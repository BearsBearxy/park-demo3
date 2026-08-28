<script setup lang="ts">
// 利润表屏 — 两层状态机(useFinStatementScreen 三屏共用) + §6 加载门。
// 动线(2026-08-29 改,设计稿 §3.2a):左栏常驻管理公司 → 选期矩阵(全部年份纵排×12月格)→ 正文。
// 改前是四层串行(整屏选公司 → 年份门 → 月历 → 正文),换个公司看要退回第一屏重走三道门。
//   · 单公司 = 可编辑(本月 cur / 本年累计 ytd 两列);companyId==='all' = 跨公司只读求和(无编辑/导入)。
//   · 常驻行(IS_ROWS)无数据留空;明细行下可加自定义子类(父项自动汇总);小计行(21/30/32)按公式算。
// 本屏只留利润表特有部分:双列取值、行树、公式/KPI、保存载荷、自定义子类与批量删除、导出。
import { ref, computed } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { reportApi } from '@/api/report'
import type { ReportCell, ReportCustomRowDTO } from '@/types/report'
import { IS_ROWS, computeRow } from '@/reports/incomeStatement'
import { parserProps } from '@/utils/importRegistry'
import { finMoney } from '@/utils/finFmt'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import BookRail from '@/components/fp/BookRail.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { useAuthStore } from '@/stores/auth'
import { useFinStatementScreen } from '@/components/fin/useFinStatementScreen'
import FinDialogs from '@/components/fin/FinDialogs.vue'
import type { FinTableRow } from '@/components/fin/FinReportTable.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import IncomeStatementTable from './IncomeStatementTable.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'

const STMT = 'is'

// 批量删除选集(屏内私有;进出编辑/切月由 resetLocal 清空)
const selected = ref(new Set<string | number>())

const {
  canEdit,
  companyId, year, month, edit, saving,
  companiesLoaded, period, draft, dirty, dlg,
  isAll, company, companyName, finCompanies,
  railItems, matrixYears, matrixBook, gateYears,
  periodSteps, stripLabel, stripQuery,
  pickCompany, pickCell, backToMatrix, addEarlier, addLater, removeYear,
  loadPeriod,
  enterEdit, onTaken, lockedBy, evictedBy, heldByOther, lockScope, requestCancel, saveConfirm, finishEdit, save, onDiscard,
  onNewCompany, onEditCompany, onDeleteCompany, submitCompany, confirmDelete,
  importing, importResult, importSummary, onImport, requestImport,
} = useFinStatementScreen({
  stmt: STMT,
  resetLocal: () => { selected.value = new Set() },
})


// 新增/重命名/删除公司写的是 management_company,归 master 不归 report(RBAC §5.6:
// 删公司同事务级联删该公司 monthly_ledger + report_*)。这条判定原先长在 FinCompanyPicker 里,
// 那个整屏选择器随四层动线退场,门跟着搬到左栏管理区。
const canManageCo = computed(() => useAuthStore().can('master:edit'))

// ── 计算(客户端):叶子 = 录入/持久值;自定义父项 = 子类求和;小计 = IS_FORMULA ──
const customRows = computed<ReportCustomRowDTO[]>(() => period.value?.customRows ?? [])
const childrenOf = (parentKey: string) =>
  customRows.value.filter(r => String(r.parentKey) === String(parentKey))

// 叶子取值:编辑态优先 draft(仅单公司可编辑),否则服务端 amounts。
function getLeaf(rowKey: string | number, field: string): number {
  const k = String(rowKey)
  const dk = `${k}|${field}`
  if (edit.value && !isAll.value && dk in draft.value) return draft.value[dk]
  const cell = period.value?.amounts[k]
  return cell ? (Number(cell[field as 'cur' | 'ytd']) || 0) : 0
}
// 自定义子类之和(递归);无子类返回 null(回落叶子)。供 computeRow 用。
function customChildrenSum(rowKey: string | number, field: string): number | null {
  const kids = childrenOf(String(rowKey))
  if (!kids.length) return null
  return kids.reduce((s, kid) => s + nodeValue(kid.rowKey, field), 0)
}
// 任意节点值(常驻小计走公式,常驻/自定义 normal 走叶子或子类和)。
function nodeValue(rowKey: string | number, field: string): number {
  const no = Number(rowKey)
  if (Number.isInteger(no) && IS_ROWS.some(r => r.no === no)) {
    return computeRow(no, field, getLeaf, customChildrenSum)
  }
  // 自定义行:有子类则求和,否则叶子
  const childSum = customChildrenSum(rowKey, field)
  return childSum !== null ? childSum : getLeaf(rowKey, field)
}
const valueOf = (rowKey: string | number, field: string) => nodeValue(rowKey, field)
const liveOf = (rowKey: string | number, field: string): number | string => {
  const dk = `${String(rowKey)}|${field}`
  if (dk in draft.value) return draft.value[dk]
  const cell = period.value?.amounts[String(rowKey)]
  return cell ? (Number(cell[field as 'cur' | 'ytd']) || 0) : 0
}

