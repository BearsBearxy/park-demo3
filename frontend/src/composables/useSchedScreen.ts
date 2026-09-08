// 6 个附表屏(附表6 光伏 / 7·8 充电桩 / 10 销售收入 / 11 电费 / 12 工资 / 13·14 水电)
// 共用的年度台账状态机。抽取自 6 屏逐字相同的那部分:
//   year/edit/drawer/importing/importResult/selectedIds 六个 ref、
//   勾选三件套(toggleSelect / selectAll / onBatchDelete)、清空本期导入、进出年份门、
//   以及「后端 message 优先、否则兜底文案」的 alert 报错口径。
// 各屏差异一律留成参数(子筛选重置、全选口径、可勾选门、批删/清空 API、清空文案、切槽是否保留勾选)——
// 抽取的前提是行为零变化,哪怕只有一屏不一样也留钩子,不为了「统一」把某屏改成别人的样子。
import { ref, computed, watch } from 'vue'
import type { ImportResultDTO } from '@/types/import'
import { useReviewStore } from '@/stores/review'
import { rowLocked } from '@/components/sched/reviewLock'

/** 台账行的共同形状:id 用于勾选/批删,source 用于「本期导入」计数,acctMonth 用于按月上锁(D18) */
export interface SchedRow {
  id: number
  source: 'seed' | 'manual' | 'import'
  acctMonth?: string
}

/** 标准「清空本期导入」确认流程:无导入行先提示,有则二次确认。unit = 本年 / 本月 / 本期。
 *  附表11 例外(无空行守卫 + 固定文案),自己传 confirm。 */
export function clearConfirm(unit: string, note: string) {
  return (n: number): boolean => {
    if (n === 0) { alert(`${unit}没有导入的行。`); return false }
    return confirm(`确认清空${unit} ${n} 条导入数据?${note}`)
  }
}

