<script setup lang="ts">
// ② 月度宽表(读/编辑双态)— 1:1 from screen-ledger.jsx wide-table branch (524-666).
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import SearchField from '@/components/ds/SearchField.vue'
import FPLedgerTable from '@/components/fp/FPLedgerTable.vue'
import LedgerCompanyBadge from './LedgerCompanyBadge.vue'
import { lgColumns } from '@/utils/ledgerColumns'
import type { ColumnKey } from '@/utils/ledgerColumns'
import { lgRecalc } from '@/utils/lgRecalc'
import { exportLedgerMonth } from '@/utils/ledgerExcel'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'

const props = defineProps<{
  month: LedgerMonthDTO            // server snapshot (read state / cancel source)
  draft: LedgerRowDTO[]            // editable working copy (owned by parent)
  companyName: string
  companyShort: string
  year: number
  monthNo: number
  edit: boolean
  saving: boolean
  addableTenants?: { id: number; name: string }[]   // 编辑态「添加租户行」候选(在租且本月尚无行)
}>()
const emit = defineEmits<{
  'switch-company': []
  back: []
  'enter-edit': []
  cancel: []
  save: []
  'copy-from-prev': []
  'tenant-click': [tenantId: number]
  import: []
  'add-tenant': [tenantId: number]
}>()

const q = ref('')

// 添加租户行(候选由父级传入;添加后重置选择)
const addTenantId = ref<number | ''>('')
function onAddTenant() {
  if (addTenantId.value === '') return
  emit('add-tenant', Number(addTenantId.value))
  addTenantId.value = ''
}

const cols = computed(() => lgColumns(props.month.prevMonth))

// active rows = draft in edit, server rows in read. search filter on tenantName (jsx 418).
const rows = computed(() => (props.edit ? props.draft : props.month.rows))
const view = computed(() =>
  rows.value.filter(r => !q.value.trim() || r.tenantName.includes(q.value.trim())),
)

// KPI 合计 — read from footer (server) in read state, recompute from draft in edit (jsx 419-420)
function sum(k: keyof LedgerRowDTO): number {
  return rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0)
}
const sumRecv = computed(() => (props.edit ? sum('totalReceivable') : props.month.footer.totalReceivable))
const sumColl = computed(() => (props.edit ? sum('totalCollected') : props.month.footer.totalCollected))
const sumEnd = computed(() => (props.edit ? sum('balanceEnd') : props.month.footer.balanceEnd))
const activeTenants = computed(() => rows.value.filter(r => (Number(r.totalReceivable) || 0) > 0).length)

