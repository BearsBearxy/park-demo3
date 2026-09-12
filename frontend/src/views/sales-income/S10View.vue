<script setup lang="ts">
// 附表10 · 销售收入 — 账册工作台三态动线(BOOK-WORKBENCH-SPEC §5/§7/§8)。
// 左轨四册(一期/二期/三期/宿舍区,期区 tabs 退场) + 选期矩阵 v3(§8:年份 tab 退场,
// 全年份纵排一屏,手工年可增删) → 点月卡进宽表;宽表内「换期」回矩阵。
// 版面由所选账册**本月生效**那版模板驱动(toS10Layout;版本按 (册,年,月) 解析,spec P3);自定义列 extra_fees
// 平铺(mergeExtras)进宽表同权编辑,保存整包收回(extractExtras)。
// PAGE-BEHAVIOR-SPEC §1 加载门:overview/books 未就绪显 .page-loading,不假空态。深链(recon 核对跳转)绕过矩阵直落。
import { ref, computed, watch, nextTick, onMounted, onDeactivated, reactive } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { periodOf, type DeepPeriod } from '@/nav/deepLink'
import FPToast from '@/components/fp/FPToast.vue'
import { S } from '@/utils/lockScopes'
import { useRoute } from 'vue-router'
import { s10Api } from '@/api/s10'
import { booksApi } from '@/api/books'
import { exportS10Month } from '@/utils/s10Excel'
import { useSchedScreen, clearConfirm } from '@/composables/useSchedScreen'
import { useReviewStore } from '@/stores/review'
import type { ReviewStatus } from '@/types/review'
import type { S10OverviewDTO, S10MonthDTO, S10RecordDTO, S10ColId, S10RecordReq } from '@/types/s10'
import type { Book, BookDef, TemplateVersion } from '@/types/book'
import { flattenCols } from '@/types/book'
import { toS10Layout, mergeExtras, extractExtras, extraColIds } from '@/utils/bookTemplate'
import { loadExtraYears, saveExtraYears, buildYearRows } from '@/utils/matrixYears'
import { PHASE_LAYOUT, leavesOf, type Group, type LayoutId } from './layout'
import { parserProps, runImport } from '@/utils/importRegistry'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import FPSideDrawer from '@/components/fp/FPSideDrawer.vue'
import FPTenantIssuePanel, { type IssueGroup } from '@/components/fp/FPTenantIssuePanel.vue'
import { groupUnbound } from '@/utils/tenantSuggest'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import FPMoreMenu from '@/components/fp/FPMoreMenu.vue'
import BookRail from '@/components/fp/BookRail.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import TemplateEditorPanel from '@/components/fp/TemplateEditorPanel.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import S10Table from './S10Table.vue'
import S10RecordDrawer from './S10RecordDrawer.vue'
import S10BindDrawer from './S10BindDrawer.vue'
import { toBindOptions } from '@/components/fp/fpTenantPicker'

// ── 账册(左轨)状态:四册期区,phase 由所选账册派生 ─────────────
const books = ref<Book[]>([])
const activeBookId = ref<number | null>(null)
// 左轨选中的那一册(定义=本期区链尾版);期区号只认它,取模板失败也不许把 phase 带歪
const railBook = computed(() => books.value.find(b => b.id === activeBookId.value) ?? null)
// 表格态的册按 (册,年,月) 解析(spec P2/P3):版面与导入词典都跟着月份走。
// year 由下面的 useSchedScreen 给出(computed 惰性求值,这里只是引用)
const monthBook = ref<Book | null>(null)
const activeBook = computed(() => (year.value != null && monthBook.value?.id === activeBookId.value)
  ? monthBook.value
  : railBook.value)
const phase = computed(() => railBook.value?.phase ?? 1)
const bookDef = computed<BookDef | null>(() => activeBook.value?.definition ?? null)
// 模板 → 宽表版面(可见列);合计口径 = 模板全列含隐藏(与后端 recalc 全口袋一致)。
// 归档列(后端下发:本月有钱但模板不渲染的列)追加成只读列,并计入合计与保存口径 ——
// 它可能已被从模板里删掉,漏掉就是「合计对不上明细」+ 保存把这笔历史钱清成 null(spec §2)
const archivedCols = computed(() => monthData.value?.archivedCols ?? [])
const layoutGroups = computed<Group[]>(() =>
  (bookDef.value ? toS10Layout(bookDef.value, archivedCols.value) : []))
const allColIds = computed(() => (bookDef.value
  ? [...new Set([...flattenCols(bookDef.value).map(c => c.id), ...archivedCols.value.map(a => a.id)])]
  : []))
// 新增租户抽屉 profile 选项仍按期区二分(office/factory)——租户类型不属于列模板
const drawerLayout = computed<LayoutId>(() => PHASE_LAYOUT[phase.value] ?? 'office')

const month = ref(1)
const overview = ref<S10OverviewDTO | null>(null)  // §6 加载信号
const monthData = ref<S10MonthDTO | null>(null)
// 编辑态改动集（行 id → 已改）；完成时 upsert
const dirty = reactive(new Set<number>())

// 竞态守卫:快速切月/册时只接受最新一次请求的结果(防乱序落表)
let monthSeq = 0
async function loadMonth(y: number) {
  const seq = ++monthSeq
  const data = await s10Api.getMonth(phase.value, y, month.value)
  if (seq !== monthSeq) return
  // extra_fees 口袋平铺进行顶层:宽表/合计按列 key 直取(BOOK-WORKBENCH §1 方案A)
  monthData.value = { ...data, rows: data.rows.map(r => mergeExtras(r)) }
  dirty.clear()
}
async function reloadOverview() {
  overview.value = await s10Api.getOverview()
}

