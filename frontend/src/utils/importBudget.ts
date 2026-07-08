// 年度预算「全面预算总表」解析(registry 'budget' 的 parseWorkbook,spec「导入」节)。
// 真实版式(两份预算工作簿实测):标题行「YYYY年财务预算总表」/ 表头「项目|2022年发生额|…|YYYY年预算|备注」/
// ~28 数据行(「收入总计」「    其中：租金收入」前导空格=子行,金额千分位字符串)。
// 规则:
//  1) 目标 sheet = 名字命中 /全面预算|财务预算总表/(粘贴路径 name='' → 全部候选);
//  2) 表头行 = 含「项目」列且 ≥2 个 /^(\d{4})年(发生额|预算)$/ 年列命中的行;「备注」列 → note;
//  3) 逐数据行 × 年列产 {year,label,sub,budget|actual,note,sortOrder}(空值/短横线跳过);
//     sub = label 前导空格或「其中」前缀;note 只挂预算年行;sortOrder = 数据行序(跨年同行同序);
//  4) 2025 起「发生额」列跳过不导(pnl 实时推算为单一事实源);收入总计行与传入 pnl 年收入差 >1 元 → warning
//     (确认屏提示;pnl 值拉不到 → 跳过校验);
//  5) 确认屏按年分段:label=「YYYY 预算 N 条 / 发生额 N 条」。
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { PNL_SOT_FROM_YEAR } from '@/analysis/budget'

export const BUDGET_SHEET_RE = /全面预算|财务预算总表/
const YEAR_COL_RE = /^(\d{4})年(发生额|预算)$/

// 千分位/货币符容错;空/短横线 → null(跳过)
function cleanNum(x: unknown): number | null {
  const s = String(x ?? '').replace(/[, ¥￥%\s]/g, '')
  if (s === '' || s === '-' || s === '–' || s === '—') return null
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}

export interface BudgetParseOut {
  sections?: { label: string; records: ImportRec[] }[]
  error?: string
  warning?: string
}

export function importBudget(
  sheets: { name: string; matrix: string[][] }[],
  pnlRevenueByYear?: Map<number, number>,
): BudgetParseOut {
  const named = sheets.filter(s => BUDGET_SHEET_RE.test(s.name))
  for (const s of (named.length ? named : sheets)) {
    const res = parseSheet(s.matrix, pnlRevenueByYear)
    if (res) return res
  }
  return { error: '未识别到「全面预算总表」:需含「项目」列与 ≥2 个「YYYY年发生额/YYYY年预算」表头列。' }
}

function parseSheet(matrix: string[][], pnlRevenueByYear?: Map<number, number>): BudgetParseOut | null {
  // 表头行定位
  let h = -1, labelCol = -1, noteCol = -1
  let yearCols: { col: number; year: number; isBudget: boolean }[] = []
  for (let r = 0; r < matrix.length && h < 0; r++) {
    const row = matrix[r] ?? []
    const lc = row.findIndex(c => String(c ?? '').trim() === '项目')
    if (lc < 0) continue
    const ycs: typeof yearCols = []
    let nc = -1
    row.forEach((c, i) => {
      const t = String(c ?? '').trim()
      const m = YEAR_COL_RE.exec(t)
      if (m) ycs.push({ col: i, year: +m[1], isBudget: m[2] === '预算' })
      else if (nc < 0 && t === '备注') nc = i
    })
    if (ycs.length < 2) continue
    h = r; labelCol = lc; noteCol = nc; yearCols = ycs
  }
  if (h < 0) return null

  const byYear = new Map<number, ImportRec[]>()
  let warning: string | undefined
  let sort = 0
  // 同年重名科目消歧:真实总表每年有两个「其中：其他」(收入侧/成本侧),重名时追加父级主行标注
  // (复审 high:重名会撞后端唯一键,且明细表两行「其他」用户无法分辨)
  let parent = ''
  const seen = new Set<string>()
  for (let r = h + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const raw = String(row[labelCol] ?? '')
    let label = raw.trim()
    if (!label) continue
    const sub = /^\s/.test(raw) || label.startsWith('其中')
    if (!sub) parent = label
    if (seen.has(label)) {
      let name = parent && parent !== label ? `${label}（${parent}）` : `${label}（${sort + 1}）`
      while (seen.has(name)) name = `${name}+`
      label = name
    }
    seen.add(label)
    const noteRaw = noteCol >= 0 ? String(row[noteCol] ?? '').trim() : ''
    const note = noteRaw && noteRaw !== '-' ? noteRaw : ''
    for (const yc of yearCols) {
      const v = cleanNum(row[yc.col])
      if (v == null) continue
      if (!yc.isBudget && yc.year >= PNL_SOT_FROM_YEAR) {
        // 跳过不导(pnl 单一事实源);收入总计行交叉校验,差 >1 元提示
        const sys = pnlRevenueByYear?.get(yc.year)
        if (label === '收入总计' && sys != null && Math.abs(v - sys) > 1) {
          warning = `${yc.year} 年发生额(收入总计)文件值与系统损益推算差 ${Math.abs(v - sys).toFixed(2)} 元`
            + `(文件 ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })} vs 系统 ${sys.toLocaleString('en-US', { minimumFractionDigits: 2 })});`
            + `该年发生额列已跳过不导,以系统实时推算为准,请核对文件口径。`
        }
        continue
      }
      const rec: ImportRec = { year: yc.year, label, sub, sortOrder: sort }
      if (yc.isBudget) { rec.budget = v; if (note) rec.note = note }   // note 只挂预算年行
      else rec.actual = v
      const list = byYear.get(yc.year) ?? []
      list.push(rec)
      byYear.set(yc.year, list)
    }
    sort++
  }
  if (!byYear.size) return null

  const sections = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, records]) => {
    const nb = records.filter(r => r.budget != null).length
    return { label: `${year} 预算 ${nb} 条 / 发生额 ${records.length - nb} 条`, records }
  })
  return { sections, warning }
}
