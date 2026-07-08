<script setup lang="ts">
// 月度台账状态机 — companyId(null=⓪) / yearGated(false=①年份门) / month(null=②月历) / drawerTenantId / edit.
// 动线: ⓪选公司 → ①年份门(SchedYearGate,同附表) → ②月历 → ③宽表 → ④抽屉。
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { companyApi, ledgerApi } from '@/api/ledger'
import { parseLedgerDeepLink } from '@/utils/deepLink'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import type { CompanyDTO, YearMonthsDTO, LedgerOverviewDTO, LedgerMonthDTO, LedgerRowDTO, LedgerSaveRow, LedgerImportRow } from '@/types/ledger'
import type { ImportResultDTO } from '@/types/import'
import { FEE_KEYS, lgColumns } from '@/utils/ledgerColumns'
import { parserProps, runImport } from '@/utils/importRegistry'
import { suggestParent } from '@/utils/tenantSuggest'
import LedgerCompanyPicker from './LedgerCompanyPicker.vue'
import LedgerNewCompanyDialog from './LedgerNewCompanyDialog.vue'
import LedgerImportResolveDialog, { type ResolveItem, type ResolveDecision } from './LedgerImportResolveDialog.vue'
import FinDialogs, { type FinDialog } from '@/components/fin/FinDialogs.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import { yearCardsOf, gateCurrentOf } from '@/utils/yearGate'
import LedgerMonthGrid from './LedgerMonthGrid.vue'
import LedgerWideTable from './LedgerWideTable.vue'
import LedgerTenantDrawer from './LedgerTenantDrawer.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'

// ── 状态机 ───────────────────────────────────────────────
const companyId = ref<number | null>(null)   // null → ⓪ 选公司
const yearGated = ref(false)                   // false → ① 年份门
const gateYears = ref<YearMonthsDTO[] | null>(null)  // ① 有数据年份(§6 加载门)
const year = ref(new Date().getFullYear())
const month = ref<number | null>(null)         // null → ② 月历
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

// ── ⓪ 进入屏:载入公司 + 各公司概览统计;核对跳转深链则继续自动钻取 ──
// 深链(spec 2026-07-07 §一):query y/m/company/tenant → ⓪按公司名精确匹配 → ①年 → ②月 → 宽表定位租户行。
// 公司名解析不到 → 静默停在⓪层;focusTenant 一次性,定位完成后清空。
const route = useRoute()
const focusTenant = ref('')
onMounted(async () => {
  await loadCompanies()
  const dl = parseLedgerDeepLink(route.query)
  if (!dl) return
  const c = companies.value.find(x => x.name === dl.company)
  if (!c) return
  await pickCompany(c.id)
  await pickYear(dl.y)
  await pickMonth(dl.m)
  focusTenant.value = dl.tenant
})

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
  companyId.value = id; yearGated.value = false; gateYears.value = null
  month.value = null; edit.value = false; drawerTenantId.value = null
  // 旧 overview/monthDto 一并清:否则 gateYears 加载期间 v-if 链穿透到旧数据,宽表闪现
  overview.value = null; monthDto.value = null
  gateYears.value = await ledgerApi.years(id)
}
async function pickYear(y: number) {
  year.value = y; yearGated.value = true; overview.value = null; monthDto.value = null
  await loadOverview()
}
function backToYears() {
  yearGated.value = false; month.value = null; edit.value = false; drawerTenantId.value = null
  if (companyId.value != null) ledgerApi.years(companyId.value).then(v => { gateYears.value = v })
}
function goGate() {
  companyId.value = null; yearGated.value = false; gateYears.value = null
  month.value = null; edit.value = false; drawerTenantId.value = null
  loadCompanies()
}
async function setYear(y: number) {
  year.value = y
  await loadOverview()
}
// ① 年份门卡片(数据年∪当前年连续区间;区间外年份走门内「新增年份」)
const yearCards = computed<YearCard[]>(() => yearCardsOf(gateYears.value, '已录入台账月份'))
const gateCurrent = computed(() => gateCurrentOf(yearCards.value))
async function pickMonth(m: number) {
  month.value = m; edit.value = false; drawerTenantId.value = null
  await loadMonth()
}
function backToMonths() {
  month.value = null; edit.value = false; drawerTenantId.value = null
  // 宽表内导入/删行保存后返回月历,月卡实时刷新(规范§六;不 await:requestId 守卫已有,旧值先显后替不闪空)
  loadOverview().catch(() => { /* 拉失败保持旧值即可,不抛 unhandledrejection(复审) */ })
}

