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
  tenantId: number
  tenantName: string
  balancePrev: number
  totalCollected: number
  note: string | null
  totalReceivable: number // derived
  balanceEnd: number      // derived
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
  tenantId: number
  balancePrev: number
  totalCollected: number
  note: string | null
}

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
}

export interface LedgerImportRequest {
  rows: LedgerImportRow[]
}
