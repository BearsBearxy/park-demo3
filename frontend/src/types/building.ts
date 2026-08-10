export interface BuildingDTO {
  id: number; name: string; phase: number; phaseName: string; kind: string
  floorCount: number; totalArea: number; rentableArea: number; status: number
  unitCount: number; occupiedCount: number; vacantCount: number
  expiringCount: number; reservedCount: number; leasedArea: number
  occRate: number; monthlyRent: number; tenantIds: number[]
  tenantBuildingArea: number   // 栋内在租合同建筑面积汇总(只读展示)
  // ─── S15 服务刀对齐点(DTO 草案,后端落地前可空;字段名以服务刀实际为准) ───
  contractRentArea?: number | null   // 栋内在租合同租赁面积汇总(合同派生;单元面积Σ恒0时的在租面积替代口径)
  remark?: string | null
}

// 在租面积显示口径(S15 §4):单元面积Σ(leasedArea)缺失/恒0 时回落合同派生汇总;
// 服务刀字段名若有出入,只需改这里与上面草案两处
export const leasedAreaShow = (b: BuildingDTO): number =>
  b.leasedArea > 0 ? b.leasedArea : (b.contractRentArea ?? 0)

export interface BuildingCreateReq {
  name: string; phase: number; floorCount: number
  totalArea: number; rentableArea: number
  perFloor: number; remark?: string
}

// 编辑专用:比 CreateReq 多 status、无 perFloor(单元仅创建时生成,编辑不增删单元)
export interface BuildingUpdateReq {
  name: string; phase: number; floorCount: number
  totalArea: number; rentableArea: number
  status: number; remark?: string
}

export interface BuildingSummaryDTO {
  buildingCount: number; stoppedCount: number; rentableArea: number
  occRate: number; vacantCount: number; unitCount: number
}

// 单元新增:unitNo 缺省后端自动生成(floor*100+序号);area 缺省 0
export interface UnitCreateReq {
  floor: number; unitNo?: string; area?: number
}

// 单元编辑(全量 PUT)
export interface UnitUpdateReq {
  floor: number; unitNo: string; area: number
}

export interface UnitDTO {
  id: number; floor: number; unitNo: string; area: number
  status: 'occupied' | 'expiring' | 'reserved' | 'vacant'
  tenantId: number | null; tenantName: string | null; companyName: string | null
  businessType: string | null; contractNo: string | null; monthlyRent: number | null
  // ─── S15 服务刀对齐点(DTO 草案,后端落地前可空;字段名以服务刀实际为准) ───
  contractRentArea?: number | null   // 占用合同租赁面积(整约口径,合同派生;单元未录面积时的展示回落)
  crossBuilding?: boolean | null     // 跨栋占用:占用合同主楼栋非本栋(经附加单元挂入)
  homeBuildingName?: string | null   // 跨栋占用合同的主楼栋名(展示用)
}

export interface BuildingDetailDTO {
  building: BuildingDTO
  units: UnitDTO[]
}
