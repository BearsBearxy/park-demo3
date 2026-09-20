<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import { buildingApi } from '@/api/building'
import { invalidateAnaCache } from '@/analysis/anaData'
import { fpSortRows } from '@/components/fp/fpSort'
import type { SortState } from '@/components/fp/fpSort'
import { useFitRows } from '@/components/fp/useFitRows'
import type { BuildingDTO, BuildingSummaryDTO, BuildingDetailDTO, BuildingCreateReq, BuildingUpdateReq } from '@/types/building'
import { occByUnit, occPct, OCC_NULL_WHY } from '@/types/building'
import { fpWan } from '@/utils/money'
import KpiCard from '@/components/ds/KpiCard.vue'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPSortableTable from '@/components/fp/FPSortableTable.vue'
import FPPager from '@/components/fp/FPPager.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import BuildingCard from './BuildingCard.vue'
import BuildingDrawer from './BuildingDrawer.vue'
import BuildingNewDialog from './BuildingNewDialog.vue'
import { iconFor } from '@/components/ds/icon'
import { useAuthStore } from '@/stores/auth'
import { useViewport } from '@/composables/useViewport'

const auth = useAuthStore()
// M 档(601–960)只压列宽/表头写法,一列都不删(TabletContent §① 黄框)
const { tier } = useViewport()

// ─── state ───────────────────────────────────────────────
const buildings = ref<BuildingDTO[]>([])
const summary = ref<BuildingSummaryDTO | null>(null)
const phase = ref<string | number>('all')
const layout = ref<string>(localStorage.getItem('fp-bd-layout') ?? '卡片墙')
const q = ref('')
const statusFilter = ref('全部状态')
const sort = ref<SortState | null>({ key: 'occRate', dir: 'desc' })
const page = ref(1)
// 台账列表:每页行数自适应放满卡片(spec §6);卡片墙固定 8(§6 例外条)
const tableWrapEl = ref<HTMLElement | null>(null)
const fitSize = useFitRows(tableWrapEl)
const pageSize = computed(() => layout.value === '卡片墙' ? 8 : fitSize.value)

// drawer
const openBuilding = ref<BuildingDTO | null>(null)
const drawerDetail = ref<BuildingDetailDTO | null>(null)

async function load() {
  ;[buildings.value, summary.value] = await Promise.all([buildingApi.list(), buildingApi.summary()])
}
onMounted(load)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void load() })

// 新增楼栋
const newDlg = ref(false)
async function createBuilding(req: BuildingCreateReq) {
  try {
    await buildingApi.create(req)
    newDlg.value = false
    await load()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '新建楼栋失败')
  }
}

// 编辑楼栋(抽屉「编辑楼栋」按钮打开泛化弹窗)
const editDlg = ref(false)
async function updateBuilding(req: BuildingUpdateReq) {
  if (!openBuilding.value) return
  try {
    const updated = await buildingApi.update(openBuilding.value.id, req)
    editDlg.value = false
    openBuilding.value = updated
    drawerDetail.value = await buildingApi.detail(updated.id)
    await load()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '操作失败')
  }
}

// 删除楼栋(抽屉内确认后上抛)
async function deleteBuilding() {
  if (!openBuilding.value) return
  try {
    await buildingApi.remove(openBuilding.value.id)
    onCloseDrawer()
    await load()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '操作失败')
  }
}

watch(layout, (v) => localStorage.setItem('fp-bd-layout', v))

// ─── computed ─────────────────────────────────────────────
const phaseCounts = computed(() => {
  const c: Record<string | number, number> = { all: buildings.value.length, 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const b of buildings.value) c[b.phase] = (c[b.phase] ?? 0) + 1
  return c
})

const filtered = computed(() =>
  buildings.value
    .filter(b => phase.value === 'all' || b.phase === phase.value)
    .filter(b => statusFilter.value === '全部状态' || (statusFilter.value === '正常' ? b.status === 1 : b.status === 0))
    .filter(b => !q.value.trim() || b.name.includes(q.value.trim()))
)

