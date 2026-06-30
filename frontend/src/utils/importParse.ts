// 通用导入解析 helper — 1:1 移植 import-excel.jsx 的 fpParsePaste / fpParseCSV。
// 把粘贴文本(TSV/CSV)或 CSV 文件文本规整为「单元格二维数组」,再交给各屏 parseRow 映射。

// 把任意值规整为字符串单元格(去首尾空白)。
export const cell = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())

// 解析粘贴文本 → 二维数组。含 \t 视为 TSV,否则按逗号 CSV(简易切分,不处理引号)。
export function parsePaste(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '')
  const sep = lines.some(l => l.includes('\t')) ? '\t' : ','
  return lines.map(l => l.split(sep).map(cell))
}

// 解析 CSV 文本 → 二维数组(支持双引号包裹与 "" 转义)。
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  const s = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur.trim()); cur = '' }
    else if (c === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur.trim()); rows.push(row) }
  return rows.filter(r => r.some(c => c !== ''))
}
