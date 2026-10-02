<script setup lang="ts">
// 利润表屏 — 两层状态机(useFinStatementScreen 三屏共用) + PAGE-BEHAVIOR-SPEC §1 加载门。
// 动线(画布 09,2026-10-03):公司下拉(期间条 / 矩阵标题)→ 选期矩阵(全部年份纵排×12月格)→ 正文。
//   · 单公司 = 可编辑(本月 cur / 本年累计 ytd 两列);companyId==='all' = 跨公司只读求和(无编辑/导入)。
//   · 常驻行(IS_ROWS)无数据写「–」;带「其中」明细的父项是可收起的分组行(默认收起);
//     明细行下可加自定义子类(父项自动汇总,「N 个子类 · 自动合计」);小计行(21/30)按公式算,净利润(32)贴底。
// 本屏只留利润表特有部分:双列取值、行树、公式、保存载荷、自定义子类与批量删除、导出。
import { ref, computed } from 'vue'
import { reportApi } from '@/api/report'
import type { ReportCell, ReportCustomRowDTO } from '@/types/report'
import { IS_ROWS, computeRow } from '@/reports/incomeStatement'
import { parserProps } from '@/utils/importRegistry'
import { periodOf } from '@/nav/deepLink'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import FPToast from '@/components/fp/FPToast.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { useFinStatementScreen } from '@/components/fin/useFinStatementScreen'
import FinDialogs from '@/components/fin/FinDialogs.vue'
import FinCompanyMenu from '@/components/fin/FinCompanyMenu.vue'
import FinPeriodBar from '@/components/fin/FinPeriodBar.vue'
import FinHead from '@/components/fin/FinHead.vue'
import FinCard from '@/components/fin/FinCard.vue'
import type { FinTableRow } from '@/components/fin/FinReportTable.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import IncomeStatementTable from './IncomeStatementTable.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import { receipt } from '@/utils/receipt'
import { ask } from '@/utils/ask'

const STMT = 'is'
/** 净利润:贴底那一行,不进表体 */
const NET = 32
/** 口径(D10):原页底「ⓘ 单位:元 · 口径…」说明行删掉,挂到净利润行名称的悬停上 */
const NET_TIP = '营业利润 = 营业收入 − 营业成本 − 税金及附加 − 销售 / 管理 / 财务费用 + 投资收益;'
  + '利润总额 = 营业利润 + 营业外收入 − 营业外支出;净利润 = 利润总额 − 所得税费用。'

// 批量删除选集(屏内私有;进出编辑/切月由 resetLocal 清空)
const selected = ref(new Set<string | number>())

const {
  canEdit, canManageCo, reviewKey, reviewNote, reviewTip, reviewLabelOf,
  companyId, year, month, edit, saving,
  companies, companiesLoaded, period, periodErr, entered, draft, dirty, dlg,
  isAll, companyName, finCompanies,
  matrixYears, matrixBook, gateYears,
  periodSteps, stripLabel, stripQuery, deepNote,
  pickCompany, pickCell, backToMatrix, addEarlier, addLater, removeYear,
  loadPeriod, veil,
  enterEdit, onTaken, lockedBy, evictedBy, heldByOther, lockScope, requestCancel, saveConfirm, finishEdit, save, onDiscard,
  onNewCompany, onEditCompany, onDeleteCompany, submitCompany,
  importing, onImport, describeImport, requestImport,
} = useFinStatementScreen({
  stmt: STMT,
  // 审核键(2026-09-08):一张表 × 一家公司 × 一个月。已审核 / 待审核的月进不了编辑态。
  reviewKind: 'report-is',
  resetLocal: () => { selected.value = new Set() },
})

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
/** 改过且有值的格:浅蓝底(清空的格和没动的一样,稿 ReportStates) */
const changedOf = (rowKey: string | number, field: string) => !!draft.value[`${String(rowKey)}|${field}`]

