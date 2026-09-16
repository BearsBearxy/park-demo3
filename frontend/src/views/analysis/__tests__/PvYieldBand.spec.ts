// PvYieldBand(B3)挂载测:几何钉坐标(点、淡区、线尾标签、悬停竖线与气泡翻边),不钉配置对象。
// 夹具非退化:三条序列逐日起伏、选中栋漏抄一天、在网不足 3 栋留空一天、29–31 日未到。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type DOMWrapper } from '@vue/test-utils'
import PvYieldBand from '../PvYieldBand.vue'
import { tipWidth } from '@/components/ana/chartTip'
import type { YieldBand } from '../pvAnaV4.logic'
import type { TickState } from '../pvMeterAna.logic'

const W = 999, PL = 44, PR = 62, PT = 12, IH = 214

function monthData(): YieldBand {
  const n = 31, fut = 28
  const med: (number | null)[] = [], lo: (number | null)[] = [], hi: (number | null)[] = []
  const sel: (number | null)[] = [], state: TickState[] = []
  for (let i = 0; i < n; i++) {
    const m = 3.2 + 0.6 * Math.sin(i * 0.7) + 0.1 * (i % 3)
    const future = i >= fut
    const thin = i === 16                           // 在网 < 3 栋:整列留空
    med.push(future || thin ? null : m)
    lo.push(future || thin ? null : m - 0.2 - 0.05 * (i % 4))
    hi.push(future || thin ? null : m + 0.15 + 0.04 * (i % 5))
    const missing = i === 5                         // 选中栋漏抄
    sel.push(future || missing ? null : m - 0.5 + 0.08 * ((i * 7) % 5))
    state.push(future ? 'future' : missing ? 'missing' : 'seen')
  }
  return {
    gran: 'month', labels: Array.from({ length: n }, (_, i) => String(i + 1)),
    sel, selState: state, selName: 'F座', med, lo, hi,
    futureFrom: fut, throughIdx: fut - 1, onlineN: 11, unbornN: 2, denomNote: '分母 = 台账装机（13 栋未录板数）',
  }
}

/** 独立按规格算的坐标:x 首尾贴边;y = 数据极值各外扩 18% */
function geo(d: YieldBand) {
  const n = d.labels.length
  const iw = W - PL - PR
  const vs = [...d.sel, ...d.med, ...d.lo, ...d.hi].filter((v): v is number => v != null)
  const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.18
  const min = lo - pad, max = hi + pad
  return {
    min, max,
    x: (i: number) => PL + (i / (n - 1)) * iw,
    y: (v: number) => PT + IH - ((v - min) / (max - min)) * IH,
  }
}
const firstPoint = (d: string) => d.match(/^M([\d.]+),([\d.]+)/)!.slice(1).map(Number)
const hit = (w: ReturnType<typeof mount>) => w.find('.pyb-hit')
const attr = (el: DOMWrapper<Element>, k: string) => el.attributes(k) ?? ''

