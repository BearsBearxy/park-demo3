// PvNullHist 挂载测:L4 直方图 + 观测红线。钉柱的 path(格位、柱高、矮柱圆角收小、零格不画)、横轴标签位置、
// 观测线位置与直标朝向(左边放不下挪到线右)、悬停格与气泡翻边、读数句是测量句。宽 = jsdom 初值 312。
import { afterEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PvNullHist from '../PvNullHist.vue'
import type { NullHist } from '../pvAnaV4.logic'

// 16 格从 −0.08 起、格宽 0.01;计数合计 999(= 重算次数),第 0 格为 0、第 1 格很矮
const COUNTS = [0, 2, 9, 20, 41, 70, 112, 148, 170, 150, 120, 80, 40, 20, 10, 7]
const DATA: NullHist = {
  id: 6, name: 'F座',
  bins: COUNTS.map((count, i) => ({ lo: -0.08 + i * 0.01, hi: -0.08 + (i + 1) * 0.01, count })),
  obs: 0.071, extreme: 6, total: 1000,
}
const mountIt = (data: NullHist = DATA, period?: string) => mount(PvNullHist, { props: { data, period } })
const bar = (w: ReturnType<typeof mountIt>, i: number) => w.find(`path.pnh-bar[data-i="${i}"]`)
const px = (s: string | undefined, prop: string) => Number(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(s ?? '')?.[1])

// 绘图区 x 30 … 304(宽 274),格宽 274/16 = 17.125 → 17.1;纵轴上端 170 × 1.12 = 190.4,y 12 … 116
describe('PvNullHist · 柱的几何', () => {
  it('❗最高那格:x = 30 + 8 × 17.125 = 167,柱两侧内缩 0.5,顶 = 116 − 170/190.4 × 104 = 23.1,圆角 2', () => {
    expect(bar(mountIt(), 8).attributes('d')).toBe('M167.5,116 L167.5,25.1 Q167.5,23.1 169.5,23.1 L181.6,23.1 Q183.6,23.1 183.6,25.1 L183.6,116 Z')
    expect(bar(mountIt(), 8).attributes('fill')).toBe('#B5D4F4')
    expect(bar(mountIt(), 8).attributes('fill-opacity')).toBe('.85')
  })

  it('❗矮柱(2 次,高 1.1)圆角收成柱高,不画出底线以下', () => {
    expect(bar(mountIt(), 1).attributes('d')).toBe('M47.6,116 L47.6,116 Q47.6,114.9 48.7,114.9 L62.6,114.9 Q63.7,114.9 63.7,116 L63.7,116 Z')
  })

  it('计数为 0 的格画成高 0 的柱(看不见;同一结构,换栋时才能从 0 长出来);其余 15 格都有高度', () => {
    const w = mountIt()
    expect(bar(w, 0).attributes('d')).toBe('M30.5,116 L30.5,116 Q30.5,116 30.5,116 L46.6,116 Q46.6,116 46.6,116 L46.6,116 Z')
    const minY = (d: string) => Math.min(...[...d.matchAll(/,(-?[\d.]+)/g)].map(m => Number(m[1])))
    expect(w.findAll('path.pnh-bar').map(p => minY(p.attributes('d')!) < 116)).toEqual([false, ...Array(15).fill(true)])
  })

  it('横轴在第 3 / 7 / 11 / 15 格左缘标数', () => {
    const ticks = mountIt().findAll('text.ax').filter(t => t.attributes('y') === '130')
    expect(ticks.map(t => t.text())).toEqual(['-0.050', '-0.010', '0.030', '0.070'])
    expect(ticks.map(t => t.attributes('x'))).toEqual(['81.4', '149.9', '218.4', '286.9'])
  })
})

describe('PvNullHist · 观测线', () => {
  it('❗红线 x = 30 + (0.071 + 0.08)/0.16 × 274 = 288.6,上端伸出绘图区 4px;直标两行在线左 6px 右对齐', () => {
    const w = mountIt()
    const line = w.find('path.pnh-obs')
    expect(line.attributes('d')).toBe('M288.6,8 V116')
    expect(line.attributes('stroke')).toBe('#E24B4A')
    expect(line.attributes('stroke-width')).toBe('2')
    const l1 = w.find('text.pnh-l1'), l2 = w.find('text.pnh-l2')
    expect(l1.text()).toBe('这一段 +0.071')
    expect(l2.text()).toBe('比它更极端的只有 6/1000 次')
    expect(l1.attributes('x')).toBe('282.6')
    expect(l1.attributes('text-anchor')).toBe('end')
    expect(l1.attributes('style')).toContain('fill: #E24B4A')
    expect(l2.attributes('style')).toContain('fill: #854F0B')
  })

  it('❗红线贴左边时直标挪到线右 6px、左对齐', () => {
    const w = mountIt({ ...DATA, obs: -0.075 })
    expect(w.find('path.pnh-obs').attributes('d')).toBe('M38.6,8 V116')
    const l1 = w.find('text.pnh-l1')
    expect(l1.text()).toBe('这一段 −0.075')
    expect(l1.attributes('x')).toBe('44.6')
    expect(l1.attributes('text-anchor')).toBe('start')
    expect(w.find('text.pnh-l2').attributes('text-anchor')).toBe('start')
  })
})

describe('PvNullHist · 悬停', () => {
  it('❗悬停第 2 格:格 5% 墨 + 两行气泡,放在格左 + 16', async () => {
    const w = mountIt()
    await w.findAll('rect.pnh-hit')[2].trigger('mouseenter')
    const slot = w.find('rect.pnh-slot')
    expect(slot.attributes('x')).toBe('64.3')
    expect(slot.attributes('width')).toBe('17.1')
    const tip = w.find('.cz-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['-0.060 ~ -0.050', '1000 遍里落在这一格 9 遍'])
    expect(px(tip.attributes('style'), 'left')).toBeCloseTo(80.3, 5)
  })

  it('❗第 12 格右边放不下,翻到格左 − 8 − 气泡宽', async () => {
    const w = mountIt()
    await w.findAll('rect.pnh-hit')[12].trigger('mouseenter')
    // 格左 235.5;气泡宽 =「1000 遍里落在这一格 40 遍」4×6.6 + 3×6.6 + 2×6.6 + 8×12 = 155.4 → 156 + 22 = 178
    expect(px(w.find('.cz-tip').attributes('style'), 'left')).toBeCloseTo(235.5 - 8 - 178, 5)
    await w.find('.pnh-plot').trigger('mouseleave')
    expect(w.find('.cz-tip').exists()).toBe(false)
    expect(w.find('rect.pnh-slot').exists()).toBe(false)
  })
})

describe('PvNullHist · 文案', () => {
  it('❗读数句只写测量,不下「不像是碰巧」的结论;卡头写出是哪一栋、打乱多少遍', () => {
    const w = mountIt()
    expect(w.find('.ana-read').text()).toBe('1000 遍里有 6 遍比这一段更偏。')
    expect(w.text()).not.toMatch(/碰巧碰上|不像是/)
    expect(w.find('.hint').text()).toBe('把 F座 的日子打乱重算 1000 遍，看能不能碰出这么大的偏差')
  })

  it('观测窗口由 view 传进来时写在参照系末尾;没传不写', () => {
    expect(mountIt(DATA, '2025-08').find('.ana-ref').text())
      .toBe('横轴 = 打乱之后算出来的偏差 · 柱高 = 1000 遍里落在这一格的次数 · 红线 = 这一段真实的偏差 · 这一段 = 2025-08')
    expect(mountIt().find('.ana-ref').text()).not.toContain('这一段 =')
  })
})

// 2026-09-16 行为矩阵:只经段控进来的图 —— 挂载时视口内擦入 320;换栋 / 换期不重挂,柱按格序、红线跟观测值 200 形变
describe('PvNullHist 动效', () => {
  const inView = () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 312, width: 312, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  }
  afterEach(() => { vi.restoreAllMocks() })

  it('❗切子屏挂上来、在视口内:数据组 first + hold;animationcancel / animationend 都摘;离屏不擦', async () => {
    inView()
    const w = mountIt()
    await nextTick()
    expect(w.find('g.pnh-data').classes()).toEqual(['pnh-data', 'ana-morph', 'first', 'hold'])
    await w.find('g.pnh-data').trigger('animationcancel')
    expect(w.find('g.pnh-data').classes()).toEqual(['pnh-data', 'ana-morph'])
    const w2 = mountIt()
    await nextTick()
    await w2.find('g.pnh-data').trigger('animationend')
    expect(w2.find('g.pnh-data').classes()).toEqual(['pnh-data', 'ana-morph'])
    vi.restoreAllMocks()
    const off = mountIt()
    await nextTick()
    expect(off.find('g.pnh-data').classes()).toEqual(['pnh-data', 'ana-morph'])
  })

  it('❗换栋不重挂:零格长出来的柱、红线都还是原来的元素,d 换成新栋的;柱与红线在形变组里,轴线与悬停槽底不在', async () => {
    const w = mountIt()
    const b0 = bar(w, 0).element
    const obs = w.find('path.pnh-obs').element
    await w.setProps({ data: { ...DATA, name: '别的栋', obs: -0.02, bins: DATA.bins.map((b, i) => ({ ...b, count: i === 0 ? 30 : b.count })) } })
    expect(bar(w, 0).element).toBe(b0)
    expect(w.find('path.pnh-obs').element).toBe(obs)
    expect(b0.getAttribute('d')).not.toContain('Q30.5,116 30.5,116')
    expect(obs.getAttribute('d')).not.toBe('M288.6,8 V116')
    expect(w.find('g.pnh-data').findAll('path.pnh-bar')).toHaveLength(16)
    await w.find('rect.pnh-hit').trigger('mouseenter')
    for (const sel of ['rect.pnh-slot', 'line.axl']) expect(w.find(sel).element.closest('.ana-morph'), sel).toBe(null)
  })
})
