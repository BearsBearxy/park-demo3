<script setup lang="ts">
// ② 月度宽表(读/编辑双态)— 1:1 from screen-ledger.jsx wide-table branch (524-666).
import { ref, computed, watch, nextTick } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SearchField from '@/components/ds/SearchField.vue'
import FPMoreMenu from '@/components/fp/FPMoreMenu.vue'
import FPLedgerTable from '@/components/fp/FPLedgerTable.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import type { FPTenantOption } from '@/components/fp/fpTenantPicker'
import { lgColumns } from '@/utils/ledgerColumns'
import type { ColumnKey } from '@/utils/ledgerColumns'
import { toLedgerColumns, extraColIds } from '@/utils/bookTemplate'
import type { Book } from '@/types/book'
import { lgRecalc } from '@/utils/lgRecalc'
import { exportLedgerMonth } from '@/utils/ledgerExcel'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import { ledgerRowKey } from '@/types/ledger'
import { useAuthStore } from '@/stores/auth'
import { useEditLock } from '@/composables/useEditLock'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'

// 台账录入 = entry(RBAC §2)。无权时表格与合计照常显示,只是没有「编辑模式」入口。
const auth = useAuthStore()

const props = defineProps<{
  month: LedgerMonthDTO            // server snapshot (read state / cancel source)
  draft: LedgerRowDTO[]            // editable working copy (owned by parent)
  book: Book | null                // 当前账册(模板驱动列;null 时回退静态 lgColumns,防御性)
  companyName: string
  year: number
  monthNo: number
  edit: boolean
  saving: boolean
  addableTenants?: FPTenantOption[]   // 编辑态「添加租户行」候选(在租且本月尚无行;含 phase/parentName 供徽章)
  issueCount?: number              // 本月未绑定租户行数(>0 时工具条显琥珀入口,点开问题抽屉)
  focusTenant?: string             // 核对跳转深链:定位并高亮该租户行(一次性,完成后 emit focus-done 由父层清空)
  /** 本期编辑锁的作用域(CONCURRENCY-SPEC §3.1):ledger:{companyId}:{year}-{month}。
   *  不传 = 不上锁,行为与加锁之前一个字不差。 */
  lockScope?: string | null
}>()
const emit = defineEmits<{
  back: []
  'enter-edit': []
  cancel: []
  save: []
  'copy-from-prev': []
  'tenant-click': [row: LedgerRowDTO]
  import: []
  'add-tenant': [tenantId: number]
  'bulk-remove': [rowKeys: number[]]
  'edit-template': []
  'open-issues': []
  'focus-done': []
}>()

// ── 深链定位:渲染后滚动到 focusTenant 行 + .row-flash 高亮渐隐(行在 FPLedgerTable 内,DOM 查找按租户名) ──
// ── 编辑锁(CONCURRENCY-SPEC §4) ──
// 与附表族页头共用同一份机制(useEditLock)。这一屏的编辑态由父层 LedgerView 持有,
// 所以锁的进出挂在两个地方:进 = 拦住 enter-edit 直到占到锁;出 = watch(edit) 归假即还。
// 用 watch 而不是在每个退出口各加一行 —— 父层有 4 条路会把 edit 置回 false
// (取消/保存/换期/切册),漏一条就是一把没人认领的锁。
const lock = useEditLock(() => { if (props.edit) emit('cancel') })
const { lockedBy, evictedBy } = lock
/** 这一期此刻被谁占着 —— 取自在场表，不用点按钮撞门(设计稿 C-2)。 */
const heldByOther = lock.watchScope(() => props.lockScope ?? null)
watch(() => props.edit, (on) => { if (!on) lock.release() })

async function onEnterEdit() {
  if (props.lockScope && !(await lock.acquire(props.lockScope))) return
  emit('enter-edit')
}
/**
 * 被接管时把草稿序列化成 TSV，直接粘进 Excel。
 *
 * 系统不替他保存（锁已经不是他的了，写回去就是又一次静默覆盖），但不能让他白干 ——
 * 「给一个数字却不给出路」等于告诉他「你丢了 14 处改动」然后关门。
 */
