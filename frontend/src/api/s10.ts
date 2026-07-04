import http from './index'
import type { S10OverviewDTO, S10MonthDTO, S10RecordDTO, S10RecordReq, S10ImportRequest, S10YearSummaryDTO } from '../types/s10'
import type { ImportResultDTO, DeleteResultDTO } from '../types/import'

// paths per 契约 S10Controller:/api/s10/...。http unwraps Result envelope。
// overview 确定性范围;getMonth 按 phase(1-4)×year×month 取稀疏宽表;save upsert(phase,acctMonth,tenantName)。
export const s10Api = {
  getOverview: (): Promise<S10OverviewDTO> => http.get('/s10/overview'),
  getMonth: (phase: number, year: number, month: number): Promise<S10MonthDTO> =>
    http.get(`/s10/${phase}/${year}/${month}`),
  // 年聚合(phase→colId→12月Σ;供损益附表派生,P2-G)
  yearSummary: (year: number): Promise<S10YearSummaryDTO> =>
    http.get('/s10/year-summary', { params: { year } }),
  saveRecord: (req: S10RecordReq): Promise<S10RecordDTO> => http.post('/s10', req),
  updateNote: (id: number, note: string | null): Promise<void> =>
    http.patch(`/s10/${id}/note`, { note }),
  deleteRecord: (id: number): Promise<void> => http.delete(`/s10/${id}`),
  // 软引用 upsert(source='import'、tenant_id=null)。契约路径 §4.2。重导=替换本槽导入行。
  importRows: (req: S10ImportRequest): Promise<ImportResultDTO> => http.post('/s10/import', req),
  // 清空本期导入:删 phase+acctMonth+source='import'(query param 避路径冲突)。
  clearImported: (phase: number, acctMonth: string): Promise<DeleteResultDTO> =>
    http.delete(`/s10/imported?phase=${phase}&acctMonth=${acctMonth}`),
  // 批量删除:按 id 删,种子行跳过。
  batchDelete: (ids: number[]): Promise<DeleteResultDTO> => http.delete('/s10/batch', { data: { ids } }),
}
