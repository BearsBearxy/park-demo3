// fitRows 纯计算单测:可用高÷行高向下取整+钳位。行高是常量输入(--mx-row-h=56),
// 严禁由渲染内容反推(LIST-PAGE-SPEC §6 防抖动铁律)。
import { describe, expect, it } from 'vitest'
import { fitRows } from './useFitRows'

describe('fitRows', () => {
  it('向下取整:700 可用高、表头 36、行高 56 → (700-36)/56=11.86 → 11 行', () => {
    expect(fitRows(700, 36, 56)).toBe(11)
  })
  it('恰好整除不多算:596 可用高 → (596-36)/56=10 行', () => {
    expect(fitRows(596, 36, 56)).toBe(10)
  })
  it('钳位:极矮窗口不低于 6,超高屏不超过 30', () => {
    expect(fitRows(100, 36, 56)).toBe(6)
    expect(fitRows(5000, 36, 56)).toBe(30)
  })
})
