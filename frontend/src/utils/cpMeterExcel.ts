// 充电桩分桩明细 Excel 全家桶(CP-METER-SPEC §3):导入行解析 + 模板生成 + 月度汇总导出。
// 与 pvMeterExcel.ts 同构:导入 = 单 sheet 长表(一行 = 一桩一日),表头按名识别(matchByHeader,含别名/单位后缀前缀匹配);
// 行级校验(日期可识别、三金额≥0)错误逐行报告不整批拦;未知桩名由后端行级 ImportError 报告。
// 运营商列仅校验参考,捕获进预览但不上传(spec §3);电表用电量不进导入模板(页面手录)。
// AOA 构建为纯函数(cpMeterExcel.spec.ts 锁定);出流走 utils/sheet.ts 适配层(exceljs,内部懒加载)。
import { writeAoaWorkbook } from './sheet'
import { matchByHeader, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'
import { parsePvReadDate } from './pvMeterExcel'   // ponytail: 日期双格式解析直接复用光伏的(同口径同 epoch)

export interface CpMeterImportError { rowIndex: number; label: string; reason: string }

// 模板列 = 后端契约字段顺序;__preview 与此对齐(FpImportModal 预览表按 templateCols 逐列取)
export const CP_METER_TEMPLATE_COLS = ['运营商', '桩名', '日期', '充电量(kWh)', '手续费(元)', '收益(元)', '备注']

// 别名兼容平台对账单口头变体(平台/时间/服务费/收入);前缀匹配自动扛「(元)」「(kWh)」等单位后缀
const CP_METER_COLUMN_MAP: ColumnMapEntry[] = [
  { label: '运营商', key: 'operatorRaw', text: true, aliases: ['平台'] },   // 仅校验参考,不上传;占列防其被误判为桩名列
  { label: '日期', key: 'dateRaw', text: true, aliases: ['时间'] },
  { label: '充电量', key: 'chargeKwh' },
  { label: '手续费', key: 'fee', aliases: ['服务费'] },
  { label: '收益', key: 'revenue', aliases: ['收入'] },
  { label: '备注', key: 'noteRaw', text: true },
]

// ── 导入行解析(纯函数,供 importRegistry customParse) ──────────
// 返回 records = 后端 POST /api/cp-meter/import 行契约 {station, readDate, chargeKwh, fee, revenue, note};
// errors 行级(rowIndex≥0)不整批拦,表头识别失败为整批错误(rowIndex=-1)。
// 桩名非空由 matchByHeader 保证(空名行/合计行在关键列扫描时已静默剔除)。
export function parseCpMeterRows(matrix: string[][]): { records: ImportRec[]; errors: CpMeterImportError[] } {
  const { records: matched, error } = matchByHeader(matrix, CP_METER_COLUMN_MAP, ['桩名', '充电桩', '站点'])
  if (error) return { records: [], errors: [{ rowIndex: -1, label: '', reason: error }] }

  const records: ImportRec[] = []
  const errors: CpMeterImportError[] = []
  matched.forEach((r, i) => {
    const station = String(r.tenantName).trim()
    const readDate = parsePvReadDate(r.dateRaw)
    if (!readDate) {
      errors.push({ rowIndex: i, label: `${station} ${String(r.dateRaw ?? '').trim()}`, reason: '日期无法识别(需 YYYY-MM-DD 或 Excel 日期格)' })
      return
    }
    const chargeKwh = (r.chargeKwh as number) ?? 0
    const fee = (r.fee as number) ?? 0
    const revenue = (r.revenue as number) ?? 0
    if (chargeKwh < 0 || fee < 0 || revenue < 0) {
      errors.push({ rowIndex: i, label: `${station} ${readDate}`, reason: '充电量/手续费/收益不能为负' })
      return
    }
    const note = String(r.noteRaw ?? '').trim() || undefined
    records.push({
      station, readDate, chargeKwh, fee, revenue, note,
      __preview: [String(r.operatorRaw ?? ''), station, readDate, chargeKwh, fee, revenue, note ?? ''],
    })
  })
  return { records, errors }
}

// ── 模板生成(spec §3:表头 + 两行示例,示例桩名 = 真实种子桩) ──────
export function buildCpMeterTemplateAoa(): (string | number)[][] {
  return [
    CP_METER_TEMPLATE_COLS,
    ['小桔', '快充1', '2026-07-01', 850.5, 42.5, 680, ''],
    ['万城万', '万城万', '2026-07-31', 1200, 60, 960, '同桩同日重复导入自动覆盖;三金额从平台对账单抄录'],
  ]
}

export async function buildCpMeterTemplate(): Promise<void> {
  await writeAoaWorkbook('充电桩明细导入模板.xlsx',
    [{ name: '充电桩明细', aoa: buildCpMeterTemplateAoa() }])
}

// ── 月度汇总导出:一行一桩(含无数据桩零值行,方便盯漏录),末行合计 ──────
// 不含电表损耗小节——那是屏内展示(spec §2),导出只镜像主表。
// 结构化最小类型(与 api/cpMeter.ts DTO 结构兼容,不 import 以保双代理并行独立)
export interface CpMeterStationLite { id: number; name: string; operator: string }
export interface CpMeterReadingLite { stationId: number; chargeKwh: number; fee: number; revenue: number }

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildCpMeterMonthAoa(
  rows: CpMeterReadingLite[], stations: CpMeterStationLite[], year: number, month: number,
): (string | number)[][] {
  type Acc = { kwh: number; fee: number; rev: number; cnt: number }
  const byStation = new Map<number, Acc>()
  for (const r of rows) {
    const a = byStation.get(r.stationId) ?? { kwh: 0, fee: 0, rev: 0, cnt: 0 }
    a.kwh += Number(r.chargeKwh) || 0
    a.fee += Number(r.fee) || 0
    a.rev += Number(r.revenue) || 0
    a.cnt += 1
    byStation.set(r.stationId, a)
  }
  const aoa: (string | number)[][] = [
    [`充电桩分桩明细汇总 · ${year}年${month}月`],
    ['桩名', '运营商', '充电量(kWh)', '手续费(元)', '收益(元)', '记录条数'],
  ]
  const t: Acc = { kwh: 0, fee: 0, rev: 0, cnt: 0 }
  for (const s of stations) {
    const a = byStation.get(s.id) ?? { kwh: 0, fee: 0, rev: 0, cnt: 0 }
    t.kwh += a.kwh; t.fee += a.fee; t.rev += a.rev; t.cnt += a.cnt
    aoa.push([s.name, s.operator, round2(a.kwh), round2(a.fee), round2(a.rev), a.cnt])
  }
  aoa.push([`合计 · ${stations.length} 桩`, '', round2(t.kwh), round2(t.fee), round2(t.rev), t.cnt])
  return aoa
}

export async function exportCpMeterMonth(
  rows: CpMeterReadingLite[], stations: CpMeterStationLite[], year: number, month: number,
): Promise<void> {
  await writeAoaWorkbook(`充电桩明细汇总-${year}年${String(month).padStart(2, '0')}月.xlsx`,
    [{ name: `${year}年${month}月`, aoa: buildCpMeterMonthAoa(rows, stations, year, month) }])
}
