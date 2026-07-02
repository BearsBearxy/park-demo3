// 报表 DTO — 镜像后端 record（spec §4）。JSON camelCase ⇄ Java record。statement='is'|'bs'|'tb'。
// field：is='cur'|'ytd'；bs='end'；tb=8 字段(openDr..endCr)——amounts 为泛型 field map。

// 单期单行的两列金额（本月 cur / 本年累计 ytd）。
export interface ReportMonthCell {
  cur: number
  ytd: number
}

// tb 科目树节点 — 镜像后端 ReportAccountDTO（P2-C spec §2）。
export interface ReportAccount {
  rowKey: string
  parentKey: string | null
  code: string | null
  label: string
  level: number
  sortOrder: number
}

// 自定义子类行（按 公司+statement 独立，spec R9）。
export interface ReportCustomRowDTO {
  id: number
  rowKey: string
  parentKey: string
  label: string
  level: number
}

// L3 单期读：amounts 只含 normal 叶子行（含自定义行），小计不落库、前端算。
// 值 = 泛型 field map（is 视图窄化为 cur/ytd，bs 为 end，tb 为 8 字段）；accounts 仅 tb 附带科目树。
export interface ReportPeriodDTO {
  amounts: Record<string, Record<string, number>>
  customRows: ReportCustomRowDTO[]
  accounts?: ReportAccount[]
}

// L2 月历：各月 hasData + 预览（本月营业收入，spec Task2 要点）。
export interface ReportMonthMeta {
  month: number
  hasData: boolean
  netPreview: number
}

export interface ReportYearDTO {
  year: number
  months: ReportMonthMeta[]
}

// PUT save body 的单元格 / 导入公司段的单元格。
export interface ReportCell {
  rowKey: string
  field: string
  amount: number
}

// tb 另可带 accounts 整期覆盖科目树（is/bs 不传即忽略）。
export interface ReportSaveRequest {
  cells: ReportCell[]
  accounts?: ReportAccount[]
}

// 导入 body（spec §6）：多公司段，公司名匹配 management_company、未匹配自动新建。
export interface ReportCompanySection {
  companyName: string
  cells: ReportCell[]
  accounts?: ReportAccount[]
}

export interface ReportImportRequest {
  sections: ReportCompanySection[]
}
