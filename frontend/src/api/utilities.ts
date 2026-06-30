import http from './index'
import type {
  OfficeOverviewDTO, OfficeYearDTO, OfficeRecordDTO, OfficeRecordReq, OfficeImportRequest,
} from '../types/utilities'
import type { ImportResultDTO, DeleteResultDTO } from '../types/import'

// paths per backend OfficeController:/api/utilities/...。http unwraps Result envelope.
// overview 合并 13+14 两子表;records/create/updateNote/remove 带 no = schedule_no(13 办公 / 14 三期)。
export const utilitiesApi = {
  overview: (): Promise<OfficeOverviewDTO> => http.get('/utilities/overview'),
  records: (no: number, year: number): Promise<OfficeYearDTO> =>
    http.get(`/utilities/${no}/records`, { params: { year } }),
  create: (no: number, req: OfficeRecordReq): Promise<OfficeRecordDTO> =>
    http.post(`/utilities/${no}/records`, req),
  updateNote: (no: number, id: number, note: string | null): Promise<OfficeRecordDTO> =>
    http.patch(`/utilities/${no}/records/${id}/note`, { note }),
  remove: (no: number, id: number): Promise<void> => http.delete(`/utilities/${no}/records/${id}`),
  // 导入:行自带 acctMonth(跨年各落各年);重导=替换涉及年 source=import 行。无 ?year,全由行驱动。
  importRows: (no: number, req: OfficeImportRequest): Promise<ImportResultDTO> =>
    http.post(`/utilities/${no}/import`, req),
  // 清空本附表本年导入:删本附表本年 source=import。
  clearImported: (no: number, year: number): Promise<DeleteResultDTO> =>
    http.delete(`/utilities/${no}/imported`, { params: { year } }),
  // 批量删除:按 id 删,种子行跳过。
  batchDelete: (ids: number[]): Promise<DeleteResultDTO> => http.delete('/utilities/batch', { data: { ids } }),
}
