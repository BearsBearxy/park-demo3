<script setup lang="ts">
// 科目余额表屏 — 两层状态机(useFinStatementScreen 三屏共用) + PAGE-BEHAVIOR-SPEC §1 加载门。差异(spec §0/C6-C8):
//   · 科目树是数据(按期存库),非前端模板:accounts 随 period 下发,编辑态本地增删,保存整期树+金额双写。
//   · 8 金额列(期初/本期/本年/期末 × 借贷);所有行皆叶子直录,合计尾行=Σ一级科目(客端算不落库,贴底)。
//   · 默认折叠到一级 + 搜索(命中自动展开到命中行);companyId==='all' 只读平铺一级(后端已合并)。
//   · 期末借贷不平:标题旁红签「期末借贷不平 · 差 x」+ 合计行多的那一格就地标(画布 09 ReportStates)。
import { ref, computed } from 'vue'
import FPWideCards, { type WideCard } from '@/components/fp/FPWideCards.vue'
import { useViewport } from '@/composables/useViewport'
import type { ReportCell } from '@/types/report'
import { TB_FIELDS, tbTotals, tbBalanceDiff, visibleRows, type TbAccount, type TbAmounts, type TbFieldKey } from '@/reports/trialBalance'
import { parserProps } from '@/utils/importRegistry'
import { finMoney, finSigned } from '@/utils/finFmt'
import { periodOf } from '@/nav/deepLink'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SearchField from '@/components/ds/SearchField.vue'
import Select from '@/components/ds/Select.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import FPToast from '@/components/fp/FPToast.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { useFinStatementScreen } from '@/components/fin/useFinStatementScreen'
import FinDialogs from '@/components/fin/FinDialogs.vue'
import FinCompanyMenu from '@/components/fin/FinCompanyMenu.vue'
import FinPeriodBar from '@/components/fin/FinPeriodBar.vue'
import FinHead from '@/components/fin/FinHead.vue'
import FinCard from '@/components/fin/FinCard.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import TbTable from './TbTable.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import { receipt } from '@/utils/receipt'
import { ask } from '@/utils/ask'

const STMT = 'tb'
/** 口径(D10):原页底说明行删掉,挂到合计行名称的悬停上 */
const TOTAL_TIP = '合计行 = 一级科目逐列求和(下级明细已含在一级科目内);期末借方合计应等于期末贷方合计。'

// ── 屏内私有态(科目树是本屏独有:按期存库,编辑态本地增删) ──
const accounts = ref<TbAccount[]>([])   // 科目树工作副本(编辑态本地增删,保存整期覆盖)
const structEdits = ref(0)              // 科目增删次数(计入保存确认改动数)
const selected = ref(new Set<string>())
// 折叠 + 搜索(spec C6):默认折叠到一级
const expanded = ref(new Set<string>())
const query = ref('')

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
  reviewKind: 'report-tb',
  extraDirty: structEdits,
  // 本期(读取/保存)到手即刷科目树工作副本
  onPeriod: p => { accounts.value = copyTree(p.accounts ?? []) },
  onPickMonth: () => { expanded.value = new Set(); query.value = '' },
  // 进出编辑/切月/保存后:清选集与科目增删计数,并放弃本地科目增删(回滚到服务端快照)
  resetLocal: () => {
    structEdits.value = 0
    selected.value = new Set()
    accounts.value = copyTree(period.value?.accounts ?? [])
  },
})

/**
 * 科目树工作副本。导入按「4-2-2-2」位数切层(utils/importTrialBalance),碰上 4-3-3 的代码就层级算错、父级挂空:
 * 开发库创显 2025-10 有 563 个科目(如 1122001006,真父级 1122001)存成 level 3、parentKey=null,
 * visibleRows 把它们当顶层平铺,「默认折叠到一级」失效(卡头 590 / 830 项)。
 * 这里按「代码最长的已有前缀」补挂父级,层级 = 父级 + 1;短代码先修,父级的层级先定。保存时随整期树写回。
 */
