import http from './index'

// 公摊分摊(PB-ALLOCATION-SPEC)DTO — 逐字对齐后端 dto/Alloc*。
// GET=viewer 可读,写=admin。用量唯一来源=P-A meter_reading 派生;本域出口=alloc_result(P-C 契约)。

export type AllocZone = 'p1' | 'p2'
export type AllocMethod = 'direct' | 'area' | 'floor' | 'loss'
export type AllocFeeKey =
  | 'share_elec_fire' | 'share_elec_elevator' | 'share_elec_light'
  | 'share_elec_floor' | 'share_elec_loss' | 'share_water'

export interface AllocMemberDTO {
  tenantId: number
  weight: number | null          // floor=层份额(1/0.5/null=层内按面积二拆);area/direct=忽略
}

export interface AllocRuleDTO {
  id: number
  zone: AllocZone
  name: string
  buildingId: number | null
  method: AllocMethod
  coefficient: number | null     // area=受益面积Σ㎡;floor=层数(可小数)
  extraQty: number               // 人工加度(电梯+170 等)
  feeKey: AllocFeeKey
  note: string | null
  sortNo: number
  meterIds: number[]
  members: AllocMemberDTO[]
}

export interface AllocRuleReq {
  zone: AllocZone
  name: string
  buildingId?: number | null
  method: AllocMethod
  coefficient?: number | null
  extraQty?: number | null
  feeKey: AllocFeeKey
  note?: string | null
  meterIds: number[]
  members: AllocMemberDTO[]
}

// 参数原值行(acctMonth ''=默认行);解析「月行优先回退默认」用 allocLogic.resolveCfg
export interface AllocCfgDTO {
  id: number
  scope: string                  // p1/p2 或 building:{id}
  cfgKey: string
  value: number | null
  acctMonth: string              // ''=默认行
  note: string | null
}

export interface AllocCfgReq {
  scope: string
  cfgKey: string
  acctMonth?: string | null      // 空=默认行
  value: number | null           // null=删行回退默认
  note?: string | null
}

export interface AllocResultDTO {
  id: number
  tenantId: number
  tenantName: string | null
  buildingId: number | null
  buildingName: string | null
  ym: string
  feeKey: AllocFeeKey
  ruleId: number | null          // 损耗行/manual/多规则合并=null
  qty: number | null
  amount: number
  rateSnap: number | null        // 损耗率/元每层/元每㎡ 快照
  priceSnap: number | null
  source: 'gen' | 'manual'
  note: string | null
  generatedAt: string
}

export interface AllocGenerateResultDTO {
  rows: number
  tenants: number
  manualKept: number
  warnings: string[]
}

// 抽屉逐费项明细(表级现算):stale=现算≠快照「读数已变,可重新生成」
export interface AllocDetailRowDTO {
  feeKey: AllocFeeKey
  ruleId: number | null
  ruleName: string | null
  qty: number | null
  amount: number
  rateSnap: number | null
  priceSnap: number | null
  source: 'gen' | 'manual'
  note: string | null
  liveAmount: number | null
  stale: boolean
}

export interface AllocManualReq {
  tenantId: number
  ym: string
  feeKey: string
  qty?: number | null
  amount: number
  note?: string | null
}

// 损耗率表一行(读时派生):lossQty=分表Σ−总表(负=有损耗)
export interface AllocLossRowDTO {
  zone: AllocZone
  buildingId: number
  buildingName: string
  headQty: number
  subQty: number
  lossQty: number
  rawRate: number | null
  shareQty: number
  adjQty: number
  adjRate: number | null
  tenantRate: number | null
}

// 对账一行:行=规则(+损耗组 ruleId=null);diff=已分摊−成本(正盈负亏)
export interface AllocReconRowDTO {
  ruleId: number | null
  name: string
  zone: AllocZone
  feeKey: AllocFeeKey
  qty: number
  price: number | null
  costAmount: number | null
  allocated: number
  diff: number | null
}

export interface AllocReconDTO {
  lossRows: AllocLossRowDTO[]
  rows: AllocReconRowDTO[]
  allocSum: number               // 本月分摊合计(互认提示:vs 电费成本模型 allocated)
  elecCostAllocated: number
}

export const allocApi = {
  // 抄表年∪结果年升序(年下拉数据驱动)
  years: (): Promise<number[]> => http.get('/alloc/years'),
  rules: (zone?: AllocZone): Promise<AllocRuleDTO[]> => http.get('/alloc/rules', { params: { zone } }),
  createRule: (req: AllocRuleReq): Promise<AllocRuleDTO> => http.post('/alloc/rules', req),
  updateRule: (id: number, req: AllocRuleReq): Promise<AllocRuleDTO> => http.put(`/alloc/rules/${id}`, req),
  // 有分摊结果 409;不存在 404
  deleteRule: (id: number): Promise<void> => http.delete(`/alloc/rules/${id}`),
  cfg: (ym: string): Promise<AllocCfgDTO[]> => http.get('/alloc/cfg', { params: { ym } }),
  saveCfg: (req: AllocCfgReq): Promise<void> => http.put('/alloc/cfg', req),
  // 按 ym 先删后插 gen 行幂等;manual 保留;返回缺抄警告清单
  generate: (ym: string): Promise<AllocGenerateResultDTO> =>
    http.post('/alloc/generate', null, { params: { ym } }),
  result: (ym: string): Promise<AllocResultDTO[]> => http.get('/alloc/result', { params: { ym } }),
  resultDetail: (tenantId: number, ym: string): Promise<AllocDetailRowDTO[]> =>
    http.get(`/alloc/result/${tenantId}`, { params: { ym } }),
  saveManual: (req: AllocManualReq): Promise<AllocResultDTO> => http.post('/alloc/result/manual', req),
  // 仅 manual 行可删;gen 行 409
  deleteResult: (id: number): Promise<void> => http.delete(`/alloc/result/${id}`),
  recon: (ym: string): Promise<AllocReconDTO> => http.get('/alloc/recon', { params: { ym } }),
}
