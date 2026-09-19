<script setup lang="ts">
// 园区能耗(park-energy)v2 — spec §二.4:主图 s12 能量流桑基(购电/光伏消纳→售电(转供)/办公/充电,
// 值=选中期间金额,点边/节点→下方该板块月度趋势卡切换)+ 购售电月度组合 s6(对比开关 ['mom'])
// + 单位购电成本趋势 s6 + 板块损益横条 s12。
// 数据与口径 = v1(buildEnergyMonths 真实源;金额侧仅 s10 覆盖月同口径;数值锚点不变)。
// 桑基变换纯函数见 parkEnergy.logic.ts(守恒:流入=流出+轧差,单测 SQL 值验)。
import { computed, ref, watch } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import { fnum, hues, inkA, mean, sgn } from '@/components/ana/anaFmt'
import {
  buildEnergyMonths, fetchBudgetAll, fetchChargingYear, fetchElecYear, fetchPvAll, fetchS10Rows, fetchUtilitiesYear,
  type EnergyMonth,
} from '@/analysis/anaData'
import type { BudgetRowDTO } from '@/api/budget'
import {
  anchorS10Ym, BOARD_ZH, boardOfSankeyClick, boardSeries, buildAmtMonths, buildSankey, buildSankeyReading, comboSeries,
  HUB, type AmtMonth, type BoardKey,
} from './parkEnergy.logic'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import { usePeriod, ymOf, type PeriodSel } from '@/analysis/usePeriod'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import { useCompare, type CompareMode } from '@/analysis/useCompare'
import { iconFor } from '@/components/ds/icon'

// 复审①:电费收入/支出预算基准在库(budget_row 子行),预算=月均虚线;同比仍无月度基准(禁用)
const CMP: CompareMode[] = ['mom', 'budget']
const cmp = useCompare(CMP)
const budgetRows = ref<BudgetRowDTO[]>([])
// 当年购电预算(支出),取「其中:」子行 label 含 电费支出
// T4 图表清晰化:售电预算·月均线已移除(售电稀疏与柱不同域),电费收入预算不再取
const budgetElec = computed(() => {
  const y = view.value.year
  const rows = budgetRows.value.filter(r => r.year === y && r.budget != null)
  return {
    cost: rows.find(r => r.label.includes('电费支出'))?.budget ?? null,
  }
})

const period = usePeriod()
const loading = ref(true)
const failed = ref(false)
// 换年在途(C5-02):旧内容留在原地退让,不卸载;过 200ms 门才亮、到数立刻灭
const staleShown = useDeferredFlag(loading)
/** 已画在屏上的期间。sel 立刻变(控件回显),年要等数据一起换 —— 否则换年那一趟会拿新年月份去索引旧年数据
 *  (C5-02 ①)。同一年里切月 / 切粒度不打接口,直接跟 sel(下方 watch)。null = 还没有任何数据。 */
const shown = ref<PeriodSel | null>(null)
watch(() => period.sel.value, (s) => { if (s.year === shown.value?.year) shown.value = s })
const view = computed(() => shown.value ?? period.sel.value)
const months = ref<EnergyMonth[]>([])       // kWh+金额混合行(v1 同款,KPI/单位成本/损益用)
const amt = ref<AmtMonth[]>([])             // 金额侧逐月行(桑基/趋势/组合用)

let token = 0   // 年切竞态守卫(范式同 FinPnlView):过期响应弃写
async function load(year: number) {
  if (!year) return
  const t = ++token
  loading.value = true
  failed.value = false
  try {
    const [elec, chg7, chg8, off13, off14, pv, s10] = await Promise.all([
      fetchElecYear(year), fetchChargingYear(7, year), fetchChargingYear(8, year),
      fetchUtilitiesYear(13, year), fetchUtilitiesYear(14, year), fetchPvAll(), fetchS10Rows(),
    ])
    if (t !== token) return
    months.value = buildEnergyMonths(year, elec, pv, [chg7, chg8], [off13, off14], s10)
    amt.value = buildAmtMonths(year, elec, pv, [chg7, chg8], [off13, off14], s10)
    shown.value = { ...period.sel.value, year }
    const buds = await fetchBudgetAll().catch(() => [])   // 预算对比基准(无预算不阻塞)
    if (t === token) budgetRows.value = buds
  } catch {
    if (t === token) failed.value = true
  } finally {
    if (t === token) loading.value = false
  }
}
watch(() => period.sel.value.year, (y) => { void load(y) }, { immediate: true })