// ponytail: BdOccBar inlined as render function — no extra component file
// rate 为 null(算不出来)只留浅色轨道:0 宽的条会被读成「出租率 0%」(METRIC-SOURCE-SPEC §3)
function OccBar(rate: number | null, h_px = 6) {
  const tone = rate == null ? '' : rate >= 90 ? 'var(--hue-blue)' : rate >= 75 ? 'var(--fill-slate)' : 'var(--hue-orange)'
  return h('div', { style: { height: h_px + 'px', borderRadius: '999px', background: 'var(--ink-040)', overflow: 'hidden', width: '100%' } },
    rate == null ? [] : [
      h('div', { style: { width: rate + '%', height: '100%', background: tone, borderRadius: '999px', transition: 'width .3s var(--ease-standard)' } }),
    ])
}

const TABLE_COLUMNS = computed(() => [
  {
    key: 'name', header: '楼栋',
    render: (b: BuildingDTO) => h('span', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
      h('span', { style: { width: '30px', height: '30px', borderRadius: '9px', background: 'var(--surface-card)', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)', flex: '0 0 auto' } }, [
        h(iconFor(b.phase === 4 ? 'bed-double' : 'building-2'), { size: 16 }),
      ]),
      h('span', { style: { display: 'flex', flexDirection: 'column' } }, [
        h('span', { style: { fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)', whiteSpace: 'nowrap' } }, b.name),
        h('span', { style: { fontSize: 'var(--fs-micro)', color: 'var(--text-muted)' } }, b.kind),
      ]),
    ]),
  },
  { key: 'phaseName', header: '期数', width: '76px',
    render: (b: BuildingDTO) => h('span', { style: { color: 'var(--text-secondary)' } }, b.phaseName) },
  { key: 'floorCount', header: '楼层', width: '66px', align: 'right' as const, mono: true, sortValue: (b: BuildingDTO) => b.floorCount },
  {
    key: 'units', header: '在租/单元', width: '100px', align: 'right' as const, mono: true, sortValue: (b: BuildingDTO) => b.occupiedCount,
    render: (b: BuildingDTO) => h('span', null, [
      h('b', { style: { fontWeight: 'var(--fw-semibold)' } }, String(b.occupiedCount)),
      h('span', { style: { color: 'var(--text-muted)' } }, ` / ${b.unitCount}`),
    ]),
  },
  { key: 'totalArea', header: '总面积 ㎡', width: '104px', align: 'right' as const, mono: true, sortValue: (b: BuildingDTO) => b.totalArea,
    render: (b: BuildingDTO) => h('span', null, b.totalArea.toLocaleString('en-US')) },
  // M 档表头缩写成「可租 ㎡」(TabletContent §① delta 行7):同一列、同一份数据,只换表头写法
  { key: 'rentableArea', header: tier.value === 'm' ? '可租 ㎡' : '可租面积 ㎡', width: '116px', align: 'right' as const, mono: true, sortValue: (b: BuildingDTO) => b.rentableArea,
    render: (b: BuildingDTO) => h('span', null, b.rentableArea.toLocaleString('en-US')) },
  // 建筑面积=栋内在租合同建筑面积汇总(只读,BILL-FORWARD 刀1 面积链路)
  { key: 'tenantBuildingArea', header: '建筑面积 ㎡', width: '110px', align: 'right' as const, mono: true, sortValue: (b: BuildingDTO) => b.tenantBuildingArea,
    render: (b: BuildingDTO) => h('span', null, b.tenantBuildingArea ? b.tenantBuildingArea.toLocaleString('en-US') : '—') },
  {
    key: 'occRate', header: '出租率', width: '132px', sortValue: (b: BuildingDTO) => b.occRate,
    // 本列有 render,FPSortableTable 的自动 title 不生效(c.render ? undefined : …),缺因 tooltip 得自己挂
    render: (b: BuildingDTO) => h('span', { style: { display: 'flex', alignItems: 'center', gap: '9px' }, title: b.occRate == null ? OCC_NULL_WHY : undefined }, [
      // 条 54 → 36(M 档,TabletContent §① delta 行6):只条变短,右侧 40px 数字列与百分数不动
      h('span', { style: { flex: '1', minWidth: tier.value === 'm' ? '36px' : '54px' } }, [OccBar(b.occRate, 5)]),
      h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 'var(--fw-semibold)', width: '40px', textAlign: 'right' } }, occPct(b.occRate)),
    ]),
  },
  { key: 'monthlyRent', header: '月租金', width: '104px', align: 'right' as const, mono: true, sortValue: (b: BuildingDTO) => b.monthlyRent,
    render: (b: BuildingDTO) => h('span', { style: { fontWeight: 'var(--fw-semibold)' } }, fpWan(b.monthlyRent)) },
  { key: 'status', header: '状态', width: '80px',
    render: (b: BuildingDTO) => h(FPContractStatus, { status: b.status === 1 ? 'active' : 'terminated' }) },
])

