<script setup lang="ts">
// 月度台账 · 账册工作台(BOOK-WORKBENCH-SPEC §5 选期矩阵 v3)。三态状态机:
//   未选册(activeBookId=null) → 矩阵态(month=null:全部年份纵排,每年一行12月卡) → 表格态(month!=null)。
// 左轨 BookRail 常驻(账册即公司,§7-2 实体切换在左栏);年份范围=数据年∪当前年∪手工年(utils/matrixYears);
// 进宽表必点月卡(§7-1 明确选期门,pick 自带年份);表格态「换期」回矩阵。
// 旧动线(公司picker→年份门→月历)已废,LedgerCompanyPicker/LedgerMonthGrid 不再引用(文件保留待主线拍板)。
import { ref, computed, watch, nextTick, onMounted, onDeactivated } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { periodOf, type DeepPeriod } from '@/nav/deepLink'
import { S } from '@/utils/lockScopes'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { companyApi, ledgerApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import { loadExtraYears, saveExtraYears, buildYearRows } from '@/utils/matrixYears'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import type { CompanyDTO, YearMonthsDTO, LedgerOverviewDTO, LedgerMonthDTO, LedgerRowDTO, LedgerSaveRow } from '@/types/ledger'
import { saveRowIdentity, overwriteTargets } from '@/types/ledger'
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

// 册清单里的那一行(定义=链尾版):矩阵态/未选月时用它
const chainBook = computed(() => books.value.find(b => b.id === activeBookId.value) ?? null)
// 表格态的册按 (册,年,月) 解析(spec P2/P3):列定义与导入词典都跟着月份走,不再是「每册一个现行版」
const monthBook = ref<Book | null>(null)
const book = computed(() => (month.value != null && monthBook.value?.id === activeBookId.value)
  ? monthBook.value
  : chainBook.value)
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
// 编辑锁作用域(CONCURRENCY-SPEC §3.1 / 拍板 #1:按公司 + 年月)。
// 公司或月份没定下来就没有期可锁 → null,LedgerWideTable 据此不上锁。
/** 矩阵每一格的作用域 —— 与进去之后那把锁必须是同一个键。 */
const cellScope = (y: number, m: number) =>
  companyId.value == null ? null : S.ledger(companyId.value, y, m)
const lockScope = computed(() =>
  companyId.value != null && month.value != null
    ? S.ledger(companyId.value, year.value, month.value)
    : null)

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
// 停用时必须关(上面 VUE-03 的理由),但**关掉不等于忘掉**:去租户管理加个别名再回来,
// 抽屉该还在原处,而不是把人丢回月份列表重新翻一遍(2026-08-28 用户拍板)。
const resume = { rowKey: null as number | null, issues: false }
onDeactivated(() => {
  resume.rowKey = drawerRowKey.value
  resume.issues = issuesOpen.value
  drawerRowKey.value = null
  issuesOpen.value = false
  // 模板面板**故意不恢复**:它的编辑锁在面板内部随 open 释放(watch props.open → lock.release),
  // 恢复只会把面板开在无锁状态 —— 这期间锁可能已被别人拿走。要改模板重新点一次即可。
  tplOpen.value = false
  // 列映射面板同样不恢复:它挂着导入解析的 pending Promise,已按取消 resolve(null) 收场,
  // 那次导入就此结束,再开一个空面板只会让人以为还能继续。
  if (mapOpen.value) finishMap(null)
})
onReactivated(() => {
  drawerRowKey.value = resume.rowKey
  issuesOpen.value = resume.issues
})
// books / companies 只拉一次:onMounted 与深链 apply 谁先到谁发起,后到的等同一个 Promise
let loaded: Promise<void> | null = null
function ensureLoaded() {
  if (!loaded) loaded = Promise.all([loadBooks(), loadCompanies()]).then(() => {})
  return loaded
}
onMounted(() => { void ensureLoaded() })
/** 深链的 co → 册:新链 co=<公司 id>;旧链 ?company=<公司名>(公司名认不到再按册名);没给 co 或 co='all'(台账没有「全部」视图)= 当前册,还没选册就是首册。认不出 → null(不动)。 */
function bookOf(co: DeepPeriod['co']): Book | null {
  if (typeof co === 'number') return books.value.find(b => b.companyId === co) ?? null
  if (typeof co === 'string' && co !== 'all') {
    const c = companies.value.find(x => x.name === co)
    return (c ? books.value.find(b => b.companyId === c.id) : books.value.find(b => b.name === co)) ?? null
  }
  return chainBook.value ?? books.value[0] ?? null
}
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM&co=<公司 id> 直落该册该月的宽表(绕过矩阵态);只有年的链接不动(本屏只认整月)。
// setup 期 books / companies 还没到 —— apply 是异步的:先等 ensureLoaded,再落册落期(与出账链五屏「同步 pick」不同,复查时别按那个口径看)。
// 换期前若在编辑态先 cancelEdit:LedgerWideTable 的 watch(edit) 据此还锁,否则 lockScope 换了键、旧锁没人认领(它是第 5 条退出编辑态的路)。
// 三个 ref(册 / 年 / 月)在同一拍连写,watch([activeBookId, year, month]) 只跑一次 templateAt。?tenant= 照旧定位高亮。
async function applyDeep(t: DeepPeriod) {
  if (t.month == null) return
  await ensureLoaded()
  const b = bookOf(t.co)
  if (!b) return
  if (edit.value) cancelEdit()
  activeBookId.value = b.id
  year.value = t.year
  extraYears.value = b.companyId != null ? loadExtraYears('ledger', b.companyId) : []
  // 矩阵数据后台补齐:「换期」返回矩阵时已就绪
  void loadGateYears().then(loadOverviews).catch(() => { /* 拉失败保持旧值即可,不抛 unhandledrejection(同 backToMonths) */ })
  month.value = t.month
  drawerRowKey.value = null
  // 先清上月快照,兜底转圈接管(同 pickCell)
  monthDto.value = null
  await loadMonth()
  focusTenant.value = typeof route.query.tenant === 'string' ? route.query.tenant : ''
}
/** 未保存改动数:编辑态下 draft 与服务端快照逐行比(含批删)。子组件 LedgerWideTable.isDirty 是同口径的布尔,它没 expose,父层自算。 */
function dirtyCount(): number {
  if (!edit.value) return 0
  const base = new Map((monthDto.value?.rows ?? []).map(r => [ledgerRowKey(r), JSON.stringify(r)]))
  let n = deletedKeys.value.size
  for (const r of draft.value) if (base.get(ledgerRowKey(r)) !== JSON.stringify(r)) n++
  return n
}
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: month.value == null ? null : periodOf(year.value, month.value), co: companyId.value }),
  apply: (t) => { void applyDeep(t).catch(() => {}) },
  dirty: dirtyCount,
})
// KeepAlive 切回重读本月(spec §12 同款):导入中心导完切回来,宽表不能还是导入前的;编辑态不动(草稿在 draft 里,快照换了会把它判脏)
onReactivated(() => { if (month.value != null && !edit.value) void loadMonth().catch(() => {}) })

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
let tplReq = 0
async function loadMonthBook() {
  const id = activeBookId.value
  const y = year.value, m = month.value
  if (id == null || m == null) return
  const reqId = ++tplReq
  // 先清:请求在途期间宁可退回册清单那行(链尾版),也不许把**上个月**那版模板顶在新月份上 ——
  // book 是带回退的 computed(矩阵态没有月份),只比册 id 的话同册切月会留一个显示上月版本的窗口
  monthBook.value = null
  try {
    const b = await booksApi.templateAt(id, y, m)
    if (reqId === tplReq) monthBook.value = b
  } catch {
    // 失败不静默:列会退回链尾版,可能与本月的钱(archivedCols)对不上,得让人知道
    if (reqId === tplReq) toastVer(`${y} 年 ${m} 月的模板版本没取到,当前按链尾版显示;请刷新重试`)
  }
}
watch([activeBookId, year, month], loadMonthBook)

