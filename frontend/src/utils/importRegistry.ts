// 导入类型单一事实源(registry)+ runImport 记录链。
// 各屏与导入中心 hub 都从这里取「解析配置(modalProps/parserProps) + 执行(runImport)」,导入后统一上报 import_log。
// T5 已完成(45cf8bf):全部原屏均经 parserProps()/runImport() 消费本 registry,屏内不再有重复列映射。
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { importLogApi } from '@/api/importLog'
import { ledgerApi } from '@/api/ledger'
import { s10Api } from '@/api/s10'
import { pvApi } from '@/api/pv'
import { chargingApi } from '@/api/charging'
import { elecApi } from '@/api/elec'
import { salaryApi } from '@/api/salary'
import { utilitiesApi } from '@/api/utilities'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import type { ReportCompanySection, ReportCell, ReportAccount } from '@/types/report'
import { importIncomeStatement } from '@/utils/importIncomeStatement'
import { importBalanceSheet } from '@/utils/importBalanceSheet'
import { importTrialBalance } from '@/utils/importTrialBalance'
import { TB_FIELDS } from '@/reports/trialBalance'
import { importPvSections } from '@/utils/importPvSections'
import { importPnlSchedule } from '@/utils/importPnlSchedule'
import { PNL_SCHEDULES } from '@/reports/pnlSchedules'
import { pnlApi } from '@/api/pnl'
import { budgetApi } from '@/api/budget'
import { importBudget, BUDGET_SHEET_RE } from '@/utils/importBudget'
import { PNL_SOT_FROM_YEAR } from '@/analysis/budget'
import { fetchPnlSummary, invalidateAnaCache } from '@/analysis/anaData'
import { importChargingRows } from '@/utils/importChargingRows'
import { parsePvMeterRows, PV_METER_TEMPLATE_COLS } from '@/utils/pvMeterExcel'
import { parseCpMeterRows, CP_METER_TEMPLATE_COLS } from '@/utils/cpMeterExcel'
import { parseMeterWorkbook, METER_TEMPLATE_COLS } from '@/utils/meterExcel'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import { contractApi } from '@/api/contract'
import { parseBillingTermsWorkbook, billingReportCsv, BILLING_TERM_TEMPLATE_COLS, type BillingContractLite, type BillingReportRow } from '@/utils/importBillingTerms'
import { parseContractWorkbook, contractReportCsv, CONTRACT_FULL_TEMPLATE_COLS, type ContractFullRow, type ContractReportRow } from '@/utils/importContractSummary'
import type { BillingLinesImportRow } from '@/types/contract'
import http from '@/api/index'
import { importElecRows } from '@/utils/importElecRows'
import { parseElecCostRows, ELEC_COST_TEMPLATE_COLS } from '@/utils/elecCostExcel'
import { parseYearMonth } from '@/utils/parseYearMonth'
import { matchByHeader, isGarbageTenantName, type ColumnMapEntry } from '@/utils/importHeaderMatch'
import { FEE_KEYS, lgColumns } from '@/utils/ledgerColumns'
import { PHASE_LAYOUT, leavesOf } from '@/views/sales-income/layout'

// ── 解析工具/常量(临时复制自各屏,T5 dedup 时归并) ─────────────
const pad2 = (m: number) => String(m).padStart(2, '0')

const SALARY_COLUMN_MAP = [
  { label: '职种/职务', key: 'role', text: true },
  { label: '基本工资', key: 'base' },
  { label: '岗位工资', key: 'post' },
  { label: '绩效奖金', key: 'perf' },
  { label: '全勤奖', key: 'attend' },
  { label: '岗位技能津贴', key: 'skill' },
  { label: '学历津贴', key: 'edu' },
  { label: '其它津贴', key: 'other' },
  { label: '午餐补助', key: 'lunch' },
  { label: '高温及其他补贴', key: 'heat' },
  { label: '招商提成', key: 'commission' },
  { label: '应出勤', key: 'shouldDays' },
  { label: '请假', key: 'leaveDays' },
  { label: '社保', key: 'social' },
  { label: '上月个税', key: 'tax' },
  { label: '其他', key: 'otherDeduct' },
]
const SALARY_SECTION_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月.*工资表/
const UTILITIES_COLUMN_MAP = [
  { label: '用电量', key: 'elecQty' },
  { label: '基准用电单价', key: 'elecPrice' },
  { label: '用水量', key: 'waterQty' },
  { label: '基准用水单价', key: 'waterPrice' },
  { label: '所属月份', key: 'belongMonth', text: true },
]

// ledger: 21 费用列(label = lgColumns 叶子,顺序 = FEE_KEYS) + 结余/收款/备注可导入列。
// 「本月应收合计/本月结余」是系统派生列,绝不映射(文件里这两列被 matchByHeader 忽略)。
// 10月表列名变体别名(规范§一;模板列只显示主 label。新增别名必须重做前缀碰撞核对)
const LEDGER_ALIASES: Partial<Record<string, string[]>> = {
  shopRent: ['商铺租金'],
  dormFacilitiesFee: ['宿舍配套设施费'],
  shopInfraMaint: ['商铺基础设施维护费'],
}
function ledgerColumnMap(prevMonth: number | null): ColumnMapEntry[] {
  const labelByKey: Record<string, string> = {}
  for (const g of lgColumns(0).groups) for (const c of g.cols) labelByKey[c.key] = c.label
  return [
    ...FEE_KEYS.map(k => ({ label: labelByKey[k], key: k as string, aliases: LEDGER_ALIASES[k] })),
    // balancePrev 主 label 仍动态单标签(模板列不双列诱导,复审①);「上月结余」走别名只参与匹配
    { label: prevMonth != null ? prevMonth + '月结余' : '上月结余', key: 'balancePrev', aliases: ['上月结余'] },
    { label: '本月收款', key: 'totalCollected' },
    { label: '备注', key: 'note', text: true },
  ]
}
// 台账文件标题年月(如「2025年1月园区费用明细表①」)。parseYearMonth 对这类聚合串会误判返 null,
// 故直接用正则在前 3 行(标题+主表头+分组行)单元格里抓第一个「yyyy年m月」;
// 窗口不能更大:扫进数据行会被备注文本(如「2024年12月电费未付」)误触发(复审③)。
const LEDGER_TITLE_YM_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月/

