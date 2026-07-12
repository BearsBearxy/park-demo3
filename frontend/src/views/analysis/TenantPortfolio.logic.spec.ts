// TenantPortfolio.logic 纯函数单测(铁律⑦):箱线五数(同 fiveNum 线性插值)、散点带抖动与帕累托累计。
import { describe, expect, it } from 'vitest'
import { buildBoxRows, buildPareto, buildStripPoints } from './TenantPortfolio.logic'

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

describe('buildStripPoints', () => {
  const groups = [
    { name: '一期', items: [{ v: 10000, tenant: 'A' }, { v: 1800000, tenant: 'B' }] },
    { name: '二期', items: [{ v: 5000, tenant: 'C' }] },
  ]
  it('x=组序±抖动(界内 ±0.16,组内首点居中),y=值/div,租户名透传', () => {
    const [g1, g2] = buildStripPoints(groups, 10000)
    expect(g1.map((p) => p.tenant)).toEqual(['A', 'B'])
    expect(g1.map((p) => p.y)).toEqual([1, 180])
    expect(g1[0].x).toBe(0)          // 首点正居中
    for (const p of g1) expect(Math.abs(p.x - 0)).toBeLessThanOrEqual(0.16)
    expect(g2[0].x).toBe(1)          // 单点组正对期区刻度
  })
  it('确定性:同输入两次调用产出全等(无随机数,渲染/快照稳定)', () => {
    expect(buildStripPoints(groups, 10000)).toEqual(buildStripPoints(groups, 10000))
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
