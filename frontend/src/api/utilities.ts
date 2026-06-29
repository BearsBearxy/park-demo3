import http from './index'
import type {
  OfficeOverviewDTO, OfficeYearDTO, OfficeRecordDTO, OfficeRecordReq,
} from '../types/utilities'

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
}
