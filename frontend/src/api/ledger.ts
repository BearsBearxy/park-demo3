import http from './index'
import type {
  CompanyDTO, YearMonthsDTO, LedgerOverviewDTO, LedgerMonthDTO, LedgerRowDTO, LedgerSaveRequest, LedgerImportRequest,
  BindResultDTO,
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
  // 按账面名批量绑定档案(跨公司跨月挂未绑定行;目标月已有该租户行计 conflicts)
  bindTenant: (tenantName: string, tenantId: number): Promise<BindResultDTO> =>
    http.put('/ledger/bind-tenant', { tenantName, tenantId }),
  // 行级绑定/换绑/解绑(tenantId=null 即解绑;同月撞车 409)
  // addAlias:把本行账面名记进该租户别名,今后导入自动认。**默认不记** ——
  // 自动记会把源册里的错别字固化成系统认可的写法,必须由用户显式勾选
  bindRow: (rowId: number, tenantId: number | null, addAlias = false): Promise<LedgerRowDTO> =>
    http.patch(`/ledger/rows/${rowId}/tenant`, { tenantId, addAlias }),
  // 行级改账面名(只动快照;未绑定行改对名字自动配档)
  renameRow: (rowId: number, tenantName: string): Promise<LedgerRowDTO> =>
    http.patch(`/ledger/rows/${rowId}/tenant-name`, { tenantName }),
}