function copyTree(list: TbAccount[]): TbAccount[] {
  const out = list.map(a => ({ ...a }))
  const byCode = new Map(out.filter(a => a.code).map(a => [a.code!, a]))
  for (const a of [...out].sort((x, y) => (x.code?.length ?? 0) - (y.code?.length ?? 0))) {
    if (a.parentKey != null || a.level === 0 || !a.code) continue
    for (let i = a.code.length - 1; i > 0; i--) {
      const p = byCode.get(a.code.slice(0, i))
      if (p) { a.parentKey = p.rowKey; a.level = p.level + 1; break }
    }
  }
  return out
}

// ── 取值:所有科目行皆叶子直录(父行金额来自文件/录入,不自动汇总;合计只 Σ 一级) ──
function getLeaf(rowKey: string, field: TbFieldKey): number {
  const dk = `${rowKey}|${field}`
  if (edit.value && !isAll.value && dk in draft.value) return draft.value[dk]
  return Number(period.value?.amounts[rowKey]?.[field]) || 0
}
const valueOf = (rowKey: string, field: TbFieldKey) => getLeaf(rowKey, field)
const liveOf = (rowKey: string, field: TbFieldKey): number | string => {
  const dk = `${rowKey}|${field}`
  if (dk in draft.value) return draft.value[dk]
  return getLeaf(rowKey, field) || ''
}
/** 改过且有值的格:浅蓝底(清空的格和没动的一样) */
const changedOf = (rowKey: string, field: TbFieldKey) => !!draft.value[`${rowKey}|${field}`]

// ── 折叠/搜索行 + 合计 ────────────────────────────────
// 每个父节点的直接子级数:表上「N 个下级」与卡片末行「下级 N」都读它;键即「有下级」的判据。
const childCount = computed(() => {
  const m = new Map<string, number>()
  for (const a of accounts.value) if (a.parentKey != null) m.set(a.parentKey, (m.get(a.parentKey) ?? 0) + 1)
  return m
})
const rows = computed(() => visibleRows(accounts.value, expanded.value, query.value))
function toggle(rowKey: string) {
  const next = new Set(expanded.value)
  if (next.has(rowKey)) next.delete(rowKey)
  else next.add(rowKey)
  expanded.value = next
}

// ── S 档 行→卡片(稿 ReportPhone §2 表第3行:标准 88 档;6 根数值列的 B 级宽表) ──
// 只在**查看态**换卡片:卡片上没有输入格,而 §11.2(2026-08-30 用户拍板)写的是手机录入
// 「不禁止、不隐藏、不优化」—— 所以编辑态继续渲原表(8 列行内录入),编辑签在 S 档挂「建议桌面端」悬停。
// jsdom 无 matchMedia → tier 恒 'xl',桌面与既有测试零差异。
const editable = computed(() => edit.value && !isAll.value)
const { tier } = useViewport()
const asCards = computed(() => tier.value === 's' && !editable.value)

// 卡面字段,逐个标明来自 TbTable 的哪一列:
//   name   ← 科目代码列 + 科目名称列
//   amount ← 期末余额:TB_FIELDS 的 endDr(期末借方)非零取它,否则 endCr(期末贷方)
//   pill   ← 这个数落在借方还是贷方(表头字面,不是对数的定性);两方都是 0 的行不画胶囊。色调一律 info
//   sub    ← 期初余额(openDr 非零取它,否则 openCr)+ 本期发生额借/贷;有下级的行再缀「下级 N」
function tbCard(r: TbAccount): WideCard {
  const v = (f: TbFieldKey) => getLeaf(r.rowKey, f)
  const endDr = v('endDr'), endCr = v('endCr')
  const onDr = endDr !== 0
  const openDr = v('openDr')
  const kids = childCount.value.get(r.rowKey) ?? 0
  return {
    name: r.code ? `${r.code} ${r.label}` : r.label,
    amount: finMoney(onDr ? endDr : endCr),
    pill: endDr === 0 && endCr === 0 ? null : { text: onDr ? '期末借方' : '期末贷方', tone: 'info' },
    sub: `期初 ${finMoney(openDr !== 0 ? openDr : v('openCr'))} · 本期借 ${finMoney(v('periodDr'))}`
      + ` · 本期贷 ${finMoney(v('periodCr'))}` + (kids ? ` · 下级 ${kids}` : ''),
  }
}
// 整卡点击 = 表上那颗折叠箭头(展开/收起下级)。叶子行点了不动。
function onCardTap(r: TbAccount) { if (childCount.value.has(r.rowKey)) toggle(r.rowKey) }

