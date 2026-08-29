<script setup lang="ts">
// 资产负债表屏 — 两层状态机(useFinStatementScreen 三屏共用) + §6 加载门。差异(spec B1/B2):
//   · 单列 期末余额(field='end');L3 两栏 .fin-two:左=资产(side L) ‖ 右=负债和所有者权益(side R),各一个 FinReportTable。
//   · 合计行(15/20/29/30/41/46/47/52/53)按 BS_SUBTOTAL 客端重算不落库;其中明细(10–13)为信息行不入 15。
//   · 单公司可编辑;companyId==='all' 跨公司只读求和。KPI:资产总计/负债合计/权益合计/平衡差(30−53,非 0 显红)。
import { ref, computed } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { reportApi } from '@/api/report'
import type { ReportCell, ReportCustomRowDTO } from '@/types/report'
import { BS_ROWS, computeBsRow } from '@/reports/balanceSheet'
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
import FinReportTable, { type FinTableRow, type FinTableColumn } from '@/components/fin/FinReportTable.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'

const STMT = 'bs'
const FIELD = 'end'
// 单列口径(spec B1):期末余额。
const BS_COLUMNS: FinTableColumn[] = [{ key: FIELD, label: '期末余额' }]
// 强调小计(原型 fin-data.js strong 标记):资产总计/负债合计/负债和所有者权益总计。
const STRONG_NOS = new Set([30, 47, 53])

// 批量删除选集(两栏共用;进出编辑/切月由 resetLocal 清空)
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
  // bs 只存 field='end',后端 netPreview(行1 cur)恒 0,月卡显 ¥0.00 是误导 → 只标「已录入」
  zeroPreviewHidden: true,
  resetLocal: () => { selected.value = new Set() },
})


// 新增/重命名/删除公司写的是 management_company,归 master 不归 report(RBAC §5.6:
// 删公司同事务级联删该公司 monthly_ledger + report_*)。这条判定原先长在 FinCompanyPicker 里,
// 那个整屏选择器随四层动线退场,门跟着搬到左栏管理区。
const canManageCo = computed(() => useAuthStore().can('master:edit'))

// ── 计算(客户端):叶子 = 录入/持久值;自定义父项 = 子类求和;合计 = BS_SUBTOTAL ──
const customRows = computed<ReportCustomRowDTO[]>(() => period.value?.customRows ?? [])
const childrenOf = (parentKey: string) =>
  customRows.value.filter(r => String(r.parentKey) === String(parentKey))

// 叶子取值(单列 end):编辑态优先 draft(仅单公司可编辑),否则服务端 amounts。
// amounts 格 = field→金额 通用 map(bs 只有 end),前端类型按 is 声明 cur/ytd,此处窄化到 end。
function getLeaf(rowKey: string | number): number {
  const k = String(rowKey)
  const dk = `${k}|${FIELD}`
  if (edit.value && !isAll.value && dk in draft.value) return draft.value[dk]
  const cell = period.value?.amounts[k] as unknown as { end?: number } | undefined
  return cell ? (Number(cell.end) || 0) : 0
}
// 自定义子类之和(递归);无子类返回 null(回落叶子)。供 computeBsRow 用。
function customChildrenSum(rowKey: string | number): number | null {
  const kids = childrenOf(String(rowKey))
  if (!kids.length) return null
  return kids.reduce((s, kid) => s + nodeValue(kid.rowKey), 0)
}
// 任意节点值(常驻小计走公式,常驻/自定义 normal 走叶子或子类和)。
function nodeValue(rowKey: string | number): number {
  const no = Number(rowKey)
  if (Number.isInteger(no) && BS_ROWS.some(r => r.no === no)) {
    return computeBsRow(no, n => getLeaf(n), n => customChildrenSum(n))
  }
  const childSum = customChildrenSum(rowKey)
  return childSum !== null ? childSum : getLeaf(rowKey)
}
const valueOf = (rowKey: string | number, _field: string) => nodeValue(rowKey)
const liveOf = (rowKey: string | number, field: string): number | string => {
  const dk = `${String(rowKey)}|${field}`
  if (dk in draft.value) return draft.value[dk]
  return getLeaf(rowKey) || ''
}

