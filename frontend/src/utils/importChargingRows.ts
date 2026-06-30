// 附表7/8 充电桩 — 单表真实模板逐行解析(自定义解析,供 FpImportModal customParse)。
// 一张 sheet 一个附表:行身份 = 月份/期间(nameLabels);运营商在「充电桩类别」合并列,向下填充(groupLabels)。
// 列:充电电量→kwh、充电成本(金额)→cost、充电金额收入/充电收入金额→incomeRaw、手续费及服务费金额→serviceFee。
// fee 按附表口径算好后下发后端(后端只入不再算):
//   电动车 no=8 → fee = incomeRaw(模板「充电金额收入」已扣手续费,直取);
//   汽车   no=7 → fee = incomeRaw − serviceFee(模板收入未扣,减「手续费及服务费金额」)。
// 每行:cat 由 __groups['充电桩类别'] 运营商名经 cats 字典(name→cat_id)解析;未知运营商 → errors 跳过。
//      acctMonth = parseYearMonth(月份/期间);null → 跳过。其中 小计/合计/总计 由 matchByHeader 识别为 subtotal
//      在到达本循环前已静默剔除;而「年/年范围」(2024年/2025年1-9月)非 subtotal,会进本循环并报告(汽车主要)。
import { matchByHeader, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'
import { parseYearMonth } from './parseYearMonth'

export interface ChargingImportRow {
  cat: string         // 已解析的 cat_id
  acctMonth: string   // YYYY-MM
  kwh: number
  fee: number
  cost: number
  note?: string       // 备注(如「未续约」「电信只剩两个充电桩」)
}
export interface ChargingError { rowIndex: number; label: string; reason: string }
export interface ChargingCatLite { catId: string; name: string }

const GROUP_LABEL = '充电桩类别'

// 收入两种表头(汽车「充电收入金额」/ 电动车「充电金额收入」)、成本两种(汽车「充电成本金额」/ 电动车「充电成本」)。
// 前缀匹配(见 importHeaderMatch)扛单位后缀「（千瓦时）」「（元）」等。
const COLUMN_MAP: ColumnMapEntry[] = [
  { label: '充电电量', key: 'kwh' },
  { label: '充电金额收入', key: 'incomeRaw' },   // 电动车
  { label: '充电收入金额', key: 'incomeRaw' },   // 汽车
  { label: '手续费及服务费金额', key: 'serviceFee' },
  { label: '充电成本金额', key: 'cost' },         // 汽车(更长,前缀优先)
  { label: '充电成本', key: 'cost' },             // 电动车
  { label: '备注', key: 'noteRaw', text: true },  // 逐月业务说明,文本列
]
const NAME_LABELS = ['月份', '期间']

// 运营商名 → cat_id(去空格容错);未知 → null。
function resolveCat(name: string, cats: ChargingCatLite[]): string | null {
  const n = name.replace(/\s/g, '')
  const hit = cats.find(c => c.name.replace(/\s/g, '') === n)
  return hit ? hit.catId : null
}

export function importChargingRows(
  matrix: string[][],
  no: number,            // 7 汽车 / 8 电动车 — 决定 fee 口径
  cats: ChargingCatLite[],
): { records: ImportRec[]; errors: ChargingError[] } {
  const { records: matched, error } = matchByHeader(matrix, COLUMN_MAP, NAME_LABELS, [GROUP_LABEL])
  if (error) return { records: [], errors: [{ rowIndex: -1, label: '', reason: error }] }

  const records: ImportRec[] = []
  const errors: ChargingError[] = []
  matched.forEach((r, i) => {
    const opName = String(r.__groups?.[GROUP_LABEL] ?? '').trim()
    const ym = parseYearMonth(r.tenantName)   // 月份/期间(行身份)
    const monthStr = String(r.tenantName ?? '').trim()
    // 聚合/年/范围(parseYearMonth → null)→ 报告跳过(汽车 年/年范围/小计行)
    if (!ym) { errors.push({ rowIndex: i, label: opName ? `${opName} ${monthStr}` : monthStr, reason: '非单月行(年/范围/小计)已跳过' }); return }
    const catId = resolveCat(opName, cats)
    if (!catId) { errors.push({ rowIndex: i, label: `${opName} ${monthStr}`, reason: `未知运营商「${opName || '空'}」,请先在字典补` }); return }

    const acctMonth = `${ym.year}-${String(ym.month).padStart(2, '0')}`
    const income = (r.incomeRaw as number) ?? 0
    const serviceFee = (r.serviceFee as number) ?? 0
    const fee = no === 8 ? income : income - serviceFee   // 电动车直取 / 汽车减手续费
    const kwh = (r.kwh as number) ?? 0
    const cost = (r.cost as number) ?? 0
    const note = String(r.noteRaw ?? '').trim() || undefined
    records.push({
      cat: catId, acctMonth, kwh, fee, cost, note,
      __preview: [opName, acctMonth, kwh, fee, cost],
    })
  })
  return { records, errors }
}
