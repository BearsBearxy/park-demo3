import http from './index'
import type { ImportResultDTO } from '../types/import'

// 充电桩分桩明细(CP-METER-SPEC)DTO — 逐字对齐后端 dto/CpStation* / CpReading* / CpPowerUsage* / CpMeterImportRequest。
// 与附表7/8 /api/charging 完全独立(功能门只是入口分叉);GET=viewer 可读,写=admin。

export interface CpStationDTO {
  id: number
  name: string
  operator: string              // 运营商(自由文本:万城万/小桔/…)
  vehicleType: 'car' | 'ebike'  // 共享桩库带类型,汽车/电动车屏各显自己
  sortNo: number
}

// 桩新增/编辑共用;PUT 需带全量(行内只改运营商时 name/vehicleType 原样回传)
export interface CpStationReq {
  name: string
  operator: string
  vehicleType: 'car' | 'ebike'
}

export interface CpReadingDTO {
  id: number
  stationId: number
  stationName: string
  readDate: string              // YYYY-MM-DD;月份 = read_date 派生
  chargeKwh: number             // 充电量 kWh
  fee: number                   // 手续费 元
  revenue: number               // 收益 元(三金额全手填,从平台对账单抄,无自动换算)
  note: string | null              // simulated 行以「模拟:」开头写推导来源
  source: 'manual' | 'import' | 'simulated'
}

// PUT 时 stationId 必传但不生效(桩不可改)
export interface CpReadingReq {
  stationId: number
  readDate: string              // YYYY-MM-DD
  chargeKwh: number
  fee: number
  revenue: number
  note?: string | null
}

// 「电表与损耗」行(运营商×类型×月):meterKwh null=该月未录电表;
// lossKwh = 电表 − Σ该运营商该类型桩当月充电量,读时派生(可为负,前端黄警示不阻断)
export interface CpPowerUsageDTO {
  id: number | null
  operator: string
  vehicleType: 'car' | 'ebike'
  month: number                 // 行所属月 1..12(2026-07-20 后端增量:年视角区分月份;单月模式亦回填)
  meterKwh: number | null
  sumChargeKwh: number
  lossKwh: number | null
  note: string | null
}

export interface CpPowerUsageReq {
  operator: string
  vehicleType: 'car' | 'ebike'
  year: number
  month: number
  meterKwh: number
  note?: string | null
}

// 模拟填充摘要:filled=新写/修正的 simulated 充电记录+新插电表行,
// skipped=manual/import 占位、值未变的 simulated、已有电表行与缺桩(被改名/删除)
export interface CpSimulateResultDTO {
  filled: number
  skipped: number
}

// 导入行:station=桩名精确匹配;readDate 由前端把 Excel 日期序列转好;运营商列仅前端校验参考不上传
export interface CpMeterImportRow {
  station: string
  readDate: string
  chargeKwh: number
  fee: number
  revenue: number
  note?: string | null
}

export const cpMeterApi = {
  stations: (): Promise<CpStationDTO[]> => http.get('/cp-meter/stations'),
  // 重名 409
  createStation: (req: CpStationReq): Promise<CpStationDTO> => http.post('/cp-meter/stations', req),
  updateStation: (id: number, req: CpStationReq): Promise<CpStationDTO> =>
    http.put(`/cp-meter/stations/${id}`, req),
  // 有充电记录的桩 409 守卫;不存在 404
  deleteStation: (id: number): Promise<void> => http.delete(`/cp-meter/stations/${id}`),
  // 有充电记录的年份升序;空表=[](年选择器数据驱动)
  years: (): Promise<number[]> => http.get('/cp-meter/years'),
  // 有充电记录的账期全集('YYYY-MM' 升序);默认月取 max,替代逐月探测
  months: (): Promise<string[]> => http.get('/cp-meter/months'),
  // month 可空=全年(ENERGY-ANALYSIS-SPEC §4,充电桩分析屏年视角;传值行为不变)
  readings: (year: number, month?: number, stationId?: number): Promise<CpReadingDTO[]> =>
    http.get('/cp-meter/readings', { params: { year, month, stationId } }),
  // source=manual;同桩同日 409
  createReading: (req: CpReadingReq): Promise<CpReadingDTO> => http.post('/cp-meter/readings', req),
  updateReading: (id: number, req: CpReadingReq): Promise<CpReadingDTO> =>
    http.put(`/cp-meter/readings/${id}`, req),
  deleteReading: (id: number): Promise<void> => http.delete(`/cp-meter/readings/${id}`),
  // month 可空=各月并集(运营商×类型×12月;无电表月 meterKwh=null,分析屏断点用)
  powerUsage: (year: number, month?: number): Promise<CpPowerUsageDTO[]> =>
    http.get('/cp-meter/power-usage', { params: { year, month } }),
  // uk(运营商,类型,月)有则改无则插;返回带派生损耗的行
  upsertPowerUsage: (req: CpPowerUsageReq): Promise<CpPowerUsageDTO> =>
    http.put('/cp-meter/power-usage', req),
  // (桩,日)幂等 upsert;未知桩名/非法日期/负金额=行级错误跳过,不整批拦
  importRows: (rows: CpMeterImportRow[]): Promise<ImportResultDTO> =>
    http.post('/cp-meter/import', { rows }),
  // 按附表7/8 充电汇总推导分桩月末记录与电表用电量;只写空位与 simulated,绝不覆盖 manual/import;幂等
  simulate: (year: number): Promise<CpSimulateResultDTO> =>
    http.post('/cp-meter/simulate', null, { params: { year } }),
}
