import http from './index'
import type { ImportResultDTO } from '../types/import'
import type { MeterOwnership } from '../utils/meterSplit'

// 园区抄表(METER-SPEC)DTO — 逐字对齐后端 dto/Meter* / MeterImportRequest。
// GET=viewer 可读,写=admin。与办公室水电 /api/office 零共享。

export type MeterKind = 'elec' | 'water'
export type MeterZone = 'p1' | 'p2' | 'dorm'
export type { MeterOwnership }

// 表类型(S2-BIND-SPEC §1 device_type;meter_type 列已被「表类」原文占用故另立):null=未录
export type MeterDeviceType = 'single' | 'three' | 'multi' | 'demand' | 'bidir'
export const DEVICE_TYPE_LABEL: Record<MeterDeviceType, string> = {
  single: '单相', three: '三相', multi: '多功能', demand: '需量', bidir: '双向',
}

export interface MeterDTO {
  id: number
  kind: MeterKind
  zone: MeterZone
  name: string                  // 首列标识名,同区同类唯一
  area: string | null
  spot: string | null
  tenantName: string | null     // 企业名称原文(§6.1 未匹配兜底+对账审计)
  tenantId: number | null       // §6 v2:租户 FK,户内表关联;多命中待核=null
  buildingId: number | null     // §6 v2:楼栋 FK,区域→楼栋映射
  ownership: MeterOwnership     // §6 v2:tenant/share/ops/infra/park
  meterType: string | null
  deviceType: MeterDeviceType | null   // S2 V63:表类型(单相/三相/多功能/需量/双向)
  subName: string | null
  code: string | null
  factor: number                // 倍率
  retiredYm: string | null      // V68:自该账期起停用(含当月不计);null=在用
  sortNo: number
  readingCount: number
}

// 新增/编辑共用;PUT 带全量。factor 空=1。
export interface MeterReq {
  kind: MeterKind
  zone: MeterZone
  name: string
  area?: string | null
  spot?: string | null
  tenantName?: string | null
  tenantId?: number | null      // §6 v2
  buildingId?: number | null    // §6 v2
  ownership?: string            // §6 v2:tenant/share/ops/infra/park(表单串型,后端 VARCHAR;空=默认 share)
  meterType?: string | null
  deviceType?: string | null    // S2 V63:表类型
  subName?: string | null
  code?: string | null
  factor?: number | null
  retiredYm?: string | null     // V68 停用账期;null=在用(撤销停用)
}

// usage* = (curr−prev)×factorSnap 后端派生(缺读数=null);漏抄/倒走/时段不符徽标由 meterLogic 派生
export interface MeterReadingDTO {
  id: number
  meterId: number
  ym: string                    // YYYY-MM
  prevTotal: number | null
  currTotal: number | null
  prevSharp: number | null
  prevPeak: number | null
  prevFlat: number | null
  prevValley: number | null
  currSharp: number | null
  currPeak: number | null
  currFlat: number | null
  currValley: number | null
  factorSnap: number            // 倍率快照;改表倍率不回溯
  usageTotal: number | null
  usageSharp: number | null
  usagePeak: number | null
  usageFlat: number | null
  usageValley: number | null
  note: string | null
  source: 'manual' | 'import'
}

// factor_snap 落库时快照表倍率,req 不带
export interface MeterReadingReq {
  meterId: number
  ym: string
  prevTotal?: number | null
  currTotal?: number | null
  prevSharp?: number | null
  prevPeak?: number | null
  prevFlat?: number | null
  prevValley?: number | null
  currSharp?: number | null
  currPeak?: number | null
  currFlat?: number | null
  currValley?: number | null
  note?: string | null
}

// 导入行:kind/zone/name=档案 upsert 键;ym 逐行自带(整册各 sheet 月份可不同)
export interface MeterImportRow {
  kind: MeterKind
  zone: MeterZone
  name: string
  ym: string
  area?: string
  spot?: string
  tenantName?: string
  tenantId?: number | null      // §6 v2:解析期拆分挂 id,多命中/未命中=null
  buildingId?: number | null    // §6 v2:区域→楼栋映射
  ownership?: MeterOwnership    // §6 v2:归属自动分类
  meterType?: string
  subName?: string
  code?: string
  factor?: number
  prevTotal?: number | null
  currTotal?: number | null
  prevSharp?: number | null
  prevPeak?: number | null
  prevFlat?: number | null
  prevValley?: number | null
  currSharp?: number | null
  currPeak?: number | null
  currFlat?: number | null
  currValley?: number | null
  note?: string
}