function draftAsTsv(): string {
  const TAB = '\t', NL = '\n'
  const leaves = [
    ...cols.value.fixedLeft,
    ...cols.value.groups.flatMap(g => g.cols),
    ...cols.value.fixedRight,
  ]
  const head = leaves.map(c => c.label).join(TAB)
  const body = props.draft.map(r =>
    leaves.map(c => {
      const v = (r as unknown as Record<string, unknown>)[c.key]
      return v == null ? '' : String(v)
    }).join(TAB))
  return [head, ...body].join(NL)
}

async function onTaken() {
  lockedBy.value = null
  if (props.lockScope) await lock.acquire(props.lockScope)
  emit('enter-edit')
}

const pageEl = ref<HTMLElement | null>(null)
watch(() => props.focusTenant, flashFocusRow, { immediate: true })
async function flashFocusRow() {
  const name = props.focusTenant?.trim()
  if (!name) return
  await nextTick()
  for (const tr of pageEl.value?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []) {
    // .lg-tname-txt 是纯名字 span(「未绑定」徽章文本不混入);老结构兜底仍查 .lg-tname
    const cell = tr.querySelector('.lg-tname-txt') ?? tr.querySelector('.lg-tname')
    if ((cell?.textContent ?? '').trim() !== name) continue
    tr.scrollIntoView({ block: 'center' })
    tr.classList.add('row-flash')
    tr.addEventListener('animationend', () => tr.classList.remove('row-flash'), { once: true })
    break
  }
  emit('focus-done')  // 找不到该租户行也视为完成:静默停在本层(spec 取静默)
}

const q = ref('')

// 添加租户(SPEC §5.1:单按钮弹 FPTenantPicker 浮层,选中即加行;model 恒 null,触发器永远显「添加租户」)
function onAddTenant(id: number | null) {
  if (id != null) emit('add-tenant', id)
}

// ── 编辑态批量删除(勾选 → 确认 → 从 draft 移除,保存时以空行落库删除) ──
const selected = ref(new Set<number>())
const bulkConfirm = ref(false)
watch(() => props.edit, (e) => { if (!e) { selected.value = new Set(); bulkConfirm.value = false } })
function toggleSelect(rowKey: number) {
  const next = new Set(selected.value)
  if (next.has(rowKey)) next.delete(rowKey)
  else next.add(rowKey)
  selected.value = next
}
function toggleSelectAll() {
  const all = rows.value.map(r => ledgerRowKey(r))
  selected.value = all.every(k => selected.value.has(k)) ? new Set() : new Set(all)
}
function bulkRemove() {
  bulkConfirm.value = false
  emit('bulk-remove', [...selected.value])
  selected.value = new Set()
}

// 模板驱动列(BOOK-WORKBENCH §3 现行版全局生效);自定义列 id 全集供 lgRecalc 合计口径
const cols = computed(() => props.book
  ? toLedgerColumns(props.book.definition, props.month.prevMonth)
  : lgColumns(props.month.prevMonth))
const extraIds = computed(() => (props.book ? extraColIds(props.book.definition) : []))

// active rows = draft in edit, server rows in read. search filter on tenantName (jsx 418).
const rows = computed(() => (props.edit ? props.draft : props.month.rows))
const view = computed(() =>
  rows.value.filter(r => !q.value.trim() || r.tenantName.includes(q.value.trim())),
)

// KPI 卡整排已取消(EDIT-MODE-SPEC §5.3,2026-08-24 拍板):合计一律看表内 tfoot。
// 记账/结转两计数(结转虚行=只带上月结余的未记账户,2026-08-24 拍板)
const activeTenants = computed(() => rows.value.filter(r => !r.carried && (Number(r.totalReceivable) || 0) > 0).length)
const carriedTenants = computed(() => rows.value.filter(r => r.carried).length)