const isMonth = computed(() => view.value.gran === 'month')
const curYm = computed(() => ymOf(view.value.year, view.value.month))
// 页头期间跟已画的那一期走(拼法同 usePeriod().label)
const viewLabel = computed(() =>
  (period.months.value.length ? view.value.year + '年' + (isMonth.value ? view.value.month + '月' : '') : '—'))
const idx = computed(() => months.value.findIndex((m) => m.ym === curYm.value))

type NumKey = Exclude<keyof EnergyMonth, 'ym'>
// 当期聚合:按月 = 选中月该源值;按年 = 全年非 null Σ(全 null → null)—— v1 同款
function agg(key: NumKey): number | null {
  if (isMonth.value) return idx.value >= 0 ? months.value[idx.value][key] : null
  let sum: number | null = null
  for (const m of months.value) if (m[key] != null) sum = (sum ?? 0) + m[key]!
  return sum
}
function mom(key: NumKey): number | null {
  if (!isMonth.value || idx.value <= 0) return null
  const cur = months.value[idx.value][key]
  const prev = months.value[idx.value - 1][key]
  return cur != null && prev != null && prev !== 0 ? +((cur / prev - 1) * 100).toFixed(1) : null
}
const nonNull = (key: NumKey) => months.value.filter((m) => m[key] != null)

const buyKwh = computed(() => agg('buyKwh'))
const buyCost = computed(() => agg('buyCost'))
const pvSelf = computed(() => agg('pvSelfKwh'))
const pvGrid = computed(() => agg('pvGridKwh'))
const pvAmt = computed(() => agg('pvAmt'))
const pvGen = computed(() => (pvSelf.value == null && pvGrid.value == null ? null : (pvSelf.value ?? 0) + (pvGrid.value ?? 0)))
const chgProfit = computed(() => agg('chgProfit'))
const s10Elec = computed(() => agg('s10Elec'))
const supply = computed(() => (buyKwh.value == null ? null : buyKwh.value + (pvSelf.value ?? 0)))

// ── 单位购电成本(元/kWh):逐月 + 当期 vs 窗口均值(v1 同款) ──
const unitMonths = computed(() => months.value.filter((m) => m.buyKwh && m.buyCost != null))
const unitSeries = computed(() => unitMonths.value.map((m) => m.buyCost! / m.buyKwh!))
const unitLabels = computed(() => unitMonths.value.map((m) => +m.ym.slice(5, 7) + '月'))
const unitCur = computed(() => (buyKwh.value && buyCost.value != null ? buyCost.value / buyKwh.value : null))
const unitAvg = computed(() => mean(unitSeries.value))
const unitVsAvg = computed(() =>
  unitCur.value != null && unitAvg.value ? +((unitCur.value / unitAvg.value - 1) * 100).toFixed(1) : null)

// ── s10 覆盖(稀疏标注,诚实原则;金额侧同口径月集合) ──
const s10Covered = computed(() => nonNull('s10Elec').length)
const coverNote = computed(() => 's10 覆盖 ' + s10Covered.value + '/' + months.value.length + ' 期')
const coveredYms = computed<string[]>(() => {
  if (isMonth.value) return amt.value.some((m) => m.ym === curYm.value && m.s10Elec != null) ? [curYm.value] : []
  return amt.value.filter((m) => m.s10Elec != null).map((m) => m.ym)
})
function covAgg(key: NumKey): number | null {
  let sum: number | null = null
  for (const m of months.value) if (coveredYms.value.includes(m.ym) && m[key] != null) sum = (sum ?? 0) + m[key]!
  return sum
}