const baseRows = computed(() =>
  layout.value === '台账列表' ? fpSortRows(filtered.value, sort.value, TABLE_COLUMNS.value) : filtered.value
)
const pageCount = computed(() => Math.max(1, Math.ceil(baseRows.value.length / pageSize.value)))
const safePage = computed(() => Math.min(page.value, pageCount.value))
const paged = computed(() => baseRows.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value))

watch([phase, q, statusFilter, layout, sort], () => { page.value = 1 })

// ─── drawer ───────────────────────────────────────────────
async function onOpenBuilding(b: BuildingDTO) {
  openBuilding.value = b
  drawerDetail.value = null
  drawerDetail.value = await buildingApi.detail(b.id)
}
function onCloseDrawer() {
  openBuilding.value = null
  drawerDetail.value = null
}

// 抽屉内楼层/单元/合同操作成功:抽屉已重拉 detail 并携带上抛,这里同步 detail+楼栋行并重拉 list+summary
function onDrawerRefreshed(d: BuildingDetailDTO) {
  drawerDetail.value = d
  openBuilding.value = d.building
  invalidateAnaCache()   // 楼栋/单元写动作后分析层缓存失效(派生审计病根B)
  load()
}

// table row click
function onTableRowClick(b: BuildingDTO) { onOpenBuilding(b) }

// KPI: stoppedCount from client list
const stoppedCount = computed(() => buildings.value.filter(b => b.status === 0).length)

// 出租率副标(§3 替代口径):按单元口径不依赖可租面积,主口径算不出来时它仍在,故两态都给。
// 口径定义在 types/building.ts occByUnit(出租与楼栋屏同一句,§2 同名指标同源)。
// 副标在 224px KPI 栏会被 ellipsis 截,缺因另挂卡片 title 兜底。
const occSub = computed(() => {
  const s = summary.value
  if (!s) return undefined
  const byUnit = occByUnit(s).text
  return s.occRate == null ? `${byUnit} · ${OCC_NULL_WHY}` : byUnit
})
</script>