// 实时金额面(服务端快照 + draft 覆盖),供合计/导出
const effAmounts = computed<TbAmounts>(() => {
  const m: TbAmounts = {}
  for (const a of accounts.value) {
    const cell: Partial<Record<TbFieldKey, number>> = {}
    for (const f of TB_FIELDS) {
      const v = getLeaf(a.rowKey, f.key)
      if (v !== 0) cell[f.key] = v
    }
    m[a.rowKey] = cell
  }
  return m
})
const totals = computed(() => tbTotals(accounts.value, effAmounts.value))
// ── 期末借贷不平(画布 09 ReportStates):红签 + 合计行多的那一格就地标「● 多 x」 ──
const diff = computed(() => tbBalanceDiff(totals.value))
const unbalanced = computed(() => Math.abs(diff.value) >= 0.005)   // 分以下视为已平
const badTag = computed(() => unbalanced.value ? `期末借贷不平 · 差 ${finSigned(Math.abs(diff.value))}` : null)
const footMark = computed<Partial<Record<TbFieldKey, string>> | undefined>(() =>
  unbalanced.value ? { [diff.value > 0 ? 'endDr' : 'endCr']: `多 ${finSigned(Math.abs(diff.value))}` } : undefined)

// ── 编辑流(进出编辑/保存外壳在 useFinStatementScreen;此处只给本表的录入与保存载荷) ──
function onInput(rowKey: string, field: TbFieldKey, value: string) {
  draft.value = { ...draft.value, [`${rowKey}|${field}`]: value === '' ? 0 : Number(value) }
}
// 整期双写:cells = 全部科目 × 8 字段(draft 覆盖服务端值,0 不落库);accounts = 工作副本(重排 sortOrder)。
function saveBody() {
  const cells: ReportCell[] = []
  for (const a of accounts.value) {
    for (const f of TB_FIELDS) {
      const v = getLeaf(a.rowKey, f.key)
      if (v !== 0) cells.push({ rowKey: a.rowKey, field: f.key, amount: v })
    }
  }
  return { cells, accounts: accounts.value.map((a, i) => ({ ...a, sortOrder: i })) }
}

// ── 新增科目(编辑态标题行「新增科目」→ 居中弹窗:code?/名称/父级下拉) ────────────────
const addOpen = ref(false)
const addCode = ref('')
const addLabel = ref('')
const addParent = ref('')   // '' = 一级科目(无父级)
const addErr = ref('')
const parentOptions = computed(() => [
  { value: '', label: '（一级科目,无父级）' },
  ...accounts.value.map(a => ({ value: a.rowKey, label: `${a.code ?? ''} ${a.label}`.trim() })),
])
function openAdd() {
  addCode.value = ''; addLabel.value = ''; addParent.value = ''; addErr.value = ''
  addOpen.value = true
}
function submitAdd() {
  const label = addLabel.value.trim()
  const code = addCode.value.trim()
  if (!label) { addErr.value = '请输入科目名称'; return }
  // rowKey:有代码用代码,否则合成 r<n>(期内唯一,spec C4)
  const used = new Set(accounts.value.map(a => a.rowKey))
  let rowKey: string
  if (code) {
    if (used.has(code)) { addErr.value = '已存在该科目代码' ; return }
    rowKey = code
  } else {
    let n = accounts.value.length + 1
    while (used.has(`r${n}`)) n++
    rowKey = `r${n}`
  }
  const parent = accounts.value.find(a => a.rowKey === addParent.value) ?? null
  const acct: TbAccount = {
    rowKey, parentKey: parent?.rowKey ?? null, code: code || null, label,
    level: parent ? parent.level + 1 : 0, sortOrder: 0,
  }
  // 插入位置:父级子树末尾(渲染紧随父级);一级科目排最后。插入后按数组序重排 sortOrder(visibleRows 按其排序)。
  const next = [...accounts.value]
  next.splice(parent ? subtreeEnd(next, parent.rowKey) : next.length, 0, acct)
  accounts.value = next.map((a, i) => ({ ...a, sortOrder: i }))
  structEdits.value++
  if (parent) expanded.value = new Set([...expanded.value, parent.rowKey])
  addOpen.value = false
}
// 父级子树(按数组序连续)在数组中的结束下标(不含)
function subtreeEnd(list: TbAccount[], rootKey: string): number {
  const keys = new Set([rootKey])
  let end = list.findIndex(a => a.rowKey === rootKey) + 1
  while (end < list.length && list[end].parentKey != null && keys.has(list[end].parentKey!)) {
    keys.add(list[end].rowKey)
    end++
  }
  return end
}

