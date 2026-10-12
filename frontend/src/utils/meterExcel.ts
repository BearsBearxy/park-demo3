/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
// 园区抄表 Excel 全家桶(METER-SPEC §4):整册多 sheet 解析 + 模板生成 + 当月导出。
// 真实源文件 = 202405水电表数据表.xlsx 六 sheet(一期/二期/宿舍 × 电/水)及水电费工作簿内同构 sheet。
// 识别双闸门:①标题行含「YYYY年M月…抄表记录」并带 分区/类别 关键词(sheet 名兜底;
//              标题缺任何一项 → 用调用方传入的 fallback 账期/分区/类别,段落标 ymSource='fallback' + asked 缺哪几项,
//              导入弹窗据此出补问框 —— 缺区或表类也算,不再静默套默认值);
//            ②表头行(含「区域」)必须同时有 上月行至+本月行至——挡掉标题被复制串味的分摊 sheet。
// 认不出的 sheet(有内容的)列成导不了的段(reason 写原因);全空的 sheet 照旧跳过。
// 已知脏数据(审计实测):幽灵行列(utils/sheet.ts 读取时已剔全空行,列按映射索引取不受游离列影响)、
// 缺本月读数(=漏抄,照收 null 不报错——进系统标黄,而不是像手工表算出负 231 万度)。
import { writeAoaWorkbook } from './sheet'
import type { ImportRec } from './importHeaderMatch'
import { splitTenantSpot, classifyOwnership, buildingIdFor, SPOT_DIR_RE } from './meterSplit'
import { tenantMatchNames } from './tenantAlias'
import { zoneLabel } from './zoneLabel'

/** 标题和 sheet 名里都没认出来、用了弹窗里选的值的那几项:月份 / 区 / 电表还是水表 */
export type MeterAskItem = 'ym' | 'zone' | 'kind'
const ASK_NAME: Record<MeterAskItem, string> = { ym: '月份', zone: '区', kind: '电表还是水表' }

export interface MeterSheetSection {
  label: string; records: ImportRec[]; sciCodes?: number
  ym: string; ymSource: 'title' | 'fallback'   // fallback = 标题缺了月份 / 区 / 表类里的某项,用了调用方传的默认值(UI 要披露)
  asked?: MeterAskItem[]   // 缺的是哪几项(ymSource='fallback' 时非空)
  noNameCol?: boolean   // 表头首格即「区域」= 缺原册标识列(§J3:同位置同表号的行只剩企业名称可区分)
  reason?: string       // 认不出的 sheet:为什么导不了(records 为空,核对页标橙不勾)
}

// 标题缺失时的兜底三件套(弹窗的账期/分区/类别选择器):账期无法从数据推断,只能由用户指定。
export interface MeterFallback { ym?: string; zone?: string; kind?: string }

// v2 结构化拆分(§6.2/§6.3)要的主数据;缺省=空(正则拆分照跑,租户/楼栋不挂 id、待核兜底)。
// tenants.id 可缺:视图只喂 tenantNames 的后备路径=按名匹配但 tenantId 置空。
export interface MeterMasterCtx {
  tenants?: { id?: number; companyName: string; aliases?: string | null }[]
  buildings?: { id: number; name: string }[]
}

export const METER_KIND_LABEL: Record<string, string> = { elec: '电表', water: '水表' }

// FpImportModal 核对页的列(照 md-v2-meter,__preview 与此对齐);模板是 6-sheet 骨架另走 buildMeterTemplate
export const METER_TEMPLATE_COLS = ['楼栋', '方位', '租户', '倍率', '上月读数', '本月读数', '用量']

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

// 期区清单(T7 GET /api/zones 的形状,取 code+name 即够用)。清单不可用(未注入或接口拉取失败
// 留了个空数组)时回落这写死的三区 —— 保证老流程(一期/二期/宿舍)在接口挂掉时照常可用。
// 导入弹窗补问框的「区」下拉也取这一份(importRegistry 用 resolveZones):选得到的区 = 认得出的区,两边不再各写一份。
export interface ZoneLite { code: string; name: string }
const DEFAULT_ZONES: ZoneLite[] = [{ code: 'p1', name: '一期' }, { code: 'p2', name: '二期' }, { code: 'dorm', name: '宿舍' }]
export const resolveZones = (zones?: ZoneLite[]): ZoneLite[] => (zones && zones.length ? zones : DEFAULT_ZONES)

