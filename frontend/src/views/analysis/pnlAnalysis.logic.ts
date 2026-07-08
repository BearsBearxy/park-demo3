// src/views/analysis/pnlAnalysis.logic.ts — 损益附表分析 v2 纯数据变换(单测 pnlAnalysis.logic.spec.ts)。
// 口径与 v1 完全一致:底带月值求和;s5 仅费用;缺 pnl 行退化为 收入−成本。金额入参元,图表序列折万。
import type { PnlBand } from '@/analysis/anaData'

export const sumBand = (a: (number | null)[]): number => a.reduce<number>((s, v) => s + (v ?? 0), 0)
export const hasVal = (a: (number | null)[]): boolean => a.some((v) => v != null)

export interface SchedTotals { income: number; cost: number; pnl: number }

/** 附表全年汇总(v1 cards 同口径;该附表本年无任何月值 → null)。 */
export function schedTotals(band: PnlBand | undefined, isExp: boolean): SchedTotals | null {
  if (!band) return null
  if (isExp) return hasVal(band.cost) ? { income: 0, cost: sumBand(band.cost), pnl: 0 } : null
  if (!hasVal(band.rev) && !hasVal(band.cost) && !hasVal(band.pnl)) return null
  const income = sumBand(band.rev)
  const cost = sumBand(band.cost)
  const pnl = hasVal(band.pnl) ? sumBand(band.pnl) : income - cost
  return { income, cost, pnl }
}

/** 迷你趋势序列(覆盖月序,万元):常规附表=月损益(缺 pnl 行退化收入−成本),s5=月费用。 */
export function schedSpark(band: PnlBand, isExp: boolean, months: number[]): number[] {
  return months.map((m) => {
    const i = m - 1
    if (isExp) return (band.cost[i] ?? 0) / 1e4
    const p = hasVal(band.pnl) ? band.pnl[i] : (band.rev[i] ?? 0) - (band.cost[i] ?? 0)
    return (p ?? 0) / 1e4
  })
}

export interface SchedMonthly { labels: string[]; rev: number[]; cost: number[]; pnl: number[] }

/** 选中附表 12 月组合序列(覆盖月序,万元;s5 → rev/pnl 空,cost=费用)。 */
export function schedMonthly(band: PnlBand, isExp: boolean, months: number[]): SchedMonthly {
  const at = (a: (number | null)[], m: number): number => (a[m - 1] ?? 0) / 1e4
  const labels = months.map((m) => m + '月')
  if (isExp) return { labels, rev: [], cost: months.map((m) => at(band.cost, m)), pnl: [] }
  const pnl = months.map((m) => (hasVal(band.pnl) ? at(band.pnl, m) : at(band.rev, m) - at(band.cost, m)))
  return { labels, rev: months.map((m) => at(band.rev, m)), cost: months.map((m) => at(band.cost, m)), pnl }
}

/** 环比叠加:序列右移一位(首位 null)= 各月「上月值」虚线基准。 */
export function momShift(values: number[]): (number | null)[] {
  return values.map((_, i) => (i === 0 ? null : values[i - 1]))
}

/** 结构堆叠:附表1-4 收入 ×覆盖月(万元)。 */
export function structStack(bySchedule: Record<string, PnlBand>, months: number[]): { name: string; values: number[] }[] {
  const defs = [['s1', '租金'], ['s2', '用电'], ['s3', '用水'], ['s4', '运管']] as const
  return defs.map(([k, name]) => ({ name, values: months.map((m) => (bySchedule[k]?.rev[m - 1] ?? 0) / 1e4) }))
}
