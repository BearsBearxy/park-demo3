<script setup lang="ts">
// 经营驾驶舱 v2(spec §二.1 + 示意图1,2026-07-08 重构):
// KPI 6 tile(#kpis 槽)+ 主图 s8 收入柱+利润线(ECharts,dataZoom+预算 markLine+点月柱全屏联动)
// + s4 收入构成环(点扇区→该板块 12 月趋势弹层)+ 第二排 s4×3 = 分期收入堆叠(点击深链附表10)
// / 收缴率横条 vs 目标(点击→欠费清单弹层,数据台账)/ 异常速览(规则引擎前4条,链监控中心)。
// 对比开关 ['mom','budget']:环比=上月收入虚线叠加;预算=预算月均虚线。数值口径与 v1 逐项一致
// (取数全走 anaData 既有聚合器,变换纯函数见 cockpit.logic.ts)。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import { iconFor } from '@/components/ds/icon'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import { CMP_BASELINE, CMP_BUDGET, STATUS, fint, fnum } from '@/components/ana/anaFmt'
import { usePeriod, ymOf } from '@/analysis/usePeriod'
import { anaSettings } from '@/analysis/anaSettings'
import { useCompare } from '@/analysis/useCompare'
import {
  buildAnomalies, fetchAnomalyInputs, fetchBudgetAll, fetchCollectRates, fetchContractSummary,
  fetchLedgerRows, fetchPnlSummary, fetchS10PhaseMonthly, fetchTenantSummary,
  type AnaAnomaly, type AnomalyInputs, type CollectRate, type PnlSummary, type S10PhaseMonthly,
} from '@/analysis/anaData'
import {
  anchorMonth, arrearsOf, atPeriod, budgetAch, budgetRevenueOf, buildConclusion, colPick, compoData, mainChart, momOf, phaseStack, schedTrend,
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
watch(year, (y) => {
  if (!y) return
  pnlLoading.value = true
  fetchPnlSummary(y)
    .then((v) => { pnl.value = v })
    .catch(() => { pnl.value = null })
    .finally(() => { pnlLoading.value = false })
}, { immediate: true })

onMounted(async () => {
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
})

// ── 期间与 KPI(口径同 v1:月=当月,年=有数月Σ,缺月 null 不补 0) ──
const isMonth = computed(() => period.sel.value.gran === 'month')
const mi = computed(() => period.sel.value.month - 1)
const money = (v: number | null): string => (v == null ? '—' : (v < 0 ? '−¥' : '¥') + fnum(Math.abs(v) / 10000) + '万')

// §五策略2 月锚:所选月无损益 → KPI/构成环锚定最近覆盖月 + 顶部横幅显式(取值公式不变)
const usedMi = computed(() => (isMonth.value ? anchorMonth(pnl.value?.months ?? [], mi.value + 1) - 1 : mi.value))
const pnlUsedYm = computed(() => (isMonth.value && usedMi.value !== mi.value ? ymOf(year.value, usedMi.value + 1) : null))
// §五策略3:所选年无损益附表 → 主区整体空态(禁止沿用旧年图表)
const pnlEmpty = computed(() => !pnl.value?.months.length)

const rev = computed(() => atPeriod(pnl.value?.revenue, isMonth.value, usedMi.value))
const cost = computed(() => atPeriod(pnl.value?.cost, isMonth.value, usedMi.value))
const prof = computed(() => atPeriod(pnl.value?.profit, isMonth.value, usedMi.value))
const margin = computed(() => (rev.value && prof.value != null ? (prof.value / rev.value) * 100 : null))
const cp = computed(() => colPick(collects.value, isMonth.value, year.value, period.ym.value))
const ach = computed(() => budgetAch(budgetRows.value, pnl.value, year.value))

// ── 主图(对比开关:mom=上月收入虚线;budget=预算月均虚线;markLine=当年预算/12 常显) ──
interface EcClick { componentType?: string; seriesName?: string; dataIndex?: number; name?: string }
const mc = computed(() => mainChart(pnl.value, budgetRevenueOf(budgetRows.value, year.value)))
const mainOption = computed<object | null>(() => {
  const d = mc.value
  if (!d || !d.covered) return null
  const series: object[] = [
    {
      name: '收入', type: 'bar', data: d.rev, barMaxWidth: 26, itemStyle: { borderRadius: [3, 3, 0, 0] },
      markLine: d.budgetAvgWan != null ? {
        silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: CMP_BUDGET },
        // 图表清晰化 §1:标签画在绘图区内,不许被图边裁切
        label: { position: 'insideEndTop', formatter: `预算月均 ${d.budgetAvgWan}万`, fontSize: 10, color: CMP_BUDGET },
        data: [{ yAxis: d.budgetAvgWan }],
      } : undefined,
    },
    { name: '利润', type: 'line', data: d.profit, smooth: true, symbolSize: 5, connectNulls: true, itemStyle: { color: '#185FA5' } },
  ]
  if (cmp.mode.value === 'mom') {
    series.push({ name: '上月收入', type: 'line', data: d.prevRev, lineStyle: { type: 'dashed', width: 1.5 }, itemStyle: { color: CMP_BASELINE }, symbol: 'none', connectNulls: true })
  }
  if (cmp.mode.value === 'budget' && d.budgetAvgWan != null) {
    series.push({ name: '预算月均', type: 'line', data: d.labels.map(() => d.budgetAvgWan), lineStyle: { type: 'dashed', width: 1.5, color: CMP_BUDGET }, itemStyle: { color: CMP_BUDGET }, symbol: 'none' })
  }
  return {
    grid: { left: 52, right: 18, top: 32, bottom: 42 },
    legend: { top: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : fnum(v) + '万') },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 12, bottom: 6, borderColor: 'transparent' }],
    xAxis: { type: 'category', data: d.labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}万' } },
    series,
  }
})
// 点击月柱 → 期间切至该月(usePeriod 校验非法月自动忽略)→ 全屏联动
function onMainClick(p: unknown): void {
  const e = p as EcClick
  if (e.componentType !== 'series' || e.dataIndex == null) return
  if (period.sel.value.gran !== 'month') period.setGran('month')
  period.setMonth(e.dataIndex + 1)
}