const {
  year, edit, drawer, importing, importResult, selectedIds, importedCount,
  guard, refresh, pickYear, goGate, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
  load: loadMonth,
  reloadOverview,
  rows: () => monthData.value?.rows ?? [],
  clearData: () => { monthData.value = null },
  // seed 行不可删 → 既不进全选,也不响应单勾
  selectAllFilter: (r: S10RecordDTO) => r.source !== 'seed',
  canSelect: (r: S10RecordDTO) => r.source !== 'seed',
  // 本屏例外:切年/回门原本不清勾选,保持原状
  keepSelectionOnNav: true,
  batchDelete: s10Api.batchDelete,
  clear: {
    call: y => s10Api.clearImported(phase.value, `${y}-${String(month.value).padStart(2, '0')}`),
    confirm: clearConfirm('本期', '手动行不受影响。'),
  },
})

// 按月取模板(spec P3):切册/切年/切月都重取;竞态守卫同 loadMonth。
// ⚠ 必须放在 useSchedScreen 之后 —— watch 的源是**立即**求值的,year 在上面还没初始化
let tplSeq = 0
async function loadMonthBook() {
  const id = activeBookId.value
  const y = year.value, m = month.value
  if (id == null || y == null) return
  const seq = ++tplSeq
  // 与台账同款:在途期间退回左轨那行(链尾版),不许上个月那版顶着(activeBook 是带回退的 computed);
  // 失败也不静默 —— 本屏报错口径是 guard 的 alert
  monthBook.value = null
  await guard(`${y} 年 ${m} 月的模板版本没取到,当前按链尾版显示;请刷新重试`, async () => {
    const b = await booksApi.templateAt(id, y, m)
    if (seq === tplSeq) monthBook.value = b
  })
}
watch([activeBookId, year, month], loadMonthBook)

// ── 矩阵态(选期矩阵 v3,§8):全年份纵排,数据年∪当前年∪手工年连续补满 ──
// overview 无分月行数 → hasData 沿用月 pills 的已录月口径(过去年整年、当年到 currentMonth)
function hasYearData(y: number): boolean {
  const s = overview.value?.summaries.find(x => x.year === y)
  return !!s && (s.recordedMonths > 0 || s.tenantCount > 0)
}
function recordedFor(y: number, m: number): boolean {
  const ov = overview.value
  if (!ov) return false
  if (y < ov.currentYear) return hasYearData(y)
  if (y === ov.currentYear) return m <= ov.currentMonth
  return false
}
// 手工年落本机(bw-extra-years:s10:{phase});bump 让 localStorage 写入驱动重组
const extraBump = ref(0)
const extraYears = computed(() => { void extraBump.value; return loadExtraYears('s10', phase.value) })

// ── 月卡角标:这个月归谁管(设计稿 per-screen-review §07-④) ──
const review = useReviewStore()
/**
 * 一格一把键 —— 本屏挂 4 把期区键,但矩阵只画**左轨选中那一册**的那一把,与屏上按钮同一条规则
 * (§03-B4:用户一次只看得见一把)。切册 = 整片换键,phase 在这里被读到,矩阵自己会重算。
 *
 * 「还不知道 → null」与「库里没这行 = 派生 entered」两条判据都在 stores/review.ts 的 statusOf,
 * 这里不再抄一遍(改前本仓有五份逐字相同的抄写)。
 */
const reviewOf = (y: number, m: number): ReviewStatus | null =>
  review.statusOf(`s10:${phase.value}:${periodOf(y, m)}`)
const matrixYears = computed(() => {
  const ov = overview.value
  if (!ov) return []
  const extra = extraYears.value
  const dataYears = ov.years.filter(y => hasYearData(y))
  // ⚠ ov.currentYear = 最大数据年,不是自然年:范围与「当前年」标签都按自然年(SPEC §5 v3 口径:
  // 数据年∪当前自然年∪手工年);cur 月标记才用 ov.currentYear/currentMonth(=最近有数据月)
  const natural = new Date().getFullYear()
  return buildYearRows(dataYears, natural, extra).map(({ year: y, manual }) => ({
    year: y,
    // 当前年优先:当前自然年无数据时 manual 也为真,不得标成「手工年」
    sub: y === natural ? '当前年' : (manual ? '手工年' : undefined),
    // 数据年不可移除;手工年录入数据即转正(dataYears 接住后 manual 变假)
    removable: manual && extra.includes(y) && !hasYearData(y),
    months: Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const hasData = recordedFor(y, m)
      // cur = 该册最近有数据月 = 当年 currentMonth(currentMonth=0 即全空,无 cur)
      return { month: m, hasData, cur: hasData && y === ov.currentYear && m === ov.currentMonth,
               review: reviewOf(y, m) }
    }),
  }))
})

// 矩阵态本来一个审核请求都不发 —— useSchedScreen 那条闸道 watch 挂在 year 上,而矩阵态 year 恒 null。
// 角标要按年取一趟:纵排几年就是几趟,ensureYear 命中已有的年直接 return,与宽表态共用同一份缓存。
// (审核态按年发,不按册 —— 切册不必重取。)
watch(() => matrixYears.value.map(r => r.year).join(','), () => {
  for (const r of matrixYears.value) void review.ensureYear(r.year)
}, { immediate: true })

// 增删手工年:本机便利动作,无权限门、无确认(§8)
function onAddEarlier() {
  const first = matrixYears.value[0]
  if (!first) return
  saveExtraYears('s10', phase.value, [...extraYears.value, first.year - 1])
  extraBump.value++
}
function onAddLater() {
  const last = matrixYears.value[matrixYears.value.length - 1]
  if (!last) return
  saveExtraYears('s10', phase.value, [...extraYears.value, last.year + 1])
  extraBump.value++
}
function onRemoveYear(y: number) {
  saveExtraYears('s10', phase.value, extraYears.value.filter(x => x !== y))
  extraBump.value++
}

