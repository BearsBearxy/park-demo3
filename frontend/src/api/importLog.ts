import http from './index'
import type { ImportLogReq, ImportLogDTO, ImportLogOverviewDTO } from '../types/importLog'

// paths per backend ImportLogController:/api/import-log。http unwraps Result envelope。
export const importLogApi = {
  record: (req: ImportLogReq): Promise<ImportLogDTO> => http.post('/import-log', req),
  overview: (days = 30, historyLimit = 100): Promise<ImportLogOverviewDTO> =>
    http.get('/import-log/overview', { params: { days, historyLimit } }),
}
