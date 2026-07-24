// 合同计费行提取导入(BILL-FORWARD-SPEC 刀1 三次返工 §1.2)。蓝本=调研脚本 audit.py 的块探测逻辑。
// 对象:月度租金工作簿(一期/二期,每租户一 sheet=上部汇总+下部通知单块)。
// 版式:A1~A7 七型通知单块自动提取;B(流水账)/C(仅汇总)/D(混合)无可提取块 → 整 sheet 报「须手录」不阻断整批。
//
// 三次返工核心转向(§1.2):停止收敛。每条费项行 1:1 出一条 BillingLine(location+fee_key枚举+area+
// unit_price+coeff+room_count+bill_mode),不再折进五标量字段,治「多价撞车丢16户租金」根 bug。
// 解析陷阱(调研实证,逐条落地):
//   ① 叠单合并:单 sheet 堆叠 2~5 张通知单块 → 全块行归入该户费项合集(同户多位置段并存),不各自成户。
//   ② 表头转置:「收费项目|物业名称」标题互换但数据恒为 location 在前列 → 按「位置在前列」定位,不信表头文字。
//   ③ 数值列无固定列号:按表头文本映射列位(面积/单价/系数/月单价/金额/房数),不按固定列索引。
//   ④ 按间房数 3 写法:整数入房数列 / 「N间」文本 / 留空靠房号列表隐含数量。
//   ⑤ 系数真值仅翔海/旭化成 1.56:思汗式「单价空、宿舍价填进系数列」错位 → 忽略回填 coeff=1(单价空则系数不当真)。
//   ⑥ multiPick 多合同户(银纳 2 合同):按位置类型路由 —— 厂房行→厂房合同、宿舍行→宿舍合同。
// 无合同户(翔海类)报「须先建合同」,不猜建、不静默丢。fee_name 归一到 13 枚举(非自由文本)。
import type { ImportRec } from './importHeaderMatch'
import type { FeeKey, BillMode, BillingLineImport } from '@/types/contract'
import { FEE_NAME, defaultBillMode } from '@/types/contract'

export const BILLING_TERM_TEMPLATE_COLS = ['租户(sheet名)', '合同号', '位置数', '计费行数', '费项摘要', '来源sheet']

// ── 主数据上下文(视图/registry 预取喂入) ──
export interface BillingContractLite {
  id: number; contractNo: string; tenantName: string
  startDate: string | null; endDate: string | null; status: string
  buildingName?: string | null   // multiPick 位置路由用(厂房/宿舍),缺省按厂房
}
export interface BillingTermCtxData { contracts: BillingContractLite[] }

export interface BillingTermError { rowIndex: number; label: string; reason: string }

// 费项枚举中文名/默认计费方式复用 types/contract(FEE_NAME/defaultBillMode),不重复定义。

// 费项原文 → 枚举归一(顺序敏感:专项名先于泛化名)
export function normalizeFeeKey(name: string): FeeKey {
  const s = String(name ?? '').replace(/\s/g, '')
  if (/电梯/.test(s)) return 'elevator'
  if (/变压器/.test(s)) return 'transformer'
  if (/门禁/.test(s)) return 'access'
  if (/网络|通讯/.test(s)) return 'network'
  if (/管理/.test(s)) return 'mgmt'
  if (/基础设施|基础维护|设施维护/.test(s)) return 'infra'
  if (/土地使用税|土地税|房产税|.+税$/.test(s)) return 'land_tax'
  if (/租金|租赁费/.test(s)) {
    if (/宿舍|公寓|员工/.test(s)) return 'rent_dorm'
    if (/办公/.test(s)) return 'rent_office'
    if (/商铺|商业|门面|店/.test(s)) return 'rent_shop'
    if (/空地|场地|堆场|露天/.test(s)) return 'rent_land'
    return 'rent_factory'
  }
  return 'other'
}

// ── audit.py 移植:费项行判定 / 表头映射 ──
const FEE_WORDS = ['租金', '维护费', '服务费', '通讯费', '税', '其他费用', '维保费', '水电', '电费', '水费', '门禁', '网络']
const isFeeItem = (v: unknown): boolean => {
  const s = String(v ?? '').trim()
  return s !== '' && s.length < 20 && FEE_WORDS.some(w => s.includes(w))
}

