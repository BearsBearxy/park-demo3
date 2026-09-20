<script setup lang="ts">
// 科目余额表屏 — 两层状态机(useFinStatementScreen 三屏共用) + PAGE-BEHAVIOR-SPEC §1 加载门。差异(spec §0/C6-C8):
//   · 科目树是数据(按期存库),非前端模板:accounts 随 period 下发,编辑态本地增删,保存整期树+金额双写。
//   · 8 金额列(期初/本期/本年/期末 × 借贷);所有行皆叶子直录,合计尾行=Σ一级科目(客端算不落库)。
//   · 默认折叠到一级 + 搜索(命中自动展开到命中行);companyId==='all' 只读平铺一级(后端已合并)。
//   · KPI:期末借合计/期末贷合计/平衡差(非0红,0显「已平」)/科目数。
import { ref, computed } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPWideCards, { type WideCard } from '@/components/fp/FPWideCards.vue'
import { useViewport } from '@/composables/useViewport'
import type { ReportCell } from '@/types/report'
import { TB_FIELDS, tbTotals, tbBalanceDiff, visibleRows, type TbAccount, type TbAmounts, type TbFieldKey } from '@/reports/trialBalance'
import { parserProps } from '@/utils/importRegistry'
import { finMoney } from '@/utils/finFmt'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import SearchField from '@/components/ds/SearchField.vue'
import Select from '@/components/ds/Select.vue'
import BookRail from '@/components/fp/BookRail.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import FPToast from '@/components/fp/FPToast.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { useAuthStore } from '@/stores/auth'
import { useFinStatementScreen } from '@/components/fin/useFinStatementScreen'
import { useFormSheet } from '@/composables/useFormSheet'
import FinDialogs from '@/components/fin/FinDialogs.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import TbTable from './TbTable.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'

const STMT = 'tb'

// ── 屏内私有态(科目树是本屏独有:按期存库,编辑态本地增删) ──
const accounts = ref<TbAccount[]>([])   // 科目树工作副本(编辑态本地增删,保存整期覆盖)
const structEdits = ref(0)              // 科目增删次数(计入保存确认改动数)
const selected = ref(new Set<string>())
// 折叠 + 搜索(spec C6):默认折叠到一级
const expanded = ref(new Set<string>())
const query = ref('')

const {
  canEdit, reviewKey, reviewNote, reviewTip, reviewLabelOf,
  companyId, year, month, edit, saving,
  companiesLoaded, period, draft, dirty, dlg,
  isAll, company, companyName, finCompanies,
  railItems, matrixYears, matrixBook, gateYears,
  periodSteps, stripLabel, stripQuery, deepNote,
  pickCompany, pickCell, backToMatrix, addEarlier, addLater, removeYear,
  enterEdit, onTaken, lockedBy, evictedBy, heldByOther, lockScope, requestCancel, saveConfirm, finishEdit, save, onDiscard,
  onNewCompany, onEditCompany, onDeleteCompany, submitCompany, confirmDelete,
  importing, importResult, importSummary, onImport, requestImport,
} = useFinStatementScreen({
  stmt: STMT,
  // 审核键(2026-09-08):一张表 × 一家公司 × 一个月。已审核 / 待审核的月进不了编辑态;
  // 交审动作在「本月出账」清单上(各屏自己的入口等设计稿)。
  reviewKind: 'report-tb',
  // tb 无 'cur' 字段,后端 netPreview(行1 cur)恒 0,月卡显 ¥0.00 是误导 → 只标「已录入」
  zeroPreviewHidden: true,
  extraDirty: structEdits,
  // 本期(读取/保存)到手即刷科目树工作副本
  onPeriod: p => { accounts.value = (p.accounts ?? []).map(a => ({ ...a })) },
  onPickMonth: () => { expanded.value = new Set(); query.value = '' },
  // 进出编辑/切月/保存后:清选集与科目增删计数,并放弃本地科目增删(回滚到服务端快照)
  resetLocal: () => {
    structEdits.value = 0
    selected.value = new Set()
    accounts.value = (period.value?.accounts ?? []).map(a => ({ ...a }))
  },
})

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

