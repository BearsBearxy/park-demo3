// budgetView.logic 单测:实际柱/前瞻虚柱/预算标记线折万 + 关键行深链路由映射。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// ───────── C6-01 首进骨架 ─────────
// 源码形状门禁:第一行两卡照主图的 :height 300 留白 —— 改图高忘了改骨架,这条就红。
// 第二行(总表明细 / 前瞻)高度随行数走,骨架不猜,也不断言。
describe('预算达成首进骨架(C6-01)', () => {
  const src = readFileSync(join(__dirname, 'BudgetView.vue'), 'utf8')
  const skel = src.slice(src.indexOf('class="bv2-page bv2-skel"'), src.indexOf('<!-- 无预算数据'))

  it('❗不转圈;骨架块高 = 卡头 20 + 五年对比 300(两卡同高,栅格同一行)', () => {
    expect(src).not.toContain('page-spin')
    // 顶替 AnaEChart 的块是 <AnaSkelChart :height>(与图同表降档,C6-01 ≤600),其余是写死高的 .fp-shim
    expect([...skel.matchAll(/height: (\d+)px|<AnaSkelChart :height="(\d+)"/g)].map(m => m[1] ?? m[2]))
      .toEqual(['20', '300', '20', '300'])
    expect(src).toContain(':option="comboOpt" :height="300"')
  })
})
