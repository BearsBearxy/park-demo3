// 智能整表拆段 — 一张 sheet 多段(多月×多期),按标题行切段、识别 年/月/期、识别版面(office/factory),
// 逐段用对应版面 columnMap 走 matchByHeader 解析。复用 importHeaderMatch(勿改它)。
import { matchByHeader, normalizeHeader, isGarbageTenantName, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'

export interface PhaseLayouts { office: ColumnMapEntry[]; factory: ColumnMapEntry[] }

export interface Section {
  year?: number
  month?: number
  phase?: number              // 一期1/二期2/三期3/宿舍4
  layout: 'office' | 'factory'
  records: ImportRec[]
  rowCount: number            // 该段数据行数(标题行下到下个标题前)
  error?: string
  unmatched?: { header: string; colIndex: number }[]   // §4:本段未匹配表头(记录上的 __unmatched 已剥,只留段级清单)
}

// 标题行:某行各单元格 join 后含「YYYY年M月…(一期|二期|三期|宿舍)」
const TITLE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月.*?(一期|二期|三期|宿舍)/

function phaseFromName(name: string): number {
  if (name.includes('宿舍')) return 4
  if (name.includes('一期')) return 1
  if (name.includes('二期')) return 2
  if (name.includes('三期')) return 3
  return 4
}

// 版面识别(不靠期号):段任一单元格含「办公室租金」或「保障房」→ office,否则 factory。
function detectLayout(rows: string[][]): 'office' | 'factory' {
  for (const row of rows) {
    for (const c of row) {
      const n = normalizeHeader(c)
      if (n.includes('办公室租金') || n.includes('保障房')) return 'office'
    }
  }
  return 'factory'
}

interface TitleHit { rowIndex: number; year: number; month: number; phase: number }

function matchTitle(row: string[]): Omit<TitleHit, 'rowIndex'> | null {
  const joined = row.map(c => String(c ?? '')).join('')
  const m = joined.match(TITLE_RE)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), phase: phaseFromName(m[3]) }
}

function parseBlock(
  block: string[][],
  phaseLayouts: PhaseLayouts,
  nameLabels: string[],
): { layout: 'office' | 'factory'; records: ImportRec[]; error?: string; unmatched?: { header: string; colIndex: number }[] } {
  const layout = detectLayout(block)
  if (!block.length) return { layout, records: [] }
  // 垃圾行过滤(规范§九 v4):段尾未标「合计」的合计行(如「202510二期」)与「0」伪租户行,入库会使段金额翻倍
  const { records, error, unmatched } = matchByHeader(block, phaseLayouts[layout], nameLabels, undefined,
    { skipName: isGarbageTenantName, keepUnmatched: true })   // §4:未匹配列上浮段级
  for (const r of records) delete r.__unmatched   // 值层不携带:防 run 展开进 POST body
  return { layout, records, error, unmatched }
}

export function splitSections(
  matrix: string[][],
  phaseLayouts: PhaseLayouts,
  nameLabels: string[],
): Section[] {
  const titles: TitleHit[] = []
  matrix.forEach((row, ri) => {
    const t = matchTitle(row)
    if (t) titles.push({ rowIndex: ri, ...t })
  })

  // 0 标题行 → 整表当 1 段(年/月/期 undefined,版面识别),供汇总屏用当前槽默认填。
  if (titles.length === 0) {
    const r = parseBlock(matrix, phaseLayouts, nameLabels)
    return [{ layout: r.layout, records: r.records, rowCount: matrix.length, error: r.error, unmatched: r.unmatched }]
  }

  const sections: Section[] = []

  // 标题前若有数据 → 无标题前导段(year/month/phase undefined)
  if (titles[0].rowIndex > 0) {
    const lead = matrix.slice(0, titles[0].rowIndex)
    if (lead.some(row => row.some(c => String(c ?? '').trim() !== ''))) {
      const r = parseBlock(lead, phaseLayouts, nameLabels)
      sections.push({ layout: r.layout, records: r.records, rowCount: lead.length, error: r.error, unmatched: r.unmatched })
    }
  }

  // 每个标题行:下一行 到 下一个标题行前一行(或表尾)
  titles.forEach((t, i) => {
    const start = t.rowIndex + 1
    const end = i + 1 < titles.length ? titles[i + 1].rowIndex : matrix.length
    const block = matrix.slice(start, end)
    const r = parseBlock(block, phaseLayouts, nameLabels)
    sections.push({
      year: t.year,
      month: t.month,
      phase: t.phase,
      layout: r.layout,
      records: r.records,
      rowCount: block.length,
      error: r.error,
      unmatched: r.unmatched,
    })
  })

  return sections
}
