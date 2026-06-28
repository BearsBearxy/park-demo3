import http from './index'
import type { TenantDTO, TenantSummaryDTO, TenantDetailDTO, TenantCategoryDTO } from '../types/tenant'

export const tenantApi = {
  /** GET /api/tenants → TenantDTO[] */
  list: (): Promise<TenantDTO[]> => http.get('/tenants'),

  /** GET /api/tenants/summary → TenantSummaryDTO */
  summary: (): Promise<TenantSummaryDTO> => http.get('/tenants/summary'),

  /** GET /api/tenants/{id} → TenantDetailDTO */
  detail: (id: number): Promise<TenantDetailDTO> => http.get(`/tenants/${id}`),

  /** GET /api/tenant-categories → TenantCategoryDTO[] */
  categories: (): Promise<TenantCategoryDTO[]> => http.get('/tenant-categories'),
}
