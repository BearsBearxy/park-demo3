import { describe, expect, it } from 'vitest'
import {
  buildSnapshot, buildDetail, theoreticalKwp, annualYieldHours,
  monthlyDispersion, responseSlopes, rcsTrend, medianPolish,
  type ReadingRow, type SnapshotInput, type StationCfg,
} from './pvMeterAna.logic'

/**
 * 快照与新增的六个纯函数(PV-ANALYSIS-SPEC §03)。
 * 整条链的验收在 pvMeterAnaAccept.logic.spec.ts;这一份测零件与护栏。
 */

const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

interface Opts {
  year?: number
  months?: number[]
  nStations?: number
  cap?: (i: number) => number | null
  panel?: (i: number) => { count: number | null; watt: number | null }
  metered?: (i: number) => boolean
  gen?: (i: number, m: number, d: number) => number   // 返回 0 = 该日无记录
}

function make(o: Opts = {}) {
  const y = o.year ?? 2026
  const n = o.nStations ?? 9
  const months = o.months ?? [7, 8]
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
      const date = dateOf(y, m, d)
      for (let i = 0; i < n; i++) {
        const g = o.gen ? o.gen(i, m, d) : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)
        if (g <= 0) continue
        rows.push({
          stationId: i + 1, date, gen: g,
          selfUse: g * 0.7, gridFeed: g * 0.3, revenue: g * 0.7 * 0.86, priceSnap: 0.86,
        })
      }
    }
  }
  return { stations, rows }
}
const snap = (o: Opts = {}) => {
  const { stations, rows } = make(o)
  return buildSnapshot({ year: o.year ?? 2026, stations, rows, gridPrice: 0.391 } satisfies SnapshotInput)
}

// ── 绝对基准通道 ──────────────────────────────────────────────────────
describe('theoreticalKwp —— 唯一不从发电量倒推的容量口径', () => {
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
})

describe('annualYieldHours', () => {
  it('发电 ÷ 分母', () => expect(annualYieldHours(95000, 100)).toBe(950))
  it('分母为空或 0 → null,不返回 Infinity', () => {
    expect(annualYieldHours(95000, null)).toBeNull()
    expect(annualYieldHours(95000, 0)).toBeNull()
  })
})

describe('分母优先级:理论装机 > 台账装机', () => {
  it('两个都有时用理论,并标出用的是哪个', () => {
    const s = snap({ cap: () => 200, panel: () => ({ count: 200, watt: 500 }) }).stations[0]
    expect(s.theoKwp).toBe(100)
    expect(s.yieldDenom).toBe('theoretical')
    expect(s.yieldHours).toBeCloseTo(s.genYear / 100, 6)
  })
  it('只有台账时退回台账,并标 ledger', () => {
    const s = snap({ cap: () => 200 }).stations[0]
    expect(s.yieldDenom).toBe('ledger')
    expect(s.yieldHours).toBeCloseTo(s.genYear / 200, 6)
  })
  it('两个都没有 → 分母为空,不硬算', () => {
    const s = snap({ cap: () => null }).stations[0]
    expect(s.yieldDenom).toBeNull()
    expect(s.yieldHours).toBeNull()
    expect(s.yieldRatio).toBeNull()
  })
})

describe('台账差 = (台账 − 理论) ÷ 理论', () => {
  it('台账比理论大 20%', () => {
    const s = snap({ cap: () => 120, panel: () => ({ count: 200, watt: 500 }) }).stations[0]
    expect(s.ledgerDiff).toBeCloseTo(0.2, 9)
  })
  it('板数没录 → null,不当成 0', () => {
    expect(snap({ cap: () => 120 }).stations[0].ledgerDiff).toBeNull()
  })
})

// ── 三张同网格 ────────────────────────────────────────────────────────
describe('三张网格共用同一套几何', () => {
  const s = snap({ months: [1, 2, 3] })
  it('列 = 该年出现过的月,三张的行长度都等于列数', () => {
    expect(s.months).toEqual(['2026-01', '2026-02', '2026-03'])
    for (const id of s.stations.map(x => x.id)) {
      expect(s.grid.deviation.get(id)!.length).toBe(3)
      expect(s.grid.dispersion.get(id)!.length).toBe(3)
      expect(s.grid.coverage.get(id)!.length).toBe(3)
    }
  })
  it('覆盖率 = 该月有抄表天数 ÷ 当月天数;满月为 1', () => {
    const cov = s.grid.coverage.get(1)!
    expect(cov[0]).toBeCloseTo(1, 9)
    expect(cov[1]).toBeCloseTo(1, 9)
  })
})

