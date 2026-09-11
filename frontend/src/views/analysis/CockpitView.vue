<script setup lang="ts">
// 经营驾驶舱 v2(spec §二.1 + 示意图1,2026-07-08 重构):
// KPI 6 tile(#kpis 槽)+ 主图 s8 收入柱+利润线(ECharts,dataZoom+预算 markLine+点月柱全屏联动)
// + s4 收入构成环(点扇区→该板块 12 月趋势弹层)+ 第二排 s4×3 = 分期收入堆叠(点击深链附表10)
// / 收缴率横条 vs 目标(点击→欠费清单弹层,数据台账)/ 异常速览(规则引擎前4条,链监控中心)。
// 对比开关 ['mom','budget']:环比=上月收入虚线叠加;预算=预算月均虚线。数值口径与 v1 逐项一致
// (取数全走 anaData 既有聚合器,变换纯函数见 cockpit.logic.ts)。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaForecastChart from '@/components/ana/AnaForecastChart.vue'
import { rollingForecastRows, prevYearUsable } from './forecastChart.logic'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import { iconFor } from '@/components/ds/icon'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import { STATUS, fint, fnum, sgn } from '@/components/ana/anaFmt'
import { usePeriod, ymOf } from '@/analysis/usePeriod'
import { anaSettings } from '@/analysis/anaSettings'
import { useCompare } from '@/analysis/useCompare'
import {
  buildAnomalies, fetchAnomalyInputs, fetchBudgetAll, fetchCollectRates, fetchContractSummary,
  fetchLedgerRows, fetchPnlSummary, fetchS10PhaseMonthly, fetchTenantSummary,
  type AnaAnomaly, type AnomalyInputs, type CollectRate, type PnlSummary, type S10PhaseMonthly,
} from '@/analysis/anaData'
import {
  achLabelText, achNoteText, anchorMonth, arrearsOf, atPnlPeriod, backtestReadout, backtestRefText, backtestRows, backtestSummary, budgetAch, budgetRevenueOf, buildConclusion, colPick, compoData, fitBandAt, fitRevenueTrend, nextMonthForecast, nextForecastReadout, nextForecastRefText, mainChart, mainChartOption, mainChartOutlierNote, momOf, monthRangeLabel, outlierReadout, outlierRefText, outlierResidual, outlierResidualsByMonth, phaseStack, pnlYearMonths, revNoteText, schedTrend,
} from './cockpit.logic'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'
import type { TenantSummaryDTO } from '@/types/tenant'
import type { ContractSummaryDTO } from '@/types/contract'

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const cmp = useCompare(['mom', 'budget'])   // 屏声明支持集(AnaShell 同集渲染开关)

// ── 取数(period 无关项拉一次;pnl 随年切换;全走 anaData 缓存) ──
const pnl = ref<PnlSummary | null>(null)
// 上一年:只给逐月预测带用(把去年尾月接到横轴左边,今年 1 月才有三个在前的点)。
// 取不到就是 null —— 老园区第一年没有上一年很正常,不能因此让整屏出错。
const prevPnl = ref<PnlSummary | null>(null)
const collects = ref<CollectRate[]>([])
const s10Phase = ref<S10PhaseMonthly | null>(null)
const ledgerRows = ref<AnalysisLedgerRow[]>([])
const tenantSum = ref<TenantSummaryDTO | null>(null)
const contractSum = ref<ContractSummaryDTO | null>(null)
const anomInputs = ref<AnomalyInputs | null>(null)
const budgetRows = ref<BudgetRowDTO[]>([])
const ready = ref(false)

const year = computed(() => period.sel.value.year)
const pnlLoading = ref(true)   // §五策略3:年切重取期间主区出加载态,避免沿用旧年图表
let token = 0                  // 年切竞态守卫(范式同 FinPnlView):过期响应弃写
watch(year, (y) => {
  if (!y) return
  const t = ++token
  pnlLoading.value = true
  fetchPnlSummary(y)
    .then((v) => { if (t === token) pnl.value = v })
    .catch(() => { if (t === token) pnl.value = null })
    .finally(() => { if (t === token) pnlLoading.value = false })
  // 上一年单独取,失败/为空都只让预测带退回本年口径,不进 pnlLoading,不拖住整屏。
  fetchPnlSummary(y - 1)
    .then((v) => { if (t === token) prevPnl.value = v })
    .catch(() => { if (t === token) prevPnl.value = null })
}, { immediate: true })

async function reload() {
  try {
    const [c, ph, lr, t, ct, ai, bg] = await Promise.all([
      fetchCollectRates(), fetchS10PhaseMonthly(), fetchLedgerRows(),
      fetchTenantSummary(), fetchContractSummary(), fetchAnomalyInputs(),
      fetchBudgetAll().catch(() => [] as BudgetRowDTO[]),   // 预算为增量端点,失败不拖垮驾驶舱
    ])
    collects.value = c
    s10Phase.value = ph
    ledgerRows.value = lr
    tenantSum.value = t
    contractSum.value = ct
    anomInputs.value = ai
    budgetRows.value = bg
  } finally {
    ready.value = true
  }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })

