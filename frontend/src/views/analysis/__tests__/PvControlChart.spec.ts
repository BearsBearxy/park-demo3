// B10 挂载测:钉渲染出来的 SVG 坐标(计划 §4)。x 用画布 v2/Drawer.dc.html 与数据无关的几何
// (宽 646:估计窗口 1/1–6/8 的底条 x 46 宽 256、未到从 430.8 起),y 按「极值贴上 50 / 下 25 像素」手算写死。
// 夹具:中线 −0.02、半宽单位 0.04(内带 −0.10~0.06,外带 −0.14~0.10);点三档都有,档位按离中线几倍半宽
// 现算(与 controlChart 同判据),6 月 9 日起整体抬 0.06,另放两个显式极值。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PvControlChart from '../PvControlChart.vue'
import type { ControlChart } from '../pvAnaV4.logic'
import { PV_COLORS as C } from '../pvAnaColors'

const dateOf = (doy: number) => new Date(Date.UTC(2025, 0, doy)).toISOString().slice(0, 10)

function build(center: number, sigma: number, days: number[], vOf: (doy: number) => number,
  window: ControlChart['window'], futureFromDoy: number | null): ControlChart {
  const counts: [number, number, number] = [0, 0, 0]
  const points = days.map(doy => {
    const v = vOf(doy), dev = Math.abs(v - center)
    const level: 0 | 1 | 2 = dev > 3 * sigma ? 2 : dev > 2 * sigma ? 1 : 0
    counts[level]++
    return { date: dateOf(doy), doy, v, level }
  })
  return {
    daysInYear: 365, center,
    inner: { lo: center - 2 * sigma, hi: center + 2 * sigma },
    outer: { lo: center - 3 * sigma, hi: center + 3 * sigma },
    points, counts, window,
    wholePeriod: window?.to === points[points.length - 1].date,
    futureFromDoy,
  }
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const WIN = { from: '2025-01-01', fromDoy: 1, to: '2025-06-08', toDoy: 159 }
const monthV = (doy: number) =>
  doy === 200 ? 0.2 : doy === 40 ? -0.16
    : -0.02 + 0.035 * Math.sin(doy / 7) + 0.02 * Math.cos(doy / 2.9) + (doy >= 160 ? 0.06 : 0)
const monthFixture = () => build(-0.02, 0.04, range(1, 240).filter(d => d !== 238), monthV, WIN, 241)
const yearFixture = () => build(-0.02, 0.04, range(1, 365), d => -0.02 + 0.03 * Math.sin(d / 11), WIN, null)

const mountChart = (data: ControlChart, segMonth?: number | null) => mount(PvControlChart, { props: { data, segMonth } })
const num = (s: string | undefined) => Number(s)

describe('PvControlChart(B10)', () => {
  it('纵轴:极值 0.2 → y 64、−0.16 → y 199(每单位 375 像素),网格 -0.20 / 0.00 / +0.20', () => {
    const w = mountChart(monthFixture())
    expect([w.find('svg').attributes('width'), w.find('svg').attributes('height')]).toEqual(['646', '250'])
    expect(w.findAll('line.gl').map(l => num(l.attributes('y1')))).toEqual([214, 139, 64])
    const labels = w.findAll('text').filter(t => /^[-+]?0\.\d\d$/.test(t.text()))
    expect(labels.map(t => t.text())).toEqual(['-0.20', '0.00', '+0.20'])
  })

  it('两层带:外带 y 101.5 高 90 淡 25%,内带 y 116.5 高 60 淡 50%;中线 y 146.5 浅蓝 1.5;两条直标贴各自上沿', () => {
    const w = mountChart(monthFixture())
    const o = w.find('rect.outer'), i = w.find('rect.inner')
    expect([num(o.attributes('x')), num(o.attributes('y')), num(o.attributes('width')), num(o.attributes('height')), o.attributes('fill-opacity')])
      .toEqual([46, 101.5, 586, 90, '0.25'])
    expect([num(i.attributes('y')), num(i.attributes('height')), i.attributes('fill'), i.attributes('fill-opacity')])
      .toEqual([116.5, 60, C.BAND, '0.5'])
    const c = w.find('line.center')
    expect([num(c.attributes('y1')), c.attributes('stroke'), c.attributes('stroke-width')]).toEqual([146.5, C.MID, '1.5'])
    expect(w.findAll('text.bandlab').map(t => [t.text(), num(t.attributes('x')), num(t.attributes('y'))]))
      .toEqual([['平时的起伏', 628, 112.5], ['更宽的那道', 628, 97.5]])
  })

  it('点三档各有各的半径与色:超外带 r3 红、超内带 r2.8 琥珀、在里面 r1.8 淡墨;极值点坐标钉死;图例计数与点数一致', () => {
    const data = monthFixture()
    const w = mountChart(data)
    const pts = w.findAll('circle.pt')
    expect(pts).toHaveLength(239)
    const byR = (r: string) => pts.filter(p => p.attributes('r') === r)
    expect(data.counts.every(n => n > 0)).toBe(true)                    // 夹具三档都有
    expect([byR('1.8').length, byR('2.8').length, byR('3').length]).toEqual(data.counts)
    expect(byR('1.8').every(p => p.attributes('fill') === C.CROWD_B10)).toBe(true)
    expect(byR('2.8').every(p => p.attributes('fill') === C.ABOVE)).toBe(true)
    expect(byR('3').every(p => p.attributes('fill') === C.BELOW)).toBe(true)
    const top = pts.find(p => num(p.attributes('cx')) === 366.4)!
    const bot = pts.find(p => num(p.attributes('cx')) === 108.8)!
    expect([num(top.attributes('cy')), top.attributes('r'), num(bot.attributes('cy')), bot.attributes('r')]).toEqual([64, '3', 199, '3'])
    expect(w.find('.leg').text()).toContain(`在里面 ${data.counts[0]} 天`)
    expect(w.find('.leg').text()).toContain(`超出里面那道 ${data.counts[1]} 天`)
    expect(w.find('.leg').text()).toContain(`超出外面那道 ${data.counts[2]} 天`)
  })

  it('估计窗口:底条 x 46 宽 256 贴绘图区底 10px,并直标取的是哪一段;参照系只写窗口与对照', () => {
    const w = mountChart(monthFixture())
    const bar = w.find('rect.win')
    expect([num(bar.attributes('x')), num(bar.attributes('y')), num(bar.attributes('width')), num(bar.attributes('height')), bar.attributes('fill')])
      .toEqual([46, 214, 256, 10, 'var(--ink-100)'])
    const lab = w.find('text.winlab')
    expect([lab.text(), num(lab.attributes('x')), num(lab.attributes('y'))]).toEqual(['这两道线是拿 1 月 1 日 – 6 月 8 日 这一段估的', 50, 210])
    const ref = w.find('.ana-ref').text()
    expect(ref).toContain('都用 6 月 8 日 及之前那一段估，之后的日子拿来对照')
    expect(ref).not.toMatch(/异常|变化本身/)
  })

  it('估计窗口退回全期:底条盖到最后一天的下一天(x 432.4),直标与参照系都写「全期」', () => {
    const data = monthFixture()
    const w = mountChart({ ...data, window: { from: '2025-01-01', fromDoy: 1, to: '2025-08-28', toDoy: 240 }, wholePeriod: true })
    expect(num(w.find('rect.win').attributes('width'))).toBe(386.4)
    expect(w.find('text.winlab').text()).toBe('这两道线是拿全期 1 月 1 日 – 8 月 28 日 估的')
    expect(w.find('.ana-ref').text()).toContain('用全期 1 月 1 日 – 8 月 28 日 估，没有留出对照的日子')
  })

  it('估计窗口底条右缘夹进绘图区:窗口止于 12 月 31 日,下一天 x 633.6 越过右缘 632 → 宽 586(不夹是 587.6)', () => {
    const w = mountChart({ ...yearFixture(), window: { from: '2025-01-01', fromDoy: 1, to: '2025-12-31', toDoy: 365 }, wholePeriod: true })
    const bar = w.find('rect.win')
    expect([num(bar.attributes('x')), num(bar.attributes('width'))]).toEqual([46, 586])
  })

  it('未到淡底从 430.8 起;传了当段月 8 月刻度标蓝,不传就不标;数据到年底没有未到淡底', () => {
    const w = mountChart(monthFixture(), 8)
    const fu = w.find('rect.future')
    expect([num(fu.attributes('x')), num(fu.attributes('width'))]).toEqual([430.8, 201.2])
    const ms = w.findAll('text.mlab')
    expect(ms.map(t => num(t.attributes('x')))).toEqual([46, 95.9, 141, 190.9, 239.2, 289.1, 337.4, 387.3, 437.2, 485.5, 535.4, 583.7])
    expect(ms.filter(t => t.attributes('fill') === C.FOCUS).map(t => t.text())).toEqual(['8月'])
    expect(mountChart(monthFixture()).findAll('text.mlab').some(t => t.attributes('fill') === C.FOCUS)).toBe(false)
    expect(mountChart(yearFixture()).find('rect.future').exists()).toBe(false)
  })

  it('两道上沿挨得比一行字近(半宽单位 0.004):只留「平时的起伏」一条直标', () => {
    const tight = build(-0.02, 0.004, range(1, 240), monthV, WIN, 241)
    const w = mountChart(tight)
    expect(w.findAll('text.bandlab').map(t => t.text())).toEqual(['平时的起伏'])
    expect(w.find('.leg').text()).toContain('更宽的那道')                // 图例里仍在
  })

  it('悬停取最近一天:竖线 + 三行气泡,第三行按档着色', async () => {
    const w = mountChart(monthFixture())
    await w.find('.plot').trigger('mousemove', { clientX: 366.4 })
    expect(w.find('.hair').attributes('style')).toContain('left: 366.4px')
    expect(w.find('.hdot').exists()).toBe(false)
    const lines = w.findAll('.dtip span')
    expect(lines.map(l => l.text())).toEqual(['7月19日', '偏差 +0.200', '超出外面那道'])
    expect(lines[2].attributes('style')).toContain(rgb(C.TIP_BELOW))
    // 宽:max('超出外面那道' 72, '偏差 +0.200' 70.2) → 72 + 22 = 94;366.4 + 12 + 94 ≤ 632 放右侧
    expect(w.find('.dtip').attributes('style')).toContain('left: 378.4px')
    await w.find('.plot').trigger('mouseleave')
    expect(w.find('.dtip').exists()).toBe(false)
  })

  it('气泡右缘放不下翻左:第 330 天 x 575.7,宽 93 → 左 470.7', async () => {
    const w = mountChart(yearFixture())
    await w.find('.plot').trigger('mousemove', { clientX: 575.7 })
    const lines = w.findAll('.dtip span').map(l => l.text())
    expect([lines[0], lines[2]]).toEqual(['11月26日', '在里面'])
    expect(w.find('.dtip').attributes('style')).toContain('left: 470.7px')
  })
})

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
