import { describe, it, expect } from 'vitest'
import { importBalanceSheet } from './importBalanceSheet'

const c = (a: (string | number)[]) => a.map(String)

// 仿真实资产负债表 sheet:单表头行,两栏(资产‖负债和所有者权益)×6 公司横向。
// 左块 = 资产名|行次|①..⑥|期末余额合计;右块 = 负债权益名|行次|①..⑥|期末余额合计。
const sheet: string[][] = [
  c(['2025年10月 资产负债表']),
  c(['资产', '行次', '①期末余额', '②期末余额（乙）', '③期末余额（帮管好）', '④期末余额（丁）', '⑤期末余额（戊）', '⑥期末余额（创燊高）', '期末余额合计',
     '负债和所有者权益', '行次', '①期末余额', '②期末余额（乙）', '③期末余额（帮管好）', '④期末余额（丁）', '⑤期末余额（戊）', '⑥期末余额（创燊高）', '期末余额合计']),
  c(['流动资产：', '', '', '', '', '', '', '', '', '流动负债：', '', '', '', '', '', '', '', '']),          // label 行(无行次)跳过
  c(['货币资金', '1', '100', '200', '300', '400', '500', '600', '2100', '短期借款', '31', '10', '20', '30', '40', '50', '60', '210']),
  c(['应收账款', '4', '101', '201', '301', '401', '501', '601', '2106', '应付账款', '33', '11', '21', '31', '41', '51', '61', '216']),
  c(['存货', '9', '50', '50', '50', '50', '50', '50', '300', '其他应付款', '39', '5', '5', '5', '5', '5', '5', '30']),
  c(['其中：原材料', '10', '7', '7', '7', '7', '7', '7', '42', '其中：航泽借款', '', '9', '9', '9', '9', '9', '9', '54']), // 右侧无行次「其中」跳过
  c(['流动资产合计', '15', '999', '999', '999', '999', '999', '999', '5994', '流动负债合计', '41', '888', '888', '888', '888', '888', '888', '5328']), // subtotal 跳过
  c(['', '', '', '', '', '', '', '', '', '实收资本（或股本）', '48', '1000', '1000', '1000', '1000', '1000', '1000', '6000']), // 右块比左块长
]

describe('importBalanceSheet — 两栏 6 公司资产负债表解析', () => {
  it('按序号拆出 6 公司段,段 label = 序号+括号名(无括号则序号本身),忽略「期末余额合计」列', () => {
    const { sections, error } = importBalanceSheet(sheet)
    expect(error).toBeUndefined()
    expect(sections.map(s => s.label)).toEqual(['①', '②乙', '③帮管好', '④丁', '⑤戊', '⑥创燊高'])
  })

  it('左右块各按自己行次列匹配 side,左右 records 合并为一段', () => {
    const { sections } = importBalanceSheet(sheet)
    const co1 = sections[0].records
    // 左块 normal 行 1/4/9/10(其中：原材料 有行次,是 normal 叶子,应导入) + 右块 31/33/39/48
    expect(co1.map(r => r.rowKey)).toEqual(['1', '4', '9', '10', '31', '33', '39', '48'])
    expect(co1.find(r => r.rowKey === '1')).toMatchObject({ end: 100 })
    expect(co1.find(r => r.rowKey === '31')).toMatchObject({ end: 10 })
    expect(co1.find(r => r.rowKey === '48')).toMatchObject({ end: 1000 })
    // ③帮管好 取自己那列(左块第 3 公司列 / 右块第 3 公司列)
    const co3 = sections[2].records
    expect(co3.find(r => r.rowKey === '1')).toMatchObject({ end: 300 })
    expect(co3.find(r => r.rowKey === '31')).toMatchObject({ end: 30 })
  })

  it('跳过 label(流动资产：)/subtotal(15/41)/无行次「其中」行,合计值丢弃(客端重算)', () => {
    const { sections } = importBalanceSheet(sheet)
    for (const s of sections) {
      const keys = s.records.map(r => r.rowKey)
      expect(keys).not.toContain('15')
      expect(keys).not.toContain('41')
      expect(s.records.every(r => r.end !== 999 && r.end !== 888)).toBe(true)
    }
  })

  it('识别不到左右两个「行次」列 → error', () => {
    const bad: string[][] = [
      c(['资产', '行次', '期末余额']),
      c(['货币资金', '1', '100']),
    ]
    const { sections, error } = importBalanceSheet(bad)
    expect(error).toBeTruthy()
    expect(sections).toEqual([])
  })
})
