// 分析图表冒烟:mount 不炸 + 关键 SVG 元素存在(jsdom 无 ResizeObserver → useWidth 回退初始宽)。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AnaStatBar from '../AnaStatBar.vue'
import AnaBoxPlot from '../AnaBoxPlot.vue'
import AnaWaterfall from '../AnaWaterfall.vue'
import AnaRadar from '../AnaRadar.vue'
import AnaScatter from '../AnaScatter.vue'
import AnaDeviationBars from '../AnaDeviationBars.vue'
import AnaSparkGrid from '../AnaSparkGrid.vue'
import AnaBullet from '../AnaBullet.vue'
import AnaStackedCols from '../AnaStackedCols.vue'
import AnaRatioArc from '../AnaRatioArc.vue'
import AnaTrend from '../AnaTrend.vue'
import AnaMoMBars from '../AnaMoMBars.vue'
import AnaHeatmap from '../AnaHeatmap.vue'
import AnaStatTile from '../AnaStatTile.vue'
import AnaVerdictBanner from '../AnaVerdictBanner.vue'
import AnaInsightHero from '../AnaInsightHero.vue'
import AnaAnomalyCard from '../AnaAnomalyCard.vue'
import AnaEmpty from '../AnaEmpty.vue'
import FigLineChart from '../FigLineChart.vue'
import { peakTag, trendTag } from '../anaFmt'

