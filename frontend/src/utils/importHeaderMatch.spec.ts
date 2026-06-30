import { describe, it, expect } from 'vitest'
import { matchByHeader, normalizeHeader, type ColumnMapEntry } from './importHeaderMatch'

// 模拟用户真实二期表的 factory 子集列
const COLS: ColumnMapEntry[] = [
  { label: '厂房租金', key: 'factoryRent' },
  { label: '企业管理服务费', key: 'factoryMgmtFee' },
  { label: '商铺租金', key: 'shopRent' },
  { label: '基本用电费', key: 'elecBasic' },
  { label: '基准水费', key: 'waterStd' },
]
const NAME = ['租户', '租户名称']

describe('matchByHeader — 真实 Excel 容错', () => {
  // 多行表头(标题/分组/叶子)+ 前置车间分类列 + 尾部合计/备注列
  const matrix: string[][] = [
    ['2025年1月二期园区费用明细表', '', '', '', '', '', '', '', ''],
    ['', '', '租金', '', '', '12月电费', '12月水费', '', ''],                 // 分组行(命中少)
    ['', '租户', '厂房租金', '企业管理服务费', '商铺租金', '基本用电费', '基准水费', '合计', '备注'], // 叶子表头行(命中5)
    ['一至四车间', '火炬创新创业园', '1000', '200', '0', '50', '10', '1260', ''],
    ['', '理朋', '0', '0', '0', '30', '5', '35', '备注X'],
    ['5，6车间', '驰鸿印业', '500', '100', '0', '20', '8', '628', ''],
  ]

  it('定位叶子表头行、忽略前置车间列与尾部合计/备注', () => {
    const { records, error } = matchByHeader(matrix, COLS, NAME)
    expect(error).toBeUndefined()
    expect(records.map(r => r.tenantName)).toEqual(['火炬创新创业园', '理朋', '驰鸿印业'])
    expect(records[0].factoryRent).toBe(1000)
    expect(records[0].factoryMgmtFee).toBe(200)
    expect(records[0].elecBasic).toBe(50)
    expect(records[0].waterStd).toBe(10)
  })

  it('合计列不落到任何字段(防误落末叶子)', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    // 1260 是合计列值,不应出现在任何映射字段里
    const vals = Object.entries(records[0]).filter(([k]) => k !== '__preview' && k !== 'tenantName').map(([, v]) => v)
    expect(vals).not.toContain(1260)
  })

  it('车间分类标签不被当成租户名(首租户不丢)', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records.map(r => r.tenantName)).not.toContain('一至四车间')
    expect(records[0].tenantName).toBe('火炬创新创业园') // 首个租户在
  })

  it('列乱序仍按名字匹配', () => {
    const reordered: string[][] = [
      ['基准水费', '租户', '基本用电费', '商铺租金', '厂房租金', '企业管理服务费'],
      ['8', '甲租户', '50', '0', '999', '111'],
    ]
    const { records } = matchByHeader(reordered, COLS, NAME)
    expect(records[0].tenantName).toBe('甲租户')
    expect(records[0].factoryRent).toBe(999) // col4 厂房租金
    expect(records[0].elecBasic).toBe(50)    // col2 基本用电费
    expect(records[0].waterStd).toBe(8)      // col0 基准水费
  })

  it('表头命中过少 → 报错', () => {
    const junk: string[][] = [['a', 'b', 'c'], ['1', '2', '3']]
    const { records, error } = matchByHeader(junk, COLS, NAME)
    expect(records.length).toBe(0)
    expect(error).toContain('无法识别表头')
  })

  it('normalizeHeader 去标点/空格', () => {
    expect(normalizeHeader('土地使用税、房产税')).toBe('土地使用税房产税')
    expect(normalizeHeader(' 厂房 租金 ')).toBe('厂房租金')
  })
})
