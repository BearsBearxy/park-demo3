import http from './index'
import type {
  SalaryOverviewDTO, SalaryYearMonthDTO, SalaryRecordDTO, SalaryRecordReq, SalaryImportRequest,
} from '../types/salary'
import type { ImportResultDTO, DeleteResultDTO } from '../types/import'

// paths per SalaryController. http unwraps Result envelope.
export const salaryApi = {
  overview: (): Promise<SalaryOverviewDTO>      => http.get('/salary/overview'),
  records: (year: number, month: number): Promise<SalaryYearMonthDTO> =>
    http.get('/salary/records', { params: { year, month } }),
  // 某年餐补逐月合计(12 个,无工资行的月为 null)。不带人,报表查看就能读 —— 损益附表5「餐补费」派生对照用
  lunchTotals: (year: number): Promise<(number | null)[]> => http.get('/salary/lunch-totals', { params: { year } }),
  create:  (req: SalaryRecordReq): Promise<SalaryRecordDTO> => http.post('/salary/records', req),
  updateNote: (id: number, note: string | null): Promise<SalaryRecordDTO> =>
    http.patch(`/salary/records/${id}/note`, { note }),
  remove:  (id: number): Promise<void>          => http.delete(`/salary/records/${id}`),
  // 导入:重导=替换本月 source=import 行(行身份=姓名)。year/month 走 query。
  importRows: (year: number, month: number, req: SalaryImportRequest): Promise<ImportResultDTO> =>
    http.post('/salary/import', req, { params: { year, month } }),
  // 清空本月导入:删 acctMonth+source=import。
  clearImported: (year: number, month: number): Promise<DeleteResultDTO> =>
    http.delete('/salary/imported', { params: { year, month } }),
  // 批量删除:按 id 删,种子行跳过。
  batchDelete: (ids: number[]): Promise<DeleteResultDTO> => http.delete('/salary/batch', { data: { ids } }),
}
