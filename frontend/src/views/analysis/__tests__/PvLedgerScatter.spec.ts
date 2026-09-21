// PvLedgerScatter(B6)挂载测:正方绘图区、45° 虚线、沿对角线的 ±容差斜带、点的 cx/cy;
// 空态(一栋没录)照样画框线与带、不画点(计划 §1 #4);录入入口 emit record。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type DOMWrapper } from '@vue/test-utils'
import PvLedgerScatter from '../PvLedgerScatter.vue'
import type { LedgerScatter } from '../pvAnaV4.logic'

const PL = 40, PT = 12, P = 248, B = 260
const num = (el: DOMWrapper<Element>, k: string) => Number(el.attributes(k))
const attr = (el: DOMWrapper<Element>, k: string) => el.attributes(k) ?? ''
const pathPts = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])])

function withPoints(): LedgerScatter {
  return {
    points: [
      { id: 3, name: 'E座', phase: 1, x: 400, y: 390, diff: -0.025 },
      { id: 1, name: 'B座', phase: 1, x: 500, y: 500, diff: 0 },
      { id: 10, name: '12栋', phase: 2, x: 380, y: 340, diff: -0.105 },
      { id: 2, name: 'C、D座', phase: 1, x: 812, y: 780, diff: -0.039 },
    ],
    unrecorded: 7, metered: 11, tolerance: 0.03,
  }
}
const empty = (): LedgerScatter => ({ points: [], unrecorded: 11, metered: 11, tolerance: 0.03 })

describe('PvLedgerScatter 有点', () => {
  // 值域:两轴合起来 340–812,各外扩 10% 值域再取整到 10 → 290–860
  const MIN = 290, MAX = 860
  const px = (v: number) => PL + ((v - MIN) / (MAX - MIN)) * P
  const py = (v: number) => B - ((v - MIN) / (MAX - MIN)) * P

  it('点的 cx/cy 落在同一把刻度上;绘图区正方', () => {
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    const c = w.findAll('circle.pls-pt')
    expect(c).toHaveLength(4)
    expect(num(c[0], 'cx')).toBeCloseTo(px(400), 6)
    expect(num(c[0], 'cy')).toBeCloseTo(py(390), 6)
    expect(num(c[3], 'cx')).toBeCloseTo(px(812), 6)
    expect(num(c[3], 'cy')).toBeCloseTo(py(780), 6)
    const ax = w.find('.pls-axl-x'), ay = w.find('.pls-axl-y')
    expect(num(ax, 'x2') - num(ax, 'x1')).toBe(P)
    expect(num(ay, 'y2') - num(ay, 'y1')).toBe(P)
  })

  it('落在 y = x 上的那栋,点心正好压在虚线上', () => {
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    const b = w.findAll('circle.pls-pt')[1]
    const cx = num(b, 'cx'), cy = num(b, 'cy')
    // 虚线从 (40,260) 到 (288,12):线上 y = 260 − (x − 40)
    expect(cy).toBeCloseTo(B - (cx - PL), 6)
    const dg = w.find('.pls-diag')
    expect([num(dg, 'x1'), num(dg, 'y1'), num(dg, 'x2'), num(dg, 'y2')]).toEqual([PL, B, PL + P, PT])
  })

  it('±3% 带是沿对角线的斜四边形:两端各在 值 × 0.97 与 值 × 1.03', () => {
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    const pts = pathPts(attr(w.find('path.pls-band'), 'd'))
    expect(pts).toHaveLength(4)
    expect(pts[0][0]).toBeCloseTo(PL, 6)
    expect(pts[0][1]).toBeCloseTo(py(MIN * 0.97), 6)
    expect(pts[1][1]).toBeCloseTo(py(MAX * 0.97), 6)
    expect(pts[2][0]).toBeCloseTo(PL + P, 6)
    expect(pts[2][1]).toBeCloseTo(py(MAX * 1.03), 6)
    expect(pts[3][1]).toBeCloseTo(py(MIN * 1.03), 6)
  })

  it('刻度取整步长,两轴同刻度字', () => {
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    const tx = w.findAll('text.pls-tx')
    expect(tx.map(t => t.text())).toEqual(['400', '600', '800'])
    expect(w.findAll('text.pls-ty').map(t => t.text())).toEqual(['400', '600', '800'])
    expect(num(tx[1], 'x')).toBeCloseTo(px(600), 6)
    expect(w.find('.pls-note').text()).toBe('7 栋板数或单块标称功率未录，这些栋不画点。')
  })
})

