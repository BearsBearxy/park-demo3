import http from './index'
import type { PvPhaseDTO, PvOverviewDTO, PvYearDTO, PvRecordDTO, PvRecordReq } from '../types/pv'

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
}
