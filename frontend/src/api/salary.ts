import http from './index'
import type { SalaryOverviewDTO, SalaryYearMonthDTO, SalaryRecordDTO, SalaryRecordReq } from '../types/salary'

// paths per SalaryController. http unwraps Result envelope.
export const salaryApi = {
  overview: (): Promise<SalaryOverviewDTO>      => http.get('/salary/overview'),
  records: (year: number, month: number): Promise<SalaryYearMonthDTO> =>
    http.get('/salary/records', { params: { year, month } }),
  create:  (req: SalaryRecordReq): Promise<SalaryRecordDTO> => http.post('/salary/records', req),
  updateNote: (id: number, note: string | null): Promise<SalaryRecordDTO> =>
    http.patch(`/salary/records/${id}/note`, { note }),
  remove:  (id: number): Promise<void>          => http.delete(`/salary/records/${id}`),
}