export function useSchedScreen<R extends SchedRow>(opts: {
  /** 载入某年的明细(月 / 期 / 类型等子状态由各屏自己的 ref 决定) */
  load: (y: number) => Promise<unknown>
  /** 重取 overview(年份卡片数据) */
  reloadOverview: () => Promise<unknown>
  /** 当前槽的全部行:importedCount 与默认全选口径都取它 */
  rows: () => R[]
  /** 清空本屏明细 ref(pickYear / goGate 共用) */
  clearData: () => void
  /** 批量删除 API(各屏签名不同:附表7/8 带附表号) */
  batchDelete: (ids: number[]) => Promise<unknown>
  /** 清空本期导入:call = API,confirm = 确认流程(标准口径用 clearConfirm 生成) */
  clear: { call: (y: number) => Promise<unknown>; confirm: (n: number) => boolean }
  /** 进年时同步重置的子筛选(期 / 运营商 / 费用类型 / 月份);在 load 之前执行 */
  onPickYear?: (y: number) => void
  /** 「全选」口径:附表6 按期、附表7/8 按运营商、附表10 排除 seed 行;省略 = 全部行 */
  selectAllFilter?: (row: R) => boolean
  /** 单行可否勾选:仅附表10 挡 seed 行,其余屏原本无此门,不能加 */
  canSelect?: (row: R) => boolean
  /** 切年 / 回门保留已勾选:仅附表10 原本不清,保持原状 */
  keepSelectionOnNav?: boolean
  /**
   * 年表屏按月份行上锁(SIDEBAR-UX-REDESIGN §7.1 D18):本屏管的审核 kind。
   *
   * 只有**年表屏**传(附表6 / 7·8 / 11 / 13·14)—— 它们一屏 12 个月的行,闸不能长在页头
   * 那颗编辑按钮上,否则会连没审的月一起锁死。附表10 / 12 是单月屏,闸在 SchedHeader 上,
   * 不传这个。附表7/8 一屏两个 kind,所以是数组。
   */
  reviewKinds?: string[]
  /** kind 的 scope 维。只有附13/14 用得上(office / phase3),跟着 tab 变所以传函数。 */
  reviewScope?: () => string | null
}) {
  const year = ref<number | null>(null)   // null → ⓪ 年份选择层
  const edit = ref(false)
  const drawer = ref(false)
  const importing = ref(false)
  const importResult = ref<ImportResultDTO | null>(null)
  const selectedIds = ref<Set<number>>(new Set())

  // ⚠ 换年一律清勾选(收口复查:四屏的 onCreate 存到别的年会静默跳年而不清 ——
  //   残留的 id 会喂给「删除选中」批删**另一年**看不见的行,后端按 id 裸删不校年份)。
  //   守在 year 这一处 = 现在和将来的所有跳年路径一次到位;
  //   附表10 的 keepSelectionOnNav 是故意跨年保留,照旧尊重。
  watch(year, () => { if (!opts.keepSelectionOnNav) selectedIds.value = new Set() })
  // ⚠ 编辑态转假(被接管/提权到期/换期)关掉写浮层 —— 抽屉/导入窗的 v-if 只判自己的 ref,
  //   失锁后「保存」「导入」照样落库(后端写口不校验锁)。附表12 修过的这一课,
  //   下沉到这里让附表族全体屏一次吃上。
  watch(edit, v => { if (!v) { drawer.value = false; importing.value = false } })

  // ── 审核闸:按月份行上锁(D18) ───────────────────────────
  // 取数走闸道(GET /api/review/states?year=,不跑首页聚合)—— 一屏一年一趟。
  const review = useReviewStore()
  watch(year, (y) => { if (opts.reviewKinds && y != null) void review.ensureYear(y) }, { immediate: true })

  /** 这一年里锁着的月份号。不是年表屏(没传 reviewKinds)时:上面那条 watch 根本不取数,
   *  byYear 里没有这一年,这里自然回空集 —— 不必再加一层三元(加了是杀不掉的冗余分支)。 */
  const lockedMonths = computed(() =>
    review.lockedMonths(year.value, opts.reviewKinds ?? [], opts.reviewScope?.() ?? null))

  /** 这一行在不在锁月里。勾选与批删两处都要问 —— 只把复选框画成 disabled 拦不住批删。 */
  const isRowLocked = (row: R) => rowLocked(lockedMonths.value, row.acctMonth)

  /**
   * 整年动作簇作用的那一串**按月**的键(2026-09-08 拍板「一颗按钮管整年,键仍按月」)。
   *
   * 年表屏一屏一整年、12 行同时摆着,没有「当前月」这一维 —— 所以给动作簇的不是一把键而是一串,
   * 一颗「交审 2025 年（3 个月）」把这一年够格的月一次交出去。**数据模型一个字没动**:
   * 键仍是 `kind[:scope]:YYYY-MM`,本月出账清单、D20 月度锁账、上面那条按月份行上锁全不受影响
   * (字面的「年键」方案被否掉了:6 月出账要求 6 月全部表已审,附表6 若变年键就永远等不到它)。
   *
   * 只筛一条:**屏上这个月真的有行**。不筛的话空年会把 12 个月全发出去,而 store.batch 是
   * 逐把写、碰到第一个失败就停 —— 人看到的是「1 月还没录完」,他明明想交的是 6 月。
   * ⚠ 这**不是**在前端重算后端的 isDone,「前端不预判录完没有」那条裁定仍然成立:
   *   这里滤掉的只是「屏上压根没有这个月」这种显然不是候选的,够不够格仍由后端 409 裁定。
   *
   * **审核态不在这里筛**。筛了的话审核员那三颗按钮就永远出不来 —— 先滤成 entered|returned,
   * 「通过」要的 submitted 早被扔了。态的分组在动作簇里一份(toSubmit/toApprove/toWithdraw),
   * 判据只此一处(铁律 5)。
   *
   * 多 scope 的屏(附13/14 office/phase3)天然只算当前那一份:rows() 取的就是当前 tab 那一趟
   * 拉回来的数据,reviewScope 闭包也跟着 tab 变 —— 与全站「动作只作用于此刻看得见的那一把」一致。
   *
   * null = 不是年表屏(没传 reviewKinds)或还在年份门上;`[]` = 这一年一行都没有。两者动作簇都不画。
   */
  const reviewKeys = computed<string[] | null>(() => {
    const kinds = opts.reviewKinds
    const y = year.value
    if (!kinds?.length || y == null) return null
    const scope = opts.reviewScope?.() ?? null
    // 只认本年的行:跨年的行会拼出一把指向**没取过的那一年**的键,而动作簇的 ready 要求
    // 每把键所在的年都已到手 —— 一把野键就让整簇静默消失。
    const pre = `${y}-`
    const months = [...new Set(
      opts.rows().map(r => r.acctMonth).filter((m): m is string => !!m && m.startsWith(pre)),
    )].sort()
    return months.flatMap(m => kinds.map(k => (scope ? `${k}:${scope}:${m}` : `${k}:${m}`)))
  })

  /** 统一报错口径:后端 message 优先,否则用兜底文案 */
  async function guard(fallback: string, fn: () => Promise<void>) {
    try {
      await fn()
    } catch (e) {
      alert((e as { message?: string })?.message ?? fallback)
    }
  }

  // 新增 / 删除 / 改备注 / 导入后重载当前槽 + overview
  async function refresh() {
    if (year.value != null) await opts.load(year.value)
    await opts.reloadOverview()
  }

  function clearSelection() {
    if (!opts.keepSelectionOnNav) selectedIds.value = new Set()
  }

  // ── 状态迁移 ─────────────────────────────────────────────
  async function pickYear(y: number) {
    year.value = y
    edit.value = false
    opts.onPickYear?.(y)
    opts.clearData()
    clearSelection()
    await opts.load(y)
  }
  function goGate() {
    year.value = null
    edit.value = false
    opts.clearData()
    clearSelection()
  }

  // ── 批量删除(编辑态复选框) ──────────────────────────────
  function toggleSelect(row: R) {
    // 已审核 / 待审核的月不许进选中集 —— 复选框那边虽然也画成了 disabled,但「删除选中」
    // 读的是这个集合,只画不拦等于把闸做成了纯装饰。
    if (isRowLocked(row)) return
    if (opts.canSelect && !opts.canSelect(row)) return
    const next = new Set(selectedIds.value)
    if (next.has(row.id)) next.delete(row.id); else next.add(row.id)
    selectedIds.value = next
  }
  function selectAll(checked: boolean) {
    const all = opts.selectAllFilter ? opts.rows().filter(opts.selectAllFilter) : opts.rows()
    // 「全选」也要跳过锁月 —— 否则一键就把闸绕过去了,而且那是**批量**删除。
    const scope = all.filter(r => !isRowLocked(r))
    selectedIds.value = checked ? new Set(scope.map(r => r.id)) : new Set()
  }
  async function onBatchDelete() {
    const ids = [...selectedIds.value]
    if (!ids.length) return
    await guard('删除失败', async () => {
      // 写口自守(6 屏一次到位):edit 会被 SchedHeader 就地翻假(被接管/提权到期),
      // 而「删除选中」按钮的 v-if 到下一拍才收 —— 这一拍点下去就是浏览态批删
      if (!edit.value) return
      await opts.batchDelete(ids)
      selectedIds.value = new Set()
      await refresh()
    })
  }

  // ── 清空本期导入 ─────────────────────────────────────────
  const importedCount = computed(() => opts.rows().filter(r => r.source === 'import').length)
  async function onClearImported() {
    if (!edit.value) return
    if (year.value == null) return
    if (!opts.clear.confirm(importedCount.value)) return
    const y = year.value
    await guard('清空失败', async () => {
      await opts.clear.call(y)
      selectedIds.value = new Set()
      await refresh()
    })
  }

  return {
    // ⚠ 少写一个名字不报错 —— setup 风格的返回表漏项,消费方拿到的是 undefined,一用才 TypeError。
    //   本仓漏过(stores/review.ts 的 statusOf 头注记着同一课)。加 computed 就把名字加进来。
    year, edit, drawer, importing, importResult, selectedIds, importedCount, lockedMonths, reviewKeys,
    guard, refresh, pickYear, goGate,
    toggleSelect, selectAll, onBatchDelete, onClearImported,
  }
}