// ── KPI 条(值与 v1 statItems 完全一致) ──
// 首进/失败期不清空整排瓦片(C6-01):瓦片消失 = 下方整片先上提再下推。标签常驻、值写 '—'。
const KPI_LABELS = ['园区购电', '购电成本', '光伏发电', '光伏消纳占供电', '单位购电成本', '售电(转供)收入'] as const
const kpis = computed(() => (!shown.value || failed.value ? KPI_LABELS.map((label) => ({ label, value: '—', note: ' ', loading: !shown.value && !failed.value })) : [
  { label: '园区购电', value: buyKwh.value != null ? fnum(buyKwh.value / 10000, 1) + '万kWh' : '—', delta: mom('buyKwh'), kind: '环比', invert: true, note: isMonth.value ? undefined : '全年' },
  { label: '购电成本', value: buyCost.value != null ? '¥' + fnum(buyCost.value / 10000, 1) + '万' : '—', note: isMonth.value ? '本月' : '全年' },
  { label: '光伏发电', value: pvGen.value != null ? fnum(pvGen.value / 10000, 1) + '万kWh' : '—', note: pvGen.value ? '消纳 ' + ((pvSelf.value ?? 0) / pvGen.value * 100).toFixed(0) + '%' : undefined },
  { label: '光伏消纳占供电', value: supply.value && pvSelf.value != null ? (pvSelf.value / supply.value * 100).toFixed(1) + '%' : '—', note: pvGen.value != null ? '发电 ' + fnum(pvGen.value / 10000, 1) + '万kWh' : undefined },
  { label: '单位购电成本', value: unitCur.value != null ? unitCur.value.toFixed(2) + '元' : '—', delta: unitVsAvg.value, kind: '较窗口均值', invert: true },
  { label: '售电(转供)收入', value: s10Elec.value != null ? '¥' + fnum(s10Elec.value / 10000, 1) + '万' : '未录入', note: isMonth.value ? (s10Elec.value == null ? '附表10缺本月' : undefined) : coverNote.value },
]))

// ── 主图:能量流桑基(金额;点边/节点 → 下方板块趋势切换) ──
// 节点色按当前外观取(暗色深蓝换灰蓝)
const nodeColor = (h: ReturnType<typeof hues>): Record<string, string> => ({
  购电: h.blue, 光伏消纳: h.teal, [HUB]: h.mid, '售电(转供)': h.deep,
  办公: h.pale, 充电桩: h.coral, 损耗差额: h.red, 转供毛差: h.amber,
})
// §五策略2 桑基月锚:所选月无 s10 → 回退 ≤所选的最近 s10 月并横幅显式(年粒度沿用覆盖月同口径)。
// 板块损益/KPI 仍锚所选月(各自空态/「附表10缺本月」已显式,不混月)。
const s10Yms = computed(() => amt.value.filter((m) => m.s10Elec != null).map((m) => m.ym))
const sankeyUsedYm = computed(() => (isMonth.value ? anchorS10Ym(s10Yms.value, curYm.value) : null))
const sankeyYms = computed<string[]>(() =>
  isMonth.value ? (sankeyUsedYm.value ? [sankeyUsedYm.value] : []) : coveredYms.value)
const sankey = computed(() => buildSankey(amt.value, sankeyYms.value))
// C6 人话句(spec 2026-07-11 定稿模板):金额取运行时数据,residual 正负两分支;原守恒口径句退 AnaMethodNote 保留
const sankeyReading = computed(() => (sankey.value ? buildSankeyReading(sankey.value) : ''))
const sankeyOption = computed(() => {
  const s = sankey.value
  if (!s) return null
  const h = hues(), NODE_COLOR = nodeColor(h)
  return {
    tooltip: {
      formatter: (p: { dataType?: string; name?: string; value?: number; data?: { source?: string; target?: string; value?: number } }) =>
        p.dataType === 'edge'
          ? `${p.data?.source} → ${p.data?.target}<br/>¥${fnum((p.data?.value ?? 0) / 10000, 1)}万`
          : `${p.name}<br/>¥${fnum((p.value ?? 0) / 10000, 1)}万`,
    },
    series: [{
      type: 'sankey', left: 10, right: 96, top: 10, bottom: 10,
      nodeWidth: 14, nodeGap: 20, nodeAlign: 'justify', draggable: false,
      emphasis: { focus: 'adjacency' },
      label: { fontSize: 11.5, color: inkA(.8) },
      lineStyle: { color: 'gradient', opacity: 0.32, curveness: 0.55 },
      data: s.nodes.map((n) => ({ ...n, itemStyle: { color: NODE_COLOR[n.name] ?? h.pale } })),
      links: s.links,
    }],
  }
})
const board = ref<BoardKey>('s10')
function onSankeyClick(params: unknown) {
  const b = boardOfSankeyClick(params as Parameters<typeof boardOfSankeyClick>[0])
  if (b) board.value = b
}

