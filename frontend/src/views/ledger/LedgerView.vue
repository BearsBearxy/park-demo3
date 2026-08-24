<script setup lang="ts">
// 月度台账 · 账册工作台(BOOK-WORKBENCH-SPEC §5 选期矩阵 v3)。三态状态机:
//   未选册(activeBookId=null) → 矩阵态(month=null:全部年份纵排,每年一行12月卡) → 表格态(month!=null)。
// 左轨 BookRail 常驻(账册即公司,§7-2 实体切换在左栏);年份范围=数据年∪当前年∪手工年(utils/matrixYears);
// 进宽表必点月卡(§7-1 明确选期门,pick 自带年份);表格态「换期」回矩阵。
// 旧动线(公司picker→年份门→月历)已废,LedgerCompanyPicker/LedgerMonthGrid 不再引用(文件保留待主线拍板)。
import { ref, computed, onMounted, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { companyApi, ledgerApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import { parseLedgerDeepLink } from '@/utils/deepLink'
import { loadExtraYears, saveExtraYears, buildYearRows } from '@/utils/matrixYears'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import type { CompanyDTO, YearMonthsDTO, LedgerOverviewDTO, LedgerMonthDTO, LedgerRowDTO, LedgerSaveRow } from '@/types/ledger'
import { ledgerRowKey } from '@/types/ledger'
import type { Book, BookDef, TemplateVersion } from '@/types/book'
import { flattenCols } from '@/types/book'
import { mergeExtras, extractExtras, extraColIds } from '@/utils/bookTemplate'
import { applyColDecisions } from './bookMapDecisions'
import { groupUnbound } from '@/utils/tenantSuggest'
import { toBindOptions } from '@/components/fp/fpTenantPicker'
import type { ImportResultDTO } from '@/types/import'
import { FEE_KEYS } from '@/utils/ledgerColumns'
import { parserProps, runImport } from '@/utils/importRegistry'
import { iconFor } from '@/components/ds/icon'
import LedgerNewCompanyDialog from './LedgerNewCompanyDialog.vue'
import LedgerDeleteCompanyDialog from './LedgerDeleteCompanyDialog.vue'
import BookRail from '@/components/fp/BookRail.vue'
import FPToast from '@/components/fp/FPToast.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import TemplateEditorPanel from '@/components/fp/TemplateEditorPanel.vue'
import ColumnMapPanel, { type UnmatchedHeader, type ColDecision } from '@/components/fp/ColumnMapPanel.vue'
import FPSideDrawer from '@/components/fp/FPSideDrawer.vue'
import FPTenantIssuePanel, { type IssueGroup } from '@/components/fp/FPTenantIssuePanel.vue'
import LedgerWideTable from './LedgerWideTable.vue'
import LedgerTenantDrawer from './LedgerTenantDrawer.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'

// ── 状态机 ───────────────────────────────────────────────
const books = ref<Book[]>([])
const booksLoaded = ref(false)
const activeBookId = ref<number | null>(null)      // null → 未选册占位
const year = ref(new Date().getFullYear())          // 表格态所在年(点月卡时随 pick 带入)
const month = ref<number | null>(null)              // null → 矩阵态;有值 → 表格态
const drawerRowKey = ref<number | null>(null)       // 行明细抽屉:行键(id ?? -tenantId)
const edit = ref(false)
const newDlg = ref(false)
const saving = ref(false)

const book = computed(() => books.value.find(b => b.id === activeBookId.value) ?? null)
const companyId = computed(() => book.value?.companyId ?? null)

// ── 数据 ─────────────────────────────────────────────────
const companies = ref<CompanyDTO[]>([])             // 深链公司名解析 + 整册拆段 companyNames 用
const gateYears = ref<YearMonthsDTO[] | null>(null) // 当前册有数据年份
const overviews = ref(new Map<string, LedgerOverviewDTO>()) // 分年概览缓存,键 `${companyId}:${year}`(矩阵月卡数据源)
const extraYears = ref<number[]>([])                // 当前册手工年(localStorage,屏+册键见 utils/matrixYears)
const monthDto = ref<LedgerMonthDTO | null>(null)   // 服务端月度快照(读态 / 取消还原源)
const draft = ref<LedgerRowDTO[]>([])               // 编辑态工作副本

const company = computed(() => companies.value.find(c => c.id === companyId.value) ?? null)
const companyName = computed(() => company.value?.name ?? book.value?.name ?? '')

// 行数据进表格前 extra_fees 口袋平铺(c_xxx 上顶层,表格/抽屉/合计按列 key 直取)
function flatMonth(dto: LedgerMonthDTO): LedgerMonthDTO {
  return { ...dto, rows: dto.rows.map(r => mergeExtras(r)) }
}

// ── 进入屏:载入账册 + 公司名单;核对跳转深链则直落目标账册的年月表格态(绕过矩阵态) ──
const auth = useAuthStore()
const route = useRoute()
const focusTenant = ref('')
// KeepAlive 停用时关掉全部 Teleport 浮层(行明细抽屉/问题抽屉/模板编辑器/列映射面板):
// 它们挂在 body 上,不随页面实例停用移出,会浮到别的页签上(审计 VUE-03 补丁范式)。
// 列映射面板还挂着导入解析的 pending Promise,必须 resolve(null) 让导入按取消收场。
onDeactivated(() => {
  drawerRowKey.value = null
  issuesOpen.value = false
  tplOpen.value = false
  if (mapOpen.value) finishMap(null)
})
onMounted(async () => {
  await Promise.all([loadBooks(), loadCompanies()])
  const dl = parseLedgerDeepLink(route.query)
  if (!dl) return
  const c = companies.value.find(x => x.name === dl.company)
  const b = c ? books.value.find(x => x.companyId === c.id) : books.value.find(x => x.name === dl.company)
  if (!b) return
  activeBookId.value = b.id
  year.value = dl.y
  extraYears.value = b.companyId != null ? loadExtraYears('ledger', b.companyId) : []
  // 矩阵数据后台补齐:「换期」返回矩阵时已就绪
  void loadGateYears().then(loadOverviews)
  month.value = dl.m
  await loadMonth()
  focusTenant.value = dl.tenant
})

async function loadBooks() {
  books.value = await booksApi.list('ledger')
  booksLoaded.value = true
}
async function loadCompanies() {
  companies.value = await companyApi.list().catch(() => [] as CompanyDTO[])
}

// requestId 守卫:快速切册/切年/切月时,丢弃先发出但后到达的过期响应
let yearsReq = 0
async function loadGateYears() {
  if (companyId.value == null) return
  const reqId = ++yearsReq
  const data = await ledgerApi.years(companyId.value)
  if (reqId === yearsReq) gateYears.value = data
}
// 逐数据年并行拉概览,写进 册+年 缓存(手工年/区间补位年整年空,不发请求);
// 不清旧值:切回矩阵时旧卡先显、到位原位翻牌(LAYOUT-STABILITY,沿用单年 12 占位卡做法)
let ovReq = 0
async function loadOverviews() {
  const cid = companyId.value
  if (cid == null) return
  const reqId = ++ovReq
  const dataYears = (gateYears.value ?? []).map(y => y.year)
  const res = await Promise.all(dataYears.map(y => ledgerApi.overview(cid, y).catch(() => null)))
  if (reqId !== ovReq) return
  const next = new Map(overviews.value)
  res.forEach((dto, i) => { if (dto) next.set(`${cid}:${dataYears[i]}`, dto) })
  overviews.value = next
}
let monthReq = 0
async function loadMonth() {
  if (companyId.value == null || month.value == null) return
  const reqId = ++monthReq
  const data = await ledgerApi.month(companyId.value, year.value, month.value)
  if (reqId === monthReq) monthDto.value = flatMonth(data)
}

// ── 状态迁移 ─────────────────────────────────────────────
async function selectBook(id: number) {
  // 左轨在编辑态也常驻可点:切册会丢弃编辑草稿,先确认(旧动线里编辑态没有切换入口,此为新暴露面)
  if (edit.value && !window.confirm('正在编辑本月台账,切换账册将丢弃未保存的修改,继续?')) return
  activeBookId.value = id
  month.value = null; edit.value = false; drawerRowKey.value = null; issuesOpen.value = false
  monthDto.value = null; gateYears.value = null
  extraYears.value = companyId.value != null ? loadExtraYears('ledger', companyId.value) : []
  await loadGateYears()
  await loadOverviews()   // 概览缓存不清:回到之前看过的册,旧卡先显后替
}
async function pickCell(y: number, m: number) {
  year.value = y; month.value = m; edit.value = false; drawerRowKey.value = null
  // 先清上月快照,兜底转圈接管:否则请求在途期间标题已是新月、金额还是旧月的
  monthDto.value = null
  await loadMonth()
}
function backToMonths() {
  month.value = null; edit.value = false; drawerRowKey.value = null
  // 保存/导入可能让空月转有数据、手工年转正:年份门+概览一并失效重拉
  // (不 await:requestId 守卫已有,旧值先显后替不闪空)
  loadGateYears().then(loadOverviews).catch(() => { /* 拉失败保持旧值即可,不抛 unhandledrejection */ })
}

// ── 选期矩阵 v3:全部年份纵排(数据年∪当前年∪手工年连续补满),每年一行 12 月卡 ──
// 手工年增删是本机便利动作(localStorage),无权限门、无确认弹窗;数据年不可移除。
function setExtra(years: number[]) {
  if (companyId.value == null) return
  saveExtraYears('ledger', companyId.value, years)
  extraYears.value = loadExtraYears('ledger', companyId.value)   // 回读取归一化(去重排序)
}
function addEarlier() {
  const rows = matrixYears.value
  setExtra([...extraYears.value, (rows.length ? rows[0].year : new Date().getFullYear()) - 1])
}
function addLater() {
  const rows = matrixYears.value
  setExtra([...extraYears.value, (rows.length ? rows[rows.length - 1].year : new Date().getFullYear()) + 1])
}
function removeYear(y: number) {
  setExtra(extraYears.value.filter(x => x !== y))
}

type MatrixCell = { month: number; hasData: boolean; rowCount?: number; cur?: boolean }
const matrixYears = computed(() => {
  const cid = companyId.value
  if (cid == null) return []
  const curYear = new Date().getFullYear()
  const dataYears = (gateYears.value ?? []).map(y => y.year)
  const out = buildYearRows(dataYears, curYear, extraYears.value).map(r => {
    // 概览未到位时 12 张占位空卡先撑住网格(不塌缩),数据到了原位翻牌(审查#30 推广到多年);
    // 非数据年不看缓存:整年删空后年份降级为 manual,残留的旧概览不得再翻出有数据卡
    const ov = r.manual ? undefined : overviews.value.get(`${cid}:${r.year}`)
    const metaBy = new Map((ov?.months ?? []).map(m => [m.month, m]))
    const months: MatrixCell[] = Array.from({ length: 12 }, (_, i) => {
      const meta = metaBy.get(i + 1)
      const hasData = !!meta && meta.status !== 'empty'
      return { month: i + 1, hasData, rowCount: hasData ? meta!.tenants : undefined }
    })
    return {
      year: r.year,
      months,
      // 当前年优先:当前自然年无数据时 manual 也为真,不得标成「手工年」(它不可移除、非手工添加)
      sub: r.year === curYear ? '当前年' : r.manual ? '手工年' : undefined,
      // 手工添加(区间自动补位年不算)且整年仍为空才可移除;录入数据即转正(gateYears 收编后 manual=false)
      removable: r.manual && extraYears.value.includes(r.year) && months.every(m => !m.hasData),
    }
  })
  // cur 标记:全年份范围内最近有数据的那一个月描边
  for (let i = out.length - 1; i >= 0; i--) {
    const j = out[i].months.map(m => m.hasData).lastIndexOf(true)
    if (j >= 0) { out[i].months[j].cur = true; break }
  }
  return out
})

// ── 新增账册(§9 建司即建册,后端建公司时自动挂 v1 账册;company:manage 门) ──
async function createCompany(name: string) {
  try {
    const c = await companyApi.create(name)
    newDlg.value = false
    await Promise.all([loadCompanies(), loadBooks()])
    const b = books.value.find(x => x.companyId === c.id)
    if (b) await selectBook(b.id)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '新建账册失败')
  }
}

// ── 删除公司(company:manage 第15权限点):左轨底部「删除账册」→ 两步弹窗(选册→输名确认) → 级联删库。
//    入口与「新增账册」并排,不放行内(用户拍板 2026-08-24:hover 钮夹在选册点击目标中间易误触) ──
const delOpen = ref(false)
const deleting = ref(false)
// 确认要求输的是**公司名原文**(账册名可能带「台账」后缀,以公司档案为准;查不到时退回册名)
const delBooks = computed(() => books.value
  .filter(b => b.companyId != null)
  .map(b => ({ id: b.id, name: b.name,
    companyName: companies.value.find(c => c.id === b.companyId)?.name ?? b.name })))
async function removeCompany(bookId: number) {
  const b = books.value.find(x => x.id === bookId) ?? null
  // companyId 类型上可空(s10 册无公司);台账册必有,空则不动(防御)
  if (!b || b.companyId == null || deleting.value) return
  deleting.value = true
  try {
    await companyApi.remove(b.companyId)
    delOpen.value = false
    if (activeBookId.value === b.id) {
      // 删的是当前册 → 回未选册态,清空整条状态链(草稿随公司一起没了,弹窗已输名确认)
      activeBookId.value = null; month.value = null; edit.value = false
      drawerRowKey.value = null; issuesOpen.value = false
      draft.value = []; deletedKeys.value = new Set()
      monthDto.value = null; gateYears.value = null; extraYears.value = []
    }
    await Promise.all([loadBooks(), loadCompanies()])
    toastVer(`已删除「${b.name}」及其全部数据`)
  } catch (e) {
    toastVer((e as { message?: string })?.message ?? '删除失败')
  } finally {
    deleting.value = false
  }
}

// ── 模板编辑(§3:轻改动不升版,结构改动升版;versions 懒加载;rollback=复制历史版为新版) ──
const tplOpen = ref(false)
const tplVersions = ref<TemplateVersion[]>([])
const tplSaving = ref(false)
const verToast = ref('')
function toastVer(msg: string) {
  verToast.value = msg
}
function patchBook(b: Book) {
  books.value = books.value.map(x => (x.id === b.id ? b : x))   // book computed 换新 → 列即时重算
}
async function openTemplate() {
  if (!book.value) return
  tplOpen.value = true
  tplVersions.value = []
  try {
    tplVersions.value = (await booksApi.versions(book.value.id)).versions
  } catch { /* 版本链拉失败面板显「暂无版本记录」,不阻断编辑 */ }
}
async function onTplSave(def: BookDef, note: string) {
  if (!book.value || tplSaving.value) return
  tplSaving.value = true
  try {
    const res = await booksApi.saveTemplate(book.value.id, def, note || undefined)
    patchBook(res.book)
    if (res.structural) toastVer(`模板已升版 v${res.book.ver}`)
    tplOpen.value = false
  } catch (e) {
    alert((e as { message?: string })?.message ?? '模板保存失败')
  } finally {
    tplSaving.value = false
  }
}
async function onTplRollback(ver: number) {
  if (!book.value) return
  try {
    const b = await booksApi.rollback(book.value.id, ver)
    patchBook(b)
    toastVer(`已回滚为新版本 v${b.ver}`)
    tplVersions.value = (await booksApi.versions(b.id)).versions
  } catch (e) {
    alert((e as { message?: string })?.message ?? '回滚失败')
  }
}

// ── §4 导入不丢列:未匹配列 → ColumnMapPanel 逐列拍板 → 决策合成一次 saveTemplate ──
const mapOpen = ref(false)
const mapUnmatched = ref<UnmatchedHeader[]>([])
let mapDone: ((r: { def: BookDef; ignore: string[] } | null) => void) | null = null
const mapExistingCols = computed(() =>
  book.value ? flattenCols(book.value.definition).map(c => ({ id: c.id, label: c.label })) : [])

// FpImportModal 解析期间 await 此回调;面板叠在导入弹窗上(z 层修正见本文件底部全局样式)
function resolveUnmatchedCb(unmatched: { header: string; sample?: string }[]): Promise<{ def: BookDef; ignore: string[] } | null> {
  if (!book.value) return Promise.resolve(null)
  mapUnmatched.value = unmatched
  mapOpen.value = true
  return new Promise(res => { mapDone = res })
}
function finishMap(r: { def: BookDef; ignore: string[] } | null) {
  mapOpen.value = false
  mapDone?.(r)
  mapDone = null
}
async function onMapApply(decisions: ColDecision[]) {
  const b = book.value
  if (!b) { finishMap(null); return }
  const { def, ignore, changed } = applyColDecisions(b.definition, decisions)
  if (!changed) { finishMap({ def: b.definition, ignore }); return }   // 全忽略/别名已有:模板不动
  try {
    // map+create 合成一次 saveTemplate 持久化(轻改动就地更新,结构改动升版)
    const res = await booksApi.saveTemplate(b.id, def, '导入列映射')
    patchBook(res.book)
    if (res.structural) toastVer(`模板已升版 v${res.book.ver}`)
    finishMap({ def: res.book.definition, ignore })
  } catch (e) {
    // 面板留着:用户可改决策重试或取消(取消 → resolve null → 导入按取消收场)
    alert((e as { message?: string })?.message ?? '模板更新失败,请重试或取消导入')
  }
}

// ── 编辑流(与旧版一致) ───────────────────────────────────
function snapshotDraft() {
  draft.value = (monthDto.value?.rows ?? []).map(r => ({ ...r }))
}
function enterEdit() {
  snapshotDraft()
  deletedKeys.value = new Set()
  edit.value = true
  ensureTenantsLoaded()
}

// 批量删除(编辑态勾选;从 draft 移除并记入 deletedKeys,保存时以空行提交=后端删空落库)
const deletedKeys = ref<Set<number>>(new Set())
function onBulkRemove(rowKeys: number[]) {
  const storedKeys = new Set((monthDto.value?.rows ?? []).map(r => ledgerRowKey(r)))
  const next = new Set(deletedKeys.value)
  for (const k of rowKeys) if (storedKeys.has(k)) next.add(k)
  deletedKeys.value = next
  draft.value = draft.value.filter(r => !rowKeys.includes(ledgerRowKey(r)))
}

// 添加租户行(宽表只显示有数据的租户;新租户入账从候选挑一行加进 draft,保存时落库)
const allTenants = ref<TenantDTO[]>([])
let tenantsInflight: Promise<void> | null = null
function ensureTenantsLoaded() {
  if (tenantsInflight) return
  tenantsInflight = tenantApi.list()
    .then(v => { allTenants.value = v })
    .catch(() => {})
    .finally(() => { tenantsInflight = null })
}
const addableTenants = computed(() =>
  allTenants.value
    .filter(t => t.status === 1 && !draft.value.some(r => r.tenantId === t.id))
    .map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
)
function onAddTenantRow(tenantId: number) {
  const t = allTenants.value.find(x => x.id === tenantId)
  if (!t || draft.value.some(r => r.tenantId === tenantId)) return
  const zero = { id: null, tenantId: t.id, tenantName: t.companyName, balancePrev: 0, totalCollected: 0, note: null, totalReceivable: 0, balanceEnd: 0 } as Record<string, unknown>
  for (const k of FEE_KEYS) zero[k] = 0
  draft.value = [zero as unknown as LedgerRowDTO, ...draft.value]
}
function cancelEdit() {
  edit.value = false
  draft.value = []
  deletedKeys.value = new Set()
}
async function save() {
  if (companyId.value == null || month.value == null) return
  saving.value = true
  try {
    // PUT body:派生列省略后端重算;自定义列走 extraFees 整包替换(extractExtras 全键输出,缺失→null)
    const extraIds = book.value ? extraColIds(book.value.definition) : []
    const rows: LedgerSaveRow[] = draft.value.map(r => {
      const fees = Object.fromEntries(FEE_KEYS.map(k => [k, r[k]]))
      const row = { id: r.id ?? undefined, tenantId: r.tenantId,
                    balancePrev: r.balancePrev, totalCollected: r.totalCollected, note: r.note, ...fees } as LedgerSaveRow
      if (extraIds.length) row.extraFees = extractExtras(r as unknown as Record<string, unknown>, extraIds)
      return row
    })
    // 批量删除的行以全零空行提交(自定义列一并置 null 清空),后端「删空」语义落库删除
    const draftKeys = new Set(draft.value.map(r => ledgerRowKey(r)))
    for (const k of deletedKeys.value) {
      if (draftKeys.has(k)) continue
      const orig = (monthDto.value?.rows ?? []).find(r => ledgerRowKey(r) === k)
      if (!orig) continue
      const zeros = Object.fromEntries(FEE_KEYS.map(kk => [kk, 0]))
      const row = { id: orig.id ?? undefined, tenantId: orig.tenantId,
                    balancePrev: 0, totalCollected: 0, note: null, ...zeros } as LedgerSaveRow
      if (extraIds.length) row.extraFees = Object.fromEntries(extraIds.map(id => [id, null]))
      rows.push(row)
    }
    monthDto.value = flatMonth(await ledgerApi.save(companyId.value, year.value, month.value, { rows }))
    edit.value = false
    draft.value = []
    deletedKeys.value = new Set()
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
    monthDto.value = flatMonth(await ledgerApi.copyFromPrev(companyId.value, year.value, month.value))
    snapshotDraft()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '从上月复制失败')
  } finally {
    saving.value = false
  }
}

