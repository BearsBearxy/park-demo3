// 附表7/8 充电桩 DTOs — 逐字对齐后端 dto/Charging*.java(同一模型两实例,schedule_no 7/8)。
// JSON camelCase ⇄ Java record;cat 的简称线格式为 "short"(@JsonProperty),非 shortName。
// 派生 profit = fee - cost 后端读时算好下发,前端不重算、不落库。

export interface ChargingCatDTO {
  catId: string       // dc/ac/shed/smart
  name: string
  short: string       // 简称(@JsonProperty("short"))
  tint: string | null // slate/blue/cyan 色点名
}

// 年份卡元数据(overview.years 元素)
export interface ChargingYearMeta {
  year: number
  hasData: boolean
  totalProfit: number // 该年 Σ(fee - cost)
  count: number       // 该年记录数
}

export interface ChargingOverviewDTO {
  currentYear: number // 最新年 = maxDataYear
  years: ChargingYearMeta[]  // 覆盖 [2024 .. maxDataYear+1]
}

export interface ChargingRecordDTO {
  id: number
  scheduleNo: number  // 7 / 8
  cat: string         // cat id
  catName: string     // join 派生
  acctMonth: string   // YYYY-MM 记账月
  kwh: number         // 充电电量(千瓦时)
  fee: number         // 手续费及服务费金额
  cost: number        // 充电成本金额
  profit: number      // 派生:fee - cost
  note: string | null
  source: 'seed' | 'manual'
}

export interface ChargingTotal {
  kwh: number
  fee: number
  cost: number
  profit: number
}

export interface ChargingYearDTO {
  year: number
  cats: ChargingCatDTO[]
  rows: ChargingRecordDTO[]
  total: ChargingTotal
}

// POST /records body — 新增记账(source=manual,派生列后端算)
export interface ChargingRecordReq {
  scheduleNo: number
  cat: string
  acctMonth: string
  kwh: number
  fee: number
  cost: number
  note?: string | null
}