// ── 板块月度趋势卡(随桑基点击切换) ──
const boardTrend = computed(() => boardSeries(amt.value, board.value))
const trendOption = computed(() => ({
  tooltip: { valueFormatter: (v: number) => '¥' + fnum(v, 1) + '万' },
  grid: { left: 52, right: 14, top: 14, bottom: 26 },
  xAxis: { type: 'category', data: boardTrend.value.yms.map((ym) => +ym.slice(5, 7) + '月') },
  yAxis: { type: 'value' },
  series: [{
    type: 'bar', barMaxWidth: 26, name: BOARD_ZH[board.value],
    data: boardTrend.value.values.map((v) => +(v / 10000).toFixed(2)),
    itemStyle: { color: board.value === 'residual' ? hues().amber : hues().blue, borderRadius: [3, 3, 0, 0] },
  }],
}))

// ── 购售电月度组合(T4 图表清晰化:双柱分组;环比灰虚线只叠购电;预算紫虚线只留购电预算·月均) ──
// 系列构建抽纯函数 comboSeries(parkEnergy.logic,单测覆盖);数据源与口径零变化,只换呈现。
const comboOption = computed(() => {
  const labels = months.value.map((m) => +m.ym.slice(5, 7) + '月')
  const buy = months.value.map((m) => (m.buyCost != null ? +(m.buyCost / 10000).toFixed(2) : null))
  const sell = months.value.map((m) => (m.s10Elec != null ? +(m.s10Elec / 10000).toFixed(2) : null))
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v != null ? '¥' + fnum(v, 1) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 46, right: 14, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value' },
    series: comboSeries(buy, sell, cmp.mode.value, budgetElec.value.cost),
  }
})

// ── 单位购电成本趋势(元/kWh,均值虚线) ──
const unitOption = computed(() => ({
  tooltip: { valueFormatter: (v: number) => v.toFixed(2) + ' 元/kWh' },
  grid: { left: 44, right: 14, top: 18, bottom: 26 },
  xAxis: { type: 'category', data: unitLabels.value, boundaryGap: false },
  yAxis: { type: 'value', scale: true },
  series: [{
    type: 'line', name: '单位购电成本', data: unitSeries.value.map((v) => +v.toFixed(4)),
    symbol: 'circle', symbolSize: 6, itemStyle: { color: hues().blue }, lineStyle: { width: 2, color: hues().blue },
    areaStyle: { opacity: 0.08, color: hues().blue },
    markLine: {
      silent: true, symbol: 'none',
      lineStyle: { type: 'dashed', color: inkA(.35) },
      // 默认 end 位置把标签画在线尾右侧,grid.right 只有 14px → 「均值 x.xx」被绘图区右缘裁掉一半;
      // 改 insideEndTop 让标签落在线内上方,读得出阈值
      label: { position: 'insideEndTop', fontSize: 11, formatter: '均值 ' + unitAvg.value.toFixed(2) },
      data: [{ yAxis: +unitAvg.value.toFixed(4) }],
    },
  }],
}))