describe('PvYieldBand 几何', () => {
  it('x 首尾贴边:1 日在 padL,31 日在 宽 − 62;淡区从 28、29 日正中起到绘图区右缘', () => {
    const d = monthData()
    const w = mount(PvYieldBand, { props: { data: d } })
    const g = geo(d)
    const [x0, y0] = firstPoint(attr(w.find('.pyb-sel'), 'd'))
    expect(x0).toBeCloseTo(44, 6)
    expect(y0).toBeCloseTo(g.y(d.sel[0]!), 6)
    const shade = w.find('.pyb-future')
    expect(Number(shade.attributes('x'))).toBeCloseTo(862.58, 1)
    expect(Number(shade.attributes('x')) + Number(shade.attributes('width'))).toBeCloseTo(937, 6)
    const xl = w.findAll('text.pyb-ax').filter(t => t.attributes('text-anchor') === 'middle')
    expect(xl.map(t => t.text())).toEqual(['1', '5', '10', '15', '20', '25', '31'])
    expect(Number(xl[xl.length - 1].attributes('x'))).toBeCloseTo(937, 6)
  })

  it('4 条横网格等分绘图区,刻度字 = 外扩后的值域四等分', () => {
    const d = monthData()
    const w = mount(PvYieldBand, { props: { data: d } })
    const ys = w.findAll('.pyb-gl').map(l => Number(l.attributes('y1')))
    expect(ys).toEqual([226, 226 - IH / 3, 226 - (2 * IH) / 3, 12].map(v => expect.closeTo(v, 6)))
    const g = geo(d)
    const labels = w.findAll('text.pyb-ax').filter(t => t.attributes('text-anchor') === 'end').map(t => t.text())
    expect(labels).toEqual([0, 1, 2, 3].map(k => (g.min + (k / 3) * (g.max - g.min)).toFixed(1)))
    // 底网格 = 外扩后的下沿:最低的数据点离底线正好 18/136 个绘图高
    const low = Math.min(...[...d.sel, ...d.lo].filter((v): v is number => v != null))
    expect(g.y(low)).toBeCloseTo(226 - IH * 18 / 136, 6)
  })

  it('漏抄那天选中栋线断开,在网不足 3 栋那天带断开 —— 断成两段各自起笔', () => {
    const w = mount(PvYieldBand, { props: { data: monthData() } })
    // 线拆成相邻两刻度一段(按起点刻度):选中栋 6 日两侧(5→6、6→7)不出段,全园线 17 日两侧不出段
    const starts = (sel: string) => w.findAll(sel).map(s => Number(s.attributes('data-i')))
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k)
    expect(starts('.pyb-sel')).toEqual([...range(0, 3), ...range(6, 26)])
    expect(starts('.pyb-med')).toEqual([...range(0, 14), ...range(17, 26)])
    expect(w.findAll('.pyb-band')).toHaveLength(2)
    const g = geo(monthData())
    const d = monthData()
    expect(attr(w.find('.pyb-sel[data-i="6"]'), 'd')).toBe(`M${g.x(6)},${g.y(d.sel[6]!)} L${g.x(7)},${g.y(d.sel[7]!)}`)
  })

  it('❗选中栋单独一个点(两边都没抄):同点连一次,圆头线帽画成点;全园线不出点(对照)', () => {
    const d = monthData()
    d.sel[3] = null; d.selState[3] = 'missing'
    d.med[14] = null
    const w = mount(PvYieldBand, { props: { data: d } })
    const g = geo(d)
    const p = `${g.x(4)},${g.y(d.sel[4]!)}`
    const lone = w.find('.pyb-sel[data-i="4"]')
    expect([attr(lone, 'd'), attr(lone, 'stroke-linecap')]).toEqual([`M${p} L${p}`, 'round'])
    // 全园线 16 日两边(15、17 日)都空:不出点
    expect(w.find('.pyb-med[data-i="15"]').exists()).toBe(false)
  })

  it('年档逐月:8 个月全标,最后一月贴右缘,整段已过去不画淡区', () => {
    const m = monthData()
    const pick = <T,>(a: T[]) => a.slice(0, 8)
    const d: YieldBand = {
      ...m, gran: 'year', labels: Array.from({ length: 8 }, (_, i) => `${i + 1}月`),
      sel: pick(m.sel).map((v, i) => (v == null ? null : v * 30 + i)), selState: pick(m.selState),
      med: pick(m.med).map(v => v! * 30), lo: pick(m.lo).map(v => v! * 30 - 4), hi: pick(m.hi).map(v => v! * 30 + 3),
      futureFrom: null, throughIdx: null,
    }
    const w = mount(PvYieldBand, { props: { data: d } })
    expect(w.find('.pyb-future').exists()).toBe(false)
    const xl = w.findAll('text.pyb-ax').filter(t => t.attributes('text-anchor') === 'middle')
    expect(xl.map(t => t.text())).toEqual(['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月'])
    expect(Number(xl[7].attributes('x'))).toBeCloseTo(937, 6)
    const g = geo(d)
    const [x0, y0] = firstPoint(attr(w.find('.pyb-med'), 'd'))
    expect(x0).toBeCloseTo(44, 6)
    expect(y0).toBeCloseTo(g.y(d.med[0]!), 6)
  })
})

