import http from './index'
import type {
  CompanyDTO, YearMonthsDTO, LedgerOverviewDTO, LedgerMonthDTO, LedgerSaveRequest, LedgerImportRequest,
} from '../types/ledger'
import type { ImportResultDTO } from '../types/import'

// paths per spec §4. http unwraps Result envelope.
export const companyApi = {
  list:   (): Promise<CompanyDTO[]>           => http.get('/companies'),
  create: (name: string): Promise<CompanyDTO> => http.post('/companies', { name }),
  rename: (id: number, name: string): Promise<CompanyDTO> => http.put(`/companies/${id}`, { name }),
  remove: (id: number): Promise<void>         => http.delete(`/companies/${id}`),
}

export const ledgerApi = {
  years: (companyId: number): Promise<YearMonthsDTO[]> =>
    http.get(`/ledger/companies/${companyId}/years`),
  overview: (companyId: number, year: number): Promise<LedgerOverviewDTO> =>
    http.get(`/ledger/companies/${companyId}/overview`, { params: { year } }),
  month: (companyId: number, year: number, month: number): Promise<LedgerMonthDTO> =>
    http.get(`/ledger/companies/${companyId}/months/${year}/${month}`),
  save: (companyId: number, year: number, month: number, body: LedgerSaveRequest): Promise<LedgerMonthDTO> =>
    http.put(`/ledger/companies/${companyId}/months/${year}/${month}`, body),
  copyFromPrev: (companyId: number, year: number, month: number): Promise<LedgerMonthDTO> =>
    http.post(`/ledger/companies/${companyId}/months/${year}/${month}/copy-from-prev`),
  // 逐行定向 upsert(tenant_id 按名解析),不走整月 save 的删空。契约路径见 §4.1。
  import: (companyId: number, year: number, month: number, body: LedgerImportRequest): Promise<ImportResultDTO> =>
    http.post(`/ledger/companies/${companyId}/import`, body, { params: { year, month } }),
}
