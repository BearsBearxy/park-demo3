import http from '@/api'
import type { ImportResultDTO } from '@/types/import'

// 年度预算(budget_row)— 契约:specs/2026-07-07-demo3-budget-compare-design.md「数据模型」节。
// 一行=某年某科目;预算与发生额可只有其一(2026 只有预算,2022~2024 只有发生额;2025 发生额不落库)。
export interface BudgetRowDTO {
  year: number
  label: string          // trim 后科目名
  sub: boolean           // 「其中：」子行
  budget: number | null  // 该年预算额
  actual: number | null  // 该年发生额
  note: string | null
  sortOrder: number
}
export interface BudgetImportRow {
  year: number; label: string; sub: boolean
  budget?: number; actual?: number; note?: string; sortOrder: number
}

export const budgetApi = {
  // 按 payload 内出现的 year 整年替换(delete+insert,同 pnl 惯例)
  import: (body: { rows: BudgetImportRow[] }): Promise<ImportResultDTO> =>
    http.post('/budget/import', body),
  // 表小,一次拉全
  all: (): Promise<BudgetRowDTO[]> => http.get('/budget/all'),
}
