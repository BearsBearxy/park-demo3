<script setup lang="ts">
// 利润表屏 — L1/L2/L3 状态机 + §6 加载门。
// 动线 1:1 from screen-income-statement.jsx:L1 选公司(全部汇总/各公司,可增删) → L2 选年月 → L3 利润表正文。
//   · 单公司 = 可编辑(本月 cur / 本年累计 ytd 两列);companyId==='all' = 跨公司只读求和(无编辑/导入)。
//   · 常驻行(IS_ROWS)无数据留空;明细行下可加自定义子类(父项自动汇总);小计行(21/30/32)按公式算。
import { ref, computed, onMounted } from 'vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import type { CompanyDTO } from '@/types/ledger'
import type { ReportPeriodDTO, ReportCell, ReportCustomRowDTO } from '@/types/report'
import type { ImportResultDTO } from '@/types/import'
import { IS_ROWS, computeRow } from '@/reports/incomeStatement'
import { parserProps, runImport } from '@/utils/importRegistry'
import { finMoney } from '@/utils/finFmt'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import FinCompanyPicker, { type FinCompany } from '@/components/fin/FinCompanyPicker.vue'
import FinMonthGrid, { type FinMonthMeta } from '@/components/fin/FinMonthGrid.vue'
import FinDialogs, { type FinDialog } from '@/components/fin/FinDialogs.vue'
import type { FinTableRow } from '@/components/fin/FinReportTable.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import IncomeStatementTable from './IncomeStatementTable.vue'

const STMT = 'is'

// ── 状态机 ───────────────────────────────────────────────
const companyId = ref<number | 'all' | null>(null)  // null → L1 选公司;'all' → 全部汇总(只读)
const year = ref(new Date().getFullYear())
const month = ref<number | null>(null)                // null → L2 月历
const edit = ref(false)
const saving = ref(false)
const maxYear = new Date().getFullYear()

// ── 数据 ─────────────────────────────────────────────────
const companies = ref<CompanyDTO[]>([])
const companiesLoaded = ref(false)                    // L1 首次加载完成前转圈,不闪空网格
const yearMonths = ref<FinMonthMeta[] | null>(null)   // L2 月历(有数据/预览)
const period = ref<ReportPeriodDTO | null>(null)      // L3 服务端本期快照(读态源)
const draft = ref<Record<string, number>>({})         // L3 编辑草稿:key=`${rowKey}|${field}`
const dirty = ref(0)                                   // 已改处计数(KPI/保存确认)
const dlg = ref<FinDialog | null>(null)

const isAll = computed(() => companyId.value === 'all')
const company = computed(() => companies.value.find(c => c.id === companyId.value) ?? null)
const companyName = computed(() => (isAll.value ? null : company.value?.name ?? null))
const finCompanies = computed<FinCompany[]>(() =>
  companies.value.map(c => ({ id: c.id, name: c.name, short: c.short })),
)

// ── L1 载入公司 ──────────────────────────────────────────
onMounted(loadCompanies)
async function loadCompanies() {
  companies.value = await companyApi.list()
  companiesLoaded.value = true
}

// ── L2 载入年历 ──────────────────────────────────────────
// 单公司:reportApi.year;全部汇总:各公司 year 合并(hasData 取或,预览取和)。竞态守卫。
let yearReq = 0
async function loadYear() {
  if (companyId.value == null) return
  const reqId = ++yearReq
  let metas: FinMonthMeta[]
  if (isAll.value) {
    const all = await Promise.all(companies.value.map(c => reportApi.year(STMT, c.id, year.value)))
    metas = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      let hasData = false, preview = 0
      for (const y of all) {
        const mm = y.months.find(x => x.month === m)
        if (mm?.hasData) { hasData = true; preview += mm.netPreview }
      }
      return { month: m, hasData, preview: hasData ? finMoney(preview) : undefined }
    })
  } else {
    const y = await reportApi.year(STMT, companyId.value as number, year.value)
    metas = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const mm = y.months.find(x => x.month === m)
      return { month: m, hasData: !!mm?.hasData, preview: mm?.hasData ? finMoney(mm.netPreview) : undefined }
    })
  }
  if (reqId === yearReq) yearMonths.value = metas
}