describe('图表原语冒烟', () => {
  it('AnaStatBar 渲染全部统计项', () => {
    const w = mount(AnaStatBar, { props: { items: [{ label: '均值', value: '12.3' }, { label: 'σ', value: '1.1', delta: 2.5 }] } })
    expect(w.findAll('.cz-stat').length).toBe(2)
    expect(w.text()).toContain('12.3')
  })

  it('AnaBoxPlot:每组一个箱体 rect + 中位线', () => {
    const w = mount(AnaBoxPlot, { props: { groups: [
      { name: 'A', values: [1, 2, 3, 4, 5] }, { name: 'B', values: [2, 4, 6, 8] }] } })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.findAll('rect').length).toBe(2)
    expect(w.text()).toContain('四分位区间')
  })

  it('AnaWaterfall:每项一根柱', () => {
    const w = mount(AnaWaterfall, { props: { items: [
      { name: '收入', value: 100, type: 'start' }, { name: '成本', value: -60, type: 'dec' },
      { name: '损益', value: 40, type: 'end' }] } })
    expect(w.findAll('rect').length).toBe(3)
  })

  it('AnaRadar:每序列一个多边形 + 图例', () => {
    const w = mount(AnaRadar, { props: { axes: ['a', 'b', 'c'], series: [
      { name: 'S1', color: 'red', values: [50, 60, 70] }] } })
    // 4 圈网格 + 1 数据面
    expect(w.findAll('polygon').length).toBe(5)
    expect(w.text()).toContain('S1')
  })

  it('AnaScatter:每点一个圆 + 基准线', () => {
    const w = mount(AnaScatter, { props: { points: [
      { x: 1, y: 2, label: 'p1' }, { x: 3, y: 4, label: 'p2' }],
      benchmark: { y: 3 }, xLabel: 'X', yLabel: 'Y' } })
    expect(w.findAll('circle').length).toBe(2)
    expect(w.text()).toContain('均值')
  })

  it('AnaDeviationBars:σ 带 + 每项一条', () => {
    const w = mount(AnaDeviationBars, { props: { items: [
      { name: 'A', value: 12 }, { name: 'B', value: 8 }], mean: 10, std: 2 } })
    // 2 个 σ 带 rect + 2 数据条
    expect(w.findAll('rect').length).toBe(4)
  })

  it('AnaSparkGrid:每项一格含迷你折线', () => {
    const w = mount(AnaSparkGrid, { props: { items: [
      { name: 'A', series: [1, 2, 3], cur: 3, mom: 5 }, { name: 'B', series: [3, 2, 1], cur: 1, mom: -3 }] } })
    expect(w.findAll('.cz-sp').length).toBe(2)
    expect(w.findAll('svg path').length).toBe(2)
  })

  it('AnaBullet:每行底轨 + 值条 + 目标线', () => {
    const w = mount(AnaBullet, { props: { rows: [{ name: 'A', value: 88 }], target: 90, max: 100 } })
    expect(w.findAll('rect').length).toBe(2)
    expect(w.findAll('line').length).toBe(1)
    expect(w.text()).toContain('目标线')
  })

  it('AnaStackedCols:stack 模式 期数×序列 个 rect', () => {
    const w = mount(AnaStackedCols, { props: { periods: ['1月', '2月'], series: [
      { name: 'a', color: 'red', values: [10, 20] }, { name: 'b', color: 'blue', values: [5, 5] }] } })
    expect(w.findAll('rect').length).toBe(4)
  })

  it('AnaRatioArc:背景+数值双弧', () => {
    const w = mount(AnaRatioArc, { props: { value: 0.62, label: '负债率', sub: 'x' } })
    expect(w.findAll('path').length).toBe(2)
    expect(w.text()).toContain('0.62')
  })

  it('AnaTrend:今年实线 + 去年虚线 + 图例', () => {
    const w = mount(AnaTrend, { props: { labels: ['1月', '2月', '3月'], cur: [1, 2, 3], prev: [1, 1, 2] } })
    expect(w.findAll('path').length).toBe(3)   // prev + area + cur
    expect(w.text()).toContain('去年同期')
  })

  it('AnaMoMBars:n-1 根环比柱', () => {
    const w = mount(AnaMoMBars, { props: { labels: ['1月', '2月', '3月'], series: [100, 110, 99] } })
    expect(w.findAll('rect').length).toBe(2)
  })

  it('AnaHeatmap:行×列 单元格', () => {
    const w = mount(AnaHeatmap, { props: { cols: ['1月', '2月'], rows: [
      { name: 'A', values: [5, -3] }, { name: 'B', values: [1, 2] }] } })
    expect(w.findAll('.ak-hm-cell').length).toBe(4)
    expect(w.text()).toContain('+5')
  })

  it('AnaStatTile / AnaVerdictBanner / AnaInsightHero / AnaAnomalyCard 挂载不炸', () => {
    expect(mount(AnaStatTile, { props: { label: '收入', value: '¥1万', status: 'good', yoy: 5, cur: [1, 2, 3] } }).text()).toContain('收入')
    expect(mount(AnaVerdictBanner, { props: { verdict: { level: 'good', headline: 'ok', points: [{ tone: 'good', text: 'p' }] }, asof: '2025-10' } }).text()).toContain('2025-10')
    expect(mount(AnaInsightHero, { props: { label: 'L', value: 'V', read: [{ tone: 'risk', text: 'r' }] } }).text()).toContain('V')
    const card = mount(AnaAnomalyCard, { props: { a: { id: 'x', sev: 'watch', type: 't', metric: 'm', title: 'T', value: '9' } } })
    expect(card.text()).toContain('T')
  })

  it('AnaEmpty:空态卡带深链', () => {
    const w = mount(AnaEmpty, {
      props: { label: '合同日期未录入', hint: '去补录', to: '/contracts', toText: '去合同管理' },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    expect(w.text()).toContain('合同日期未录入')
    expect(w.text()).toContain('去合同管理')
  })

  it('FigLineChart:主题/粒度切换壳 + 折线', () => {
    const w = mount(FigLineChart, { props: { model: { themes: [
      { name: '同比', sub: 's', gran: { 月: {
        lines: [
          { name: '今年', color: '#000', kind: 'area', pts: [1, 2, 3] },
          { name: '去年', color: '#999', kind: 'compare', pts: [1, 1, 2] }],
        labels: ['1月', '2月', '3月'], value: '¥3万', delta: '+50%', up: true, rangeLabel: 'r' } } }] } } })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.text()).toContain('¥3万')
    expect(w.findAll('button').length).toBeGreaterThan(0)
  })
})

describe('动态标签', () => {
  it('peakTag/trendTag 由数据算出', () => {
    expect(peakTag([1, 2, 5])!.text).toContain('新高')
    expect(peakTag([5, 2, 1])!.tone).toBe('risk')
    expect(trendTag([1, 2, 3, 4])!.text).toContain('上行')
    expect(trendTag([1, 2])).toBeNull()
  })
})
