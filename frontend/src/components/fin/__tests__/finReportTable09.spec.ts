// FinReportTable 画布 09(2026-10-03)那一批:分组行收起、关键列、0 写「–」、改过格、贴底行与口径悬停、成对表。
// 夹具不退化:有值 / 0 / 负数都有;组有「其中」(默认收起)与「自动合计」(默认展开)两种;成对表两边行数不等。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FinReportTable, { type FinTableRow, type FinTableColumn } from '../FinReportTable.vue'

const COLS: FinTableColumn[] = [{ key: 'cur', label: '本月金额', strong: true }, { key: 'ytd', label: '本年累计金额' }]
const ROWS: FinTableRow[] = [
  { key: 1, no: 1, label: '一、营业收入', level: 0, type: 'normal' },
  { key: 2, no: 2, label: '减：营业成本', level: 0, type: 'normal', parentAuto: true, childCount: 2, group: 'open' },
  { key: 'c1', label: '租赁成本', level: 1, type: 'normal', custom: true, parent: 2 },
  { key: 'c2', label: '物业成本', level: 1, type: 'normal', custom: true, parent: 2 },
  { key: 3, no: 3, label: '营业税金及附加', level: 0, type: 'normal', group: 'fold', tag: '其中 2 项' },
  { key: 5, no: 5, label: '营业税', level: 1, type: 'normal', parent: 3 },
  { key: 6, no: 6, label: '城市维护建设税', level: 1, type: 'normal', parent: 3 },
  { key: 21, no: 21, label: '二、营业利润', level: 0, type: 'subtotal' },
]
const FOOT: FinTableRow[] = [{ key: 32, no: 32, label: '四、净利润', level: 0, type: 'subtotal' }]
const V: Record<string, number> = {
  '1|cur': 2010881.85, '1|ytd': 23215887.17, '2|cur': 2940770.57, '2|ytd': 29015530.53,
  'c1|cur': 2100000, 'c2|cur': 840770.57, '3|cur': 137533.28, '6|ytd': 4.5,
  '32|cur': -1484332.12, '32|ytd': -10706830.92,
}
const valueOf = (k: string | number, f: string) => V[`${k}|${f}`] ?? 0
const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string } })._tip?.text
const labels = (w: ReturnType<typeof mount>) => w.findAll('tbody .fin-lt').map(e => e.text())

const open = (over: Record<string, unknown> = {}) => mount(FinReportTable, {
  props: { rows: ROWS, columns: COLS, valueOf, editable: false, foot: FOOT, footTip: '净利润 = 利润总额 − 所得税费用。', ...over },
})

describe('FinReportTable · 分组行', () => {
  // 破坏验证:isOpen 的默认改成恒 true → 第一条红
  it('❗「其中」组默认收起,点箭头展开,子行缩进一级;「自动合计」组默认展开', async () => {
    const w = open()
    expect(labels(w)).toEqual(['一、营业收入', '减：营业成本', '租赁成本', '物业成本', '营业税金及附加', '二、营业利润'])
    const g = w.findAll('tbody tr')[4]
    expect(g.find('.fin-tagt').text()).toBe('其中 2 项')
    expect(g.find('.fin-caret').attributes('aria-label')).toBe('展开')
    await g.find('.fin-caret').trigger('click')
    expect(labels(w)).toEqual(['一、营业收入', '减：营业成本', '租赁成本', '物业成本', '营业税金及附加', '营业税', '城市维护建设税', '二、营业利润'])
    expect(w.findAll('tbody tr')[4].find('.fin-caret').attributes('aria-label')).toBe('收起')
    // 缩进按层级:顶层 12px,子行 24px
    expect((w.findAll('tbody tr')[4].find('.fin-rowlabel').element as HTMLElement).style.paddingLeft).toBe('12px')
    expect((w.findAll('tbody tr')[5].find('.fin-rowlabel').element as HTMLElement).style.paddingLeft).toBe('24px')
  })

  it('❗自定义子类的父项:蓝签「N 个子类 · 自动合计」,点箭头把子类收起', async () => {
    const w = open()
    const p = w.findAll('tbody tr')[1]
    expect(p.find('.chip').text()).toBe('2 个子类 · 自动合计')
    await p.find('.fin-caret').trigger('click')
    expect(labels(w)).toEqual(['一、营业收入', '减：营业成本', '营业税金及附加', '二、营业利润'])
  })

  it('❗顶层分组行铺浅灰底(td.grp),普通行与小计行不铺', () => {
    const w = open()
    const trs = w.findAll('tbody tr')
    expect(trs[4].find('td.fin-c1').classes()).toContain('grp')
    expect(trs[0].find('td.fin-c1').classes()).not.toContain('grp')
    expect(trs[5].find('td.fin-c1').classes()).toContain('sub')
  })

  // 破坏验证:行末 td.fp-fill 去掉 trClass → 灰底 / 选中底 / 小计上边线停在最后一列金额,红
  it('❗单表:分组灰底、选中底、小计上边线铺到行末填充格(稿 ReportIS 灰带铺到卡片右沿)', () => {
    const w = open({ editable: true, selectable: true, selected: new Set([1]) })
    const fill = (i: number) => w.findAll('tbody tr')[i].find('td.fp-fill').classes()
    expect(fill(4)).toContain('grp')
    expect(fill(0)).toContain('sel')
    expect(fill(5)).toContain('sub')
    expect(fill(0)).not.toContain('grp')
  })
})

