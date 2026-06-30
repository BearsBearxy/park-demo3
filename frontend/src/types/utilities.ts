// 附表13/14 办公·三期水电 DTOs — 逐字对齐后端 dto/Office*.java(同一模型两实例,schedule_no 13/14)。
// JSON camelCase ⇄ Java record。派生 elecAmt=elecQty×elecPrice / waterAmt=waterQty×waterPrice /
// total=elecAmt+waterAmt 后端读时算好下发,前端不重算、不落库。

// 年份卡元数据(overview.years 元素;合并 13+14 两子表)
export interface OfficeYearMeta {
  year: number
  hasData: boolean
  totalFee: number  // 该年 13+14 Σ(电费金额+水费金额)
  count: number     // 该年 13+14 行数合计
}

export interface OfficeOverviewDTO {
  currentYear: number       // 最新年 = maxDataYear
  years: OfficeYearMeta[]    // 覆盖 [min(2024,minData) .. maxDataYear+1]
}

export interface OfficeRecordDTO {
  id: number
  scheduleNo: number  // 13 办公水电 / 14 三期水电
  acctMonth: string   // YYYY-MM 记账月
  belongMonth: string // YYYY-MM 所属月
  elecQty: number     // 用电量(千瓦)
  elecPrice: number   // 基准用电单价(元/千瓦)
  elecAmt: number     // 派生:elecQty × elecPrice
  waterQty: number    // 用水量(吨)
  waterPrice: number  // 基准用水单价(元/吨)
  waterAmt: number    // 派生:waterQty × waterPrice
  total: number       // 派生:elecAmt + waterAmt
  note: string | null
  source: 'seed' | 'manual'
}

export interface OfficeTotal {
  elecQty: number
  elecAmt: number
  waterQty: number
  waterAmt: number
  total: number
}

export interface OfficeYearDTO {
  year: number
  scheduleNo: number
  rows: OfficeRecordDTO[]
  total: OfficeTotal
}

// POST /{no}/import body 行 — 行身份=月份字符串(tenantName,如 "1月"/"01"/"2025-01");派生不传。
// 对齐后端 OfficeImportRequest.Row。
export interface OfficeImportRow {
  tenantName: string   // 月份字符串
  elecQty?: number
  elecPrice?: number
  waterQty?: number
  waterPrice?: number
}

export interface OfficeImportRequest {
  rows: OfficeImportRow[]
}

// POST /records body — 新增记账(source=manual,派生列后端算)
export interface OfficeRecordReq {
  scheduleNo: number
  acctMonth: string
  belongMonth: string
  elecQty: number
  elecPrice: number
  waterQty: number
  waterPrice: number
  note?: string | null
}