// ── 期间与 KPI(口径同 v1:月=当月,年=有数月Σ,缺月 null 不补 0) ──
const isMonth = computed(() => period.sel.value.gran === 'month')
const mi = computed(() => period.sel.value.month - 1)
const money = (v: number | null): string => (v == null ? '—' : (v < 0 ? '−¥' : '¥') + fnum(Math.abs(v) / 10000) + '万')

// §五策略2 月锚:所选月无损益 → KPI/构成环锚定最近覆盖月 + 顶部横幅显式(取值公式不变)
const usedMi = computed(() => (isMonth.value ? anchorMonth(pnl.value?.months ?? [], mi.value + 1) - 1 : mi.value))
const pnlUsedYm = computed(() => (isMonth.value && usedMi.value !== mi.value ? ymOf(year.value, usedMi.value + 1) : null))
// §五策略3:所选年无损益附表 → 主区整体空态(禁止沿用旧年图表)
const pnlEmpty = computed(() => !pnl.value?.months.length)

// I4(对抗复查):年粒度下这三个数与「预算达成」共用同一批月份(pnlYearMonths)。
// 改前 atPeriod 把 2025-12 那笔年末冲回(收入 −63.6 万)也加进年度合计,而达成率把它剔了 ——
// 同一条 KPI 条上「营收合计 ¥8,772万」与「预算达成 95.3%(¥9,271万)」一除得 94.6%,对不上。
// 月粒度不受影响:点开 12 月就该看见那笔冲回本身。覆盖区间印在各瓦 note 上(pnlRange),不隐瞒。
const yearMonths = computed(() => pnlYearMonths(pnl.value))
const rev = computed(() => atPnlPeriod(pnl.value?.revenue, isMonth.value, usedMi.value, yearMonths.value))
const cost = computed(() => atPnlPeriod(pnl.value?.cost, isMonth.value, usedMi.value, yearMonths.value))
const prof = computed(() => atPnlPeriod(pnl.value?.profit, isMonth.value, usedMi.value, yearMonths.value))
const margin = computed(() => (rev.value && prof.value != null ? (prof.value / rev.value) * 100 : null))
const cp = computed(() => colPick(collects.value, isMonth.value, year.value, period.ym.value))
const ach = computed(() => budgetAch(budgetRows.value, pnl.value, year.value))
// 未闭月护栏(FORECAST §2.7):副标题按可用月印覆盖区间,不写「已闭月」(该端点语义是审核状态,分析层不消费)。
// I4:达成率与营收/成本/利润三瓦共用 pnlYearMonths,所以覆盖区间也只算一次,四个瓦印的是同一句。
// 月粒度下这三瓦本就是显示当月实值(不是年度口径),没有覆盖区间可印 —— 空字符串是对的。
const pnlRange = computed(() => (isMonth.value ? '' : monthRangeLabel(yearMonths.value)))
// N2(修复轮2):预算达成永远是年度口径(budgetAch 不吃 isMonth),覆盖区间不能跟着 pnlRange
// 在月粒度下被清空 —— 否则默认打开驾驶舱看到的是「¥9,271万 · 」,分隔符后面空的。
const achNote = computed(() => achNoteText(ach.value, ach.value ? money(ach.value.budget) : '', year.value))
// F3(修复轮1,design-boards):覆盖表派给本任务的三处文案 —— 「预算达成」瓦标题/「N期收入」瓦 note,
// 计算逻辑抽成 cockpit.logic.ts 的纯函数(achLabelText/revNoteText,与本文件其余屏内变换同规矩,
// 单测见 cockpit.logic.spec.ts),这里只接线。
const achLabel = computed(() => achLabelText(ach.value))
const revNote = computed(() => revNoteText(isMonth.value, yearMonths.value, mc.value?.outlierMonths ?? [], pnlRange.value))

// ── 主图(对比开关:mom=上月收入虚线;budget=预算月均虚线;markLine=当年预算/12 常显) ──
interface EcClick { componentType?: string; seriesName?: string; dataIndex?: number; name?: string }
const budgetYuan = computed(() => budgetRevenueOf(budgetRows.value, year.value))
const mc = computed(() => mainChart(pnl.value, budgetYuan.value))