describe('FinReportTable · 数与关键列', () => {
  // 破坏验证:show() 改回 finSigned(v) || '–' → 0 写成 0.00,红
  it('❗0 与空一律写「–」—— 普通行、小计行、「其中」明细行都一样', async () => {
    const w = open()
    const trs = w.findAll('tbody tr')
    expect(trs[4].findAll('.fin-nv').map(e => e.text())).toEqual(['137,533.28', '–'])
    expect(trs[5].findAll('.fin-nv').map(e => e.text()), '小计 0 也写「–」').toEqual(['–', '–'])
    await trs[4].find('.fin-caret').trigger('click')
    expect(w.findAll('tbody tr')[5].findAll('.fin-nv').map(e => e.text())).toEqual(['–', '–'])
    expect(w.findAll('tbody tr')[6].findAll('.fin-nv').map(e => e.text())).toEqual(['–', '4.50'])
  })

  // 破坏验证:td 上的 k 条件去掉 → 本年累计也铺底,第二条红
  it('❗关键列(本月金额):表头下划线那一格只有它;格子浅蓝底 + 加粗,本年累计不加粗', () => {
    const w = open()
    expect(w.findAll('thead th.k').map(e => e.text())).toEqual(['本月金额'])
    const r = w.findAll('tbody tr')[0].findAll('td')
    expect(r[2].classes()).toContain('k')
    expect(r[3].classes()).not.toContain('k')
    expect(r[2].find('.fin-nv').classes()).toContain('b')
    expect(r[3].find('.fin-nv').classes()).not.toContain('b')
  })

  it('❗编辑态:录入框白底描边;改过且有值的格加 chg(浅蓝底无框),没改的不加', () => {
    const w = open({ editable: true, changedOf: (k: string | number, f: string) => k === 1 && f === 'cur' })
    const inputs = w.findAll('tbody tr')[0].findAll('input.fin-ni')
    expect(inputs.map(i => i.classes().includes('chg'))).toEqual([true, false])
    // 录入格那一列不铺关键列底(底色让给框自己)
    expect(w.findAll('tbody tr')[0].findAll('td')[2].classes()).not.toContain('k')
  })

  // 破坏验证:isCalc 把分组行也算成计算格 → 「其中」父行没有录入框,红
  it('❗编辑态「其中」父项(ReportStates 第二种写法):收着,父行自己两格录入框,没有「自动合计」签', () => {
    const w = open({ editable: true })
    const g = w.findAll('tbody tr')[4]
    expect(g.find('.fin-tagt').text()).toBe('其中 2 项')
    expect(g.findAll('input.fin-ni')).toHaveLength(2)
    expect(g.find('.chip').exists()).toBe(false)
    // 「N 个子类 · 自动合计」那种父项是计算格,不给框
    expect(w.findAll('tbody tr')[1].findAll('input.fin-ni')).toHaveLength(0)
  })

  // 破坏验证:普通行 .fin-nv 的 neg 条件去掉 → 红(ReportBS 应交税费负数也红,不止净利润)
  it('❗负数红不限于贴底行:普通行负数也红', () => {
    const w = open({ valueOf: (k: string | number, f: string) => (k === 1 && f === 'cur' ? -12602461.47 : valueOf(k, f)) })
    const v = w.findAll('tbody tr')[0].findAll('.fin-nv')
    expect(v[0].text()).toBe('−12,602,461.47')
    expect(v[0].classes()).toContain('neg')
    expect(v[1].classes()).not.toContain('neg')
  })
})

describe('FinReportTable · 贴底行', () => {
  // 破坏验证:tfoot 的 v-tip 删掉 → 红
  it('❗净利润贴底(tfoot,不在表体里),名称挂口径悬停,负数红', () => {
    const w = open()
    expect(labels(w)).not.toContain('四、净利润')
    const f = w.get('tfoot tr')
    expect(f.find('.fin-foot-l').text()).toBe('四、净利润')
    expect(tipOf(f.find('.fin-foot-l').element)).toBe('净利润 = 利润总额 − 所得税费用。')
    const v = f.findAll('.fin-nv')
    expect(v.map(e => e.text())).toEqual(['−1,484,332.12', '−10,706,830.92'])
    expect(v[0].classes()).toContain('neg')
  })
})