// 点月卡 → 表格态(空月卡可点,进空月录入);换期清勾选——旧版 switchMonth 即清,
// 勾选行 id 跨月残留会让「删除选中」删掉别的月的行(审查#12)
async function pickCell(y: number, m: number) {
  selectedIds.value = new Set()
  month.value = m
  await pickYear(y)
}

// 左轨切册:一键切换,回该册矩阵(§5 进宽表必点月卡)
function selectBook(id: number) {
  if (id === activeBookId.value) return
  // 编辑态有脏改动:切册=丢弃,先确认(与台账屏 selectBook 同款,审查#18)
  if (edit.value && dirty.size > 0 && !window.confirm('正在编辑本期附表,切换账册将丢弃未保存的修改,继续?')) return
  edit.value = false
  selectedIds.value = new Set()
  activeBookId.value = id
  bindRowId.value = null
  issuesOpen.value = false
  if (year.value != null) goGate()
}

// ≤960 顶部账册 chips(RESPONSIVE-LAYOUT-SPEC §5.6,照台账屏范式):选中项常显——
// 深链/切册后选中 chip 可能在横滚区外,滚到可见。jsdom 无 scrollIntoView,可选调用兜底;
// 桌面档 chips display:none,scrollIntoView 对不可见元素是空操作,不必按档跳过。
const chipsEl = ref<HTMLElement | null>(null)
watch(activeBookId, async () => {
  await nextTick()
  chipsEl.value?.querySelector('.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
})

// ── 进入屏:overview + 四册并取(§6 取数前不渲染)。深链(期间深链协议 §4.2 + 收入核对 / 分析层旧链)直落表格态并定位租户行 ──
const route = useRoute()
const focusTenant = ref('')   // 一次性:S10Table 定位完成后清空
// overview / books 只拉一次:onMounted 与深链 apply 谁先到谁发起,后到的等同一个 Promise
let loaded: Promise<void> | null = null
function ensureLoaded() {
  if (!loaded) loaded = (async () => {
    const [ov, bs] = await Promise.all([s10Api.getOverview(), booksApi.list('s10')])
    overview.value = ov
    books.value = bs
    month.value = ov.currentMonth || 1
    activeBookId.value = bs.find(b => b.phase === 1)?.id ?? bs[0]?.id ?? null
  })()
  return loaded
}
onMounted(() => { void ensureLoaded() })
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM&co=<期区 1..4> 直落该期区该月的表格态;只有年的链接不动(本屏只认整月)。
// setup 期 books 还没到 —— apply 是异步的:先等 ensureLoaded,再落册落期(与出账链五屏「同步 pick」不同,复查时别按那个口径看)。
// 期区**直写 activeBookId,不经 selectBook** —— selectBook 在表格态末行 goGate 把人推回矩阵(spec §9 P0b 破坏验证 / §12);
// 旧链(收入核对「去改附表10」、分析层 5 处)仍走 ?phase=,co 缺席时用它兜底;?tenant= 照旧定位高亮。
// 册先于 year 落定:ensureLoaded 那一拍 year 仍是 null,loadMonthBook 早退不取模板;之后 activeBookId / month / year 同一拍连写,templateAt 只按目标册取一次。
// 本屏草稿 = dirty 集合;切回时有 → 不切期,只在 deepNote 里说。必须在下面的 onReactivated 之前调用:先改期,后重读。
async function applyDeep(t: DeepPeriod) {
  if (t.month == null) return
  await ensureLoaded()
  const ph = typeof t.co === 'number' ? t.co : Number(route.query.phase)
  const b = books.value.find(x => x.phase === ph)
  // 链接指名的期区不存在(co=2 而库里只有 1 / 3 期册):不落错册 —— 停在原地;co 缺席、旧 ?phase= 认不出的仍留在当前册
  if (t.co != null && !b) return
  if (b) activeBookId.value = b.id
  await pickCell(t.year, t.month)
  focusTenant.value = typeof route.query.tenant === 'string' ? route.query.tenant : ''
}
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: year.value == null ? null : periodOf(year.value, month.value), co: phase.value }),
  apply: (t) => { void applyDeep(t).catch(() => {}) },
  dirty: () => dirty.size,
  // phase 是 `railBook?.phase ?? 1`,恒有值 —— 不写空判(2026-09-06 T3 评审:那一支到不了)
  ctx: () => ({ p: year.value == null ? null : periodOf(year.value, month.value), coName: `${phase.value}期` }),
})
// KeepAlive 切回重读(spec §12):导入中心导完切回来,矩阵与本月不能还是导入前的旧表;有草稿只刷总览(loadMonth 会 dirty.clear())
onReactivated(() => {
  void reloadOverview().catch(() => {})
  if (year.value != null && dirty.size === 0) void loadMonth(year.value).catch(() => {})
})

// ── 编辑态:单元格 / 备注 即时写回本地行（触发表内重算）+ 标脏 ──
function onCell(row: S10RecordDTO, colId: S10ColId, value: number) {
  ;(row as unknown as Record<string, unknown>)[colId] = value
  dirty.add(row.id)
}
function onNoteEdit(row: S10RecordDTO, value: string) {
  row.note = value
  dirty.add(row.id)
}

