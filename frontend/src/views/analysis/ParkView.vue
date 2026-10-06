<script setup lang="ts">
// 出租与楼栋(park)— 2026-10 改稿(画布画板 park-v2 默认 / park-v2-b 点进一期 A座 / park-v2-d 点进没建单元的楼;图 = 规格)。
// KPI 4:出租率(按单元)/ 合同月租合计 / 有在租合同的租户 / 楼栋。
// 主卡 s8「各栋合同月租和单元」:一栋一行,左合同月租横条、右单元租出/空着;点楼栋(柱或名字)→ 右栏合同明细只列这栋
// (07-08 用户定的联动保留),再点同一栋 / × 取消。右栏 s4:合同明细(露 8 行 + 看全部合同)叠在各期区合同月租横条上。
// 下面两张 s12:各栋户数和合同月租散点、面积转换。屏上每一句字从句型库 anaSentence 的 PARK 段出(画板逐字对过)。
// 口径不变:在租合同 = active/expiring(park.logic.liveContracts);单元租出 = 单元数 − 空单元(BuildingDTO,同楼栋管理 KPI)。
// 这屏不随期间变:工具条写「按 {今天} 在租的合同」(产品在租状态按今天派生)。
// 数据变换纯函数见 park.logic.ts(单测 park.logic.spec.ts)。
import { computed, onMounted, ref, watch } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import { esc, fint, hues, inkA } from '@/components/ana/anaFmt'
import { anaPalette } from '@/components/ana/anaTheme'
import * as S from '@/components/ana/anaSentence'
import { useViewport } from '@/composables/useViewport'
import { fetchBuildingDetail, fetchBuildings, fetchBuildingSummary, fetchContracts, fetchTenants } from '@/analysis/anaData'
import { buildBuildingRows, buildPhaseRows, crossBuildings, liveContracts, unitOcc, vacantByFloor } from './park.logic'
import { iconFor } from '@/components/ds/icon'
import { canReach } from '@/nav/navAccess'
import { useViewGate } from '@/composables/useViewGate'
import { useAuthStore } from '@/stores/auth'
import type { BuildingDTO, BuildingSummaryDTO } from '@/types/building'
import { RENT_AREA_FACTOR, type ContractDTO } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'

const PK = S.PARK
const auth = useAuthStore()
const { lack } = useViewGate()

// S 档(≤600):明细表换两行行卡、散点与面积转换进「更多分析」折叠,主卡横条收窄几何。判视口不判容器(挂载前就判得出)。
const { tier } = useViewport()
const isS = computed(() => tier.value === 's')
const moreOpen = ref(false)

const loading = ref(true)
const failed = ref(false)
const buildings = ref<BuildingDTO[]>([])
const bSummary = ref<BuildingSummaryDTO | null>(null)   // 只取 occRate(按面积的出租率,缺分母时为 null)
const contracts = ref<ContractDTO[]>([])
const tenants = ref<TenantDTO[]>([])
const today = () => new Date().toLocaleDateString('sv-SE')   // sv-SE = YYYY-MM-DD,按本机时区(同 ContractDrawer todayStr)
const day = ref(today())   // 读到数据那天(在租按今天派生),工具条「按 X 在租的合同」;每次重读刷新

