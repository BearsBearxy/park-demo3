// 附表10 销售收入 DTOs — 逐字对齐契约/后端 dto/S10*.java。JSON camelCase ⇄ Java record。
// 25 费用列 camelCase（顺序即列展示顺序，与后端种子完全一致）。
// 派生（行合计 total / 列合计 columnTotals / 总计 grandTotal）后端算好下发，前端编辑态自行即时重算；不落库。
import type { ArchivedCol } from './book'

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
  total: number   // 派生:25 列 + 自定义列之和
  extraFees?: Record<string, number | null>  // 自定义列口袋(键=列固定id c_xxx,方案A;后端恒下发,本地新增行可缺省)
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
  archivedCols?: ArchivedCol[]           // 归档列(spec §2):台账同款,两屏同做
}

// 年聚合（镜像后端 S10YearSummaryDTO,供损益附表派生）:phase(1-4) → colId → 长度 12 月Σ
//（该月无行=null;全零列不输出;无数据年 phases 空）。
export interface S10YearSummaryDTO {
  year: number
  phases: Record<number, Record<string, (number | null)[]>>
}

// POST /api/s10 body — 新增/upsert 一行（source 由后端定:manual）。25 费用列可空。
export interface S10RecordReq extends Partial<S10Fees> {
  id?: number                 // 非空=按行更新(允许改名,修「改名 upsert 复制一行」老坑);空=按槽+名 upsert
  tenantId?: number | null
  tenantName: string
  phase: number
  acctMonth: string   // YYYY-MM
  profile: string
  note?: string | null
  extraFees?: Record<string, number | null> | null  // 非空=整包替换;缺省=不动
}

export interface S10NoteReq {
  note: string | null
}

// 导入 body(spec §4.2):phase + acctMonth(YYYY-MM)+ 每行 tenantName/profile + 25 费用 camelCase。
export interface S10ImportRow extends Partial<S10Fees> {
  tenantName: string
  profile: string
  extraFees?: Record<string, number | null>   // 自定义列:未知 id 该行报错
}

export interface S10ImportRequest {
  phase: number
  acctMonth: string   // YYYY-MM
  rows: S10ImportRow[]
}
