import http from './index'
import type { ContractDTO, ContractSummaryDTO, ContractDetailDTO, ContractCreateReq } from '../types/contract'

export const contractApi = {
  list:    (): Promise<ContractDTO[]>              => http.get('/contracts'),
  summary: (): Promise<ContractSummaryDTO>         => http.get('/contracts/summary'),
  detail:  (id: number): Promise<ContractDetailDTO> => http.get(`/contracts/${id}`),
  create:  (req: ContractCreateReq): Promise<ContractDTO> => http.post('/contracts', req),
}
