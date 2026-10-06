import http from '@/api'
import type { PnlOverviewDTO, PnlYearDTO, PnlRowDTO } from '@/types/pnl'
import type { ImportResultDTO } from '@/types/import'

// paths per P2-D plan Task1 (/api/pnl/{schedule}/...)。http unwraps Result envelope。
export const pnlApi = {
  overview: (schedule: string): Promise<PnlOverviewDTO> =>
    http.get(`/pnl/${schedule}/overview`),
  year: (schedule: string, year: number): Promise<PnlYearDTO> =>
    http.get(`/pnl/${schedule}/${year}`),
  // 保存整年:服务端只写变了的格,改到整月锁账的月整次拒(423,message 是给人看的整句)。
  // auto = 打开年表时自动补行(PnlScheduleView.tryGenerate),只让数据修改记录注明是自动补的
  save: (schedule: string, year: number, body: { rows: PnlRowDTO[] }, auto = false): Promise<PnlYearDTO> =>
    http.put(`/pnl/${schedule}/${year}`, body, auto ? { params: { auto: true } } : undefined),
  // 导入整 (schedule,year):同上只写变了的格、改到整月锁账的月整次拒
  import: (schedule: string, year: number, body: { rows: PnlRowDTO[] }): Promise<ImportResultDTO> =>
    http.post(`/pnl/${schedule}/import`, body, { params: { year } }),
}
