// motionize 纯函数单测(动效设计稿 §8.2/§8.3,C6-02~C6-06)。
// 这里钉的是**注入规则**,不是某张图好不好看:相位两套键、屏侧显式键的优先级、
// reduced / 离屏两条短路、错峰门槛。规则一改,54 张 AnaEChart 同时改。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref, type Ref } from 'vue'
import { DUR, EASE, STAGGER, motionize, onReactivated, useEnterPhase, useMorphHold } from '../anaMotion'

type Rec = Record<string, unknown>
const ENV = { reduced: false, isS: false, visible: true }
const m = (o: Rec, phase: 'enter' | 'update', env: Partial<typeof ENV> = {}): Rec =>
  motionize(o, phase, { ...ENV, ...env }) as Rec
const ser = (r: Rec): Rec[] => r.series as Rec[]

describe('motionize', () => {
  it('enter 相:顶层与**每个系列**都 320 / quarticOut(逐系列是因为 getShallow 只在系列缺键时回落)', () => {
    const r = m({ series: [{ type: 'line' }, { type: 'pie' }] }, 'enter')
    expect(r.animationDuration).toBe(DUR.enter)
    expect(DUR.enter).toBe(320)
    for (const s of ser(r)) {
      expect(s.animationDuration).toBe(320)
      expect(s.animationEasing).toBe(EASE.enter)
      expect(s.animationEasing).toBe('quarticOut')
      expect(s.animationDelay).toBe(0)
      expect(s.animationDurationUpdate).toBe(DUR.update)
    }
  })

  it('update 相:每系列 animationDuration 0(新增元素瞬现,永不重播入场)+ animationDurationUpdate 200 cubicOut', () => {
    const r = m({ series: [{ type: 'bar', data: [1, 2] }, { type: 'treemap' }] }, 'update')
    expect(r.animationDuration).toBe(0)
    for (const s of ser(r)) {
      expect(s.animationDuration).toBe(0)
      expect(s.animationDurationUpdate).toBe(200)
      // update 相 animationEasing 也注 cubicOut —— TreemapView.js:219 更新读的是它,不是 EasingUpdate
      expect(s.animationEasing).toBe('cubicOut')
      expect(s.animationEasingUpdate).toBe('cubicOut')
      expect(s.animationDelay).toBe(0)
      expect(s.animationDelayUpdate).toBe(0)
      expect(s.animationDelay).not.toBeInstanceOf(Function)   // update 相不错峰
    }
  })

  it('屏侧**顶层**显式键压过注入,并吸收进每个系列(Breakeven 顶层 animationDurationUpdate:0 的用法)', () => {
    const r = m({ animationDurationUpdate: 0, series: [{ type: 'bar' }, { type: 'line' }] }, 'update')
    expect(r.animationDurationUpdate).toBe(0)
    for (const s of ser(r)) expect(s.animationDurationUpdate).toBe(0)
  })

  it('系列自带的键最优先(压过顶层与注入)', () => {
    const r = m({ animationDuration: 50, series: [{ type: 'line', animationDuration: 999, animationEasing: 'linear' }] }, 'enter')
    expect(ser(r)[0].animationDuration).toBe(999)
    expect(ser(r)[0].animationEasing).toBe('linear')
    expect(ser(r)[0].animationDurationUpdate).toBe(200)   // 没写的键仍拿注入值
  })

  it('reduced:顶层 animation:false + stateAnimation 0,且**逐系列** animation:false(treemap 系列默认 true 会压过顶层)', () => {
    const r = m({ series: [{ type: 'treemap' }, { type: 'bar', data: [1] }], stateAnimation: { duration: 300 } }, 'enter', { reduced: true })
    expect(r.animation).toBe(false)
    expect(r.stateAnimation).toEqual({ duration: 0 })
    for (const s of ser(r)) expect(s.animation).toBe(false)
    expect(ser(r)[0].animationDuration).toBeUndefined()   // 关了就不再注时长
  })

  it('离屏:逐系列 animation:false,但 stateAnimation **不动**(否则折叠区图表 hover 永远 0ms)', () => {
    const r = m({ series: [{ type: 'bar', data: [1] }], stateAnimation: { duration: 120 } }, 'enter', { visible: false })
    expect(r.animation).toBe(false)
    expect(ser(r)[0].animation).toBe(false)
    expect(r.stateAnimation).toEqual({ duration: 120 })
    expect('stateAnimation' in m({ series: [] }, 'enter', { visible: false })).toBe(false)
  })

  it('错峰:bar/scatter 且 data.length ≤ 24 且未显式设置才注入;封顶 12 根 = 144ms', () => {
    const delay = ser(m({ series: [{ type: 'bar', data: Array(24).fill(1) }] }, 'enter'))[0].animationDelay as (i: number) => number
    expect(typeof delay).toBe('function')
    expect(delay(0)).toBe(0)
    expect(delay(5)).toBe(60)
    expect(delay(23)).toBe(STAGGER.cap * STAGGER.step)   // 144:第 13 根起同 delay
    // 25 项不错峰(365 点整体起);line 不错峰;显式写了的不碰;update 相不错峰
    expect(ser(m({ series: [{ type: 'bar', data: Array(25).fill(1) }] }, 'enter'))[0].animationDelay).toBe(0)
    expect(ser(m({ series: [{ type: 'line', data: [1, 2] }] }, 'enter'))[0].animationDelay).toBe(0)
    expect(ser(m({ series: [{ type: 'bar', data: [1], animationDelay: 7 }] }, 'enter'))[0].animationDelay).toBe(7)
    expect(ser(m({ series: [{ type: 'scatter', data: [1] }] }, 'update'))[0].animationDelay).toBe(0)
  })

  it('S 档:enter 降到 200 无错峰、update 0(SVGRenderer 逐元素 DOM attr)', () => {
    const r = m({ series: [{ type: 'bar', data: [1, 2] }] }, 'enter', { isS: true })
    expect(ser(r)[0].animationDuration).toBe(DUR.update)
    expect(ser(r)[0].animationDelay).toBe(0)
    expect(ser(r)[0].animationDurationUpdate).toBe(0)
  })

  it('奇形 option 不炸:缺 series / 单对象 series / 非对象系列项', () => {
    expect(ser(m({}, 'enter'))).toEqual([])
    expect(ser(m({ series: { type: 'bar', data: [1] } }, 'enter'))).toHaveLength(1)
    expect(ser(m({ series: [null, 'x'] as unknown[] as Rec[] }, 'enter'))).toEqual([null, 'x'])
    expect(ser(m({ series: [null] as unknown[] as Rec[] }, 'enter', { reduced: true }))).toEqual([null])
  })
})

