// 三大报表(is/bs/tb)共用的年份门状态:公司 → 年份门(SchedYearGate) → 月历 → 表格。
// 加载"有数据年份"(单公司直查;全部汇总跨公司按年合并取最大月数)、卡片派生、进出门迁移。
import { ref, computed, type Ref } from 'vue'
import { reportApi } from '@/api/report'
import type { CompanyDTO, YearMonthsDTO } from '@/types/ledger'
import { yearCardsOf, gateCurrentOf } from '@/utils/yearGate'

export function useReportYearGate(opts: {
  stmt: string
  companyId: Ref<number | 'all' | null>
  companies: Ref<CompanyDTO[]>
  year: Ref<number>
  onEnterYear: () => Promise<void> | void   // 选定年份后由视图加载该年月历
}) {
  const yearGated = ref(false)
  const gateYears = ref<YearMonthsDTO[] | null>(null)   // null = 加载中(§6 加载门)
  let req = 0   // 竞态守卫:快速切公司时丢弃过期响应
  async function loadGateYears() {
    if (opts.companyId.value == null) return
    const reqId = ++req
    const lists = opts.companyId.value === 'all'
      ? await Promise.all(opts.companies.value.map(c => reportApi.years(opts.stmt, c.id)))
      : [await reportApi.years(opts.stmt, opts.companyId.value as number)]
    if (reqId !== req) return
    const merged = new Map<number, number>()
    for (const l of lists) for (const y of l) merged.set(y.year, Math.max(merged.get(y.year) ?? 0, y.months))
    gateYears.value = [...merged.entries()].map(([year, months]) => ({ year, months }))
      .sort((a, b) => a.year - b.year)
  }
  const yearCards = computed(() => yearCardsOf(gateYears.value, '已录入月份'))
  const gateCurrent = computed(() => gateCurrentOf(yearCards.value))
  function resetGate() { yearGated.value = false; gateYears.value = null }
  async function pickYear(y: number) {
    opts.year.value = y; yearGated.value = true
    await opts.onEnterYear()
  }
  function backToYearGate() {
    yearGated.value = false
    loadGateYears()   // 回门时刷新月份计数(可能刚保存/导入过)
  }
  return { yearGated, gateYears, yearCards, gateCurrent, loadGateYears, resetGate, pickYear, backToYearGate }
}
