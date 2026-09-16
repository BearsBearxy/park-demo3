// PvConsumption(B7)挂载测:槽与柱的 x/width、三段堆叠的 y、圆角只在最顶段、副轴钉死 0–6%、
// 超轴刻度断线 + 三角 + 数值、未到淡区、悬停槽底与气泡翻边。
// 夹具非退化:三段逐日起伏、损耗率逐日变且有一天冲到 7.2%、有一天损耗为 0、29–31 日未到。
import { describe, expect, it } from 'vitest'
import { mount, type DOMWrapper } from '@vue/test-utils'
import PvConsumption from '../PvConsumption.vue'
import { tipWidth } from '@/components/ana/chartTip'
import type { Consumption, ConsumptionTick } from '../pvAnaV4.logic'

const W = 999, PL = 46, PT = 22, IH = 224, BOT = 246
const num = (el: DOMWrapper<Element>, k: string) => Number(el.attributes(k))
const attr = (el: DOMWrapper<Element>, k: string) => el.attributes(k) ?? ''

function tick(label: string, self: number, grid: number, rate: number): ConsumptionTick {
  const loss = ((self + grid) * rate) / (1 - rate)
  const pct = (loss / (self + grid + loss)) * 100
  return { label, self, grid, loss, lossPct: pct, over: pct > 6 }
}
function monthData(): Consumption {
  const ticks = Array.from({ length: 31 }, (_, i): ConsumptionTick => {
    const label = String(i + 1)
    if (i >= 28) return { label, self: 0, grid: 0, loss: 0, lossPct: null, over: false }
    const rate = i === 9 ? 0.072 : i === 2 ? 0 : 0.01 + (0.04 * (i % 7)) / 6
    return tick(label, 10000 + 1500 * Math.sin(i) + 200 * (i % 4), 5000 + 800 * Math.cos(i * 0.6), rate)
  })
  return { gran: 'month', ticks, futureFrom: 28, throughIdx: 27 }
}
function geo(d: Consumption) {
  const slot = (W - 92) / d.ticks.length
  const ymax = Math.max(...d.ticks.map(t => (t.self + t.grid + t.loss) / 1e4)) * 1.12
  return {
    slot, bw: slot * 0.6,
    cx: (i: number) => PL + (i + 0.5) * slot,
    h: (kwh: number) => (kwh / 1e4 / ymax) * IH,
    yLoss: (pct: number) => BOT - (pct / 6) * IH,
    ymax,
  }
}
const seg = (w: ReturnType<typeof mount>, i: number, k: string) => w.find(`.pcs-bar[data-i="${i}"] .pcs-${k}`)

describe('PvConsumption 柱', () => {
  it('31 个槽:1 日柱 x = padL + 0.2 槽、宽 0.6 槽;淡区从 29 日槽左沿起', () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    const s0 = seg(w, 0, 'self')
    expect(Math.abs(num(s0, 'x') - 51.8)).toBeLessThan(0.1)   // 画布实测 51.8(它把柱宽取整成 17.6)
    expect(num(s0, 'x')).toBeCloseTo(PL + 0.2 * g.slot, 6)
    expect(num(s0, 'width')).toBeCloseTo(g.bw, 6)
    expect(num(w.find('.pcs-future'), 'x')).toBeCloseTo(865.2, 1)
    expect(num(w.find('.pcs-future'), 'x') + num(w.find('.pcs-future'), 'width')).toBeCloseTo(W - 46, 6)
    expect(w.findAll('.pcs-bar')).toHaveLength(28)
  })

  it('三段自下而上叠:自用贴底、上网压在自用上、损耗顶段圆角 ≤ 3', () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    const t = d.ticks[4]
    const self = seg(w, 4, 'self'), grid = seg(w, 4, 'grid')
    expect(num(self, 'y') + num(self, 'height')).toBeCloseTo(BOT, 6)
    expect(num(self, 'height')).toBeCloseTo(g.h(t.self), 6)
    expect(num(grid, 'y') + num(grid, 'height')).toBeCloseTo(num(self, 'y'), 6)
    expect(num(grid, 'height')).toBeCloseTo(g.h(t.grid), 6)
    const loss = seg(w, 4, 'loss')
    expect(loss.element.tagName).toBe('path')
    const lossH = g.h(t.loss)
    const top = num(grid, 'y') - lossH
    const x = num(self, 'x'), r = Math.min(3, lossH)
    expect(loss.attributes('d')).toBe(
      `M${x},${num(grid, 'y')} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + g.bw - r},${top} Q${x + g.bw},${top} ${x + g.bw},${top + r} L${x + g.bw},${num(grid, 'y')} Z`,
    )
  })

  it('❗那天没有损耗:圆角落到上网段,不画损耗段', () => {
    const w = mount(PvConsumption, { props: { data: monthData() } })
    expect(seg(w, 2, 'loss').exists()).toBe(false)
    expect(seg(w, 2, 'grid').element.tagName).toBe('path')
    expect(seg(w, 3, 'grid').element.tagName).toBe('rect')
  })

  it('左轴 = 最高柱 × 1.12 四等分;右轴钉死 0/2/4/6%', () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    expect(w.findAll('.pcs-yl').map(t => t.text())).toEqual([0, 1, 2, 3].map(k => ((k / 3) * g.ymax).toFixed(1)))
    const yr = w.findAll('.pcs-yr')
    expect(yr.map(t => t.text())).toEqual(['0%', '2%', '4%', '6%'])
    expect(yr.map(t => num(t, 'y') - 4)).toEqual([246, 246 - IH / 3, 246 - (2 * IH) / 3, 22].map(v => expect.closeTo(v, 6)))
    expect(yr[0].attributes('fill')).toBe('#854F0B')
    expect(num(yr[0], 'x')).toBe(W - 46 + 6)
  })
})