// rAF 手动推帧:「下一帧置真」「两帧后摘」都要数帧
let frames: FrameRequestCallback[] = []
const nextFrame = () => { const q = frames; frames = []; q.forEach((cb) => cb(0)) }
beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { frames.push(cb); return frames.length }))
})
afterEach(() => { vi.unstubAllGlobals() })

// 切页签:KeepAlive 里的子树换成 <i> = 停用,换回 = 重新激活。attachTo 让 DOM 真在文档里(isConnected)。
const keepAlive = (child: () => ReturnType<typeof h>) => {
  const on = ref(true)
  const Host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => (on.value ? child() : h('i')) }) })
  const w = mount(Host, { attachTo: document.body })
  return {
    w,
    away: async () => { on.value = false; await nextTick() },
    back: async () => { on.value = true; await nextTick() },
  }
}

// useEnterPhase:自绘图的擦入相(2026-09-16 行为矩阵)。钉的是「这次擦不擦」:挂载时的视口 / 前台判据、
// entrance:false、切回页签的重播与它的三条否决。
// jsdom 的 getBoundingClientRect 全 0(bottom 0)本身就是「离屏」,所以每条用例自己桩 rect。
describe('useEnterPhase', () => {
  const setRect = (top: number, bottom: number) => {
    Element.prototype.getBoundingClientRect = () =>
      ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  }
  const setHidden = (v: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })

  // first 直接从 setup 里捞出来断言,不看渲染出的文本
  let first: Ref<boolean> = ref(false)
  let opts: { entrance?: boolean } = {}
  const Probe = defineComponent({
    setup() {
      const el = ref<Element | null>(null)
      first = useEnterPhase(el, opts)
      return () => h('div', { ref: el })
    },
  })
  beforeEach(() => { opts = {}; setRect(0, 300); setHidden(false) })

  it('视口内挂载 → 擦;不看屏级标志(宿主里没有 AnaShell / provide 也擦)', () => {
    const w = mount(Probe)
    expect(first.value).toBe(true)
    w.unmount()
  })

  it('离屏(图顶在视口下沿之外)→ 不擦,滚到时已画好不补播(同 C6-06)', () => {
    setRect(innerHeight + 40, innerHeight + 340)
    const w = mount(Probe)
    expect(first.value).toBe(false)
    w.unmount()
  })

  it('后台标签页(document.hidden)→ 不擦', () => {
    setHidden(true)
    const w = mount(Probe)
    expect(first.value).toBe(false)
    setHidden(false)
    w.unmount()
  })

  it('entrance:false(抽屉 / 弹窗里的图)→ 挂载不擦,切回页签也不擦', async () => {
    opts = { entrance: false }
    const k = keepAlive(() => h(Probe))
    expect(first.value, '挂载').toBe(false)
    await k.away(); await k.back(); nextFrame()
    expect(first.value, '切回').toBe(false)
    k.w.unmount()
  })

  it('❗KeepAlive 停用当场摘标志 —— 动画被取消只发 animationcancel,消费者的 animationend 收不到', async () => {
    // 擦入跑到一半点页签走人:标志留在 true 的话,DOM 回来时类名没变过,CSS 动画不会按「重新挂类」重启,
    // 重播就变成随缘。收在 useEnterPhase 里 = 七张自绘图一起覆盖。
    const k = keepAlive(() => h(Probe))
    expect(first.value, '首挂该擦').toBe(true)
    await k.away()
    expect(first.value, '停用没摘掉标志').toBe(false)
    k.w.unmount()
  })

  it('切回页签 + 视口内 → 下一帧才置真(先假后真,wipe 类重新挂上才重播)', async () => {
    const k = keepAlive(() => h(Probe))
    await k.away(); await k.back()
    expect(first.value, '同一帧就置真 = 类名没摘过').toBe(false)
    nextFrame()
    expect(first.value, '切回没重播').toBe(true)
    k.w.unmount()
  })

  it('切回页签但离屏 → 不擦', async () => {
    const k = keepAlive(() => h(Probe))
    await k.away()
    setRect(innerHeight + 40, innerHeight + 340)
    await k.back(); nextFrame()
    expect(first.value).toBe(false)
    k.w.unmount()
  })

  it('帧内又被停用(连点页签)→ 那一帧不再置真', async () => {
    const k = keepAlive(() => h(Probe))
    await k.away(); await k.back(); await k.away()
    nextFrame()
    expect(first.value).toBe(false)
    k.w.unmount()
  })
})

