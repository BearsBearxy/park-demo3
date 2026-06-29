import http from './index'
import type {
  ChargingCatDTO, ChargingOverviewDTO, ChargingYearDTO, ChargingRecordDTO, ChargingRecordReq,
} from '../types/charging'

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
}
