// PvAnchorBars(A2)挂载测:0 线位置、条的 x/width、条尾两枚标签、最右列 ▲▼Δ、未投产行、行点击与悬停气泡。
// 夹具非退化:三期都在、一条负条、比去年有多有少有持平有 —、一栋未投产、一栋在网不足。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type DOMWrapper } from '@vue/test-utils'
import PvAnchorBars from '../PvAnchorBars.vue'
import { tipWidth } from '@/components/ana/chartTip'
import type { AnchorBars, AnchorRow } from '../pvAnaV4.logic'

const W = 999, ANCHOR = 807.5
const row = (id: number, name: string, phase: number, yh: number, prev: number | null): AnchorRow => ({
  id, name, phase, yieldHours: yh, delta: yh - ANCHOR, deltaPct: (yh / ANCHOR - 1) * 100,
  prevDelta: prev, prevMonths: prev == null ? 0 : 7,
})
function data(): AnchorBars {
  return {
    anchor: ANCHOR,
    rows: [
      row(3, 'E座', 1, 1147, 16.4),
      row(2, 'C、D座', 1, 1102, -41.6),
      row(7, '9栋', 2, 1034, null),
      row(9, '11栋', 2, 990, 0.3),
      row(4, 'F座', 1, 877, -79),
      row(13, '三期楼', 3, 760, 12),
    ],
    unborn: [{ id: 11, name: '创业大厦', phase: 3 }],
    short: ['10栋'], noDenom: [], noPrev: 1,
    prevLoaded: true, denomNote: '分母 = 台账装机（13 栋未录板数）',
  }
}

// 独立按规格算:栋名列 96、右留 176、0 线在绘图宽 22%;正条最长的留 5% 顶到右界,负条左边也装得下
const PL = 96, PLOT = W - PL - 176, ZERO = PL + 0.22 * PLOT
const S = Math.min((W - 176 - ZERO) / (339.5 * 1.05), (ZERO - PL) / (47.5 * 1.05))
const bar = (w: ReturnType<typeof mount>, id: number) => w.find(`rect.pan-bar[data-id="${id}"]`)
const num = (el: DOMWrapper<Element>, k: string) => Number(el.attributes(k))
const attr = (el: DOMWrapper<Element>, k: string) => el.attributes(k) ?? ''
/** 行 g 靠 translateY 定位:元素的绝对 y = 自己的 y + 所在行 g 的 translateY */
const rowY = (el: Element) => Number(/translate\(0px, (-?[\d.]+)px\)/.exec(el.closest('g.pan-rowg')?.getAttribute('style') ?? '')?.[1])
const absY = (el: DOMWrapper<Element>) => num(el, 'y') + rowY(el.element)