// ── L3 载入本期 ──────────────────────────────────────────
let periodReq = 0
async function loadPeriod() {
  if (companyId.value == null || month.value == null) return
  const reqId = ++periodReq
  const data = isAll.value
    ? await reportApi.allPeriod(STMT, year.value, month.value)
    : await reportApi.period(STMT, companyId.value as number, year.value, month.value)
  if (reqId === periodReq) period.value = data
}

// ── 状态迁移 ─────────────────────────────────────────────
async function pickCompany(id: number | string) {
  companyId.value = id as number
  month.value = null; edit.value = false; yearMonths.value = null
  await loadYear()
}
function pickAll() {
  companyId.value = 'all'
  month.value = null; edit.value = false; yearMonths.value = null
  loadYear()
}
function goGate() {
  companyId.value = null; month.value = null; edit.value = false
  loadCompanies()
}
async function setYear(y: number) {
  year.value = y
  yearMonths.value = null
  await loadYear()
}
async function pickMonth(m: number) {
  month.value = m; edit.value = false; draft.value = {}; dirty.value = 0
  selected.value = new Set()
  period.value = null
  await loadPeriod()
}
function backToMonths() {
  if (edit.value) cancelEdit()
  month.value = null
}

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

// ── 编辑流 ───────────────────────────────────────────────
function enterEdit() {
  draft.value = {}; dirty.value = 0; selected.value = new Set(); edit.value = true
}
function cancelEdit() {
  edit.value = false; draft.value = {}; dirty.value = 0; selected.value = new Set()
}
function onInput(rowKey: string | number, field: string, value: string) {
  const dk = `${String(rowKey)}|${field}`
  draft.value = { ...draft.value, [dk]: value === '' ? 0 : Number(value) }
  dirty.value = Object.keys(draft.value).length
}
// 退出编辑:有改动先弹保存确认,无改动直接退。
const saveConfirm = ref(false)
function finishEdit() {
  if (dirty.value > 0) { saveConfirm.value = true; return }
  edit.value = false
}
async function save() {
  if (companyId.value == null || month.value == null || isAll.value) return
  saveConfirm.value = false
  saving.value = true
  try {
    // 保存本期该公司全部叶子(常驻 normal + 自定义)cur/ytd:合并服务端已有值与 draft 覆盖。
    const cells: ReportCell[] = []
    const merged = mergedLeafValues()
    for (const [dk, amount] of merged) {
      const [rowKey, field] = dk.split('|')
      cells.push({ rowKey, field, amount })
    }
    period.value = await reportApi.save(STMT, companyId.value as number, year.value, month.value, { cells })
    edit.value = false; draft.value = {}; dirty.value = 0; selected.value = new Set()
    await loadYear()  // 刷新月历(hasData/预览)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
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
function onDiscard() {
  saveConfirm.value = false
  cancelEdit()
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
const selected = ref(new Set<string | number>())
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
    dirty.value = Object.keys(d).length
    selected.value = new Set()
    if (custom.length) await loadPeriod()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除所选失败')
  }
}

// ── 公司增删改 ────────────────────────────────────────────
function onNewCompany() { dlg.value = { type: 'company', mode: 'new' } }
function onEditCompany(c: FinCompany) {
  dlg.value = { type: 'company', mode: 'edit', company: c }
}
function onDeleteCompany(c: FinCompany) { dlg.value = { type: 'delco', company: c } }
async function submitCompany(name: string) {
  const d = dlg.value
  if (d?.type !== 'company') return
  try {
    if (d.mode === 'edit' && d.company) {
      await companyApi.rename(Number(d.company.id), name)
    } else {
      await companyApi.create(name)
    }
    dlg.value = null
    companies.value = await companyApi.list()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存公司失败')
  }
}
async function confirmDelete() {
  const d = dlg.value
  if (d?.type !== 'delco') return
  try {
    await companyApi.remove(Number(d.company.id))
    dlg.value = null
    if (companyId.value === d.company.id) goGate()
    else companies.value = await companyApi.list()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除公司失败')
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

// ── 导入 Excel(合并多公司利润表 → 逐公司段,未匹配公司自动新建)───────
// 仅单公司 + 已选月可导入(isAll / 未选月由模板按钮禁用兜底)。目标期 = 当前 year/month。
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
const importSummary = ref('')
async function onImport(picks: { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  if (month.value == null) return
  try {
    importResult.value = await runImport('report_is', picks, { year: year.value, month: month.value }, fileName)
    importSummary.value = picks.map(p => `${p.label ?? ''}:${p.records.length} 行`).join('\n')
    if (edit.value) cancelEdit()                 // 导入=整期替换:先退出编辑(未保存草稿作废)再重拉
    companies.value = await companyApi.list()   // 可能自动新建了公司
    await loadPeriod()                           // 刷新本期(本公司若在导入名单则见新值)
    await loadYear()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 导出 xlsx(懒加载)────────────────────────────────────
async function onExport() {
  if (!period.value || month.value == null) return
  try {
    const { exportIncomeStatement } = await import('@/utils/incomeStatementExcel')
    exportIncomeStatement(
      flatRows.value, valueOf,
      companyName.value ?? '全部汇总', year.value, month.value,
    )
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}
</script>

<template>
  <!-- L1 选择公司 -->
  <template v-if="companyId === null">
    <FinCompanyPicker
      v-if="companiesLoaded"
      title="利润表"
      sub="选择管理公司录入损益数据,或查看全部公司汇总 · 按年 / 月分期"
      :companies="finCompanies"
      @pick-all="pickAll"
      @pick="pickCompany"
      @new="onNewCompany"
      @edit="onEditCompany"
      @delete="onDeleteCompany"
    />
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </template>

  <!-- L2 月历 -->
  <FinMonthGrid
    v-else-if="month === null && yearMonths"
    :company-name="companyName"
    :year="year"
    :months="yearMonths"
    :max-year="maxYear"
    @pick="pickMonth"
    @back="goGate"
    @year="setYear"
  />

  <!-- L3 利润表正文 -->
  <template v-else-if="period">
    <div class="fin-page">
      <div class="fin-head">
        <div class="fin-head-l">
          <button class="fin-back" title="返回月份选择" @click="backToMonths"><component :is="iconFor('arrow-left')" :size="16" /></button>
          <div>
            <h2 class="fin-title">利润表</h2>
            <p class="fin-sub">{{ isAll ? '全部汇总' : company?.name }} · <span class="mono">{{ year }} 年 {{ month }} 月</span></p>
          </div>
        </div>
        <div class="fin-actions">
          <span v-if="isAll" class="fin-tag ro"><component :is="iconFor('lock')" :size="13" />汇总只读</span>
          <template v-else-if="!edit">
            <Button variant="outline" size="sm" @click="importing = true">
              <template #leading><component :is="iconFor('upload')" :size="14" /></template>
              导入
            </Button>
            <Button variant="outline" size="sm" @click="onExport">
              <template #leading><component :is="iconFor('download')" :size="14" /></template>
              导出 Excel
            </Button>
            <Button variant="filled" size="sm" @click="enterEdit">
              <template #leading><component :is="iconFor('pencil')" :size="14" /></template>
              编辑
            </Button>
          </template>
          <template v-else>
            <span class="fin-tag edit">编辑中 · {{ company?.name }}</span>
            <Button variant="outline" size="sm" :disabled="saving" @click="importing = true">
              <template #leading><component :is="iconFor('upload')" :size="14" /></template>
              导入
            </Button>
            <Button variant="gray" size="sm" :disabled="saving" @click="cancelEdit">取消</Button>
            <Button variant="filled" size="sm" :disabled="saving" @click="finishEdit">
              <template #leading><component :is="iconFor('check')" :size="14" /></template>
              保存
            </Button>
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
        <span class="fin-toolbar-note">{{ isAll ? '全部汇总为跨公司只读求和,如需录入请在公司选择页进入单家公司' : edit ? '点击单元格录入金额;悬停明细行可「+」添加子类,父项自动汇总;空项留空即可' : '只读 · 点击「编辑」录入 · 深色行为公式自动计算' }}</span>
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
      @save="save"
      @discard="onDiscard"
      @close="saveConfirm = false"
    />
  </template>

  <!-- 过渡中(切公司/年/月,数据加载)兜底转圈,不闪空白。
       ⚠️ v-else 必须紧邻上方 L1/L2/L3 状态链;不可被自带 v-if 的弹窗隔在中间(见 DESIGN-FIDELITY §6.2)。 -->
  <div v-else class="page-loading"><span class="page-spin" /></div>

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
.fin-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:isfade .16s forwards; }
@keyframes isfade { to { opacity:1; } }
.fin-dlg { width:min(440px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:isrise .2s var(--ease-standard) both; }
@keyframes isrise { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
