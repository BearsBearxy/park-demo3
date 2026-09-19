// 四张非光伏自绘图的动效接线(2026-09-16 行为矩阵):擦入被取消也摘类、改宽挂 hold、换数同键形变。
// 过渡本身 jsdom 跑不出来(不加载 CSS)—— 这里钉的是过渡成立的前提:
//   元素复用(同一个 DOM 节点换几何属性)、落在 .ana-morph 下、悬停层不在形变组里、结构变了就换新节点。
// 「几何属性真的会过渡」已在本机 Chromium 实测(见 ana.css .ana-morph 头注)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AnaForecastChart from '../AnaForecastChart.vue'
import AnaRentBandChart from '../AnaRentBandChart.vue'
import AnaRenewalChart from '../AnaRenewalChart.vue'
import AnaUnitRentHist from '../AnaUnitRentHist.vue'
import AnaBullet from '../AnaBullet.vue'
import AnaTrend from '../AnaTrend.vue'
import AnaBarRows from '../AnaBarRows.vue'
import { rollingForecastRows } from '@/views/analysis/forecastChart.logic'
import type { RentBandCol } from '@/views/analysis/rentBandChart.logic'
import type { PnlSummary } from '@/analysis/anaData'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvedTheme } from '@/stores/appearance'

// jsdom 无 ResizeObserver:桩记下回调,手动改宽
let ros: ResizeObserverCallback[] = []
class ROStub {
  constructor(cb: ResizeObserverCallback) { ros.push(cb) }
  observe() {} unobserve() {} disconnect() {}
}
// useWidth 系(AnaBullet / AnaTrend)读 clientWidth,其余读 contentRect —— 两样一起给
const resizeTo = (width: number) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  ros.forEach((cb) => cb([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver))
}

// rAF 手动推帧(useMorphHold 两帧后摘 hold)
let frames: FrameRequestCallback[] = []
const nextFrame = async () => { const q = frames; frames = []; q.forEach((cb) => cb(0)); await nextTick() }

