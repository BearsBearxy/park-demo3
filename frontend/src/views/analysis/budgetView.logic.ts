// src/views/analysis/budgetView.logic.ts — 预算对比 v2 纯数据变换(单测 budgetView.logic.spec.ts)。
// 五年组合图数据(实际柱/前瞻虚柱/预算标记线,元→万)+ 关键行 → 损益附表深链路由。
import type { BudgetKey } from '@/analysis/budget'

export interface YearCol { year: number; actual: number | null; budget: number | null }
export interface ComboBarPoint { value: number | null; isForecast: boolean }

/** 实际柱(万元):有实际→实值;仅预算→前瞻值(isForecast,图上虚线描边);皆无→null。 */
export function comboBarData(cols: YearCol[]): ComboBarPoint[] {
  return cols.map((c) => (c.actual != null
    ? { value: +(c.actual / 1e4).toFixed(1), isForecast: false }
    : c.budget != null
      ? { value: +(c.budget / 1e4).toFixed(1), isForecast: true }
      : { value: null, isForecast: false }))
}

/** 预算标记线(万元;无预算年 → null 断点)。 */
export function comboBudgetData(cols: YearCol[]): (number | null)[] {
  return cols.map((c) => (c.budget != null ? +(c.budget / 1e4).toFixed(1) : null))
}

/** 关键行 → 对应损益附表路由(spec §二.15 深链):费用族→附表5;园区收入/成本/利润(跨附表1-4 聚合)→附表1 起点。 */
export function keyRoute(k: BudgetKey | null): string | null {
  if (!k) return null
  return k === 'mgmt' || k === 'sales' || k === 'fin' || k === 'repair' || k === 's5' ? 'expense-pnl' : 'rent-pnl'
}
