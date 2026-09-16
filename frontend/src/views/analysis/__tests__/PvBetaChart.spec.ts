// B11 挂载测:钉渲染出来的 SVG 坐标(计划 §4)。月槽中心 x 用画布 v2/Drawer.dc.html 的几何
// (宽 646、12 等分:70.4 / 119.3 / … / 607.6),y 按「极值贴上 34 / 下 48 像素」手算写死。
// 夹具三种留空都有(1 月投产前、2 月与 5 月样本不足、9–12 月还没到),5 月在两段有值的月中间 —— 连线必须在那里断开。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PvBetaChart from '../PvBetaChart.vue'
import type { BetaSlot } from '../pvAnaV4.logic'
import { PV_COLORS as C } from '../pvAnaColors'

const BETA: Record<number, number> = { 3: 0.95, 4: 1.04, 6: 1.1, 7: 1.06, 8: 1.01 }
const WHY: Record<number, BetaSlot['why']> = { 1: 'pre', 2: 'thin', 5: 'thin', 9: 'future', 10: 'future', 11: 'future', 12: 'future' }
const slots = (current: number | null = 8): BetaSlot[] => Array.from({ length: 12 }, (_, k) => ({
  month: k + 1, beta: BETA[k + 1] ?? null, why: WHY[k + 1] ?? null, current: k + 1 === current,
}))
const CENTERS = [70.4, 119.3, 168.1, 216.9, 265.8, 314.6, 363.4, 412.3, 461.1, 509.9, 558.8, 607.6]

const mountChart = (s: BetaSlot[] = slots()) => mount(PvBetaChart, { props: { slots: s, year: 2025 } })
const num = (s: string | undefined) => Number(s)

