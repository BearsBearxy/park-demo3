// fin-pnl v2 纯函数单测:瀑布垫底分解/科目序列/环比叠加/预算月线(budget_row 当年值/12)。
import { describe, expect, it } from 'vitest'
import type { PnlSummary } from '@/analysis/anaData'
import type { BudgetRowDTO } from '@/api/budget'
import {
  budgetMonthlyWan, momOverlay, subjectMonthly, subjectTrendOption, waterfallOption, waterfallParts,
  type WfItem,
} from './finPnl.logic'

const wf = (name: string, value: number, type: WfItem['type']): WfItem => ({ name, value, type })

describe('waterfallParts(透明垫底柱分解)', () => {
  it('start→dec→dec→end:pad=扣减后低位,bar=|value|', () => {
    const { pads, bars } = waterfallParts([wf('a', 100, 'start'), wf('b', -30, 'dec'), wf('c', -20, 'dec'), wf('d', 50, 'end')])
    expect(pads).toEqual([0, 70, 50, 0])
    expect(bars).toEqual([100, 30, 20, 50])
  })
  it('inc 垫到当前累计(fin-cashflow 欠费瀑布形态)', () => {
    const { pads, bars } = waterfallParts([wf('期初', 10, 'start'), wf('应收', 5, 'inc'), wf('实收', -3, 'dec'), wf('期末', 12, 'end')])
    expect(pads).toEqual([0, 10, 12, 0])
    expect(bars).toEqual([10, 5, 3, 12])
  })
})

describe('waterfallOption', () => {
  const items = [wf('营业收入', 8772.2, 'start'), wf('租金成本', -4208.7, 'dec'), wf('园区总损益', 2285.7, 'end')]
  const opt = waterfallOption(items) as {
    xAxis: { data: string[] }
    series: [
      { silent: boolean; itemStyle: { color: string }; data: number[] },
      { data: { value: number; itemStyle: { color: string } }[] },
    ]
  }
  it('垫底系列透明且 silent;数值系列=|value|', () => {
    expect(opt.series[0].silent).toBe(true)
    expect(opt.series[0].itemStyle.color).toBe('transparent')
    expect(opt.series[0].data.map((v) => +v.toFixed(4))).toEqual([0, 4563.5, 0])   // 浮点容差
    expect(opt.series[1].data.map((d) => d.value)).toEqual([8772.2, 4208.7, 2285.7])
  })
  it('着色:减项红/终点深蓝/起点蓝;类目=科目名', () => {
    expect(opt.xAxis.data).toEqual(['营业收入', '租金成本', '园区总损益'])
    expect(opt.series[1].data[0].itemStyle.color).toBe('#378ADD')
    expect(opt.series[1].data[1].itemStyle.color).toBe('#E24B4A')
    expect(opt.series[1].data[2].itemStyle.color).toBe('#185FA5')
  })
})

// ── 科目 12 月序列 ──
const nulls = (): (number | null)[] => new Array(12).fill(null)
const band = (cost: (number | null)[]) => ({ rev: nulls(), cost, pnl: nulls() })
const ps: PnlSummary = {
  year: 2025,
  months: [1, 3],
  revenue: [1e4, null, 3e4, ...new Array(9).fill(null)],
  cost: [5e3, null, 1e4, ...new Array(9).fill(null)],
  profit: [5e3, null, 2e4, ...new Array(9).fill(null)],
  bySchedule: {
    s1: band([2e3, null, 4e3, ...new Array(9).fill(null)]),
    s2: band(nulls()), s3: band(nulls()), s4: band(nulls()), s5: band(nulls()),
  },
}

describe('subjectMonthly / momOverlay', () => {
  it('覆盖月取值折万;成本科目走对应附表;未知科目回退收入', () => {
    expect(subjectMonthly(ps, '营业收入')).toEqual([1, 3])
    expect(subjectMonthly(ps, '租金成本')).toEqual([0.2, 0.4])
    expect(subjectMonthly(ps, '园区总损益')).toEqual([0.5, 2])
    expect(subjectMonthly(ps, '不存在')).toEqual([1, 3])
  })
  it('环比=上期值后移一位,首期 null', () => {
    expect(momOverlay([5, 7, 9])).toEqual([null, 5, 7])
    expect(momOverlay([])).toEqual([])
  })
})

describe('budgetMonthlyWan(budget_row 当年值/12)', () => {
  const row = (year: number, label: string, sub: boolean, budget: number | null): BudgetRowDTO =>
    ({ year, label, sub, budget, actual: null, note: null, sortOrder: 0 })
  const rows = [
    row(2025, '收入总计', false, 92705202.87),
    row(2025, '其中：租金收入', true, 65306885.03),   // 子行不参与匹配
    row(2025, '利润总额', false, 29447576.97),
    row(2024, '收入总计', false, 1e8),                 // 其他年份不取
  ]
  it('营业收入/园区总损益 → 对应关键行 /12 折万', () => {
    expect(budgetMonthlyWan(rows, 2025, '营业收入')).toBeCloseTo(92705202.87 / 12 / 1e4, 6)
    expect(budgetMonthlyWan(rows, 2025, '园区总损益')).toBeCloseTo(29447576.97 / 12 / 1e4, 6)
  })
  it('成本细分科目无预算基准 → null;年份缺行 → null', () => {
    expect(budgetMonthlyWan(rows, 2025, '租金成本')).toBeNull()
    expect(budgetMonthlyWan(rows, 2023, '营业收入')).toBeNull()
  })
})

describe('subjectTrendOption(环比虚线/预算 markLine)', () => {
  interface TrendOpt { series: { name?: string; lineStyle?: { type: string }; markLine?: { data: { yAxis: number }[] } }[] }
  it('budget → 主系列 markLine yAxis=预算/月;mom → 追加虚线系列', () => {
    const o = subjectTrendOption(['1月', '3月'], [1, 3], '营业收入', { mom: [null, 1], budget: 772.5 }) as TrendOpt
    expect(o.series).toHaveLength(2)
    expect(o.series[0].markLine!.data[0].yAxis).toBe(772.5)
    expect(o.series[1].name).toBe('上期')
    expect(o.series[1].lineStyle!.type).toBe('dashed')
  })
  it('无对比 → 单系列无 markLine', () => {
    const o = subjectTrendOption(['1月'], [1], '营业收入', {}) as TrendOpt
    expect(o.series).toHaveLength(1)
    expect(o.series[0].markLine).toBeUndefined()
  })
})
