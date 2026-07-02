// 资产负债表 sheet 解析 — 两栏(资产‖负债和所有者权益)×多公司横向 → 每公司一段(供 FpImportModal customParse)。
// 布局(plan Task4):单表头行 `资产|行次|①期末余额|…|⑥期末余额（创燊高）|期末余额合计|负债和所有者权益|行次|①期末余额|…|期末余额合计`
//   左右两块各自(名称列, 行次列, 每公司 1 列);「期末余额合计」列忽略。
// 算法:
//  1) 表头行 = 首个含 ≥2 个「行次」的行;第 1/2 个「行次」列 = 左/右块行次列。
//  2) 公司列 = 表头 normalize 后匹配 `①..⑩期末余额(名)`(括号被 normalize 剥掉):
//     左块列 ∈ (左行次, 右行次),右块列 > 右行次;合计/名称列不匹配自然忽略。
//     同序号左右合并为一段,段 label = 序号+括号名(如 ③帮管好,无括号则序号本身)。
//  3) 数据行按块内行次匹配 BS_ROWS 该 side 的 normal 行(label/subtotal/无行次「其中」行自然落空跳过),
//     先收左块再收右块 → 每公司 {rowKey, end}。文件合计行值丢弃(客端按 BS_SUBTOTAL 重算,spec B4)。
import { normalizeHeader } from './importHeaderMatch'
import { BS_ROWS } from '@/reports/balanceSheet'
import type { ImportRec } from './importHeaderMatch'

export interface BsSection { label: string; records: ImportRec[] }

const NORMAL_L = new Set(BS_ROWS.filter(r => r.type === 'normal' && r.side === 'L').map(r => r.no as number))
const NORMAL_R = new Set(BS_ROWS.filter(r => r.type === 'normal' && r.side === 'R').map(r => r.no as number))

const HANG = normalizeHeader('行次')
// 公司列头(normalize 后):序号 ①–⑩ + 「期末余额」壳 + 可选公司名。
const CO_RE = /^([①②③④⑤⑥⑦⑧⑨⑩])期末余额(.*)$/

function cleanNum(x: unknown): number {
  const v = parseFloat(String(x ?? '').replace(/[, ¥%￥]/g, ''))
  return isNaN(v) ? 0 : v
}

// 行次:纯整数(容许尾随空白);返回 null 表示非行次单元格。
function parseNo(v: unknown): number | null {
  const s = String(v ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  return parseInt(s, 10)
}

export function importBalanceSheet(matrix: string[][]): { sections: BsSection[]; error?: string } {
  const width = Math.max(0, ...matrix.map(r => r.length))

  // 1) 表头行 = 首个含 ≥2 个「行次」的行;左右块行次列
  let header = -1
  let noCols: number[] = []
  for (let r = 0; r < matrix.length && header < 0; r++) {
    const cols: number[] = []
    for (let c = 0; c < width; c++) if (normalizeHeader(matrix[r]?.[c]) === HANG) cols.push(c)
    if (cols.length >= 2) { header = r; noCols = cols }
  }
  if (header < 0) {
    return { sections: [], error: '无法识别资产负债表表头:未找到左右两个「行次」列。请确认粘贴的是两栏资产负债表(资产‖负债和所有者权益)。' }
  }
  const [leftNo, rightNo] = noCols

  // 2) 公司列:序号+期末余额(+名);同序号左右合并,label 取带名的
  interface Co { label: string; lCol?: number; rCol?: number }
  const bySeq = new Map<string, Co>()
  for (let c = leftNo + 1; c < width; c++) {
    if (c === rightNo) continue
    const m = CO_RE.exec(normalizeHeader(matrix[header]?.[c]))
    if (!m) continue
    const label = m[1] + m[2]
    const co = bySeq.get(m[1])
    if (!co) { bySeq.set(m[1], { label, [c < rightNo ? 'lCol' : 'rCol']: c }); continue }
    if (label.length > co.label.length) co.label = label
    if (c < rightNo) co.lCol = co.lCol ?? c
    else co.rCol = co.rCol ?? c
  }
  const cos = [...bySeq.values()]
  if (!cos.length) {
    return { sections: [], error: '无法识别资产负债表:未从表头解析出任何公司列(①期末余额…)。' }
  }

  // 3) 逐数据行按块内行次匹配该 side 的 normal 行 → 每公司一段(先左块后右块)
  const sections: BsSection[] = cos.map(co => ({ label: co.label, records: [] }))
  const dataRows = matrix.slice(header + 1)
  const collect = (noCol: number, normal: Set<number>, colOf: (co: Co) => number | undefined) => {
    for (const row of dataRows) {
      const no = parseNo(row[noCol])
      if (no == null || !normal.has(no)) continue   // 空/label/subtotal/无行次「其中」/未知行次 跳过
      cos.forEach((co, i) => {
        const col = colOf(co)
        if (col == null) return
        const end = cleanNum(row[col])
        sections[i].records.push({ rowKey: String(no), end, __preview: [String(no), end] })
      })
    }
  }
  collect(leftNo, NORMAL_L, co => co.lCol)
  collect(rightNo, NORMAL_R, co => co.rCol)
  return { sections }
}