// cell-edit → mutate draft row + recalc derived (jsx onEdit 422-426)
function onCellEdit(p: { rowKey: number; key: ColumnKey; value: string }) {
  const row = props.draft.find(r => ledgerRowKey(r) === p.rowKey)
  if (!row) return
  if (p.key === 'note') {
    row.note = p.value
  } else {
    ;(row as any)[p.key] = p.value === '' ? 0 : Number(p.value)
    lgRecalc(row, extraIds.value)   // 合计含平铺自定义列(行已 mergeExtras)
  }
}

async function onExport() {
  try {
    await exportLedgerMonth(props.month, props.companyName, props.year, props.monthNo, props.book?.definition)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}

// 编辑态 ⋯ 溢出菜单分发(导出 / 账册模板)
function onMore(key: string) {
  if (key === 'export') void onExport()
  else if (key === 'template') emit('edit-template')
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

// 返回箭头(回矩阵态,两态常驻;「换期」文本按钮仅浏览态,SPEC §5.2-2 导航类编辑态隐藏):
// 编辑态有未保存修改先走脏确认,矩阵态回来草稿已不在
function onBack() {
  if (isDirty.value && !window.confirm('本月台账有修改尚未保存,换期将丢失这些修改,继续?')) return
  emit('back')
}
</script>

<template>
  <div class="lg-page" ref="pageEl">
    <div class="lg-head">
      <div class="lg-head-l">
        <button class="lg-back" @click="onBack" title="换期(返回月份矩阵)"><component :is="iconFor('arrow-left')" :size="16" /></button>
        <div>
          <h2 class="lg-title">{{ book?.name ?? companyName }} <span v-if="book" class="lg-ver">v{{ book.ver }}</span> · {{ year }} 年 {{ monthNo }} 月</h2>
          <p class="lg-sub">{{ companyName }} · 一行一租户 · 上月（{{ month.prevMonth }} 月）结余结转本月</p>
        </div>
      </div>
      <div class="lg-head-actions">
        <!-- 工具条五段定序(EDIT-MODE-SPEC §5,v5 2026-08-24 对齐基准):
             ① 态区(返回箭头在左侧 lg-head-l,两态常驻走脏确认;这里是态 chip)
             ② 录入动作区(仅编辑态,频率降序:导入 > 从上月复制 > 添加租户)
             ④ 溢出 ⋯(只读动作编辑态降级不消失) ⑤ 主控区恒右。
             换期文本按钮编辑态隐藏(§5.2-2 导航类);导出浏览态主行常驻、编辑态进 ⋯(§5.2-3)。
             「账册模板」两态常驻(2026-08-24 拍板移出编辑模式动作区):浏览态主行,编辑态收进 ⋯。 -->
        <span v-if="!edit" class="lg-tag">{{ activeTenants }} 户记账<template v-if="carriedTenants"> · {{ carriedTenants }} 户结转</template></span>
        <!-- 锁的最重要一次沟通是对**持有人**说的:让他知道自己受保护、别人进不来。 -->
        <span v-else class="lg-tag edit">
          <component :is="iconFor('lock')" :size="12" />{{ lockScope ? '本期已锁定 · 仅你可改' : `编辑中 · ${companyName}` }}
        </span>

        <template v-if="edit">
          <!-- ② 录入动作区 -->
          <Button variant="outline" size="sm" :disabled="saving" @click="onImport">
            <template #leading><component :is="iconFor('upload')" :size="14" /></template>
            导入 Excel
          </Button>
          <Button variant="gray" size="sm" :disabled="saving" @click="onCopyPrev">
            <template #leading><component :is="iconFor('copy')" :size="14" /></template>
            从上月复制
          </Button>
          <!-- 添加租户:单按钮弹选择器(§5.1 禁「下拉+按钮」双控件);候选=在租且本月尚无行 -->
          <FPTenantPicker
            class="lg-addbtn"
            :model-value="null"
            :tenants="addableTenants ?? []"
            placeholder="添加租户"
            :disabled="saving"
            empty-hint="本月已有台账行的租户不在候选,请直接在表格中查找该行"
            @update:model-value="onAddTenant"
          />
          <span class="lg-sep" aria-hidden="true" />
          <!-- ④ 溢出:导出/账册模板编辑态收进 ⋯ 不消失 -->
          <FPMoreMenu
            :items="[{ key: 'export', label: '导出 Excel', icon: 'download' }, { key: 'template', label: '账册模板', icon: 'table-2' }]"
            @select="onMore"
          />
          <!-- ⑤ 主控区(恒右):取消紧邻保存,保存 filled 恒最右 -->
          <Button variant="gray" size="sm" :disabled="saving" @click="onCancel">取消</Button>
          <Button variant="filled" size="sm" :disabled="saving" @click="emit('save')">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            保存
          </Button>
        </template>

        <template v-else>
          <!-- 浏览态:[换期][导出] | [编辑模式](主控位与编辑态取消/保存同一右锚) -->
          <Button variant="outline" size="sm" @click="onBack">
            <template #leading><component :is="iconFor('calendar')" :size="14" /></template>
            换期
          </Button>
          <Button variant="outline" size="sm" @click="onExport">
            <template #leading><component :is="iconFor('download')" :size="14" /></template>
            导出 Excel
          </Button>
          <!-- 账册模板(BOOK-WORKBENCH §3):两态常驻,浏览态主行;编辑权限门在面板内(book-template:edit) -->
          <Button variant="outline" size="sm" @click="emit('edit-template')">
            <template #leading><component :is="iconFor('table-2')" :size="14" /></template>
            账册模板
          </Button>
          <!-- ⚠ 编辑模式入口带权限门:无 entry:edit 不显示(2026-08-22 v-else 语义坑,勿改回 v-else 兜底) -->
          <!-- 锁位就长在这颗按钮上(设计稿 §05):min-width 定死,三态换文案不换宽度。 -->
          <Button v-if="auth.can('entry:edit')" variant="outline" size="sm"
                  class="lg-lockbtn" :class="{ held: !!heldByOther }" @click="onEnterEdit">
            <template #leading>
              <span v-if="heldByOther" class="lg-lockav" :class="{ dim: heldByOther.idle }">{{ heldByOther.displayName.slice(0, 1) }}</span>
              <component v-else :is="iconFor('pencil')" :size="14" />
            </template>
            <template v-if="heldByOther">
              {{ heldByOther.displayName }} {{ heldByOther.idle ? `空闲 ${Math.floor(heldByOther.idleMs / 60000)} 分` : '编辑中' }}
            </template>
            <template v-else>编辑模式</template>
          </Button>
        </template>
      </div>
    </div>

    <FPTakeoverDrawer :holder="lockedBy" :scope="lockScope ?? ''"
                      :what="`${companyName} ${year}-${String(monthNo).padStart(2, '0')} 月度台账`"
                      @close="lockedBy = null" @taken="onTaken" />
    <FPEvictedDialog :eviction="evictedBy"
                     :what="`${companyName} ${year}-${String(monthNo).padStart(2, '0')} 月度台账`"
                     :dirty-count="draft.length" :copy-text="draftAsTsv"
                     @close="evictedBy = null" />

    <div class="lg-toolbar">
      <div class="lg-toolbar-l">
        <SearchField placeholder="搜索租户" shortcut="" :value="q" :width="180" @change="q = $event" />
        <!-- 未绑定问题入口:紧贴搜索框、**常驻**(LAYOUT-STABILITY:入口随月份出现/消失会挪动工具条;
             0 问题时置灰,点开是空态说明,用户 2026-08-23 反馈「入口找不到」后定为常驻) -->
        <button class="lg-issues" :class="{ quiet: (issueCount ?? 0) === 0 }" @click="emit('open-issues')">
          <component :is="iconFor('alert-triangle')" :size="13" />
          未绑定 {{ issueCount ?? 0 }}
        </button>
        <Button v-if="edit && selected.size" variant="danger" size="sm" :disabled="saving" @click="bulkConfirm = true">
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          删除所选 ({{ selected.size }})
        </Button>
      </div>
      <span class="lg-toolbar-note">{{ edit ? '点击单元格编辑数值,不收的费用列留空即可,应收/结余自动计算;勾选行可批量删除' : auth.can('entry:edit') ? '只读 · 点击「编辑模式」录入 · 点击租户名查看明细' : '只读 · 点击租户名查看明细' }}</span>
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
/* 锁位:三态同宽 —— 「编辑模式」/「张三 编辑中」/「张三 空闲 23 分」换文案不挪版 */
.lg-lockbtn { min-width:150px; justify-content:center; }
.lg-lockbtn.held { border-color:var(--hue-orange); background:rgb(252,243,232); color:var(--hue-orange); }
.lg-lockav { width:18px; height:18px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center; background:var(--fill-blue); color:#fff; font-size:9.5px; font-weight:var(--fw-semibold); }
.lg-lockav.dim { opacity:.55; }

/* 1:1 from screen-ledger.jsx LgStyles 70-81, 140-141, 149-151, 175-178, 217-218 */
.lg-page { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.lg-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lg-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.lg-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lg-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.lg-title { margin:0; font:var(--type-h2); color:var(--text-primary); }
/* 模板版本徽标(账册头,BOOK-WORKBENCH §5) */
.lg-ver { display:inline-block; vertical-align:3px; font-family:var(--font-mono); font-size:11px; font-weight:var(--fw-semibold);
  color:var(--hue-blue); background:var(--accent-blue); border-radius:var(--radius-full); padding:2px 9px; }
.lg-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lg-head-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

.lg-tag { display:inline-flex; align-items:center; height:28px; padding:0 12px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-secondary); font-size:12.5px; font-weight:var(--fw-medium); }
.lg-tag.edit { background:rgb(252,243,232); color:var(--hue-orange); }
/* 段间分隔(SPEC §5.1 细竖线断档) */
.lg-sep { flex:0 0 auto; width:1px; height:18px; background:var(--border-subtle); }
/* 「添加租户」单按钮弹选择器:触发器对齐 ds/Button sm(高28/胶囊/12px 字),浮层右对齐定宽不随按钮收窄 */
.lg-addbtn :deep(.fp-tp-trigger) { height:28px; padding:0 12px; gap:6px; border-radius:var(--radius-full); font-size:var(--fs-label); }
.lg-addbtn :deep(.fp-tp-trigger .txt.ph) { color:var(--text-primary); }
.lg-addbtn :deep(.fp-tp-pop) { width:260px; left:auto; right:0; }
/* 批量删除确认弹窗(1:1 LedgerNewCompanyDialog .lg-dlg 风格) */
.lg-bulk-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:320; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); }
.lg-bulk-dlg { width:min(420px,92vw); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); }
.lg-bulk-dlg .h { padding:20px 22px 4px; }
.lg-bulk-dlg .h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-bulk-dlg .h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-bulk-dlg .f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }

.lg-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.lg-toolbar-l { display:flex; align-items:center; gap:10px; }
.lg-toolbar-note { font-size:12px; color:var(--text-muted); }
.lg-issues {
  display:inline-flex; align-items:center; gap:5px;
  height:28px; padding:0 10px; border-radius:var(--radius-full);
  border:1px solid var(--status-warning); background:transparent;
  color:var(--status-warning); font-size:12px; font-weight:var(--fw-medium);
  cursor:pointer; white-space:nowrap;
}
.lg-issues:hover { background:var(--bg-hover); }
.lg-issues.quiet { border-color:var(--border-subtle); color:var(--text-muted); }

.lg-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* 深链定位行:2s 高亮渐隐(行在子组件 FPLedgerTable 内,须 :deep;结束后还原表格自身背景) */
:deep(tr.row-flash > td) { animation: lg-row-flash var(--dur-highlight) var(--ease-standard); }
@keyframes lg-row-flash { from { background: var(--accent-blue); } to { background: var(--surface-white); } }
</style>