type HeaderField = 'item' | 'prop' | 'room' | 'room_count' | 'tax_rate' | 'monthly' | 'unit_excl'
  | 'unit_incl' | 'unit_alloc' | 'unit' | 'area_open' | 'area' | 'coef' | 'amount' | 'remark'

function mapHeader(title: unknown): HeaderField | null {
  const t = String(title ?? '').replace(/\s/g, '')
  if (t === '') return null
  if (t === '收费项目' || t === '费用项目' || t === '费项') return 'item'
  if (t === '物业名称' || t === '位置' || t === '房产名称') return 'prop'
  if (t === '房数' || t === '间数') return 'room_count'
  if (t === '房号' || t === '房间号') return 'room'
  if (t.includes('税率')) return 'tax_rate'
  if (t.includes('月单价')) return 'monthly'
  if (t.includes('不含税')) return 'unit_excl'
  if (t.includes('含税') && t.includes('单价')) return 'unit_incl'
  if (t.includes('分摊面积单价')) return 'unit_alloc'
  if (t.includes('面积单价') || t.includes('建筑面积单价')) return 'unit'
  if (t === '单价' || t === '单价（元）' || t === '单价(元)') return 'unit'
  if (t.includes('空地面积')) return 'area_open'
  if (t.includes('面积')) return 'area'
  if (t.includes('系数')) return 'coef'
  if (t.includes('金额')) return 'amount'
  if (t.includes('备注')) return 'remark'
  return null
}

