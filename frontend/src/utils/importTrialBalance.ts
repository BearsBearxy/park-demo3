// 科目余额表多 sheet 解析 — 每张名字含「余额表」的 sheet = 一公司段(供 FpImportModal parseWorkbook;粘贴路径 name='' 也收)。
// 两版式(spec C3):
//   缩进型(①/②):两行表头(组行「期初余额…」合并单元格 + 次行「借方/贷方」)→ 合并映射 8 列;
//                一级有代码、下级无代码,层级 = 名称前导空格数/2。
//   代码型(其余):单行表头 `期初余额(借方)` 直接映射;全有代码,层级 = (代码位数−4)/2。
// 数据行:code=代码列(可空),label=名称去前导空格,parent=向上最近 level−1 行,rowKey=code||`r<行号>`;
//        跳「合计」行/名称空行;金额 cleanNum(" - "→0);sortOrder 保文件行序。
import { normalizeHeader } from './importHeaderMatch'
import { TB_FIELDS, type TbAccount, type TbFieldKey } from '@/reports/trialBalance'

export type TbImportRecord = { account: TbAccount; amounts: Record<TbFieldKey, number> }
export interface TbSection { label: string; records: TbImportRecord[] }

function cleanNum(x: unknown): number {
  const v = parseFloat(String(x ?? '').replace(/[, ¥%￥]/g, ''))
  return isNaN(v) ? 0 : v
}

// 组关键词 + 借/贷 → 8 field(任一缺失返回 null)
function fieldOf(group: string, side: string): TbFieldKey | null {
  const g = group.includes('期初') ? 'open' : group.includes('本期') ? 'period'
    : group.includes('本年') ? 'ytd' : group.includes('期末') ? 'end' : null
  const s = side.includes('借') ? 'Dr' : side.includes('贷') ? 'Cr' : null
  return g && s ? (g + s) as TbFieldKey : null
}

// 段 label(spec C9):余额表（X）→X、①余额表→①、fallback 表头行之前的标题行首个非空格。
function labelOf(name: string, matrix: string[][], headerRow: number): string {
  const paren = /余额表\s*[（(]\s*(.+?)\s*[）)]/.exec(name)
  if (paren) return paren[1]
  const prefix = name.split('余额表')[0].trim()
  if (prefix) return prefix
  for (let r = 0; r < headerRow; r++) {
    for (const cell of matrix[r] ?? []) {
      const t = String(cell ?? '').trim()
      if (t) return t
    }
  }
  return name || '余额表'
}

function parseSheet(matrix: string[][]): { headerRow: number; records: TbImportRecord[] } | null {
  const width = Math.max(0, ...matrix.map(r => r.length))

  // 1) 表头行 = 首个同时含「科目名称」与「期初余额」的行
  let h = -1
  for (let r = 0; r < matrix.length && h < 0; r++) {
    const cells = (matrix[r] ?? []).map(normalizeHeader)
    if (cells.some(c => c.includes('科目名称')) && cells.some(c => c.includes('期初余额'))) h = r
  }
  if (h < 0) return null
  const head = matrix[h] ?? []
  // 次行为「借方/贷方」子表头 → 两行合并映射;否则单行直接映射
  const sub = matrix[h + 1] ?? []
  const twoRow = sub.some(c => { const n = normalizeHeader(c); return n === '借方' || n === '贷方' })

  // 2) 列映射:代码列 + 名称列 + 8 field 列
  let codeCol = -1, nameCol = -1
  for (let c = 0; c < width; c++) {
    const nh = normalizeHeader(head[c])
    if (nameCol < 0 && nh.includes('科目名称')) nameCol = c
    else if (codeCol < 0 && /科目(代码|编码|编号)/.test(nh)) codeCol = c
  }
  const colField = new Map<number, TbFieldKey>()
  let group = ''
  for (let c = 0; c < width; c++) {
    const nh = normalizeHeader(head[c])
    if (nh) group = nh   // 组表头合并单元格只在首列有值,空列沿用左侧组
    const f = twoRow ? fieldOf(group, normalizeHeader(sub[c])) : fieldOf(nh, nh)
    if (f) colField.set(c, f)
  }
  if (nameCol < 0 || !colField.size) return null

  // 3) 数据行
  const records: TbImportRecord[] = []
  const lastAtLevel: string[] = []   // 各层最近一行的 rowKey(供 parent 挂接)
  for (let r = h + (twoRow ? 2 : 1); r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const raw = String(row[nameCol] ?? '')
    const label = raw.replace(/^[ 　]+/, '').trim()
    if (!label || label.includes('合计')) continue
    const code = codeCol >= 0 ? String(row[codeCol] ?? '').trim() : ''
    const lead = raw.length - raw.replace(/^[ 　]+/, '').length
    const level = code ? Math.max(0, Math.floor((code.length - 4) / 2)) : Math.floor(lead / 2)
    const rowKey = code || `r${r + 1}`
    const parentKey = level > 0 ? lastAtLevel[level - 1] ?? null : null
    lastAtLevel[level] = rowKey
    const amounts = Object.fromEntries(TB_FIELDS.map(f => [f.key, 0])) as Record<TbFieldKey, number>
    for (const [c, f] of colField) amounts[f] = cleanNum(row[c])
    records.push({
      account: { rowKey, parentKey, code: code || null, label, level, sortOrder: records.length },
      amounts,
    })
  }
  return { headerRow: h, records }
}

export function importTrialBalance(
  sheets: { name: string; matrix: string[][] }[],
): { sections: TbSection[]; error?: string } {
  const picked = sheets.filter(s => s.name === '' || s.name.includes('余额表'))
  if (!picked.length) {
    return { sections: [], error: '工作簿中没有名字含「余额表」的工作表。请上传含各公司余额表 sheet 的整本工作簿。' }
  }
  const sections: TbSection[] = []
  for (const s of picked) {
    const parsed = parseSheet(s.matrix)
    if (!parsed) {
      return { sections: [], error: `工作表「${s.name || '粘贴内容'}」无法识别表头:需含「科目名称」列与「期初余额」列(两行借贷子表头或单行 期初余额(借方) 均可)。` }
    }
    sections.push({ label: labelOf(s.name, s.matrix, parsed.headerRow), records: parsed.records })
  }
  return { sections }
}
