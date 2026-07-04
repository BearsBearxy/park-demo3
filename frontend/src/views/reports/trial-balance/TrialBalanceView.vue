<script setup lang="ts">
// 科目余额表屏 — L1/L2/L3 状态机 + §6 加载门。范式同 BalanceSheetView,差异(spec §0/C6-C8):
//   · 科目树是数据(按期存库),非前端模板:accounts 随 period 下发,编辑态本地增删,保存整期树+金额双写。
//   · 8 金额列(期初/本期/本年/期末 × 借贷);所有行皆叶子直录,合计尾行=Σ一级科目(客端算不落库)。
//   · 默认折叠到一级 + 搜索(命中自动展开到命中行);companyId==='all' 只读平铺一级(后端已合并)。
//   · KPI:期末借合计/期末贷合计/平衡差(非0红,0显「已平」)/科目数。
import { ref, computed, onMounted } from 'vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import type { CompanyDTO } from '@/types/ledger'
import type { ReportPeriodDTO, ReportCell } from '@/types/report'
import type { ImportResultDTO } from '@/types/import'
import { TB_FIELDS, tbTotals, tbBalanceDiff, visibleRows, type TbAccount, type TbAmounts, type TbFieldKey } from '@/reports/trialBalance'
import { parserProps, runImport } from '@/utils/importRegistry'
import { finMoney } from '@/utils/finFmt'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import SearchField from '@/components/ds/SearchField.vue'
import Select from '@/components/ds/Select.vue'
import FinCompanyPicker, { type FinCompany } from '@/components/fin/FinCompanyPicker.vue'
import FinMonthGrid, { type FinMonthMeta } from '@/components/fin/FinMonthGrid.vue'
import SchedYearGate from '@/components/sched/SchedYearGate.vue'
import { useReportYearGate } from '@/components/fin/useReportYearGate'
import FinDialogs, { type FinDialog } from '@/components/fin/FinDialogs.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import TbTable from './TbTable.vue'

const STMT = 'tb'

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
const yearMonths = ref<FinMonthMeta[] | null>(null)   // L2 月历
const period = ref<ReportPeriodDTO | null>(null)      // L3 服务端本期快照(读态源)
const accounts = ref<TbAccount[]>([])                  // 科目树工作副本(编辑态本地增删,保存整期覆盖)
const draft = ref<Record<string, number>>({})          // 金额草稿:key=`${rowKey}|${field}`
const structEdits = ref(0)                             // 科目增删次数(计入保存确认改动数)
const dlg = ref<FinDialog | null>(null)

// 折叠 + 搜索(spec C6):默认折叠到一级
const expanded = ref(new Set<string>())
const query = ref('')

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
      // 零值预览抑制:tb 无 'cur' 字段,后端 netPreview(行1 cur)恒 0,显 ¥0.00 是误导 → 月卡只标「已录入」
      return { month: m, hasData, preview: hasData && preview ? finMoney(preview) : undefined }
    })
  } else {
    const y = await reportApi.year(STMT, companyId.value as number, year.value)
    metas = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const mm = y.months.find(x => x.month === m)
      return { month: m, hasData: !!mm?.hasData, preview: mm?.hasData && mm.netPreview ? finMoney(mm.netPreview) : undefined }
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
  if (reqId === periodReq) {
    period.value = data
    accounts.value = (data.accounts ?? []).map(a => ({ ...a }))
  }
}

// ── 年份门(公司→年份→月历,同附表) ────────────────────────
const { yearGated, gateYears, yearCards, gateCurrent, loadGateYears, resetGate, pickYear, backToYearGate } =
  useReportYearGate({
    stmt: STMT, companyId, companies, year,
    // period 一并清:否则 yearMonths 加载期间 v-if 链穿透到旧 period,数据表闪现
    onEnterYear: async () => { yearMonths.value = null; period.value = null; await loadYear() },
  })