// 切回重读 / 点重试都重跑 reload:失败标志只在成功分支清(重试在途时失败卡留在原地)。两趟叠着发只认最后一趟。
let seq = 0
async function reload() {
  const my = ++seq
  try {
    const [bs, sum, cs, ts] = await Promise.all([
      fetchBuildings(), fetchBuildingSummary(), fetchContracts(), fetchTenants(),
    ])
    if (my !== seq) return
    ;[buildings.value, bSummary.value, contracts.value, tenants.value] = [bs, sum, cs, ts]
    day.value = today()
    failed.value = false
  } catch {
    if (my === seq) failed.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}
onMounted(reload)
onReactivated(() => { void reload() })

const live = computed(() => liveContracts(contracts.value))
const rows = computed(() => buildBuildingRows(buildings.value, live.value))
const phases = computed(() => buildPhaseRows(buildings.value, live.value))
const bById = computed(() => new Map(buildings.value.map((b) => [b.id, b])))
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const totalRentWan = computed(() => sum(rows.value.map((r) => r.rentWan)))
const rentedCount = computed(() => rows.value.filter((r) => r.rentWan > 0).length)
const nTen = computed(() => new Set(live.value.map((c) => c.tenantId)).size)
const activeTenants = computed(() => tenants.value.filter((t) => t.status === 1).length)
const uTot = computed(() => sum(buildings.value.map((b) => b.unitCount)))
const uOcc = computed(() => sum(buildings.value.map(unitOcc)))
const occRate = computed(() => (uTot.value > 0 ? Math.round((uOcc.value / uTot.value) * 1000) / 10 : null))
const asofText = computed(() => S.asofLive(S.dayLabel(day.value)))

// ── KPI 条 ──(首进/失败期不清空整排瓦片:标签常驻、值写 '—')
const KPI_LABELS = [PK.occTile, PK.tile.rent, PK.tile.tenants, PK.tile.bld] as const
const kpis = computed(() => (loading.value || failed.value ? KPI_LABELS.map((label) => ({ label, value: '—', note: ' ', loading: loading.value })) : [
  { label: PK.occTile, value: occRate.value != null ? occRate.value.toFixed(1) + '%' : '—', note: S.unitNote(uOcc.value, uTot.value) },
  { label: PK.tile.rent, value: S.yuan(totalRentWan.value), note: S.liveNote(live.value.length) },
  { label: PK.tile.tenants, value: nTen.value + ' 户', note: S.tenantNote(activeTenants.value) },
  { label: PK.tile.bld, value: rows.value.length + ' 栋', note: S.bldNote(rentedCount.value) },
]))

// ── 主卡:各栋合同月租和单元(一栋一行,按合同月租排;30 栋全画,行高 14 让两句读数句回到首屏) ──
const selected = ref<string | null>(null)   // 楼栋名
const ROW = 14, TOP = 24
const mainH = computed(() => TOP + rows.value.length * ROW + 2)
const mainOption = computed(() => {
  const pal = anaPalette(), h = hues(), sel = selected.value, rs = rows.value
  // 左栏楼栋名定宽,合同月租横条与单元横条按卡宽比例分(画板 619 宽:名 120、月租 250、单元起于 432、右留 40)
  const nameW = isS.value ? 92 : 120
  const dim = (name: string) => !!sel && name !== sel
  // 没选中的楼栋只淡柱子;柱端字降到墨 62% 但不跟着透明
  const item = (name: string, v: number) => ({ value: v, itemStyle: { opacity: dim(name) ? 0.35 : 1 }, label: dim(name) ? { color: pal.label, opacity: 1 } : undefined })
  const unitOf = (id: number) => bById.value.get(id)
  const hasUnits = (id: number) => (unitOf(id)?.unitCount ?? 0) > 0
  const yCat = (gi: number, show: boolean) => ({
    gridIndex: gi, type: 'category', inverse: true, data: rs.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, triggerEvent: show,
    axisLabel: show
      ? { interval: 0, fontSize: 11, color: pal.legend, formatter: (v: string) => (v === sel ? `{b|${v}}` : v), rich: { b: { fontWeight: 600, color: inkA(1), fontSize: 11 } } }
      : { show: false },
  })
  const opt = {
    tooltip: {
      trigger: 'item',
      formatter: (p: { dataIndex: number; seriesIndex: number }) => {
        const r = rs[p.dataIndex], b = r && unitOf(r.id)
        if (!r) return ''
        return `${esc(r.name)}<br/>${PK.rentHead} ${S.yuan(r.rentWan)}` + (b && b.unitCount ? `<br/>${PK.unitLegend[0]} ${S.unitLabel(unitOcc(b), b.unitCount)}` : `<br/>${PK.noUnitTag}`)
      },
    },
    title: { text: PK.rentHead, left: nameW, top: 4, textStyle: { fontSize: 11, fontWeight: 'normal', color: pal.label } },
    legend: { data: [...PK.unitLegend], left: '70%', top: 2, itemGap: 10 },
    grid: [{ left: nameW, top: TOP, bottom: 2, width: '40%' }, { left: '70%', right: 40, top: TOP, bottom: 2 }],
    xAxis: [
      { gridIndex: 0, type: 'value', show: false, max: Math.max(...rs.map((r) => r.rentWan), 1) },
      { gridIndex: 1, type: 'value', show: false, max: Math.max(...buildings.value.map((b) => b.unitCount), 1) },
    ],
    yAxis: [yCat(0, true), yCat(1, false)],
    series: [
      { type: 'bar', xAxisIndex: 0, yAxisIndex: 0, barWidth: 9, itemStyle: { color: h.blue },
        label: { show: true, position: 'right', fontSize: 11, color: pal.legend, formatter: (p: { value: number }) => (p.value > 0 ? S.yuan(p.value) : PK.zero) },
        data: rs.map((r) => item(r.name, +r.rentWan.toFixed(2))) },
      { name: PK.unitLegend[0], type: 'bar', stack: 'u', xAxisIndex: 1, yAxisIndex: 1, barWidth: 9, itemStyle: { color: h.deep },
        data: rs.map((r) => (hasUnits(r.id) ? item(r.name, unitOcc(unitOf(r.id)!)) : null)) },
      { name: PK.unitLegend[1], type: 'bar', stack: 'u', xAxisIndex: 1, yAxisIndex: 1, barWidth: 9, itemStyle: { color: inkA(0.12) },
        label: { show: true, position: 'right', fontSize: 11, color: pal.legend,
          formatter: (p: { dataIndex: number }) => { const b = unitOf(rs[p.dataIndex].id)!; return S.unitLabel(unitOcc(b), b.unitCount) } },
        data: rs.map((r) => (hasUnits(r.id) ? item(r.name, unitOf(r.id)!.vacantCount) : null)) },
      // 没建单元的楼:单元那一栏写字不画条(散点默认 opacity .8 会把字压淡,钉成 1)
      { type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, symbolSize: 0, silent: true, itemStyle: { opacity: 1 },
        label: { show: true, position: 'right', distance: 0, fontSize: 11, color: pal.label, formatter: PK.noUnitTag },
        data: rs.filter((r) => !hasUnits(r.id)).map((r) => [0, r.name]) },
    ],
  }
  if (!isS.value) return opt
  // S 档(≤600)卡内只剩 ~250px,放不下名字 + 月租条 + 单元条三栏:单元那栏不画,月租条吃满
  // (全园按单元出租率在屏顶 KPI,空单元读数句照出)
  return { ...opt, legend: undefined, grid: [{ left: nameW, top: TOP, bottom: 2, right: 52 }],
    xAxis: opt.xAxis.slice(0, 1), yAxis: opt.yAxis.slice(0, 1), series: opt.series.slice(0, 1) }
})
// 点柱子(params.name)或点左边楼栋名(yAxis triggerEvent,params.value)都算点这一栋
function onMainClick(params: unknown) {
  const p = params as { componentType?: string; name?: string; value?: unknown }
  const name = p.componentType === 'yAxis' ? String(p.value ?? '') : p.name
  if (!name || !rows.value.some((r) => r.name === name)) return
  selected.value = selected.value === name ? null : name
}
const withUnits = computed(() => buildings.value.filter((b) => b.unitCount > 0))
const rentRead = computed(() => S.concentration({ what: PK.rentHead, by: PK.byRentShort, items: rows.value.map((r) => ({ name: r.name, value: r.rentWan })), q: '栋' })?.text)
const vacRead = computed(() => S.concentration({ what: PK.byVacant, by: PK.byVacant, items: withUnits.value.map((b) => ({ name: b.name, value: b.vacantCount })), q: '栋' })?.text)
// 两句都是集中度 → 参照先写两句各自的样本量;再照实说没建单元的楼、有单元租出却没有本栋在租合同的楼
const mainRefs = computed(() => {
  const noUnit = buildings.value.length - withUnits.value.length
  const cross = crossBuildings(rows.value, bById.value)
  return [
    S.mainBase(live.value.length, withUnits.value.length, sum(withUnits.value.map((b) => b.vacantCount))),
    noUnit ? S.thin({ noUnit }).text : '',
    cross.length ? S.thin({ cross }).text : '',
  ].filter(Boolean)
})

// ── 右栏上:合同明细(一行一份合同;没选楼栋 = 全园区;露前 8 行,其余去合同管理看) ──
// sp-ask2 第 4 条(用户 10-05 按推荐定):画板 10 行 → 8 行,右栏变矮,主卡底下少空一截。
const DETAIL_N = 8
const selB = computed(() => (selected.value ? buildings.value.find((b) => b.name === selected.value) ?? null : null))
const detailAll = computed(() => (selB.value ? live.value.filter((c) => c.buildingId === selB.value!.id) : live.value)
  .slice().sort((a, x) => x.monthlyRent - a.monthlyRent))
const detailRows = computed(() => detailAll.value.slice(0, DETAIL_N))
const noEnd = computed(() => detailAll.value.filter((c) => !c.endDate).length)
// 点进一栋:楼层读数句要这栋的单元(楼层 + 状态),按需取一次(anaData 缓存);读不到就不出这句,不挡明细
const floors = ref<{ id: number; floors: { floor: number; n: number }[] } | null>(null)
watch(() => selB.value?.id, async (id) => {
  floors.value = null
  if (id == null || !selB.value?.unitCount) return
  try {
    const d = await fetchBuildingDetail(id)
    if (selB.value?.id === id) floors.value = { id, floors: vacantByFloor(d.building.floorCount, d.units) }
  } catch { /* 楼层句闭嘴,明细照常 */ }
})
const unitRead = computed(() => {
  const b = selB.value
  if (!b) return null
  if (!b.unitCount) return S.thin({ bldNoUnit: true }).text
  const f = floors.value
  return f && f.id === b.id ? S.floorRun({ what: PK.unit.st.vacant, floors: f.floors })?.text ?? null : null
})

// ── 右栏下:各期区合同月租(横条直接标名、金额和占比,不靠颜色分期区) ──
const phaseH = computed(() => phases.value.length * 30 + 4)
const phaseOption = computed(() => {
  const pal = anaPalette(), ps = phases.value, tot = sum(ps.map((p) => p.rentWan))
  return {
    grid: { left: 40, right: 112, top: 2, bottom: 2 },
    xAxis: { type: 'value', show: false, max: Math.max(...ps.map((p) => p.rentWan), 1e-9) },
    yAxis: { type: 'category', inverse: true, data: ps.map((p) => p.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 11, color: pal.legend } },
    series: [{ type: 'bar', barWidth: 12, itemStyle: { color: hues().blue }, data: ps.map((p) => +p.rentWan.toFixed(2)),
      label: { show: true, position: 'right', fontSize: 11, color: pal.legend,
        formatter: (p: { dataIndex: number }) => S.shareLabel(ps[p.dataIndex].rentWan, tot > 0 ? ps[p.dataIndex].rentWan / tot * 100 : 0) } }],
  }
})
const phaseRead = computed(() => S.concentration({ what: PK.rentHead, by: PK.byRentShort, items: phases.value.map((p) => ({ name: p.name, value: p.rentWan })), q: '个期区' })?.text)

// ── 各栋户数和合同月租(线性轴,全部楼栋;只给读数句点到的户均最高 / 最低两栋标名) ──
const perHead = computed(() => S.extremes({ metric: PK.perHead, fmt: S.yi,
  items: rows.value.filter((r) => r.tenants > 0).map((r) => ({ label: r.name, value: r.rentWan * 10000 / r.tenants })) }))
const overlapRef = computed(() => S.overlap({ n: rows.value.filter((r) => r.tenants === 0 && r.rentWan === 0).length, q: '栋', what: PK.noLive, where: PK.origin })?.text)
const scatterOption = computed(() => {
  const pal = anaPalette(), ex = perHead.value
  const marked = new Set(ex ? [ex.hi.label, ex.lo.label] : [])
  const xMax = Math.max(...rows.value.map((r) => r.tenants), 1)
  return {
    tooltip: {
      formatter: (p: { name: string; value: [number, number] }) => {
        const r = rows.value.find((x) => x.name === p.name)
        return `${esc(p.name)}<br/>${p.value[0]} 户 · ${S.yuan(p.value[1])}` + (r && r.tenants ? `<br/>${PK.perHead} ${S.yi(r.rentWan * 10000 / r.tenants)}` : '')
      },
    },
    grid: { left: 52, right: 24, top: 30, bottom: 34 },   // top 30:纵轴名不顶出图框
    xAxis: { type: 'value', name: PK.scatterX, nameLocation: 'middle', nameGap: 22, nameTextStyle: { fontSize: 11, color: pal.label } },
    yAxis: { type: 'value', name: PK.scatterY, nameTextStyle: { fontSize: 11, color: pal.label, align: 'left' } },
    series: [{ type: 'scatter', symbolSize: 10,
      data: rows.value.map((r) => ({ name: r.name, value: [r.tenants, +r.rentWan.toFixed(2)],
        itemStyle: { color: hues().blue, opacity: marked.has(r.name) ? 1 : 0.55 },
        // 靠右边的点把名字写在上面,免得出框
        label: marked.has(r.name)
          ? { show: true, formatter: r.name, position: r.tenants > xMax * 0.6 ? 'top' : 'right', fontSize: 11, color: pal.legend, textBorderColor: pal.calloutCore, textBorderWidth: 3 }
          : { show: false } })) }],
  }
})

// ── 面积转换(07-15 用户定的卡;覆盖率常显,算不了的照说) ──
// 只聚合「有面积数据」(建筑>0 且租赁>0)的在租合同;N=0 整卡空态引导补录,不画 0。
const bAreaOf = (c: ContractDTO): number => Number(c.buildingArea ?? 0)
const areaLive = computed(() => live.value.filter((c) => bAreaOf(c) > 0 && c.rentArea > 0))
const areaStats = computed(() => {
  const sumB = sum(areaLive.value.map(bAreaOf)), sumR = sum(areaLive.value.map((c) => c.rentArea))
  const parkArea = sum(buildings.value.map((b) => b.totalArea))
  return {
    n: areaLive.value.length, m: live.value.length, sumB, sumR,
    parkAreaN: buildings.value.filter((b) => b.totalArea > 0).length,
    rentableN: buildings.value.filter((b) => b.rentableArea > 0).length,
    factor: sumR > 0 ? sumB / sumR : null,
    // 平均分摊率 = 在租建筑 ÷ 楼栋建筑。分母≤0 或分子>分母(数据自相矛盾)→ null,同后端 occRateOf
    share: parkArea > 0 && sumB <= parkArea ? (sumB / parkArea) * 100 : null,
  }
})
const areaOcc = computed(() => bSummary.value?.occRate ?? null)
const areaRows = computed(() => buildings.value.map((b) => {
  const cs = areaLive.value.filter((c) => c.buildingId === b.id)
  return { name: b.name, building: sum(cs.map(bAreaOf)), rent: sum(cs.map((c) => c.rentArea)) }
}).filter((r) => r.building > 0).sort((a, b) => b.building - a.building))
const areaRead = computed(() => S.baseline({ items: areaRows.value.map((r) => ({ name: r.name, value: r.building / r.rent })), base: RENT_AREA_FACTOR, q: '栋' })?.text)
const areaOption = computed(() => {
  const h = hues(), rs = areaRows.value, rot = rs.length > 8
  return {
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps: { seriesName: string; name: string; value: number }[]) => `${esc(ps[0]?.name)}<br/>` + ps.map((p) => `${esc(p.seriesName)} ${S.sqm(p.value)}`).join('<br/>'),
    },
    legend: { top: 0, data: [...PK.areaLegend] },
    grid: { left: 56, right: 12, top: 28, bottom: rot ? 64 : 26 },
    xAxis: { type: 'category', data: rs.map((r) => r.name), axisLabel: { fontSize: 11, interval: 0, rotate: rot ? 30 : 0 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => S.sqm(v) } },
    series: [
      { name: PK.areaLegend[0], type: 'bar', barMaxWidth: 12, itemStyle: { color: h.deep }, data: rs.map((r) => +r.building.toFixed(2)) },
      { name: PK.areaLegend[1], type: 'bar', barMaxWidth: 12, itemStyle: { color: h.mid }, data: rs.map((r) => +r.rent.toFixed(2)) },
    ],
  }
})
</script>

