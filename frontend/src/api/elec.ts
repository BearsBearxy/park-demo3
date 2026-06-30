import http from './index'
import type { ElecPhaseDTO, ElecOverviewDTO, ElecYearDTO, ElecRecordDTO, ElecRecordReq, ElecImportRow } from '../types/elec'
import type { ImportResultDTO, DeleteResultDTO } from '../types/import'

// paths per ElecController. http unwraps Result envelope.
// records 需 year + type(后端按 type 过滤);overview 价税合计跨 energy+basic。
export const elecApi = {
  phases:  (): Promise<ElecPhaseDTO[]>        => http.get('/elec/phases'),
  overview: (): Promise<ElecOverviewDTO>      => http.get('/elec/overview'),
  records: (year: number, type: string): Promise<ElecYearDTO> =>
    http.get('/elec/records', { params: { year, type } }),
  create:  (req: ElecRecordReq): Promise<ElecRecordDTO> => http.post('/elec/records', req),
  updateNote: (id: number, note: string | null): Promise<ElecRecordDTO> =>
    http.patch(`/elec/records/${id}/note`, { note }),
  remove:  (id: number): Promise<void>        => http.delete(`/elec/records/${id}`),
  // 导入:行自带 type+phaseId+acctMonth,按(期,月)整月整期 upsert。
  importRows: (rows: ElecImportRow[]): Promise<ImportResultDTO> => http.post('/elec/import', { rows }),
  // 清空本年导入:删本年 source=import。
  clearImported: (year: number): Promise<DeleteResultDTO> =>
    http.delete('/elec/imported', { params: { year } }),
  // 批量删除:按 id 删(seed 同等可删)。
  batchDelete: (ids: number[]): Promise<DeleteResultDTO> => http.delete('/elec/batch', { data: { ids } }),
}