describe('PvLedgerScatter 空态', () => {
  it('❗一栋没录:画框线、虚线、斜带,没有点、没有刻度字', () => {
    const w = mount(PvLedgerScatter, { props: { data: empty() } })
    expect(w.find('.pls-axl-x').exists()).toBe(true)
    expect(w.find('.pls-axl-y').exists()).toBe(true)
    expect(w.find('.pls-diag').exists()).toBe(true)
    const band = pathPts(attr(w.find('path.pls-band'), 'd'))
    expect(band).toHaveLength(4)
    // 带有宽度:右端上下沿拉开;上沿不冲出画布顶
    expect(band[1][1] - band[2][1]).toBeGreaterThan(10)
    expect(Math.min(...band.map(p => p[1]))).toBeGreaterThanOrEqual(0)
    expect(w.findAll('circle.pls-pt')).toHaveLength(0)
    expect(w.findAll('text.pls-tx')).toHaveLength(0)
    expect(w.find('.pls-note').text()).toBe('11 栋板数或单块标称功率未录，这些栋不画点。录几栋出几个点。')
  })

  it('右栏三条说明按容差写,录入入口 emit record', async () => {
    const w = mount(PvLedgerScatter, { props: { data: { ...empty(), tolerance: 0.05 } } })
    expect(w.text()).toContain('灰带 = 相差 ±5% 以内')
    expect(w.text()).toContain('一个点 = 一栋')
    await w.find('.pls-link').trigger('click')
    expect(w.emitted('record')).toHaveLength(1)
  })

  it('对照:全都录了就不出灰底提示', () => {
    const d = withPoints()
    d.unrecorded = 0
    const w = mount(PvLedgerScatter, { props: { data: d } })
    expect(w.find('.pls-note').exists()).toBe(false)
  })
})

// 手机体验稿 §④:原来 SQ 写死 300,改成量容器宽取 min(容器宽, 300)。
// 桌面(容器 ≥ 300)这一档的每个数都钉住 —— 拆固定宽不许动到桌面一个像素。
describe('PvLedgerScatter 画布宽', () => {
  const clientWidth = (v: number) =>
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => v })
  afterEach(() => { clientWidth(0) })

  it('❗容器 ≥ 300:300×334,绘图区 248,对角线上那句还在 (186.3, 140)', () => {
    clientWidth(792)
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    const svg = w.find('svg.pls-svg')
    expect([attr(svg, 'width'), attr(svg, 'height'), attr(svg, 'viewBox')]).toEqual(['300', '334', '0 0 300 334'])
    expect(num(w.find('.pls-axl-x'), 'x2') - num(w.find('.pls-axl-x'), 'x1')).toBe(P)
    const lbl = w.findAll('text.pls-ax').find(t => t.text() === '虚线 = 两者相等')!
    expect([attr(lbl, 'x'), attr(lbl, 'y')]).toEqual(['186.3', '140'])
    const xt = w.findAll('text.pls-ax').find(t => t.text().startsWith('板数'))!
    expect([attr(xt, 'x'), attr(xt, 'y')]).toEqual([String(PL + P), String(B + 30)])
    const yt = w.findAll('text.pls-ax').find(t => t.text().startsWith('台账'))!
    expect([attr(yt, 'x'), attr(yt, 'y')]).toEqual([String(PL - 6), String(PT + 10)])
    expect(w.find('.pls').classes()).not.toContain('pls-narrow')
  })

  it('❗容器 280:画布跟着收到 280×314,绘图区还是正方 228,右栏改到图下面', async () => {
    clientWidth(280)
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    await nextTick()
    const svg = w.find('svg.pls-svg')
    expect([attr(svg, 'width'), attr(svg, 'viewBox')]).toEqual(['280', '0 0 280 314'])
    const ax = w.find('.pls-axl-x'), ay = w.find('.pls-axl-y')
    expect(num(ax, 'x2') - num(ax, 'x1')).toBe(228)
    expect(num(ay, 'y2') - num(ay, 'y1')).toBe(228)
    // 轴字不出画布:x 轴标题右端贴着绘图区右缘,左端还在 0 以内
    const xt = w.findAll('text.pls-ax').find(t => t.text().startsWith('板数'))!
    expect(num(xt, 'x')).toBe(40 + 228)
    expect(w.find('.pls').classes()).toContain('pls-narrow')
  })
})

