// 园区抄表 Excel 全家桶(METER-SPEC §4):整册多 sheet 解析 + 模板生成 + 当月导出。
// 真实源文件 = 202405水电表数据表.xlsx 六 sheet(一期/二期/宿舍 × 电/水)及水电费工作簿内同构 sheet。
// 识别双闸门:①标题行含「YYYY年M月…抄表记录」并带 分区/类别 关键词(sheet 名兜底;
//              标题缺项 → 用调用方传入的 fallback 账期/分区/类别,段落标 ymSource='fallback' 供 UI 披露);
//            ②表头行(含「区域」)必须同时有 上月行至+本月行至——挡掉标题被复制串味的分摊 sheet。
// 未识别 sheet 静默跳过(整册常混上百张租户缴费单 sheet)。
// 已知脏数据(审计实测):幽灵行列(utils/sheet.ts 读取时已剔全空行,列按映射索引取不受游离列影响)、
// 缺本月读数(=漏抄,照收 null 不报错——进系统标黄,而不是像手工表算出负 231 万度)。
import { writeAoaWorkbook } from './sheet'
import type { ImportRec } from './importHeaderMatch'
import { splitTenantSpot, classifyOwnership, buildingIdFor, OWNERSHIP_LABEL, SPOT_DIR_RE } from './meterSplit'
import { tenantMatchNames } from './tenantAlias'

export interface MeterSheetSection {
  label: string; records: ImportRec[]; sciCodes?: number
  ym: string; ymSource: 'title' | 'fallback'   // fallback = 标题里没账期,用了调用方传的默认账期(UI 要披露)
  noNameCol?: boolean   // 表头首格即「区域」= 缺原册标识列(§J3:同位置同表号的行只剩企业名称可区分)
}

// 标题缺失时的兜底三件套(弹窗的账期/分区/类别选择器):账期无法从数据推断,只能由用户指定。
export interface MeterFallback { ym?: string; zone?: string; kind?: string }

// v2 结构化拆分(§6.2/§6.3)要的主数据;缺省=空(正则拆分照跑,租户/楼栋不挂 id、待核兜底)。
// tenants.id 可缺:视图只喂 tenantNames 的后备路径=按名匹配但 tenantId 置空。
export interface MeterMasterCtx {
  tenants?: { id?: number; companyName: string; aliases?: string | null }[]
  buildings?: { id: number; name: string }[]
}

export const METER_ZONE_LABEL: Record<string, string> = { p1: '一期', p2: '二期', dorm: '宿舍' }
export const METER_KIND_LABEL: Record<string, string> = { elec: '电表', water: '水表' }

// FpImportModal 预览表列(__preview 与此对齐,§6.4 拆分结果);模板是 6-sheet 骨架另走 buildMeterTemplate
export const METER_TEMPLATE_COLS = ['期数', '楼栋', '方位', '租户', '归属', '倍率', '上月总', '本月总', '表列用量']

