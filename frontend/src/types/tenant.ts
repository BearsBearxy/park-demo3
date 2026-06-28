export interface TenantDTO {
  id: number; companyName: string; contactName: string; contactPhone: string
  businessType: string; status: number; categoryId: number | null; phase: number
  since: string | null; monthlyRent: number; leasedArea: number
  primaryBuilding: string | null; contractCount: number; remark?: string
}

export interface TenantSummaryDTO {
  tenantActive: number; occRate: number; monthlyRent: number; expiringTenants: number
}

export interface TenantCategoryDTO {
  id: number; name: string
}

export interface ContractHistoryDTO {
  contractNo: string; buildingName: string; floorInfo: string
  startDate: string; endDate: string; signDate: string
  monthlyRent: number; rentArea: number; status: string
}

export interface TenantDetailDTO {
  tenant: TenantDTO
  contracts: ContractHistoryDTO[]
}