// ── 删科目(级联收集子树,spec C8;单删/批量共用同一语义) ─────
function collectDoomed(rootKeys: Iterable<string>): Set<string> {
  const doomed = new Set(rootKeys)
  let grew = true
  while (grew) {   // 级联:反复吸收 parentKey 在删除集内的行
    grew = false
    for (const a of accounts.value) {
      if (!doomed.has(a.rowKey) && a.parentKey != null && doomed.has(a.parentKey)) { doomed.add(a.rowKey); grew = true }
    }
  }
  return doomed
}
function removeKeys(doomed: Set<string>) {
  accounts.value = accounts.value.filter(a => !doomed.has(a.rowKey))
  // 丢弃被删行的金额草稿
  const nd = { ...draft.value }
  for (const dk of Object.keys(nd)) if (doomed.has(dk.split('|')[0])) delete nd[dk]
  draft.value = nd
  // 剔除已随级联消失的选中项
  selected.value = new Set([...selected.value].filter(k => !doomed.has(k)))
  structEdits.value++
}
function removeAccount(rowKey: string) {
  // 保存前可随时「取消/放弃修改」回滚,故不弹确认(同 BS 屏删子类)
  removeKeys(collectDoomed([rowKey]))
}

// ── 批量删除(编辑态复选 → PAGE-BEHAVIOR-SPEC §2 居中确认 → 沿单删语义连子树移除,随保存落库) ──
const bulkDoomed = computed(() => collectDoomed(selected.value))  // 含级联子树的实际移除行数(确认弹窗展示)
function toggleSelect(rowKey: string) {
  const next = new Set(selected.value)
  if (next.has(rowKey)) next.delete(rowKey)
  else next.add(rowKey)
  selected.value = next
}
// 确认(十件 ⑨):标题问句、正文给数、主按钮写动作;删除类默认焦点在「取消」
async function askBulkRemove() {
  const n = bulkDoomed.value.size
  if (await ask({
    title: `删除所选 ${selected.value.size} 个科目？`,
    body: `连同其全部子科目(合计 ${n} 行)及这些行的本期金额一并移除;点「保存」后整期生效,「取消」编辑可放弃。`,
    action: `删除 ${n} 行`,
    danger: true,
  })) bulkRemove()
}
function bulkRemove() {
  if (!editable.value) return   // 确认期间编辑权被接管(只退编辑态、选集还在):不再动科目树
  removeKeys(collectDoomed(selected.value))
  selected.value = new Set()
}

// ── 导出 xlsx(懒加载,平铺全部行 10 列) ────────────────────
async function onExport() {
  if (!period.value || month.value == null) return
  try {
    const { writeAoaWorkbook } = await import('@/utils/sheet')
    const header = ['科目代码', '科目名称', ...TB_FIELDS.map(f => `${f.group}(${f.side})`)]
    const body = accounts.value.map(a => [
      a.code ?? '', a.label,
      ...TB_FIELDS.map(f => getLeaf(a.rowKey, f.key)),
    ])
    const foot = ['', '合计', ...TB_FIELDS.map(f => totals.value[f.key])]
    await writeAoaWorkbook(`科目余额表-${companyName.value ?? '全部汇总'}-${year.value}年${month.value}月.xlsx`,
      [{ name: `${year.value}年${month.value}月`, aoa: [header, ...body, foot] }])
  } catch (e) {
    receipt.fail((e as { message?: string })?.message ?? '导出失败', { label: '重试', run: () => void onExport() })
  }
}
</script>

