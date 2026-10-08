<script setup lang="ts">
// 经营驾驶舱(2026-10 改稿;画板 cockpit-month-v2 / -m06 / -m11 / cockpit-year-v2,图 = 规格)。
// 按月 = 选中那个月里面的事(板块、期区、公司、规则,和上个月比);按年 = 这一年逐月 + 和往年比。
// 数、挑项、句子、ECharts option 全在 cockpit.logic.ts 的 monthBoard / yearBoard(句子从句型库出),这里只接线和交互。
// 期间回退(cv2-notdone / cv2-ask 7,用户 2026-10-05 照推荐):所选月损益表没数 → 整页显示最近有数的月,期间旁挂标签;
// 按年默认落到最近一个 12 个月录满的年;在按年里亲手选到损益表 0 个月的年 → 整页空状态,不画 0 柱。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import { useViewGate } from '@/composables/useViewGate'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import { isSViewport } from '@/components/ana/anaChartHeight'
import { iconFor } from '@/components/ds/icon'
import { fint } from '@/components/ana/anaFmt'
import { CK, asofTables, noPnlBefore, noPnlYear, pageFallback, seeYear, ymLabel } from '@/components/ana/anaSentence'
import { usePeriod, ymOf } from '@/analysis/usePeriod'
import { anaSettings } from '@/analysis/anaSettings'
import {
  buildAnomalies, fetchAnomalyInputs, fetchAvailableMonths, fetchBudgetAll, fetchCollectRates, fetchLedgerRows,
  fetchPnlSummary, fetchS10PhaseMonthly,
  type AnaAnomaly, type AnomalyInputs, type CollectRate, type PnlSummary, type S10PhaseMonthly,
} from '@/analysis/anaData'
import { CK_SEGS, arrearsOf, fullPnlYear, monthBoard, pnlShownYear, pnlShownYm, schedTrend, yearBoard, type Card } from './cockpit.logic'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const sel = period.sel
// 手机档(≤600):回测表换成两行行卡(5 列在 336 宽上放不下);判据同 AnaEChart,挂载时判一次
const isS = isSViewport()
const ALL = '去异常提醒中心看全部'   // 规则卡的按钮(链 /anomaly;屏名和侧栏一致,文案复查:原「监控中心」全站没有这个屏)

// ── 取数(期间无关项拉一次;损益表随显示的年换) ──
const srcMonths = ref<Record<string, string[]>>({})   // 各表有数的月(定整页回退、工具条「各表到哪个月」)
const collects = ref<CollectRate[]>([])
const s10 = ref<S10PhaseMonthly | null>(null)
const ledgerRows = ref<AnalysisLedgerRow[]>([])
const anomInputs = ref<AnomalyInputs | null>(null)
const budgetRows = ref<BudgetRowDTO[]>([])
const ready = ref(false)
// 取数失败 ≠ 表里没有:失败给「重试」,不落到「损益表里没有…」那句(文案复查 10-05)
const failed = ref(false)
async function reload() {
  failed.value = false
  try {
    const [m, c, ph, lr, ai, bg] = await Promise.all([
      fetchAvailableMonths(), fetchCollectRates(), fetchS10PhaseMonthly(), fetchLedgerRows(), fetchAnomalyInputs(),
      fetchBudgetAll().catch(() => [] as BudgetRowDTO[]),   // 预算为增量端点,失败只让按年少「预算达成」和往年
    ])
    srcMonths.value = Object.fromEntries(Object.entries(m.sources ?? {}).map(([k, v]) => [k, [...v].sort()]))
    collects.value = c
    s10.value = ph
    ledgerRows.value = lr
    anomInputs.value = ai
    budgetRows.value = bg
  } catch {
    failed.value = true
  } finally {
    ready.value = true
  }
}
onMounted(reload)
// 侧栏点击是「恢复现场」,不重建实例 —— 纯读屏切回来该看最新的
onReactivated(() => { void reload() })

