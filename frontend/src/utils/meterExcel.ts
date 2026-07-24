// 园区抄表 Excel 全家桶(METER-SPEC §4):整册多 sheet 解析 + 模板生成 + 当月导出。
// 真实源文件 = 202405水电表数据表.xlsx 六 sheet(一期/二期/宿舍 × 电/水)及水电费工作簿内同构 sheet。
// 识别双闸门:①标题行含「YYYY年M月…抄表记录」并带 分区/类别 关键词(sheet 名兜底);
//            ②表头行(含「区域」)必须同时有 上月行至+本月行至——挡掉标题被复制串味的分摊 sheet。
// 未识别 sheet 静默跳过(整册常混上百张租户缴费单 sheet)。
// 已知脏数据(审计实测):幽灵行列(blankrows:false 已剔空行,列按映射索引取不受游离列影响)、
// 缺本月读数(=漏抄,照收 null 不报错——进系统标黄,而不是像手工表算出负 231 万度)。
import type { ImportRec } from './importHeaderMatch'
import { splitTenantSpot, classifyOwnership, buildingIdFor, OWNERSHIP_LABEL } from './meterSplit'

export interface MeterSheetSection { label: string; records: ImportRec[] }

// v2 结构化拆分(§6.2/§6.3)要的主数据;缺省=空(正则拆分照跑,租户/楼栋不挂 id、待核兜底)。
// tenants.id 可缺:视图只喂 tenantNames 的后备路径=按名匹配但 tenantId 置空。
export interface MeterMasterCtx {
  tenants?: { id?: number; companyName: string }[]
  buildings?: { id: number; name: string }[]
}

export const METER_ZONE_LABEL: Record<string, string> = { p1: '一期', p2: '二期', dorm: '宿舍' }
export const METER_KIND_LABEL: Record<string, string> = { elec: '电表', water: '水表' }

// FpImportModal 预览表列(__preview 与此对齐,§6.4 拆分结果);模板是 6-sheet 骨架另走 buildMeterTemplate
export const METER_TEMPLATE_COLS = ['期数', '楼栋', '方位', '租户', '归属', '倍率', '上月总', '本月总']