// ── 展平行树:常驻行 + 自定义子类递归 ──────────────────────
const flatRows = computed<FinTableRow[]>(() => {
  const out: FinTableRow[] = []
  const pushChildren = (parentKey: string, baseLevel: number) => {
    for (const c of childrenOf(parentKey)) {
      const kids = childrenOf(c.rowKey)
      out.push({
        key: c.rowKey, label: c.label, level: Math.min(baseLevel + 1, 3), type: 'normal',
        custom: true, parentAuto: kids.length > 0, childCount: kids.length,
        canAddChild: baseLevel + 1 < 2,
      })
      pushChildren(c.rowKey, baseLevel + 1)
    }
  }
  for (const r of IS_ROWS) {
    const kids = r.type === 'normal' ? childrenOf(String(r.no)) : []
    out.push({
      key: r.no, no: r.no, label: r.label, level: r.level, type: r.type,
      strong: r.type === 'subtotal',
      parentAuto: kids.length > 0, childCount: kids.length,
      canAddChild: r.type === 'normal' && r.level < 2,
    })
    pushChildren(String(r.no), r.level)
  }
  return out
})

// ── 编辑流(进出编辑/保存外壳在 useFinStatementScreen;此处只给本表的录入与保存载荷) ──
function onInput(rowKey: string | number, field: string, value: string) {
  const dk = `${String(rowKey)}|${field}`
  draft.value = { ...draft.value, [dk]: value === '' ? 0 : Number(value) }
}
// 保存本期该公司全部叶子(常驻 normal + 自定义)cur/ytd:合并服务端已有值与 draft 覆盖。
function saveBody() {
  const cells: ReportCell[] = []
  const merged = mergedLeafValues()
  for (const [dk, amount] of merged) {
    const [rowKey, field] = dk.split('|')
    cells.push({ rowKey, field, amount })
  }
  return { cells }
}
// 保存体:所有可录入叶子行(常驻 normal + 自定义)× cur/ytd,draft 覆盖服务端值。
function mergedLeafValues(): Map<string, number> {
  const m = new Map<string, number>()
  const leafKeys: string[] = [
    ...IS_ROWS.filter(r => r.type === 'normal').map(r => String(r.no)),
    ...customRows.value.map(r => r.rowKey),
  ]
  for (const k of leafKeys) {
    for (const field of ['cur', 'ytd']) {
      const dk = `${k}|${field}`
      const cell = period.value?.amounts[k]
      const base = cell ? (Number(cell[field as 'cur' | 'ytd']) || 0) : 0
      const v = dk in draft.value ? draft.value[dk] : base
      if (v !== 0) m.set(dk, v)  // 0 值不落库(与后端 clear+insert 一致,留空即无行)
    }
  }
  return m
}

// ── 自定义子类增删 ────────────────────────────────────────
function onAddChild(row: FinTableRow) {
  dlg.value = {
    type: 'addrow', parentLabel: row.label, heading: '添加利润表子类',
    placeholder: '如:厂房租金收入',
    hint: '子类金额逐期录入,父项自动按子类合计;可继续在子类下添加下一级。',
  }
  addParentKey.value = String(row.key)
  addParentLevel.value = row.level
}
const addParentKey = ref('')
const addParentLevel = ref(0)
async function submitRow(label: string) {
  if (companyId.value == null || isAll.value) return
  try {
    await reportApi.addCustomRow(STMT, companyId.value as number, {
      parentKey: addParentKey.value, label, level: Math.min(addParentLevel.value + 1, 3),
    })
    dlg.value = null
    await loadPeriod()
    if (!edit.value) enterEdit()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '添加子类失败')
  }
}
// 自定义行删除:row.key 是 rowKey(字符串) → customRows 里查 id → deleteCustomRow(级联后端处理)。
async function removeCustom(row: FinTableRow) {
  const target = customRows.value.find(r => r.rowKey === String(row.key))
  if (!target) return
  try {
    await reportApi.deleteCustomRow(STMT, target.id)
    selected.value.delete(row.key)
    await loadPeriod()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除子类失败')
  }
}

