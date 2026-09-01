import { describe, expect, it } from 'vitest'
import {
  buildSnapshot, buildDetail, theoreticalKwp, annualYieldHours,
  responseSlopes, rcsTrend, medianPolish, median, robustSigma, runsOf,
  type AnaSnapshot, type ReadingRow, type SnapshotInput, type StationCfg, type TickState,
} from './pvMeterAna.logic'

/**
 * 快照与零件(PV-ANALYSIS-SPEC §03)。整条链的验收在 pvMeterAnaAccept.logic.spec.ts。
 */

const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

interface Opts {
  year?: number
  months?: number[]
  nStations?: number
  gran?: 'month' | 'year'
  month?: number
  cap?: (i: number) => number | null
  panel?: (i: number) => { count: number | null; watt: number | null }
  metered?: (i: number) => boolean
  gen?: (i: number, m: number, d: number) => number   // 返回 0 = 该日无记录
  /** 「今天」。不给也钉一个 —— 拿系统当天的话,这份夹具在 2026-08 当月跑会整批变「未到」 */
  today?: string
}

function make(o: Opts = {}) {
  const y = o.year ?? 2026
  const n = o.nStations ?? 9
  const months = o.months ?? [1, 2, 3, 4, 5, 6, 7, 8]
  const stations: StationCfg[] = Array.from({ length: n }, (_, i) => {
    const p = o.panel ? o.panel(i) : { count: null, watt: null }
    return {
      id: i + 1, name: `S${i + 1}`, phase: i < 5 ? 1 : 2,
      metered: o.metered ? o.metered(i) : true,
      capKwp: o.cap ? o.cap(i) : 100,
      panelCount: p.count, panelWatt: p.watt,
    }
  })
  const rows: ReadingRow[] = []
  for (const m of months) {
    const dim = new Date(y, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      for (let i = 0; i < n; i++) {
        const g = o.gen ? o.gen(i, m, d) : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)
        if (g <= 0) continue
        rows.push({
          stationId: i + 1, date: dateOf(y, m, d), gen: g,
          selfUse: g * 0.7, gridFeed: g * 0.3, revenue: g * 0.7 * 0.86, priceSnap: 0.86,
        })
      }
    }
  }
  return { stations, rows }
}
const snap = (o: Opts = {}) => {
  const { stations, rows } = make(o)
  return buildSnapshot({
    year: o.year ?? 2026, gran: o.gran ?? 'month', month: o.month ?? 8,
    stations, rows, gridPrice: 0.391, today: o.today ?? '2026-09-01',
  } satisfies SnapshotInput)
}

// ── 期间与刻度 ────────────────────────────────────────────────────────
describe('两档缩放:月段逐日、年段逐月', () => {
  it('月段的刻度 = 当月每一天;标签是日号', () => {
    const s = snap({ month: 8 })
    expect(s.ticks).toHaveLength(31)
    expect(s.ticks[0]).toBe('2026-08-01')
    expect(s.tickLabels.slice(0, 3)).toEqual(['1', '2', '3'])
  })
  it('2 月按当月实际天数,不是写死 31', () => {
    expect(snap({ months: [1, 2, 3], month: 2 }).ticks).toHaveLength(28)
  })
  it('年段的刻度 = 出现过的月;标签带「月」', () => {
    const s = snap({ gran: 'year', months: [1, 2, 3] })
    expect(s.ticks).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(s.tickLabels).toEqual(['1月', '2月', '3月'])
  })
  it('**模型永远吃全年** —— 切段不改喂进去的数据', () => {
    const a = snap({ month: 7 })
    const b = snap({ month: 8 })
    expect(a.quality.totalDays).toBe(b.quality.totalDays)
    expect(a.stations[0].days).toBe(b.stations[0].days)
    expect(a.stations[0].genYear).toBeCloseTo(b.stations[0].genYear, 6)
  })
  it('账面量与等效小时都跟着刻度走', () => {
    expect(snap({ month: 8 }).ledger.self).toHaveLength(31)
    expect(snap({ gran: 'year' }).ledger.self).toHaveLength(8)
    expect(snap({ month: 8 }).ledger.yield).toHaveLength(31)
  })
})