// 抽屉行:用已加载的行(读态 monthDto,编辑态 draft),按行键定位
const drawerRow = computed<LedgerRowDTO | null>(() => {
  if (drawerRowKey.value == null) return null
  const rows = edit.value ? draft.value : monthDto.value?.rows ?? []
  return rows.find(r => ledgerRowKey(r) === drawerRowKey.value) ?? null
})

// ── 导入 Excel(scope = 当前账册公司 + 年 + 月,在表格态入口) ──────────
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
type SectionPick = { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }

// 关导入弹窗时若列映射面板还挂着 pending Promise,一并按取消收场(弹窗解析在 await 它)
function closeImport() {
  importing.value = false
  if (mapOpen.value) finishMap(null)
}

async function onImport(recs: ImportRec[], fileName: string) {
  if (companyId.value == null || month.value == null) return
  const ym = recs[0]?.__ymDetected as { year: number; month: number } | undefined
  if (ym && (ym.year !== year.value || ym.month !== month.value)) {
    if (!window.confirm(`文件标题识别为 ${ym.year}年${ym.month}月,当前导入目标是 ${year.value}年${month.value}月,仍导入到当前月吗?`)) return
  }
  importing.value = false
  await runLedgerImport(recs, fileName)
}

async function onImportSections(picks: SectionPick[], fileName: string) {
  if (companyId.value == null || month.value == null) return
  importing.value = false
  await runSectionsImport(picks, fileName)
}

