// PvDayChart 挂载测:钉渲染出来的坐标,不钉中间对象(计划 §4)。
// 期望值是把画布 ../运维文档/设计稿/已实现/光伏分栋分析v4定稿-2026-09-13/Main.dc.html renderVals「通栏大图」那段原码(704–735 行)
// 原样喂同一份夹具、在 node 里跑出来的数(宽 1025),不是拿组件自己的公式再算一遍。
// 夹具不退化:比值按 sin 起伏;同一栋里有连续低于(1–3 日,贴左缘)、零散高于(10 日)、连续高于(20–22 日)、
// 漏抄(14 / 25 / 26 日)、未到(29–31 日)。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import PvDayChart from '../PvDayChart.vue'
import type { BoardRow, TickState } from '../pvMeterAna.logic'
import type { PvDayChartProps } from '../pvAnaV4.logic'

const pad = (n: number) => String(n).padStart(2, '0')
const TICKS = Array.from({ length: 31 }, (_, i) => `2025-08-${pad(i + 1)}`)
const LABELS = TICKS.map((_, i) => String(i + 1))
const MISS = [14, 25, 26]

function baseRow(): BoardRow {
  const ratio: (number | null)[] = [], out: (number | null)[] = [], state: TickState[] = []
  for (let d = 1; d <= 31; d++) {
    let v = +(0.78 + 0.05 * Math.sin(d * 1.3)).toFixed(4), o = 0
    if (d <= 3) { v = [0.62, 0.60, 0.64][d - 1]; o = -1 }
    if (d === 10) { v = 0.90; o = 1 }
    if (d >= 20 && d <= 22) { v = [0.93, 0.95, 0.91][d - 20]; o = 1 }
    const st: TickState = d > 28 ? 'future' : MISS.includes(d) ? 'missing' : 'seen'
    state.push(st)
    ratio.push(st === 'seen' ? v : null)
    out.push(st === 'seen' ? o : null)
  }
  return {
    id: 3, name: 'E座', phase: 1, cadence: 'daily', ratio, state, center: 0.78, lo: 0.70, hi: 0.86, out,
    runs: [{ from: 0, to: 2, dir: -1, live: false }, { from: 19, to: 21, dir: 1, live: false }],
    outN: 7, maxDev: 0.22, seenN: 25, elapsedN: 28, baseNote: '', base: null,
    firstDate: '2024-03-01', bornBySeg: true,
  }
}

const props = (row: BoardRow, over: Partial<PvDayChartProps> = {}): PvDayChartProps =>
  ({ row, ticks: TICKS, tickLabels: LABELS, gran: 'month', elapsedN: 28, fact: '事实句', unreadable: false, ...over })
const mk = (row = baseRow(), over: Partial<PvDayChartProps> = {}) => mount(PvDayChart, { props: props(row, over) })
const num = (w: ReturnType<typeof mk>, sel: string, attr: string) => w.findAll(sel).map(e => Number(e.attributes(attr)))
const px = (s: string) => parseFloat(s)

