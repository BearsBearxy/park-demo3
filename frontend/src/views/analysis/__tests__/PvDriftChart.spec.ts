// B9 挂载测:钉渲染出来的 SVG 坐标(计划 §4)。x 的期望值直接用画布 v2/Drawer.dc.html 上
// 与数据无关的几何(宽 646:第 160 天 x = 302、8 月 1 日 387.3、8 月 28 日 430.8、月初刻度 95.9 / 141 …),
// y 的期望值按「极值贴在上 59 / 下 37 像素处」手算写死。
// 夹具不退化:正弦 + 余弦叠加、6 月 9 日起抬升、中间漏 4 天、两个显式极值;另一份整年到 12 月底的
// 夹具用来摆「没有变点 / 没有当段 / 没有未到」与气泡右缘翻边。jsdom 里 getBoundingClientRect 全 0,clientX 即组件内 x。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PvDriftChart from '../PvDriftChart.vue'
import type { DriftChart } from '../pvAnaV4.logic'
import { PV_COLORS as C } from '../pvAnaColors'

const dateOf = (doy: number) => new Date(Date.UTC(2025, 0, doy)).toISOString().slice(0, 10)

function monthFixture(): DriftChart {
  const skip = new Set([100, 101, 102, 238])
  const points: DriftChart['points'] = []
  const trend: DriftChart['trend'] = []
  for (let doy = 1; doy <= 240; doy++) {
    if (skip.has(doy)) continue
    const lift = doy >= 160 ? 0.1 : 0
    let v = 0.06 * Math.sin(doy / 9) + 0.02 * Math.cos(doy / 3.7) + lift
    if (doy === 200) v = 0.25      // 上极值
    if (doy === 40) v = -0.15      // 下极值
    points.push({ date: dateOf(doy), doy, v })
    const fit = 0.03 * Math.sin(doy / 40) + (doy >= 160 ? 0.09 : 0)
    const half = 0.03 + 0.01 * Math.cos(doy / 50)
    trend.push({ doy, fit, lo: fit - half, hi: fit + half })
  }
  return {
    daysInYear: 365, points, trend,
    cp: { date: '2025-06-09', doy: 160, from: '2025-06-02', fromDoy: 153, to: '2025-06-15', toDoy: 166 },
    seg: { month: 8, fromDoy: 213, toDoy: 240 },
    futureFromDoy: 241,
  }
}

function yearFixture(): DriftChart {
  const points: DriftChart['points'] = []
  const trend: DriftChart['trend'] = []
  for (let doy = 1; doy <= 365; doy++) {
    points.push({ date: dateOf(doy), doy, v: 0.05 * Math.sin(doy / 11) + 0.015 * Math.cos(doy / 2.3) })
    const fit = 0.02 * Math.sin(doy / 60)
    trend.push({ doy, fit, lo: fit - 0.025, hi: fit + 0.025 })
  }
  return { daysInYear: 365, points, trend, cp: null, seg: null, futureFromDoy: null }
}

const mountChart = (data: DriftChart) => mount(PvDriftChart, { props: { data } })
const num = (s: string | undefined) => Number(s)

