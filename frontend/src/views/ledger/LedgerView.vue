<script setup lang="ts">
// 月度台账四级状态机 — companyId(null=⓪) / year / month(null=①) / drawerTenantId / edit.
// 动线 1:1 from screen-ledger.jsx LedgerScreen (386-718): ⓪选公司 → ①年/月历 → ②宽表 → ③抽屉。
import { ref, computed, onMounted } from 'vue'
import { companyApi, ledgerApi } from '@/api/ledger'
import type { CompanyDTO, LedgerOverviewDTO, LedgerMonthDTO, LedgerRowDTO, LedgerSaveRow, LedgerImportRow } from '@/types/ledger'
import type { ImportResultDTO } from '@/types/import'
import { FEE_KEYS, lgColumns } from '@/utils/ledgerColumns'
import LedgerCompanyPicker from './LedgerCompanyPicker.vue'
import LedgerNewCompanyDialog from './LedgerNewCompanyDialog.vue'
import LedgerMonthGrid from './LedgerMonthGrid.vue'
import LedgerWideTable from './LedgerWideTable.vue'
import LedgerTenantDrawer from './LedgerTenantDrawer.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'

// ── 状态机 ───────────────────────────────────────────────
const companyId = ref<number | null>(null)   // null → ⓪ 选公司
const year = ref(new Date().getFullYear())
const month = ref<number | null>(null)         // null → ① 年/月历
const drawerTenantId = ref<number | null>(null)
const edit = ref(false)
const newDlg = ref(false)
const saving = ref(false)

const maxYear = new Date().getFullYear()
// ⓪ 公司卡「N 月应收」标签的月份:优先由数据派生(有数据的当前月,见 loadCompanies),
// 不耦合系统时钟;仅在全系统无任何台账数据时退回当月。
const dataMonth = ref(new Date().getMonth() + 1)

// ── 数据 ─────────────────────────────────────────────────
const companies = ref<CompanyDTO[]>([])
const companiesLoaded = ref(false)  // ⓪ 首次加载完成前显示转圈,不闪空网格
// ⓪ 每家公司的派生统计:记账租户 + 当前月应收
const statsById = ref<Record<number, { tenants: number; recv: number }>>({})
const overview = ref<LedgerOverviewDTO | null>(null)  // ① 年度概览
const monthDto = ref<LedgerMonthDTO | null>(null)     // ② 服务端月度快照(读态 / 取消还原源)
const draft = ref<LedgerRowDTO[]>([])                 // ② 编辑态工作副本

const company = computed(() => companies.value.find(c => c.id === companyId.value) ?? null)

// ── ⓪ 进入屏:载入公司 + 各公司概览统计 ──────────────────
onMounted(loadCompanies)

async function loadCompanies() {
  companies.value = await companyApi.list()
  const results = await Promise.all(
    companies.value.map(async c => {
      const ov = await ledgerApi.overview(c.id, year.value)
      const cur = ov.months.find(m => m.status === 'current')
      return { id: c.id, tenants: ov.activeTenants, recv: cur?.recv ?? 0, month: cur?.month ?? null }
    }),
  )
  statsById.value = Object.fromEntries(results.map(r => [r.id, { tenants: r.tenants, recv: r.recv }]))
  // 标签月份从数据的当前月派生(种子各公司一致),与卡片 recv 取值同月;无数据则保留当月回退值
  const dm = results.find(r => r.month != null)?.month
  if (dm != null) dataMonth.value = dm
  companiesLoaded.value = true
}

// ── ① 载入概览 ───────────────────────────────────────────
// requestId 守卫：快速切年/月/公司时，丢弃先发出但后到达的过期响应，避免覆盖当前选择
let ovReq = 0
async function loadOverview() {
  if (companyId.value == null) return
  const reqId = ++ovReq
  const data = await ledgerApi.overview(companyId.value, year.value)
  if (reqId === ovReq) overview.value = data
}

// ── ② 载入月度宽表 ───────────────────────────────────────
let monthReq = 0
async function loadMonth() {
  if (companyId.value == null || month.value == null) return
  const reqId = ++monthReq
  const data = await ledgerApi.month(companyId.value, year.value, month.value)
  if (reqId === monthReq) monthDto.value = data
}

// ── 状态迁移 ─────────────────────────────────────────────
async function pickCompany(id: number) {
  companyId.value = id; month.value = null; edit.value = false; drawerTenantId.value = null
  await loadOverview()
}
function goGate() {
  companyId.value = null; month.value = null; edit.value = false; drawerTenantId.value = null
  loadCompanies()
}
async function setYear(y: number) {
  year.value = y
  await loadOverview()
}
async function pickMonth(m: number) {
  month.value = m; edit.value = false; drawerTenantId.value = null
  await loadMonth()
}
function backToMonths() {
  month.value = null; edit.value = false; drawerTenantId.value = null
}

// 新建公司 → 进入①
async function createCompany(name: string) {
  try {
    const c = await companyApi.create(name)
    newDlg.value = false
    companies.value = [...companies.value, c]
    await pickCompany(c.id)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '新建公司失败')
  }
}

