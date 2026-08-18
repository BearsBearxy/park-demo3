import http from './index'
import type { ImportResultDTO } from '../types/import'

// 电费成本模型(ELEC-COST-SPEC)DTO — 逐字对齐后端 dto/ElecMeter* / ElecCostEntry* / ElecPriceCfg* /
// ElecSimulateResult / ElecMetric。与附表11 /api/elec 完全独立(功能门入口分叉,原功能零改动);
// GET=viewer 可读,写=admin(SecurityConfig 统一门)。

export type ElecMeterKind = 'master' | 'dorm' | 'ops'

export interface ElecMeterDTO {
  id: number
  name: string
  kind: ElecMeterKind
  sortNo: number
}

// 电表新增/编辑共用;改名自由(重名 409),有费项数据不可改 kind(409,服务层守卫)
export interface ElecMeterReq {
  name: string
  kind: ElecMeterKind
}

export interface ElecCostEntryDTO {
  id: number
  meterId: number
  meterName: string
  acctMonth: string            // YYYY-MM
  feeKey: string               // master=tou_industrial/basic_industrial/commercial/pv_grid_income/pf_reward;dorm=usage;ops=usage/allocated
  subKey: string               // ''=合计行;合计与拆分并存照返,黄警前端判(spec §3 拆分口径)
  amount: number
  qty: number | null           // 电量 kWh(可空,本屏不展示,导入可携带)
  note: string | null          // simulated 行以「模拟:」开头写推导来源
  source: 'manual' | 'import' | 'simulated'
}

// upsert 键=(meterId, acctMonth, feeKey, subKey 空串归一化);命中改无则插,source 统一置 manual
export interface ElecCostEntryReq {
  meterId: number
  acctMonth: string            // YYYY-MM
  feeKey: string
  subKey?: string | null
  amount: number
  qty?: number | null
  note?: string | null
}

export interface ElecPriceCfgDTO {
  cfgKey: string               // pv_grid_price / grid_posted_price / third_party_price / pf_reward_rate
  value: number | null         // 解析值:当月优先回退默认;两级都缺=null
  source: 'month' | 'default' | null
  monthValue: number | null    // 月度行原值(参数区分别编辑用)
  defaultValue: number | null  // 默认行原值
  note: string | null
}

// acctMonth 空串/null=默认行;value=null 删该行(月度行删除即回退默认)
export interface ElecPriceCfgReq {
  acctMonth?: string | null
  cfgKey: string
  value: number | null
  note?: string | null
}

// 导入行(长表:电表|费项|拆分|月份|金额|电量|备注);fee/split 收中文名
// (费项名↔fee_key 映射在后端 ElecCostService 为单一事实源,兼容直传 key)
export interface ElecCostImportRow {
  meter: string
  fee: string
  split?: string | null
  month: string                // YYYY-MM
  amount: number
  qty?: number | null
  note?: string | null
}

// 模拟填充摘要:filled=新写/修正的 simulated 行(含电价参数行),skipped=manual/import 占位或值未变
export interface ElecSimulateResultDTO {
  filled: number
  skipped: number
  byRule: Record<string, number>
}

// 派生指标卡(spec §1 说明 1-7);missing 非空 → value=null,前端置灰列缺失源。
// 7 键序=parkElecProfit/pvInvestIncome/pvLoss/basicElecProfit/chargingProfit/opsElecCost/sellAgreementPnl;
// pvLoss 为电量口径 kWh,其余为金额 元。
export interface ElecMetricDTO {
  key: string
  label: string
  value: number | null
  formulaText: string
  missing: string[]
}

// 年度派生指标序列一元素(ENERGY-ANALYSIS §4):month 1..12 × 7 卡;口径与单月 metrics 全等(后端同一计算体)
export interface ElecMetricsMonthDTO {
  month: number
  metrics: ElecMetricDTO[]
}

export const elecCostApi = {
  meters: (): Promise<ElecMeterDTO[]> => http.get('/elec-cost/meters'),
  createMeter: (req: ElecMeterReq): Promise<ElecMeterDTO> => http.post('/elec-cost/meters', req),
  updateMeter: (id: number, req: ElecMeterReq): Promise<ElecMeterDTO> =>
    http.put(`/elec-cost/meters/${id}`, req),
  // 有费项数据 409;不存在 404
  deleteMeter: (id: number): Promise<void> => http.delete(`/elec-cost/meters/${id}`),
  // 有数据年份升序;空表=[](年选择器数据驱动,同 pv-meter)
  years: (): Promise<number[]> => http.get('/elec-cost/years'),
  // 有录入的账期全集('YYYY-MM' 升序);默认月取 max,替代逐月探测
  months: (): Promise<string[]> => http.get('/elec-cost/months'),
  entries: (year: number, month: number): Promise<ElecCostEntryDTO[]> =>
    http.get('/elec-cost/entries', { params: { year, month } }),
  upsertEntry: (req: ElecCostEntryReq): Promise<ElecCostEntryDTO> => http.put('/elec-cost/entries', req),
  deleteEntry: (id: number): Promise<void> => http.delete(`/elec-cost/entries/${id}`),
  priceCfg: (acctMonth?: string): Promise<ElecPriceCfgDTO[]> =>
    http.get('/elec-cost/price-cfg', { params: { acctMonth } }),
  savePriceCfg: (req: ElecPriceCfgReq): Promise<void> => http.put('/elec-cost/price-cfg', req),
  // (表,月,费项,拆分) upsert 幂等;未知表名/费项等=行级错误跳过,不整批拦
  importRows: (rows: ElecCostImportRow[]): Promise<ImportResultDTO> =>
    http.post('/elec-cost/import', { rows }),
  // 只写空位与既有 simulated 行,绝不覆盖 manual/import;幂等(第二跑值未变 filled=0)
  simulate: (year: number): Promise<ElecSimulateResultDTO> =>
    http.post('/elec-cost/simulate', null, { params: { year } }),
  metrics: (year: number, month: number): Promise<ElecMetricDTO[]> =>
    http.get('/elec-cost/metrics', { params: { year, month } }),
  // 12 元素月序(1..12),空月各卡 value=null(缺失源列于 missing)
  metricsYear: (year: number): Promise<ElecMetricsMonthDTO[]> =>
    http.get('/elec-cost/metrics-year', { params: { year } }),
}
