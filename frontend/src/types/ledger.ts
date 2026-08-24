// Ledger DTOs — shapes mirror backend records (spec §4.1/§4.2). JSON camelCase ⇄ Java record.
// 21 fee columns are flattened onto LedgerRowDTO/LedgerFooter as BigDecimal→number.

export interface CompanyDTO {
  id: number
  name: string
  short: string
  sortNo: number
}

// 年份门:有数据的年份 + 该年已录入月份数(台账/三大报表共用,镜像后端 YearMonthsDTO)
export interface YearMonthsDTO {
  year: number
  months: number
}

export interface MonthMeta {
  month: number
  recv: number
  coll: number
  tenants: number
  status: 'done' | 'current' | 'empty'
}

export interface LedgerOverviewDTO {
  companyName: string
  year: number
  monthsWithData: number
  ytdRecv: number
  avgRecv: number
  activeTenants: number
  months: MonthMeta[]
}

// 21 fee columns (order = spec §3.1). Shared by row + footer.
export interface LedgerFees {
  factoryRent: number
  factoryMgmtFee: number
  shopRent: number
  dormRent: number
  dormFacilitiesFee: number
  shopMgmtFee: number
  factoryInfraMaint: number
  shopInfraMaint: number
  dormInfraMaint: number
  elevatorMaint: number
  transformerMaint: number
  landUseTax: number
  networkFee: number
  accessCtrlMaint: number
  officeOtherFee: number
  dormOtherFee: number
  basicElectricity: number
  standardElectricity: number
  electricityMaint: number
  standardWater: number
  waterMaint: number
}

export interface LedgerRowDTO extends LedgerFees {
  id: number | null       // 行 id(服务端行必有;编辑态本地新增行为 null,保存后获得)
  tenantId: number | null // null = 未绑定档案(V105 软引用)
  tenantName: string      // 账面名快照,与档案名可不一致
  balancePrev: number
  totalCollected: number
  note: string | null
  totalReceivable: number // derived
  balanceEnd: number      // derived
  extraFees?: Record<string, number | null>  // 自定义列口袋(键=列固定id c_xxx,方案A;后端恒下发,本地新增行可缺省)
}

export interface LedgerFooter extends LedgerFees {
  balancePrev: number
  totalReceivable: number
  totalCollected: number
  balanceEnd: number
}

export interface LedgerMonthDTO {
  companyName: string
  year: number
  month: number
  prevMonth: number
  rows: LedgerRowDTO[]
  footer: LedgerFooter
}

// PUT save body (spec §4.2): derived columns omitted, backend recomputes.
export interface LedgerSaveRow extends LedgerFees {
  id?: number | null        // 既有行身份(未绑定行必带;绑定行可省走 tenantId)
  tenantId: number | null
  tenantName?: string       // 提供即改账面名快照(未绑定行改名后后端自动按新名配档)
  balancePrev: number
  totalCollected: number
  note: string | null
  extraFees?: Record<string, number | null> | null  // 非空=整包替换;缺省=不动
}

// 行稳定键:服务端行用 id;编辑态本地新增行(尚无 id)用 -tenantId 负数命名空间,保存后自然换正
export const ledgerRowKey = (r: { id?: number | null; tenantId?: number | null }): number =>
  r.id ?? -(r.tenantId ?? 0)

export interface BindResultDTO { bound: number; conflicts: number }

export interface LedgerSaveRequest {
  rows: LedgerSaveRow[]
}

// 导入 body:tenantName(按名解析 FK)+ 文件里出现的列。列级定向 upsert:
// 字段缺省(文件没这列)= 不动既有值;为 0(文件里是 '-')= 显式清零。
export interface LedgerImportRow extends Partial<LedgerFees> {
  tenantName: string
  balancePrev?: number
  totalCollected?: number
  note?: string
  extraFees?: Record<string, number | null>   // 自定义列:按键合并(键出现=覆盖含0;缺席=不动)
}

export interface LedgerImportRequest {
  rows: LedgerImportRow[]
}