<template>
  <!-- fp-fluid:摘 base.css 的 800px 屏级地板(RESPONSIVE-LAYOUT-SPEC §8),挂在屏根一次即可 -->
  <div class="finw fp-fluid">
    <!-- 公司清单未到位 -->
    <div v-if="!companiesLoaded" class="page-loading"><span class="page-spin" /></div>

    <!-- 一家公司都没有:「新增公司」进空态,有 master:edit 才出 -->
    <template v-else-if="companyId === null">
      <h2 class="finw-h2">科目余额表</h2>
      <div class="finw-empty">
        <FPEmpty sub="科目余额表 按公司 × 年月分期">还没有管理公司
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
          <span class="ic"><component :is="iconFor('table-2')" :size="18" /></span>科目余额表<i class="finw-dot" aria-hidden="true">•</i>
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
          <FPStepStrip :steps="periodSteps" current="trial-balance" :period="stripLabel" :query="stripQuery" hide-back />
        </FinPeriodBar>
        <FinHead :class="{ 'fp-stale': veil }" title="科目余额表" :edit="edit" :dirty="dirty" :saving="saving" :is-all="isAll" :company-count="companies.length"
                 :load-err="periodErr" :entered="entered" :can-edit="canEdit" :held-by-other="heldByOther"
                 :review-note="reviewNote" :review-tip="reviewTip" :review-key="reviewKey"
                 :review-label="reviewLabelOf('科目余额表')" :month-text="`${month} 月`" :bad="badTag"
                 @export="onExport" @import="requestImport" @cancel="requestCancel" @save="finishEdit" @enter="enterEdit">
          <template #edit>
            <Button variant="outline" size="sm" :disabled="saving" @click="openAdd">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增科目
            </Button>
          </template>
        </FinHead>

        <div v-if="periodErr" class="finw-empty" :class="{ 'fp-stale': veil }">
          <FPLoadError sub="屏上不显示上一次读到的数字" @retry="loadPeriod">{{ year }} 年 {{ month }} 月的科目余额表没读到</FPLoadError>
        </div>
        <FinCard v-else :class="{ 'fp-stale': veil }">
          <template #bar>
            <div class="tb-tools">
              <SearchField v-model="query" placeholder="搜索科目代码 / 名称" :width="240" shortcut="" />
              <span class="fin-count">{{ rows.length }} / {{ accounts.length }} 项</span>
              <Button v-if="edit && !isAll && selected.size" variant="danger" size="sm" :disabled="saving" @click="askBulkRemove">
                <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
                删除所选 ({{ selected.size }})
              </Button>
            </div>
          </template>
          <TbTable
            v-if="!asCards"
            :rows="rows"
            :expanded="expanded"
            :kids="childCount"
            :totals="totals"
            :value-of="valueOf"
            :editable="editable"
            :reserve="canEdit && !isAll"
            :live-of="liveOf"
            :changed-of="changedOf"
            :selected="selected"
            :data-key="`${companyId}:${year}-${month}`"
            :foot-tip="TOTAL_TIP"
            :foot-mark="footMark"
            @toggle="toggle"
            @input="onInput"
            @remove="removeAccount"
            @select="toggleSelect"
          />
          <!-- S 档查看态:行→卡片(标准 88)。合计尾行不跟着走 -->
          <FPWideCards
            v-else
            :rows="rows"
            row-key="rowKey"
            :fields="tbCard"
            :density="88"
            @row-click="onCardTap"
          />
        </FinCard>
      </div>

      <FpImportModal
        v-if="importing"
        :title="'导入 科目余额表'"
        :sub="'上传整本工作簿(每张「余额表」工作表=一家公司,缩进型/代码型版式均可),按 sheet 拆段、未匹配公司自动新建,导入到当前所选年月'"
        v-bind="parserProps('report_tb')"
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
         ⚠️ v-else 必须紧邻上方「矩阵态 / 正文态」状态链(PAGE-BEHAVIOR-SPEC §1.2)。 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </div>

  <!-- 公司弹窗(居中,自管 v-if),放最后 -->
  <FinDialogs
    :dlg="dlg"
    :companies="finCompanies"
    @close="dlg = null"
    @submit-company="submitCompany"
  />

  <!-- 新增科目居中弹窗(遵 PAGE-BEHAVIOR-SPEC §2:Teleport + backdrop 居中;样式 1:1 FinDialogs .fin-mask/.fin-dlg),放最后 -->
  <Teleport to="body">
    <div v-if="addOpen" class="fin-mask" @mousedown="addOpen = false">
      <div class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="fin-dlg-h">
          <h3>新增科目</h3>
          <p>在当前期科目表中新增一个科目;可挂任意父级,金额随后在表格中录入,保存时整期生效。</p>
        </div>
        <div class="fin-dlg-b">
          <div class="fin-field">
            <div class="lab">科目代码(可选)</div>
            <input class="fin-in" v-model="addCode" placeholder="如:100201" @input="addErr = ''" @keydown.enter="submitAdd" />
          </div>
          <div class="fin-field">
            <div class="lab">科目名称</div>
            <input class="fin-in" :class="{ err: addErr }" v-model="addLabel" placeholder="如:银行存款-农商行" @input="addErr = ''" @keydown.enter="submitAdd" />
          </div>
          <div class="fin-field">
            <div class="lab">父级科目</div>
            <Select v-model="addParent" :options="parentOptions" size="sm" />
          </div>
          <p class="fp-field-err"><template v-if="addErr">{{ addErr }}</template></p>
        </div>
        <div class="fin-dlg-f">
          <Button variant="gray" size="sm" @click="addOpen = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitAdd">
            <template #leading><component :is="iconFor('check')" /></template>
            添加
          </Button>
        </div>
      </div>
    </div>
  </Teleport>

  <FPTakeoverDrawer :holder="lockedBy" :scope="lockScope() ?? ''"
                    :what="`科目余额表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                    @close="lockedBy = null" @taken="onTaken" />
  <FPEvictedDialog :eviction="evictedBy"
                   :what="`科目余额表 · ${companyName ?? ''} ${year}-${String(month ?? 1).padStart(2, '0')}`"
                   :dirty-count="dirty" @close="evictedBy = null" />
  <!-- 期间深链被草稿挡下时的页内提示(§4.2):切回时地址栏要求别的期,本期有未保存改动 → 不换期,只说 -->
  <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
