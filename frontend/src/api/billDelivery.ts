import http from './index'
import type { CompanyDTO } from '@/types/ledger'

// 催缴单交付链(S20-BILL-DELIVERY-SPEC)API — 收款公司/账户主数据 + 单据状态流转。
// ⚠ 字段名与三刀共用契约逐字钉死(后端 dto/Company*/BillNotice*),不得各自改名。
// 独立成文件而非扩 ledger.ts/billNotices.ts:S19/S20 三把刀并行,少碰一个既有文件少一次冲突。
// GET 全员可读,写=ADMIN(后端 SecurityConfig 统一门)。

export type AccountKind = 'bank' | 'wechat' | 'alipay' | 'personal' | 'other'
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  bank: '对公银行', wechat: '微信', alipay: '支付宝', personal: '个人卡', other: '其他',
}
export const ACCOUNT_KINDS = Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]

export interface CompanyAccountDTO {
  id: number
  companyId: number
  kind: AccountKind
  accountName: string | null    // 户名(对公=公司全称,个人=收款人姓名)
  accountNo: string | null      // 账号 / 收款码标识
  bankName: string | null       // 开户行(bank/personal 用)
  isDefault: boolean            // 该公司默认收款账户(导出时预选)
  sortNo: number
  remark: string | null
}

// GET /api/companies 扩形(V94):在既有 CompanyDTO 上加 fullName/status/accounts
export interface CompanyFullDTO extends CompanyDTO {
  fullName: string | null       // 法定全称,印在通知单落款与账户块;空则回落 name
  status: number                // 1=启用 0=停用(停用不再出现在收款公司选择器,历史单不受影响)
  accounts: CompanyAccountDTO[]
}

export interface CompanyReq {
  name: string
  short: string
  fullName?: string | null
  status?: number
}
export interface AccountReq {
  kind: AccountKind
  accountName?: string | null
  accountNo?: string | null
  bankName?: string | null
  isDefault?: boolean
  remark?: string | null
}

export interface ConfirmResultDTO { confirmed: number; skipped: number }
export interface MarkExportedResultDTO { marked: number }

export const companyBookApi = {
  list: (): Promise<CompanyFullDTO[]> => http.get('/companies'),
  create: (req: CompanyReq): Promise<CompanyFullDTO> => http.post('/companies', req),
  update: (id: number, req: CompanyReq): Promise<CompanyFullDTO> => http.put(`/companies/${id}`, req),
  addAccount: (companyId: number, req: AccountReq): Promise<CompanyAccountDTO> =>
    http.post(`/companies/${companyId}/accounts`, req),
  updateAccount: (id: number, req: AccountReq): Promise<CompanyAccountDTO> =>
    http.put(`/company-accounts/${id}`, req),
  deleteAccount: (id: number): Promise<void> => http.delete(`/company-accounts/${id}`),
}

export const billDeliveryApi = {
  // 户级批量确认:该户本月全部 draft 单转 confirmed;已 confirmed/exported 的计入 skipped
  confirm: (ym: string, tenantIds: number[]): Promise<ConfirmResultDTO> =>
    http.post('/bill-notices/confirm', { ym, tenantIds }),
  // 导出成功后回写 exported_at(前端导出完成才调,失败不调)
  markExported: (ym: string, tenantIds: number[]): Promise<MarkExportedResultDTO> =>
    http.post('/bill-notices/mark-exported', { ym, tenantIds }),
}
