// 利润表 sheet 解析 — 6 公司横向合并 → 每公司一段(自定义解析,供 FpImportModal customParse)。
// 布局(spec §6):2 行表头 — 公司名行(每公司名跨 2 列) + 子表头行(本月金额/本年累计金额);
//   行首两列「项目|行次」;尾「合计」列(忽略)。
// 算法:
//  1) 子表头行 = 含 ≥2 个「本月金额/本年累计金额」命中的行;公司名行 = 其上一行。
//  2) 行次列 = 表头块内标签为「行次」的列(兜底:数据行多为 IS_ROWS 行次整数的列)。
//  3) 每公司 (curCol,ytdCol):子表头行里连续的「本月金额→本年累计金额」列对,公司名取该对上方公司名单元格;「合计」跳过。
//  4) 逐数据行按 行次 匹配 IS_ROWS 的 normal 行 → 每公司收 {rowKey,cur,ytd};label/小计(21/30/32)/空/未知行次跳过。
import { normalizeHeader } from './importHeaderMatch'
import { IS_ROWS } from '@/reports/incomeStatement'
import type { ImportRec } from './importHeaderMatch'

export interface IsSection { label: string; records: ImportRec[] }

const NORMAL_NO = new Set(IS_ROWS.filter(r => r.type === 'normal').map(r => r.no))

const CUR_LBL = normalizeHeader('本月金额')
const YTD_LBL = normalizeHeader('本年累计金额')
const isCur = (v: unknown) => normalizeHeader(v) === CUR_LBL
const isYtd = (v: unknown) => normalizeHeader(v) === YTD_LBL

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

export function importIncomeStatement(matrix: string[][]): { sections: IsSection[]; error?: string } {
  const width = Math.max(0, ...matrix.map(r => r.length))

  // 1) 子表头行 = 含 ≥2 个 本月/本年累计 命中的行
  let subHeader = -1
  for (let r = 0; r < matrix.length; r++) {
    let n = 0
    for (const cell of matrix[r]) if (isCur(cell) || isYtd(cell)) n++
    if (n >= 2) { subHeader = r; break }
  }
  if (subHeader < 0) {
    return { sections: [], error: '无法识别利润表表头:未找到「本月金额 / 本年累计金额」子表头行。请确认粘贴的是利润表且含两行表头。' }
  }
  const nameRow = matrix[subHeader - 1] ?? []
  const sub = matrix[subHeader]

  // 2) 行次列:表头块(0..subHeader)内标签为「行次」;兜底 = 数据行多为已知行次整数的列
  const HANG = normalizeHeader('行次')
  let noCol = -1
  for (let c = 0; c < width && noCol < 0; c++) {
    for (let r = 0; r <= subHeader; r++) {
      if (normalizeHeader(matrix[r]?.[c]) === HANG) { noCol = c; break }
    }
  }
  const dataRows = matrix.slice(subHeader + 1)
  if (noCol < 0) {
    let best = 0
    for (let c = 0; c < width; c++) {
      let hit = 0
      for (const row of dataRows) { const no = parseNo(row[c]); if (no != null && NORMAL_NO.has(no)) hit++ }
      if (hit > best) { best = hit; noCol = c }
    }
  }
  if (noCol < 0) {
    return { sections: [], error: '无法识别利润表:未找到「行次」列。' }
  }

  // 3) 公司列对:扫子表头行,连续 本月→本年累计 组成一对,公司名取该对首列上方单元格;「合计」跳过。
  interface Co { label: string; curCol: number; ytdCol: number }
  const cos: Co[] = []
  for (let c = 0; c < width; c++) {
    if (!isCur(sub[c])) continue
    // 找该「本月」右侧最近的「本年累计」列
    let yc = -1
    for (let d = c + 1; d < width; d++) { if (isYtd(sub[d])) { yc = d; break }; if (isCur(sub[d])) break }
    if (yc < 0) continue
    // 公司名:名行 curCol 单元格(合并单元格值常落在首列),空则向左回退到最近非空
    let label = String(nameRow[c] ?? '').trim()
    if (!label) { for (let k = c - 1; k >= 0; k--) { const v = String(nameRow[k] ?? '').trim(); if (v) { label = v; break } } }
    if (!label || /合计|总计/.test(label)) continue
    cos.push({ label, curCol: c, ytdCol: yc })
  }
  if (!cos.length) {
    return { sections: [], error: '无法识别利润表:未从表头解析出任何公司列。' }
  }

  // 4) 逐数据行按行次匹配 normal 行 → 每公司一段
  const sections: IsSection[] = cos.map(co => ({ label: co.label, records: [] }))
  for (const row of dataRows) {
    const no = parseNo(row[noCol])
    if (no == null || !NORMAL_NO.has(no)) continue   // 空/label/小计/未知行次 跳过
    const rowKey = String(no)
    cos.forEach((co, i) => {
      const cur = cleanNum(row[co.curCol])
      const ytd = cleanNum(row[co.ytdCol])
      sections[i].records.push({ rowKey, cur, ytd, __preview: [rowKey, cur, ytd] })
    })
  }
  return { sections }
}