// 同 sheet 多月纵向堆叠拆块(规范§五 v3,事故三:873 行 12 块堆叠只解析最后一段)。
// 块起点双保险(复审:数据行备注「费用参见2024年12月…明细表附页」不得误切,否则其后行静默丢失):
// ① 单元格以「yyyy年m月」开头且含「明细表」(标题式锚,备注引用多有前缀);
// ② 该行非空格 ≤3(标题行只有 1~2 个非空,数据行远多于此)。
// 首个起点之前的行自成前导块(解析失败静默丢弃,同坏 sheet 权衡);整 sheet 无起点 → 单块=现行为零回归。
const LEDGER_BLOCK_START_RE = /^\s*(\d{4})\s*年\s*(\d{1,2})\s*月.*明细表/
function splitLedgerBlocks(matrix: string[][]): string[][][] {
  const starts: number[] = []
  matrix.forEach((row, ri) => {
    if (row.filter(c => String(c ?? '').trim() !== '').length > 3) return
    if (row.some(c => LEDGER_BLOCK_START_RE.test(String(c ?? '')))) starts.push(ri)
  })
  if (!starts.length) return [matrix]
  const blocks: string[][][] = []
  if (starts[0] > 0) blocks.push(matrix.slice(0, starts[0]))
  starts.forEach((s, i) => blocks.push(matrix.slice(s, starts[i + 1])))
  return blocks
}

// 与引擎 isNumericOrBlank 同口径:空/千分位数字/短横线视为「数字样」,不作公司名候选
const isNumericLike = (s: string): boolean => {
  const t = s.replace(/[, ¥%\s]/g, '')
  return t === '' || t === '-' || t === '–' || t === '—' || (!isNaN(parseFloat(t)) && /^[-+]?[\d.]+$/.test(t))
}

// 段内同名租户行合并(规范§八 v4,事故四):真实台账"同租户多处物业分行记",后端 last-wins 会丢调整行
// (B2·1月万众宿舍双行)。数值键逐列相加(同段列集一致,空=0 直接加);字符串键(note)非空去重后「；」拼接;
// __ 前缀键与 __preview 取首行;合并后行序保持首现位置(Map 插入序)。
function mergeSameNameRecords(records: ImportRec[]): ImportRec[] {
  const byName = new Map<string, ImportRec>()
  for (const r of records) {
    const prev = byName.get(String(r.tenantName))
    if (!prev) { byName.set(String(r.tenantName), { ...r }); continue }
    for (const [k, v] of Object.entries(r)) {
      if (k === 'tenantName' || k.startsWith('__')) continue
      if (typeof v === 'number') prev[k] = (Number(prev[k]) || 0) + v
      else if (typeof v === 'string' && v) {
        const parts = String(prev[k] ?? '').split('；').filter(Boolean)
        if (!parts.includes(v)) parts.push(v)
        prev[k] = parts.join('；')
      }
    }
  }
  return [...byName.values()]
}

// 台账单 sheet 解析:标题年月正则(前3行) + matchByHeader(含别名) + 公司识别三级回退。
// balancePrev 动态标签按「该 sheet 识别到的年月」重建(11月表的「10月结余」也能吃;识别不到才用屏上下文 prev,复审②)。
// ① 前置标记列:仅扫租户列左侧(真实表标记列都在最前),在有租户名的数据行里 ≥90% 为同一非数字文本
//    (如整列「创显」)→ 该文本即公司名。租户列右侧的备注/费用列天然出局,不会被误判成公司(复审①)。
// ② sheet 名等于/包含某已有管理公司名 → 该公司
// ③ 都没有 → undefined,调用方回退屏/表单上下文公司
function parseLedgerSheet(matrix: string[][], ctxPrev: number | null, sheetName: string, companyNames?: string[]) {
  let ym: { year: number; month: number } | undefined
  for (const row of matrix.slice(0, 3)) {
    for (const c of row) {
      const m = LEDGER_TITLE_YM_RE.exec(String(c ?? ''))
      if (m) { ym = { year: +m[1], month: +m[2] }; break }
    }
    if (ym) break
  }
  const columnMap = ledgerColumnMap(ym ? (ym.month === 1 ? 12 : ym.month - 1) : ctxPrev)
  const res = matchByHeader(matrix, columnMap, ['租户'], undefined, { skipName: isGarbageTenantName })   // 垃圾行过滤(规范§九 v4)
  if (res.error || !res.records.length) return { records: [] as ImportRec[], error: res.error, ym, company: undefined as string | undefined }
  const { nameCol, headerEnd } = res.meta!
  // 分母与 records 同口径:垃圾行也剔除,否则垃圾行占比≥10% 时 90% 标记列规则失效(复审)
  const dataRows = matrix.slice(headerEnd + 1).filter(r => { const n = String(r[nameCol] ?? '').trim(); return n !== '' && !/合计|小计|总计/.test(n) && !isGarbageTenantName(n) })
  let company: string | undefined
  for (let c = 0; c < nameCol && !company; c++) {
    const counts = new Map<string, number>()
    for (const r of dataRows) { const v = String(r[c] ?? '').trim(); if (v) counts.set(v, (counts.get(v) ?? 0) + 1) }
    for (const [v, n] of counts) if (n >= dataRows.length * 0.9 && !isNumericLike(v)) { company = v; break }
  }
  if (!company) company = companyNames?.find(n => sheetName === n || sheetName.includes(n))
  const records = mergeSameNameRecords(res.records)
  // 合并后重建 __preview:否则确认屏预览表对被合并租户显示首行未合并金额(复审:预览口径失真)
  for (const r of records) r.__preview = [r.tenantName, ...columnMap.map(c => (c.text ? r[c.key] : r[c.key] as number) || '')]
  return { records, error: undefined as string | undefined, ym, company }
}

// budget 导入:2025 起发生额列以 pnl 实时推算为单一事实源(spec「导入」节)。解析器是同步的,
// 打开弹窗时预取各 pnl 年收入年Σ进模块级 map;解析时查不到(未返回/该年无数据)即跳过校验。
const budgetPnlRevenue = new Map<number, number>()
function prefetchBudgetPnlRevenue(): void {
  for (let y = PNL_SOT_FROM_YEAR; y <= new Date().getFullYear(); y++) {
    void fetchPnlSummary(y).then(s => {
      const total = s.revenue.reduce<number | null>((acc, v) => (v == null ? acc : (acc ?? 0) + v), null)
      if (total != null) budgetPnlRevenue.set(y, total)
    }).catch(() => { /* 拉不到 → 跳过校验 */ })
  }
}