// jsx lgMoney
function lgMoney(v: number): string {
  const neg = v < 0
  return (neg ? '−¥' : '¥') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// cell-edit → mutate draft row + recalc derived (jsx onEdit 422-426)
function onCellEdit(p: { tenantId: number; key: ColumnKey; value: string }) {
  const row = props.draft.find(r => r.tenantId === p.tenantId)
  if (!row) return
  if (p.key === 'note') {
    row.note = p.value
  } else {
    ;(row as any)[p.key] = p.value === '' ? 0 : Number(p.value)
    lgRecalc(row)
  }
}

async function onExport() {
  try {
    await exportLedgerMonth(props.month, props.companyName, props.year, props.monthNo)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}

// 从上月复制:先 confirm()(覆盖本月已有行,spec §4.2)
function onCopyPrev() {
  if (window.confirm(`从 ${props.month.prevMonth} 月复制将覆盖本月已录入的行,确认继续?`)) {
    emit('copy-from-prev')
  }
}
</script>

<template>
  <div class="lg-page">
    <div class="lg-head">
      <div class="lg-head-l">
        <button class="lg-back" @click="emit('back')" title="返回月份选择"><component :is="iconFor('arrow-left')" :size="16" /></button>
        <div>
          <h2 class="lg-title">{{ year }} 年 {{ monthNo }} 月 · 月度台账</h2>
          <p class="lg-sub">{{ companyName }} · 一行一租户 · 上月（{{ month.prevMonth }} 月）结余结转本月</p>
        </div>
      </div>
      <div class="lg-head-actions">
        <LedgerCompanyBadge v-if="!edit" :name="companyName" :short="companyShort" @switch="emit('switch-company')" />
        <template v-if="!edit">
          <span class="lg-tag">{{ activeTenants }} 户记账</span>
          <Button variant="outline" size="sm" @click="emit('import')">
            <template #leading><component :is="iconFor('upload')" :size="14" /></template>
            导入 Excel
          </Button>
          <Button variant="outline" size="sm" @click="onExport">
            <template #leading><component :is="iconFor('download')" :size="14" /></template>
            导出 Excel
          </Button>
          <Button variant="filled" size="sm" @click="emit('enter-edit')">
            <template #leading><component :is="iconFor('pencil')" :size="14" /></template>
            编辑
          </Button>
        </template>
        <template v-else>
          <span class="lg-tag edit">编辑中 · {{ companyName }}</span>
          <!-- 添加租户行:宽表只显示有数据的租户,新租户入账从这里挑(候选=在租且本月尚无行) -->
          <span class="lg-addrow">
            <select class="lg-addsel" v-model="addTenantId" :disabled="saving">
              <option value="">添加租户行…</option>
              <option v-for="t in addableTenants ?? []" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
            <Button variant="outline" size="sm" :disabled="saving || addTenantId === ''" @click="onAddTenant">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              添加
            </Button>
          </span>
          <Button variant="gray" size="sm" :disabled="saving" @click="onCopyPrev">
            <template #leading><component :is="iconFor('copy')" :size="14" /></template>
            从上月复制
          </Button>
          <Button variant="gray" size="sm" :disabled="saving" @click="emit('cancel')">取消</Button>
          <Button variant="filled" size="sm" :disabled="saving" @click="emit('save')">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            保存
          </Button>
        </template>
      </div>
    </div>

    <div class="lg-kpis">
      <KpiCard tint="slate" label="应收合计"><span class="lg-kval">{{ lgMoney(sumRecv) }}</span>
        <template #icon><component :is="iconFor('wallet')" :size="16" /></template>
      </KpiCard>
      <KpiCard tint="blue" label="已收合计"><span class="lg-kval">{{ lgMoney(sumColl) }}</span>
        <template #icon><component :is="iconFor('banknote')" :size="16" /></template>
      </KpiCard>
      <KpiCard tint="sky" label="期末余额"><span class="lg-kval">{{ lgMoney(sumEnd) }}</span>
        <template #icon><component :is="iconFor('scale')" :size="16" /></template>
      </KpiCard>
      <KpiCard tint="cyan" label="记账租户"><span class="lg-kval">{{ activeTenants }} 户</span>
        <template #icon><component :is="iconFor('users')" :size="16" /></template>
      </KpiCard>
    </div>

    <div class="lg-toolbar">
      <div class="lg-toolbar-l">
        <SearchField placeholder="搜索租户" shortcut="" :value="q" :width="180" @change="q = $event" />
      </div>
      <span class="lg-toolbar-note">{{ edit ? '点击单元格编辑数值,不收的费用列留空即可,应收/结余自动计算' : '只读 · 点击「编辑」录入 · 点击租户名查看明细' }}</span>
    </div>

    <FPLedgerTable
      :columns="cols"
      :rows="view"
      :edit="edit"
      @cell-edit="onCellEdit"
      @tenant-click="emit('tenant-click', $event)"
    />

    <p class="lg-foot">
      <component :is="iconFor('info')" :size="13" />
      {{ companyName }} 的独立台账 · 本月应收合计 = 各费用项之和;本月结余 = 上月结余 + 应收 − 本月收款。不归本公司收的费用列保持留空。
    </p>
  </div>
</template>

<style scoped>
/* 1:1 from screen-ledger.jsx LgStyles 70-81, 140-141, 149-151, 175-178, 217-218 */
.lg-page { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.lg-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lg-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.lg-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lg-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.lg-title { margin:0; font:var(--type-h2); color:var(--text-primary); }
.lg-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lg-head-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

.lg-tag { display:inline-flex; align-items:center; height:28px; padding:0 12px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-secondary); font-size:12.5px; font-weight:var(--fw-medium); }
.lg-tag.edit { background:rgb(252,243,232); color:var(--hue-orange); }
.lg-addrow { display:inline-flex; align-items:center; gap:6px; }
.lg-addsel { height:32px; max-width:180px; padding:0 8px; font-size:12.5px; color:var(--text-primary); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; font-family:var(--font-sans); }
.lg-addsel:focus { border-color:var(--hue-blue); }

.lg-kpis { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
.lg-kpis .lg-kval { white-space:nowrap; font-size:clamp(14px, 1.5vw, 23px); }

.lg-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.lg-toolbar-l { display:flex; align-items:center; gap:10px; }
.lg-toolbar-note { font-size:12px; color:var(--text-muted); }

.lg-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
