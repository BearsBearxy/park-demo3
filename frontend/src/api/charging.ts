import http from './index'
import type {
  ChargingCatDTO, ChargingOverviewDTO, ChargingYearDTO, ChargingRecordDTO, ChargingRecordReq,
  ChargingImportRequest,
} from '../types/charging'
import type { ImportResultDTO, DeleteResultDTO } from '../types/import'

// paths per backend ChargingController:/api/charging/{no}/...。http unwraps Result envelope.
// no = schedule_no(7 汽车 / 8 电动车);同一套方法两实例。
export const chargingApi = {
  cats: (no: number): Promise<ChargingCatDTO[]> => http.get(`/charging/${no}/cats`),
  overview: (no: number): Promise<ChargingOverviewDTO> => http.get(`/charging/${no}/overview`),
  records: (no: number, year: number): Promise<ChargingYearDTO> =>
    http.get(`/charging/${no}/records`, { params: { year } }),
  create: (no: number, req: ChargingRecordReq): Promise<ChargingRecordDTO> =>
    http.post(`/charging/${no}/records`, req),
  updateNote: (no: number, id: number, note: string | null): Promise<ChargingRecordDTO> =>
    http.patch(`/charging/${no}/records/${id}/note`, { note }),
  remove: (no: number, id: number): Promise<void> => http.delete(`/charging/${no}/records/${id}`),
  // 导入:行自带 cat(cat_id)+acctMonth+fee(已按附表算好);按(附表,cat,月)upsert。
  importRows: (no: number, req: ChargingImportRequest): Promise<ImportResultDTO> =>
    http.post(`/charging/${no}/import`, req),
  // 清空本附表本年导入:删本附表本年 source=import。
  clearImported: (no: number, year: number): Promise<DeleteResultDTO> =>
    http.delete(`/charging/${no}/imported`, { params: { year } }),
  // 批量删除:按 id 删(seed 同等可删)。
  batchDelete: (no: number, ids: number[]): Promise<DeleteResultDTO> =>
    http.delete(`/charging/${no}/batch`, { data: { ids } }),
}