// ── 看板 ──────────────────────────────────────────────────────────────
describe('看板:这栋 ÷ 全园同刻度中位', () => {
  it('**不用装机容量** —— 分子分母都是实测度数', () => {
    const withCap = snap({ cap: () => 100 })
    const noCap = snap({ cap: () => null })
    expect(noCap.board.map(b => b.ratio)).toEqual(withCap.board.map(b => b.ratio))
  })
  it('各栋规模不同时比值本身有高有低,但每栋的带是自己的', () => {
    const s = snap({ gen: (i) => 400 * (i === 0 ? 2 : 1) })
    const big = s.board.find(b => b.name === 'S1')!
    expect(big.center!).toBeGreaterThan(1.5)
    // 它一直是这个水平,所以没出自己的带
    expect(big.out.filter(v => v === 1 || v === -1)).toEqual([])
  })
  // v3 口径变更(§03.7):窗口从「整年减当月」换成「同批在网 ∩ 同运行状态 ∩ 变点之前」,
  // 措辞随之从「范围取自…」换成「基线取 首 ~ 末 共 N 天（生效的条件）」。
  // **「不含被看的那段」这条没变**,所以这里改的是断言的措辞,不是断言的意思。
  it('月段的带取自**段外**,不含被看的那段', () => {
    const s = snap({ month: 8 })
    const note = s.board[0].baseNote
    expect(note).toContain('基线取 2026-01-01 ~ 07-31')     // 窗口在当月之前收口
    expect(note).toContain('同批在网')                       // §03.7 条件①,永远写出来
    expect(note).not.toContain('2026-08')                   // 当月一天都没进窗口
  })
  it('年段的带取自这几个月自身,且**说的是实际月数**不是写死 12', () => {
    // 8 个月 ≥ minN 6 → 画得出带,而且说的是 8 不是 12
    expect(snap({ gran: 'year' }).board[0].baseNote).toBe('基线取 2026-01 ~ 08 共 8 个月（同批在网）')
    // 3 个月够不到 minN 6 → **明说画不出**,不是画一条 3 个点估出来的假带
    const thin = snap({ gran: 'year', months: [1, 2, 3] }).board[0]
    expect(thin.baseNote).toBe('可用历史刻度只有 3 个月，不足 6 个月，画不出正常范围')
    expect(thin.lo).toBeNull()
  })
  it('整月掉下去的栋:带不会被它自己撑宽,整月落在带外', () => {
    const s = snap({ month: 8, gen: (i, m) => 400 * (i === 0 && m === 8 ? 0.7 : 1) })
    const b = s.board.find(x => x.name === 'S1')!
    expect(b.out.filter(v => v === -1).length).toBeGreaterThanOrEqual(28)
  })
  it('缺抄的刻度是 null,out 也是 null —— 不当成 0 也不当成正常', () => {
    const s = snap({ month: 8, gen: (i, m, d) => (i === 0 && m === 8 && d > 20 ? 0 : 400) })
    const b = s.board.find(x => x.name === 'S1')!
    expect(b.ratio[25]).toBeNull()
    expect(b.out[25]).toBeNull()
  })
  it('历史不够时给不出带,而不是给一条假的', () => {
    const s = snap({ months: [8], month: 8 })     // 只有当月,段外没有数据
    expect(s.board[0].lo).toBeNull()
    expect(s.board[0].out.every(v => v === null)).toBe(true)
  })
  it('未装表的栋不进看板', () => {
    const s = snap({ metered: i => i !== 2 })
    expect(s.board.some(b => b.name === 'S3')).toBe(false)
    expect(s.quality.noMeter).toEqual(['S3'])
  })
})

