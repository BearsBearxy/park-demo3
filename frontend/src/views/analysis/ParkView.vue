<script setup lang="ts">
// 出租与楼栋(park)v2 — spec §二.3:KPI 4(楼栋/在租/合同/月租总额)+ 主图 s8 楼栋月租 TreeMap
// (点块→右侧 s4 该楼栋租户明细表联动过滤)+ 期区结构环 s4 + 楼栋×租户散点 s6 + 单元空态卡保留。
// 数据与口径 = v1(building×contract×tenant 快照,有效合同=active/expiring,数值锚点不变);
// spec 降级不变:库内 unit.area/contract.rent_area 全 0 → 面积口径不可算,空态卡深链 /buildings。
// F3(2026-07-15)追加「面积转换」卡:在租合同建筑 vs 租赁面积楼栋对比 + 换算系数/分摊率,带覆盖率护栏。
// 数据变换纯函数见 park.logic.ts(单测 park.logic.spec.ts)。
import { computed, onMounted, ref } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import { fint, fnum } from '@/components/ana/anaFmt'
import { fetchBuildings, fetchContracts, fetchTenants } from '@/analysis/anaData'
import { buildBuildingRows, buildPhaseRows, liveContracts, splitLogPoints } from './park.logic'
import { iconFor } from '@/components/ds/icon'
import type { BuildingDTO } from '@/types/building'
import { RENT_AREA_FACTOR, type ContractDTO } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'

const loading = ref(true)
const failed = ref(false)
const buildings = ref<BuildingDTO[]>([])
const contracts = ref<ContractDTO[]>([])
const tenants = ref<TenantDTO[]>([])

async function reload() {
  // 切回重读会重跑本函数:失败标志不清,重试成功后屏上仍挂着「加载失败」卡(P3 T2 评审坐实)
  failed.value = false
  try {
    ;[buildings.value, contracts.value, tenants.value] = await Promise.all([
      fetchBuildings(), fetchContracts(), fetchTenants(),
    ])
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })

// fpAnaTheme 蓝族字面色(ECharts canvas 不认 CSS 变量;分期 1~4 取主题前 4 色)
const PHASE_COLOR = ['#378ADD', '#185FA5', '#85B7EB', '#B5D4F4']
const phaseColor = (p: number) => PHASE_COLOR[(p - 1) % PHASE_COLOR.length]

const live = computed(() => liveContracts(contracts.value))
const rows = computed(() => buildBuildingRows(buildings.value, live.value))
const phases = computed(() => buildPhaseRows(buildings.value, live.value))
const totalRentWan = computed(() => rows.value.reduce((s, r) => s + r.rentWan, 0))
const activeTenants = computed(() => tenants.value.filter((t) => t.status === 1).length)
const unitTotal = computed(() => buildings.value.reduce((s, b) => s + b.unitCount, 0))

// ── KPI 条(spec §二.3:楼栋/在租/合同/月租总额;值与 v1 statItems 一致) ──
const kpis = computed(() => (loading.value || failed.value ? [] : [
  { label: '楼栋数', value: rows.value.length + ' 栋' },
  { label: '在租租户', value: fint(activeTenants.value) + ' 户' },
  { label: '有效合同', value: fint(live.value.length) + ' 份' },
  { label: '合同月租合计', value: '¥' + fnum(totalRentWan.value, 1) + '万', note: '主数据快照' },
]))

// ── 主图:楼栋月租 TreeMap(点块→右侧租户明细联动;再点同块/×取消) ──
const selected = ref<string | null>(null)   // 楼栋名
const treemapOption = computed(() => ({
  tooltip: {
    formatter: (p: { name: string; value: number }) => {
      const r = rows.value.find((x) => x.name === p.name)
      return `${p.name}<br/>月租 ¥${fnum(p.value, 1)}万` + (r ? ` · ${r.tenants} 户 · ${r.contracts} 份` : '')
    },
  },
  series: [{
    type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
    left: 0, right: 0, top: 0, bottom: 0,
    label: { show: true, formatter: (p: { name: string; value: number }) => `${p.name}\n¥${fnum(p.value, 1)}万`, fontSize: 11, lineHeight: 16 },
    itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 },
    data: rows.value.map((r) => ({
      name: r.name, value: +r.rentWan.toFixed(2),
      itemStyle: { color: phaseColor(r.phase), opacity: selected.value && selected.value !== r.name ? 0.4 : 1 },
    })),
  }],
}))
function onTreeClick(params: unknown) {
  const p = params as { name?: string }
  if (!p.name || !rows.value.some((r) => r.name === p.name)) return
  selected.value = selected.value === p.name ? null : p.name
}

