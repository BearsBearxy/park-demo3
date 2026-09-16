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

// 资不抵债时负债率 >100(实测备份 12 个公司×期间里 9 个超,最高 1387.5%,另有一个 -843.2%)。
// 引擎 progress.clip 默认 true 会把环夹满 —— 环画满时必须读得出是超量程,不是正好 100%。
describe('gaugesOption 超量程标记', () => {
  interface GOptX {
    series: {
      max: number
      splitNumber: number
      axisLine: { lineStyle: { color: [number, string][] } }
      axisLabel: { show: boolean }
      data: [{ value: number }]
    }[]
  }
  const track = (o: GOptX, i: number): string => o.series[i].axisLine.lineStyle.color[0][1]

  it('量程内:轨道是中性灰,刻度不露出', () => {
    const o = gaugesOption(62, 1.2) as GOptX
    expect(track(o, 0)).toBe('rgba(28,28,28,.08)')
    expect(o.series[0].axisLabel.show).toBe(false)
    expect(track(o, 1)).toBe('rgba(28,28,28,.08)')
  })
  it('负债率 >100:轨道染成同档语义色浅底 + 露出 0 / 100 两个刻度,数字仍是真值', () => {
    const o = gaugesOption(157.3, 0.64) as GOptX
    expect(track(o, 0)).toBe('#E24B4A26')
    expect(o.series[0].axisLabel.show).toBe(true)
    expect(o.series[0].splitNumber).toBe(1)
    expect(o.series[0].max).toBe(100)
    expect(o.series[0].data[0].value).toBe(157.3)
    expect(track(o, 1)).toBe('rgba(28,28,28,.08)')
  })
  it('负债率为负(总负债为负)同样算超量程,且不给「好」色', () => {
    const o = gaugesOption(-843.2, null) as GOptX
    expect(debtTone(-843.2)).toBe('risk')
    expect(track(o, 0)).toBe('#E24B4A26')
    expect(o.series[0].data[0].value).toBe(-843.2)
  })
  it('流动比率 >2 自己标,不牵连负债率那只', () => {
    const o = gaugesOption(50, 2.5) as GOptX
    expect(track(o, 1)).toBe('#378ADD26')
    expect(o.series[1].axisLabel.show).toBe(true)
    expect(track(o, 0)).toBe('rgba(28,28,28,.08)')
  })
})