// 删除公司(确认弹窗复用 FinDialogs delco;后端级联删除其台账+报表数据)
const dlg = ref<FinDialog | null>(null)
function onDeleteCompany(c: CompanyDTO) {
  dlg.value = { type: 'delco', company: { id: c.id, name: c.name, short: c.short } }
}
async function confirmDeleteCompany() {
  const d = dlg.value
  if (d?.type !== 'delco') return
  try {
    await companyApi.remove(Number(d.company.id))
    dlg.value = null
    await loadCompanies()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除公司失败')
  }
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
  deletedIds.value = new Set()
  edit.value = true
  ensureTenantsLoaded()
}

// ── 批量删除(编辑态勾选;从 draft 移除并记入 deletedIds,保存时以空行提交=后端删空落库) ──
const deletedIds = ref<Set<number>>(new Set())
function onBulkRemove(tenantIds: number[]) {
  const storedIds = new Set((monthDto.value?.rows ?? []).map(r => r.tenantId))
  const next = new Set(deletedIds.value)
  for (const id of tenantIds) if (storedIds.has(id)) next.add(id)   // 未保存的新增行只需移出 draft
  deletedIds.value = next
  draft.value = draft.value.filter(r => !tenantIds.includes(r.tenantId))
}

// ── 添加租户行(宽表只显示有数据的租户;新租户入账从候选挑一行加进 draft,保存时落库) ──
const allTenants = ref<TenantDTO[]>([])
function ensureTenantsLoaded() {
  if (!allTenants.value.length) tenantApi.list().then(v => { allTenants.value = v }).catch(() => {})
}
const addableTenants = computed(() =>
  allTenants.value
    .filter(t => t.status === 1 && !draft.value.some(r => r.tenantId === t.id))
    .map(t => ({ id: t.id, name: t.companyName })),
)
function onAddTenantRow(tenantId: number) {
  const t = allTenants.value.find(x => x.id === tenantId)
  if (!t || draft.value.some(r => r.tenantId === tenantId)) return
  const zero = { tenantId: t.id, tenantName: t.companyName, balancePrev: 0, totalCollected: 0, note: null, totalReceivable: 0, balanceEnd: 0 } as Record<string, unknown>
  for (const k of FEE_KEYS) zero[k] = 0
  draft.value = [zero as unknown as LedgerRowDTO, ...draft.value]
}
function cancelEdit() {
  // 取消:丢弃 draft,回到服务端快照(jsx cancelEdit 433-437)
  edit.value = false
  draft.value = []
  deletedIds.value = new Set()
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
    // 批量删除的行以全零空行提交,后端「删空」语义将其落库删除
    for (const id of deletedIds.value) {
      if (rows.some(r => r.tenantId === id)) continue
      const zeros = Object.fromEntries(FEE_KEYS.map(k => [k, 0]))
      rows.push({ tenantId: id, balancePrev: 0, totalCollected: 0, note: null, ...zeros } as LedgerSaveRow)
    }
    monthDto.value = await ledgerApi.save(companyId.value, year.value, month.value, { rows })
    edit.value = false
    draft.value = []
    deletedIds.value = new Set()
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
const importSummary = ref<string | null>(null)   // 预检跳过行数提示,随结果 toast 展示
// 数字清洗:剥 ¥/,/%/空格,非数字 → 0。
const cleanNum = (x: unknown): number => { const v = parseFloat(String(x).replace(/[, ¥%]/g, '')); return isNaN(v) ? 0 : v }
// 模板列:租户 + 21 费用 label(取自 lgColumns 叶子,FEE_KEYS 同序),复用列定义不另造。

// ── 导入预检:表内出现租户表没有的名字 → 先弹 ResolveDialog 决策(关联/新建/跳过)再导入 ──
// recs=平铺单表;picks=整册拆段(多 sheet),二者互斥
type SectionPick = { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }
const pendingImport = ref<{ recs?: ImportRec[]; picks?: SectionPick[]; fileName: string } | null>(null)
const resolveItems = ref<ResolveItem[]>([])

async function onImport(recs: ImportRec[], fileName: string) {
  if (companyId.value == null || month.value == null) return
  // 文件标题识别的年月 ≠ 当前屏年月 → 先确认,防导错月
  const ym = recs[0]?.__ymDetected as { year: number; month: number } | undefined
  if (ym && (ym.year !== year.value || ym.month !== month.value)) {
    if (!window.confirm(`文件标题识别为 ${ym.year}年${ym.month}月,当前导入目标是 ${year.value}年${month.value}月,仍导入到当前月吗?`)) return
  }
  importing.value = false
  importSummary.value = null
  try {
    allTenants.value = await tenantApi.list()   // 刷新缓存,精确匹配 companyName
  } catch { /* 拉不到租户表则不预检,直接导入,由后端逐行报「租户不存在」 */ }
  const known = new Set(allTenants.value.map(t => t.companyName))
  const unknown = [...new Set(recs.map(r => String(r.tenantName ?? '').trim()).filter(n => n && !known.has(n)))]
  if (!unknown.length) { await runLedgerImport(recs, fileName); return }
  resolveItems.value = unknown.map(name => ({ name, suggest: suggestParent(name, allTenants.value) }))
  pendingImport.value = { recs, fileName }
}

// 整册拆段确认后:平铺各段收集未登记租户 → 复用 ResolveDialog;段流程不做覆盖/年月 confirm(规范 v1 边界)
async function onImportSections(picks: SectionPick[], fileName: string) {
  if (companyId.value == null || month.value == null) return
  importing.value = false
  importSummary.value = null
  try {
    allTenants.value = await tenantApi.list()
  } catch { /* 拉不到租户表则不预检,直接导入,由后端逐行报「租户不存在」 */ }
  const known = new Set(allTenants.value.map(t => t.companyName))
  const unknown = [...new Set(picks.flatMap(p => p.records).map(r => String(r.tenantName ?? '').trim()).filter(n => n && !known.has(n)))]
  if (!unknown.length) { await runSectionsImport(picks, fileName); return }
  resolveItems.value = unknown.map(name => ({ name, suggest: suggestParent(name, allTenants.value) }))
  pendingImport.value = { picks, fileName }
}

async function onResolveConfirm(decisions: ResolveDecision[]) {
  const pending = pendingImport.value
  if (!pending) return
  pendingImport.value = null
  // link/create 逐个建档(失败 alert 后端 message 并中止本次导入)
  for (const d of decisions) {
    if (d.action === 'skip') continue
    try {
      const created = await tenantApi.create({
        companyName: d.name, businessType: '未分类',
        parentId: d.action === 'link' ? d.parentId : undefined,
        remark: '台账导入时自动创建',
      })
      allTenants.value = [...allTenants.value, created]
    } catch (e) {
      alert((e as { message?: string })?.message ?? '创建租户失败')
      return
    }
  }
  // skip 的名字过滤掉对应台账行,行数记入结果 toast summary;段模式逐段过滤,清空的段丢弃
  const skipNames = new Set(decisions.filter(d => d.action === 'skip').map(d => d.name))
  const drop = (rs: ImportRec[]) => rs.filter(r => !skipNames.has(String(r.tenantName ?? '').trim()))
  if (pending.picks) {
    const picks = pending.picks.map(p => ({ ...p, records: drop(p.records) })).filter(p => p.records.length)
    const skippedRows = pending.picks.reduce((s, p) => s + p.records.length, 0) - picks.reduce((s, p) => s + p.records.length, 0)
    if (skippedRows > 0) importSummary.value = `跳过未登记租户 ${skippedRows} 行`
    // 全部行都被跳过 → 不发空请求、不落误导性 rejected 日志(复审:空 payload 边界)
    if (!picks.length) { alert('全部行都被跳过,未执行导入。'); return }
    await runSectionsImport(picks, pending.fileName)
    return
  }
  const recs = drop(pending.recs!)
  const skippedRows = pending.recs!.length - recs.length
  if (skippedRows > 0) importSummary.value = `跳过未登记租户 ${skippedRows} 行`
  if (!recs.length) { alert('全部行都被跳过,未执行导入。'); return }
  await runLedgerImport(recs, pending.fileName)
}

async function runLedgerImport(recs: ImportRec[], fileName: string) {
  // 覆盖预检:本月已有数据的租户与文件重叠 → 确认后才覆盖(只覆盖文件中提供的列)
  const existing = new Set((monthDto.value?.rows ?? []).map(r => r.tenantName))
  const n = new Set(recs.map(r => String(r.tenantName ?? '').trim()).filter(name => existing.has(name))).size
  if (n > 0 && !window.confirm(`本月已有 ${n} 家租户的台账数据,导入将覆盖这些租户文件中提供的列,继续?`)) return
  try {
    const cname = companies.value.find(c => c.id === companyId.value)?.name
    importResult.value = await runImport('ledger', recs,
      { companyId: companyId.value!, companyName: cname, year: year.value, month: month.value! }, fileName)
    await loadMonth()   // 重载本月,反映 upsert 后的费用
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// 段模式执行:registry run 逐段解析公司/年月并聚合(不做覆盖预检,后端列级 upsert + 结果 toast 兜底)
async function runSectionsImport(picks: SectionPick[], fileName: string) {
  try {
    const cname = companies.value.find(c => c.id === companyId.value)?.name
    importResult.value = await runImport('ledger', picks,
      { companyId: companyId.value!, companyName: cname, year: year.value, month: month.value! }, fileName)
    await loadMonth()
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
      @delete-company="onDeleteCompany"
    />
    <div v-else class="page-loading"><span class="page-spin" /></div>
    <LedgerNewCompanyDialog
      v-if="newDlg"
      :existing-names="companies.map(c => c.name)"
      @close="newDlg = false"
      @create="createCompany"
    />
  </template>

  <!-- ① 年份门(同附表 SchedYearGate) -->
  <SchedYearGate
    v-else-if="!yearGated && gateYears && company"
    icon="calendar"
    :title="'月度台账 · ' + company.name"
    sub="先选择年份,再进入该年的月历与月度宽表 · 每个年份是一份独立的逐月台账"
    :years="yearCards"
    :current="gateCurrent"
    :store-key="'ledger-' + companyId"
    back-label="返回公司选择"
    footer="进入年份后按月录入或导入;可新增更早 / 未来年份。"
    @pick="pickYear"
    @back="goGate"
  />

  <!-- ② 年/月历 -->
  <LedgerMonthGrid
    v-else-if="yearGated && month === null && overview && company"
    :overview="overview"
    :company-name="company.name"
    :company-short="company.short"
    :year="year"
    :max-year="maxYear"
    @switch-company="goGate"
    @back="backToYears"
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
      :addable-tenants="addableTenants"
      :focus-tenant="focusTenant"
      @focus-done="focusTenant = ''"
      @switch-company="goGate"
      @back="backToMonths"
      @enter-edit="enterEdit"
      @cancel="cancelEdit"
      @save="save"
      @copy-from-prev="copyFromPrev"
      @tenant-click="drawerTenantId = $event"
      @import="importing = true"
      @add-tenant="onAddTenantRow"
      @bulk-remove="onBulkRemove"
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
      :sub="'按表头名字自动识别列,需包含表头;可整表粘贴(前置公司列/合计行/应收结余列自动忽略),导入到 ' + year + ' 年 ' + month + ' 月'"
      v-bind="parserProps('ledger', { year, month: month!, companyName: company.name, companyNames: companies.map(c => c.name) })"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImportSections"
    />
    <LedgerImportResolveDialog
      v-if="pendingImport"
      :items="resolveItems"
      @confirm="onResolveConfirm"
      @close="pendingImport = null"
    />
  </template>

  <!-- 过渡中(切公司/月,数据加载)兜底转圈,不闪空白。
       ⚠️ v-else 必须紧邻上方 ⓪/①/② 状态链;不可被 <ImportResultToast>(自带 v-if) 隔在中间,
       否则 v-else 会绑到 toast 的 v-if(importResult 恒 null)→ 永久转圈(见 DESIGN-FIDELITY §6)。 -->
  <div v-else class="page-loading"><span class="page-spin" /></div>

  <ImportResultToast v-if="importResult" :result="importResult" :summary="importSummary ?? undefined" @close="importResult = null" />

  <!-- 删除公司确认(自管显隐,放最后不打断上方状态链) -->
  <FinDialogs :dlg="dlg" :companies="[]" @close="dlg = null" @confirm-delete="confirmDeleteCompany" />
</template>
