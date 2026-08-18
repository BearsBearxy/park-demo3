// 光伏分栋抄表 Excel 全家桶(PV-METER-SPEC §3):导入行解析 + 模板生成 + 月度汇总导出。
// 导入 = 单 sheet 长表(一行 = 一站一日),表头按名识别(matchByHeader,含别名/单位后缀前缀匹配);
// 行级校验(日期可识别、三量≥0)错误逐行报告不整批拦;未知站名由后端行级 ImportError 报告。
// 期数列仅校验参考,捕获进预览但不上传(spec §3)。
// AOA 构建为纯函数(pvMeterExcel.spec.ts 锁定);出流走 utils/sheet.ts 适配层(exceljs,内部懒加载)。
import { writeAoaWorkbook } from './sheet'
import { matchByHeader, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'

export interface PvMeterImportError { rowIndex: number; label: string; reason: string }

// 模板列 = 后端契约字段顺序;__preview 与此对齐(FpImportModal 预览表按 templateCols 逐列取)
export const PV_METER_TEMPLATE_COLS = ['期数', '楼栋', '日期', '发电总量(kWh)', '自消纳电量(kWh)', '上网电量(kWh)', '备注']

// 别名兼容真实抄表口头变体(自销纳/消纳/上网量);前缀匹配自动扛「(kWh)」等单位后缀
const PV_METER_COLUMN_MAP: ColumnMapEntry[] = [
  { label: '期数', key: 'phaseRaw', text: true },   // 仅校验参考,不上传;占列防其被误判为楼栋列
  { label: '日期', key: 'dateRaw', text: true, aliases: ['抄表日期'] },
  { label: '发电总量', key: 'genTotal', aliases: ['发电量'] },
  { label: '自消纳电量', key: 'selfUse', aliases: ['自销纳电量', '消纳电量'] },
  { label: '上网电量', key: 'gridFeed', aliases: ['上网量'] },
  { label: '备注', key: 'noteRaw', text: true },
]

// ── 日期解析:YYYY-MM-DD / YYYY/M/D / YYYY年M月D日 / Excel 日期序列 ──
// FpImportModal 读文件走 utils/sheet.ts → 日期格已归一成 'yyyy-mm-dd' 字符串;
// 粘贴路径或未设日期格式的单元格可能是裸序列号字符串(如 '45658'),按 1899-12-30 epoch 换算
// (与 parseYearMonth 同口径,吃掉 1900 非闰年 bug)。非法/聚合串 → null,调用方收行级错误。
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

function fmtDate(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  // 年域收口 + 真实日校验(2026-02-30 之类经 Date 溢出会变 3 月 → 判非法)
  if (y < 2000 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parsePvReadDate(cell: unknown): string | null {
  if (cell == null || cell === '') return null
  const s = String(cell).trim()
  const m = s.match(/^(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?$/)
  if (m) return fmtDate(+m[1], +m[2], +m[3])
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s))
    if (n > 60 && n < 120000) {
      const d = new Date(EXCEL_EPOCH + n * 86400000)
      return fmtDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
  }
  return null
}

// ── 导入行解析(纯函数,供 importRegistry customParse) ──────────
// 返回 records = 后端 POST /api/pv-meter/import 行契约 {station, readDate, genTotal, selfUse, gridFeed, note};
// errors 行级(rowIndex≥0)不整批拦,表头识别失败为整批错误(rowIndex=-1)。
// 楼栋名非空由 matchByHeader 保证(空名行/合计行在关键列扫描时已静默剔除)。
export function parsePvMeterRows(matrix: string[][]): { records: ImportRec[]; errors: PvMeterImportError[] } {
  const { records: matched, error } = matchByHeader(matrix, PV_METER_COLUMN_MAP, ['楼栋', '电站'])
  if (error) return { records: [], errors: [{ rowIndex: -1, label: '', reason: error }] }

  const records: ImportRec[] = []
  const errors: PvMeterImportError[] = []
  matched.forEach((r, i) => {
    const station = String(r.tenantName).trim()
    const readDate = parsePvReadDate(r.dateRaw)
    if (!readDate) {
      errors.push({ rowIndex: i, label: `${station} ${String(r.dateRaw ?? '').trim()}`, reason: '日期无法识别(需 YYYY-MM-DD 或 Excel 日期格)' })
      return
    }
    const genTotal = (r.genTotal as number) ?? 0
    const selfUse = (r.selfUse as number) ?? 0
    const gridFeed = (r.gridFeed as number) ?? 0
    if (genTotal < 0 || selfUse < 0 || gridFeed < 0) {
      errors.push({ rowIndex: i, label: `${station} ${readDate}`, reason: '电量不能为负' })
      return
    }
    const note = String(r.noteRaw ?? '').trim() || undefined
    records.push({
      station, readDate, genTotal, selfUse, gridFeed, note,
      __preview: [String(r.phaseRaw ?? ''), station, readDate, genTotal, selfUse, gridFeed, note ?? ''],
    })
  })
  return { records, errors }
}

// ── 模板生成(spec §3:表头 + 两行示例,示例站名 = 真实种子站) ──────
export function buildPvMeterTemplateAoa(): (string | number)[][] {
  return [
    PV_METER_TEMPLATE_COLS,
    ['一期', 'B座', '2026-07-01', 1250.5, 800, 450.5, ''],
    ['二期', '8栋', '2026-07-31', 3600, 2800, 800, '月抄用当月任意日期(建议月末);同站同日重复导入自动覆盖'],
  ]
}

export async function buildPvMeterTemplate(): Promise<void> {
  await writeAoaWorkbook('光伏抄表导入模板.xlsx',
    [{ name: '光伏抄表', aoa: buildPvMeterTemplateAoa() }])
}

// ── 月度汇总导出:一行一电站(含无数据站,方便盯漏抄),末行合计 ──────
// 结构化最小类型(与 api/pvMeter.ts DTO 结构兼容,不 import 以保双代理并行独立)
export interface PvMeterStationLite {
  id: number; name: string; phase: number
  capacityKwp?: number | null; priceYuan?: number | null
}
export interface PvMeterReadingLite {
  stationId: number; genTotal: number; selfUse: number; gridFeed: number
  priceSnap?: number | null; revenue?: number | null   // revenue = 后端派生 selfUse×priceSnap;缺省时本地兜底同口径
  readDate?: string; note?: string | null              // 明细 sheet 用;缺省时明细行日期/备注为空
}

const PHASE_NAME: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期' }
const round2 = (n: number) => Math.round(n * 100) / 100

export function buildPvMeterMonthAoa(
  rows: PvMeterReadingLite[], stations: PvMeterStationLite[], year: number, month: number,
): (string | number)[][] {
  type Acc = { gen: number; self: number; grid: number; rev: number; cnt: number }
  const byStation = new Map<number, Acc>()
  for (const r of rows) {
    const a = byStation.get(r.stationId) ?? { gen: 0, self: 0, grid: 0, rev: 0, cnt: 0 }
    a.gen += Number(r.genTotal) || 0
    a.self += Number(r.selfUse) || 0
    a.grid += Number(r.gridFeed) || 0
    a.rev += Number(r.revenue ?? (Number(r.selfUse) || 0) * (Number(r.priceSnap) || 0)) || 0
    a.cnt += 1
    byStation.set(r.stationId, a)
  }
  const aoa: (string | number)[][] = [
    [`光伏分栋抄表汇总 · ${year}年${month}月`],
    ['期数', '电站', '装机容量(kWp)', '消纳单价(元/kWh)', '发电总量(kWh)', '自消纳电量(kWh)', '上网电量(kWh)', '消纳收益(元)', '抄表条数'],
  ]
  const t: Acc = { gen: 0, self: 0, grid: 0, rev: 0, cnt: 0 }
  for (const s of stations) {
    const a = byStation.get(s.id) ?? { gen: 0, self: 0, grid: 0, rev: 0, cnt: 0 }
    t.gen += a.gen; t.self += a.self; t.grid += a.grid; t.rev += a.rev; t.cnt += a.cnt
    aoa.push([PHASE_NAME[s.phase] ?? String(s.phase), s.name, s.capacityKwp ?? '', s.priceYuan ?? '',
      round2(a.gen), round2(a.self), round2(a.grid), round2(a.rev), a.cnt])
  }
  aoa.push([`合计 · ${stations.length} 站`, '', '', '', round2(t.gen), round2(t.self), round2(t.grid), round2(t.rev), t.cnt])
  return aoa
}

// ── 明细 sheet:一行一抄表记录,列=导入模板七列(表头同 PV_METER_TEMPLATE_COLS)──
// 错价修正回路(P0-3):导出文件可直接重导——改站价后导出明细,改量重导即按当前站价重新快照。
// 行序:站库 sort 序 → 日期升序,方便逐站核对。
export function buildPvMeterDetailAoa(
  rows: PvMeterReadingLite[], stations: PvMeterStationLite[],
): (string | number)[][] {
  const idx = new Map(stations.map((s, i) => [s.id, i]))
  const sorted = rows.slice().sort((a, b) =>
    (idx.get(a.stationId) ?? 999) - (idx.get(b.stationId) ?? 999)
    || String(a.readDate ?? '').localeCompare(String(b.readDate ?? '')))
  return [
    PV_METER_TEMPLATE_COLS,
    ...sorted.map((r): (string | number)[] => {
      const s = stations[idx.get(r.stationId) ?? -1]
      return [
        s ? (PHASE_NAME[s.phase] ?? String(s.phase)) : '',
        s?.name ?? '',
        r.readDate ?? '',
        Number(r.genTotal) || 0, Number(r.selfUse) || 0, Number(r.gridFeed) || 0,
        r.note ?? '',
      ]
    }),
  ]
}

export async function exportPvMeterMonth(
  rows: PvMeterReadingLite[], stations: PvMeterStationLite[], year: number, month: number,
): Promise<void> {
  await writeAoaWorkbook(`光伏抄表汇总-${year}年${String(month).padStart(2, '0')}月.xlsx`, [
    { name: `${year}年${month}月`, aoa: buildPvMeterMonthAoa(rows, stations, year, month) },
    // 第二 sheet「明细」= 导入模板格式,支持导出→改→重导的修正闭环
    { name: '明细', aoa: buildPvMeterDetailAoa(rows, stations) },
  ])
}