// ── 收入构成环(点扇区 → 该板块 12 月趋势弹层;月锚随 usedMi,与 KPI 同口径) ──
const compo = computed(() => compoData(pnl.value, isMonth.value, usedMi.value))
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
    xAxis: { type: 'category', data: d.months, axisLabel: { fontSize: 10, formatter: (v: string) => `${+v.slice(5)}月` } },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}万' } },
    series: d.series.map((s) => ({ name: s.name, type: 'bar', stack: 'ph', data: s.data, barMaxWidth: 30 })),
  }
})
function onPhaseClick(p: unknown): void {
  const e = p as EcClick
  const s = ps.value?.series.find((x) => x.name === e.seriesName)
  if (!s || !e.name) return
  tabs.openFresh('sales-income', { pin: true })   // 深链协议:KeepAlive 只在 onMounted 消费 query
  void router.push({ path: '/sales-income', query: { y: e.name.slice(0, 4), m: String(+e.name.slice(5, 7)), phase: String(s.phase) } })
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
      label: { show: true, position: 'right', fontSize: 10, formatter: '{c}%' },
      markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: 'rgba(28,28,28,.45)' }, label: { position: 'insideEndTop', formatter: `目标 ${target}%`, fontSize: 10 }, data: [{ xAxis: target }] },
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
  tabs.openFresh('ledger', { pin: true })
  void router.push({ path: '/ledger', query: { y: ym.slice(0, 4), m: String(+ym.slice(5, 7)), company, tenant } })
}

// ── 异常速览(规则引擎共用 anomaly 屏;前 4 条,链监控中心) ──
const anomalies = computed<AnaAnomaly[]>(() =>
  anomInputs.value ? buildAnomalies(anomInputs.value, { collectTarget: anaSettings.collectTarget }) : [])
