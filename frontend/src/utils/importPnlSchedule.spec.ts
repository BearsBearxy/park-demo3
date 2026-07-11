import { describe, it, expect } from 'vitest'
import { importPnlSchedule } from './importPnlSchedule'

const c = (a: (string | number)[]) => a.map(String)

// 仿真实附表1:标题行(带年)/单位行/表头(区域|科目细分|1月..12月|本年合计|备注,月列带空格)/数据行(分组合并单元格向下填充)。
// 真实母册 5 张附表表体内均无整空行(空行只出现在表尾),故此处不再夹造中间空行 —— 见规则 4b。
const monthHeads = Array.from({ length: 12 }, (_, i) => ` ${i + 1}月 `)
const sheet1: string[][] = [
  c(['2025年租金损益明细', ...Array(15).fill('')]),
  c([...Array(14).fill(''), '金额单位：元', '']),
  c(['区域', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
  c(['一期、宿舍', '一期租金收入', ' 1,141,774.45 ', ...Array(10).fill(' 100.00 '), ' 135,794.49 ', ' 999,999.99 ', '']),
  c(['', '一期企业服务费收入', ' -   ', '0', ...Array(10).fill(''), ' 42.00 ', '免租期']),
  c(['二期', '收入小计', ...Array(12).fill(' 1.00 '), ' 12.00 ', '']),
  c(['', '租金损益', ...Array(12).fill(' 2.00 '), ' 24.00 ', '']),
]

// 总计类行(label 落分组列/科目细分空)+ 纯分组头(无月值只 carry)
const sheetTotals: string[][] = [
  c(['2025年租金损益明细', ...Array(15).fill('')]),
  c(['区域', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
  c(['一期', '一期租金收入', ...Array(12).fill(' 1.00 '), ' 12.00 ', '']),
  c(['园区总租金收入', '', ...Array(12).fill(' 9.00 '), ' 108.00 ', '']),   // 总计行:有月值,label 在分组列
  c(['光伏工程成本', '', ...Array(14).fill('')]),                           // 纯分组头:无月值,只 carry
  c(['', '土建成本', ...Array(12).fill(' 3.00 '), ' 36.00 ', '']),
]

// 真实版式:园区总计带 → 整空行 ×2 → 堆叠的无关附块「三期项目已发生成本汇总表」,
// 其「成本合计」数值列恰好压在「1月」列上(母册 附表1 第 36~47 行)。
const sheetAnnex: string[][] = [
  c(['2025年租金损益明细', ...Array(15).fill('')]),
  c(['区域', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
  c(['一期、宿舍', '一期租金收入', ...Array(12).fill(' 1.00 '), ' 12.00 ', '']),
  c(['园区总租金收入', '', ' 5,140,137.39 ', ...Array(11).fill(' 1.00 '), ' 56,914,614.29 ', '']),
  c(['园区总租金成本', '', ' 3,292,213.18 ', ...Array(11).fill(' 1.00 '), ' 42,087,163.07 ', '']),
  c(['园区租金总损益', '', ' 1,847,924.21 ', ...Array(11).fill(' 0.00 '), ' 14,827,451.22 ', '']),
  c(['', '', ...Array(14).fill('')]),                                         // ← 表尾
  c(['', '', ...Array(14).fill('')]),
  c(['', '三期项目已发生成本汇总表', ...Array(14).fill('')]),
  c(['', '车间', '成本合计', ...Array(13).fill('')]),
  c(['', '三车间', ' 27,876,152.51 ', ...Array(13).fill('')]),
  c(['', '开票税费（成本票部分）', ' 575,667.80 ', ...Array(12).fill(''), '建中成本票4.68%']),
  c(['', '已发生成本金额合计：', ' 82,187,725.02 ', ...Array(13).fill('')]),
  c(['', '截止2025年12月三期租金收入合计', ' 2,784,838.22 ', ...Array(13).fill('')]),
  c(['', '结余未回本金额', ' 91,530,038.38 ', ...Array(13).fill('')]),
]

describe('importPnlSchedule — 总计类行与纯分组头', () => {
  it('科目细分空+分组列有字+有月值 → 总计行(label=分组列字,groupLabel 空,不污染 carry)', () => {
    const { rows } = importPnlSchedule(sheetTotals)
    const total = rows.find(r => r.label === '园区总租金收入')!
    expect(total).toBeTruthy()
    expect(total.groupLabel).toBe('')
    expect(total.m[0]).toBe(9)
    expect(total.kind).toBe('total')
  })
  it('科目细分空+分组列有字+无月值 → 纯分组头 carry', () => {
    const { rows } = importPnlSchedule(sheetTotals)
    const annex = rows.find(r => r.label === '土建成本')!
    expect(annex.groupLabel).toBe('光伏工程成本')
  })
  it('总计行后 carry 清空,不把总计字带给后续行', () => {
    const { rows } = importPnlSchedule(sheetTotals)
    expect(rows.map(r => r.label)).toEqual(['一期租金收入', '园区总租金收入', '土建成本'])
  })
})

// 回归:曾把附块 `已发生成本金额合计：`(82,187,725.02)当成园区总租金成本、
// `截止2025年12月三期租金收入合计`(2,784,838.22)当成园区总租金收入 —— 两者 detectKind 均命中「合计」→ total,
// groupLabel 又恰为空,被 extractPnlBand 认作园区总计带,全部计入 2025-01,园区利润由 +2,290万 翻成 −5,650万。
describe('importPnlSchedule — 整空行=表尾,堆叠附块不入表(规则 4b)', () => {
  it('解析止于园区总计带,附块任一行都不进 rows', () => {
    const { rows } = importPnlSchedule(sheetAnnex)
    expect(rows.map(r => r.label)).toEqual([
      '一期租金收入', '园区总租金收入', '园区总租金成本', '园区租金总损益',
    ])
  })

  it('附块的「合计」行不会被当成园区总计带(成本/收入均不受污染)', () => {
    const { rows } = importPnlSchedule(sheetAnnex)
    expect(rows.find(r => r.label === '已发生成本金额合计：')).toBeUndefined()
    expect(rows.find(r => r.label === '截止2025年12月三期租金收入合计')).toBeUndefined()

    // extractPnlBand 的选行条件:groupLabel==='' && kind==='total' && label 含 成本/收入
    const bandish = rows.filter(r => r.groupLabel === '' && r.kind === 'total')
    expect(bandish.map(r => r.label)).toEqual(['园区总租金收入', '园区总租金成本'])
    expect(bandish.find(r => r.label === '园区总租金成本')!.m[0]).toBe(3292213.18)
  })

  it('表尾空行之前的行照常解析(空行不是数据行)', () => {
    const { rows, year } = importPnlSchedule(sheetAnnex)
    expect(year).toBe(2025)
    expect(rows).toHaveLength(4)
    expect(rows.find(r => r.label === '园区租金总损益')!.kind).toBe('pnl')
  })

  // 附表5 把二级分组放在表头为空的未映射列,且该行月值全为 " - "(→null)。
  // 若「整空行」只查 分组/科目细分/月列,这种行会被误判为表尾,把其后的「运营费用总计」整块切掉。
  it('非空单元格落在未映射列的行,不得被当成表尾', () => {
    const sheet5: string[][] = [
      c(['2025年费用支出明细', ...Array(16).fill('')]),
      c(['科目', '', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
      c(['管理费用', '保险费', '一期园区财产综合险', ...Array(12).fill(' -   '), ' -   ', '']),
      c(['', '其他管理费用支出', '', ...Array(12).fill(' -   '), ' -   ', '']),   // ← 只有未映射列 idx1 有字
      c(['运营费用总计', '', '', ...Array(12).fill(' 1.00 '), ' 12.00 ', '']),
      c(['', '', ...Array(15).fill('')]),                                        // ← 真表尾
      c(['', '被切掉的附块', ...Array(14).fill('')]),
    ]
    const { rows } = importPnlSchedule(sheet5)
    expect(rows.find(r => r.label === '运营费用总计')).toBeTruthy()
    expect(rows.find(r => r.label === '运营费用总计')!.m[0]).toBe(1)
    expect(rows.find(r => r.label === '被切掉的附块')).toBeUndefined()
  })
})

describe('importPnlSchedule — 母册附表解析', () => {
  it('表头定位(含 科目细分+1月) + 年识别(标题 2025年)', () => {
    const { year, rows, error } = importPnlSchedule(sheet1)
    expect(error).toBeUndefined()
    expect(year).toBe(2025)
    expect(rows).toHaveLength(4)
  })

  it('12 月列按「N月」定位;「本年合计」列忽略不进 m', () => {
    const { rows } = importPnlSchedule(sheet1)
    expect(rows[0].m).toHaveLength(12)
    expect(rows[0].m[0]).toBe(1141774.45)
    expect(rows[0].m[11]).toBe(135794.49)
    expect(rows[0].m).not.toContain(999999.99)
    expect(rows[2].m.every(v => v === 1)).toBe(true)
  })

  it('" - "/空 → null(未录),真 0 保留;备注列收 note', () => {
    const { rows } = importPnlSchedule(sheet1)
    expect(rows[1].m[0]).toBeNull()
    expect(rows[1].m[1]).toBe(0)
    expect(rows[1].m.slice(2)).toEqual(Array(10).fill(null))
    expect(rows[1].note).toBe('免租期')
    expect(rows[0].note).toBeNull()
  })

  it('分组列向下填充;kind=detectKind;rowKey=r<n>/sortOrder 保序', () => {
    const { rows } = importPnlSchedule(sheet1)
    expect(rows.map(r => r.groupLabel)).toEqual(['一期、宿舍', '一期、宿舍', '二期', '二期'])
    expect(rows.map(r => r.kind)).toEqual(['detail', 'detail', 'subtotal', 'pnl'])
    expect(rows.map(r => r.rowKey)).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(rows.map(r => r.sortOrder)).toEqual([0, 1, 2, 3])
  })

  it('附表5 版式:科目与科目细分之间多一空列,分组列仍按表头文字定位', () => {
    const sheet5: string[][] = [
      c(['2025年费用支出明细', ...Array(16).fill('')]),
      c(['科目', '', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
      c(['销售费用', '', '厂房租赁中介费：', ' 45,130.00 ', ...Array(11).fill(' -   '), ' 45,130.00 ', '']),
      c(['', '', '一期中介费', ...Array(12).fill(''), '', '']),
    ]
    const { year, rows, error } = importPnlSchedule(sheet5)
    expect(error).toBeUndefined()
    expect(year).toBe(2025)
    expect(rows.map(r => r.groupLabel)).toEqual(['销售费用', '销售费用'])
    expect(rows[0].m[0]).toBe(45130)
    expect(rows[0].m[1]).toBeNull()
  })

  it('识别不到表头 → error;标题无年 → year=null 行照收', () => {
    const bad = [c(['随便', '什么']), c(['1', '2'])]
    const r1 = importPnlSchedule(bad)
    expect(r1.error).toBeTruthy()
    expect(r1.rows).toEqual([])
    expect(r1.year).toBeNull()

    const noYear = [
      c(['区域', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
      c(['一期', '一期租金收入', ...Array(12).fill('5'), '60', '']),
    ]
    const r2 = importPnlSchedule(noYear)
    expect(r2.error).toBeUndefined()
    expect(r2.year).toBeNull()
    expect(r2.rows).toHaveLength(1)
    expect(r2.rows[0].m.every(v => v === 5)).toBe(true)
  })
})