const cleanNum = (v: unknown): number | null => {
  if (v == null) return null
  const s = String(v).replace(/[,，\s]/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const cellStr = (row: string[] | undefined, i: number): string => String(row?.[i] ?? '').trim()

// ── 单元格归一(METER-IMPORT-SPEC §2.2) ──
// 段落合计行:真实文件「A座总用电量」/「E座总用电量」,用户模板落在区域列
const TOTAL_RE = /总用电量|总用水量|总用量|合计|小计/
// Excel 日期型位置格(真实文件 C11=2023-05-18 带 mm-dd-yy 自有格式,dateNF 管不着 → raw:false 出 "5/18/23")
const normSpot = (s: string): string => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return s
  const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
// 常规格式的长编码被 SheetJS 按 6 位有效数字渲染成 2.20605E+11 —— 有效位已丢,还原不了。
// ponytail: 不猜,按无编码处理(掉到地址层匹配,不会错挂),整册给一条 warning 让用户改文本格式重导。
const SCI_RE = /^\d(\.\d+)?E\+\d+$/i
// 数值化的标识/编码(101 → 101.00):261 块宿舍影子表的直接成因
const dropTrailingZeros = (s: string): string => (/^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s)

// ── sheet 识别(分级降级):标题(前4行含「抄表记录」的单元格)+ sheet 名 取 月份/分区/类别;
//    取不到的那几项落到 fallback(用户在导入弹窗里选的账期/分区/类别)——账期无法从数据推断,只能问人。
function detectSheet(name: string, matrix: string[][], fb: MeterFallback = {}):
    { zone: string; kind: string; ym: string; ymSource: 'title' | 'fallback' } | null {
  const src = [...matrix.slice(0, 4).flat().map(c => String(c ?? '')).filter(s => s.includes('抄表记录')), name].join('|')
  const m = src.match(/(\d{4})年(\d{1,2})月/)
  const ym = m ? `${m[1]}-${String(+m[2]).padStart(2, '0')}` : fb.ym
  const zone = /一期/.test(src) ? 'p1' : /二期/.test(src) ? 'p2' : /宿舍/.test(src) ? 'dorm' : fb.zone
  const kind = /电表/.test(src) ? 'elec' : /水表/.test(src) ? 'water' : fb.kind
  return ym && zone && kind ? { zone, kind, ym, ymSource: m ? 'title' : 'fallback' } : null
}

// 闸门②:表头行 = 前 8 行里含「区域」且同行有 上月行至+本月行至(挡串味标题的分摊 sheet)。
// 降级绝不放宽这道闸门,否则无关 sheet 会被当抄表读。
function headerRow(matrix: string[][]): number {
  for (let r = 0; r < Math.min(8, matrix.length); r++) {
    const row = (matrix[r] ?? []).map(c => String(c ?? '').trim())
    if (row.includes('区域') && row.some(c => c.startsWith('上月行至')) && row.some(c => c.startsWith('本月行至')))
      return r
  }
  return -1
}

// ── 单 sheet 解析(纯函数,spec 锁定) ──
export function parseMeterSheet(
  name: string, matrix: string[][], master: MeterMasterCtx = {}, fb: MeterFallback = {},
): MeterSheetSection | null {
  const det = detectSheet(name, matrix, fb)
  if (!det) return null
  const h = headerRow(matrix)
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
  // 表列用量(1 列或 5 列均可):只进预览做人工对照,不入库(§2.3 用量口径唯一 = (curr−prev)×倍率)
  const usageCol = idx(c => /^本月用(电量|水量|量)/.test(c))
  // 标识列(A 列无表头)可有可无(§2):「区域」在 0 列 = 用户新模板无标识列;>0 = 第 0 列是标识列
  const nameCol = areaCol > 0 ? 0 : -1
  // TOU 版式:表头下一行 prevCol 处为「总」(电表尖峰平谷子头);水表/无子头=单列
  const sub = (matrix[h + 1] ?? []).map(c => String(c ?? '').trim())
  const tou = sub[prevCol] === '总'
  const dataStart = h + (tou ? 2 : 1)
  // v2 主数据(§6.2/§6.3):租户库名单+按名挂 id;楼栋清单按 name 映射
  const tenants = master.tenants ?? []
  const buildings = master.buildings ?? []
  // 正名+别名(V86)同权:名单供拆分匹配,idByName 供挂号;同别名撞车由 matchTenant 多命中护栏落待核
  const tenantNames = tenants.flatMap(t => tenantMatchNames(t))
  const idByName = new Map(tenants.filter(t => t.id != null)
    .flatMap(t => tenantMatchNames(t).map(n => [n, t.id as number] as const)))

  const records: ImportRec[] = []
  let sciCodes = 0
  let lastArea = ''
  for (let r = dataStart; r < matrix.length; r++) {
    const row = matrix[r] as string[]
    const key = dropTrailingZeros(nameCol >= 0 ? cellStr(row, nameCol) : '')
    const areaRaw = cellStr(row, areaCol)
    // Excel 段落合计行剔除(标识或区域列命中;曾被当表导入产生脏档案 id 1135-1138)
    if (TOTAL_RE.test(key) || TOTAL_RE.test(areaRaw)) continue
    // 区域纵向合并:sheet_to_json 只给左上角,续行空 → 向下继承(旧实现在这吃掉大半数据且不报错)
    if (areaRaw) lastArea = areaRaw
    const area = areaRaw || lastArea
    // 位置 = 区域列与企业名称列之间的未命名列(一期 1 列,宿舍 2 列),非空拼接
    const spotCells: string[] = []
    for (let c = areaCol + 1; c >= 0 && tenantCol > 0 && c < tenantCol; c++) {
      const v = normSpot(cellStr(row, c))
      if (v) spotCells.push(v)
    }
    const factor = factorCol >= 0 ? cleanNum(row?.[factorCol]) : null
    const prevTotal = cleanNum(row?.[prevCol])
    const currTotal = cleanNum(row?.[currCol])
    const rawTenant = tenantCol >= 0 ? cellStr(row, tenantCol) : ''
    const meterType = typeCol >= 0 ? cellStr(row, typeCol) : ''
    const subName = subCol >= 0 ? cellStr(row, subCol) : ''
    let code = codeCol >= 0 ? dropTrailingZeros(cellStr(row, codeCol)) : ''
    if (SCI_RE.test(code)) { sciCodes++; code = '' }
    // 空行/游离备注行:标识+区域+位置+企业名称+表名+编码 全空 → 非数据行
    if (![key, areaRaw, ...spotCells, rawTenant, subName, code].some(Boolean)) continue
    // v2 拆分(§6.2/§6.3):企业名称原文拆 租户/方位;归属分类(多命中也按租户表归类,id 置空待核);区域→楼栋
    const split = splitTenantSpot(rawTenant, tenantNames)
    const ownership = classifyOwnership(meterType || undefined, `${key} ${rawTenant}`, !!split.tenant || split.multi)
    const tenantId = ownership === 'tenant' && split.tenant ? idByName.get(split.tenant) ?? null : null
    const buildingId = buildingIdFor(det.zone, area, buildings)
    // 位置列已给出位置时,企业名称里剥出的 split.spot 只接受「方位型」(东西南北侧/高低区/门口):
    // 原册天面行的企业名称写的是电表描述(客梯1 / 客梯2（到-1楼）),SPOT_RE 会剥出 '1'/'到-1楼',
    // 拼成 '天面 1'/'天面 到-1楼' 把同一楼层裂成三组(存量已由 V72 清理)。位置列为空时行为不变。
    const tailSpot = spotCells.length && !SPOT_DIR_RE.test(split.spot ?? '') ? null : split.spot
    const spot = [...spotCells, tailSpot].filter(Boolean).join(' ')
    // 无标识列时合成标签(§3.1):区域-位置-表名 → 编码;仅作人类可读标签与 L3 兜底,身份靠后端分层匹配
    const name = key || [area, spot, subName].filter(Boolean).join('-').slice(0, 64) || code
    // 表列用量 vs 派生用量(§2.3):只对照不落库,差异超 max(1,1%) 预览打 ⚠
    const stated = usageCol >= 0 ? cleanNum(row?.[usageCol]) : null
    const derived = prevTotal == null || currTotal == null ? null : (currTotal - prevTotal) * (factor ?? 1)
    const gap = stated != null && derived != null && Math.abs(stated - derived) > Math.max(1, Math.abs(derived) * 0.01)
    const rec: ImportRec = {
      kind: det.kind, zone: det.zone, name, ym: det.ym,
      area: area || undefined,
      spot: spot || undefined,
      tenantName: rawTenant || undefined,   // 企业名称原文保留(§6.1 未匹配兜底+对账审计)
      meterType: meterType || undefined,
      subName: subName || undefined,
      code: code || undefined,
      factor: factor ?? undefined,
      prevTotal, currTotal,
      tenantId, buildingId, ownership,
      note: noteCol >= 0 ? cellStr(row, noteCol) || undefined : undefined,
      // §6.4 导入预览列:期数|楼栋|方位|租户(或待核原文)|归属|倍率|上月总|本月总|表列用量
      __preview: [METER_ZONE_LABEL[det.zone], buildings.find(b => b.id === buildingId)?.name ?? '',
        spot, ownership === 'tenant' ? (split.tenant ?? (rawTenant ? `${rawTenant}(待核)` : '')) : rawTenant,
        OWNERSHIP_LABEL[ownership], factor ?? '', prevTotal ?? '', currTotal ?? '',
        stated == null ? '' : gap ? `${stated}⚠` : stated],
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
  const label = `${METER_ZONE_LABEL[det.zone]}${METER_KIND_LABEL[det.kind]} · ${y}年${+mo}月 · ${records.length}块表`
    + (det.ymSource === 'fallback' ? '(按所选账期)' : '')
  return { label, records, sciCodes, ym: det.ym, ymSource: det.ymSource, noNameCol: nameCol < 0 }
}

// ── 整册解析(parseWorkbook 契约):识别 sheet → sections 勾选段;仅 1 段平铺为 records ──
export function parseMeterWorkbook(
  sheets: { name: string; matrix: string[][] }[], master: MeterMasterCtx = {}, fb: MeterFallback = {},
): { records?: ImportRec[]; sections?: MeterSheetSection[]; error?: string; warning?: string; notice?: string } {
  const sections = sheets.map(s => parseMeterSheet(s.name, s.matrix, master, fb)).filter((s): s is MeterSheetSection => !!s)
  if (!sections.length)
    return { error: sheets.some(s => headerRow(s.matrix) >= 0)
      // 表头认出来了,缺的是账期/分区/类别 → 给可操作提示(裸粘贴数据块走这条)
      ? '读到抄表表头了,但标题里没有账期(年月)——账期无法从数据推断,请在上方选择账期/分区/类别后重新解析。'
      : '没识别到抄表数据:表头行需同时含「区域」+「上月行至」+「本月行至」。标题行(YYYY年M月…抄表记录)可以没有,账期在上方选。' }
  const sci = sections.reduce((n, s) => n + (s.sciCodes ?? 0), 0)
  // 非阻断提示走 warning(弹窗里的橙色条,与 error 分开、不阻断导入;后端 errors/notices 也不掺)
  // §J3:缺标识列必须当场说出来 —— 位置歧义只剩企业名称可救,治本是用模板/导出当月的文件重导。
  const warning = [
    sci ? `${sci} 行的表编码被 Excel 按科学计数法截断(如 2.20605E+11),有效位已丢失无法还原,已按「无编码」处理(改走位置匹配)。请把编码列设为「文本」格式后重导,才能启用编码匹配。` : '',
    sections.some(s => s.noNameCol) ? '本文件缺原册首列(标识名),同位置同表号的行将只能靠企业名称区分;建议用「下载模板」或「导出当月」的文件重导。' : '',
  ].filter(Boolean).join(' ') || undefined
  const byFb = sections.filter(s => s.ymSource === 'fallback')
  const notice = byFb.length
    ? `${byFb.length} 段没在标题里读到账期,已按你选的 ${byFb[0].ym} 账期导入(分区/类别同理)。请核对下方段标签,不对就改上方选项。`
    : undefined
  return sections.length === 1 ? { records: sections[0].records, warning, notice } : { sections, warning, notice }
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
  await writeAoaWorkbook(`园区抄表导入模板-${ym}.xlsx`,
    TEMPLATE_SHEETS.map(([sheet, zone, kind]) => ({ name: sheet, aoa: buildMeterTemplateAoa(zone, kind, ym) })))
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
  await writeAoaWorkbook(`园区抄表-${ym}.xlsx`,
    TEMPLATE_SHEETS.map(([sheet, zone, kind]) => ({ name: sheet, aoa: buildMeterExportAoa(zone, kind, ym, meters, readings) })))
}