describe('PvYieldBand 线尾直标', () => {
  it('对照:三条线尾隔得开时各就各位 —— 线取线尾 + 4,带取上沿 + 2,x = 最后已过去刻度 + 8', () => {
    const d = monthData()
    d.hi[27] = 4.4; d.lo[27] = 4.1; d.med[27] = 3.2; d.sel[27] = 2.4
    const w = mount(PvYieldBand, { props: { data: d } })
    const g = geo(d)
    const y = (k: string) => Number(w.find('.pyb-tail-' + k).attributes('y'))
    expect(y('band')).toBeCloseTo(g.y(4.4) + 2, 6)
    expect(y('med')).toBeCloseTo(g.y(3.2) + 4, 6)
    expect(y('sel')).toBeCloseTo(g.y(2.4) + 4, 6)
    expect(Number(w.find('.pyb-tail-sel').attributes('x'))).toBeCloseTo(g.x(27) + 8, 6)
    expect(w.find('.pyb-tail-sel').text()).toBe('F座')
  })

  it('❗中位贴着带上沿时被往下推开整 13,带标签不动', () => {
    const d = monthData()
    d.med[27] = 3.5; d.hi[27] = 3.52; d.lo[27] = 3.2; d.sel[27] = 2.3
    const w = mount(PvYieldBand, { props: { data: d } })
    const g = geo(d)
    const band = Number(w.find('.pyb-tail-band').attributes('y'))
    const med = Number(w.find('.pyb-tail-med').attributes('y'))
    expect(band).toBeCloseTo(g.y(3.52) + 2, 6)
    expect(g.y(3.5) + 4).toBeLessThan(band + 13)   // 不推就叠字
    expect(med).toBeCloseTo(band + 13, 6)
  })

  it('❗三条线尾全压在值域底:连推两层,最低那枚仍在绘图区内', () => {
    const d = monthData()
    const all = [...d.sel, ...d.lo].filter((v): v is number => v != null)
    const floor = Math.min(...all)
    d.sel[27] = floor; d.med[27] = floor; d.lo[27] = floor; d.hi[27] = floor
    const w = mount(PvYieldBand, { props: { data: d } })
    const g = geo(d)
    const ys = ['band', 'med', 'sel'].map(k => Number(w.find('.pyb-tail-' + k).attributes('y')))
    expect(ys[0]).toBeCloseTo(g.y(floor) + 2, 6)
    expect(ys[1]).toBeCloseTo(ys[0] + 13, 6)
    expect(ys[2]).toBeCloseTo(ys[1] + 13, 6)
    expect(ys[2]).toBeLessThanOrEqual(226)
  })
})

