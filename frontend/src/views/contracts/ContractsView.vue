<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from 'vue'
import { contractApi } from '@/api/contract'
import { fpSortRows } from '@/components/fp/fpSort'
import type { SortState } from '@/components/fp/fpSort'
import type { ContractDTO, ContractSummaryDTO } from '@/types/contract'
import { fpMoney, fpWan } from '@/utils/money'
import KpiCard from '@/components/ds/KpiCard.vue'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Select from '@/components/ds/Select.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPSortableTable from '@/components/fp/FPSortableTable.vue'
import { useFitRows } from '@/components/fp/useFitRows'
import FPPager from '@/components/fp/FPPager.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import ContractDrawer from './ContractDrawer.vue'
import ContractNewDialog from './ContractNewDialog.vue'
import { iconFor } from '@/components/ds/icon'

// ─── state ───────────────────────────────────────────────
const contracts = ref<ContractDTO[]>([])
const summary = ref<ContractSummaryDTO | null>(null)
const statusFilter = ref('all')
const phase = ref('全部期数')
const q = ref('')
const sort = ref<SortState | null>({ key: 'daysToEnd', dir: 'asc' })
const page = ref(1)
const tableWrapEl = ref<HTMLElement | null>(null)
const pageSize = useFitRows(tableWrapEl)   // 自适应每页行数:正好填满卡片,不滚动直接翻页
const openContract = ref<ContractDTO | null>(null)
const showNew = ref(false)
const editFrom = ref<ContractDTO | null>(null)
const renewFrom = ref<ContractDTO | null>(null)

async function reload() {
  ;[contracts.value, summary.value] = await Promise.all([contractApi.list(), contractApi.summary()])
}
onMounted(reload)

async function onCreated() {
  showNew.value = false
  await reload()
}

// 编辑/续签/终止成功:抽屉切换为返回的最新 DTO(watch 重拉 detail),列表+KPI 重拉
async function onEdited(dto: ContractDTO) {
  editFrom.value = null
  openContract.value = dto
  await reload()
}
async function onRenewed(dto: ContractDTO) {
  renewFrom.value = null
  openContract.value = dto
  await reload()
}
async function onTerminated(dto: ContractDTO) {
  openContract.value = dto
  await reload()
}
async function onDeleted() {
  openContract.value = null
  await reload()
}

// ─── phase filter ─────────────────────────────────────────
// ponytail: phaseName not in ContractDTO; we derive it inline from buildingName suffix heuristic
// matching the reference data pattern (建筑物名含"一期"/"二期"/"三期"/"宿舍")
function phaseOf(c: ContractDTO): string {
  if (c.buildingName.includes('一期')) return '一期'
  if (c.buildingName.includes('二期')) return '二期'
  if (c.buildingName.includes('三期')) return '三期'
  if (c.buildingName.includes('宿舍')) return '宿舍'
  return ''
}

// ─── lifecycle tabs ───────────────────────────────────────
// 合同生命周期标签集,经 FPPhaseTabs :tabs 传入(spec §2:禁止复制样式另建 tab 组件;
// 原 ContractLifecycleTabs.vue 样式复制品已删,常量收编于此)
const LIFECYCLE = [
  { k: 'all',        label: '全部' },
  { k: 'draft',      label: '草稿' },
  { k: 'active',     label: '执行中' },
  { k: 'expiring',   label: '即将到期' },
  { k: 'expired',    label: '已到期' },
  { k: 'terminated', label: '已终止' },
]

const lifecycleCounts = computed(() => {
  // seed all lifecycle keys to 0 so empty-status tabs show "0" (matches design), not blank
  const c: Record<string, number> = { all: contracts.value.length, draft: 0, active: 0, expiring: 0, expired: 0, terminated: 0 }
  for (const r of contracts.value) c[r.status] = (c[r.status] ?? 0) + 1
  return c
})

// ─── filtered ─────────────────────────────────────────────
const filtered = computed(() =>
  contracts.value
    .filter(c => statusFilter.value === 'all' || c.status === statusFilter.value)
    .filter(c => phase.value === '全部期数' || phaseOf(c) === phase.value)
    .filter(c => !q.value.trim() ||
      c.contractNo.includes(q.value.trim()) ||
      c.tenantName.includes(q.value.trim()) ||
      c.buildingName.includes(q.value.trim()))
)

