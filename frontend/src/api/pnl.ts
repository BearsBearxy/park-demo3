import http from '@/api'
import type { PnlOverviewDTO, PnlYearDTO, PnlRowDTO } from '@/types/pnl'
import type { ImportResultDTO } from '@/types/import'

// paths per P2-D plan Task1 (/api/pnl/{schedule}/...)。http unwraps Result envelope。
export const pnlApi = {
  overview: (schedule: string): Promise<PnlOverviewDTO> =>
    http.get(`/pnl/${schedule}/overview`),
  year: (schedule: string, year: number): Promise<PnlYearDTO> =>
    http.get(`/pnl/${schedule}/${year}`),
  // 保存整年(clear+insert)
  save: (schedule: string, year: number, body: { rows: PnlRowDTO[] }): Promise<PnlYearDTO> =>
    http.put(`/pnl/${schedule}/${year}`, body),
  // 导入整 (schedule,year) clear+insert
  import: (schedule: string, year: number, body: { rows: PnlRowDTO[] }): Promise<ImportResultDTO> =>
    http.post(`/pnl/${schedule}/import`, body, { params: { year } }),
}
