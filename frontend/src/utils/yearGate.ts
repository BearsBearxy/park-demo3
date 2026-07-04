// 年份门卡片派生:台账/三大报表共用(接 ledgerApi.years / reportApi.years)。
// 数据年 ∪ 当前自然年,连续补齐成年份区间(与附表 overview 的 lo..hi 口径一致);
// 区间外的更早/未来年由 SchedYearGate 的「新增年份」(localStorage 受管年)承担。
import type { YearCard } from '@/components/sched/SchedYearGate.vue'
import type { YearMonthsDTO } from '@/types/ledger'

export function yearCardsOf(years: YearMonthsDTO[] | null, label: string): YearCard[] {
  const byYear = new Map((years ?? []).map(y => [y.year, y.months]))
  const ys = [...byYear.keys(), new Date().getFullYear()]
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const cards: YearCard[] = []
  for (let y = lo; y <= hi; y++) {
    const m = byYear.get(y) ?? 0
    cards.push({ year: y, hasData: m > 0, metric: `${m} 个月`, label })
  }
  return cards
}

// 「最新」年 = 区间最高年(含当前自然年)
export function gateCurrentOf(cards: YearCard[]): number {
  return cards.length ? cards[cards.length - 1].year : new Date().getFullYear()
}
