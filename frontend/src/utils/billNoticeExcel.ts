// 催缴单交付导出(S20-BILL-DELIVERY-SPEC §5):发租户·通知单 zip / 发财务·对账表。
// 版式=源册「二期2024年2月水电费.xlsx」租户 sheet(王红婷)逐格实测复刻:12 列宽、双线外框、
// 电/水 两侧表头(电侧多「按尖峰电价收取比率」列)、B:C 竖跨块名、公摊三类行形状、账户块、签收栏、落款。
// SheetJS 社区版不支持字体/边框/填充(Pro 功能),故本文件走 exceljs(懒加载,与现有 xlsx 并存不替换)。
// ⭐口径复用铁律:费项名/合并行/用量单价格式一律调 billNoticeLogic 现成纯函数(billFeeLabel/mergeMaintRows/
// billQtyCell/segLabel/noteDisplay…),禁另抄一份 —— 屏上看到什么,导出就是什么。
// 纯函数(splitByPayCompany/buildNoticeSections/noticeFileName/buildReconSheet)由 billNoticeExcel.spec.ts 锁定;
// exceljs 出流只验通性(能写出、回读锚点格对得上),不比对二进制。
import type { BorderStyle, Worksheet } from 'exceljs'
import type { BillNoticeDetailDTO, BillNoticeLineDTO } from '@/api/billNotices'
import {
  billFeeLabel, billQtyCell, groupExcelStyle, lineNoteKey, mergeMaintRows, mergeNoteKey, noteDisplay, segLabel,
  type MaintRow,
} from './billNoticeLogic'
import { downloadBlob } from './billExcel'

const r2 = (v: number) => Math.round(v * 100) / 100

// ── 对接 /api/companies 的结构化类型(S20 三刀共用字段名):只声明本文件读到的字段,
//    与 api/companies.ts 的 DTO 靠结构化类型对接,不互相 import 免并行刀撞名 ──
export interface CompanyAccount {
  kind: string
  accountName?: string | null
  accountNo?: string | null
  bankName?: string | null
  remark?: string | null
}
export interface Company {
  id: number
  name: string
  short?: string | null
  fullName?: string | null
}

export interface NoticeExportItem {
  tenantId: number
  tenantName: string | null
  details: BillNoticeDetailDTO[]
  notes: Map<string, string>     // noteKeyId → 人工覆盖备注(与抽屉同一份)
  premiseText: string | null
}

// ── 一户一单按收款公司拆(§5.1:同户跨两家公司出两张,与源册当年一致) ──
export interface PayGroup {
  companyId: number | null
  companyName: string | null
  lines: BillNoticeLineDTO[]
  total: number
  prevDue: number
}
export function splitByPayCompany(item: NoticeExportItem): PayGroup[] {
  const out: PayGroup[] = []
  const by = new Map<number | string, PayGroup>()
  for (const d of item.details) {
    // 租金行不进水电费通知单(源册是「水电费缴费通知单」;租金另有合同/账单链)
    const ls = d.lines.filter(l => l.feeGroup !== 'rent')
    if (!ls.length) continue
    const k = d.payCompanyId ?? ''
    let g = by.get(k)
    if (!g) {
      g = { companyId: d.payCompanyId, companyName: d.payCompanyName, lines: [], total: 0, prevDue: 0 }
      by.set(k, g)
      out.push(g)
    }
    g.lines.push(...ls)
    g.total = r2(g.total + ls.reduce((s, l) => s + l.amount, 0))
    g.prevDue = r2(g.prevDue + (d.prevDue ?? 0))
    g.companyName ??= d.payCompanyName
  }
  return out
}