describe('born:未投产留白,与漏抄是两回事', () => {
  // S6 从 8 月才有记录 —— 7 月那格必须是「未投产」,不是「漏抄」
  const s = snap({ months: [7, 8], gen: (i, m) => (i === 5 && m === 7 ? 0 : 400) })
  it('该栋的首列下标 = 它第一次出现的月', () => {
    expect(s.grid.born.get(6)).toBe(1)
    expect(s.grid.born.get(1)).toBe(0)
  })
  it('未投产的月在覆盖矩阵上是 null,不是 0', () => {
    expect(s.grid.coverage.get(6)![0]).toBeNull()
  })
})

describe('月度偏离:log 域中位数换回比例', () => {
  // S1 只有最后一个月掉 20%,前两个月正常 —— α 锚在正常段上,该月的偏离才是 −20%
  const s = snap({
    months: [6, 7, 8],
    gen: (i, m) => 400 * (i === 0 && m === 8 ? 0.8 : 1),
  })
  it('掉 20% 的那栋那月约 −20%,其余月约 0', () => {
    const dev = s.grid.deviation.get(1)!
    expect(dev[0]!).toBeCloseTo(0, 1)
    expect(dev[1]!).toBeCloseTo(0, 1)
    expect(dev[2]!).toBeLessThan(-0.15)
    expect(dev[2]!).toBeGreaterThan(-0.25)
  })

  // 实测踩到的:偏移恰好占一半时,α 落在两个水平的中间,两半各显示一半的落差。
  // 这不是 bug,是抛光「α 吸收水平」的直接后果 —— 也正是 §03.1 那条盲区
  // 「抛光只看变化,看不见水平」的最小可复现形态。绝对基准通道(A1/T1)补的就是它。
  it('偏移恰好占一半时,α 落在中间,两半对称显示 —— 不是 −20% 与 0', () => {
    const half = snap({ months: [7, 8], gen: (i, m) => 400 * (i === 0 && m === 8 ? 0.8 : 1) })
    const dev = half.grid.deviation.get(1)!
    expect(dev[0]!).toBeGreaterThan(0.08)
    expect(dev[1]!).toBeLessThan(-0.08)
    expect(dev[0]! + dev[1]!).toBeCloseTo(0, 1)
  })
  it('抄表不足 4 天的月算不出中位数 → null,不画成 0', () => {
    const t = snap({ months: [7, 8], gen: (i, m, d) => (i === 0 && m === 8 && d > 3 ? 0 : 400) })
    expect(t.grid.deviation.get(1)![1]).toBeNull()
  })
})

describe('monthlyDispersion —— 一阶差分 MAD,量的是抖动不是趋势', () => {
  const { stations, rows } = make({ months: [1, 2, 3] })
  const p = medianPolish(rows.map(r => ({ stationId: r.stationId, date: r.date, gen: r.gen })), stations, null)
  it('每栋每月一个值,不足 4 天的月不给值', () => {
    const d = monthlyDispersion(p)
    expect(d.get(1)!.size).toBe(3)
    for (const v of d.get(1)!.values()) expect(v).toBeGreaterThanOrEqual(0)
  })
})

