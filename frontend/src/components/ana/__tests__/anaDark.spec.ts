// 图表暗色(DARK-MODE-SPEC §6,稿 Analysis 第 1 节):anaTheme 出浅色 / 暗色两套同结构主题,
// AnaEChart 按当前外观 init,切外观时重建实例;calloutMark / bandSeries 的颜色跟着外观走。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const h = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), getOption: vi.fn((): Record<string, unknown> => ({})), resize: vi.fn(), clear: vi.fn(), dispose: vi.fn(), on: vi.fn(), getWidth: vi.fn(() => 600), getHeight: vi.fn(() => 300) }
  return { chart, init: vi.fn(() => chart), registerTheme: vi.fn() }
})
vi.mock('../echartsBundle', () => ({ init: h.init, registerTheme: h.registerTheme }))

import AnaEChart from '../AnaEChart.vue'
import { ANA_DARK, ANA_LIGHT, CALLOUT, FP_ANA_THEME, FP_ANA_THEME_DARK, anaPalette, bandSeries, calloutMark } from '../anaTheme'
import { resolvedTheme } from '@/stores/appearance'
import { cmpBaseline, cmpBudget } from '../anaFmt'

beforeEach(() => { vi.clearAllMocks(); resolvedTheme.value = 'light' })

describe('AnaEChart · 切外观', () => {
  it('两套主题都注册;按当前外观 init', async () => {
    resolvedTheme.value = 'dark'
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar' }] } } })
    await flushPromises()
    expect(h.registerTheme.mock.calls.map((c) => c[0])).toEqual(['fpAnaTheme', 'fpAnaThemeDark'])
    expect(h.init).toHaveBeenCalledWith(expect.anything(), 'fpAnaThemeDark', expect.anything())
    w.unmount()
  })

  it('❗外观一变:旧实例 dispose,按新主题重新 init、重新下发 option、事件重新挂上', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar' }] } } })
    await flushPromises()
    expect(h.init).toHaveBeenLastCalledWith(expect.anything(), 'fpAnaTheme', expect.anything())
    h.chart.setOption.mockClear(); h.chart.on.mockClear()
    resolvedTheme.value = 'dark'
    await nextTick(); await flushPromises()
    expect(h.chart.dispose).toHaveBeenCalledTimes(1)
    expect(h.init).toHaveBeenLastCalledWith(expect.anything(), 'fpAnaThemeDark', expect.anything())
    expect(h.chart.setOption).toHaveBeenCalledWith(expect.objectContaining({ series: [expect.objectContaining({ type: 'bar' })] }), { notMerge: true })
    expect(h.chart.on.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['click', 'finished', 'datazoom']))
    w.unmount()
  })
})

describe('anaTheme · 两套色板', () => {
  const keysOf = (o: unknown, p = ''): string[] =>
    o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => keysOf(v, p + '.' + k)) : [p]

  it('暗色主题与浅色同结构,只换值', () => {
    expect(keysOf(FP_ANA_THEME_DARK)).toEqual(keysOf(FP_ANA_THEME))
    expect(Object.keys(ANA_DARK)).toEqual(Object.keys(ANA_LIGHT))
  })

  it('暗色只换第 6 个分类色(深蓝 → 灰蓝),主题 color[3] 同值一起换;其余 7 个两边一样', () => {
    expect(ANA_DARK.cat[5]).toBe('#6E86AE')
    expect(FP_ANA_THEME_DARK.color[3]).toBe('#6E86AE')
    expect(ANA_DARK.cat.filter((c, i) => c !== ANA_LIGHT.cat[i])).toEqual(['#6E86AE'])
    expect(FP_ANA_THEME_DARK.tooltip.backgroundColor).toBe('rgb(62,77,95)')   // = 暗色 --tip-bg
  })

  it('暗色色板在卡片 rgb(42,42,44) 上:分类色 / 标注环 ≥3,坐标字 / 图例 ≥4.5(稿断言同一组)', () => {
    const rgb = (s: string): number[] => {
      const m = s.match(/^#(..)(..)(..)$/)
      if (m) return m.slice(1).map((x) => parseInt(x, 16))
      const p = s.match(/\(([^)]+)\)/)![1].split(',').map(Number)
      return p[3] == null ? p.slice(0, 3) : p.slice(0, 3).map((c, i) => Math.round(p[3] * c + (1 - p[3]) * [42, 42, 44][i]))
    }
    const L = (c: number[]) => c.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
    const onCard = (s: string) => { const a = L(rgb(s)), b = L([42, 42, 44]); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    for (const c of [...ANA_DARK.cat, ...Object.values(ANA_DARK.callout)]) expect(onCard(c), c).toBeGreaterThanOrEqual(3)
    for (const c of [ANA_DARK.label, ANA_DARK.legend]) expect(onCard(c), c).toBeGreaterThanOrEqual(4.5)
    // 坐标轴名(「万/月」「收款率(%)」)与对比线(markLine 标签当字色)也是字
    for (const c of [ANA_DARK.axisName.category, ANA_DARK.axisName.value, ANA_DARK.cmp.budget, ANA_DARK.cmp.baseline]) {
      expect(onCard(c), c).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('❗坐标轴名字色进两套主题:暗色 = 坐标字色;浅色写的就是 ECharts 原来的默认(类目轴 = 轴线色、数值轴 #54555a),浅色外观不变', () => {
    expect(FP_ANA_THEME_DARK.valueAxis.nameTextStyle.color).toBe(ANA_DARK.label)
    expect(FP_ANA_THEME_DARK.categoryAxis.nameTextStyle.color).toBe(ANA_DARK.label)
    expect(FP_ANA_THEME.valueAxis.nameTextStyle.color).toBe('#54555a')
    expect(FP_ANA_THEME.categoryAxis.nameTextStyle.color).toBe(FP_ANA_THEME.categoryAxis.axisLine.lineStyle.color)
  })

  it('❗对比线(预算紫 / 基线灰)跟外观:浅色是原值,暗色换同色相的浅色', () => {
    expect([cmpBudget(), cmpBaseline()]).toEqual(['#7C3AED', '#64748B'])
    resolvedTheme.value = 'dark'
    expect([cmpBudget(), cmpBaseline()]).toEqual([ANA_DARK.cmp.budget, ANA_DARK.cmp.baseline])
    expect(ANA_DARK.cmp.budget).not.toBe('#7C3AED')
  })

  it('❗calloutMark:调用方照旧传 CALLOUT.red,暗色下环换暗色红、芯换卡片色;浅色原样', () => {
    const ring = () => (calloutMark(CALLOUT.red, '#E24B4A', [{ coord: [0, 1], lines: ['x'] }]) as { data: { itemStyle: { color: string; borderColor?: string } }[] }).data[1].itemStyle
    expect(ring()).toMatchObject({ color: '#fff', borderColor: '#BC4A41' })
    resolvedTheme.value = 'dark'
    expect(anaPalette()).toBe(ANA_DARK)
    expect(ring()).toMatchObject({ color: 'rgb(42,42,44)', borderColor: 'rgb(250,136,125)' })
  })

  it('❗bandSeries 默认带色跟外观:浅色 7% 墨、暗色 7% 白', () => {
    const fill = () => ((bandSeries([1], [2])[1] as { areaStyle: { color: string } }).areaStyle.color)
    expect(fill()).toBe('rgba(28,28,28,.07)')
    resolvedTheme.value = 'dark'
    expect(fill()).toBe('rgba(255,255,255,.07)')
  })
})