// ── 状态迁移 ─────────────────────────────────────────────
async function pickCompany(id: number | string) {
  companyId.value = id as number
  month.value = null; edit.value = false; yearMonths.value = null; period.value = null
  resetGate()
  await loadGateYears()
}
function pickAll() {
  companyId.value = 'all'
  month.value = null; edit.value = false; yearMonths.value = null; period.value = null
  resetGate()
  loadGateYears()
}
function goGate() {
  companyId.value = null; month.value = null; edit.value = false
  resetGate()
  loadCompanies()
}
async function setYear(y: number) {
  year.value = y
  yearMonths.value = null; period.value = null
  await loadYear()
}
async function pickMonth(m: number) {
  month.value = m; edit.value = false; draft.value = {}; structEdits.value = 0; selected.value = new Set()
  expanded.value = new Set(); query.value = ''
  period.value = null
  await loadPeriod()
}
function backToMonths() {
  if (edit.value) cancelEdit()
  month.value = null
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

// ── 折叠/搜索行 + 合计/KPI ────────────────────────────────
const parents = computed(() => {
  const s = new Set<string>()
  for (const a of accounts.value) if (a.parentKey != null) s.add(a.parentKey)
  return s
})
const rows = computed(() => visibleRows(accounts.value, expanded.value, query.value))
function toggle(rowKey: string) {
  const next = new Set(expanded.value)
  if (next.has(rowKey)) next.delete(rowKey)
  else next.add(rowKey)
  expanded.value = next
}

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

// ── 编辑流 ───────────────────────────────────────────────
const dirty = computed(() => Object.keys(draft.value).length + structEdits.value)
function enterEdit() {
  draft.value = {}; structEdits.value = 0; selected.value = new Set(); edit.value = true
}
function cancelEdit() {
  edit.value = false; draft.value = {}; structEdits.value = 0; selected.value = new Set()
  // 放弃本地科目增删:回滚到服务端快照
  accounts.value = (period.value?.accounts ?? []).map(a => ({ ...a }))
}
function onInput(rowKey: string, field: TbFieldKey, value: string) {
  draft.value = { ...draft.value, [`${rowKey}|${field}`]: value === '' ? 0 : Number(value) }
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
    // 整期双写:cells = 全部科目 × 8 字段(draft 覆盖服务端值,0 不落库);accounts = 工作副本(重排 sortOrder)。
    const cells: ReportCell[] = []
    for (const a of accounts.value) {
      for (const f of TB_FIELDS) {
        const v = getLeaf(a.rowKey, f.key)
        if (v !== 0) cells.push({ rowKey: a.rowKey, field: f.key, amount: v })
      }
    }
    const body = { cells, accounts: accounts.value.map((a, i) => ({ ...a, sortOrder: i })) }
    period.value = await reportApi.save(STMT, companyId.value as number, year.value, month.value, body)
    accounts.value = (period.value.accounts ?? []).map(a => ({ ...a }))
    edit.value = false; draft.value = {}; structEdits.value = 0; selected.value = new Set()
    await loadYear()  // 刷新月历(hasData/预览)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}
function onDiscard() {
  saveConfirm.value = false
  cancelEdit()
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

// ── 批量删除(编辑态复选 → §7 居中确认 → 沿单删语义连子树移除,随保存落库) ──
const selected = ref(new Set<string>())
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

// ── 公司增删改(同 BS 屏) ─────────────────────────────────
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

// ── 导入 Excel(整本工作簿,每张「余额表」sheet=一公司段,未匹配公司自动新建)──────
// 仅单公司 + 已选月可导入(同 bs 屏)。目标期 = 当前 year/month。
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
const importSummary = ref('')
async function onImport(picks: { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  if (month.value == null) return
  try {
    importResult.value = await runImport('report_tb', picks, { year: year.value, month: month.value }, fileName)
    importSummary.value = picks.map(p => `${p.label ?? ''}:${p.records.length} 行`).join('\n')
    if (edit.value) cancelEdit()                 // 编辑态导入成功=整期替换:未保存草稿作废,退出编辑再重拉(spec J3)
    companies.value = await companyApi.list()   // 可能自动新建了公司
    await loadPeriod()                           // 刷新本期(本公司若在导入名单则见新树+新值)
    await loadYear()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 导出 xlsx(懒加载,平铺全部行 10 列) ────────────────────
async function onExport() {
  if (!period.value || month.value == null) return
  try {
    const XLSX = await import('xlsx')
    const header = ['科目代码', '科目名称', ...TB_FIELDS.map(f => `${f.group}(${f.side})`)]
    const body = accounts.value.map(a => [
      a.code ?? '', a.label,
      ...TB_FIELDS.map(f => getLeaf(a.rowKey, f.key)),
    ])
    const foot = ['', '合计', ...TB_FIELDS.map(f => totals.value[f.key])]
    const ws = XLSX.utils.aoa_to_sheet([header, ...body, foot])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `${year.value}年${month.value}月`)
    XLSX.writeFile(wb, `科目余额表-${companyName.value ?? '全部汇总'}-${year.value}年${month.value}月.xlsx`)
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
      title="科目余额表"
      sub="选择管理公司录入/查看各科目期初·本期·本年·期末借贷余额,或查看全部公司汇总 · 按年 / 月分期"
      :companies="finCompanies"
      @pick-all="pickAll"
      @pick="pickCompany"
      @new="onNewCompany"
      @edit="onEditCompany"
      @delete="onDeleteCompany"
    />
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </template>

  <!-- L1.5 年份门(同附表 SchedYearGate) -->
  <SchedYearGate
    v-else-if="!yearGated && gateYears"
    icon="book-open"
    :title="'科目余额表 · ' + (companyName ?? '全部汇总')"
    sub="先选择年份,再进入该年的月历与余额表 · 每个年月是一期独立的科目余额"
    :years="yearCards"
    :current="gateCurrent"
    :store-key="'report-tb-' + companyId"
    back-label="返回公司选择"
    footer="进入年份后按月查看或录入;可新增更早 / 未来年份。"
    @pick="pickYear"
    @back="goGate"
  />

  <!-- L2 月历 -->
  <FinMonthGrid
    v-else-if="yearGated && month === null && yearMonths"
    :company-name="companyName"
    :year="year"
    :months="yearMonths"
    :max-year="maxYear"
    @pick="pickMonth"
    @back="backToYearGate"
    @switch="goGate"
    @year="setYear"
  />

  <!-- L3 科目余额表正文 -->
  <template v-else-if="period">
    <div class="fin-page">
      <div class="fin-head">
        <div class="fin-head-l">
          <button class="fin-back" title="返回月份选择" @click="backToMonths"><component :is="iconFor('arrow-left')" :size="16" /></button>
          <div>
            <h2 class="fin-title">科目余额表</h2>
            <p class="fin-sub">{{ isAll ? '全部汇总' : company?.name }} · <span class="mono">{{ year }} 年 {{ month }} 月</span></p>
          </div>
        </div>
        <div class="fin-actions">
          <span v-if="isAll" class="fin-tag ro"><component :is="iconFor('lock')" :size="13" />汇总只读 · 仅一级科目合并</span>
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
            <Button variant="outline" size="sm" :disabled="saving" @click="openAdd">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增科目
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
        <KpiCard tint="slate" label="期末借方合计"><span class="fin-kval">{{ finMoney(totals.endDr) }}</span><template #icon><component :is="iconFor('trending-up')" :size="18" /></template></KpiCard>
        <KpiCard tint="blue" label="期末贷方合计"><span class="fin-kval">{{ finMoney(totals.endCr) }}</span><template #icon><component :is="iconFor('trending-down')" :size="18" /></template></KpiCard>
        <KpiCard tint="cyan" label="试算平衡差(借−贷)">
          <span class="fin-kval" :style="{ color: balanced ? 'var(--hue-green)' : 'var(--hue-red)' }">{{ balanced ? '已平' : finMoney(kpiDiff) }}</span>
          <template #icon><component :is="iconFor(balanced ? 'check-circle-2' : 'alert-triangle')" :size="18" /></template>
        </KpiCard>
        <KpiCard tint="sky" label="科目数"><span class="fin-kval">{{ accounts.length }}</span><template #icon><component :is="iconFor('list')" :size="18" /></template></KpiCard>
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

      <TbTable
        :rows="rows"
        :expanded="expanded"
        :parents="parents"
        :totals="totals"
        :value-of="valueOf"
        :editable="edit && !isAll"
        :live-of="liveOf"
        :selected="selected"
        @toggle="toggle"
        @input="onInput"
        @remove="removeAccount"
        @select="toggleSelect"
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
      @save="save"
      @discard="onDiscard"
      @close="saveConfirm = false"
    />
  </template>

  <!-- 过渡中(切公司/年/月,数据加载)兜底转圈,不闪空白。
       ⚠️ v-else 必须紧邻上方 L1/L2/L3 状态链;不可被自带 v-if 的弹窗隔在中间(见 DESIGN-FIDELITY §6.2)。 -->
  <div v-else class="page-loading"><span class="page-spin" /></div>

  <!-- 公司弹窗(居中,自管 v-if),放最后 -->
  <FinDialogs
    :dlg="dlg"
    :companies="finCompanies"
    @close="dlg = null"
    @submit-company="submitCompany"
    @confirm-delete="confirmDelete"
  />

  <!-- 新增科目居中弹窗(遵 DESIGN-FIDELITY §7:Teleport + backdrop 居中;样式 1:1 FinDialogs .fin-mask/.fin-dlg),放最后 -->
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

  <!-- 批量删除确认(遵 DESIGN-FIDELITY §7 居中弹窗,同上 .fin-mask/.fin-dlg),放最后 -->
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

  <!-- 导入结果(自管 v-if),放最后:不打断上方 v-if/v-else 状态链(DESIGN-FIDELITY §6.2) -->
  <ImportResultToast
    v-if="importResult"
    :result="importResult"
    :summary="importSummary"
    @close="importResult = null; importSummary = ''"
  />
</template>

<style scoped>
/* L3 chrome — 1:1 同 BalanceSheetView(.fin-head/.fin-kpis/.fin-toolbar/.fin-tag 段,源 fin-common.jsx FinStyles)。 */
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
.fin-toolbar-note { font-size:12px; color:var(--text-muted); }
.tb-tools { display:flex; align-items:center; gap:10px; }
.fin-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* 新增科目弹窗 — 1:1 FinDialogs .fin-mask/.fin-dlg(scoped 不跨组件,故本屏自带一份,遵 §7) */
.fin-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:tbfade .16s forwards; }
@keyframes tbfade { to { opacity:1; } }
.fin-dlg { width:min(440px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:tbrise .2s var(--ease-standard) both; }
@keyframes tbrise { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-b { padding:18px 22px 4px; display:flex; flex-direction:column; gap:14px; }
.fin-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.fin-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.fin-in:focus { border-color:var(--hue-blue); }
.fin-in.err { border-color:var(--hue-red); }
.fin-erm { font-size:11.5px; color:var(--hue-red); margin-top:-6px; min-height:14px; }
.fin-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