// ── 能耗板块损益横条(v1 segs 同口径:转供=覆盖月售电−购电;光伏=消纳+上网;充电=毛利) ──
const segs = computed(() => {
  const out: { key: string; name: string; profit: number }[] = []
  const covS10 = covAgg('s10Elec'), covBuy = covAgg('buyCost')
  if (covS10 != null && covBuy != null) out.push({ key: 'resale', name: '电力转供', profit: covS10 - covBuy })
  if (pvAmt.value != null) out.push({ key: 'pv', name: '光伏', profit: pvAmt.value })
  if (chgProfit.value != null) out.push({ key: 'chg', name: '充电桩', profit: chgProfit.value })
  return out
})
const segsOption = computed(() => ({
  tooltip: { valueFormatter: (v: number) => (v < 0 ? '−' : '') + '¥' + fnum(Math.abs(v), 1) + '万' },
  grid: { left: 76, right: 76, top: 8, bottom: 22 },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', data: [...segs.value].reverse().map((s) => s.name) },
  series: [{
    type: 'bar', barMaxWidth: 22,
    data: [...segs.value].reverse().map((s) => ({
      value: +(s.profit / 10000).toFixed(1),
      itemStyle: { color: s.profit < 0 ? hues().red : hues().blue, borderRadius: 3 },
    })),
    label: { show: true, position: 'right', fontSize: 11, formatter: (p: { value: number }) => (p.value < 0 ? '−' : '') + '¥' + fnum(Math.abs(p.value), 1) + '万' },
  }],
}))
</script>

