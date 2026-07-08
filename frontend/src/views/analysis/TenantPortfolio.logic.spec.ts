// TenantPortfolio.logic 纯函数单测(铁律⑦):箱线五数(同 fiveNum 线性插值)与帕累托累计。
import { describe, expect, it } from 'vitest'
import { buildBoxRows, buildPareto } from './TenantPortfolio.logic'

describe('buildBoxRows', () => {
  it('五数=线性插值分位(与 AnaBoxPlot/fiveNum 同算法),含均值与样本数', () => {
    const [r] = buildBoxRows([{ name: '一期', values: [1, 2, 3, 4, 5] }])
    expect(r.stats).toEqual([1, 2, 3, 4, 5])
    expect(r.mean).toBe(3)
    expect(r.n).toBe(5)
  })
  it('div 折万:所有统计量同比例缩放', () => {
    const [r] = buildBoxRows([{ name: '二期', values: [10000, 20000, 30000, 40000] }], 10000)
    expect(r.stats).toEqual([1, 1.75, 2.5, 3.25, 4])   // 四元线性插值分位
    expect(r.mean).toBe(2.5)
  })
})

describe('buildPareto', () => {
  it('Top N 截断;累计只加已展示项;cums[4]=Top5 集中度', () => {
    const shares = Array.from({ length: 8 }, (_, i) => ({ name: `户${i + 1}`, share: 10 - i }))
    const p = buildPareto(shares, 6)
    expect(p.names).toHaveLength(6)
    expect(p.shares[0]).toBe(10)
    expect(p.cums[4]).toBe(10 + 9 + 8 + 7 + 6)   // Top5
    expect(p.cums[5]).toBe(45)
  })
})
