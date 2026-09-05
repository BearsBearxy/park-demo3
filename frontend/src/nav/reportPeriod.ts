// 报表层的期 —— 期间条的步骤定义，以及跟着导航一起走的那一包查询参数
// （2026-08-28 设计稿 §3.2b/c，P3）。
//
// 病根与出账链同源：三大报表 + 附表1–5 + 收入核对是**同一个期的不同侧面**
// （报表中心的「本期勾稽」瓦片条就是在横着比它们），可是改造前
// `ReportsHomeView.go()` 是干净的 `router.push('/' + v)` —— 不带任何查询参数。
// 用户在报表中心选定 2025 年 9 月、点开利润表，要重走公司 → 年 → 月三道门回到原地。
//
// ⚠ 与出账链有一处**真实差别**，不要照抄：出账链五屏的期轴完全相同（都是那把月锁的年月），
//   所以期能进一个 store。报表层不同 —— 三大报表是 (公司, 年, 月)、损益附表是 (年)、
//   收入核对是 (年, 月)。**不存在一个所有屏都认的期对象**。
//   所以这里走查询参数而不是 store：条把整包 p/co 带过去（periodLink 形状，各屏自己组，2026-09-04 起），
//   **目标屏认得几个用几个，不认的原样传回来**。靠这条，
//   利润表 → 附表1 → 利润表 之后月份和公司都还在。
import { fpBuildRoutes } from '@/nav/fpNav'
import { parsePeriod } from '@/nav/deepLink'
import type { Step } from '@/components/fp/FPStepStrip.vue'

const ROUTES = fpBuildRoutes()
const pad2 = (n: number) => String(n).padStart(2, '0')

/** 损益附表：条上只写「附表N」，全名进 title —— 九个步骤挤不下全称。 */
const SHORT = new Set(['rent-pnl', 'elec-pnl', 'water-pnl', 'ops-pnl', 'expense-pnl'])

/** 期间条的九个步骤，顺序同报表中心目录（三大报表 / 损益附表 / 收入核对）。 */
export const REPORT_STEPS: readonly Step[] = [
  'income-statement', 'balance-sheet', 'trial-balance',
  'rent-pnl', 'elec-pnl', 'water-pnl', 'ops-pnl', 'expense-pnl',
  'reconciliation',
].map(value => {
  const full = ROUTES[value]?.page ?? value
  // 「附表4 运管损益」→ 标签「附表4」+ title 全名
  return SHORT.has(value)
    ? { value, label: full.split(' ')[0], title: full }
    : { value, label: full }
})

export interface ReportPeriod {
  year: number
  month: number | null
  companyId: number | 'all' | null
}

/**
 * 回读。**没有年 = 不是深链**，一律返回 null ——
 * 半个期塞给屏，比不塞更坏（屏会停在一个说不清从哪来的状态）。
 * 年月越界一律丢：地址栏是用户可改的，不信任它。
 * 2026-09-03 起委托 nav/deepLink.parsePeriod(SIDEBAR-UX-REDESIGN §4.2 唯一收口):从此也认 p= 新格式,
 * 旧 y&m&co 口径原样;深链里的公司名(company)不落进 companyId —— 报表层没有公司名维度。
 */
export function parsePeriodQuery(q: Record<string, unknown>): ReportPeriod | null {
  const dp = parsePeriod(q)
  if (!dp) return null
  return { year: dp.year, month: dp.month, companyId: typeof dp.co === 'string' && dp.co !== 'all' ? null : dp.co }
}

/** 条上那个期标。有几个维度写几个 —— 损益附表是园区全局整年，写「2025 年」就够。 */
export function periodLabel(year: number, month: number | null, companyName: string | null): string {
  const base = month == null ? `${year} 年` : `${year}-${pad2(month)}`
  return companyName ? `${base} · ${companyName}` : base
}
