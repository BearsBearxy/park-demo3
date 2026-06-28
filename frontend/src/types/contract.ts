export interface ContractDTO {
  id: number; contractNo: string
  tenantId: number; tenantName: string
  buildingId: number; buildingName: string; floorInfo: string
  rentArea: number; monthlyRent: number; deposit: number
  startDate: string | null; endDate: string | null; signDate: string | null
  status: string   // 'draft'|'active'|'expiring'|'expired'|'terminated'
  termMonths: number; daysToEnd: number | null
  remark: string | null
}

export interface ContractSummaryDTO {
  total: number; contractActive: number; contractExpiring: number
  contractDraft: number; monthlyRent: number
}

export interface ContractDetailDTO {
  contract: ContractDTO
  tenant: { companyName: string; contactName: string; contactPhone: string; businessType: string; status: number }
}
