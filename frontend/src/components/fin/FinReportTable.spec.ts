import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import FinReportTable, { type FinTableRow, type FinTableColumn } from './FinReportTable.vue'

const columns: FinTableColumn[] = [
  { key: 'cur', label: '本月金额' },
  { key: 'ytd', label: '本年累计金额' },
]

// 常驻叶子行(1) + 一条自定义子类(isc-1,其父) + 小计行(21)
const rows: FinTableRow[] = [
  { key: 1, no: 1, label: '一、营业收入', level: 0, type: 'normal' },
  { key: 'isc-1', label: '一期租户', level: 1, type: 'normal', custom: true },
  { key: 21, no: 21, label: '二、营业利润', level: 0, type: 'subtotal', strong: true },
]

const values: Record<string, Record<string, number>> = {
  '1': { cur: 12000, ytd: 34000 },
  'isc-1': { cur: 500, ytd: 800 },
  '21': { cur: -100, ytd: 200 },
}
const valueOf = (k: string | number, f: string) => values[String(k)]?.[f] ?? 0

describe('FinReportTable', () => {
  it('renders columns + all rows with subtotal/custom classes', () => {
    const w = mount(FinReportTable, { props: { rows, columns, valueOf, editable: false } })
    // 表头 = 项目 + 行次 + 2 金额列
    const ths = w.findAll('thead th').map((t) => t.text())
    expect(ths).toEqual(['项　目', '行次', '本月金额', '本年累计金额'])
    // 3 行渲染,小计行带 sub.strong,自定义行 custom(行次列空)
    const trs = w.findAll('tbody tr')
    expect(trs.length).toBe(3)
    expect(trs[2].classes()).toContain('sub')
    expect(trs[2].classes()).toContain('strong')
    // 自定义行行次列为空
    expect(trs[1].findAll('.fin-no')[0].text()).toBe('')
    // 常驻叶子行行次 = 1
    expect(trs[0].find('.fin-no').text()).toBe('1')
  })

  it('formats signed values, negative gets .neg', () => {
    const w = mount(FinReportTable, { props: { rows, columns, valueOf, editable: false } })
    const trs = w.findAll('tbody tr')
    // row1 cur = 12,000.00
    expect(trs[0].findAll('.fin-nv')[0].text()).toBe('12,000.00')
    // subtotal cur = -100 → 负号 + neg class + calc
    const sub = trs[2].findAll('.fin-nv')[0]
    expect(sub.text()).toBe('−100.00')
    expect(sub.classes()).toContain('neg')
    expect(sub.classes()).toContain('calc')
  })

  it('editable → normal leaf renders input, emits input on change', async () => {
    const w = mount(FinReportTable, { props: { rows, columns, valueOf, editable: true } })
    const trs = w.findAll('tbody tr')
    // 叶子行(row1)有 input;小计行仍是只读 .fin-nv.calc
    const inputs = trs[0].findAll('input.fin-ni')
    expect(inputs.length).toBe(2)
    expect(trs[2].find('input.fin-ni').exists()).toBe(false)
    await inputs[0].setValue('999')
    const ev = w.emitted('input')
    expect(ev).toBeTruthy()
    expect(ev![0]).toEqual([1, 'cur', '999'])
  })

  it('parentAuto row shows child-count chip and is read-only even when editable', () => {
    const autoRows: FinTableRow[] = [
      { key: 1, no: 1, label: '一、营业收入', level: 0, type: 'normal', parentAuto: true, childCount: 1 },
      { key: 'isc-1', label: '一期租户', level: 1, type: 'normal', custom: true, canAddChild: true },
    ]
    const w = mount(FinReportTable, { props: { rows: autoRows, columns, valueOf, editable: true } })
    const trs = w.findAll('tbody tr')
    // 父行有 chip「1 子类」,且是 calc 只读(非 input)
    expect(trs[0].find('.chip').text()).toContain('1')
    expect(trs[0].find('input.fin-ni').exists()).toBe(false)
    expect(trs[0].findAll('.fin-nv.calc').length).toBe(2)
    // 自定义子类可加子(addchild) + 可删(custom-x)
    expect(trs[1].find('.addchild').exists()).toBe(true)
    expect(trs[1].find('.custom-x').exists()).toBe(true)
  })
})