describe('PvDriftChart(B9)', () => {
  it('画布 646 × 300;纵轴三条网格按极值贴 59 / 37 像素排出 -0.20 / 0.00 / +0.20', () => {
    const w = mountChart(monthFixture())
    const svg = w.find('svg')
    expect([svg.attributes('width'), svg.attributes('height')]).toEqual(['646', '300'])
    // 极值 0.25 → y 73,-0.15 → y 237,每单位 164 / 0.4 = 410 像素
    const labels = w.findAll('text').filter(t => t.attributes('text-anchor') === 'end' && /^[-+]?0\.\d\d$/.test(t.text()))
    expect(labels.map(t => [t.text(), num(t.attributes('y')) - 4])).toEqual([['-0.20', 257.5], ['0.00', 175.5], ['+0.20', 93.5]])
    expect(w.findAll('line.gl').map(l => num(l.attributes('y1')))).toEqual([257.5, 175.5, 93.5])
    expect(w.findAll('line.gl').every(l => l.attributes('x1') === '46' && l.attributes('x2') === '632')).toBe(true)
  })

  it('散点 r2 淡墨;极值点落在 (366.4, 73) 与 (108.8, 237);漏抄的天不画点', () => {
    const w = mountChart(monthFixture())
    const pts = w.findAll('circle.pt')
    expect(pts).toHaveLength(236)
    expect(pts.every(p => p.attributes('r') === '2' && p.attributes('fill') === C.CROWD_B9)).toBe(true)
    const at = (x: number) => pts.filter(p => num(p.attributes('cx')) === x)
    expect(at(366.4).map(p => num(p.attributes('cy')))).toEqual([73])
    expect(at(108.8).map(p => num(p.attributes('cy')))).toEqual([237])
    // 第 101 天 x = 207、第 238 天 x = 427.5:漏抄,没有点;对照:第 99 天 203.8 与第 237 天 425.9 有点
    expect(at(207)).toHaveLength(0)
    expect(at(427.5)).toHaveLength(0)
    expect(at(203.8)).toHaveLength(1)
    expect(at(425.9)).toHaveLength(1)
  })

  it('趋势 2px 蓝,相邻点按 Catmull-Rom ÷6 转贝塞尔;估计范围是 50% 浅蓝闭合面', () => {
    const w = mountChart(monthFixture())
    const tr = w.find('path.trend')
    expect([tr.attributes('stroke'), tr.attributes('stroke-width')]).toEqual([C.FOCUS, '2'])
    const d = tr.attributes('d')!
    // 首段:P0 = P1 = x46,P2 = x47.6,P3 = x49.2 → 控制点 x 46 + 1.6/6 = 46.3、47.6 − 3.2/6 = 47.1
    expect(d).toMatch(/^M46,[\d.]+ C46\.3,[\d.]+ 47\.1,[\d.]+ 47\.6,[\d.]+ C/)
    expect(d.match(/ C/g)).toHaveLength(235)
    const band = w.find('path.band')
    expect([band.attributes('fill'), band.attributes('fill-opacity')]).toEqual([C.BAND, '0.5'])
    expect(band.attributes('d')).toMatch(/^M46,[\d.]+ L47\.6,[\d.]+ .* L430\.8,[\d.]+ L430\.8,[\d.]+ .* L46,[\d.]+ Z$/)
  })

  it('变点三件:红竖线 x 302、区间淡红 12% 底 290.7 → 311.6、竖线右侧两行直标(第二行是区间,不是结论)', () => {
    const w = mountChart(monthFixture())
    const cp = w.find('path.cp')
    expect([cp.attributes('d'), cp.attributes('stroke'), cp.attributes('stroke-width')])
      .toEqual(['M302,14 V274', C.BELOW, '1.5'])
    const span = w.find('rect.cpspan')
    expect([num(span.attributes('x')), num(span.attributes('width')), span.attributes('fill'), span.attributes('fill-opacity')])
      .toEqual([290.7, 20.9, C.BELOW, '0.12'])
    const labs = w.findAll('text.cplab')
    expect(labs.map(t => [t.text(), num(t.attributes('x')), num(t.attributes('y')), t.attributes('text-anchor')]))
      .toEqual([['6月9日起', 307, 42, 'start'], ['区间 6月2日–6月15日', 307, 56, 'start']])
    expect(w.text()).not.toContain('抬上去')
    expect(w.find('.leg').text()).toContain('这天前后水平变了')
  })

  it('变点直标右边放不下挪到左侧右对齐:11 月 26 日 x 575.7,第二行估宽 132,575.7 + 5 + 132 > 632 → x 570.7 右对齐', () => {
    const w = mountChart({ ...yearFixture(), cp: { date: '2025-11-26', doy: 330, from: '2025-11-19', fromDoy: 323, to: '2025-12-03', toDoy: 337 } })
    expect(w.find('path.cp').attributes('d')).toBe('M575.7,14 V274')
    expect(w.findAll('text.cplab').map(t => [t.text(), num(t.attributes('x')), t.attributes('text-anchor')]))
      .toEqual([['11月26日起', 570.7, 'end'], ['区间 11月19日–12月3日', 570.7, 'end']])
  })

  it('当前期间淡蓝底 387.3 宽 43.5 + 「当前期间 8 月」;未到淡底从 430.8 画到右缘;月初刻度与画布同位,8 月标蓝', () => {
    const w = mountChart(monthFixture())
    const seg = w.find('rect.seg')
    expect([num(seg.attributes('x')), num(seg.attributes('width')), seg.attributes('fill')]).toEqual([387.3, 43.5, C.SEG_B9])
    const sl = w.find('text.seglab')
    expect([sl.text(), num(sl.attributes('y'))]).toEqual(['当前期间 8 月', 26])
    expect(Math.abs(num(sl.attributes('x')) - 409.1)).toBeLessThanOrEqual(0.1)
    const fu = w.find('rect.future')
    expect([num(fu.attributes('x')), num(fu.attributes('width')), fu.attributes('fill')]).toEqual([430.8, 201.2, C.FUTURE])
    const ms = w.findAll('text.mlab')
    expect(ms.map(t => num(t.attributes('x')))).toEqual([46, 95.9, 141, 190.9, 239.2, 289.1, 337.4, 387.3, 437.2, 485.5, 535.4, 583.7])
    expect(ms.map(t => t.attributes('fill') === C.FOCUS)).toEqual([false, false, false, false, false, false, false, true, false, false, false, false])
    expect(ms[7].attributes('font-weight')).toBe('600')
    expect(w.find('.ana-ref').text()).toContain('横轴 = 2025 年逐日')
    expect(w.find('.ana-ref').text()).toContain('右侧淡区还没到')
  })

  it('没有变点 / 没有当段 / 数据到年底:三样图元都不出现,图例与参照系跟着不写', () => {
    const w = mountChart(yearFixture())
    expect(w.findAll('circle.pt')).toHaveLength(365)          // 对照:点照画
    expect(w.find('path.cp').exists()).toBe(false)
    expect(w.find('rect.cpspan').exists()).toBe(false)
    expect(w.findAll('text.cplab')).toHaveLength(0)
    expect(w.find('rect.seg').exists()).toBe(false)
    expect(w.find('rect.future').exists()).toBe(false)
    expect(w.findAll('text.mlab').some(t => t.attributes('fill') === C.FOCUS)).toBe(false)
    expect(w.find('.leg').text()).not.toContain('水平变了')
    expect(w.find('.ana-ref').text()).not.toContain('右侧淡区')
  })

  it('网格步长可取 0.15:极值 0.2 / −0.125 时排出 -0.15 / 0.00 / +0.15 / +0.30(与画布同一组网格)', () => {
    const d = monthFixture()
    const points = d.points.map(p => ({ ...p, v: p.doy === 200 ? 0.2 : p.doy === 40 ? -0.125 : p.v * 0.6 }))
    const trend = d.trend.map(t => ({ ...t, fit: t.fit * 0.6, lo: t.fit * 0.6 - 0.02, hi: t.fit * 0.6 + 0.02 }))
    const w = mountChart({ ...d, points, trend })
    // 每单位 164 / 0.325 像素;量程 −0.198~0.317,÷3 = 0.172,离 0.15 比离 0.2 近
    const labels = w.findAll('text').filter(t => t.attributes('text-anchor') === 'end' && /^[-+]?0\.\d\d$/.test(t.text()))
    expect(labels.map(t => t.text())).toEqual(['-0.15', '0.00', '+0.15', '+0.30'])
    expect(w.findAll('line.gl').map(l => num(l.attributes('y1')))).toEqual([249.6, 173.9, 98.2, 22.5])
  })

  it('闰年:二月 29 天,3 月初刻度落在第 61 天 x = 142.3(平年 141)', () => {
    const w = mountChart({ ...yearFixture(), daysInYear: 366 })
    expect(num(w.findAll('text.mlab')[2].attributes('x'))).toBe(142.3)
  })

  it('悬停取最近的一天:竖线 + 高亮点 + 三行气泡;变点当天算「之后」', async () => {
    const w = mountChart(monthFixture())
    await w.find('.plot').trigger('mousemove', { clientX: 302 })
    expect(w.find('.hair').attributes('style')).toContain('left: 302px')
    const p = monthFixture().points.find(x => x.doy === 160)!
    const cy = Math.round((73 + (0.25 - p.v) * 410) * 10) / 10
    expect(w.find('.hdot').attributes('style')).toContain(`left: 297.5px`)
    expect(w.find('.hdot').attributes('style')).toContain(`top: ${Math.round((cy - 4.5) * 10) / 10}px`)
    const lines = w.findAll('.dtip span')
    expect(lines.map(l => l.text())).toEqual(['6月9日', `偏离 +${p.v.toFixed(3)}`, '在 6 月 9 日水平变化之后'])
    expect(lines[1].attributes('style')).toContain(rgb(C.TIP_SEL))
    // 最长行 9 汉字 × 12 + 6 × 6.6 = 147.6 → 148 + 22 = 170;302 + 12 + 170 = 484 ≤ 632,放右侧
    expect(w.find('.dtip').attributes('style')).toContain('left: 314px')
  })

  it('落在漏抄的天上:两侧同距时取早的一天;鼠标在未到区里夹到最后一天;移出就收', async () => {
    const w = mountChart(monthFixture())
    await w.find('.plot').trigger('mousemove', { clientX: 207 })      // 第 101 天,100–102 都漏
    expect(w.findAll('.dtip span').map(l => l.text())[0]).toBe('4月9日') // 第 99 天(对面是第 103 天)
    expect(w.findAll('.dtip span')[2].text()).toBe('在 6 月 9 日水平变化之前')
    await w.find('.plot').trigger('mousemove', { clientX: 600 })
    expect(w.findAll('.dtip span')[0].text()).toBe('8月28日')
    await w.find('.plot').trigger('mouseleave')
    expect(w.find('.dtip').exists()).toBe(false)
    expect(w.find('.hair').exists()).toBe(false)
  })

  it('长缺口中间离两侧都超过 6 天:不出气泡;对照:离缺口边 6 天内照出', async () => {
    const d = monthFixture()
    const w = mountChart({ ...d, points: d.points.filter(p => p.doy < 50 || p.doy > 70) })
    await w.find('.plot').trigger('mousemove', { clientX: 141 })        // 第 60 天,两侧最近 49 / 71
    expect(w.find('.dtip').exists()).toBe(false)
    await w.find('.plot').trigger('mousemove', { clientX: 125 })        // 第 50 天,左侧第 49 天
    expect(w.findAll('.dtip span')[0].text()).toBe('2月18日')
  })

  it('气泡右缘放不下翻到竖线左侧:第 330 天 x 575.7,宽 93 → 左 470.7', async () => {
    const w = mountChart(yearFixture())
    await w.find('.plot').trigger('mousemove', { clientX: 575.7 })
    const lines = w.findAll('.dtip span').map(l => l.text())
    expect(lines).toHaveLength(2)                                         // 没有变点就没有第三行
    expect(lines[0]).toBe('11月26日')
    // '偏离 ±0.0xx' = 2 汉字 24 + 7 × 6.6 = 70.2 → 71 + 22 = 93;575.7 + 12 + 93 > 632
    expect(w.find('.dtip').attributes('style')).toContain('left: 470.7px')
  })
})

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

