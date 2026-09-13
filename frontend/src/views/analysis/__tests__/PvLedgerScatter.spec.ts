// PvLedgerScatter(B6)挂载测:正方绘图区、45° 虚线、沿对角线的 ±容差斜带、点的 cx/cy;
// 空态(一栋没录)照样画框线与带、不画点(计划 §1 #4);录入入口 emit record。
import { describe, expect, it } from 'vitest'
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