// ── ② 编辑流 ─────────────────────────────────────────────
function snapshotDraft() {
  draft.value = (monthDto.value?.rows ?? []).map(r => ({ ...r }))
}
function enterEdit() {
  snapshotDraft()
  edit.value = true
}
function cancelEdit() {
  // 取消:丢弃 draft,回到服务端快照(jsx cancelEdit 433-437)
  edit.value = false
  draft.value = []
}
async function save() {
  if (companyId.value == null || month.value == null) return
  saving.value = true
  try {
    // PUT body:派生列(totalReceivable/balanceEnd)省略,后端重算(types LedgerSaveRow)
    const rows: LedgerSaveRow[] = draft.value.map(r => {
      const fees = Object.fromEntries(FEE_KEYS.map(k => [k, r[k]]))
      return { tenantId: r.tenantId, balancePrev: r.balancePrev, totalCollected: r.totalCollected, note: r.note, ...fees } as LedgerSaveRow
    })
    monthDto.value = await ledgerApi.save(companyId.value, year.value, month.value, { rows })
    edit.value = false
    draft.value = []
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}
async function copyFromPrev() {
  if (companyId.value == null || month.value == null) return
  saving.value = true
  try {
    monthDto.value = await ledgerApi.copyFromPrev(companyId.value, year.value, month.value)
    snapshotDraft()  // 复制后刷新工作副本,保持编辑态
  } catch (e) {
    alert((e as { message?: string })?.message ?? '从上月复制失败')
  } finally {
    saving.value = false
  }
}

// ③ 抽屉行:用②已加载的行(读态 monthDto,编辑态 draft)
const drawerRow = computed<LedgerRowDTO | null>(() => {
  if (drawerTenantId.value == null) return null
  const rows = edit.value ? draft.value : monthDto.value?.rows ?? []
  return rows.find(r => r.tenantId === drawerTenantId.value) ?? null
})

// ── 导入 Excel(scope = 当前公司 + 年 + 月,在②宽表入口) ──────────
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
// 数字清洗:剥 ¥/,/%/空格,非数字 → 0。
const cleanNum = (x: unknown): number => { const v = parseFloat(String(x).replace(/[, ¥%]/g, '')); return isNaN(v) ? 0 : v }
// 模板列:租户 + 21 费用 label(取自 lgColumns 叶子,FEE_KEYS 同序),复用列定义不另造。
const importCols = computed(() => {
  const labelByKey: Record<string, string> = {}
  for (const g of lgColumns(0).groups) for (const c of g.cols) labelByKey[c.key] = c.label
  return ['租户', ...FEE_KEYS.map(k => labelByKey[k])]
})
// parseRow:cells[0]=租户名(空跳过);cells[1..21]→21 费用(FEE_KEYS 序)。
function importParseRow(c: string[]): ImportRec | null {
  const name = (c[0] || '').trim(); if (!name) return null
  const fees: Record<string, number> = {}
  FEE_KEYS.forEach((k, i) => { fees[k] = cleanNum(c[i + 1]) })
  return { tenantName: name, ...fees, __preview: [name, ...FEE_KEYS.map((_k, i) => cleanNum(c[i + 1]) || '')] }
}
async function onImport(recs: ImportRec[]) {
  if (companyId.value == null || month.value == null) return
  importing.value = false
  try {
    const rows = recs as unknown as LedgerImportRow[]
    importResult.value = await ledgerApi.import(companyId.value, year.value, month.value, { rows })
    await loadMonth()   // 重载本月,反映 upsert 后的费用
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}
</script>

<template>
  <!-- ⓪ 选择记账公司 -->
  <template v-if="companyId === null">
    <LedgerCompanyPicker
      v-if="companiesLoaded"
      :companies="companies"
      :stats-by-id="statsById"
      :cur-month="dataMonth"
      @pick="pickCompany"
      @new-company="newDlg = true"
    />
    <div v-else class="page-loading"><span class="page-spin" /></div>
    <LedgerNewCompanyDialog
      v-if="newDlg"
      :existing-names="companies.map(c => c.name)"
      @close="newDlg = false"
      @create="createCompany"
    />
  </template>

  <!-- ① 年/月历 -->
  <LedgerMonthGrid
    v-else-if="month === null && overview && company"
    :overview="overview"
    :company-name="company.name"
    :company-short="company.short"
    :year="year"
    :max-year="maxYear"
    @switch-company="goGate"
    @year="setYear"
    @pick-month="pickMonth"
  />

  <!-- ② 月度宽表 + ③ 抽屉 -->
  <template v-else-if="monthDto && company">
    <LedgerWideTable
      :month="monthDto"
      :draft="draft"
      :company-name="company.name"
      :company-short="company.short"
      :year="year"
      :month-no="month!"
      :edit="edit"
      :saving="saving"
      @switch-company="goGate"
      @back="backToMonths"
      @enter-edit="enterEdit"
      @cancel="cancelEdit"
      @save="save"
      @copy-from-prev="copyFromPrev"
      @tenant-click="drawerTenantId = $event"
      @import="importing = true"
    />
    <LedgerTenantDrawer
      :row="drawerRow"
      :company-name="company.name"
      :year="year"
      :month-no="month!"
      :prev-month="monthDto.prevMonth"
      @close="drawerTenantId = null"
    />
    <FpImportModal
      v-if="importing"
      :title="'导入 月度台账 · ' + company.name"
      :sub="'列顺序 = 租户 + 各费用项(共 ' + importCols.length + ' 列),按租户名匹配在租租户后导入到 ' + year + ' 年 ' + month + ' 月'"
      :template-cols="importCols"
      :parse-row="importParseRow"
      @close="importing = false"
      @import="onImport"
    />
  </template>

  <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />

  <!-- 过渡中(切公司/月,数据加载)兜底转圈,不闪空白 -->
  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>
