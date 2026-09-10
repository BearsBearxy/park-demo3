// 驾驶舱 v2 纯函数单测(铁律⑦):取期/环比/主图整形/构成/分期堆叠/收缴取期/欠费清单/预算达成。
// 折万与聚合口径必须与 v1 一致(锚点:2025-10 营收 9,301,531 元 → 930.15 万)。
import { describe, expect, it } from 'vitest'
import {
  anchorMonth, arrearsOf, atPeriod, budgetAch, budgetRevenueOf, buildConclusion, colPick, compoData, mainChart, momOf, phaseStack, schedTrend,
} from './cockpit.logic'
import type { PnlSummary, S10PhaseMonthly, CollectRate } from '@/analysis/anaData'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'

const N12 = (): (number | null)[] => new Array(12).fill(null)
function pnl(p: Partial<PnlSummary>): PnlSummary {
  return { year: 2025, months: [], revenue: N12(), cost: N12(), profit: N12(), bySchedule: {}, ...p }
}
function ledger(p: Partial<AnalysisLedgerRow>): AnalysisLedgerRow {
  return {
    companyId: 1, companyName: '甲公司', year: 2025, month: 10,
    tenantId: 1, tenantName: '租户A', balancePrev: 0, receivable: 100, collected: 100, balanceEnd: 0,
    ...p,
  }
}
const budgetRow = (p: Partial<BudgetRowDTO>): BudgetRowDTO =>
  ({ year: 2025, label: '收入总计', sub: false, budget: null, actual: null, note: null, sortOrder: 0, ...p })

describe('atPeriod / momOf(v1 口径原样抽出)', () => {
  const arr = [100, null, 300, ...new Array(9).fill(null)] as (number | null)[]
  it('月=当月(含 null);年=有数月Σ;全 null → null', () => {
    expect(atPeriod(arr, true, 0)).toBe(100)
    expect(atPeriod(arr, true, 1)).toBeNull()
    expect(atPeriod(arr, false, 0)).toBe(400)
    expect(atPeriod(N12(), false, 0)).toBeNull()
    expect(atPeriod(undefined, true, 0)).toBeNull()
  })
  it('环比对比上一有数月(跳过 null);上月为 0 → null;年粒度 → null', () => {
    expect(momOf(arr, true, 2)).toBe(200)          // 300 vs 100(跳过 null 的 2 月)
    expect(momOf(arr, true, 1)).toBeNull()          // 当月无值
    expect(momOf(arr, false, 2)).toBeNull()
    expect(momOf([0, 100, ...new Array(10).fill(null)], true, 1)).toBeNull()
  })
})

describe('anchorMonth(§五策略2 月锚回退)', () => {
  it('已覆盖/无覆盖 → 原月;缺月 → ≤所选最近覆盖月;更早无 → 最早覆盖月', () => {
    expect(anchorMonth([9, 10], 10)).toBe(10)   // 命中不回退
    expect(anchorMonth([9, 10], 12)).toBe(10)   // 回退最近覆盖月
    expect(anchorMonth([9, 10], 3)).toBe(9)     // 更早无 → 最早覆盖月
    expect(anchorMonth([], 5)).toBe(5)          // 无覆盖(年空态另行处理)→ 原月
  })
})

