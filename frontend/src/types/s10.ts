// 附表10 销售收入 DTOs — 逐字对齐契约/后端 dto/S10*.java。JSON camelCase ⇄ Java record。
// 25 费用列 camelCase（顺序即列展示顺序，与后端种子完全一致）。
// 派生（行合计 total / 列合计 columnTotals / 总计 grandTotal）后端算好下发，前端编辑态自行即时重算；不落库。

// 25 费用列字段名（camelCase）— 仅类型用途，与 layout.ts 的 colId 一一对应。
export interface S10Fees {
  officeRent: number
  officeMgmtFee: number
  factoryRent: number
  factoryMgmtFee: number
  landRent: number
  shopRent: number
  shopMgmtFee: number
  dormRent: number
  dormFacilityFee: number
  infraOffice: number
  infraFactory: number
  infraShop: number
  infraDorm: number
  elevatorMaint: number
  transformerMaint: number
  landUseTax: number
  networkFee: number
  accessMaint: number
  otherFee: number
  elecBasic: number
  elecStd: number
  elecMaint: number
  waterStd: number
  waterMaint: number
  guaranteeRent: number
}

export type S10ColId = keyof S10Fees

export interface S10RecordDTO extends S10Fees {
  id: number
  tenantId: number | null
  tenantName: string
  phase: number
  profile: string
  note: string | null
  source: 'seed' | 'manual' | 'import'
  total: number   // 派生:25 列之和
}

// 年摘要（overview.summaries 元素）
export interface S10YearSummary {
  year: number
  recordedMonths: number
  tenantCount: number
}

export interface S10OverviewDTO {
  years: number[]
  currentYear: number
  currentMonth: number
  summaries: S10YearSummary[]
}

export interface S10MonthDTO {
  phase: number
  year: number
  month: number
  recorded: boolean
  rows: S10RecordDTO[]
  columnTotals: Record<string, number>   // colId → 列合计
  grandTotal: number
}

// POST /api/s10 body — 新增/upsert 一行（source 由后端定:manual）。25 费用列可空。
export interface S10RecordReq extends Partial<S10Fees> {
  tenantId?: number | null
  tenantName: string
  phase: number
  acctMonth: string   // YYYY-MM
  profile: string
  note?: string | null
}

export interface S10NoteReq {
  note: string | null
}