// T1/T2(design-boards 2026-09-11):月度收入 OLS 拟合 —— 全屏唯一一份(fitRevenueTrend),
// 下面三个 KPI 瓦与主图的趋势线/拟合区间/离群残差标注全部从这一个 fit 读,不再各算一次回归。
const fit = computed(() => fitRevenueTrend(pnl.value))
const outlierRes = computed(() => outlierResidual(fit.value, mc.value?.rev ?? [], mc.value?.outlierMonths ?? []))
// F4(修复轮1):主图 markPoint 逐点标注用,每根 pin 各取自己月份的残差倍数(不像 outlierRes 那样固定第一个月)
const outlierResByMonth = computed(() => outlierResidualsByMonth(fit.value, mc.value?.rev ?? [], mc.value?.outlierMonths ?? []))
const outlierRead = computed(() => outlierReadout(fit.value, outlierRes.value))
const outlierRef = computed(() => outlierRefText(fit.value))
// 下月预测(用户 2026-09-12:只要「录了这个月,看到下个月大概多少」)。
// 与下面回测表每一站同一套算法 —— 理由见 cockpit.logic.ts nextMonthForecast 头注。
const forecast = computed(() => nextMonthForecast(pnl.value))
const forecastRead = computed(() => nextForecastReadout(forecast.value))
const forecastRef = computed(() => nextForecastRefText(forecast.value, backSum.value))
// 回测:每站只用当时已有的月重新拟合(见 backtestRows 头注)。
// 「全年会落在哪」那张卡 2026-09-12 整块删掉 —— 用户:「全年分析对用户一点作用没有」。
const backRows = computed(() => backtestRows(pnl.value, budgetYuan.value))
const backSum = computed(() => backtestSummary(backRows.value))
const backRead = computed(() => backtestReadout(backSum.value))
const backRef = computed(() => backtestRefText(backRows.value))
// 主图离群月提示(不写「已闭月」—— closed-months 端点语义是审核状态,不是会计封账,分析层零引用)
const outlierBannerText = computed(() => {
  const m = mc.value?.outlierMonths[0]
  // 用户 2026-09-12:不许替他判断那个数是什么,也不许替他把它摘出去。
  // 改前这句写死「为年末冲回」(库里只有「收入为负」这一个事实,「冲回」是解读),
  // 而且声称「已排除」。两处都改:只陈述实测到的事实,并说明它**在**年度口径里。
  return m ? `${year.value}-${String(m).padStart(2, '0')} 收入为负,已计入年度营收/成本/利润与达成率` : ''
})
// AnaPeriodBanner selected/used 必填(五个既有屏共享该契约);插槽覆盖了文案,这两个值不上屏,
// 但仍按实际的离群月/达成率覆盖区间传——都是上面已算出来的值。
const outlierYm = computed(() => {
  const m = mc.value?.outlierMonths[0]
  return m ? ymOf(year.value, m) : ''
})
// 未闭月护栏(FORECAST §2.7):y 轴量程(d.yMin)由 mainChart 用 usableMonths 算好,这里只消费;
// 离群月本身仍画(数据点/tooltip 值不变),bar 标红 + markPoint 钉在轴内边界,readable 为「带外」。
// F1(对抗复查):option 本体(趋势线/拟合区间/离群标注三块交付物)抽成 cockpit.logic.ts 的纯函数
// mainChartOption——原先整段写在这个 computed 里,没有挂载测/纯函数覆盖,删掉/清空照样全绿。
const mainOption = computed<object | null>(() =>
  mainChartOption(mc.value, outlierResByMonth.value, cmp.mode.value))
// 2026-09-12(用户):趋势/拟合区间/已录入折线从主图拆出来自成一张,轴不从 0 起——
// 理由见 forecastChart.logic.ts 头注(ECharts 在类目轴上画不准这种「一个月一段区间」)。
// 自绘图的数据:逐月预测带(每个月的带只用它之前的月算),见 forecastChart.logic.ts。
// 上一年一起拉:它的尾月接到横轴左边,今年 1 月才有三个在前的点(用户 2026-09-12 提的跨年机制)。
// 接不接由 prevYearUsable 判 —— 附表口径不同就不接,理由见该函数头注。
const rollRows = computed(() => rollingForecastRows(pnl.value, prevPnl.value))
const prevState = computed<'none' | 'mismatch' | 'spliced'>(() =>
  prevYearUsable(pnl.value, prevPnl.value) ? 'spliced' : (prevPnl.value?.months.length ? 'mismatch' : 'none'))
// 点击月柱 → 期间切至该月(usePeriod 校验非法月自动忽略)→ 全屏联动
function onMainClick(p: unknown): void {
  const e = p as EcClick
  if (e.componentType !== 'series' || e.dataIndex == null) return
  if (period.sel.value.gran !== 'month') period.setGran('month')
  period.setMonth(e.dataIndex + 1)
}

