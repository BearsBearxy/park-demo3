// 驾驶舱 v2 纯函数单测(铁律⑦):取期/环比/主图整形/构成/分期堆叠/收缴取期/欠费清单/预算达成。
// 折万与聚合口径必须与 v1 一致(锚点:2025-10 营收 9,301,531 元 → 930.15 万)。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  achLabelText, achNoteText, anchorMonth, arrearsOf, atPeriod, atPnlPeriod, backtestReadout, backtestRefText, backtestRows, backtestSummary, budgetAch, budgetRevenueOf, buildConclusion, colPick, compoData, fitBandAt, fitRevenueTrend, t80, fitRevenueTrendUpTo, mainChart, mainChartOption, mainChartOutlierNote, nextMonthForecast, nextForecastReadout, nextForecastRefText, momOf, monthRangeLabel, outlierReadout, outlierRefText, outlierResidual, outlierResidualsByMonth, phaseStack, pnlYearMonths, revNoteText, schedTrend,
  type BacktestRow, type BudgetAch, type MainChartData, type RevenueFit,
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
    const d = mainChart(pnl({}), null)!
    expect(d.budgetAvgWan).toBeNull()
    expect(d.yMin).toBeUndefined()   // 无可用值 → 交 ECharts 自动定量程
  })
  it('❗outlierMonths 标记收入为负的月(FORECAST §2.7);点仍画,不从 labels/rev 里摘除', () => {
    const revenue = N12(); revenue[9] = 8000000; revenue[11] = -636050.65
    const d = mainChart(pnl({ months: [10, 12], revenue }), null)!
    expect(d.outlierMonths).toEqual([12])
    expect(d.rev[11]).toBe(-63.61)   // 离群月数据点仍在 rev 里,只是被标记
  })
  it('❗yMin 必须罩住负收入月 —— 柱子画的是真值,轴不许把它切在外面(用户 2026-09-12)', () => {
    const revenue = N12(); revenue[9] = 8000000; revenue[11] = -636050.65
    const profit = N12(); profit[9] = -100000
    const d = mainChart(pnl({ months: [10, 12], revenue, profit }), null)!
    // 改前 yMin 是 −10(12 月被 usableMonths 剔掉,那根 −63.61 万的柱子画在轴外)
    expect(d.yMin).toBe(-63.61)
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
    expect(compoData(p, true, 0, [])).toEqual([
      { key: 's2', label: '用电', value: 800 },
      { key: 's1', label: '租金', value: 500 },
    ])
    expect(compoData(null, true, 0, [])).toEqual([])
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
  it('❗负收入月照样进分母 —— 用户 2026-09-12:「是什么数据就使用什么数据」', () => {
    const withNeg = N12(); withNeg[9] = 87722076; withNeg[11] = -636050.65
    const noNeg = N12(); noNeg[9] = 87722076   // 同一份 10 月数据,少那个负收入月
    const a1 = budgetAch(rows, pnl({ revenue: withNeg }), 2025)!
    const a2 = budgetAch(rows, pnl({ revenue: noNeg }), 2025)!
    // 这条 2026-09-12 整个翻过来了。改前:12 月被剔,a1 与 a2 完全相同。
    expect(a1.usedMonths).toEqual([10, 12])                  // 录了就算,一个不摘
    expect(a1.actual).toBeCloseTo(a2.actual - 636050.65, 2)  // 负收入被如实加进分子
    expect(a1.rate).toBeLessThan(a2.rate)                    // 达成率因此更低,这是数据本来的样子
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

// ── I3 / I4(对抗复查 2026-09-11):未闭月护栏的自述价值 + 并排数的月份一致性 ─────────────
// 下面这一整年都是实测值(park_demo3,SQL 见 task-8-report.md),不是造的:
//   pnl_row year=2025 / group_label='' / kind='total' / label LIKE '%收入%' / schedule s1~s4 → 收入
//   同上 label LIKE '%成本%' 加 s5「运营费用总计」→ 成本;budget_row 2025「收入总计」→ 预算
// 改前源码注释、文件头锚点、提交标题都写着「105.6% → 94.6%,差 11 个点且方向相反」,
// 而 cockpit.logic.spec.ts 里唯一一条相关断言是 `a1.rate === a2.rate`(离群月被剔掉了)——
// 它在注释说谎时照样全绿。这两条用例存在的理由就是把那句自述钉在实测量级上。
describe('❗I3 / I4:2025 实测量级', () => {
  const REV: (number | null)[] = [
    7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20,
    8249744.52, 8669057.75, 8762619.48, 9301530.81, 9407837.38, -636050.65,
  ]
  const COST: (number | null)[] = [
    5352943.58, 4407978.73, 4563133.11, 5120974.86, 5000786.11, 5178358.96,
    5203700.08, 5702265.08, 6272067.92, 6142810.17, 5958830.00, 5917279.67,
  ]
  const PROFIT: (number | null)[] = REV.map((v, i) => (v as number) - (COST[i] as number))
  const BUDGET = 92705202.87
  const M12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const rows2025: BudgetRowDTO[] = [budgetRow({ budget: BUDGET })]
  const p2025 = (): PnlSummary => pnl({ months: M12, revenue: REV, cost: COST, profit: PROFIT })

  it('❗I3:达成率 = 十二个月原样相加 ÷ 预算 = 94.6%,与「把全部月份加起来」逐分钱相同', () => {
    const allMonths = REV.reduce<number>((s, v) => s + (v ?? 0), 0)
    const rateAll = (allMonths / BUDGET) * 100
    const a = budgetAch(rows2025, p2025(), 2025)!
    // 2026-09-12 起没有任何月份被摘出去,所以「护栏口径」与「全部月份」是同一个数。
    // 改前这里钉的是 95.3% vs 94.6% 的差,那个差随排除规则一起没了。
    expect(rateAll.toFixed(1)).toBe('94.6')
    expect(a.rate.toFixed(1)).toBe('94.6')
    expect(a.usedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(a.actual).toBeCloseTo(87722075.54, 2)
    expect(a.rate).toBeCloseTo(rateAll, 10)   // 逐分钱相同,不是「接近」
  })

  it('❗I4:结论句里印出来的收入 ÷ 预算,必须回到同一句里印出来的达成率(利润率同理)', () => {
    const r = buildConclusion(p2025(), [], rows2025, [], 0, { collectTarget: 96 },
      { isMonth: false, year: 2025, usedMi: 0, ym: null })
    expect(r[0].text).toBe('2025年收入 ¥8,772万(预算达成 94.6%),园区利润 ¥2,290万(利润率 26.1%)')
    // 可执行形式:只认句子自己印出来的数,读者拿计算器怎么算,这里就怎么算。
    const num = (re: RegExp): number => Number(re.exec(r[0].text)![1].replace(/,/g, ''))
    const revWan = num(/收入 ¥([\d,]+)万/)
    const profWan = num(/园区利润 ¥([\d,]+)万/)
    const rate = num(/预算达成 ([\d.]+)%/)
    const margin = num(/利润率 ([\d.]+)%/)
    // I4 钉的是「印出来的两个数自洽」,与排除不排除无关 —— 2026-09-12 改口径后仍然必须成立
    expect((revWan * 10000 / BUDGET) * 100).toBeCloseTo(rate, 1)
    expect((profWan / revWan) * 100).toBeCloseTo(margin, 1)
  })

  it('❗I4:达成率分母与并排三瓦的取期共用同一个月份集合(不是各算各的)', () => {
    const p = p2025()
    const months = pnlYearMonths(p)
    expect(months).toEqual(budgetAch(rows2025, p, 2025)!.usedMonths)
    expect(atPnlPeriod(p.revenue, false, 0, months)).toBeCloseTo(87722075.54, 2)
    // 月粒度一直如此:点开 12 月就该看见那个负数本身,不是一片空白
    expect(atPnlPeriod(p.revenue, true, 11, months)).toBe(-636050.65)
    // 2026-09-12 起年度口径与「不过滤月份」的老写法**相同** —— 改前这里差的正是那 63.6 万
    expect((atPeriod(p.revenue, false, 0) as number) - (atPnlPeriod(p.revenue, false, 0, months) as number))
      .toBeCloseTo(0, 2)
  })
})

// ── N1(对抗复查修复轮2):收入构成环与 KPI 营收合计共用同一批月份 ─────────────────────────
// 改前 compoData 走 atPeriod(不剔离群月),KPI 营收走 atPnlPeriod(剔离群月)——12 月那笔离群
// 冲回被环图吃了进去、被 KPI 剔了出去,同一屏出现两个不同的营收合计。
describe('❗N1:年粒度构成合计按 yearMonths 过滤,不再是另一个数', () => {
  const revenue = N12(); revenue[9] = 8000000; revenue[11] = -636050.65   // 12 月离群(年末冲回)
  const s1 = N12(); s1[9] = 5000000; s1[11] = 300000                     // 12 月这一段本身不是负的
  const p = pnl({
    months: [10, 12], revenue,
    bySchedule: { s1: { rev: s1, cost: N12(), pnl: N12() } },
  })
  const months = pnlYearMonths(p)   // 2026-09-12 起不再剔任何月:[10, 12]

  it('构成合计与营收 KPI 用同一批月份 —— 两个数必须同源,不是「含不含 12 月」', () => {
    expect(months).toEqual([10, 12])
    expect(compoData(p, false, 0, months)).toEqual([{ key: 's1', label: '租金', value: 5300000 }])
    expect(atPnlPeriod(p.revenue, false, 0, months)).toBeCloseTo(8000000 - 636050.65, 2)
  })

  it('❗回退成不按月份过滤的旧写法(atPeriod)会把离群月的 30 万也加进构成合计', () => {
    // 这条钉的是「旧写法算出来是另一个数」本身:s1 全年(含 12 月)Σ = 530 万,
    // 与过滤后的 500 万相差正是 12 月那 30 万 —— compoData 换回 atPeriod 就会掉回这个数。
    expect(atPeriod(s1, false, 0)).toBe(5300000)
  })
})

// ── N2(对抗复查修复轮2):预算达成小字不随粒度消失覆盖区间,也不留半句分隔符 ──────────────
describe('❗N2:achNoteText/monthRangeLabel', () => {
  const rows = [budgetRow({ budget: 92705202.87 })]
  // 只给 10 月数据 → usedMonths=[10];budgetAch 不吃 isMonth,这个结果与「当前是月粒度还是年粒度」无关。
  const revenue = N12(); revenue[9] = 87722076
  const a = budgetAch(rows, pnl({ revenue }), 2025)!

  it('月份区间:多月给区间,单月给该月,空给空串', () => {
    expect(monthRangeLabel([1, 2, 3])).toBe('1-3月')
    expect(monthRangeLabel([10])).toBe('10月')
    expect(monthRangeLabel([])).toBe('')
  })

  it('ach 存在:区间来自 usedMonths,与 isMonth 无关(budgetAch 本就不吃这个参数)', () => {
    expect(a.usedMonths).toEqual([10])
    expect(achNoteText(a, '¥9,271万', 2025)).toBe('¥9,271万 · 10月')
  })

  it('无预算 → 年份提示,不带分隔符', () => {
    expect(achNoteText(null, '¥9,271万', 2025)).toBe('2025年未导入预算')
  })

  it('❗区间为空时不留半句(不以分隔符结尾)—— 这是本函数存在的意义', () => {
    const empty: BudgetAch = { budget: 1, actual: 1, rate: 100, gap: 0, usedMonths: [] }
    const text = achNoteText(empty, '¥1万', 2025)
    expect(text).toBe('¥1万')
    expect(text.endsWith(' · ')).toBe(false)
  })

  it('❗组件必须用 achNote(ach.usedMonths 的区间)接预算达成的 note,不能借回 pnlRange —— '
    + 'pnlRange 在月粒度下强制清空,那正是改前「¥9,271万 · 」断句的成因', () => {
    const src = readFileSync(join(__dirname, 'CockpitView.vue'), 'utf8')
    // F3(修复轮1):标题从静态 label="预算达成" 改成 :label="achLabel"(按稿补齐覆盖区间,
    // 见 CockpitView.vue 的 achLabel 计算属性)——判据锚点跟着改,断言意图(note 接 achNote、
    // 不借 pnlRange)不变。
    const tile = /<AnaKpiTile :label="achLabel"[\s\S]*?\/>/.exec(src)
    expect(tile, 'CockpitView.vue 找不到「预算达成」瓦').toBeTruthy()
    expect(tile![0]).toContain(':note="achNote"')
    expect(tile![0]).not.toContain('pnlRange')
  })

  // ── F3(修复轮1,design-boards):achLabelText/revNoteText —— 覆盖表派给 T1 的另外两处文案 ──
  it('❗achLabelText:标题按稿补齐覆盖区间「预算达成(N-M月)」,无预算 → 纯标题不带括号', () => {
    expect(achLabelText(a)).toBe('预算达成(10月)')       // a.usedMonths=[10](本 describe 顶部构造)
    expect(achLabelText(null)).toBe('预算达成')
  })

  it('❗revNoteText 不得声称剔掉过月份 —— 负收入月已经在年度口径里了', () => {
    // 实测 2025 库就是这个入参:12 个训练月,其中 12 月收入为负。旧写法印「12期,已剤12月」,
    // 与同屏横幅「2025-12 收入为负,已计入年度营收/成本/利润与达成率」直接相反。
    expect(revNoteText(false, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '备用文案')).toBe('12期')
    expect(revNoteText(false, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '备用文案')).not.toContain('已剔')
    expect(revNoteText(false, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], '备用文案')).toBe('11期')
    expect(revNoteText(true, [1, 2, 3], '备用文案')).toBeUndefined()   // 月粒度:标题已是当月实值,不印覆盖区间
    expect(revNoteText(false, [], '备用文案')).toBe('备用文案')          // 无覆盖月 → 回落
    expect(revNoteText(false, [], '')).toBeUndefined()                  // 回落也是空 → undefined,不留半句
  })
})

// ── T1/T2(design-boards 2026-09-11):月度收入 OLS 拟合(全屏唯一一份)+ 依赖它的三个 KPI 瓦 ──
// 与「❗I3/I4」用同一批 2025 实测数(park_demo3,锚点 2025-12);任务书给的验收锚点全部钉在这里:
// 月均增速 25.8 / 12月拟合 958 / 全年拟合合计 9794 / 按节奏推全年 105.6% / 屏上旧值 94.6%。
describe('❗T1/T2:fitRevenueTrend 与依赖它的 KPI/主图纯函数(2025 实测锚点)', () => {
  const REV: (number | null)[] = [
    7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20,
    8249744.52, 8669057.75, 8762619.48, 9301530.81, 9407837.38, -636050.65,
  ]
  const BUDGET = 92705202.87
  const M12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const p2025 = (): PnlSummary => pnl({ months: M12, revenue: REV })

  it('❗拟合用全部十二个月(用户 2026-09-12),锚点随之改写:斜率 −13.5、拟合优度 0.03', () => {
    const fit = fitRevenueTrend(p2025())!
    expect(fit).not.toBeNull()
    // 这一组数 2026-09-12 整体换掉了。改前训练月是 1-11(12 月因收入为负被摘出去),
    // 斜率 +25.8 万/月、拟合优度 0.93。现在十二个月全进,−63.61 万那一点把回归拉翻:
    expect(fit.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(fit.slope.toFixed(1)).toBe('-13.5')      // 从 +25.8 翻成负数:线在说园区收入在缩
    expect(fit.r2.toFixed(2)).toBe('0.03')          // 拟合优度从 0.93 掉到几乎为零
    expect(fit.r2).toBeGreaterThanOrEqual(0)
    expect(fit.r2).toBeLessThanOrEqual(1)
    expect(Math.round(fit.fitted[11]!)).toBe(657)   // 12 月拟合值,改前 958
    expect(Math.round(fit.residualScale)).toBe(272) // 残差标准差,改前 24 —— 一个点撑大了十倍
  })

  it('训练点 <3(覆盖月太少)→ 拟合没有意义,返回 null;pnl 为 null 同样返回 null', () => {
    const revenue = new Array(12).fill(null) as (number | null)[]
    revenue[0] = 100; revenue[1] = 200
    expect(fitRevenueTrend(pnl({ months: [1, 2], revenue }))).toBeNull()
    expect(fitRevenueTrend(null)).toBeNull()
  })

  it('❗斜率方向不是写死的:收入递减的年份必须拟合出负斜率(不是永远正)', () => {
    const revenue = [1200, 1100, 1000, 900, 800, 700].map((v) => v * 10000) as (number | null)[]
    revenue.push(null, null, null, null, null, null)
    const fit = fitRevenueTrend(pnl({ months: [1, 2, 3, 4, 5, 6], revenue }))!
    expect(fit.slope).toBeLessThan(0)     // 递减序列 → 负斜率,不是恒正
    expect(fit.r2).toBeCloseTo(1, 2)      // 完美线性,拟合优度应接近 1
  })

  // paceFullYear 的两条用例 2026-09-12 随函数一起删 —— 用户:「全年分析对用户一点作用没有」。
  // 这一屏现在只答一个问题:录到这个月了,下个月大概多少(见 nextMonthForecast)。


  // 「屏上旧值」那块对照瓦 2026-09-12 删掉:不再排除任何月份之后,它与 budgetAch 是同一个数,
  // 并排印两个一样的百分比只会让人以为哪里算错了。oldScreenRate/oldScreenNoteText 一并删。

  it('❗负收入月的残差倍数:12月实际−63.61万 距拟合657万,2 倍残差', () => {
    const fit = fitRevenueTrend(p2025())
    const mc = mainChart(p2025(), null)!
    const o = outlierResidual(fit, mc.rev, mc.outlierMonths)!
    expect(o.month).toBe(12)
    expect(o.actualWan).toBeCloseTo(-63.61, 1)
    // 改前是 42 倍。12 月自己进了训练集之后,它把残差标准差从 24 万撑到 272 万,
    // 于是「离正常波动多远」这个数自己把自己压下去了 —— 这是把异常点算进基准的必然结果。
    expect(Math.floor(o.residuals)).toBe(2)
    expect(o.residuals).toBeGreaterThan(2)
    expect(o.residuals).toBeLessThan(3)
  })

  it('outlierResidual:无离群月 / 无拟合 / 该月无实际值 → null(不能瞎编一个倍数)', () => {
    const fit = fitRevenueTrend(p2025())
    expect(outlierResidual(fit, [], [])).toBeNull()
    expect(outlierResidual(null, [1], [1])).toBeNull()
    expect(outlierResidual(fit, [null], [1])).toBeNull()
  })

  it('❗F4:两个离群月的残差按点各算(outlierResidualsByMonth)——改前主图 markPoint 两根 pin '
    + '会顶同一个数字(固定取 outlierMonths[0]),这里断言两点必须各算各的', () => {
    const fit: RevenueFit = { months: [1, 2, 3, 4, 5], slope: 10, intercept: 0, r2: 0.9, residualScale: 5, fitted: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] }
    const revWan = [10, 20, 30, 40, 50, 60, 200, 80, 90, 100, 110, -40]   // 7月/12月是离群,偏离幅度不同
    const m = outlierResidualsByMonth(fit, revWan, [7, 12])
    expect(m.size).toBe(2)
    expect(m.get(7)).toBeCloseTo(Math.abs(200 - 70) / 5, 5)     // |实际−拟合|/残差标准差 = 26
    expect(m.get(12)).toBeCloseTo(Math.abs(-40 - 120) / 5, 5)   // = 32
    expect(m.get(7)).not.toBe(m.get(12))   // 核心:不能两点顶同一个数字
  })

  it('outlierResidualsByMonth:无拟合 / 残差标准差为0 / 该月无实际值 → 该月不进 Map(不瞎编)', () => {
    const fit: RevenueFit = { months: [1], slope: 0, intercept: 0, r2: 0, residualScale: 0, fitted: new Array(12).fill(0) }
    expect(outlierResidualsByMonth(null, [1], [1]).size).toBe(0)
    expect(outlierResidualsByMonth(fit, [1], [1]).size).toBe(0)   // residualScale=0
    const fit2: RevenueFit = { ...fit, residualScale: 5 }
    expect(outlierResidualsByMonth(fit2, [null], [1]).size).toBe(0)
  })

  it('❗读数句/参照系小字:内容与字数门禁(≤30 / ≤28 可见字,copy lint 的真实判据)', () => {
    const fit = fitRevenueTrend(p2025())
    const mc = mainChart(p2025(), null)!
    const o = outlierResidual(fit, mc.rev, mc.outlierMonths)
    const read = outlierReadout(fit, o)
    const ref = outlierRefText(fit)
    expect(read).toBe('12月收入 −64万，离1-12月的正常波动 2倍残差')
    expect(ref).toBe('参照1-12月拟合 · 残差272万')
    expect([...read!.replace(/\s+/g, '')].length).toBeLessThanOrEqual(30)
    expect([...ref.replace(/\s+/g, '')].length).toBeLessThanOrEqual(28)
    expect(outlierReadout(null, o)).toBeNull()
    expect(outlierRefText(null)).toBe('')
  })

  it('❗拟合区间(fitBandAt):12月下沿232万/上沿1082万,宽度对称包住657万中心', () => {
    const fit = fitRevenueTrend(p2025())
    const band = fitBandAt(fit, 12)!
    // 改前 919/958/997(带宽 78 万)。12 月进训练集之后残差标准差涨了十倍,带跟着张到 850 万宽 ——
    // 一条什么都罩得住的带,这是用户选「全部算进去」的代价,如实钉住,不修饰。
    expect(Math.round(band.mid)).toBe(657)
    expect(Math.round(band.lo)).toBe(232)
    expect(Math.round(band.hi)).toBe(1082)
    expect(band.hi - band.mid).toBeCloseTo(band.mid - band.lo, 1)   // 对称区间,不是单边宽
    expect(band.lo).toBeLessThan(band.mid)
    expect(band.mid).toBeLessThan(band.hi)
  })

  it('fitBandAt:无拟合 → null;自由度大到表外**不再**返回 null,改走正态极限', () => {
    expect(fitBandAt(null, 12)).toBeNull()
    const fit = fitRevenueTrend(p2025())!
    // 这条断言 2026-09-12 翻过来了。改前:df 超出 t 表(旧表只到 9)就 return null,
    // 后果是拟合月份一多带子**无声消失**——跟准不准无关,纯粹是查表查不到。
    // 用户要求「不管中几次都显示预测带」,所以表补到 df 30、再往上用正态极限。
    const overDf = { ...fit, months: Array.from({ length: 20 }, (_, i) => i + 1) }
    const band = fitBandAt(overDf, 12)
    expect(band, 'df 大就不给带 —— 这正是拆掉的那道门').toBeTruthy()
    expect(band!.hi).toBeGreaterThan(band!.lo)
  })
})

describe('❗F1(对抗复查,adversarial-survived.md):主图与趋势图的 option 对象'
  + '——这几块原先整段写在 CockpitView.vue 的 <script setup> computed 里,零纯函数/零挂载测覆盖', () => {
  const REV: (number | null)[] = [
    7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20,
    8249744.52, 8669057.75, 8762619.48, 9301530.81, 9407837.38, -636050.65,
  ]
  const M12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const p2025 = (): PnlSummary => pnl({ months: M12, revenue: REV })

  // ── 趋势线/拟合区间 2026-09-12 搬去 trendChartOption(用户:主图里「完全看不见」)。
  //    断言跟着搬,判据一个没减,另加两条只在新图成立的(轴不从 0 起、离群月留断口)。
  it('❗主图(柱图)里不再有趋势线/拟合区间 —— 拆出去了就不许两张图各画一份', () => {
    const d = mainChart(p2025(), null)
    const opt = mainChartOption(d, new Map(), 'none') as { series: { name: string }[] }
    expect(opt.series.find((s) => s.name === '趋势')).toBeUndefined()
    expect(opt.series.find((s) => s.name.startsWith('拟合区间'))).toBeUndefined()
  })

  it('t80:表内按表,df>30 用正态极限,df<1 才是真的算不出', () => {
    expect(t80(9)).toBe(1.383)
    expect(t80(30)).toBe(1.310)
    expect(t80(31)).toBe(1.2816)
    expect(t80(0)).toBeNull()
  })

  it('❗离群 markPoint 的 label.formatter 逐月取 outlierResByMonth(F4 的原话镜像到 option 层:'
    + '两根 pin 不能顶同一个数字,不许退回固定取 outlierMonths[0] 那种写法)', () => {
    const fit: RevenueFit = { months: [1, 2, 3, 4, 5], slope: 10, intercept: 0, r2: 0.9, residualScale: 5, fitted: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] }
    const revWan = [10, 20, 30, 40, 50, 60, 200, 80, 90, 100, 110, -40]
    const outlierMonths = [7, 12]
    const outlierRes = outlierResidualsByMonth(fit, revWan, outlierMonths)
    const d: MainChartData = {
      labels: Array.from({ length: 12 }, (_, i) => `${i + 1}月`), rev: revWan, profit: new Array(12).fill(null),
      prevRev: new Array(12).fill(null), budgetAvgWan: null, covered: 12, outlierMonths, yMin: undefined,
    }
    const opt = mainChartOption(d, outlierRes, 'none') as
      { series: { name: string; markPoint?: { label: { formatter: (p: { data: { month?: number } }) => string } } }[] }
    const bar = opt.series.find((s) => s.name === '收入')
    const formatter = bar!.markPoint!.label.formatter
    const f7 = formatter({ data: { month: 7 } })
    const f12 = formatter({ data: { month: 12 } })
    expect(f7).not.toBe(f12)   // 核心:两根 pin 不能顶同一个数字(改前的缺陷)
    // pin 上那两个字也是屏上文案:不得写「离群」(同上一条理由)
    for (const f of [f7, f12]) expect(f).not.toContain('离群')
    expect(f12).toContain('收入为负')
    expect(f7).toContain(String(Math.floor(outlierRes.get(7)!)))
    expect(f12).toContain(String(Math.floor(outlierRes.get(12)!)))
  })

  it('无离群月时不给 markPoint;pnl/mainChart 未覆盖(covered=0)时整个 option 为 null', () => {
    const opt = mainChartOption(mainChart(pnl({ months: [], revenue: N12() }), null), new Map(), 'none')
    expect(opt).toBeNull()
    const noOutlier = mainChart(pnl({ months: [1], revenue: [100, ...N12().slice(1)] }), null)
    const o2 = mainChartOption(noOutlier, new Map(), 'none') as { series: { name: string; markPoint?: unknown }[] }
    const bar = o2.series.find((s) => s.name === '收入')
    expect(bar!.markPoint).toBeUndefined()
  })
})

describe('❗F6(对抗复查):mainChartOutlierNote——不再写死「12月」/「m12」/「s1」', () => {
  // oldScreenNoteText 的两条随那块对照瓦一起删(2026-09-12),理由见上面同日那条注释。

  it('❗mainChartOutlierNote:离群月是 3 月时文案必须说「3月」,不出现「12月」「m12」「s1」', () => {
    const s = mainChartOutlierNote([3])
    expect(s).toContain('3月')
    expect(s).not.toContain('12月')
    expect(s).not.toMatch(/m12/i)
    expect(s).not.toContain('s1')
  })

  it('❗屏上不得出现「离群」「污染」「冲回」 —— 用户 2026-09-12:那个月就是真亏损,不是脏数据', () => {
    const s = mainChartOutlierNote([12])
    for (const w of ['离群', '污染', '冲回']) expect(s, w).not.toContain(w)
    expect(s).toContain('收入<0')        // 事实还在,换掉的只是对它的定性
  })
})

// ── T3(design-boards 2026-09-11):「全年会落在哪」+「这条带过去准不准」两张卡 ──
// 与 T1/T2 同一批 2025 实测数(park_demo3,锚点 2025-12);任务书验收锚点:
// 9,794/105.6% · 9,754/105.2% · 9,833/106.1% · 8,772/94.6%,回测六站见下方逐条断言(数与板上逐字对)。
describe('❗T3:backtestRows(滚动起点回测)+ nextMonthForecast(下月预测)', () => {
  const REV: (number | null)[] = [
    7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20,
    8249744.52, 8669057.75, 8762619.48, 9301530.81, 9407837.38, -636050.65,
  ]
  const BUDGET = 92705202.87
  const M12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const p2025 = (): PnlSummary => pnl({ months: M12, revenue: REV })

  // 「全年会落在哪」那张卡与 paceFullYear/yearOutlook* 四个函数 2026-09-12 整块删掉。
  // 用户原话:「我现在不想要全年的拟合,我只需要用户每个月录入单月数据的时候能看到下月的预测,
  // 仅此而已,全年分析对用户一点作用没有」。回测表的「同时推全年」那一列也一起去掉。

  it('❗下月预测与回测最后一站是同一套算法 —— 两者必须逐位相等', () => {
    // 改前图上画整年拟合带(样本内,12 月 232~1082),表里验的是样本外一步预测(919~997),
    // 宽度差十倍并排摆着,用户当场指出自相矛盾。
    // ⚠ 照实写:这条**破坏不了** —— 把 nextMonthForecast 里的 fitRevenueTrendUpTo(pnl, last)
    //   换成 fitRevenueTrend(pnl),它照样绿。因为预测月本来就没有数据,「已录入的全部月」与
    //   「截到 last 为止的月」是同一个集合。真正把两者钉死的是上面那条「图上只画下月那一列」:
    //   带子画在没有数据的那一列,就不可能再是样本内的。这条只是数值回归网。
    const revTo11: (number | null)[] = REV.map((v, i) => (i === 11 ? null : v))
    const p11 = pnl({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], revenue: revTo11 })
    const f = nextMonthForecast(p11)!
    const rows = backtestRows(p11, BUDGET)!
    const last = rows[rows.length - 1]
    expect(f.month).toBe(12)
    expect(last.vantageMonth, '回测最后一站正是站在最后一个已录入月').toBe(11)
    expect(f.mid).toBeCloseTo(last.predictMid, 2)
    expect(f.lo).toBeCloseTo(last.lo, 2)
    expect(f.hi).toBeCloseTo(last.hi, 2)
    expect(Math.round(f.mid)).toBe(958)
    expect(Math.round(f.lo)).toBe(919)
    expect(Math.round(f.hi)).toBe(997)
  })

  it('❗年中(只录到 6 月):最早两站训练点不足,跳过它们而不是把整张成绩单判空', () => {
    // 2026-09-12 实测发现的缺陷。年中正是这屏最常被打开的时候,而那张表是下月预测唯一的信用凭证,
    // 改前 v=1(只有 1 个训练点)一算不出来就 `return null`,整表连同它一起消失。
    const half: (number | null)[] = REV.map((v, i) => (i < 6 ? v : null))
    const p6 = pnl({ months: [1, 2, 3, 4, 5, 6], revenue: half })
    const rows = backtestRows(p6, BUDGET)!
    expect(rows, '整张表不该消失').toBeTruthy()
    expect(rows.map((r) => r.vantageMonth), 'v=1/2 训练点不足被跳过,3 起才算得出来').toEqual([3, 4, 5, 6])
    // 「今天」是真正算出来的最后一站,不是名义上的最后一个月
    expect(rows[rows.length - 1].isLast).toBe(true)
    expect(rows.slice(0, -1).every((r) => !r.isLast)).toBe(true)
    // 最后一站预测 7 月,7 月还没到 → 待验,不参与评分
    expect(rows[3].actualWan).toBeNull()
    expect(backtestSummary(rows)!.scored).toBe(3)
    // 下月预测与这最后一站仍然逐位相等
    const f = nextMonthForecast(p6)!
    expect(f.month).toBe(7)
    expect(f.mid).toBeCloseTo(rows[3].predictMid, 2)
    expect(f.lo).toBeCloseTo(rows[3].lo, 2)
    expect(f.hi).toBeCloseTo(rows[3].hi, 2)
  })

  it('❗读数句/参照系小字:只报数不报「80%」,实测命中随参照系同屏(D1)', () => {
    const revTo11: (number | null)[] = REV.map((v, i) => (i === 11 ? null : v))
    const p11 = pnl({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], revenue: revTo11 })
    const f = nextMonthForecast(p11)
    const sum = backtestSummary(backtestRows(p11, BUDGET))
    const read = nextForecastReadout(f)!
    const ref = nextForecastRefText(f, sum)
    expect(read).toBe('12月预计 958万，区间 919~997')
    expect(read, '名义 80% 没兑现过,读数句不许印它').not.toContain('80%')
    expect(ref).toBe('参照1-11月拟合 · 过去5次中2次')
    expect([...read].length).toBeLessThanOrEqual(30)
    expect([...ref].length).toBeLessThanOrEqual(28)
  })

  it('❗backtestRows:六站逐条落在板上的数——预测/区间/实际/命中/全年推算', () => {
    const rows = backtestRows(p2025(), BUDGET)!
    expect(rows.map((r) => r.vantageMonth)).toEqual([6, 7, 8, 9, 10, 11])
    const round = (v: number) => Math.round(v)
    const expected = [
      { v: 6, pred: 776, lo: 744, hi: 809, actual: 825, hit: false, under: true, pct: '6.3' },
      { v: 7, pred: 816, lo: 776, hi: 857, actual: 867, hit: false, under: true, pct: '6.2' },
      { v: 8, pred: 859, lo: 814, hi: 905, actual: 876, hit: true, under: null, pct: null },
      { v: 9, pred: 889, lo: 847, hi: 930, actual: 930, hit: false, under: true, pct: '4.7' },
      { v: 10, pred: 928, lo: 886, hi: 971, actual: 941, hit: true, under: null, pct: null },
      // 2026-09-12:最后一站不再「待验」—— 负收入月也进评分,跳过它等于挑掉了最难的一次。
      { v: 11, pred: 958, lo: 919, hi: 997, actual: -64, hit: false, under: false, pct: '106.6' },
    ]
    rows.forEach((r, i) => {
      const e = expected[i]
      expect(round(r.predictMid), `v${e.v} pred`).toBe(e.pred)
      expect(round(r.lo), `v${e.v} lo`).toBe(e.lo)
      expect(round(r.hi), `v${e.v} hi`).toBe(e.hi)
      expect(r.actualWan == null ? null : round(r.actualWan), `v${e.v} actual`).toBe(e.actual)
      expect(r.hit, `v${e.v} hit`).toBe(e.hit)
      expect(r.under, `v${e.v} under`).toBe(e.under)
      expect(r.missPct == null ? null : r.missPct.toFixed(1), `v${e.v} pct`).toBe(e.pct)
    })
    expect(rows[5].isLast).toBe(true)
    expect(rows.slice(0, 5).every((r) => !r.isLast)).toBe(true)
    // 2026-09-12 之后这条**反过来了**,而且必须反:回测是样本外的,站在 11 月末只能用 1-11 月;
    // 主 fit 现在含 12 月自己(用户要求全部算进去)。两者不该再相等 —— 屏上因此有两个 12 月区间:
    // 回测表里的 919~997(样本外)与图上的 232~1082(样本内)。钉住这个差别,免得有人"修"成一致。
    const mainBand = fitBandAt(fitRevenueTrend(p2025())!, 12)!
    expect(round(rows[5].predictMid)).toBe(958)
    expect(round(mainBand.mid)).toBe(657)
    expect(round(rows[5].predictMid)).not.toBe(round(mainBand.mid))
  })

  it('backtestRows:pnl 为 null → null', () => {
    expect(backtestRows(null, BUDGET)).toBeNull()
  })

  it('❗backtestSummary:6 次可评分(最后一站也算),2 中 4 落空,方向有高有低', () => {
    const rows = backtestRows(p2025(), BUDGET)
    const sum = backtestSummary(rows)!
    // 改前 5/2/3 且「全是低估」。12 月那一站进来之后多一次落空,而且方向是高估(实际远低于下沿),
    // 所以「全是低估」不再成立 —— 这正是那条文案不许写死方向的理由。
    expect(sum.scored).toBe(6)
    expect(sum.hits).toBe(2)
    expect(sum.misses).toBe(4)
    expect(sum.unders).toBe(3)
    expect(sum.allUnder).toBe(false)
    expect(backtestSummary(null)).toBeNull()
  })

  it('❗backtestReadout/RefText:文案与字数门禁(≤30/≤28 可见字),不含统计禁词', () => {
    const rows = backtestRows(p2025(), BUDGET)
    const sum = backtestSummary(rows)
    const read = backtestReadout(sum)
    const ref = backtestRefText(rows)
    expect(read).toBe('这条带按80%画的，6次里只中了2次，落空的4次全是有高有低')
    expect(ref).toBe('参照6-11月末起点·样本6次')
    expect([...read!].length).toBeLessThanOrEqual(30)
    expect([...ref].length).toBeLessThanOrEqual(28)
    expect(read).not.toMatch(/σ|标准差|标准偏差|西格玛|z\s*分数|置信/)
    expect(ref).not.toMatch(/σ|标准差|标准偏差|西格玛|z\s*分数|置信/)
    expect(backtestReadout(null)).toBeNull()
    expect(backtestRefText(null)).toBe('')
  })

  it('backtestReadout:全部命中时不说「全是低估」(不能瞎编方向)', () => {
    expect(backtestReadout({ scored: 3, hits: 3, misses: 0, unders: 0, allUnder: false })).toBe('这条带按80%画的，3次全部命中')
  })

  it('❗backtestSummary:unders 只数「落空里偏低」的那部分,不能拿 misses 顶替 —— '
    + '2025 实测数据里两者刚好都是3,单靠上面那条测不出「顶替」这种 bug,这里手造一次高估把两者拆开', () => {
    const rows: BacktestRow[] = [
      { vantageMonth: 1, isLast: false, predictMid: 100, lo: 90, hi: 110, actualWan: 120, hit: false, under: true, missPct: 20 },
      { vantageMonth: 2, isLast: false, predictMid: 100, lo: 90, hi: 110, actualWan: 80, hit: false, under: false, missPct: 20 },
      { vantageMonth: 3, isLast: true, predictMid: 100, lo: 90, hi: 110, actualWan: 100, hit: true, under: null, missPct: null },
    ]
    const sum = backtestSummary(rows)!
    expect(sum.scored).toBe(3)
    expect(sum.hits).toBe(1)
    expect(sum.misses).toBe(2)
    expect(sum.unders).toBe(1)    // 只有一次偏低——不等于 misses(2),顶替的话这里就会错报成 2
    expect(sum.allUnder).toBe(false)
  })
})

