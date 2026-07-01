import { describe, it, expect } from 'vitest'
import { importIncomeStatement } from './importIncomeStatement'

const c = (a: (string | number)[]) => a.map(String)

// 仿真实利润表 sheet:6 公司横向合并(此处取 2 公司够验列拆分)。
// 2 行表头:公司名行(每公司名跨 2 列) + 子表头行(本月金额/本年累计金额);行首「项目|行次」;尾「合计」。
const sheet: string[][] = [
  c(['2025年10月 利润表']),
  c(['项目', '行次', '甲公司', '', '乙公司', '', '合计', '']),
  c(['', '', '本月金额', '本年累计金额', '本月金额', '本年累计金额', '本月金额', '本年累计金额']),
  c(['一、营业收入', '1', '100', '1000', '200', '2000', '300', '3000']),
  c(['减：营业成本', '2', '40', '400', '80', '800', '120', '1200']),
  c(['营业税金及附加', '3', '5', '50', '6', '60', '11', '110']),
  c(['其中：', '4', '', '', '', '', '', '']),                       // label 行(行次 4)跳过
  c(['营业税', '5', '2', '20', '3', '30', '5', '50']),
  c(['二、营业利润', '21', '55', '550', '111', '1110', '166', '1660']), // 小计(21)跳过
  c(['三、利润总额', '30', '55', '550', '111', '1110', '166', '1660']), // 小计(30)跳过
  c(['四、净利润', '32', '50', '500', '100', '1000', '150', '1500']),   // 小计(32)跳过
]

describe('importIncomeStatement — 合并多公司利润表解析', () => {
  it('按公司拆列(cur/ytd 两列一组),忽略「合计」列,产每公司一段', () => {
    const { sections, error } = importIncomeStatement(sheet)
    expect(error).toBeUndefined()
    expect(sections.map(s => s.label)).toEqual(['甲公司', '乙公司'])
  })

  it('按行次匹配 IS_ROWS normal 行,cur/ytd 取对应列', () => {
    const { sections } = importIncomeStatement(sheet)
    const jia = sections[0].records
    // 常驻 normal 行 1/2/3/5 命中;label(4)/小计(21/30/32) 不入
    expect(jia.map(r => r.rowKey)).toEqual(['1', '2', '3', '5'])
    expect(jia.find(r => r.rowKey === '1')).toMatchObject({ cur: 100, ytd: 1000 })
    expect(jia.find(r => r.rowKey === '3')).toMatchObject({ cur: 5, ytd: 50 })
    // 乙公司取自己那一组列
    const yi = sections[1].records
    expect(yi.find(r => r.rowKey === '1')).toMatchObject({ cur: 200, ytd: 2000 })
  })

  it('跳过小计(21/30/32)与 label(4)行', () => {
    const { sections } = importIncomeStatement(sheet)
    for (const s of sections) {
      const keys = s.records.map(r => r.rowKey)
      expect(keys).not.toContain('4')
      expect(keys).not.toContain('21')
      expect(keys).not.toContain('30')
      expect(keys).not.toContain('32')
    }
  })

  it('忽略「合计」列(不产成一段公司)', () => {
    const { sections } = importIncomeStatement(sheet)
    expect(sections.map(s => s.label)).not.toContain('合计')
    expect(sections.length).toBe(2)
  })

  it('识别不到子表头(本月/本年累计)→ error', () => {
    const bad: string[][] = [
      c(['项目', '行次', '甲公司']),
      c(['一、营业收入', '1', '100']),
    ]
    const { sections, error } = importIncomeStatement(bad)
    expect(error).toBeTruthy()
    expect(sections).toEqual([])
  })
})
