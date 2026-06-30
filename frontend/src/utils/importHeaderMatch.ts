// 按表头名字匹配 — 扛真实 Excel:多行表头(租户表头与叶子标签不在同一行)、前置「车间」分类列、
// 尾部「合计/备注」列、小计行、部分叶子标签落在分组行、列乱序。
// 算法:
//  1) 表头块 = 顶部到"最后一个含≥2个费用列标签命中的行"(叶子表头行);
//  2) 逐列扫表头块(跨行)定费用列→key(捕获落在分组行的标签如「其他费用」);
//  3) 租户列 = 非费用列里、数据行"文本(非数字/非空/非小计)"最多的列(故租户表头在别行/数据租户不在首列都能找到);
//  4) 数据行 = 表头块之后、租户列非空且非小计的行;未命中的列(车间/合计/备注/分组)一律忽略。
// 仅供 columnMap 模式;位置映射仍走各屏 parseRow。

export interface ColumnMapEntry { label: string; key: string; text?: boolean }
export interface ImportRec { __preview?: unknown[]; [k: string]: unknown }
export interface MatchResult { records: ImportRec[]; error?: string }

// 去空格 + 常见分隔/括号标点(不改字符本体),便于宽松匹配。
export function normalizeHeader(s: unknown): string {
  return String(s ?? '').replace(/[\s、，,·．。.（）()【】[\]／/\\\-_]/g, '')
}

function cleanNum(x: unknown): number {
  const v = parseFloat(String(x ?? '').replace(/[, ¥%￥]/g, ''))
  return isNaN(v) ? 0 : v
}

// 是否"数字或空"(空/各种短横线/可解析为数字)
function isNumericOrBlank(v: unknown): boolean {
  const s = String(v ?? '').replace(/[, ¥%￥\s]/g, '')
  if (s === '' || s === '-' || s === '–' || s === '—') return true
  return !isNaN(parseFloat(s)) && /^[-+]?[\d.]+$/.test(s)
}
function isSubtotal(v: string): boolean {
  return /合计|小计|总计/.test(v)
}

export function matchByHeader(
  matrix: string[][],
  columnMap: ColumnMapEntry[],
  nameLabels: string[],
): MatchResult {
  // 标签按 normalize 后长度降序:前缀命中时「最长匹配标签优先」,防短标签(如 基本)吞掉长列头。
  const labels = columnMap
    .map(c => ({ nl: normalizeHeader(c.label), key: c.key, text: !!c.text }))
    .sort((a, b) => b.nl.length - a.nl.length)
  // 列头 → 命中的列定义:normalize 相等 或 列头以标签为前缀(扛 用电量(千瓦)→用电量 等单位后缀)。
  const matchLabel = (cell: unknown) => {
    const nh = normalizeHeader(cell)
    if (!nh) return undefined
    for (const l of labels) if (nh === l.nl || nh.startsWith(l.nl)) return l
    return undefined
  }

  // 1) 表头块末行 = 最后一个含 ≥2 个费用列标签命中的行(叶子表头行;数据行单元格是数字/租户名/车间,不命中标签)
  let headerEnd = -1
  matrix.forEach((row, ri) => {
    let n = 0
    for (const c of row) if (matchLabel(c)) n++
    if (n >= 2) headerEnd = ri
  })
  if (headerEnd < 0) {
    return { records: [], error: '无法识别表头:没有一行的列名与本期版面匹配。请确认粘贴含表头行,且粘到了对应期的版面(如二期粘到二期)。' }
  }

  const width = Math.max(0, ...matrix.map(r => r.length))

  // 2) 逐列扫表头块定费用列(跨行,捕获落在分组行的标签)
  const colKey = new Map<number, string>()
  const textCols = new Set<number>() // 标记为 text 的列:存原始字符串,不 cleanNum
  for (let c = 0; c < width; c++) {
    for (let r = 0; r <= headerEnd; r++) {
      const l = matchLabel(matrix[r]?.[c])
      if (l && !colKey.has(c)) { colKey.set(c, l.key); if (l.text) textCols.add(c); break }
    }
  }
  if (colKey.size < 2) {
    return { records: [], error: '无法识别表头:列名与本期版面不匹配。请确认粘到了对应期的版面。' }
  }

  // 3) 关键列(行身份:租户/姓名/月份…) 定位:
  //    ① 先按 nameLabels 表头匹配,且该列数据多为非空 → 用它(让"月份"等可能为纯数字的关键列也能定位);
  //    ② 否则按"非费用列里数据行文本(非数字/非空/非小计)最多"兜底(扛"租户表头在别行、数据租户不在表头列"如附表10二期)。
  const dataRows = matrix.slice(headerEnd + 1)
  const nameSet = new Set(nameLabels.map(normalizeHeader))
  let nameCol = -1
  if (nameSet.size) {
    for (let c = 0; c < width; c++) {
      if (colKey.has(c)) continue
      let headerHit = false
      for (let r = 0; r <= headerEnd; r++) { if (nameSet.has(normalizeHeader(matrix[r]?.[c]))) { headerHit = true; break } }
      if (!headerHit) continue
      const nonEmpty = dataRows.filter(row => { const v = String(row[c] ?? '').trim(); return v !== '' && !isSubtotal(v) }).length
      if (nonEmpty >= Math.max(1, Math.ceil(dataRows.length * 0.5))) { nameCol = c; break }
    }
  }
  if (nameCol < 0) {
    let bestText = 0
    for (let c = 0; c < width; c++) {
      if (colKey.has(c)) continue
      let t = 0
      for (const row of dataRows) {
        const v = String(row[c] ?? '').trim()
        if (v && !isNumericOrBlank(v) && !isSubtotal(v)) t++
      }
      if (t > bestText) { bestText = t; nameCol = c }
    }
  }
  if (nameCol < 0) {
    return { records: [], error: '未找到关键列(租户/姓名/月份):请确认表头含该列、且其下有数据。' }
  }

  // 4) 数据行 → 记录(跳过租户列空/小计行;未命中列忽略)
  const records: ImportRec[] = []
  for (const row of dataRows) {
    const name = String(row[nameCol] ?? '').trim()
    if (!name || isSubtotal(name)) continue
    const rec: ImportRec = { tenantName: name }
    colKey.forEach((key, ci) => { rec[key] = textCols.has(ci) ? String(row[ci] ?? '').trim() : cleanNum(row[ci]) })
    rec.__preview = [name, ...columnMap.map(c => (c.text ? rec[c.key] : (rec[c.key] as number)) || '')]
    records.push(rec)
  }
  if (!records.length) {
    return { records: [], error: '已读取数据,但没识别到租户行。请确认含租户名一列。' }
  }
  return { records }
}
