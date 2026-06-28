import http from './index'
import type {
  CompanyDTO, LedgerOverviewDTO, LedgerMonthDTO, LedgerSaveRequest,
} from '../types/ledger'

// paths per spec §4. http unwraps Result envelope.
export const companyApi = {
  list:   (): Promise<CompanyDTO[]>           => http.get('/companies'),
  create: (name: string): Promise<CompanyDTO> => http.post('/companies', { name }),
  rename: (id: number, name: string): Promise<CompanyDTO> => http.put(`/companies/${id}`, { name }),
  remove: (id: number): Promise<void>         => http.delete(`/companies/${id}`),
}

export const ledgerApi = {
  overview: (companyId: number, year: number): Promise<LedgerOverviewDTO> =>
    http.get(`/ledger/companies/${companyId}/overview`, { params: { year } }),
  month: (companyId: number, year: number, month: number): Promise<LedgerMonthDTO> =>
    http.get(`/ledger/companies/${companyId}/months/${year}/${month}`),
  save: (companyId: number, year: number, month: number, body: LedgerSaveRequest): Promise<LedgerMonthDTO> =>
    http.put(`/ledger/companies/${companyId}/months/${year}/${month}`, body),
  copyFromPrev: (companyId: number, year: number, month: number): Promise<LedgerMonthDTO> =>
    http.post(`/ledger/companies/${companyId}/months/${year}/${month}/copy-from-prev`),
}