// onReactivated:AnaEChart 与 useEnterPhase 共用的「切回页签」判据
describe('onReactivated', () => {
  it('KeepAlive 根挂载时伴随的那次 activated 不算;停用后再激活才调,每次切回都调', async () => {
    const fn = vi.fn()
    const Probe = defineComponent({ setup() { onReactivated(fn); return () => h('b') } })
    const k = keepAlive(() => h(Probe))
    await nextTick()
    expect(fn, '挂载伴随的那次被当成切回').not.toHaveBeenCalled()
    await k.away(); await k.back()
    expect(fn).toHaveBeenCalledTimes(1)
    await k.away(); await k.back()
    expect(fn).toHaveBeenCalledTimes(2)
    k.w.unmount()
  })

  it('❗页签停用期间才挂上的后代(数据在后台到)→ 第一次切回就调,不用再切一趟', async () => {
    const fn = vi.fn()
    const late = ref(false)
    const Probe = defineComponent({ setup() { onReactivated(fn); return () => h('b') } })
    const Screen = defineComponent({ setup: () => () => h('div', [late.value ? h(Probe) : null]) })
    const k = keepAlive(() => h(Screen))
    await k.away()
    late.value = true
    await nextTick()
    expect(fn, '挂在缓存容器里就被调了').not.toHaveBeenCalled()
    await k.back()
    expect(fn, '用户第一次看见它,却没当成切回').toHaveBeenCalledTimes(1)
    k.w.unmount()
  })
})

// useMorphHold:形变压制开关。钉「改宽与 hold 落在同一次渲染」「两帧后才摘」「wipe 期间常开」。
describe('useMorphHold', () => {
  const width = ref(480)
  const first = ref(false)
  let hold: Ref<boolean> = ref(false)
  let renders: [number, boolean][] = []
  const Probe = defineComponent({
    setup() {
      hold = useMorphHold(width, first)
      return () => { renders.push([width.value, hold.value]); return h('g') }
    },
  })
  beforeEach(() => { width.value = 480; first.value = false; renders = [] })

  it('宽度变了 → 新宽度第一次渲染时 hold 已为真(同一次 patch),两帧后才摘', async () => {
    const w = mount(Probe)
    expect(hold.value).toBe(false)
    width.value = 900
    await nextTick()
    expect(renders.filter(([wd]) => wd === 900).every(([, hd]) => hd), '新几何先于 hold 落地 → 那一帧会形变').toBe(true)
    expect(hold.value).toBe(true)
    nextFrame()
    expect(hold.value, '一帧就摘:rAF 阶段早于同帧样式计算,过渡会被放回来').toBe(true)
    nextFrame()
    expect(hold.value).toBe(false)
    w.unmount()
  })

  it('wipe 进行中(first 为真)→ hold 常开,不看宽度', () => {
    first.value = true
    const w = mount(Probe)
    expect(hold.value).toBe(true)
    first.value = false
    expect(hold.value).toBe(false)
    w.unmount()
  })
})
