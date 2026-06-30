import http from './index'
import type { PvPhaseDTO, PvOverviewDTO, PvYearDTO, PvRecordDTO, PvRecordReq, PvImportRow } from '../types/pv'
import type { ImportResultDTO, DeleteResultDTO } from '../types/import'

// paths per spec §4. http unwraps Result envelope.
export const pvApi = {
  phases:  (): Promise<PvPhaseDTO[]>        => http.get('/pv/phases'),
  overview: (): Promise<PvOverviewDTO>      => http.get('/pv/overview'),
  records: (year: number): Promise<PvYearDTO> =>
    http.get('/pv/records', { params: { year } }),
  create:  (req: PvRecordReq): Promise<PvRecordDTO> => http.post('/pv/records', req),
  updateNote: (id: number, note: string | null): Promise<PvRecordDTO> =>
    http.patch(`/pv/records/${id}/note`, { note }),
  remove:  (id: number): Promise<void>      => http.delete(`/pv/records/${id}`),
  // 导入:行自带 phaseId+acctMonth,按(期,月)upsert。
  importRows: (rows: PvImportRow[]): Promise<ImportResultDTO> => http.post('/pv/import', { rows }),
  // 清空本年导入:删本年 source=import。
  clearImported: (year: number): Promise<DeleteResultDTO> =>
    http.delete('/pv/imported', { params: { year } }),
  // 批量删除:按 id 删(seed 同等可删)。
  batchDelete: (ids: number[]): Promise<DeleteResultDTO> => http.delete('/pv/batch', { data: { ids } }),
}
