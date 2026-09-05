<script setup lang="ts">
// 结构与续约(tenant-portfolio)v2 — spec §二.6:KPI 条 + 期区结构环(点扇区→下方租户清单过滤联动)
// + 月租帕累托(ECharts 柱+累计%线双轴)+ 租金分布散点带(对数轴,抖动/五数纯函数单测)+ 续约空态保留。
// 口径与 v1 完全一致(数值锚点不变):月租金=各户生效合同月租之和;主数据为当前快照,不随期间切换;
// 类目未维护 → 按期区呈现;合同起止日期未录 → 续约风险空态;rent_area 全 0 → 面积空态。
// 数据变换纯函数见 ./TenantPortfolio.logic.ts(单测)。
import { computed, onMounted, ref } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import AnaShell from './AnaShell.vue'
import { fetchContracts, fetchTenants } from '@/analysis/anaData'
import type { ContractDTO } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'
import { iconFor } from '@/components/ds/icon'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import { PHASES } from '@/views/sales-income/layout'
import { contractStatusOf, contractStatusColor } from '@/components/fp/contractStatus'
import { buildBoxRows, buildPareto, buildStripPoints, type BoxRow } from './TenantPortfolio.logic'

const loaded = ref(false)
const err = ref('')
const tenantList = ref<TenantDTO[]>([])
const contracts = ref<ContractDTO[]>([])

async function reload() {
  try {
    const [ts, cs] = await Promise.all([fetchTenants(), fetchContracts()])
    tenantList.value = ts
    contracts.value = cs
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    loaded.value = true
  }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })

const phaseName = (p: number): string => (p === 0 ? '未标注' : PHASES.find((x) => x.phase === p)?.short ?? `期区${p}`)
// ECharts canvas 不识别 CSS 变量 → fpAnaTheme 蓝族字面值(HTML 图例同源保持一致)
const HEX = ['#378ADD', '#85B7EB', '#185FA5', '#5DCAA5', '#B5D4F4', 'rgba(28,28,28,.4)']

// ── 租金份额(在租租户,月租金=生效合同Σ;v1 口径不变) ──
const activeTenants = computed(() => tenantList.value.filter((t) => t.status === 1))
const totalRent = computed(() => activeTenants.value.reduce((s, t) => s + t.monthlyRent, 0))
interface ShareRow {
  rank: number; name: string; rent: number; share: number; phase: number
  contractCount: number; primaryBuilding: string | null
}
const shares = computed<ShareRow[]>(() => activeTenants.value
  .filter((t) => t.monthlyRent > 0)
  .map((t) => ({
    rank: 0, name: t.companyName, rent: t.monthlyRent,
    share: totalRent.value ? (t.monthlyRent / totalRent.value) * 100 : 0,
    phase: Number(t.phase) || 0, contractCount: t.contractCount, primaryBuilding: t.primaryBuilding,
  }))
  .sort((a, b) => b.rent - a.rent)
  .map((t, i) => ({ ...t, rank: i + 1 })))
const top5Share = computed(() => +shares.value.slice(0, 5).reduce((s, t) => s + t.share, 0).toFixed(1))
const top10Share = computed(() => +shares.value.slice(0, 10).reduce((s, t) => s + t.share, 0).toFixed(1))
const hhi = computed(() => Math.round(shares.value.reduce((s, t) => s + t.share * t.share, 0)))
const activeContracts = computed(() => contracts.value.filter((c) => c.status === 'active').length)
const undatedContracts = computed(() => contracts.value.filter((c) => !c.startDate && !c.endDate && !c.signDate).length)

// ── 月租帕累托(柱+累计%线双轴;Top 20,累计=v1 语义只加已展示项) ──
const PAR_N = 20
const pareto = computed(() => buildPareto(shares.value, PAR_N))
const paretoOption = computed<object>(() => {
  const p = pareto.value
  return {
    grid: { left: 46, right: 46, top: 30, bottom: 64 },
    legend: { top: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : (v as number).toFixed(1) + '%') },
    xAxis: { type: 'category', data: p.names, axisLabel: { rotate: 38, fontSize: 11, width: 72, overflow: 'truncate' } },
    yAxis: [
      { type: 'value', axisLabel: { formatter: '{value}%' } },
      { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' }, splitLine: { show: false } },
    ],
    series: [
      { name: '月租金占比', type: 'bar', barWidth: 14, data: p.shares, itemStyle: { color: '#85B7EB' } },
      {
        name: '累计占比', type: 'line', yAxisIndex: 1, data: p.cums, symbolSize: 5,
        lineStyle: { color: '#1C1C1C', width: 2 }, itemStyle: { color: '#1C1C1C' },
        markLine: p.names.length >= 5 ? {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: '#EF9F27' },
          label: { formatter: `Top5 ${top5Share.value}%`, color: '#EF9F27', fontSize: 11 },
          data: [{ xAxis: p.names[4] }],
        } : undefined,
      },
    ],
  }
})

