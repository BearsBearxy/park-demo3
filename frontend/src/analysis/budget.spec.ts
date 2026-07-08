import { describe, it, expect } from 'vitest'
import { extractS5GroupTotals, matchBudgetKey, pnlKeyTotals } from './budget'
import type { PnlSummary } from './anaData'
import type { PnlYearDTO } from '@/types/pnl'

describe('matchBudgetKey — 总表关键行匹配(真实标签)', () => {
  it('关键行(费用侧细分,复审:管理费用不再吃整体 s5 假超支)', () => {
    expect(matchBudgetKey('收入总计')).toBe('revenue')
    expect(matchBudgetKey('主营成本总计')).toBe('cost')
    expect(matchBudgetKey('管理费用总计')).toBe('mgmt')
    expect(matchBudgetKey('销售费用-中介费')).toBe('sales')
    expect(matchBudgetKey('财务费用')).toBe('fin')
    expect(matchBudgetKey('修缮、工程费用')).toBe('repair')
    expect(matchBudgetKey('利润总额')).toBe('profit')
    expect(matchBudgetKey('本年损益')).toBe('profit')
  })
  it('匹配不到的行 → null(只显示文件值)', () => {
    expect(matchBudgetKey('其他暂不可估收支')).toBeNull()
    expect(matchBudgetKey('税金')).toBeNull()
  })
  it('子行不参与匹配(其中：电费收入 含「收入」也不吃 pnl 值)', () => {
    expect(matchBudgetKey('其中：租金收入', true)).toBeNull()
    expect(matchBudgetKey('收入总计', true)).toBeNull()
  })
})

describe('extractS5GroupTotals — s5 组级小计年Σ(库行实测标签)', () => {
  const row = (label: string, kind: string, m: (number | null)[]) => ({ rowKey: 'r', label, kind, groupLabel: '', m, note: null, sortOrder: 0 })
  const dto = {
    rows: [
      row('管理费用总计：', 'total', [100, 200, ...Array(10).fill(null)]),
      row('销售费用合计', 'total', [10, null, ...Array(10).fill(null)]),
      row('财务费用合计：', 'total', [1, 2, ...Array(10).fill(null)]),
      row('修缮、改造费用', 'total', [5, ...Array(11).fill(null)]),
      row('运营费用总计', 'total', [116, 202, ...Array(10).fill(null)]),   // 大合计不吃进组级
      row('办公室水电费合计', 'total', [999, ...Array(11).fill(null)]),    // 组内小计不误吃
    ],
  } as unknown as PnlYearDTO
  it('四组各取对应行年Σ', () => {
    expect(extractS5GroupTotals(dto)).toEqual({ mgmt: 300, sales: 10, fin: 3, repair: 5 })
  })
  it('缺行 → null', () => {
    expect(extractS5GroupTotals({ rows: [] } as unknown as PnlYearDTO)).toEqual({ mgmt: null, sales: null, fin: null, repair: null })
  })
})

describe('pnlKeyTotals — pnl 年Σ → 关键值', () => {
  const band = (cost: (number | null)[]) => ({ rev: Array(12).fill(null), cost, pnl: Array(12).fill(null) })
  const p: PnlSummary = {
    year: 2025,
    months: [1, 2],
    revenue: [100, 200, ...Array(10).fill(null)],
    cost: [80, 120, ...Array(10).fill(null)],       // 含 s5
    profit: [20, 80, ...Array(10).fill(null)],
    bySchedule: {
      s1: band(Array(12).fill(null)), s2: band(Array(12).fill(null)),
      s3: band(Array(12).fill(null)), s4: band(Array(12).fill(null)),
      s5: band([30, 20, ...Array(10).fill(null)]),
    },
  }
  it('revenue/profit=年Σ;cost=总成本−s5;s5=运营费用总计带;组级未传 → null', () => {
    expect(pnlKeyTotals(p)).toEqual({
      revenue: 300, cost: 150, s5: 50, profit: 100,
      mgmt: null, sales: null, fin: null, repair: null,
    })
  })
  it('组级传入透传', () => {
    expect(pnlKeyTotals(p, { mgmt: 40, sales: 5, fin: 1, repair: 4 }).mgmt).toBe(40)
  })
  it('全 null(该年未录)→ 全 null', () => {
    const empty: PnlSummary = {
      year: 2026, months: [], revenue: Array(12).fill(null), cost: Array(12).fill(null), profit: Array(12).fill(null),
      bySchedule: { s5: band(Array(12).fill(null)) },
    }
    expect(pnlKeyTotals(empty)).toEqual({
      revenue: null, cost: null, s5: null, profit: null,
      mgmt: null, sales: null, fin: null, repair: null,
    })
  })
})