// 25 物理列全集(office∪factory):后端 save 对缺省键 r2(null)=清零而非"不动",
// 必须无条件全键逐发——只发模板内标准列会把模板外(如 factory 册的 5 个 office 列)
// 或隐藏列的既有值静默清零(审查#9/#17/#26);值取自平铺行,服务端 DTO 带全列不丢。
const PHYS_IDS = [...new Set([...leavesOf('office'), ...leavesOf('factory')].map(l => l.colId as string))]
function toReq(row: S10RecordDTO): S10RecordReq {
  const req: S10RecordReq = {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    phase: phase.value,
    acctMonth: `${year.value}-${String(month.value).padStart(2, '0')}`,
    profile: row.profile,
    note: row.note,
  }
  const bag = req as unknown as Record<string, number>
  const src = row as unknown as Record<string, unknown>
  for (const id of PHYS_IDS) bag[id] = Number(src[id]) || 0
  const def = bookDef.value
  if (def) req.extraFees = extractExtras(src, extraColIds(def, archivedCols.value))   // 自定义列(含隐藏/归档)整包收回
  return req
}

// 退出编辑:有脏行先弹保存确认;无改动直接退出
const saveConfirm = ref(false)
function finishEdit(forced = false) {
  // forced = 锁已经没了(被接管/提权到期/换期)。此刻再弹「要不要保存」只剩一个
  // 无锁写的入口 —— 甲点「保存修改」会整行盖掉接管者正编辑的数据。
  // 脏行仍在内存里,重进编辑态可继续;强制退出这一下必须无条件生效。
  if (forced) { saveConfirm.value = false; edit.value = false; return }
  if (!edit.value) { edit.value = true; return }
  if (dirty.size > 0) { saveConfirm.value = true; return }
  edit.value = false
}

// ── 被接管时的「复制我的改动」:脏行按当前版面的叶子列导 TSV ──
// S10 的编辑是**就地改行**(dirty 只记 id),被踢后 refresh 会拉回服务端旧值 —— 不复制就丢。
function draftAsTsv(): string {
  const TAB = '\t', NL = '\n'
  const leaves = leavesOf(PHASE_LAYOUT[phase.value] ?? 'office')
  const head = ['租户', ...leaves.map(l => l.label)].join(TAB)
  const rows = (monthData.value?.rows ?? []).filter(r => dirty.has(r.id))
  const body = rows.map(r => {
    const rec = r as unknown as Record<string, unknown>
    return [String(rec.tenantName ?? ''), ...leaves.map(l => {
      const v = rec[l.colId as string]
      return v == null ? '' : String(v)
    })].join(TAB)
  })
  return [head, ...body].join(NL)
}

// 保存修改:脏行逐个 upsert;成功才退出编辑(失败保留编辑态与脏标记,
// 否则浏览态显示未落库的改值、KPI 却是后端旧数,像保存成功了一样——审查#8)
async function onSaveChanges() {
  saveConfirm.value = false
  if (dirty.size === 0 || !monthData.value) { edit.value = false; selectedIds.value = new Set(); return }
  const rows = monthData.value.rows.filter(r => dirty.has(r.id))
  await guard('保存失败', async () => {
    for (const r of rows) await s10Api.saveRecord(toReq(r))
    await refresh()
    edit.value = false
    selectedIds.value = new Set()
  })
}

// 放弃修改:重载丢弃本地改动 + 退出
async function onDiscardChanges() {
  saveConfirm.value = false
  edit.value = false
  selectedIds.value = new Set()
  if (year.value != null) await loadMonth(year.value)
}

// 新增租户:POST（tenantId 空、source 后端定 manual）
async function onCreate(name: string, profile: string) {
  if (year.value == null) return
  const acctMonth = `${year.value}-${String(month.value).padStart(2, '0')}`
  await guard('新增租户失败', async () => {
    await s10Api.saveRecord({ tenantId: null, tenantName: name, phase: phase.value, acctMonth, profile })
    drawer.value = false
    // ⚠ 不再裸置 edit = true：那会在没占锁的情况下把人送进编辑态。
    //   新增租户这条路只有编辑态里才走得到（按钮收在编辑态），所以这里本就该已经是 true；
    //   保险起见不动它，由用户自己点「编辑模式」——权限与锁在那道门上一次说清。
    await refresh()
  })
}

const onDelete = (row: S10RecordDTO) => guard('删除失败', async () => {   // seed 行 → 409
  await s10Api.deleteRecord(row.id)
  await refresh()
})

const onExport = () => guard('导出失败', async () => {
  if (!monthData.value) return
  await exportS10Month(monthData.value, '附表10 · 销售收入', bookDef.value)
})

// 编辑态 ⋯ 溢出菜单分发(账册模板/导出)
function onMoreSelect(key: string) {
  if (key === 'tpl') openTpl()
  else if (key === 'export') void onExport()
}

// ── 模板编辑(§3):两态常驻「账册模板」入口(浏览态主行/编辑态⋯,同台账口径),
//    当前左轨选中的那一册;写权限由第16权限点 book-template:edit 门内控(canEdit 传面板) ──
const tplOpen = ref(false)
const tplVersions = ref<TemplateVersion[]>([])
const tplSaving = ref(false)
async function loadVersions(bookId: number) {
  // year 来自 useSchedScreen,可能为 null;传不出年月时后端退回链尾标 current,不影响功能
  tplVersions.value = (await booksApi.versions(bookId, year.value ?? undefined, month.value)).versions
}
function openTpl() {
  const b = activeBook.value
  if (!b) return
  tplOpen.value = true
  tplVersions.value = []
  void guard('加载模板版本失败', () => loadVersions(b.id))
}
function applyBook(b: Book) {
  monthBook.value = b   // 本月生效的那一版 → 版面即时重算
  // 册清单里的行恒是链尾版(整表导入词典按它取):保存产出的新版即链尾,顺手换上;钉旧版只抬 latestVer
  books.value = books.value.map(x => x.id !== b.id ? x
    : (b.ver === b.latestVer ? b : { ...x, latestVer: Math.max(x.latestVer, b.latestVer) }))
}
async function onTplSave(def: BookDef, note: string) {
  const b = activeBook.value
  const y = year.value
  if (!b || y == null) return
  tplSaving.value = true
  await guard('保存模板失败', async () => {
    const res = await booksApi.saveTemplate(b.id, def, y, month.value, note || undefined)
    applyBook(res.book)
    await loadVersions(b.id)
    tplOpen.value = false
    await loadMonth(y)     // 归档列/合计按新版重算
  })
  tplSaving.value = false
}
// P7 选择器:只钉本月(不造版本);该月已录入后端 409(P6 冻结,面板那边已置灰,这里兜底提示)
async function onTplPin(ver: number) {
  const b = activeBook.value
  const y = year.value
  if (!b || y == null) return
  await guard('切换模板版本失败', async () => {
    const nb = await booksApi.pin(b.id, ver, y, month.value)
    applyBook(nb)          // 编辑器草稿随 book 变化自动重拷
    await loadMonth(y)
  })
}