// ── 单据正文行(一个扁平记录覆盖五种形状,写格函数只有一个) ──
export interface NoticeBodyRow {
  name: string                 // D 项目
  prev: number | null          // E 上月行至
  curr: number | null          // F 本月行至
  factor: number | null        // G 倍率
  area: number | null          // E:G 合并显面积(按面积摊的行)
  h: string | null             // H「每层」/「㎡」
  qty: number | null           // I 数值(用量 / 每层单价 / 损耗金额基数)
  qtyText: string | null       // I 文本(装机容量费「25千伏安」)
  qtyIsMoney: boolean          // I 走 0.00(损耗基数是金额不是度数)
  price: number | null         // J 数值
  priceText: string | null     // J 文本(「元，共N层」)
  priceIsPct: boolean          // J 走 0.00%(损耗率)
  amount: number               // K 金额
  note: string                 // L 备注(人工覆盖>引擎)
  meterQty: number | null      // 参与块「实际用量合计」的度/吨;公摊/容量行不入(源册 I11/I44 同)
}
export interface NoticeSection {
  label: string                // 电费 / 用电维护费 / 水费 / 用水维护费 / 其他费项
  water: boolean               // 水侧(表头无「按尖峰电价收取比率」列)
  maint: boolean
  rows: NoticeBodyRow[]
  total: number
  qtyTotal: number | null
}

const LOSS_NOTE = '用电总金额×损耗率'
const AREA_NOTE = '面积×公摊单价'
const SECTIONS: { label: string; water: boolean; maint: boolean }[] = [
  { label: '电费', water: false, maint: false },
  { label: '用电维护费', water: false, maint: true },
  { label: '水费', water: true, maint: false },
  { label: '用水维护费', water: true, maint: true },
]

const sumOf = (ms: BillNoticeLineDTO[], f: (l: BillNoticeLineDTO) => number | null): number | null => {
  let s: number | null = null
  for (const m of ms) { const v = f(m); if (v != null) s = (s ?? 0) + v }
  return s == null ? null : r2(s)
}
const sameOf = (ms: BillNoticeLineDTO[], f: (l: BillNoticeLineDTO) => number | null): number | null => {
  const v = f(ms[0])
  return ms.every(m => f(m) === v) ? v : null
}
const num = (s: string | null | undefined): number | null => {
  const v = Number(s)
  return s == null || s === '' || !Number.isFinite(v) ? null : v
}

// 项目名:合并行=纸单费项名;费块逐表行=段名→表名→费项名(源册单表户 D 列就是「峰」「水表1」);
// 维护费块的独苗行(mergeMaintRows 不并单表的 mgmt_fee/water_pipe)认费项名 —— 那一行的身份是
// 「电力管理费」而不是「电表①」,块内只有一列项目名,给表名会把费项说没了。
// 块内出现多场地/多块表时才冠场地/表名 —— 单表户与源册逐字相同,多表户不至于分不清哪行是哪块表。
function projectName(
  m: MaintRow<BillNoticeLineDTO>, maint: boolean, showPremise: boolean, showMeter: boolean,
): string {
  const f = m.kind === 'line' ? m.line : m.row.members[0]
  const base = m.kind === 'merge' ? m.row.label
    : maint ? billFeeLabel(m.line.feeKey)
      : (segLabel(m.line.seg) || m.line.meterLabel || billFeeLabel(m.line.feeKey))
  return [
    showPremise ? f.premise : null,
    showMeter && f.meterLabel && f.meterLabel !== base ? f.meterLabel : null,
    base,
  ].filter((s): s is string => !!s).join(' ')
}

const BLANK_ROW: NoticeBodyRow = {
  name: '', prev: null, curr: null, factor: null, area: null, h: null, qty: null, qtyText: null,
  qtyIsMoney: false, price: null, priceText: null, priceIsPct: false, amount: 0, note: '', meterQty: null,
}

