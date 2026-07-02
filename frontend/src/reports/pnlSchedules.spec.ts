import { describe, it, expect } from 'vitest'
import { PNL_SCHEDULES, rowYearTotal, detectKind } from './pnlSchedules'

describe('PNL_SCHEDULES — 5 附表 config', () => {
  it('5 条 s1..s5,route/storeKey 一一对应', () => {
    expect(PNL_SCHEDULES.map(c => c.schedule)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(PNL_SCHEDULES.map(c => c.route)).toEqual(['rent-pnl', 'elec-pnl', 'water-pnl', 'ops-pnl', 'expense-pnl'])
    expect(PNL_SCHEDULES.map(c => c.storeKey)).toEqual(['pnl-s1', 'pnl-s2', 'pnl-s3', 'pnl-s4', 'pnl-s5'])
  })

  it('sheetRe 各自命中真实母册 sheet 名,互不误命中', () => {
    const names = ['附表1租金损益明细', '附表2电费损益明细', '附表3水费损益明细', '附表4其他运管费用收益', '附表5费用支出明细']
    PNL_SCHEDULES.forEach((c, i) => {
      names.forEach((n, j) => expect(c.sheetRe.test(n)).toBe(i === j))
    })
  })

  it('groupCol 按真实表头:区域/科目名称/科目名称/项目/科目', () => {
    expect(PNL_SCHEDULES.map(c => c.groupCol)).toEqual(['区域', '科目名称', '科目名称', '项目', '科目'])
  })
})

describe('rowYearTotal — 本年合计客端派生(D3)', () => {
  it('全 null → null(整行未录不显 0)', () => {
    expect(rowYearTotal(Array(12).fill(null))).toBeNull()
  })

  it('Σ非空,真 0 参与求和', () => {
    expect(rowYearTotal([1.5, null, 0, 2, ...Array(8).fill(null)])).toBe(3.5)
  })
})

describe('detectKind — D2 标签识别(先判损益再判合计)', () => {
  it('含 损益 → pnl,优先于 合计(「损益合计」不误判 total)', () => {
    expect(detectKind('租金损益')).toBe('pnl')
    expect(detectKind('损益合计')).toBe('pnl')
  })

  it('含 小计 → subtotal', () => {
    expect(detectKind('一、三期基本用电收入小计')).toBe('subtotal')
  })

  it('含 合计/总计 → total', () => {
    expect(detectKind('收入合计')).toBe('total')
    expect(detectKind('费用总计')).toBe('total')
  })

  it('否则 detail', () => {
    expect(detectKind('一期租金收入')).toBe('detail')
  })
})