// meter v2 主数据(METER-SPEC §6.2/§6.3):解析器是同步的,打开弹窗时预取租户库(带 id)与楼栋清单进模块缓存;
// 每次打开都重取(会话内主数据可能新增),旧值在新值落位前顶用。
let meterTenants: { id: number; companyName: string }[] | null = null
let meterBuildings: { id: number; name: string }[] | null = null
function prefetchMeterMaster(): void {
  void tenantApi.list().then(v => { meterTenants = v.map(t => ({ id: t.id, companyName: t.companyName })) }).catch(() => {})
  void buildingApi.list().then(v => { meterBuildings = v.map(b => ({ id: b.id, name: b.name })) }).catch(() => {})
}

// 计费条款(BILL-FORWARD 第1刀 §1.2):解析器要合同库做 租户名→生效合同 匹配;打开弹窗预取(同 meter 模式)
let billingContracts: BillingContractLite[] | null = null
function prefetchBillingContracts(): void {
  void contractApi.list().then(v => {
    billingContracts = v.map(c => ({
      id: c.id, contractNo: c.contractNo, tenantName: c.tenantName,
      startDate: c.startDate, endDate: c.endDate, status: c.status,
      buildingName: c.buildingName,   // multiPick 位置路由(厂房/宿舍)
    }))
  }).catch(() => {})
}

const phaseLayoutsCol = {
  office: leavesOf('office').map(l => ({ label: l.label, key: l.colId, aliases: l.aliases })),
  factory: leavesOf('factory').map(l => ({ label: l.label, key: l.colId, aliases: l.aliases })),
}

// ── 类型 ────────────────────────────────────────────────
export type ImportStatus = 'complete' | 'partial' | 'rejected'
type Pick = { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }
// ctx:hub 每次导入创建一个,同一引用同时传给 modalProps 与 run(charging 用它在解析期暂存 parseErrors)
export interface ImportCtx {
  companyId?: number; companyName?: string; year?: number; month?: number
  companyNames?: string[]   // 已有管理公司名单(台账整册拆段的 sheet 名识别用)
  tenantNames?: string[]                      // 租户库 companyName 全量(meter §6.2 拆分;视图填,同 companyNames 机制)
  buildings?: { id: number; name: string }[]  // 楼栋清单(meter §6.3 区域→楼栋映射;视图填,BuildingDTO 结构兼容)
  cats?: unknown[]; _parseErrors?: { rowIndex: number; label: string; reason: string }[]
  _bfReport?: BillingReportRow[]   // 计费字段导入:解析期到户报告,导入成功后落 CSV(裁定⑤)
  _cfReport?: ContractReportRow[]  // 合同汇总册导入:解析期到户报告(与 rows 同序),导入后并入后端匹配结果落 CSV
}
export interface ImportTypeEntry {
  key: string; label: string; tag: string; icon: string
  context: 'none' | 'ledger'
  // title/templateCols 为 FpImportModal 必填项,收紧类型让 v-bind 展开处可静态校验
  modalProps: (ctx: ImportCtx) => { title: string; templateCols: string[] } & Record<string, unknown>
  run: (payload: ImportRec[] | Pick[], ctx: ImportCtx) => Promise<ImportResultDTO>
  target: (ctx: ImportCtx) => string | null
}

export function deriveStatus(res: ImportResultDTO): ImportStatus {
  const warn = res.skipped + res.errors.length
  if (res.imported === 0) return 'rejected'
  return warn > 0 ? 'partial' : 'complete'
}

// 空聚合器
const zero = (): ImportResultDTO => ({ imported: 0, skipped: 0, errors: [] })

