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
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaForecastChart from '@/components/ana/AnaForecastChart.vue'
import { rollingForecastRows, prevYearUsable } from './forecastChart.logic'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import { isSViewport } from '@/components/ana/anaChartHeight'
import { iconFor } from '@/components/ds/icon'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import { STATUS, fint, fnum, hues, inkA, sgn } from '@/components/ana/anaFmt'
import { anaPalette } from '@/components/ana/anaTheme'
import { usePeriod, ymOf } from '@/analysis/usePeriod'
import { anaSettings } from '@/analysis/anaSettings'
import { useCompare } from '@/analysis/useCompare'
import {
  buildAnomalies, fetchAnomalyInputs, fetchBudgetAll, fetchCollectRates, fetchContractSummary,
  fetchLedgerRows, fetchPnlSummary, fetchS10PhaseMonthly, fetchTenantSummary,
  type AnaAnomaly, type AnomalyInputs, type CollectRate, type PnlSummary, type S10PhaseMonthly,
} from '@/analysis/anaData'
import {
  achLabelText, achNoteText, anchorMonth, arrearsOf, atPnlPeriod, backtestReadout, backtestRefText, backtestRows, backtestSummary, budgetAch, budgetRevenueOf, buildConclusion, colPick, compoData, fitBandAt, fitRevenueTrend, nextMonthForecast, nextForecastReadout, nextForecastRefText, mainChart, mainChartOption, mainChartOutlierNote, momOf, monthRangeLabel, outlierReadout, outlierRefText, outlierResidual, outlierResidualsByMonth, phaseStack, phaseStackLast, pnlYearMonths, revNoteText, schedTrend,
} from './cockpit.logic'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'
import type { TenantSummaryDTO } from '@/types/tenant'
import type { ContractSummaryDTO } from '@/types/contract'

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const cmp = useCompare(['mom', 'budget'])   // 屏声明支持集(AnaShell 同集渲染开关)

// ── 手机档(分析屏手机体验稿 ④ 经营驾驶舱,2026-09-20) ──
// 判据借 AnaEChart / AnaSkelChart 那一张(anaChartHeight.isSViewport,挂载时 matchMedia 判一次、
// 不跟随 resize)。这里要的是「渲染哪一支」,不是几何像素 —— 用视口档而不是容器宽,是为了与
// ana.css 的 @media(max-width:600) 同一个断点:JS 支与 CSS 支永远同档,不会一个认一个不认;
// 也因此零响应式重排,首帧即终态(LAYOUT-STABILITY §1)。自绘图那批按容器宽判的是画布几何,不是这里。
// isS 为 false 时下面每一处 v-if 都不渲染、每一条 CSS 都在 @media 内 —— >600 逐字零差异。
const isS = isSViewport()
const kpiMore = ref(false)    // 稿 ②:手机上 KPI 常显 6 枚,第 7 枚(月均增速)折在「更多指标 1 枚」后面
const foldOpen = ref(false)   // 稿 ⑨⑩⑪:预测带 / 分期堆叠 / 回测表 折在「更多分析」后面
// 折起来的块一律写成 `v-if="!isS || 展开"`(不是 display:none):
//  ① `!isS ||` 这一半让桌面永远渲染,零差异不依赖任何一条 CSS;
//  ② display:none 的容器宽高是 0,里面的 AnaEChart / 自绘图会按 0 宽初始化,展开那一下是张空图。
//     不渲染就没有这个问题,展开时是全新挂载,宽度一次量准。

// ── 取数(period 无关项拉一次;pnl 随年切换;全走 anaData 缓存) ──
const pnl = ref<PnlSummary | null>(null)
// 上一年:只给逐月预测带用(把去年尾月接到横轴左边,今年 1 月才有三个在前的点)。
// 取不到就是 null —— 老园区第一年没有上一年很正常,不能因此让整屏出错。
// 按年份记(键 = 那份数据自己的年):换年时 pnl 与上一年分两趟落地,配对只能看年份,不能看「最近到的那份」。
const prevByYear = ref<Record<number, PnlSummary | null>>({})
const prevLoading = ref(false)   // 上一年那一趟单独的在途标志(动效稿 C5-12,只点亮进度线)
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
  // prevLoading 只喂工具条那条进度线(动效稿 C5-12):当前数据是真的、可读可点,只缺预测带的早几个月,
  // 不给任何内容挂 .fp-stale;到数那一帧带与 gapNote 瞬现。
  prevLoading.value = true
  fetchPnlSummary(y - 1)
    .then((v) => { prevByYear.value[y - 1] = v })   // 不看 token:哪一年的数就记在哪一年下,过期也配不错
    .catch(() => { prevByYear.value[y - 1] = null })
    .finally(() => { if (t === token) prevLoading.value = false })
}, { immediate: true })
// 追加拉取 + 换年重取共用一条线:过 200ms 门才亮、到数立刻灭(useDeferredFlag)。
const busy = useDeferredFlag(computed(() => pnlLoading.value || prevLoading.value))
// 退让只认换年那一路(C5-02 ③):prevLoading 是追加拉取,当前数据是真的,只点亮进度线不退让(C5-12)。
const staleShown = useDeferredFlag(pnlLoading)

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
const money = (v: number | null): string => (v == null ? '—' : (v < 0 ? '−¥' : '¥') + fnum(Math.abs(v) / 10000) + '万')