// 2026-09-16 行为矩阵:抽屉里的图 —— 打开瞬现(不擦入,原则 7);上一栋 / 下一栋不重挂,同键 200 形变
describe('PvDriftChart(B9)动效', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('❗抽屉里在视口内挂载也不擦:数据组只有形变类,没有 first / hold', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 646, width: 646, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const w = mountChart(monthFixture())
    await nextTick()
    expect(w.find('g.b9-data').classes()).toEqual(['b9-data', 'ana-morph'])
  })

  it('❗下一栋不重挂:同一天的点、变点竖线、区间底还是同一个元素,坐标换成新栋的;悬停层与轴线不在形变组里', async () => {
    const w = mountChart(monthFixture())
    const pt = w.findAll('circle.pt')[0].element
    const cp = w.find('path.cp').element
    const span = w.find('rect.cpspan').element
    const before = [pt.getAttribute('cy'), cp.getAttribute('d'), span.getAttribute('x')]
    const d = monthFixture()
    const next: DriftChart = {
      ...d,
      points: d.points.map(p => ({ ...p, v: p.v * 0.5 - 0.1 })),
      cp: { date: '2025-07-01', doy: 182, from: '2025-06-24', fromDoy: 175, to: '2025-07-08', toDoy: 189 },
    }
    await w.setProps({ data: next })
    expect(w.findAll('circle.pt')[0].element).toBe(pt)
    expect(w.find('path.cp').element).toBe(cp)
    expect(w.find('rect.cpspan').element).toBe(span)
    expect([pt.getAttribute('cy'), cp.getAttribute('d'), span.getAttribute('x')].map((v, k) => v === before[k])).toEqual([false, false, false])
    const g = w.find('g.b9-data')
    for (const sel of ['circle.pt', 'path.trend', 'path.band', 'path.cp', 'rect.cpspan', 'rect.seg', 'rect.future']) expect(g.find(sel).exists(), sel).toBe(true)
    await w.find('.plot').trigger('mousemove', { clientX: 302 })
    for (const sel of ['.hair', '.hdot', '.dtip', 'line.axl']) expect(w.find(sel).element.closest('.ana-morph'), sel).toBe(null)
  })
})