describe('PvAnchorBars 几何', () => {
  it('0 线 = 锚点,落在绘图宽 22%;画布高 = 8 + 行数 × 26 + 34;名字右对齐于 86', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const a = w.find('.pan-anchor')
    expect(num(a, 'x1')).toBeCloseTo(ZERO, 6)
    expect(a.attributes('stroke-dasharray')).toBe('5 4')
    expect(w.find('.pan-anchor-t').text()).toBe('0 = 807.5 h 那条线')
    expect(num(w.find('svg'), 'height')).toBe(8 + 7 * 26 + 34)
    const names = w.findAll('text.pan-name')
    expect(names.map(n => n.text())).toEqual(['E座', 'C、D座', '9栋', '11栋', 'F座', '三期楼', '创业大厦'])
    expect(names.every(n => n.attributes('x') === '86' && n.attributes('text-anchor') === 'end')).toBe(true)
  })

  it('正条从 0 线往右长 delta × 比例,负条往左;条高 14、行距 26、按期别上色', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const e = bar(w, 3)
    expect(num(e, 'x')).toBeCloseTo(ZERO, 6)
    expect(num(e, 'width')).toBeCloseTo(339.5 * S, 6)
    expect(num(e, 'x') + num(e, 'width')).toBeCloseTo(W - 176 - 339.5 * S * 0.05, 6)
    expect(absY(e)).toBe(14)
    expect(e.attributes('fill')).toBe('#378ADD')
    const neg = bar(w, 13)
    expect(num(neg, 'x')).toBeCloseTo(ZERO - 47.5 * S, 6)
    expect(num(neg, 'width')).toBeCloseTo(47.5 * S, 6)
    expect(absY(neg)).toBe(8 + 5 * 26 + 6)
    expect(neg.attributes('fill')).toBe('#EF9F27')
    expect(bar(w, 7).attributes('fill')).toBe('#5DCAA5')
  })

  it('每 50 h 一条竖网格;有负条时往左也画到栋名列边', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const labels = w.findAll('text.pan-ax').filter(t => t.attributes('y') === String(8 + 7 * 26 + 16)).map(t => t.text())
    expect(labels).toEqual(['−100', '−50', '0', '+50', '+100', '+150', '+200', '+250', '+300', '+350'])
    const g = w.findAll('.pan-gl')
    expect(num(g[3], 'x1')).toBeCloseTo(ZERO + 50 * S, 6)
    expect(num(g[0], 'x1')).toBeGreaterThanOrEqual(PL)
  })

  it('对照:没有负条就不画 0 线左边的网格', () => {
    const d = data()
    d.rows = d.rows.filter(r => r.delta > 0)
    const w = mount(PvAnchorBars, { props: { data: d, selId: null } })
    const labels = w.findAll('.pan-gl').length
    const first = w.findAll('text.pan-ax').find(t => t.attributes('text-anchor') === 'middle')!
    expect(first.text()).toBe('0')
    expect(labels).toBeGreaterThan(1)
  })

  it('条尾两枚标签:+x h 在条尾 + 8,+z% 再往右 58;负条的标签从 0 线右侧起', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const hs = w.findAll('text.pan-h'), ps = w.findAll('text.pan-pct')
    const end = ZERO + 339.5 * S
    expect(hs[0].text()).toBe('+339.5 h')
    expect(num(hs[0], 'x')).toBeCloseTo(end + 8, 6)
    expect(ps[0].text()).toBe('+42%')
    expect(num(ps[0], 'x')).toBeCloseTo(end + 66, 6)
    expect(hs[5].text()).toBe('−47.5 h')
    expect(num(hs[5], 'x')).toBeCloseTo(ZERO + 8, 6)
    expect(ps[5].text()).toBe('−6%')
  })

  it('❗条尾数字写长了,百分比跟着往右让,不压字', () => {
    const d = data()
    d.rows[0] = row(3, 'E座', 1, 2807.5, 16.4)      // +2000.0 h:9 个字符
    const w = mount(PvAnchorBars, { props: { data: d, selId: null } })
    const h = w.findAll('text.pan-h')[0], p = w.findAll('text.pan-pct')[0]
    expect(h.text()).toBe('+2000.0 h')
    expect(num(p, 'x') - num(h, 'x')).toBeCloseTo(tipWidth(['+2000.0 h'], 0) + 5, 6)
    expect(num(p, 'x') - num(h, 'x')).toBeGreaterThan(58)
  })

  it('最右列:比去年多 ▲ 绿、少 ▼ 橙 + 琥珀字、持平不画箭头、没有同月显 —', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const ds = w.findAll('text.pan-d')
    expect(ds.map(t => t.text())).toEqual(['+16 h', '−42 h', '—', '0 h', '−79 h', '+12 h'])
    expect(ds.every(t => t.attributes('x') === String(W - 6))).toBe(true)
    expect(ds[1].attributes('fill')).toBe('#854F0B')
    const arrows = w.findAll('text.pan-arrow')
    expect(arrows.map(a => a.text())).toEqual(['▲', '▼', '▼', '▲'])
    expect(arrows[0].classes()).toContain('pan-up')
    expect(arrows[1].attributes('fill')).toBe('#EF9F27')
    expect(num(arrows[0], 'x')).toBe(W - 60)
    expect(absY(arrows[1])).toBe(8 + 26 + 17)
  })

  it('未投产那栋占行写字、不画条、不能点', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    expect(bar(w, 11).exists()).toBe(false)
    const off = w.find('text.pan-off')
    expect(off.text()).toBe('未投产 · 没有可算的年等效')
    expect(num(off, 'x')).toBeCloseTo(ZERO + 6, 6)
    expect(num(off, 'y')).toBe(8 + 6 * 26 + 17)
    expect(w.find('.pan-row[data-id="11"]').exists()).toBe(false)
    expect(w.findAll('.pan-row')).toHaveLength(6)
  })
})