function bodyRow(
  m: MaintRow<BillNoticeLineDTO>, notes: Map<string, string>,
  maint: boolean, showPremise: boolean, showMeter: boolean,
): NoticeBodyRow {
  const members = m.kind === 'line' ? [m.line] : m.row.members
  const f = members[0]
  const amount = m.kind === 'line' ? r2(m.line.amount) : m.row.amount
  const nk = m.kind === 'line' ? lineNoteKey(m.line) : mergeNoteKey(m.row.feeKey, f.premise)
  const engine = m.kind === 'line' ? m.line.note : m.row.note
  const base: NoticeBodyRow = {
    ...BLANK_ROW,
    name: projectName(m, maint, showPremise, showMeter),
    amount,
    note: noteDisplay(notes, nk, engine).text,
  }
  // 用量/单价一律取 billQtyCell(单行)或 mergeMaintRows 已算好的合并格(多行)——与屏上同源
  const cell = m.kind === 'merge'
    ? (m.row.qty != null && m.row.price != null ? { qty: m.row.qty, unit: m.row.unit, price: m.row.price } : null)
    : billQtyCell(m.line)

  // ① 装机容量费:实际用量列是「25千伏安」文本(源册 I5),不入用量合计
  if (f.feeKey === 'capacity')
    return { ...base, qtyText: f.qty == null ? null : `${f.qty}千伏安`, price: f.priceSnap }
  // ② 线路损耗:I=金额基数(0.00) J=损耗率(0.00%) L=固定说明(源册 R42)
  if (f.feeKey === 'share_elec_loss') {
    const b = sumOf(members, l => l.baseSnap)
    return {
      ...base, qty: b, qtyIsMoney: true, priceIsPct: true,
      price: sameOf(members, l => l.priceSnap) ?? (b ? amount / b : null),
      note: base.note || LOSS_NOTE,
    }
  }
  // ③ 按份数摊(电梯/消防/楼层):H「每层」,I 每层单价,J「元，共N层」(源册 R40/R41)。
  //    ⭐份数优先于面积:合并行常是「车间层份池 + 园区面积池」两成员(王红婷消防=车间43.60×0.11
  //    + 园区0.015×面积),源册正是把面积部分折进每层单价(I41=ROUND(V71+V46×面积/层份,2)=114.1)。
  //    按 members[0] 判形状会误落面积分支,单价变成 12.56÷1034.11=0.0121457 这种无意义长小数。
  //    层份只取 floor 成员的 baseSnap(面积成员的 base 是㎡,混加即错)。
  const floorMs = members.filter(l => l.shareSrc === 'floor')
  if (floorMs.length) {
    const b = sumOf(floorMs, l => l.baseSnap)
    if (b) return { ...base, h: '每层', qty: r2(amount / b), priceText: `元，共${b}层` }
  }
  // ④ 按面积摊(纯面积行:路灯/绿化水):E:G 合并显面积,H「㎡」,J 单价(源册 R43/R47)
  if (f.shareSrc === 'area') {
    const a = sumOf(members, l => l.baseSnap)
    return {
      ...base, area: a, h: '㎡',
      price: num(cell?.price) ?? (a ? amount / a : null),
      note: base.note || AREA_NOTE,
    }
  }
  if (f.shareSrc === 'floor') {
    const b = sumOf(members, l => l.baseSnap)
    if (b) return { ...base, h: '每层', qty: r2(amount / b), priceText: `元，共${b}层` }
  }
  // ⑤ 逐表行:上月/本月行至+倍率+用量+单价(合并行读数不同,行至列留空)
  const single = members.length === 1 ? f : null
  const qty = cell?.qty ?? sumOf(members, l => l.qty)
  return {
    ...base,
    prev: single?.prevRead ?? null, curr: single?.currRead ?? null, factor: single?.factorSnap ?? null,
    qty,
    price: num(cell?.price) ?? sameOf(members, l => l.priceSnap),
    meterQty: cell && cell.unit !== '' ? null : qty,
  }
}