// ── 展平行树:常驻行 + 自定义子类递归 ──────────────────────
// 「其中：」那条信息行不再单画 —— 父项本身就是「xx 其中 N 项」的分组行(画布 09 ReportIS)。
const flatRows = computed<FinTableRow[]>(() => {
  const out: FinTableRow[] = []
  const pushChildren = (parentKey: string, parent: string | number, baseLevel: number) => {
    for (const c of childrenOf(parentKey)) {
      const kids = childrenOf(c.rowKey)
      out.push({
        key: c.rowKey, label: c.label, level: Math.min(baseLevel + 1, 3), type: 'normal', parent,
        custom: true, parentAuto: kids.length > 0, childCount: kids.length,
        canAddChild: baseLevel + 1 < 2, group: kids.length ? 'open' : undefined,
      })
      pushChildren(c.rowKey, c.rowKey, baseLevel + 1)
    }
  }
  let top: number | null = null   // 当前「其中」组的父项行次
  IS_ROWS.forEach((r, i) => {
    if (r.type === 'label' || r.no === NET) return
    if (r.level === 0) top = r.no
    const kids = r.type === 'normal' ? childrenOf(String(r.no)) : []
    // 「其中」明细:紧跟在这一行后面、直到下一个顶层行之前的 level-1 常驻行
    let of = 0
    if (r.level === 0) for (let j = i + 1; j < IS_ROWS.length && IS_ROWS[j].level > 0; j++) if (IS_ROWS[j].type === 'normal') of++
    out.push({
      key: r.no, no: r.no, label: r.label, level: r.level, type: r.type,
      strong: r.type === 'subtotal', parent: r.level > 0 && top != null ? top : undefined,
      parentAuto: kids.length > 0, childCount: kids.length,
      canAddChild: r.type === 'normal' && r.level < 2,
      group: of ? 'fold' : kids.length ? 'open' : undefined,
      tag: of ? `其中 ${of} 项` : undefined,
    })
    pushChildren(String(r.no), r.no, r.level)
  })
  return out
})
const footRows = computed<FinTableRow[]>(() => {
  const r = IS_ROWS.find(x => x.no === NET)!
  return [{ key: r.no, no: r.no, label: r.label, level: 0, type: 'subtotal' }]
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
// 「可继续在子类下添加下一级」只在新子类自己还能再挂一级时才成立(新子类 level < 2 ⇔ 父项是顶层)
function onAddChild(row: FinTableRow) {
  dlg.value = {
    type: 'addrow', parentLabel: row.label, heading: '添加利润表子类',
    placeholder: '如:厂房租金收入',
    hint: row.level === 0 ? '可继续在子类下添加下一级。' : undefined,
  }
  addParentKey.value = String(row.key)
  addParentLevel.value = row.level
}
const addParentKey = ref('')
const addParentLevel = ref(0)
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
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
    receipt.fail(errMsg(e, '添加子类失败'), { label: '重试', run: () => void submitRow(label) })
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
    receipt.fail(errMsg(e, '删除子类失败'), { label: '重试', run: () => void removeCustom(row) })
  }
}

// ── 批量删除(P2-G3):编辑态多选 → 自定义行立即级联删、固定行清空本期值进 draft ──
function onToggleSelect(row: FinTableRow) {
  const next = new Set(selected.value)
  if (next.has(row.key)) next.delete(row.key)
  else next.add(row.key)
  selected.value = next
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
// 确认(十件 ⑨):标题问句、正文给数、主按钮写动作;删除类默认焦点在「取消」
async function askBulkDelete() {
  const { custom, fixed } = selSplit.value
  const n = selected.value.size
  const body = [
    custom.length ? `自定义行 ${custom.length} 行将删除(含其下子类,立即生效)` : '',
    fixed.length ? `固定行 ${fixed.length} 行将清空本期数值(点「保存」后生效)` : '',
  ].filter(Boolean).join(';') + '。'
  if (await ask({ title: `删除所选 ${n} 行？`, body, action: `删除 ${n} 行`, danger: true })) await bulkDelete()
}
async function bulkDelete() {
  if (!edit.value || isAll.value) return   // 确认期间编辑权被接管 / 切到了汇总:不再写
  const { custom, fixed } = selSplit.value
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
    // 不带重试:自定义行是逐条删的,半途失败时前几条已删掉,原样再跑会对着删过的行再删一遍
    receipt.fail(errMsg(e, '删除所选失败'))
  }
}

const itemCount = computed(() =>
  IS_ROWS.filter(r => r.type === 'normal').length + customRows.value.length,
)

