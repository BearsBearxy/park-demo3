import api from '@/api'
import type { PendingItem, ReviewRow } from '@/types/review'

/**
 * 审核机制(SIDEBAR-UX-REDESIGN §7.4)。
 *
 * ⚠ 键里带冒号(`ledger:7:2024-02`),必须 encodeURIComponent —— 冒号在 path segment 里合法,
 *   但 scope 将来出现斜杠或非 ASCII 就会把路径切断。后端 @PathVariable 收的是解码后的值。
 */
export const reviewApi = {
  /** 清单屏用:某月**全部**审核键(含派生 entered)+ 通过前置缺项。内部跑一遍首页聚合,不便宜。 */
  list: (period: string) => api.get<ReviewRow[]>('/review', { params: { period } }),

  /** 编辑闸用:某年**已落库**的行。不跑聚合、不发派生态、不算前置 —— 闸只问「锁没锁」。
   *  按年取是因为附表族是年表屏(一屏 12 个月),而单月屏在屏内换月也能命中同一份。 */
  states: (year: number) => api.get<ReviewRow[]>('/review/states', { params: { year } }),

  submit: (key: string) => api.post<void>(`/review/${encodeURIComponent(key)}/submit`),
  approve: (key: string) => api.post<void>(`/review/${encodeURIComponent(key)}/approve`),
  returnBack: (key: string, reason: string) =>
    api.post<void>(`/review/${encodeURIComponent(key)}/return`, { reason }),
  withdraw: (key: string, reason: string) =>
    api.post<void>(`/review/${encodeURIComponent(key)}/withdraw`, { reason }),

  /** 整月全审的月份集合(D20)。矩阵月格的 ✓ 靠它,与四个 /months 端点同形。 */
  closedMonths: () => api.get<string[]>('/review/closed-months'),

  /** 铃铛抽屉用:待审**明细**(跨全部月)。只有个数的话,人得自己在年份条上逐月翻着找。
   *  ⚠ 只在抽屉打开时取 —— 别挂到 3 秒一拍的心跳上,那条通道只该带一个号。 */
  pending: () => api.get<PendingItem[]>('/review/pending'),
}
