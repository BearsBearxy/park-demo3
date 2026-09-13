// PvNullHist 挂载测:L4 直方图 + 观测红线。钉柱的 path(格位、柱高、矮柱圆角收小、零格不画)、横轴标签位置、
// 观测线位置与直标朝向(左边放不下挪到线右)、悬停格与气泡翻边、读数句是测量句。宽 = jsdom 初值 312。
import { describe, it, expect } from 'vitest'
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

  it('计数为 0 的格不画柱(对照:其余 15 格都画了)', () => {
    const w = mountIt()
    expect(bar(w, 0).exists()).toBe(false)
    expect(w.findAll('path.pnh-bar')).toHaveLength(15)
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
    const line = w.find('line.pnh-obs')
    expect(line.attributes('x1')).toBe('288.6')
    expect(line.attributes('x2')).toBe('288.6')
    expect(line.attributes('y1')).toBe('8')
    expect(line.attributes('y2')).toBe('116')
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
    expect(w.find('line.pnh-obs').attributes('x1')).toBe('38.6')
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
