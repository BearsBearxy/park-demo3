// AnaEChart 薄封装单测(jsdom 无 canvas → 整体 mock ./echartsBundle;屏组组件测试沿用此规约):
// init('fpAnaTheme') / 主题注册 / setOption(notMerge) / option 更新 / click 透传 / resize / dispose / S 档图高降档。
// ⚠ 桩掉的是整个装配模块,所以「注册清单是否漏项」本测试**零覆盖** —— 只能在浏览器里看控制台。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h as vh, KeepAlive, nextTick, ref } from 'vue'

const h = vi.hoisted(() => {
  // getWidth/getHeight 是 C6-02 的 RO 守卫要读的(尺寸真变才 resize),按 ChartInst 契约桩上
  const chart = { setOption: vi.fn(), getOption: vi.fn((): Record<string, unknown> => ({})), resize: vi.fn(), clear: vi.fn(), dispose: vi.fn(), on: vi.fn(), getWidth: vi.fn(() => 600), getHeight: vi.fn(() => 300) }
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
const rectAt = (top: number) => () =>
  ({ top, bottom: top + 300, left: 0, right: 600, width: 600, height: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
const ON_SCREEN = rectAt(0)
const OFF_SCREEN = rectAt(innerHeight + 40)
Element.prototype.getBoundingClientRect = ON_SCREEN

import AnaEChart, { mobilizeOption } from '../AnaEChart.vue'
import AnaSkelChart from '../AnaSkelChart.vue'
import { chartHeightFor } from '../anaChartHeight'
import { DUR } from '../anaMotion'
import { CALLOUT, calloutMark } from '../anaTheme'

// 入场窗口按 performance.now 算:桩成手动时钟,later(ms) 往前拨
let clock = 1000
const later = (ms: number) => { clock += ms }

beforeEach(() => {
  vi.clearAllMocks()
  lastRO = null
  Element.prototype.getBoundingClientRect = ON_SCREEN
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

// S 档桩:matchMedia 只让 ≤600 命中(jsdom 的 matchMedia 一律 matches:false = 非 S 档)
const withS = async (fn: () => Promise<void> | void) => {
  const orig = window.matchMedia
  window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('max-width') }) as MediaQueryList)
  try { await fn() } finally { window.matchMedia = orig }
}

describe('AnaEChart', () => {
  it('懒加载后 init(el, fpAnaTheme) + setOption(notMerge);主题注册幂等(全局仅一次)', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar' }] } } })
    const box = w.find('.ana-echart')
    expect(box.classes()).toContain('loading')   // 加载中占位
    await flushPromises()
    // 第三参是 2026-08-20 修「每个图都很糊」的核心:非整数 DPR(Windows 125% 缩放 → 1.14)
    // 会让 canvas 背景缓冲落在小数像素上、整张被重采样。ceil 且下限 2 = 2 倍超采样。
    // 断言 ≥2 而不是断言等于某个数:CI 与本机 devicePixelRatio 不同,写死会随环境红。
    expect(h.init).toHaveBeenCalledWith(box.element, 'fpAnaTheme',
      expect.objectContaining({ devicePixelRatio: expect.any(Number) }))
    const dpr = (h.init.mock.calls[0] as unknown[])[2] as { devicePixelRatio: number }
    expect(dpr.devicePixelRatio).toBeGreaterThanOrEqual(2)
    expect(Number.isInteger(dpr.devicePixelRatio)).toBe(true)
    // 注入动效键后不再逐字相等(动效设计稿 §8.3 明写改 objectContaining);键值本身见下面三条与 anaMotion.spec.ts
    expect(h.chart.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ series: [expect.objectContaining({ type: 'bar' })] }), { notMerge: true })
    expect(box.classes()).not.toContain('loading')
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

  // 图上点标注(anaTheme.calloutMark,设计稿方案 A):气泡是 HTML 叠层,动画走完('finished')才按点的像素摆好显出来
  describe('点标注气泡', () => {
    const CALLOUT_OPT = {
      series: [{ type: 'line', markPoint: calloutMark(CALLOUT.red, '#E24B4A', [{ coord: [11, -63.6], lines: ['收入为负', '2倍残差'] }], 'bottom') }],
    }
    const fire = (ev: string, arg?: unknown) => {
      for (const c of h.chart.on.mock.calls.filter((x) => x[0] === ev)) (c[1] as (p: unknown) => void)(arg)
    }
    const withPixel = (px: number[] | null) => {
      const c = h.chart as typeof h.chart & { convertToPixel?: unknown; containPixel?: unknown }
      c.convertToPixel = vi.fn(() => px ?? [0, 0])
      c.containPixel = vi.fn(() => px != null)
    }

    it('❗setOption 时藏着,finished 后按点的像素摆到点下方并显出;字逐行照 lines', async () => {
      withPixel([262, 159])
      const w = mount(AnaEChart, { props: { option: CALLOUT_OPT } })
      await flushPromises()
      const b = () => w.find('.ana-callout')
      expect(b().exists()).toBe(true)
      expect(b().classes()).not.toContain('on')
      fire('finished')
      await flushPromises()
      expect(b().classes()).toEqual(expect.arrayContaining(['on', 'bottom']))
      expect(b().findAll('.l').map((x) => x.text())).toEqual(['收入为负', '2倍残差'])
      // jsdom 量出的气泡是 0×0:居中在点上 → left = 262,上沿 = 159 + 13.5
      expect(b().attributes('style')).toContain('left: 262px')
      expect(b().attributes('style')).toContain('top: 172.5px')
      w.unmount()
    })

    it('❗拖选缩放一开始就藏;缩放完点落在绘图区外不再显', async () => {
      withPixel([262, 159])
      const w = mount(AnaEChart, { props: { option: CALLOUT_OPT } })
      await flushPromises()
      fire('finished'); await flushPromises()
      expect(w.find('.ana-callout').classes()).toContain('on')
      fire('datazoom'); await flushPromises()
      expect(w.find('.ana-callout').classes()).not.toContain('on')
      withPixel(null)
      fire('finished'); await flushPromises()
      expect(w.find('.ana-callout').classes()).not.toContain('on')
      w.unmount()
    })

    it('option 换了 → 旧气泡立刻藏,等新一轮 finished', async () => {
      withPixel([100, 120])
      const w = mount(AnaEChart, { props: { option: CALLOUT_OPT } })
      await flushPromises()
      fire('finished'); await flushPromises()
      await w.setProps({ option: { ...CALLOUT_OPT, grid: { top: 40 } } })
      await nextTick()
      expect(w.find('.ana-callout').classes()).not.toContain('on')
      w.unmount()
    })

    it('option 里没有点标注 → 不出叠层', async () => {
      const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar' }] } } })
      await flushPromises()
      fire('finished'); await flushPromises()
      expect(w.find('.ana-callout').exists()).toBe(false)
      w.unmount()
    })
  })

  it('S 档(matchMedia ≤600 命中)图高降档:lg300→260;挂载时一次初判,不挂 resize 监听', () => withS(async () => {
    const w = mount(AnaEChart, { props: { option: {}, height: 300 } })
    await flushPromises()
    expect(w.find('.ana-echart').attributes('style')).toContain('height: 260px')
    w.unmount()
  }))

  it('chartHeightFor:S 档五档映射 xl/lg→260、md→220、sm→180、xs→150,档外原样;非 S 档一律原样', async () => {
    const TIERS = [440, 300, 250, 200, 170, 123]
    expect(TIERS.map((t) => chartHeightFor(t))).toEqual(TIERS)
    await withS(() => { expect(TIERS.map((t) => chartHeightFor(t))).toEqual([260, 260, 220, 180, 150, 123]) })
  })

  it('❗AnaSkelChart(顶替 AnaEChart 的骨架)与图同表降档 —— 否则 ≤600 数据到的那一帧整页跳', () => withS(() => {
    const w = mount(AnaSkelChart, { props: { height: 200 } })
    expect(w.classes()).toContain('fp-shim')
    expect(w.attributes('style')).toContain('height: 180px')
    w.unmount()
  }))

  it('ResizeObserver 只在尺寸**真变**时 resize;卸载 dispose + 断开观察', async () => {
    const w = mount(AnaEChart, { props: { option: {}, height: 180 } })
    await flushPromises()
    expect(w.find('.ana-echart').attributes('style')).toContain('height: 180px')
    expect(lastRO!.observe).toHaveBeenCalledWith(w.find('.ana-echart').element)
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
    // ❗0×0 = KeepAlive 停用(DOM 进了脱离文档的缓存容器)。跟着缩到 0 的话,切回时 RO 报真尺寸
    // → resize 的 duration 0 payload 把刚起步的重播入场截断成终态
    fire(0, 0)
    expect(h.chart.resize, '停用时缩到 0 → 切回那次 resize 截断重播').toHaveBeenCalledTimes(1)
    // ❗空批次:原生 RO 规范上不派发,polyfill / 替身会 —— 解构 entries[0] 再读 contentRect 就抛
    // TypeError,抛在观察者任务里,这一批别的图的 resize 一起被跳过且控制台只留一条未捕获错误
    expect(() => lastRO!.cb([], lastRO as unknown as ResizeObserver)).not.toThrow()
    expect(h.chart.resize).toHaveBeenCalledTimes(1)
    w.unmount()
    expect(h.chart.dispose).toHaveBeenCalled()
    expect(lastRO!.disconnect).toHaveBeenCalled()
  })

  // ── 动效注入通道(动效设计稿 §8.3,C6-02 / C6-03)。注入规则本身钉在 anaMotion.spec.ts,
  //    这里只钉「挂载即走 enter、入场 320 之后的 watch 走 update」这条通道(屏级 entered 已删)。
  it('挂载即入场:每系列 320 / quarticOut;同一宿主里后挂上的图(切子屏 / 空态↔图)照样入场', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'line' }] } } })
    await flushPromises()
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration).toBe(320)
    expect(opt.series[0].animationEasing).toBe('quarticOut')
    // 切子屏:key 换 = 旧图卸、新图挂。旧规则(屏级 entered)下新图走更新相、零入场
    const tab = ref('a')
    const Host = defineComponent({ setup: () => () => vh(AnaEChart, { key: tab.value, option: { series: [{ type: 'bar', data: [1] }] } }) })
    const w2 = mount(Host)
    await flushPromises()
    tab.value = 'b'
    await flushPromises()
    const last = h.chart.setOption.mock.calls.at(-1)![0] as { series: Record<string, unknown>[] }
    expect(h.init.mock.calls.length, '没有真的重挂').toBe(3)
    expect(last.series[0].animationDuration, '切子屏新挂的图没入场').toBe(320)
    w2.unmount(); w.unmount()
  })

  it('option 更新走 update 相:每系列 animationDuration 0 + animationDurationUpdate 200', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'line' }] } } })
    await flushPromises()
    h.chart.setOption.mockClear()
    later(DUR.enter)   // 入场已播完
    await w.setProps({ option: { series: [{ type: 'line', data: [1] }] } })
    await nextTick()
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration).toBe(0)
    expect(opt.series[0].animationDurationUpdate).toBe(200)
    w.unmount()
  })

  it('❗带 dataZoom 的图换 option:照新 option 下发(watch 的 oldValue 不许被当成回签留存的视图状态)', async () => {
    const w = mount(AnaEChart, { props: { option: { dataZoom: [{ type: 'inside' }], legend: { top: 0 }, series: [{ type: 'bar', data: [1] }] } } })
    await flushPromises()
    h.chart.setOption.mockClear()
    await w.setProps({ option: { dataZoom: [{ type: 'inside', start: 10 }], legend: { top: 4 }, series: [{ type: 'bar', data: [2] }] } })
    await nextTick()
    expect(h.chart.setOption).toHaveBeenCalledTimes(1)
    const opt = h.chart.setOption.mock.calls[0][0] as { dataZoom: unknown; legend: unknown }
    expect(opt.dataZoom).toEqual([{ type: 'inside', start: 10 }])
    expect(opt.legend).toEqual({ top: 4 })
    w.unmount()
  })

  it('❗入场 320 内到的 option(回签静默重取 / 两趟到数)仍走 enter 相 —— update 相会让折线裁剪当场跳满', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'line', data: [1] }] } } })
    await flushPromises()
    h.chart.setOption.mockClear()
    later(DUR.enter - 20)
    await w.setProps({ option: { series: [{ type: 'line', data: [2] }] } })
    await nextTick()
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration, '入场途中被更新相截断').toBe(320)
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

  it('entrance=false(抽屉 / 弹窗里的图)→ 首挂走更新相,瞬现', async () => {
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar', data: [1] }] }, entrance: false } })
    await flushPromises()
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration).toBe(0)
    w.unmount()
  })

  it('离屏挂载 → 关动画瞬到(C6-06),不补播', async () => {
    Element.prototype.getBoundingClientRect = OFF_SCREEN
    const w = mount(AnaEChart, { props: { option: { series: [{ type: 'bar', data: [1] }] } } })
    await flushPromises()
    const opt = h.chart.setOption.mock.calls[0][0] as { animation: unknown; series: Record<string, unknown>[] }
    expect(opt.animation).toBe(false)
    expect(opt.series[0].animation).toBe(false)
    w.unmount()
  })
})