// ── 收入构成环(点扇区 → 该板块 12 月趋势弹层;月锚随 usedMi,与 KPI 同口径) ──
// N1(修复轮2):与 rev/cost/prof 共用 yearMonths,收入构成合计不再是另一个数(见 cockpit.logic.ts)。
const compo = computed(() => compoData(pnl.value, isMonth.value, usedMi.value, yearMonths.value))
const compoTotal = computed(() => compo.value.reduce((s, d) => s + d.value, 0))
// 名义分类(租金/用电/用水/运管)须异色:主题色板前 4 位是蓝族渐变(给「分期收入堆叠」这类有序量用的),
// 4 扇区环恰好取满前 4 位 → 全蓝难辨。此处局部指定 4 个可区分色相,不动全局主题。
const COMPO_COLORS = ['#378ADD', '#5DCAA5', '#EF9F27', '#F0997B']
const donutOption = computed<object>(() => {
  const total = compoTotal.value
  const pct = (v: number): string => (total > 0 ? ((v / total) * 100).toFixed(1) : '0.0')
  const byLabel = new Map(compo.value.map((d) => [d.label, d.value]))
  return {
    color: COMPO_COLORS,
    tooltip: { trigger: 'item', valueFormatter: (v: number) => fnum(v) + '万' },
    // 图例带占比:静态也能读出各板块比重,不必悬停(扇区上不加标签,避免细扇区如「用水」标签重叠)
    legend: { bottom: 0, formatter: (name: string) => `${name} ${pct(byLabel.get(name) ?? 0)}%` },
    series: [{
      type: 'pie', radius: ['50%', '74%'], center: ['50%', '42%'],
      label: { show: false }, itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      data: compo.value.map((d) => ({ name: d.label, value: +(d.value / 10000).toFixed(2) })),
    }],
  }
})
const segModal = ref<{ key: string; label: string } | null>(null)
function onDonutClick(p: unknown): void {
  const e = p as EcClick
  const hit = compo.value.find((d) => d.label === e.name)
  if (hit) segModal.value = { key: hit.key, label: hit.label }
}
const segTrendOption = computed<object | null>(() => {
  if (!segModal.value) return null
  const t = schedTrend(pnl.value, segModal.value.key)
  if (!t.labels.length) return null
  return {
    grid: { left: 52, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : fnum(v) + '万') },
    xAxis: { type: 'category', data: t.labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}万' } },
    series: [{ name: segModal.value.label + '收入', type: 'line', data: t.vals, smooth: true, areaStyle: { opacity: 0.12 } }],
  }
})

// ── 分期收入堆叠(点击段 → 深链附表10 该期该月) ──
const ps = computed(() => phaseStack(s10Phase.value))
const phaseOption = computed<object | null>(() => {
  const d = ps.value
  if (!d) return null
  return {
    grid: { left: 52, right: 12, top: 30, bottom: 26 },
    legend: { top: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : fnum(v) + '万') },
    /* 月标签缩短「2025-01」→「1月」防 10+ 期挤爆(tooltip/点击深链仍用完整 YM) */
    xAxis: { type: 'category', data: d.months, axisLabel: { fontSize: 11, formatter: (v: string) => `${+v.slice(5)}月` } },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}万' } },
    series: d.series.map((s) => ({ name: s.name, type: 'bar', stack: 'ph', data: s.data, barMaxWidth: 30 })),
  }
})
function onPhaseClick(p: unknown): void {
  const e = p as EcClick
  const s = ps.value?.series.find((x) => x.name === e.seriesName)
  if (!s || !e.name) return
  tabs.openDeep('sales-income')   // 页签语义(spec §4.1);发链 periodLink:p + co=期区(§4.2)
  void router.push(periodLink('sales-income', { p: periodOf(+e.name.slice(0, 4), +e.name.slice(5, 7)), co: s.phase }))
}

// ── 收缴率横条 vs 目标(点击 → 该期欠费清单弹层) ──
// 只显近 6 期(2026-07-20 用户反馈:全年 10+ 期横条在小卡里过度拥挤);全期趋势看 KPI sparkline
// 先按所选年过滤再取近6期(2026-07-21 用户反馈:此前全局切片,台账跨年时选2025却混入2024期)
const collShown = computed(() => collects.value.filter((c) => c.ym.startsWith(year.value + '-')).slice(-6))
const collectOption = computed<object | null>(() => {
  if (!collShown.value.length) return null
  const target = anaSettings.collectTarget
  return {
    grid: { left: 48, right: 40, top: 12, bottom: 26 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => v.toFixed(1) + '%' },
    xAxis: { type: 'value', max: (v: { max: number }) => Math.max(100, Math.ceil(v.max)), axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: collShown.value.map((c) => `${+c.ym.slice(5)}月`) },
    series: [{
      name: '收缴率', type: 'bar', barMaxWidth: 20,
      data: collShown.value.map((c) => ({ value: +c.rate.toFixed(1), itemStyle: { color: c.rate >= target ? '#378ADD' : '#EF9F27', borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', fontSize: 11, formatter: '{c}%' },
      markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: 'rgba(28,28,28,.45)' }, label: { position: 'insideEndTop', formatter: `目标 ${target}%`, fontSize: 11 }, data: [{ xAxis: target }] },
    }],
  }
})
const arrModal = ref<string | null>(null)   // 欠费清单弹层:选中期 ym
const arrears = computed(() => (arrModal.value ? arrearsOf(ledgerRows.value, arrModal.value) : null))
function onCollectClick(p: unknown): void {
  const e = p as EcClick
  const ym = collShown.value[e.dataIndex ?? -1]?.ym   // 与近6期切片同数组,索引对齐
  if (ym) arrModal.value = ym
}
function goLedger(tenant: string, company: string, ym: string): void {
  tabs.openDeep('ledger')
  void router.push(periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company, tenant } }))
}