<template>
  <!-- 期间无关屏:隐期间控件;屏名进工具条,右端写「按哪天在租的合同」 -->
  <AnaShell period-mode="none" :asof-text="asofText">
    <template #tools>
      <span class="pk-name"><component :is="iconFor('building-2')" :size="15" />{{ PK.screen }}</span>
    </template>
    <template #kpis>
      <AnaKpiTile v-for="k in kpis" :key="k.label" v-bind="k" pct-unit />
    </template>

    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着)。
         卡头、读数句、参照照抄真版式,数字换成同长的隐形占位。主卡图高按库里现有 30 栋(24 + 30×14 + 2 = 446)、
         期区横条按现有 4 个期区(4×30 + 4 = 124)、主卡参照按现有 3 行、明细表按 8 行(浏览器 1440 宽实测)留;
         数据形状变了,首进会差出那几行。KPI 行由 .anx-kpis min-height 兜位。数据到了原地硬切,不做淡入。 -->
    <div v-if="loading" class="ak-page ak-skel">
      <div class="av2-grid">
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">{{ PK.card.main }}</span><span class="hint">{{ S.hint(PK.allBld, PK.byRent) }}</span></div>
          <div class="fp-shim" style="height: 446px"></div>
          <p class="ana-read"><span class="ana-hole">合同月租的 00.0% 在最多的 0 栋</span></p>
          <p class="ana-read"><span class="ana-hole">空单元的 00.0% 在一期 宿舍四栋、一期 某座</span></p>
          <p class="ana-ref"><span class="ana-hole">按 000 份在租合同、00 栋的 000 个空单元算</span></p>
          <p class="ana-ref"><span class="ana-hole">有 0 栋没建单元，算不了这几栋的出租率</span></p>
          <p class="ana-ref"><span class="ana-hole">一期 空地租出的 0 个单元记在别栋的合同上</span></p>
        </div>
        <div class="pk-col av2-s4">
          <div class="av2-card">
            <div class="av2-card-h"><span class="t">{{ S.tenantTitle(PK.card.detail, PK.all) }}</span><span class="hint"><span class="ana-hole">000 份 · 元</span></span></div>
            <div v-if="isS" class="fp-shim" style="height: 448px"></div>
            <div v-else class="fp-shim" style="height: 334px"></div>
            <p class="ana-ref"><span class="ana-hole">000 份没写到期日，都按在租算</span></p>
            <div class="pk-foot"><span class="pk-cue">{{ PK.pickCue }}</span><span class="pk-all ana-hole">{{ PK.viewAll }}</span></div>
          </div>
          <div class="av2-card">
            <div class="av2-card-h"><span class="t">{{ PK.card.phase }}</span><span class="hint"><span class="ana-hole">0 个期区 · 万元</span></span></div>
            <div class="fp-shim" style="height: 124px"></div>
            <p class="ana-read"><span class="ana-hole">合同月租的 00.0% 在一期</span></p>
            <p class="ana-ref"><span class="ana-hole">合同月租按 000 份在租合同算</span></p>
          </div>
        </div>
        <button v-if="isS" type="button" class="ak-foldbar" disabled tabindex="-1">
          <b>更多分析</b>
          <span class="sub">{{ PK.card.scatter }} · {{ PK.card.area }}</span>
          <span class="n">2 块</span>
        </button>
        <div class="av2-card av2-s12 pk-more" :class="{ 'is-open': moreOpen }">
          <div class="av2-card-h"><span class="t">{{ PK.card.scatter }}</span><span class="hint">{{ S.hint(PK.allBld, '万元') }}</span></div>
          <AnaSkelChart :height="260" />
          <p class="ana-read"><span class="ana-hole">户均最高 一期 G座 ¥000,000，最低 散租宿舍 ¥000</span></p>
          <p class="ana-ref"><span class="ana-hole">0 栋没有在租合同，叠在原点</span></p>
        </div>
        <div class="av2-card av2-s12 pk-more" :class="{ 'is-open': moreOpen }">
          <div class="av2-card-h"><span class="t">{{ PK.card.area }}</span><span class="hint"><span class="ana-hole">00/000 份合同录了面积 · ㎡</span></span></div>
          <div class="pk-area-body">
            <div class="pk-area-metrics ana-hole">
              <div class="pk-am"><div class="v">0.00</div><div class="l">{{ PK.factorLabel }}</div><div class="s">建筑 000,000㎡，租赁 000,000㎡</div><div class="s">约定按 0.0 换算</div></div>
              <div class="pk-am"><div class="l">{{ PK.shareLabel }}</div><div class="pk-thin">只有 0 栋录了楼栋建筑面积，算不了平均分摊率</div></div>
              <div class="pk-am"><div class="l">{{ PK.areaOccLabel }}</div><div class="pk-thin">只有 0 栋录了可租面积，算不了按面积的出租率</div></div>
            </div>
            <div class="pk-area-chart"><AnaSkelChart :height="280" /></div>
          </div>
        </div>
      </div>
    </div>
    <!-- skel:end -->
    <!-- 加载失败(画布 06-D 右格):换掉内容区,带重试;重试走同一个 reload(首进 / 切回共用) -->
    <FPLoadError v-else-if="failed" sub="屏上不显示上一次读到的数字" @retry="reload">楼栋、合同和租户数据没读到</FPLoadError>
    <div v-else class="ak-page">
      <div class="av2-grid">
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">{{ PK.card.main }}</span><span class="hint">{{ S.hint(PK.allBld, PK.byRent) }}</span></div>
          <AnaEChart :option="mainOption" :height="mainH" @chart-click="onMainClick" />
          <p class="ana-read hold"><template v-if="rentRead">{{ rentRead }}</template></p>
          <p class="ana-read hold"><template v-if="vacRead">{{ vacRead }}</template></p>
          <p v-for="t in mainRefs" :key="t" class="ana-ref">{{ t }}</p>
        </div>

        <div class="pk-col av2-s4">
          <div class="av2-card">
            <div class="av2-card-h">
              <span class="t">{{ S.tenantTitle(PK.card.detail, selected ?? PK.all) }}</span>
              <span class="hint">{{ S.hint(S.coverN(detailAll.length, '份', ''), '元') }}</span>
              <button v-if="selected" class="pk-clear" @click="selected = null">{{ PK.clear }}</button>
            </div>
            <div class="pk-tbl-wrap">
              <table v-if="!isS" class="ak-tbl pk-tbl">
                <thead><tr><th v-for="t in PK.th" :key="t">{{ t }}</th></tr></thead>
                <tbody>
                  <tr v-for="c in detailRows" :key="c.id">
                    <td>{{ c.tenantName }}</td>
                    <td class="mono">{{ fint(c.monthlyRent) }}</td>
                    <td class="mono mut">{{ c.endDate ?? PK.noEnd }}</td>
                  </tr>
                </tbody>
              </table>
              <!-- S 档两行行卡:3 列表每列 ~110px 放不下长户名;第二行补楼栋名(手机上主卡堆在上面,未选中时不写楼栋就不知道这户在哪) -->
              <div v-else class="pk-rows">
                <div v-for="c in detailRows" :key="c.id" class="pk-rc">
                  <div class="r1"><span class="nm">{{ c.tenantName }}</span><span class="v mono">{{ S.yi(c.monthlyRent) }}</span></div>
                  <div class="r2"><span>{{ bById.get(c.buildingId)?.name ?? '' }}</span><span class="mono">{{ PK.th[2] }} {{ c.endDate ?? PK.noEnd }}</span></div>
                </div>
              </div>
            </div>
            <!-- 点进一栋才有楼层读数句(用户点出来的,不是数据到达,不进骨架) -->
            <template v-if="selected"><p class="ana-read hold"><template v-if="unitRead">{{ unitRead }}</template></p></template>
            <p class="ana-ref hold"><template v-if="noEnd">{{ S.thin({ noEnd }).text }}</template></p>
            <!-- 单元格子只在楼栋管理的楼栋弹窗里画(10-04 用户定方案 B);楼栋管理页不认深链,只跳到页 -->
            <div v-if="selB && (canReach('/buildings', auth.navLayers, auth.can) || lack('/buildings'))" class="pk-unit">
              <RouterLink v-if="canReach('/buildings', auth.navLayers, auth.can)" class="pk-go" to="/buildings">{{ selB.unitCount ? PK.unit.see : PK.unit.go }}</RouterLink>
              <span v-else class="pk-go off" v-tip="lack('/buildings')">{{ selB.unitCount ? PK.unit.see : PK.unit.go }}</span>
            </div>
            <div class="pk-foot">
              <!-- 「左边」只在桌面成立;手机上主卡堆在上面,这句不出 -->
              <span v-if="!selected" class="pk-cue">{{ PK.pickCue }}</span>
              <!-- 合同管理页没有按楼栋筛的深链(只认 ?contractNo=),只跳到页 -->
              <RouterLink v-if="DETAIL_N < detailAll.length && canReach('/contracts', auth.navLayers, auth.can)"
                          class="pk-all" to="/contracts">{{ PK.viewAll }}</RouterLink>
              <span v-else-if="DETAIL_N < detailAll.length && lack('/contracts')" class="pk-all off" v-tip="lack('/contracts')">{{ PK.viewAll }}</span>
            </div>
          </div>

          <div class="av2-card">
            <div class="av2-card-h"><span class="t">{{ PK.card.phase }}</span><span class="hint">{{ S.hint(S.coverN(phases.length, '个期区', ''), '万元') }}</span></div>
            <AnaEChart :option="phaseOption" :height="phaseH" />
            <p class="ana-read hold"><template v-if="phaseRead">{{ phaseRead }}</template></p>
            <p class="ana-ref hold"><template v-if="phaseRead">{{ S.pctBase(live.length) }}</template></p>
          </div>
        </div>

        <!-- S 档「更多分析」:散点 / 面积转换默认收起;条在两块之上,展开只往下长。桌面这条 display:none,零差异。 -->
        <button v-if="isS" type="button" class="ak-foldbar" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
          <b>更多分析</b>
          <span class="sub">{{ PK.card.scatter }} · {{ PK.card.area }}</span>
          <span class="n">{{ moreOpen ? '收起' : '2 块' }}</span>
        </button>

        <div class="av2-card av2-s12 pk-more" :class="{ 'is-open': moreOpen }">
          <div class="av2-card-h"><span class="t">{{ PK.card.scatter }}</span><span class="hint">{{ S.hint(PK.allBld, '万元') }}</span></div>
          <AnaEChart :option="scatterOption" :height="260" />
          <p class="ana-read hold"><template v-if="perHead">{{ perHead.text }}</template></p>
          <p class="ana-ref hold"><template v-if="overlapRef">{{ overlapRef }}</template></p>
        </div>

        <div class="av2-card av2-s12 pk-more" :class="{ 'is-open': moreOpen }">
          <div class="av2-card-h"><span class="t">{{ PK.card.area }}</span><span class="hint">{{ S.hint(S.areaCover(areaStats.n, areaStats.m), '㎡') }}</span></div>
          <AnaEmpty v-if="areaStats.n === 0" label="合同面积待补录"
            hint="请在合同管理中录入建筑面积与租赁面积" to="/contracts" to-text="去合同管理补录" />
          <div v-else class="pk-area-body">
            <div class="pk-area-metrics">
              <div class="pk-am">
                <div class="v">{{ areaStats.factor != null ? areaStats.factor.toFixed(2) : '' }}</div>
                <div class="l">{{ PK.factorLabel }}</div>
                <div class="s">{{ S.areaSums(areaStats.sumB, areaStats.sumR) }}</div>
                <div class="s">{{ S.factorBase(RENT_AREA_FACTOR) }}</div>
              </div>
              <div class="pk-am">
                <div class="l">{{ PK.shareLabel }}</div>
                <div v-if="areaStats.share != null" class="v">{{ areaStats.share.toFixed(1) }}%</div>
                <div v-else class="pk-thin">{{ S.thin({ few: areaStats.parkAreaN, field: PK.field.total, cant: PK.cant.share }).text }}</div>
              </div>
              <div class="pk-am">
                <div class="l">{{ PK.areaOccLabel }}</div>
                <div v-if="areaOcc != null" class="v">{{ areaOcc }}%</div>
                <div v-else class="pk-thin">{{ S.thin({ few: areaStats.rentableN, field: PK.field.rentable, cant: PK.cant.occ }).text }}</div>
              </div>
              <!-- 跨层引导:楼栋管理属数据层,园区股东看不见那一层 -->
              <RouterLink v-if="(areaOcc == null || areaStats.share == null) && canReach('/buildings', auth.navLayers, auth.can)"
                          class="pk-go" to="/buildings">{{ PK.goFill }}</RouterLink>
              <span v-else-if="(areaOcc == null || areaStats.share == null) && lack('/buildings')" class="pk-go off" v-tip="lack('/buildings')">{{ PK.goFill }}</span>
            </div>
            <div class="pk-area-chart">
              <AnaEChart :option="areaOption" :height="280" />
              <!-- 每栋都正好等于约定值时不出句(画板如此),出句时才占这一行 -->
              <template v-if="areaRead"><p class="ana-read">{{ areaRead }}</p></template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 屏名进工具条(同 CockpitView .cv2-name):排在工具条最前 */