describe('PvAnchorBars 选中与交互', () => {
  it('选中栋:同色不透明 + 墨描边,名字加粗;其余 85%', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: 4 } })
    expect(bar(w, 4).classes()).toContain('pan-bar-sel')
    expect(bar(w, 4).attributes('fill-opacity')).toBe('1')
    expect(bar(w, 4).attributes('fill')).toBe('#378ADD')
    expect(bar(w, 3).classes()).not.toContain('pan-bar-sel')
    expect(bar(w, 3).attributes('fill-opacity')).toBe('0.85')
    expect(w.findAll('text.pan-name-sel').map(t => t.text())).toEqual(['F座'])
  })

  it('行点击 emit pick(id),只选中', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await w.find('.pan-row[data-id="2"]').trigger('click')
    expect(w.emitted('pick')).toEqual([[2]])
  })

  it('悬停上半行:行底 5% 墨,气泡四行放行下', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const r = w.find('.pan-row[data-id="3"]')
    await r.trigger('mouseenter')
    expect(r.attributes('style')).toContain('var(--ink-050)')
    const lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines).toEqual(['E座 · 一期', '年等效 1147 h', '比锚点多 339.5 h（+42%）', '比去年多 16 h · 按 7 个月对齐'])
    const tw = tipWidth(lines, 22)
    const style = w.find('.pv-tip').attributes('style')
    expect(style).toContain(`left: ${Math.max(ZERO, Math.min(ZERO + 339.5 * S - 60, W - tw - 70))}px`)
    expect(style).toContain('top: 38px')
    await r.trigger('mouseleave')
    expect(w.find('.pv-tip').exists()).toBe(false)
  })

  it('悬停下半行:气泡放行上;负条写「少」;没有同月写比不了', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await w.find('.pan-row[data-id="13"]').trigger('mouseenter')
    let lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines[2]).toBe('比锚点少 47.5 h（−6%）')
    expect(w.find('.pv-tip').attributes('style')).toContain(`top: ${8 + 5 * 26 - 88}px`)
    // 负条的气泡不许钻到 0 线左边的栋名列里
    expect(w.find('.pv-tip').attributes('style')).toContain(`left: ${ZERO}px`)
    await w.find('.pan-row[data-id="7"]').trigger('mouseenter')
    lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines[3]).toBe('去年同月无抄表，比不了')
  })

  it('❗上一年数据没取到(还在请求 / 失败)不许写成「去年同月无抄表」;对照:取到了、这栋去年没抄 → 比不了', async () => {
    const off = mount(PvAnchorBars, { props: { data: { ...data(), prevLoaded: false }, selId: null } })
    await off.find('.pan-row[data-id="7"]').trigger('mouseenter')
    expect(off.findAll('.pv-tip span').map(s => s.text())[3]).toBe('上一年数据没取到')
    expect(off.find('.ana-ref').text()).toContain('上一年数据没取到，先显 —')
    expect(off.find('.ana-ref').text()).not.toContain('去年同月无抄表')
    const on = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    expect(on.find('.ana-ref').text()).toContain('去年同月无抄表显 —')
  })

  it('❗图注末尾写分母口径(§2.5 B3 / A2 都要写)', () => {
    const t = mount(PvAnchorBars, { props: { data: data(), selId: null } }).find('.ana-ref').text()
    expect(t.endsWith(' · 分母 = 台账装机（13 栋未录板数）')).toBe(true)
  })

  it('图注写「横轴不从 0 h 起」与在网不足的栋', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const t = w.find('.ana-ref').text()
    expect(t.startsWith('横轴不从 0 h 起：0 就是 807.5 h 那条线')).toBe(true)
    expect(t).toContain('在网天数不足 1 栋，不画、不年化（10栋）')
    expect(t).not.toContain('没有装机分母')
  })
})

// 2026-09-16 行为矩阵:只经段控进来的图 —— 挂载时视口内擦入 320(切子屏 / 切回页签);换期不重挂,条长同键 200 形变,名次变了整行 g 滑到新行
describe('PvAnchorBars 动效', () => {
  const inView = () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 999, width: 999, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  }
  afterEach(() => { vi.restoreAllMocks() })

  it('❗切子屏挂上来、在视口内:数据组挂 first + hold(栋名组也 hold、不擦);animationcancel / animationend 都摘;离屏挂载不擦', async () => {
    inView()
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await nextTick()
    expect(w.find('g.pan-data').classes()).toEqual(['pan-data', 'ana-morph', 'first', 'hold'])
    expect(w.find('g.pan-names').classes()).toEqual(['pan-names', 'ana-morph', 'hold'])
    await w.find('g.pan-data').trigger('animationcancel')
    expect(w.find('g.pan-data').classes()).toEqual(['pan-data', 'ana-morph'])
    expect(w.find('g.pan-names').classes()).toEqual(['pan-names', 'ana-morph'])
    const w2 = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await nextTick()
    await w2.find('g.pan-data').trigger('animationend')
    expect(w2.find('g.pan-data').classes()).toEqual(['pan-data', 'ana-morph'])
    vi.restoreAllMocks()
    const off = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await nextTick()
    expect(off.find('g.pan-data').classes()).toEqual(['pan-data', 'ana-morph'])
  })

  it('❗换年名次变了不挪 DOM:同一栋的条还是同一个元素、DOM 顺序不动,行 g 换到新名次;栋名与条尾字同行跟走', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const f = bar(w, 4).element
    const x0 = f.getAttribute('width')
    const d = data()
    d.rows = [row(4, 'F座', 1, 1300, -79), ...d.rows.filter(r => r.id !== 4)]
    await w.setProps({ data: d })
    expect(bar(w, 4).element).toBe(f)
    expect(f.getAttribute('width')).not.toBe(x0)
    expect(w.findAll('rect.pan-bar').map(r => Number(r.attributes('data-id')))).toEqual([3, 2, 7, 9, 4, 13])
    expect([rowY(f), rowY(bar(w, 3).element)]).toEqual([8, 8 + 26])
    expect(rowY(w.findAll('text.pan-name').find(t => t.text() === 'F座')!.element)).toBe(8)
    expect(f.closest('g.pan-rowg')!.querySelector('text.pan-h')!.textContent).toBe('+492.5 h')
  })

  it('❗悬停行(HTML 层)不在形变组里', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await w.find('.pan-row[data-id="3"]').trigger('mouseenter')
    expect(w.find('.pan-row[data-id="3"]').element.closest('.ana-morph')).toBe(null)
    expect(w.find('.pv-tip').element.closest('.ana-morph')).toBe(null)
  })
})
