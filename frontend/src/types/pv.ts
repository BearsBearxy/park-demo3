// 附表6 光伏发电 DTOs — 逐字对齐后端 dto/Pv*.java(spec §4)。
// JSON camelCase ⇄ Java record;short 线格式为 "short"(@JsonProperty),非 shortName。
// 派生 gen/fee 后端读时算好下发,前端不重算、不落库。

export interface PvPhaseDTO {
  id: string          // p1 / p2 / p3
  name: string
  short: string       // 2 字简称(@JsonProperty("short"))
  online: string | null  // YYYY-MM 并网月
}

// 年份卡元数据(overview.years 元素)
export interface YearMeta {
  year: number
  hasData: boolean
  totalFee: number    // 该年 Σfee
  count: number       // 该年记录数
}

export interface PvOverviewDTO {
  currentYear: number // 最新年 = maxDataYear
  years: YearMeta[]   // 覆盖 [2024 .. maxDataYear+1]
}

export interface PvRecordDTO {
  id: number
  phase: string       // phase id
  phaseName: string   // join 派生
  acctMonth: string   // YYYY-MM 记账月
  occurMonth: string  // YYYY-MM 发生月
  selfKwh: number     // 自消纳电量
  selfAmt: number     // 自消纳金额
  gridKwh: number     // 上网电量
  gridAmt: number     // 上网收益
  gen: number         // 派生:selfKwh + gridKwh
  fee: number         // 派生:selfAmt + gridAmt
  note: string | null
  source: 'seed' | 'manual'
}

export interface PvTotal {
  gen: number
  fee: number
  selfKwh: number
  selfAmt: number
  gridKwh: number
  gridAmt: number
}

export interface PvYearDTO {
  year: number
  phases: PvPhaseDTO[]
  rows: PvRecordDTO[]
  total: PvTotal
}

// POST /records body — 新增记账(source=manual,派生列后端算)
export interface PvRecordReq {
  phase: string
  acctMonth: string
  occurMonth: string
  selfKwh: number
  selfAmt: number
  gridKwh: number
  gridAmt: number
  note?: string | null
}