describe('PvConsumption 损耗率', () => {
  it('白芯点落在副轴上;超 6% 那天折线断开、不画点,轴外三角 + 数值', () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    const dots = w.findAll('.pcs-lossdot')
    expect(dots).toHaveLength(27)
    expect(num(dots[0], 'cx')).toBeCloseTo(g.cx(0), 6)
    expect(num(dots[0], 'cy')).toBeCloseTo(g.yLoss(d.ticks[0].lossPct!), 6)
    expect(dots.some(c => Math.abs(num(c, 'cx') - g.cx(9)) < 1e-6)).toBe(false)
    expect(attr(w.find('.pcs-lossline'), 'd').match(/M/g)).toHaveLength(2)
    const tri = w.find('.pcs-over')
    const pts = attr(tri, 'points').split(' ').map(p => p.split(',').map(Number))
    expect(pts[2][0]).toBeCloseTo(g.cx(9), 6)
    expect(Math.max(...pts.map(p => p[1]))).toBeLessThan(PT)
    expect(w.find('.pcs-overt').text()).toBe('7.2%')
  })

  it('对照:没有超轴的刻度就没有三角,折线一笔到底', () => {
    const d = monthData()
    d.ticks[9] = tick('10', 11000, 5200, 0.05)
    const w = mount(PvConsumption, { props: { data: d } })
    expect(w.find('.pcs-over').exists()).toBe(false)
    expect(attr(w.find('.pcs-lossline'), 'd').match(/M/g)).toHaveLength(1)
    expect(w.find('.ana-ref').text()).not.toContain('超过')
  })
})

describe('PvConsumption 悬停', () => {
  it('悬停 11 日:槽底 x = 柱心 − 柱宽/2 − 3、宽 柱宽 + 6;气泡五行在柱心右 14', async () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    await w.find('.pcs-hit').trigger('mousemove', { clientX: PL + 10 * g.slot + 2 })
    const hair = w.find('.pcs-hair')
    expect(num(hair, 'x')).toBeCloseTo(g.cx(10) - g.bw / 2 - 3, 6)
    expect(num(hair, 'width')).toBeCloseTo(g.bw + 6, 6)
    const t = d.ticks[10]
    const lines = w.findAll('.pv-tip span')
    expect(lines.map(s => s.text())).toEqual([
      '11 日', `自己用了 ${(t.self / 1e4).toFixed(2)} 万度`, `卖上网 ${(t.grid / 1e4).toFixed(2)} 万度`,
      `路上损掉 ${(t.loss / 1e4).toFixed(3)} 万度`, `损耗率 ${t.lossPct!.toFixed(2)}%`,
    ])
    expect(w.find('.pv-tip').attributes('style')).toContain(`left: ${g.cx(10) + 14}px`)
    await w.find('.pcs-hit').trigger('mouseleave')
    expect(w.find('.pcs-hair').exists()).toBe(false)
  })

  it('❗损耗率 ≥ 3% 那行转琥珀;对照 < 3% 不转', async () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    await w.find('.pcs-hit').trigger('mousemove', { clientX: g.cx(9) })
    expect(w.findAll('.pv-tip span')[4].attributes('style')).toContain('rgb(246, 199, 122)')
    await w.find('.pcs-hit').trigger('mousemove', { clientX: g.cx(7) })   // 8 日:1%
    expect(w.findAll('.pv-tip span')[4].attributes('style')).not.toContain('rgb(246, 199, 122)')
  })

  it('❗右缘放不下翻到左侧;鼠标进未到的日子钉在 28 日', async () => {
    const d = monthData()
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    await w.find('.pcs-hit').trigger('mousemove', { clientX: 990 })
    const lines = w.findAll('.pv-tip span').map(s => s.text())
    expect(lines[0]).toBe('28 日')
    const tw = tipWidth(lines, 22)
    expect(g.cx(27) + 14 + tw).toBeGreaterThan(W)
    expect(w.find('.pv-tip').attributes('style')).toContain(`left: ${g.cx(27) - 14 - tw}px`)
  })
})