/** 单据正文分块(纯函数):电费/用电维护费/水费/用水维护费,维护费块过 mergeMaintRows(纸单口径一项一行)。
 *  ⚠ 块合计一律取 groupExcelStyle 的原始行累加,不经合并行 —— 合并是纯呈现层,一分钱不改。 */
export function buildNoticeSections(lines: BillNoticeLineDTO[], notes: Map<string, string>): NoticeSection[] {
  const xg = groupExcelStyle(lines)
  const out: NoticeSection[] = []
  for (const s of SECTIONS) {
    const groups = (s.water ? xg.water : xg.elec).groups
    const all = groups.flatMap(p => (s.maint ? p.maint : p.fee))
    if (!all.length) continue
    const showPremise = new Set(all.map(l => l.premise)).size > 1
    const showMeter = new Set(all.map(l => l.meterLabel).filter(Boolean)).size > 1
    const rows: NoticeBodyRow[] = []
    for (const p of groups) {
      const ls = s.maint ? p.maint : p.fee
      if (!ls.length) continue
      // 合并粒度=场地带内(与抽屉同口径:「一个地块一个地块的给我」)
      const mrows: MaintRow<BillNoticeLineDTO>[] = s.maint
        ? mergeMaintRows(ls)
        : ls.map(l => ({ kind: 'line' as const, line: l }))
      for (const mr of mrows) rows.push(bodyRow(mr, notes, s.maint, showPremise, showMeter))
    }
    const qs = rows.map(r => r.meterQty).filter((v): v is number => v != null)
    out.push({
      label: s.label, water: s.water, maint: s.maint, rows,
      total: r2(groups.reduce((a, p) => a + (s.maint ? p.maintTotal : p.feeTotal), 0)),
      qtyTotal: qs.length ? r2(qs.reduce((a, b) => a + b, 0)) : null,
    })
  }
  // 未知费项键兜底成一块,别丢行(引擎加费项时不会静默消失)
  if (xg.other.length) {
    out.push({
      label: '其他费项', water: true, maint: true,
      rows: xg.other.map(l => bodyRow({ kind: 'line', line: l }, notes, false, false, false)),
      total: xg.otherTotal, qtyTotal: null,
    })
  }
  return out
}

/** 文件名(§5.1):公司文件夹 / 水电费缴费通知单-YYYY年MM月-户名.xlsx;sanitize 同 billExcel。 */
export function noticeFileName(company: string | null, ym: string, tenantName: string | null): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '')
  const [y, mo] = ym.split('-')
  const dir = safe(company ?? '') || '未指定收款公司'
  return `${dir}/水电费缴费通知单-${y}年${mo}月-${safe(tenantName ?? '') || '租户'}.xlsx`
}

// ═══ exceljs 版式层 ═══════════════════════════════════════════
// 列宽/页面设置/字号/行高全部照源册实测值。字体 Calibri(源册 charset 134,中文按系统回退)。
const COL_WIDTHS = [3.43, 4, 6.86, 17.43, 10.86, 9.86, 8.43, 9.29, 10.71, 13.29, 12.86, 16.71]
const FONT = 'Calibri'
const MONEY = '0.00_ '           // 源册 K 列格式(尾部 _ 留出负号位)
const PCT = '0.00%'
const C_FIRST = 2                // B
const C_LAST = 12                // L
const TITLE = '水电费缴费通知单'
const BANNER = '以上是贵公司水电费明细，麻烦把水电费存入我公司以下账户，谢谢！'
const LATE_NOTE = '滞纳金按每日  ‰收取'
const HEAD_E = ['上月行至', '本月行至', '倍率', '按尖峰电价收取比率', '实际用量', '单价', '金额', '备注']
const HEAD_W = ['上月行至', '本月行至', '倍率', '', '实际用量', '单价', '金额', '备注']

type Align = 'left' | 'center' | 'right'
interface Seg {
  from: number
  to?: number
  v?: string | number | Date | null
  bold?: boolean
  size?: number
  align?: Align
  fmt?: string
  wrap?: boolean
}
interface RowOpt { h?: number; top?: BorderStyle; bottom?: BorderStyle; naked?: boolean }

