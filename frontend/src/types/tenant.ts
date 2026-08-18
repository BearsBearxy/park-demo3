// 可空三项(contactName/contactPhone/phase):V1__schema.sql 建表就是 NULL,后端 TenantDTO 是装箱
// String/Integer,Jackson 原样序列化 null —— 前端以前声明非空,消费方一律漏兜底
export interface TenantDTO {
  id: number; companyName: string; contactName: string | null; contactPhone: string | null
  businessType: string; status: number; categoryId: number | null; phase: number | null
  since: string | null; monthlyRent: number; leasedArea: number
  primaryBuilding: string | null; contractCount: number; remark?: string
  parentId: number | null; parentName: string | null
  aliases?: string | null   // 别名,逗号分隔(V86):worksheet老板名/曾用名,导入与挂号匹配同权
}

// occRate 转发自 BuildingService.summary(),同样可空(METRIC-SOURCE-SPEC §3)
export interface TenantSummaryDTO {
  tenantActive: number; occRate: number | null; monthlyRent: number; expiringTenants: number
}

export interface TenantCategoryDTO {
  id: number; name: string
}

/** POST /api/tenants 入参(必填=名称+业务类型,其余可空) */
export interface TenantCreateReq {
  companyName: string; businessType: string
  contactName?: string; contactPhone?: string
  categoryId?: number | null; phase?: number | null
  since?: string | null; remark?: string
  parentId?: number | null   // 一级子租户关联的主租户(如「王柱宿舍」→「王柱」)
  aliases?: string | null    // 别名,逗号分隔(V86)
}

/** PUT /api/tenants/{id} 入参 = CreateReq 全量字段 + status(1在租/2已退租/0黑名单) */
export interface TenantUpdateReq extends TenantCreateReq {
  status: number
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
