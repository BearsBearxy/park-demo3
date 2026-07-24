import http from './index'
import type { ImportResultDTO } from '../types/import'
import type { MeterOwnership } from '../utils/meterSplit'

// 园区抄表(METER-SPEC)DTO — 逐字对齐后端 dto/Meter* / MeterImportRequest。
// GET=viewer 可读,写=admin。与办公室水电 /api/office 零共享。

export type MeterKind = 'elec' | 'water'
export type MeterZone = 'p1' | 'p2' | 'dorm'
export type { MeterOwnership }

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
  ownership: MeterOwnership     // §6 v2:tenant/share/ops/infra
  meterType: string | null
  subName: string | null
  code: string | null
  factor: number                // 倍率
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
  ownership?: string            // §6 v2:tenant/share/ops/infra(表单串型,后端 VARCHAR;空=默认 share)
  meterType?: string | null
  subName?: string | null
  code?: string | null
  factor?: number | null
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
}
