// 免租期区间(F2):后端 contract.rent_free 存 JSON 字符串,api 层进出统一转数组(见 api/contract.ts)
export interface RentFreePeriod { start: string; end: string; note?: string }

// 建筑面积→租赁面积换算系数(F1,全园区默认公摊口径:租赁面积=建筑面积÷0.8)。
// 唯一定义点:合同录入联动与分析层面积转换卡共用,禁止另处硬编码。
export const RENT_AREA_FACTOR = 0.8

// 用电分类(V51 电费签约要素,裁定④):KVA 仅大工业可填
export const POWER_TYPE_LABEL: Record<string, string> = {
  industrial: '大工业', commercial: '商业', resident: '居民',
}

export interface ContractDTO {
  id: number; contractNo: string
  tenantId: number; tenantName: string
  buildingId: number; buildingName: string; unitId: number | null; floorInfo: string
  rentArea: number; monthlyRent: number; deposit: number
  buildingArea?: number | null   // 建筑面积㎡(可空;清空保存后端自动=租赁面积×0.8 重算,裁定①)
  unitPrice?: number | null      // 租金单价 元/㎡/月(五费项之一,V51 方案A 宽表=唯一事实源)
  // V51 五费项固定字段+电费签约要素(空=待录,BILL-FORWARD 刀1 二次返工裁定③④)
  mgmtFeePrice?: number | null   // 管理费单价 元/㎡/月
  infraFeePrice?: number | null  // 基础维护单价 元/㎡/月
  elevatorCount?: number | null  // 货梯数N(规则 N×150×L 元/月,首层不算)
  elevatorFloors?: number | null // 计费层数L(已扣首层)
  elevatorFee?: number | null    // 电梯覆盖月额(优先于规则)
  transformerFee?: number | null // 变压器覆盖月额(规则:KVA<150含未填=159,≥150=1元/KVA/月)
  powerType?: string | null      // industrial|commercial|resident
  kva?: number | null            // 配电容量,仅大工业(人工补录)
  rentFree?: RentFreePeriod[] | null   // 免租期(api 层已解析,坏数据按 null)
  startDate: string | null; endDate: string | null; signDate: string | null
  termText?: string | null       // 期限原文(V55,原样存原样显;多段/相对表述的唯一事实源)
  termType?: string | null       // explicit|multiple|relative|none
  tierPriceNote?: string | null  // 分年阶梯价说明(留档,不参与计费)
  status: string   // 展示态派生桶 'draft'|'active'|'expiring'|'expired'|'terminated'|'renewed'(后端 effectiveStatus,§5.1)
  parentContractId?: number | null   // 续签链上一期 id(read-only,V54;前端据此聚合链/取叶子)
  linkType?: 'new' | 'renew' | 'escalation' | null   // V57 相对父期链接类型(ESCALATION-SPLIT-SPEC §1),递增段显徽标
  kind?: 'normal' | 'master_lease' | null            // V59 合同性质:整体承租不计出租率/KPI,列表显「整租」徽标
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
  // V51 五费项+电费要素(皆可空=待录)
  mgmtFeePrice?: number | null
  infraFeePrice?: number | null
  elevatorCount?: number | null
  elevatorFloors?: number | null
  elevatorFee?: number | null
  transformerFee?: number | null
  powerType?: string | null
  kva?: number | null
  startDate?: string | null
  endDate?: string | null
  signDate?: string | null
  status: string
  remark?: string | null
  rentFree?: RentFreePeriod[] | null
  billingLines?: BillingLineReq[] | null   // 计费行整组替换(单一编辑随合同 PUT);null=不动,空列表=清空
  extraUnitIds?: number[] | null           // 附加单元(V58 contract_unit,主单元在 unitId);整组替换同上
  // V55 期限原文三件套:后端早已支持,前端此前漏传(CONTRACT-CARD-V2-SPEC §6)
  termText?: string | null
  termType?: string | null         // explicit|multiple|relative|none
  tierPriceNote?: string | null
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
  billingLines: BillingLineDTO[]   // 计费行,后端按 location,seq 排序(BILL-FORWARD 刀1 §1.7)
  extraUnitIds: number[]           // 附加单元(V58,主单元在 contract.unitId);编辑回带
}
// 阶梯期类型已删(ESCALATION-SPLIT-SPEC):阶梯语义由 escalation 链表达

