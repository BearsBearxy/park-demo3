// 分析图表冒烟:mount 不炸 + 关键 SVG 元素存在(jsdom 无 ResizeObserver → useWidth 回退初始宽)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import AnaBarRow from '../AnaBarRow.vue'
import AnaBullet from '../AnaBullet.vue'
import AnaSpark from '../AnaSpark.vue'
import AnaTrend from '../AnaTrend.vue'
import AnaEmpty from '../AnaEmpty.vue'
import { peakTag, trendTag } from '../anaFmt'

// AnaEmpty 自 P5 起要看「这个人看不看得见目标屏所在的层」→ 需要 auth store
beforeEach(() => setActivePinia(createPinia()))

describe('图表原语冒烟', () => {
  it('AnaBullet:每行底轨 + 值条 + 目标线', () => {
    const w = mount(AnaBullet, { props: { rows: [{ name: 'A', value: 88 }], target: 90, max: 100 } })
    expect(w.findAll('rect').length).toBe(2)
    expect(w.findAll('path').length).toBe(1)   // 目标线:path(<line> 端点过渡不了)
    expect(w.text()).toContain('目标线')
  })

  it('AnaTrend:今年实线 + 去年虚线 + 图例', () => {
    const w = mount(AnaTrend, { props: { labels: ['1月', '2月', '3月'], cur: [1, 2, 3], prev: [1, 1, 2] } })
    expect(w.findAll('path').length).toBe(3)   // prev + area + cur
    expect(w.text()).toContain('去年同期')
  })

  const emptyCard = () => mount(AnaEmpty, {
    props: { label: '合同日期未录入', hint: '去补录', to: '/contracts', toText: '去合同管理' },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })

  it('AnaEmpty:空态卡带深链', () => {
    const w = emptyCard()
    expect(w.text()).toContain('合同日期未录入')
    expect(w.text()).toContain('去合同管理')
  })

  // ❗§6:园区股东只有经营分析层,/contracts 在数据层 —— 给他这条链接等于把他送进一个
  //   侧边栏没有入口的屏。破坏验证:把 canGo 改成 `!!props.to` → 红。
  it('❗看不见目标屏所在层的人不给「去录入」链接,但缺什么数照说', () => {
    useAuthStore().navLayers = ['analysis']
    const w = emptyCard()
    expect(w.find('a').exists(), '股东进不去合同屏').toBe(false)
    expect(w.text(), '说明文字不该跟着链接一起消失').toContain('合同日期未录入')
    expect(w.text()).toContain('去补录')
  })

  // ❗C6-19:条长靠 --pct 驱动 ana.css 的 clip-path,fill 自己常驻 width:100%。
  //   内联再写 width 就回到布局属性(原则 3),而漏写 --pct 会让 inset(0 100%) 把整条裁没。
  it('❗AnaBarRow:条长写进 --pct(带单位),不内联 width', () => {
    const fill = mount(AnaBarRow, { props: { name: 'A座', value: 37, max: 100 } }).find('.ak-bar-fill')
    expect(fill.attributes('style')).toContain('--pct: 37%')
    expect(fill.attributes('style'), 'width 是布局属性,不该再出现在内联里').not.toContain('width')
  })
})