beforeEach(() => {
  ros = []
  frames = []
  vi.stubGlobal('ResizeObserver', ROStub)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ── 夹具 ─────────────────────────────────────────────── */
const pnl = (revenue: (number | null)[]): PnlSummary => ({
  year: 2025, months: revenue.flatMap((v, i) => (v == null ? [] : [i + 1])), revenue,
  cost: new Array(12).fill(null), profit: new Array(12).fill(null), bySchedule: {},
})
const REV6 = [7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20]
const pad12 = (a: number[]) => [...a, ...new Array(12 - a.length).fill(null)]
const fRows = (rev: number[]) => rollingForecastRows(pnl(pad12(rev)))

const bandCols = (k = 1): RentBandCol[] => [
  ...Array.from({ length: 12 }, (_, i) => ({
    month: `2025-${String(i + 1).padStart(2, '0')}`, realized: (330 - i * 1.5) * k, locked: null, mid: null, lo: null, hi: null,
  })),
  ...Array.from({ length: 12 }, (_, i) => {
    const locked = (312 - i * 8) * k
    return { month: `2026-${String(i + 1).padStart(2, '0')}`, realized: i === 0 ? locked : null, locked, mid: locked + 12, lo: locked + 2, hi: locked + 26 }
  }),
]

const histProps = (selfValue: number) => ({
  bins: Array.from({ length: 16 }, (_, i) => ({ lo: i * 2.5, hi: (i + 1) * 2.5, count: ((i * 7) % 5) + 1 })),
  capHi: 40, overflowCount: 2, overflowMax: 150,
  stats: { p10: 10, median: 20, p90: 32.5 }, selfValue, selfName: '甲', height: 280,
})

const CHARTS = [
  { name: 'AnaForecastChart', group: 'g.afc-data', mk: () => mount(AnaForecastChart, { props: { rows: fRows(REV6) } }) },
  { name: 'AnaRentBandChart', group: 'g.arb-data', mk: () => mount(AnaRentBandChart, { props: { cols: bandCols(), splitIdx: 12, height: 280 } }) },
  { name: 'AnaRenewalChart', group: 'g.arn-data', mk: () => mount(AnaRenewalChart, { props: { hits: 18, n: 72, band: { lo: 0.18, hi: 0.33 } } }) },
  { name: 'AnaUnitRentHist', group: 'g.auh-data', mk: () => mount(AnaUnitRentHist, { props: histProps(18) }) },
  // 预算屏子弹图 / 现金流屏趋势(2026-09-16 对抗复查:矩阵首进行、回签行都要擦,上一轮漏了)
  { name: 'AnaBullet', group: 'svg.bul-svg', mk: () => mount(AnaBullet, { props: { rows: [{ name: '收入', value: 92 }, { name: '利润', value: 104 }], target: 100 } }) },
  { name: 'AnaTrend', group: 'g.trend-data', mk: () => mount(AnaTrend, { props: { labels: ['1月', '2月', '3月'], cur: [3, 5, 4] } }) },
] as const

const inMorph = (el: Element) => el.closest('.ana-morph') != null

// 暗色(对抗复查 2026-09-20):四张自绘 SVG 图原来整套写死浅色(阴影区 #F5F6F9 在暗卡片上一块亮白、预测图中位数字
// #1E293B 对卡片 1.02:1、提示框和卡片同色)。颜色挪进 anaTheme 的两套 --sv-* 变量,挂在图的根上,切外观不用重挂载。
describe('自绘图 · 切外观', () => {
  afterEach(() => { resolvedTheme.value = 'light' })
  it.each(CHARTS.slice(0, 4))('❗$name:根上挂 --sv-* 两套色,浅色是原来的 Figma 取色,切深色当场换', async ({ mk }) => {
    const w = mk()
    const host = () => (w.element as HTMLElement).style
    expect(host().getPropertyValue('--sv-tip-bg')).toBe('#1E293B')
    expect(host().getPropertyValue('--sv-label')).toBe('#94A3B8')
    resolvedTheme.value = 'dark'
    await nextTick()
    expect(host().getPropertyValue('--sv-tip-bg'), '暗色提示框底 = 暗色 --tip-bg').toBe('rgb(62,77,95)')
    expect(host().getPropertyValue('--sv-label')).toBe('rgba(236,236,238,.62)')
    w.unmount()
  })
  it('❗样式里不再有写死的颜色:四张图的 <style> 只引 --sv-* 与令牌', () => {
    for (const f of ['AnaRentBandChart', 'AnaForecastChart', 'AnaRenewalChart', 'AnaUnitRentHist']) {
      const css = readFileSync(join(__dirname, '..', f + '.vue'), 'utf8').split('<style')[1].replace(/\/\*[\s\S]*?\*\//g, '')
      expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g), f).toBeNull()
    }
  })
})

describe('自绘图擦入 / 改宽', () => {
  // KeepAlive 停用由 useEnterPhase 当场摘;这里是另一条路:动画被别的原因取消(元素被挪走、clip-path 被覆盖),
  // 只发 animationcancel —— 不摘的话 first 卡在真,hold 跟着卡死,这张图此后换期永远不形变。
  it.each(CHARTS)('❗$name:擦入被取消(animationcancel)也摘掉 first,hold 随之放开', async ({ group, mk }) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 600, width: 600, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const w = mk()
    await nextTick()
    expect(w.find(group).classes(), '视口内挂载该擦').toContain('first')
    expect(w.findAll('.ana-morph').every((g) => g.classes('hold')), '擦入中不许形变').toBe(true)
    await w.find(group).trigger('animationcancel')
    expect(w.find(group).classes()).not.toContain('first')
    expect(w.findAll('.ana-morph').some((g) => g.classes('hold')), 'hold 卡住 = 换期不再形变').toBe(false)
    w.unmount()
  })

  // RO 改宽瞬算(矩阵「窗口改宽 → 不走形变」):新宽度那一帧所有形变组都挂 hold,两帧后放开。
  it.each(CHARTS)('❗$name:改宽 → 形变组挂 hold,两帧后摘', async ({ mk }) => {
    const w: VueWrapper = mk()
    await nextTick()
    const held = () => w.findAll('.ana-morph, .auh-slide').map((g) => g.classes('hold'))
    expect(held().length, '一个形变组都没有').toBeGreaterThan(0)
    expect(held().every((x) => !x)).toBe(true)
    resizeTo(640)
    await nextTick()
    expect(held().every((x) => x), '改宽那一帧在形变 = 窗口一拖整张图在追').toBe(true)
    await nextFrame(); await nextFrame()
    expect(held().every((x) => !x)).toBe(true)
    w.unmount()
  })
})

// DOM 条形清单:擦在容器上(换期新键行不各擦一次),同 PvRoiView 进度条
describe('AnaBarRows', () => {
  const rect = (top: number) => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    { top, bottom: top + 150, left: 0, right: 300, width: 300, height: 150, x: 0, y: top, toJSON: () => ({}) } as DOMRect)
  const mk = () => mount(AnaBarRows, { slots: { default: '<div class="ak-bar-row">甲</div><div class="ak-bar-row">乙</div>' } })

  it('❗视口内首挂擦入;animationend / animationcancel 都摘', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    rect(0)
    for (const ev of ['animationend', 'animationcancel']) {
      const w = mk()
      await nextTick()
      expect(w.classes(), '视口内挂载没擦').toEqual(['ak-bar-rows', 'first'])
      expect(w.findAll('.ak-bar-row')).toHaveLength(2)
      await w.trigger(ev)
      expect(w.classes(), ev + ' 没摘').toEqual(['ak-bar-rows'])
      w.unmount()
    }
  })

  it('离屏首挂瞬到,不擦', async () => {
    rect(innerHeight + 40)
    const w = mk()
    await nextTick()
    expect(w.classes()).toEqual(['ak-bar-rows'])
    w.unmount()
  })
})

