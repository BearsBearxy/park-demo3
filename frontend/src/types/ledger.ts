// Ledger DTOs — shapes mirror backend records (spec §4.1/§4.2). JSON camelCase ⇄ Java record.
// 21 fee columns are flattened onto LedgerRowDTO/LedgerFooter as BigDecimal→number.

export interface CompanyDTO {
  id: number
  name: string
  short: string
  sortNo: number
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

// 导入 body(spec §4.1):每行 tenantName(按名解析 FK)+ 21 费用 camelCase。
export interface LedgerImportRow extends LedgerFees {
  tenantName: string
}

export interface LedgerImportRequest {
  rows: LedgerImportRow[]
}