// 2026-09-16 矩阵:换年 / 换期不重挂,同键 200 形变。jsdom 不跑 CSS 过渡,钉的是前提:
// 同一个 DOM 节点换几何属性、落在 .ana-morph 下、十字线不在形变组里、键变了换新节点、改宽挂 hold。
describe('小图换数形变', () => {
  let ros: ResizeObserverCallback[] = []
  let frames: FrameRequestCallback[] = []
  const nextFrame = async () => { const q = frames; frames = []; q.forEach((cb) => cb(0)); await nextTick() }
  beforeEach(() => {
    ros = []
    frames = []
    vi.stubGlobal('ResizeObserver', class { constructor(cb: ResizeObserverCallback) { ros.push(cb) } observe() {} disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const inMorph = (el: Element) => el.closest('.ana-morph') != null

  it('❗AnaSpark:同点数换数 → 同一条 path 换 d;点数一变 → 线和末点一起换新节点(末点不在线外滑)', async () => {
    const w = mount(AnaSpark, { props: { series: [1, 3, 2, 5] } })
    const path = w.find('path').element
    const d0 = path.getAttribute('d')
    await w.setProps({ series: [2, 1, 4, 3] })
    expect(w.find('path').element, '换数重建了节点 = 没有过渡').toBe(path)
    expect(path.getAttribute('d')).not.toBe(d0)
    expect(inMorph(path) && inMorph(w.find('circle').element)).toBe(true)
    await w.setProps({ series: [2, 1, 4, 3, 6] })
    expect(w.find('path').element, '点数变了 d 插值不了,旧末点会从旧位置滑过去').not.toBe(path)
  })

  it('❗AnaTrend:同点数换数 → 同一条 path 换 d;十字线与高亮点不在形变组里(悬停 0ms)', async () => {
    const w = mount(AnaTrend, { props: { labels: ['1月', '2月', '3月'], cur: [1, 2, 3], prev: [1, 1, 2] } })
    const cur = w.findAll('path')[2].element
    const d0 = cur.getAttribute('d')
    await w.setProps({ cur: [3, 1, 2] })
    expect(w.findAll('path')[2].element).toBe(cur)
    expect(cur.getAttribute('d')).not.toBe(d0)
    expect(w.findAll('path').every((p) => inMorph(p.element)), '三条数据路径都该在形变组里').toBe(true)
    await w.find('div[style*="crosshair"]').trigger('pointermove', { clientX: 260 })
    expect(w.findAll('circle').length, '十字线没出来').toBe(2)
    expect(w.findAll('circle').some((c) => inMorph(c.element)), '十字线会跟着形变').toBe(false)
  })

  it('❗AnaBullet:同一项留在同一行才复用节点;上面少一行、下面的上移 → 换新节点,不从别的项滑过来', async () => {
    const rows = (a: number, b: number, c: number) => [{ name: '收入', value: a }, { name: '成本费用', value: b }, { name: '利润', value: c }]
    const w = mount(AnaBullet, { props: { rows: rows(90, 105, 80), target: 100 } })
    const bar0 = () => w.findAll('svg > g')[0].findAll('rect')[1].element
    const first = bar0()
    const w0 = first.getAttribute('width')
    await w.setProps({ rows: rows(95, 100, 85) })
    expect(bar0(), '同一项换数重建了节点 = 没有过渡').toBe(first)
    expect(first.getAttribute('width')).not.toBe(w0)
    const tgt = w.findAll('svg > g')[0].find('path').element
    expect(inMorph(first) && inMorph(tgt), '条 / 目标线不在形变组里').toBe(true)
    await w.setProps({ rows: rows(95, 100, 85).slice(1) })
    expect(bar0(), '收入那根条被拿去画成本费用 = 不同项之间形变').not.toBe(first)
  })

  it.each([
    { name: 'AnaBullet', mk: () => mount(AnaBullet, { props: { rows: [{ name: 'A', value: 88 }], target: 90, max: 100 } }) },
    { name: 'AnaTrend', mk: () => mount(AnaTrend, { props: { labels: ['1月', '2月', '3月'], cur: [1, 2, 3] } }) },
  ])('❗$name:改宽 → 形变组挂 hold(瞬算),两帧后摘', async ({ mk }) => {
    const w = mk()
    await nextTick()
    const held = () => w.findAll('.ana-morph').map((g) => g.classes('hold'))
    expect(held()).toEqual([false])
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(700)
    ros.forEach((cb) => cb([], {} as ResizeObserver))
    await nextTick()
    expect(held(), '改宽那一帧在形变 = 窗口一拖条 / 线在追').toEqual([true])
    await nextFrame(); await nextFrame()
    expect(held()).toEqual([false])
  })

  // C6-19:条长靠内联 --pct 驱动 ana.css 的 clip-path 200(本机 Chromium 实测 --pct 一改 clip-path 就起过渡)。
  // 前提是换期时 fill 还是同一个节点 —— 节点一换,新节点没有「改前」的值,过渡不起。
  it('❗AnaBarRow:换数 → 同一个 .ak-bar-fill 节点改 --pct', async () => {
    const w = mount(AnaBarRow, { props: { name: 'A座', value: 37, max: 100 } })
    const fill = w.find('.ak-bar-fill').element
    await w.setProps({ value: 81 })
    expect(w.find('.ak-bar-fill').element, 'fill 被重建 = clip-path 不过渡').toBe(fill)
    expect(fill.getAttribute('style')).toContain('--pct: 81%')
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