// 已画那一期(C5-02):换年在途 pnl 还是旧年,选择已是新年新月 —— 拿新月去对旧年的覆盖月,
// 横幅会凭空插进来(文案还是假的),数据到了再拔掉,整片 grid 被推下又弹回。
// 同年换月 / 换粒度不打接口,直接跟选择;跨年在途冻结在 pnl 那一年最后被选中的那一期,与数据同一拍换。
const drawnSel = ref(period.sel.value)
watch([pnl, period.sel], ([p, s]) => { if (!p || p.year === s.year) drawnSel.value = s }, { immediate: true })
const drawnMi = computed(() => drawnSel.value.month - 1)
// §五策略2 月锚:所选月无损益 → KPI/构成环锚定最近覆盖月 + 顶部横幅显式(取值公式不变)
const usedMi = computed(() => (isMonth.value ? anchorMonth(pnl.value?.months ?? [], drawnMi.value + 1) - 1 : drawnMi.value))
const pnlUsedYm = computed(() => (isMonth.value && usedMi.value !== drawnMi.value ? ymOf(drawnSel.value.year, usedMi.value + 1) : null))
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
const revNote = computed(() => revNoteText(isMonth.value, yearMonths.value, pnlRange.value))

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
  return m ? `${drawnSel.value.year}-${String(m).padStart(2, '0')} 收入为负,已计入年度营收/成本/利润与达成率` : ''
})
// AnaPeriodBanner selected/used 必填(五个既有屏共享该契约);插槽覆盖了文案,这两个值不上屏,
// 但仍按实际的离群月/达成率覆盖区间传——都是上面已算出来的值。
const outlierYm = computed(() => {
  const m = mc.value?.outlierMonths[0]
  return m ? ymOf(drawnSel.value.year, m) : ''
})
// 未闭月护栏(FORECAST §2.7):y 轴量程(d.yMin)由 mainChart 用 usableMonths 算好,这里只消费;
// 离群月本身仍画(数据点/tooltip 值不变),bar 标红 + markPoint 钉在柱头,readable 为「带外」。
// F1(对抗复查):option 本体(趋势线/拟合区间/离群标注三块交付物)抽成 cockpit.logic.ts 的纯函数
// mainChartOption——原先整段写在这个 computed 里,没有挂载测/纯函数覆盖,删掉/清空照样全绿。
const mainOption = computed<object | null>(() =>
  mainChartOption(mc.value, outlierResByMonth.value, cmp.mode.value))