// 一行按「段」声明,段内横向合并,段两端自动取外框线(B 左双线 / L 右双线);未声明列补空白带框格,
// 否则表框会断线。⚠ 边框必须写在合并后的主格上:Excel 用主格样式画整个合并区的边。
function writeRow(ws: Worksheet, r: number, segs: Seg[], o: RowOpt = {}): void {
  const covered = new Set<number>()
  for (const s of segs) for (let c = s.from; c <= (s.to ?? s.from); c++) covered.add(c)
  const blanks: Seg[] = []
  for (let c = C_FIRST; c <= C_LAST; c++) if (!covered.has(c)) blanks.push({ from: c })
  for (const s of [...segs, ...blanks]) {
    const to = s.to ?? s.from
    if (to > s.from) ws.mergeCells(r, s.from, r, to)
    const cell = ws.getCell(r, s.from)
    if (s.v != null) cell.value = s.v
    cell.font = { name: FONT, size: s.size ?? 11, bold: !!s.bold }
    cell.alignment = { horizontal: s.align ?? 'center', vertical: 'middle', wrapText: !!s.wrap }
    if (s.fmt) cell.numFmt = s.fmt
    if (!o.naked) {
      cell.border = {
        top: { style: o.top ?? 'thin' },
        bottom: { style: o.bottom ?? 'thin' },
        left: { style: s.from === C_FIRST ? 'double' : 'thin' },
        right: { style: to === C_LAST ? 'double' : 'thin' },
      }
    }
  }
  if (o.h) ws.getRow(r).height = o.h
}

function writeBodyRow(ws: Worksheet, r: number, b: NoticeBodyRow): void {
  const segs: Seg[] = [{ from: 4, v: b.name, align: 'left' }]
  if (b.area != null) segs.push({ from: 5, to: 7, v: b.area, align: 'right' })
  else {
    segs.push({ from: 5, v: b.prev }, { from: 6, v: b.curr }, { from: 7, v: b.factor })
  }
  if (b.h) segs.push({ from: 8, v: b.h, align: b.h === '每层' ? 'right' : 'center' })
  segs.push({ from: 9, v: b.qtyText ?? b.qty, fmt: b.qtyIsMoney ? MONEY : undefined })
  segs.push(b.priceText != null
    ? { from: 10, v: b.priceText, align: 'left' }
    : { from: 10, v: b.price, fmt: b.priceIsPct ? PCT : undefined })
  segs.push({ from: 11, v: b.amount, fmt: MONEY })
  if (b.note) segs.push({ from: 12, v: b.note, align: 'left', wrap: true })
  writeRow(ws, r, segs, { h: 21 })
}

