// PvAnchorBars(A2 每千瓦日均和合格线的差)挂载测:0 线位置、条的 x/width、条尾两枚标签、最右列比去年、还没并网行、行点击与悬停气泡。
// 2026-10-06 改稿:年等效小时 → 每千瓦日均比合格线摊到每天(807.5 ÷ 365 = 2.21);差两位小数不带单位;最右列写百分比或「—」。
// 夹具非退化:三期都在、一条负条、比去年有涨有跌有 —、一栋还没并网;二期日均比一期高(差最长的是二期)。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type DOMWrapper } from '@vue/test-utils'
import PvAnchorBars from '../PvAnchorBars.vue'
import { tipWidth } from '@/components/ana/chartTip'
import type { AnchorBars, AnchorRow } from '../pvAnaV4.logic'

const W = 999, AD = 807.5 / 365
const row = (id: number, name: string, phase: number, perDay: number, prev: string, days = 365): AnchorRow => ({
  id, name, phase, perDay, days, delta: perDay - AD, deltaPct: (perDay / AD - 1) * 100, prev,
})
function data(): AnchorBars {
  return {
    anchorDay: AD,
    rows: [
      row(7, '9栋', 2, 4.57, '+3.2%', 214),
      row(9, '11栋', 2, 4.4, '—', 214),
      row(3, 'E座', 1, 2.85, '−1.8%'),
      row(2, 'C、D座', 1, 2.84, '+0.4%'),
      row(4, 'F座', 1, 2.3, '—'),
      row(13, '三期楼', 3, 2.0, '−12.0%', 120),
    ],
    unborn: [{ id: 11, name: '创业大厦', phase: 3 }],
    hint: '', badge: null, refs: [],
  }
}

// 独立按规格算:栋名列 96、右留 176、0 线在绘图宽 22%;正条最长的留 5% 顶到右界,负条左边也装得下
const PL = 96, PLOT = W - PL - 176, ZERO = PL + 0.22 * PLOT
const POS = 4.57 - AD, NEG = AD - 2.0
const S = Math.min((W - 176 - ZERO) / (POS * 1.05), (ZERO - PL) / (NEG * 1.05))
const bar = (w: ReturnType<typeof mount>, id: number) => w.find(`rect.pan-bar[data-id="${id}"]`)
const num = (el: DOMWrapper<Element>, k: string) => Number(el.attributes(k))
/** 行 g 靠 translateY 定位:元素的绝对 y = 自己的 y + 所在行 g 的 translateY */
const rowY = (el: Element) => Number(/translate\(0px, (-?[\d.]+)px\)/.exec(el.closest('g.pan-rowg')?.getAttribute('style') ?? '')?.[1])
const absY = (el: DOMWrapper<Element>) => num(el, 'y') + rowY(el.element)