// ── 批量删除(P2-G3):编辑态多选 → 自定义行立即级联删、固定行清空本期值进 draft ──
const bulkConfirm = ref(false)
function onToggleSelect(row: FinTableRow) {
  if (selected.value.has(row.key)) selected.value.delete(row.key)
  else selected.value.add(row.key)
}
// 选集拆分:自定义行(有 customRow 记录) / 固定行(其余普通叶子行)
const selSplit = computed(() => {
  const custom: ReportCustomRowDTO[] = []
  const fixed: string[] = []
  for (const k of selected.value) {
    const c = customRows.value.find(r => r.rowKey === String(k))
    if (c) custom.push(c)
    else fixed.push(String(k))
  }
  return { custom, fixed }
})
async function bulkDelete() {
  const { custom, fixed } = selSplit.value
  bulkConfirm.value = false
  try {
    // 自定义行:祖先也在选中集内的跳过(父删即级联),其余循环既有级联端点立即删除
    const chosen = new Set(custom.map(c => c.rowKey))
    const ancestorChosen = (c: ReportCustomRowDTO): boolean => {
      let p: string | undefined = c.parentKey
      while (p) {
        if (chosen.has(p)) return true
        p = customRows.value.find(x => x.rowKey === p)?.parentKey
      }
      return false
    }
    for (const c of custom) {
      if (!ancestorChosen(c)) await reportApi.deleteCustomRow(STMT, c.id)
    }
    // 固定行:cur/ytd 写 0 进 draft(=留空,随「保存」clear+insert 落库删除)
    const d = { ...draft.value }
    for (const k of fixed) for (const f of ['cur', 'ytd']) d[`${k}|${f}`] = 0
    draft.value = d
    selected.value = new Set()
    if (custom.length) await loadPeriod()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除所选失败')
  }
}

// ── KPI(营业收入/营业利润/利润总额/净利润 本月)────────────
const kpiRevenue = computed(() => nodeValue(1, 'cur'))
const kpiOp = computed(() => nodeValue(21, 'cur'))
const kpiTotal = computed(() => nodeValue(30, 'cur'))
const kpiNet = computed(() => nodeValue(32, 'cur'))

const itemCount = computed(() =>
  IS_ROWS.filter(r => r.type === 'normal').length + customRows.value.length,
)

