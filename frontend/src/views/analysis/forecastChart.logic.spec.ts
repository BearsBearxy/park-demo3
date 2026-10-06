// 自绘 SVG 图共用的轴刻度(niceTicks)。
import { describe, it, expect } from 'vitest'
import { niceTicks } from './forecastChart.logic'

describe('niceTicks', () => {
  it('取 1/2/5×10^k 的整刻度,全部落在区间内', () => {
    const t = niceTicks(712, 945)
    expect(t.length).toBeGreaterThanOrEqual(3)
    expect(t.every((v) => v >= 712 && v <= 945)).toBe(true)
    const step = t[1] - t[0]
    expect(t.every((v, i) => i === 0 || Math.abs(v - t[i - 1] - step) < 1e-6)).toBe(true)
  })
  it('上下界相等时不崩', () => {
    expect(niceTicks(5, 5)).toEqual([5])
  })
})