</template>

<style scoped>
/* 外壳:左栏撤掉(画布 09),屏根就是一列 —— 与利润表同一份(scoped 不跨文件) */
.finw { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); overflow-y:auto; }
/* position:relative —— FPLoadBar 是 absolute,宿主不给参照它会认 AppShell 的外壳 */
.fin-page { position:relative; flex:1 1 auto; display:flex; flex-direction:column; gap:16px; min-height:0; }
.fin-count { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; }
.tb-tools { display:flex; align-items:center; gap:10px; min-width:0; }

.finw-pick { position:relative; display:flex; flex-direction:column; gap:16px; }
.finw-pick :deep(.bmm-top) { position:absolute; top:0; right:0; }
.finw-head { flex:0 0 auto; padding-right:140px; }
.finw-title { margin:0; font:var(--type-h2); display:flex; align-items:center; gap:var(--space-2); }
.finw-title .ic { width:26px; height:26px; border-radius:var(--radius-sm); background:var(--accent-blue); color:var(--hue-blue); display:grid; place-items:center; flex:none; }
.finw-dot { font-style:normal; color:var(--text-primary); }
.finw-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }

.finw-h2 { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); }
.finw-empty { flex:1 1 auto; display:flex; flex-direction:column; min-height:0; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }

/* 新增科目弹窗 — 1:1 FinDialogs .fin-mask/.fin-dlg(scoped 不跨组件,故本屏自带一份,遵 PAGE-BEHAVIOR-SPEC §2) */
.fin-mask { position:fixed; inset:0; background:var(--scrim); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.fin-dlg { width:min(440px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:var(--shadow-dialog); animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-b { padding:18px 22px 4px; display:flex; flex-direction:column; gap:14px; }
.fin-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.fin-in { width:100%; box-sizing:border-box; height:36px; padding:0 12px; font-size:var(--fs-body); color:var(--text-primary); border:1px solid var(--border-control); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.fin-in:focus { border-color:var(--hue-blue); }
.fin-in.err { border-color:var(--hue-red); }
.fin-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }

/* S 档(≤600):工具行弹性收窄,搜索框吃剩余宽、可被挤压。SearchField 宽度是 ds 组件内联 style 写死,
   只能 !important 压过内联——作用域锁死 .tb-tools 内(先例:mx-list.css .mx-pagerbar 压 ds-pg-pill 内联) */
@media (max-width: 600px) {
  .tb-tools { flex:1 1 auto; min-width:0; }
  .tb-tools :deep(.ds-searchfield) { width:auto !important; flex:1 1 120px; min-width:0; }
}
</style>