describe('PvBetaChart(B11)', () => {
  it('12 个月槽固定:刻度字在槽中心,y 188;空槽字淡(墨 28%)并在 y 199 写原因,有值的月不写', () => {
    const w = mountChart()
    expect([w.find('svg').attributes('width'), w.find('svg').attributes('height')]).toEqual(['646', '200'])
    const ms = w.findAll('text.mlab')
    expect(ms.map(t => t.text())).toEqual(Array.from({ length: 12 }, (_, k) => `${k + 1}月`))
    expect(ms.map(t => num(t.attributes('x')))).toEqual(CENTERS)
    expect(ms.every(t => t.attributes('y') === '188')).toBe(true)
    expect(ms.map(t => t.attributes('fill-opacity') === '0.28')).toEqual([true, true, false, false, true, false, false, false, true, true, true, true])
    const why = w.findAll('text.whylab')
    expect(why.map(t => [t.text(), num(t.attributes('x')), num(t.attributes('y'))])).toEqual([
      ['投产前', 70.4, 199], ['不足', 119.3, 199], ['不足', 265.8, 199],
      ['未到', 461.1, 199], ['未到', 509.9, 199], ['未到', 558.8, 199], ['未到', 607.6, 199],
    ])
  })

  it('点 r7 蓝底白环落在槽中心;极值 1.10 → y 50、0.95 → y 122(每单位 480 像素);连线在样本不足的 5 月断开', () => {
    const w = mountChart()
    const dots = w.findAll('circle.dot')
    expect(dots.map(d => [num(d.attributes('cx')), num(d.attributes('cy'))]))
      .toEqual([[168.1, 122], [216.9, 78.8], [314.6, 50], [363.4, 69.2], [412.3, 93.2]])
    expect(dots.every(d => d.attributes('r') === '7' && d.attributes('fill') === C.FOCUS && d.attributes('stroke-width') === '2.5')).toBe(true)
    // 连线一月一段(换栋能形变):3→4、6→7、7→8;4→5、5→6 空槽处不出段
    const segs = w.findAll('path.line')
    expect(segs.map(s => s.attributes('d'))).toEqual(['M168.1,122 L216.9,78.8', 'M314.6,50 L363.4,69.2', 'M363.4,69.2 L412.3,93.2'])
    expect(segs.every(s => s.attributes('stroke') === C.FOCUS && s.attributes('stroke-width') === '2')).toBe(true)
  })

  it('网格 0.9 / 1.0 / 1.1;=1 参照墨阶虚线 y 98 + 右端直标「1 = 与全园同步」', () => {
    const w = mountChart()
    expect(w.findAll('line.gl').map(l => num(l.attributes('y1')))).toEqual([146, 98, 50])
    expect(w.findAll('text').filter(t => /^\d\.\d$/.test(t.text())).map(t => t.text())).toEqual(['0.9', '1.0', '1.1'])
    const ref = w.find('line.ref')
    expect([num(ref.attributes('y1')), ref.attributes('stroke'), ref.attributes('stroke-dasharray')]).toEqual([98, 'var(--ink-500)', '4 3'])
    const lab = w.find('text.reflab')
    expect([lab.text(), num(lab.attributes('x')), num(lab.attributes('y')), lab.attributes('text-anchor')]).toEqual(['1 = 与全园同步', 628, 92, 'end'])
  })

  it('网格从 1 起按步长排:极值 1.12 / 0.92 时步长 0.15,网格 0.85 / 1.00 / 1.15(1 永远是一条网格)', () => {
    const s = slots().map(x => (x.month === 3 ? { ...x, beta: 0.92 } : x.month === 6 ? { ...x, beta: 1.12 } : x))
    const w = mountChart(s)
    // 每单位 72 / 0.2 = 360 像素:y = 50 + (1.12 − v) × 360
    expect(w.findAll('line.gl').map(l => num(l.attributes('y1')))).toEqual([147.2, 93.2, 39.2])
    expect(w.findAll('text').filter(t => /^\d\.\d\d$/.test(t.text())).map(t => t.text())).toEqual(['0.85', '1.00', '1.15'])
  })

  it('当段月:淡蓝底 x 387.8 宽 48.8 + 「当段」在槽中心上方;刻度字标蓝加粗。年档没有当段 → 两样都不出现', () => {
    const w = mountChart()
    const cur = w.find('rect.cur')
    expect([num(cur.attributes('x')), num(cur.attributes('y')), num(cur.attributes('width')), num(cur.attributes('height')), cur.attributes('fill')])
      .toEqual([387.8, 16, 48.8, 154, C.SEG_B11])
    const lab = w.find('text.curlab')
    expect([lab.text(), num(lab.attributes('x')), num(lab.attributes('y'))]).toEqual(['当段', 412.3, 12])
    const aug = w.findAll('text.mlab')[7]
    expect([aug.attributes('fill'), aug.attributes('font-weight')]).toEqual([C.FOCUS, '600'])
    const y = mountChart(slots(null))
    expect(y.find('rect.cur').exists()).toBe(false)
    expect(y.find('text.curlab').exists()).toBe(false)
    expect(y.findAll('text.mlab').some(t => t.attributes('fill') === C.FOCUS)).toBe(false)
  })

  it('一个值都没有:框线、=1 参照、12 个刻度照画,不画点也不画线', () => {
    const empty = slots(null).map(s => ({ ...s, beta: null, why: s.month > 8 ? 'future' as const : 'pre' as const }))
    const w = mountChart(empty)
    expect(w.findAll('circle.dot')).toHaveLength(0)
    expect(w.find('path.line').exists()).toBe(false)
    expect(w.find('line.axl').exists()).toBe(true)
    expect(w.findAll('text.mlab')).toHaveLength(12)
    // 只有 1:量程 0.95~1.05,每单位 720 像素 → 1 在 y 86;步长 0.05 → 四条网格
    expect(num(w.find('line.ref').attributes('y1'))).toBe(86)
    expect(w.findAll('line.gl').map(l => num(l.attributes('y1')))).toEqual([158, 122, 86, 50])
  })

  it('悬停整槽命中:有值的月两行(值 + 测量句),空槽第二行写原因;右侧放不下翻左', async () => {
    const w = mountChart()
    const hits = w.findAll('span.hit')
    expect(hits).toHaveLength(12)
    expect(hits[7].attributes('style')).toContain('left: 398.3px')
    await hits[7].trigger('mouseenter')
    expect(w.findAll('.dtip span').map(l => l.text())).toEqual(['2025 年 8 月', '1.01　全园多发时它比全园还多'])
    // '1.01　…' = 4 × 6.6 + 12 × 12 = 170.4 → 171 + 22 = 193;412.3 + 26 + 193 = 631.3 ≤ 632 放右
    expect(w.find('.dtip').attributes('style')).toContain('left: 438.3px')
    await hits[2].trigger('mouseenter')
    expect(w.findAll('.dtip span')[1].text()).toBe('0.95　全园多发时它跟得没那么足')
    await hits[9].trigger('mouseenter')
    const lines = w.findAll('.dtip span')
    expect(lines.map(l => l.text())).toEqual(['2025 年 10 月', '还没到，这个月不出点'])
    expect(lines[1].attributes('style')).toContain(rgb(C.TIP_ABOVE))
    // 宽 10 × 12 + 22 = 142;509.9 + 26 + 142 > 632 → 509.9 − 26 − 142 = 341.9
    expect(w.find('.dtip').attributes('style')).toContain('left: 341.9px')
    await hits[1].trigger('mouseenter')
    expect(w.findAll('.dtip span')[1].text()).toBe('样本不足，这个月不出点')
    await hits[1].trigger('mouseleave')
    expect(w.find('.dtip').exists()).toBe(false)
  })

  it('图注按三种留空原因列出各自的月', () => {
    const t = mountChart().find('.ana-ref').text()
    expect(t).toContain('投产前（1 月）')
    expect(t).toContain('样本不足（2、5 月抄表天数太少）')
    expect(t).toContain('还没到（9–12 月）')
    const none = mountChart(slots().map(s => ({ ...s, beta: s.beta ?? 1, why: null }))).find('.ana-ref').text()
    expect(none).toContain('投产前（本栋没有）')
    expect(none).toContain('样本不足（本栋没有）')
  })
})

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

