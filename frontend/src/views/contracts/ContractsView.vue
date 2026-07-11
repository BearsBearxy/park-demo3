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
import FPSortableTable from '@/components/fp/FPSortableTable.vue'
import FPPager from '@/components/fp/FPPager.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import ContractLifecycleTabs from './ContractLifecycleTabs.vue'
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
const pageSize = 8
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

// ─── lifecycle counts ─────────────────────────────────────
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
    header: '面积 ㎡',
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
const pageCount = computed(() => Math.max(1, Math.ceil(sortedFiltered.value.length / pageSize)))
const safePage = computed(() => Math.min(page.value, pageCount.value))
const paged = computed(() => sortedFiltered.value.slice((safePage.value - 1) * pageSize, safePage.value * pageSize))

watch([statusFilter, phase, q, sort], () => { page.value = 1 })
</script>

<template>
  <div style="display:flex;flex-direction:column;gap:20px;max-width:1200px;margin:0 auto;width:100%;min-height:100%">
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
      <!-- 3. Lifecycle tabs -->
      <ContractLifecycleTabs v-model="statusFilter" :counts="lifecycleCounts" />

      <!-- 4. Toolbar -->
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="position:relative;flex:1 1 240px;min-width:200px">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);display:inline-flex">
            <component :is="iconFor('search')" :size="16" />
          </span>
          <input
            v-model="q"
            placeholder="搜索合同编号 / 租户 / 楼栋"
            style="width:100%;height:36px;padding:0 12px 0 34px;border-radius:var(--radius-full);border:1px solid var(--border-subtle);background:var(--surface-card);font-family:var(--font-sans);font-size:13px;color:var(--text-primary);box-sizing:border-box;outline:none"
          />
        </div>
        <div style="width:140px">
          <Select :options="['全部期数','一期','二期','三期','宿舍']" v-model="phase" size="sm" />
        </div>
        <span style="font-size:var(--fs-label);color:var(--text-muted);margin-left:auto">共 {{ filtered.length }} 份</span>
      </div>

      <!-- 5. Table card -->
      <Card surface="white" :padding="0" style="border:1px solid var(--border-subtle);overflow:hidden">
        <div style="padding:14px 4px 0">
          <FPSortableTable
            :columns="TABLE_COLUMNS"
            :rows="paged"
            rowKey="id"
            :sort="sort"
            :rowHover="true"
            @sortChange="sort = $event"
            @rowClick="openContract = $event"
          />
        </div>
        <div v-if="filtered.length === 0" style="text-align:center;padding:40px;color:var(--text-disabled)">没有匹配的合同</div>
      </Card>

      <!-- spacer: pin pager to card bottom (DESIGN-FIDELITY §5) -->
      <div style="flex:1 1 auto;min-height:0" aria-hidden="true"></div>

      <!-- 6. Pager -->
      <FPPager
        v-if="filtered.length > 0"
        :page="safePage"
        :pageCount="pageCount"
        :total="filtered.length"
        @page="page = $event"
      />
      </div>
    </div>
    </template>
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <!-- 7. Drawer -->
    <ContractDrawer
      :open="!!openContract"
      :contract="openContract"
      @close="openContract = null"
      @edit="editFrom = $event"
      @renew="renewFrom = $event"
      @terminated="onTerminated"
      @deleted="onDeleted"
    />

    <!-- 8. 新增合同弹窗 -->
    <ContractNewDialog v-if="showNew" @close="showNew = false" @created="onCreated" />

    <!-- 9. 编辑 / 续签弹窗(从抽屉操作区打开,压在抽屉之上) -->
    <ContractNewDialog v-if="editFrom" :initial="editFrom" @close="editFrom = null" @saved="onEdited" />
    <ContractNewDialog v-if="renewFrom" :renew-from="renewFrom" @close="renewFrom = null" @saved="onRenewed" />
  </div>
</template>

<style scoped>
/* KPI 左栏呼吸感样式(spec §A,楼栋/租户/合同三屏一字同款) */
.mx-body { display:grid; grid-template-columns:224px minmax(0,1fr); gap:28px; align-items:start; }
.mx-kpirail { display:flex; flex-direction:column; gap:16px; position:sticky; top:16px; }
.mx-main { min-width:0; display:flex; flex-direction:column; gap:16px; }
@media (max-width:1100px) {
  .mx-body { grid-template-columns:1fr; gap:16px; }
  .mx-kpirail { flex-direction:row; flex-wrap:wrap; position:static; }
  .mx-kpirail > * { flex:1 1 160px; }
}
</style>
