<script setup lang="ts">
// ② 月度宽表(读/编辑双态)— 1:1 from screen-ledger.jsx wide-table branch (524-666).
import { ref, computed, watch, nextTick } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import SearchField from '@/components/ds/SearchField.vue'
import FPLedgerTable from '@/components/fp/FPLedgerTable.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import type { FPTenantOption } from '@/components/fp/fpTenantPicker'
import LedgerCompanyBadge from './LedgerCompanyBadge.vue'
import { lgColumns } from '@/utils/ledgerColumns'
import type { ColumnKey } from '@/utils/ledgerColumns'
import { lgRecalc } from '@/utils/lgRecalc'
import { exportLedgerMonth } from '@/utils/ledgerExcel'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import { useAuthStore } from '@/stores/auth'

// 台账录入 = entry(RBAC §2)。无权时表格与合计照常显示,只是没有「编辑模式」入口。
const auth = useAuthStore()

const props = defineProps<{
  month: LedgerMonthDTO            // server snapshot (read state / cancel source)
  draft: LedgerRowDTO[]            // editable working copy (owned by parent)
  companyName: string
  companyShort: string
  year: number
  monthNo: number
  edit: boolean
  saving: boolean
  addableTenants?: FPTenantOption[]   // 编辑态「添加租户行」候选(在租且本月尚无行;含 phase/parentName 供徽章)
  focusTenant?: string             // 核对跳转深链:定位并高亮该租户行(一次性,完成后 emit focus-done 由父层清空)
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
  'bulk-remove': [tenantIds: number[]]
  'focus-done': []
}>()

// ── 深链定位:渲染后滚动到 focusTenant 行 + .row-flash 高亮渐隐(行在 FPLedgerTable 内,DOM 查找按租户名) ──
const pageEl = ref<HTMLElement | null>(null)
watch(() => props.focusTenant, flashFocusRow, { immediate: true })
async function flashFocusRow() {
  const name = props.focusTenant?.trim()
  if (!name) return
  await nextTick()
  for (const tr of pageEl.value?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []) {
    if ((tr.querySelector('.lg-tname')?.textContent ?? '').trim() !== name) continue
    tr.scrollIntoView({ block: 'center' })
    tr.classList.add('row-flash')
    tr.addEventListener('animationend', () => tr.classList.remove('row-flash'), { once: true })
    break
  }
  emit('focus-done')  // 找不到该租户行也视为完成:静默停在本层(spec 取静默)
}

const q = ref('')

// 添加租户行(候选由父级传入;添加后重置选择)
const addTenantId = ref<number | null>(null)
function onAddTenant() {
  if (addTenantId.value == null) return
  emit('add-tenant', addTenantId.value)
  addTenantId.value = null
}