// ─── table columns ────────────────────────────────────────
const TABLE_COLUMNS = computed(() => [
  {
    key: 'contractNo',
    header: '合同编号',
    width: '142px',
    mono: true,
    render: (r: ContractDTO) => h('span', {
      style: { fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }
    }, r.contractNo),
  },
  {
    key: 'tenantName',
    header: '租户',
    render: (r: ContractDTO) => h('span', {
      style: { display: 'flex', alignItems: 'center', gap: '9px' }
    }, [
      h(Avatar, { name: r.tenantName, size: 28 }),
      h('span', { style: { fontWeight: 'var(--fw-medium)', whiteSpace: 'nowrap' } }, r.tenantName),
    ]),
  },
  {
    key: 'loc',
    header: '楼栋 / 房号',
    width: '158px',
    sortValue: (r: ContractDTO) => r.buildingName,
    render: (r: ContractDTO) => h('span', {
      style: { display: 'flex', flexDirection: 'column' }
    }, [
      h('span', { style: { color: 'var(--text-secondary)', whiteSpace: 'nowrap' } }, r.buildingName),
      h('span', { style: { fontSize: 'var(--fs-micro)', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' } }, r.floorInfo),
    ]),
  },
  {
    key: 'rentArea',
    header: '租赁面积 ㎡',   /* F1:既有 rent_area 语义明确为租赁面积(计租面积) */
    width: '84px',
    align: 'right' as const,
    mono: true,
    sortValue: (r: ContractDTO) => r.rentArea,
    render: (r: ContractDTO) => h('span', {}, r.rentArea.toLocaleString('en-US')),
  },
  {
    key: 'monthlyRent',
    header: '月租金',
    width: '104px',
    align: 'right' as const,
    mono: true,
    sortValue: (r: ContractDTO) => r.monthlyRent,
    render: (r: ContractDTO) => h('span', {
      style: { fontWeight: 'var(--fw-semibold)' }
    }, fpMoney(r.monthlyRent)),
  },
  {
    key: 'range',
    header: '租赁期间',
    width: '186px',
    sortValue: (r: ContractDTO) => r.startDate ?? '9999',
    render: (r: ContractDTO) => h('span', {
      style: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }
    }, r.startDate ? `${r.startDate} → ${r.endDate}` : '待签约'),
  },
  {
    key: 'daysToEnd',
    header: '距到期',
    width: '96px',
    align: 'right' as const,
    // ponytail: draft→1e9 (末尾), expired/terminated→1e8 (沉底前), active/expiring→actual days asc
    sortValue: (r: ContractDTO) =>
      r.daysToEnd == null ? 1e9 :
      (r.status === 'expired' || r.status === 'terminated') ? 1e8 :
      r.daysToEnd,
    render: (r: ContractDTO) => {
      if (r.status === 'draft')       return h('span', { style: { color: 'var(--text-disabled)', fontSize: '12px' } }, '—')
      if (r.status === 'expired')     return h('span', { style: { color: 'var(--hue-red)',      fontSize: '12px' } }, '已到期')
      if (r.status === 'terminated')  return h('span', { style: { color: 'var(--text-disabled)', fontSize: '12px' } }, '已终止')
      const d = r.daysToEnd ?? 0
      const tone = d <= 90 ? 'rgb(168,98,0)' : 'var(--text-secondary)'
      return h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 'var(--fw-semibold)', color: tone } }, `${d} 天`)
    },
  },
  {
    key: 'status',
    header: '状态',
    width: '92px',
    render: (r: ContractDTO) => h(FPContractStatus, { status: r.status }),
  },
])

// ─── sort / page ──────────────────────────────────────────
const sortedFiltered = computed(() => fpSortRows(filtered.value, sort.value, TABLE_COLUMNS.value))
const pageCount = computed(() => Math.max(1, Math.ceil(sortedFiltered.value.length / pageSize.value)))
const safePage = computed(() => Math.min(page.value, pageCount.value))
const paged = computed(() => sortedFiltered.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value))

watch([statusFilter, phase, q, sort], () => { page.value = 1 })
</script>