// ── 导出 xlsx(懒加载)────────────────────────────────────
async function onExport() {
  if (!period.value || month.value == null) return
  try {
    const { exportIncomeStatement } = await import('@/utils/incomeStatementExcel')
    // 必须 await:出流改 exceljs 后写文件是异步的,裸调用的 rejection 会逃出这个 try/catch 变 unhandled
    await exportIncomeStatement(
      flatRows.value, valueOf,
      companyName.value ?? '全部汇总', year.value, month.value,
    )
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}
</script>

<template>
  <div class="finw">
    <!-- 左轨常驻:管理公司一键切换(BOOK-WORKBENCH-SPEC §7-2 实体切换在左栏)。
         改前这是一整屏的公司选择器,换个公司看要退回第一屏再走年份门与月历两道门。 -->
    <aside class="finw-rail">
      <div class="finw-rail-t">管理公司</div>
      <BookRail :books="railItems" :active-id="companyId" :can-manage="canManageCo" @select="pickCompany">
        <template #manage>
          <div class="finw-manage">
            <button class="finw-mbtn" @click="onNewCompany">
              <component :is="iconFor('plus')" :size="13" />新增
            </button>
            <button class="finw-mbtn" :disabled="isAll || !company" @click="onEditCompany()">
              <component :is="iconFor('pencil')" :size="13" />重命名
            </button>
            <button class="finw-mbtn del" :disabled="isAll || !company" @click="onDeleteCompany()">
              <component :is="iconFor('trash-2')" :size="13" />删除
            </button>
          </div>
        </template>
      </BookRail>
    </aside>

    <div class="finw-main">
      <!-- 公司清单未到位 -->
      <div v-if="!companiesLoaded" class="page-loading"><span class="page-spin" /></div>

      <!-- 一家公司都没有:左栏「新增」是唯一出路,别给一屏空矩阵 -->
      <div v-else-if="companyId === null" class="finw-empty">
        <component :is="iconFor('bar-chart-3')" :size="28" />
        <p class="t">还没有管理公司</p>
        <p class="s">在左栏底部「新增」建一家,利润表 按公司 × 年月分期</p>
      </div>

      <!-- ⓪ 选期矩阵(年份门 + 月历合成一张,2026-08-24「选期矩阵 v3」推到报表层) -->
      <template v-else-if="month === null">
        <div class="finw-head">
          <div>
            <h2 class="finw-title">
              <span class="ic"><component :is="iconFor('bar-chart-3')" :size="18" /></span>利润表 · {{ companyName ?? '全部汇总' }}
            </h2>
            <p class="finw-sub">选择月份进入该期报表 · 每个年月是一期独立报表</p>
          </div>
        </div>
        <div v-if="gateYears" class="finw-matrix">
          <BookMonthMatrix
            :book="matrixBook"
            :years="matrixYears"
            @pick="pickCell"
            @add-earlier="addEarlier"
            @add-later="addLater"
            @remove-year="removeYear"
          />
        </div>
        <div v-else class="page-loading"><span class="page-spin" /></div>
      </template>


  <!-- 正文态(下面这一块整体位于 .finw-main 内,缩进保持原样以免冲淡 diff) -->
  <template v-else-if="period">
    <div class="fin-page">
      <!-- 期间条(设计稿 §3.2c):九张报表横跳不换期。与出账链链路条同一个组件 -->
      <FPStepStrip :steps="periodSteps" current="income-statement" :period="stripLabel"
                   :query="stripQuery" back-label="换期" @back="backToMatrix" />
      <div class="fin-head">
        <div class="fin-head-l">
          <button class="fin-back" title="返回选期矩阵" @click="backToMatrix"><component :is="iconFor('arrow-left')" :size="16" /></button>
          <div>
            <h2 class="fin-title">利润表</h2>
            <p class="fin-sub">{{ isAll ? '全部汇总' : company?.name }} · <span class="mono">{{ year }} 年 {{ month }} 月</span></p>
          </div>
        </div>
        <div class="fin-actions">
          <span v-if="isAll" class="fin-tag ro"><component :is="iconFor('lock')" :size="13" />汇总只读</span>
          <!-- 三段(EDIT-MODE-SPEC v2):写操作仅编辑态 / 只读操作两态常驻 / 右端主控件。
               改前导入在**两态都有**(浏览态也能点,违反 v2「浏览态一切写入口隐藏」),
               而导出被关在浏览态分支里 —— 一进编辑模式导出就消失,可导出恰恰是 v2 明列的只读操作。 -->
          <template v-else>
            <span v-if="edit" class="fin-tag edit">编辑中 · {{ company?.name }}</span>
            <Button v-if="edit" variant="outline" size="sm" :disabled="saving" @click="requestImport">
              <template #leading><component :is="iconFor('upload')" :size="14" /></template>
              导入
            </Button>
            <Button variant="outline" size="sm" @click="onExport">
              <template #leading><component :is="iconFor('download')" :size="14" /></template>
              导出 Excel
            </Button>
            <!-- 草稿型屏:编辑态走下面的 [取消][保存]，所以这里只负责浏览态那三态
                 (编辑模式 / 张三 编辑中 / 张三 空闲 23 分) —— 设计稿 §05 -->
            <FPEditModeButton v-if="!edit" :edit="false" :held-by-other="heldByOther"
                              :can-enter="canEdit" @toggle="enterEdit" />
            <!-- ⚠ 必须 v-if="edit"，不能 v-else：上面是「!edit && canEdit」，
                 v-else 会把「没权限」也算进去，无权账号将看到「保存/取消」。 -->
            <template v-if="edit">
              <Button variant="gray" size="sm" :disabled="saving" @click="requestCancel">取消</Button>
              <Button variant="filled" size="sm" :disabled="saving" @click="finishEdit">
                <template #leading><component :is="iconFor('check')" :size="14" /></template>
                保存
              </Button>
            </template>
          </template>
        </div>
      </div>

      <div class="fin-kpis">
        <KpiCard tint="slate" label="营业收入(本月)"><span class="fin-kval">{{ finMoney(kpiRevenue) }}</span><template #icon><component :is="iconFor('trending-up')" :size="18" /></template></KpiCard>
        <KpiCard tint="blue" label="营业利润(本月)"><span class="fin-kval">{{ finMoney(kpiOp) }}</span><template #icon><component :is="iconFor('bar-chart-3')" :size="18" /></template></KpiCard>
        <KpiCard tint="sky" label="利润总额(本月)"><span class="fin-kval">{{ finMoney(kpiTotal) }}</span><template #icon><component :is="iconFor('sigma')" :size="18" /></template></KpiCard>
        <KpiCard tint="cyan" label="净利润(本月)"><span class="fin-kval" :style="{ color: kpiNet < 0 ? 'var(--hue-red)' : undefined }">{{ finMoney(kpiNet) }}</span><template #icon><component :is="iconFor('wallet')" :size="18" /></template></KpiCard>
      </div>

      <div class="fin-toolbar">
        <div class="fin-toolbar-l">
          <span class="fin-tag">{{ itemCount }} 项</span>
          <Button v-if="edit && selected.size" variant="danger" size="sm" @click="bulkConfirm = true">
            <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
            删除所选 ({{ selected.size }})
          </Button>
        </div>
        <span class="fin-toolbar-note">{{ isAll ? '全部汇总为跨公司只读求和,如需录入请在公司选择页进入单家公司' : edit ? '点击单元格录入金额;悬停明细行可「+」添加子类,父项自动汇总;空项留空即可' : canEdit ? '只读 · 点击「编辑」录入 · 深色行为公式自动计算' : '只读 · 深色行为公式自动计算' }}</span>
      </div>

      <IncomeStatementTable
        :rows="flatRows"
        :value-of="valueOf"
        :editable="edit && !isAll"
        :live-of="liveOf"
        :selectable="edit && !isAll"
        :selected="selected"
        @input="onInput"
        @add-child="onAddChild"
        @remove-child="removeCustom"
        @toggle-select="onToggleSelect"
      />

      <p class="fin-foot"><component :is="iconFor('info')" :size="13" />单位:元 · 营业利润 = 营业收入 − 营业成本 − 税金及附加 − 销售/管理/财务费用 + 投资收益;利润总额 = 营业利润 + 营业外收入 − 营业外支出;净利润 = 利润总额 − 所得税费用。</p>
    </div>

    <FpImportModal
      v-if="importing"
      :title="'导入 利润表'"
      :sub="'上传/粘贴合并多公司的利润表(两行表头,每公司本月/本年累计两列),按公司拆段、未匹配公司自动新建,导入到当前所选年月'"
      v-bind="parserProps('report_is')"
      @close="importing = false"
      @import-sections="onImport"
    />

    <SaveConfirmDialog
      v-if="saveConfirm"
      :count="dirty"
      @save="save(saveBody)"
      @discard="onDiscard"
      @close="saveConfirm = false"
    />
  </template>

      <!-- 过渡中(切公司 / 点月格,数据加载)兜底转圈,不闪空白。
           ⚠️ v-else 必须紧邻上方「矩阵态 / 正文态」状态链;不可被自带 v-if 的弹窗隔在中间
              (见 DESIGN-FIDELITY §6.2)。 -->
  <div v-else class="page-loading"><span class="page-spin" /></div>
    </div>
  </div>

  <!-- 公司/子类弹窗(居中,自管 v-if),放最后 -->
  <FinDialogs
    :dlg="dlg"
    :companies="finCompanies"
    @close="dlg = null"
    @submit-company="submitCompany"
    @confirm-delete="confirmDelete"
    @submit-row="submitRow"
  />

  <!-- 导入结果(自管 v-if),放最后:不打断上方 v-if/v-else 状态链(DESIGN-FIDELITY §6.2) -->
  <ImportResultToast
    v-if="importResult"
    :result="importResult"
    :summary="importSummary"
    @close="importResult = null; importSummary = ''"
  />

  <!-- 批量删除确认(遵 DESIGN-FIDELITY §7:Teleport + backdrop 居中;样式 1:1 FinDialogs .fin-mask/.fin-dlg),放最后 -->
  <Teleport to="body">
    <div v-if="bulkConfirm" class="fin-mask" @mousedown="bulkConfirm = false">
      <div class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="fin-dlg-h">
          <h3>删除所选行</h3>
          <p>
            <template v-if="selSplit.custom.length">自定义行 {{ selSplit.custom.length }} 行将删除(含其下子类,立即生效);</template>
            <template v-if="selSplit.fixed.length">固定行 {{ selSplit.fixed.length }} 行将清空本期数值(点「保存」后生效)。</template>
          </p>
        </div>
        <div class="fin-dlg-f" style="padding-top:20px">
          <Button variant="gray" size="sm" @click="bulkConfirm = false">取消</Button>
          <Button variant="danger" size="sm" @click="bulkDelete">
            <template #leading><component :is="iconFor('trash-2')" /></template>
            确认删除
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
  <FPTakeoverDrawer :holder="lockedBy" :scope="lockScope() ?? ''"
                    :what="`利润表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                    @close="lockedBy = null" @taken="onTaken" />
  <FPEvictedDialog :eviction="evictedBy"
                   :what="`利润表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                   :dirty-count="dirty" @close="evictedBy = null" />
</template>

<style scoped>
/* L3 chrome — 1:1 from fin-common.jsx FinStyles(.fin-head/.fin-kpis/.fin-toolbar/.fin-tag 段)。
   L1/L2 chrome 已随各 fin 组件 scoped 携带;此处仅补 L3 独有部分。 */
.fin-page { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.fin-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.fin-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.fin-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.fin-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.fin-title { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.fin-sub .mono { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.fin-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.fin-tag { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-secondary); font-size:12.5px; font-weight:var(--fw-medium); }
.fin-tag.edit { background:rgb(255,243,230); color:var(--hue-orange); }
.fin-tag.ro { background:var(--accent-sky); color:var(--hue-blue); }
.fin-kpis { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
.fin-kpis .fin-kval { white-space:nowrap; font-size:clamp(14px, 1.5vw, 22px); }
.fin-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.fin-toolbar-l { display:flex; align-items:center; gap:8px; }
.fin-toolbar-note { font-size:12px; color:var(--text-muted); }
.fin-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
/* 批量删除确认弹窗 — 1:1 FinDialogs .fin-mask/.fin-dlg(scoped 不跨组件,故本屏自带一份,遵 §7) */
.fin-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.fin-dlg { width:min(440px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }

/* ── 工作台外壳(2026-08-29,设计稿 §3.2a):左轨常驻 + 主区。与月度台账 .lgw 家族同形 ── */
.finw { display: flex; gap: 16px; width: 100%; height: 100%; min-height: 0; box-sizing: border-box;
        font-family: var(--font-sans); color: var(--text-primary); }
.finw-rail {
  flex: 0 0 208px; min-height: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 14px 12px; box-sizing: border-box;
  background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
}
.finw-rail-t { font-size: 12px; font-weight: var(--fw-medium); color: var(--text-muted); padding: 0 4px; }
.finw-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }

/* 左轨底部管理区:三个动作(新增/重命名/删除),作用于当前选中那一家 */
.finw-manage { display: flex; gap: 4px; margin-top: var(--space-2); }
.finw-mbtn {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  padding: 8px 4px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm);
  background: transparent; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-micro); color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.finw-mbtn:hover:not(:disabled) { color: var(--hue-blue); border-color: var(--hue-blue); }
.finw-mbtn.del:hover:not(:disabled) { color: var(--hue-red); border-color: var(--hue-red); }
/* 停在「全部汇总」时无对象可改 —— 置灰不挪位(LAYOUT-STABILITY:入口常驻) */
.finw-mbtn:disabled { color: var(--text-disabled); border-color: var(--border-subtle); cursor: default; }

.finw-head { flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.finw-title { margin: 0; font: var(--type-h2); display: flex; align-items: center; gap: var(--space-2); }
.finw-title .ic {
  width: 26px; height: 26px; border-radius: var(--radius-sm);
  background: var(--accent-blue); color: var(--hue-blue); display: grid; place-items: center; flex: none;
}
.finw-sub { margin: 4px 0 0; font-size: var(--fs-label); color: var(--text-muted); }
.finw-matrix { flex: 0 0 auto; }

.finw-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--text-disabled);
}
.finw-empty .t { margin: 8px 0 0; font-size: 15px; font-weight: var(--fw-semibold); color: var(--text-muted); }
.finw-empty .s { margin: 0; font-size: 12px; color: var(--text-disabled); }
</style>