async function runLedgerImport(recs: ImportRec[], fileName: string) {
  const existing = new Set((monthDto.value?.rows ?? []).map(r => r.tenantName))
  const n = new Set(recs.map(r => String(r.tenantName ?? '').trim()).filter(name => existing.has(name))).size
  if (n > 0 && !window.confirm(`本月已有 ${n} 家租户的台账数据,导入将覆盖这些租户文件中提供的列,继续?`)) return
  try {
    importResult.value = await runImport('ledger', recs,
      { companyId: companyId.value!, companyName: companyName.value, year: year.value, month: month.value! }, fileName)
    await loadMonth()
    await afterImportIssues()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

async function runSectionsImport(picks: SectionPick[], fileName: string) {
  try {
    importResult.value = await runImport('ledger', picks,
      { companyId: companyId.value!, companyName: companyName.value, year: year.value, month: month.value! }, fileName)
    await loadMonth()
    await afterImportIssues()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 未绑定问题抽屉(V105) ─────────────────────────────────
const issuesOpen = ref(false)
const router = useRouter()
const tabs = useTabsStore()

const issueGroups = computed<IssueGroup[]>(() => groupUnbound(
  monthDto.value?.rows ?? [],
  r => Number(r.totalReceivable) || 0,
  `${year.value}年${month.value}月 · ${companyName.value}`,
))

async function afterImportIssues() {
  ensureTenantsLoaded()
  if ((monthDto.value?.rows ?? []).some(r => r.tenantId == null)) issuesOpen.value = true
}

async function onBindIssue(name: string, tenantId: number) {
  try {
    const res = await ledgerApi.bindTenant(name, tenantId)
    await refreshRowIdentity()
    if (res.conflicts > 0)
      alert(`已绑定 ${res.bound} 行;另有 ${res.conflicts} 行因目标租户当月已有台账行而跳过,请到对应月份人工合并。`)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '绑定失败')
  }
}

function onTenantClick(row: LedgerRowDTO) {
  drawerRowKey.value = ledgerRowKey(row)
  ensureTenantsLoaded()
}

// 行级绑定/换绑/解绑/改名(抽屉内即时提交):重拉本月 + 编辑态就地同步 draft 的身份字段
async function refreshRowIdentity() {
  const data = flatMonth(await ledgerApi.month(companyId.value!, year.value, month.value!))
  monthDto.value = data
  if (edit.value) {
    const byId = new Map(data.rows.filter(r => r.id != null).map(r => [r.id!, r]))
    for (const r of draft.value)
      if (r.id != null && byId.has(r.id)) {
        r.tenantId = byId.get(r.id)!.tenantId
        r.tenantName = byId.get(r.id)!.tenantName
      }
  }
}
async function onBindRow(rowId: number, tenantId: number | null) {
  try {
    await ledgerApi.bindRow(rowId, tenantId)
    await refreshRowIdentity()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '绑定失败')
  }
}
async function onRenameRow(rowId: number, tenantName: string) {
  try {
    await ledgerApi.renameRow(rowId, tenantName)
    await refreshRowIdentity()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '改名失败')
  }
}

const bindOptions = computed(() => toBindOptions(allTenants.value))

function gotoTenants() {
  issuesOpen.value = false
  tabs.open('tenants')
  router.push('/tenants')
}
</script>

<template>
  <div class="lgw">
    <!-- 左轨:本屏账册(账册即公司)常驻,一键切换;新增/删除公司入口走 company:manage(第15权限点) -->
    <aside class="lgw-rail">
      <div class="lgw-rail-t">台账账册</div>
      <BookRail
        :books="books"
        :active-id="activeBookId"
        :can-manage="auth.can('company:manage')"
        @select="selectBook"
        @create="newDlg = true"
        @delete="delOpen = true"
      />
    </aside>

    <div class="lgw-main">
      <!-- 载入中 -->
      <div v-if="!booksLoaded" class="page-loading"><span class="page-spin" /></div>

      <!-- 未选册占位 -->
      <div v-else-if="!book" class="lgw-empty">
        <component :is="iconFor('book-open')" :size="28" />
        <p class="t">从左侧选择账册</p>
        <p class="s">每家记账公司一册 · 选册后按年份与月份进入宽表录入</p>
      </div>

      <!-- 矩阵态:账册头 + 全部年份纵排月卡(§5 明确选期门 v3,必点月卡进宽表;年份增删入口在组件内自渲染) -->
      <template v-else-if="month === null">
        <div class="lgw-head">
          <div>
            <h2 class="lgw-title">月度台账 · {{ book.name }} <span class="lgw-ver">v{{ book.ver }}</span></h2>
            <p class="lgw-sub">选择月份进入该月宽表 · 空月可直接进入录入 / 导入 / 从上月复制</p>
          </div>
        </div>
        <div v-if="gateYears" class="lgw-matrix">
          <BookMonthMatrix
            :book="book"
            :years="matrixYears"
            @pick="pickCell"
            @add-earlier="addEarlier"
            @add-later="addLater"
            @remove-year="removeYear"
          />
        </div>
        <div v-else class="page-loading"><span class="page-spin" /></div>
      </template>

      <!-- 表格态 + 行明细抽屉 -->
      <template v-else-if="monthDto">
        <LedgerWideTable
          :month="monthDto"
          :draft="draft"
          :book="book"
          :company-name="companyName"
          :year="year"
          :month-no="month!"
          :edit="edit"
          :saving="saving"
          :addable-tenants="addableTenants"
          :issue-count="issueGroups.reduce((n, g) => n + g.count, 0)"
          :focus-tenant="focusTenant"
          @focus-done="focusTenant = ''"
          @back="backToMonths"
          @enter-edit="enterEdit"
          @cancel="cancelEdit"
          @save="save"
          @copy-from-prev="copyFromPrev"
          @tenant-click="onTenantClick"
          @import="importing = true"
          @add-tenant="onAddTenantRow"
          @bulk-remove="onBulkRemove"
          @edit-template="openTemplate"
          @open-issues="issuesOpen = true; ensureTenantsLoaded()"
        />
        <LedgerTenantDrawer
          :row="drawerRow"
          :book="book"
          :company-name="companyName"
          :year="year"
          :month-no="month!"
          :prev-month="monthDto.prevMonth"
          :tenants="bindOptions"
          :can-bind="edit && auth.can('entry:edit')"
          :on-bind="onBindRow"
          :on-rename="onRenameRow"
          @close="drawerRowKey = null"
        />
        <FpImportModal
          v-if="importing"
          :title="'导入 月度台账 · ' + companyName"
          :sub="'按表头名字自动识别列,需包含表头;可整表粘贴(前置公司列/合计行/应收结余列自动忽略),导入到 ' + year + ' 年 ' + month + ' 月'"
          v-bind="parserProps('ledger', {
            year, month: month!, companyId: companyId ?? undefined, companyName,
            companyNames: companies.map(c => c.name),
            bookDef: book?.definition, resolveUnmatched: resolveUnmatchedCb,
          })"
          @close="closeImport"
          @import="onImport"
          @import-sections="onImportSections"
        />
        <!-- 未绑定租户问题抽屉(V105:右侧滑出,边看表格边处理;绑定走编辑模式门) -->
        <FPSideDrawer :open="issuesOpen" title="未绑定的租户行" @close="issuesOpen = false">
          <FPTenantIssuePanel
            :groups="issueGroups"
            :tenants="allTenants"
            :can-act="edit && auth.can('entry:edit')"
            act-hint="进入「编辑」模式后可在此绑定;浏览态仅查看。"
            :on-bind="onBindIssue"
            @goto-tenants="gotoTenants"
          />
        </FPSideDrawer>
      </template>

      <!-- 过渡中(切册/切月,数据加载)兜底转圈,不闪空白(v-else 必须紧邻上方状态链) -->
      <div v-else class="page-loading"><span class="page-spin" /></div>
    </div>
  </div>

  <!-- 模板编辑器(编辑模式入口在宽表工具栏;save/rollback 结果就地更新 book,列即时重算) -->
  <TemplateEditorPanel
    :open="tplOpen"
    :book="book"
    :versions="tplVersions"
    :saving="tplSaving"
    @save="onTplSave"
    @rollback="onTplRollback"
    @close="tplOpen = false"
  />

  <!-- §4 导入列映射面板:FpImportModal 解析期间 await,决策 apply 后合成一次 saveTemplate -->
  <ColumnMapPanel
    :open="mapOpen"
    :unmatched="mapUnmatched"
    :existing-cols="mapExistingCols"
    @apply="onMapApply"
    @close="finishMap(null)"
  />

  <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />

  <LedgerNewCompanyDialog
    v-if="newDlg"
    :existing-names="companies.map(c => c.name)"
    @close="newDlg = false"
    @create="createCompany"
  />

  <!-- 删除账册(company:manage):两步弹窗——选册 → 输公司名原文激活删除,级联不可恢复 -->
  <LedgerDeleteCompanyDialog
    v-if="delOpen"
    :books="delBooks"
    :busy="deleting"
    @close="delOpen = false"
    @confirm="removeCompany"
  />

  <!-- 升版提示:收编进 FPToast(LAYOUT-STABILITY §4.1 反馈提示唯一组件,审查#31) -->
  <FPToast v-model="verToast" placement="page" :duration="4000" />
</template>

<style scoped>
/* 账册工作台两栏:左轨常驻 + 右侧三态主区 */
.lgw { display:flex; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.lgw-rail {
  flex:0 0 208px; min-height:0; display:flex; flex-direction:column; gap:8px;
  padding:14px 12px; box-sizing:border-box;
  background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg);
}
.lgw-rail-t { font-size:12px; font-weight:var(--fw-medium); color:var(--text-muted); padding:0 4px; }
.lgw-main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; gap:16px; overflow-y:auto; }

/* 未选册占位 */
.lgw-empty {
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  color:var(--text-disabled);
}
.lgw-empty .t { margin:8px 0 0; font-size:15px; font-weight:var(--fw-semibold); color:var(--text-muted); }
.lgw-empty .s { margin:0; font-size:12px; color:var(--text-disabled); }

/* 矩阵态账册头 */
.lgw-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lgw-title { margin:0; font:var(--type-h2); color:var(--text-primary); display:flex; align-items:center; gap:8px; }
.lgw-ver {
  font-family:var(--font-mono); font-size:11px; font-weight:var(--fw-semibold);
  color:var(--hue-blue); background:var(--accent-blue); border-radius:var(--radius-full); padding:2px 9px;
}
.lgw-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lgw-matrix { flex:0 0 auto; }

</style>

<style>
</style>
