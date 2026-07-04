import http from './index'
import type { BuildingDTO, BuildingSummaryDTO, BuildingDetailDTO, BuildingCreateReq } from '../types/building'

export const buildingApi = {
  /** GET /api/buildings → BuildingDTO[] */
  list: (): Promise<BuildingDTO[]> => http.get('/buildings'),

  /** POST /api/buildings → BuildingDTO */
  create: (req: BuildingCreateReq): Promise<BuildingDTO> => http.post('/buildings', req),

  /** GET /api/buildings/summary → BuildingSummaryDTO */
  summary: (): Promise<BuildingSummaryDTO> => http.get('/buildings/summary'),

  /** GET /api/buildings/{id} → BuildingDetailDTO */
  detail: (id: number): Promise<BuildingDetailDTO> => http.get(`/buildings/${id}`),
}
