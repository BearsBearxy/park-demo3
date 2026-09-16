// AnaEChart 薄封装单测(jsdom 无 canvas → 整体 mock ./echartsBundle;屏组组件测试沿用此规约):
// init('fpAnaTheme') / 主题注册 / setOption(notMerge) / option 更新 / click 透传 / resize / dispose / S 档图高降档。
// ⚠ 桩掉的是整个装配模块,所以「注册清单是否漏项」本测试**零覆盖** —— 只能在浏览器里看控制台。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

const h = vi.hoisted(() => {
  // getWidth/getHeight 是 C6-02 的 RO 守卫要读的(尺寸真变才 resize),按 ChartInst 契约桩上
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), getWidth: vi.fn(() => 600), getHeight: vi.fn(() => 300) }
  return { chart, init: vi.fn(() => chart), registerTheme: vi.fn() }
})
vi.mock('../echartsBundle', () => ({ init: h.init, registerTheme: h.registerTheme }))

// jsdom 无 ResizeObserver:桩记录回调供手动触发
let lastRO: ROStub | null = null
class ROStub {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor(public cb: ResizeObserverCallback) { lastRO = this }
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ROStub

// jsdom 的 getBoundingClientRect 全 0 —— 在 AnaEChart 眼里那是「离屏」(C6-06 该次关动画)。
// 桩成在视口内,让下面的用例走正常相位;离屏分支本身钉在 anaMotion.spec.ts。
Element.prototype.getBoundingClientRect = () =>
  ({ top: 0, bottom: 300, left: 0, right: 600, width: 600, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

import AnaEChart, { mobilizeOption } from '../AnaEChart.vue'

beforeEach(() => {
  vi.clearAllMocks()
  lastRO = null
})

describe('AnaEChart', () => {
  it('懒加载后 init(el, fpAnaTheme) + setOption(notMerge);主题注册幂等(全局仅一次)', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar' }] } } })
    expect(w.classes()).toContain('loading')   // 加载中占位
    await flushPromises()
    // 第三参是 2026-08-20 修「每个图都很糊」的核心:非整数 DPR(Windows 125% 缩放 → 1.14)
    // 会让 canvas 背景缓冲落在小数像素上、整张被重采样。ceil 且下限 2 = 2 倍超采样。
    // 断言 ≥2 而不是断言等于某个数:CI 与本机 devicePixelRatio 不同,写死会随环境红。
    expect(h.init).toHaveBeenCalledWith(w.element, 'fpAnaTheme',
      expect.objectContaining({ devicePixelRatio: expect.any(Number) }))
    const dpr = (h.init.mock.calls[0] as unknown[])[2] as { devicePixelRatio: number }
    expect(dpr.devicePixelRatio).toBeGreaterThanOrEqual(2)
    expect(Number.isInteger(dpr.devicePixelRatio)).toBe(true)
    // 注入动效键后不再逐字相等(动效设计稿 §8.3 明写改 objectContaining);键值本身见下面三条与 anaMotion.spec.ts
    expect(h.chart.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ series: [expect.objectContaining({ type: 'bar' })] }), { notMerge: true })
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
    expect(h.chart.setOption).toHaveBeenCalledWith(expect.objectContaining({ a: 2 }), { notMerge: true })
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

  it('S 档(matchMedia ≤600 命中)图高降档:lg300→260;挂载时一次初判,不挂 resize 监听', async () => {
    // jsdom 的 matchMedia 一律 matches:false(等于非 S 档),既有用例的 height 直传就是这么保住的;
    // 这里桩成命中来走降档分支。断言映射一档即可——映射表是纯查表,五档全列是重复自己。
    const orig = window.matchMedia
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    try {
      const w = mount(AnaEChart, { props: { option: {}, height: 300 } })
      await flushPromises()
      expect(w.attributes('style')).toContain('height: 260px')
      w.unmount()
    } finally {
      window.matchMedia = orig
    }
  })

  it('ResizeObserver 只在尺寸**真变**时 resize;卸载 dispose + 断开观察', async () => {
    const w = mount(AnaEChart, { props: { option: {}, height: 180 } })
    await flushPromises()
    expect(w.attributes('style')).toContain('height: 180px')
    expect(lastRO!.observe).toHaveBeenCalledWith(w.element)
    const fire = (width: number, height: number) =>
      lastRO!.cb([{ contentRect: { width, height } } as unknown as ResizeObserverEntry], lastRO as unknown as ResizeObserver)
    // observe 之后引擎立刻空回调一次,尺寸与实例一致 —— 这一下 resize() 会以 animation:{duration:0}
    // 的 payload 走 update,把每张图的首绘在首帧截断为零(C6-02,全站最大的一处硬伤)。
    fire(600, 300)
    expect(h.chart.resize).not.toHaveBeenCalled()
    fire(600.4, 299.6)   // 亚像素抖动,四舍五入后同尺寸
    expect(h.chart.resize).not.toHaveBeenCalled()
    fire(800, 300)       // 真窗口缩放才 resize(动画被截断是引擎行为,接受,不补播)
    expect(h.chart.resize).toHaveBeenCalledTimes(1)
    // ❗空批次:原生 RO 规范上不派发,polyfill / 替身会 —— 解构 entries[0] 再读 contentRect 就抛
    // TypeError,抛在观察者任务里,这一批别的图的 resize 一起被跳过且控制台只留一条未捕获错误
    expect(() => lastRO!.cb([], lastRO as unknown as ResizeObserver)).not.toThrow()
    expect(h.chart.resize).toHaveBeenCalledTimes(1)
    w.unmount()
    expect(h.chart.dispose).toHaveBeenCalled()
    expect(lastRO!.disconnect).toHaveBeenCalled()
  })

  // ── 动效注入通道(动效设计稿 §8.3,C6-02 / C6-03)。注入规则本身钉在 anaMotion.spec.ts,
  //    这里只钉「首绘走 enter、watch 走 update、屏级 entered 决定相位」这条通道。
  it('首绘走 enter 相:每系列 320 / quarticOut', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'line' }] } } })
    await flushPromises()
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration).toBe(320)
    expect(opt.series[0].animationEasing).toBe('quarticOut')
    w.unmount()
  })

  it('option 更新走 update 相:每系列 animationDuration 0 + animationDurationUpdate 200', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'line' }] } } })
    await flushPromises()
    h.chart.setOption.mockClear()
    await w.setProps({ option: { series: [{ type: 'line', data: [1] }] } })
    await nextTick()
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration).toBe(0)
    expect(opt.series[0].animationDurationUpdate).toBe(200)
    w.unmount()
  })

  it('屏侧顶层 animationDurationUpdate:0 压过注入的 200,并吸收进每个系列', async () => {
    const w = mount(AnaEChart, { props: { option: { animationDurationUpdate: 0, series: [{ type: 'bar' }, { type: 'line' }] } } })
    await flushPromises()
    const opt = h.chart.setOption.mock.calls[0][0] as { animationDurationUpdate: number; series: Record<string, unknown>[] }
    expect(opt.animationDurationUpdate).toBe(0)
    for (const s of opt.series) expect(s.animationDurationUpdate).toBe(0)
    w.unmount()
  })

  it("屏级 provide('anaEntered') 已为真(段控 / 抽屉 / v-if 重挂)→ 首挂就走更新相,永不重播入场", async () => {
    const w = mount(AnaEChart, {
      props: { option: { series: [{ type: 'bar', data: [1] }] } },
      global: { provide: { anaEntered: ref(true) } },
    })
    await flushPromises()
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration).toBe(0)
    w.unmount()
  })
})