describe('PvAnchorBars 几何', () => {
  it('0 线 = 合格线摊到每天,落在绘图宽 22%,线下写「0 是合格线」;画布高 = 8 + 行数 × 26 + 34;名字右对齐于 86', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const a = w.find('.pan-anchor')
    expect(num(a, 'x1')).toBeCloseTo(ZERO, 6)
    expect(a.attributes('stroke-dasharray')).toBe('5 4')
    expect(w.find('.pan-anchor-t').text()).toBe('0 是合格线')
    expect(num(w.find('.pan-anchor-t'), 'y')).toBe(8 + 7 * 26 + 30)
    expect(num(w.find('svg'), 'height')).toBe(8 + 7 * 26 + 34)
    const names = w.findAll('text.pan-name')
    expect(names.map(n => n.text())).toEqual(['9栋', '11栋', 'E座', 'C、D座', 'F座', '三期楼', '创业大厦'])
    expect(names.every(n => n.attributes('x') === '86' && n.attributes('text-anchor') === 'end')).toBe(true)
  })

  it('❗条长 = 比合格线每天多几 kWh:二期 4.57 的条比一期 2.85 长(原来按年等效排在一期后面);负条往左;按期别上色', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const top = bar(w, 7)
    expect(num(top, 'x')).toBeCloseTo(ZERO, 6)
    expect(num(top, 'width')).toBeCloseTo(POS * S, 6)
    expect(num(top, 'x') + num(top, 'width')).toBeCloseTo(W - 176 - POS * S * 0.05, 6)
    expect(num(top, 'width')).toBeGreaterThan(num(bar(w, 3), 'width') * 3)
    expect(absY(top)).toBe(14)
    expect(top.attributes('fill')).toBe('#378ADD')   // 二期
    expect(bar(w, 3).attributes('fill')).toBe('#0C447C')   // 一期
    const neg = bar(w, 13)
    expect(num(neg, 'x')).toBeCloseTo(ZERO - NEG * S, 6)
    expect(num(neg, 'width')).toBeCloseTo(NEG * S, 6)
    expect(absY(neg)).toBe(8 + 5 * 26 + 6)
    expect(neg.attributes('fill')).toBe('#85B7EB')   // 三期
  })

  it('竖网格从每 0.5 起:−0.5 0 +0.5 +1 +1.5 +2;有负条时往左也画到栋名列边', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const labels = w.findAll('text.pan-ax').filter(t => t.attributes('y') === String(8 + 7 * 26 + 16)).map(t => t.text())
    expect(labels).toEqual(['−0.5', '0', '+0.5', '+1', '+1.5', '+2'])
    const g = w.findAll('.pan-gl')
    expect(num(g[2], 'x1')).toBeCloseTo(ZERO + 0.5 * S, 6)
    expect(num(g[0], 'x1')).toBeGreaterThanOrEqual(PL)
  })

  it('对照:没有负条就不画 0 线左边的网格', () => {
    const d = data()
    d.rows = d.rows.filter(r => r.delta > 0)
    const w = mount(PvAnchorBars, { props: { data: d, selId: null } })
    const first = w.findAll('text.pan-ax').find(t => t.attributes('text-anchor') === 'middle')!
    expect(first.text()).toBe('0')
    expect(w.findAll('.pan-gl').length).toBeGreaterThan(1)
  })

  it('条尾两枚标签:差两位小数不带单位在条尾 + 8,百分比再往右 58;负条的标签从 0 线右侧起', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const hs = w.findAll('text.pan-h'), ps = w.findAll('text.pan-pct')
    const end = ZERO + POS * S
    expect(hs[0].text()).toBe('+2.36')
    expect(num(hs[0], 'x')).toBeCloseTo(end + 8, 6)
    expect(ps[0].text()).toBe('+107%')
    expect(num(ps[0], 'x')).toBeCloseTo(end + 66, 6)
    expect(hs[2].text()).toBe('+0.64')
    expect(ps[2].text()).toBe('+29%')
    expect(hs[5].text()).toBe('−0.21')
    expect(num(hs[5], 'x')).toBeCloseTo(ZERO + 8, 6)
    expect(ps[5].text()).toBe('−10%')
  })

  it('❗条尾数字写长了,百分比跟着往右让,不压字', () => {
    const d = data()
    d.rows[0] = row(7, '9栋', 2, AD + 1234.5678, '—')      // +1234.57:8 个字符
    const w = mount(PvAnchorBars, { props: { data: d, selId: null } })
    const h = w.findAll('text.pan-h')[0], p = w.findAll('text.pan-pct')[0]
    expect(h.text()).toBe('+1234.57')
    expect(num(p, 'x') - num(h, 'x')).toBe(58)
    d.rows[0] = row(7, '9栋', 2, AD + 123456.789, '—')     // +123456.79:10 个字符,字宽 66 > 58
    const w2 = mount(PvAnchorBars, { props: { data: d, selId: null } })
    const h2 = w2.findAll('text.pan-h')[0], p2 = w2.findAll('text.pan-pct')[0]
    expect(num(p2, 'x') - num(h2, 'x')).toBeCloseTo(tipWidth(['+123456.79'], 0) + 5, 6)
    expect(num(p2, 'x') - num(h2, 'x')).toBeGreaterThan(58)
  })

  it('❗最右列「比去年」:有数写百分比(正文墨),没数写「—」(淡墨);不再画 ▲▼', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const ds = w.findAll('text.pan-d')
    expect(ds.map(t => t.text())).toEqual(['+3.2%', '—', '−1.8%', '+0.4%', '—', '−12.0%'])
    expect(ds.every(t => t.attributes('x') === String(W - 6) && t.attributes('text-anchor') === 'end')).toBe(true)
    expect(ds.map(t => t.classes().includes('pan-d-none'))).toEqual([false, true, false, false, true, false])
    expect(w.findAll('text.pan-arrow')).toHaveLength(0)
    expect(w.findAll('text.pan-ax').find(t => t.attributes('y') === '9')!.text()).toBe('比去年')
  })

  it('还没并网那栋占行写「还没并网」、不画条、不能点', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    expect(bar(w, 11).exists()).toBe(false)
    const off = w.find('text.pan-off')
    expect(off.text()).toBe('还没并网')
    expect(num(off, 'x')).toBeCloseTo(ZERO + 6, 6)
    expect(num(off, 'y')).toBe(8 + 6 * 26 + 17)
    expect(w.find('.pan-row[data-id="11"]').exists()).toBe(false)
    expect(w.findAll('.pan-row')).toHaveLength(6)
  })

  it('图例:一期 二期 三期 合格线 + 条长说明;卡下参照不在组件里(屏写)', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    expect(w.findAll('.pv-leg > span').map(s => s.text())).toEqual(['一期', '二期', '三期', '合格线', '条长：比合格线每天多发几 kWh'])
    expect(w.find('.ana-ref').exists()).toBe(false)
  })
})