// ── 异常速览(规则引擎共用 anomaly 屏;前 4 条,链监控中心) ──
const anomalies = computed<AnaAnomaly[]>(() =>
  anomInputs.value ? buildAnomalies(anomInputs.value, { collectTarget: anaSettings.collectTarget }) : [])
const anomTop = computed(() => anomalies.value.slice(0, 4))
const go = (link: string): void => { void router.push(link) }
/** 规则引擎异常条(AnaAnomaly):录入屏目标带期与定位;落分析屏的三条 p 今天不被消费(usePeriod 单例,spec §12 遗留),带上无害。
 *  本屏 anomTop 含③④两条录入屏规则,extra 在那里才有值;与 AnomalyView.goAnom 逐字同形(那边那一列只有①②,今天等于原样 push)。 */
const goAnom = (a: AnaAnomaly): void => {
  const v = a.link.slice(1)
  // 录入屏目标走 openFresh({pin:true})(与 goLedger / goS10 同形):缓存的台账 / 附10 页签有草稿时 useDeepPeriod 的 dirty 闸会吞掉这一跳,「一击落位」靠全新实例;分析屏目标保持裸 push
  if (v === 'ledger' || v === 'sales-income') tabs.openDeep(v)
  void router.push(periodLink(v, { p: periodOf(+a.ym.slice(0, 4), +a.ym.slice(5, 7)), co: a.co, extra: { company: a.company, tenant: a.tenant } }))
}

// ── 经营结论条(spec 2026-07-11 §A:分句数据模板,取数全复用上方 computed 同源函数) ──
const conclusion = computed(() => buildConclusion(
  pnl.value, collects.value, budgetRows.value, ledgerRows.value, anomalies.value.length,
  { collectTarget: anaSettings.collectTarget },
  { isMonth: isMonth.value, year: year.value, usedMi: usedMi.value, ym: period.ym.value },
))
</script>