describe('PvDayChart', () => {
  it('画布 1025 × 236:宽取实测(jsdom 退回初值),高固定,viewBox 与之一致', () => {
    const svg = mk().find('svg')
    expect([svg.attributes('width'), svg.attributes('height'), svg.attributes('viewBox')]).toEqual(['1025', '236', '0 0 1025 236'])
  })

  it('出范围点:只画出范围的已抄日,r4 白环,低于红 / 高于琥珀;在范围内的日子不画点', () => {
    const w = mk()
    const pts = w.findAll('circle.pt')
    expect(pts.map(p => [Number(p.attributes('cx')), Number(p.attributes('cy')), p.attributes('fill')])).toEqual([
      [44, 183.4, '#E24B4A'], [76.2, 192.6, '#E24B4A'], [108.5, 174.2, '#E24B4A'],
      [334.1, 54.4, '#EF9F27'], [656.4, 40.6, '#EF9F27'], [688.7, 31.4, '#EF9F27'], [720.9, 49.8, '#EF9F27'],
    ])
    expect(pts.every(p => p.attributes('r') === '4' && p.attributes('stroke-width') === '1.5')).toBe(true)
  })

  it('折线在漏抄日断开、不画到未到的日子(三段)', () => {
    const d = mk().find('path.line').attributes('d')
    expect(d).toBe(' M44,183.4 L76.2,192.6 L108.5,174.2 L140.7,130.1 L172.9,104.7 L205.2,86.7 L237.4,102.3 L269.6,128.8 L301.9,127.3 L334.1,54.4 L366.3,87 L398.6,107.2 L430.8,131.1 M495.3,95.7 L527.5,88.3 L559.7,112.2 L592,132.4 L624.2,119.4 L656.4,40.6 L688.7,31.4 L720.9,49.8 L753.1,132.7 L785.4,114.6 M882.1,121.6 L914.3,131.9')
  })

  it('带画满整宽 + 中心虚线 + 上下沿数值贴带边', () => {
    const w = mk()
    const band = w.find('rect.band')
    expect([band.attributes('x'), band.attributes('y'), band.attributes('width'), band.attributes('height')]).toEqual(['44', '72.8', '967', '73.8'])
    expect(w.find('line.ctr').attributes('y1')).toBe('109.7')
    const hi = w.find('.axh.hi'), lo = w.find('.axh.lo')
    expect([hi.text(), px((hi.element as HTMLElement).style.top)]).toEqual(['上沿 0.860', 57.8])
    expect([lo.text(), px((lo.element as HTMLElement).style.top)]).toEqual(['下沿 0.700', 148.6])
  })

  it('纵轴 4 条横网格 + 刻度值;横轴 1 / 5 / 10 / 15 / 20 / 25 / 31', () => {
    const w = mk()
    expect(num(w, 'line.gl', 'y1')).toEqual([212, 145.3, 78.7, 12])
    const labs = w.findAll('.axh').filter(e => !e.classes('hi') && !e.classes('lo'))
    expect(labs.map(e => [e.text(), px((e.element as HTMLElement).style.top)])).toEqual([['0.56', 205], ['0.70', 138.3], ['0.85', 71.7], ['0.99', 5]])
    const xt = w.findAll('text.ax')
    expect(xt.map(t => t.text())).toEqual(['1', '5', '10', '15', '20', '25', '31'])
    expect(xt.map(t => Number(t.attributes('x')))).toEqual([44, 172.9, 334.1, 495.3, 656.4, 817.6, 1011])
  })

  it('连续段底色随方向,贴左缘的那段夹进绘图区(x 不小于 44)', () => {
    const runs = mk().findAll('rect.run')
    expect(runs.map(r => [Number(r.attributes('x')), Number(r.attributes('width')), r.attributes('fill')]))
      .toEqual([[44, 80.6, '#E24B4A'], [640.3, 96.7, '#EF9F27']])
  })

  it('连续段到末日时右缘夹在 W − padR(对照:整段都已过去,没有未到淡底)', () => {
    const row = baseRow()
    for (const [d, v] of [[29, 0.92], [30, 0.94], [31, 0.93]] as const) {
      row.state[d - 1] = 'seen'; row.ratio[d - 1] = v; row.out[d - 1] = 1
    }
    row.runs.push({ from: 28, to: 30, dir: 1, live: true })
    const w = mk(row, { elapsedN: 31 })
    const last = w.findAll('rect.run').at(-1)!
    expect([Number(last.attributes('x')), Number(last.attributes('width'))]).toEqual([930.4, 80.6])
    expect(Number(last.attributes('x')) + Number(last.attributes('width'))).toBeCloseTo(1011, 5)
    expect(w.find('rect.future').exists()).toBe(false)
  })

  it('三态:漏抄 = 底部 2×7 琥珀刻度;未到 = 右侧淡底(28.5 日起到 31 日)', () => {
    const w = mk()
    const miss = w.findAll('rect.miss')
    expect(miss.map(m => Number(m.attributes('x')))).toEqual([462, 816.6, 848.8])
    expect(miss.every(m => m.attributes('y') === '205' && m.attributes('width') === '2' && m.attributes('height') === '7' && m.attributes('fill') === '#EF9F27')).toBe(true)
    const fut = w.find('rect.future')
    expect([Number(fut.attributes('x')), Number(fut.attributes('width')), fut.attributes('fill')]).toEqual([930.4, 80.6, 'rgba(28,28,28,.03)'])
    // 不写「未到 / 漏」字(V4 §0)
    expect(w.text()).not.toMatch(/未到|漏/)
  })

  it('投产前的空刻度不画缺抄刻度、悬停不出气泡(对照:同一形状早已投产 → 画、出「这天没抄表」)', async () => {
    const shape = (firstDate: string) => {
      const row = baseRow()
      for (let d = 1; d <= 4; d++) { row.state[d - 1] = 'missing'; row.ratio[d - 1] = null; row.out[d - 1] = null }
      row.runs = row.runs.slice(1)
      row.firstDate = firstDate
      return row
    }
    const late = mk(shape('2025-08-05'))
    expect(num(late, 'rect.miss', 'x')).toEqual([462, 816.6, 848.8])
    const early = mk(shape('2025-01-01'))
    expect(num(early, 'rect.miss', 'x')).toEqual([43, 75.2, 107.5, 139.7, 462, 816.6, 848.8])
    await late.find('.pdc-plot').trigger('mousemove', { clientX: 76.2 })
    expect(late.find('.pdc-tip').exists()).toBe(false)
    await early.find('.pdc-plot').trigger('mousemove', { clientX: 76.2 })
    expect(early.find('.pdc-tip').text()).toContain('这天没抄表')
  })

  it('空态(这段一个读数都没有、范围画不出):框线、轴线、横轴字都在,不画点、线、带、纵轴数', () => {
    const row = baseRow()
    row.ratio = row.ratio.map(() => null); row.out = row.out.map(() => null)
    row.state = row.state.map((_, i) => (i < 28 ? 'missing' : 'future'))
    Object.assign(row, { center: null, lo: null, hi: null, runs: [], outN: 0, seenN: 0 })
    const w = mk(row)
    expect(num(w, 'line.gl', 'y1')).toEqual([212, 145.3, 78.7, 12])
    expect(w.find('line.axl').exists()).toBe(true)
    expect(w.findAll('text.ax')).toHaveLength(7)
    for (const sel of ['circle.pt', 'path.line', 'rect.band', 'line.ctr', '.axh.hi']) expect(w.find(sel).exists(), sel).toBe(false)
    expect(w.findAll('.axh').every(e => (e.element as HTMLElement).style.display === 'none')).toBe(true)
    expect(w.html()).not.toContain('NaN')
  })

  it('悬停:取 x 最近的刻度 → 竖线 + 高亮点 + 深底气泡四行,放在竖线右侧 12px', async () => {
    const w = mk()
    await w.find('.pdc-plot').trigger('mousemove', { clientX: 330 })
    expect(Number(w.find('line.hair').attributes('x1'))).toBe(334.1)
    expect([Number(w.find('circle.hdot').attributes('cx')), Number(w.find('circle.hdot').attributes('cy'))]).toEqual([334.1, 54.4])
    const tip = w.find('.pdc-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['8 月 10 日', '比值 0.900', '范围 0.700 – 0.860', '高于上沿'])
    expect((tip.findAll('span')[3].element as HTMLElement).style.color).toBe('rgb(246, 199, 122)')
    expect(px((tip.element as HTMLElement).style.left)).toBeCloseTo(346.1, 5)
    await w.find('.pdc-plot').trigger('mouseleave')
    expect(w.find('.pdc-tip').exists()).toBe(false)
    expect(w.find('line.hair').exists()).toBe(false)
  })

  it('悬停到右缘:气泡翻到竖线左侧(宽按 chartTip 估);鼠标在未到区域 → 停在最后一个已过去的刻度', async () => {
    const w = mk()
    await w.find('.pdc-plot').trigger('mousemove', { clientX: 1000 })
    expect(Number(w.find('line.hair').attributes('x1'))).toBe(914.3)
    const tip = w.find('.pdc-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['8 月 28 日', '比值 0.732', '范围 0.700 – 0.860', '在范围内'])
    // 最长行「范围 0.700 – 0.860」= 2 × 12 + 14 × 6.6 → 117,加内边距 22 → 宽 139;914.3 + 12 + 139 > 1011 → 914.3 − 12 − 139
    expect(px((tip.element as HTMLElement).style.left)).toBeCloseTo(763.3, 5)
  })

  it('悬停漏抄日:第二行「这天没抄表」,不画高亮点', async () => {
    const w = mk()
    await w.find('.pdc-plot').trigger('mousemove', { clientX: 817.6 })
    expect(w.find('.pdc-tip').findAll('span').map(s => s.text())).toEqual(['8 月 25 日', '这天没抄表'])
    expect(w.find('circle.hdot').exists()).toBe(false)
    expect(Number(w.find('line.hair').attributes('x1'))).toBe(817.6)
  })

  it('❗读不出的栋:线与带照画,不画连续段底色、不画出范围点、气泡不写在不在范围内(对照:同一栋读得出时都有)', async () => {
    const w = mk(baseRow(), { unreadable: true })
    expect(w.find('path.line').exists()).toBe(true)
    expect(w.find('rect.band').exists()).toBe(true)
    expect(w.findAll('rect.run')).toHaveLength(0)
    expect(w.findAll('circle.pt')).toHaveLength(0)
    await w.find('.pdc-plot').trigger('mousemove', { clientX: 330 })
    expect(w.find('.pdc-tip').findAll('span').map(s => s.text())).toEqual(['8 月 10 日', '比值 0.900', '范围 0.700 – 0.860'])
    const ok = mk()
    expect([ok.findAll('rect.run').length, ok.findAll('circle.pt').length]).toEqual([2, 7])
  })

  it('图头:栋名 + 事实句 + 五项图例', () => {
    const w = mk()
    expect(w.find('.pdc-hd .nm').text()).toBe('E座')
    expect(w.find('.pdc-hd .fact').text()).toBe('事实句')
    expect(w.findAll('.leg > span').map(s => s.text())).toEqual(['逐日比值', '这栋的范围', '低于下沿', '高于上沿', '缺抄'])
  })

  it('❗C6-17：数据元素全在 g.pdc-data 里，轴线与 x 刻度在组前；换栋挂 .swap，animationend 摘掉', async () => {
    const w = mk()
    const g = w.find('g.pdc-data')
    for (const sel of ['rect.future', 'rect.band', 'line.ctr', 'rect.run', 'rect.miss', 'path.line', 'circle.pt']) {
      expect(g.find(sel).exists(), sel).toBe(true)
    }
    // 网格 4 + 轴线 1 + x 刻度 7 留在组外，且轴线排在数据组之前
    const kids = Array.from(w.find('svg').element.children)
    expect(kids.filter(e => ['gl', 'axl', 'ax'].some(c => e.classList.contains(c)))).toHaveLength(12)
    expect(kids.findIndex(e => e.classList.contains('pdc-data'))).toBeGreaterThan(kids.findIndex(e => e.classList.contains('axl')))
    // AnaShell 之外 entered 默认真 = 不擦；换栋才挂 .swap
    expect(g.classes()).not.toContain('first')
    expect(g.classes()).not.toContain('swap')
    await w.setProps({ row: { ...baseRow(), id: 9 } })
    expect(w.find('g.pdc-data').classes()).toContain('swap')
    expect(w.find('div.pdc-data.pdc-bandlab').classes()).toContain('swap')
    await w.find('g.pdc-data').trigger('animationend')
    expect(w.find('g.pdc-data').classes()).not.toContain('swap')
  })

  it('❗C6-17:.swap 必须自带 clip-path: none,且 animationcancel 与 animationend 同样摘类', async () => {
    // 首绘 320 擦入没跑完就点了另一枚芯片 → first 与 swap 同挂。
    // 两条规则特异度同为 (0,2,0)、.swap 在后:它只抢到 animation,
    // .first 的 clip-path: inset(0 100% 0 0) 原样留着 = 整组数据被裁成零宽,屏上只剩轴与网格。
    const src = readFileSync(join(__dirname, '../PvDayChart.vue'), 'utf8')
    const css = src.slice(src.indexOf('<style'))
    const rule = (sel: string) => css.split(sel + ' {')[1]?.split('}')[0] ?? ''
    expect(rule('.pdc-data.first'), '首绘基态不是零宽裁剪了,下面这条前提不成立').toContain('clip-path: inset(0 100% 0 0)')
    expect(rule('.pdc-data.swap'), '换栋淡入没解除首绘的裁剪 → 两个类同挂时空图').toContain('clip-path: none')
    expect(css.indexOf('.pdc-data.swap {'), '.swap 必须排在 .first 之后才压得过').toBeGreaterThan(css.indexOf('.pdc-data.first {'))
    // KeepAlive 停用取消动画只发 cancel:不听的话类留着,回签重插 DOM 重播
    const w = mk()
    await w.setProps({ row: { ...baseRow(), id: 9 } })
    expect(w.find('g.pdc-data').classes()).toContain('swap')
    await w.find('g.pdc-data').trigger('animationcancel')
    expect(w.find('g.pdc-data').classes(), 'animationcancel 没摘掉 .swap').not.toContain('swap')
  })
})