// ── 右侧联动:该楼栋租户明细(未选中 = 全园区,按月租降序) ──
const detailRows = computed(() => {
  const b = selected.value ? buildings.value.find((x) => x.name === selected.value) : null
  const cs = b ? live.value.filter((c) => c.buildingId === b.id) : live.value
  return [...cs].sort((a, x) => x.monthlyRent - a.monthlyRent)
})

// ── 期区结构环(月租金额占比) ──
const donutOption = computed(() => ({
  tooltip: { formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>¥${fnum(p.value, 1)}万 · ${p.percent}%` },
  series: [{
    type: 'pie', radius: ['48%', '74%'], center: ['50%', '50%'],
    label: { fontSize: 11, formatter: '{b}\n{d}%' },
    itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
    data: phases.value.map((p) => ({ name: p.name, value: +p.rentWan.toFixed(2), itemStyle: { color: phaseColor(p.phase) } })),
  }],
}))

// ── 楼栋×租户散点(x=租户数,y=月租万;气泡大小=合同数,颜色=分期) ──
// spec §T2:y 轴(月租,万)默认对数(小栋与大栋同图可读);log 下月租≤0 无法取对数 → 过滤并在卡头 hint 披露计数
const yLog = ref(true)
const pkScatter = computed(() => splitLogPoints(rows.value, (r) => r.rentWan, yLog.value))
const scatterOption = computed(() => ({
  tooltip: {
    formatter: (p: { name: string; value: [number, number] }) => {
      const r = rows.value.find((x) => x.name === p.name)
      return `${p.name}<br/>${p.value[0]} 户 · ¥${fnum(p.value[1], 1)}万` + (r ? `<br/>户均 ¥${fint(r.avgRent)}` : '')
    },
  },
  grid: { left: 48, right: 18, top: 16, bottom: 34 },
  xAxis: { type: 'value', name: '租户数(户)', nameLocation: 'middle', nameGap: 24, nameTextStyle: { fontSize: 11 } },
  yAxis: { type: yLog.value ? 'log' : 'value', name: '月租(万)', nameTextStyle: { fontSize: 11 } },
  series: [{
    type: 'scatter',
    data: pkScatter.value.shown.map((r) => ({
      name: r.name, value: [r.tenants, +r.rentWan.toFixed(2)],
      symbolSize: 8 + Math.sqrt(r.contracts) * 2.4,
      itemStyle: { color: phaseColor(r.phase), opacity: 0.85 },
    })),
  }],
}))

// ── F3 面积转换(spec 2026-07-15):在租合同建筑面积 vs 租赁面积 ──
// 覆盖率护栏铁律:只聚合「有面积数据」(建筑>0 且租赁>0,系数分母恒不为 0)的在租合同;
// N=0 整卡空态引导补录,绝不渲染 0% 假数据。
// ponytail: 展示基准直接 import 合同录入侧常量,全仓唯一定义点(租赁=建筑÷0.8)
const AREA_FACTOR_BASE = RENT_AREA_FACTOR
const bAreaOf = (c: ContractDTO): number => Number(c.buildingArea ?? 0)
const areaLive = computed(() => live.value.filter((c) => bAreaOf(c) > 0 && c.rentArea > 0))
const areaStats = computed(() => {
  const sumB = areaLive.value.reduce((s, c) => s + bAreaOf(c), 0)
  const sumR = areaLive.value.reduce((s, c) => s + c.rentArea, 0)
  const parkArea = buildings.value.reduce((s, b) => s + b.totalArea, 0)
  return {
    n: areaLive.value.length, m: live.value.length, sumB, sumR, parkArea,
    factor: sumR > 0 ? sumB / sumR : null,                  // 全园实际换算系数 = Σ建筑÷Σ租赁
    share: parkArea > 0 ? (sumB / parkArea) * 100 : null,   // 平均分摊率 = Σ在租建筑÷Σ楼栋建筑
  }
})
// 楼栋行:仅保留有面积数据合同的楼栋,按建筑面积降序(全空楼栋不画空柱)
const areaRows = computed(() => buildings.value.map((b) => {
  const cs = areaLive.value.filter((c) => c.buildingId === b.id)
  return {
    name: b.name,
    building: cs.reduce((s, c) => s + bAreaOf(c), 0),
    rent: cs.reduce((s, c) => s + c.rentArea, 0),
  }
}).filter((r) => r.building > 0).sort((a, b) => b.building - a.building))
const AREA_COLOR = { building: '#185FA5', rent: '#85B7EB' }   // 蓝族字面色(同 PHASE_COLOR 取法)
const areaBarOption = computed(() => ({
  tooltip: {
    trigger: 'axis', axisPointer: { type: 'shadow' },
    formatter: (ps: { seriesName: string; name: string; value: number }[]) => {
      const name = ps[0]?.name ?? ''
      const r = areaRows.value.find((x) => x.name === name)
      return `${name}<br/>` + ps.map((p) => `${p.seriesName} ${fnum(p.value, 0)}㎡`).join('<br/>')
        + (r && r.rent > 0 ? `<br/>换算系数 ${fnum(r.building / r.rent, 2)}` : '')
    },
  },
  // 斜排标签比平排吃更多下边距,bottom 不跟着放大会把楼栋名切掉下半截
  grid: { left: 56, right: 18, top: 12, bottom: areaRows.value.length > 8 ? 48 : 26 },
  // 楼栋名多到一定数量后 ECharts 会自作主张隔一个隐一个,柱子无名可对 → interval:0 强制全画、斜排避让;
  // 楼栋少时不倾斜(平排更好读),阈值 8 是本屏宽度下横排放得下的上限
  xAxis: {
    type: 'category', data: areaRows.value.map((r) => r.name),
    axisLabel: { fontSize: 11, interval: 0, rotate: areaRows.value.length > 8 ? 30 : 0, hideOverlap: true },
  },
  yAxis: { type: 'value', name: '面积(㎡)', nameTextStyle: { fontSize: 11 } },
  series: [
    { name: '建筑面积', type: 'bar', barMaxWidth: 26, itemStyle: { color: AREA_COLOR.building, borderRadius: [3, 3, 0, 0] }, data: areaRows.value.map((r) => +r.building.toFixed(2)) },
    { name: '租赁面积', type: 'bar', barMaxWidth: 26, itemStyle: { color: AREA_COLOR.rent, borderRadius: [3, 3, 0, 0] }, data: areaRows.value.map((r) => +r.rent.toFixed(2)) },
  ],
}))
</script>

<template>
  <!-- §五:期间无关屏(主数据快照)→ 隐期间控件,显口径徽章 -->
  <AnaShell period-mode="none" scope-chip="主数据快照 · 期间无关">
    <template #kpis>
      <AnaKpiTile v-for="k in kpis" :key="k.label" v-bind="k" />
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <AnaEmpty v-else-if="failed" label="数据加载失败" hint="请刷新重试" />
    <div v-else class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('building-2')" :size="20" /></span>
          <div>
            <h2 class="ak-title">出租与楼栋</h2>
            <p class="ak-sub">合同月租规模 · 楼栋×租户分布 · 共 {{ rows.length }} 栋 · 主数据快照(不随期间切换)</p>
          </div>
        </div>
      </div>

      <div class="av2-grid">
        <div class="av2-card av2-s8">
          <div class="av2-card-h"><span class="t">楼栋月租 TreeMap</span><span class="hint">块面积＝月租(万)· 颜色＝分期<span class="hint-desk"> · 点击下钻右侧明细</span></span></div>
          <AnaEChart :option="treemapOption" :height="300" @chart-click="onTreeClick" />
          <div class="pk-legend">
            <span v-for="p in phases" :key="p.phase" class="pk-leg"><span class="sw" :style="{ background: phaseColor(p.phase) }"></span>{{ p.name }}</span>
          </div>
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">租户明细 · {{ selected ?? '全园区' }}</span>
            <button v-if="selected" class="pk-clear" @click="selected = null">× 取消过滤</button>
            <!-- 整句都是桌面指点话术,S 档整体隐藏(无分隔符残留) -->
          <span v-else class="hint"><span class="hint-desk">点左图楼栋块过滤</span></span>
          </div>
          <div class="pk-tbl-wrap">
            <table class="ak-tbl">
              <thead><tr><th>租户</th><th>月租(元)</th><th>到期</th></tr></thead>
              <tbody>
                <tr v-for="c in detailRows" :key="c.id">
                  <td>{{ c.tenantName }}</td>
                  <td class="mono">{{ fint(c.monthlyRent) }}</td>
                  <td class="mono mut">{{ c.endDate ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pk-sum">{{ detailRows.length }} 份合同 · 月租合计 ¥{{ fnum(detailRows.reduce((s, c) => s + c.monthlyRent, 0) / 10000, 1) }}万</div>
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">期区月租结构</span><span class="hint">有效合同月租占比</span></div>
          <AnaEChart :option="donutOption" :height="300" />
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">楼栋×租户散点</span>
            <span class="pk-lh">
              <span class="hint">气泡＝合同数 · 颜色＝分期<template v-if="yLog"> · 对数刻度:小栋与大栋同图可读</template><template v-if="yLog && pkScatter.hidden"> · 月租0楼栋 {{ pkScatter.hidden }} 栋未显示</template></span>
              <span class="anx-seg mini" role="group" aria-label="纵轴刻度">
                <button :class="{ on: yLog }" @click="yLog = true">对数</button>
                <button :class="{ on: !yLog }" @click="yLog = false">线性</button>
              </span>
            </span>
          </div>
          <AnaEChart :option="scatterOption" :height="300" />
        </div>

        <div class="av2-card pk-s2">
          <!-- spec 空态覆盖点保留:park 单元层 → 引导补录 unit.area,深链 /buildings -->
          <AnaEmpty label="单元面积未录入" :hint="unitTotal + ' 个单元 area 全为 0,出租率/面积去化暂不可算'"
            to="/buildings" to-text="去补录面积" />
        </div>

        <div class="av2-card av2-s12">
          <!-- F3 面积转换:覆盖率护栏常驻卡头;N=0 → 整卡空态引导补录,不画 0% 假数据 -->
          <div class="av2-card-h">
            <span class="t">面积转换</span>
            <span class="hint"><b class="pk-cov">{{ areaStats.n }}/{{ areaStats.m }}</b> 份在租合同有面积数据 · 在租=active/expiring</span>
          </div>
          <AnaEmpty v-if="areaStats.n === 0" label="合同面积待补录"
            hint="请在合同管理中录入建筑面积与租赁面积" to="/contracts" to-text="去合同管理补录" />
          <div v-else class="pk-area-body">
            <div class="pk-area-metrics">
              <div class="pk-am">
                <div class="v">{{ areaStats.factor != null ? fnum(areaStats.factor, 2) : '—' }}</div>
                <div class="l">全园实际换算系数</div>
                <div class="s">Σ建筑 {{ fnum(areaStats.sumB, 0) }}㎡ ÷ Σ租赁 {{ fnum(areaStats.sumR, 0) }}㎡ · 基准 {{ AREA_FACTOR_BASE }}</div>
              </div>
              <div class="pk-am">
                <div class="v">{{ areaStats.share != null ? fnum(areaStats.share, 1) + '%' : '—' }}</div>
                <div class="l">平均分摊率</div>
                <div class="s">Σ在租建筑 {{ fnum(areaStats.sumB, 0) }}㎡ ÷ Σ楼栋建筑 {{ fnum(areaStats.parkArea, 0) }}㎡</div>
              </div>
            </div>
            <div class="pk-area-chart">
              <AnaEChart :option="areaBarOption" :height="250" />
              <div class="pk-legend">
                <span class="pk-leg"><span class="sw" :style="{ background: AREA_COLOR.building }"></span>建筑面积</span>
                <span class="pk-leg"><span class="sw" :style="{ background: AREA_COLOR.rent }"></span>租赁面积</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AnaMethodNote>口径:库内 unit.area 与 contract.rent_area 全为 0,出租率/面积去化不可算;本屏以有效合同(active/expiring)的月租与租户分布呈现楼栋结构,楼栋租户数为去重口径。面积转换卡只聚合建筑/租赁面积均已录入的在租合同(覆盖率见卡头),换算系数=Σ建筑÷Σ租赁(录入基准 0.8),平均分摊率=Σ在租建筑÷Σ楼栋建筑面积。</AnaMethodNote>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 空态卡填补 av2-grid 第二排剩余 2 列(4+6+2=12);窄屏与 av2-s* 同步降为整行 */
.pk-s2 { grid-column: span 2; }
@media (max-width: 1100px) { .pk-s2 { grid-column: span 12; } }
.pk-tbl-wrap { max-height: 296px; overflow: auto; }
.pk-sum { margin-top: 8px; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.pk-clear { border: none; background: transparent; color: var(--text-link); font-size: 11px; cursor: pointer; font-family: var(--font-sans); white-space: nowrap; }
.pk-lh { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.pk-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; justify-content: center; }
.pk-leg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }
.pk-leg .sw { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
/* F3 面积转换卡:左指标竖排 + 右图;窄屏降为纵排(指标改横排) */
.pk-cov { font-weight: var(--fw-semibold); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.pk-area-body { display: flex; gap: 20px; align-items: stretch; }
.pk-area-metrics { flex: 0 0 216px; display: flex; flex-direction: column; gap: 14px; justify-content: center; }
.pk-am .v { font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.pk-am .l { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.pk-am .s { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 2px; }
.pk-area-chart { flex: 1 1 auto; min-width: 0; }
@media (max-width: 900px) {
  .pk-area-body { flex-direction: column; }
  .pk-area-metrics { flex: 0 0 auto; flex-direction: row; gap: 24px; }
}
</style>
