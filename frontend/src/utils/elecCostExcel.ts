// 电费成本 Excel 全家桶(ELEC-COST-SPEC §5):导入行解析 + 模板生成 + 月度导出。
// 导入 = 单 sheet 长表(一行 = 一表一费项一月),表头按名识别(matchByHeader);
// 费项名/拆分名精确匹配(映射见下,行级错误不整批拦);未知电表名由后端行级 ImportError 报告(表是 DB 驱动 CRUD)。
// AOA 构建为纯函数(elecCostExcel.spec.ts 锁定);xlsx 懒加载,仅点下载/导出才拉(仿 pvMeterExcel)。
import { matchByHeader, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'
import { parseYearMonth } from './parseYearMonth'

// ── 中文费项名↔fee_key 映射:前端单一事实源(视图域 import 复用),镜像后端 ElecCostService.FEE_BY_LABEL ──
// 含别名:宿舍「用电费用」/ops「电表费用」同 key;「功率因素」为用户树状图原文错别字
export const ELEC_FEE_BY_LABEL: Record<string, string> = {
  工业分时电价: 'tou_industrial',
  工业基本电费: 'basic_industrial',
  商业用电: 'commercial',
  光伏上网收益: 'pv_grid_income',
  功率因数奖励: 'pf_reward',
  功率因素奖励: 'pf_reward',
  用电费用: 'usage',
  电表费用: 'usage',
  分摊额度: 'allocated',
}
// fee_key → 展示名(usage 默认「用电费用」;ops 表展示「电表费用」走 elecFeeLabel(key, kind))
export const ELEC_FEE_LABEL: Record<string, string> = {
  tou_industrial: '工业分时电价', basic_industrial: '工业基本电费', commercial: '商业用电',
  pv_grid_income: '光伏上网收益', pf_reward: '功率因数奖励', usage: '用电费用', allocated: '分摊额度',
}
export function elecFeeLabel(feeKey: string, kind?: string): string {
  if (feeKey === 'usage' && kind === 'ops') return '电表费用'
  return ELEC_FEE_LABEL[feeKey] ?? feeKey
}

// sub_key 映射(拆分口径 ELEC-COST-SPEC §3):工业拆 B-G座/三期工业大厦,商业拆 A座/三期创业大厦
export const ELEC_SUB_BY_LABEL: Record<string, string> = {
  'B-G座': 'bg', 三期工业大厦: 't3_industry', A座: 'a', 三期创业大厦: 't3_chuangye',
}
export const ELEC_SUB_LABEL: Record<string, string> = {
  bg: 'B-G座', t3_industry: '三期工业大厦', a: 'A座', t3_chuangye: '三期创业大厦',
}

// 直传 key 兼容(同后端 getOrDefault 语义):中文名或 fee_key/sub_key 都收,其余=行级错误
const FEE_KEY_SET = new Set(Object.values(ELEC_FEE_BY_LABEL))
const SUB_KEY_SET = new Set(Object.values(ELEC_SUB_BY_LABEL))

export interface ElecCostImportError { rowIndex: number; label: string; reason: string }

// 模板列 = 后端 ElecCostImportRequest.Row 字段顺序;__preview 与此对齐
export const ELEC_COST_TEMPLATE_COLS = ['电表', '费项', '拆分', '月份(YYYY-MM)', '金额(元)', '电量(kWh,可空)', '备注']

// 金额/电量列标 text:自己解析——cleanNum 会把空格吃成 0,而「电量可空」「金额缺失报错」都需要区分空与 0
const ELEC_COST_COLUMN_MAP: ColumnMapEntry[] = [
  { label: '费项', key: 'feeRaw', text: true },
  { label: '拆分', key: 'splitRaw', text: true },
  { label: '月份', key: 'monthRaw', text: true },
  { label: '金额', key: 'amountRaw', text: true },
  { label: '电量', key: 'qtyRaw', text: true },
  { label: '备注', key: 'noteRaw', text: true },
]

// 数字单元格:''=空(undefined),非数字=null,其余去千分位/货币符后取数
function numCell(v: unknown): number | null | undefined {
  const s = String(v ?? '').replace(/[, ¥￥\s]/g, '')
  if (s === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ── 导入行解析(纯函数,供 importRegistry customParse) ──────────
// records = 后端 POST /api/elec-cost/import 行契约 {meter, fee, split, month, amount, qty, note};
// fee/split 原样透传中文名(后端映射为单一落库口径),客户端仅做精确匹配预检挡行级错误。
// 电表名合法性(存在/费项×表类型)由后端校验行级报告;表头识别失败为整批错误(rowIndex=-1)。
export function parseElecCostRows(matrix: string[][]): { records: ImportRec[]; errors: ElecCostImportError[] } {
  const { records: matched, error } = matchByHeader(matrix, ELEC_COST_COLUMN_MAP, ['电表'])
  if (error) return { records: [], errors: [{ rowIndex: -1, label: '', reason: error }] }

  const records: ImportRec[] = []
  const errors: ElecCostImportError[] = []
  matched.forEach((r, i) => {
    const meter = String(r.tenantName).trim()
    const fee = String(r.feeRaw ?? '').trim()
    if (!(fee in ELEC_FEE_BY_LABEL) && !FEE_KEY_SET.has(fee)) {
      errors.push({ rowIndex: i, label: `${meter} ${fee}`, reason: '费项无法识别(如 工业分时电价/工业基本电费/商业用电/光伏上网收益/功率因数奖励/用电费用/电表费用/分摊额度)' })
      return
    }
    const split = String(r.splitRaw ?? '').trim()
    if (split !== '' && !(split in ELEC_SUB_BY_LABEL) && !SUB_KEY_SET.has(split)) {
      errors.push({ rowIndex: i, label: `${meter} ${split}`, reason: '拆分无法识别(可留空=合计行;工业拆 B-G座/三期工业大厦,商业拆 A座/三期创业大厦)' })
      return
    }
    const ym = parseYearMonth(r.monthRaw)   // 不给回退年:裸「7月」歧义,必须带年
    if (!ym) {
      errors.push({ rowIndex: i, label: `${meter} ${String(r.monthRaw ?? '').trim()}`, reason: '月份无法识别(需 YYYY-MM 或 Excel 日期格)' })
      return
    }
    const month = `${ym.year}-${String(ym.month).padStart(2, '0')}`
    const amount = numCell(r.amountRaw)
    if (amount == null || amount < 0) {
      errors.push({ rowIndex: i, label: `${meter} ${month}`, reason: '金额缺失或为负' })
      return
    }
    const qty = numCell(r.qtyRaw)
    if (qty === null || (qty != null && qty < 0)) {
      errors.push({ rowIndex: i, label: `${meter} ${month}`, reason: qty === null ? '电量无法识别(可留空)' : '电量不能为负' })
      return
    }
    const note = String(r.noteRaw ?? '').trim() || undefined
    records.push({
      meter, fee, split, month, amount, qty, note,
      __preview: [meter, fee, split, month, amount, qty ?? '', note ?? ''],
    })
  })
  return { records, errors }
}

// ── 模板生成(表头 + 示例行,电表/拆分名 = V42 真实种子;同费项勿合计+拆分并存,示例即示范) ──────
export function buildElecCostTemplateAoa(): (string | number)[][] {
  return [
    ELEC_COST_TEMPLATE_COLS,
    ['一期总表', '工业分时电价', '', '2025-01', 850000, 1200000, '拆分留空=合计行'],
    ['一期总表', '商业用电', 'A座', '2025-01', 120000, 150000, '拆分行(同费项要么全拆分要么只合计,勿并存)'],
    ['一期总表', '商业用电', '三期创业大厦', '2025-01', 60000, 75000, ''],
    ['宿舍电表', '用电费用', '', '2025-01', 30000, 45000, ''],
    ['水泵房', '电表费用', '', '2025-01', 8000, '', '电量可空;(电表,月份,费项,拆分)重复导入自动覆盖'],
  ]
}

export async function buildElecCostTemplate(): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildElecCostTemplateAoa()), '电费成本')
  XLSX.writeFile(wb, '电费成本导入模板.xlsx')
}