describe('自绘图换数同键形变', () => {
  it('❗AnaForecastChart:同结构换数 → 同一批节点换 d / cy;点数一变 → 整组换新节点(不让点在线外滑)', async () => {
    const w = mount(AnaForecastChart, { props: { rows: fRows(REV6) } })
    const line = w.find('path.afc-line').element
    const dot = w.find('circle.afc-dot').element
    const d0 = line.getAttribute('d')
    await w.setProps({ rows: fRows(REV6.map((v, i) => v * (1 + i * 0.01))) })
    expect(w.find('path.afc-line').element, '换数重建了节点 = 没有过渡').toBe(line)
    expect(line.getAttribute('d')).not.toBe(d0)
    expect(w.find('circle.afc-dot').element).toBe(dot)
    expect(inMorph(line) && inMorph(w.find('path.afc-fbar').element), '线 / 预测月标记不在形变组里').toBe(true)
    await w.setProps({ rows: fRows([...REV6, 7800000]) })
    expect(w.find('path.afc-line').element, '点数变了 d 插值不了,旧节点留着 = 点滑线跳').not.toBe(line)
    // 悬停层 0ms:竖线 / 高亮点 / 气泡不在形变组里
    await w.find('.afc-host').trigger('mousemove', { clientX: 200 })
    for (const c of ['.afc-hair', '.afc-hdot', '.afc-tip']) {
      expect(inMorph(w.find(c).element), `${c} 会跟着形变`).toBe(false)
    }
    w.unmount()
  })

  it('❗AnaRentBandChart:切回重拉换数 → 同一批路径节点换 d,在形变组里', async () => {
    const w = mount(AnaRentBandChart, { props: { cols: bandCols(), splitIdx: 12, height: 280 } })
    const real = w.find('path.arb-real').element
    const d0 = real.getAttribute('d')
    await w.setProps({ cols: bandCols(1.1) })
    expect(w.find('path.arb-real').element).toBe(real)
    expect(real.getAttribute('d')).not.toBe(d0)
    expect(inMorph(real) && inMorph(w.find('circle.arb-dot').element)).toBe(true)
    w.unmount()
  })

  it('❗AnaRenewalChart:观测竖线是 path(<line> 端点过渡不了),与续签条、区间块同在形变组里同节点换几何', async () => {
    const w = mount(AnaRenewalChart, { props: { hits: 18, n: 72, band: { lo: 0.18, hi: 0.33 } } })
    const marker = w.find('.arn-marker').element
    const hit = w.find('rect.arn-hit').element
    const band = w.find('rect.arn-band').element
    expect(marker.tagName).toBe('path')
    const [d0, w0, x0] = [marker.getAttribute('d'), hit.getAttribute('width'), band.getAttribute('x')]
    await w.setProps({ hits: 30, band: { lo: 0.3, hi: 0.5 } })
    expect([w.find('.arn-marker').element, w.find('rect.arn-hit').element, w.find('rect.arn-band').element]).toEqual([marker, hit, band])
    expect([marker.getAttribute('d'), hit.getAttribute('width'), band.getAttribute('x')]).not.toEqual([d0, w0, x0])
    expect([marker, hit, band].every(inMorph)).toBe(true)
    w.unmount()
  })

  it('❗AnaUnitRentHist:换租户 → 本户线连字整组平移(同一个 <g> 换 transform),柱在形变组里,气泡不在', async () => {
    const w = mount(AnaUnitRentHist, { props: histProps(18) })
    const selfG = w.find('.auh-self').element.parentElement!
    const t0 = selfG.getAttribute('style')
    expect(selfG.classList.contains('auh-slide')).toBe(true)
    expect(selfG.contains(w.find('.auh-selflab').element), '名字不在平移组里 = 线在滑、字先跳').toBe(true)
    await w.setProps(histProps(27))
    expect(w.find('.auh-self').element.parentElement).toBe(selfG)
    expect(selfG.getAttribute('style')).not.toBe(t0)
    expect(selfG.getAttribute('style')).toMatch(/translate\([\d.]+px/)
    expect(inMorph(w.find('rect.auh-bar').element) && inMorph(w.find('rect.auh-bandrect').element)).toBe(true)
    await w.find('.auh-host').trigger('mousemove', { clientX: 60 })
    expect(inMorph(w.find('rect.auh-tip').element), '气泡会跟着形变').toBe(false)
    w.unmount()
  })
})
