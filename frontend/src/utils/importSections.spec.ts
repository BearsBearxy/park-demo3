import { describe, it, expect } from 'vitest'
import { splitSections, type PhaseLayouts } from './importSections'
import type { ColumnMapEntry } from './importHeaderMatch'

// office 含「办公室租金」「保障房」标签;factory 不含。两套 columnMap(子集即可)。
const OFFICE: ColumnMapEntry[] = [
  { label: '办公室租金', key: 'officeRent' },
  { label: '厂房租金', key: 'factoryRent' },
  { label: '其他费用', key: 'otherFee' },
]
const FACTORY: ColumnMapEntry[] = [
  { label: '厂房租金', key: 'factoryRent' },
  { label: '企业管理服务费', key: 'factoryMgmtFee' },
  { label: '其他费用', key: 'otherFee' },
]
const LAYOUTS: PhaseLayouts = { office: OFFICE, factory: FACTORY }
const NAME = ['租户名称', '租户']
const c = (a: (string | number)[]) => a.map(String)

describe('splitSections — 智能整表拆段', () => {
  // 多段:1月二期(factory) + 1月散租宿舍(office) + 2月一期(office)
  const matrix: string[][] = [
    c(['2025年1月二期园区费用明细表（总表）']),
    c(['租户', '厂房租金', '企业管理服务费', '其他费用']),
    c(['火炬', '1000', '100', '5']),
    c(['锂朋', '2000', '200', '6']),
    c(['2025年1月散租宿舍费用明细表']),
    c(['租户', '办公室租金', '厂房租金', '其他费用']),
    c(['宿舍甲', '300', '400', '1']),
    c(['2025年2月一期园区费用明细表']),
    c(['租户', '办公室租金', '厂房租金', '其他费用']),
    c(['一期户', '500', '600', '2']),
  ]

  it('按标题行拆成 3 段', () => {
    const secs = splitSections(matrix, LAYOUTS, NAME)
    expect(secs.length).toBe(3)
  })

  it('识别 年/月/期', () => {
    const secs = splitSections(matrix, LAYOUTS, NAME)
    expect(secs[0]).toMatchObject({ year: 2025, month: 1, phase: 2 })
    expect(secs[1]).toMatchObject({ year: 2025, month: 1, phase: 4 })
    expect(secs[2]).toMatchObject({ year: 2025, month: 2, phase: 1 })
  })

  it('散租宿舍 → phase 4', () => {
    const secs = splitSections(matrix, LAYOUTS, NAME)
    expect(secs[1].phase).toBe(4)
  })

  it('版面识别:二期→factory、含办公室租金→office', () => {
    const secs = splitSections(matrix, LAYOUTS, NAME)
    expect(secs[0].layout).toBe('factory')
    expect(secs[1].layout).toBe('office')
    expect(secs[2].layout).toBe('office')
  })

  it('逐段解析出 records', () => {
    const secs = splitSections(matrix, LAYOUTS, NAME)
    expect(secs[0].records.map(r => r.tenantName)).toEqual(['火炬', '锂朋'])
    expect(secs[0].records[0].factoryRent).toBe(1000)
    expect(secs[1].records.map(r => r.tenantName)).toEqual(['宿舍甲'])
  })

  it('单段无标题 → 整体当 1 段,年/月/期 undefined,版面识别', () => {
    const single: string[][] = [
      c(['租户', '厂房租金', '企业管理服务费', '其他费用']),
      c(['甲', '1', '2', '3']),
    ]
    const secs = splitSections(single, LAYOUTS, NAME)
    expect(secs.length).toBe(1)
    expect(secs[0].year).toBeUndefined()
    expect(secs[0].month).toBeUndefined()
    expect(secs[0].phase).toBeUndefined()
    expect(secs[0].layout).toBe('factory')
    expect(secs[0].records[0].tenantName).toBe('甲')
  })

  it('垃圾行过滤(v4):段尾未标合计的合计行「202510二期」与「0」全零行被跳,段合计不翻倍', () => {
    const withGarbage: string[][] = [
      c(['2025年10月二期园区费用明细表']),
      c(['租户', '厂房租金', '企业管理服务费', '其他费用']),
      c(['火炬', '1000', '100', '5']),
      c(['锂朋', '2000', '200', '6']),
      c(['202510二期', '3000', '300', '11']),   // 各列 = 该段各列总和
      c(['0', '0', '0', '0']),
    ]
    const secs = splitSections(withGarbage, LAYOUTS, NAME)
    expect(secs.length).toBe(1)
    expect(secs[0].records.map(r => r.tenantName)).toEqual(['火炬', '锂朋'])
    expect(secs[0].records.reduce((n, r) => n + (r.factoryRent as number), 0)).toBe(3000)   // 不含合计行,不翻倍
  })

  it('无标题前导段(标题前有数据)→ 单独一段,年月期 undefined', () => {
    const withLead: string[][] = [
      c(['租户', '办公室租金', '厂房租金', '其他费用']),
      c(['前导户', '10', '20', '1']),
      c(['2025年3月二期园区费用明细表']),
      c(['租户', '厂房租金', '企业管理服务费', '其他费用']),
      c(['后段户', '30', '40', '2']),
    ]
    const secs = splitSections(withLead, LAYOUTS, NAME)
    expect(secs.length).toBe(2)
    expect(secs[0].year).toBeUndefined()
    expect(secs[0].layout).toBe('office')
    expect(secs[0].records[0].tenantName).toBe('前导户')
    expect(secs[1]).toMatchObject({ year: 2025, month: 3, phase: 2 })
  })
})