describe('PvYieldBand 悬停', () => {
  it('悬停 11 日:竖线 x、选中栋高亮点 cx/cy、气泡四行,气泡在竖线右 12', async () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvYieldBand, { props: { data: d } })
    await hit(w).trigger('mousemove', { clientX: g.x(10) + 3 })
    expect(Number(w.find('.pyb-hair').attributes('x1'))).toBeCloseTo(g.x(10), 6)
    expect(Number(w.find('.pyb-dot').attributes('cx'))).toBeCloseTo(g.x(10), 6)
    expect(Number(w.find('.pyb-dot').attributes('cy'))).toBeCloseTo(g.y(d.sel[10]!), 6)
    const lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines).toEqual([
      '11 日', `F座 ${d.sel[10]!.toFixed(2)} h`, `全园中位 ${d.med[10]!.toFixed(2)} h`,
      `中间一半 ${d.lo[10]!.toFixed(2)} – ${d.hi[10]!.toFixed(2)} h`,
    ])
    expect(w.find('.pv-tip').attributes('style')).toContain(`left: ${g.x(10) + 12}px`)
    await hit(w).trigger('mouseleave')
    expect(w.find('.pv-tip').exists()).toBe(false)
    expect(w.find('.pyb-hair').exists()).toBe(false)
  })

  it('❗右缘放不下翻到竖线左侧;鼠标移进未到的日子钉在 28 日', async () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvYieldBand, { props: { data: d } })
    await hit(w).trigger('mousemove', { clientX: 990 })
    expect(Number(w.find('.pyb-hair').attributes('x1'))).toBeCloseTo(g.x(27), 6)
    const lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines[0]).toBe('28 日')
    const tw = tipWidth(lines, 22)
    expect(g.x(27) + 12 + tw).toBeGreaterThan(W)
    expect(w.find('.pv-tip').attributes('style')).toContain(`left: ${g.x(27) - 12 - tw}px`)
  })

  it('漏抄那天:第二行写没抄表、不画高亮点;在网不足 3 栋那天:写留空、不给中间一半', async () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvYieldBand, { props: { data: d } })
    await hit(w).trigger('mousemove', { clientX: g.x(5) })
    expect(w.findAll('.pv-tip span')[1].text()).toBe('F座 这天没抄表')
    expect(w.find('.pyb-dot').exists()).toBe(false)
    await hit(w).trigger('mousemove', { clientX: g.x(16) })
    const t = w.findAll('.pv-tip span').map(s => s.text())
    expect(t).toContain('在网不足 3 栋，全园线留空')
    expect(t.some(s => s.startsWith('中间一半'))).toBe(false)
    expect(w.find('.pyb-dot').exists()).toBe(true)
  })

  it('❗投产前的日子:第二行写「—」,不写没抄表(对照:投产后的漏抄日写没抄表)', async () => {
    const d = monthData()
    d.selState = d.selState.map((s, i) => (i < 5 ? 'pre' : s))
    d.sel = d.sel.map((v, i) => (i < 5 ? null : v))
    const w = mount(PvYieldBand, { props: { data: d } })
    await hit(w).trigger('mousemove', { clientX: geo(d).x(2) })
    expect(w.findAll('.pv-tip span')[1].text()).toBe('F座 —')
    await hit(w).trigger('mousemove', { clientX: geo(d).x(5) })
    expect(w.findAll('.pv-tip span')[1].text()).toBe('F座 这天没抄表')
  })

  it('年档气泡首行写「3 月」', async () => {
    const m = monthData()
    const d: YieldBand = {
      ...m, gran: 'year', labels: Array.from({ length: 8 }, (_, i) => `${i + 1}月`),
      sel: m.sel.slice(0, 8), selState: m.selState.slice(0, 8), med: m.med.slice(0, 8),
      lo: m.lo.slice(0, 8), hi: m.hi.slice(0, 8), futureFrom: null, throughIdx: null,
    }
    const w = mount(PvYieldBand, { props: { data: d } })
    await hit(w).trigger('mousemove', { clientX: geo(d).x(2) })
    expect(w.findAll('.pv-tip span')[0].text()).toBe('3 月')
  })
})

describe('PvYieldBand 图注', () => {
  it('❗「数据到」写最后一条抄表那天,不写今天:今天 28 日、数据只到 12 日 → 写 12 日', () => {
    const w = mount(PvYieldBand, { props: { data: { ...monthData(), throughIdx: 11 } } })
    expect(w.find('.ana-ref').text()).toContain(' · 数据到 12 日，右侧淡区还没到 · ')
    expect(w.find('.ana-ref').text()).not.toContain('数据到 28 日')
  })

  it('写在网 / 未投产栋数、数据到哪天、分母口径', () => {
    const w = mount(PvYieldBand, { props: { data: monthData() } })
    expect(w.find('.ana-ref').text()).toBe(
      '纵轴 = 等效小时 kWh/kWp · 横轴 = 1…31 日 · 11 栋在网、2 栋未投产 · 数据到 28 日，右侧淡区还没到 · 分母 = 台账装机（13 栋未录板数）',
    )
  })
})

