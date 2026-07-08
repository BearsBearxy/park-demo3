// budgetView.logic 单测:实际柱/前瞻虚柱/预算标记线折万 + 关键行深链路由映射。
import { describe, expect, it } from 'vitest'
import { comboBarData, comboBudgetData, keyRoute } from './budgetView.logic'

const cols = [
  { year: 2024, actual: 82867520.26, budget: null },
  { year: 2025, actual: 87722075.54, budget: 92705202.87 },
  { year: 2026, actual: null, budget: 103620434.53 },
  { year: 2027, actual: null, budget: null },
]

describe('comboBarData / comboBudgetData', () => {
  it('有实际→实值柱;仅预算→前瞻柱;皆无→null(万元 1 位)', () => {
    expect(comboBarData(cols)).toEqual([
      { value: 8286.8, isForecast: false },
      { value: 8772.2, isForecast: false },
      { value: 10362, isForecast: true },
      { value: null, isForecast: false },
    ])
  })
  it('预算标记线:无预算年 null 断点', () => {
    expect(comboBudgetData(cols)).toEqual([null, 9270.5, 10362, null])
  })
})

describe('keyRoute', () => {
  it('费用族→expense-pnl;收入/成本/利润→rent-pnl;未匹配→null', () => {
    expect(keyRoute('mgmt')).toBe('expense-pnl')
    expect(keyRoute('sales')).toBe('expense-pnl')
    expect(keyRoute('fin')).toBe('expense-pnl')
    expect(keyRoute('repair')).toBe('expense-pnl')
    expect(keyRoute('s5')).toBe('expense-pnl')
    expect(keyRoute('revenue')).toBe('rent-pnl')
    expect(keyRoute('cost')).toBe('rent-pnl')
    expect(keyRoute('profit')).toBe('rent-pnl')
    expect(keyRoute(null)).toBeNull()
  })
})