describe('mainChart(主图整形:折万/上月右移/预算月均)', () => {
  it('折万保留 2 位;prevRev 右移一格;budgetAvg=年预算/12 折万;covered=覆盖期数', () => {
    const revenue = N12(); revenue[8] = 8000000; revenue[9] = 9301531   // 2025-10 锚点
    const profit = N12(); profit[9] = 3158720
    const d = mainChart(pnl({ months: [9, 10], revenue, profit }), 92705202.87)!
    expect(d.labels).toHaveLength(12)
    expect(d.rev[9]).toBe(930.15)
    expect(d.profit[9]).toBe(315.87)
    expect(d.prevRev[9]).toBe(800)      // 10 月位置 = 9 月收入
    expect(d.prevRev[0]).toBeNull()
    expect(d.budgetAvgWan).toBe(772.5)  // 92,705,202.87 / 12 / 10000
    expect(d.covered).toBe(2)
  })
  it('无 pnl → null;无预算 → budgetAvgWan null', () => {
    expect(mainChart(null, 1)).toBeNull()
    expect(mainChart(pnl({}), null)!.budgetAvgWan).toBeNull()
  })
  it('❗outlierMonths 标记收入为负的月(FORECAST §2.7);点仍画,不从 labels/rev 里摘除', () => {
    const revenue = N12(); revenue[9] = 8000000; revenue[11] = -636050.65
    const d = mainChart(pnl({ months: [10, 12], revenue }), null)!
    expect(d.outlierMonths).toEqual([12])
    expect(d.rev[11]).toBe(-63.61)   // 离群月数据点仍在 rev 里,只是被标记
  })
})

describe('compoData / schedTrend(构成环 + 点扇区趋势)', () => {
  const band = (rev: (number | null)[]) => ({ rev, cost: N12(), pnl: N12() })
  const p = pnl({
    bySchedule: {
      s1: band([500, ...new Array(11).fill(null)]),
      s2: band([800, null, 200, ...new Array(9).fill(null)]),
      s3: band([0, ...new Array(11).fill(null)]),      // 0 → 剔除
      s4: band(N12()),                                  // null → 0 → 剔除
    },
  })
  it('当月取值,>0 降序,带板块 key', () => {
    expect(compoData(p, true, 0)).toEqual([
      { key: 's2', label: '用电', value: 800 },
      { key: 's1', label: '租金', value: 500 },
    ])
    expect(compoData(null, true, 0)).toEqual([])
  })
  it('schedTrend 只取有数月并折万', () => {
    expect(schedTrend(p, 's2')).toEqual({ labels: ['1月', '3月'], vals: [0.08, 0.02] })
    expect(schedTrend(p, 's4')).toEqual({ labels: [], vals: [] })
  })
})

describe('phaseStack(分期收入堆叠,折万;缺月 null)', () => {
  it('期区中文名 + 月对齐(2025-10 一期/三期 SQL 锚点值)', () => {
    const ph: S10PhaseMonthly = {
      months: ['2025-01', '2025-10'],
      phases: [1, 3],
      totals: { 1: { '2025-01': 10000, '2025-10': 3019915.67 }, 3: { '2025-10': 642877.11 } },
      elec: {},
    }
    const d = phaseStack(ph)!
    expect(d.series.map((s) => s.name)).toEqual(['一期', '三期'])
    expect(d.series[0].data).toEqual([1, 301.99])
    expect(d.series[1].data).toEqual([null, 64.29])
    expect(phaseStack(null)).toBeNull()
    expect(phaseStack({ months: [], phases: [], totals: {}, elec: {} })).toBeNull()
  })
})

describe('colPick(收缴率取期,v1 口径)', () => {
  const cs: CollectRate[] = [
    { ym: '2025-01', receivable: 100, collected: 100, rate: 100 },
    { ym: '2025-10', receivable: 100, collected: 50, rate: 50 },
  ]
  it('月粒度:取 ≤当前月最近一期', () => {
    expect(colPick(cs, true, 2025, '2025-06')).toEqual({ ym: '2025-01', rate: 100 })
    expect(colPick(cs, true, 2025, '2025-12')).toEqual({ ym: '2025-10', rate: 50 })
    expect(colPick(cs, true, 2025, '2024-12')).toBeNull()
  })
  it('年粒度:并该年各期(金额加权);取期标注紧凑化(断月→N期)', () => {
    const y = colPick(cs, false, 2025, null)!
    expect(y.rate).toBe(75)
    expect(y.ym).toBe('2期')   // 1月+10月 断月 → 期数;冗长枚举「1月/10月」已废(2026-07-20 用户反馈)
    expect(colPick(cs, false, 2024, null)).toBeNull()
  })

  it('取期标注:连续月→区间;单月→该月', () => {
    const mk = (ym: string): (typeof cs)[number] => ({ ym, receivable: 100, collected: 80, rate: 80 })
    expect(colPick([mk('2025-01'), mk('2025-02'), mk('2025-03')], false, 2025, null)!.ym).toBe('1-3月')
    expect(colPick([mk('2025-05')], false, 2025, null)!.ym).toBe('5月')
  })
})