describe('PvAnchorBars 选中与交互', () => {
  it('选中栋:同色不透明 + 墨描边,名字加粗;其余 85%', () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: 4 } })
    expect(bar(w, 4).classes()).toContain('pan-bar-sel')
    expect(bar(w, 4).attributes('fill-opacity')).toBe('1')
    expect(bar(w, 4).attributes('fill')).toBe('#0C447C')
    expect(bar(w, 3).classes()).not.toContain('pan-bar-sel')
    expect(bar(w, 3).attributes('fill-opacity')).toBe('0.85')
    expect(w.findAll('text.pan-name-sel').map(t => t.text())).toEqual(['F座'])
  })

  it('行点击 emit pick(id),只选中', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await w.find('.pan-row[data-id="2"]').trigger('click')
    expect(w.emitted('pick')).toEqual([[2]])
  })

  it('悬停上半行:行底 5% 墨,气泡四行放行下(每千瓦日均、几天、比合格线、比去年)', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    const r = w.find('.pan-row[data-id="7"]')
    await r.trigger('mouseenter')
    expect(r.attributes('style')).toContain('var(--ink-050)')
    const lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines).toEqual(['9栋 · 二期', '每千瓦日均 4.57 kWh · 214 天', '比合格线每天多 2.36 kWh（+107%）', '比去年 +3.2%'])
    const tw = tipWidth(lines, 22)
    const style = w.find('.pv-tip').attributes('style')
    expect(style).toContain(`left: ${Math.max(ZERO, Math.min(ZERO + POS * S - 60, W - tw - 70))}px`)
    expect(style).toContain('top: 38px')
    await r.trigger('mouseleave')
    expect(w.find('.pv-tip').exists()).toBe(false)
  })

  it('悬停下半行:气泡放行上;负条写「少」;比去年没数不出那一行', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await w.find('.pan-row[data-id="13"]').trigger('mouseenter')
    expect(w.findAll('.pv-tip span').map(s => s.text())[2]).toBe('比合格线每天少 0.21 kWh（−10%）')
    expect(w.find('.pv-tip').attributes('style')).toContain(`top: ${8 + 5 * 26 - 88}px`)
    // 负条的气泡不许钻到 0 线左边的栋名列里
    expect(w.find('.pv-tip').attributes('style')).toContain(`left: ${ZERO}px`)
    await w.find('.pan-row[data-id="9"]').trigger('mouseenter')
    expect(w.findAll('.pv-tip span')).toHaveLength(3)
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
    d.rows = [row(4, 'F座', 1, 5.0, '—'), ...d.rows.filter(r => r.id !== 4)]
    await w.setProps({ data: d })
    expect(bar(w, 4).element).toBe(f)
    expect(f.getAttribute('width')).not.toBe(x0)
    expect(w.findAll('rect.pan-bar').map(r => Number(r.attributes('data-id')))).toEqual([7, 9, 3, 2, 4, 13])
    expect([rowY(f), rowY(bar(w, 7).element)]).toEqual([8, 8 + 26])
    expect(rowY(w.findAll('text.pan-name').find(t => t.text() === 'F座')!.element)).toBe(8)
    expect(f.closest('g.pan-rowg')!.querySelector('text.pan-h')!.textContent).toBe('+2.79')
  })

  it('❗悬停行(HTML 层)不在形变组里', async () => {
    const w = mount(PvAnchorBars, { props: { data: data(), selId: null } })
    await w.find('.pan-row[data-id="3"]').trigger('mouseenter')
    expect(w.find('.pan-row[data-id="3"]').element.closest('.ana-morph')).toBe(null)
    expect(w.find('.pv-tip').element.closest('.ana-morph')).toBe(null)
  })
})
