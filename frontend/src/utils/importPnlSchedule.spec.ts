import { describe, it, expect } from 'vitest'
import { importPnlSchedule } from './importPnlSchedule'

const c = (a: (string | number)[]) => a.map(String)

// 仿真实附表1:标题行(带年)/单位行/表头(区域|科目细分|1月..12月|本年合计|备注,月列带空格)/数据行(分组合并单元格向下填充)。
const monthHeads = Array.from({ length: 12 }, (_, i) => ` ${i + 1}月 `)
const sheet1: string[][] = [
  c(['2025年租金损益明细', ...Array(15).fill('')]),
  c([...Array(14).fill(''), '金额单位：元', '']),
  c(['区域', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
  c(['一期、宿舍', '一期租金收入', ' 1,141,774.45 ', ...Array(10).fill(' 100.00 '), ' 135,794.49 ', ' 999,999.99 ', '']),
  c(['', '一期企业服务费收入', ' -   ', '0', ...Array(10).fill(''), ' 42.00 ', '免租期']),
  c(['', '', ...Array(14).fill('')]),
  c(['二期', '收入小计', ...Array(12).fill(' 1.00 '), ' 12.00 ', '']),
  c(['', '租金损益', ...Array(12).fill(' 2.00 '), ' 24.00 ', '']),
]

// 总计类行(label 落分组列/科目细分空)+ 纯分组头(无月值只 carry)
const sheetTotals: string[][] = [
  c(['2025年租金损益明细', ...Array(15).fill('')]),
  c(['区域', '科目细分', ...monthHeads, ' 本年合计 ', ' 备注 ']),
  c(['一期', '一期租金收入', ...Array(12).fill(' 1.00 '), ' 12.00 ', '']),
  c(['园区总租金收入', '', ...Array(12).fill(' 9.00 '), ' 108.00 ', '']),   // 总计行:有月值,label 在分组列
  c(['三期项目已发生成本汇总表', '', ...Array(14).fill('')]),               // 纯分组头:无月值,只 carry
  c(['', '土建成本', ...Array(12).fill(' 3.00 '), ' 36.00 ', '']),
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
  it('科目细分空+分组列有字+无月值 → 纯分组头 carry(附块行拿到自己的分组)', () => {
    const { rows } = importPnlSchedule(sheetTotals)
    const annex = rows.find(r => r.label === '土建成本')!
    expect(annex.groupLabel).toBe('三期项目已发生成本汇总表')
  })
  it('总计行后 carry 清空,不把总计字带给后续行', () => {
    const { rows } = importPnlSchedule(sheetTotals)
    expect(rows.map(r => r.label)).toEqual(['一期租金收入', '园区总租金收入', '土建成本'])
  })
})

describe('importPnlSchedule — 母册附表解析', () => {
  it('表头定位(含 科目细分+1月) + 年识别(标题 2025年)', () => {
    const { year, rows, error } = importPnlSchedule(sheet1)
    expect(error).toBeUndefined()
    expect(year).toBe(2025)
    expect(rows).toHaveLength(4) // 空 label 行跳过
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