// ── 智能整表导入 Excel:词典 = 四册现行版模板(§4,office=1∪4/factory=2∪3 并集在 registry) ──
const importSummary = ref('')   // 各段年月期·导入/跳过/错误 文本
const bookDefs = computed<Partial<Record<number, BookDef>>>(() => {
  const m: Partial<Record<number, BookDef>> = {}
  for (const b of books.value) if (b.phase != null) m[b.phase] = b.definition
  return m
})

const ZH_PHASE: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期', 4: '宿舍' }

// 经 runImport(共享 registry 逐段 upsert + 记录 import_log),重建每段摘要,跳转第一段槽
// emit 签名的 year/month/phase 为可选并集(兼容纯标签段);s10 走 phaseLayouts 智能整表,段必带年/月/期
async function onSmartImport(
  picks: { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }[],
  fileName: string,
) {
  importing.value = false
  await guard('导入失败', async () => {
    importResult.value = await runImport('s10', picks, { bookDefs: bookDefs.value }, fileName)
    importSummary.value = picks
      .map(p => `${p.year}年${p.month}月·${ZH_PHASE[p.phase!]}:${p.records.length} 条`)
      .join('\n')
    const first = picks[0]
    if (first) {
      const b = books.value.find(x => x.phase === first.phase)
      if (b) activeBookId.value = b.id
      year.value = first.year!
      month.value = first.month!
      await reloadOverview()
      await loadMonth(first.year!)
    }
    ensureTenantsLoaded()
    if ((monthData.value?.rows ?? []).some(r => r.tenantId == null)) issuesOpen.value = true
  })
}

// ── 未绑定问题抽屉(V105):附表10 与台账同一套语义 ─────────────
const auth = useAuthStore()
const router = useRouter()
const tabs = useTabsStore()
const issuesOpen = ref(false)
const allTenants = ref<TenantDTO[]>([])
// KeepAlive 停用时关掉 Teleport 浮层(绑定弹窗/问题抽屉/模板编辑器),防浮到别的页签(审计 VUE-03 范式)
onDeactivated(() => {
  bindRowId.value = null; issuesOpen.value = false; tplOpen.value = false
  drawer.value = false; importing.value = false   // Teleport 到 body 的弹层不随页签 DOM 摘除(审查#16)
})
let tenantsInflight: Promise<void> | null = null
function ensureTenantsLoaded() {
  if (tenantsInflight) return   // in-flight 去重(评审E3)
  tenantsInflight = tenantApi.list()
    .then(v => { allTenants.value = v })
    .catch(() => {})
    .finally(() => { tenantsInflight = null })
}

const ZH_PHASE_ISSUE: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期', 4: '宿舍' }
// 行合计口径 = rowTotal 同一函数(评审R2:并存两份迟早分叉)
const issueGroups = computed<IssueGroup[]>(() => groupUnbound(
  monthData.value?.rows ?? [],
  r => rowTotal(r),
  `${year.value}年${month.value}月 · ${ZH_PHASE_ISSUE[phase.value]}`,
))
const issueCount = computed(() => issueGroups.value.reduce((n, g) => n + g.count, 0))

// 绑定 = 立即写库;编辑态不整页 refresh(会冲掉 dirty 改动),就地补 tenantId
async function onBindIssue(name: string, tenantId: number) {
  await guard('绑定失败', async () => {
    await s10Api.bindTenant(name, tenantId)
    if (edit.value && dirty.size > 0) {
      for (const r of monthData.value?.rows ?? [])
        if (r.tenantId == null && r.tenantName === name) r.tenantId = tenantId
    } else if (year.value != null) {
      await loadMonth(year.value)
    }
  })
}

function gotoTenants() {
  issuesOpen.value = false
  tabs.open('tenants')
  router.push('/tenants')
}

// ── 行级绑定弹窗(抄表「表档案·租户」同款:点开一条,绑/解/换) ──
const bindRowId = ref<number | null>(null)
const bindRowTarget = computed(() =>
  bindRowId.value == null ? null : (monthData.value?.rows.find(r => r.id === bindRowId.value) ?? null))
const bindOptions = computed(() => toBindOptions(allTenants.value))
function openBindRow(r: S10RecordDTO) {
  bindRowId.value = r.id
  ensureTenantsLoaded()
}
async function onBindRowCommit(id: number, tenantId: number | null) {
  await guard('绑定失败', async () => {
    const updated = await s10Api.bindRow(id, tenantId)
    // 就地更新该行(不整页 refresh:编辑态 dirty 改动不能被冲掉)
    const row = monthData.value?.rows.find(r => r.id === id)
    if (row) row.tenantId = updated.tenantId
  })
}
async function onRenameRowCommit(id: number, tenantName: string) {
  await guard('改名失败', async () => {
    const updated = await s10Api.renameRow(id, tenantName)
    const row = monthData.value?.rows.find(r => r.id === id)
    if (row) { row.tenantName = updated.tenantName; row.tenantId = updated.tenantId }
  })
}

