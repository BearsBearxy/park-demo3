export interface BuildingDTO {
  id: number; name: string; phase: number; phaseName: string; kind: string
  floorCount: number; totalArea: number; rentableArea: number; status: number
  unitCount: number; occupiedCount: number; vacantCount: number
  expiringCount: number; reservedCount: number; leasedArea: number
  occRate: number; monthlyRent: number; tenantIds: number[]
  remark?: string | null
}

export interface BuildingSummaryDTO {
  buildingCount: number; stoppedCount: number; rentableArea: number
  occRate: number; vacantCount: number; unitCount: number
}

export interface UnitDTO {
  id: number; floor: number; unitNo: string; area: number
  status: 'occupied' | 'expiring' | 'reserved' | 'vacant'
  tenantId: number | null; tenantName: string | null; companyName: string | null
  businessType: string | null; contractNo: string | null; monthlyRent: number | null
}

export interface BuildingDetailDTO {
  building: BuildingDTO
  units: UnitDTO[]
}
