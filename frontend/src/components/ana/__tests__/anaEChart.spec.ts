// AnaEChart 薄封装单测(jsdom 无 canvas → vi.mock('echarts');屏组组件测试沿用此规约):
// init('fpAnaTheme') / 主题注册 / setOption(notMerge) / option 更新 / click 透传 / resize / dispose。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const h = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() }
  return { chart, init: vi.fn(() => chart), registerTheme: vi.fn() }
})
vi.mock('echarts', () => ({ init: h.init, registerTheme: h.registerTheme }))

// jsdom 无 ResizeObserver:桩记录回调供手动触发
let lastRO: ROStub | null = null
class ROStub {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor(public cb: ResizeObserverCallback) { lastRO = this }
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ROStub

import AnaEChart from '../AnaEChart.vue'

beforeEach(() => {
  vi.clearAllMocks()
  lastRO = null
})

describe('AnaEChart', () => {
  it('懒加载后 init(el, fpAnaTheme) + setOption(notMerge);主题注册幂等(全局仅一次)', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar' }] } } })
    expect(w.classes()).toContain('loading')   // 加载中占位
    await flushPromises()
    expect(h.init).toHaveBeenCalledWith(w.element, 'fpAnaTheme')
    expect(h.chart.setOption).toHaveBeenCalledWith({ series: [{ type: 'bar' }] }, { notMerge: true })
    expect(w.classes()).not.toContain('loading')
    const before = h.registerTheme.mock.calls.length   // 首个用例 1 次;跨用例幂等(anaTheme 模块级守卫)
    const w2 = mount(AnaEChart, { props: { option: {} } })
    await flushPromises()
    expect(h.registerTheme.mock.calls.length).toBe(before)
    w2.unmount(); w.unmount()
  })

  it('option 变更(深比较)→ setOption(notMerge) 重下发', async () => {
    const w = mount(AnaEChart, { props: { option: { a: 1 } } })
    await flushPromises()
    h.chart.setOption.mockClear()
    await w.setProps({ option: { a: 2 } })
    await nextTick()
    expect(h.chart.setOption).toHaveBeenCalledWith({ a: 2 }, { notMerge: true })
    w.unmount()
  })

  it('ECharts click → chart-click 透传 params', async () => {
    const w = mount(AnaEChart, { props: { option: {} } })
    await flushPromises()
    const call = h.chart.on.mock.calls.find((c) => c[0] === 'click')
    expect(call).toBeTruthy()
    ;(call![1] as (p: unknown) => void)({ name: '3月', value: 42 })
    expect(w.emitted('chart-click')![0]).toEqual([{ name: '3月', value: 42 }])
    w.unmount()
  })

  it('ResizeObserver 触发 resize;卸载 dispose + 断开观察', async () => {
    const w = mount(AnaEChart, { props: { option: {}, height: 180 } })
    await flushPromises()
    expect(w.attributes('style')).toContain('height: 180px')
    expect(lastRO!.observe).toHaveBeenCalledWith(w.element)
    lastRO!.cb([], lastRO as unknown as ResizeObserver)
    expect(h.chart.resize).toHaveBeenCalled()
    w.unmount()
    expect(h.chart.dispose).toHaveBeenCalled()
    expect(lastRO!.disconnect).toHaveBeenCalled()
  })
})
