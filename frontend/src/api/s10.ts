import http from './index'
import type { S10OverviewDTO, S10MonthDTO, S10RecordDTO, S10RecordReq } from '../types/s10'

// paths per 契约 S10Controller:/api/s10/...。http unwraps Result envelope。
// overview 确定性范围;getMonth 按 phase(1-4)×year×month 取稀疏宽表;save upsert(phase,acctMonth,tenantName)。
export const s10Api = {
  getOverview: (): Promise<S10OverviewDTO> => http.get('/s10/overview'),
  getMonth: (phase: number, year: number, month: number): Promise<S10MonthDTO> =>
    http.get(`/s10/${phase}/${year}/${month}`),
  saveRecord: (req: S10RecordReq): Promise<S10RecordDTO> => http.post('/s10', req),
  updateNote: (id: number, note: string | null): Promise<void> =>
    http.put(`/s10/${id}/note`, { note }),
  deleteRecord: (id: number): Promise<void> => http.delete(`/s10/${id}`),
}
