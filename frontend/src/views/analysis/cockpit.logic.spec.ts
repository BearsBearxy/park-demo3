// 驾驶舱 v2 纯函数单测(铁律⑦):取期/环比/主图整形/构成/分期堆叠/收缴取期/欠费清单/预算达成。
// 折万与聚合口径必须与 v1 一致(锚点:2025-10 营收 9,301,531 元 → 930.15 万)。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  achNoteText, anchorMonth, arrearsOf, atPeriod, atPnlPeriod, budgetAch, budgetRevenueOf, buildConclusion, colPick, compoData, mainChart, momOf, monthRangeLabel, phaseStack, pnlYearMonths, schedTrend,
  type BudgetAch,
} from './cockpit.logic'
import { usableMonths } from '@/analysis/anaData'
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
  it('❗yMin 只取 usableMonths 挑出的月(离群月的极端负收入不拉爆量程)', () => {
    const revenue = N12(); revenue[9] = 8000000; revenue[11] = -636050.65
    const profit = N12(); profit[9] = -100000
    const d = mainChart(pnl({ months: [10, 12], revenue, profit }), null)!
    // 10 月利润 −10 万是可用月里的最小值;12 月离群收入 −63.61 万被 usableMonths 剔掉,不参与量程
    expect(d.yMin).toBe(-10)
  })
  it('❗全离群(usableMonths 退回原始月列表)时 yMin 不取该兜底 —— 交 ECharts 自动定量程;分母侧月列表仍非空', () => {
    const revenue = N12(); revenue[9] = -8000000; revenue[11] = -636050.65
    const d = mainChart(pnl({ months: [10, 12], revenue }), null)!
    expect(d.outlierMonths).toEqual([10, 12])   // 两个覆盖月都是离群月
    expect(d.yMin).toBeUndefined()              // 不能钉在 −80/−63.61 万那种被污染的极端值上
    // 同一份数据喂给 usableMonths(分母消费者走这条路):兜底仍在,不返回空数组(分母不为 0)
    expect(usableMonths([10, 12], revenue)).toEqual([10, 12])
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

  it('❗I3:护栏把达成率从 94.6% 抬到 95.3% —— 涨 0.69 个点、方向相同、两边都够不着 100%', () => {
    const allMonths = REV.reduce<number>((s, v) => s + (v ?? 0), 0)
    const rateAll = (allMonths / BUDGET) * 100            // 含 12 月冲回(= 改前 atPeriod 的年度口径)
    const a = budgetAch(rows2025, p2025(), 2025)!         // 剔掉 12 月(护栏口径)
    expect(rateAll.toFixed(1)).toBe('94.6')
    expect(a.rate.toFixed(1)).toBe('95.3')
    expect(a.usedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(a.actual).toBeCloseTo(88358126.19, 2)
    expect(a.rate - rateAll).toBeCloseTo(0.69, 2)         // 不是 11 个点
    expect(a.rate).toBeGreaterThan(rateAll)               // 方向相同,不是「相反」
    expect(a.rate).toBeLessThan(100)                      // 护栏抬不过 100%,105.6% 那个数不存在
  })

  it('❗I4:结论句里印出来的收入 ÷ 预算,必须回到同一句里印出来的达成率(利润率同理)', () => {
    const r = buildConclusion(p2025(), [], rows2025, [], 0, { collectTarget: 96 },
      { isMonth: false, year: 2025, usedMi: 0, ym: null })
    expect(r[0].text).toBe('2025年收入 ¥8,836万(预算达成 95.3%),园区利润 ¥2,945万(利润率 33.3%)')
    // 可执行形式:只认句子自己印出来的数,读者拿计算器怎么算,这里就怎么算。
    const num = (re: RegExp): number => Number(re.exec(r[0].text)![1].replace(/,/g, ''))
    const revWan = num(/收入 ¥([\d,]+)万/)
    const profWan = num(/园区利润 ¥([\d,]+)万/)
    const rate = num(/预算达成 ([\d.]+)%/)
    const margin = num(/利润率 ([\d.]+)%/)
    // 改前:收入含 12 月冲回(¥8,772万)、达成率不含 —— 这一除得 94.62,与印出来的 95.3 差 0.68 个点
    expect((revWan * 10000 / BUDGET) * 100).toBeCloseTo(rate, 1)
    expect((profWan / revWan) * 100).toBeCloseTo(margin, 1)
  })

  it('❗I4:达成率分母与并排三瓦的取期共用同一个月份集合(不是各算各的)', () => {
    const p = p2025()
    const months = pnlYearMonths(p)
    expect(months).toEqual(budgetAch(rows2025, p, 2025)!.usedMonths)
    expect(atPnlPeriod(p.revenue, false, 0, months)).toBeCloseTo(88358126.19, 2)
    // 月粒度不受护栏影响:点开 12 月就该看见那笔冲回本身,不是一片空白
    expect(atPnlPeriod(p.revenue, true, 11, months)).toBe(-636050.65)
    // 对照:不过滤月份的老写法把冲回加进年度合计 —— 两者相差正是那 63.6 万
    expect((atPeriod(p.revenue, false, 0) as number) - (atPnlPeriod(p.revenue, false, 0, months) as number))
      .toBeCloseTo(-636050.65, 2)
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
  const months = pnlYearMonths(p)   // 12 月因整屏营收离群被剔:[10]

  it('构成合计只算 yearMonths 里的月,与营收 KPI 用同一批月份、不含 12 月那笔', () => {
    expect(months).toEqual([10])
    expect(compoData(p, false, 0, months)).toEqual([{ key: 's1', label: '租金', value: 5000000 }])
    expect(atPnlPeriod(p.revenue, false, 0, months)).toBe(8000000)
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
    const tile = /<AnaKpiTile label="预算达成"[\s\S]*?\/>/.exec(src)
    expect(tile, 'CockpitView.vue 找不到「预算达成」瓦').toBeTruthy()
    expect(tile![0]).toContain(':note="achNote"')
    expect(tile![0]).not.toContain('pnlRange')
  })
})