// ─── 计费行批量导入(BILL-FORWARD 刀1 三次返工 §1.1/§1.7,契约逐字对齐后端) ─────────
// 停止收敛:每费项行 1:1 出一条计费行(位置分组 + 受控费项枚举),不再折进五标量。
export type FeeKey = 'rent_factory' | 'rent_office' | 'rent_dorm' | 'rent_shop' | 'rent_land'
  | 'mgmt' | 'infra' | 'elevator' | 'transformer' | 'access' | 'network' | 'land_tax' | 'other'
export type BillMode = 'per_sqm_month' | 'per_month' | 'per_room_year' | 'per_room_month' | 'per_kva_month'

// 读 DTO(§1.7/§7.2:GET /contracts/{id} 含 billingLines,按 propertyType,location,seq 排序)
export interface BillingLineDTO {
  id: number; contractId: number
  propertyType?: PropertyType | null   // 段类型 factory|office|dorm|shop|land(V54,段内每行冗余)
  location: string
  feeKey: FeeKey; feeName?: string | null   // feeName=feeLabel(propertyType,feeKey) 上下文回显
  area?: number | null; unitPrice?: number | null; coeff?: number | null
  roomCount?: number | null; billMode?: string | null
  amountOverride?: number | null; seq?: number | null; source?: string | null
}
// 写 Req(§1.7:内嵌 ContractCreateReq,单一编辑随合同整体 PUT 整组替换)
export interface BillingLineReq {
  id?: number | null             // null=新增
  propertyType?: PropertyType | null   // 段类型(V54);非空则后端钉死校验 feeKey∈该类型允许集,越界 400
  location: string
  feeKey: FeeKey                 // ∈ FeeKey
  area?: number | null
  unitPrice?: number | null
  coeff?: number | null          // null→1
  roomCount?: number | null
  billMode?: string | null       // null→按 feeKey 默认
  amountOverride?: number | null
  seq?: number | null
}
// 导入 Line(§1.7:FeeRow 1:1;对应后端 BillingLinesImportRequest.Row.Line)
export interface BillingLineImport {
  location: string
  feeKey: FeeKey
  area?: number | null
  unitPrice?: number | null
  coeff?: number | null          // null→1
  roomCount?: number | null
  billMode?: string | null       // null→按 feeKey 默认
  amountOverride?: number | null
  note?: string | null
}
// 导入 Row(§1.7:contractId 已由前端完成匹配/multiPick 路由)
export interface BillingLinesImportRow {
  contractId: number
  lines: BillingLineImport[]
}

// ─── 计费行呈现/派生助手(前后端共享契约,镜像后端 ContractService) ──────────
// 下拉/默认行序:13 枚举定序,前 5 项=单位置户默认预置标准行前缀(§1.3 红线③)。
export const FEE_KEYS: readonly FeeKey[] = [
  'rent_factory', 'rent_office', 'rent_dorm', 'rent_shop', 'rent_land',
  'mgmt', 'infra', 'elevator', 'transformer', 'access', 'network', 'land_tax', 'other',
]
export const RENT_KEYS: readonly FeeKey[] = ['rent_factory', 'rent_office', 'rent_dorm', 'rent_shop', 'rent_land']
export const FEE_NAME: Record<FeeKey, string> = {
  rent_factory: '厂房租金', rent_office: '办公室租金', rent_dorm: '宿舍租金', rent_shop: '商铺租金', rent_land: '空地租金',
  mgmt: '企业管理服务费', infra: '基础设施维护费', elevator: '电梯维护费', transformer: '变压器维护费',
  access: '门禁设施维护费', network: '网络通讯费', land_tax: '土地使用税', other: '其他费用',
}
// feeKey → 默认计费方式(镜像后端 ContractService.defaultBillMode §1.1)
export function defaultBillMode(k: FeeKey): BillMode {
  switch (k) {
    case 'access': return 'per_room_year'
    case 'network': return 'per_room_month'
    case 'elevator': case 'transformer': case 'land_tax': case 'other': return 'per_month'
    default: return 'per_sqm_month'   // rent_* + mgmt + infra
  }
}
export const isRentKey = (k: FeeKey): boolean => RENT_KEYS.includes(k)

