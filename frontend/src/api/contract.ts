import http from './index'
import type { ContractDTO, ContractSummaryDTO, ContractDetailDTO, ContractCreateReq, ContractRenewReq } from '../types/contract'

export const contractApi = {
  list:    (): Promise<ContractDTO[]>              => http.get('/contracts'),
  summary: (): Promise<ContractSummaryDTO>         => http.get('/contracts/summary'),
  detail:  (id: number): Promise<ContractDetailDTO> => http.get(`/contracts/${id}`),
  create:  (req: ContractCreateReq): Promise<ContractDTO> => http.post('/contracts', req),
  update:  (id: number, req: ContractCreateReq): Promise<ContractDTO> => http.put(`/contracts/${id}`, req),
  terminate: (id: number): Promise<ContractDTO>    => http.post(`/contracts/${id}/terminate`),
  renew:   (id: number, req: ContractRenewReq): Promise<ContractDTO> => http.post(`/contracts/${id}/renew`, req),
  remove:  (id: number): Promise<void>             => http.delete(`/contracts/${id}`),
}