// ── 展平行树(按 side 各一栏):常驻行 + 自定义子类递归 ─────
function flatSide(side: 'L' | 'R'): FinTableRow[] {
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
  let lbl = 0
  for (const r of BS_ROWS) {
    if (r.side !== side) continue
    if (r.no === null) {
      out.push({ key: `${side}-lbl-${lbl++}`, label: r.label, level: r.level, type: 'label' })
      continue
    }
    const kids = r.type === 'normal' ? childrenOf(String(r.no)) : []
    out.push({
      key: r.no, no: r.no, label: r.label, level: r.level, type: r.type,
      strong: STRONG_NOS.has(r.no),
      parentAuto: kids.length > 0, childCount: kids.length,
      canAddChild: r.type === 'normal' && r.level < 2,
    })
    pushChildren(String(r.no), r.level)
  }
  return out
}
const rowsL = computed(() => flatSide('L'))
const rowsR = computed(() => flatSide('R'))

// ── 编辑流(进出编辑/保存外壳在 useFinStatementScreen;此处只给本表的录入与保存载荷) ──
function onInput(rowKey: string | number, field: string, value: string) {
  const dk = `${String(rowKey)}|${field}`
  draft.value = { ...draft.value, [dk]: value === '' ? 0 : Number(value) }
}
// 保存本期该公司全部叶子(常驻 normal + 自定义)end:合并服务端已有值与 draft 覆盖。
function saveBody() {
  const cells: ReportCell[] = []
  for (const [dk, amount] of mergedLeafValues()) {
    const [rowKey, field] = dk.split('|')
    cells.push({ rowKey, field, amount })
  }
  return { cells }
}
// 保存体:所有可录入叶子行(常驻 normal + 自定义)× end,draft 覆盖服务端值。
function mergedLeafValues(): Map<string, number> {
  const m = new Map<string, number>()
  const leafKeys: string[] = [
    ...BS_ROWS.filter(r => r.type === 'normal').map(r => String(r.no)),
    ...customRows.value.map(r => r.rowKey),
  ]
  for (const k of leafKeys) {
    const dk = `${k}|${FIELD}`
    const cell = period.value?.amounts[k] as unknown as { end?: number } | undefined
    const base = cell ? (Number(cell.end) || 0) : 0
    const v = dk in draft.value ? draft.value[dk] : base
    if (v !== 0) m.set(dk, v)  // 0 值不落库(与后端 clear+insert 一致,留空即无行)
  }
  return m
}

// ── 自定义子类增删 ────────────────────────────────────────
function onAddChild(row: FinTableRow) {
  dlg.value = {
    type: 'addrow', parentLabel: row.label, heading: '添加资产负债表子类',
    placeholder: '如:航泽借款',
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

// ── 批量删除(P2-G3):编辑态多选(两栏共用一个选集) → 自定义行立即级联删、固定行清空本期值进 draft ──
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
    // 固定行:end 写 0 进 draft(=留空,随「保存」clear+insert 落库删除)
    const d = { ...draft.value }
    for (const k of fixed) d[`${k}|${FIELD}`] = 0
    draft.value = d
    selected.value = new Set()
    if (custom.length) await loadPeriod()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除所选失败')
  }
}

// ── KPI(资产总计/负债合计/权益合计/平衡差)────────────────
const kpiAssets = computed(() => nodeValue(30))
const kpiLiab = computed(() => nodeValue(47))
const kpiEquity = computed(() => nodeValue(52))
const kpiDiff = computed(() => nodeValue(30) - nodeValue(53))
// 浮点噪声容差(分以下视为已平)
const balanced = computed(() => Math.abs(kpiDiff.value) < 0.005)

const itemCount = computed(() =>
  BS_ROWS.filter(r => r.type === 'normal').length + customRows.value.length,
)

