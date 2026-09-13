// PvRevenueBars(B8)挂载测:条从 104 起、两段接缝、条尾合计 x、段内写得下才写数(按字宽)、
// 期别点色、选中栋加粗、行悬停气泡上下半行分放。
// 夹具非退化:三期都在、合计从 3.96 万到 0.20 万、一栋没有上网、一栋上网段只有几像素、一对段宽卡在写数门槛两侧。
import { describe, expect, it } from 'vitest'
import { mount, type DOMWrapper } from '@vue/test-utils'
import PvRevenueBars from '../PvRevenueBars.vue'
import { tipWidth } from '@/components/ana/chartTip'
import type { RevenueBars, RevenueRow } from '../pvAnaV4.logic'

const W = 999, PL = 104
const num = (el: DOMWrapper<Element>, k: string) => Number(el.attributes(k))
const attr = (el: DOMWrapper<Element>, k: string) => el.attributes(k) ?? ''
const row = (id: number, name: string, phase: number, gen: number, self: number, grid: number): RevenueRow =>
  ({ id, name, phase, gen, self, grid, total: self + grid })
function data(): RevenueBars {
  return {
    rows: [
      row(2, 'C、D座', 1, 86000, 26000, 13600),
      row(1, 'B座', 1, 51600, 17300, 6900),
      row(9, '11栋', 2, 35000, 13700, 3200),
      row(6, '8栋', 2, 30100, 11700, 200),     // 上网段不到 4px
      row(7, '9栋', 2, 9000, 2000, 0),         // 没有上网;自用段 0.20 万 ≈ 39.4px,刚够写
      row(13, '三期楼', 3, 8800, 1900, 50),     // 自用段 0.19 万 ≈ 37.4px,写不下
    ],
    gridPrice: 0.4, through: '8/28',
  }
}
const S = (W - 84 - PL) / (3.96 * 1.04)
const rect = (w: ReturnType<typeof mount>, k: string, id: number) => w.find(`rect.prb-${k}[data-id="${id}"]`)

describe('PvRevenueBars 几何', () => {
  it('条从 104 起:自用段宽 = 值 × 比例,上网段接在自用尾,合计字在条尾 + 8;最长那条留 4%', () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: null } })
    const self = rect(w, 'self', 2), grid = rect(w, 'grid', 2)
    const selfEnd = PL + 2.6 * S
    expect(num(self, 'x')).toBe(PL)
    expect(num(self, 'width')).toBeCloseTo(2.6 * S + 6, 6)   // 伸进上网段 6px 藏右圆角
    expect(num(grid, 'x')).toBeCloseTo(selfEnd, 6)
    expect(num(grid, 'width')).toBeCloseTo(1.36 * S, 6)
    expect(num(grid, 'x') + num(grid, 'width')).toBeCloseTo(W - 84 - 3.96 * S * 0.04, 6)
    const tot = w.find('text.prb-tot[data-id="2"]')
    expect(tot.text()).toBe('3.96')
    expect(num(tot, 'x')).toBeCloseTo(PL + 3.96 * S + 8, 6)
    expect(num(self, 'y')).toBe(11.5)
    expect(num(rect(w, 'self', 1), 'y')).toBe(6 + 27 + 5.5)
    expect(num(w.find('svg'), 'height')).toBe(6 + 6 * 27 + 26)
  })

  it('❗上网段只有几像素:自用段只往里伸那几像素,不冒出条尾;没有上网的栋不画上网段', () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: null } })
    const gw = 0.02 * S
    expect(num(rect(w, 'self', 6), 'width')).toBeCloseTo(1.17 * S + gw, 6)
    expect(num(rect(w, 'self', 6), 'x') + num(rect(w, 'self', 6), 'width')).toBeCloseTo(PL + 1.19 * S, 6)
    expect(rect(w, 'grid', 7).exists()).toBe(false)
    expect(num(rect(w, 'self', 7), 'width')).toBeCloseTo(0.2 * S, 6)
  })

  it('横轴整数刻度 0–4,1 万元落在 104 + 比例', () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: null } })
    const t = w.findAll('text.prb-ax')
    expect(t.map(x => x.text())).toEqual(['0', '1', '2', '3', '4'])
    expect(num(t[1], 'x')).toBeCloseTo(PL + S, 6)
    expect(num(w.find('.prb-axl'), 'x2')).toBe(W - 84)
  })

  it('❗段内写数按字宽:0.20 万段宽 39.4 写得下、0.19 万段宽 37.4 写不下;几像素的上网段不写', () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: null } })
    expect(0.2 * S).toBeGreaterThanOrEqual(tipWidth(['0.20'], 0) + 12)
    expect(0.19 * S).toBeLessThan(tipWidth(['0.19'], 0) + 12)
    const selfTexts = w.findAll('text.prb-in-self').map(t => t.text())
    expect(selfTexts).toEqual(['2.60', '1.73', '1.37', '1.17', '0.20'])
    const gridTexts = w.findAll('text.prb-in-grid')
    expect(gridTexts.map(t => t.text())).toEqual(['1.36', '0.69', '0.32'])
    expect(num(gridTexts[0], 'x')).toBeCloseTo(PL + 2.6 * S + 7, 6)
    expect(num(w.findAll('text.prb-in-self')[0], 'x')).toBe(PL + 7)
  })

  it('❗字长了门槛跟着涨:年档 5 位数的「50.00」段宽 39 写不下,「60.00」段宽 46.8 写得下', () => {
    const d: RevenueBars = {
      rows: [
        row(2, 'C、D座', 1, 9e6, 6e6, 4e6),        // 合计 1000 万,比例 ≈ 0.78 px/万
        row(1, 'B座', 1, 3e6, 6e5, 1.2e6),
        row(9, '11栋', 2, 2e6, 5e5, 1e6),
      ],
      gridPrice: 0.4, through: null,
    }
    const s = (W - 84 - PL) / (1000 * 1.04)
    expect(50 * s).toBeGreaterThan(38)
    expect(50 * s).toBeLessThan(tipWidth(['50.00'], 0) + 12)
    expect(60 * s).toBeGreaterThanOrEqual(tipWidth(['60.00'], 0) + 12)
    const w = mount(PvRevenueBars, { props: { data: d, selId: null } })
    expect(w.findAll('text.prb-in-self').map(t => t.text())).toEqual(['600.00', '60.00'])
    expect(w.findAll('text.prb-ax').map(t => t.text())).toEqual(['0', '200', '400', '600', '800', '1000'])
  })

  it('期别点按期上色;选中栋名字加粗', () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: 9 } })
    const dots = w.findAll('circle.prb-dot')
    expect(dots.map(d => d.attributes('fill'))).toEqual(['#378ADD', '#378ADD', '#5DCAA5', '#5DCAA5', '#5DCAA5', '#EF9F27'])
    expect(num(dots[2], 'cy')).toBe(6 + 2 * 27 + 13.5)
    expect(w.findAll('text.prb-name-sel').map(t => t.text())).toEqual(['11栋'])
  })
})