// ── 期区结构环(点扇区→下方租户清单过滤联动) ──
const phaseFilter = ref<number | null>(null)
const donutData = computed(() => {
  const byPhase = new Map<number, number>()
  for (const t of shares.value) byPhase.set(t.phase, (byPhase.get(t.phase) ?? 0) + t.rent)
  return [...byPhase.entries()].sort((a, b) => b[1] - a[1]).map(([p, rent], i) => ({
    phase: p, label: phaseName(p), rent,
    share: totalRent.value ? +((rent / totalRent.value) * 100).toFixed(1) : 0,
    color: HEX[i % HEX.length],
  }))
})
const donutOption = computed<object>(() => ({
  tooltip: {
    formatter: (p: { data?: { name?: string; value?: number; share?: number } }) =>
      p.data ? `${p.data.name}<br/>¥${((p.data.value ?? 0) / 10000).toFixed(1)}万 · ${p.data.share}%` : '',
  },
  series: [{
    type: 'pie', radius: ['52%', '78%'], center: ['50%', '50%'],
    label: { show: false },
    // 圆角只放系列级:数据项动态描边(选中期=黑框)是选中态指示器,ECharts 逐属性合并后仍生效
    itemStyle: { borderRadius: 6 },
    emphasis: { scaleSize: 4 },
    data: donutData.value.map((d) => ({
      name: d.label, value: +d.rent.toFixed(2), share: d.share, phase: d.phase,
      itemStyle: {
        color: d.color,
        borderColor: phaseFilter.value === d.phase ? '#1C1C1C' : '#fff',
        borderWidth: phaseFilter.value === d.phase ? 2 : 1,
      },
    })),
  }],
}))
function onDonutClick(params: unknown) {
  const p = params as { data?: { phase?: number } }
  if (p?.data?.phase == null) return
  phaseFilter.value = phaseFilter.value === p.data.phase ? null : p.data.phase
}

// ── 合同月租/面积分布(抖动散点带+对数轴,按期区;面积全 0 → 空态保留) ──
// 换掉箱线图:月租极度右偏(单份~180万合同),线性轴上箱体压扁成线;散点带让每份合同
// 可见可悬停(巨型合同成为可识别的点),对数轴让 0.1万~180万 同图可读(同 ParkView 散点惯例)。
const boxMode = ref<'rent' | 'area'>('rent')
const phaseByTenantId = computed(() => new Map(tenantList.value.map((t) => [t.id, Number(t.phase) || 0])))
const tenantNameById = computed(() => new Map(tenantList.value.map((t) => [t.id, t.companyName])))
const boxGroups = computed(() => {
  const g = new Map<number, { v: number; tenant: string }[]>()
  for (const c of contracts.value) {
    if (c.status !== 'active') continue
    const v = boxMode.value === 'rent' ? c.monthlyRent : c.rentArea
    if (v <= 0) continue   // 对数轴取不了 ≤0,与原箱线同口径过滤
    const p = phaseByTenantId.value.get(c.tenantId) ?? 0
    const list = g.get(p) ?? []
    list.push({ v, tenant: tenantNameById.value.get(c.tenantId) ?? '—' })
    g.set(p, list)
  }
  return [1, 2, 3, 4, 0].filter((p) => g.has(p))
    .map((p) => ({ name: phaseName(p), items: g.get(p) as { v: number; tenant: string }[] }))
})
const hasArea = computed(() => contracts.value.some((c) => c.rentArea > 0))
// 对数轴取不到 ≤0,上面 boxGroups 直接 continue 掉了这些合同 —— 但屏上不能一声不吭:
// 实测「租赁面积」模式下会静默略去相当一部分合同(面积未录/为 0),整个期区都可能从图上消失,
// 而用户看到的是一张完整的图,会以为这就是全部。缺失必须能表达(METRIC-SOURCE-SPEC §3 同精神)。
const boxDropped = computed(() => {
  let n = 0, phases = new Set<number>()
  for (const c of contracts.value) {
    if (c.status !== 'active') continue
    const v = boxMode.value === 'rent' ? c.monthlyRent : c.rentArea
    if (v > 0) continue
    n++
    phases.add(phaseByTenantId.value.get(c.tenantId) ?? 0)
  }
  const shown = new Set(boxGroups.value.map((g) => g.name))
  const gonePhases = [...phases].map(phaseName).filter((nm) => !shown.has(nm))
  return { n, total: contracts.value.filter((c) => c.status === 'active').length, gonePhases }
})
const boxDiv = computed(() => (boxMode.value === 'rent' ? 10000 : 1))
const boxRows = computed<BoxRow[]>(() =>
  buildBoxRows(boxGroups.value.map((g) => ({ name: g.name, values: g.items.map((i) => i.v) })), boxDiv.value))
