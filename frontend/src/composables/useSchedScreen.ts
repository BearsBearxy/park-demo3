// 6 个附表屏(附表6 光伏 / 7·8 充电桩 / 10 销售收入 / 11 电费 / 12 工资 / 13·14 水电)
// 共用的年度台账状态机。抽取自 6 屏逐字相同的那部分:
//   year/edit/drawer/importing/importResult/selectedIds 六个 ref、
//   勾选三件套(toggleSelect / selectAll / onBatchDelete)、清空本期导入、进出年份门、
//   以及「后端 message 优先、否则兜底文案」的 alert 报错口径。
// 各屏差异一律留成参数(子筛选重置、全选口径、可勾选门、批删/清空 API、清空文案、切槽是否保留勾选)——
// 抽取的前提是行为零变化,哪怕只有一屏不一样也留钩子,不为了「统一」把某屏改成别人的样子。
import { ref, computed } from 'vue'
import type { ImportResultDTO } from '@/types/import'

/** 台账行的共同形状:id 用于勾选/批删,source 用于「本期导入」计数 */
export interface SchedRow {
  id: number
  source: 'seed' | 'manual' | 'import'
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
}) {
  const year = ref<number | null>(null)   // null → ⓪ 年份选择层
  const edit = ref(false)
  const drawer = ref(false)
  const importing = ref(false)
  const importResult = ref<ImportResultDTO | null>(null)
  const selectedIds = ref<Set<number>>(new Set())

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
    if (opts.canSelect && !opts.canSelect(row)) return
    const next = new Set(selectedIds.value)
    if (next.has(row.id)) next.delete(row.id); else next.add(row.id)
    selectedIds.value = next
  }
  function selectAll(checked: boolean) {
    const scope = opts.selectAllFilter ? opts.rows().filter(opts.selectAllFilter) : opts.rows()
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
    year, edit, drawer, importing, importResult, selectedIds, importedCount,
    guard, refresh, pickYear, goGate,
    toggleSelect, selectAll, onBatchDelete, onClearImported,
  }
}
