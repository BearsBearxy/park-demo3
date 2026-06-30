// 附表12 工资明细 DTOs — 逐字对齐后端 dto/Salary*.java。
// 一行 = 某员工某月。派生列(wageTotal/gross/deduct/net/actualDays/fullAttend)后端读时算好下发,
// 前端不重算、不落库。金额 BigDecimal → number(JSON 数字)。

export interface SalaryRecordDTO {
  id: number
  acctMonth: string   // YYYY-MM 所属月份
  empIdx: number      // 序号(seed 用,manual=0)
  name: string
  role: string | null
  base: number        // 基本
  post: number        // 岗位
  perf: number        // 绩效奖金
  attend: number      // 全勤奖
  skill: number       // 岗位技能津贴
  edu: number         // 学历津贴
  other: number       // 其它津贴
  lunch: number       // 午餐补助
  heat: number        // 高温及其他
  commission: number  // 招商提成
  shouldDays: number  // 应出勤
  leaveDays: number   // 请假
  social: number      // 社保
  tax: number         // 上月个税
  otherDeduct: number // 其他扣款
  sign: boolean       // 签收
  wageTotal: number   // 派生 = base+post+perf+attend+skill+edu+other
  gross: number       // 派生 = wageTotal+lunch+heat+commission
  deduct: number      // 派生 = social+tax+otherDeduct
  net: number         // 派生 = gross-deduct
  actualDays: number  // 派生 = shouldDays-leaveDays
  fullAttend: boolean // 派生 = leaveDays==0
  note: string | null
  source: 'seed' | 'manual' | 'import'
}

// 年份卡元数据(overview.years 元素,对齐 SalaryOverviewDTO.YearMeta)
export interface SalaryYearMeta {
  year: number
  hasData: boolean
  count: number          // 人次
  netTotal: number       // 全年实发合计
  months: number[]       // 该年有数据的月份(升序)
}

export interface SalaryOverviewDTO {
  currentYear: number    // 最新年 = maxDataYear
  years: SalaryYearMeta[] // 覆盖 [2024 .. maxDataYear+1]
}

// 月明细合计(对齐 SalaryYearMonthDTO.Total,无 shouldDays/leaveDays/net 之外的考勤列)
export interface SalaryTotal {
  base: number
  post: number
  perf: number
  attend: number
  skill: number
  edu: number
  other: number
  lunch: number
  heat: number
  commission: number
  wageTotal: number
  gross: number
  social: number
  tax: number
  otherDeduct: number
  deduct: number
  net: number
}

export interface SalaryYearMonthDTO {
  year: number
  month: number
  rows: SalaryRecordDTO[]
  total: SalaryTotal
}

// POST /import body 行 — 行身份=姓名(tenantName);应发/实发/全勤派生不传。对齐后端 SalaryImportRequest.Row。
export interface SalaryImportRow {
  tenantName: string   // 姓名
  role?: string | null
  base?: number
  post?: number
  perf?: number
  attend?: number
  skill?: number
  edu?: number
  other?: number
  lunch?: number
  heat?: number
  commission?: number
  shouldDays?: number
  leaveDays?: number
  social?: number
  tax?: number
  otherDeduct?: number
}

export interface SalaryImportRequest {
  rows: SalaryImportRow[]
}

// POST /records body — 新增工资(source=manual,派生列后端算)
export interface SalaryRecordReq {
  acctMonth: string
  name: string
  role?: string | null
  base?: number
  post?: number
  perf?: number
  attend?: number
  skill?: number
  edu?: number
  other?: number
  lunch?: number
  heat?: number
  commission?: number
  shouldDays?: number
  leaveDays?: number
  social?: number
  tax?: number
  otherDeduct?: number
  note?: string | null
}