/** 一联通知单落到一张 worksheet(§5.3 版式);返回最后一行号。 */
function writeNoticeSheet(
  ws: Worksheet, g: PayGroup, item: NoticeExportItem, ym: string,
  account: CompanyAccount | null, company: Company | null,
): void {
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const [y, mo] = ym.split('-')
  const sections = buildNoticeSections(g.lines, item.notes)
  const tenant = item.tenantName ?? `#${item.tenantId}`
  let r = 1

  writeRow(ws, r++, [{ from: 2, to: 12, v: TITLE, bold: true, size: 12 }], { h: 21, naked: true })
  writeRow(ws, r++, [{ from: 2, to: 12, v: `计费期限：${y}年${+mo}月` }], { h: 21, naked: true })
  writeRow(ws, r++, [
    { from: 2, to: 7, v: `租户名称：${tenant}` },
    { from: 9, v: '位置：', align: 'right' },
    { from: 10, to: 12, v: item.premiseText, wrap: true },
  ], { h: 21, naked: true })

  let side: 'e' | 'w' | null = null
  for (const s of sections) {
    const mySide = s.water ? 'w' : 'e'
    if (side !== mySide) {
      side = mySide
      const heads = s.water ? HEAD_W : HEAD_E
      writeRow(ws, r++, [
        { from: 2, to: 4, v: '项目' },
        ...heads.map((v, i) => ({ from: 5 + i, v: v || null })),
      ], { h: s.water ? 20.1 : 39.95, top: 'double' })
    }
    const first = r
    for (const b of s.rows) writeBodyRow(ws, r++, b)
    // B:C 竖跨块名(源册 B5:C10「电费」);合并后主格承载样式
    ws.mergeCells(first, 2, r - 1, 3)
    const label = ws.getCell(first, 2)
    label.value = s.label
    label.font = { name: FONT, size: 9 }
    label.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    label.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'double' }, right: { style: 'thin' } }
    writeRow(ws, r++, [
      { from: 2, to: 4, v: `${s.label}合计`, bold: true },
      { from: 9, v: s.qtyTotal, bold: true },
      { from: 11, v: s.total, bold: true, fmt: MONEY },
    ], { h: s.water ? 20.1 : 29.1 })
  }

  const grand = r2(g.total + g.prevDue)
  writeRow(ws, r++, [
    // 联内只有维护费块时,源册合计行原文是「水电维护费合计」(维护费联走另一家公司)
    { from: 2, to: 4, v: sections.every(s => s.maint) ? '水电维护费合计' : '水电费合计', bold: true },
    { from: 11, v: g.total, bold: true, fmt: MONEY },
  ], { h: 23.1, top: 'double', bottom: 'double' })
  writeRow(ws, r++, [
    { from: 2, to: 3, v: '本期合计' },
    { from: 4, to: 7, v: g.total, bold: true, fmt: MONEY },
    { from: 9, to: 10, v: LATE_NOTE },
    { from: 11, to: 12 },
  ], { h: 27 })
  writeRow(ws, r++, [
    { from: 2, to: 3, v: '上期欠费' },
    { from: 4, to: 7, v: g.prevDue || null, bold: true, fmt: MONEY },
    { from: 9, to: 10, v: '总  计' },
    { from: 11, to: 12, v: grand, bold: true, fmt: MONEY },
  ], { h: 21, bottom: 'double' })

  // 无账户信息 → 收款语与账户块整块省略(源册 17/56 户即如此;留着「以下账户」却没账户是假话)
  const acct = account && [
    account.accountName && `户名：${account.accountName}`,
    account.accountNo && `账号：${account.accountNo}`,
    account.bankName && `开户行：${account.bankName}`,
    account.remark && `备注：${account.remark}`,
  ].filter(Boolean).join('\n')
  if (acct) {
    writeRow(ws, r++, [{ from: 2, to: 12, v: BANNER, align: 'left' }], { h: 21, top: 'double' })
    for (let i = 0; i < 3; i++) writeRow(ws, r + i, [], { h: 21 })
    ws.mergeCells(r, 2, r + 2, 12)
    const box = ws.getCell(r, 2)
    box.value = acct
    box.font = { name: FONT, size: 11 }
    box.alignment = { vertical: 'middle', wrapText: true }
    box.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'double' }, right: { style: 'double' } }
    r += 3
  }

  writeRow(ws, r++, [
    { from: 2, to: 3, v: '制表', bold: true }, { from: 4, to: 7, bold: true },
    { from: 9, v: '复核', bold: true }, { from: 10, to: 12, bold: true },
  ], { h: 21, top: 'double', bottom: 'double' })
  writeRow(ws, r++, [{ from: 2, to: 12, v: '通知单签收信息栏', bold: true }], { h: 21, top: 'double' })
  writeRow(ws, r++, [
    { from: 2, to: 4, v: '签收企业', bold: true }, { from: 5, to: 12, v: tenant, bold: true },
  ], { h: 21 })
  writeRow(ws, r++, [
    { from: 2, to: 4, v: '签收人', bold: true }, { from: 5, to: 7, bold: true },
    { from: 9, v: '职务', bold: true }, { from: 10, to: 12, bold: true },
  ], { h: 21 })
  writeRow(ws, r++, [
    { from: 2, to: 4, v: '签收日期', bold: true }, { from: 5, to: 12, bold: true },
  ], { h: 21, bottom: 'double' })
  const lastRow = r - 1

  // 落款(源册 K29/K30:公司全称 + 日期,右下无框)
  r += 2
  writeRow(ws, r++, [{ from: 11, v: company?.fullName || company?.name || g.companyName, size: 12, align: 'left' }],
    { h: 21, naked: true })
  writeRow(ws, r, [{ from: 11, to: 12, v: new Date(), size: 12, fmt: 'yyyy-mm-dd' }], { h: 21, naked: true })

  ws.pageSetup.printArea = `B1:L${lastRow}`
}

