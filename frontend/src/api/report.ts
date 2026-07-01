import http from '@/api'
import type {
  ReportYearDTO, ReportPeriodDTO, ReportCustomRowDTO,
  ReportSaveRequest, ReportImportRequest,
} from '@/types/report'
import type { ImportResultDTO } from '@/types/import'

// paths per spec §4 (/api/reports/{statement}/...). http unwraps Result envelope.
export const reportApi = {
  year: (stmt: string, companyId: number, year: number): Promise<ReportYearDTO> =>
    http.get(`/reports/${stmt}/${companyId}/${year}`),
  period: (stmt: string, companyId: number, year: number, month: number): Promise<ReportPeriodDTO> =>
    http.get(`/reports/${stmt}/${companyId}/${year}/${month}`),
  // 全部汇总:跨公司同 rowKey 同 field 求和,customRows 并集,只读。
  allPeriod: (stmt: string, year: number, month: number): Promise<ReportPeriodDTO> =>
    http.get(`/reports/${stmt}/all/${year}/${month}`),
  save: (stmt: string, companyId: number, year: number, month: number, body: ReportSaveRequest): Promise<ReportPeriodDTO> =>
    http.put(`/reports/${stmt}/${companyId}/${year}/${month}`, body),
  addCustomRow: (stmt: string, companyId: number, body: { parentKey: string; label: string; level: number }): Promise<ReportCustomRowDTO> =>
    http.post(`/reports/${stmt}/${companyId}/custom-row`, body),
  deleteCustomRow: (stmt: string, id: number): Promise<void> =>
    http.delete(`/reports/${stmt}/custom-row/${id}`),
  import: (stmt: string, year: number, month: number, body: ReportImportRequest): Promise<ImportResultDTO> =>
    http.post(`/reports/${stmt}/import`, body, { params: { year, month } }),
}