// ── 期间:所选 → 实际显示 ──
const pnlYms = computed(() => srcMonths.value.pnl ?? [])
const isMonth = computed(() => sel.value.gran === 'month')
const selYm = computed(() => ymOf(sel.value.year, sel.value.month))
const shown = computed<{ year: number; month: number | null } | null>(() => {
  if (isMonth.value) {
    const u = pnlShownYm(pnlYms.value, selYm.value)
    return u ? { year: +u.slice(0, 4), month: +u.slice(5, 7) } : null
  }
  const y = pnlShownYear(pnlYms.value, sel.value.year)
  return y == null ? null : { year: y, month: null }
})
const fullYear = computed(() => fullPnlYear(pnlYms.value))
// 损益表有数、但所选期(按月:所选月及以前;按年:亲手选的年)一个月都没有 → 整页空状态
const pageEmpty = computed(() => ready.value && !failed.value && !shown.value && pnlYms.value.length > 0)
const fallbackTag = computed(() => {
  const s = shown.value
  if (!s) return ''
  if (s.month != null) { const u = ymOf(s.year, s.month); return u === selYm.value ? '' : pageFallback(u, selYm.value) }
  return s.year === sel.value.year ? '' : pageFallback(String(s.year), String(sel.value.year))
})

// 损益表:取显示的那一年。换年竞态守卫:过期响应弃写
const pnl = ref<PnlSummary | null>(null)
const pnlLoading = ref(false)
const pnlFailed = ref(false)
let token = 0
function loadPnl(y: number | undefined) {
  if (y == null) return
  const t = ++token
  pnlLoading.value = true
  pnlFailed.value = false
  fetchPnlSummary(y)
    .then((v) => { if (t === token) pnl.value = v })
    .catch(() => { if (t === token) { pnl.value = null; pnlFailed.value = true } })
    .finally(() => { if (t === token) pnlLoading.value = false })
}
watch(() => shown.value?.year, loadPnl, { immediate: true })
const retryPnl = () => loadPnl(shown.value?.year)
// 上一年:只给 1 月「比12月」用。单独一趟,不进 pnlLoading、不拖住整屏;到了才补上 1 月瓦的涨跌
const prevPnl = ref<PnlSummary | null>(null)
const prevYear = computed(() => (shown.value?.month === 1 ? shown.value.year - 1 : null))
watch(prevYear, (y) => {
  if (y == null || prevPnl.value?.year === y) return
  fetchPnlSummary(y).then((v) => { if (prevYear.value === v.year) prevPnl.value = v }).catch(() => {})
}, { immediate: true })
// 换年在途:旧年内容留在原地退让(C5-02),进度线在工具条上;过 200ms 门才亮
const staleShown = useDeferredFlag(pnlLoading)
// 已画那一期:换年在途时冻结在旧年,与数据同一拍换(不拿新年的月去对旧年的数)
const drawn = ref(shown.value)
watch([pnl, shown], ([p, s]) => { if (!s || !p || p.year === s.year) drawn.value = s }, { immediate: true })

// ── 两块板 ──
const anomalies = computed<AnaAnomaly[]>(() => (anomInputs.value
  ? buildAnomalies(anomInputs.value, { collectTarget: anaSettings.collectTarget, spikeTh: anaSettings.spikeTh }) : []))