const PAGE_SETUP = {
  paperSize: 9, orientation: 'portrait' as const, scale: 85, horizontalCentered: true,
  margins: { left: 0.16, right: 0.16, top: 0.39, bottom: 0.59, header: 0.51, footer: 0.51 },
}

const loadExcelJS = async () => (await import('exceljs')).Workbook

/** 单联通知单 → xlsx 字节(批量与单户共用)。 */
export async function noticeWorkbookBytes(
  g: PayGroup, item: NoticeExportItem, ym: string,
  account: CompanyAccount | null, company: Company | null,
): Promise<Uint8Array> {
  const Workbook = await loadExcelJS()
  const wb = new Workbook()
  const ws = wb.addWorksheet(item.tenantName?.slice(0, 28) || `#${item.tenantId}`, {
    pageSetup: PAGE_SETUP, properties: { defaultRowHeight: 21 },
  })
  writeNoticeSheet(ws, g, item, ym, account, company)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** 发租户·通知单(§5.1):一户一联按收款公司拆,zip 按公司分文件夹。 */
export async function exportNoticeZip(
  items: NoticeExportItem[], ym: string,
  accountOf: (companyId: number | null) => CompanyAccount | null,
  companyOf: (id: number | null) => Company | null,
): Promise<{ files: number }> {
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  for (const item of items) {
    for (const g of splitByPayCompany(item)) {
      const co = companyOf(g.companyId)
      const dir = co?.short || co?.name || g.companyName
      let name = noticeFileName(dir, ym, item.tenantName)
      // sanitize 后撞名兜底(如「甲/乙」与「甲乙」);同户同公司两联理论上已被 splitByPayCompany 合并
      for (let i = 2; files[name]; i++) name = noticeFileName(dir, ym, `${item.tenantName ?? ''}~${i}`)
      files[name] = await noticeWorkbookBytes(g, item, ym, accountOf(g.companyId), co)
      // 让出宏任务:百来户连成一个不间断长任务会让按钮不变灰、界面僵死到导完(billExcel 同手法)
      await new Promise(r => setTimeout(r))
    }
  }
  const count = Object.keys(files).length
  if (count) {
    // ponytail: level 0 存储——xlsx 本身已是 deflate 压缩包,再压白耗 CPU
    downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }),
      `水电费缴费通知单-${ym.replace('-', '年')}月.zip`)
  }
  return { files: count }
}

// ── 发财务·对账表(§5.2):每家公司一 sheet(户 × 费项 × 金额)+ 总表 ──
export interface ReconRow {
  companyId: number | null
  tenantId: number
  tenantName: string | null
  feeKey: string
  amount: number
}
type Cell = string | number