<template>
  <div style="display:flex;flex-direction:column;gap:20px;max-width:1600px;margin:0 auto;width:100%;height:100%">
    <!-- 1. Header -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0;font-size:var(--fs-h2);font-weight:var(--fw-semibold)">合同管理</h2>
        <p style="margin:5px 0 0;font-size:var(--fs-label);color:var(--text-muted)">
          租赁合同与续签 · 主数据 · 共 {{ summary ? contracts.length : '…' }} 份
        </p>
      </div>
      <!-- ponytail: 导入尚未提供,保持显式 disabled;新增已接写接口 -->
      <div style="display:flex;gap:8px">
        <span title="导入开发中">
          <Button variant="outline" size="sm" disabled>
            <template #leading><component :is="iconFor('upload')" :size="14" /></template>
            导入
          </Button>
        </span>
        <Button variant="filled" size="sm" @click="showNew = true">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增合同
        </Button>
      </div>
    </div>

    <!-- data body: gated on first load so we never flash empty KPIs / 共0份 / 没有匹配 -->
    <template v-if="summary">
    <div class="mx-body">
      <!-- 2. KPI 左栏(spec §3:三屏统一样式) -->
      <aside class="mx-kpirail">
        <KpiCard label="执行中" :value="String(summary.contractActive)" tint="slate" :style="{ padding: '20px' }">
          <template #icon><component :is="iconFor('file-check-2')" :size="16" /></template>
        </KpiCard>
        <KpiCard label="即将到期" :value="String(summary.contractExpiring)" delta="90天内·需续签" trend="down" tint="cyan" :style="{ padding: '20px' }">
          <template #icon><component :is="iconFor('clock')" :size="16" /></template>
        </KpiCard>
        <KpiCard label="草稿待签" :value="String(summary.contractDraft)" delta="待生效" tint="sky" :style="{ padding: '20px' }">
          <template #icon><component :is="iconFor('file-pen')" :size="16" /></template>
        </KpiCard>
        <KpiCard label="月租金合计" :value="fpWan(summary.monthlyRent)" tint="blue" :style="{ padding: '20px' }">
          <template #icon><component :is="iconFor('coins')" :size="16" /></template>
        </KpiCard>
      </aside>

      <div class="mx-main">
      <!-- 3. Toolbar(spec §2:单行,生命周期 tabs 左 / 搜索+期数 Select 右,总数只出现在分页器) -->
      <div class="mx-toolbar">
        <FPPhaseTabs v-model="statusFilter" :counts="lifecycleCounts" :tabs="LIFECYCLE" />
        <div class="mx-toolbar-right">
          <div class="mx-search">
            <span class="mx-search-icon">
              <component :is="iconFor('search')" :size="16" />
            </span>
            <input v-model="q" placeholder="搜索合同编号 / 租户 / 楼栋" />
          </div>
          <div style="width:130px">
            <Select :options="['全部期数','一期','二期','三期','宿舍']" v-model="phase" size="sm" />
          </div>
        </div>
      </div>

      <!-- 4. List card(spec §3:卡片定高,表格区+分页条两段,分页器贴卡底不悬浮) -->
      <Card surface="white" :padding="0" class="mx-listcard">
        <div ref="tableWrapEl" class="mx-tablewrap">
          <FPSortableTable
            :columns="TABLE_COLUMNS"
            :rows="paged"
            rowKey="id"
            :sort="sort"
            :rowHover="true"
            @sortChange="sort = $event"
            @rowClick="openContract = $event"
          />
          <div v-if="filtered.length === 0" style="text-align:center;padding:40px;color:var(--text-disabled)">没有匹配的合同</div>
        </div>
        <div v-if="filtered.length > 0" class="mx-pagerbar">
          <FPPager
            :page="safePage"
            :pageCount="pageCount"
            :total="filtered.length"
            @page="page = $event"
          />
        </div>
      </Card>
      </div>
    </div>
    </template>
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <!-- 5. Drawer -->
    <ContractDrawer
      :open="!!openContract"
      :contract="openContract"
      @close="openContract = null"
      @edit="editFrom = $event"
      @renew="renewFrom = $event"
      @terminated="onTerminated"
      @deleted="onDeleted"
    />

    <!-- 6. 新增合同弹窗 -->
    <ContractNewDialog v-if="showNew" @close="showNew = false" @created="onCreated" />

    <!-- 7. 编辑 / 续签弹窗(从抽屉操作区打开,压在抽屉之上) -->
    <ContractNewDialog v-if="editFrom" :initial="editFrom" @close="editFrom = null" @saved="onEdited" />
    <ContractNewDialog v-if="renewFrom" :renew-from="renewFrom" @close="renewFrom = null" @saved="onRenewed" />
  </div>
</template>

<!-- .mx-* 布局样式收编于全局 styles/mx-list.css(LIST-PAGE-SPEC 单一事实源),本屏不再自带变体 -->