// ── 行合计(问题面板挂账金额用;KPI 卡整排已取消 2026-08-24,合计看表内 footer)──
// 浏览态信后端派生(total 已含口袋);编辑态本地即时算,口径=模板全列含隐藏(含 c_ 列)。
const localRowTotal = (r: S10RecordDTO) => {
  const bag = r as unknown as Record<string, unknown>
  return allColIds.value.reduce((a, id) => a + (Number(bag[id]) || 0), 0)
}
const rowTotal = (r: S10RecordDTO) => (edit.value ? localRowTotal(r) : Number(r.total) || 0)
const tenantCount = computed(() => monthData.value?.rows.length ?? 0)

// 导入入口按 §5 移进 #edit-actions 首位(SchedHeader 自带导入按钮排在槽后,顺序不合规,不用);
// 脏草稿确认沿用 SchedHeader.onImport 同款文案 —— 导入落库后重拉数据会静默冲掉草稿。
function onImportClick() {
  if (dirty.size > 0 &&
      !window.confirm(`当前有 ${dirty.size} 处修改尚未保存。\n导入会重新载入本期数据,这些修改将丢失。\n\n仍要导入?`)) return
  importing.value = true
}
</script>

<template>
  <!-- PAGE-BEHAVIOR-SPEC §1 加载门:overview/books 到达前显转圈,不闪空态 -->
  <template v-if="overview">
    <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5.3/§5.6 迁移(左轨收 chips、宽表 S 档单 sticky、
         矩阵横滚圈在 .s10-matrix 内),摘掉 base.css 的 M↓ 屏级地板——表内自滚,屏根不再触发双重横滚 -->
    <div class="s10-wb fp-fluid">
      <!-- 左轨:本屏四册(期区),入口常驻(§7-3) -->
      <aside class="s10-rail">
        <div class="s10-rail-cap">账册</div>
        <!-- 附表10 四册固定:公司管理入口(company:manage)恒关,不接 create/remove -->
        <BookRail :books="books" :active-id="activeBookId" :can-manage="false" @select="(id) => selectBook(Number(id))" />
      </aside>

      <!-- ≤960 左轨收成顶部横向 chips(§5.6):选择语义与轨内点击同源 selectBook(含编辑态脏确认);
           ≥961 隐藏、桌面零变化。四册固定,无新增/删除入口(can-manage 本就恒关) -->
      <div ref="chipsEl" class="s10-chips">
        <button v-for="b in books" :key="b.id" class="s10-chip" :class="{ on: b.id === activeBookId }"
                @click="selectBook(b.id)">{{ b.name }}</button>
      </div>

      <div class="s10-main">
        <!-- ⓪ 矩阵态(选期矩阵 v3):全年份纵排 12 月卡,必点月卡进宽表 -->
        <template v-if="year === null">
          <div class="s10-gate">
            <div class="s10-gate-head">
              <div>
                <h2 class="s10-gate-title"><component :is="iconFor('coins')" :size="20" />附表10 · 销售收入</h2>
                <p class="s10-gate-sub">逐月、按期 / 宿舍汇总的租户总收款 · 左侧切换账册,点击月份卡进入宽表(空月卡可进入录入)</p>
              </div>
              <div v-if="activeBook" class="s10-gate-book">
                <span class="s10-gate-bookname">{{ activeBook.name }}</span>
                <span class="s10-gate-ver">v{{ activeBook.ver }}</span>
              </div>
            </div>
            <!-- 矩阵 12 月卡窄档装不下:横滚圈在矩阵块内(照台账 .lgw-matrix 范式),
                 账册头/主区其余内容不跟着滚 -->
            <div class="s10-matrix">
              <BookMonthMatrix
                :book="activeBook"
                :years="matrixYears"
                @pick="pickCell"
                @add-earlier="onAddEarlier"
                @add-later="onAddLater"
                @remove-year="onRemoveYear"
              />
            </div>
          </div>
        </template>

        <!-- ① 表格态 -->
        <template v-else-if="monthData">
          <div class="s10-page">
            <SchedHeader
              :scope="S.s10(phase, year, month)"
              :review-key="`s10:${phase}:${year}-${String(month).padStart(2, '0')}`"
              icon="coins"
              title="附表10 · 销售收入"
              sub="逐月、按期 / 宿舍汇总的租户总收款 · 一行一租户,列为各收款项目 · 金额单位 元"
              :year="year"
              :edit="edit"
              perm="entry:edit"
              :dirty="dirty.size"
              :copy-text="draftAsTsv"
              @back="goGate"
              @toggle-edit="finishEdit">
              <!-- 工具条 §5 五段定序:录入(导入>批量>单行添加) | 配置 | ⋯溢出 | 主控恒右。
                   导入用自绘按钮抢首位(SchedHeader 自带的排槽后),脏确认在 onImportClick。 -->
              <template #edit-actions>
                <Button variant="outline" size="sm" @click="onImportClick">
                  <template #leading><component :is="iconFor('upload')" :size="14" /></template>
                  导入 Excel
                </Button>
                <Button v-if="importedCount > 0" variant="outline" size="sm" @click="onClearImported">
                  <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
                  清空本期导入 ({{ importedCount }})
                </Button>
                <Button v-if="selectedIds.size > 0" variant="danger" size="sm" @click="onBatchDelete">
                  <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
                  删除选中 ({{ selectedIds.size }})
                </Button>
                <Button variant="outline" size="sm" @click="drawer = true">
                  <template #leading><component :is="iconFor('plus')" :size="14" /></template>
                  新增租户
                </Button>
                <span class="s10-tbsep" aria-hidden="true" />
                <!-- 编辑态降级不消失(§5-3):账册模板/导出收进 ⋯ -->
                <FPMoreMenu :items="[
                  { key: 'tpl', label: '账册模板', icon: 'sliders-horizontal' },
                  { key: 'export', label: '导出', icon: 'download' },
                ]" @select="onMoreSelect" />
              </template>
              <template #static-actions>
                <!-- 账册模板两态常驻(同台账口径):浏览态主行,编辑态收进上面的 ⋯ -->
                <Button v-if="!edit" variant="outline" size="sm" @click="openTpl">
                  <template #leading><component :is="iconFor('sliders-horizontal')" :size="14" /></template>
                  账册模板
                </Button>
                <Button v-if="!edit" variant="outline" size="sm" @click="onExport">
                  <template #leading><component :is="iconFor('download')" :size="14" /></template>
                  导出
                </Button>
              </template>
            </SchedHeader>

            <!-- 期区条:账册名·vN + 年月 + 换期(回矩阵,§5) + 户数/修改提示 -->
            <div class="s10-toolbar">
              <div class="s10-period">
                <span class="s10-period-book">
                  {{ activeBook?.name }}
                  <b class="s10-period-ver">v{{ activeBook?.ver }}</b>
                </span>
                <span class="s10-period-ym">{{ year }}年{{ month }}月</span>
                <!-- 导航类编辑态隐藏(§5-2):编辑中换期=丢草稿风险,退出编辑再换 -->
                <Button v-if="!edit" variant="outline" size="sm" @click="goGate">
                  <template #leading><component :is="iconFor('calendar')" :size="14" /></template>
                  换期
                </Button>
              </div>
              <div class="s10-toolbar-r">
                <!-- 常驻入口(0 时置灰;用户反馈「入口找不到」,且随数据出现/消失会挪动工具条) -->
                <button class="s10-issues" :class="{ quiet: issueCount === 0 }"
                        @click="issuesOpen = true; ensureTenantsLoaded()">
                  <component :is="iconFor('alert-triangle')" :size="13" />
                  未绑定 {{ issueCount }}
                </button>
                <span v-if="edit" class="s10-editflag">
                  <component :is="iconFor('pencil')" :size="13" />已修改 <b>{{ dirty.size }}</b> 处
                </span>
                <span v-else class="s10-count">{{ activeBook?.name }} · 本月 <b>{{ tenantCount }}</b> 户</span>
              </div>
            </div>

            <!-- ≤600 重编辑提示(§5.3/§11.2):预留位——行常驻定高,文案仅编辑态显,显隐不挪表格
                 (LAYOUT-STABILITY §2-3;条件挂在行内 span 上,不进流内块门禁)。填报不拦不藏 -->
            <div class="s10-s-hint">
              <span v-if="edit">编辑模式 · 小屏可录入,建议在桌面端操作</span>
            </div>

            <!-- ② 宽表:版面由现行版模板驱动 -->
            <S10Table
              :groups="layoutGroups"
              :sum-ids="allColIds"
              :column-totals="monthData.columnTotals"
              :grand-total="monthData.grandTotal"
              :phase-name="activeBook?.name ?? ''"
              :year="year"
              :month="month"
              :rows="monthData.rows"
              :edit="edit"
              :selected-ids="selectedIds"
              :focus-tenant="focusTenant"
              @focus-done="focusTenant = ''"
              @add="drawer = true"
              @edit="edit = true"
              @delete="onDelete"
              @cell="onCell"
              @note="onNoteEdit"
              @toggle-select="toggleSelect"
              @select-all="selectAll"
              @bind-row="openBindRow"
            />
          </div>

          <S10RecordDrawer
            v-if="drawer"
            :phase-name="activeBook?.name ?? ''"
            :layout="drawerLayout"
            @close="drawer = false"
            @save="onCreate"
          />

          <FpImportModal
            v-if="importing"
            :title="'导入 附表10 · 智能整表'"
            :sub="'上传/粘贴整张多段 Excel,系统按标题行自动拆段、识别年/月/期与版面,核对后逐段导入'"
            v-bind="parserProps('s10', { bookDefs })"
            :default-year="year"
            :default-month="month"
            :default-phase="phase"
            @close="importing = false"
            @import-sections="onSmartImport"
          />

          <SaveConfirmDialog
            v-if="saveConfirm"
            :count="dirty.size"
            @save="onSaveChanges"
            @discard="onDiscardChanges"
            @close="saveConfirm = false"
          />
        </template>

        <!-- 切期/切册过渡兜底转圈 -->
        <div v-else class="page-loading"><span class="page-spin" /></div>
      </div>
    </div>

    <ImportResultToast v-if="importResult" :result="importResult" :summary="importSummary" @close="importResult = null; importSummary = ''" />
    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />

    <!-- 行级绑定弹窗(点行名/未绑定标签打开) -->
    <S10BindDrawer
      :row="bindRowTarget"
      :slot-label="`${year}年${month}月 · ${ZH_PHASE_ISSUE[phase]}`"
      :tenants="bindOptions"
      :can-bind="edit && auth.can('entry:edit')"
      :on-bind="onBindRowCommit"
      :on-rename="onRenameRowCommit"
      @close="bindRowId = null"
    />

    <!-- 未绑定租户问题抽屉(V105) -->
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

    <!-- 模板编辑器(表格态入口,当前左轨选中的那一册的**本月**那版;编辑走 book-template:edit、
         换版走第17点 book-template:switch;本月已录入 → 模板定稿,面板置灰) -->
    <TemplateEditorPanel
      :open="tplOpen"
      :book="activeBook"
      :versions="tplVersions"
      :saving="tplSaving"
      :can-edit="auth.can('book-template:edit')"
      :can-switch="auth.can('book-template:switch')"
      :month-has-data="monthData?.recorded === true"
      :year="year"
      :month="month"
      @save="onTplSave"
      @pin="onTplPin"
      @close="tplOpen = false"
    />
  </template>

  <!-- 首载转圈也挂 fp-fluid:它是屏根 Fragment 的另一形态首元素,不摘会让 390 视口为一个居中转圈横滚 -->
  <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>
