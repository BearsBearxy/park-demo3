import { describe, it, expect } from 'vitest'
import { computeRow, IS_ROWS, IS_FORMULA } from './incomeStatement'

// 叶子录入值 map(rowKey=String(no) → cur 值);缺省 0。
function leafGetter(vals: Record<number, number>) {
  return (no: number, _field: string) => vals[no] ?? 0
}
const noChildren = (_no: number, _field: string): number | null => null

describe('IS_ROWS 模板', () => {
  it('覆盖行次 1–32,小计仅 21/30/32', () => {
    expect(IS_ROWS.map(r => r.no)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1))
    expect(IS_ROWS.filter(r => r.type === 'subtotal').map(r => r.no)).toEqual([21, 30, 32])
    expect(Object.keys(IS_FORMULA).map(Number).sort((a, b) => a - b)).toEqual([21, 30, 32])
  })
})

describe('computeRow 小计公式', () => {
  const vals = { 1: 1000, 2: 200, 3: 30, 11: 11, 14: 14, 18: 18, 20: 20, 22: 22, 24: 24, 31: 31 }
  const getLeaf = leafGetter(vals)

  it('21 = g(1)-g(2)-g(3)-g(11)-g(14)-g(18)+g(20)', () => {
    const expected = 1000 - 200 - 30 - 11 - 14 - 18 + 20 // 747
    expect(computeRow(21, 'cur', getLeaf, noChildren)).toBe(expected)
  })

  it('30 = g(21)+g(22)-g(24)', () => {
    const r21 = 1000 - 200 - 30 - 11 - 14 - 18 + 20 // 747
    const expected = r21 + 22 - 24 // 745
    expect(computeRow(30, 'cur', getLeaf, noChildren)).toBe(expected)
  })

  it('32 = g(30)-g(31)', () => {
    const r30 = (1000 - 200 - 30 - 11 - 14 - 18 + 20) + 22 - 24 // 745
    const expected = r30 - 31 // 714
    expect(computeRow(32, 'cur', getLeaf, noChildren)).toBe(expected)
  })
})

describe('computeRow 父项含自定义子类', () => {
  it('normal 行有自定义子类时 = 子类和(忽略自身叶子录入值)', () => {
    const getLeaf = leafGetter({ 14: 999 }) // 父项 14 有旧录入值,应被子类和覆盖
    const childrenSum = (no: number, _f: string) => (no === 14 ? 60 : null) // 14 的两子类 40+20
    expect(computeRow(14, 'cur', getLeaf, childrenSum)).toBe(60)
  })

  it('小计公式经父项汇总后重算:14 的子类和进入 21', () => {
    const getLeaf = leafGetter({ 1: 100, 14: 0 })
    const childrenSum = (no: number, _f: string) => (no === 14 ? 25 : null)
    // 21 = 100 - 0 - 0 - 0 - 25(子类和) - 0 + 0
    expect(computeRow(21, 'cur', getLeaf, childrenSum)).toBe(75)
  })

  it('无子类回落叶子录入值', () => {
    const getLeaf = leafGetter({ 3: 42 })
    expect(computeRow(3, 'cur', getLeaf, noChildren)).toBe(42)
  })
})
