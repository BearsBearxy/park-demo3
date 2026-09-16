// motionize 纯函数单测(动效设计稿 §8.2/§8.3,C6-02~C6-06)。
// 这里钉的是**注入规则**,不是某张图好不好看:相位两套键、屏侧显式键的优先级、
// reduced / 离屏两条短路、错峰门槛。规则一改,54 张 AnaEChart 同时改。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref, type Ref } from 'vue'
import { DUR, EASE, STAGGER, motionize, useEnterPhase } from '../anaMotion'

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

// useEnterPhase:自绘图与 AnaEChart 共用的首绘判据(C6-25)。钉的是「这次挂载擦不擦」的三条否决
// —— 屏级 entered 已真(段控 / 抽屉 / v-if 重挂)、图不在视口内、标签页在后台。
// jsdom 的 getBoundingClientRect 全 0(bottom 0)本身就是「离屏」,所以每条用例自己桩 rect。
describe('useEnterPhase', () => {
  const setRect = (top: number, bottom: number) => {
    Element.prototype.getBoundingClientRect = () =>
      ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  }
  const setHidden = (v: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })

  // first 直接从 setup 里捞出来断言,不看渲染出的文本:first 在 onMounted 里翻转,
  // 那一帧的 DOM 还是挂载时的旧值(重渲染排在同一个 flush 里,浏览器里赶在绘制前,不闪)。
  let first: Ref<boolean> = ref(false)
  const Probe = defineComponent({
    setup() {
      const el = ref<Element | null>(null)
      first = useEnterPhase(el)
      return () => h('div', { ref: el })
    },
  })
  const probe = (enteredNow: boolean) => {
    const entered = ref(enteredNow)
    const w = mount(Probe, { global: { provide: { anaEntered: entered } } })
    return { w, entered }
  }

  it('首进屏 + 视口内 + 前台 → 擦;挂载后把屏级 entered 置真(纯自绘屏没有 AnaEChart 替它置)', async () => {
    setRect(0, 300); setHidden(false)
    const { w, entered } = probe(false)
    expect(first.value).toBe(true)
    expect(entered.value).toBe(false)     // 同一渲染批里挂载的图都还能拿到 enter
    await nextTick()
    expect(entered.value).toBe(true)
    w.unmount()
  })

  it('屏级 entered 已真(段控 / 抽屉 / v-if 重挂)→ 不擦,永不重播入场', () => {
    setRect(0, 300); setHidden(false)
    const { w } = probe(true)
    expect(first.value).toBe(false)
    w.unmount()
  })

  it('离屏(图顶在视口下沿之外)→ 不擦,滚到时已画好不补播(同 C6-06)', () => {
    setRect(innerHeight + 40, innerHeight + 340); setHidden(false)
    const { w } = probe(false)
    expect(first.value).toBe(false)
    w.unmount()
  })

  it('后台标签页(document.hidden)→ 不擦', () => {
    setRect(0, 300); setHidden(true)
    const { w } = probe(false)
    expect(first.value).toBe(false)
    setHidden(false)
    w.unmount()
  })

  it('❗KeepAlive 停用当场摘标志 —— 动画被取消只发 animationcancel,消费者的 animationend 收不到', async () => {
    // 擦入跑到一半点页签走人:KeepAlive 把整棵 DOM 挪进缓存容器,运行中的 CSS 动画被取消。
    // 标志留在 true 的话,切回该页签重插 DOM 就把「一生一次」的 320 擦入 / 120 淡入再播一遍。
    // 收在 useEnterPhase 里 = 七张自绘图(PvDayChart / PvConsumption / PvRevenueBars /
    // AnaForecastChart / AnaRenewalChart / AnaRentBandChart / AnaUnitRentHist)一起覆盖。
    setRect(0, 300); setHidden(false)
    const on = ref(true)
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (on.value ? h(Probe) : h('i')) }),
    })
    const w = mount(Host, { global: { provide: { anaEntered: ref(false) } } })
    expect(first.value, '首挂该擦').toBe(true)
    on.value = false
    await nextTick()
    expect(first.value, '停用没摘掉标志 → 回签重播入场').toBe(false)
    w.unmount()
  })
})
