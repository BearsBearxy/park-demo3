// 免租期区间(F2):后端 contract.rent_free 存 JSON 字符串,api 层进出统一转数组(见 api/contract.ts)
export interface RentFreePeriod { start: string; end: string; note?: string }

// 建筑面积→租赁面积换算系数(F1,全园区默认公摊口径:租赁面积=建筑面积÷0.8)。
// 唯一定义点:合同录入联动与分析层面积转换卡共用,禁止另处硬编码。
export const RENT_AREA_FACTOR = 0.8

export interface ContractDTO {
  id: number; contractNo: string
  tenantId: number; tenantName: string
  buildingId: number; buildingName: string; unitId: number | null; floorInfo: string
  rentArea: number; monthlyRent: number; deposit: number
  buildingArea?: number | null   // 建筑面积㎡(V33,存量留空不推测)
  unitPrice?: number | null      // 租金单价 元/㎡/月(V33,存量留空)
  rentFree?: RentFreePeriod[] | null   // 免租期(api 层已解析,坏数据按 null)
  startDate: string | null; endDate: string | null; signDate: string | null
  status: string   // 'draft'|'active'|'expiring'|'expired'|'terminated'
  termMonths: number; daysToEnd: number | null
  remark: string | null
}

export interface ContractCreateReq {
  contractNo: string
  tenantId: number
  buildingId: number
  unitId?: number | null
  buildingArea?: number | null
  rentArea?: number
  unitPrice?: number | null
  monthlyRent?: number
  deposit?: number
  startDate?: string | null
  endDate?: string | null
  signDate?: string | null
  status: string
  remark?: string | null
  rentFree?: RentFreePeriod[] | null
}

export interface ContractRenewReq {
  contractNo: string
  startDate?: string | null
  endDate?: string | null
  signDate?: string | null
  monthlyRent?: number | null   // 空=继承旧合同
  deposit?: number | null
  rentArea?: number | null
}

export interface ContractSummaryDTO {
  total: number; contractActive: number; contractExpiring: number
  contractDraft: number; monthlyRent: number
}

export interface ContractDetailDTO {
  contract: ContractDTO
  tenant: { companyName: string; contactName: string; contactPhone: string; businessType: string; status: number }
}
