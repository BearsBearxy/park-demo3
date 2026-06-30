// 附表6 光伏发电 — 多段堆叠真实模板拆段(自定义解析,供 FpImportModal customParse)。
// 一张 sheet 多段:每段标题含「期」+「光伏发电明细」(如 一期B-G座光伏发电明细/二期光伏发电明细/三期（3、4车间）光伏发电明细)。
// 段→phaseId(一→p1/二→p2/三→p3);每段两行表头 + 逐月行(小计/合计行由 matchByHeader 跳过)。
// 列:消纳电量→selfKwh、消纳电费金额→selfAmt、上网电量→gridKwh、上网收益→gridAmt;
//     发生月份/备注 作 text 列;光伏发电总量/总金额(派生)不映射、自动忽略。
// 行:parseYearMonth(记账月份)→acctMonth、parseYearMonth(发生月份)→occurMonth。
import { matchByHeader, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'
import { parseYearMonth } from './parseYearMonth'

export interface PvSection { label: string; records: ImportRec[] }

// 记账月份=行身份(nameLabels);发生月份/备注 text 列;消纳/上网 4 列→字段。
const PV_COLUMN_MAP: ColumnMapEntry[] = [
  { label: '发生月份', key: 'occurRaw', text: true },
  { label: '消纳电量', key: 'selfKwh' },
  { label: '消纳电费金额', key: 'selfAmt' },
  { label: '上网电量', key: 'gridKwh' },
  { label: '上网收益', key: 'gridAmt' },
  { label: '备注', key: 'noteRaw', text: true },
]
const NAME_LABELS = ['记账月份']

// 段标题:某行 join 后含「(一|二|三)期…光伏…明细」。
const TITLE_RE = /(一|二|三)期.*光伏.*明细/

function phaseFromTitle(t: string): string | null {
  if (t.includes('一期')) return 'p1'
  if (t.includes('二期')) return 'p2'
  if (t.includes('三期')) return 'p3'
  return null
}

function matchTitle(row: string[]): { phaseId: string; label: string } | null {
  const joined = row.map(c => String(c ?? '')).join('')
  if (!TITLE_RE.test(joined)) return null
  const phaseId = phaseFromTitle(joined)
  if (!phaseId) return null
  // 标签取首个非空单元格(段名)
  const label = row.map(c => String(c ?? '').trim()).find(c => c) ?? joined
  return { phaseId, label }
}

// 段块 → 记录:matchByHeader 解析后,记账月份(tenantName)/发生月份(occurRaw)经 parseYearMonth → YYYY-MM;
// 月份解析失败(空/小计漏网)→ 跳过。
function parsePvBlock(block: string[][], phaseId: string): ImportRec[] {
  const { records } = matchByHeader(block, PV_COLUMN_MAP, NAME_LABELS)
  const out: ImportRec[] = []
  for (const r of records) {
    const ym = parseYearMonth(r.tenantName)
    if (!ym) continue
    const acctMonth = `${ym.year}-${String(ym.month).padStart(2, '0')}`
    const om = parseYearMonth(r.occurRaw)
    const occurMonth = om ? `${om.year}-${String(om.month).padStart(2, '0')}` : acctMonth
    const note = String(r.noteRaw ?? '').trim()
    out.push({
      phaseId, acctMonth, occurMonth,
      selfKwh: r.selfKwh as number, selfAmt: r.selfAmt as number,
      gridKwh: r.gridKwh as number, gridAmt: r.gridAmt as number,
      note: note || undefined,
      __preview: [r.tenantName, acctMonth, occurMonth, r.selfKwh, r.selfAmt, r.gridKwh, r.gridAmt],
    })
  }
  return out
}

export function importPvSections(matrix: string[][]): { sections: PvSection[] } {
  const titles: { rowIndex: number; phaseId: string; label: string }[] = []
  matrix.forEach((row, ri) => {
    const t = matchTitle(row)
    if (t) titles.push({ rowIndex: ri, ...t })
  })

  const sections: PvSection[] = []
  titles.forEach((t, i) => {
    const start = t.rowIndex + 1
    const end = i + 1 < titles.length ? titles[i + 1].rowIndex : matrix.length
    const block = matrix.slice(start, end)
    sections.push({ label: t.label, records: parsePvBlock(block, t.phaseId) })
  })
  return { sections }
}
