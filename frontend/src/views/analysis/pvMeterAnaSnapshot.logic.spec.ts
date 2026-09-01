import { describe, expect, it } from 'vitest'
import {
  buildSnapshot, buildDetail, theoreticalKwp, annualYieldHours,
  responseSlopes, rcsTrend, medianPolish,
  type ReadingRow, type SnapshotInput, type StationCfg,
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
    stations, rows, gridPrice: 0.391,
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
  it('月段的带取自**当月之外**,不含被看的那段', () => {
    const s = snap({ month: 8 })
    expect(s.board[0].baseNote).toContain('当月之外')
  })
  it('年段的带取自这几个月自身,且**说的是实际月数**不是写死 12', () => {
    expect(snap({ gran: 'year', months: [1, 2, 3] }).board[0].baseNote).toBe('范围取自这 3 个月自身')
    expect(snap({ gran: 'year' }).board[0].baseNote).toBe('范围取自这 8 个月自身')
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
    expect(f.text).toMatch(/^\d+ 起连续 \d+ 天在正常范围下方$/)
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
