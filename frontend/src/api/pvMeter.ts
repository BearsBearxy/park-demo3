import http from './index'
import type { ImportResultDTO } from '../types/import'

// 光伏分栋抄表(PV-METER-SPEC)DTO — 逐字对齐后端 dto/PvStation* / PvReading* / PvMeterImportRequest。
// 与附表6 /api/pv 完全独立;GET=viewer 可读,写=admin。

export interface PvStationDTO {
  id: number
  name: string
  phase: number                // 1/2/3
  metered: number              // 1=已装光伏计量表 0=未安装(不入任何分析;与「装了表但漏抄」是两回事)
  capacityKwp: number | null   // 装机容量 kWp(可空)
  panelCount: number | null    // 光伏板数量(块,可空)
  panelWatt: number | null     // 单块标称功率 W(可空;理论装机 = panelCount × panelWatt ÷ 1000)
  priceYuan: number | null     // 消纳综合单价 元/kWh(可空)
  sortNo: number
}

// 电站新增/编辑共用;PUT 需带全量(行内只改单价时 name/phase 原样回传)
export interface PvStationReq {
  name: string
  phase: number
  capacityKwp?: number | null
  priceYuan?: number | null
  panelCount?: number | null
  panelWatt?: number | null
}

export interface PvReadingDTO {
  id: number
  stationId: number
  stationName: string
  readDate: string             // YYYY-MM-DD;发电月份 = read_date 派生
  genTotal: number
  selfUse: number
  gridFeed: number
  priceSnap: number | null     // 单价快照(可空=录入时站未配价);调站价不漂移历史
  revenue: number              // 派生:selfUse × priceSnap(无快照按 0)
  note: string | null          // simulated 行以「模拟:」开头写推导来源
  source: 'manual' | 'import' | 'simulated'
}

// 模拟填充摘要:filled=补的站配置(容量/单价空位)+新写/修正的 simulated 抄表记录,
// skipped=manual/import 占位、值未变的 simulated 与缺站(该期该月无可分容量)
export interface PvSimulateResultDTO {
  filled: number
  skipped: number
}

// PUT 时 stationId 必传但不生效(站不可改),price_snap 保持原快照
export interface PvReadingReq {
  stationId: number
  readDate: string             // YYYY-MM-DD
  genTotal: number
  selfUse: number
  gridFeed: number
  note?: string | null
}

// 导入行:station=楼栋名精确匹配;readDate 由前端把 Excel 日期序列转好;期数列仅前端校验参考不上传
export interface PvMeterImportRow {
  station: string
  readDate: string
  genTotal: number
  selfUse: number
  gridFeed: number
  note?: string | null
}

export const pvMeterApi = {
  stations: (): Promise<PvStationDTO[]> => http.get('/pv-meter/stations'),
  createStation: (req: PvStationReq): Promise<PvStationDTO> => http.post('/pv-meter/stations', req),
  // 名称/期数/容量/单价均可改;重名 409
  updateStation: (id: number, req: PvStationReq): Promise<PvStationDTO> =>
    http.put(`/pv-meter/stations/${id}`, req),
  // 有抄表记录的年份升序;空表=[](年选择器数据驱动)
  years: (): Promise<number[]> => http.get('/pv-meter/years'),
  // 有抄表记录的账期全集('YYYY-MM' 升序);默认月取 max,替代逐月探测
  months: (): Promise<string[]> => http.get('/pv-meter/months'),
  // 有抄表记录的站 409 守卫;不存在 404
  deleteStation: (id: number): Promise<void> => http.delete(`/pv-meter/stations/${id}`),
  readings: (year: number, month: number, stationId?: number): Promise<PvReadingDTO[]> =>
    http.get('/pv-meter/readings', { params: { year, month, stationId } }),
  // month 放开可空=全年(ENERGY-ANALYSIS-SPEC §4):分析层年视角(PvRoiView 分栋抄表分析)
  readingsYear: (year: number): Promise<PvReadingDTO[]> =>
    http.get('/pv-meter/readings', { params: { year } }),
  // price_snap=当时站单价快照;同站同日 409
  createReading: (req: PvReadingReq): Promise<PvReadingDTO> => http.post('/pv-meter/readings', req),
  updateReading: (id: number, req: PvReadingReq): Promise<PvReadingDTO> =>
    http.put(`/pv-meter/readings/${id}`, req),
  deleteReading: (id: number): Promise<void> => http.delete(`/pv-meter/readings/${id}`),
  // (站,日)幂等 upsert;未知站名/非法日期/负量=行级错误跳过,不整批拦
  importRows: (rows: PvMeterImportRow[]): Promise<ImportResultDTO> =>
    http.post('/pv-meter/import', { rows }),
  // 按附表6 phase 月度汇总反推站容量/单价(只填空位)并按容量占比拆分各栋月末记录;
  // 只写空位与 simulated,绝不覆盖 manual/import;幂等
  simulate: (year: number): Promise<PvSimulateResultDTO> =>
    http.post('/pv-meter/simulate', null, { params: { year } }),
}