// ── sheet 识别(分级降级):标题(前4行含「抄表记录」的单元格)+ sheet 名 取 月份/分区/类别;
//    取不到的那几项落到 fallback(用户在导入弹窗里选的账期/分区/类别)——账期无法从数据推断,只能问人。
function detectSheet(name: string, matrix: string[][], fb: MeterFallback = {}, zones?: ZoneLite[]):
    { zone: string; kind: string; ym: string; ymSource: 'title' | 'fallback'; asked: MeterAskItem[] } | null {
  const src = [...matrix.slice(0, 4).flat().map(c => String(c ?? '')).filter(s => s.includes('抄表记录')), name].join('|')
  const m = src.match(/(\d{4})年(\d{1,2})月/)
  const seen: Record<MeterAskItem, string | undefined> = {
    ym: m ? `${m[1]}-${String(+m[2]).padStart(2, '0')}` : undefined,
    // 按 label 长度降序反查,防「三期」这类子串被更短的 label 误命中(清单里 label 互不为前缀时无所谓,但排序成本很低)
    zone: [...resolveZones(zones)].sort((a, b) => b.name.length - a.name.length).find(z => src.includes(z.name))?.code,
    kind: /电表/.test(src) ? 'elec' : /水表/.test(src) ? 'water' : undefined,
  }
  // 缺哪项都算(改前标题有年月、缺区或表类时静默套 fb 的 p1/elec,不出补问)
  const asked = (['ym', 'zone', 'kind'] as const).filter(k => !seen[k])
  const ym = seen.ym ?? fb.ym, zone = seen.zone ?? fb.zone, kind = seen.kind ?? fb.kind
  return ym && zone && kind ? { zone, kind, ym, ymSource: asked.length ? 'fallback' : 'title', asked } : null
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
  name: string, matrix: string[][], master: MeterMasterCtx = {}, fb: MeterFallback = {}, zones?: ZoneLite[],
): MeterSheetSection | null {
  const det = detectSheet(name, matrix, fb, zones)
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
    // 用量:按读数算(本月 − 上月)× 倍率,和导进去以后系统算的一样(表里的用量列不落库);读数缺一个才退回表里写的
    const stated = usageCol >= 0 ? cleanNum(row?.[usageCol]) : null
    const derived = prevTotal == null || currTotal == null ? null : Math.round((currTotal - prevTotal) * (factor ?? 1) * 100) / 100
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
      // 核对页列(md-v2-meter):楼栋|方位|租户(或待核原文)|倍率|上月读数|本月读数|用量;期区写在段名上
      __preview: [buildings.find(b => b.id === buildingId)?.name ?? area,
        spot, ownership === 'tenant' ? (split.tenant ?? (rawTenant ? `${rawTenant}(待核)` : '')) : rawTenant,
        factor ?? '', prevTotal ?? '', currTotal ?? '', derived ?? stated ?? ''],
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
  const label = `${zoneLabel(det.zone)}${METER_KIND_LABEL[det.kind]} · ${y}年${+mo}月 · ${records.length}块表`
    + (det.asked.length ? `(${det.asked.map(k => ASK_NAME[k]).join('、')}按你选的)` : '')
  return { label, records, sciCodes, ym: det.ym, ymSource: det.ymSource, asked: det.asked, noNameCol: nameCol < 0 }
}

// ── 整册解析(parseWorkbook 契约):识别 sheet → sections 勾选段;仅 1 段平铺为 records ──
export function parseMeterWorkbook(
  sheets: { name: string; matrix: string[][] }[], master: MeterMasterCtx = {}, fb: MeterFallback = {}, zones?: ZoneLite[],
): { records?: ImportRec[]; sections?: MeterSheetSection[]; error?: string; warning?: string; notice?: string; ask?: MeterAskItem[] } {
  // 认不出的 sheet 不再静默跳过:有内容的列成导不了的段,写明原因(全空的 sheet 照旧跳过)
  const all = sheets.flatMap((s): MeterSheetSection[] => {
    const sec = parseMeterSheet(s.name, s.matrix, master, fb, zones)
    if (sec) return [sec]
    if (!s.matrix.some(r => r.some(c => String(c ?? '').trim() !== ''))) return []
    const reason = headerRow(s.matrix) < 0 ? '没有「区域」「上月行至」「本月行至」这几列，不是抄表表'
      : !detectSheet(s.name, s.matrix, fb, zones) ? '看不出是哪个月、哪个区、电表还是水表'
      : '表头下面没有读数'
    return [{ label: s.name || '粘贴的表', records: [], ym: '', ymSource: 'title', reason }]
  })
  const sections = all.filter(s => !s.reason)
  // 一段都导不了:说第一张认不出的表为什么(认不出卡下面有「文件要长这样」可对照)
  if (!sections.length) {
    const why = all[0]?.reason
    return { error: why ? `${all.length > 1 ? `${all.length} 张表都导不了，第一张「${all[0].label}」` : ''}${why}。` : '没读到任何内容。' }
  }
  const sci = sections.reduce((n, s) => n + (s.sciCodes ?? 0), 0)
  // 非阻断提示走 warning(弹窗里的橙色条,与 error 分开、不阻断导入;后端 errors/notices 也不掺)
  // §J3:缺标识列必须当场说出来 —— 位置歧义只剩企业名称可救,治本是用模板/导出当月的文件重导。
  const warning = [
    sci ? `${sci} 行的表编码被 Excel 按科学计数法截断(如 2.20605E+11),有效位已丢失无法还原,已按「无编码」处理(改走位置匹配)。请把编码列设为「文本」格式后重导,才能启用编码匹配。` : '',
    sections.some(s => s.noNameCol) ? '本文件缺原册首列(标识名),同位置同表号的行将只能靠企业名称区分;建议用「下载模板」或「导出当月」的文件重导。' : '',
  ].filter(Boolean).join(' ') || undefined
  const byFb = sections.filter(s => s.ymSource === 'fallback')
  const ask = (['ym', 'zone', 'kind'] as const).filter(k => byFb.some(s => s.asked?.includes(k)))
  const notice = byFb.length
    ? `${byFb.length} 段标题里没写${ask.map(k => ASK_NAME[k]).join('、')}，按你选的导入；不对就改选项，会按新选的重新认。`
    : undefined
  return sections.length === 1 && all.length === 1
    ? { records: sections[0].records, warning, notice, ask: ask.length ? ask : undefined }
    : { sections: all, warning, notice, ask: ask.length ? ask : undefined }
}