// 2026-09-16 行为矩阵:只经段控进来的图 —— 挂载时视口内点组擦入 320;换期不重挂,点按栋 200 形变,带跟量程形变
describe('PvLedgerScatter 动效', () => {
  const inView = () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 300, width: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  }
  afterEach(() => { vi.restoreAllMocks() })

  it('❗切子屏挂上来、在视口内:点组 first + hold,带组只 hold 不擦;animationcancel / animationend 都摘;离屏不擦', async () => {
    inView()
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    await nextTick()
    expect(w.find('g.pls-data').classes()).toEqual(['pls-data', 'ana-morph', 'first', 'hold'])
    expect(w.find('g.pls-bandg').classes()).toEqual(['pls-bandg', 'ana-morph', 'hold'])
    await w.find('g.pls-data').trigger('animationcancel')
    expect(w.find('g.pls-data').classes()).toEqual(['pls-data', 'ana-morph'])
    expect(w.find('g.pls-bandg').classes()).toEqual(['pls-bandg', 'ana-morph'])
    const w2 = mount(PvLedgerScatter, { props: { data: withPoints() } })
    await nextTick()
    await w2.find('g.pls-data').trigger('animationend')
    expect(w2.find('g.pls-data').classes()).toEqual(['pls-data', 'ana-morph'])
    vi.restoreAllMocks()
    const off = mount(PvLedgerScatter, { props: { data: withPoints() } })
    await nextTick()
    expect(off.find('g.pls-data').classes()).toEqual(['pls-data', 'ana-morph'])
  })

  it('❗换期不重挂:同一栋的点还是同一个元素,cx/cy 换成新量程上的;带同一个元素、d 变了;点都在形变组里', async () => {
    const w = mount(PvLedgerScatter, { props: { data: withPoints() } })
    const [e, cd] = [0, 3].map(k => w.findAll('circle.pls-pt')[k].element)
    const band = w.find('path.pls-band').element
    const before = [e.getAttribute('cx'), cd.getAttribute('cx'), band.getAttribute('d')]
    // 换一年:C、D座 的两个值都变了(量程跟着变,别的栋的点也挪)
    const d = withPoints()
    d.points = [...d.points.slice(0, 3), { id: 2, name: 'C、D座', phase: 1, x: 1200, y: 1100, diff: -0.083 }]
    await w.setProps({ data: d })
    expect(w.findAll('circle.pls-pt')[0].element).toBe(e)
    expect(w.findAll('circle.pls-pt')[3].element).toBe(cd)
    expect(w.find('path.pls-band').element).toBe(band)
    expect([e.getAttribute('cx'), cd.getAttribute('cx'), band.getAttribute('d')].map((v, k) => v === before[k])).toEqual([false, false, false])
    expect(w.find('g.pls-data').findAll('circle.pls-pt')).toHaveLength(4)
    expect(w.find('.pls-diag').element.closest('.ana-morph')).toBe(null)
  })
})
