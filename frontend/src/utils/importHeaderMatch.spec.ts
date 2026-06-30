import { describe, it, expect } from 'vitest'
import { matchByHeader, normalizeHeader, type ColumnMapEntry } from './importHeaderMatch'

// 真实二期表 factory 子集列
const COLS: ColumnMapEntry[] = [
  { label: '厂房租金', key: 'factoryRent' },
  { label: '企业管理服务费', key: 'factoryMgmtFee' },
  { label: '其他费用', key: 'otherFee' },
  { label: '基本用电费', key: 'elecBasic' },
  { label: '水维护费', key: 'waterMaint' },
]
const NAME = ['租户', '租户名称']

describe('matchByHeader — 真实 Excel 容错(二期结构)', () => {
  // 真实结构:租户表头在 r0col0、数据租户在 col1(col0=车间分类列)、叶子在 r2、其他费用在 r1分组行、尾部合计/备注、小计行
  const cols = (a: (string | number)[]) => a.map(String)
  const matrix: string[][] = [
    cols(['租户', '', '项目', '', '', '', '', '合计', '备注']),                               // r0:租户表头在col0
    cols(['', '', '租金', '', '其他费用', '1月电费', '1月水费', '', '']),                       // r1:分组行,其他费用在 col4
    cols(['', '', '厂房租金', '企业管理服务费', '', '基本用电费', '水维护费', '', '']),           // r2:叶子表头行
    cols(['一至四车间', '火炬创新创业园', '1808871', '100', '5', '50', '7', '1809033', '']),     // data:车间col0+租户col1
    cols(['', '锂朋', '0', '0', '3', '30', '2', '35', '']),
    cols(['五、六车间', '力灏', '200017', '200', '9', '90', '8', '200324', '']),
    cols(['一至四车间合计：', '', '2008888', '300', '17', '170', '17', '2009422', '']),          // 小计行(col1空)
    cols(['二期园区总计：', '', '2008888', '300', '17', '170', '17', '2009422', '']),
  ]

  it('租户表头在别行/数据租户在col1 也能找到租户列', () => {
    const { records, error } = matchByHeader(matrix, COLS, NAME)
    expect(error).toBeUndefined()
    expect(records.map(r => r.tenantName)).toEqual(['火炬创新创业园', '锂朋', '力灏'])
  })

  it('前置车间列被忽略,首租户不丢', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records.map(r => r.tenantName)).not.toContain('一至四车间')
    expect(records[0].tenantName).toBe('火炬创新创业园')
  })

  it('落在分组行的「其他费用」标签也被捕获', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records[0].otherFee).toBe(5)
    expect(records[0].factoryRent).toBe(1808871)
    expect(records[0].factoryMgmtFee).toBe(100)
  })

  it('合计列不落到任何字段', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    const vals = Object.entries(records[0]).filter(([k]) => k !== '__preview' && k !== 'tenantName').map(([, v]) => v)
    expect(vals).not.toContain(1809033)
  })

  it('小计/总计行被跳过', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records.length).toBe(3) // 火炬/锂朋/力灏,不含两条小计
    expect(records.some(r => /合计|总计/.test(r.tenantName as string))).toBe(false)
  })

  it('列乱序仍按名字匹配', () => {
    const reordered: string[][] = [
      cols(['', '租户', '基本用电费', '厂房租金', '企业管理服务费']),
      cols(['', '甲租户', '50', '999', '111']),
    ]
    const { records } = matchByHeader(reordered, COLS, NAME)
    expect(records[0].tenantName).toBe('甲租户')
    expect(records[0].factoryRent).toBe(999)
    expect(records[0].elecBasic).toBe(50)
  })

  it('表头命中过少 → 报错', () => {
    const junk: string[][] = [['a', 'b', 'c'], ['1', '2', '3']]
    const { error } = matchByHeader(junk, COLS, NAME)
    expect(error).toContain('无法识别表头')
  })

  it('normalizeHeader 去标点/空格', () => {
    expect(normalizeHeader('土地使用税、房产税')).toBe('土地使用税房产税')
    expect(normalizeHeader(' 厂房 租金 ')).toBe('厂房租金')
  })

  // 关键列为纯数字(如办公水电的月份"1"/"2") → 数据内容法找不到,须按 nameLabels 表头定位
  it('纯数字关键列按 nameLabels 表头定位(办公水电月份)', () => {
    const COLS2: ColumnMapEntry[] = [
      { label: '用电量', key: 'elecQty' },
      { label: '用水量', key: 'waterQty' },
    ]
    const m: string[][] = [
      cols(['月份', '用电量', '用水量']),
      cols(['1', '3000', '50']),
      cols(['2', '3200', '55']),
      cols(['合计', '6200', '105']),
    ]
    const { records, error } = matchByHeader(m, COLS2, ['月份', '所属月'])
    expect(error).toBeUndefined()
    expect(records.map(r => r.tenantName)).toEqual(['1', '2']) // 月份列(纯数字)被正确识别,合计行跳过
    expect(records[0].elecQty).toBe(3000)
  })
})
