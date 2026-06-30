import http from './index'
import type { DataHomeOverviewDTO } from '../types/dataHome'

// GET /api/data-home/overview。http 拆 Result 封套 + 带 JWT。
export const dataHomeApi = {
  getOverview: (): Promise<DataHomeOverviewDTO> => http.get('/data-home/overview'),
}
