// PvAcfBars 挂载测:L2 竖柱 + 淡带。钉柱的 path(位置、高度、圆角朝向)、带的 y/高、带内柱浅一档、x 标签位置、
// 悬停柱槽与气泡翻边、读数句是测量句。夹具 14 个间隔,有正有负、有带内有带外;宽 = jsdom 初值 312。
import { afterEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PvAcfBars from '../PvAcfBars.vue'
import type { AcfBars } from '../pvAnaV4.logic'

const N = 227
const THR = 1.96 / Math.sqrt(N)   // 0.1301
const RHO = [0.58, 0.40, 0.25, 0.17, 0.11, 0.08, 0.15, -0.05, 0.06, -0.12, 0.03, 0.02, 0.09, -0.21]
const DATA: AcfBars = {
  id: 6, name: 'F座', n: N, threshold: THR,
  bars: RHO.map((rho, k) => ({ lag: k + 1, rho, inside: Math.abs(rho) <= THR })),
}
const mountIt = (data = DATA) => mount(PvAcfBars, { props: { data } })
const bar = (w: ReturnType<typeof mountIt>, lag: number) => w.find(`path.pacf-bar[data-lag="${lag}"]`)
const px = (s: string | undefined, prop: string) => Number(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(s ?? '')?.[1])

// 纵轴:上端 ceil(0.58 × 10)/10 = 0.6,下端 floor(−0.21 × 20)/20 = −0.25;y 10 … 116
// Y(v) = 10 + (0.6 − v) / 0.85 × 106 → Y(0) = 84.8、Y(0.58) = 12.5、Y(−0.21) = 111
// 槽宽 274 / 14 = 19.571,柱宽 11,第 1 根柱 x = 30 + (19.571 − 11)/2 = 34.3
describe('PvAcfBars · 柱与带的几何', () => {
  it('❗正值柱从 0 线往上,顶端两角圆角 2', () => {
    expect(bar(mountIt(), 1).attributes('d')).toBe('M34.3,84.8 L34.3,14.5 Q34.3,12.5 36.3,12.5 L43.3,12.5 Q45.3,12.5 45.3,14.5 L45.3,84.8 Z')
  })

  it('❗负值柱从 0 线往下,圆角在底端', () => {
    // 第 14 根:x = 30 + 13 × 19.571 + 4.286 = 288.7
    expect(bar(mountIt(), 14).attributes('d')).toBe('M288.7,84.8 L288.7,109 Q288.7,111 290.7,111 L297.7,111 Q299.7,111 299.7,109 L299.7,84.8 Z')
  })

  it('❗淡带 = ±1.96/√n,y 从 Y(+带) 到 Y(−带),横跨绘图区,浅蓝 20%', () => {
    const band = mountIt().find('rect.pacf-band')
    expect(band.attributes('x')).toBe('30')
    expect(band.attributes('width')).toBe('274')
    expect(band.attributes('y')).toBe('68.6')
    expect(band.attributes('height')).toBe('32.4')
    expect(band.attributes('fill')).toBe('#B5D4F4')
    expect(band.attributes('fill-opacity')).toBe('.20')
  })

  it('❗带外柱主色、带内柱浅一档(|ρ| ≤ 带 才算带内,负值同理)', () => {
    const w = mountIt()
    expect(bar(w, 1).attributes('fill')).toBe('#378ADD')     // 0.58
    expect(bar(w, 7).attributes('fill')).toBe('#378ADD')     // 0.15 > 0.1301
    expect(bar(w, 5).attributes('fill')).toBe('#85B7EB')     // 0.11
    expect(bar(w, 10).attributes('fill')).toBe('#85B7EB')    // −0.12
    expect(bar(w, 14).attributes('fill')).toBe('#378ADD')    // −0.21
  })

  it('横网格每 0.3 一条(只画纵轴范围里的),x 只标 1 / 4 / 7 / 10 / 末一个(13 贴着 14 不标)', () => {
    const w = mountIt()
    const yl = w.findAll('text.ax').filter(t => t.attributes('text-anchor') === 'end')
    expect(yl.map(t => t.text())).toEqual(['0.0', '0.3', '0.6'])
    expect(yl.map(t => t.attributes('y'))).toEqual(['88.8', '51.4', '14'])
    const xl = w.findAll('text.ax').filter(t => t.attributes('text-anchor') === 'middle')
    expect(xl.map(t => t.text())).toEqual(['1', '4', '7', '10', '14'])
    expect(xl.map(t => t.attributes('x'))).toEqual(['39.8', '98.5', '157.2', '215.9', '294.2'])
  })

  it('没有有效天数(带宽无穷)时不画带,纵轴只按柱取', () => {
    const w = mountIt({ ...DATA, n: 0, threshold: Infinity, bars: DATA.bars.map(b => ({ ...b, inside: true })) })
    expect(w.find('rect.pacf-band').exists()).toBe(false)
    // 下端 floor(−0.21 × 20)/20 仍是 −0.25,柱位置不变
    expect(bar(w, 1).attributes('d')).toBe('M34.3,84.8 L34.3,14.5 Q34.3,12.5 36.3,12.5 L43.3,12.5 Q45.3,12.5 45.3,14.5 L45.3,84.8 Z')
  })
})

describe('PvAcfBars · 悬停', () => {
  it('❗悬停第 1 根:整槽 5% 墨 + 两行气泡,放在柱左 + 16', async () => {
    const w = mountIt()
    expect(w.find('rect.pacf-slot').exists()).toBe(false)
    await w.findAll('rect.pacf-hit')[0].trigger('mouseenter')
    const slot = w.find('rect.pacf-slot')
    expect(slot.attributes('x')).toBe('30')
    expect(slot.attributes('width')).toBe('19.6')
    const tip = w.find('.cz-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['隔 1 天', '0.58　还看得出关系'])
    expect(px(tip.attributes('style'), 'left')).toBeCloseTo(50.3, 5)
  })

  it('❗最后一根右边放不下,翻到柱左 − 8 − 气泡宽', async () => {
    const w = mountIt()
    await w.findAll('rect.pacf-hit')[13].trigger('mouseenter')
    const tip = w.find('.cz-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['隔 14 天', '-0.21　还看得出关系'])
    // 气泡宽 = 「-0.21　还看得出关系」5 × 6.6 + 7 × 12 = 117 → +22 = 139;288.7 − 8 − 139 = 141.7
    expect(px(tip.attributes('style'), 'left')).toBeCloseTo(141.7, 5)
  })

  it('带内柱气泡第二行写「在淡带里」;移出画布收起', async () => {
    const w = mountIt()
    await w.findAll('rect.pacf-hit')[4].trigger('mouseenter')
    expect(w.find('.cz-tip').text()).toContain('0.11　在淡带里，算没有规律')
    await w.find('.pacf-plot').trigger('mouseleave')
    expect(w.find('.cz-tip').exists()).toBe(false)
    expect(w.find('rect.pacf-slot').exists()).toBe(false)
  })
})

describe('PvAcfBars · 文案', () => {
  it('❗读数句只写测量:两个间隔的值 + 带外几根,不下「第二天多半还偏高」这类结论', () => {
    const read = mountIt().find('.ana-read').text()
    expect(read).toBe('隔 1 天 0.58，隔 3 天 0.25 · 隔 1–14 天里 6 根柱在淡带外。')
    expect(read).not.toMatch(/多半|还偏高|掉到/)
  })

  it('参照系写出算的是哪一栋', () => {
    expect(mountIt().find('.ana-ref').text()).toBe('横轴 = 隔几天 · 淡带之内算没有规律，柱子画浅一档 · 拿 F座 整年的逐日偏差算')
  })
})

// 2026-09-16 行为矩阵:只经段控进来的图 —— 挂载时视口内柱组擦入 320;换栋 / 换期不重挂,柱按隔几天同键 200 形变
describe('PvAcfBars 动效', () => {
  const inView = () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 312, width: 312, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  }
  afterEach(() => { vi.restoreAllMocks() })

  it('❗切子屏挂上来、在视口内:柱组 first + hold,淡带 / 0 线只 hold 不擦;animationcancel / animationend 都摘;离屏不擦', async () => {
    inView()
    const w = mountIt()
    await nextTick()
    expect(w.find('g.pacf-data').classes()).toEqual(['pacf-data', 'ana-morph', 'first', 'hold'])
    expect(w.find('rect.pacf-band').element.parentElement!.getAttribute('class')).toBe('pacf-ref ana-morph hold')
    expect(w.find('path.axl').element.parentElement!.getAttribute('class')).toBe('ana-morph hold')
    await w.find('g.pacf-data').trigger('animationcancel')
    expect(w.find('g.pacf-data').classes()).toEqual(['pacf-data', 'ana-morph'])
    const w2 = mountIt()
    await nextTick()
    await w2.find('g.pacf-data').trigger('animationend')
    expect(w2.find('g.pacf-data').classes()).toEqual(['pacf-data', 'ana-morph'])
    vi.restoreAllMocks()
    const off = mountIt()
    await nextTick()
    expect(off.find('g.pacf-data').classes()).toEqual(['pacf-data', 'ana-morph'])
  })

  it('❗换栋不重挂:同一个「隔几天」的柱还是同一个元素,d 换成新栋的且命令结构不变;0 线跟着量程挪;悬停槽底不在形变组里', async () => {
    const w = mountIt()
    const b1 = bar(w, 1).element
    const before = b1.getAttribute('d')!
    const y0 = w.find('path.axl').attributes('d')
    // 另一栋:第 1 根从正翻成负(圆角从顶换到底,命令字母不变)
    await w.setProps({ data: { ...DATA, name: '别的栋', bars: DATA.bars.map(b => ({ ...b, rho: b.lag === 1 ? -0.3 : b.rho })) } })
    expect(bar(w, 1).element).toBe(b1)
    const after = b1.getAttribute('d')!
    expect(after).not.toBe(before)
    const cmds = (d: string) => d.replace(/[^A-Z]/g, '')
    expect(cmds(after)).toBe(cmds(before))
    expect(w.find('path.axl').attributes('d')).not.toBe(y0)
    await w.find('rect.pacf-hit').trigger('mouseenter')
    expect(w.find('rect.pacf-slot').element.closest('.ana-morph')).toBe(null)
  })
})