// 切回页签(KeepAlive 重新激活):视口内的图 clear 后按 enter 相重下发。
describe('AnaEChart 切回页签', () => {
  const OPT = { series: [{ type: 'bar', data: [1] }] }
  const tabbed = async (props: { option: object; entrance?: boolean }) => {
    const on = ref(true)
    const Host = defineComponent({ setup: () => () => vh(KeepAlive, null, { default: () => (on.value ? vh(AnaEChart, props) : vh('i')) }) })
    const w = mount(Host, { attachTo: document.body })
    await flushPromises()
    expect(h.chart.setOption, '挂载只下发一次').toHaveBeenCalledTimes(1)
    h.chart.setOption.mockClear()
    return {
      w,
      away: async () => { on.value = false; await nextTick() },
      back: async () => { on.value = true; await nextTick() },
    }
  }

  it('视口内 → 先 clear 再按 enter 相(320)重下发;每次切回都重播', async () => {
    const t = await tabbed({ option: OPT })
    expect(h.chart.clear, '挂载伴随的 activated 被当成切回').not.toHaveBeenCalled()
    await t.away(); await t.back()
    expect(h.chart.clear).toHaveBeenCalledTimes(1)
    expect(h.chart.setOption).toHaveBeenCalledTimes(1)
    expect(h.chart.clear.mock.invocationCallOrder[0]).toBeLessThan(h.chart.setOption.mock.invocationCallOrder[0])
    const opt = h.chart.setOption.mock.calls[0][0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration, '切回没走入场相').toBe(320)
    await t.away(); await t.back()
    expect(h.chart.clear).toHaveBeenCalledTimes(2)
    t.w.unmount()
  })

  it('切回时离屏 → 不重播', async () => {
    const t = await tabbed({ option: OPT })
    await t.away()
    Element.prototype.getBoundingClientRect = OFF_SCREEN
    await t.back()
    expect(h.chart.clear).not.toHaveBeenCalled()
    expect(h.chart.setOption).not.toHaveBeenCalled()
    t.w.unmount()
  })

  it('减动效 → 不重播', async () => {
    const orig = window.matchMedia
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('reduced-motion') }) as MediaQueryList)
    try {
      const t = await tabbed({ option: OPT })
      await t.away(); await t.back()
      expect(h.chart.clear).not.toHaveBeenCalled()
      t.w.unmount()
    } finally {
      window.matchMedia = orig
    }
  })

  it('entrance=false → 不重播', async () => {
    const t = await tabbed({ option: OPT, entrance: false })
    await t.away(); await t.back()
    expect(h.chart.clear).not.toHaveBeenCalled()
    t.w.unmount()
  })

  it('❗离开期间容器改了尺寸 → 先 resize 再 clear 重播(否则随后的 RO resize 把重播截成终态)', async () => {
    const t = await tabbed({ option: OPT })
    const box = t.w.find('.ana-echart').element
    await t.away()
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 300 })
    await t.back()
    expect(h.chart.resize).toHaveBeenCalledTimes(1)
    expect(h.chart.resize.mock.invocationCallOrder[0]).toBeLessThan(h.chart.clear.mock.invocationCallOrder[0])
    // 尺寸没变(与实例一致)→ 不 resize
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 600 })
    await t.away(); await t.back()
    expect(h.chart.resize).toHaveBeenCalledTimes(1)
    expect(h.chart.clear).toHaveBeenCalledTimes(2)
    t.w.unmount()
  })

  it('❗重播留住用户拖出的缩放窗口与点掉的图例(clear + notMerge 会一起清掉)', async () => {
    const t = await tabbed({ option: { ...OPT, legend: { top: 0 }, dataZoom: [{ type: 'inside' }, { type: 'slider', height: 12 }] } })
    h.chart.getOption.mockReturnValue({
      dataZoom: [{ type: 'inside', start: 20, end: 55 }, { type: 'slider', start: 20, end: 55 }],
      legend: [{ selected: { 收入: true, 利润: false } }],
    })
    await t.away(); await t.back()
    const opt = h.chart.setOption.mock.calls[0][0] as { dataZoom: Record<string, unknown>[]; legend: Record<string, unknown> }
    expect(opt.dataZoom).toEqual([{ type: 'inside', start: 20, end: 55 }, { type: 'slider', height: 12, start: 20, end: 55 }])
    expect(opt.legend).toEqual({ top: 0, selected: { 收入: true, 利润: false } })
    h.chart.getOption.mockReturnValue({})
    t.w.unmount()
  })

  it('❗页签停用期间才挂上的图 → 第一次切回就重播', async () => {
    const on = ref(true)
    const late = ref(false)
    const Screen = defineComponent({ setup: () => () => vh('div', [late.value ? vh(AnaEChart, { option: OPT }) : null]) })
    const Host = defineComponent({ setup: () => () => vh(KeepAlive, null, { default: () => (on.value ? vh(Screen) : vh('i')) }) })
    const w = mount(Host, { attachTo: document.body })
    await flushPromises()
    on.value = false; await nextTick()
    late.value = true
    await flushPromises()   // 在缓存容器里 init + 首绘
    expect(h.chart.setOption).toHaveBeenCalledTimes(1)
    on.value = true; await nextTick()
    expect(h.chart.clear, '第一次切回没重播').toHaveBeenCalledTimes(1)
    const opt = h.chart.setOption.mock.calls.at(-1)![0] as { series: Record<string, unknown>[] }
    expect(opt.series[0].animationDuration).toBe(320)
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