const stripPts = computed(() => buildStripPoints(boxGroups.value, boxDiv.value))
const boxUnit = computed(() => (boxMode.value === 'rent' ? '万' : '㎡'))
const boxOption = computed<object>(() => ({
  grid: { left: 56, right: 18, top: 16, bottom: 26 },
  tooltip: {
    formatter: (p: { seriesIndex?: number; dataIndex?: number; data?: { tenant?: string; value?: [number, number] } }) => {
      const u = boxUnit.value
      if (p.seriesIndex === 1) {   // 中位横线 → 组统计
        const r = boxRows.value[p.dataIndex ?? -1]
        if (!r) return ''
        return `${r.name}(${r.n} 份)<br/>中位 ${r.stats[2]}${u} · 均值 ${r.mean}${u}<br/>IQR ${r.stats[1]}~${r.stats[3]}${u}`
      }
      return p.data?.tenant ? `${p.data.tenant}<br/>${p.data.value?.[1]}${u}` : ''
    },
  },
  // x 用数值轴承载抖动,整数刻度映射期区名
  xAxis: {
    type: 'value', min: -0.5, max: boxRows.value.length - 0.5, interval: 1,
    axisLabel: { formatter: (v: number) => boxRows.value[Math.round(v)]?.name ?? '' },
    splitLine: { show: false },
  },
  yAxis: { type: 'log', name: boxUnit.value, minorSplitLine: { show: true } },
  series: [
    {
      type: 'scatter', symbolSize: 7,
      itemStyle: { color: 'rgba(133,183,235,.55)', borderColor: '#378ADD', borderWidth: 1 },
      data: stripPts.value.flatMap((pts) => pts.map((pt) => ({ value: [pt.x, pt.y], tenant: pt.tenant }))),
    },
    {   // 中位横线(rect 扁标记)
      type: 'scatter', symbol: 'rect', symbolSize: [34, 3],
      itemStyle: { color: '#1C1C1C' },
      data: boxRows.value.map((r, i) => [i, r.stats[2]]),
    },
  ],
}))

// ── 合同生命周期(真实状态计数,v1 保留) ──
// 色与文案一律取自 contractStatus.ts 权威表,不再本地写。此前本地那套把 expired 给了灰、
// terminated 给了红,与合同管理屏**正好对调** —— 用户会读成「已终止那批出了问题」。
const lifeCounts = computed(() => {
  const n = (s: string) => contracts.value.filter((c) => c.status === s).length
  return (['active', 'expiring', 'draft', 'expired', 'terminated'] as const).map((s) => ({
    label: contractStatusOf(s).label,
    value: n(s),
    tone: contractStatusColor(s),
  }))
})
const lifeMax = computed(() => Math.max(...lifeCounts.value.map((l) => l.value), 1))

// ── 租户清单(环图点扇区过滤联动;累计=已展示项逐行累加) ──
const LIST_N = 12
const filteredShares = computed(() => (phaseFilter.value == null ? shares.value : shares.value.filter((t) => t.phase === phaseFilter.value)))
const listRows = computed(() => {
  let cum = 0
  return filteredShares.value.slice(0, LIST_N).map((t) => { cum += t.share; return { ...t, cum } })
})
</script>