describe('FinReportTable · 成对表(资产负债表)', () => {
  const C1: FinTableColumn[] = [{ key: 'end', label: '期末余额', strong: true }]
  const L: FinTableRow[] = [
    { key: 15, no: 15, label: '流动资产', level: 0, type: 'subtotal', group: 'open', tag: '2 项 · 合计' },
    { key: 1, no: 1, label: '货币资金', level: 1, type: 'normal', parent: 15 },
    { key: 2, no: 2, label: '短期投资', level: 1, type: 'normal', parent: 15 },
  ]
  const R: FinTableRow[] = [{ key: 41, no: 41, label: '流动负债', level: 0, type: 'subtotal', group: 'open', tag: '1 项 · 合计' },
    { key: 31, no: 31, label: '短期借款', level: 1, type: 'normal', parent: 41 }]
  const BV: Record<string, number> = { 15: 292259.39, 1: 292259.39, 41: 43520000, 31: 43520000, 30: 388014099.69, 53: 388013099.69 }
  const mk = (over: Record<string, unknown> = {}) => mount(FinReportTable, {
    props: {
      rows: L, right: R, heads: ['资　产', '负债和所有者权益'], columns: C1, editable: false,
      valueOf: (k: string | number) => BV[String(k)] ?? 0,
      foot: [{ key: 30, no: 30, label: '资产总计', level: 0, type: 'subtotal' }, { key: 53, no: 53, label: '负债和所有者权益（或股东权益）总计', level: 0, type: 'subtotal' }],
      ...over,
    },
  })

  it('❗一张 6 列表:两边各「名称 / 行次 / 期末余额」+ 最右空列;按行成对,短的一边补空格', () => {
    const w = mk()
    expect(w.findAll('thead th').map(e => e.text())).toEqual(['资　产', '行次', '期末余额', '负债和所有者权益', '行次', '期末余额', ''])
    const trs = w.findAll('tbody tr')
    expect(trs).toHaveLength(3)
    for (const tr of trs) expect(tr.findAll('td'), '每行格数一样多(补空格)').toHaveLength(7)
    expect(trs[0].text()).toContain('流动资产')
    expect(trs[0].text()).toContain('流动负债')
    expect(trs[2].findAll('td')[3].text(), '右边短一行,补空').toBe('')
    // 段头行带段合计金额与行次
    expect(trs[0].findAll('td').map(e => e.text().trim()).slice(0, 3)).toEqual(['流动资产2 项 · 合计', '15', '292,259.39'])
    // 两边各是一行:填充格不跟哪一边铺灰(稿 ReportBS 段头灰底停在右半边金额列)
    expect(trs[0].find('td.fp-fill').classes()).not.toContain('grp')
  })

  // 破坏验证:pairs() 改成左右同一份可见表 → 收左边时右边也跟着少,红
  it('❗两边各自收起:收左边的段,右边行不动,重新按行配对', async () => {
    const w = mk()
    await w.findAll('tbody tr')[0].findAll('.fin-caret')[0].trigger('click')
    const trs = w.findAll('tbody tr')
    expect(trs).toHaveLength(2)
    expect(trs[1].text()).toContain('短期借款')
    expect(trs[1].findAll('td')[0].text(), '左边只剩段头,第二行左半边补空').toBe('')
  })

  it('❗贴底一行同时放资产总计与负债和权益总计;就地标「● 多 x」只给多的那边写字,另一边只给点', () => {
    const w = mk({ footMark: { 30: '多 1,000.00', 53: '' }, footTip: '期末资产总计应等于负债合计与所有者权益合计之和' })
    const f = w.get('tfoot tr')
    expect(f.findAll('.fin-foot-l').map(e => e.text())).toEqual(['资产总计', '负债和所有者权益（或股东权益）总计'])
    expect(f.findAll('.fin-foot-l').map(e => tipOf(e.element))).toEqual(['期末资产总计应等于负债合计与所有者权益合计之和', '期末资产总计应等于负债合计与所有者权益合计之和'])
    const marks = f.findAll('.fin-mark')
    expect(marks.map(m => m.text())).toEqual(['多 1,000.00', ''])
    expect(marks.every(m => m.find('.fin-dot').exists())).toBe(true)
    expect(f.findAll('.fin-foot-v').map(e => e.text())).toEqual(['多 1,000.00388,014,099.69', '388,013,099.69'])
  })
})