// ── 导出 xlsx(懒加载,两栏并排同文件版式)──────────────────
async function onExport() {
  if (!period.value || month.value == null) return
  try {
    const { writeAoaWorkbook } = await import('@/utils/sheet')
    const cellRow = (r: FinTableRow | undefined): (string | number)[] => {
      if (!r) return ['', '', '']
      const no = r.type === 'label' || r.custom ? '' : r.no ?? r.key
      return [r.label, no, r.type === 'label' ? '' : valueOf(r.key, FIELD)]
    }
    const header = ['资产', '行次', '期末余额', '负债和所有者权益', '行次', '期末余额']
    const n = Math.max(rowsL.value.length, rowsR.value.length)
    const body = Array.from({ length: n }, (_, i) => [...cellRow(rowsL.value[i]), ...cellRow(rowsR.value[i])])
    await writeAoaWorkbook(`资产负债表-${companyName.value ?? '全部汇总'}-${year.value}年${month.value}月.xlsx`,
      [{ name: `${year.value}年${month.value}月`, aoa: [header, ...body] }])
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}
</script>

<template>
  <!-- fp-fluid:摘 base.css 的 800px 屏级地板(RESPONSIVE-LAYOUT-SPEC §8)。
       挂在左栏壳根上一次即可 —— 地板规则只查 .fp-content 首子,内层状态(矩阵/正文/转圈)
       不再逐挂;照台账 .lgw 同族先例(LedgerView:655)。master 侧原对旧四层结构
       (FinCompanyPicker/FinMonthGrid,本分支已退场)逐状态挂标,意图随新结构收敛到这一处。 -->
  <div class="finw fp-fluid">
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
        <component :is="iconFor('scale')" :size="28" />
        <p class="t">还没有管理公司</p>
        <p class="s">在左栏底部「新增」建一家,资产负债表 按公司 × 年月分期</p>
      </div>

      <!-- ⓪ 选期矩阵(年份门 + 月历合成一张,2026-08-24「选期矩阵 v3」推到报表层) -->
      <template v-else-if="month === null">
        <div class="finw-head">
          <div>
            <h2 class="finw-title">
              <span class="ic"><component :is="iconFor('scale')" :size="18" /></span>资产负债表 · {{ companyName ?? '全部汇总' }}
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


  <!-- L3 资产负债表正文(两栏) -->
  <template v-else-if="period">
    <div class="fin-page">
      <!-- 期间条(设计稿 §3.2c):九张报表横跳不换期。与出账链链路条同一个组件 -->
      <FPStepStrip :steps="periodSteps" current="balance-sheet" :period="stripLabel"
                   :query="stripQuery" back-label="换期" @back="backToMatrix" />
      <div class="fin-head">
        <div class="fin-head-l">
          <button class="fin-back" title="返回选期矩阵" @click="backToMatrix"><component :is="iconFor('arrow-left')" :size="16" /></button>
          <div>
            <h2 class="fin-title">资产负债表</h2>
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
        <KpiCard tint="slate" label="资产总计"><span class="fin-kval">{{ finMoney(kpiAssets) }}</span><template #icon><component :is="iconFor('wallet')" :size="18" /></template></KpiCard>
        <KpiCard tint="blue" label="负债合计"><span class="fin-kval">{{ finMoney(kpiLiab) }}</span><template #icon><component :is="iconFor('banknote')" :size="18" /></template></KpiCard>
        <KpiCard tint="sky" label="所有者权益合计"><span class="fin-kval">{{ finMoney(kpiEquity) }}</span><template #icon><component :is="iconFor('landmark')" :size="18" /></template></KpiCard>
        <KpiCard tint="cyan" label="平衡差(资产−负债权益)">
          <span class="fin-kval" :style="{ color: balanced ? undefined : 'var(--hue-red)' }">{{ balanced ? '已平' : finMoney(kpiDiff) }}</span>
          <template #icon><component :is="iconFor(balanced ? 'check-circle-2' : 'alert-triangle')" :size="18" /></template>
        </KpiCard>
      </div>

      <div class="fin-toolbar">
        <div class="fin-toolbar-l">
          <span class="fin-tag">{{ itemCount }} 项</span>
          <Button v-if="edit && selected.size" variant="danger" size="sm" @click="bulkConfirm = true">
            <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
            删除所选 ({{ selected.size }})
          </Button>
        </div>
        <span class="fin-toolbar-note">{{ isAll ? '全部汇总为跨公司只读求和,如需录入请在公司选择页进入单家公司' : edit ? '点击单元格录入期末余额;悬停明细行可「+」添加子类,父项自动汇总;空项留空即可' : canEdit ? '只读 · 点击「编辑」录入 · 深色行为公式自动计算,资产 = 负债 + 所有者权益应试算平衡' : '只读 · 深色行为公式自动计算,资产 = 负债 + 所有者权益应试算平衡' }}</span>
      </div>

      <div class="fin-two">
        <div class="fin-side">
          <div class="fin-side-h"><component :is="iconFor('trending-up')" :size="15" />资　产</div>
          <FinReportTable
            :rows="rowsL"
            :columns="BS_COLUMNS"
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
        </div>
        <div class="fin-side">
          <div class="fin-side-h"><component :is="iconFor('scale')" :size="15" />负债和所有者权益</div>
          <FinReportTable
            :rows="rowsR"
            :columns="BS_COLUMNS"
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
        </div>
      </div>

      <p class="fin-foot"><component :is="iconFor('info')" :size="13" />单位:元 · 期末资产总计应等于负债合计与所有者权益合计之和(试算平衡);常驻项无数据留空,父项金额随其子类自动汇总;「其中」明细(原材料等)为信息行,不计入流动资产合计。</p>
    </div>

    <FpImportModal
      v-if="importing"
      :title="'导入 资产负债表'"
      :sub="'上传/粘贴两栏合并多公司的资产负债表(资产‖负债和所有者权益,每公司一列期末余额),按公司拆段、未匹配公司自动新建,导入到当前所选年月'"
      v-bind="parserProps('report_bs')"
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
                    :what="`资产负债表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                    @close="lockedBy = null" @taken="onTaken" />
  <FPEvictedDialog :eviction="evictedBy"
                   :what="`资产负债表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                   :dirty-count="dirty" @close="evictedBy = null" />
</template>

<style scoped>
/* L3 chrome — 1:1 from fin-common.jsx FinStyles(.fin-head/.fin-kpis/.fin-toolbar/.fin-tag 段),
   两栏 .fin-two/.fin-side/.fin-side-h 同源(fin-common.jsx L181-184)。
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
.fin-two { flex:1 1 auto; min-height:0; display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; }
.fin-side { display:flex; flex-direction:column; min-height:0; height:100%; }
.fin-side-h { flex:0 0 auto; display:flex; align-items:center; gap:7px; height:38px; padding:0 14px; background:var(--ink-900); color:#fff; font-size:12.5px; font-weight:var(--fw-semibold); border-radius:var(--radius-lg) var(--radius-lg) 0 0; }
.fin-side :deep(.fin-wrap) { border-radius:0 0 var(--radius-lg) var(--radius-lg); border-top:none; }
.fin-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* ── M/S 档(≤960,RESPONSIVE-LAYOUT-SPEC §5.3 明文):双表并排是报表层最先坏的点——
   降单列上下堆叠。.fin-side 放开 height:100%:单列后行高由内容定,定高会把两张表
   挤进同一屏各自内滚;改自然流整页滚动(查看态可用优先)。宽档规则在前(§1)。 ── */
@media (max-width: 960px) {
  .fin-two { grid-template-columns:1fr; }
  .fin-side { height:auto; }
}
/* ── S 档(≤600):KPI repeat(4) 在 390 上每格 <90px,金额放不下——定两列 ── */
@media (max-width: 600px) {
  .fin-kpis { grid-template-columns:repeat(2, minmax(0,1fr)); }
}
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