// 到户报告落盘(计费行/合同汇总册共用)
function downloadCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export const IMPORT_TYPES: ImportTypeEntry[] = [
  {
    key: 'ledger', label: '月度台账', tag: '凭证', icon: 'book-open', context: 'ledger',
    modalProps: (ctx) => {
      const prev = ctx.month ? (ctx.month === 1 ? 12 : ctx.month - 1) : null
      const columnMap = ledgerColumnMap(prev)
      return {
        title: '导入 月度台账' + (ctx.companyName ? ' · ' + ctx.companyName : ''),
        sub: `按表头名字自动识别列,需包含表头;可整表粘贴(前置公司列/合计行/应收结余列自动忽略),导入到 ${ctx.year} 年 ${ctx.month} 月`,
        templateCols: ['租户', ...columnMap.map(c => c.label)],
        // 整册多 sheet 拆段(规范§二;粘贴路径被 FpImportModal 包装为单 sheet,语义同旧 customParse)
        // v3:每 sheet 先按块起点切分(同 sheet 多月纵向堆叠,规范§五),每块作虚拟 sheet 原样解析
        parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => {
          const parsed = sheets.flatMap(s =>
            splitLedgerBlocks(s.matrix).map(block => parseLedgerSheet(block, prev, s.name, ctx.companyNames)))
          const withRecords = parsed.filter(p => p.records.length)
          if (!withRecords.length) return { error: parsed.find(p => p.error)?.error ?? '已读取数据,但没识别到任何有效记录。' }
          // 有记录的 sheet 仅 1 个 → 平铺(现有预检/双 confirm 流程不变),识别年月照旧挂行
          if (withRecords.length === 1) {
            const p = withRecords[0]
            if (p.ym) for (const r of p.records) r.__ymDetected = p.ym
            return { records: p.records }
          }
          // ≥2 个 → 拆段:records 各自携带 __company/__ym(run 逐段落库),label 供确认屏勾选
          return {
            sections: withRecords.map(p => ({
              label: `${p.company ?? ctx.companyName ?? '当前公司'} · ` +
                (p.ym ? `${p.ym.year}年${p.ym.month}月` : `${ctx.year}年${ctx.month}月(未识别,用当前)`),
              records: p.records.map(r => { const rec = { ...r }; if (p.company) rec.__company = p.company; if (p.ym) rec.__ym = p.ym; return rec }),
            })),
          }
        },
      }
    },
    run: async (payload, ctx) => {
      // 发后端前剥所有 __ 前缀内部键(__ymDetected/__company/__ym)
      const strip = (r: ImportRec) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('__')))
      // Pick[] 段分支(元素带 .records):逐段公司名精确匹配、未匹配自动新建(同 report_is 惯例),
      // 年月未识别回退 ctx;段公司名空则用 ctx.companyId → 聚合 ImportResultDTO
      if (payload.length && (payload[0] as Pick).records) {
        const picks = payload as Pick[]
        const companies = await companyApi.list()
        const byName = new Map(companies.map(c => [c.name.trim(), c.id]))
        const agg = zero()
        for (const p of picks) {
          const first = p.records[0]
          if (!first) continue
          const cname = String(first.__company ?? '').trim()
          let companyId = ctx.companyId
          if (cname) {
            if (!byName.has(cname)) {
              const created = await companyApi.create(cname)   // 未匹配自动新建
              byName.set(cname, created.id)
            }
            companyId = byName.get(cname)
          }
          const ym = first.__ym as { year: number; month: number } | undefined
          const res = await ledgerApi.import(companyId!, ym?.year ?? ctx.year!, ym?.month ?? ctx.month!,
            { rows: p.records.map(strip) as never })
          agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
        }
        return agg
      }
      const rows = (payload as ImportRec[]).map(strip)
      return ledgerApi.import(ctx.companyId!, ctx.year!, ctx.month!, { rows: rows as never })
    },
    target: (ctx) => `${ctx.year}-${pad2(ctx.month!)} · ${ctx.companyName ?? ''}`,
  },
  {
    key: 's10', label: '销售收入', tag: '附表10', icon: 'coins', context: 'none',
    modalProps: () => ({
      title: '导入 附表10 · 智能整表',
      sub: '上传/粘贴整张多段 Excel,系统按标题行自动拆段、识别年/月/期与版面,核对后逐段导入',
      templateCols: phaseLayoutsCol.factory.map(c => c.label),
      phaseLayouts: phaseLayoutsCol, nameLabels: ['租户名称', '租户'],
    }),
    run: async (payload) => {
      const picks = payload as Pick[]
      const agg = zero()
      for (const p of picks) {
        const acctMonth = `${p.year}-${pad2(p.month!)}`
        const rows = p.records.map(r => ({ profile: PHASE_LAYOUT[p.phase!], ...r }))
        const res = await s10Api.importRows({ phase: p.phase!, acctMonth, rows: rows as never })
        agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
      }
      return agg
    },
    target: () => null,
  },
  {
    key: 'pv', label: '光伏发电', tag: '附表6', icon: 'sun', context: 'none',
    modalProps: () => ({
      title: '导入 附表6 · 光伏发电',
      sub: '上传/粘贴多段堆叠的光伏发电明细(一期/二期/三期),系统按段切期、按表头识别列,逐段核对后导入',
      templateCols: ['记账月份', '发生月份', '消纳电量', '消纳电费金额', '上网电量', '上网收益'],
      customParse: (matrix: string[][]) => importPvSections(matrix),
    }),
    run: async (payload) => {
      const picks = payload as Pick[]
      const rows = picks.flatMap(p => p.records)
      if (!rows.length) return zero()
      return pvApi.importRows(rows as never)
    },
    target: () => null,
  },
  // ── 光伏分栋抄表(PV-METER-SPEC §3):长表一行=一站一日,(电站,日期)幂等 upsert ──
  {
    key: 'pvMeter', label: '光伏抄表', tag: '抄表', icon: 'gauge', context: 'none',
    modalProps: (ctx) => ({
      title: '导入 光伏抄表 · 分栋明细',
      sub: '上传/粘贴分栋抄表长表(一行=一站一日),按表头识别列;(电站,日期)重复导入自动覆盖,未知站名/非法日期逐行报告不整批拦',
      templateCols: PV_METER_TEMPLATE_COLS,
      // 行级错误(非法日期/负电量)暂存 ctx,run 时并入结果面板(同 charging 模式);表头识别失败才整批拦
      customParse: (matrix: string[][]) => {
        const { records, errors } = parsePvMeterRows(matrix)
        ctx._parseErrors = errors.filter(e => e.rowIndex >= 0)
        const headerErr = errors.find(e => e.rowIndex < 0)
        if (headerErr) return { error: headerErr.reason }
        return { records }
      },
    }),
    // ponytail: 直调端点不经 api/pvMeter.ts——该文件归视图域(Wave2-A)所有,双代理并行互不阻塞;A 落地后可换 pvMeterApi
    run: async (payload, ctx) => {
      const rows = payload as ImportRec[]
      const pe = ctx._parseErrors ?? []
      if (!rows.length) return { imported: 0, skipped: pe.length, errors: pe }
      const res = await http.post<ImportResultDTO>('/pv-meter/import', { rows })
      return { imported: res.imported, skipped: res.skipped + pe.length, errors: [...res.errors, ...pe] }
    },
    target: () => null,
  },
  // ── 充电桩分桩明细(CP-METER-SPEC §3):长表一行=一桩一日,(桩,日)幂等 upsert;与附表7/8 月度汇总完全独立 ──
  {
    key: 'cpMeter', label: '充电桩明细', tag: '抄表', icon: 'plug', context: 'none',
    modalProps: (ctx) => ({
      title: '导入 充电桩明细 · 分桩抄表',
      sub: '上传/粘贴分桩充电长表(一行=一桩一日),按表头识别列;(桩,日期)重复导入自动覆盖,未知桩名/非法日期逐行报告不整批拦',
      templateCols: CP_METER_TEMPLATE_COLS,
      // 行级错误(非法日期/负金额)暂存 ctx,run 时并入结果面板(同 pvMeter 模式);表头识别失败才整批拦
      customParse: (matrix: string[][]) => {
        const { records, errors } = parseCpMeterRows(matrix)
        ctx._parseErrors = errors.filter(e => e.rowIndex >= 0)
        const headerErr = errors.find(e => e.rowIndex < 0)
        if (headerErr) return { error: headerErr.reason }
        return { records }
      },
    }),
    // ponytail: 直调端点不经 api/cpMeter.ts——该文件归视图域(W2-A)所有,双代理并行互不阻塞;A 落地后可换 cpMeterApi
    run: async (payload, ctx) => {
      const rows = payload as ImportRec[]
      const pe = ctx._parseErrors ?? []
      if (!rows.length) return { imported: 0, skipped: pe.length, errors: pe }
      const res = await http.post<ImportResultDTO>('/cp-meter/import', { rows })
      return { imported: res.imported, skipped: res.skipped + pe.length, errors: [...res.errors, ...pe] }
    },
    target: () => null,
  },
  // ── 园区抄表(METER-SPEC §4):整册多 sheet(一期/二期/宿舍×电/水),每 sheet 月份自理;
  //    表按 (分区,类别,标识) 自动建档,读数按 (表,月) 幂等覆盖;未识别 sheet(租户缴费单等)静默跳过 ──
  {
    key: 'meter', label: '园区抄表', tag: '抄表', icon: 'gauge', context: 'none',
    modalProps: (ctx) => {
      // v2 拆分(§6.2/§6.3)要租户库(带 id 才能挂 tenantId)+楼栋清单:打开弹窗即预取进模块缓存
      // (同 budget 预取模式,解析在用户选完文件后通常已就绪);视图喂的 ctx.tenantNames/ctx.buildings 作后备。
      // 取不到也不拦——正则拆分照跑,租户/楼栋 id 空、档案可改。
      prefetchMeterMaster()
      return {
        title: '导入 园区抄表 · 水电表读数',
        sub: '上传整册抄表工作簿(一期/二期/宿舍×电/水 sheet,标题行含年月),识别 sheet 逐段勾选;表自动建档,同表同月重复导入自动覆盖;缺本月读数照收并标「漏抄」',
        templateCols: METER_TEMPLATE_COLS,
        parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) =>
          parseMeterWorkbook(sheets, {
            tenants: meterTenants ?? ctx.tenantNames?.map(n => ({ companyName: n })),
            buildings: meterBuildings ?? ctx.buildings,
          }),
      }
    },
    // sections 勾选段与单段平铺两种 payload 形态都可能到达(parseWorkbook 契约)
    run: async (payload) => {
      const rows = (payload as (ImportRec | { records: ImportRec[] })[])
        .flatMap(p => 'records' in p && Array.isArray((p as { records: ImportRec[] }).records)
          ? (p as { records: ImportRec[] }).records : [p as ImportRec])
      if (!rows.length) return { imported: 0, skipped: 0, errors: [] }
      const res = await http.post<ImportResultDTO>('/meters/import', { rows })
      return { imported: res.imported, skipped: res.skipped, errors: res.errors }
    },
    target: () => null,
  },
  // ── 合同计费行(BILL-FORWARD 刀1 三次返工 §1.2):月度租金工作簿整册提取,
  //    sheet=租户,块探测 A1~A7 七型;停止收敛——每费项行 1:1 出一条计费行(位置+13枚举+面积/单价/系数/房数);
  //    叠单合并/表头转置修正/列文本映射/按间房数三写法;multiPick 银纳按位置类型路由(厂房→厂房合同/宿舍→宿舍合同);
  //    无合同户报「须先建合同」;须手录 sheet 逐条报告不整批拦;后端按 source 覆盖(manual 保留,import 覆盖);
  //    导入成功自动落「到户报告」CSV(282 户逐户有名) ──
  {
    key: 'billingTerms', label: '合同计费行', tag: '合同', icon: 'file-text', context: 'none',
    modalProps: (ctx) => {
      prefetchBillingContracts()
      return {
        title: '导入 合同计费行 · 月度租金工作簿',
        sub: '上传月度租金工作簿(每租户一 sheet,含通知单块),每费项行 1:1 提取为计费行(位置×费项×计费方式)落到生效合同;银纳类多合同按位置自动路由(厂房/宿舍),同名多合同请勾选归属;流水账/无合同 sheet 须手录/须先建合同;导入后自动下载到户报告',
        templateCols: BILLING_TERM_TEMPLATE_COLS,
        parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => {
          const { sections, errors, report } = parseBillingTermsWorkbook(sheets, { contracts: billingContracts ?? [] })
          ctx._parseErrors = errors.map(e => ({ rowIndex: Math.max(e.rowIndex, 0), label: e.label, reason: e.reason }))
          ctx._bfReport = report
          if (!sections.length) {
            return { error: errors.length
              ? `没有可自动提取的计费行:${errors.length} 项须手录/须先建合同(如 ${errors[0].label}:${errors[0].reason})`
              : '没识别到通知单块:sheet 需含「收费项目」表头。' }
          }
          return { sections }
        },
      }
    },
    // sections 勾选段与单段平铺两种 payload 形态都可能到达(parseWorkbook 契约,同 meter)
    run: async (payload, ctx) => {
      const recs = (payload as (ImportRec | { records: ImportRec[] })[])
        .flatMap(p => 'records' in p && Array.isArray((p as { records: ImportRec[] }).records)
          ? (p as { records: ImportRec[] }).records : [p as ImportRec])
      const pe = ctx._parseErrors ?? []
      if (!recs.length) return { imported: 0, skipped: pe.length, errors: pe }
      // 剥去 __preview 等 UI 字段,只上契约字段(§1.7 Row{contractId, lines})
      const rows: BillingLinesImportRow[] = recs.map(r => ({
        contractId: r.contractId as number, lines: (r.lines ?? []) as BillingLinesImportRow['lines'],
      }))
      const res = await contractApi.importBillingLines(rows)
      // 到户报告 CSV(§1.2-8):解析期清点,注:手录(manual)行后端保留,报告以册内提取行为准
      if (ctx._bfReport?.length) downloadCsv('计费字段到户报告', billingReportCsv(ctx._bfReport))
      return { imported: res.imported, skipped: res.skipped + pe.length, errors: [...res.errors, ...pe] }
    },
    target: () => null,
  },
  // ── 合同汇总册(园区租户租金合同明细汇总):一户一行 = 期限四件套 + 整组计费行 → POST /contracts/import-full。
  //    明细长表出计费行(1:1,按位置聚段)、汇总宽表出期限四件套与 AB 对账;租户匹配/合同新建在后端(全称优先,简称+期兜底);
  //    导入后自动下载到户报告 CSV(逐户:费项数/位置段数/期限/AB 差异/问题 + 后端匹配还是新建) ──
  {
    key: 'contractFull', label: '合同期限+计费行', tag: '合同', icon: 'file-text', context: 'none',
    modalProps: (ctx) => ({
      title: '导入 合同汇总册 · 期限 + 计费行',
      sub: '上传「园区租户租金合同明细汇总」整册(明细/汇总两表):明细表逐费项出计费行,汇总表出租赁期限起止/类型/原文/阶梯价并对账月费用合计;一户一份合同,在册的匹配、不在册的自动建档;期限缺失户标「待人工补」;导入后自动下载到户报告',
      templateCols: CONTRACT_FULL_TEMPLATE_COLS,
      parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => {
        const { rows, report, errors, error } = parseContractWorkbook(sheets)
        ctx._parseErrors = errors.map(e => ({ rowIndex: Math.max(e.rowIndex, 0), label: e.label, reason: e.reason }))
        ctx._cfReport = report
        if (error) return { error }
        if (!rows.length) return { error: '没解析到任何租户行:请确认整册含「明细」「汇总」两表。' }
        return {
          records: rows.map((r, i) => ({ ...r, __preview: [
            r.phase ? `${r.phase}期` : '', r.tenantName, r.tenantFullName, r.buildingHint,
            r.lines.length, report[i]?.detailTotal ?? '', r.startDate ? `${r.startDate}~${r.endDate}` : '待人工补', r.termType ?? '',
          ] })),
        }
      },
    }),
    run: async (payload, ctx) => {
      const rows = payload as unknown as ContractFullRow[]
      const pe = ctx._parseErrors ?? []
      if (!rows.length) return { imported: 0, skipped: pe.length, errors: pe }
      const res = await http.post<{ result: ImportResultDTO; matched: number; created: number
        report: { rowIndex: number; contractNo: string | null; action: string; message: string | null }[] }>(
        '/contracts/import-full', { rows })
      // 到户报告:解析期清点 + 后端匹配结果(rowIndex 与 rows/report 同序)
      const rep = ctx._cfReport ?? []
      if (rep.length) {
        for (const it of res.report) {
          const r = rep[it.rowIndex]
          if (!r) continue
          r.issues = [r.issues, `${it.action === 'created' ? '新建合同' : it.action === 'matched' ? '匹配合同' : '未导入'}${it.contractNo ? ' ' + it.contractNo : ''}`, it.message].filter(Boolean).join(';')
        }
        downloadCsv('合同汇总册到户报告', contractReportCsv(rep))
      }
      const r = res.result
      return { imported: r.imported, skipped: r.skipped + pe.length, errors: [...r.errors, ...pe] }
    },
    target: () => null,
  },
  ...([7, 8] as const).map(no => ({
    key: `charging_${no}`, label: no === 7 ? '汽车充电桩' : '电动车充电桩',
    tag: `附表${no}`, icon: no === 7 ? 'car' : 'bike', context: 'none' as const,
    modalProps: (ctx: ImportCtx) => ({
      title: `导入 附表${no} · 充电桩`,
      sub: '上传/粘贴充电桩损益明细,系统按运营商、按月份识别行,核对后导入',
      templateCols: ['充电桩类别', '记账月', '充电电量', '手续费及服务费', '充电成本'],
      customParse: (matrix: string[][]) => {
        const { records, errors } = importChargingRows(matrix, no, (ctx.cats ?? []) as never)
        ctx._parseErrors = errors.filter(e => e.rowIndex >= 0)
        const headerErr = errors.find(e => e.rowIndex < 0)
        if (headerErr) return { error: headerErr.reason }
        return { records }
      },
    }),
    run: async (payload: ImportRec[] | Pick[], ctx: ImportCtx) => {
      const rows = payload as ImportRec[]
      const res = await chargingApi.importRows(no, { rows: rows as never })
      const pe = ctx._parseErrors ?? []
      return { imported: res.imported, skipped: res.skipped + pe.length, errors: [...res.errors, ...pe] }
    },
    target: () => null,
  })),
  {
    key: 'elec', label: '电费成本', tag: '附表11', icon: 'zap', context: 'none',
    modalProps: () => ({
      title: '导入 附表11 · 电费成本',
      sub: '上传/粘贴电费成本附表(两行表头),系统按(记账期,期)切分,产电量电费 + 大工业基本电费记录,核对后导入',
      templateCols: ['类型', '期', '记账月份', '用电类别/计费需量', '电量', '单价', '税率'],
      customParse: (matrix: string[][]) => importElecRows(matrix),
    }),
    run: async (payload) => {
      const rows = payload as ImportRec[]
      return elecApi.importRows(rows as never)
    },
    target: () => null,
  },
  // ── 园区电费成本模型(ELEC-COST-SPEC §5):长表一行=一表一费项一月,(表,月,费项,拆分)幂等 upsert;
  //    与附表11(上一条 elec)完全独立零改动 ──
  {
    key: 'elecCost', label: '电费成本', tag: '录入', icon: 'zap', context: 'none',
    modalProps: (ctx) => ({
      title: '导入 电费成本 · 总表费项',
      sub: '上传/粘贴电费成本长表(一行=一表一费项一月),按表头识别列;(电表,月份,费项,拆分)重复导入自动覆盖,未知电表/费项逐行报告不整批拦',
      templateCols: ELEC_COST_TEMPLATE_COLS,
      // 行级错误(费项/拆分/月份/金额非法)暂存 ctx,run 时并入结果面板(同 pvMeter 模式);表头识别失败才整批拦
      customParse: (matrix: string[][]) => {
        const { records, errors } = parseElecCostRows(matrix)
        ctx._parseErrors = errors.filter(e => e.rowIndex >= 0)
        const headerErr = errors.find(e => e.rowIndex < 0)
        if (headerErr) return { error: headerErr.reason }
        return { records }
      },
    }),
    // ponytail: 直调端点不经 api/elecCost.ts——该文件归视图域所有,双代理并行互不阻塞;视图域落地后可换 elecCostApi
    run: async (payload, ctx) => {
      const rows = payload as ImportRec[]
      const pe = ctx._parseErrors ?? []
      if (!rows.length) return { imported: 0, skipped: pe.length, errors: pe }
      const res = await http.post<ImportResultDTO>('/elec-cost/import', { rows })
      return { imported: res.imported, skipped: res.skipped + pe.length, errors: [...res.errors, ...pe] }
    },
    target: () => null,
  },
  {
    key: 'salary', label: '工资明细', tag: '附表12', icon: 'wallet', context: 'none',
    modalProps: (ctx) => ({
      title: '导入 附表12 · 工资明细',
      sub: '上传/粘贴整张多月工资表,系统按标题行自动拆月、按姓名识别行,核对年/月后逐月导入',
      templateCols: ['姓名', ...SALARY_COLUMN_MAP.map(c => c.label)],
      columnMap: SALARY_COLUMN_MAP, nameLabels: ['姓名'], sectionTitleRe: SALARY_SECTION_RE,
      defaultYear: ctx.year, defaultMonth: ctx.month ?? 1,
    }),
    run: async (payload, ctx) => {
      const picks = payload as Pick[]
      const agg = zero()
      for (const p of picks) {
        const y = p.year ?? ctx.year!; const m = p.month ?? ctx.month ?? 1
        const res = await salaryApi.importRows(y, m, { rows: p.records as never })
        agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
      }
      return agg
    },
    target: () => null,
  },
  ...([13, 14] as const).map(no => ({
    key: `office_${no}`, label: no === 13 ? '办公水电' : '三期水电',
    tag: `附表${no}`, icon: 'plug', context: 'none' as const,
    modalProps: () => ({
      title: `导入 附表${no} · ${no === 13 ? '办公水电' : '三期水电'}`,
      sub: '上传/粘贴逐月水电表,系统按表头名字识别列、按月份识别行,核对后导入',
      templateCols: ['月份', ...UTILITIES_COLUMN_MAP.map(c => c.label)],
      columnMap: UTILITIES_COLUMN_MAP, nameLabels: ['月份'],
    }),
    run: async (payload: ImportRec[] | Pick[]) => {
      const recs = payload as ImportRec[]
      const byYear = new Map<number, unknown[]>()
      const errors: ImportResultDTO['errors'] = []
      let frontSkipped = 0
      recs.forEach((r, i) => {
        const ym = parseYearMonth(r.tenantName)
        if (!ym) { errors.push({ rowIndex: i, label: String(r.tenantName ?? ''), reason: '无法识别月份' }); frontSkipped++; return }
        const acctMonth = `${ym.year}-${pad2(ym.month)}`
        const bm = parseYearMonth(r.belongMonth, ym.year)
        const belongMonth = bm ? `${bm.year}-${pad2(bm.month)}` : acctMonth
        const arr = byYear.get(ym.year) ?? []
        arr.push({ acctMonth, belongMonth, elecQty: r.elecQty, elecPrice: r.elecPrice, waterQty: r.waterQty, waterPrice: r.waterPrice })
        byYear.set(ym.year, arr)
      })
      const agg: ImportResultDTO = { imported: 0, skipped: frontSkipped, errors }
      for (const rows of byYear.values()) {
        const res = await utilitiesApi.importRows(no, { rows: rows as never })
        agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
      }
      return agg
    },
    target: () => null,
  })),
  {
    key: 'report_is', label: '利润表', tag: '报表', icon: 'trending-up', context: 'ledger',
    modalProps: (ctx) => ({
      title: '导入 利润表',
      sub: `上传/粘贴合并多公司的利润表(两行表头,每公司本月/本年累计两列),按公司拆段、未匹配公司自动新建,导入到 ${ctx.year} 年 ${ctx.month} 月`,
      templateCols: ['行次', '本月金额', '本年累计金额'],
      sheetMatch: /利润表|损益表/,   // 文件上传按名挑 sheet(修只读 sheet 0 缺口),未命中回退第一个
      customParse: (matrix: string[][]) => importIncomeStatement(matrix),
    }),
    // 逐公司段:公司名匹配 management_company、未匹配自动新建 → 聚合成 sections → reportApi.import。
    run: async (payload, ctx) => {
      const picks = payload as Pick[]
      if (!picks.length) return zero()
      const companies = await companyApi.list()
      const byName = new Map(companies.map(c => [c.name.trim(), c.id]))
      const sections: ReportCompanySection[] = []
      for (const p of picks) {
        const name = (p.label ?? '').trim()
        if (!name) continue
        if (!byName.has(name)) {
          const created = await companyApi.create(name)   // 未匹配自动新建
          byName.set(name, created.id)
        }
        const cells: ReportCell[] = []
        for (const r of p.records) {
          const rowKey = String(r.rowKey)
          cells.push({ rowKey, field: 'cur', amount: Number(r.cur) || 0 })
          cells.push({ rowKey, field: 'ytd', amount: Number(r.ytd) || 0 })
        }
        sections.push({ companyName: name, cells })
      }
      return reportApi.import('is', ctx.year!, ctx.month!, { sections })
    },
    target: (ctx) => `${ctx.year}-${pad2(ctx.month!)}`,
  },
  {
    key: 'report_bs', label: '资产负债表', tag: '报表', icon: 'scale', context: 'ledger',
    modalProps: (ctx) => ({
      title: '导入 资产负债表',
      sub: `上传/粘贴两栏合并多公司的资产负债表(资产‖负债和所有者权益,每公司一列期末余额),按公司拆段、未匹配公司自动新建,导入到 ${ctx.year} 年 ${ctx.month} 月`,
      templateCols: ['行次', '期末余额'],
      sheetMatch: /资产负债表/,   // 文件上传按名挑 sheet(修只读 sheet 0 缺口),未命中回退第一个
      customParse: (matrix: string[][]) => importBalanceSheet(matrix),
    }),
    // 逐公司段:同 report_is,cells 为单列 field='end';文件合计行已被解析器丢弃(客端重算)。
    run: async (payload, ctx) => {
      const picks = payload as Pick[]
      if (!picks.length) return zero()
      const companies = await companyApi.list()
      const byName = new Map(companies.map(c => [c.name.trim(), c.id]))
      const sections: ReportCompanySection[] = []
      for (const p of picks) {
        const name = (p.label ?? '').trim()
        if (!name) continue
        if (!byName.has(name)) {
          const created = await companyApi.create(name)   // 未匹配自动新建
          byName.set(name, created.id)
        }
        const cells: ReportCell[] = p.records.map(r => ({
          rowKey: String(r.rowKey), field: 'end', amount: Number(r.end) || 0,
        }))
        sections.push({ companyName: name, cells })
      }
      return reportApi.import('bs', ctx.year!, ctx.month!, { sections })
    },
    target: (ctx) => `${ctx.year}-${pad2(ctx.month!)} · 资产负债表`,
  },
  {
    key: 'report_tb', label: '科目余额表', tag: '报表', icon: 'table-2', context: 'ledger',
    modalProps: (ctx) => ({
      title: '导入 科目余额表',
      sub: `上传整本工作簿(每张「余额表」sheet=一家公司,缩进型/代码型版式均可),按 sheet 拆段、未匹配公司自动新建,导入到 ${ctx.year} 年 ${ctx.month} 月`,
      templateCols: ['科目代码', '科目名称', ...TB_FIELDS.map(f => f.label)],
      parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => importTrialBalance(sheets),
    }),
    // 逐段:公司名匹配/未匹配自动新建 → sections=[{companyName, accounts, cells(8字段展开,0 不落库)}] → 一次 import 聚合。
    run: async (payload, ctx) => {
      const picks = payload as Pick[]
      if (!picks.length) return zero()
      const companies = await companyApi.list()
      const byName = new Map(companies.map(c => [c.name.trim(), c.id]))
      const sections: ReportCompanySection[] = []
      for (const p of picks) {
        const name = (p.label ?? '').trim()
        if (!name) continue
        if (!byName.has(name)) {
          const created = await companyApi.create(name)   // 未匹配自动新建
          byName.set(name, created.id)
        }
        const accounts: ReportAccount[] = []
        const cells: ReportCell[] = []
        for (const r of p.records) {
          const account = r.account as ReportAccount
          const amounts = r.amounts as Record<string, number>
          accounts.push(account)
          for (const f of TB_FIELDS) {
            const v = Number(amounts?.[f.key]) || 0
            if (v !== 0) cells.push({ rowKey: account.rowKey, field: f.key, amount: v })
          }
        }
        sections.push({ companyName: name, accounts, cells })
      }
      return reportApi.import('tb', ctx.year!, ctx.month!, { sections })
    },
    target: (ctx) => `${ctx.year}-${pad2(ctx.month!)} · 科目余额表`,
  },
  // ── 损益附表 1–5(P2-D):5 条同构由 PNL_SCHEDULES 生成;年从标题自动识,识别失败回退屏当前年槽(ctx.year) ──
  ...PNL_SCHEDULES.map((config, i) => ({
    key: `pnl_${config.schedule}`, label: config.title, tag: '报表',
    icon: ['trending-up', 'zap', 'droplets', 'wrench', 'banknote'][i], context: 'none' as const,
    modalProps: () => ({
      title: '导入 ' + config.title,
      sub: '从年度统计母册导入该附表(整年替换);上传含该 sheet 的工作簿或粘贴该表,年份从标题自动识别',
      templateCols: [config.groupCol, '科目细分', ...Array.from({ length: 12 }, (_, m) => `${m + 1}月`), '备注'],
      sheetMatch: config.sheetRe,
      customParse: (matrix: string[][]) => {
        const r = importPnlSchedule(matrix)
        if (r.error) return { error: r.error }
        // __yearDetected 随行携带识别年(run 取首行);__preview 供预览表(emit 前被剥)
        return {
          records: r.rows.map(row => ({
            ...row, __yearDetected: r.year,
            __preview: [row.groupLabel, row.label, ...row.m.map(v => v ?? ''), row.note ?? ''],
          })),
        }
      },
    }),
    // __usedYear 回传实际落库年,屏据此在识别年 ≠ 当前年时切年
    run: async (payload: ImportRec[] | Pick[], ctx: ImportCtx) => {
      const rows = payload as ImportRec[]
      const y = (rows[0]?.__yearDetected as number | null) ?? ctx.year!
      const clean = rows.map(r => { const { __yearDetected, ...rest } = r; void __yearDetected; return rest })
      const res = await pnlApi.import(config.schedule, y, { rows: clean as never })
      return Object.assign(res, { __usedYear: y })
    },
    target: (ctx: ImportCtx) => `${ctx.year ?? ''} · ${config.title}`,
  })),
  // ── 年度预算(P3-P1 预算对比):解析规则见 importBudget.ts 头注释;确认屏按年分段,run 聚合整包一次导入 ──
  {
    key: 'budget', label: '年度预算', tag: '预算', icon: 'target', context: 'none',
    modalProps: () => {
      prefetchBudgetPnlRevenue()
      return {
        title: '导入 年度预算',
        sub: '上传含「全面预算总表」的预算工作簿(或粘贴该表),按年拆段核对后导入;2025 起发生额列以系统损益推算为准,自动跳过',
        templateCols: ['项目', 'YYYY年发生额(可多列)', 'YYYY年预算', '备注'],
        sheetMatch: BUDGET_SHEET_RE,
        parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => importBudget(sheets, budgetPnlRevenue),
      }
    },
    // 勾选段(年)平铺成单 payload:后端按 payload 内出现的 year 整年替换
    run: async (payload) => {
      const rows = (payload as Pick[]).flatMap(p => p.records)
      if (!rows.length) return zero()
      return budgetApi.import({ rows: rows as never })
    },
    target: () => null,
  },
]

