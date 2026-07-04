import http from './index'
import type { TenantDTO, TenantSummaryDTO, TenantDetailDTO, TenantCategoryDTO, TenantCreateReq } from '../types/tenant'

export const tenantApi = {
  /** GET /api/tenants → TenantDTO[] */
  list: (): Promise<TenantDTO[]> => http.get('/tenants'),

  /** POST /api/tenants → TenantDTO(新租户,派生字段月租/合同数=0) */
  create: (req: TenantCreateReq): Promise<TenantDTO> => http.post('/tenants', req),

  /** GET /api/tenants/summary → TenantSummaryDTO */
  summary: (): Promise<TenantSummaryDTO> => http.get('/tenants/summary'),

  /** GET /api/tenants/{id} → TenantDetailDTO */
  detail: (id: number): Promise<TenantDetailDTO> => http.get(`/tenants/${id}`),

  /** GET /api/tenant-categories → TenantCategoryDTO[] */
  categories: (): Promise<TenantCategoryDTO[]> => http.get('/tenant-categories'),
}