// ── S2-BIND-SPEC §3:表→合同绑定(读侧派生,按账期月判定) ──
export type BindBucket = 'date_missing' | 'ambiguous' | 'bld_mismatch' | 'no_contract'
export type BindStatus =
  | 'auto' | 'auto_bld'            // 自动归属(候选唯一/楼栋对位唯一)
  | 'override' | 'override_stale'  // 人工绑定(stale=合同不覆盖 ym,警示不静默失效)
  | 'manual'                       // 待处理队列(带 bucket 分桶原因)
  | 'pending'                      // 待核:ownership=tenant 且 tenant_id NULL 且原文有意义
  | 'placeholder'                  // 占位槽:原文 NULL/'-'/'（空）'/'已停用',不计入待核收敛

export interface BindCandidateDTO {
  contractId: number
  contractNo: string
  buildingName: string | null
  startDate: string | null
  endDate: string | null
}

// rows 每块租户表;candidates 仅 manual 时给(供 UI 选定绑定)
export interface MeterBindingRowDTO {
  meterId: number
  status: BindStatus
  bucket?: BindBucket | null
  contractId?: number | null
  contractNo?: string | null
  candidates?: BindCandidateDTO[]
  hasReading: boolean
}

// summary=服务端各状态计数;UI 收敛卡用 summarizeBinding(rows) 客户端派生(rows 全量自足,免形状耦合)
export interface MeterBindingDTO {
  summary: Record<string, number>
  rows: MeterBindingRowDTO[]
}

// GET /meters/usage-summary?ym 户×月聚合(S3 输入面):仅 ownership=tenant 且 tenant_id 非空的表
export interface MeterUsageSummaryRowDTO {
  tenantId: number
  tenantName: string
  kind: MeterKind
  meterCount: number
  missingReadings: number
  usageTotal: number | null
  usageSharp: number | null
  usagePeak: number | null
  usageFlat: number | null
  usageValley: number | null
}

export const metersApi = {
  list: (kind?: MeterKind, zone?: MeterZone): Promise<MeterDTO[]> =>
    http.get('/meters', { params: { kind, zone } }),
  create: (req: MeterReq): Promise<MeterDTO> => http.post('/meters', req),
  // 同(kind,zone,name) 重名 409;改倍率只影响之后新录读数
  update: (id: number, req: MeterReq): Promise<MeterDTO> => http.put(`/meters/${id}`, req),
  // 有读数 409 守卫;不存在 404
  remove: (id: number): Promise<void> => http.delete(`/meters/${id}`),
  // 有读数的年份升序;空表=[](年选择器数据驱动)
  years: (): Promise<number[]> => http.get('/meters/years'),
  readings: (ym: string): Promise<MeterReadingDTO[]> => http.get('/meters/readings', { params: { ym } }),
  // 某表逐月历史(抽屉)
  meterReadings: (id: number): Promise<MeterReadingDTO[]> => http.get(`/meters/${id}/readings`),
  // factorSnap=当时表倍率快照;同表同月 409
  createReading: (req: MeterReadingReq): Promise<MeterReadingDTO> => http.post('/meters/readings', req),
  updateReading: (id: number, req: MeterReadingReq): Promise<MeterReadingDTO> =>
    http.put(`/meters/readings/${id}`, req),
  deleteReading: (id: number): Promise<void> => http.delete(`/meters/readings/${id}`),
  // 表按 (kind,zone,name) 建档/刷新,读数按 (表,ym) 幂等覆盖;行级错误跳过不整批拦
  importRows: (rows: MeterImportRow[]): Promise<ImportResultDTO> => http.post('/meters/import', { rows }),
  // ── S2-BIND-SPEC §3 ──
  // 归属覆盖率报表:summary+每块租户表状态行(选定月判定)
  binding: (ym: string): Promise<MeterBindingDTO> => http.get('/meters/binding', { params: { ym } }),
  // 写 override(contractId=null 解绑);校验合同存在
  bind: (id: number, contractId: number | null): Promise<void> =>
    http.put(`/meters/${id}/bind`, { contractId }),
  // 按 tenant_name 原文=租户档案名精确唯一匹配的待核表批量挂 tenant_id;幂等
  autoLinkByName: (): Promise<{ linked: number; skipped: number }> =>
    http.post('/meters/auto-link-by-name'),
  usageSummary: (ym: string): Promise<MeterUsageSummaryRowDTO[]> =>
    http.get('/meters/usage-summary', { params: { ym } }),
}