<template>
  <!-- §五:月敏感屏(full);月锚回退横幅 + 年空态见主区 -->
  <AnaShell :compare="['mom', 'budget']" period-mode="full">
    <template #tools>
      <span class="cv2-name"><component :is="iconFor('gauge')" :size="15" />经营驾驶舱</span>
    </template>

    <!-- KPI 条(spec:营收/成本/利润率/收缴率 vs 目标/预算达成/在租租户) -->
    <template #kpis>
      <!-- I4:年粒度三瓦与「预算达成」同批月份,覆盖区间印在 note 上(月粒度 pnlRange 为空,note 不出现) -->
      <!-- F3(修复轮1):年粒度标题/note 按稿改「N-M 月收入」/「N 期,已剔 M 月」(revNote,见上方计算属性头注) -->
      <AnaKpiTile :label="isMonth ? '营业收入' : pnlRange + '收入'" :value="money(rev)"
        :delta="momOf(pnl?.revenue, isMonth, usedMi)" kind="环比" :trend="pnl?.revenue" :note="revNote" />
      <AnaKpiTile label="成本费用" :value="money(cost)" :delta="momOf(pnl?.cost, isMonth, usedMi)" kind="环比" invert :trend="pnl?.cost" :note="pnlRange || undefined" />
      <!-- 数值失真门(普查稿 §2.5):基数过小时利润率会被放大成失真的大百分比,上限守卫不印具体数 -->
      <AnaKpiTile label="园区利润" :value="money(prof)"
        :note="(margin != null ? (margin > 300 ? '利润率 — 基数过小' : '利润率 ' + margin.toFixed(1) + '%') : '当期无损益数据') + (pnlRange ? ' · ' + pnlRange : '')" :trend="pnl?.profit" />
      <!-- 副文案人话化(2026-07-20 用户反馈):delta=−15.5pt + kind=距目标96%,口径区间挪 note 行 -->
      <AnaKpiTile label="收缴率" :value="cp ? cp.rate.toFixed(1) + '%' : '—'"
        :delta="cp ? +(cp.rate - anaSettings.collectTarget).toFixed(1) : null"
        :kind="cp ? `距目标${anaSettings.collectTarget}%` : ''" unit="pt"
        :note="cp ? `${cp.ym}累计实收/应收` : '台账未录入'" :trend="collects.map((c) => c.rate)" />
      <!-- 未闭月护栏(FORECAST §2.7):分母排除离群月,副标题印 usedMonths 覆盖区间(不写「已闭月」) -->
      <!-- N2:达成率是年度口径,覆盖区间用 achNote(不借 pnlRange —— 那个在月粒度下是空的) -->
      <AnaKpiTile :label="achLabel" :value="ach ? ach.rate.toFixed(1) + '%' : '—'" :note="achNote" />
      <AnaKpiTile label="在租租户(计数口径)" :value="tenantSum ? fint(tenantSum.tenantActive) + ' 户' : '—'"
        :note="contractSum ? `在租合同 ${fint(contractSum.contractActive)} 份` : undefined" />
      <!-- T1(design-boards 2026-09-11):三个新瓦,与主图共用同一份 fit(见 fit 计算属性头注) -->
      <AnaKpiTile label="月均增速" :value="fit ? sgn(fit.slope, 1, '万/月') : '—'"
        :note="fit ? '拟合优度 ' + fit.r2.toFixed(2) : undefined" />
      <!-- 前后对照瓦(故意留着):护栏修复前的口径,12 月冲回无条件计入年度收入 -->
    </template>

    <div v-if="!ready || pnlLoading" class="page-loading"><span class="page-spin" /></div>
    <!-- §五策略3:所选年无损益附表 → 主区整体空态(主数据类 KPI 保留于上方,禁止沿用旧年图表) -->
    <AnaEmpty v-else-if="pnlEmpty" :label="year + ' 年损益附表未录入'"
      hint="驾驶舱主区依赖损益附表 1~5;切换年份或先录入该年数据(在租租户等主数据 KPI 不受影响)"
      to="/rent-pnl" to-text="去录入损益附表" />
    <template v-else>
      <!-- §五策略2:所选月无损益 → KPI/构成环锚定最近覆盖月,顶部横幅显式(禁静默) -->
      <AnaPeriodBanner v-if="pnlUsedYm && period.ym.value" :selected="period.ym.value" :used="pnlUsedYm"
        source="损益" style="margin-bottom: 12px" />
      <!-- 收缴率取期回退同样横幅显式(复审:原仅 KPI 小字披露,与其他屏不一致) -->
      <AnaPeriodBanner v-if="cp && period.ym.value && cp.ym !== period.ym.value" :selected="period.ym.value" :used="cp.ym"
        source="台账" style="margin-bottom: 12px" />
      <!-- §A 经营结论条(spec 2026-07-11):数据模板分句,缺数据省句;句前圆点按 tone,异常句可点击深链;av2-lead=S 档排最前(结论先行) -->
      <div v-if="conclusion.length" class="av2-card cv2-concl av2-lead">
        <template v-for="(c, i) in conclusion" :key="i">
          <button v-if="c.link" class="cv2-cs lk" @click="go(c.link)">
            <span class="dot" :style="{ background: STATUS[c.tone].color }"></span>{{ c.text }}
          </button>
          <span v-else class="cv2-cs">
            <span class="dot" :style="{ background: STATUS[c.tone].color }"></span>{{ c.text }}
          </span>
        </template>
      </div>
      <div class="av2-grid">
      <!-- 主图 s8:收入柱+利润线 -->
      <div class="av2-card av2-s8">
        <div class="av2-card-h">
          <!-- F3(修复轮1):图标题按稿改「月度收入 · 预测护栏」——年份已在顶部期间选择器与下方 hint 里,标题不必重复 -->
          <span class="t">月度收入 · 预测护栏</span>
          <span class="hint">覆盖 {{ mc?.covered ?? 0 }} 期(万元)<span class="hint-desk">· 点击月柱切换期间 · 拖选缩放</span> · 紫虚线=预算月均</span>
        </div>
        <!-- 未闭月护栏(FORECAST §2.7):该年含离群月(收入<0)时提示,不写「已闭月」 -->
        <AnaPeriodBanner v-if="outlierBannerText" :selected="outlierYm" :used="pnlRange" style="margin-bottom: 8px">{{ outlierBannerText }}</AnaPeriodBanner>
        <AnaEChart v-if="mainOption" :option="mainOption" :height="300" @chart-click="onMainClick" />
        <AnaEmpty v-else :label="year + ' 年无损益附表数据'" hint="收入/利润来自损益附表 1~5 园区总计带" to="/rent-pnl" to-text="去录入损益附表" />
        <!-- T2(design-boards 2026-09-11):读数句+参照系小字,纯函数返回值见 outlierReadout/outlierRefText -->
        <p v-if="outlierRead" class="ana-read">{{ outlierRead }}</p>
        <p v-if="outlierRef" class="ana-ref">{{ outlierRef }}</p>
        <!-- F1(修复轮1,design-boards):稿上 ⓘ 门后那句反过度承诺的判据说明,改前屏上没有、仓库里 grep 不到 ——
             这条带存在的理由(抓离群,不押未来)只写在稿里,没人看得到。
             F6(对抗复查):板上原句把月份(m12)/附表(s1)写死了,改成由 mc.outlierMonths 驱动,见 cockpit.logic.ts mainChartOutlierNote。 -->
      </div>

      <!-- s4:收入构成环 -->
      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">收入构成 · {{ isMonth ? '本月' : '本年' }}</span>
          <span class="hint">合计 {{ money(compoTotal || null) }}<span class="hint-desk"> · 点击扇区看趋势</span></span>
        </div>
        <AnaEChart v-if="compo.length" :option="donutOption" :height="300" @chart-click="onDonutClick" />
        <AnaEmpty v-else label="当期无收入构成数据" hint="构成来自损益附表 1~4 各板块收入" to="/rent-pnl" to-text="去录入损益附表" />
      </div>


      <!-- 2026-09-12(用户):收入趋势 · 下月预测 —— 从主图拆出来的独立图。主图是 0 起的柱图,
           三条线挤在柱顶那一小段里看不出斜率;这张图没有柱子,轴不从 0 起,离群月留断口。 -->
      <div v-if="rollRows" class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">收入趋势 · 下月预测</span>
          <span class="hint">逐月预测带 · 每月的带只用它之前的月算</span>
        </div>
        <AnaForecastChart :rows="rollRows" :height="280" :prev-state="prevState" />
        <!-- 下月预测的读数句与参照系小字:参照系里带着这套算法过去的实测命中,与读数句同屏(D1)。 -->
        <template v-if="forecastRead">
          <p class="ana-read">{{ forecastRead }}</p>
          <p class="ana-ref">{{ forecastRef }}</p>
        </template>
        <!-- 没有下月可预测时说清楚为什么,不留一张光秃秃的图让人以为功能坏了。 -->
        <p v-else class="ana-ref">本年 12 个月已录满，没有下月可预测</p>
      </div>

      <!-- 第二排 s4×3 -->
      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">分期收入堆叠</span>
          <span class="hint">附表10 覆盖 {{ ps?.months.length ?? 0 }} 期<span class="hint-desk"> · 点击深链附表10</span></span>
        </div>
        <AnaEChart v-if="phaseOption" :option="phaseOption" :height="250" @chart-click="onPhaseClick" />
        <AnaEmpty v-else label="附表10 无计费数据" hint="分期收入来自附表10 租户×月计费" to="/sales-income" to-text="去录入附表10" />
      </div>

      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">收缴率 vs 目标</span>
          <span class="hint">{{ year }}年近 6 期(台账共 {{ collects.length }} 期,趋势见 KPI)<span class="hint-desk">· 点击看欠费清单</span></span>
        </div>
        <AnaEChart v-if="collectOption" :option="collectOption" :height="250" @chart-click="onCollectClick" />
        <AnaEmpty v-else label="台账数据未录入" hint="收缴率 = 台账 Σ实收 / Σ应收" to="/ledger" to-text="去台账录入" />
      </div>

      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">异常速览</span>
          <span class="hint">规则引擎跑真数据<span class="hint-desk"> · 点击查看</span></span>
        </div>
        <div v-if="anomTop.length" class="cv2-anoms">
          <button v-for="a in anomTop" :key="a.id" class="cv2-anom" @click="goAnom(a)">
            <span class="dot" :style="{ background: STATUS[a.sev].color }"></span>
            <span class="tt">{{ a.title }}</span>
            <span class="vv" :style="{ color: STATUS[a.sev].color }">{{ a.value }}</span>
          </button>
          <button class="cv2-all" @click="go('/anomaly')">进入监控中心 · 全部 {{ anomalies.length }} 条 →</button>
        </div>
        <AnaEmpty v-else label="当前规则下暂无异常" hint="收缴率/能耗环比/收入中断/负值行 四规则均未触发" />
      </div>

      <!-- T3:这条带过去准不准——滚动起点回测,每站只用当时已有的月,不复用 T1 的单次 fit;
           六列数据比四行三列的邻卡宽得多,独占一整行不挤 -->
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">这条带过去准不准</span>
          <span class="hint">滚动起点回测：每次只用当时已有的月，预测下一个月</span>
        </div>
        <table v-if="backRows" class="ak-tbl">
          <thead><tr><th>站在哪个月末</th><th>下月预测</th><th>区间</th><th>实际</th><th>中没中</th></tr></thead>
          <tbody>
            <tr v-for="r in backRows" :key="r.vantageMonth">
              <td>{{ r.vantageMonth }}月末{{ r.isLast ? '（今天）' : '' }}</td>
              <td class="mono">{{ fint(r.predictMid) }}万</td>
              <td class="mono">{{ fint(r.lo) }}~{{ fint(r.hi) }}</td>
              <td class="mono">{{ r.actualWan != null ? fint(r.actualWan) + '万' : '—' }}</td>
              <td>
                <span v-if="r.hit == null" style="color: var(--text-muted)">待验</span>
                <span v-else-if="r.hit" :style="{ color: STATUS.good.color }">命中</span>
                <span v-else :style="{ color: STATUS.watch.color }">落空 {{ r.under ? '低估' : '高估' }} {{ r.missPct?.toFixed(1) }}%</span>
              </td>
            </tr>
          </tbody>
        </table>
        <AnaEmpty v-else label="回测需要拟合" hint="滚动起点回测依赖至少 3 个可用月才能起步" />
        <p v-if="backRead" class="ana-read">{{ backRead }}</p>
        <p v-if="backRead" class="ana-ref">{{ backRef }}</p>
      </div>

      <div class="av2-s12">
      </div>
      </div>
    </template>

    <!-- 弹层:板块 12 月趋势(构成环点扇区) -->
    <div v-if="segModal" class="cv2-mask" @click.self="segModal = null">
      <div class="cv2-modal">
        <div class="cv2-modal-h">
          <span class="t">{{ segModal.label }}收入 · {{ year }}年 12 月趋势</span>
          <button class="x" @click="segModal = null"><component :is="iconFor('x')" :size="15" /></button>
        </div>
        <AnaEChart v-if="segTrendOption" :option="segTrendOption" :height="250" />
        <AnaEmpty v-else :label="year + ' 年该板块无月度数据'" />
      </div>
    </div>

    <!-- 弹层:欠费清单(收缴率条点击) -->
    <div v-if="arrModal" class="cv2-mask" @click.self="arrModal = null">
      <div class="cv2-modal">
        <div class="cv2-modal-h">
          <span class="t">欠费清单 · {{ arrModal }}(应收−实收 &gt; 0)</span>
          <button class="x" @click="arrModal = null"><component :is="iconFor('x')" :size="15" /></button>
        </div>
        <table v-if="arrears?.rows.length" class="ak-tbl">
          <thead><tr><th>租户</th><th>公司</th><th>应收</th><th>实收</th><th>欠费</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in arrears.rows.slice(0, 15)" :key="r.name">
              <td>{{ r.name }}</td>
              <td class="mut" style="text-align: left">{{ r.company }}</td>
              <td class="mono">¥{{ fint(r.recv) }}</td>
              <td class="mono">¥{{ fint(r.coll) }}</td>
              <td class="mono" style="color: var(--hue-red)">¥{{ fint(r.arr) }}</td>
              <td><button class="cv2-link" @click="goLedger(r.name, r.company, arrModal!)">查台账 →</button></td>
            </tr>
          </tbody>
        </table>
        <AnaEmpty v-else label="该期无欠费租户" />
        <p v-if="arrears?.rows.length" class="cv2-arr-sum">
          共 {{ arrears.rows.length }} 户欠费 · 合计 <b>¥{{ fint(arrears.total) }}</b>{{ arrears.rows.length > 15 ? ' · 仅列前 15 户' : '' }}
        </p>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 工具条屏名(order:-1 置于期间控件前,不改 AnaShell) */