<template>
  <!-- §五:月敏感屏(full);桑基月锚回退以横幅显式 -->
  <AnaShell :compare="CMP" period-mode="full" :busy="staleShown">
    <template #kpis>
      <AnaKpiTile v-for="k in kpis" :key="k.label" v-bind="k" />
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。块高逐块照真版式钉死 ——
         页头 44(ana.css .ak-h-ic 40 / .ak-title 行盒 20 + .ak-sub margin-top 4 + 行盒 20;行盒 = base.css body
         line-height var(--lh-snug) = tokens.css 20px);卡头 20 + ana.css .av2-card-h margin-bottom 8 = 28;
         图块 = AnaSkelChart,高与各 AnaEChart 的 :height 字面值同表降档(300 / 170 / 250 / 250 / 170,anaChartHeight.ts)。
         KPI 行由 .anx-kpis min-height 94 + 常驻 '—' 瓦片兜位。数据到了原地硬切,不做淡入。
         只认首进(还没有任何一期画过):换年时旧内容留在原地退让(C5-02),不退回骨架、不卸载图。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <div v-if="loading && !shown" class="ak-page ak-skel">
      <!-- 页头与卡头照抄真版式(手机上会折行,灰条顶不住);随数据变的字换成同长的隐形占位。
           桑基卡下的人话句跟数据出没,库里现有数据有,骨架按「有」留位。 -->
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('zap')" :size="20" /></span>
          <div>
            <h2 class="ak-title">园区能耗</h2>
            <p class="ak-sub">能量流(金额)· 购电 vs 售电(转供)· 单位成本 · 板块损益 · 期间 <span class="ana-hole">0000年00月</span></p>
          </div>
        </div>
      </div>
      <div class="av2-grid">
        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">能量流桑基 · <span class="ana-hole">{{ period.sel.value.gran === 'month' ? '本月' : 's10 覆盖月同口径(00 期)' }}</span></span>
            <span class="hint">金额(元)<span class="hint-desk">· 点边/节点切换下方板块趋势</span></span>
          </div>
          <AnaSkelChart :height="300" />
          <p class="pe-reading"><span class="ana-hole">本期园区买电 ¥00.0万,光伏自用 ¥00.0万;向租户售电 ¥000.0万,办公/充电自用 ¥0.0万;差额 ¥00.0万 为转供加价收益</span></p>
        </div>
        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">板块月度趋势 · {{ BOARD_ZH[board] }}</span>
            <span class="hint">万元<span class="hint-desk"> · 点上方桑基切换板块</span></span>
          </div>
          <AnaSkelChart :height="170" />
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">购售电月度组合</span><span class="hint">万元 · 售电仅 s10 覆盖月有数 · 环比线仅购电(售电稀疏不适用)</span></div>
          <AnaSkelChart :height="250" />
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">单位购电成本趋势</span><span class="hint">元/kWh · 当期较窗口均值 <span class="ana-hole">−0.0%</span></span></div>
          <AnaSkelChart :height="250" />
        </div>
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">能耗板块损益</span><span class="hint"><span class="ana-hole">本月</span> · 净额万元(红＝亏损)</span></div>
          <AnaSkelChart :height="170" />
        </div>
      </div>
    </div>
    <!-- skel:end -->
    <AnaEmpty v-else-if="failed" label="数据加载失败" hint="请刷新重试" />
    <!-- data-stale-host 常挂:类摘掉后仍有 transition-property,退场才是 200 而不是硬切 -->
    <div v-else class="ak-page" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('zap')" :size="20" /></span>
          <div>
            <h2 class="ak-title">园区能耗</h2>
            <p class="ak-sub">能量流(金额)· 购电 vs 售电(转供)· 单位成本 · 板块损益 · 期间 {{ viewLabel }}</p>
          </div>
        </div>
      </div>

      <div class="av2-grid">
        <!-- av2-core:本屏无 s8,人工指定核心图——桑基是全屏信息密度最高的主图(四源金额流+守恒口径),且驱动下方板块趋势联动 -->
        <div class="av2-card av2-s12 av2-core">
          <div class="av2-card-h">
            <span class="t">能量流桑基 · {{ isMonth ? '本月' : 's10 覆盖月同口径(' + coveredYms.length + ' 期)' }}</span>
            <span class="hint">金额(元)<span class="hint-desk">· 点边/节点切换下方板块趋势</span></span>
          </div>
          <!-- §五策略2:所选月无售电 → 桑基锚定最近 s10 覆盖月,卡顶横幅(禁静默) -->
          <AnaPeriodBanner v-if="sankeyUsedYm && sankeyUsedYm !== curYm" :selected="curYm" :used="sankeyUsedYm"
            source="售电(附表10)" style="margin-bottom: 8px" />
          <AnaEChart v-if="sankeyOption" :option="sankeyOption" :height="300" @chart-click="onSankeyClick" />
          <!-- 该期间售电(附表10)未录 → 空态引导深链,不画假图 -->
          <AnaEmpty v-else label="该期间售电(附表10)未录入" hint="s10 为稀疏月度表,金额口径能量流暂不可算" to="/sales-income" to-text="去录入销售收入" />
          <!-- C6:生成式人话句(数据模板);守恒口径原句退下方 AnaMethodNote 保留 -->
          <p v-if="sankey" class="pe-reading">{{ sankeyReading }}</p>
        </div>

        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">板块月度趋势 · {{ BOARD_ZH[board] }}</span>
            <span class="hint">万元<span class="hint-desk"> · 点上方桑基切换板块</span></span>
          </div>
          <AnaEChart v-if="boardTrend.yms.length" :option="trendOption" :height="170" />
          <AnaEmpty v-else label="该板块本年无数据" hint="换个板块或期间再看" />
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">购售电月度组合</span><span class="hint">万元 · 售电仅 s10 覆盖月有数 · 环比线仅购电(售电稀疏不适用)</span></div>
          <AnaEChart :option="comboOption" :height="250" />
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">单位购电成本趋势</span><span class="hint">元/kWh · 当期较窗口均值 {{ unitVsAvg != null ? sgn(unitVsAvg) : '—' }}</span></div>
          <AnaEChart v-if="unitSeries.length" :option="unitOption" :height="250" />
          <AnaEmpty v-else label="本年无购电数据" to="/elec-cost" to-text="去录入电费成本" />
        </div>

        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">能耗板块损益</span><span class="hint">{{ isMonth ? '本月' : '本年' }} · 净额万元(红＝亏损)</span></div>
          <AnaEChart v-if="segs.length" :option="segsOption" :height="170" />
          <AnaEmpty v-else label="本期无可算板块" hint="电力转供需同月购电(附表11)与售电(附表10)同时在库" />
        </div>
      </div>

    </div>
  </AnaShell>
</template>

<style scoped>
/* C6 桑基人话句:比 AnaMethodNote 醒目一档(正文次级色) */
.pe-reading { font-size: 12px; color: var(--text-secondary); margin: 10px 0 0; line-height: 1.5; }
</style>
