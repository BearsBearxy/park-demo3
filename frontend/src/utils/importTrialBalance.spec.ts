import { describe, it, expect } from 'vitest'
import { importTrialBalance } from './importTrialBalance'

const c = (a: (string | number)[]) => a.map(String)

// 缩进型(①/②版式):两行表头(组行合并单元格 + 借方/贷方子行),一级有代码、下级无代码靠名称前导空格分层(2 空格/级)。
const indentSheet: string[][] = [
  c(['佛山市①公司 科目余额表 2025年10月']),
  c(['科目代码', '科目名称', '期初余额', '', '本期发生额', '', '本年累计发生额', '', '期末余额', '']),
  c(['', '', '借方', '贷方', '借方', '贷方', '借方', '贷方', '借方', '贷方']),
  c(['2001', '短期借款', ' - ', '5,000', '', '1000', '', '1000', '', '6000']),
  c(['', '  大沥农商行', '', '3000', '', '600', '', '600', '', '3600']),
  c(['', '    明细户', '', '100', '', '', '', '', '', '100']),
  c(['1001', '库存现金', '100', '', '10', '', '10', '', '110', '']),
  c(['', '合计', '100', '8000', '10', '1600', '10', '1600', '110', '9600']),
  c(['', '', '', '', '', '', '', '', '', '']),
]

// 代码型(帮管好等版式):单行表头 `期初余额(借方)` 直接映射,全有代码,层级=(代码位数−4)/2。
const codeSheet: string[][] = [
  c(['帮管好2025年10月科目余额表']),
  c(['科目代码', '科目名称', '期初余额(借方)', '期初余额(贷方)', '本期发生额(借方)', '本期发生额(贷方)', '本年累计发生额(借方)', '本年累计发生额(贷方)', '期末余额(借方)', '期末余额(贷方)']),
  c(['1002', '银行存款', '1,000.50', '', '200', '', '500', '', '1200.50', '']),
  c(['100201', '农商行', '1000.50', '', '200', '', '500', '', '1200.50', '']),
  c(['', '合计', '1000.50', '', '200', '', '500', '', '1200.50', '']),
]

describe('importTrialBalance — 缩进型(两行表头)', () => {
  it('两行表头合并映射 8 列;" - " 清洗为 0;金额落对字段', () => {
    const { sections, error } = importTrialBalance([{ name: '①余额表', matrix: indentSheet }])
    expect(error).toBeUndefined()
    expect(sections).toHaveLength(1)
    const recs = sections[0].records
    const loan = recs.find(r => r.account.label === '短期借款')!
    expect(loan.amounts).toMatchObject({ openDr: 0, openCr: 5000, periodCr: 1000, ytdCr: 1000, endCr: 6000 })
    const cash = recs.find(r => r.account.label === '库存现金')!
    expect(cash.amounts).toMatchObject({ openDr: 100, periodDr: 10, ytdDr: 10, endDr: 110, endCr: 0 })
  })

  it('无代码行按前导空格分层(2 空格/级),parent=向上最近 level−1 行,rowKey=code||r<行号>', () => {
    const { sections } = importTrialBalance([{ name: '①余额表', matrix: indentSheet }])
    const recs = sections[0].records
    expect(recs.map(r => r.account.rowKey)).toEqual(['2001', 'r5', 'r6', '1001'])
    expect(recs.map(r => r.account.level)).toEqual([0, 1, 2, 0])
    expect(recs.map(r => r.account.parentKey)).toEqual([null, '2001', 'r5', null])
    // label 去前导空格;无代码行 code=null
    expect(recs[1].account).toMatchObject({ label: '大沥农商行', code: null })
  })

  it('跳过「合计」行与名称空行;sortOrder 保文件行序', () => {
    const { sections } = importTrialBalance([{ name: '①余额表', matrix: indentSheet }])
    const recs = sections[0].records
    expect(recs.some(r => r.account.label.includes('合计'))).toBe(false)
    expect(recs.map(r => r.account.sortOrder)).toEqual([0, 1, 2, 3])
  })
})

describe('importTrialBalance — 代码型(单行表头)', () => {
  it('单行表头 `期初余额(借方)` 直接映射;层级=(代码位数−4)/2,parent 按代码层挂接', () => {
    const { sections, error } = importTrialBalance([{ name: '余额表（帮管好）', matrix: codeSheet }])
    expect(error).toBeUndefined()
    const recs = sections[0].records
    expect(recs.map(r => r.account.rowKey)).toEqual(['1002', '100201'])
    expect(recs.map(r => r.account.level)).toEqual([0, 1])
    expect(recs[1].account.parentKey).toBe('1002')
    expect(recs[0].amounts).toMatchObject({ openDr: 1000.5, periodDr: 200, ytdDr: 500, endDr: 1200.5 })
  })
})

describe('importTrialBalance — 多 sheet 分段与 label', () => {
  it('每张「余额表」sheet 一段,非余额表 sheet 忽略;label:余额表（X）→X、①余额表→①', () => {
    const { sections } = importTrialBalance([
      { name: '①余额表', matrix: indentSheet },
      { name: '利润表', matrix: [c(['行次', '本月金额'])] },
      { name: '余额表（帮管好）', matrix: codeSheet },
    ])
    expect(sections.map(s => s.label)).toEqual(['①', '帮管好'])
  })

  it('粘贴路径(name 空)也解析,label fallback 标题行', () => {
    const { sections, error } = importTrialBalance([{ name: '', matrix: codeSheet }])
    expect(error).toBeUndefined()
    expect(sections[0].label).toBe('帮管好2025年10月科目余额表')
  })

  it('整本没有余额表 sheet → error', () => {
    const { sections, error } = importTrialBalance([{ name: '利润表', matrix: codeSheet }])
    expect(error).toBeTruthy()
    expect(sections).toEqual([])
  })

  it('余额表 sheet 缺表头(无科目名称/期初余额列)→ error 点名 sheet', () => {
    const { error } = importTrialBalance([{ name: '②余额表', matrix: [c(['随便', '什么']), c(['1', '2'])] }])
    expect(error).toContain('②余额表')
  })
})