// ── 逐月斜率 ──────────────────────────────────────────────────────────
describe('responseSlopes', () => {
  const { stations, rows } = make({ months: [1, 2, 3] })
  const day = rows.map(r => ({ stationId: r.stationId, date: r.date, gen: r.gen }))
  const p = medianPolish(day, stations, null)
  const sl = responseSlopes(day, p, stations)

  it('每栋每月一行,带 β / 标准误 / R² / 样本数', () => {
    const rowsS1 = sl.get(1)!
    expect(rowsS1.map(r => r.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    for (const r of rowsS1) {
      expect(r.n).toBeGreaterThan(20)
      expect(Number.isFinite(r.beta)).toBe(true)
    }
  })
  it('各栋与全园同步涨落时 β 贴近 1', () => {
    for (const [, arr] of sl) for (const r of arr) expect(r.beta, r.key).toBeCloseTo(1, 1)
  })
  it('by=year 时每栋只有一行', () => {
    const y = responseSlopes(day, p, stations, 'year')
    expect(y.get(1)!.length).toBe(1)
    expect(y.get(1)![0].key).toBe('2026')
  })
})

// ── 样条 ──────────────────────────────────────────────────────────────
describe('rcsTrend —— 不预设形状,曲线自己长出来', () => {
  const mk = (f: (i: number) => number, n = 120) =>
    Array.from({ length: n }, (_, i) => ({ date: dateOf(2026, 1 + Math.floor(i / 31), (i % 31) + 1), v: f(i) }))

  it('点数不够时返回空数组,不是画一条假线', () => {
    expect(rcsTrend(mk(() => 0, 4))).toEqual([])
  })
  it('每个点给拟合值与上下界,且 lo ≤ fit ≤ hi', () => {
    const r = rcsTrend(mk(i => Math.sin(i / 20) * 0.1))
    expect(r.length).toBe(120)
    for (const x of r) {
      expect(x.lo).toBeLessThanOrEqual(x.fit + 1e-9)
      expect(x.hi).toBeGreaterThanOrEqual(x.fit - 1e-9)
    }
  })
  it('**阶跃被平滑成缓坡** —— 这证明它与变点检验互补而不是重复', () => {
    const r = rcsTrend(mk(i => (i < 60 ? 0 : -0.4)))
    const at = (i: number) => r[i].fit
    // 拟合在断点两侧不是直上直下:断点前后各 8 个点之间必须有中间值
    const mid = at(60)
    expect(mid).toBeGreaterThan(-0.4)
    expect(mid).toBeLessThan(0)
    // 两端仍然分得开
    expect(at(5) - at(114)).toBeGreaterThan(0.2)
  })
  it('常数序列上置信带很窄 —— 不确定性反映的是数据,不是凭空的宽度', () => {
    const r = rcsTrend(mk(() => 0.3))
    for (const x of r) expect(x.hi - x.lo).toBeLessThan(0.01)
  })
})

// ── 命中清单的三条硬规矩 ──────────────────────────────────────────────
describe('criteriaHits 的三条硬规矩(§04.3)', () => {
  it('① 只列命中的,不列「正常」的 —— 干净数据上一条 readable 命中都没有', () => {
    const s = snap({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], panel: () => ({ count: 200, watt: 500 }), cap: () => 100 })
    expect(s.hits.filter(h => h.readable && h.criterion !== 'yield')).toEqual([])
  })

  it('② 按楼栋固定顺序,不按严重度排', () => {
    const s = snap({
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      cap: i => (i === 7 ? 300 : 100),                    // S8 台账差最大
      panel: () => ({ count: 200, watt: 500 }),
    })
    const order = s.hits.map(h => h.stationId)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('③ 在网不足 90 天的栋整栋一行「读不出」,不逐条重复', () => {
    const s = snap({ months: [7, 8] })                    // 62 天
    const one = s.hits.filter(h => h.stationId === 1)
    expect(one.length).toBe(1)
    expect(one[0].readable).toBe(false)
    expect(one[0].what).toBe('在网天数')
    expect(one[0].line).toContain('读不出')
  })

  it('命中行是三段式:哪个数 · 多少 · 跟什么比', () => {
    const s = snap({
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      cap: i => (i === 2 ? 150 : 100),
      panel: () => ({ count: 200, watt: 500 }),
    })
    const h = s.hits.find(x => x.criterion === 'ledger' && x.readable)!
    expect(h.what).toBe('台账差')
    expect(h.value).toContain('vs 理论')
    expect(h.line).toMatch(/^判据线 ±\d+%$/)
  })

  it('未装表的栋整站不出现在清单里 —— 它永远不用管', () => {
    const s = snap({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], metered: i => i !== 3 })
    expect(s.hits.some(h => h.stationId === 4)).toBe(false)
    expect(s.quality.noMeter).toEqual(['S4'])
  })
})

// ── 账面量 ────────────────────────────────────────────────────────────
describe('账面量零容量依赖 —— 板数与台账都没录也照常出真数', () => {
  const s = snap({ months: [1, 2, 3], cap: () => null })
  it('消纳结构逐月给自消纳 / 上网 / 损耗与损耗率', () => {
    expect(s.ledger.monthly.labels).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(s.ledger.monthly.self.every(v => v > 0)).toBe(true)
    expect(s.ledger.monthly.grid.every(v => v > 0)).toBe(true)
    // 夹具里 gen = self + grid,所以损耗恒为 0 —— 关键是它算得出来,不是 NaN
    for (const v of s.ledger.monthly.lossPct) expect(Number.isFinite(v)).toBe(true)
  })
  it('每栋的收益拆成消纳与上网两笔', () => {
    for (const st of s.stations) {
      expect(st.revSelf).toBeGreaterThan(0)
      expect(st.revGrid).toBeCloseTo(st.gridKwh * 0.391, 6)
    }
  })
})

// ── 护栏 ──────────────────────────────────────────────────────────────
describe('护栏', () => {
  it('未装表:整站不进抛光,并单独列名', () => {
    const s = snap({ metered: i => i !== 2 })
    expect(s.quality.noMeter).toEqual(['S3'])
    expect(s.polish.alpha.has(3)).toBe(false)
  })
  it('未录容量与未录板数分开列名 —— 前者算不出效率,后者只是没有绝对基准', () => {
    const s = snap({ cap: i => (i === 0 ? null : 100), panel: i => (i === 1 ? { count: 200, watt: 500 } : { count: null, watt: null }) })
    expect(s.quality.noCapacity).toEqual(['S1'])
    expect(s.quality.noPanel).toContain('S1')
    expect(s.quality.noPanel).not.toContain('S2')
  })
  it('在网栋数不足时降级,并把这件事记在质量里', () => {
    const s = snap({ nStations: 2 })
    expect(s.quality.tooFewStations).toBe(true)
    expect(s.quality.degraded).toBe(true)
  })
  it('上一年无抄表 → 同比显「没得比」,不显 0%', () => {
    const { stations, rows } = make({ months: [1, 2, 3] })
    const s = buildSnapshot({ year: 2026, stations, rows, gridPrice: 0.391, prevRows: [] })
    expect(s.yoy.yearPct).toBeNull()
    expect(s.yoy.yearNote).toContain('没得比')
  })
  it('同比跨年月份不齐:按两年都有抄表的月对齐,并报出参与月数', () => {
    const cur = make({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
    const prev = make({ months: [1, 2, 3], year: 2025 })
    const s = buildSnapshot({ year: 2026, stations: cur.stations, rows: cur.rows, gridPrice: 0.391, prevRows: prev.rows })
    expect(s.yoy.yearMonths).toBe(3)
    expect(Math.abs(s.yoy.yearPct!)).toBeLessThan(20)
  })
})

// ── 单栋抽屉 ──────────────────────────────────────────────────────────
describe('buildDetail(L5)', () => {
  it('在网不足 8 天返回 null —— 画不出就说画不出,不画一条假线', () => {
    const s = snap({ months: [7], gen: (i, m, d) => (d > 5 ? 0 : 400) })
    expect(buildDetail(s, 1)).toBeNull()
  })
  it('控制限用**变点前段**估,并把估计窗口给出来', () => {
    // S1 从 8/10 起掉 30%:控制限的估计窗口必须停在变点附近,不是整期
    const s = snap({
      months: [7, 8],
      gen: (i, m, d) => 400 * (i === 0 && m === 8 && d >= 10 ? 0.7 : 1),
    })
    const d = buildDetail(s, 1)!
    expect(d.cpDate).not.toBeNull()
    expect(d.limitFrom).toBe('2026-07-01')
    expect(d.limitTo!.localeCompare(d.cpDate!)).toBeLessThanOrEqual(0)
    // 整期估的话故障段会把 σ 撑大;前段估出来的必须明显更小
    const wholeSigma = Math.abs(d.resid.reduce((a, b) => a + b, 0) / d.resid.length)
    expect(d.sigma).toBeLessThan(0.2 + wholeSigma)
  })
  it('样条与残差同长,变点区间在日期序列里', () => {
    const s = snap({ months: [1, 2, 3] })
    const d = buildDetail(s, 1)!
    expect(d.spline.length).toBe(d.resid.length)
    if (d.cpLo) expect(d.dates).toContain(d.cpLo)
    if (d.cpHi) expect(d.dates).toContain(d.cpHi)
  })
})