describe('PvRevenueBars 悬停与图注', () => {
  it('悬停上半行:行底 4% 墨,气泡五行,放在行下 30、条尾右 60', async () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: null } })
    const r = w.find('.prb-row[data-id="1"]')
    await r.trigger('mouseenter')
    expect(r.attributes('style')).toContain('var(--ink-040)')
    const lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines).toEqual(['B座 · 一期', '本段发电 5.16 万度', '自己用了 ¥1.73 万', '卖上网 ¥0.69 万', '合计 ¥2.42 万'])
    const tw = tipWidth(lines, 22)
    const style = w.find('.pv-tip').attributes('style')
    expect(style).toContain(`left: ${Math.min(PL + 2.42 * S + 60, W - tw - 8)}px`)
    expect(style).toContain(`top: ${6 + 27 + 30}px`)
    await r.trigger('mouseleave')
    expect(w.find('.pv-tip').exists()).toBe(false)
  })

  it('❗悬停下半行:气泡放行上 104;条尾靠右时气泡夹在画布内', async () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: null } })
    await w.find('.prb-row[data-id="13"]').trigger('mouseenter')
    expect(w.find('.pv-tip').attributes('style')).toContain(`top: ${6 + 5 * 27 - 104}px`)
    await w.find('.prb-row[data-id="6"]').trigger('mouseenter')      // 第 4 行往上放不下 104,夹到 0
    expect(w.find('.pv-tip').attributes('style')).toContain('top: 0px')
    await w.find('.prb-row[data-id="2"]').trigger('mouseenter')
    const tw = tipWidth(w.findAll('.pv-tip span').map(s => s.text()), 22)
    expect(PL + 3.96 * S + 60).toBeGreaterThan(W - tw - 8)
    expect(w.find('.pv-tip').attributes('style')).toContain(`left: ${W - tw - 8}px`)
  })

  it('图例与图注写上网单价常量、数据到哪天;对照:录满了不写数据到', () => {
    const w = mount(PvRevenueBars, { props: { data: data(), selId: null } })
    expect(w.find('.pv-leg').text()).toContain('卖上网的（上网 ¥0.40/度）')
    expect(w.find('.ana-ref').text()).toBe(
      '横轴 = 万元，从 0 起 · 两段叠起来，条尾就是合计，不用心算 · 按合计从多到少排 · 两段单价口径不同（自用按录入时的单价、上网按 ¥0.40/度） · 数据到 8/28',
    )
    const full = mount(PvRevenueBars, { props: { data: { ...data(), through: null }, selId: null } })
    expect(full.find('.ana-ref').text()).not.toContain('数据到')
  })
})
