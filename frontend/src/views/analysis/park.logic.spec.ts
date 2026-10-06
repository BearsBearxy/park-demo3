// park.logic.spec.ts — ParkView v2 纯函数单测(有效合同过滤/楼栋聚合/去重/排序/分期聚合)。
import { describe, expect, it } from 'vitest'
import { buildBuildingRows, buildPhaseRows, crossBuildings, liveContracts, unitOcc, vacantByFloor, type BuildingLike, type ContractLike } from './park.logic'
import { floorRun } from '@/components/ana/anaSentence'

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

  // 2026-10 改稿:单元一栏、主卡参照「有单元租出却没有这栋的在租合同」、点进一栋的楼层读数
  it('unitOcc:租出 = 单元数 − 空单元(临期、预定都算租出)', () => {
    expect(unitOcc({ id: 1, unitCount: 59, vacantCount: 37 })).toBe(22)
    expect(unitOcc({ id: 2, unitCount: 0, vacantCount: 0 })).toBe(0)
  })

  it('crossBuildings:没有在租合同、单元却租出了的楼才点名,带租出个数', () => {
    const rows = [
      { id: 1, name: 'A栋', contracts: 3 },   // 有合同 → 不点名
      { id: 2, name: '空地', contracts: 0 },  // 无合同、2 个单元租出 → 点名
      { id: 3, name: 'C栋', contracts: 0 },   // 无合同、单元全空 → 不点名
      { id: 4, name: '保障房', contracts: 0 }, // 没建单元(不在 map 里)→ 不点名
    ]
    const byId = new Map([
      [1, { id: 1, unitCount: 10, vacantCount: 4 }],
      [2, { id: 2, unitCount: 2, vacantCount: 0 }],
      [3, { id: 3, unitCount: 14, vacantCount: 14 }],
    ])
    expect(crossBuildings(rows, byId)).toEqual([{ name: '空地', n: 2 }])
  })

  it('vacantByFloor:1..顶层全列,没建单元的层按 0;顶层取层数与单元最高层的大者', () => {
    const units = [
      { floor: 1, status: 'occupied' }, { floor: 3, status: 'vacant' }, { floor: 3, status: 'vacant' },
      { floor: 4, status: 'vacant' }, { floor: 4, status: 'expiring' }, { floor: 6, status: 'vacant' },
    ]
    expect(vacantByFloor(5, units)).toEqual([1, 2, 3, 4, 5, 6].map((floor) => ({ floor, n: [0, 0, 2, 1, 0, 1][floor - 1] })))
    expect(vacantByFloor(0, [])).toEqual([{ floor: 1, n: 0 }])
    // 接上句型库:4 个空单元里 3 个在 3F、4F(第 5 层没建单元也算进楼层段,不跳)
    expect(floorRun({ what: '空单元', floors: vacantByFloor(6, units) })?.text).toBe('空单元的 4 个里 3 个在 3F、4F')
  })
})