const mb = computed(() => {
  const s = drawn.value, p = pnl.value
  if (!s || s.month == null || !p || p.year !== s.year) return null
  return monthBoard({
    pnl: p, prevPnl: prevPnl.value?.year === s.year - 1 ? prevPnl.value : null, month: s.month,
    s10: s10.value, collects: collects.value, ledger: ledgerRows.value, anomalies: anomalies.value, target: anaSettings.collectTarget,
  })
})
const yb = computed(() => {
  const s = drawn.value, p = pnl.value
  if (!s || s.month != null || !p || p.year !== s.year) return null
  return yearBoard({ pnl: p, budget: budgetRows.value, collects: collects.value, target: anaSettings.collectTarget })
})
const kpis = computed(() => (pageEmpty.value || failed.value || pnlFailed.value ? null : mb.value?.kpis ?? yb.value?.kpis ?? null))
const kpiHold = computed(() => (kpis.value || pageEmpty.value || failed.value || pnlFailed.value ? 0 : isMonth.value ? 4 : 5))
// 工具条「数据截至」:几份数据各写到哪个月(S-34 槽位 17);按年没有销售收入表的卡
const asofText = computed(() => {
  const last = (k: string) => { const a = srcMonths.value[k] ?? []; return a[a.length - 1] }
  const rows = ([[CK.tbl.pnl, last('pnl')], ...(isMonth.value ? [[CK.tbl.s10, last('s10')]] : []), [CK.tbl.ledger, last('ledger')]] as [string, string | undefined][])
    .filter((r): r is [string, string] => !!r[1])
  return rows.length ? asofTables(rows) : undefined
})

// 参照位至少留一行(hold):换月时有的卡没有参照,卡不缩
const refsOf = (c: Card): string[] => (c.refs.length ? c.refs : [''])

// ── 交互(原有的三样照旧挂在新图上:点月份切期间、点期区深链销售收入表、点公司 / 月份看欠费清单) ──
interface EcClick { componentType?: string; seriesName?: string; dataIndex?: number; name?: string }
/** 点某个月(预测图的点 / 各月营业收入柱)→ 按月切到那个月,全屏联动 */
function pickMonth(p: unknown): void {
  const e = p as EcClick, y = drawn.value?.year
  if (e.componentType !== 'series' || e.dataIndex == null || y == null) return
  if (sel.value.gran !== 'month') period.setGran('month')
  if (sel.value.year !== y) period.setYear(y)
  period.setMonth(e.dataIndex + 1)
}
/** 点期区的条 → 深链销售收入表那一期那个期区(上月的条落上月) */
function onPhaseClick(p: unknown): void {
  if (blocked('/sales-income')) return
  const e = p as EcClick, b = mb.value
  const ph = b && e.dataIndex != null ? b.phase.phases[e.dataIndex] : undefined
  if (!b || ph == null) return
  const ym = e.seriesName === b.phase.curName ? b.ym : b.phase.prevYm
  tabs.openDeep('sales-income')   // 页签语义(spec §4.1);发链 periodLink:p + co=期区(§4.2)
  void router.push(periodLink('sales-income', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), co: ph }))
}
// 欠费清单弹层:点公司 → 那家公司那一期;点按年的月柱 → 那一期全部公司
const arrModal = ref<{ ym: string; company: string | null } | null>(null)
const arrears = computed(() => (arrModal.value ? arrearsOf(ledgerRows.value, arrModal.value.ym, arrModal.value.company) : null))
function onCoClick(p: unknown): void {
  const e = p as EcClick, ym = mb.value?.coll.ym
  if (ym && e.name) arrModal.value = { ym, company: e.name }
}
function onCollMonthClick(p: unknown): void {
  const e = p as EcClick, y = drawn.value?.year
  if (e.componentType === 'series' && e.dataIndex != null && y != null) arrModal.value = { ym: ymOf(y, e.dataIndex + 1), company: null }
}
function goLedger(tenant: string, company: string, ym: string): void {
  tabs.openDeep('ledger')
  void router.push(periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company, tenant } }))
}
// 板块趋势弹层:点构成条(类目 = 板块)/ 历年构成的段(系列 = 板块)
const segModal = ref<{ key: string; label: string } | null>(null)
function onSegClick(p: unknown): void {
  const e = p as EcClick
  const hit = CK_SEGS.find(([n]) => n === e.name) ?? CK_SEGS.find(([n]) => n === e.seriesName)
  if (hit) segModal.value = { key: hit[1], label: hit[0] }
}
const segTrendOption = computed<object | null>(() => {
  if (!segModal.value) return null
  const t = schedTrend(pnl.value, segModal.value.key)
  if (!t.labels.length) return null
  return {
    grid: { left: 52, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : v.toFixed(1) + '万') },
    xAxis: { type: 'category', data: t.labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}万' } },
    series: [{ name: segModal.value.label, type: 'line', data: t.vals, smooth: true, areaStyle: { opacity: 0.12 } }],
  }
})
const go = (link: string): void => { void router.push(link) }
// 跳到模块屏的入口:没有目标屏的查看权就置灰、悬停写明缺哪一项;图上的点没法置灰,点了说一句原因不跳(RBAC v3,master 0.28.0)
const { lack, blocked } = useViewGate()
/** 规则引擎异常条(AnaAnomaly):录入屏目标带期与定位;与 AnomalyView.goAnom 逐字同形。 */
const goAnom = (a: AnaAnomaly): void => {
  const v = a.link.slice(1)
  // 录入屏目标走 openDeep(缓存的台账 / 附10 页签有草稿时 useDeepPeriod 的 dirty 闸会吞掉这一跳,「一击落位」靠全新实例);分析屏目标保持裸 push
  if (v === 'ledger' || v === 'sales-income') tabs.openDeep(v)
  void router.push(periodLink(v, { p: periodOf(+a.ym.slice(0, 4), +a.ym.slice(5, 7)), co: a.co, extra: { company: a.company, tenant: a.tenant } }))
}
</script>

