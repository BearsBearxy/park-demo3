import http from './index'
import type { ElecPhaseDTO, ElecOverviewDTO, ElecYearDTO, ElecRecordDTO, ElecRecordReq } from '../types/elec'

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
}
