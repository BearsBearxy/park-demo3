import http from './index'

// 催缴单(S4-BILL-NOTICE-SPEC)DTO — 逐字对齐后端 dto/BillNotice*。
// GET=已登录可读,写(generate/issue/void)=ADMIN(后端 SecurityConfig 统一门)。

// 列表行(一户一套账,拆票则一户多单)
export interface BillNoticeDTO {
  id: number
  ym: string
  tenantId: number
  tenantName: string | null
  payCompanyId: number | null        // null=费项未设收款公司(单头带 warn)
  payCompanyName: string | null
  noticeKind: string                 // combined/fee/maint/dorm/offbook(v2 屏上不显,仅 offbook 降淡判定用)
  premiseText: string | null         // 场地段拼接(如 "A座602室,B座201室")
  totalAmount: number
  prevDue: number                    // 上期欠费:催缴闭环接口点,S4 恒 0
  status: string                     // draft/issued/void
  warn: string | null                // 门禁告警原文(";"拼接);null=无警告
  lineCount: number
}

// 明细行(行序=line_no=场地段→表序→段序;price_* 为取价审计链)
export interface BillNoticeLineDTO {
  lineNo: number
  feeKey: string                     // elec/mgmt_fee/capacity/water/water_pipe/share_*(billFeeLabel)
  premise: string | null
  meterId: number | null
  meterLabel: string | null          // 电表①/水表①(sub_name 或顺位补号)
  contractId: number | null          // 出账时表→合同归属快照
  seg: string | null                 // sharp/peak/flat/valley;非分时行 null
  prevRead: number | null
  currRead: number | null
  factorSnap: number | null
  qty: number | null
  priceSnap: number | null
  priceKey: string | null
  priceScope: string | null          // ''=全园 | p1/p2/dorm | tenant:{id}
  priceMonth: string | null          // ''=初始版本
  ruleBranch: string | null          // tou/resident/commercial/tenant_override/fixed/pool
  poolRuleId: number | null
  poolName: string | null            // 公摊池名(S5 §3.2,detail 读时 join alloc_rule.name);非公摊行 null
  shareSrc: string | null            // member/area/floor
  baseSnap: number | null            // 公摊行=该户份额基数;损耗行=链基数金额
  amount: number
  note: string | null
  feeGroup: string | null            // rent/elec/water(V90):板块分组
}

export interface BillNoticeDetailDTO {
  id: number
  ym: string
  tenantId: number
  tenantName: string | null
  payCompanyId: number | null
  payCompanyName: string | null
  noticeKind: string
  premiseText: string | null
  totalAmount: number
  prevDue: number
  status: string
  warn: string | null
  lines: BillNoticeLineDTO[]
}

// generate 摘要:generated=新插单数;lines=行数;warned=带 warn 单数+因 issued 跳过的租户数
export interface BillNoticeGenResultDTO {
  generated: number
  lines: number
  warned: number
  batch: string
}

export const billNoticesApi = {
  // 某月全状态列表(含租户/收款公司名与行数)
  list: (ym: string): Promise<BillNoticeDTO[]> => http.get('/bill-notices', { params: { ym } }),
  detail: (id: number): Promise<BillNoticeDetailDTO> => http.get(`/bill-notices/${id}`),
  // 幂等:先删本月 draft/void 再插;有 issued 单的租户跳过并计入 warned
  generate: (ym: string): Promise<BillNoticeGenResultDTO> =>
    http.post('/bill-notices/generate', null, { params: { ym } }),
  // 仅 draft 可签发;签发后不被重跑覆盖
  issue: (id: number): Promise<BillNoticeDTO> => http.post(`/bill-notices/${id}/issue`),
  // draft/issued 可作废;已作废 409
  void: (id: number): Promise<BillNoticeDTO> => http.post(`/bill-notices/${id}/void`),
}