.cv2-name { order: -1; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
/* §A 经营结论条(av2-card 观感,单行 flex wrap;位于回退横幅后、grid 前) */
.cv2-concl { display: flex; flex-wrap: wrap; align-items: center; column-gap: 20px; row-gap: 6px; margin-bottom: 12px; }
.cv2-cs { display: inline-flex; align-items: center; gap: 7px; border: none; background: transparent; padding: 0; font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-primary); }
.cv2-cs .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.cv2-cs.lk { cursor: pointer; }
.cv2-cs.lk:hover { text-decoration: underline; }
/* 异常速览紧凑行 */
.cv2-anoms { display: flex; flex-direction: column; gap: 6px; }
.cv2-anom { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: var(--surface-card); border-radius: 8px; padding: 9px 10px; cursor: pointer; font-family: var(--font-sans); text-align: left; }
.cv2-anom:hover { background: var(--bg-hover); }
.cv2-anom .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.cv2-anom .tt { flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv2-anom .vv { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-semibold); font-family: var(--font-mono); }
.cv2-all { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); padding: 4px 0 0; text-align: center; }
.cv2-all:hover { text-decoration: underline; }
/* 弹层 */
/* 全屏模态遮罩 → --z-modal(300)。原写 60 落在 popover 档(那档是给贴附浮层的),会被任何抽屉盖住 */
.cv2-mask { position: fixed; inset: 0; z-index: var(--z-modal); background: rgba(28, 28, 28, 0.35); display: grid; place-items: center; }
.cv2-modal { background: var(--surface-white); border-radius: 14px; box-shadow: 0 12px 40px rgba(28, 28, 28, 0.22); padding: 16px 18px; width: min(620px, 92vw); max-height: 80vh; overflow: auto; }
.cv2-modal-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.cv2-modal-h .t { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.cv2-modal-h .x { border: none; background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; padding: 4px; border-radius: 6px; }
.cv2-modal-h .x:hover { background: var(--bg-hover); color: var(--text-primary); }
.cv2-link { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); }
.cv2-link:hover { text-decoration: underline; }
.cv2-arr-sum { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }
</style>