// ── 编辑态批量删除(勾选 → 确认 → 从 draft 移除,保存时以空行落库删除) ──
const selected = ref(new Set<number>())
const bulkConfirm = ref(false)
watch(() => props.edit, (e) => { if (!e) { selected.value = new Set(); bulkConfirm.value = false } })
function toggleSelect(tenantId: number) {
  const next = new Set(selected.value)
  if (next.has(tenantId)) next.delete(tenantId)
  else next.add(tenantId)
  selected.value = next
}
function toggleSelectAll() {
  const all = rows.value.map(r => r.tenantId)
  selected.value = all.every(id => selected.value.has(id)) ? new Set() : new Set(all)
}
function bulkRemove() {
  bulkConfirm.value = false
  emit('bulk-remove', [...selected.value])
  selected.value = new Set()
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

// draft 是 month.rows 的浅拷贝(LedgerView.vue:181),所以直接 JSON 比对即可判脏。
// 不另立 dirty 计数器 —— 计数器要在 onCellEdit / 添加行 / 批删三处同步维护,漏一处就骗人。
const isDirty = computed(() =>
  props.edit && JSON.stringify(props.draft) !== JSON.stringify(props.month.rows))

// 导入会重拉整月数据,握在手里的 draft 会被静默冲掉 —— 这正是改前把导入关在浏览态所规避的东西。
// 现在导入收进了编辑态,守卫必须补上,否则等于把那个坑挪到了编辑态里。
function onImport() {
  if (isDirty.value &&
      !window.confirm('本月台账有修改尚未保存。\n导入会重新载入本月数据,这些修改将丢失。\n\n仍要导入?')) return
  emit('import')
}

// 取消 = 丢弃整月草稿(LedgerView.vue:221-223 直接清空 draft),此前一点即弃、零提示。
function onCancel() {
  if (isDirty.value && !window.confirm('放弃本月未保存的修改?')) return
  emit('cancel')
}

// 从上月复制:先 confirm()(覆盖本月已有行,spec §4.2)
function onCopyPrev() {
  if (window.confirm(`从 ${props.month.prevMonth} 月复制将覆盖本月已录入的行,确认继续?`)) {
    emit('copy-from-prev')
  }
}
</script>

<template>
  <div class="lg-page" ref="pageEl">
    <div class="lg-head">
      <div class="lg-head-l">
        <button class="lg-back" @click="emit('back')" title="返回月份选择"><component :is="iconFor('arrow-left')" :size="16" /></button>
        <div>
          <h2 class="lg-title">{{ year }} 年 {{ monthNo }} 月 · 月度台账</h2>
          <p class="lg-sub">{{ companyName }} · 一行一租户 · 上月（{{ month.prevMonth }} 月）结余结转本月</p>
        </div>
      </div>
      <div class="lg-head-actions">
        <!-- 工具栏三段(EDIT-MODE-SPEC v2):① 态标识 ② 写操作(仅编辑态) ③ 只读操作常驻 + 右端主控件。
             改前是「浏览态一整块 / 编辑态一整块」二选一,导致**导出被关在浏览态分支里**——
             一进编辑模式导出就消失,用户得先点「取消/保存」退出才能导出。而导出是只读操作,
             v2 §1 明列「只读操作不受管:查看、展开、搜索、切期、模板下载、导出、打印」。 -->
        <LedgerCompanyBadge v-if="!edit" :name="companyName" :short="companyShort" @switch="emit('switch-company')" />
        <span v-if="!edit" class="lg-tag">{{ activeTenants }} 户记账</span>
        <span v-else class="lg-tag edit">编辑中 · {{ companyName }}</span>

        <template v-if="edit">
          <!-- 导入 = 写操作,收进编辑态(与附表 8 屏、抄表 4 屏同一口径) -->
          <Button variant="outline" size="sm" :disabled="saving" @click="onImport">
            <template #leading><component :is="iconFor('upload')" :size="14" /></template>
            导入 Excel
          </Button>
          <!-- 添加租户行:宽表只显示有数据的租户,新租户入账从这里挑(候选=在租且本月尚无行) -->
          <span class="lg-addrow">
            <FPTenantPicker
              class="lg-addpick"
              v-model="addTenantId"
              :tenants="addableTenants ?? []"
              placeholder="添加租户行…"
              :disabled="saving"
              empty-hint="本月已有台账行的租户不在候选,请直接在表格中查找该行"
            />
            <Button variant="outline" size="sm" :disabled="saving || addTenantId == null" @click="onAddTenant">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              添加
            </Button>
          </span>
          <Button variant="gray" size="sm" :disabled="saving" @click="onCopyPrev">
            <template #leading><component :is="iconFor('copy')" :size="14" /></template>
            从上月复制
          </Button>
        </template>

        <!-- 导出:只读,两态常驻 -->
        <Button variant="outline" size="sm" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出 Excel
        </Button>

        <Button v-if="!edit && auth.can('entry:edit')" variant="outline" size="sm" @click="emit('enter-edit')">
          <template #leading><component :is="iconFor('pencil')" :size="14" /></template>
          编辑模式
        </Button>
        <template v-else>
          <Button variant="gray" size="sm" :disabled="saving" @click="onCancel">取消</Button>
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
        <Button v-if="edit && selected.size" variant="danger" size="sm" :disabled="saving" @click="bulkConfirm = true">
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          删除所选 ({{ selected.size }})
        </Button>
      </div>
      <span class="lg-toolbar-note">{{ edit ? '点击单元格编辑数值,不收的费用列留空即可,应收/结余自动计算;勾选行可批量删除' : auth.can('entry:edit') ? '只读 · 点击「编辑」录入 · 点击租户名查看明细' : '只读 · 点击租户名查看明细' }}</span>
    </div>

    <FPLedgerTable
      :columns="cols"
      :rows="view"
      :edit="edit"
      :selected="edit ? selected : undefined"
      @cell-edit="onCellEdit"
      @tenant-click="emit('tenant-click', $event)"
      @toggle-select="toggleSelect"
      @toggle-select-all="toggleSelectAll"
    />

    <!-- 批量删除确认(居中弹窗,项目 §7 惯例;点「保存」后生效,取消编辑可放弃) -->
    <Teleport to="body">
      <div v-if="bulkConfirm" class="lg-bulk-mask" @mousedown="bulkConfirm = false">
        <div class="lg-bulk-dlg" role="dialog" aria-modal="true" @mousedown.stop>
          <div class="h">
            <h3>删除所选台账行</h3>
            <p>将从本月台账移除所选 {{ selected.size }} 行(含其费用/结余/备注);点「保存」后生效,「取消」编辑可放弃。</p>
          </div>
          <div class="f">
            <Button variant="gray" size="sm" @click="bulkConfirm = false">取消</Button>
            <Button variant="danger" size="sm" @click="bulkRemove">
              <template #leading><component :is="iconFor('trash-2')" /></template>
              删除 {{ selected.size }} 行
            </Button>
          </div>
        </div>
      </div>
    </Teleport>

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
/* 选择器换 FPTenantPicker,尺寸对齐原 .lg-addsel(高 32 / 宽 180)保持工具条布局不变 */
.lg-addpick { width:180px; }
.lg-addpick :deep(.fp-tp-trigger) { height:32px; font-size:12.5px; }
/* 批量删除确认弹窗(1:1 LedgerNewCompanyDialog .lg-dlg 风格) */
.lg-bulk-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:320; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); }
.lg-bulk-dlg { width:min(420px,92vw); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); }
.lg-bulk-dlg .h { padding:20px 22px 4px; }
.lg-bulk-dlg .h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-bulk-dlg .h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-bulk-dlg .f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }

.lg-kpis { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
.lg-kpis .lg-kval { white-space:nowrap; font-size:clamp(14px, 1.5vw, 23px); }

.lg-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.lg-toolbar-l { display:flex; align-items:center; gap:10px; }
.lg-toolbar-note { font-size:12px; color:var(--text-muted); }

.lg-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* 深链定位行:2s 高亮渐隐(行在子组件 FPLedgerTable 内,须 :deep;结束后还原表格自身背景) */
:deep(tr.row-flash > td) { animation: lg-row-flash 2s var(--ease-standard); }
@keyframes lg-row-flash { from { background: var(--accent-blue); } to { background: var(--surface-white); } }
</style>