const cellS = (m: string[][], r: number, c: number): string => String(m[r]?.[c] ?? '').trim()
const toNum = (v: unknown): number | null => {
  const s = String(v ?? '').replace(/[,，¥￥%\s]/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const r2 = (n: number): number => Math.round(n * 100) / 100

// 文本单价取数(「100元/年/间」「面议」…):抽首个数值,失败 null
function unitFromText(text: string): number | null {
  const m = /([\d.]+)/.exec(String(text ?? '').replace(/[,，]/g, ''))
  return m ? Number(m[0]) : null
}

// 按间房数 3 写法(§1.2 陷阱④):整数入房数列 / 「N间」文本 / 留空靠房号列表隐含数量
function roomsOf(roomCount: string | null, roomList: string | null): number | null {
  if (roomCount) {
    const n = toNum(roomCount)
    if (n != null) return Math.round(n)
    const m = /(\d+)\s*间/.exec(roomCount)
    if (m) return +m[1]
  }
  if (roomList) {
    const m = /(\d+)\s*间/.exec(roomList)
    if (m) return +m[1]
    const parts = roomList.split(/[,，、;；\/\s]+/).filter(Boolean)
    if (parts.length) return parts.length
  }
  return null
}

// sheet 标题/上部汇总块里识别文件所属月(前 8 行任意单元格「yyyy年m月」或「yyyy.mm」)
function detectYm(matrix: string[][]): { year: number; month: number } | null {
  for (let r = 0; r < Math.min(8, matrix.length); r++) {
    for (const cell of matrix[r] ?? []) {
      const s = String(cell ?? '')
      let m = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(s)
      if (!m) m = /(\d{4})\.(\d{1,2})(?!\d)/.exec(s)
      if (m) return { year: +m[1], month: +m[2] }
    }
  }
  return null
}

// 该租户在 ym 月生效中的合同;唯一命中=直入,多合同=候选(§1.2-4 别名收敛,同二次返工)。
const normName = (s: string) => s.replace(/[\s()（）·]/g, '')
function matchContract(tenant: string, ym: { year: number; month: number } | null,
    contracts: BillingContractLite[]): { candidates: BillingContractLite[]; reason?: string } {
  const inForce = contracts.filter(c => c.status !== 'terminated' && c.status !== 'draft')
  let cands = inForce.filter(c => c.tenantName.trim() === tenant)
  if (!cands.length) {
    const t = normName(tenant)
    if (t.length >= 2) {
      const fuzzy = inForce.filter(c => {
        const n = normName(c.tenantName)
        return n.length >= 2 && (n.includes(t) || t.includes(n))
      })
      const names = [...new Set(fuzzy.map(c => c.tenantName))]
      if (names.length === 1) cands = fuzzy
      else if (names.length > 1) return { candidates: [], reason: `名称近似多租户(${names.join('/')}),不猜,待核` }
    }
  }
  if (!cands.length) {
    return { candidates: [], reason: contracts.some(c => c.tenantName.trim() === tenant) ? '租户有合同但无生效中的' : '未匹配到租户/合同' }
  }
  if (ym) {
    const mStart = `${ym.year}-${String(ym.month).padStart(2, '0')}-01`
    const mEnd = `${ym.year}-${String(ym.month).padStart(2, '0')}-31`
    const inMonth = cands.filter(c => (!c.startDate || c.startDate <= mEnd) && (!c.endDate || c.endDate >= mStart))
    if (inMonth.length) cands = inMonth
  }
  return { candidates: cands }
}

// ── 单 sheet 解析:块探测(A1~A7,叠单多块)+ 行 1:1 出 FeeLine ──
export interface FeeLine extends BillingLineImport {
  location: string; feeKey: FeeKey; feeName: string
  area: number | null; unitPrice: number | null; coeff: number
  roomCount: number | null; billMode: BillMode; amountOverride: number | null; note: string | null
}

function parseSheetLines(matrix: string[][]): { lines: FeeLine[]; ledgerBlocks: number; hadBlocks: boolean } {
  const nrow = Math.min(matrix.length, 300)
  const maxCol = 24
  let ledgerBlocks = 0
  const hdrRows: number[] = []
  for (let r = 0; r < nrow; r++) {
    for (let c = 0; c < maxCol; c++) {
      const v = cellS(matrix, r, c).replace(/\s/g, '')
      if (v === '本月合计') ledgerBlocks++
      if ((v === '收费项目' || v === '费用项目' || v === '费项') && !hdrRows.includes(r)) hdrRows.push(r)
    }
  }
  const lines: FeeLine[] = []
  let hadBlocks = false
  for (const hr of hdrRows) {
    const cols: Partial<Record<HeaderField, number>> = {}
    for (let c = 0; c < maxCol; c++) {
      const f = mapHeader(matrix[hr]?.[c])
      if (f && cols[f] == null) cols[f] = c
    }
    if (cols.item == null) continue
    // 陷阱②表头转置:数据恒为「位置在前列」→ location=较小列,fee=较大列(不信表头文字)
    const feeCol = cols.prop != null ? Math.max(cols.item, cols.prop) : cols.item
    const locCol = cols.prop != null ? Math.min(cols.item, cols.prop) : null
    hadBlocks = true
    for (let r = hr + 1; r < nrow && r - hr <= 120; r++) {
      const locVal = locCol != null ? cellS(matrix, r, locCol) : ''
      const guard = locVal || cellS(matrix, r, feeCol)
      if (guard === '合计' || guard === '总计' || guard === '小计') break
      const item = cellS(matrix, r, feeCol)
      if (!isFeeItem(item)) continue
      const get = (f: HeaderField): string | null => cols[f] != null ? cellS(matrix, r, cols[f]!) || null : null
      const num = (f: HeaderField): number | null => cols[f] != null ? toNum(matrix[r]?.[cols[f]!]) : null

      const feeKey = normalizeFeeKey(item)
      const billMode = defaultBillMode(feeKey)
      const location = locVal || '主'
      const area = num('area') ?? num('area_open')
      const sqmPrice = num('unit_incl') ?? num('unit_alloc') ?? num('unit')
      const rawCoeff = num('coef')
      const monthly = num('monthly')
      const amount = num('amount')

      const notes: string[] = []
      const remark = get('remark'); if (remark) notes.push(remark)
      const taxRate = num('tax_rate'); if (taxRate != null) notes.push(`税率${taxRate}`)
      const unitExcl = num('unit_excl'); if (unitExcl != null) notes.push(`不含税${unitExcl}`)
      const openArea = num('area_open'); if (openArea != null && feeKey !== 'rent_land') notes.push(`空地面积${openArea}`)

      let line: FeeLine
      if (billMode === 'per_room_year' || billMode === 'per_room_month') {
        // 门禁/网络:按间计费。单价可为文本(「100元/年/间」滑列)→ 抽数;房数三写法。
        let up = sqmPrice
        const unitTxt = get('unit')
        if (up == null && unitTxt && toNum(unitTxt) == null) { up = unitFromText(unitTxt); notes.push(`原价文本「${unitTxt}」`) }
        const rooms = roomsOf(get('room_count'), get('room'))
        line = { location, feeKey, feeName: item, area: null, unitPrice: up, coeff: 1,
          roomCount: rooms, billMode, amountOverride: null, note: null }
      } else if (billMode === 'per_month') {
        // 固定月额(电梯/变压器/税/其他):直填月额,面积单价空。
        line = { location, feeKey, feeName: item, area: null, unitPrice: null, coeff: 1,
          roomCount: null, billMode, amountOverride: monthly ?? amount, note: null }
      } else {
        // per_sqm_month:面积×单价×系数。系数真值仅翔海/旭化成——单价空则系数不当真(陷阱⑤忽略回填)。
        const coeff = (sqmPrice != null && rawCoeff != null && rawCoeff > 0) ? rawCoeff : 1
        const override = sqmPrice == null && area == null && (monthly ?? amount) != null ? (monthly ?? amount) : null
        line = { location, feeKey, feeName: item, area, unitPrice: sqmPrice, coeff,
          roomCount: null, billMode, amountOverride: override, note: null }
      }
      line.note = notes.length ? notes.join(';') : null
      lines.push(line)
    }
  }
  return { lines, ledgerBlocks, hadBlocks }
}

// ── multiPick 位置路由(§1.2 陷阱⑥,银纳类) ──
type Kind = 'dorm' | 'factory'
const contractKind = (c: BillingContractLite): Kind =>
  /宿舍|公寓|员工/.test((c.buildingName ?? '') + c.contractNo) ? 'dorm' : 'factory'
const lineKind = (l: FeeLine): Kind =>
  /宿舍|公寓|员工/.test(l.location) || l.feeKey === 'rent_dorm' ? 'dorm' : 'factory'

// ── 到户报告(§1.2-8:在册合同全量逐户有名) ──
export interface BillingReportRow {
  tenantName: string; contractNo: string
  state: 'imported' | 'manual_required' | 'not_in_file' | 'pending_pick'
  lineCount: number; locations: number; fees: string; sheet: string | null; issues: string
}

const STATE_LABEL: Record<BillingReportRow['state'], string> = {
  imported: '已导入', manual_required: '须手录', not_in_file: '未见于本册(空待录)', pending_pick: '多合同待人选',
}

export function billingReportCsv(rows: BillingReportRow[]): string {
  const head = ['租户', '合同号', '状态', '计费行数', '位置段数', '费项摘要', '来源sheet', '说明']
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = rows.map(r => [r.tenantName, r.contractNo, STATE_LABEL[r.state],
    r.lineCount, r.locations, r.fees, r.sheet ?? '', r.issues].map(esc).join(','))
  return '﻿' + head.join(',') + '\n' + lines.join('\n')
}

export interface BillingTermSection { label: string; records: ImportRec[]; checked?: boolean }

// 计费行摘要:按 location 分组列费项枚举中文(预览/报告用)
function feeSummary(lines: FeeLine[]): string {
  const byLoc = new Map<string, FeeKey[]>()
  for (const l of lines) {
    const arr = byLoc.get(l.location) ?? []
    arr.push(l.feeKey); byLoc.set(l.location, arr)
  }
  return [...byLoc.entries()].map(([loc, keys]) =>
    `${loc}:${[...new Set(keys)].map(k => FEE_NAME[k]).join('/')}`).join('; ')
}
const locCount = (lines: FeeLine[]) => new Set(lines.map(l => l.location)).size

// ── 整册解析(parseWorkbook 契约)——停止收敛,每计费行 1:1 落库 ──
export function parseBillingTermsWorkbook(
  sheets: { name: string; matrix: string[][] }[],
  ctx: BillingTermCtxData,
): { sections: BillingTermSection[]; errors: BillingTermError[]; report: BillingReportRow[]; feeLineTotal: number } {
  const sections: BillingTermSection[] = []
  const errors: BillingTermError[] = []
  const manualSheets = new Map<string, string>()   // 租户名 → 须手录/须先建合同原因
  const byContract = new Map<number, { lines: FeeLine[]; sheet: string; pick: boolean }>()
  let feeLineTotal = 0

  // 唯一命中先按合同归并(同租户多 sheet:厂房册+宿舍册合并,叠单块自然并入);多候选留待路由/人选
  const merged = new Map<number, { contract: BillingContractLite; sheets: string[]; lines: FeeLine[]; ym: ReturnType<typeof detectYm> }>()
  const multi: { name: string; ym: ReturnType<typeof detectYm>; lines: FeeLine[]; candidates: BillingContractLite[] }[] = []

  for (const s of sheets) {
    const name = s.name.trim()
    if (/水电费|总表|应收费用总表|费用汇总表/.test(name)) continue   // 非租户 sheet 名单式排除
    const ym = detectYm(s.matrix)
    const { lines, ledgerBlocks, hadBlocks } = parseSheetLines(s.matrix)
    if (!hadBlocks) {
      const reason = ledgerBlocks > 0 ? '流水账式 sheet,须手录条款' : '无通知单块,须手录条款'
      manualSheets.set(name, reason)
      errors.push({ rowIndex: -1, label: name, reason })
      continue
    }
    feeLineTotal += lines.length
    const { candidates, reason } = matchContract(name, ym, ctx.contracts)
    if (!candidates.length) {
      const r = reason ?? '未匹配到生效合同'
      const final = /近似/.test(r) ? r : `须先建合同:${r}`
      errors.push({ rowIndex: -1, label: name, reason: final })
      manualSheets.set(name, final)
      continue
    }
    if (candidates.length > 1) { multi.push({ name, ym, lines, candidates }); continue }
    const c = candidates[0]
    const m = merged.get(c.id)
    if (m) { m.sheets.push(name); m.lines.push(...lines) }
    else merged.set(c.id, { contract: c, sheets: [name], lines: [...lines], ym })
  }

  const recOf = (contractId: number, lines: FeeLine[]): ImportRec => ({
    contractId, lines,
    __preview: [locCount(lines), lines.length, feeSummary(lines)],
  })
  const sectionLabel = (head: string, ym: ReturnType<typeof detectYm>, lines: FeeLine[]) =>
    `${head}${ym ? ` · ${ym.year}年${ym.month}月` : ''} · ${lines.length}行/${locCount(lines)}位置 · ${feeSummary(lines)}`

  for (const { contract, sheets: names, lines, ym } of merged.values()) {
    const label = names.join('+')
    sections.push({ label: sectionLabel(`${label} → ${contract.contractNo}`, ym, lines), records: [recOf(contract.id, lines)], checked: true })
    byContract.set(contract.id, { lines, sheet: label, pick: false })
  }

  // multiPick:位置类型可区分 → 自动路由(厂房行→厂房合同/宿舍行→宿舍合同,两段都用);否则退回人选其一
  for (const { name, ym, lines, candidates } of multi) {
    const kinds = candidates.map(contractKind)
    const routed = candidates.map(c => ({ c, cl: lines.filter(l => lineKind(l) === contractKind(c)) }))
    const canRoute = new Set(kinds).size === candidates.length && routed.every(r => r.cl.length > 0)
    if (canRoute) {
      for (const { c, cl } of routed) {
        sections.push({ label: sectionLabel(`${name} → ${c.contractNo}(位置路由)`, ym, cl), records: [recOf(c.id, cl)], checked: true })
        byContract.set(c.id, { lines: cl, sheet: name, pick: false })
      }
    } else {
      for (const c of candidates) {
        sections.push({ label: sectionLabel(`${name} → ${c.contractNo}(多合同,勾选其一)`, ym, lines), records: [recOf(c.id, lines)], checked: false })
        if (!byContract.has(c.id)) byContract.set(c.id, { lines, sheet: name, pick: true })
      }
    }
  }

  // 到户报告:在册合同(非终止/草稿)全量逐户有名
  const report: BillingReportRow[] = []
  for (const c of ctx.contracts) {
    if (c.status === 'terminated' || c.status === 'draft') continue
    const hit = byContract.get(c.id)
    const manualReason = manualSheets.get(c.tenantName.trim())
    if (hit) {
      report.push({
        tenantName: c.tenantName, contractNo: c.contractNo,
        state: hit.pick ? 'pending_pick' : 'imported',
        lineCount: hit.lines.length, locations: locCount(hit.lines), fees: feeSummary(hit.lines),
        sheet: hit.sheet, issues: '',
      })
    } else {
      report.push({
        tenantName: c.tenantName, contractNo: c.contractNo,
        state: manualReason ? 'manual_required' : 'not_in_file',
        lineCount: 0, locations: 0, fees: '',
        sheet: manualReason ? c.tenantName : null, issues: manualReason ?? '',
      })
    }
  }
  return { sections, errors, report, feeLineTotal }
}