// ─── 类型钉死费用组(CONTRACT-CARD-SPEC §1/§7.1,2026-07-24 用户拍板,唯一事实源) ──────
// 选物业类型 → 钉死费用项自动出现(不可删费用名);条件项勾选才出现;land_tax 全类型可选。
// 镜像后端 ContractService.ALLOWED_FEES(= PINNED ∪ COND ∪ OPTIONAL);越界后端 400。
export type PropertyType = 'factory' | 'office' | 'dorm' | 'shop' | 'land'
export const PROPERTY_TYPES: readonly PropertyType[] = ['factory', 'office', 'dorm', 'shop', 'land']
export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  factory: '厂房', office: '办公室', dorm: '宿舍', shop: '商铺', land: '空地',
}
// 钉死费用项(必现,不可删):录入即插入,行序固定
export const PINNED_FEES: Record<PropertyType, FeeKey[]> = {
  factory: ['rent_factory', 'mgmt', 'infra'],
  office:  ['rent_office', 'mgmt'],                 // 办公室不含基础设施维护费
  dorm:    ['rent_dorm', 'infra', 'access', 'network'],
  shop:    ['rent_shop', 'infra', 'mgmt'],
  land:    ['rent_land'],
}
// 条件费用项(段内勾选才落行,填月额;首层无梯=不勾=不出现)
export const COND_FEES: Record<PropertyType, FeeKey[]> = {
  factory: ['elevator', 'transformer'],
  office:  ['elevator', 'transformer'],
  dorm:    [],
  shop:    ['transformer'],
  land:    [],
}
// 全类型可选(土地使用税)
export const OPTIONAL_FEES: readonly FeeKey[] = ['land_tax']
// 该段类型的租金 fee_key(建筑类租金计入租赁面积;land 为空地租金单列)
export const RENT_KEY_OF: Record<PropertyType, FeeKey> = {
  factory: 'rent_factory', office: 'rent_office', dorm: 'rent_dorm', shop: 'rent_shop', land: 'rent_land',
}
// 建筑类租金(计入租赁面积;rent_land 空地租金单列不入,2026-07-24 面积裁定)
export const BUILDING_RENT_KEYS: readonly FeeKey[] = ['rent_factory', 'rent_office', 'rent_dorm', 'rent_shop']

// 上下文显示名(§7.2,镜像后端 feeLabel):mgmt/infra 随段类型加前缀,其余同 FEE_NAME。
export function feeLabel(pt: PropertyType | null | undefined, key: FeeKey): string {
  if (key === 'mgmt' || key === 'infra') {
    const prefix = pt ? PROPERTY_TYPE_LABEL[pt] : ''
    return prefix + (key === 'mgmt' ? '企业管理服务费' : '基础设施维护费')
  }
  return FEE_NAME[key]
}
// 遗留行(propertyType 空)按租金 fee_key 反推段类型;非租金行兜底 factory(与后端回填口径同)。
export function inferPropertyType(feeKey: FeeKey): PropertyType {
  switch (feeKey) {
    case 'rent_office': return 'office'
    case 'rent_dorm':   return 'dorm'
    case 'rent_shop':   return 'shop'
    case 'rent_land':   return 'land'
    default:            return 'factory'
  }
}
// 新增段的行预置默认单价(§1.3:门禁 100/网络 50,其余待填)
export function pinnedDefaultUnitPrice(key: FeeKey): number | null {
  if (key === 'access') return 100
  if (key === 'network') return 50
  return null
}
const round2 = (n: number): number => Math.round(n * 100) / 100
// 月单价只读派生(镜像后端计费公式 §1.1);缺参数返回 null=待录。per_kva 取 contract.kva。
type LineCalc = Pick<BillingLineReq, 'feeKey' | 'billMode' | 'area' | 'unitPrice' | 'coeff' | 'roomCount' | 'amountOverride'>
export function lineMonthly(l: LineCalc, kva?: number | null): number | null {
  const num = (v: number | null | undefined): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null)
  const mode = l.billMode || defaultBillMode(l.feeKey)
  switch (mode) {
    case 'per_sqm_month': { const a = num(l.area), u = num(l.unitPrice); return a == null || u == null ? null : round2(a * u * (num(l.coeff) ?? 1)) }
    case 'per_room_year': { const u = num(l.unitPrice), r = num(l.roomCount); return u == null || r == null ? null : round2(u * r / 12) }
    case 'per_room_month': { const u = num(l.unitPrice), r = num(l.roomCount); return u == null || r == null ? null : round2(u * r) }
    case 'per_kva_month': { const k = num(kva); return k == null ? null : round2(k) }
    default: return num(l.amountOverride)   // per_month
  }
}