<template>
  <!-- 根收编 .mx-page(迁移①):内联 height:100% 媒体查询盖不住,S 档高度链三件套要在类上生效;
       fp-fluid = 摘掉 base.css 的 800px 屏级地板(通过 §9 验收的标志) -->
  <div class="mx-page fp-fluid">
    <!-- 1. Title row -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0;font-size:var(--fs-h2);font-weight:var(--fw-semibold)">楼栋管理</h2>
        <p style="margin:5px 0 0;font-size:var(--fs-label);color:var(--text-muted)">
          园区楼栋资产与空间台账 · 主数据 · 共 {{ summary ? buildings.length : '…' }} 栋 / {{ summary?.unitCount ?? '—' }} 单元
        </p>
      </div>
      <div style="display:flex;gap:8px">
        <!-- ponytail: 楼栋导入未实现,按钮显式 disabled(诚实),避免可点无响应 -->
        <span title="导入开发中">
          <Button variant="outline" size="sm" disabled>
            <template #leading><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></template>
            导入
          </Button>
        </span>
        <Button v-if="auth.can('master:edit')" variant="filled" size="sm" @click="newDlg = true">
          <template #leading><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></template>
          新增楼栋
        </Button>
      </div>
    </div>

    <!-- data body: gated on first load so we never flash empty KPIs / 共0栋 / 没有匹配 -->
    <!-- 数据体**不再整屏 v-if** —— 外壳常驻，只在叶子上放骨架（加载态设计稿 §07「精确占位」）。
         零位移由「外壳从不卸载」这个结构保证，不是靠两份版式对齐出来的。 -->
    <div class="mx-body">
    <!-- 2. KPI 左栏(§3 统一样式) -->
    <aside class="mx-kpirail">
      <KpiCard label="楼栋总数" :value="summary ? String(summary.buildingCount) : ''" :loading="!summary" :sub="`${stoppedCount} 栋停用`" tint="slate">
        <template #icon><component :is="iconFor('building-2')" :size="16" /></template>
      </KpiCard>
      <KpiCard label="可租面积" :value="summary ? `${(summary.rentableArea / 10000).toFixed(2)} 万㎡` : ''" :loading="!summary" sub="" tint="sky">
        <template #icon><component :is="iconFor('ruler')" :size="16" /></template>
      </KpiCard>
      <KpiCard
        label="园区出租率" :value="summary ? occPct(summary.occRate) : ''" :loading="!summary" :sub="occSub ?? ''" tint="blue"
        :title="summary && summary.occRate == null ? OCC_NULL_WHY : undefined"
      >
        <template #icon><component :is="iconFor('trending-up')" :size="16" /></template>
      </KpiCard>
      <KpiCard label="空置单元" :value="summary ? String(summary.vacantCount) : ''" :loading="!summary" sub="待招商" tint="cyan">
        <template #icon><component :is="iconFor('door-open')" :size="16" /></template>
      </KpiCard>
    </aside>

    <div class="mx-main">
    <!-- 3. Toolbar(spec §2 单行:tabs 左 / 布局切换+搜索+状态 右;总数只出现在分页器) -->
    <div class="mx-toolbar">
      <FPPhaseTabs v-model="phase" :counts="phaseCounts" />
      <div class="mx-toolbar-right">
        <Segmented :options="['卡片墙', '台账列表']" v-model="layout" size="sm" />
        <div class="mx-search">
          <span class="mx-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input v-model="q" placeholder="搜索楼栋名称" />
        </div>
        <div style="width:130px">
          <Select :options="['全部状态', '正常', '停用']" v-model="statusFilter" size="sm" />
        </div>
      </div>
    </div>

    <!-- 5. Content area -->
    <!-- minmax 内层 min(100%,296px):容器比 296 还窄(390px 视口减去卡内边距)时列宽退让到容器宽,防横向溢出(spec §5.5) -->
    <div v-if="layout === '卡片墙'" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,296px),1fr));gap:16px">
      <BuildingCard
        v-for="b in paged"
        :key="b.id"
        :building="b"
        @open="onOpenBuilding"
      />
      <!-- 卡片墙的骨架:复用 BuildingCard 自己的 .bd-card 盒子(它是 scoped 的,外面照抄迟早漂开)。
           8 张 = 卡片墙模式下的 pageSize 常量,与真数据落位后的张数一致。 -->
      <BuildingCard v-for="i in (summary ? 0 : 8)" :key="'sk-' + i" loading :building="({} as never)" />
      <div v-if="summary && filtered.length === 0" style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-disabled)">没有匹配的楼栋</div>
    </div>
    <Card v-else surface="white" :padding="0" class="mx-listcard">
      <div ref="tableWrapEl" class="mx-tablewrap">
        <FPSortableTable
          :columns="TABLE_COLUMNS"
          :rows="paged"
          rowKey="id"
          :sort="sort"
          :rowHover="true"
          :skeleton-rows="summary ? 0 : pageSize"
          @sortChange="sort = $event"
          @rowClick="onTableRowClick"
        >
          <!-- S 档行卡映射(迁移②,spec §5.1:主字段 + ≤2 次级 + 状态胶囊,72px 内):
               不映射的话兜底用第一列——它是 30px 图标+双行的 VNode,塞行卡浪费高度还挤掉次级字段 -->
          <template #card="{ row }">
            <!-- 第一行:楼栋名吃余宽省略号 + 月租金贴右端(稿 §1「我改了两处①」:
                 桌面表有「月租金」列,卡上原先一个钱字都没有;右端对齐是为了一列 mono 数竖着能比大小)。
                 格式用桌面同一个 fpWan,不另写一套。 -->
            <div class="mx-rowcard-main has-money">
              <span class="mx-rowcard-name">{{ row.name }}</span>
              <span class="mx-rowcard-money">{{ fpWan(row.monthlyRent) }}</span>
            </div>
            <div class="mx-rowcard-sub">
              <!-- 稿改后屏样逐字是「一期 · 8/8」,现状屏样才带「在租」两字 —— 图是规格。
                   收这两字正是为了给同一行新加的 44 条 + 40 数腾地(稿 §1「我改了两处②」)。 -->
              <span>{{ row.phaseName }} · {{ row.occupiedCount }}/{{ row.unitCount }}</span>
              <!-- 出租率:条 44 + 数 40(稿 §1「我改了两处②」)。条是桌面表那根 OccBar 本体
                   (同一个函数、同一组阈值 ≥90 蓝 / ≥75 灰蓝 / 其余橙),不新造组件也不另定阈值 -->
              <span class="bd-occbar"><component :is="() => OccBar(row.occRate, 5)" /></span>
              <span class="bd-occpct">{{ occPct(row.occRate) }}</span>
              <!-- flex:0 0 auto 豁免 .mx-rowcard-sub > * 的 min-width:0,胶囊不被截字 -->
              <span style="margin-left:auto;flex:0 0 auto">
                <FPContractStatus :status="row.status === 1 ? 'active' : 'terminated'" />
              </span>
            </div>
          </template>
        </FPSortableTable>
        <div v-if="summary && filtered.length === 0" style="padding:40px;text-align:center;color:var(--text-disabled)">没有匹配的楼栋</div>
      </div>
      <!-- 分页器停靠卡片底部(spec §5) -->
      <div v-if="!summary || filtered.length > 0" class="mx-pagerbar">
        <FPPager
          :page="safePage"
          :pageCount="pageCount"
          :total="filtered.length"
          @page="page = $event"
        />
      </div>
    </Card>

    <!-- spacer: 卡片墙无列表卡片,分页器维持既有置底方式(spec §5 例外条) -->
    <div v-if="layout === '卡片墙'" style="flex:1 1 auto;min-height:0" aria-hidden="true"></div>

    <!-- 6. Pager(仅卡片墙:台账列表的分页器在卡内 .mx-pagerbar) -->
    <FPPager
      v-if="layout === '卡片墙' && filtered.length > 0"
      :page="safePage"
      :pageCount="pageCount"
      :total="filtered.length"
      @page="page = $event"
    />
    </div>
    </div>

    <!-- 7. Drawer -->
    <!-- 定高:本抽屉是「先打开、再 await detail」,不定高的话 detail 到达会把抽屉从 260px 撑到 760px
         (PAGE-BEHAVIOR-SPEC §1.4);内容后到只在抽屉 body 内滚动,外框零位移 -->
    <BuildingDrawer
      :open="!!openBuilding"
      :building="openBuilding"
      :detail="drawerDetail"
      :fixed-height="true"
      @close="onCloseDrawer"
      @edit="editDlg = true"
      @delete="deleteBuilding"
      @refreshed="onDrawerRefreshed"
    />

    <!-- 8. 新增楼栋弹窗 -->
    <BuildingNewDialog
      v-if="newDlg"
      :existing-names="buildings.map(b => b.name)"
      @close="newDlg = false"
      @create="createBuilding"
    />

    <!-- 9. 编辑楼栋弹窗(复用新增弹窗的编辑态) -->
    <BuildingNewDialog
      v-if="editDlg && openBuilding"
      :existing-names="buildings.map(b => b.name)"
      :initial="openBuilding"
      @close="editDlg = false"
      @update="updateBuilding"
    />
  </div>