const anomTop = computed(() => anomalies.value.slice(0, 4))
const go = (link: string): void => { void router.push(link) }

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
      <AnaKpiTile :label="isMonth ? '营业收入' : '营收合计'" :value="money(rev)"
        :delta="momOf(pnl?.revenue, isMonth, usedMi)" kind="环比" :trend="pnl?.revenue" />
      <AnaKpiTile label="成本费用" :value="money(cost)" :delta="momOf(pnl?.cost, isMonth, usedMi)" kind="环比" invert :trend="pnl?.cost" />
      <AnaKpiTile label="园区利润" :value="money(prof)"
        :note="margin != null ? '利润率 ' + margin.toFixed(1) + '%' : '当期无损益数据'" :trend="pnl?.profit" />
      <!-- 副文案人话化(2026-07-20 用户反馈):delta=−15.5pt + kind=距目标96%,口径区间挪 note 行 -->
      <AnaKpiTile label="收缴率" :value="cp ? cp.rate.toFixed(1) + '%' : '—'"
        :delta="cp ? +(cp.rate - anaSettings.collectTarget).toFixed(1) : null"
        :kind="cp ? `距目标${anaSettings.collectTarget}%` : ''" unit="pt"
        :note="cp ? `${cp.ym}累计实收/应收` : '台账未录入'" :trend="collects.map((c) => c.rate)" />
      <AnaKpiTile label="预算达成" :value="ach ? ach.rate.toFixed(1) + '%' : '—'"
        :note="ach ? `${year}年预算 ${money(ach.budget)}` : `${year}年未导入预算`" />
      <AnaKpiTile label="在租租户(计数口径)" :value="tenantSum ? fint(tenantSum.tenantActive) + ' 户' : '—'"
        :note="contractSum ? `在租合同 ${fint(contractSum.contractActive)} 份` : undefined" />
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
      <!-- §A 经营结论条(spec 2026-07-11):数据模板分句,缺数据省句;句前圆点按 tone,异常句可点击深链 -->
      <div v-if="conclusion.length" class="av2-card cv2-concl">
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
          <span class="t">收入与利润 · {{ year }}年</span>
          <span class="hint">覆盖 {{ mc?.covered ?? 0 }} 期(万元)· 点击月柱切换期间 · 拖选缩放 · 紫虚线=预算月均</span>
        </div>
        <AnaEChart v-if="mainOption" :option="mainOption" :height="304" @chart-click="onMainClick" />
        <AnaEmpty v-else :label="year + ' 年无损益附表数据'" hint="收入/利润来自损益附表 1~5 园区总计带" to="/rent-pnl" to-text="去录入损益附表" />
      </div>

      <!-- s4:收入构成环 -->
      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">收入构成 · {{ isMonth ? '本月' : '本年' }}</span>
          <span class="hint">合计 {{ money(compoTotal || null) }} · 点击扇区看趋势</span>
        </div>
        <AnaEChart v-if="compo.length" :option="donutOption" :height="304" @chart-click="onDonutClick" />
        <AnaEmpty v-else label="当期无收入构成数据" hint="构成来自损益附表 1~4 各板块收入" to="/rent-pnl" to-text="去录入损益附表" />
      </div>

      <!-- 第二排 s4×3 -->
      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">分期收入堆叠</span>
          <span class="hint">附表10 覆盖 {{ ps?.months.length ?? 0 }} 期 · 点击深链附表10</span>
        </div>
        <AnaEChart v-if="phaseOption" :option="phaseOption" :height="248" @chart-click="onPhaseClick" />
        <AnaEmpty v-else label="附表10 无计费数据" hint="分期收入来自附表10 租户×月计费" to="/sales-income" to-text="去录入附表10" />
      </div>

      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">收缴率 vs 目标</span>
          <span class="hint">{{ year }}年近 6 期(台账共 {{ collects.length }} 期,趋势见 KPI)· 点击看欠费清单</span>
        </div>
        <AnaEChart v-if="collectOption" :option="collectOption" :height="248" @chart-click="onCollectClick" />
        <AnaEmpty v-else label="台账数据未录入" hint="收缴率 = 台账 Σ实收 / Σ应收" to="/ledger" to-text="去台账录入" />
      </div>

      <div class="av2-card av2-s4">
        <div class="av2-card-h">
          <span class="t">异常速览</span>
          <span class="hint">规则引擎跑真数据 · 点击查看</span>
        </div>
        <div v-if="anomTop.length" class="cv2-anoms">
          <button v-for="a in anomTop" :key="a.id" class="cv2-anom" @click="go(a.link)">
            <span class="dot" :style="{ background: STATUS[a.sev].color }"></span>
            <span class="tt">{{ a.title }}</span>
            <span class="vv" :style="{ color: STATUS[a.sev].color }">{{ a.value }}</span>
          </button>
          <button class="cv2-all" @click="go('/anomaly')">进入监控中心 · 全部 {{ anomalies.length }} 条 →</button>
        </div>
        <AnaEmpty v-else label="当前规则下暂无异常" hint="收缴率/能耗环比/收入中断/负值行 四规则均未触发" />
      </div>

      <div class="av2-s12">
        <AnaMethodNote>
          口径:营收/成本/利润 = 损益附表 1~5 园区总计带(成本含附表5运营费用总计);收缴率 = 台账 Σ实收/Σ应收(仅 {{ collects.length }} 期,诚实标注);
          预算达成 = 年度口径(全面预算总表收入总计);分期收入 = 附表10(已剔期别汇总行)。对比开关:环比=上月收入虚线,预算=预算月均(年预算/12)虚线。
        </AnaMethodNote>
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
        <AnaEChart v-if="segTrendOption" :option="segTrendOption" :height="240" />
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
.cv2-name { order: -1; display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
/* §A 经营结论条(av2-card 观感,单行 flex wrap;位于回退横幅后、grid 前) */
.cv2-concl { display: flex; flex-wrap: wrap; align-items: center; column-gap: 20px; row-gap: 6px; margin-bottom: 12px; }
.cv2-cs { display: inline-flex; align-items: center; gap: 7px; border: none; background: transparent; padding: 0; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.cv2-cs .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.cv2-cs.lk { cursor: pointer; }
.cv2-cs.lk:hover { text-decoration: underline; }
/* 异常速览紧凑行 */
.cv2-anoms { display: flex; flex-direction: column; gap: 6px; }
.cv2-anom { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: var(--surface-card); border-radius: 8px; padding: 9px 10px; cursor: pointer; font-family: var(--font-sans); text-align: left; }
.cv2-anom:hover { background: var(--bg-hover); }
.cv2-anom .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.cv2-anom .tt { flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv2-anom .vv { flex: 0 0 auto; font-size: 11.5px; font-weight: var(--fw-semibold); font-family: var(--font-mono); }
.cv2-all { border: none; background: transparent; color: var(--text-link); font-size: 11.5px; cursor: pointer; font-family: var(--font-sans); padding: 4px 0 0; text-align: center; }
.cv2-all:hover { text-decoration: underline; }
/* 弹层 */
.cv2-mask { position: fixed; inset: 0; z-index: 60; background: rgba(28, 28, 28, 0.35); display: grid; place-items: center; }
.cv2-modal { background: var(--surface-white); border-radius: 14px; box-shadow: 0 12px 40px rgba(28, 28, 28, 0.22); padding: 16px 18px; width: min(620px, 92vw); max-height: 80vh; overflow: auto; }
.cv2-modal-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.cv2-modal-h .t { font-size: 13.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cv2-modal-h .x { border: none; background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; padding: 4px; border-radius: 6px; }
.cv2-modal-h .x:hover { background: var(--bg-hover); color: var(--text-primary); }
.cv2-link { border: none; background: transparent; color: var(--text-link); font-size: 11.5px; cursor: pointer; font-family: var(--font-sans); }
.cv2-link:hover { text-decoration: underline; }
.cv2-arr-sum { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }
</style>