<template>
  <AnaShell period-mode="full" :busy="staleShown" :asof-text="asofText" :kpi-hold="kpiHold">
    <template #tools>
      <span class="cv2-name"><component :is="iconFor('gauge')" :size="15" />{{ CK.screen }}</span>
    </template>

    <!-- 屏顶:按月 4 张(比上月),按年 5 张(加预算达成,比上一年) -->
    <template #kpis>
      <template v-if="kpis">
        <AnaKpiTile v-bind="kpis.rev" pct-unit />
        <AnaKpiTile v-bind="kpis.cost" pct-unit />
        <AnaKpiTile v-bind="kpis.profit" profit pct-unit />
        <AnaKpiTile v-if="yb" v-bind="yb.kpis.budget" pct-unit />
        <AnaKpiTile v-bind="kpis.rate" pct-unit />
      </template>
    </template>

    <!-- 整页期间回退:贴在期间选择旁,不另起一行(收缴率单图回退贴它自己的卡头) -->
    <template #period-note>
      <FPStateTag v-if="fallbackTag" tone="muted">{{ fallbackTag }}</FPStateTag>
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。块高 = 真版式的图高 + 卡头 + 读数句 / 参照行数,数据到了原地硬切。
         门只认首进(!pnl):换年那一路旧内容留在原地退让(C5-02),不塌回骨架。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <template v-if="!ready || (pnlLoading && !pnl)">
      <!-- 照真版式的卡序、栅格、图高、卡头与文字行数留位;随数据变的字换成同长的隐形占位(取默认期 12 月 / 2025 年的字) -->
      <div v-if="isMonth" class="av2-grid cv2-skel">
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">{{ CK.card.fc }}</span><span class="hint"><span class="ana-hole">2025年1–12月 · 万元</span></span></div>
          <AnaSkelChart :height="280" />
          <p class="ana-read hold"><span class="ana-hole">12月实际低于预计 ¥918.6~997.4万</span></p>
          <p class="ana-ref hold"><span class="ana-hole">最近 6 次（7–12月）中 2 次落在区间里</span></p>
          <p class="ana-ref hold"><span class="ana-hole">按1–11月算12月</span></p>
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">{{ CK.card.compo }}</span><span class="hint"><span class="ana-hole">4 个板块 · 和11月比 · 万元</span></span></div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"><span class="ana-hole">租金 638.8→−341.3；其余 3 项 302.0→277.6</span></p>
          <p class="ana-ref hold"><span class="ana-hole"></span></p>
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">{{ CK.card.phase }}</span><span class="hint"><span class="ana-hole">4 个期区 · 和11月比 · 万元</span></span></div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"><span class="ana-hole">二期 489.3→−511.2；其余 3 项 401.6→403.0</span></p>
          <p class="ana-ref hold"><span class="ana-hole">按销售收入表算，和营业收入分开记</span></p>
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">{{ CK.card.coll }}</span><span class="hint"><span class="ana-hole">6 家管理公司 · 台账 · %</span></span></div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"><span class="ana-hole">6 家里 0 家到了目标，最低是 某某 67.1%</span></p>
          <p class="ana-ref hold"><span class="ana-hole">按台账10月的实收和应收算</span></p>
        </div>
        <div class="av2-card av2-s6 cv2-anoc">
          <div class="av2-card-h"><span class="t">{{ CK.card.rules }}</span><span class="hint"><span class="ana-hole">前 3 条</span></span></div>
          <div class="cv2-anoms">
            <button v-for="i in 3" :key="i" type="button" class="cv2-anom ana-hole" disabled>
              <span class="dot"></span><span class="tt">占位</span><span class="vv">00</span>
            </button>
            <p class="ana-ref"><span class="ana-hole">12月共触发 7 条规则</span></p>
            <p class="ana-ref"><span class="ana-hole">12月没有台账，收缴率、应收为负两类规则没跑</span></p>
            <button type="button" class="cv2-all ana-hole" disabled>{{ ALL }} →</button>
          </div>
        </div>
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">{{ CK.card.bt }}</span><span class="hint"><span class="ana-hole">6 次</span></span></div>
          <!-- 表块 258 = 表头 30 + 6 行 × 38 -->
          <div class="fp-shim" style="height: 258px"></div>
          <p class="ana-ref hold"><span class="ana-hole">每次按当时已有的月算下一个月</span></p>
        </div>
      </div>
      <div v-else class="av2-grid cv2-skel">
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">{{ CK.card.hist }}</span><span class="hint"><span class="ana-hole">4 年 · 万元</span></span></div>
          <AnaSkelChart :height="300" />
          <p class="ana-read hold"><span class="ana-hole">2022年→2025年 营业收入增长 100.1%</span></p>
          <p class="ana-ref hold"><span class="ana-hole">2022–24 取预算表全年实际，2025 取损益表</span></p>
          <p class="ana-ref hold"><span class="ana-hole">成本费用按营业收入和园区利润算</span></p>
        </div>
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">{{ CK.card.cum }}</span><span class="hint"><span class="ana-hole">万元</span></span></div>
          <AnaSkelChart :height="300" />
          <p class="ana-read hold"><span class="ana-hole">12月累计比11月底少 ¥63.6万</span></p>
          <p class="ana-ref hold"><span class="ana-hole"></span></p>
        </div>
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">{{ CK.card.monthly }}</span><span class="hint"><span class="ana-hole">万元</span></span></div>
          <AnaSkelChart :height="280" />
          <p class="ana-read hold"><span class="ana-hole">营业收入最高 11月 ¥940.8万，最低 12月 −¥63.6万</span></p>
          <p class="ana-ref hold"><span class="ana-hole"></span></p>
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">{{ CK.card.histCompo }}</span><span class="hint"><span class="ana-hole">4 年 · 万元</span></span></div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"><span class="ana-hole">租金占营业收入 2025年 64.9%，比2024年低 6.2 个点</span></p>
          <p class="ana-ref hold"><span class="ana-hole">2022–24 取预算表全年实际，2025 取损益表</span></p>
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">{{ CK.card.collM }}</span><span class="hint"><span class="ana-hole">2025年1–10月 · 台账 · %</span></span></div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"><span class="ana-hole">10 个月里 3 个月到了目标，最低是 2月 59.6%</span></p>
          <p class="ana-ref hold"><span class="ana-hole">按台账各月的实收和应收算</span></p>
        </div>
      </div>
    </template>
    <!-- skel:end -->
    <!-- 按年里亲手选到损益表 0 个月的年:整页空状态(图标 + 一句 + 一个按钮),不画 0 柱 -->
    <FPLoadError v-else-if="failed || pnlFailed" sub="屏上不显示别的月份的数字" @retry="failed ? reload() : retryPnl()">经营驾驶舱的数据没读到</FPLoadError>
    <FPEmpty v-else-if="pageEmpty" size="sm" :action="fullYear ? seeYear(fullYear) : undefined"
      @action="fullYear && period.setYear(fullYear)">{{ isMonth ? noPnlBefore(selYm) : noPnlYear(sel.year) }}</FPEmpty>
    <!-- 按月:预测(整行)→ 构成、分期 → 各公司收缴率、触发的规则 → 回测表;按年:历年 + 累计 → 各月 → 历年构成、各月收缴率。
         换年在途:旧内容留在原地退让(C5-02),data-stale-host 常挂,退场才是 200 而不是硬切 -->
    <div v-else-if="mb" class="av2-grid" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">{{ mb.fc.title }}</span>
          <span class="hint">{{ mb.fc.hint }}</span>
        </div>
        <AnaEChart v-if="mb.fc.option" :option="mb.fc.option" :height="280" @chart-click="pickMonth" />
        <p class="ana-read hold">{{ mb.fc.read }}</p>
        <p v-for="(r, i) in refsOf(mb.fc)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">{{ mb.compo.title }}</span>
          <span class="hint">{{ mb.compo.hint }}</span>
        </div>
        <AnaEChart v-if="mb.compo.option" :option="mb.compo.option" :height="250" @chart-click="onSegClick" />
        <p class="ana-read hold">{{ mb.compo.read }}</p>
        <p v-for="(r, i) in refsOf(mb.compo)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">{{ mb.phase.title }}</span>
          <span class="hint">{{ mb.phase.hint }}</span>
        </div>
        <AnaEChart v-if="mb.phase.option" :option="mb.phase.option" :height="250" @chart-click="onPhaseClick" />
        <AnaEmpty v-else :label="mb.phase.empty" />
        <p class="ana-read hold">{{ mb.phase.read }}</p>
        <p v-for="(r, i) in refsOf(mb.phase)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">{{ mb.coll.title }}<FPStateTag v-if="mb.coll.tag" tone="muted" style="margin-left: 8px">{{ mb.coll.tag }}</FPStateTag></span>
          <span class="hint">{{ mb.coll.hint }}</span>
        </div>
        <AnaEChart v-if="mb.coll.option" :option="mb.coll.option" :height="250" @chart-click="onCoClick" />
        <AnaEmpty v-else :label="mb.coll.empty" />
        <p class="ana-read hold">{{ mb.coll.read }}</p>
        <p v-for="(r, i) in refsOf(mb.coll)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <!-- 触发的规则:产品规则引擎这个月的命中,前 3 条;点条去录入屏 / 分析屏定位 -->
      <div class="av2-card av2-s6 cv2-anoc">
        <div class="av2-card-h">
          <span class="t">{{ CK.card.rules }}</span>
          <span class="hint">{{ mb.rules.hint }}</span>
        </div>
        <div v-if="mb.rules.rows.length" class="cv2-anoms">
          <button v-for="r in mb.rules.rows" :key="r.a.id" type="button" class="cv2-anom" :disabled="!!lack(r.a.link)" v-tip="lack(r.a.link)" @click="goAnom(r.a)">
            <span class="dot"></span><span class="tt">{{ r.title }}</span><span class="vv">{{ r.value }}</span>
          </button>
          <p v-for="t in mb.rules.refs" :key="t" class="ana-ref">{{ t }}</p>
          <button type="button" class="cv2-all" :disabled="!!lack('/anomaly')" v-tip="lack('/anomaly')" @click="go('/anomaly')">{{ ALL }} →</button>
        </div>
        <AnaEmpty v-else :label="mb.rules.refs.join('') || undefined" to="/anomaly" :to-text="ALL" />
      </div>

      <!-- 回测表:放首屏以下(cv2-ask 6);只验过不到 5 次时标题不说「这条带」 -->
      <div v-if="mb.bt.rows.length" class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">{{ mb.bt.title }}</span>
          <span class="hint">{{ mb.bt.hint }}</span>
        </div>
        <div v-if="isS" class="cv2-rc">
          <div v-for="r in mb.bt.rows" :key="r[0]" class="cv2-rc-i">
            <span class="r1"><span class="nm">{{ r[0] }}</span><span class="mono">{{ r[3] }}</span><span class="hz">{{ r[4] }}</span></span>
            <span class="r2">{{ CK.btHead[1] }} <span class="mono">{{ r[1] }}</span> · {{ CK.btHead[2] }} <span class="mono">{{ r[2] }}</span></span>
          </div>
        </div>
        <table v-else class="ak-tbl">
          <thead><tr><th v-for="h in CK.btHead" :key="h">{{ h }}</th></tr></thead>
          <tbody>
            <tr v-for="r in mb.bt.rows" :key="r[0]">
              <td v-for="(x, i) in r" :key="i" :class="{ mono: i > 0 && i < 4 }">{{ x }}</td>
            </tr>
          </tbody>
        </table>
        <p class="ana-ref hold">{{ mb.bt.ref }}</p>
      </div>
    </div>
    <div v-else-if="yb" class="av2-grid" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <div class="av2-card av2-s8">
        <div class="av2-card-h">
          <span class="t">{{ yb.hist.title }}</span>
          <span class="hint">{{ yb.hist.hint }}</span>
        </div>
        <AnaEChart v-if="yb.hist.option" :option="yb.hist.option" :height="300" />
        <p class="ana-read hold">{{ yb.hist.read }}</p>
        <p v-for="(r, i) in refsOf(yb.hist)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">{{ yb.cum.title }}</span>
          <span class="hint">{{ yb.cum.hint }}</span>
        </div>
        <AnaEChart v-if="yb.cum.option" :option="yb.cum.option" :height="300" />
        <p class="ana-read hold">{{ yb.cum.read }}</p>
        <p v-for="(r, i) in refsOf(yb.cum)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">{{ yb.monthly.title }}</span>
          <span class="hint">{{ yb.monthly.hint }}</span>
        </div>
        <AnaEChart v-if="yb.monthly.option" :option="yb.monthly.option" :height="280" @chart-click="pickMonth" />
        <p class="ana-read hold">{{ yb.monthly.read }}</p>
        <p v-for="(r, i) in refsOf(yb.monthly)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">{{ yb.histCompo.title }}</span>
          <span class="hint">{{ yb.histCompo.hint }}</span>
        </div>
        <AnaEChart v-if="yb.histCompo.option" :option="yb.histCompo.option" :height="250" @chart-click="onSegClick" />
        <p class="ana-read hold">{{ yb.histCompo.read }}</p>
        <p v-for="(r, i) in refsOf(yb.histCompo)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">{{ yb.collM.title }}</span>
          <span class="hint">{{ yb.collM.hint }}</span>
        </div>
        <AnaEChart v-if="yb.collM.option" :option="yb.collM.option" :height="250" @chart-click="onCollMonthClick" />
        <AnaEmpty v-else :label="yb.collM.empty" />
        <p class="ana-read hold">{{ yb.collM.read }}</p>
        <p v-for="(r, i) in refsOf(yb.collM)" :key="i" class="ana-ref hold">{{ r }}</p>
      </div>
    </div>
    <AnaEmpty v-else :label="noPnlYear(sel.year)" to="/rent-pnl" />

    <!-- 弹层:板块趋势(点构成条 / 历年构成的段) -->
    <div v-if="segModal" class="cv2-mask" @click.self="segModal = null">
      <div class="cv2-modal">
        <div class="cv2-modal-h">
          <span class="t">{{ segModal.label }}收入 · {{ drawn?.year }}年 12 月趋势</span>
          <button class="x" @click="segModal = null"><component :is="iconFor('x')" :size="15" /></button>
        </div>
        <!-- 弹层里的图瞬现,只有卡片上浮(原则 7) -->
        <AnaEChart v-if="segTrendOption" :option="segTrendOption" :height="250" :entrance="false" />
        <AnaEmpty v-else :label="drawn?.year + ' 年该板块无月度数据'" />
      </div>
    </div>

    <!-- 弹层:欠费清单(点公司 / 点按年的月柱) -->
    <div v-if="arrModal" class="cv2-mask" @click.self="arrModal = null">
      <div class="cv2-modal">
        <div class="cv2-modal-h">
          <span class="t">欠费清单 · {{ ymLabel(arrModal.ym) }}{{ arrModal.company ? ' · ' + arrModal.company : '' }}(应收−实收 &gt; 0)</span>
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
              <td><button class="cv2-link" :disabled="!!lack('/ledger')" v-tip="lack('/ledger')" @click="goLedger(r.name, r.company, arrModal!.ym)">查台账 →</button></td>
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
/* 触发的规则:紧凑行。圆点不按严重度上色(橙只给没到目标),值用正文色(S-43) */
.cv2-anoms { display: flex; flex-direction: column; gap: 6px; }
.cv2-anoms .ana-ref { margin: 0; }
.cv2-anom { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: var(--surface-card); border-radius: 8px; padding: 9px 10px; cursor: pointer; font-family: var(--font-sans); text-align: left; transition: background var(--dur-fast) var(--ease-standard); }
.cv2-anom:hover { background: var(--bg-hover); }
.cv2-anom:disabled { opacity: 0.55; cursor: default; background: var(--surface-card); }
/* C2-08 按压:按下换深一档 0ms 瞬到,松开走上面那条 120 回弹。 */
.cv2-anom:active { background: var(--ink-100); transition-duration: 0ms; }
.cv2-anom .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: var(--hue-blue); }
.cv2-anom .tt { flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv2-anom .vv { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-semibold); font-family: var(--font-mono); color: var(--text-primary); }
.cv2-all { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); padding: 4px 0 0; text-align: center; }
.cv2-all:hover { text-decoration: underline; }
.cv2-all:disabled { color: var(--text-disabled); cursor: default; text-decoration: none; }
/* 弹层 */
/* 全屏模态遮罩 → --z-modal(300)。开:遮罩淡入 + 卡上浮,与 FPDrawer 同款 200(C5-06);关:v-if 瞬时 */
.cv2-mask { position: fixed; inset: 0; z-index: var(--z-modal); background: rgba(28, 28, 28, 0.35); display: grid; place-items: center; opacity: 0; animation: fp-fade-in var(--dur-base) var(--ease-out) forwards; }
.cv2-modal { background: var(--surface-white); border-radius: 14px; box-shadow: 0 12px 40px rgba(28, 28, 28, 0.22); padding: 16px 18px; width: min(620px, 92vw); max-height: 80vh; overflow: auto; animation: fp-rise-in var(--dur-base) var(--ease-out) both; }
.cv2-modal-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.cv2-modal-h .t { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.cv2-modal-h .x { border: none; background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; padding: 4px; border-radius: 6px; }
.cv2-modal-h .x:hover { background: var(--bg-hover); color: var(--text-primary); }
.cv2-link { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); }
.cv2-link:hover { text-decoration: underline; }
.cv2-link:disabled { color: var(--text-disabled); cursor: default; text-decoration: none; }
.cv2-arr-sum { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }

/* 手机档:5 列回测表 → 两行行卡(第一行 月末 + 实际 + 落在哪,第二行 预测 + 区间;字与桌面表逐格同源) */
.cv2-rc { display: flex; flex-direction: column; gap: 6px; }
.cv2-rc-i { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: 8px; background: var(--surface-card); }
.cv2-rc-i .r1 { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-body); font-weight: var(--fw-semibold); }
.cv2-rc-i .r1 .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cv2-rc-i .r1 .hz { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-regular); color: var(--text-secondary); }
.cv2-rc-i .r2 { font-size: var(--fs-micro); color: var(--text-muted); }
.cv2-rc-i .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
</style>