const cleanNum = (v: unknown): number | null => {
  if (v == null) return null
  const s = String(v).replace(/[,，\s]/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const cellStr = (row: string[] | undefined, i: number): string => String(row?.[i] ?? '').trim()

// ── sheet 识别:标题行(前4行)取 月份+分区+类别;标题缺分区/类别时用 sheet 名兜底 ──
function detectSheet(name: string, matrix: string[][]): { zone: string; kind: string; ym: string } | null {
  for (let r = 0; r < Math.min(4, matrix.length); r++) {
    for (const cell of matrix[r] ?? []) {
      const s = String(cell ?? '')
      const m = s.match(/(\d{4})年(\d{1,2})月.*抄表记录/)
      if (!m) continue
      const ym = `${m[1]}-${String(+m[2]).padStart(2, '0')}`
      const src = s + '|' + name
      const zone = /一期/.test(src) ? 'p1' : /二期/.test(src) ? 'p2' : /宿舍/.test(src) ? 'dorm' : null
      const kind = /电表/.test(src) ? 'elec' : /水表/.test(src) ? 'water' : null
      return zone && kind ? { zone, kind, ym } : null
    }
  }
  return null
}

// ── 单 sheet 解析(纯函数,spec 锁定) ──
export function parseMeterSheet(name: string, matrix: string[][], master: MeterMasterCtx = {}): MeterSheetSection | null {
  const det = detectSheet(name, matrix)
  if (!det) return null
  // 表头行 = 含「区域」的行;闸门②:同行必须有 上月行至+本月行至(挡串味标题的分摊 sheet)
  let h = -1
  for (let r = 0; r < Math.min(8, matrix.length); r++) {
    const row = (matrix[r] ?? []).map(c => String(c ?? '').trim())
    if (row.includes('区域') && row.some(c => c.startsWith('上月行至')) && row.some(c => c.startsWith('本月行至')))
      { h = r; break }
  }
  if (h < 0) return null
  const header = (matrix[h] ?? []).map(c => String(c ?? '').trim())
  const idx = (pred: (c: string) => boolean) => header.findIndex(pred)
  const areaCol = idx(c => c === '区域')
  const tenantCol = idx(c => c === '企业名称')
  const typeCol = idx(c => c === '表类')
  const subCol = idx(c => /^(电表|水表)名称$/.test(c))
  const codeCol = idx(c => /^(电表|水表)编码$/.test(c))
  const factorCol = idx(c => /^(电表|水表)?倍率$/.test(c))
  const noteCol = idx(c => c === '备注')
  const prevCol = idx(c => c.startsWith('上月行至'))
  const currCol = idx(c => c.startsWith('本月行至'))
  // TOU 版式:表头下一行 prevCol 处为「总」(电表尖峰平谷子头);水表/无子头=单列
  const sub = (matrix[h + 1] ?? []).map(c => String(c ?? '').trim())
  const tou = sub[prevCol] === '总'
  const dataStart = h + (tou ? 2 : 1)
  // v2 主数据(§6.2/§6.3):租户库名单+按名挂 id;楼栋清单按 name 映射
  const tenants = master.tenants ?? []
  const buildings = master.buildings ?? []
  const tenantNames = tenants.map(t => t.companyName)
  const idByName = new Map(tenants.filter(t => t.id != null).map(t => [t.companyName, t.id as number]))

  const records: ImportRec[] = []
  for (let r = dataStart; r < matrix.length; r++) {
    const row = matrix[r] as string[]
    const key = cellStr(row, 0)
    if (!key) continue   // 标识列空=非数据行(小计/游离备注行)
    // Excel 车间汇总行剔除(标识或区域列含 总用电量/总用水量/合计;曾被当表导入产生脏档案 id 1135-1138)
    if (/总用电量|总用水量|合计/.test(key) || /总用电量|总用水量|合计/.test(cellStr(row, areaCol))) continue
    // 位置 = 区域列与企业名称列之间的未命名列(一期 1 列,宿舍 2 列),非空拼接
    const spotCells: string[] = []
    for (let c = areaCol + 1; c > 0 && tenantCol > 0 && c < tenantCol; c++) {
      const v = cellStr(row, c)
      if (v) spotCells.push(v)
    }
    const factor = factorCol >= 0 ? cleanNum(row?.[factorCol]) : null
    const prevTotal = cleanNum(row?.[prevCol])
    const currTotal = cleanNum(row?.[currCol])
    const area = cellStr(row, areaCol)
    const rawTenant = tenantCol >= 0 ? cellStr(row, tenantCol) : ''
    const meterType = typeCol >= 0 ? cellStr(row, typeCol) : ''
    // v2 拆分(§6.2/§6.3):企业名称原文拆 租户/方位;归属分类(多命中也按租户表归类,id 置空待核);区域→楼栋
    const split = splitTenantSpot(rawTenant, tenantNames)
    const ownership = classifyOwnership(meterType || undefined, `${key} ${rawTenant}`, !!split.tenant || split.multi)
    const tenantId = ownership === 'tenant' && split.tenant ? idByName.get(split.tenant) ?? null : null
    const buildingId = buildingIdFor(det.zone, area, buildings)
    const spot = [...spotCells, split.spot].filter(Boolean).join(' ')
    const rec: ImportRec = {
      kind: det.kind, zone: det.zone, name: key, ym: det.ym,
      area: area || undefined,
      spot: spot || undefined,
      tenantName: rawTenant || undefined,   // 企业名称原文保留(§6.1 未匹配兜底+对账审计)
      meterType: meterType || undefined,
      subName: subCol >= 0 ? cellStr(row, subCol) || undefined : undefined,
      code: codeCol >= 0 ? cellStr(row, codeCol) || undefined : undefined,
      factor: factor ?? undefined,
      prevTotal, currTotal,
      tenantId, buildingId, ownership,
      note: noteCol >= 0 ? cellStr(row, noteCol) || undefined : undefined,
      // §6.4 导入预览列:期数|楼栋|方位|租户(或待核原文)|归属|倍率|上月总|本月总
      __preview: [METER_ZONE_LABEL[det.zone], buildings.find(b => b.id === buildingId)?.name ?? '',
        spot, ownership === 'tenant' ? (split.tenant ?? (rawTenant ? `${rawTenant}(待核)` : '')) : rawTenant,
        OWNERSHIP_LABEL[ownership], factor ?? '', prevTotal ?? '', currTotal ?? ''],
    }
    if (tou) {
      rec.prevSharp = cleanNum(row?.[prevCol + 1]); rec.prevPeak = cleanNum(row?.[prevCol + 2])
      rec.prevFlat = cleanNum(row?.[prevCol + 3]); rec.prevValley = cleanNum(row?.[prevCol + 4])
      rec.currSharp = cleanNum(row?.[currCol + 1]); rec.currPeak = cleanNum(row?.[currCol + 2])
      rec.currFlat = cleanNum(row?.[currCol + 3]); rec.currValley = cleanNum(row?.[currCol + 4])
    }
    records.push(rec)
  }
  if (!records.length) return null
  const [y, mo] = det.ym.split('-')
  return { label: `${METER_ZONE_LABEL[det.zone]}${METER_KIND_LABEL[det.kind]} · ${y}年${+mo}月 · ${records.length}块表`, records }
}

// ── 整册解析(parseWorkbook 契约):识别 sheet → sections 勾选段;仅 1 段平铺为 records ──
export function parseMeterWorkbook(sheets: { name: string; matrix: string[][] }[], master: MeterMasterCtx = {}):
    { records?: ImportRec[]; sections?: MeterSheetSection[]; error?: string } {
  const sections = sheets.map(s => parseMeterSheet(s.name, s.matrix, master)).filter((s): s is MeterSheetSection => !!s)
  if (!sections.length)
    return { error: '没识别到抄表 sheet:标题需含「YYYY年M月…抄表记录」及 一期/二期/宿舍 与 电表/水表,表头需含 区域+上月行至+本月行至。' }
  return sections.length === 1 ? { records: sections[0].records } : { sections }
}

// ── 模板:6-sheet 骨架(标题行含年月+真实版式表头+示例行),与解析器互认 ──
export function buildMeterTemplateAoa(zone: string, kind: string, ym: string): (string | number)[][] {
  const [y, mo] = ym.split('-')
  const title = `${y}年${+mo}月${METER_ZONE_LABEL[zone]}${zone === 'dorm' ? '' : '园区'}${METER_KIND_LABEL[kind]}抄表记录`
  if (kind === 'elec') {
    return [
      ['', title],
      ['', '区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '', '', '', '', '本月行至', '', '', '', '', '备注'],
      ['', '', '', '', '', '', '', '', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', ''],
      ['示例总电', '一车间', '', '', '总电表', '总电表', '230220001238', 500, 473.65, 123.06, 142.8, 176.7, 31.08, 543.99, 142.42, 164.09, 202.21, 35.25, ''],
    ]
  }
  return [
    ['', title],
    ['', '区域', '', '企业名称', '表类', '水表名称', '水表编码', '水表倍率', '上月行至', '本月行至', '备注'],
    ['示例总水', '二期总水表', '', '', '总水表', '总水表', '2311956778', 10, 1567, 2137, ''],
  ]
}

const TEMPLATE_SHEETS: [string, string, string][] = [
  ['一期园区电', 'p1', 'elec'], ['一期园区水', 'p1', 'water'],
  ['二期园区电', 'p2', 'elec'], ['二期园区水', 'p2', 'water'],
  ['宿舍电', 'dorm', 'elec'], ['宿舍水', 'dorm', 'water'],
]

export async function buildMeterTemplate(ym: string): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const [sheet, zone, kind] of TEMPLATE_SHEETS)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildMeterTemplateAoa(zone, kind, ym)), sheet)
  XLSX.writeFile(wb, `园区抄表导入模板-${ym}.xlsx`)
}