// ── 折叠/搜索行 + 合计/KPI ────────────────────────────────
// 每个父节点的直接子级数。改前这里只攒一个 parents 集合(有没有下级);S 档卡片上没有 ▸ 箭头,
// 末行要标「下级 N」才知道这张卡点得开,于是同一趟循环顺手数个数,parents 由它的键推出 ——
// 判定与改前逐字等价(parentKey 非空的键都算父)。
const childCount = computed(() => {
  const m = new Map<string, number>()
  for (const a of accounts.value) if (a.parentKey != null) m.set(a.parentKey, (m.get(a.parentKey) ?? 0) + 1)
  return m
})
const parents = computed(() => new Set(childCount.value.keys()))
const rows = computed(() => visibleRows(accounts.value, expanded.value, query.value))
function toggle(rowKey: string) {
  const next = new Set(expanded.value)
  if (next.has(rowKey)) next.delete(rowKey)
  else next.add(rowKey)
  expanded.value = next
}

// ── S 档 行→卡片(稿 ReportPhone §2 表第3行:标准 88 档;6 根数值列的 B 级宽表) ──
// 只在**查看态**换卡片:卡片上没有输入格,而 §11.2(2026-08-30 用户拍板)写的是手机录入
// 「不禁止、不隐藏、不优化」—— 所以编辑态继续渲原表(8 列行内录入 + TbTable 自己的首列 sticky),
// 上面那行 .tb-s-hint 照旧荐桌面。jsdom 无 matchMedia → tier 恒 'xl',桌面与既有测试零差异。
const editable = computed(() => edit.value && !isAll.value)
const { tier } = useViewport()
const asCards = computed(() => tier.value === 's' && !editable.value)

// 卡面字段,逐个标明来自 TbTable 的哪一列:
//   name   ← 科目代码列(colgroup 第 1 根)+ 科目名称列(第 2 根)
//   amount ← 期末余额:TB_FIELDS 的 endDr(期末借方)非零取它,否则 endCr(期末贷方)
//   pill   ← 这个数落在借方还是贷方。「期末借方/期末贷方」是 TB_FIELDS[].side 的表头字面,
//            不是对数的定性;两方都是 0 的行不画胶囊。色调一律 info —— 源码里没有任何判据
//            说借方余额比贷方余额「好」,用 ok/warn 就是凭空发明一个判定
//   sub    ← 期初余额(openDr 非零取它,否则 openCr)+ 本期发生额借/贷(periodDr/periodCr);
//            有下级的行再缀「下级 N」(childCount),卡片档没有 ▸,这个数是「点得开」的唯一提示
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
// 整卡点击 = 表上那颗 ▸(展开/收起下级)。折叠是本屏既有行为(spec C6 默认折叠到一级),
// 卡片档不给它入口的话,手机上除了搜索再也看不到下级科目。叶子行点了不动。
function onCardTap(r: TbAccount) { if (parents.value.has(r.rowKey)) toggle(r.rowKey) }

// 实时金额面(服务端快照 + draft 覆盖),供合计/KPI/导出
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
const kpiDiff = computed(() => tbBalanceDiff(totals.value))
// 浮点噪声容差(分以下视为已平)
const balanced = computed(() => Math.abs(kpiDiff.value) < 0.005)

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

// ── 新增科目(居中弹窗:code?/名称/父级下拉) ────────────────
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
const bulkConfirm = ref(false)
const bulkDoomed = computed(() => collectDoomed(selected.value))  // 含级联子树的实际移除行数(确认弹窗展示)
function toggleSelect(rowKey: string) {
  const next = new Set(selected.value)
  if (next.has(rowKey)) next.delete(rowKey)
  else next.add(rowKey)
  selected.value = next
}
function bulkRemove() {
  bulkConfirm.value = false
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
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}
// 新增/重命名/删除公司写的是 management_company,归 master 不归 report(RBAC §5.6:
// 删公司同事务级联删该公司 monthly_ledger + report_*)。这条判定原先长在 FinCompanyPicker 里,
// 那个整屏选择器随四层动线退场,门跟着搬到左栏管理区。
const canManageCo = computed(() => useAuthStore().can('master:edit'))