// 2026-09-16 行为矩阵:只经段控进来的图 —— 挂载时视口内擦入 320;换栋 / 换期不重挂,同键 200 形变
describe('PvYieldBand 动效', () => {
  const inView = () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 999, width: 999, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  }
  afterEach(() => { vi.restoreAllMocks() })

  it('❗切子屏挂上来、在视口内:数据组 first + hold;animationcancel / animationend 都摘;离屏挂载不擦', async () => {
    inView()
    const w = mount(PvYieldBand, { props: { data: monthData() } })
    await nextTick()
    expect(w.find('g.pyb-data').classes()).toEqual(['pyb-data', 'ana-morph', 'first', 'hold'])
    await w.find('g.pyb-data').trigger('animationcancel')
    expect(w.find('g.pyb-data').classes()).toEqual(['pyb-data', 'ana-morph'])
    const w2 = mount(PvYieldBand, { props: { data: monthData() } })
    await nextTick()
    await w2.find('g.pyb-data').trigger('animationend')
    expect(w2.find('g.pyb-data').classes()).toEqual(['pyb-data', 'ana-morph'])
    vi.restoreAllMocks()
    const off = mount(PvYieldBand, { props: { data: monthData() } })
    await nextTick()
    expect(off.find('g.pyb-data').classes()).toEqual(['pyb-data', 'ana-morph'])
  })

  it('❗按月 ↔ 按年:刻度下标不是同一类目 —— 数据组整组换新元素,「11 日」的线段不滑成「11 月」', async () => {
    const w = mount(PvYieldBand, { props: { data: monthData() } })
    const g0 = w.find('g.pyb-data').element
    const seg = w.find('.pyb-sel[data-i="10"]').element
    const m = monthData()
    const pick = <T,>(a: T[]) => a.slice(0, 12)
    await w.setProps({ data: { ...m, gran: 'year', labels: pick(m.labels).map(l => l + '月'), sel: pick(m.sel), selState: pick(m.selState), med: pick(m.med), lo: pick(m.lo), hi: pick(m.hi), futureFrom: 12, throughIdx: 11 } })
    expect(w.find('g.pyb-data').element).not.toBe(g0)
    expect(w.find('.pyb-sel[data-i="10"]').exists()).toBe(true)
    expect(w.find('.pyb-sel[data-i="10"]').element, '跨粒度复用了同下标的线段').not.toBe(seg)
  })

  it('❗换栋不重挂:同一刻度的线段 / 带还是同一个元素,d 换成新栋的;带、两条线、线尾字在形变组里,轴线与悬停层不在', async () => {
    const w = mount(PvYieldBand, { props: { data: monthData() } })
    const seg = w.find('.pyb-sel[data-i="10"]').element
    const band = w.findAll('.pyb-band')[0].element
    const before = [seg.getAttribute('d'), band.getAttribute('d')]
    const d = monthData()
    // 另一栋:比原来整体低 0.4(量程下端跟着撑开 → 带的 y 也变)
    await w.setProps({ data: { ...d, selName: 'E座', sel: d.sel.map(v => (v == null ? null : v - 0.4)) } })
    expect(w.find('.pyb-sel[data-i="10"]').element).toBe(seg)
    expect(w.findAll('.pyb-band')[0].element).toBe(band)
    expect([seg.getAttribute('d'), band.getAttribute('d')].map((v, k) => v === before[k])).toEqual([false, false])
    const g = w.find('g.pyb-data')
    for (const sel of ['.pyb-band', '.pyb-med', '.pyb-sel', '.pyb-tail']) expect(g.find(sel).exists(), sel).toBe(true)
    await w.find('.pyb-hit').trigger('mousemove', { clientX: 44 + 10 * (999 - 44 - 62) / 30 })
    for (const sel of ['.pyb-hair', '.pyb-dot', '.pyb-axl']) expect(w.find(sel).element.closest('.ana-morph'), sel).toBe(null)
  })
})