<template>
  <!-- §五:期间无关屏(主数据快照)→ 隐期间控件,显口径徽章 -->
  <AnaShell period-mode="none" scope-chip="主数据快照 · 期间无关">
    <!-- v-if 必须在槽内层:挂在 <template #kpis> 上时条件为假 → $slots.kpis 不存在 →
         AnaShell 的容器判不到、连同 min-height 一起不渲染 → 数据到达时整条 KPI 带凭空插入,
         把下方图表整体下推 93px(DESIGN-FIDELITY §6.4)。写法对齐 ExpiryView。 -->
    <template #kpis>
      <template v-if="loaded && !err && activeTenants.length">
      <AnaKpiTile label="在租租户" :value="`${activeTenants.length} 户`" :note="`${shares.length} 户有月租金`" />
      <AnaKpiTile label="Top5 集中度" :value="`${top5Share}%`" :note="top5Share > 55 ? '偏高' : '正常'" />
      <AnaKpiTile label="Top10 集中度" :value="`${top10Share}%`" />
      <AnaKpiTile label="集中度指数(HHI)" :value="String(hhi)" :note="hhi > 1500 ? '中等集中 · >2500为高度集中' : '较分散 · >2500为高度集中'" />
      <AnaKpiTile label="生效合同" :value="`${activeContracts} 份`" />
      <AnaKpiTile label="月租金总额" :value="`¥${(totalRent / 10000).toFixed(1)}万`" />
      </template>
    </template>

    <div v-if="!loaded" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="err" class="ak-page">
      <AnaEmpty label="分析数据加载失败" :hint="err" />
    </div>

    <div v-else-if="!activeTenants.length" class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('users')" :size="20" /></span>
          <div>
            <h2 class="ak-title">结构与续约</h2>
            <p class="ak-sub">主数据快照 · 期间无关</p>
          </div>
        </div>
      </div>
      <AnaEmpty label="暂无在租租户" hint="录入租户与合同后,此处呈现租金集中度与结构分析" to="/tenants" toText="去租户管理" />
    </div>

    <div v-else class="ak-page">
      <AnaMethodNote>主数据(租户/合同)为当前快照口径,不随顶部期间切换;月租金=各户生效合同月租之和。</AnaMethodNote>

      <div class="av2-grid">
        <!-- 主图:月租帕累托(柱+累计%线双轴) -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">租金贡献集中度(帕累托)</span>
            <span class="hint">Top {{ Math.min(PAR_N, shares.length) }} 户(共 {{ shares.length }} 户) · 柱=占比 · 线=累计</span>
          </div>
          <AnaEChart :option="paretoOption" :height="300" />
        </div>

        <!-- 期区结构环(点扇区→下方清单过滤) -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">期区结构</span><span class="hint">按月租金<span class="hint-desk"> · 点扇区过滤下方清单</span></span></div>
          <AnaEChart :option="donutOption" :height="300" @chart-click="onDonutClick" />
          <div class="tp2-dl">
            <button v-for="d in donutData" :key="d.label" class="ak-dl tp2-dlbtn" :class="{ on: phaseFilter === d.phase }" @click="phaseFilter = phaseFilter === d.phase ? null : d.phase">
              <span class="dot" :style="{ background: d.color }"></span>
              <span class="nm">{{ d.label }}</span>
              <span class="pc">{{ d.share }}%</span>
              <span class="am">¥{{ (d.rent / 10000).toFixed(1) }}万</span>
            </button>
          </div>
          <AnaMethodNote>租户类目均未维护(全部「未分类」),改按期区呈现;<RouterLink class="tp-link" to="/tenants">去租户管理补录类目</RouterLink>。</AnaMethodNote>
        </div>

        <!-- 租金分布散点带(对数轴,按期区;点=每份合同) -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">合同{{ boxMode === 'rent' ? '月租' : '面积' }}分布(按期区)</span>
            <span class="hint">
              <span class="ak-seg2" style="margin-right: 8px">
                <button :class="{ on: boxMode === 'rent' }" @click="boxMode = 'rent'">月租金</button>
                <button :class="{ on: boxMode === 'area' }" @click="boxMode = 'area'">租赁面积</button>
              </span>
              生效合同 · 点=每份合同<span class="hint-desk">(悬停看租户)</span> · 横线=中位 · 对数轴
              <template v-if="boxDropped.n > 0">
                · <span class="tp-drop">已略去 {{ boxDropped.n }}/{{ boxDropped.total }} 份({{ boxMode === 'rent' ? '月租金' : '面积' }}为 0 或未录,对数轴取不到){{
                  boxDropped.gonePhases.length ? '，' + boxDropped.gonePhases.join('、') + ' 整期不可见' : '' }}</span>
              </template>
            </span>
          </div>
          <AnaEChart v-if="boxMode === 'rent' || hasArea" :option="boxOption" :height="250" />
          <AnaEmpty v-else
            label="合同租赁面积未录入(rent_area 全部为 0)"
            hint="补录合同面积后,此处按期区呈现面积分布散点带"
            to="/contracts" toText="去合同管理补录" />
        </div>

        <!-- 续约风险 → 空态保留(合同日期未录) -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">续约风险</span><span class="hint">剩余天数 × 月租金 · 依赖合同起止日期</span></div>
          <AnaEmpty
            label="合同起止日期未录入,无法评估到期与续约风险"
            :hint="`${undatedContracts} / ${contracts.length} 份合同缺起止/签订日期;补录后此处展示「剩余天数 × 月租金」续约风险散点与临期清单`"
            to="/contracts" toText="去合同管理补录" />
        </div>

        <!-- 合同生命周期 -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">合同生命周期</span><span class="hint">全部合同分布</span></div>
          <div class="ak-bar-rows">
            <div v-for="l in lifeCounts" :key="l.label" class="ak-bar-row">
              <span class="ak-bar-name">{{ l.label }}</span>
              <div class="ak-bar-track"><div class="ak-bar-fill" :style="{ width: (l.value / lifeMax) * 100 + '%', background: l.tone }"></div></div>
              <span class="ak-bar-val">{{ l.value }} 份</span>
            </div>
          </div>
        </div>

        <!-- 租户清单(环图联动过滤) -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">
              租户清单
              <span v-if="phaseFilter != null" class="tp2-chip">
                {{ phaseName(phaseFilter) }} · {{ filteredShares.length }} 户
                <button class="x" title="清除过滤" @click="phaseFilter = null">×</button>
              </span>
            </span>
            <span class="hint">按月租金降序 · 前 {{ Math.min(LIST_N, filteredShares.length) }} 户 · 累计=已展示项</span>
          </div>
          <table class="ak-tbl">
            <thead><tr><th>租户</th><th>期区</th><th>月租金(万)</th><th>占比</th><th>累计</th><th>合同数</th><th>主楼栋</th></tr></thead>
            <tbody>
              <tr v-for="t in listRows" :key="t.name">
                <td><span class="nm2"><span class="rk">{{ t.rank }}</span>{{ t.name }}</span></td>
                <td class="mut">{{ phaseName(t.phase) }}</td>
                <td class="mono">{{ (t.rent / 10000).toFixed(1) }}</td>
                <td><span class="ak-inbar"><i :style="{ width: Math.min(100, t.share * 4) + '%' }"></i></span><span class="mono">{{ t.share.toFixed(1) }}%</span></td>
                <td class="mono mut">{{ t.cum.toFixed(0) }}%</td>
                <td class="mono mut">{{ t.contractCount }}</td>
                <td class="mut">{{ t.primaryBuilding || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="!listRows.length" class="tp2-none">该期区暂无有月租金的租户</div>
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.tp-link { color: var(--text-link); text-decoration: none; }
/* 略去份数走告警橙:它是「这张图不完整」的提示,不是普通补充说明 */
.tp-drop { color: var(--status-warning); font-weight: var(--fw-medium); }
.tp-link:hover { text-decoration: underline; }
.tp2-dl { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.tp2-dlbtn { width: 100%; border: none; background: transparent; cursor: pointer; font-family: var(--font-sans); padding: 5px 6px; border-radius: 8px; }
.tp2-dlbtn:hover { background: var(--bg-hover); }
.tp2-dlbtn.on { background: var(--accent-blue); }
.tp2-chip { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; font-size: 11px; font-weight: var(--fw-medium); color: var(--text-secondary); background: var(--surface-sunken); border-radius: var(--radius-full); padding: 2px 8px; }
.tp2-chip .x { border: none; background: transparent; cursor: pointer; color: var(--text-muted); font-size: 12px; padding: 0; line-height: 1; }
.tp2-chip .x:hover { color: var(--text-primary); }
.tp2-none { text-align: center; color: var(--text-disabled); font-size: var(--fs-label); padding: 18px 0; }
</style>
