// 年份门卡片派生:台账/三大报表共用(接 ledgerApi.years / reportApi.years)。
// 数据年 ∪ 当前自然年,连续补齐成年份区间(与附表 overview 的 lo..hi 口径一致);
// 区间外的更早/未来年由 SchedYearGate 的「新增年份」(localStorage 受管年)承担。
import type { YearCard } from '@/components/sched/SchedYearGate.vue'
import type { YearMonthsDTO } from '@/types/ledger'

// 全站年选择器口径:连续区间 [min(数据年, 今年-LOOKBACK) .. max(数据年, 今年+LOOKAHEAD)],补齐中间空缺年。
// 演进:①最初「有数据的年 ∪ 今年」离散集合 → 先有鸡先有蛋死锁(某年没数据就选不中,于是永远录不进去);
//       ②改连续区间但只放宽到 今年±1 → 仍是门,2023 及更早补录不了(用户 2026-07-29 追问);
//       ③现窗口 今年-10..今年+2,恒覆盖档案回溯年(账册最早追到 2023,附表外链更早)与提前开年。
// 数据年在窗口外时按数据年扩(导入了 2015 的历史册就能选到 2015),再由钳位挡住脏数据年(1900/2999)撑爆下拉。
const LOOKBACK = 10, LOOKAHEAD = 2
export function buildYearOptions(
  dataYears: number[],
  today = new Date(),
  opts?: { back?: number; forward?: number },
): number[] {
  const cur = today.getFullYear()
  const back = opts?.back ?? 30, forward = opts?.forward ?? 9
  const lo = Math.max(Math.min(cur - LOOKBACK, ...dataYears), cur - back)
  const hi = Math.min(Math.max(cur + LOOKAHEAD, ...dataYears), cur + forward)
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

export function yearCardsOf(years: YearMonthsDTO[] | null, label: string): YearCard[] {
  const byYear = new Map((years ?? []).map(y => [y.year, y.months]))
  return buildYearOptions([...byYear.keys()]).map(y => {
    const m = byYear.get(y) ?? 0
    return { year: y, hasData: m > 0, metric: `${m} 个月`, label }
  })
}

// 「最新」年 = 当前自然年(区间恒含今年;区间最高年现在是今年+1,不该顶「最新」角标)
export function gateCurrentOf(cards: YearCard[], today = new Date()): number {
  const cur = today.getFullYear()
  return cards.some(c => c.year === cur) ? cur : (cards[cards.length - 1]?.year ?? cur)
}

// 月历年份胶囊上限:与选项区间上界同源(今年+1),否则未来年进得去、退一年就回不来。
export function maxSelectableYear(today = new Date()): number {
  const ys = buildYearOptions([], today)
  return ys[ys.length - 1]
}