// ── 模板:6-sheet 骨架(标题行含年月+真实版式表头+示例行),与解析器互认 ──
export function buildMeterTemplateAoa(zone: string, kind: string, ym: string): (string | number)[][] {
  const [y, mo] = ym.split('-')
  const title = `${y}年${+mo}月${zoneLabel(zone)}${zone === 'dorm' ? '' : '园区'}${METER_KIND_LABEL[kind]}抄表记录`
  if (kind === 'elec') {
    return [
      ['', title],
      ['', '区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '', '', '', '', '本月行至', '', '', '', '', '备注'],
      ['', '', '', '', '', '', '', '', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', ''],
      ['示例总电', '1号楼', '', '', '总电表', '总电表', '000000000001', 500, 473.65, 123.06, 142.8, 176.7, 31.08, 543.99, 142.42, 164.09, 202.21, 35.25, ''],
    ]
  }
  return [
    ['', title],
    ['', '区域', '', '企业名称', '表类', '水表名称', '水表编码', '水表倍率', '上月行至', '本月行至', '备注'],
    ['示例总水', '1号楼', '', '', '总水表', '总水表', '000000000002', 10, 1567, 2137, ''],
  ]
}

// sheet 清单随期区清单生成(期区不可用时回落写死三区,见 resolveZones)。
// buildMeterTemplate 与 exportMeterMonth 共用这一个来源 —— 不共用则新期区能建能导入,却永远不出现在模板/导出里。
export const templateSheets = (zones?: ZoneLite[]): [string, string, string][] =>
  resolveZones(zones).flatMap(z => (['elec', 'water'] as const).map(k =>
    [`${z.name}${z.code === 'dorm' ? '' : '园区'}${k === 'elec' ? '电' : '水'}`, z.code, k] as [string, string, string]))

export async function buildMeterTemplate(ym: string, zones?: ZoneLite[]): Promise<void> {
  await writeAoaWorkbook(`园区抄表导入模板-${ym}.xlsx`,
    templateSheets(zones).map(([sheet, zone, kind]) => ({ name: sheet, aoa: buildMeterTemplateAoa(zone, kind, ym) })))
}

// ── 当月导出:6 sheet 同构真实版式,可改后直接重导(修正回路,同 PV 导出口径) ──
// 结构化最小类型(与 api/meters.ts DTO 兼容,不 import 保持纯函数独立可测)
// status = 站在导出月的状态段(METER-TIMELINE-SPEC §1.3);档案各列也是那个月的值(调用方传 list(ym) 的结果)
export interface MeterLite {
  id: number; kind: string; zone: string; name: string
  area?: string | null; spot?: string | null; tenantName?: string | null
  meterType?: string | null; subName?: string | null; code?: string | null; factor?: number | null
  status: string | null
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
  // SPEC §6:只导站在该月在册的表 —— 在用与停用(停用照样在册上);已拆 / 还不在册的不导
  const onRegister = (m: MeterLite) => m.status === 'active' || m.status === 'retired'
  for (const m of meters.filter(m => m.zone === zone && m.kind === kind && onRegister(m))) {
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

export async function exportMeterMonth(
  ym: string, meters: MeterLite[], readings: MeterReadingLite[], zones?: ZoneLite[],
): Promise<void> {
  await writeAoaWorkbook(`园区抄表-${ym}.xlsx`,
    templateSheets(zones).map(([sheet, zone, kind]) => ({ name: sheet, aoa: buildMeterExportAoa(zone, kind, ym, meters, readings) })))
}
