/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
// 工资多月分段 — 一张 sheet 多月堆叠(每月一张完整表,标题行分隔),按标题切段、识别年/月,
// 逐段用同一套 columnMap 走 matchByHeader 解析。复用 importHeaderMatch(勿改它)。
// 与 importSections 的区别:工资是单版面(无 office/factory 之分、无期),故只识别 年/月。
import { matchByHeader, blockReason, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'

export interface SalarySection {
  year?: number
  month?: number
  title?: string     // 文件里那一行标题原文(导入弹窗核对页「文件里的标题」);没标题的整表没有
  records: ImportRec[]
  rowCount: number   // 该段数据行数(标题行下到下个标题前)
  reason?: string    // 这一段导不了的原因(表头认不出 / 没有数据),核对页写在这一段上;能导时没有
}

// 标题行:某行各单元格 join 后含「YYYY年M月…工资表」(如「2025年1月工资表(总表）」)
const TITLE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月.*工资表/

interface TitleHit { rowIndex: number; year: number; month: number; title: string }

function matchTitle(row: string[]): Omit<TitleHit, 'rowIndex'> | null {
  const joined = row.map(c => String(c ?? '')).join('')
  const m = joined.match(TITLE_RE)
  return m ? { year: Number(m[1]), month: Number(m[2]), title: joined.trim() } : null
}

export function splitSalarySections(
  matrix: string[][],
  columnMap: ColumnMapEntry[],
  nameLabels: string[],
): SalarySection[] {
  const titles: TitleHit[] = []
  matrix.forEach((row, ri) => {
    const t = matchTitle(row)
    if (t) titles.push({ rowIndex: ri, ...t })
  })

  // 0 标题 → 整表当 1 段(年/月 undefined,由调用方用当前槽兜底)
  if (titles.length === 0) {
    const m = matchByHeader(matrix, columnMap, nameLabels)
    return [{ records: m.records, rowCount: matrix.length, reason: blockReason(m, '姓名') }]
  }

  // 每个标题行:下一行 到 下一个标题行前一行(或表尾)
  return titles.map((t, i) => {
    const start = t.rowIndex + 1
    const end = i + 1 < titles.length ? titles[i + 1].rowIndex : matrix.length
    const block = matrix.slice(start, end)
    const m = matchByHeader(block, columnMap, nameLabels)
    return { year: t.year, month: t.month, title: t.title, records: m.records, rowCount: block.length, reason: blockReason(m, '姓名') }
  })
}