describe('arrearsOf(欠费清单弹层:该期 租户Σ应收−Σ实收>0 降序)', () => {
  it('跨公司求和;只留欠费;公司取应收最大;合计正确', () => {
    const rows = [
      ledger({ tenantName: 'A', companyName: '甲', receivable: 600, collected: 300 }),
      ledger({ tenantName: 'A', companyName: '乙', receivable: 400, collected: 200 }),
      ledger({ tenantName: 'B', receivable: 100, collected: 100 }),                       // 无欠费
      ledger({ tenantName: 'C', receivable: 50, collected: 0 }),
      ledger({ tenantName: 'D', month: 1, receivable: 999, collected: 0 }),               // 非该期
    ]
    const r = arrearsOf(rows, '2025-10')
    expect(r.rows.map((x) => x.name)).toEqual(['A', 'C'])
    expect(r.rows[0]).toEqual({ name: 'A', company: '甲', recv: 1000, coll: 500, arr: 500 })
    expect(r.total).toBe(550)
  })
})

describe('budgetAch / budgetRevenueOf(年度口径;锚点 94.6%)', () => {
  const rows: BudgetRowDTO[] = [
    budgetRow({ label: '其中：租金收入', sub: true, budget: 1 }),   // 子行不参与
    budgetRow({ budget: 92705202.87 }),
    budgetRow({ year: 2026, budget: 103620434.53 }),
  ]
  it('取当年非子行收入总计;达成率=实际年Σ/预算', () => {
    expect(budgetRevenueOf(rows, 2025)).toBe(92705202.87)
    expect(budgetRevenueOf(rows, 2024)).toBeNull()
    const revenue = N12(); revenue[0] = 87722076   // 2025 年营收合计锚点(SQL 回验)
    const a = budgetAch(rows, pnl({ revenue }), 2025)!
    expect(a.rate.toFixed(1)).toBe('94.6')
    expect(a.gap).toBeCloseTo(4983126.87, 1)
    expect(a.usedMonths).toEqual([1])   // 无离群月:usedMonths = 有数月本身
  })
  it('❗离群月(收入<0)不计入分母 —— 之前无条件相加会把达成率往错方向压(FORECAST §2.7)', () => {
    const withOutlier = N12(); withOutlier[9] = 87722076; withOutlier[11] = -636050.65   // 12月年末冲回
    const noOutlier = N12(); noOutlier[9] = 87722076   // 同一份 10 月数据,少一个离群月
    const a1 = budgetAch(rows, pnl({ revenue: withOutlier }), 2025)!
    const a2 = budgetAch(rows, pnl({ revenue: noOutlier }), 2025)!
    expect(a1.usedMonths).toEqual([10])            // 12 月被剔除,不进 usedMonths
    expect(a1.actual).toBe(a2.actual)               // 离群月的负收入没有被吃进分子
    expect(a1.rate).toBe(a2.rate)                    // 剔除前后达成率一致 —— 证明离群月未被计入
  })
  it('无预算或无实际 → null', () => {
    expect(budgetAch([], pnl({}), 2025)).toBeNull()
    expect(budgetAch(rows, pnl({}), 2025)).toBeNull()
  })
})

