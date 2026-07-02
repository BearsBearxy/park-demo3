import { describe, it, expect } from 'vitest'
import { computeBsRow, BS_ROWS, BS_SUBTOTAL } from './balanceSheet'

// 叶子录入值 map(rowKey=String(no) → end 值);缺省 0。
function leafGetter(vals: Record<number, number>) {
  return (no: number) => vals[no] ?? 0
}
const noChildren = (_no: number): number | null => null

describe('BS_ROWS 模板', () => {
  it('有行次的行覆盖 1–53,label 行 no=null', () => {
    const numbered = BS_ROWS.filter(r => r.no !== null).map(r => r.no)
    expect(numbered).toEqual(Array.from({ length: 53 }, (_, i) => i + 1))
    expect(BS_ROWS.filter(r => r.no === null).every(r => r.type === 'label')).toBe(true)
    expect(BS_ROWS.filter(r => r.no === null)).toHaveLength(5)
  })

  it('side 划分:1–30 为 L,31–53 为 R', () => {
    for (const r of BS_ROWS.filter(r => r.no !== null)) {
      expect(r.side).toBe(r.no! <= 30 ? 'L' : 'R')
    }
  })

  it('subtotal 行 = 公式键 = 15/20/29/30/41/46/47/52/53', () => {
    const subtotals = [15, 20, 29, 30, 41, 46, 47, 52, 53]
    expect(BS_ROWS.filter(r => r.type === 'subtotal').map(r => r.no)).toEqual(subtotals)
    expect(Object.keys(BS_SUBTOTAL).map(Number).sort((a, b) => a - b)).toEqual(subtotals)
  })
})

describe('computeBsRow 合计公式', () => {
  it('20 = g(18) − g(19) 差额', () => {
    const getLeaf = leafGetter({ 18: 1000, 19: 300 })
    expect(computeBsRow(20, getLeaf, noChildren)).toBe(700)
  })

  it('15 = Σ(1..9,14),其中 10–13 不计', () => {
    const vals: Record<number, number> = {}
    for (let n = 1; n <= 14; n++) vals[n] = n // 10–13 也给值,应被忽略
    const expected = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 14 // 59
    expect(computeBsRow(15, leafGetter(vals), noChildren)).toBe(expected)
  })

  it('29 用 20 账面价值,不重复 18/19', () => {
    const getLeaf = leafGetter({ 16: 10, 17: 20, 18: 1000, 19: 300, 21: 5 })
    // 29 = 10 + 20 + (1000−300) + 5 = 735;若误加 18/19 原值会变 2035/…
    expect(computeBsRow(29, getLeaf, noChildren)).toBe(735)
  })

  it('30 = g(15) + g(29)', () => {
    const getLeaf = leafGetter({ 1: 100, 9: 50, 16: 30, 18: 200, 19: 80 })
    const r15 = 100 + 50
    const r29 = 30 + (200 - 80)
    expect(computeBsRow(30, getLeaf, noChildren)).toBe(r15 + r29)
  })

  it('41/46/47 负债侧:47 = Σ(31..40) + Σ(42..45)', () => {
    const getLeaf = leafGetter({ 31: 10, 33: 20, 40: 5, 42: 100, 45: 1 })
    expect(computeBsRow(41, getLeaf, noChildren)).toBe(35)
    expect(computeBsRow(46, getLeaf, noChildren)).toBe(101)
    expect(computeBsRow(47, getLeaf, noChildren)).toBe(136)
  })

  it('52/53:53 = g(47) + g(52)', () => {
    const getLeaf = leafGetter({ 31: 40, 48: 60, 51: 15 })
    expect(computeBsRow(52, getLeaf, noChildren)).toBe(75)
    expect(computeBsRow(53, getLeaf, noChildren)).toBe(40 + 75)
  })

  it('两侧平衡场景:30 === 53', () => {
    // 资产:货币资金 500 + 固定资产(800−300)=500 → 30 = 1000
    // 负债权益:短期借款 400 + 实收资本 600 → 53 = 1000
    const getLeaf = leafGetter({ 1: 500, 18: 800, 19: 300, 31: 400, 48: 600 })
    expect(computeBsRow(30, getLeaf, noChildren)).toBe(1000)
    expect(computeBsRow(53, getLeaf, noChildren)).toBe(1000)
  })
})

describe('computeBsRow 父项含自定义子类', () => {
  it('normal 行有自定义子类时 = 子类和(忽略自身叶子录入值)', () => {
    const getLeaf = leafGetter({ 4: 999 }) // 应收账款有旧录入值,应被子类和覆盖
    const childrenSum = (no: number) => (no === 4 ? 60 : null)
    expect(computeBsRow(4, getLeaf, childrenSum)).toBe(60)
  })

  it('子类和进入上级合计:4 的子类和进入 15/30', () => {
    const getLeaf = leafGetter({ 1: 100, 4: 0 })
    const childrenSum = (no: number) => (no === 4 ? 25 : null)
    expect(computeBsRow(15, getLeaf, childrenSum)).toBe(125)
    expect(computeBsRow(30, getLeaf, childrenSum)).toBe(125)
  })

  it('无子类回落叶子录入值', () => {
    const getLeaf = leafGetter({ 33: 42 })
    expect(computeBsRow(33, getLeaf, noChildren)).toBe(42)
  })
})
