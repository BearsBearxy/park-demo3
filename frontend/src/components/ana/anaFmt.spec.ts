// anaFmt 单测:仅覆盖 trendPath(spec 2026-07-11 §B 新增);既有格式化/统计函数由各屏 logic spec 间接覆盖。
import { describe, expect, it } from 'vitest'
import { trendPath } from './anaFmt'

describe('trendPath(KPI 迷你趋势线:x 等距,y 归一,null 断点分段)', () => {
  it('常规序列:起点 M 0 且最小值贴底(h−1)、末点最大值贴顶(1),段内平滑', () => {
    const d = trendPath([1, 2, 3], 56, 20)
    expect(d.startsWith('M 0.00 19.00')).toBe(true)
    expect(d).toContain('C')
    expect(d.endsWith('56.00 1.00')).toBe(true)
  })
  it('null 为断点:分段各起一条 M,不 connectNulls', () => {
    const d = trendPath([1, 2, null, 3, 4], 56, 20)
    expect(d.match(/M /g)).toHaveLength(2)
  })
  it('可画段不足 → 空串(全 null / 单点 / 断点两侧各剩单点 / 空数组)', () => {
    expect(trendPath([null, null, null], 56, 20)).toBe('')
    expect(trendPath([5], 56, 20)).toBe('')
    expect(trendPath([1, null, 2], 56, 20)).toBe('')
    expect(trendPath([], 56, 20)).toBe('')
  })
  it('全等序列画中线(避免极差除零)', () => {
    expect(trendPath([5, 5, 5], 56, 20).startsWith('M 0.00 10.00')).toBe(true)
  })
})
