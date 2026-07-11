// park.logic.ts — ParkView v2 数据变换纯函数(铁律⑦:屏内变换抽出单测)。
// 口径与 v1 完全一致(数值锚点不变):有效合同 = active/expiring;楼栋行按月租降序;
// 分期聚合剔除无合同分期。金额单位:rentWan = 万元,avgRent = 元。
// 结构化最小类型(BuildingDTO/ContractDTO 为其超集),便于单测小夹具。

// 散点对数轴数据准备(spec §T2)与 tenant-energy 共用一套实现 → 同目录复用再导出(单测在 TenantEnergy.logic.spec.ts)
export { splitLogPoints } from './TenantEnergy.logic'

export interface BuildingLike { id: number; name: string; phase: number; phaseName: string }
export interface ContractLike { buildingId: number; tenantId: number; monthlyRent: number; status: string }

export interface BRow {
  id: number; name: string; phase: number; phaseName: string
  contracts: number; tenants: number; rentWan: number; avgRent: number
}
export interface PRow { phase: number; name: string; buildings: number; contracts: number; tenants: number; rentWan: number }

/** 有效合同 = active/expiring(v1 同款;draft/terminated 不计)。 */
export function liveContracts<T extends ContractLike>(contracts: T[]): T[] {
  return contracts.filter((c) => c.status === 'active' || c.status === 'expiring')
}

/** 楼栋行:合同数 / 去重租户数 / 月租合计(万)/ 户均月租(元),按月租降序(v1 同款)。 */
export function buildBuildingRows(buildings: BuildingLike[], live: ContractLike[]): BRow[] {
  return buildings.map((b) => {
    const cs = live.filter((c) => c.buildingId === b.id)
    const rent = cs.reduce((s, c) => s + c.monthlyRent, 0)
    return {
      id: b.id, name: b.name, phase: b.phase, phaseName: b.phaseName,
      contracts: cs.length, tenants: new Set(cs.map((c) => c.tenantId)).size,
      rentWan: rent / 10000, avgRent: cs.length ? rent / cs.length : 0,
    }
  }).sort((a, b) => b.rentWan - a.rentWan)
}

/** 分期聚合(期区结构环/散点图例;v1 同款,无合同分期剔除,按期号升序)。 */
export function buildPhaseRows(buildings: BuildingLike[], live: ContractLike[]): PRow[] {
  const byPhase = new Map<number, PRow>()
  for (const b of buildings) {
    if (!byPhase.has(b.phase)) byPhase.set(b.phase, { phase: b.phase, name: b.phaseName, buildings: 0, contracts: 0, tenants: 0, rentWan: 0 })
    byPhase.get(b.phase)!.buildings++
  }
  for (const p of byPhase.values()) {
    const ids = new Set(buildings.filter((b) => b.phase === p.phase).map((b) => b.id))
    const cs = live.filter((c) => ids.has(c.buildingId))
    p.contracts = cs.length
    p.tenants = new Set(cs.map((c) => c.tenantId)).size
    p.rentWan = cs.reduce((s, c) => s + c.monthlyRent, 0) / 10000
  }
  return [...byPhase.values()].filter((p) => p.contracts > 0).sort((a, b) => a.phase - b.phase)
}
