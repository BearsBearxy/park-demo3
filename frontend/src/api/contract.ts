import http from './index'
import type { ContractDTO, ContractSummaryDTO, ContractDetailDTO, ContractCreateReq, ContractRenewReq, RentFreePeriod, BillingLinesImportRow } from '../types/contract'
import type { ImportResultDTO } from '../types/import'

// rent_free 后端存 JSON 字符串(TEXT 列):读侧 try-parse 转数组(手改库塞垃圾按 null 兜底,见 plan 风险条),
// 写侧序列化。字符串形态不出 api 层,组件只见 RentFreePeriod[]。
type ContractWire = Omit<ContractDTO, 'rentFree'> & { rentFree?: string | null }
function fromWire(w: ContractWire): ContractDTO {
  let rentFree: RentFreePeriod[] | null = null
  if (w.rentFree) {
    try { const a = JSON.parse(w.rentFree); rentFree = Array.isArray(a) ? a : null } catch { /* 垃圾数据按空 */ }
  }
  return { ...w, rentFree }
}
const toWire = (req: ContractCreateReq) =>
  ({ ...req, rentFree: req.rentFree?.length ? JSON.stringify(req.rentFree) : null })

export const contractApi = {
  // asOfDate(yyyy-MM-dd)非空 → 后端某日在租过滤(§5.2:非草稿且 startDate≤日≤endDate)
  list:    (asOfDate?: string): Promise<ContractDTO[]> =>
    http.get<ContractWire[]>('/contracts', asOfDate ? { params: { asOfDate } } : undefined).then(rs => rs.map(fromWire)),
  summary: (): Promise<ContractSummaryDTO>         => http.get('/contracts/summary'),
  detail:  (id: number): Promise<ContractDetailDTO> =>
    http.get<Omit<ContractDetailDTO, 'contract'> & { contract: ContractWire }>(`/contracts/${id}`)
      .then(d => ({ ...d, contract: fromWire(d.contract) })),
  create:  (req: ContractCreateReq): Promise<ContractDTO> => http.post<ContractWire>('/contracts', toWire(req)).then(fromWire),
  update:  (id: number, req: ContractCreateReq): Promise<ContractDTO> => http.put<ContractWire>(`/contracts/${id}`, toWire(req)).then(fromWire),
  terminate: (id: number): Promise<ContractDTO>    => http.post<ContractWire>(`/contracts/${id}/terminate`).then(fromWire),
  renew:   (id: number, req: ContractRenewReq): Promise<ContractDTO> => http.post<ContractWire>(`/contracts/${id}/renew`, req).then(fromWire),
  remove:  (id: number): Promise<void>             => http.delete(`/contracts/${id}`),
  // 计费行批量导入(BILL-FORWARD 刀1 三次返工 §1.7):FeeRow 1:1,按合同整组替换 source='import' 行、保留 manual 行
  importBillingLines: (rows: BillingLinesImportRow[]): Promise<ImportResultDTO> =>
    http.post('/contracts/billing-lines/import', { rows }),
}
