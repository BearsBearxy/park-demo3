import http from './index'
import type { BuildingDTO, BuildingSummaryDTO, BuildingDetailDTO } from '../types/building'

export const buildingApi = {
  /** GET /api/buildings → BuildingDTO[] */
  list: (): Promise<BuildingDTO[]> => http.get('/buildings'),

  /** GET /api/buildings/summary → BuildingSummaryDTO */
  summary: (): Promise<BuildingSummaryDTO> => http.get('/buildings/summary'),

  /** GET /api/buildings/{id} → BuildingDetailDTO */
  detail: (id: number): Promise<BuildingDetailDTO> => http.get(`/buildings/${id}`),
}