</template>

<style scoped>
/* S 档行卡第二行的出租率两格(稿 §1 几何注③:条宽 44、数宽 40)。
   这两个节点只在 FPSortableTable 的 tier==='s' 卡片分支里进 DOM,宽档不存在,故不必包 @media。
   定宽而不是 flex:1 —— 一列条与一列数要竖着对齐,跟着内容走就会逐行漂。 */
.bd-occbar { flex: 0 0 44px; display: flex; }
.bd-occpct { flex: 0 0 40px; text-align: right; font-family: var(--font-mono); font-weight: var(--fw-semibold); }

/* M/S 档(≤960)工具条收纳(spec §5.1 M 行):摘掉 800px 地板后工具条要自己在窄容器里活——
   右组允许换行、搜索框放弃 230 定宽改吃满余宽;tabs 胶囊排不下时行内横滑
   (隐滚动条留触屏拖动,照抄 mx-list.css 的 .mx-kpirail 手法)。
   不进全局 mx-list.css:租户/系统用户两屏还没迁、仍垫着地板,全局改会动未验收屏的 M/S 档。 */
@media (max-width: 960px) {
  .mx-toolbar-right { flex-wrap: wrap; }
  .mx-search { flex: 1 1 160px; width: auto; }
  .fp-phasetabs { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .fp-phasetabs::-webkit-scrollbar { display: none; }
}
@media (max-width: 600px) { /* S */
  /* iOS 聚焦缩放三件套之一(spec §6.5):S 档输入 16px。ds/Input、Select 已在组件内处理,
     .mx-search 是裸 input,屏侧自扛 */
  .mx-search input { font-size: var(--fs-input-m); }
}
</style>