describe('PvConsumption 年档与图注', () => {
  it('年档 12 个槽全标月份,淡区从第 9 个槽起', () => {
    const d: Consumption = {
      gran: 'year', futureFrom: 8, throughIdx: 7,
      ticks: Array.from({ length: 12 }, (_, i) => (i >= 8
        ? { label: `${i + 1}月`, self: 0, grid: 0, loss: 0, lossPct: null, over: false }
        : tick(`${i + 1}月`, 300000 + 40000 * Math.sin(i), 150000 + 20000 * i, 0.02 + 0.003 * i))),
    }
    const g = geo(d)
    const w = mount(PvConsumption, { props: { data: d } })
    expect(w.findAll('.pcs-xl').map(t => t.text())).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}月`))
    expect(num(w.find('.pcs-future'), 'x')).toBeCloseTo(PL + 8 * g.slot, 6)
    expect(num(seg(w, 3, 'self'), 'width')).toBeCloseTo(g.bw, 6)
    expect(w.find('.ana-ref').text()).toContain('数据到 8月')
  })

  it('❗「数据到」写最后一条抄表所在的刻度,不按今天:未到从 29 日起、数据只到 12 日 → 写 12 日', () => {
    const w = mount(PvConsumption, { props: { data: { ...monthData(), throughIdx: 11 } } })
    expect(w.find('.ana-ref').text().endsWith(' · 数据到 12 日')).toBe(true)
    // 对照:截止日在段末(整段录满)不写
    expect(mount(PvConsumption, { props: { data: { ...monthData(), futureFrom: null, throughIdx: null } } }).find('.ana-ref').text()).not.toContain('数据到')
  })

  it('月档图注:超轴几天、数据到哪天', () => {
    const w = mount(PvConsumption, { props: { data: monthData() } })
    expect(w.find('.ana-ref').text()).toBe(
      '左轴 = 万度，三段自下而上 = 自己用了 / 卖上网 / 路上损掉 · 右轴 = 损耗率，刻度钉死在 0–6% 不随数据缩放 · 1 天超过 6%，折线在那里断开，轴外三角标数值 · 数据到 28 日',
    )
  })

  it('❗C6-25：柱段 / 损耗线与点 / 轴外三角与数在 g.pcs-data 里，轴线与 x 刻度在组前', () => {
    const w = mount(PvConsumption, { props: { data: monthData() } })
    const g = w.find('g.pcs-data')
    expect(g.findAll('.pcs-bar')).toHaveLength(28)   // 未到的 29–31 日不出柱
    for (const sel of ['.pcs-lossline', '.pcs-lossdot', '.pcs-over', '.pcs-overt']) expect(g.find(sel).exists(), sel).toBe(true)
    const kids = Array.from(w.find('svg').element.children)
    expect(kids.findIndex(e => e.classList.contains('pcs-data'))).toBeGreaterThan(kids.findIndex(e => e.classList.contains('pcs-axl')))
    expect(w.find('.pcs-axl').element.closest('g.pcs-data')).toBe(null)
    expect(w.find('.pcs-xl').element.closest('g.pcs-data')).toBe(null)
    // AnaShell 之外 entered 默认真 = 不擦
    expect(g.classes()).not.toContain('first')
  })
})
