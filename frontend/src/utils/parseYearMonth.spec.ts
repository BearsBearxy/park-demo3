import { describe, it, expect } from 'vitest'
import { parseYearMonth } from './parseYearMonth'

describe('parseYearMonth', () => {
  it('Excel 序列号(1899-12-30 epoch)', () => {
    expect(parseYearMonth(45292)).toEqual({ year: 2024, month: 1 })   // 2024-01-01
    expect(parseYearMonth(45658)).toEqual({ year: 2025, month: 1 })   // 2025-01-01
    expect(parseYearMonth('45323')).toEqual({ year: 2024, month: 2 })  // 字符串序列号 2024-02-01
  })
  it('Date 对象', () => {
    expect(parseYearMonth(new Date(Date.UTC(2024, 5, 1)))).toEqual({ year: 2024, month: 6 })
  })
  it('YYYY-MM-DD / YYYY/M/D / YYYY年M月 / YYYY-MM', () => {
    expect(parseYearMonth('2024-01-01')).toEqual({ year: 2024, month: 1 })
    expect(parseYearMonth('2024/1/1')).toEqual({ year: 2024, month: 1 })
    expect(parseYearMonth('2024.3.1')).toEqual({ year: 2024, month: 3 })
    expect(parseYearMonth('2024年1月')).toEqual({ year: 2024, month: 1 })
    expect(parseYearMonth('2024年12月')).toEqual({ year: 2024, month: 12 })
    expect(parseYearMonth('2025-03')).toEqual({ year: 2025, month: 3 })
  })
  it('M/D/YY(年末位) — Excel m/d/yy 单元格经 raw:false 渲染', () => {
    expect(parseYearMonth('1/1/24')).toEqual({ year: 2024, month: 1 })
    expect(parseYearMonth('12/1/23')).toEqual({ year: 2023, month: 12 })
    expect(parseYearMonth('3/1/2024')).toEqual({ year: 2024, month: 3 })
    expect(parseYearMonth('13/1/24')).toEqual({ year: 2024, month: 1 })  // 首字段>12 视为日,用次字段为月
  })
  it('裸 M月 / M(配回退年)', () => {
    expect(parseYearMonth('3月', 2025)).toEqual({ year: 2025, month: 3 })
    expect(parseYearMonth('7', 2024)).toEqual({ year: 2024, month: 7 })
    expect(parseYearMonth(5, 2024)).toEqual({ year: 2024, month: 5 })
  })
  it('裸月无回退年 → null', () => {
    expect(parseYearMonth('3月')).toBeNull()
    expect(parseYearMonth(5)).toBeNull()
  })
  it('无法识别 / 越界 → null', () => {
    expect(parseYearMonth('乱码', 2025)).toBeNull()
    expect(parseYearMonth('')).toBeNull()
    expect(parseYearMonth(null)).toBeNull()
    expect(parseYearMonth('13月', 2025)).toBeNull()
    expect(parseYearMonth('1999-01')).toBeNull()
  })
})