describe('buildConclusion(经营结论条 spec §A:数据模板分句,缺数据省句)', () => {
  const rows: BudgetRowDTO[] = [budgetRow({ budget: 92705202.87 })]
  const cs: CollectRate[] = [{ ym: '2025-10', receivable: 39568105, collected: 32166000, rate: 81.3 }]
  // 期末欠费锚点:最新台账月(2025-10)Σ balanceEnd>0 = 3,185万;负余额(预收)不计;旧月不计
  const lr: AnalysisLedgerRow[] = [
    ledger({ year: 2025, month: 10, tenantName: 'A', balanceEnd: 20000000 }),
    ledger({ year: 2025, month: 10, tenantName: 'B', balanceEnd: 11850000 }),
    ledger({ year: 2025, month: 10, tenantName: 'C', balanceEnd: -500 }),
    ledger({ year: 2025, month: 9, tenantName: 'A', balanceEnd: 99999999 }),
  ]
  const fullPnl = (): PnlSummary => {
    const revenue = N12(); revenue[0] = 87722076   // 2025 年营收合计锚点(SQL 回验)
    const profit = N12(); profit[0] = 22900000
    return pnl({ months: [1], revenue, profit })
  }
  const yr = { isMonth: false, year: 2025, usedMi: 0, ym: null }
  const tgt = { collectTarget: 96 }

  it('三句齐(年粒度):收入利润句含预算达成,收缴句 vs 目标+期末欠费,异常句带 link', () => {
    const r = buildConclusion(fullPnl(), cs, rows, lr, 4, tgt, yr)
    expect(r).toHaveLength(3)
    expect(r[0].text).toBe('2025年收入 ¥8,772万(预算达成 94.6%),园区利润 ¥2,290万(利润率 26.1%)')
    expect(r[0].tone).toBe('watch')   // 达成 94.6% < 100
    expect(r[1]).toEqual({ text: '收缴率 81.3% 低于目标 96%,期末欠费 ¥3,185万', tone: 'watch' })
    expect(r[2]).toEqual({ text: '4 条异常待处理', tone: 'watch', link: '/anomaly' })
  })
  it('缺预算:句1 省预算达成括注;利润为正 → good', () => {
    const r = buildConclusion(fullPnl(), cs, [], lr, 4, tgt, yr)
    expect(r[0].text).toBe('2025年收入 ¥8,772万,园区利润 ¥2,290万(利润率 26.1%)')
    expect(r[0].tone).toBe('good')
  })
  it('缺台账(collects 空):省收缴句,余两句;ledger 空:收缴句省欠费分句', () => {
    const r = buildConclusion(fullPnl(), [], rows, lr, 4, tgt, yr)
    expect(r).toHaveLength(2)
    expect(r[1].text).toBe('4 条异常待处理')
    const r2 = buildConclusion(fullPnl(), cs, rows, [], 4, tgt, yr)
    expect(r2[1].text).toBe('收缴率 81.3% 低于目标 96%')
  })
  it('零异常 → 规则引擎无异常(good,无 link)', () => {
    const r = buildConclusion(fullPnl(), cs, rows, lr, 0, tgt, yr)
    expect(r[2]).toEqual({ text: '规则引擎无异常', tone: 'good' })
  })
  it('pnl 为 null:省收入利润句;台账也缺(全缺)→ []', () => {
    const r = buildConclusion(null, cs, rows, lr, 4, tgt, yr)
    expect(r.map((x) => x.text)).toEqual(['收缴率 81.3% 低于目标 96%,期末欠费 ¥3,185万', '4 条异常待处理'])
    expect(buildConclusion(null, [], rows, [], 4, tgt, yr)).toEqual([])
  })
  it('月粒度:句1 前缀带月且不并入年度预算达成;收缴取参 = KPI 的所选月 ym(非 pnl 月锚)', () => {
    const revenue = N12(); revenue[9] = 9301531   // 2025-10 锚点
    const profit = N12(); profit[9] = 3158720
    // 所选 2025-11(台账无)但 pnl 锚定 10 月:收缴句必须按 ym='2025-11' 走 colPick 回退,与 KPI 同参
    const r = buildConclusion(pnl({ months: [10], revenue, profit }), cs, rows, [], 0, tgt,
      { isMonth: true, year: 2025, usedMi: 9, ym: '2025-11' })
    expect(r[0].text).toBe('2025年10月收入 ¥930万,园区利润 ¥316万(利润率 34.0%)')
    expect(r[1].text).toBe('收缴率 81.3% 低于目标 96%')
  })
})