// ── 月度导出:sheet1=电表分区镜像(长表,含拆分行+来源标注列),sheet2=派生指标 ──────
// 结构化最小类型(与 api/elecCost.ts DTO 结构兼容,不 import 以保双代理并行独立)
export interface ElecMeterLite { id: number; name: string; kind: string }
export interface ElecCostEntryLite {
  meterId: number; feeKey: string; subKey?: string | null
  amount: number; qty?: number | null; note?: string | null
  source?: string | null; acctMonth?: string
}
export interface ElecMetricLite {
  key?: string; label: string; value?: number | null
  formulaText?: string | null; missing?: string[]
}

const SOURCE_LABEL: Record<string, string> = { manual: '手工', import: '导入', simulated: '模拟' }
// 行序:表序(meters 给定 sort 序) → 费项固定序 → 合计行在前、拆分行在后
const FEE_ORDER = ['tou_industrial', 'basic_industrial', 'commercial', 'pv_grid_income', 'pf_reward', 'usage', 'allocated']
const SUB_ORDER = ['', 'bg', 't3_industry', 'a', 't3_chuangye']
const round2 = (n: number) => Math.round(n * 100) / 100

// sheet1:表头 = 导入模板七列 + 尾缀「来源」(matchByHeader 未命中列自动忽略 → 导出可直接回导,模拟标注不碍事)。
// ponytail: 无费项行的电表不出行——占位行费项为空回导必报错,镜像以「有数据」为准。
export function buildElecCostMonthAoa(
  entries: ElecCostEntryLite[], meters: ElecMeterLite[], year: number, month: number,
): (string | number)[][] {
  const ym = `${year}-${String(month).padStart(2, '0')}`
  const aoa: (string | number)[][] = [
    [`电费成本 · ${year}年${month}月`],
    [...ELEC_COST_TEMPLATE_COLS, '来源'],
  ]
  const feeIdx = (k: string) => { const i = FEE_ORDER.indexOf(k); return i < 0 ? 999 : i }
  const subIdx = (k: string) => { const i = SUB_ORDER.indexOf(k); return i < 0 ? 999 : i }
  for (const m of meters) {
    const rows = entries.filter(e => e.meterId === m.id).slice().sort((a, b) =>
      feeIdx(a.feeKey) - feeIdx(b.feeKey) || subIdx(a.subKey ?? '') - subIdx(b.subKey ?? ''))
    for (const e of rows) {
      aoa.push([
        m.name,
        elecFeeLabel(e.feeKey, m.kind),
        ELEC_SUB_LABEL[e.subKey ?? ''] ?? '',
        e.acctMonth ?? ym,
        round2(Number(e.amount) || 0),
        e.qty == null ? '' : round2(Number(e.qty)),
        e.note ?? '',
        SOURCE_LABEL[e.source ?? ''] ?? '',
      ])
    }
  }
  return aoa
}

// sheet2:派生指标 1-7(与屏上指标卡同源,算不出的项数值空 + 缺失源指名)
export function buildElecCostMetricsAoa(
  metrics: ElecMetricLite[], year: number, month: number,
): (string | number)[][] {
  return [
    [`派生指标 · ${year}年${month}月`],
    ['指标', '数值', '公式', '缺失源'],
    ...metrics.map((m): (string | number)[] => [
      m.label,
      m.value == null ? '' : round2(Number(m.value)),
      m.formulaText ?? '',
      (m.missing ?? []).join('；'),
    ]),
  ]
}

export async function exportElecCostMonth(
  entries: ElecCostEntryLite[], meters: ElecMeterLite[], metrics: ElecMetricLite[],
  year: number, month: number,
): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildElecCostMonthAoa(entries, meters, year, month)), `${year}年${month}月`)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildElecCostMetricsAoa(metrics, year, month)), '派生指标')
  XLSX.writeFile(wb, `电费成本-${year}年${String(month).padStart(2, '0')}月.xlsx`)
}