// ── 事实清单 ──────────────────────────────────────────────────────────
describe('事实清单的三条硬规矩(§04.3)', () => {
  it('① 只列有话可说的 —— 干净数据上不报出范围', () => {
    const s = snap({ month: 8, panel: () => ({ count: 200, watt: 500 }), cap: () => 100 })
    expect(s.facts.filter(f => f.kind === 'run' || f.kind === 'scatter')).toEqual([])
  })
  it('② 按楼栋固定顺序,不按严重度排', () => {
    const s = snap({ month: 8, cap: i => (i === 7 ? 300 : 100), panel: () => ({ count: 200, watt: 500 }) })
    const order = s.facts.map(f => f.stationId)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
  it('③ 抄得太少时说「只抄了几天」,不给结论', () => {
    const s = snap({ month: 8, gen: (i, m, d) => (i === 0 && m === 8 && d > 4 ? 0 : 400) })
    const f = s.facts.filter(x => x.station === 'S1' && x.kind === 'thin')
    expect(f.length).toBe(1)
    expect(f[0].text).toContain('只抄了 4 天')
  })
  it('每行是一句事实:日期 + 天数 + 方向,没有判词也没有 p/q', () => {
    const s = snap({ month: 8, gen: (i, m) => 400 * (i === 0 && m === 8 ? 0.7 : 1) })
    const f = s.facts.find(x => x.station === 'S1' && x.kind === 'run')!
    // v3(§03.8):末端正好是数据截止日的段带「（仍在持续）」后缀。**它也是一句事实**,
    // 不是判词 —— 所以正则放宽到「可选后缀」,下面「仍在持续」那一组再逐条钉它出不出现。
    expect(f.text).toMatch(/^\d+ 起连续 \d+ 天在正常范围下方(（仍在持续）)?$/)
    for (const w of ['异常', '正常。', '建议', 'q', 'p 值', '缺口']) expect(f.text).not.toContain(w)
  })
  it('台账差把两个数都写出来,可复算', () => {
    const s = snap({ month: 8, cap: i => (i === 2 ? 150 : 100), panel: () => ({ count: 200, watt: 500 }) })
    const f = s.facts.find(x => x.station === 'S3' && x.kind === 'ledger')!
    expect(f.text).toContain('150.0')
    expect(f.text).toContain('100.0')
  })
  it('年等效小时只在年段说 —— 它本来就是年粒度的', () => {
    const m = snap({ month: 8 })
    const y = snap({ gran: 'year' })
    expect(m.facts.some(f => f.kind === 'yield')).toBe(false)
    expect(y.facts.some(f => f.kind === 'yield')).toBe(true)
  })
})

// ── 绝对基准通道 ──────────────────────────────────────────────────────
describe('theoreticalKwp / annualYieldHours', () => {
  const st = (count: number | null, watt: number | null): StationCfg =>
    ({ id: 1, name: 'X', phase: 1, metered: true, capKwp: 100, panelCount: count, panelWatt: watt })
  it('板数 × 单块标称功率 ÷ 1000', () => {
    expect(theoreticalKwp(st(1000, 500))).toBe(500)
    expect(theoreticalKwp(st(680, 545))).toBeCloseTo(370.6, 6)
  })
  it('两列任一为空 → null,不猜也不退回台账', () => {
    expect(theoreticalKwp(st(null, 500))).toBeNull()
    expect(theoreticalKwp(st(1000, null))).toBeNull()
    expect(theoreticalKwp(st(0, 500))).toBeNull()
  })
  it('分母为空或 0 → null,不返回 Infinity', () => {
    expect(annualYieldHours(95000, null)).toBeNull()
    expect(annualYieldHours(95000, 0)).toBeNull()
  })
  it('分母优先理论装机,没有就退回台账并标出来', () => {
    expect(snap({ cap: () => 200, panel: () => ({ count: 200, watt: 500 }) }).stations[0].yieldDenom).toBe('theoretical')
    expect(snap({ cap: () => 200 }).stations[0].yieldDenom).toBe('ledger')
    expect(snap({ cap: () => null }).stations[0].yieldDenom).toBeNull()
  })
  it('台账差 = (台账 − 理论) ÷ 理论;板数没录时为 null 不是 0', () => {
    expect(snap({ cap: () => 120, panel: () => ({ count: 200, watt: 500 }) }).stations[0].ledgerDiff).toBeCloseTo(0.2, 9)
    expect(snap({ cap: () => 120 }).stations[0].ledgerDiff).toBeNull()
  })
})

// ── 逐月斜率与样条 ────────────────────────────────────────────────────
describe('responseSlopes', () => {
  const { stations, rows } = make({ months: [1, 2, 3] })
  const day = rows.map(r => ({ stationId: r.stationId, date: r.date, gen: r.gen }))
  const p = medianPolish(day, stations, null)
  const sl = responseSlopes(day, p, stations)
  it('每栋每月一行,带 β / 标准误 / R² / 样本数', () => {
    expect(sl.get(1)!.map(r => r.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    for (const r of sl.get(1)!) expect(r.n).toBeGreaterThan(20)
  })
  it('各栋与全园同步涨落时 β 贴近 1', () => {
    for (const [, arr] of sl) for (const r of arr) expect(r.beta, r.key).toBeCloseTo(1, 1)
  })
})

describe('rcsTrend —— 不预设形状,曲线自己长出来', () => {
  const mk = (f: (i: number) => number, n = 120) =>
    Array.from({ length: n }, (_, i) => ({ date: dateOf(2026, 1 + Math.floor(i / 31), (i % 31) + 1), v: f(i) }))
  it('点数不够时返回空数组,不是画一条假线', () => {
    expect(rcsTrend(mk(() => 0, 4))).toEqual([])
  })
  it('每个点给拟合值与上下界,且 lo ≤ fit ≤ hi', () => {
    for (const x of rcsTrend(mk(i => Math.sin(i / 20) * 0.1))) {
      expect(x.lo).toBeLessThanOrEqual(x.fit + 1e-9)
      expect(x.hi).toBeGreaterThanOrEqual(x.fit - 1e-9)
    }
  })
  it('**阶跃被平滑成缓坡** —— 这证明它与变点检验互补而不是重复', () => {
    const r = rcsTrend(mk(i => (i < 60 ? 0 : -0.4)))
    expect(r[60].fit).toBeGreaterThan(-0.4)
    expect(r[60].fit).toBeLessThan(0)
    expect(r[5].fit - r[114].fit).toBeGreaterThan(0.2)
  })
  it('常数序列上置信带很窄 —— 不确定性反映的是数据,不是凭空的宽度', () => {
    for (const x of rcsTrend(mk(() => 0.3))) expect(x.hi - x.lo).toBeLessThan(0.01)
  })
})

// ── 护栏与抽屉 ────────────────────────────────────────────────────────
describe('护栏', () => {
  it('未录容量与未录板数分开列名', () => {
    const s = snap({ cap: i => (i === 0 ? null : 100), panel: i => (i === 1 ? { count: 200, watt: 500 } : { count: null, watt: null }) })
    expect(s.quality.noCapacity).toEqual(['S1'])
    expect(s.quality.noPanel).toContain('S1')
    expect(s.quality.noPanel).not.toContain('S2')
  })
  it('在网栋数不足时降级,并记在质量里', () => {
    const s = snap({ nStations: 2 })
    expect(s.quality.tooFewStations).toBe(true)
    expect(s.quality.degraded).toBe(true)
  })
  it('上一年无抄表 → 同比显「没得比」,不显 0%', () => {
    const { stations, rows } = make({ months: [1, 2, 3] })
    const s = buildSnapshot({ year: 2026, gran: 'year', stations, rows, gridPrice: 0.391, prevRows: [] })
    expect(s.yoy.yearPct).toBeNull()
    expect(s.yoy.yearNote).toContain('没得比')
  })
  it('同比跨年月份不齐:按两年都有抄表的月对齐,并报出参与月数', () => {
    const cur = make({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
    const prev = make({ months: [1, 2, 3], year: 2025 })
    const s = buildSnapshot({ year: 2026, gran: 'year', stations: cur.stations, rows: cur.rows, gridPrice: 0.391, prevRows: prev.rows })
    expect(s.yoy.yearMonths).toBe(3)
    expect(Math.abs(s.yoy.yearPct!)).toBeLessThan(20)
  })
})

describe('buildDetail(L5)—— 始终整年逐日,与期间无关', () => {
  it('在网不足 8 天返回 null', () => {
    const s = snap({ months: [7], month: 7, gen: (i, m, d) => (d > 5 ? 0 : 400) })
    expect(buildDetail(s, 1)).toBeNull()
  })
  it('控制限用**变点前段**估,并把估计窗口给出来', () => {
    const s = snap({ months: [7, 8], month: 8, gen: (i, m, d) => 400 * (i === 0 && m === 8 && d >= 10 ? 0.7 : 1) })
    const d = buildDetail(s, 1)!
    expect(d.cpDate).not.toBeNull()
    expect(d.limitFrom).toBe('2026-07-01')
    expect(d.limitTo!.localeCompare(d.cpDate!)).toBeLessThanOrEqual(0)
  })
  it('切换期间不影响抽屉:同一栋两段算出同一条曲线', () => {
    const a = snap({ month: 7 })
    const b = snap({ month: 8 })
    expect(buildDetail(b, 1)!.resid).toEqual(buildDetail(a, 1)!.resid)
  })
})

// ── v3:月中未录全(§03.8 / §08 v3 第 1·3·4 条)────────────────────────
//
// 8 月 15 号打开这屏:8/01–8/15 已过去,其中 8/07 漏抄,8/16 起未到。
// 覆盖率的分母是**已过去的 15 天**,不是整月 31 天 —— 分母写成整月的话
// 14/31 = 45%,13 栋一股脑掉进「读不出」,屏上什么都不剩,而这屏存在的理由
// 恰恰是「录完几天内就能看出」。
const midMonth = () => snap({
  today: '2026-08-15',
  gen: (_i, m, d) => (m === 8 && (d === 7 || d > 15) ? 0 : 400),
})

describe('月中未录全:覆盖率的分母是「已过去」不是「整段」(§08 v3-3)', () => {
  it('两条边界各自算出来:数据截止 8/15、已过去 15 个刻度、整段仍是 31', () => {
    const s = midMonth()
    expect(s.ticks).toHaveLength(31)          // x 轴照旧画满整段,不随录到哪天伸缩
    expect(s.dataThrough).toBe('2026-08-15')
    expect(s.elapsedN).toBe(15)
    expect(s.elapsedN).not.toBe(s.ticks.length)
  })

  it('三态分开数:14 已抄 / 1 漏抄 / 16 未到,未到处 out 是 null 不是 0', () => {
    const b = midMonth().board[0]
    expect(b.state.filter(v => v === 'seen')).toHaveLength(14)
    expect(b.state.filter(v => v === 'missing')).toHaveLength(1)
    expect(b.state.filter(v => v === 'future')).toHaveLength(16)
    expect(b.state[6]).toBe('missing')        // 8/07 漏抄
    expect(b.state[15]).toBe('future')        // 8/16 未到
    expect(b.out[6]).toBeNull()
    expect(b.out[15]).toBeNull()
    expect(b.seenN).toBe(14)
    expect(b.elapsedN).toBe(15)               // = 已抄 + 漏抄,不含未到
  })

  it('14 / 15 = 93% ≥ 90% → **一栋都不进「读不出」**', () => {
    const s = midMonth()
    // 这条是分母写错时的红灯:按整段算是 14/31 = 45%,低于判据线,每一栋都会多出一条 thin
    expect(14 / s.ticks.length).toBeCloseTo(0.45, 2)
    expect(14 / s.ticks.length).toBeLessThan(s.crit.coverMonth)
    expect(14 / s.board[0].elapsedN).toBeGreaterThanOrEqual(s.crit.coverMonth)
    expect(s.facts.filter(f => f.kind === 'thin')).toEqual([])
  })

  it('分母**真的**是逐栋的 elapsedN:再漏两天(12/15 = 80%)就该说「只抄了几天」', () => {
    const s = snap({
      today: '2026-08-15',
      gen: (i, m, d) => (m === 8 && (d > 15 || d === 7 || (i === 0 && (d === 3 || d === 5))) ? 0 : 400),
    })
    const f = s.facts.filter(x => x.station === 'S1' && x.kind === 'thin')
    expect(f).toHaveLength(1)
    expect(f[0].text).toBe('本月只抄了 12 天，已过去 15 天')
    // 同一份数据里其余栋照旧读得出 —— 覆盖率是逐栋算的,不是全屏一刀切
    expect(s.facts.filter(x => x.kind === 'thin' && x.station !== 'S1')).toEqual([])
  })
})

describe('「仍在持续」只认数据截止日(§03.8 / §08 v3-4)', () => {
  const low = (i: number, m: number) => 400 * (i === 0 && m === 8 ? 0.7 : 1)
  it('段末端 == 数据截止日 → 带「（仍在持续）」', () => {
    const s = snap({ month: 8, gen: low })
    expect(s.dataThrough).toBe('2026-08-31')
    expect(s.facts.find(x => x.station === 'S1' && x.kind === 'run')!.text)
      .toBe('1 起连续 31 天在正常范围下方（仍在持续）')
  })
  it('9 月回看 8 月:同一段已经结束了 → **不带**后缀', () => {
    const s = snap({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9], month: 8, today: '2026-10-01', gen: low })
    expect(s.dataThrough).toBe('2026-09-30')
    expect(s.facts.find(x => x.station === 'S1' && x.kind === 'run')!.text)
      .toBe('1 起连续 31 天在正常范围下方')
  })
})

// ── v3:基线窗口(§03.7 / §08 v3-6)────────────────────────────────────
//
// §03.7 那张表的可执行版本。夹具照那张表的**结构**复刻(不是数值):
// 一期 5 栋 1/1 在网,二期 6 栋 6/1 并网且容量更大 —— 全园中位从 460 抬到 520,
// 一期 5 栋的比值**什么都没干就集体下移 ~12%**。
// 种入的靶子照 §08:F座 7/18 起 ×0.72。
const B_YEAR = 2025
const FAULT = 'F座'
const CAPS: [string, number][] = [
  ['A座', 500], ['B座', 480], ['E座', 460], [FAULT, 440], ['G座', 420],   // 一期,1/1
  ['8栋', 520], ['9栋', 530], ['10栋', 540], ['11栋', 550], ['12栋', 560], ['13栋', 570], // 二期,6/1
]
const P1_NAMES = CAPS.slice(0, 5).map(([n]) => n)

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

function cohortInput(): SnapshotInput {
  const stations: StationCfg[] = CAPS.map(([name, cap], i) => ({
    id: i + 1, name, phase: i < 5 ? 1 : 2, metered: true,
    capKwp: cap, panelCount: (cap * 1000) / 500, panelWatt: 500,
  }))
  const rows: ReadingRow[] = []
  for (let m = 1; m <= 8; m++) {
    const dim = new Date(B_YEAR, m, 0).getDate()
    const park = lcg(B_YEAR * 100 + m)            // 全园共享的天气因子(种子不含站 id)
    const w = Array.from({ length: dim }, () => 0.55 + park() * 0.9)
    stations.forEach((s, i) => {
      if (i >= 5 && m < 6) return                 // 二期 6/1 才在网
      const jit = lcg(s.id * 100000 + B_YEAR * 100 + m)
      for (let d = 1; d <= dim; d++) {
        const fault = s.name === FAULT && (m > 7 || (m === 7 && d >= 18)) ? 0.72 : 1
        const gen = CAPS[i][1] * w[d - 1] * (0.98 + jit() * 0.04) * fault
        rows.push({
          stationId: s.id, date: dateOf(B_YEAR, m, d), gen,
          selfUse: gen * 0.7, gridFeed: gen * 0.3, revenue: gen * 0.7 * 0.86, priceSnap: 0.86,
        })
      }
    })
  }
  return { year: B_YEAR, gran: 'month', month: 8, stations, rows, gridPrice: 0.391, today: '2025-09-01' }
}

/** v2 口径:窗口 = 整年减当月。逐字复刻旧实现(median + robustSigma × bandSigma),**只换窗口**,
 *  这样两边的「命中」用的是同一把尺(runsOf ≥ bandRun 个连续同向),差别只来自窗口本身。 */
function hitsOldWindow(inp: SnapshotInput, s: AnaSnapshot): string[] {
  const byKey = new Map<string, Map<number, number>>()
  for (const r of inp.rows) {
    if (!(r.gen > 0)) continue
    const m = byKey.get(r.date) ?? new Map<number, number>()
    m.set(r.stationId, (m.get(r.stationId) ?? 0) + r.gen)
    byKey.set(r.date, m)
  }
  const ratio = new Map<number, Map<string, number>>()
  for (const [k, per] of byKey) {
    const mid = median([...per.values()])
    if (!(mid > 0)) continue
    for (const [id, gen] of per) {
      const m = ratio.get(id) ?? new Map<string, number>()
      m.set(k, gen / mid)
      ratio.set(id, m)
    }
  }
  const segSet = new Set(s.ticks)
  return s.board.filter(b => {
    const all = ratio.get(b.id) ?? new Map<string, number>()
    const base = [...all].filter(([k]) => !segSet.has(k)).map(([, v]) => v)
    if (base.length < 20) return false
    const center = median(base)
    const half = Math.max(robustSigma(base), 1e-6) * s.crit.bandSigma
    const out = s.ticks.map(t => {
      const v = all.get(t)
      return v == null ? null : v < center - half ? -1 : v > center + half ? 1 : 0
    })
    const state = out.map(v => (v == null ? 'missing' : 'seen')) as TickState[]
    return runsOf(out, state, s.crit.bandRun, s.ticks.length - 1).length > 0
  }).map(b => b.name)
}

describe('基线窗口:整年减当月 vs 三条件齐(§03.7 / §08 v3-6)', () => {
  const inp = cohortInput()
  const s = buildSnapshot(inp)
  const hitsNew = s.board.filter(b => b.runs.length > 0).map(b => b.name)
  const hitsOld = hitsOldWindow(inp, s)

  it('夹具本身:二期 6/1 并网,一期 5 栋的比值什么都没干就集体下移', () => {
    const rOf = (m: number, d: number) =>
      buildSnapshot({ ...inp, month: m }).board[0].ratio[d - 1]!
    const before = rOf(5, 15)
    const after = rOf(6, 15)
    expect(s.board[0].name).toBe('A座')
    expect(after / before).toBeLessThan(0.95)
    expect(after / before).toBeGreaterThan(0.80)
  })

  it('**两个窗口给出的命中栋数不同** —— 差的那几栋是并网批次换了口径,不是它们变了', () => {
    expect(hitsOld.length).not.toBe(hitsNew.length)
    expect(hitsOld.length).toBeGreaterThan(hitsNew.length)
    // 旧口径:一期 5 栋全被报出来(窗口里 1–5 月的 151 天把中心定在换批之前的水平)
    expect(hitsOld).toEqual(P1_NAMES)
  })

  it('三条件齐的窗口里**只剩种入的那栋** —— 4 栋误报消失,靶子还在', () => {
    expect(hitsNew).toContain(FAULT)
    expect(hitsNew).toEqual([FAULT])
    for (const n of P1_NAMES.filter(x => x !== FAULT)) expect(hitsOld, n).toContain(n)
  })

  it('窗口写在屏上:F座 的 baseNote 报出三条件里实际生效的那几条', () => {
    const f = s.board.find(b => b.name === FAULT)!
    expect(f.baseNote).toContain('基线取')
    expect(f.baseNote).toContain('同批在网')     // 条件①
    expect(f.baseNote).toContain('变点之前')     // 条件③:窗口在种入日之前收口
    expect(f.baseNote).not.toContain('2025-08') // 当段不进窗口
  })

  it('靶子亮:F座 8 月整月落在正常范围下方,偏离约 −28%', () => {
    const f = s.board.find(b => b.name === FAULT)!
    expect(f.out.filter(v => v === -1)).toHaveLength(31)
    expect(f.maxDev).toBeLessThan(-0.2)
    expect(f.maxDev).toBeGreaterThan(-0.36)
  })
})