.pk-name { order: -1; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
/* 右栏:明细卡叠在期区卡上,末张撑满(与主卡同排等高) */
.pk-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pk-col > .av2-card:last-child { flex: 1 1 auto; }
/* 1101–1280:主卡整行,右栏两张并排(否则 span 6 的右栏右边空半行) */
@media (max-width: 1280px) and (min-width: 1101px) {
  .pk-col { grid-column: span 12; flex-direction: row; }
  .pk-col > .av2-card, .pk-col > .av2-card:last-child { flex: 1 1 0; min-width: 0; }
}
.pk-tbl th, .pk-tbl td { padding-left: 8px; padding-right: 8px; }
.pk-tbl th:first-child, .pk-tbl td:first-child { padding-left: 0; }
.pk-tbl th:last-child, .pk-tbl td:last-child { padding-right: 0; }
.pk-tbl td:first-child { white-space: normal; width: 100%; line-height: 16px; }
.pk-clear { border: none; background: transparent; color: var(--text-link); font-size: 11px; cursor: pointer; font-family: var(--font-sans); white-space: nowrap; }
.pk-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-muted); }
.pk-all { margin-left: auto; color: var(--text-link); font-size: var(--fs-micro); white-space: nowrap; text-decoration: none; }
.pk-all:hover, .pk-go:hover { text-decoration: underline; }
.pk-go { display: inline-block; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-link); text-decoration: none; }
/* 没有目标屏的查看权(RBAC v3,master 0.28.0):不藏,置灰并悬停写明缺哪一项 */
.pk-go.off, .pk-all.off { color: var(--text-disabled); cursor: default; text-decoration: none; }
.pk-thin { margin-top: 2px; font-size: var(--fs-label); line-height: 18px; color: var(--text-secondary); }
/* 面积转换:左指标竖排 + 右图;窄屏降为纵排 */
.pk-area-body { display: flex; gap: 20px; align-items: stretch; }
.pk-area-metrics { flex: 0 0 216px; display: flex; flex-direction: column; gap: 14px; justify-content: center; }
.pk-am .v { font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.pk-am .l { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.pk-am .s { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 2px; }
.pk-area-chart { flex: 1 1 auto; min-width: 0; }
@media (max-width: 900px) {
  .pk-area-body { flex-direction: column; }
  .pk-area-metrics { flex: 0 0 auto; }
}
/* 「点左边的楼栋」:≤1280 主卡 8 栏变整行、明细落到主卡下面,「左边」不成立(文案复查 10-05) */
@media (max-width: 1280px) { .pk-cue { display: none; } }
/* 「更多分析」折叠条:桌面 display:none —— 不进栅格、不占位。S 档才长出来。 */
.ak-foldbar { display: none; }
@media (max-width: 600px) { /* S */
  .pk-col { gap: 6px; }
  .pk-cue { display: none; }   /* 「点左边的楼栋」:手机上主卡堆在上面,「左边」不成立 */
  .ak-foldbar {
    display: flex; align-items: center; gap: 8px; grid-column: 1 / -1;
    min-height: 44px; padding: 0 12px; box-sizing: border-box;
    border: 1px solid var(--border-subtle); border-radius: 8px;
    background: var(--surface-white); color: var(--text-primary);
    font-family: var(--font-sans); font-size: var(--fs-label); cursor: pointer; text-align: left;
  }
  .ak-foldbar .sub { flex: 1 1 auto; min-width: 0; font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ak-foldbar .n { flex: 0 0 auto; font-size: var(--fs-micro); color: var(--text-muted); }
  .pk-more { display: none; }
  .pk-more.is-open { display: block; }
  /* 明细行卡:第一行 租户名 + 右对齐合同月租(元),第二行 楼栋 ——右端—— 到期。行高 56。 */
  .pk-rows { display: flex; flex-direction: column; }
  .pk-rc { height: 56px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 0 2px; border-bottom: 1px solid var(--divider); }
  .pk-rc .r1 { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-label); }
  .pk-rc .r1 .nm { flex: 1 1 auto; min-width: 0; color: var(--text-primary); font-weight: var(--fw-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pk-rc .r1 .v { flex: 0 0 auto; color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .pk-rc .r2 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: var(--fs-micro); color: var(--text-muted); }
  .pk-rc .r2 > * { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}
</style>
