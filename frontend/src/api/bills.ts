import http from './index'
import type { LedgerFees } from '../types/ledger'
import type { S10Fees, S10ColId } from '../types/s10'

// 账单行 = 台账行 × 租户(parentId/parentName) × 公司,镜像后端 BillRowDTO(21 费用列平铺自 LedgerFees)。
// companyName=公司主体名(非租户名);派生列(totalReceivable/balanceEnd)复用 LedgerService 台账口径,前端不重算。
export interface BillRowDTO extends LedgerFees {
  companyId: number
  companyName: string
  tenantId: number | null   // V105:未绑定台账行为 null(账面名在 tenantName)
  tenantName: string
  parentId: number | null
  parentName: string | null
  balancePrev: number
  totalCollected: number
  totalReceivable: number // derived
  balanceEnd: number      // derived
}

// 附表10 行(应收口径明细),镜像后端 BillS10RowDTO:tenantId 可空(import 软引用),25 费用列平铺。
export interface BillS10RowDTO extends S10Fees {
  tenantId: number | null
  tenantName: string
  phase: number
}

// 收款公司指引映射(BILLS-SPEC §5):tenant_id × fee_key(附表10 colId) → company_id。
// 与台账记账公司/期数完全不联动——它是"要求租户转到哪"的指引,不是记账事实;默认值后端种子推导,此后全靠用户手动改。
export interface PaymapRow {
  tenantId: number
  feeKey: S10ColId
  companyId: number
}

// path per plan F4。http unwraps Result envelope.
export const billsApi = {
  // 台账口径账单行:BILLS-SPEC 2026-07-16 后本屏不再消费(实收/结余属台账)。暂无消费方,收款核对备用。
  list: (year: number, month: number): Promise<BillRowDTO[]> =>
    http.get('/bills', { params: { year, month } }),
  // 该期全部 s10_record 行(BILLS-SPEC §1):账单屏唯一数据源(家族列表 + 工资条明细 + 导出)。
  s10: (year: number, month: number): Promise<BillS10RowDTO[]> =>
    http.get('/bills/s10', { params: { year, month } }),
  // 收款公司指引(BILLS-SPEC §5):进页一次拉全量缓存;PUT = 单格 upsert,选中即存
  paymap: (): Promise<PaymapRow[]> => http.get('/bills/paymap'),
  setPaymap: (row: PaymapRow): Promise<void> => http.put('/bills/paymap', row),
}
