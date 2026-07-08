// park.logic.spec.ts — ParkView v2 纯函数单测(有效合同过滤/楼栋聚合/去重/排序/分期聚合)。
import { describe, expect, it } from 'vitest'
import { buildBuildingRows, buildPhaseRows, liveContracts, type BuildingLike, type ContractLike } from './park.logic'

const B: BuildingLike[] = [
  { id: 1, name: 'A栋', phase: 1, phaseName: '一期' },
  { id: 2, name: 'B栋', phase: 2, phaseName: '二期' },
  { id: 3, name: 'C栋', phase: 3, phaseName: '三期' },   // 无合同分期 → phases 剔除
]
const C: ContractLike[] = [
  { buildingId: 1, tenantId: 10, monthlyRent: 10000, status: 'active' },
  { buildingId: 1, tenantId: 10, monthlyRent: 5000, status: 'expiring' },   // 同租户两份 → 去重 1 户
  { buildingId: 2, tenantId: 20, monthlyRent: 20000, status: 'active' },
  { buildingId: 2, tenantId: 30, monthlyRent: 99999, status: 'terminated' }, // 非有效 → 全部口径剔除
  { buildingId: 2, tenantId: 40, monthlyRent: 88888, status: 'draft' },
]

describe('park.logic', () => {
  it('liveContracts:仅 active/expiring', () => {
    expect(liveContracts(C).map((c) => c.tenantId)).toEqual([10, 10, 20])
  })

  it('buildBuildingRows:月租合计(万)/合同数/去重租户/户均,按月租降序', () => {
    const rows = buildBuildingRows(B, liveContracts(C))
    expect(rows.map((r) => r.name)).toEqual(['B栋', 'A栋', 'C栋'])   // 2.0 > 1.5 > 0
    const a = rows.find((r) => r.name === 'A栋')!
    expect(a.rentWan).toBeCloseTo(1.5, 10)
    expect(a.contracts).toBe(2)
    expect(a.tenants).toBe(1)                  // 同租户两合同去重
    expect(a.avgRent).toBeCloseTo(7500, 10)
    expect(rows.find((r) => r.name === 'C栋')!.avgRent).toBe(0)   // 无合同不除零
  })

  it('buildPhaseRows:按分期聚合,无合同分期剔除,期号升序', () => {
    const ps = buildPhaseRows(B, liveContracts(C))
    expect(ps.map((p) => p.phase)).toEqual([1, 2])
    expect(ps[0]).toMatchObject({ name: '一期', buildings: 1, contracts: 2, tenants: 1 })
    expect(ps[0].rentWan).toBeCloseTo(1.5, 10)
    expect(ps[1].rentWan).toBeCloseTo(2.0, 10)
  })
})
