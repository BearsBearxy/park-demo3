import http from './index'

// paths per AnalysisController(/api/analysis/*,P3 只读聚合)。http unwraps Result envelope。
// 仅 3 个「一次拉全」端点;其余分析取数走既有 api/*(pnl/s10/pv/elec/charging/utilities/report/...)。

export interface AnalysisMonthsDTO {
  months: string[]                     // 各源 distinct 月份并集(YYYY-MM 升序)
  sources: Record<string, string[]>    // pnl/s10/ledger/pv/elec/charging/office/report → 各自月份
}

// s10 租户×月 slim 行:elec=elecBasic+elecStd+elecMaint;water=waterStd+waterMaint;total=25列Σ(元)
export interface AnalysisS10Row {
  acctMonth: string
  phase: number
  tenantId: number | null
  tenantName: string
  elec: number
  water: number
  total: number
}

// 台账 租户×公司×月 slim 行:receivable=21费Σ;balanceEnd=prev+recv−coll(元)
export interface AnalysisLedgerRow {
  companyId: number
  companyName: string
  year: number
  month: number
  tenantId: number | null
  tenantName: string
  balancePrev: number
  receivable: number
  collected: number
  balanceEnd: number
}

export const analysisApi = {
  months: (): Promise<AnalysisMonthsDTO> => http.get('/analysis/months'),
  s10TenantMonths: (): Promise<AnalysisS10Row[]> => http.get('/analysis/s10-tenant-months'),
  ledgerTenantMonths: (): Promise<AnalysisLedgerRow[]> => http.get('/analysis/ledger-tenant-months'),
}