// 2026-09-12(用户):趋势/拟合区间/已录入折线从主图拆出来自成一张,轴不从 0 起——
// 理由见 forecastChart.logic.ts 头注(ECharts 在类目轴上画不准这种「一个月一段区间」)。
// 自绘图的数据:逐月预测带(每个月的带只用它之前的月算),见 forecastChart.logic.ts。
// 上一年一起拉:它的尾月接到横轴左边,今年 1 月才有三个在前的点(用户 2026-09-12 提的跨年机制)。
// 接不接由 prevYearUsable 判 —— 附表口径不同就不接,理由见该函数头注。
// 两趟分开落地(且都走模块级缓存):往前退一年时 pnl 可能先于它的上一年到,往后进一年时上一年先到
// 而 pnl 还是旧年 —— 拿「最近到的那份」配就是「自己拼自己」,带先形变到一份假历史上。按 pnl 的年份取。
const prevOk = computed(() => (pnl.value ? prevByYear.value[pnl.value.year - 1] ?? null : null))
const rollRows = computed(() => rollingForecastRows(pnl.value, prevOk.value))
const prevState = computed<'none' | 'mismatch' | 'spliced'>(() =>
  prevYearUsable(pnl.value, prevOk.value) ? 'spliced' : (prevOk.value?.months.length ? 'mismatch' : 'none'))
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
// 常驻读数句要的占比:compo 已按 value 降序且滤掉 ≤0,[0] 就是最大那块;
// 这个百分数下面 donutOption 的图例 formatter 已经在算(pct),这里不是新指标。
const compoTopPct = computed(() => (compoTotal.value > 0 ? ((compo.value[0].value / compoTotal.value) * 100).toFixed(1) : '0.0'))
// 名义分类(租金/用电/用水/运管)须异色:主题色板前 4 位是蓝族渐变(给「分期收入堆叠」这类有序量用的),
// 4 扇区环恰好取满前 4 位 → 全蓝难辨。此处局部指定 4 个可区分色相,不动全局主题。
const donutColors = computed<string[]>(() => {
  const { blue, teal, amber, coral } = hues()
  return [blue, teal, amber, coral]
})
// 稿 ⑥「图例行补上金额」:手机上把 ECharts 图例换成 DOM 行,一行 = 色块 + 板块名 + 占比 + 金额。
// 两个数都不是新指标 —— 占比就是下面 donutOption 图例 formatter 在算的 pct,金额就是 series.data
// 里那个 value(万);桌面靠图例读占比、悬停读金额,手机没有悬停,于是把同两个数直接印成行。
// S 档 ECharts 图例被 mobilizeOption 改成 type:'scroll',5 行会被压成一条横向滚动条 —— 换成 DOM 行
// 不是「加一份图例」,是把那条滚不动的图例换掉。
const compoRows = computed(() => compo.value.map((d, i) => ({
  key: d.key,
  label: d.label,
  color: donutColors.value[i % donutColors.value.length],
  pct: compoTotal.value > 0 ? ((d.value / compoTotal.value) * 100).toFixed(1) : '0.0',
  wan: fnum(d.value / 10000),
})))
const donutOption = computed<object>(() => {
  const total = compoTotal.value
  const pct = (v: number): string => (total > 0 ? ((v / total) * 100).toFixed(1) : '0.0')
  const byLabel = new Map(compo.value.map((d) => [d.label, d.value]))
  return {
    color: donutColors.value,
    tooltip: { trigger: 'item', valueFormatter: (v: number) => fnum(v) + '万' },
    // 图例带占比:静态也能读出各板块比重,不必悬停(扇区上不加标签,避免细扇区如「用水」标签重叠)
    // S 档图例交给上面的 DOM 行(compoRows),这里收起;环心同步回 50%,不然底下空一条图例带的位。
    legend: { show: !isS, bottom: 0, formatter: (name: string) => `${name} ${pct(byLabel.get(name) ?? 0)}%` },
    series: [{
      type: 'pie', radius: ['50%', '74%'], center: ['50%', isS ? '50%' : '42%'],
      label: { show: false }, itemStyle: { borderRadius: 6, borderColor: anaPalette().calloutCore, borderWidth: 2 },   // 缝 = 卡片色
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
// 最新一期的堆叠合计 + 最厚那一段占比(常驻读数句;手机上这张图一个数都读不到——
// x 轴只印「N月」、y 轴只印刻度,每段的值只活在 tooltip 里)。
const psLast = computed(() => phaseStackLast(ps.value))
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
// 只显近 6 期(2026-07-20 用户反馈:全年 10+ 期横条在小卡里过度拥挤)
// 先按所选年过滤再取近6期(2026-07-21 用户反馈:此前全局切片,台账跨年时选2025却混入2024期)
const collShown = computed(() => collects.value.filter((c) => c.ym.startsWith(year.value + '-')).slice(-6))
/** 收缴率读数句点名的那一期 = **这张图自己的最后一根柱**。
 *  ⚠ 不能用 KPI 瓦那个 cp:年档下 colPick 返回的 ym 是标签串(「1-10月」「6期」,cockpit.logic.ts),
 *  取第 5 位起的子串是空串、转成数字就是 0,屏上会印出不存在的「0月」。
 *  取 collShown 的最后一项还顺带让 n=collShown.length 真的成为这句的分母。 */
const cpBar = computed(() => collShown.value.at(-1) ?? null)
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
      data: collShown.value.map((c) => ({ value: +c.rate.toFixed(1), itemStyle: { color: c.rate >= target ? hues().blue : hues().amber, borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', fontSize: 11, formatter: '{c}%' },
      markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: inkA(.45) }, label: { position: 'insideEndTop', formatter: `目标 ${target}%`, fontSize: 11 }, data: [{ xAxis: target }] },
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
  <AnaShell :compare="['mom', 'budget']" period-mode="full" :busy="busy">
    <template #tools>
      <span class="cv2-name"><component :is="iconFor('gauge')" :size="15" />经营驾驶舱</span>
    </template>

    <!-- KPI 条(spec:营收/成本/利润率/收缴率 vs 目标/预算达成/在租租户) -->
    <template #kpis>
      <!-- I4:年粒度三瓦与「预算达成」同批月份,覆盖区间印在 note 上(月粒度 pnlRange 为空,note 不出现) -->
      <!-- F3(修复轮1):年粒度标题/note 按稿改「N-M 月收入」/「N 期,已剔 M 月」(revNote,见上方计算属性头注) -->
      <AnaKpiTile :label="isMonth ? '营业收入' : pnlRange + '收入'" :value="money(rev)"
        :delta="momOf(pnl?.revenue, isMonth, usedMi)" kind="环比" :note="revNote" />
      <AnaKpiTile label="成本费用" :value="money(cost)" :delta="momOf(pnl?.cost, isMonth, usedMi)" kind="环比" invert :note="pnlRange || undefined" />
      <!-- 数值失真门(普查稿 §2.5):基数过小时利润率会被放大成失真的大百分比,上限守卫不印具体数 -->
      <AnaKpiTile label="园区利润" :value="money(prof)" profit
        :note="(margin != null ? (margin > 300 ? '利润率 — 基数过小' : '利润率 ' + margin.toFixed(1) + '%') : '当期无损益数据') + (pnlRange ? ' · ' + pnlRange : '')" />
      <!-- 副文案人话化(2026-07-20 用户反馈):delta=−15.5pt + kind=距目标96%,口径区间挪 note 行 -->
      <AnaKpiTile label="收缴率" :value="cp ? cp.rate.toFixed(1) + '%' : '—'"
        :delta="cp ? +(cp.rate - anaSettings.collectTarget).toFixed(1) : null"
        :kind="cp ? `距目标${anaSettings.collectTarget}%` : ''" unit="pt"
        :note="cp ? `${cp.ym}累计实收/应收` : '台账未录入'" />
      <!-- 未闭月护栏(FORECAST §2.7):分母排除离群月,副标题印 usedMonths 覆盖区间(不写「已闭月」) -->
      <!-- N2:达成率是年度口径,覆盖区间用 achNote(不借 pnlRange —— 那个在月粒度下是空的) -->
      <AnaKpiTile :label="achLabel" :value="ach ? ach.rate.toFixed(1) + '%' : '—'" :note="achNote" />
      <AnaKpiTile label="在租租户(计数口径)" :value="tenantSum ? fint(tenantSum.tenantActive) + ' 户' : '—'"
        :note="contractSum ? `在租合同 ${fint(contractSum.contractActive)} 份` : undefined" />
      <!-- T1(design-boards 2026-09-11):三个新瓦,与主图共用同一份 fit(见 fit 计算属性头注) -->
      <!-- 稿 ②:S 档两列 → 7 枚瓦要排 4 行,第 4 行只有一枚、右边空一格。第 7 枚折起来,常显 6 枚
           正好 3 行满。折谁按稿上画出来的那 6 枚反推 = 第 7 枚「月均增速」(稿旁的文字清单写的是
           「预算达成」,与它自己画的三台手机对不上 —— 三台上 88.2% 都在,不在的是月均增速)。 -->
      <AnaKpiTile v-if="!isS || kpiMore" label="月均增速" :value="fit ? sgn(fit.slope, 1, '万/月') : '—'"
        :note="fit ? '拟合优度 ' + fit.r2.toFixed(2) : undefined" />
      <button v-if="isS" type="button" class="cv2-kpi-more" :aria-expanded="kpiMore" @click="kpiMore = !kpiMore">
        <component :is="iconFor('chevron-down')" :size="15" :class="{ up: kpiMore }" />{{ kpiMore ? '收起' : '更多指标 1 枚' }}
      </button>
      <!-- 前后对照瓦(故意留着):护栏修复前的口径,12 月冲回无条件计入年度收入 -->
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。每块骨架的高 = 它顶替的那张图的 :height 字面值
         (主图 300 · 构成环 300 · 预测带 280 · 第二排三张 250),卡头 20 + .av2-card-h 的 8 下边距;
         KPI 行由 .anx-kpis 的 min-height 94 兜位。数据到了原地硬切,不做淡入、卡片不错峰。
         结论条与取期横幅按库里现有数据留位(见下一段注释)。
         主图 / 构成环 / 预测带 / 分期堆叠 四张卡的读数句是常驻的(.ana-read/.ana-ref 行盒 20 由 --lh-snug 定,与字号无关),
         骨架照 8+20 / 2+20 钉上,不钉的话数据到了下面整片下沉。
         **门只认首进**(!pnl):换年那一路旧年内容留在原地退让(C5-02),不许整片塌回骨架 —— 那是
         「一次交互两个动的东西」(§1.7):正文整片消失 + 工具条进度线。
         顶替 AnaEChart 的四块(主图 / 构成环 / 分期堆叠 / 收缴率)走 AnaSkelChart(≤600 与图同一张降档表);
         预测带是自绘 SVG(不降档)、异常速览是 DOM 列表,两块照旧写死。 -->
    <!-- 2026-09-16 起骨架照抄真版式:顶部台账取期横幅、结论条、各卡卡头与读数句、异常清单、回测表都按
         库里现有数据的样子留位(默认期 = 最近有损益的月,台账比它早一个月,所以横幅在;结论三句;
         回测六行;异常速览四条)—— 手机上这些字都会折行,灰条顶不住。随数据变的字换成同长的隐形占位。
         数据换了形状(台账补齐、回测变成七行)时,首进会差出那一段,届时照新数据改这里。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <template v-if="!ready || (pnlLoading && !pnl)">
      <AnaPeriodBanner class="ana-hole" selected="0000-00" used="0000-00" source="台账" style="margin-bottom: 12px" />
      <div class="av2-card cv2-concl av2-lead cv2-skel">
        <span class="cv2-cs ana-hole"><span class="dot"></span>0000年00月收入 ¥000万,园区利润 ¥000万(利润率 00.0%)</span>
        <span class="cv2-cs ana-hole"><span class="dot"></span>收缴率 00.0% 低于目标 00%,期末欠费 ¥0,000万</span>
        <button type="button" class="cv2-cs lk ana-hole" disabled><span class="dot"></span>000 条异常待处理</button>
      </div>
      <div class="av2-grid cv2-skel">
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">月度收入 · 预测护栏</span>
            <span class="hint">覆盖 <span class="ana-hole">00</span> 期(万元)<span class="hint-desk">· 点击月柱切换期间 · 拖选缩放</span><span class="hint-touch">· 点月柱切期间</span> · 紫虚线=预算月均</span>
          </div>
          <AnaPeriodBanner class="ana-hole" selected="0000-00" used="0000-00" style="margin-bottom: 8px">0000-00 收入为负,已计入年度营收/成本/利润与达成率</AnaPeriodBanner>
          <AnaSkelChart :height="300" />
          <p class="ana-read hold"><span class="ana-hole">00月收入 −00万，离0-00月的正常波动 0倍残差</span></p>
          <p class="ana-ref hold"><span class="ana-hole">参照0-00月拟合 · 残差000万</span></p>
        </div>
        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">收入构成 · {{ isMonth ? '本月' : '本年' }}</span>
            <span class="hint">合计 <span class="ana-hole">¥000.0万</span><span class="hint-desk"> · 点击扇区看趋势</span><span class="hint-touch"> · 点扇区看趋势</span></span>
          </div>
          <AnaSkelChart :height="300" />
          <p class="ana-read"><span class="ana-hole">租金 ¥000.0万,占 00.0%</span></p>
          <p class="ana-ref"><span class="ana-hole">0 个板块 · 损益附表1~4 · 万元</span></p>
        </div>
        <div class="av2-card av2-s12 cv2-fc" :class="{ 'cv2-hide-s': !foldOpen }">
          <div class="av2-card-h">
            <span class="t">收入趋势 · 下月预测</span>
            <span class="hint">逐月预测带 · 每月的带只用它之前的月算</span>
          </div>
          <!-- 预测带是自绘 SVG,不降档 -->
          <div class="fp-shim" style="height: 280px"></div>
          <p class="ana-ref"><span class="ana-hole">本年 12 个月已录满，没有下月可预测</span></p>
        </div>
        <div class="av2-card av2-s4 cv2-ph" :class="{ 'cv2-hide-s': !foldOpen }">
          <div class="av2-card-h">
            <span class="t">分期收入堆叠</span>
            <span class="hint">附表10 覆盖 <span class="ana-hole">0</span> 期<span class="hint-desk"> · 点击深链附表10</span><span class="hint-touch"> · 点图看附表10</span></span>
          </div>
          <AnaSkelChart :height="250" />
          <p class="ana-read"><span class="ana-hole">0月 合计 000万,一期占 00.0%</span></p>
          <p class="ana-ref"><span class="ana-hole">0 个期区 · 附表10 · 万元</span></p>
        </div>
        <div class="av2-card av2-s4 cv2-coll">
          <div class="av2-card-h">
            <span class="t">收缴率 vs 目标</span>
            <span class="hint">{{ year }}年近 6 期(台账共 <span class="ana-hole">00</span> 期)<span class="hint-desk">· 点击看欠费清单</span><span class="hint-touch">· 点柱看欠费清单</span></span>
          </div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"><span class="ana-hole">0月 收缴 00.0%,对目标 −00.0pt</span></p>
          <p class="ana-ref hold"><span class="ana-hole">n=0 期 · 台账 Σ实收 / Σ应收</span></p>
        </div>
        <div class="av2-card av2-s4 cv2-anoc">
          <div class="av2-card-h">
            <span class="t">异常速览</span>
            <span class="hint">规则引擎跑真数据<span class="hint-desk"> · 点击查看</span><span class="hint-touch"> · 点条看详情</span></span>
          </div>
          <div class="cv2-anoms">
            <button v-for="i in 4" :key="i" type="button" class="cv2-anom ana-hole" disabled>
              <span class="dot"></span><span class="tt">占位</span><span class="vv">00%</span>
            </button>
            <button type="button" class="cv2-all ana-hole" disabled>进入监控中心 · 全部 000 条 →</button>
          </div>
        </div>
        <!-- 折叠条照真版式留位(手机档);桌面不渲染,与真版式同一支判据 -->
        <div v-if="isS" class="cv2-fold av2-s12" aria-hidden="true">
          <component :is="iconFor('chevron-down')" :size="15" />
          <b>更多分析</b>
          <span class="s">收入趋势·下月预测 · 分期收入堆叠 · 这条带过去准不准 · 欠费清单</span>
          <span class="n">4 块</span>
        </div>
        <div class="av2-card av2-s12 cv2-bt" :class="{ 'cv2-hide-s': !foldOpen }">
          <div class="av2-card-h">
            <span class="t">这条带过去准不准</span>
            <span class="hint">滚动起点回测：每次只用当时已有的月，预测下一个月</span>
          </div>
          <!-- 表块 258 = 表头 30 + 6 行 × 38(手机档这张卡默认折着,展开后是行卡不是表,
               两档不同高 —— 但它在折叠线之下,首进时不占位,骨架只需顶住桌面那一档) -->
          <div class="fp-shim" style="height: 258px"></div>
          <p class="ana-read"><span class="ana-hole">这条带按80%画的，0次里只中了0次，落空的0次全是有高有低</span></p>
          <p class="ana-ref"><span class="ana-hole">参照0-00月末起点·样本0次</span></p>
        </div>
        <div class="av2-s12"></div>
      </div>
    </template>
    <!-- skel:end -->
    <!-- §五策略3:所选年无损益附表 → 主区整体空态(主数据类 KPI 保留于上方,禁止沿用旧年图表) -->
    <AnaEmpty v-else-if="pnlEmpty" :label="year + ' 年损益附表未录入'"
      hint="驾驶舱主区依赖损益附表 1~5;切换年份或先录入该年数据(在租租户等主数据 KPI 不受影响)"
      to="/rent-pnl" to-text="去录入损益附表" />
    <template v-else>
      <!-- §五策略2:所选月无损益 → KPI/构成环锚定最近覆盖月,顶部横幅显式(禁静默) -->
      <AnaPeriodBanner v-if="pnlUsedYm" :selected="ymOf(drawnSel.year, drawnSel.month)" :used="pnlUsedYm"
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
      <!-- 换年在途:旧年内容留在原地退让,进度线在 sticky 工具条上(C5-02 ③④)。
           data-stale-host 常挂 —— 类摘掉后仍有 transition-property,退场才是 200,不挂就是硬切。 -->
      <div class="av2-grid" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <!-- 主图 s8:收入柱+利润线 -->
      <div class="av2-card av2-s8">
        <div class="av2-card-h">
          <!-- F3(修复轮1):图标题按稿改「月度收入 · 预测护栏」——年份已在顶部期间选择器与下方 hint 里,标题不必重复 -->
          <span class="t">月度收入 · 预测护栏</span>
          <span class="hint">覆盖 {{ mc?.covered ?? 0 }} 期(万元)<span class="hint-desk">· 点击月柱切换期间 · 拖选缩放</span><span class="hint-touch">· 点月柱切期间</span> · 紫虚线=预算月均</span>
        </div>
        <!-- 未闭月护栏(FORECAST §2.7):该年含离群月(收入<0)时提示,不写「已闭月」 -->
        <AnaPeriodBanner v-if="outlierBannerText" :selected="outlierYm" :used="pnlRange" style="margin-bottom: 8px">{{ outlierBannerText }}</AnaPeriodBanner>
        <AnaEChart v-if="mainOption" :option="mainOption" :height="300" @chart-click="onMainClick" />
        <AnaEmpty v-else :label="year + ' 年无损益附表数据'" hint="收入/利润来自损益附表 1~5 园区总计带" to="/rent-pnl" to-text="去录入损益附表" />
        <!-- T2(design-boards 2026-09-11):读数句+参照系小字,纯函数返回值见 outlierReadout/outlierRefText -->
        <p class="ana-read hold"><template v-if="outlierRead">{{ outlierRead }}</template></p>
        <p class="ana-ref hold"><template v-if="outlierRef">{{ outlierRef }}</template></p>
        <!-- F1(修复轮1,design-boards):稿上 ⓘ 门后那句反过度承诺的判据说明,改前屏上没有、仓库里 grep 不到 ——
             这条带存在的理由(抓离群,不押未来)只写在稿里,没人看得到。
             F6(对抗复查):板上原句把月份(m12)/附表(s1)写死了,改成由 mc.outlierMonths 驱动,见 cockpit.logic.ts mainChartOutlierNote。 -->
      </div>

      <!-- s4:收入构成环 -->
      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">收入构成 · {{ isMonth ? '本月' : '本年' }}</span>
          <span class="hint">合计 {{ money(compoTotal || null) }}<span class="hint-desk"> · 点击扇区看趋势</span><span class="hint-touch"> · 点扇区看趋势</span></span>
        </div>
        <AnaEChart v-if="compo.length" :option="donutOption" :height="300" @chart-click="onDonutClick" />
        <AnaEmpty v-else label="当期无收入构成数据" hint="构成来自损益附表 1~4 各板块收入" to="/rent-pnl" to-text="去录入损益附表" />
        <!-- 稿 ⑥:手机图例行(见 compoRows 头注)。行数 = 板块数,与环上的扇区一一对应,不截断。 -->
        <ul v-if="isS && compoRows.length" class="cv2-leg">
          <li v-for="r in compoRows" :key="r.key">
            <i :style="{ background: r.color }"></i><span class="nm">{{ r.label }}</span>
            <b>{{ r.pct }}%</b><span class="wan">{{ r.wan }}万</span>
          </li>
        </ul>
        <!-- 常驻读数句:悬停才看得见的只有各扇区的金额(tooltip),占比在图例里、合计在卡头 hint 里,
             所以这句写「最大那块的金额 + 占比」,补上唯一缺的那个数。 -->
        <p class="ana-read hold"><template v-if="compo.length">{{ compo[0].label }} {{ money(compo[0].value) }},占 {{ compoTopPct }}%</template></p>
        <p class="ana-ref hold"><template v-if="compo.length">{{ compo.length }} 个板块 · 损益附表1~4 · 万元</template></p>
      </div>


      <!-- 2026-09-12(用户):收入趋势 · 下月预测 —— 从主图拆出来的独立图。主图是 0 起的柱图,
           三条线挤在柱顶那一小段里看不出斜率;这张图没有柱子,轴不从 0 起,离群月留断口。 -->
      <div v-if="rollRows && (!isS || foldOpen)" class="av2-card av2-s12 cv2-fc">
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
        <!-- hold:这一支本来就不会塌(两支都出字,v-else 这支还是个定长句)——加 hold 只是把
             「条件出句的读数句一律占位」这条规矩钉在这行上,视觉零差异(句子自己就够 1lh)。 -->
        <p v-else class="ana-ref hold">本年 12 个月已录满，没有下月可预测</p>
      </div>

      <!-- 第二排 s4×3 -->
      <div v-if="!isS || foldOpen" class="av2-card av2-s4 cv2-ph">
        <div class="av2-card-h">
          <span class="t">分期收入堆叠</span>
          <span class="hint">附表10 覆盖 {{ ps?.months.length ?? 0 }} 个月<span class="hint-desk"> · 点击深链附表10</span><span class="hint-touch"> · 点图看附表10</span></span>
        </div>
        <AnaEChart v-if="phaseOption" :option="phaseOption" :height="250" @chart-click="onPhaseClick" />
        <AnaEmpty v-else label="附表10 无计费数据" hint="分期收入来自附表10 租户×月计费" to="/sales-income" to-text="去录入附表10" />
        <!-- 常驻读数句:最新一期的柱子有多高、哪一段最厚(两个数都只对已画出的那一列求和/取最大)。
             hold:图画得出来而 phaseStackLast 返回 null(最后一列 total<=0)是真会发生的,而骨架那两行
             是无条件画的 —— 不占位就会在数据到的那一帧反向塌 50px。 -->
        <p class="ana-read hold"><template v-if="psLast">{{ psLast.m }}月 合计 {{ fint(psLast.total) }}万,{{ psLast.name }}占 {{ psLast.pct.toFixed(1) }}%</template></p>
        <p class="ana-ref hold"><template v-if="psLast">{{ ps?.series.length }} 个期区 · 附表10 · 万元</template></p>
      </div>

      <div class="av2-card av2-s4 cv2-coll">
        <div class="av2-card-h">
          <span class="t">收缴率 vs 目标</span>
          <span class="hint">{{ year }}年近 6 期(台账共 {{ collects.length }} 期)<span class="hint-desk">· 点击看欠费清单</span><span class="hint-touch">· 点柱看欠费清单</span></span>
        </div>
        <AnaEChart v-if="collectOption" :option="collectOption" :height="250" @chart-click="onCollectClick" />
        <AnaEmpty v-else label="台账数据未录入" hint="收缴率 = 台账 Σ实收 / Σ应收" to="/ledger" to-text="去台账录入" />
        <!-- 稿 ⑦ 画了这两行(卡内 .readrow + .ana-ref)。两个数都是上面 KPI「收缴率」瓦在用的那一个
             (cpBar 取的是 collShown 的最后一项 —— 这张图最后一根柱),n 是这张图切出来的近 6 期,都不是新算的。
             差额用 sgn 带符号印,不写「距目标差 N」—— 收缴率高过目标时那句话是反的。
             hold:cpBar 为 null(台账未录入)时两句同时闭嘴,而骨架那两行是无条件画的。 -->
        <p class="ana-read hold"><template v-if="cpBar">{{ +cpBar.ym.slice(5) }}月 收缴 {{ cpBar.rate.toFixed(1) }}%,对目标 {{ sgn(cpBar.rate - anaSettings.collectTarget, 1, 'pt') }}</template></p>
        <p class="ana-ref hold"><template v-if="cpBar">n={{ collShown.length }} 期 · 台账 Σ实收 / Σ应收</template></p>
      </div>

      <div class="av2-card av2-s4 cv2-anoc">
        <div class="av2-card-h">
          <span class="t">异常速览</span>
          <span class="hint">规则引擎跑真数据<span class="hint-desk"> · 点击查看</span><span class="hint-touch"> · 点条看详情</span></span>
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

      <!-- 稿 ⑨⑩⑪ 的折叠线:画在异常速览之后(不是「第 4 块之后」)。上面四块回答「这个月怎么样 /
           钱从哪来 / 收没收上来 / 有什么不对」,折进去的三块回答「下个月大概多少」「三期怎么拆」
           「这条带过去准不准」—— 后三问是坐下来才问的。摘要串与件数照稿上写的那条抄
           (稿把「欠费清单」也算进这条摘要,虽然它是点收缴率柱出来的整屏件、不是一张卡)。
           只在手机档渲染 —— 桌面这三块本来就并排看得见,不需要这条。 -->
      <button v-if="isS" type="button" class="cv2-fold av2-s12" :aria-expanded="foldOpen" @click="foldOpen = !foldOpen">
        <component :is="iconFor('chevron-down')" :size="15" :class="{ up: foldOpen }" />
        <b>更多分析</b>
        <span class="s">收入趋势·下月预测 · 分期收入堆叠 · 这条带过去准不准 · 欠费清单</span>
        <span class="n">4 块</span>
      </button>

      <!-- T3:这条带过去准不准——滚动起点回测,每站只用当时已有的月,不复用 T1 的单次 fit;
           六列数据比四行三列的邻卡宽得多,独占一整行不挤 -->
      <div v-if="!isS || foldOpen" class="av2-card av2-s12 cv2-bt">
        <div class="av2-card-h">
          <span class="t">这条带过去准不准</span>
          <span class="hint">滚动起点回测：每次只用当时已有的月，预测下一个月</span>
        </div>
        <!-- 稿 ⑪「5 列回测表 → 行卡」:336 宽上每列 67px,「2026-03 月末」10 字符 ≈ 78px 放不下。
             手机改两行行卡:第一行 月末 + 实际 + 中没中,第二行 预测 + 区间。字与桌面表逐格同源,
             只是换了排法。桌面走下面原样的 <table>,一个字符都没动。 -->
        <div v-if="isS && backRows" class="cv2-rc">
          <div v-for="r in backRows" :key="r.vantageMonth" class="cv2-rc-i">
            <span class="r1">
              <span class="nm">{{ r.vantageMonth }}月末{{ r.isLast ? '（今天）' : '' }}</span>
              <span class="mono">{{ r.actualWan != null ? fint(r.actualWan) + '万' : '—' }}</span>
              <span v-if="r.hit == null" class="hz" style="color: var(--text-muted)">待验</span>
              <span v-else-if="r.hit" class="hz" :style="{ color: STATUS.good.color }">命中</span>
              <span v-else class="hz" :style="{ color: STATUS.watch.color }">落空 {{ r.under ? '低估' : '高估' }} {{ r.missPct?.toFixed(1) }}%</span>
            </span>
            <span class="r2">预测 <span class="mono">{{ fint(r.predictMid) }}万</span> · 区间 <span class="mono">{{ fint(r.lo) }}~{{ fint(r.hi) }}</span></span>
          </div>
        </div>
        <table v-else-if="backRows" class="ak-tbl">
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
        <!-- hold:表画得出来而句子算不出来是真会发生的 —— 回测每一站的「实际」取下一个月的收入,
             录入有缺口时全部站点都是「待验」(hit 全 null),backtestSummary.scored=0,两句同时闭嘴。
             骨架那两行是无条件画的,不占位就会在数据到的那一帧反向塌两行。 -->
        <p class="ana-read hold"><template v-if="backRead">{{ backRead }}</template></p>
        <p class="ana-ref hold"><template v-if="backRead">{{ backRef }}</template></p>
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
        <!-- 弹层里的图瞬现,只有卡片上浮(原则 7) -->
        <AnaEChart v-if="segTrendOption" :option="segTrendOption" :height="250" :entrance="false" />
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
.cv2-anom { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: var(--surface-card); border-radius: 8px; padding: 9px 10px; cursor: pointer; font-family: var(--font-sans); text-align: left; transition: background var(--dur-fast) var(--ease-standard); }
.cv2-anom:hover { background: var(--bg-hover); }
/* C2-08 按压:按下换深一档 0ms 瞬到,松开走上面那条 120 回弹。 */
.cv2-anom:active { background: var(--ink-100); transition-duration: 0ms; }
.cv2-anom .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.cv2-anom .tt { flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv2-anom .vv { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-semibold); font-family: var(--font-mono); }
.cv2-all { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); padding: 4px 0 0; text-align: center; }
.cv2-all:hover { text-decoration: underline; }
/* 弹层 */
/* 全屏模态遮罩 → --z-modal(300)。原写 60 落在 popover 档(那档是给贴附浮层的),会被任何抽屉盖住 */
/* 开:遮罩淡入 + 卡上浮,与 FPDrawer 同款 200(C5-06);关:v-if 瞬时 */
.cv2-mask { position: fixed; inset: 0; z-index: var(--z-modal); background: rgba(28, 28, 28, 0.35); display: grid; place-items: center; opacity: 0; animation: fp-fade-in var(--dur-base) var(--ease-out) forwards; }
.cv2-modal { background: var(--surface-white); border-radius: 14px; box-shadow: 0 12px 40px rgba(28, 28, 28, 0.22); padding: 16px 18px; width: min(620px, 92vw); max-height: 80vh; overflow: auto; animation: fp-rise-in var(--dur-base) var(--ease-out) both; }
.cv2-modal-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.cv2-modal-h .t { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.cv2-modal-h .x { border: none; background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; padding: 4px; border-radius: 6px; }
.cv2-modal-h .x:hover { background: var(--bg-hover); color: var(--text-primary); }
.cv2-link { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); }
.cv2-link:hover { text-decoration: underline; }
.cv2-arr-sum { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }

/* ── 手机档零件(分析屏手机体验稿 ④ 经营驾驶舱,2026-09-20) ──
   下面四个零件的宿主元素都挂着 v-if="isS",桌面一个都不渲染;改变既有元素的那几条一律关在
   @media (max-width:600px) 里。两道闸叠起来 = >600 逐字零差异(RESPONSIVE-LAYOUT-SPEC §9 第一条)。
   字号只取阶梯值(28/24/20/16/15/14/12/11):折叠条 / 更多指标瓦 / 回测行卡 那三处画的 13px
   是越界的,落地回 14(--fs-body);11 是中文下限,照用。
   ⚠ 本文件的 <style> 块不在 anaCopyLint 的注释剥离范围内(它只剥 HTML 注释),这里别写触发词。 */

/* 稿 ②「更多指标 1 枚」:KPI 栅格里跨满两列的一枚,高 108 与 AnaKpiTile 同(那个 108 的账见该文件) */
.cv2-kpi-more { grid-column: 1 / -1; height: 108px; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; border-radius: var(--radius-md); background: var(--surface-card); color: var(--text-secondary); font-family: var(--font-sans); font-size: var(--fs-body); cursor: pointer; }
.cv2-kpi-more svg { transition: transform var(--dur-fast) var(--ease-standard); }
.cv2-kpi-more svg.up { transform: rotate(180deg); }

/* 折叠条:园区 / 租户 / 到期墙 三屏要照抄的形状就是这 8 行 + 下面 @media 里的一条 order。
   ⚠ 今天它住在本屏 scoped 里 —— 真要三屏共用得搬进 ana.css,那是共用文件,交主进程(见交付说明)。 */
.cv2-fold { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 0 12px; border-radius: 8px; border: 1px dashed var(--border-control); background: var(--surface-card); color: var(--text-secondary); font-family: var(--font-sans); font-size: var(--fs-body); text-align: left; cursor: pointer; }
.cv2-fold b { flex: 0 0 auto; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cv2-fold .s { flex: 1; min-width: 0; font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv2-fold .n { flex: 0 0 auto; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); }
.cv2-fold svg { flex: 0 0 auto; transition: transform var(--dur-fast) var(--ease-standard); }
.cv2-fold svg.up { transform: rotate(180deg); }

/* 稿 ⑥ 手机图例行:色块 + 板块名 + 占比 + 金额,占比与金额右对齐成两列 */
.cv2-leg { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.cv2-leg li { display: flex; align-items: center; gap: 6px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.cv2-leg i { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
.cv2-leg .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cv2-leg b { margin-left: auto; font-family: var(--font-mono); font-weight: var(--fw-semibold); color: var(--text-primary); }
.cv2-leg .wan { width: 52px; text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

/* 稿 ⑪ 5 列回测表 → 两行行卡 */
.cv2-rc { display: flex; flex-direction: column; gap: 6px; }
.cv2-rc-i { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: 8px; background: var(--surface-card); }
.cv2-rc-i .r1 { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-body); font-weight: var(--fw-semibold); }
.cv2-rc-i .r1 .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cv2-rc-i .r1 .hz { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-regular); }
.cv2-rc-i .r2 { font-size: var(--fs-micro); color: var(--text-muted); }
.cv2-rc-i .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

@media (max-width: 600px) {
  /* 稿 ④:四句结论一句一行(桌面是 wrap 成一排,column-gap 20 在竖排下会变成行间的空隙,清掉) */
  .cv2-concl { flex-direction: column; align-items: flex-start; column-gap: 0; row-gap: 7px; }
  /* 折起来的那三块 —— **只有骨架分支走这条**。骨架里没有 AnaEChart,只有 .fp-shim / AnaSkelChart
     两种死高的 div,display:none 不会踩「0 宽初始化」那个坑;真版式那三块走 v-if(理由见 <script>)。
     两支分工的第二个理由:motionR2-pnl.spec.ts 钉死了骨架在 S 档的 6 块高序列,那条是
     src/views/__tests__ 下已有的 spec —— jsdom 不跑媒体查询,display:none 它照样数得到 6 块。 */
  .cv2-hide-s { display: none; }
  /* 稿 ⑤⑥⑦⑧ 的块序:主图(.av2-s8 在 ana.css 已 order:-1)→ 构成环(0)→ 收缴率 → 异常 → 折叠条 → 三块折叠件。
     折叠线画在**异常速览之后**,不是「第 4 块之后」——收缴率与异常都是站着问的,按第 4 块切会把
     收缴率那张图切进折叠里。order 只作用于 .av2-grid 的直接子项,所以这些类都打在格子元素本身。 */
  .cv2-coll { order: 1; }
  .cv2-anoc { order: 2; }
  .cv2-fold { order: 3; }
  .cv2-fc { order: 4; }
  .cv2-ph { order: 5; }
  .cv2-bt { order: 6; }
  /* 稿 ⑧:异常速览每行 40 高(桌面 9+20+9=38,手指按的行按稿抬到 40) */
  .cv2-anom { min-height: 40px; }
}
</style>