let monthReq = 0
async function loadMonth() {
  if (companyId.value == null || month.value == null) return
  const reqId = ++monthReq
  const data = await ledgerApi.month(companyId.value, year.value, month.value)
  if (reqId === monthReq) monthDto.value = flatMonth(data)
}

// ≤960 顶部账册 chips(RESPONSIVE-LAYOUT-SPEC §5.6):选中项常显——深链/切册后选中 chip
// 可能在横滚区外,滚到可见。jsdom 无 scrollIntoView,可选调用兜底;桌面档 chips display:none,
// scrollIntoView 对不可见元素是空操作,不必按档跳过。
const chipsEl = ref<HTMLElement | null>(null)
watch(activeBookId, async () => {
  await nextTick()
  chipsEl.value?.querySelector('.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
})

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

// ── 模板编辑(spec P4/P5:从本月那版改起,存成链尾+1 只把本月切过去;versions 懒加载;pin=钉本月的版本) ──
const tplOpen = ref(false)
const tplVersions = ref<TemplateVersion[]>([])
const tplSaving = ref(false)
const verToast = ref('')
function toastVer(msg: string) {
  verToast.value = msg
}
function patchBook(b: Book) {
  monthBook.value = b   // 保存/钉版回的是**本月生效**的那一版 → 列即时重算
  // 册清单里的行恒是链尾版。保存产出的新版就是链尾,顺手换上;钉旧版只抬 latestVer。
  // 全局链是一条:同屏其他公司册的链尾一起抬,别处的版本选择器不必刷新整页才看得见这一版。
  books.value = books.value.map(x =>
    x.id === b.id && b.ver === b.latestVer
      ? b
      : { ...x, latestVer: Math.max(x.latestVer, b.latestVer) })
}
async function openTemplate() {
  if (!book.value) return
  tplOpen.value = true
  tplVersions.value = []
  try {
    tplVersions.value = (await booksApi.versions(book.value.id, year.value, month.value ?? undefined)).versions
  } catch { /* 版本链拉失败面板显「暂无版本记录」,不阻断编辑 */ }
}
async function onTplSave(def: BookDef, note: string) {
  if (!book.value || month.value == null || tplSaving.value) return
  tplSaving.value = true
  try {
    const res = await booksApi.saveTemplate(book.value.id, def, year.value, month.value, note || undefined)
    patchBook(res.book)
    toastVer(`模板已升版 v${res.book.ver}(仅本月)`)
    tplOpen.value = false
    await loadMonth()   // 归档列/合计按新版重算
  } catch (e) {
    alert((e as { message?: string })?.message ?? '模板保存失败')
  } finally {
    tplSaving.value = false
  }
}
// P7 选择器:只钉本月(不造版本);该月已录入后端 409(P6 冻结,面板那边已置灰,这里兜底提示)
async function onTplPin(ver: number) {
  if (!book.value || month.value == null) return
  try {
    const b = await booksApi.pin(book.value.id, ver, year.value, month.value)
    patchBook(b)
    toastVer(`本月已切到模板 v${b.ver}`)
    await loadMonth()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '切换模板版本失败')
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
  const m = month.value
  if (!b || m == null) { finishMap(null); return }
  const { def, ignore, changed } = applyColDecisions(b.definition, decisions)
  if (!changed) { finishMap({ def: b.definition, ignore }); return }   // 全忽略/别名已有:模板不动
  try {
    // map+create 合成一次 saveTemplate 持久化(P5:任何保存都升版,只把本月切过去)
    const res = await booksApi.saveTemplate(b.id, def, year.value, m, '导入列映射')
    patchBook(res.book)
    toastVer(`模板已升版 v${res.book.ver}(仅本月)`)
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
    // PUT body:派生列省略后端重算;自定义列走 extraFees 整包替换(extractExtras 全键输出,缺失→null)。
    // 归档列必须一起收回:它可能已被从模板里删掉,漏掉这一键整包替换就把这笔历史钱清成 null(spec §2)
    const extraIds = book.value ? extraColIds(book.value.definition, monthDto.value?.archivedCols) : []
    const rows: LedgerSaveRow[] = draft.value.map(r => {
      const fees = Object.fromEntries(FEE_KEYS.map(k => [k, r[k]]))
      const row = { ...saveRowIdentity(r),
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
      const row = { ...saveRowIdentity(orig),
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
  const n = overwriteTargets(monthDto.value?.rows ?? [], recs.map(r => r.tenantName as string | null | undefined))
  if (n > 0 && !window.confirm(`本月已有 ${n} 家租户的台账数据,导入将覆盖这些租户文件中提供的列,继续?`)) return
  try {
    importResult.value = await runImport('ledger', recs,
      { companyId: companyId.value!, companyName: companyName.value, year: year.value, month: month.value! }, fileName)
    await loadMonth()
    refreshDraftAfterImport()
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
    refreshDraftAfterImport()
    await afterImportIssues()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// 导入落库后编辑态渲染的是 draft:不重建就一直空表到点保存(2026-08-24 用户点名 bug)。
// 沿用进入编辑时的构建逻辑重建、清删除记账;导入前 LedgerWideTable 已做脏确认,这里直接重建不再问。
function refreshDraftAfterImport() {
  if (!edit.value) return
  snapshotDraft()
  deletedKeys.value = new Set()
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
async function onBindRow(rowId: number, tenantId: number | null, addAlias = false) {
  try {
    await ledgerApi.bindRow(rowId, tenantId, addAlias)
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
  // pin 打开 = 真开一个新页签。不带 pin 会进**预览槽**,而预览槽全局只有一个 ——
  // 去加个别名就把台账那页顶没了,回来还得重新翻到这个月(2026-08-28 用户拍板)。
  // 也不能用 openFresh:那会 bump epoch 让 KeepAlive 丢掉台账实例,抽屉与月份一起没。
  // 这里不再关抽屉 —— onDeactivated 会关,并且记下来等回来复原。
  tabs.open('tenants', { pin: true })
  router.push('/tenants')
}
</script>

<template>
  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5.3/§5.6 迁移(左轨收 chips、宽表 S 档单 sticky、
       矩阵横滚圈在 .lgw-matrix 内),摘掉 base.css 的 M↓ 屏级地板——表内自滚,屏根不再触发双重横滚 -->
  <div class="lgw fp-fluid">
    <!-- 左轨:本屏账册(账册即公司)常驻,一键切换;新增/删除公司入口走 company:manage(第15权限点) -->
    <aside class="lgw-rail">
      <div class="lgw-rail-t">台账账册</div>
      <BookRail
        :books="books"
        :active-id="activeBookId"
        :can-manage="auth.can('company:manage')"
        @select="(id) => selectBook(Number(id))"
        @create="newDlg = true"
        @delete="delOpen = true"
      />
    </aside>

    <!-- ≤960 左轨收成顶部横向 chips(§5.6):选择语义与轨内点击同源 selectBook(含编辑态脏确认);
         ≥961 隐藏、桌面零变化。新增/删除入口同一权限门,不因收轨而消失(弹窗本就是全档覆盖层) -->
    <div ref="chipsEl" class="lgw-chips">
      <button v-for="b in books" :key="b.id" class="lgw-chip" :class="{ on: b.id === activeBookId }"
              @click="selectBook(b.id)">{{ b.name }}</button>
      <template v-if="auth.can('company:manage')">
        <button class="lgw-chip mng" @click="newDlg = true">＋ 新增</button>
        <button class="lgw-chip mng" @click="delOpen = true">删除</button>
      </template>
    </div>

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
            :scope-of="cellScope"
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
        <!-- ≤600 重编辑提示(§5.3):预留位——行常驻定高,文案仅编辑态显,显隐不挪表格
             (LAYOUT-STABILITY §2-3;条件挂在行内 span 上,不进流内块门禁)。编辑不拦不藏 -->
        <div class="lgw-s-hint">
          <span v-if="edit">编辑模式 · 小屏可录入,建议在桌面端操作</span>
        </div>
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
          :lock-scope="lockScope"
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
          :archived="monthDto.archivedCols"
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

  <!-- 模板编辑器(「账册模板」两态常驻入口在宽表工具栏;save/pin 结果就地更新 book,列即时重算;
       编辑走第16权限点 book-template:edit、换版走第17点 book-template:switch,无权时面板只读预览;
       本月已录入(有非结转行)→ 模板定稿,面板置灰) -->
  <TemplateEditorPanel
    :open="tplOpen"
    :book="book"
    :versions="tplVersions"
    :saving="tplSaving"
    :can-edit="auth.can('book-template:edit')"
    :can-switch="auth.can('book-template:switch')"
    :month-has-data="(monthDto?.rows ?? []).some(r => !r.carried)"
    :year="year"
    :month="month"
    @save="onTplSave"
    @pin="onTplPin"
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
  <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
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

/* 顶部 chips 与 S 档提示行:桌面档不存在(display:none),窄档媒体块内再显——宽档规则在前 */
.lgw-chips { display:none; }
.lgw-s-hint { display:none; }

/* ── M/S 档(≤960):左轨收成顶部横向 chips(RESPONSIVE-LAYOUT-SPEC §5.6) ── */
@media (max-width: 960px) {
  .lgw { flex-direction:column; gap:12px; }
  .lgw-rail { display:none; }
  .lgw-chips { flex:0 0 auto; display:flex; gap:8px; overflow-x:auto; padding:2px; }
  .lgw-chip {
    flex:0 0 auto; display:inline-flex; align-items:center;
    height:36px; padding:0 14px; border-radius:var(--radius-full);
    border:1px solid var(--border-subtle); background:var(--surface-white);
    color:var(--text-secondary); font-family:var(--font-sans);
    font-size:var(--fs-label); font-weight:var(--fw-medium);
    cursor:pointer; white-space:nowrap;
  }
  /* 选中态只换色不改尺寸(布局稳定铁律,同 BookRail .br-item.on 语义) */
  .lgw-chip.on { border-color:var(--hue-blue); background:var(--accent-blue); color:var(--text-primary); }
  .lgw-chip.mng { border-style:dashed; color:var(--text-muted); }
  /* 矩阵 12 月卡窄档装不下:横滚圈在矩阵块内,账册头/主区其余内容不跟着滚 */
  .lgw-matrix { overflow-x:auto; }
}

/* ── S 档(≤600):台账录入不拦不藏,常驻预留提示行(§5.3;LAYOUT-STABILITY §2-3 预留位) ── */
@media (max-width: 600px) {
  .lgw-s-hint { display:flex; align-items:center; flex:0 0 20px; height:20px; font-size:12px; color:var(--hue-orange); }
  /* 宽表主体(LedgerWideTable 根)从 height:100% 改弹性填充:给提示行让位,整屏不多滚一截 */
  .lgw-s-hint + .lg-page { height:auto; flex:1 1 auto; }
}
</style>

<style>
</style>
