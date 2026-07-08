// fin-balance v2 纯函数单测:双环 option 数据/配色同源、gauge ≤2 与语义色阈值。
import { describe, expect, it } from 'vitest'
import { DONUT_PAL, currentTone, debtTone, donutOption, gaugesOption, sliceColor } from './finBalance.logic'

describe('donutOption / sliceColor', () => {
  it('切片 name/value 保序,配色循环主题色板(HTML 图例同源取色)', () => {
    const o = donutOption(
      [{ label: '货币资金', value: 7203515.53 }, { label: '应收账款', value: 31556941.24 }],
      '5.1亿', '资产总计',
    ) as { title: { text: string }; series: [{ data: { name: string; value: number; itemStyle: { color: string } }[] }] }
    expect(o.title.text).toBe('5.1亿')
    expect(o.series[0].data.map((d) => d.name)).toEqual(['货币资金', '应收账款'])
    expect(o.series[0].data.map((d) => d.value)).toEqual([7203515.53, 31556941.24])
    expect(o.series[0].data[0].itemStyle.color).toBe(DONUT_PAL[0])
    expect(sliceColor(DONUT_PAL.length)).toBe(DONUT_PAL[0])   // 超长循环
  })
})

describe('gauge 语义色阈值(与 v1 RatioArc tone 同口径)', () => {
  it('资产负债率:<60 好 / <85 关注 / ≥85 风险;流动比率:≥1 好', () => {
    expect(debtTone(59.9)).toBe('good')
    expect(debtTone(60)).toBe('warn')
    expect(debtTone(85)).toBe('risk')
    expect(currentTone(1)).toBe('good')
    expect(currentTone(0.99)).toBe('warn')
  })
})

describe('gaugesOption(spec ≤2 个仪表)', () => {
  interface GOpt { series: { max: number; data: [{ value: number; name: string }] }[] }
  it('双 gauge:负债率 0~100 / 流动比率 0~2,值保留一致精度', () => {
    const o = gaugesOption(76.54321, 1.2345) as GOpt
    expect(o.series).toHaveLength(2)
    expect(o.series[0].max).toBe(100)
    expect(o.series[0].data[0].value).toBe(76.5)
    expect(o.series[1].max).toBe(2)
    expect(o.series[1].data[0].value).toBe(1.23)
  })
  it('流动比率不可算(流动负债≤0)→ 仅 1 个 gauge', () => {
    const o = gaugesOption(50, null) as GOpt
    expect(o.series).toHaveLength(1)
    expect(o.series[0].data[0].name).toBe('资产负债率')
  })
})
