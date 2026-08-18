// 附表11 电费成本 — 真实模板逐行解析(bespoke,供 FpImportModal customParse)。
// 模板两行表头:r1 分组(进项 / 其中:基本用电)、r2 叶子(开票日期/用电时段/用电类别/单位/电量/
// 不含税单价/不含税金额/税率/税额/价税合计/计费需量/单价/基本用电费)。数据起 r3。
// 左块(记账期@0·期@1·用电时段@2·开票日期@3)合并/下填,位置固定;右块(用电类别起)表头与数据同列对齐,
// 按 r2 表头名定位列(扛列序微调)。记账期(YYYYMM 下填)→acctMonth;期(下填)→phaseId(一→p1/二→p2/三→p3)。
// 逐数据行(跳 小计/合计/总计):
//   energy 记录:type=energy,cat=用电类别·unit=单位·qty=电量·price=不含税单价·rate=税率·period=用电时段(空→null)。
//   basic  记录:行若「计费需量」非空(大工业行)→ 额外产 type=basic,demand=计费需量·price=单价(basic 列)·rate=同行税率(或 0)。
// 派生(不含税金额/税额/价税合计/基本用电费)不导,后端读时算。
import { excelSerialToDate, parseYearMonth } from './parseYearMonth'
import type { ImportRec } from './importHeaderMatch'

export interface ElecImportRow {
  type: 'energy' | 'basic'
  phaseId: string
  acctMonth: string
  invDate?: string | null
  period?: string | null
  cat?: string | null
  unit?: string | null
  qty?: number | null
  demand?: number | null
  price: number
  rate: number
  note?: string | null
}
export interface ElecParseError { rowIndex: number; label: string; reason: string }

// 左块固定列(数据层稳定:记账期/期 合并下填,用电时段/开票日期 紧随)
const COL_ACCT = 0
const COL_PHASE = 1
const COL_PERIOD = 2
const COL_INV = 3

// 右块表头名(r2 叶子),按名在表头行定位真实列号(对齐数据)
const H_CAT = '用电类别'
const H_UNIT = '单位'
const H_QTY = '电量'
const H_PRICE = '不含税单价'
const H_RATE = '税率'
const H_DEMAND = '计费需量'
const H_BASIC_PRICE = '单价'

const norm = (v: unknown) => String(v ?? '').replace(/\s/g, '')
const isSubtotal = (v: unknown) => /小计|合计|总计/.test(String(v ?? ''))

