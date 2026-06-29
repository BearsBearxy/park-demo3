// 附表11 电费成本 DTOs — 逐字对齐后端 dto/Elec*.java(spec §4)。
// JSON camelCase ⇄ Java record;ElecPhaseDTO 的 short 线格式为 "short"(@JsonProperty),非 shortName。
// 两类型共一表用 type 区分:energy(电量电费/进项)/ basic(基本电费)。
// 派生 amount/tax/total 后端读时算好下发,前端不重算、不落库。

export interface ElecPhaseDTO {
  id: string          // p1 / p2 / p3
  name: string
  short: string       // 简称(@JsonProperty("short"))
}

// 年份卡元数据(overview.years 元素;价税合计跨 energy+basic)
export interface YearMeta {
  year: number
  hasData: boolean
  totalFee: number    // 该年价税合计(energy+basic 合)
  count: number       // 该年记录数
}

export interface ElecOverviewDTO {
  currentYear: number // 最新年 = maxDataYear
  years: YearMeta[]   // 覆盖 [2024 .. maxDataYear+1]
}

export interface ElecRecordDTO {
  id: number
  type: 'energy' | 'basic'
  phase: string       // phase id
  phaseName: string   // join 派生
  acctMonth: string   // YYYY-MM 记账月
  invDate: string | null  // YYYY-MM-DD 开票日期
  period: string | null   // 峰/平/谷(仅 energy)
  cat: string | null      // 用电类别(仅 energy)
  unit: string | null     // 单位(仅 energy)
  qty: number | null      // 电量 kWh(仅 energy)
  demand: number | null   // 计费需量 kVA(仅 basic)
  price: number
  rate: number
  amount: number      // 派生:energy qty×price / basic demand×price
  tax: number         // 派生:amount×rate
  total: number       // 派生:amount+tax
  note: string | null
  source: 'seed' | 'manual'
}

export interface ElecTotal {
  qty: number         // energy 电量合计
  demand: number      // basic 需量合计
  amount: number      // 不含税金额 / 基本用电费 合计
  tax: number
  total: number       // 价税合计
}

export interface ElecYearDTO {
  year: number
  type: 'energy' | 'basic'  // 本次过滤口径
  phases: ElecPhaseDTO[]
  rows: ElecRecordDTO[]
  total: ElecTotal
}

// POST /records body — 新增记账(source=manual,派生列后端算)
export interface ElecRecordReq {
  type: 'energy' | 'basic'
  phase: string
  acctMonth: string
  invDate?: string | null
  period?: string | null   // 仅 energy
  cat?: string | null      // 仅 energy
  unit?: string | null     // 仅 energy
  qty?: number | null      // 仅 energy
  demand?: number | null   // 仅 basic
  price: number
  rate: number
  note?: string | null
}
