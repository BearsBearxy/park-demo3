// 损益附表 1–5 单 sheet 解析 — 母册矩阵 → 整年行集(供 FpImportModal customParse,P2-D spec §4)。
// 真实版式:标题行(2025年租金损益明细) / 单位行 / 表头 `分组列|科目细分|1月..12月|本年合计|备注`(附表5 分组与科目细分间多一空列)。
// 规则:
//  1) 表头行 = 首个同时含「科目细分」与「1月」的行;
//  2) 12 月列按表头「N月」定位;「本年合计」列忽略(客端派生);「备注」列收 note;
//  3) 分组列 = 科目细分左侧首个非月、非空表头列,数据行值向下填充(合并单元格);
//  4) 数据行:科目细分有字=普通行;科目细分空而分组列有字时——该行**有月值**=总计类行(label 取分组列字,
//     groupLabel 留空,不污染后续 carry 且清 carry;如附表1「园区总租金收入/总成本/总损益」)、
//     **无月值**=纯分组头(carry,附表1 尾部「三期项目已发生成本汇总表」附块因此拿到自己的分组);
//     金额 " - "/空 → null(未录),真 0 保留;kind=detectKind(存文件值不重算,D2);
//  5) 年 = 表头行之前 /(\d{4})年/(识别失败 year=null,调用方回退当前年槽);rowKey 合成 r<n>。
import { normalizeHeader } from './importHeaderMatch'
import { detectKind } from '@/reports/pnlSchedules'
import type { PnlKind, PnlRowDTO } from '@/types/pnl'

const MONTH_RE = /^(\d{1,2})月$/

// null=未录(区分真 0);扛千分位/货币符/各种短横线。
function cleanNum(x: unknown): number | null {
  const s = String(x ?? '').replace(/[, ¥%￥\s]/g, '')
  if (s === '' || s === '-' || s === '–' || s === '—') return null
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}

export function importPnlSchedule(matrix: string[][]): { year: number | null; rows: PnlRowDTO[]; error?: string } {
  const width = Math.max(0, ...matrix.map(r => r.length))

  // 1) 表头行 + 科目细分列
  let h = -1
  let subCol = -1
  for (let r = 0; r < matrix.length && h < 0; r++) {
    const cells = (matrix[r] ?? []).map(normalizeHeader)
    const sc = cells.findIndex(c => c.includes('科目细分'))
    if (sc >= 0 && cells.some(c => MONTH_RE.exec(c)?.[1] === '1')) { h = r; subCol = sc }
  }
  if (h < 0) {
    return { year: null, rows: [], error: '无法识别附表表头:未找到同时含「科目细分」与「1月」的表头行。请确认选中的是损益附表(分组|科目细分|1月..12月)。' }
  }
  const head = Array.from({ length: width }, (_, c) => normalizeHeader(matrix[h]?.[c]))

  // 2) 12 月列 + 备注列(「本年合计」两者都不命中,自然忽略)
  const monthCol: number[] = Array(12).fill(-1)
  let noteCol = -1
  for (let c = 0; c < width; c++) {
    const m = MONTH_RE.exec(head[c])
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 1 && n <= 12 && monthCol[n - 1] < 0) monthCol[n - 1] = c
      continue
    }
    if (noteCol < 0 && head[c].includes('备注')) noteCol = c
  }

  // 3) 分组列 = 科目细分左侧首个非月、非空表头列(附表5 的中间空列被跳过)
  let groupCol = -1
  for (let c = subCol - 1; c >= 0; c--) {
    if (head[c] && !MONTH_RE.test(head[c])) { groupCol = c; break }
  }

  // 4) 数据行(分组向下填充;总计类行/纯分组头 见文件头规则 4)
  const rows: PnlRowDTO[] = []
  let group = ''
  const push = (label: string, groupLabel: string, row: string[], note: string, kindOverride?: PnlKind) => {
    rows.push({
      rowKey: `r${rows.length + 1}`,
      groupLabel,
      label,
      kind: kindOverride ?? detectKind(label),
      note: note || null,
      m: monthCol.map(c => (c < 0 ? null : cleanNum(row[c]))),
      sortOrder: rows.length,
    })
  }
  for (let r = h + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const gv = groupCol >= 0 ? String(row[groupCol] ?? '').trim() : ''
    const label = String(row[subCol] ?? '').trim()
    const note = noteCol >= 0 ? String(row[noteCol] ?? '').trim() : ''
    if (!label) {
      if (!gv) continue
      const hasValue = monthCol.some(c => c >= 0 && cleanNum(row[c]) != null)
      if (hasValue) {
        // 总计类行:分组列字作 label,清 carry;结构上即总计行,detectKind 判 detail 时升格 total(如「园区总租金收入」)
        const k = detectKind(gv)
        push(gv, '', row, note, k === 'detail' ? 'total' : k)
        group = ''
        continue
      }
      group = gv                                                        // 纯分组头:只 carry
      continue
    }
    if (gv) group = gv
    push(label, group, row, note)
  }

  // 5) 年识别:表头行之前首个 /(\d{4})年/
  let year: number | null = null
  outer: for (let r = 0; r < h; r++) {
    for (const cell of matrix[r] ?? []) {
      const ym = /(\d{4})年/.exec(String(cell ?? ''))
      if (ym) { year = parseInt(ym[1], 10); break outer }
    }
  }
  return { year, rows }
}