// ≤960 左轨收成顶部 chips 后,轨底那三颗管理钮收成一颗虚线 chip → 点开这个面板再选动作
// (§5.6「S:选择器点开为全屏列表 sheet」)。壳复用 styles/form-sheet.css 的 .fp-fsheet,不新造组件。
const manageOpen = ref(false)
const sheet = useFormSheet()


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

    <!-- ≤960 左轨收成顶部横向 chips(RESPONSIVE-LAYOUT-SPEC §5.6,照台账屏 LedgerView 范式):
         选择语义与轨内点击同源 pickCompany;≥961 整行 display:none,桌面零变化(§9)。
         轨底三颗管理钮收成最后一颗虚线 chip,点开面板再选动作——收轨不等于收权限,
         同一道 master:edit 门不因收轨消失。 -->
    <div class="finw-chips">
      <button v-for="b in railItems" :key="b.id" class="finw-chip" :class="{ on: b.id === companyId }"
              @click="pickCompany(b.id)">{{ b.name }}</button>
      <button v-if="canManageCo" class="finw-chip mng" @click="manageOpen = true">管理</button>
    </div>

    <div class="finw-main">
      <!-- 公司清单未到位 -->
      <div v-if="!companiesLoaded" class="page-loading"><span class="page-spin" /></div>

      <!-- 一家公司都没有:左栏「新增」是唯一出路,别给一屏空矩阵 -->
      <div v-else-if="companyId === null" class="finw-empty">
        <component :is="iconFor('table-2')" :size="28" />
        <p class="t">还没有管理公司</p>
        <p class="s">在左栏底部「新增」建一家,科目余额表 按公司 × 年月分期</p>
      </div>

      <!-- ⓪ 选期矩阵(年份门 + 月历合成一张,2026-08-24「选期矩阵 v3」推到报表层) -->
      <template v-else-if="month === null">
        <div class="finw-head">
          <div>
            <h2 class="finw-title">
              <span class="ic"><component :is="iconFor('table-2')" :size="18" /></span>科目余额表 · {{ companyName ?? '全部汇总' }}
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
      <FPStepStrip :steps="periodSteps" current="trial-balance" :period="stripLabel"
                   :query="stripQuery" back-label="换期" @back="backToMatrix" />
      <div class="fin-head">
        <div class="fin-head-l">
          <button class="fin-back" title="返回选期矩阵" @click="backToMatrix"><component :is="iconFor('arrow-left')" :size="16" /></button>
          <div>
            <h2 class="fin-title">科目余额表</h2>
            <p class="fin-sub">{{ isAll ? '全部汇总' : company?.name }} · <span class="mono">{{ year }} 年 {{ month }} 月</span></p>
          </div>
        </div>
        <div class="fin-actions">
          <span v-if="isAll" class="fin-tag ro"><component :is="iconFor('lock')" :size="13" />汇总只读 · 仅一级科目合并</span>
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
            <!-- 交审动作簇:紧贴编辑按钮**左边**,同高同圆角(per-screen-review §01)。编辑按钮位一个像素不动。
                 一张表 × 一家公司 × 一个月 = 一把键 —— 左栏换公司就换键,「全部汇总」拼不出键(reviewKey 为 null)整簇不画。
                 「一次交全部公司」是本月出账清单的活,不是这里的(§03-B3)。
                 ⚠ 编辑态不再整簇藏掉，改成把 `:edit` 交给组件：动作按钮一颗不画（交审交的是**库里那一份**，
                   而这一屏编辑态手上是 draft），但「已退回」那颗 chip 留着 —— 人正是照着那句理由在改。
                   判据只在组件里一份，宿主不再挂第二份 v-if。 -->
            <FPReviewActions :edit="edit" :keys="reviewKey ? [reviewKey] : null"
                             :label="reviewLabelOf('科目余额表')" :can-edit="canEdit" />
            <!-- 草稿型屏:编辑态走下面的 [取消][保存]，所以这里只负责浏览态那三态
                 (编辑模式 / 张三 编辑中 / 张三 空闲 23 分) —— 设计稿 §05 -->
            <!-- 审核药丸(§7.5):已审核 / 待审核时这一位换成同尺寸禁用药丸 —— 不接的话按钮还写着
                 「编辑模式」,点下去 enterEdit 被 reviewBlock 挡住无声返回,看起来像坏了。 -->
            <FPEditModeButton v-if="!edit" :edit="false" :held-by-other="heldByOther"
                              :can-enter="canEdit" :review-note="reviewNote" :review-tip="reviewTip"
                              @toggle="enterEdit" />
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
        <KpiCard tint="slate" label="期末借方合计" :value="finMoney(totals.endDr)"><template #icon><component :is="iconFor('trending-up')" :size="18" /></template></KpiCard>
        <KpiCard tint="blue" label="期末贷方合计" :value="finMoney(totals.endCr)"><template #icon><component :is="iconFor('trending-down')" :size="18" /></template></KpiCard>
        <KpiCard tint="sky" label="试算平衡差(借−贷)">
          <span :style="{ color: balanced ? 'var(--delta-up-text)' : 'var(--delta-down-text)' }">{{ balanced ? '已平' : finMoney(kpiDiff) }}</span>
          <template #icon><component :is="iconFor(balanced ? 'check-circle-2' : 'alert-triangle')" :size="18" /></template>
        </KpiCard>
        <KpiCard tint="cyan" label="科目数" :value="String(accounts.length)"><template #icon><component :is="iconFor('list')" :size="18" /></template></KpiCard>
      </div>

      <div class="fin-toolbar">
        <div class="tb-tools">
          <SearchField v-model="query" placeholder="搜索科目代码 / 名称" :width="240" shortcut="" />
          <span class="fin-tag">{{ rows.length }} / {{ accounts.length }} 项</span>
          <Button v-if="edit && !isAll && selected.size" variant="danger" size="sm" :disabled="saving" @click="bulkConfirm = true">
            <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
            删除所选 ({{ selected.size }})
          </Button>
        </div>
        <span class="fin-toolbar-note">{{ isAll ? '全部汇总为跨公司只读求和,仅按一级科目(代码优先)合并平铺,明细不合并' : edit ? '点击单元格录入金额;悬停行可 × 删除科目(级联下级);「新增科目」可挂任意父级,保存时整期覆盖' : '只读 · 默认折叠到一级科目,点击 ▸ 展开下级;搜索命中自动展开到命中行' }}</span>
      </div>

      <!-- ≤600 宽表行内批量编辑提示(§5.3/§11.2 裁定:录入不禁止、不隐藏、不优化,只荐桌面):
           预留位——行在 S 档常驻定高,文案仅编辑态显,显隐不挪表格(LAYOUT-STABILITY §2-3;
           照抄 LedgerView .lgw-s-hint)。单条弹窗编辑的屏不加,本屏是 8 列行内批量录入才有 -->
      <div class="tb-s-hint">
        <span v-if="edit">编辑模式 · 小屏可录入,建议在桌面端操作</span>
      </div>
      <TbTable
        v-if="!asCards"
        :rows="rows"
        :expanded="expanded"
        :parents="parents"
        :totals="totals"
        :value-of="valueOf"
        :editable="editable"
        :live-of="liveOf"
        :selected="selected"
        @toggle="toggle"
        @input="onInput"
        @remove="removeAccount"
        @select="toggleSelect"
      />
      <!-- S 档查看态:行→卡片(标准 88)。合计尾行不跟着走 —— 期末借/贷合计就在上面 KPI 那两张卡上 -->
      <FPWideCards
        v-else
        :rows="rows"
        row-key="rowKey"
        :fields="tbCard"
        :density="88"
        @row-click="onCardTap"
      />

      <p class="fin-foot"><component :is="iconFor('info')" :size="13" />单位:元 · 合计行 = 一级科目逐列求和(下级明细已含在一级科目内);期末借方合计应等于期末贷方合计(试算平衡)。</p>
    </div>

    <FpImportModal
      v-if="importing"
      :title="'导入 科目余额表'"
      :sub="'上传整本工作簿(每张「余额表」工作表=一家公司,缩进型/代码型版式均可),按 sheet 拆段、未匹配公司自动新建,导入到当前所选年月'"
      v-bind="parserProps('report_tb')"
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
              (见 PAGE-BEHAVIOR-SPEC §1.2)。 -->
  <div v-else class="page-loading"><span class="page-spin" /></div>
    </div>
  </div>

  <!-- ≤960 管理面板(§5.6:S 档选择器点开为全屏 sheet):虚线「管理」chip 的落点,
       轨底三颗管理钮原样搬进来 —— 点 chip 只开面板,删除仍要在面板里再点一次、再过 FinDialogs 的确认。
       壳复用 styles/form-sheet.css 那一套(S 档 .fp-fsheet 全屏、其余档居中卡),不新造面板组件。 -->
  <Teleport to="body">
    <div v-if="manageOpen" class="fin-mask" :class="{ 'fp-fsheet': sheet }" @mousedown="manageOpen = false">
      <div class="fin-dlg" role="dialog" aria-modal="true" aria-label="管理公司" @mousedown.stop>
        <!-- ⚠ ✕ 不是装饰:S 档挂上 .fp-fsheet 之后弹卡全屏,遮罩被它 100% 盖满,
             「点外面关」没有「外面」可点;全文件也没有 Esc 处理。没这颗就只能靠
             「点新增再取消」绕出去(2026-09-21 对抗复查抓到)。 -->
        <div class="fin-dlg-h">
          <h3>管理公司</h3>
          <button type="button" class="finw-sheet-x" aria-label="关闭" @click="manageOpen = false">
            <component :is="iconFor('x')" :size="18" />
          </button>
        </div>
        <div class="finw-sheet-b fp-fsheet-bd">
          <div class="finw-manage">
            <button class="finw-mbtn" @click="manageOpen = false; onNewCompany()">
              <component :is="iconFor('plus')" :size="13" />新增
            </button>
            <button class="finw-mbtn" :disabled="isAll || !company" @click="manageOpen = false; onEditCompany()">
              <component :is="iconFor('pencil')" :size="13" />重命名
            </button>
            <button class="finw-mbtn del" :disabled="isAll || !company" @click="manageOpen = false; onDeleteCompany()">
              <component :is="iconFor('trash-2')" :size="13" />删除
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 公司弹窗(居中,自管 v-if),放最后 -->
  <FinDialogs
    :dlg="dlg"
    :companies="finCompanies"
    @close="dlg = null"
    @submit-company="submitCompany"
    @confirm-delete="confirmDelete"
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
          <div class="fin-erm">{{ addErr }}</div>
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

  <!-- 批量删除确认(遵 PAGE-BEHAVIOR-SPEC §2 居中弹窗,同上 .fin-mask/.fin-dlg),放最后 -->
  <Teleport to="body">
    <div v-if="bulkConfirm" class="fin-mask" @mousedown="bulkConfirm = false">
      <div class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="fin-dlg-h">
          <h3>删除所选科目</h3>
          <p>将删除所选 {{ selected.size }} 个科目,并连同其全部子科目(合计 {{ bulkDoomed.size }} 行)及这些行的本期金额一并移除;点「保存」后整期生效,「取消」编辑可放弃。</p>
        </div>
        <div class="fin-dlg-f">
          <Button variant="gray" size="sm" @click="bulkConfirm = false">取消</Button>
          <Button variant="danger" size="sm" @click="bulkRemove">
            <template #leading><component :is="iconFor('trash-2')" /></template>
            删除 {{ bulkDoomed.size }} 行
          </Button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 导入结果(自管 v-if),放最后:不打断上方 v-if/v-else 状态链(PAGE-BEHAVIOR-SPEC §1.2) -->
  <ImportResultToast
    v-if="importResult"
    :result="importResult"
    :summary="importSummary"
    @close="importResult = null; importSummary = ''"
  />
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
/* L3 chrome — 1:1 同 BalanceSheetView(.fin-head/.fin-kpis/.fin-toolbar/.fin-tag 段,源 fin-common.jsx FinStyles)。 */
.fin-page { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.fin-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.fin-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.fin-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-control); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.fin-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.fin-title { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.fin-sub .mono { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.fin-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.fin-tag { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-secondary); font-size:12.5px; font-weight:var(--fw-medium); }
.fin-tag.edit { background:var(--warn-bg); color:var(--hue-orange); }
.fin-tag.ro { background:var(--accent-sky); color:var(--hue-blue); }
.fin-kpis { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
.fin-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.fin-toolbar-note { font-size:12px; color:var(--text-muted); }
.tb-tools { display:flex; align-items:center; gap:10px; }
.fin-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* S 档提示行:桌面档不存在(display:none),窄档媒体块内再显——宽档规则在前(§1) */
.tb-s-hint { display:none; }

/* ⚠ 本屏两个媒体块(960/600)挪到了**本文件末尾**(2026-09-21,§5.6 收左轨):窄档要盖的
   .finw / .finw-rail 基础规则写在下面的「工作台外壳」段里,媒体块排在它们之前是**静默**失效
   ——同特异性按源序,`.finw-rail{display:none}` 会被后面的 `.finw-rail{display:flex}` 盖回去。
   两块的相对次序(960 在前、600 在后)与块内内容一字未动。 */

/* 新增科目弹窗 — 1:1 FinDialogs .fin-mask/.fin-dlg(scoped 不跨组件,故本屏自带一份,遵 PAGE-BEHAVIOR-SPEC §2) */
.fin-mask { position:fixed; inset:0; background:var(--scrim); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.fin-dlg { width:min(440px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:var(--shadow-dialog); animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-b { padding:18px 22px 4px; display:flex; flex-direction:column; gap:14px; }
.fin-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
/* 高度对齐设计系统 md=36(ds/Input 与 ds/Select 同档):此前 38/40px,而同一表单网格里的
   下拉已是 ds/Select 的 36px,并排就差 2~4px。改这里而不是改 Select —— 36 是三个 ds 控件
   (Button/Input/Select)共同的 md 档,38/40 才是各表单自己发明的。 */
.fin-in { width:100%; box-sizing:border-box; height:36px; padding:0 12px; font-size:var(--fs-body); color:var(--text-primary); border:1px solid var(--border-control); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.fin-in:focus { border-color:var(--hue-blue); }
.fin-in.err { border-color:var(--hue-red); }
.fin-erm { font-size:11.5px; color:var(--hue-red); margin-top:-6px; min-height:14px; }
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

/* 顶部 chips:桌面档不存在(display:none),窄档媒体块内再显——宽档规则在前(§1) */
.finw-chips { display:none; }
/* 管理面板体(壳走 styles/form-sheet.css 的 .fp-fsheet,S 档全屏 sheet;此处只补内边距与触达高) */
.finw-sheet-b { padding: 18px 22px 22px; }
.fin-dlg-h:has(.finw-sheet-x) { display: flex; align-items: center; justify-content: space-between; }
.finw-sheet-x { flex: 0 0 auto; width: 44px; height: 44px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; }
.finw-sheet-b .finw-mbtn { min-height: 44px; }

/* ── M 档(≤960,RESPONSIVE-LAYOUT-SPEC §5.3):KPI 定两列。坏的是**标签**不是金额——
   768 上 repeat(4) 每格 151,扣 .kc 的 padding 40 只剩 111 内容宽;
   「试算平衡差(借−贷)」/「期末借方合计」≈98 + 图标 18 + 缝 8 = 124 > 111,
   被 .kc-l 的 ellipsis 截断;而 ds/KpiCard 的 .kc-l 没有 :title(useFitDown 只管数值不管标签),
   悬停也看不全——补缺陷不是偏好。(挂载即终态,不随内容抖;宽档规则在前 §1。) ── */
@media (max-width: 960px) {
  .fin-kpis { grid-template-columns:repeat(2, minmax(0,1fr)); }

  /* 左轨收成顶部横向 chips(§5.6):几何 1:1 抄台账屏 LedgerView .lgw-chips 那一份 ——
     chip 36 高 / radius-full / 行内横滚;选中态只换色不改尺寸(布局稳定铁律)。
     208px 定宽轨在 390 视口占掉 208/390 = 53% 的宽,主区剩不下一张表。 */
  .finw { flex-direction:column; gap:12px; }
  .finw-rail { display:none; }
  .finw-chips { flex:0 0 auto; display:flex; gap:8px; overflow-x:auto; padding:2px; }
  .finw-chip {
    flex:0 0 auto; display:inline-flex; align-items:center;
    height:36px; padding:0 14px; border-radius:var(--radius-full);
    border:1px solid var(--border-control); background:var(--surface-white);
    color:var(--text-secondary); font-family:var(--font-sans);
    font-size:var(--fs-label); font-weight:var(--fw-medium);
    cursor:pointer; white-space:nowrap;
  }
  .finw-chip.on { border-color:var(--hue-blue); background:var(--accent-blue); color:var(--text-primary); }
  .finw-chip.mng { border-style:dashed; color:var(--text-muted); }
}

/* ── S 档(≤600,RESPONSIVE-LAYOUT-SPEC §5.3)── */
@media (max-width: 600px) {
  /* §5.7「3–4 张 → 横滑胶囊」:本屏 4 张 KpiCard。S 档从 2 列网格(2 行 = 216px)
     换成一行横滑(≈108px),省下的 108 直接变成表格能露的行数 ——
     §5.7 的验收标准原话:「不是卡片好不好看,而是收完之后主内容能不能进首屏」。
     几何照 mx-list.css 的 .mx-kpirail:定宽 140、不换行、隐滚动条但留触屏拖动。
     ⚠ M 档(960 块)仍是 2 列,那是 KpiNarrow 板实测的结论(768 上 4 列标签被截),两档各管各的。 */
  .fin-kpis {
    display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 12px;
    -webkit-overflow-scrolling: touch; scrollbar-width: none;
  }
  .fin-kpis::-webkit-scrollbar { display: none; }
  .fin-kpis > * { flex: 0 0 140px; }
  /* 工具行弹性收窄:搜索框吃剩余宽、可被挤压。SearchField 宽度是 ds 组件内联 style 写死
     (该组件不在本次改动范围),只能 !important 压过内联——作用域锁死 .tb-tools 内,
     不外溢到其他搜索场景(先例:mx-list.css .mx-pagerbar 压 ds-pg-pill 内联) */
  .tb-tools { flex:1 1 auto; min-width:0; }
  .tb-tools :deep(.ds-searchfield) { width:auto !important; flex:1 1 120px; min-width:0; }
  /* 宽表编辑荐桌面提示(§11.2 预留位):行常驻定高 20px,进出编辑只换文案不挪版 */
  .tb-s-hint { display:flex; align-items:center; flex:0 0 20px; height:20px; font-size:12px; color:var(--hue-orange); }
}
</style>
