<script setup lang="ts">
// 出租与楼栋(park)v2 — spec §二.3:KPI 4(楼栋/在租/合同/月租总额)+ 主图 s8 楼栋月租 TreeMap
// (点块→右侧 s4 该楼栋租户明细表联动过滤)+ 期区结构环 s4 + 楼栋×租户散点 s6 + 单元空态卡保留。
// 数据与口径 = v1(building×contract×tenant 快照,有效合同=active/expiring,数值锚点不变);
// spec 降级不变:库内 unit.area/contract.rent_area 全 0 → 面积口径不可算,空态卡深链 /buildings。
// 数据变换纯函数见 park.logic.ts(单测 park.logic.spec.ts)。
import { computed, onMounted, ref } from 'vue'
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
import type { ContractDTO } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'

const loading = ref(true)
const failed = ref(false)
const buildings = ref<BuildingDTO[]>([])
const contracts = ref<ContractDTO[]>([])
const tenants = ref<TenantDTO[]>([])

onMounted(async () => {
  try {
    ;[buildings.value, contracts.value, tenants.value] = await Promise.all([
      fetchBuildings(), fetchContracts(), fetchTenants(),
    ])
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})

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
  xAxis: { type: 'value', name: '租户数(户)', nameLocation: 'middle', nameGap: 24, nameTextStyle: { fontSize: 10.5 } },
  yAxis: { type: yLog.value ? 'log' : 'value', name: '月租(万)', nameTextStyle: { fontSize: 10.5 } },
  series: [{
    type: 'scatter',
    data: pkScatter.value.shown.map((r) => ({
      name: r.name, value: [r.tenants, +r.rentWan.toFixed(2)],
      symbolSize: 8 + Math.sqrt(r.contracts) * 2.4,
      itemStyle: { color: phaseColor(r.phase), opacity: 0.85 },
    })),
  }],
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
          <div class="av2-card-h"><span class="t">楼栋月租 TreeMap</span><span class="hint">块面积＝月租(万)· 颜色＝分期 · 点击下钻右侧明细</span></div>
          <AnaEChart :option="treemapOption" :height="320" @chart-click="onTreeClick" />
          <div class="pk-legend">
            <span v-for="p in phases" :key="p.phase" class="pk-leg"><span class="sw" :style="{ background: phaseColor(p.phase) }"></span>{{ p.name }}</span>
          </div>
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">租户明细 · {{ selected ?? '全园区' }}</span>
            <button v-if="selected" class="pk-clear" @click="selected = null">× 取消过滤</button>
            <span v-else class="hint">点左图楼栋块过滤</span>
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
          <AnaEChart :option="donutOption" :height="252" />
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">楼栋×租户散点</span>
            <span class="pk-lh">
              <span class="hint">气泡＝合同数 · 颜色＝分期<template v-if="yLog"> · 对数刻度:小栋与大栋同图可读</template><template v-if="yLog && pkScatter.hidden"> · 月租0楼栋 {{ pkScatter.hidden }} 栋未显示</template></span>
              <span class="pk-log-seg" role="group" aria-label="纵轴刻度">
                <button :class="{ on: yLog }" @click="yLog = true">对数</button>
                <button :class="{ on: !yLog }" @click="yLog = false">线性</button>
              </span>
            </span>
          </div>
          <AnaEChart :option="scatterOption" :height="252" />
        </div>

        <div class="av2-card pk-s2">
          <!-- spec 空态覆盖点保留:park 单元层 → 引导补录 unit.area,深链 /buildings -->
          <AnaEmpty label="单元面积未录入" :hint="unitTotal + ' 个单元 area 全为 0,出租率/面积去化暂不可算'"
            to="/buildings" to-text="去补录面积" />
        </div>
      </div>

      <AnaMethodNote>口径:库内 unit.area 与 contract.rent_area 全为 0,出租率/面积去化不可算;本屏以有效合同(active/expiring)的月租与租户分布呈现楼栋结构,楼栋租户数为去重口径。</AnaMethodNote>
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
/* 卡头 mini seg(仿 AnaShell .anx-seg;scoped 不透传 → 本地复刻,同 TenantEnergyView 惯例) */
.pk-lh { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.pk-log-seg { display: inline-flex; flex: 0 0 auto; background: var(--surface-sunken); border-radius: var(--radius-full); padding: 2px; gap: 2px; }
.pk-log-seg button { border: none; background: transparent; cursor: pointer; font-family: var(--font-sans); font-size: 11px; font-weight: var(--fw-medium); color: var(--text-secondary); padding: 3px 10px; border-radius: var(--radius-full); transition: background var(--dur-fast), color var(--dur-fast); }
.pk-log-seg button.on { background: var(--surface-white); color: var(--text-primary); font-weight: var(--fw-semibold); box-shadow: 0 1px 3px rgba(28, 28, 28, .1); }
.pk-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; justify-content: center; }
.pk-leg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }
.pk-leg .sw { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
</style>
