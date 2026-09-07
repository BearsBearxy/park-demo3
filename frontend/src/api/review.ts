import api from '@/api'
import type { ReviewRow } from '@/types/review'

/**
 * 审核机制(SIDEBAR-UX-REDESIGN §7.4)。
 *
 * ⚠ 键里带冒号(`ledger:7:2024-02`),必须 encodeURIComponent —— 冒号在 path segment 里合法,
 *   但 scope 将来出现斜杠或非 ASCII 就会把路径切断。后端 @PathVariable 收的是解码后的值。
 */
export const reviewApi = {
  list: (period: string) => api.get<ReviewRow[]>('/review', { params: { period } }),

  submit: (key: string) => api.post<void>(`/review/${encodeURIComponent(key)}/submit`),
  approve: (key: string) => api.post<void>(`/review/${encodeURIComponent(key)}/approve`),
  returnBack: (key: string, reason: string) =>
    api.post<void>(`/review/${encodeURIComponent(key)}/return`, { reason }),
  withdraw: (key: string, reason: string) =>
    api.post<void>(`/review/${encodeURIComponent(key)}/withdraw`, { reason }),

  /** 整月全审的月份集合(D20)。矩阵月格的 ✓ 靠它,与四个 /months 端点同形。 */
  closedMonths: () => api.get<string[]>('/review/closed-months'),
}