// ── 导出 xlsx(懒加载)────────────────────────────────────
async function onExport() {
  if (!period.value || month.value == null) return
  try {
    const { exportIncomeStatement } = await import('@/utils/incomeStatementExcel')
    // 必须 await:出流改 exceljs 后写文件是异步的,裸调用的 rejection 会逃出这个 try/catch 变 unhandled
    // 导出按文件行次全量(含净利润、「其中：」信息行与自定义子类),不跟屏上收起走
    const all: FinTableRow[] = []
    const push = (pk: string, lvl: number) => {
      for (const c of childrenOf(pk)) {
        all.push({ key: c.rowKey, label: c.label, level: Math.min(lvl + 1, 3), type: 'normal', custom: true })
        push(c.rowKey, lvl + 1)
      }
    }
    for (const r of IS_ROWS) {
      all.push({ key: r.no, no: r.no, label: r.label, level: r.level, type: r.type })
      push(String(r.no), r.level)
    }
    await exportIncomeStatement(all, valueOf, companyName.value ?? '全部汇总', year.value, month.value)
  } catch (e) {
    receipt.fail(errMsg(e, '导出失败'), { label: '重试', run: () => void onExport() })
  }
}
</script>

<template>
  <!-- fp-fluid:摘 base.css 的 800px 屏级地板(RESPONSIVE-LAYOUT-SPEC §8),挂在屏根一次即可 -->
  <div class="finw fp-fluid">
    <!-- 公司清单未到位 -->
    <div v-if="!companiesLoaded" class="page-loading"><span class="page-spin" /></div>

    <!-- 一家公司都没有(画布 09 ReportPickEmpty 下半):「新增公司」进空态,有 master:edit 才出 -->
    <template v-else-if="companyId === null">
      <h2 class="finw-h2">利润表</h2>
      <div class="finw-empty">
        <FPEmpty sub="利润表 按公司 × 年月分期">还没有管理公司
          <template v-if="canManageCo" #action>
            <Button variant="outline" size="md" @click="onNewCompany">
              <template #leading><component :is="iconFor('plus')" :size="16" /></template>
              新增公司
            </Button>
          </template>
        </FPEmpty>
      </div>
    </template>

    <!-- ⓪ 选期矩阵:标题里的公司就是下拉(和正文期间条里同一个) -->
    <div v-else-if="month === null" class="finw-pick">
      <div class="finw-head">
        <h2 class="finw-title">
          <span class="ic"><component :is="iconFor('trending-up')" :size="18" /></span>利润表<i class="finw-dot" aria-hidden="true">•</i>
          <FinCompanyMenu size="lg" :companies="finCompanies" :current="companyId" :can-manage="canManageCo"
                          @pick="pickCompany" @add="onNewCompany" @rename="onEditCompany()" @remove="onDeleteCompany()" />
        </h2>
        <p class="finw-sub">选择月份进入该期报表 · 每个年月是一期独立报表</p>
      </div>
      <BookMonthMatrix
        v-if="gateYears"
        :book="matrixBook"
        :years="matrixYears"
        blank="–"
        @pick="pickCell"
        @add-earlier="addEarlier"
        @add-later="addLater"
        @remove-year="removeYear"
      />
      <div v-else class="page-loading"><span class="page-spin" /></div>
    </div>

    <!-- 正文态(读到了,或没读到 → FPLoadError 换掉表) -->
    <template v-else-if="period || periodErr">
      <div class="fin-page">
        <!-- 本期在途(换公司不换期 / 重试 / 子类增删后重读)的唯一信号;旧内容原地退让(.fp-stale 带 pointer-events:none) -->
        <FPLoadBar :on="veil" />
        <FinPeriodBar :period="periodOf(year, month)" :edit="edit" :companies="finCompanies" :company-id="companyId"
                      :can-manage="canManageCo" @back="backToMatrix" @pick="pickCompany($event, true)"
                      @add="onNewCompany" @rename="onEditCompany()" @remove="onDeleteCompany()">
          <FPStepStrip :steps="periodSteps" current="income-statement" :period="stripLabel" :query="stripQuery" hide-back />
        </FinPeriodBar>
        <FinHead :class="{ 'fp-stale': veil }" title="利润表" :edit="edit" :dirty="dirty" :saving="saving" :is-all="isAll" :company-count="companies.length"
                 :load-err="periodErr" :entered="entered" :can-edit="canEdit" :held-by-other="heldByOther"
                 :review-note="reviewNote" :review-tip="reviewTip" :review-key="reviewKey"
                 :review-label="reviewLabelOf('利润表')" :month-text="`${month} 月`"
                 @export="onExport" @import="requestImport" @cancel="requestCancel" @save="finishEdit" @enter="enterEdit" />

        <div v-if="periodErr" class="finw-empty" :class="{ 'fp-stale': veil }">
          <FPLoadError sub="屏上不显示上一次读到的数字" @retry="loadPeriod">{{ year }} 年 {{ month }} 月的利润表没读到</FPLoadError>
        </div>
        <FinCard v-else :class="{ 'fp-stale': veil }">
          <template #bar>
            <span class="fin-count">{{ itemCount }} 项</span>
            <Button v-if="edit && selected.size" variant="danger" size="sm" @click="askBulkDelete">
              <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
              删除所选 ({{ selected.size }})
            </Button>
          </template>
          <IncomeStatementTable
            :rows="flatRows"
            :foot="footRows"
            :foot-tip="NET_TIP"
            :value-of="valueOf"
            :editable="edit && !isAll"
            :live-of="liveOf"
            :changed-of="changedOf"
            :selectable="edit && !isAll"
            :selected="selected"
            @input="onInput"
            @add-child="onAddChild"
            @remove-child="removeCustom"
            @toggle-select="onToggleSelect"
          />
        </FinCard>
      </div>

      <FpImportModal
        v-if="importing"
        :title="'导入 利润表'"
        :sub="'上传/粘贴合并多公司的利润表(两行表头,每公司本月/本年累计两列),按公司拆段、未匹配公司自动新建,导入到当前所选年月'"
        v-bind="parserProps('report_is')"
        @close="importing = false"
        :runner="onImport"
        :describe="describeImport"
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
            (见 PAGE-BEHAVIOR-SPEC §1.2)。 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </div>

  <!-- 公司/子类弹窗(居中,自管 v-if),放最后 -->
  <FinDialogs
    :dlg="dlg"
    :companies="finCompanies"
    @close="dlg = null"
    @submit-company="submitCompany"
    @submit-row="submitRow"
  />


  <FPTakeoverDrawer :holder="lockedBy" :scope="lockScope() ?? ''"
                    :what="`利润表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                    @close="lockedBy = null" @taken="onTaken" />
  <FPEvictedDialog :eviction="evictedBy"
                   :what="`利润表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                   :dirty-count="dirty" @close="evictedBy = null" />
  <!-- 期间深链被草稿挡下时的页内提示(§4.2):切回时地址栏要求别的期,本期有未保存改动 → 不换期,只说 -->
  <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
