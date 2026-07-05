import http from './index'
import type { TenantDTO, TenantSummaryDTO, TenantDetailDTO, TenantCategoryDTO, TenantCreateReq, TenantUpdateReq } from '../types/tenant'

export const tenantApi = {
  /** GET /api/tenants → TenantDTO[] */
  list: (): Promise<TenantDTO[]> => http.get('/tenants'),

  /** POST /api/tenants → TenantDTO(新租户,派生字段月租/合同数=0) */
  create: (req: TenantCreateReq): Promise<TenantDTO> => http.post('/tenants', req),

  /** PUT /api/tenants/{id} → TenantDTO(全量编辑,含状态;同名 409) */
  update: (id: number, req: TenantUpdateReq): Promise<TenantDTO> => http.put(`/tenants/${id}`, req),

  /** DELETE /api/tenants/{id}(有合同/台账记录 409) */
  remove: (id: number): Promise<void> => http.delete(`/tenants/${id}`),

  /** GET /api/tenants/summary → TenantSummaryDTO */
  summary: (): Promise<TenantSummaryDTO> => http.get('/tenants/summary'),

  /** GET /api/tenants/{id} → TenantDetailDTO */
  detail: (id: number): Promise<TenantDetailDTO> => http.get(`/tenants/${id}`),

  /** GET /api/tenant-categories → TenantCategoryDTO[] */
  categories: (): Promise<TenantCategoryDTO[]> => http.get('/tenant-categories'),
}
