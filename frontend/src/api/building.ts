import http from './index'
import type { BuildingDTO, BuildingSummaryDTO, BuildingDetailDTO, BuildingCreateReq, BuildingUpdateReq } from '../types/building'

export const buildingApi = {
  /** GET /api/buildings → BuildingDTO[] */
  list: (): Promise<BuildingDTO[]> => http.get('/buildings'),

  /** POST /api/buildings → BuildingDTO */
  create: (req: BuildingCreateReq): Promise<BuildingDTO> => http.post('/buildings', req),

  /** GET /api/buildings/summary → BuildingSummaryDTO */
  summary: (): Promise<BuildingSummaryDTO> => http.get('/buildings/summary'),

  /** GET /api/buildings/{id} → BuildingDetailDTO */
  detail: (id: number): Promise<BuildingDetailDTO> => http.get(`/buildings/${id}`),

  /** PUT /api/buildings/{id} → BuildingDTO（编辑不重算单元） */
  update: (id: number, req: BuildingUpdateReq): Promise<BuildingDTO> => http.put(`/buildings/${id}`, req),

  /** DELETE /api/buildings/{id}（有合同 409；单元随 FK 级联删除） */
  remove: (id: number): Promise<void> => http.delete(`/buildings/${id}`),
}
