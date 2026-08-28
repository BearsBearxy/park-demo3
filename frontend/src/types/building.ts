export interface BuildingDTO {
  id: number; name: string; phase: number; phaseName: string; zone: string | null; kind: string
  floorCount: number; totalArea: number; rentableArea: number; status: number
  unitCount: number; occupiedCount: number; vacantCount: number
  expiringCount: number; reservedCount: number; leasedArea: number
  occRate: number | null; monthlyRent: number; tenantIds: number[]
  tenantBuildingArea: number   // 栋内在租合同建筑面积汇总(只读展示)
  remark?: string | null
}

// 在租面积显示口径(S15-b 对线定稿):后端 leasedArea 已=Σ被占单元合同派生面积
// (BuildingService.toDTO,unit.area 全 0 时代替口径),直接用;无回落项。
export const leasedAreaShow = (b: BuildingDTO): number => b.leasedArea ?? 0

// 出租率显示口径(METRIC-SOURCE-SPEC §3):后端分母缺失/分子>分母时返回 null,不再钳成 0% 或 100%。
// 前端一律「—」+ 说明原因;禁止 occRate + '%' 直拼 —— null 会拼出 "null%",
// 更糟的是拿去当 CSS width 会被浏览器丢弃退回 auto,画出一根满格条(读作「100% 且告警」)。
export const occPct = (r: number | null): string => r == null ? '—' : r + '%'
export const OCC_NULL_WHY = '缺可租面积数据'

export interface BuildingCreateReq {
  name: string; phase: number; floorCount: number
  totalArea: number; rentableArea: number
  perFloor: number; remark?: string; zone?: string | null
}

// 编辑专用:比 CreateReq 多 status、无 perFloor(单元仅创建时生成,编辑不增删单元)
export interface BuildingUpdateReq {
  name: string; phase: number; floorCount: number
  totalArea: number; rentableArea: number
  status: number; remark?: string; zone?: string | null
}

export interface BuildingSummaryDTO {
  buildingCount: number; stoppedCount: number; rentableArea: number
  occRate: number | null; vacantCount: number; unitCount: number
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
  // ─── S15-b 对线定稿(后端 UnitDTO 实名) ───
  derivedArea?: number | null        // 合同派生面积:绑定行Σ(÷绑定单元数),无绑定回退同类型行均摊(unit.area 全库 0)
  crossBuilding?: boolean | null     // 跨栋占用:占用合同主楼栋非本栋(经附加单元挂入)
  homeBuildingName?: string | null   // 跨栋占用合同的主楼栋名(展示用)
}

export interface BuildingDetailDTO {
  building: BuildingDTO
  units: UnitDTO[]
}