</template>

<style scoped>
/* 账册工作台外框:左轨 + 主区(BOOK-WORKBENCH-SPEC §5 版式) */
.s10-wb { display:flex; gap:14px; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.s10-rail { flex:0 0 200px; min-height:0; display:flex; flex-direction:column; gap:8px; padding:12px 10px; background:var(--surface-card); border-radius:var(--radius-lg); }
.s10-rail-cap { flex:0 0 auto; font-size:11px; font-weight:var(--fw-semibold); color:var(--text-muted); letter-spacing:.05em; padding:0 6px; }
.s10-main { flex:1 1 auto; min-width:0; min-height:0; display:flex; flex-direction:column; }

/* 矩阵态(选期门) */
.s10-gate { display:flex; flex-direction:column; gap:16px; min-height:0; overflow:auto; padding:4px 2px; }
.s10-gate-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.s10-gate-title { margin:0; font-size:20px; font-weight:var(--fw-semibold); color:var(--text-primary); display:flex; align-items:center; gap:10px; }
.s10-gate-sub { margin:4px 0 0; font-size:12px; color:var(--text-muted); }
.s10-gate-book { display:inline-flex; align-items:center; gap:8px; height:32px; padding:0 14px; border-radius:var(--radius-full); background:var(--accent-blue); }
.s10-gate-bookname { font-size:14px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.s10-gate-ver { font-family:var(--font-mono); font-size:11px; font-weight:var(--fw-semibold); color:var(--hue-blue); background:var(--surface-white); border-radius:var(--radius-full); padding:1px 8px; }

/* 1:1 from screen-schedule10.jsx S10Styles(.s10-page / .s10-kpis / .s10-toolbar 段) */
.s10-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }

/* 工具条分隔符(§5:录入区|配置区|溢出区 之间的断档) */
.s10-tbsep { flex:none; width:1px; height:18px; background:var(--border-subtle); }

/* 工具栏 — 固定高度,编辑/只读切换不改布局 */
.s10-toolbar { flex:0 0 auto; min-height:30px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.s10-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
/* 期区条:账册·版本 + 年月 + 换期 */
.s10-period { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.s10-period-book { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.s10-period-ver { font-family:var(--font-mono); font-size:11px; font-weight:var(--fw-semibold); color:var(--hue-blue); background:var(--accent-blue); border-radius:var(--radius-full); padding:1px 8px; }
.s10-period-ym { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); }
.s10-count { font-size:12px; color:var(--text-muted); }
.s10-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }
.s10-editflag { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--hue-orange); background:rgb(255,243,230); padding:5px 11px; border-radius:var(--radius-full); }
.s10-issues {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px; border-radius: var(--radius-full);
  border: 1px solid var(--status-warning); background: transparent;
  color: var(--status-warning); font-size: 12px; font-weight: var(--fw-medium);
  cursor: pointer; white-space: nowrap;
}
.s10-issues:hover { background: var(--bg-hover); }
.s10-issues.quiet { border-color: var(--border-subtle); color: var(--text-muted); }
.s10-editflag b { font-family:var(--font-mono); margin:0 2px; }

/* 矩阵块:桌面无横滚(占位类,窄档媒体块内加 overflow) */
.s10-matrix { flex:0 0 auto; }
/* 顶部 chips 与 S 档提示行:桌面档不存在(display:none),窄档媒体块内再显——宽档规则在前 */
.s10-chips { display:none; }
.s10-s-hint { display:none; }

/* ── M/S 档(≤960):左轨收成顶部横向 chips(RESPONSIVE-LAYOUT-SPEC §5.6,照台账屏范式) ── */
@media (max-width: 960px) {
  .s10-wb { flex-direction:column; gap:12px; }
  .s10-rail { display:none; }
  .s10-chips { flex:0 0 auto; display:flex; gap:8px; overflow-x:auto; padding:2px; }
  .s10-chip {
    flex:0 0 auto; display:inline-flex; align-items:center;
    height:36px; padding:0 14px; border-radius:var(--radius-full);
    border:1px solid var(--border-subtle); background:var(--surface-white);
    color:var(--text-secondary); font-family:var(--font-sans);
    font-size:var(--fs-label); font-weight:var(--fw-medium);
    cursor:pointer; white-space:nowrap;
  }
  /* 选中态只换色不改尺寸(布局稳定铁律,同 BookRail .br-item.on 语义) */
  .s10-chip.on { border-color:var(--hue-blue); background:var(--accent-blue); color:var(--text-primary); }
  /* 矩阵 12 月卡窄档装不下:横滚圈在矩阵块内,账册头不跟着滚 */
  .s10-matrix { overflow-x:auto; }
}

/* ── S 档(≤600):填报不拦不藏,常驻预留提示行(§5.3/§11.2;LAYOUT-STABILITY §2-3 预留位) ── */
@media (max-width: 600px) {
  .s10-s-hint { display:flex; align-items:center; flex:0 0 20px; height:20px; font-size:12px; color:var(--hue-orange); }
}
</style>