// ── 当月导出:6 sheet 同构真实版式,可改后直接重导(修正回路,同 PV 导出口径) ──
// 结构化最小类型(与 api/meters.ts DTO 兼容,不 import 保持纯函数独立可测)
export interface MeterLite {
  id: number; kind: string; zone: string; name: string
  area?: string | null; spot?: string | null; tenantName?: string | null
  meterType?: string | null; subName?: string | null; code?: string | null; factor?: number | null
}
export interface MeterReadingLite {
  meterId: number
  prevTotal?: number | null; currTotal?: number | null
  prevSharp?: number | null; prevPeak?: number | null; prevFlat?: number | null; prevValley?: number | null
  currSharp?: number | null; currPeak?: number | null; currFlat?: number | null; currValley?: number | null
  note?: string | null
}

export function buildMeterExportAoa(
  zone: string, kind: string, ym: string, meters: MeterLite[], readings: MeterReadingLite[],
): (string | number)[][] {
  const byMeter = new Map(readings.map(r => [r.meterId, r]))
  const aoa = buildMeterTemplateAoa(zone, kind, ym).slice(0, kind === 'elec' ? 3 : 2)   // 标题+表头,去示例行
  for (const m of meters.filter(m => m.zone === zone && m.kind === kind)) {
    const r = byMeter.get(m.id)
    const base: (string | number)[] = [m.name, m.area ?? '', m.spot ?? '', m.tenantName ?? '',
      m.meterType ?? '', m.subName ?? '', m.code ?? '', m.factor ?? 1]
    aoa.push(kind === 'elec'
      ? [...base, r?.prevTotal ?? '', r?.prevSharp ?? '', r?.prevPeak ?? '', r?.prevFlat ?? '', r?.prevValley ?? '',
         r?.currTotal ?? '', r?.currSharp ?? '', r?.currPeak ?? '', r?.currFlat ?? '', r?.currValley ?? '', r?.note ?? '']
      : [...base, r?.prevTotal ?? '', r?.currTotal ?? '', r?.note ?? ''])
  }
  return aoa
}

export async function exportMeterMonth(ym: string, meters: MeterLite[], readings: MeterReadingLite[]): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const [sheet, zone, kind] of TEMPLATE_SHEETS) {
    const aoa = buildMeterExportAoa(zone, kind, ym, meters, readings)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  }
  XLSX.writeFile(wb, `园区抄表-${ym}.xlsx`)
}
