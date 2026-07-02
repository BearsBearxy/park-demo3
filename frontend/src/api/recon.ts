import http from '@/api'
import type { ReconOverview, ReconMonth } from '@/types/recon'

// paths per P2-E plan Task1 (/api/recon)。http unwraps Result envelope。
export const reconApi = {
  // year 缺省=后端取两本账有数据的最大年
  overview: (year?: number): Promise<ReconOverview> =>
    http.get('/recon/overview', { params: { year } }),
  month: (year: number, month: number): Promise<ReconMonth> =>
    http.get(`/recon/${year}/${month}`),
  // upsert 处置标记(uk 冲突更新 note);调用方局部更新 entities,不消费返回体
  mark: (year: number, month: number, body: { tenantName: string; tenantId?: number | null; note?: string | null }): Promise<void> =>
    http.post(`/recon/${year}/${month}/mark`, body),
  unmark: (year: number, month: number, tenantName: string): Promise<void> =>
    http.delete(`/recon/${year}/${month}/mark`, { params: { tenantName } }),
}