// 2026-09-16 行为矩阵:抽屉里的图 —— 打开瞬现(不擦入,原则 7);上一栋 / 下一栋不重挂,同键 200 形变
describe('PvBetaChart(B11)动效', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('❗抽屉里在视口内挂载也不擦:数据组只有形变类,没有 first / hold', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 300, left: 0, right: 646, width: 646, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const w = mountChart()
    await nextTick()
    expect(w.find('g.b11-data').classes()).toEqual(['b11-data', 'ana-morph'])
  })

  it('❗下一栋不重挂:同一个月的点与连线段还是同一个元素,坐标换成新栋的;5 月补上值后 4→5、5→6 两段新出现;悬停层不在形变组里', async () => {
    const w = mountChart()
    const dot4 = w.findAll('circle.dot')[1].element   // 4 月不是极值(极值钉在上下边,换栋也不动)
    const seg67 = w.find('path.line[data-m="6"]').element
    const before = [dot4.getAttribute('cy'), seg67.getAttribute('d')]
    const next = slots().map(s => ({ ...s, beta: s.month === 5 ? 1.2 : s.beta == null ? null : s.beta + 0.05, why: s.month === 5 ? null : s.why }))
    await w.setProps({ slots: next })
    expect(w.findAll('circle.dot')[1].element).toBe(dot4)
    expect(w.find('path.line[data-m="6"]').element).toBe(seg67)
    expect([dot4.getAttribute('cy'), seg67.getAttribute('d')].map((v, k) => v === before[k])).toEqual([false, false])
    expect(w.findAll('path.line').map(p => Number(p.attributes('data-m')))).toEqual([3, 4, 5, 6, 7])
    await w.findAll('.hit')[2].trigger('mouseenter')
    for (const sel of ['.hit', '.dtip', 'line.ref', 'line.axl']) expect(w.find(sel).element.closest('.ana-morph'), sel).toBe(null)
  })
})