</template>

<style scoped>
/* 外壳:左栏撤掉(画布 09),屏根就是一列 */
.finw { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); overflow-y:auto; }
/* position:relative —— FPLoadBar 是 absolute,宿主不给参照它会认 AppShell 的外壳 */
.fin-page { position:relative; flex:1 1 auto; display:flex; flex-direction:column; gap:16px; min-height:0; }
.fin-count { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; }

/* 选期矩阵:标题行「图标 利润表 • [公司 ▾]」;「补更早年份」与标题同一行(矩阵自己那一行挪上来) */
.finw-pick { position:relative; display:flex; flex-direction:column; gap:16px; }
.finw-pick :deep(.bmm-top) { position:absolute; top:0; right:0; }
.finw-head { flex:0 0 auto; padding-right:140px; }
.finw-title { margin:0; font:var(--type-h2); display:flex; align-items:center; gap:var(--space-2); }
.finw-title .ic { width:26px; height:26px; border-radius:var(--radius-sm); background:var(--accent-blue); color:var(--hue-blue); display:grid; place-items:center; flex:none; }
.finw-dot { font-style:normal; color:var(--text-primary); }
.finw-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }

/* 一家公司都没有 / 本期没读到:空态卡占住内容区 */
.finw-h2 { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); }
.finw-empty { flex:1 1 auto; display:flex; flex-direction:column; min-height:0; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
</style>