/** 单公司 sheet 的 AOA(纯函数):列=费项(首现序,中文名走 billFeeLabel),行=户,末列合计,末行列合计。 */
export function buildReconSheet(rows: ReconRow[]): Cell[][] {
  const keys: string[] = []
  const order: number[] = []
  const byT = new Map<number, { name: string; fees: Map<string, number> }>()
  for (const r of rows) {
    if (!keys.includes(r.feeKey)) keys.push(r.feeKey)
    let t = byT.get(r.tenantId)
    if (!t) {
      t = { name: r.tenantName ?? `#${r.tenantId}`, fees: new Map() }
      byT.set(r.tenantId, t)
      order.push(r.tenantId)
    }
    t.fees.set(r.feeKey, r2((t.fees.get(r.feeKey) ?? 0) + r.amount))
  }
  const body = order.map(id => {
    const t = byT.get(id)!
    const vals = keys.map(k => t.fees.get(k) ?? 0)
    return [t.name, ...vals, r2(vals.reduce((a, b) => a + b, 0))] as Cell[]
  })
  const cols = keys.map((_, i) => r2(body.reduce((s, b) => s + (b[i + 1] as number), 0)))
  return [
    ['租户', ...keys.map(billFeeLabel), '合计'],
    ...body,
    [`合计 · ${body.length} 户`, ...cols, r2(cols.reduce((a, b) => a + b, 0))],
  ]
}

/** 总表 AOA:各公司户数/金额合计 + 未设置收款公司清单(催缴人要一眼看见谁还没指公司)。 */
export function buildReconSummary(rows: ReconRow[], sheets: { companyId: number | null; name: string }[]): Cell[][] {
  const aoa: Cell[][] = [['收款公司', '户数', '金额合计(元)']]
  for (const s of sheets) {
    const rs = rows.filter(r => r.companyId === s.companyId)
    aoa.push([s.name, new Set(rs.map(r => r.tenantId)).size, r2(rs.reduce((a, r) => a + r.amount, 0))])
  }
  aoa.push(['合计', new Set(rows.map(r => r.tenantId)).size, r2(rows.reduce((a, r) => a + r.amount, 0))])
  const unset = rows.filter(r => r.companyId == null)
  if (unset.length) {
    aoa.push([], ['未设收款公司清单'], ['租户', '费用项', '金额(元)'])
    for (const r of unset) aoa.push([r.tenantName ?? `#${r.tenantId}`, billFeeLabel(r.feeKey), r2(r.amount)])
  }
  return aoa
}

// Excel sheet 名禁用字符与 31 字上限
const sheetName = (s: string) => (s.replace(/[\\/:*?[\]]/g, '').slice(0, 31) || 'sheet')

export async function reconWorkbookBytes(
  rows: ReconRow[], ym: string, sheets: { companyId: number | null; name: string }[],
): Promise<Uint8Array> {
  const Workbook = await loadExcelJS()
  const wb = new Workbook()
  const add = (name: string, aoa: Cell[][], head: number) => {
    const ws = wb.addWorksheet(sheetName(name))
    for (const row of aoa) ws.addRow(row)
    for (let i = 1; i <= head; i++) ws.getRow(i).font = { name: FONT, size: 11, bold: true }
    ws.getRow(aoa.length).font = { name: FONT, size: 11, bold: true }
    ws.getColumn(1).width = 24
    for (let c = 2; c <= (aoa[0]?.length ?? 1); c++) ws.getColumn(c).width = 14
  }
  add('总表', [[`${ym} 催缴单对账表`], ...buildReconSummary(rows, sheets)], 2)
  for (const s of sheets) add(s.name, buildReconSheet(rows.filter(r => r.companyId === s.companyId)), 1)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** 发财务·对账表(§5.2):单文件多 sheet 下载。 */
export async function exportReconWorkbook(
  rows: ReconRow[], ym: string, sheets: { companyId: number | null; name: string }[],
): Promise<void> {
  const bytes = await reconWorkbookBytes(rows, ym, sheets)
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `催缴单对账表-${ym.replace('-', '年')}月.xlsx`)
}