// '13%' / '0.13' / 13 → 小数税率;空 → 0
function parseRate(v: unknown): number {
  const s = String(v ?? '').trim()
  if (!s) return 0
  if (s.endsWith('%')) { const n = parseFloat(s); return isNaN(n) ? 0 : n / 100 }
  const n = parseFloat(s.replace(/[, ]/g, ''))
  if (isNaN(n)) return 0
  return n > 1 ? n / 100 : n   // 13 视作 13% / 0.13 直取
}
function num(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(/[, ¥￥]/g, ''))
  return isNaN(n) ? 0 : n
}
// 开票日期 → YYYY-MM-DD(尽量保留日);失败留原串。parseYearMonth 给年月,日另取。
function parseInvDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const ym = parseYearMonth(v)
  if (!ym) return s
  // Excel 日期序列号(单元格没带日期格式时 exceljs 出的是裸数字,如 45064)先还原成真日期 ——
  // 兄弟解析器 parseYearMonth/parsePvReadDate 早就认序列号,只有这里不认:落到下面的正则全不匹配、
  // day 静默补 1,开票日期会整列塌成当月 1 日(5/18 开的票记成 05-01),且不报错。
  if (typeof v === 'number') {
    const d = excelSerialToDate(v)
    if (d) return `${ym.year}-${String(ym.month).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  // 取「日」:YYYY-MM-DD / YYYY/M/D / m/d/yy 中位日字段;取不到补 01
  let day = 1
  let m = s.match(/^\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*(\d{1,2})/)        // YYYY-MM-DD
  if (m) day = Number(m[1])
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/))) {     // m/d/yy:首>12 则首为日,否则次为日
    day = Number(m[1]) > 12 ? Number(m[1]) : Number(m[2])
  }
  const dd = Math.min(Math.max(day, 1), 31)
  return `${ym.year}-${String(ym.month).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

function phaseFromLabel(s: string): string | null {
  if (s.includes('一')) return 'p1'
  if (s.includes('二')) return 'p2'
  if (s.includes('三')) return 'p3'
  return null
}

// 找叶子表头行 = 含 用电类别 + 电量 + 不含税单价 命中的行;返回行号 + 右块列定位
function locateHeader(matrix: string[][]): { headerRow: number; cols: Record<string, number> } | null {
  for (let ri = 0; ri < matrix.length; ri++) {
    const row = matrix[ri]
    const cols: Record<string, number> = {}
    row.forEach((c, ci) => {
      const nh = norm(c)
      for (const h of [H_CAT, H_UNIT, H_QTY, H_PRICE, H_RATE, H_DEMAND, H_BASIC_PRICE]) {
        if (nh === norm(h) && cols[h] === undefined) cols[h] = ci
      }
    })
    if (cols[H_CAT] !== undefined && cols[H_QTY] !== undefined && cols[H_PRICE] !== undefined) {
      return { headerRow: ri, cols }
    }
  }
  return null
}

export function importElecRows(matrix: string[][]): { records?: ImportRec[]; error?: string } {
  const loc = locateHeader(matrix)
  if (!loc) return { error: '无法识别表头:未找到「用电类别 / 电量 / 不含税单价」列。请确认粘贴含表头行。' }
  const { headerRow, cols } = loc

  const records: ImportRec[] = []
  const errors: ElecParseError[] = []
  let acctMonth: string | null = null   // 记账期下填
  let phaseId: string | null = null     // 期下填

  for (let ri = headerRow + 1; ri < matrix.length; ri++) {
    const row = matrix[ri]
    if (!row || row.length === 0) continue
    // 小计/合计/总计行整行跳过(任意单元格命中)
    if (row.some(isSubtotal)) continue

    // 左块下填:记账期(YYYYMM)→acctMonth、期→phaseId
    const acctRaw = row[COL_ACCT]
    if (norm(acctRaw)) {
      const ym = parseYearMonth(acctRaw)
      if (ym) acctMonth = `${ym.year}-${String(ym.month).padStart(2, '0')}`
    }
    const phaseRaw = row[COL_PHASE]
    if (norm(phaseRaw)) {
      const p = phaseFromLabel(String(phaseRaw))
      if (p) phaseId = p
    }

    const cat = String(row[cols[H_CAT]] ?? '').trim()
    if (!cat) continue   // 无用电类别 = 非数据行(空行/续表)

    if (!acctMonth || !phaseId) {
      errors.push({ rowIndex: ri, label: cat, reason: '缺记账期或期(下填未命中)' })
      continue
    }

    const periodRaw = String(row[COL_PERIOD] ?? '').trim()
    const period = periodRaw || null
    const invDate = parseInvDate(row[COL_INV])
    const unit = String(row[cols[H_UNIT]] ?? '').trim() || null
    const qty = num(row[cols[H_QTY]])
    const price = num(row[cols[H_PRICE]])
    const rate = parseRate(row[cols[H_RATE]])

    records.push({
      type: 'energy', phaseId, acctMonth, invDate, period, cat, unit, qty, price, rate,
      __preview: ['energy', phaseId, acctMonth, cat, qty, price, (rate * 100).toFixed(0) + '%'],
    })

    // 大工业行带基本用电(计费需量非空)→ 额外 basic 记录
    const demandCi = cols[H_DEMAND]
    const basicPriceCi = cols[H_BASIC_PRICE]
    const demandRaw = demandCi !== undefined ? row[demandCi] : ''
    if (norm(demandRaw)) {
      const demand = num(demandRaw)
      const bPrice = basicPriceCi !== undefined ? num(row[basicPriceCi]) : 0
      records.push({
        type: 'basic', phaseId, acctMonth, invDate, demand, price: bPrice, rate,
        __preview: ['basic', phaseId, acctMonth, '计费需量 ' + demand, bPrice, (rate * 100).toFixed(0) + '%'],
      })
    }
  }

  if (errors.length && !records.length) {
    return { error: errors[0].reason + `(共 ${errors.length} 行)` }
  }
  return { records }
}
