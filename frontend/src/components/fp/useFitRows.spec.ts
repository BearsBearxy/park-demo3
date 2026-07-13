// fitRows 纯计算单测:可用高÷行高向下取整+钳位(自适应每页行数的核心公式)。
import { describe, expect, it } from 'vitest'
import { fitRows } from './useFitRows'

describe('fitRows', () => {
  it('向下取整:606 可用高、表头 34、行高 47 → (606-34)/47=12.17 → 12 行', () => {
    expect(fitRows(606, 34, 47)).toBe(12)
  })
  it('行高更高的屏(租户两行式 57px)自然得到更少行数', () => {
    expect(fitRows(606, 34, 57)).toBe(10)
  })
  it('钳位:极矮窗口不低于 6,超高屏不超过 30', () => {
    expect(fitRows(100, 34, 57)).toBe(6)
    expect(fitRows(5000, 34, 40)).toBe(30)
  })
})
