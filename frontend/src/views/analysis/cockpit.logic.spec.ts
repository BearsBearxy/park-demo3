// 驾驶舱纯函数单测(铁律⑦):取期/环比/欠费清单 + 2026-10 改稿的 monthBoard / yearBoard(文件末尾)。
// 折万与聚合口径必须与 v1 一致(锚点:2025-10 营收 9,301,531 元 → 930.15 万)。
import { describe, expect, it } from 'vitest'
import {
  anchorMonth, arrearsOf, atPeriod, budgetRevenueOf, t80, momOf, schedTrend,
  monthBoard, yearBoard, pnlShownYm, pnlShownYear, fullPnlYear, type Tile,
} from './cockpit.logic'
import type { AnaAnomaly, PnlSummary, S10PhaseMonthly, CollectRate } from '@/analysis/anaData'
import { noPnlYear, pageFallback, seeYear } from '@/components/ana/anaSentence'
import FX from './__fixtures__/cockpit2025.json'
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

describe('schedTrend(点构成条看板块趋势)', () => {
  const band = (rev: (number | null)[]) => ({ rev, cost: N12(), pnl: N12() })
  const p = pnl({ bySchedule: { s2: band([800, null, 200, ...new Array(9).fill(null)]), s4: band(N12()) } })
  it('只取有数月并折万', () => {
    expect(schedTrend(p, 's2')).toEqual({ labels: ['1月', '3月'], vals: [0.08, 0.02] })
    expect(schedTrend(p, 's4')).toEqual({ labels: [], vals: [] })
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

describe('budgetRevenueOf', () => {
  it('取当年非子行收入总计', () => {
    const rows: BudgetRowDTO[] = [budgetRow({ label: '其中：租金收入', sub: true, budget: 1 }), budgetRow({ budget: 92705202.87 }), budgetRow({ year: 2026, budget: 103620434.53 })]
    expect(budgetRevenueOf(rows, 2025)).toBe(92705202.87)
    expect(budgetRevenueOf(rows, 2024)).toBeNull()
  })
})

describe('t80(t 分布双侧 80% 分位,revBandAt 用)', () => {
  it('表内按表,df>30 用正态极限,df<1 才是真的算不出', () => {
    expect(t80(9)).toBe(1.383)
    expect(t80(30)).toBe(1.310)
    expect(t80(31)).toBe(1.2816)
    expect(t80(0)).toBeNull()
  })
})

// ═════════ 2026-10 改稿(画板 cockpit-month-v2 / -m06 / -m11 / cockpit-year-v2)═════════
// 夹具 __fixtures__/cockpit2025.json = park_demo3 2025 实测(出稿脚本那一份取数;台账按公司×月合并,收缴率不变)。
// 期望值是画板上的字(cockpit-v2/manifest.json),逐字对。
const fx = FX as unknown as { pnl: PnlSummary; coll: CollectRate[]; s10p: S10PhaseMonthly; budget: BudgetRowDTO[]; ledger: AnalysisLedgerRow[]; anomalies: AnaAnomaly[] }
const mb = (month: number, prevPnl: PnlSummary | null = null, p: PnlSummary = fx.pnl) =>
  monthBoard({ pnl: p, prevPnl, month, s10: fx.s10p, collects: fx.coll, ledger: fx.ledger, anomalies: fx.anomalies, target: 96 })
const tileText = (t: Tile) => [t.label, t.value, t.dval, t.dkey, t.note].filter(Boolean).join(' | ')
interface OptSeries { name?: string; data: unknown[]; markPoint?: { data: { callout?: { lines: string[] } }[] } }
const opt = (o: object | null) => o as { series: OptSeries[]; legend?: { data: string[] } }
const bubbles = (o: object | null) => opt(o).series.flatMap((s) => s.markPoint?.data ?? []).filter((x) => x.callout).map((x) => x.callout!.lines.join(''))
const labels = (o: object | null) => opt(o).series.flatMap((s) => s.data)
  .filter((d): d is { label: { show: boolean; formatter: unknown } } => !!d && typeof d === 'object' && 'label' in d && (d as { label: { show: boolean } }).label.show)
  .map((d) => (typeof d.label.formatter === 'string' ? d.label.formatter : 'fn'))
const BT_ROWS = [
  '6月末 · ¥776.1万 · ¥743.7~808.6万 · ¥825.0万 · 高于区间',
  '7月末 · ¥816.4万 · ¥775.5~857.3万 · ¥866.9万 · 高于区间',
  '8月末 · ¥859.3万 · ¥813.8~904.8万 · ¥876.3万 · 在区间里',
  '9月末 · ¥888.6万 · ¥847.3~930.0万 · ¥930.2万 · 高于区间',
  '10月末 · ¥928.2万 · ¥885.8~970.6万 · ¥940.8万 · 在区间里',
  '11月末 · ¥958.0万 · ¥918.6~997.4万 · −¥63.6万 · 低于区间',
]

describe('❗改稿 · 按月 2025-12(默认板)', () => {
  const b = mb(12)
  it('KPI 四张:比11月;收入差额不标红、利润下滑标红;收缴率回退到 10 月', () => {
    expect(tileText(b.kpis.rev)).toBe('营业收入 | −¥63.6万 | −1,004.4万 | 比11月')
    expect(b.kpis.rev.dtone).toBeUndefined()
    expect(tileText(b.kpis.cost)).toBe('成本费用 | ¥591.7万 | −4.2万 | 比11月')
    expect(b.kpis.cost.dtone).toBe('up')
    expect(tileText(b.kpis.profit)).toBe('园区利润 | −¥655.3万 | −1,000.2万 | 比11月')
    expect(b.kpis.profit.dtone).toBe('down')
    expect(tileText(b.kpis.rate)).toBe('收缴率(10月) | 81.3% | 比目标 96% 低 14.7 个点')
  })
  it('预测卡:12 月看 12 月本身;区间画在 7–12 月;气泡钉在 12 月实际', () => {
    expect([b.fc.title, b.fc.hint, b.fc.read, ...b.fc.refs]).toEqual([
      '营业收入趋势 · 预测', '2025年1–12月 · 万元', '12月实际低于预计 ¥918.6~997.4万', '最近 6 次（7–12月）中 2 次落在区间里', '按1–11月算12月'])
    expect(opt(b.fc.option).legend!.data).toEqual(['营业收入', '区间（6次中2次）'])
    expect(opt(b.fc.option).series[1].data.flatMap((v, i) => (v == null ? [] : [i + 1]))).toEqual([7, 8, 9, 10, 11, 12])
    expect(bubbles(b.fc.option)).toEqual(['12月实际'])
  })
  it('回测表六行逐字(和预测区间同一套算法)', () => {
    expect([b.bt.title, b.bt.hint, b.bt.ref]).toEqual(['这条带过去准不准', '6 次', '每次按当时已有的月算下一个月'])
    expect(b.bt.rows.map((r) => r.join(' · '))).toEqual(BT_ROWS)
  })
  it('构成 / 分期:上月 / 本月成对条,只标读数句点到的那一项', () => {
    expect([b.compo.title, b.compo.hint, b.compo.read]).toEqual(['营业收入构成', '4 个板块 · 和11月比 · 万元', '租金 638.8→−341.3；其余 3 项 302.0→277.6'])
    expect(labels(b.compo.option)).toEqual(['638.8', '−341.3'])
    expect([b.phase.title, b.phase.hint, b.phase.read, ...b.phase.refs]).toEqual(['分期收入', '4 个期区 · 和11月比 · 万元', '二期 489.3→−511.2；其余 3 项 401.6→403.0', '按销售收入表算，和营业收入分开记'])
    expect(labels(b.phase.option)).toEqual(['489.3', '−511.2'])
  })
  it('各公司收缴率回退到 10 月,只标最低那家;规则前 3 条 + 两句参照', () => {
    expect([b.coll.title, b.coll.tag, b.coll.hint, b.coll.read, ...b.coll.refs]).toEqual(['各公司收缴率', '显示 10月', '6 家管理公司 · 台账 · %', '6 家里 0 家到了目标，最低是 创显 67.1%', '按台账10月的实收和应收算'])
    expect(labels(b.coll.option)).toHaveLength(1)
    expect(b.rules.hint).toBe('前 3 条')
    expect(b.rules.rows.map((r) => `${r.title}  ${r.value}`)).toEqual(['铂超贸易 12月无计费记录  11月计费 ¥2.6万', '火炬创新创业园 12月计费合计为负  −¥758.1万', '优品世家 12月无计费记录  11月计费 ¥2.2万'])
    expect(b.rules.refs).toEqual(['12月共触发 7 条规则', '12月没有台账，收缴率、应收为负两类规则没跑'])
  })
})

describe('❗改稿 · 按月 2025-06 / 2025-11 / 1 月', () => {
  it('6 月:回测只 4 次 → 不画区间只出「预计」点,回测表标题不说「这条带」;分期上月没数照说', () => {
    const b = mb(6)
    expect([tileText(b.kpis.rev), tileText(b.kpis.cost), tileText(b.kpis.profit), tileText(b.kpis.rate)]).toEqual([
      '营业收入 | ¥771.1万 | +17.4万 | 比5月', '成本费用 | ¥517.8万 | +17.8万 | 比5月', '园区利润 | ¥253.3万 | −0.4万 | 比5月', '收缴率 | 69.9% | 比目标 96% 低 26.1 个点'])
    expect([b.fc.title, b.fc.hint, b.fc.read, ...b.fc.refs]).toEqual(['营业收入趋势 · 下月预测', '2025年1–7月 · 万元', '7月实际 ¥825.0万，高于预计 ¥776.1万', '只验过 4 次，不画区间'])
    expect(opt(b.fc.option).legend!.data).toEqual(['营业收入', '预计'])
    expect(bubbles(b.fc.option)).toEqual(['¥825.0万'])
    expect([b.bt.title, b.bt.hint]).toEqual(['过去几次预测准不准', '4 次'])
    expect(b.bt.rows.map((r) => r.join(' · '))).toEqual([
      '3月末 · ¥695.4万 · ¥650.4~740.5万 · ¥740.6万 · 高于区间', '4月末 · ¥733.1万 · ¥678.3~787.9万 · ¥753.7万 · 在区间里',
      '5月末 · ¥755.6万 · ¥715.8~795.5万 · ¥771.1万 · 在区间里', BT_ROWS[0]])
    expect([b.phase.hint, b.phase.read]).toEqual(['4 个期区 · 万元', '销售收入表没有5月，做不了和5月比'])
    expect(opt(b.phase.option).series).toHaveLength(1)
    expect([b.coll.tag, b.coll.read, ...b.coll.refs]).toEqual(['', '6 家里 2 家到了目标，最低是 创显 39.6%', '按台账6月的实收和应收算'])
    expect(b.rules.rows.map((r) => `${r.title}  ${r.value}`)).toEqual(['创显 6月收缴率  39.6%', '钜兴 6月应收为负 · 帮管好台账  −¥1.3万', '钜兴 6月应收为负 · 一泽台账  −¥2.2万'])
    expect(b.rules.refs).toEqual(['6月共触发 11 条规则'])
  })
  it('11 月:预测 12 月,气泡写实际金额;变动不到 5% 的两张成对条不出句;规则一条没有 → 只剩那句没跑', () => {
    const b = mb(11)
    expect([tileText(b.kpis.rev), tileText(b.kpis.cost), tileText(b.kpis.profit)]).toEqual([
      '营业收入 | ¥940.8万 | +10.6万 | 比10月', '成本费用 | ¥595.9万 | −18.4万 | 比10月', '园区利润 | ¥344.9万 | +29.0万 | 比10月'])
    expect([b.fc.title, b.fc.hint, b.fc.read, ...b.fc.refs]).toEqual(['营业收入趋势 · 下月预测', '2025年1–12月 · 万元', '12月实际 −¥63.6万，低于预计 ¥918.6~997.4万', '最近 6 次（7–12月）中 2 次落在区间里'])
    expect(bubbles(b.fc.option)).toEqual(['−¥63.6万'])
    expect(b.bt.rows.map((r) => r.join(' · '))).toEqual(BT_ROWS)
    expect([b.compo.read, b.phase.read]).toEqual([null, null])
    expect(labels(b.compo.option)).toEqual([])
    expect(b.rules.rows).toEqual([])
    expect(b.rules.refs).toEqual(['11月没有台账，收缴率、应收为负两类规则没跑'])
  })
  it('1 月比上一年的 12 月;上一年没有就不出涨跌,构成照说没有', () => {
    const p = { ...fx.pnl, year: 2026 }
    const dec = { ...fx.pnl, year: 2025 }
    expect(mb(1, dec, p).kpis.rev.dkey).toBe('比12月')
    expect(mb(1, dec, p).kpis.rev.dval).toBe('+778.3万')   // 7,146,649.89 − (−636,050.65)
    const none = mb(1, null, p)
    expect(none.kpis.rev.dval).toBeUndefined()
    expect(none.compo.read).toBe('损益表没有12月，做不了和12月比')
  })
})

describe('❗改稿 · 按年 2025', () => {
  const y = yearBoard({ pnl: fx.pnl, budget: fx.budget, collects: fx.coll, target: 96 })
  it('KPI 五张:比2024年 + 预算达成 + 收缴率(1–10月)', () => {
    expect(Object.values(y.kpis).map(tileText)).toEqual([
      '营业收入 | ¥8,772.2万 | +5.9% | 比2024年', '成本费用 | ¥6,482.1万 | +7.5% | 比2024年', '园区利润 | ¥2,290.1万 | +1.4% | 比2024年',
      '预算达成 | 94.6% | 比全年预算少 ¥498.3万', '收缴率(1–10月) | 80.5% | 比目标 96% 低 15.5 个点'])
    expect(y.kpis.cost.dtone).toBeUndefined()   // 成本涨了不标红
  })
  it('历年 / 累计 / 各月:读数句、参照、气泡、峰谷标签', () => {
    expect([y.hist.hint, y.hist.read, ...y.hist.refs]).toEqual(['4 年 · 万元', '2022年→2025年 营业收入增长 100.1%', '2022–24 取预算表全年实际，2025 取损益表', '2022–24 的成本费用按营业收入和园区利润算'])   // 文案复查:2025 柱取损益表原值,只有往年是算出来的
    expect(bubbles(y.hist.option)).toEqual(['比2022年增长 100.1%'])
    expect([y.cum.hint, y.cum.read]).toEqual(['万元', '12月累计比11月底少 ¥63.6万'])
    expect(bubbles(y.cum.option)).toEqual(['12月 少 ¥63.6万'])
    expect([y.monthly.hint, y.monthly.read]).toEqual(['万元', '营业收入最高 11月 ¥940.8万，最低 12月 −¥63.6万'])
    expect(labels(y.monthly.option)).toEqual(['¥940.8万', '−¥63.6万'])
  })
  it('历年构成 / 各月收缴率', () => {
    expect([y.histCompo.hint, y.histCompo.read, ...y.histCompo.refs]).toEqual(['4 年 · 万元', '租金占营业收入 2025年 64.9%，比2024年低 6.2 个点', '2022–24 取预算表全年实际，2025 取损益表'])
    expect(labels(y.histCompo.option)).toEqual(['64.9%'])
    expect([y.collM.hint, y.collM.read, ...y.collM.refs]).toEqual(['2025年1–10月 · 台账 · %', '10 个月里 3 个月到了目标，最低是 2月 59.6%', '按台账各月的实收和应收算'])
    expect(labels(y.collM.option)).toHaveLength(1)
  })
})

describe('❗改稿 · 期间回退(cv2-notdone / cv2-ask 7)', () => {
  const yms = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`)
  it('按月:所选月没损益 → 最近有数月;更早都没有 → 最早有数月', () => {
    expect(pnlShownYm(yms, '2025-06')).toBe('2025-06')
    expect(pnlShownYm(yms, '2026-01')).toBe('2025-12')
    expect(pnlShownYm(yms, '2024-03')).toBeNull()   // 只往前退:更早没有就空状态,不拿 2025年1月顶替
    expect(pnlShownYm([], '2025-06')).toBeNull()
    expect(pageFallback('2025-12', '2026-01')).toBe('显示 2025年12月 · 2026年1月无数据')
  })
  it('按年:有数的年照画;0 个月的年不管从哪儿来都是空状态(按钮去最近录满的年)', () => {
    expect(fullPnlYear([...yms, '2026-01'])).toBe(2025)
    expect(pnlShownYear(yms, 2025)).toBe(2025)
    expect(pnlShownYear(yms, 2026)).toBeNull()
    expect(pnlShownYear(yms, 2024)).toBeNull()
    expect(pageFallback('2025', '2026')).toBe('显示 2025年 · 2026年无数据')
    expect([noPnlYear(2026), seeYear(2025)]).toEqual(['损益表里没有2026年', '看 2025年'])
  })
})

describe('❗改稿 · 按年的边角数据(开发里句子超长会抛错,整屏挂掉)', () => {
  it('最高 / 最低各有两个月并列、逐个点名放不下 30 字 → 写「2 个月」;上一年预算表没拆板块 → 构成不出句', () => {
    const revenue = [7e6, 8e6, 9e6, 7.5e6, 8e6, 7e6, 7.5e6, 9e6, 8e6, 7.5e6, 8e6, 7.5e6]
    const p = { ...fx.pnl, revenue, profit: revenue.map((v, i) => v - (fx.pnl.cost[i] ?? 0)) }
    const flat = fx.budget.filter((r) => !r.sub)   // 只剩「收入总计」「利润总额」这类总行
    const y = yearBoard({ pnl: p, budget: flat, collects: fx.coll, target: 96 })
    expect(y.monthly.read).toBe('营业收入最高 2 个月 ¥900.0万，最低 2 个月 ¥700.0万')
    expect(labels(y.monthly.option)).toHaveLength(4)   // 并列的四根柱都标数
    expect(y.histCompo.read).toBeNull()
  })
})