// 各屏用:取该类型的解析配置(= modalProps 去掉 title/sub/defaults),屏自己给 :title/:sub/:default-*。
// 单一事实源:columnMap/customParse/phaseLayouts/nameLabels/templateCols 都出自这里,屏不再本地重复。
export function parserProps(key: string, ctx: ImportCtx = {}): { templateCols: string[] } & Record<string, unknown> {
  const entry = IMPORT_TYPES.find(t => t.key === key)
  if (!entry) throw new Error('unknown import type: ' + key)
  const { title, sub, defaultYear, defaultMonth, defaultPhase, ...parser } = entry.modalProps(ctx)
  void title; void sub; void defaultYear; void defaultMonth; void defaultPhase
  return parser as { templateCols: string[] } & Record<string, unknown>
}

// 唯一导入入口:执行 entry.run → 上报 import_log(best-effort,失败不阻断) → 返回 result。
export async function runImport(
  key: string, payload: ImportRec[] | Pick[], ctx: ImportCtx, fileName: string,
): Promise<ImportResultDTO> {
  const entry = IMPORT_TYPES.find(t => t.key === key)
  if (!entry) throw new Error('unknown import type: ' + key)
  const res = await entry.run(payload, ctx)
  // 有行入库即让分析层缓存整体失效:空态→去导入→回分析屏立即见新数据(复审:缓存陈旧闭环)
  if (res.imported > 0) invalidateAnaCache()
  try {
    await importLogApi.record({
      dataType: entry.key, typeLabel: entry.label, fileName: fileName || '（粘贴）',
      target: entry.target(ctx),
      rows: res.imported + res.skipped + res.errors.length,
      ok: res.imported, warn: res.skipped + res.errors.length, status: deriveStatus(res),
    })
  } catch (e) { console.warn('[import-log] 记录失败(不影响导入):', e) }
  return res
}
