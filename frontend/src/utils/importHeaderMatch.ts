// 按表头名字匹配 — 扛真实 Excel:多行表头 / 前置分类列(车间) / 尾部合计·备注列 / 列乱序。
// 思路:定位"命中列标签最多"的行=表头行;按 normalize 后的列名把列映射到 key;租户列按 nameLabels 定位;
//       数据=表头行之后、租户列非空的行;未命中的列(车间/合计/备注/纯分组行)一律忽略;顺序无关。
// 仅供 columnMap 模式;位置映射仍走各屏 parseRow。

export interface ColumnMapEntry { label: string; key: string }
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

export function matchByHeader(
  matrix: string[][],
  columnMap: ColumnMapEntry[],
  nameLabels: string[],
): MatchResult {
  const labelToKey = new Map<string, string>()
  for (const c of columnMap) labelToKey.set(normalizeHeader(c.label), c.key)
  const nameSet = new Set(nameLabels.map(normalizeHeader))

  // 表头行 = 命中列标签最多的一行(自动跳过 标题/分组 等多行表头)
  let headerRowIdx = -1
  let best = 0
  matrix.forEach((row, ri) => {
    let n = 0
    for (const c of row) if (labelToKey.has(normalizeHeader(c))) n++
    if (n > best) { best = n; headerRowIdx = ri }
  })
  if (headerRowIdx < 0 || best < 2) {
    return { records: [], error: '无法识别表头：没有一行的列名与本期版面匹配。请确认粘贴内容含表头行,且粘到了对应期的版面。' }
  }

  // 列 → key,以及租户列
  const headerRow = matrix[headerRowIdx]
  const colKey = new Map<number, string>()
  let nameCol = -1
  headerRow.forEach((c, ci) => {
    const n = normalizeHeader(c)
    if (nameCol < 0 && nameSet.has(n)) nameCol = ci
    else if (!colKey.has(ci) && labelToKey.has(n)) colKey.set(ci, labelToKey.get(n)!)
  })
  // 兜底租户列:第一个"非命中-fee 且表头非空"的文本列
  if (nameCol < 0) {
    for (let ci = 0; ci < headerRow.length; ci++) {
      if (!colKey.has(ci) && normalizeHeader(headerRow[ci])) { nameCol = ci; break }
    }
  }
  if (nameCol < 0) return { records: [], error: '未找到「租户」列,请确认表头含租户名称列。' }

  // 数据行:表头之后、租户列非空(车间合并单元格的空格/分类标签都不影响)
  const records: ImportRec[] = []
  for (let ri = headerRowIdx + 1; ri < matrix.length; ri++) {
    const row = matrix[ri]
    const name = String(row[nameCol] ?? '').trim()
    if (!name) continue
    const rec: ImportRec = { tenantName: name }
    colKey.forEach((key, ci) => { rec[key] = cleanNum(row[ci]) })
    // __preview 按 columnMap 顺序对齐(modal 的 templateCols = [租户名, ...columnMap labels])
    rec.__preview = [name, ...columnMap.map(c => (rec[c.key] as number) || '')]
    records.push(rec)
  }
  return { records }
}