// mobilizeOption 纯函数(设计稿 §03 移动化注入)。原则:只补屏侧没写的键,显式设置一律尊重。
// 结果按整键 toEqual 断言 —— 顺带锁住「没让它改的兄弟键一根毛都没动」。
describe('mobilizeOption', () => {
  const m = (o: object, isS: boolean) => mobilizeOption(o, isS) as Record<string, unknown>

  it('全档注入 tooltip.confine:true;显式 confine:false 尊重;数组形态跳过;无键不凭空造', () => {
    expect(m({ tooltip: { trigger: 'axis' } }, false).tooltip).toEqual({ trigger: 'axis', confine: true })
    expect(m({ tooltip: { confine: false } }, true).tooltip).toEqual({ confine: false })
    expect(m({ tooltip: [{ trigger: 'axis' }] }, true).tooltip).toEqual([{ trigger: 'axis' }])
    expect(m({}, true)).toEqual({})
  })

  it('isS:dataZoom 剔 slider 保 inside;剔空删键(数组与对象形态同);legend 未设 type 改 scroll', () => {
    expect(m({ dataZoom: [{ type: 'inside' }, { type: 'slider' }] }, true).dataZoom).toEqual([{ type: 'inside' }])
    expect('dataZoom' in m({ dataZoom: [{ type: 'slider' }] }, true)).toBe(false)
    expect('dataZoom' in m({ dataZoom: { type: 'slider' } }, true)).toBe(false)
    expect(m({ legend: {} }, true).legend).toEqual({ type: 'scroll' })
    expect(m({ legend: { type: 'plain' } }, true).legend).toEqual({ type: 'plain' })
  })

  it('isS:xAxis/yAxis(对象或数组)axisLabel 补 hideOverlap:true;已显式设不碰', () => {
    const r = m({ xAxis: { type: 'category' }, yAxis: [{ axisLabel: { hideOverlap: false } }, {}] }, true)
    expect(r.xAxis).toEqual({ type: 'category', axisLabel: { hideOverlap: true } })
    expect(r.yAxis).toEqual([{ axisLabel: { hideOverlap: false } }, { axisLabel: { hideOverlap: true } }])
  })

  it('isS:line/scatter symbolSize 三态 —— 数字+2、未设给 6、函数跳过;symbol:none 与非目标系列不碰', () => {
    const fn = (): number => 4
    const r = m({ series: [
      { type: 'line', symbolSize: 4 },
      { type: 'scatter' },
      { type: 'line', symbolSize: fn },
      { type: 'line', symbol: 'none' },
      { type: 'bar', symbolSize: 4 },
    ] }, true)
    expect(r.series).toEqual([
      { type: 'line', symbolSize: 6 },
      { type: 'scatter', symbolSize: 6 },
      { type: 'line', symbolSize: fn },
      { type: 'line', symbol: 'none' },
      { type: 'bar', symbolSize: 4 },
    ])
  })

  it('入参不被原地突变(option 来自屏侧 computed,突变会污染响应式源)', () => {
    const input = {
      tooltip: { trigger: 'axis' },
      legend: {},
      dataZoom: [{ type: 'inside' }, { type: 'slider' }],
      xAxis: { type: 'category' },
      yAxis: [{}],
      series: [{ type: 'line' }],
    }
    const snap = JSON.parse(JSON.stringify(input))
    m(input, true)
    expect(input).toEqual(snap)
  })

  it('isS=false:除 tooltip.confine 外零改动(桌面零视觉差异)', () => {
    const input = {
      tooltip: { trigger: 'axis' },
      legend: {},
      dataZoom: [{ type: 'slider' }],
      xAxis: { type: 'category' },
      series: [{ type: 'line', symbolSize: 4 }],
    }
    expect(m(input, false)).toEqual({ ...input, tooltip: { trigger: 'axis', confine: true } })
  })
})
