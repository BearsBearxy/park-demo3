// 导入类型单一事实源(registry)+ runImport 记录链。
// 各屏与导入中心 hub 都从这里取「解析配置(modalProps/parserProps) + 执行(runImport)」,导入后统一上报 import_log;
// 全部屏均经 parserProps()/runImport() 消费本 registry,屏内不得再写列映射。
// 台账/附表10 列匹配已模板化(BOOK-WORKBENCH-SPEC):ctx.bookDef/bookDefs 给定即以账册现行版为准,静态表仅作回退。
import { flattenCols, type BookDef } from '../types/book'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { addResult, failKind, failReason, type ImportRunProgress } from '@/components/import/importRun'
import type { ImportLogDTO } from '@/types/importLog'
import { periodLink } from '@/nav/deepLink'
// 各域「导入行」契约:以前 run() 一律 `as never` 上抛,后端契约的键名一次都没被编译器对过(P5-5)
import { overwriteTargets, type LedgerImportRow } from '@/types/ledger'
import type { S10ImportRow, S10Fees } from '@/types/s10'
import type { PvImportRow } from '@/types/pv'
import type { ChargingImportRow } from '@/types/charging'
import type { ElecImportRow } from '@/types/elec'
import type { SalaryImportRow } from '@/types/salary'
import type { OfficeImportRow } from '@/types/utilities'
import type { PnlRowDTO } from '@/types/pnl'
import type { BudgetImportRow } from '@/api/budget'
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
import { useAuthStore } from '@/stores/auth'
import { importBudget, BUDGET_SHEET_RE } from '@/utils/importBudget'
import { PNL_SOT_FROM_YEAR } from '@/analysis/budget'
import { fetchPnlSummary, invalidateAnaCache } from '@/analysis/anaData'
import { importChargingRows, type ChargingCatLite } from '@/utils/importChargingRows'
import { parsePvMeterRows } from '@/utils/pvMeterExcel'
import { parseCpMeterRows } from '@/utils/cpMeterExcel'
import { parseMeterWorkbook, resolveZones, METER_TEMPLATE_COLS, METER_KIND_LABEL } from '@/utils/meterExcel'
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
import { matchByHeader, isGarbageTenantName, type BadRow, type ColumnMapEntry } from '@/utils/importHeaderMatch'
import { FEE_KEYS, lgColumns } from '@/utils/ledgerColumns'
import { PHASE_LAYOUT, leavesOf } from '@/views/sales-income/layout'

// ── 解析工具/常量(临时复制自各屏,T5 dedup 时归并) ─────────────
const pad2 = (m: number) => String(m).padStart(2, '0')
const ymOf = (y: number, m: number) => `${y}-${pad2(m)}`
// 导入写口一律不出底部全局提示:失败原因由导入弹窗的失败卡写(UI-OVERLAY-SPEC §8)
const SILENT = { silentNetError: true }

// key 收紧到 SalaryImportRow 的字段名:改后端契约字段名时这张表直接编译失败,不再静默丢列
const SALARY_COLUMN_MAP: (ColumnMapEntry & { key: Exclude<keyof SalaryImportRow, 'tenantName'> })[] = [
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
export const UTILITIES_COLUMN_MAP = [
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
// 上月结余列的别名全集:源册跨月/跨公司写法不一(「9月结余」「上月应收结余」…),
// 而列语义恒为 balancePrev。主 label 用当月动态标签,其余 11 个月份写法与文字变体全进别名——
// 靠忽略清单绕过会让期初值静默丢失(历史月未补时那是唯一入口,2026-08-25 拍板)。
function balancePrevEntry(prevMonth: number | null): ColumnMapEntry {
  const label = prevMonth != null ? prevMonth + '月结余' : '上月结余'
  const aliases = ['上月结余', '上月应收结余', '上期结余', '期初余额', '上月余额']
  for (let m = 1; m <= 12; m++) {
    aliases.push(`${m}月结余`, `${m}月应收结余`)
  }
  return { label, key: 'balancePrev', aliases: aliases.filter(a => a !== label) }
}

// 模板驱动词典(§3 现行版全局生效):列=模板全列(含 hidden,导入仍认),别名随模板;结余/收款/备注照旧追加。
// 结余链(2026-08-25 修订):上月结余照常匹配上送——**吃不吃由后端按链上位置定**
// (租户首现月=期初照收;非首现=派生位忽略)。前端不做业务判定,否则历史月没补时结余全空。
function ledgerColumnMapFromDef(def: BookDef, prevMonth: number | null): ColumnMapEntry[] {
  return [
    ...flattenCols(def).map(c => ({ label: c.label, key: c.id, aliases: c.aliases.length ? c.aliases : undefined })),
    balancePrevEntry(prevMonth),
    { label: '本月收款', key: 'totalCollected' },
    { label: '备注', key: 'note', text: true },
  ]
}
// 派生/装饰列:未匹配也不值得打扰用户(应收合计/本月结余/本月应收款是系统算的,序号/合计是装饰;
// 数字样表头是脏单元格)。注意「N月结余」不在此列——它是 balancePrev 的动态标签,要匹配不要忽略。
const LEDGER_UNMATCHED_IGNORE_RE = /应收合计|本月结余|本月应收款|^序号|合计|^小计|^总计/

function ledgerColumnMap(prevMonth: number | null): ColumnMapEntry[] {
  const labelByKey: Record<string, string> = {}
  for (const g of lgColumns(0).groups) for (const c of g.cols) labelByKey[c.key] = c.label
  return [
    ...FEE_KEYS.map(k => ({ label: labelByKey[k], key: k as string, aliases: LEDGER_ALIASES[k] })),
    // balancePrev 主 label 动态单标签(模板列不双列诱导,复审①);变体走别名只参与匹配
    balancePrevEntry(prevMonth),
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
function parseLedgerSheet(matrix: string[][], ctxPrev: number | null, sheetName: string, companyNames?: string[], def?: BookDef | null) {
  let ym: { year: number; month: number } | undefined
  for (const row of matrix.slice(0, 3)) {
    for (const c of row) {
      const m = LEDGER_TITLE_YM_RE.exec(String(c ?? ''))
      if (m) { ym = { year: +m[1], month: +m[2] }; break }
    }
    if (ym) break
  }
  const prevOfSheet = ym ? (ym.month === 1 ? 12 : ym.month - 1) : ctxPrev
  const columnMap = def ? ledgerColumnMapFromDef(def, prevOfSheet) : ledgerColumnMap(prevOfSheet)
  const res = matchByHeader(matrix, columnMap, ['租户'], undefined,
    { skipName: isGarbageTenantName, keepUnmatched: true })   // 垃圾行过滤(规范§九 v4);§4 未匹配列上浮
  if (res.error || !res.records.length) return { records: [] as ImportRec[], error: res.error, ym, company: undefined as string | undefined, unmatched: res.unmatched ?? [] }
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
  return { records, error: undefined as string | undefined, ym, company, unmatched: res.unmatched ?? [] }
}

// 少一张损益附表查看权:预算这次不拿损益收入合计核对,核对页的提示条上说(RBAC §15.7)
const BUDGET_NO_PNL = '有的损益附表你看不了，这次导入不拿它们的收入合计核对预算。'

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
let meterTenants: { id: number; companyName: string; aliases?: string | null }[] | null = null
let meterBuildings: { id: number; name: string }[] | null = null
function prefetchMeterMaster(): void {
  void tenantApi.list().then(v => { meterTenants = v.map(t => ({ id: t.id, companyName: t.companyName, aliases: t.aliases })) }).catch(() => {})
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
// companyId:台账整册 / 三大报表的 run 认完(或新建完)公司写回这一段,target 据此记「导到哪家」
type Pick = { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[]; companyId?: number }

/** 导入中心的五组(照 ix-v2-main,组名同侧栏分组) */
export type ImportGroup = '出账 · 每月工序' | '记账 · 按月' | '记账 · 按年' | '账簿与报表' | '档案'
/** 一条导入记录「导到哪」(import_log 的结构列):期 = 月 2026-09 / 日 2026-10-01 / 年 2026;不按期的(合同)全空。
 *  zone:抄表 / 附表6 / 附表11 是 p1/p2/p3/dorm,附表10 是期区号 1..4 */
export interface ImportTarget { periodFrom: string | null; periodTo: string | null; companyId: number | null; zone: string | null }
/** 「去看」深链(periodLink 的形状) */
export type ImportViewLink = { path: string; query: Record<string, string> }

const T = (o: Partial<ImportTarget> = {}): ImportTarget => ({ periodFrom: null, periodTo: null, companyId: null, zone: null, ...o })
// 一串同格式的期 → 起止(月 / 日 / 年串按字典序比就是按时间比)
const span = (ps: (string | null | undefined)[]): Partial<ImportTarget> => {
  const s = ps.filter((p): p is string => !!p).sort()
  return s.length ? { periodFrom: s[0], periodTo: s[s.length - 1] } : {}
}
const one = (p: string | null): Partial<ImportTarget> => ({ periodFrom: p, periodTo: p })
const ctxYm = (ctx: ImportCtx) => (ctx.year && ctx.month ? ymOf(ctx.year, ctx.month) : null)
// 平铺 / 勾选段两种 payload 都摊成行
const recsOf = (payload?: ImportRec[] | Pick[]): ImportRec[] =>
  (payload ?? []).flatMap(p => (Array.isArray((p as Pick).records) ? (p as Pick).records : [p as ImportRec]))
// 一次请求写几个期区(抄表 / 附表6 / 附表11):按期区分组(首现序),每组一个落点
function byZone(recs: ImportRec[], zoneOf: (r: ImportRec) => unknown, periodOf: (r: ImportRec) => unknown): ImportTarget[] {
  const g = new Map<string, string[]>()
  for (const r of recs) { const z = String(zoneOf(r) ?? ''); g.set(z, [...(g.get(z) ?? []), String(periodOf(r) ?? '')]) }
  return [...g].map(([zone, ps]) => T({ zone: zone || null, ...span(ps) }))
}
// 同一请求的结果按行号拆回各期区(顺序同 byZone),报给 runImport 一段一条导入记录。
// 这几个后端写口 skipped = errors 条数、每行要么写进去要么有一条 error,所以一段写入数 = 段行数 − 段 error 数。
function splitByZone(ctx: ImportCtx, res: ImportResultDTO, zones: unknown[]): void {
  const keys = zones.map(z => String(z ?? ''))
  const order = [...new Set(keys)]
  if (!ctx._seg || order.length < 2) return
  order.forEach((k, i) => {
    const errors = res.errors.filter(e => keys[e.rowIndex] === k)
    ctx._seg!(i, { imported: keys.filter(x => x === k).length - errors.length, skipped: errors.length, errors })
  })
}
// 三大报表一次请求写几家公司:后端 errors 的行号是段号(那家整段没导),其余段写入数 = 该段的格数
function splitByCompany(ctx: ImportCtx, res: ImportResultDTO, sections: ReportCompanySection[]): void {
  if (!ctx._seg || sections.length < 2) return
  sections.forEach((s, i) => {
    const errors = res.errors.filter(e => e.rowIndex === i)
    ctx._seg!(i, errors.length ? { imported: 0, skipped: errors.length, errors } : { imported: s.cells.length, skipped: 0, errors: [] })
  })
}
// 三大报表:有公司名的段才发(run 里 `if (!name) continue`),target 用同一个过滤保持段号对齐
const namedPicks = (picks?: ImportRec[] | Pick[]) => ((picks ?? []) as Pick[]).filter(p => (p.label ?? '').trim())
// 「去看」:被拒的记录没有去看;期取年 / 取月
const live = (l: ImportLogDTO) => l.status !== 'rejected'
const y4 = (p?: string | null) => p?.slice(0, 4)
const ym7 = (p?: string | null) => (p && p.length >= 7 ? p.slice(0, 7) : undefined)

// ctx:hub 每次导入创建一个,同一引用同时传给 modalProps 与 run(charging 用它在解析期暂存 parseErrors)
export interface ImportCtx {
  companyId?: number; companyName?: string; year?: number; month?: number
  companyNames?: string[]   // 已有管理公司名单(台账整册拆段的 sheet 名识别用)
  tenantNames?: string[]                      // 租户库 companyName 全量(meter §6.2 拆分;视图填,同 companyNames 机制)
  buildings?: { id: number; name: string }[]  // 楼栋清单(meter §6.3 区域→楼栋映射;视图填,BuildingDTO 结构兼容)
  zones?: { code: string; name: string }[]    // 期区清单(meter sheet 名反查用;视图填,ZoneDTO 结构兼容;缺省回落 meterExcel 写死三区)
  cats?: ChargingCatLite[]   // 充电桩运营商字典(视图填 ChargingCatDTO[],结构兼容)
  // ── 账册模板(BOOK-WORKBENCH-SPEC):视图填,缺省走静态 lgColumns/layout.ts 回退 ──
  bookDef?: BookDef                            // 台账:当前账册现行版定义(列匹配以它为准,含 hidden)
  bookDefs?: Partial<Record<number, BookDef>>  // 附表10:phase→现行版定义(office=1∪4,factory=2∪3 取并集)
  // §4 禁静默丢列:台账通路发现未匹配列时回调视图弹「列匹配面板」;
  // 视图负责持久化决策(加别名/新建列走 saveTemplate)后返回更新后的 def 与本次忽略清单;null=用户取消。
  // 不给回调(导入中心等无面板宿主)→ 未匹配列直接整批拦,报错指去台账页处置。
  resolveUnmatched?: (unmatched: { header: string; sample?: string }[]) => Promise<{ def: BookDef; ignore: string[] } | null>
  _bfReport?: BillingReportRow[]   // 计费字段导入:解析期到户报告,导入成功后落 CSV(裁定⑤)
  _cfReport?: ContractReportRow[]  // 合同汇总册导入:解析期到户报告(与 rows 同序),导入后并入后端匹配结果落 CSV
  // 导入弹窗的进度回调(components/import/importRun.ts 协议):附表10 逐段 —— 从 _run.from 段起发,每段写完报一次
  _run?: ImportRunProgress
  // 逐段导入每段发之前问一次还能不能写(附表10 传 () => edit):false = 已失锁(被接管 / 授权到期),停下不再发
  _alive?: () => boolean
  // runImport 自己挂的:run 每写完一个落点(target 里第 k 个)报一次结果,一个落点记一条导入记录。
  // 逐段 / 逐月 / 逐年 / 逐公司发请求的在每次请求后报;一次请求写几个期区 / 公司的按行号拆好再报;只有一个落点的不用报
  _seg?: (k: number, res: ImportResultDTO) => void
}
export interface ImportTypeEntry {
  key: string; icon: string
  group: ImportGroup
  /** 名字(跟侧栏):导入中心行名、弹窗标题、导入记录的 typeLabel */
  name: string
  /** 导入中心清单行名下面那句(照 ix-v2-main) */
  desc: string
  /** 导入弹窗标题下面那句(照 md-v2-copy;落点是某屏里另一本账的,句尾带「，导进 X」) */
  sub: string
  /** 「文件要长这样」下面的规矩,一条一行 */
  rules: string[]
  /** 「文件要长这样」小样表:表头 + 两行示例 */
  sample: { head: string[]; rows: string[][] }
  /** 导完「去 X 看」的 X */
  landing: string
  /** 计数单位:导入 N 行 / 覆盖 N 家 / 导入 N 块表 / 合同按户 */
  unit: '行' | '户' | '家' | '段' | '块表'
  // 该类导入写进的那一屏的写权(任一即可;RBAC-SPEC §15.7:权限挂在 import kind 上,不挂导入中心这个屏)。
  // 取值须与后端写规则表对同一条 path 的判定一致 —— 前端只管磁贴显不显示,后端才是边界。
  module: readonly string[]
  // templateCols 为 FpImportModal 必填项,收紧类型让 v-bind 展开处可静态校验(标题、sub 不在这里:parserProps 用 name / sub 拼)
  modalProps: (ctx: ImportCtx) => { templateCols: string[] } & Record<string, unknown>
  // fileName:runImport 透传的文件名(粘贴为「（粘贴）」);目前只有抄表导入把它交给后端(进档案变更记录)
  run: (payload: ImportRec[] | Pick[], ctx: ImportCtx, fileName?: string) => Promise<ImportResultDTO>
  /** 导到哪:一个落点一条(附表10 每段、工资每月、水电每年、台账整册每家每月;抄表 / 附表6 / 附表11 每个期区;三大报表每家公司)。
   *  runImport 在 run 之后调(台账、报表的公司 id 那时才认完),顺序与 ctx._seg 的 k 对齐 */
  target: (ctx: ImportCtx, picks?: ImportRec[] | Pick[]) => ImportTarget[]
  /** 导入记录的「去看」:用各屏已认的深链参数;旧记录没有结构列、被拒的记录 → null */
  viewLink: (log: ImportLogDTO) => ImportViewLink | null
  /** 只有台账:进核对页时问一次 —— 文件标题写的月份(fileYm,YYYY-MM)、要导到的那个月已有几家会被盖掉(existing);
   *  分段台账两样都不给(同改前不预检) */
  precheck?: (ctx: ImportCtx, parsed: { records?: ImportRec[] }) => Promise<{ fileYm?: string; existing?: number }>
}

// 一行没写进去、又有没导的 = 被拒;一行没写、也没有没导的(如科目余额表某家期末全为 0,cells 被滤空)不算被拒
export function deriveStatus(res: ImportResultDTO): ImportStatus {
  const warn = res.skipped + res.errors.length
  if (res.imported === 0 && warn > 0) return 'rejected'
  return warn > 0 ? 'partial' : 'complete'
}

// 空聚合器
const zero = (): ImportResultDTO => ({ imported: 0, skipped: 0, errors: [] })

// 三大报表:公司核对完(进度卡「核对公司 · 新建 n 家」,走到「写入」那步)再写。
// 开跑前自动新建的公司是单独的请求,写入被整单拒(审核闸等)时不会跟着回滚 ——
// 告诉导入弹窗的失败卡多写一句(UI-OVERLAY-SPEC §8「新建的 N 家公司已留下」)
async function keptOnFail<T>(ctx: ImportCtx, made: number, fn: () => Promise<T>): Promise<T> {
  ctx._run?.note('核对公司', `新建 ${made} 家`)
  ctx._run?.stage('写入')
  try { return await fn() } catch (e) {
    if (made > 0) ctx._run?.kept(`新建的 ${made} 家公司已留下`)
    throw e
  }
}

// ── ImportRec → 各域导入行 DTO(P5-5)───────────────────────
// 解析器产出的 ImportRec 是 `[k: string]: unknown` 袋子,以前一律 `as never` 上抛 —— 等于把整个后端契约
// 的键名校验关掉:改一个 DTO 字段名编译器不吭声,导入就静默丢那一列。这里逐键搬进 DTO,键名交给编译器对。
// 值一律直接断言、不做 Number()/String() 转换:解析器已把类型定形,再转一遍会把 undefined 变成 NaN,
// 线上 JSON 形状就变了(undefined 被 JSON.stringify 丢掉,NaN 却序列化成 null)。
// DTO 里可选的键即使源上没有也照列:值是 undefined,序列化时自然消失,与「键根本不出现」等价。

// 台账:列级定向 upsert,文件没有的列必须「键不出现」(出现即被后端当显式清零),故逐键判 undefined。
// 顺带把 __ 前缀内部键(__ymDetected/__company/__ym)挡在外面。
const toLedgerRow = (r: ImportRec): LedgerImportRow => {
  const row: LedgerImportRow = { tenantName: String(r.tenantName) }
  for (const k of FEE_KEYS) if (r[k] !== undefined) row[k] = r[k] as number
  // 结余:照常上送——后端按链上位置定夺(首现月=期初收下,非首现=派生位忽略)
  if (r.balancePrev !== undefined) row.balancePrev = r.balancePrev as number
  if (r.totalCollected !== undefined) row.totalCollected = r.totalCollected as number
  if (r.note !== undefined) row.note = r.note as string
  // 自定义列(方案A §4):c_ 键收进口袋,键出现=覆盖(含显式0),缺席=不动
  const extras: Record<string, number> = {}
  for (const k of Object.keys(r)) if (k.startsWith('c_') && r[k] !== undefined) extras[k] = r[k] as number
  if (Object.keys(extras).length) row.extraFees = extras
  return row
}

const toPvRow = (r: ImportRec): PvImportRow => ({
  phaseId: r.phaseId as string, acctMonth: r.acctMonth as string, occurMonth: r.occurMonth as string,
  selfKwh: r.selfKwh as number, selfAmt: r.selfAmt as number,
  gridKwh: r.gridKwh as number, gridAmt: r.gridAmt as number, note: r.note as string | undefined,
})

const toChargingRow = (r: ImportRec): ChargingImportRow => ({
  cat: r.cat as string, acctMonth: r.acctMonth as string,
  kwh: r.kwh as number, fee: r.fee as number, cost: r.cost as number, note: r.note as string | null,
})

// energy / basic 两形态共用一个搬运:各自没有的键取到 undefined,序列化后消失
const toElecRow = (r: ImportRec): ElecImportRow => ({
  type: r.type as 'energy' | 'basic', phaseId: r.phaseId as string, acctMonth: r.acctMonth as string,
  invDate: r.invDate as string | null, period: r.period as string | null,
  cat: r.cat as string | null, unit: r.unit as string | null,
  qty: r.qty as number | null, demand: r.demand as number | null,
  price: r.price as number, rate: r.rate as number, note: r.note as string | null,
})

// 工资:列集就是 SALARY_COLUMN_MAP(其 key 已收紧成 SalaryImportRow 字段名),不另抄一份字段清单
const toSalaryRow = (r: ImportRec): SalaryImportRow => {
  const row: SalaryImportRow = { tenantName: String(r.tenantName) }
  for (const c of SALARY_COLUMN_MAP) {
    if (r[c.key] === undefined) continue
    if (c.key === 'role') row.role = r.role as string
    else row[c.key] = r[c.key] as number
  }
  return row
}

const toPnlRow = (r: ImportRec): PnlRowDTO => ({
  rowKey: r.rowKey as string, groupLabel: r.groupLabel as string, label: r.label as string,
  kind: r.kind as PnlRowDTO['kind'], note: r.note as string | null,
  m: r.m as (number | null)[], sortOrder: r.sortOrder as number,
})

const toBudgetRow = (r: ImportRec): BudgetImportRow => ({
  year: r.year as number, label: r.label as string, sub: r.sub as boolean, sortOrder: r.sortOrder as number,
  budget: r.budget as number | undefined, actual: r.actual as number | undefined, note: r.note as string | undefined,
})

// 到户报告落盘(计费行/合同汇总册共用)
function downloadCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// 损益附表 1–5 在侧栏的名字(fpNav.ts「损益附表」那一组)
const PNL_NAV_LABEL = ['附表1 租金损益', '附表2 用电损益', '附表3 用水损益', '附表4 运管损益', '附表5 费用支出']

// 光伏 / 充电桩抄表:「文件要长这样」小样表和核对页用同一行表头(下载模板仍用 *_TEMPLATE_COLS 那份带括号单位的)
const PV_METER_HEAD = ['期数', '楼栋', '日期', '发电总量 kWh', '自消纳 kWh', '上网 kWh', '备注']
const CP_METER_HEAD = ['运营商', '桩名', '日期', '充电量 kWh', '手续费 元', '收益 元', '备注']

// 导入中心清单的组内顺序(照 ix-v2-main):出账 · 每月工序 / 记账 · 按月 / 记账 · 按年 / 账簿与报表 / 档案
const ORDER = ['meter', 'pvMeter', 'cpMeter', 'ledger', 's10', 'salary', 'pv', 'charging_7', 'charging_8', 'elec', 'elecCost',
  'office_13', 'office_14', 'report_is', 'report_bs', 'report_tb', 'pnl_s1', 'pnl_s2', 'pnl_s3', 'pnl_s4', 'pnl_s5', 'budget',
  'contractFull', 'billingTerms']

// 办公 / 三期水电:解析时已把月份认成 acctMonth / belongMonth;逐年一次请求(target 与 run 共用这一份分组,段号对齐)
function officeByYear(recs: ImportRec[]): OfficeImportRow[][] {
  const by = new Map<string, OfficeImportRow[]>()
  for (const r of recs) {
    const y = String(r.acctMonth).slice(0, 4)
    by.set(y, [...(by.get(y) ?? []), { acctMonth: r.acctMonth as string, belongMonth: r.belongMonth as string,
      elecQty: r.elecQty as number, elecPrice: r.elecPrice as number, waterQty: r.waterQty as number, waterPrice: r.waterPrice as number }])
  }
  return [...by.values()]
}

const TYPES: ImportTypeEntry[] = [
  {
    key: 'ledger', icon: 'book-open', module: ['ledger:edit'],
    group: '记账 · 按月', name: '月度台账', desc: '各公司收款台账，先选公司', sub: '一家公司一个月的收款台账',
    rules: ['按表头名字认列，先后不要紧', '合计行、应收合计、本月结余这些系统算的列自动跳过', '同公司同月再导，文件里有的列盖掉旧数'],
    sample: { head: ['租户', '8月结余', '厂房租金', '厂房企业管理服务费', '基准电费', '基准水费', '本月收款', '备注'], rows: [
      ['恒毅', '0', '60,000', '8,250', '6,120', '1,880', '76,250', ''],
      ['叙丰', '12,400', '30,000', '4,100', '3,600', '1,200', '30,000', ''],
    ] },
    landing: '月度台账', unit: '家',
    modalProps: (ctx) => {
      const prev = ctx.month ? (ctx.month === 1 ? 12 : ctx.month - 1) : null
      // §3 现行版全局生效:弹窗「模板列顺序」与确认屏预览列序都跟账册现行版;无 def 才退静态种子表
      const columnMap = ctx.bookDef ? ledgerColumnMapFromDef(ctx.bookDef, prev) : ledgerColumnMap(prev)
      return {
        templateCols: ['租户', ...columnMap.map(c => c.label)],
        // 整册多 sheet 拆段(规范§二;粘贴路径被 FpImportModal 包装为单 sheet,语义同旧 customParse)
        // v3:每 sheet 先按块起点切分(同 sheet 多月纵向堆叠,规范§五),每块作虚拟 sheet 原样解析
        parseWorkbook: async (sheets: { name: string; matrix: string[][] }[]) => {
          const parseAll = (def: BookDef | null) => sheets.flatMap(s =>
            splitLedgerBlocks(s.matrix).map(block => parseLedgerSheet(block, prev, s.name, ctx.companyNames, def)))
          let def = ctx.bookDef ?? null
          let parsed = parseAll(def)
          // §4 禁静默丢列:全册未匹配表头并集(剔除派生/装饰列)→ 有面板宿主就地处置,没有则整批拦
          const collect = (ps: typeof parsed) => {
            const seen = new Map<string, string | undefined>()
            for (const p of ps) for (const u of p.unmatched)
              if (!LEDGER_UNMATCHED_IGNORE_RE.test(u.header) && !isNumericLike(u.header) && !seen.has(u.header))
                seen.set(u.header, undefined)
            return [...seen.keys()]
          }
          let warning: string | undefined
          const pending = collect(parsed)
          if (pending.length) {
            if (!ctx.resolveUnmatched) return { error: `${pending.length} 个表头未匹配任何列:${pending.join('、')}。台账导入不丢列——请到「月度台账」页导入以当场处置,或先在打开「账册模板」为这些表头添加别名/自定义列。` }
            const dec = await ctx.resolveUnmatched(pending.map(h => ({ header: h })))
            if (!dec) return { error: '导入已取消:存在未处置的未匹配列。' }
            def = dec.def
            parsed = parseAll(def)
            // §4 出口③:显式忽略的列必须留痕,不许就地蒸发(审查#23)
            const notes: string[] = []
            if (dec.ignore.length) notes.push(`按「忽略」处理未导入:${dec.ignore.join('、')}`)
            const left = collect(parsed).filter(h => !dec.ignore.includes(h))
            if (left.length) notes.push(`仍未匹配已跳过:${left.join('、')}`)
            if (notes.length) warning = notes.join(';')
          }
          // §3:命中隐藏列要提示(值入库但表格不显示,不静默——审查#20/#27)
          if (def) {
            const hiddenById = new Map(flattenCols(def).filter(c => c.hidden).map(c => [c.id, c.label]))
            if (hiddenById.size) {
              const hit = new Set<string>()
              for (const p of parsed) for (const r of p.records)
                for (const id of hiddenById.keys()) if (r[id] !== undefined) hit.add(hiddenById.get(id)!)
              if (hit.size) warning = (warning ? warning + ';' : '')
                + `命中隐藏列:${[...hit].join('、')} —— 值已入库,当前表格不显示(编辑模板可取消隐藏)`
            }
          }
          const withRecords = parsed.filter(p => p.records.length)
          if (!withRecords.length) return { error: parsed.find(p => p.error)?.error ?? '已读取数据,但没识别到任何有效记录。' }
          // 有记录的 sheet 仅 1 个 → 平铺(现有预检/双 confirm 流程不变),识别年月照旧挂行
          if (withRecords.length === 1) {
            const p = withRecords[0]
            if (p.ym) for (const r of p.records) r.__ymDetected = p.ym
            return { records: p.records, warning }
          }
          // ≥2 个 → 拆段:records 各自携带 __company/__ym(run 逐段落库),label 供确认屏勾选
          return {
            warning,
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
      // Pick[] 段分支(元素带 .records):逐段公司名精确匹配、未匹配自动新建(同 report_is 惯例),
      // 年月未识别回退 ctx;段公司名空则用 ctx.companyId → 聚合 ImportResultDTO
      if (Array.isArray(payload[0]?.records)) {
        const picks = payload as Pick[]
        const companies = await companyApi.list()
        const byName = new Map(companies.map(c => [c.name.trim(), c.id]))
        const agg = zero()
        // 逐公司一次请求:后面哪家失败,前面写进去的、自动新建的公司都不回滚 —— 报给导入弹窗的失败卡照实写
        let made = 0
        try {
          for (const [k, p] of picks.entries()) {
            const first = p.records[0]
            if (!first) continue
            const cname = String(first.__company ?? '').trim()
            let companyId = ctx.companyId
            if (cname) {
              if (!byName.has(cname)) {
                const created = await companyApi.create(cname, true)   // 未匹配自动新建
                byName.set(cname, created.id)
                made++
              }
              companyId = byName.get(cname)
            }
            p.companyId = companyId   // target 记「导到哪家」(新建的公司这时才有 id)
            const ym = first.__ym as { year: number; month: number } | undefined
            const res = await ledgerApi.import(companyId!, ym?.year ?? ctx.year!, ym?.month ?? ctx.month!,
              { rows: p.records.map(toLedgerRow) })
            agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
            ctx._seg?.(k, res)   // 一家一个月一条导入记录
            ctx._run?.wrote(agg.imported)
          }
        } catch (e) {
          if (made > 0) ctx._run?.kept(`新建的 ${made} 家公司已留下`)
          throw e
        }
        return agg
      }
      return ledgerApi.import(ctx.companyId!, ctx.year!, ctx.month!,
        { rows: (payload as ImportRec[]).map(toLedgerRow) })
    },
    target: (ctx, picks) => {
      const ps = picks as Pick[] | undefined
      if (!Array.isArray(ps?.[0]?.records)) return [T({ ...one(ctxYm(ctx)), companyId: ctx.companyId ?? null })]
      return ps!.map(p => {
        const ym = p.records[0]?.__ym as { year: number; month: number } | undefined
        return T({ ...one(ym ? ymOf(ym.year, ym.month) : ctxYm(ctx)), companyId: p.companyId ?? null })
      })
    },
    viewLink: (l) => (live(l) && l.periodFrom && l.companyId != null ? periodLink('ledger', { p: l.periodFrom, co: l.companyId }) : null),
    precheck: async (ctx, parsed) => {
      const recs = parsed.records
      if (!recs?.length) return {}
      const d = recs[0].__ymDetected as { year: number; month: number } | undefined
      const fileYm = d ? ymOf(d.year, d.month) : undefined
      if (ctx.companyId == null || !ctx.year || !ctx.month) return { fileYm }
      try {
        // 按去重租户家数计,结转虚行不算(同改前 LedgerView 的覆盖确认:overwriteTargets)
        const rows = (await ledgerApi.month(ctx.companyId, ctx.year, ctx.month)).rows
        return { fileYm, existing: overwriteTargets(rows, recs.map(r => r.tenantName as string | undefined)) }
      } catch { return { fileYm } }   // 拉不到本月数据不拦(同改前)
    },
  },
  {
    key: 's10', icon: 'coins', module: ['sales-income:edit'],
    group: '记账 · 按月', name: '附表10 销售收入', desc: '各期区销售收入', sub: '整本销售收入表，一次导多个月、多个期区',
    rules: ['每段标题写年月和期区，认不出的下一步手选', '一段一段导，断了能接着导'],
    sample: { head: ['租户名称', '厂房租金', '厂房企业管理服务费', '厂房基础设施维护费', '基准电费', '基准水费'], rows: [
      ['恒毅', '60,000', '8,250', '1,320', '6,120', '1,880'],
      ['叙丰', '30,000', '4,100', '660', '3,600', '1,200'],
    ] },
    landing: '附表10 销售收入', unit: '行',
    modalProps: (ctx) => {
      // 模板驱动版面:office=一期∪宿舍册并集,factory=二期∪三期并集(解析期 phase 未知只能并集;
      // 某期册没有的 c_ 列,后端按期册校验会逐行报错,不会静默入错册)。def 缺省 → 静态 layout.ts 回退。
      const union = (defs: (BookDef | undefined)[]): ColumnMapEntry[] => {
        const byId = new Map<string, ColumnMapEntry>()
        for (const d of defs) if (d) for (const c of flattenCols(d)) {
          const prev0 = byId.get(c.id)
          if (!prev0) byId.set(c.id, { label: c.label, key: c.id, aliases: c.aliases.length ? [...c.aliases] : undefined })
          else if (c.aliases.length) prev0.aliases = [...new Set([...(prev0.aliases ?? []), ...c.aliases])]
        }
        return [...byId.values()]
      }
      const layouts = ctx.bookDefs
        ? { office: union([ctx.bookDefs[1], ctx.bookDefs[4]]), factory: union([ctx.bookDefs[2], ctx.bookDefs[3]]) }
        : phaseLayoutsCol
      return {
        templateCols: layouts.factory.map(c => c.label),
        phaseLayouts: layouts, nameLabels: ['租户名称', '租户'],
      }
    },
    // 逐段:每段一个 (期,月) 槽一次请求,后端清本槽导入行再插(重发同一段 = 同样结果,S10ImportApiIT 重导用例)。
    // 有 _run 时从 _run.from 段起发(「从第 k 段接着导」前面的段不重发),总数从 _run.base 起累计,导入记录记全量。
    run: async (payload, ctx) => {
      const picks = payload as Pick[]
      const seg = ctx._run
      let agg = seg ? seg.base : zero()
      for (let k = seg?.from ?? 0; k < picks.length; k++) {
        // 后端写口不校验锁:失锁后接着发 = 无锁写别人手里的月。断在这一段,前面写完的照实算(失败卡 4xx 一类,只给「返回修改」)
        if (ctx._alive && !ctx._alive()) throw new Error('已退出编辑，从这一段起没有再发')
        const p = picks[k]
        const acctMonth = `${p.year}-${pad2(p.month!)}`
        // r 的运行时形状 = tenantName + 该版面 colId(colId 即 keyof S10Fees,见 layout.ts)
        const rows: S10ImportRow[] = p.records.map(r => {
          // __ 内部键挡在 POST 外;c_ 自定义列收进口袋(方案A)
          const row: Record<string, unknown> = { profile: PHASE_LAYOUT[p.phase!] }
          const extras: Record<string, number> = {}
          for (const [k, v] of Object.entries(r)) {
            if (k.startsWith('__') || v === undefined) continue
            if (k.startsWith('c_')) { extras[k] = v as number; continue }
            row[k] = v
          }
          if (Object.keys(extras).length) row.extraFees = extras
          return row as unknown as S10ImportRow
        })
        const res = await s10Api.importRows({ phase: p.phase!, acctMonth, rows })
        agg = addResult(agg, res)   // 各段的提示(未绑定租户)也并进来,结果卡「n 条提示」要用
        seg?.segDone(k, res)
        ctx._seg?.(k, res)   // 一段(一个期区一个月)一条导入记录
      }
      return agg
    },
    target: (_ctx, picks) => ((picks ?? []) as Pick[]).map(p =>
      T({ ...one(p.year && p.month ? ymOf(p.year, p.month) : null), zone: p.phase != null ? String(p.phase) : null })),
    viewLink: (l) => (live(l) && l.periodFrom && l.zone ? periodLink('sales-income', { p: l.periodFrom, co: Number(l.zone) }) : null),
  },
  {
    key: 'pv', icon: 'sun', module: ['pv-income:edit'],
    group: '记账 · 按年', name: '附表6 光伏发电', desc: '全年分月光伏收益', sub: '光伏发电明细，一期、二期、三期叠在一张表里',
    rules: ['按段分期区，按表头名字认列'],
    sample: { head: ['记账月份', '发生月份', '消纳电量', '消纳电费金额', '上网电量', '上网收益'], rows: [
      ['2026-08', '2026-07', '52,310', '36,617', '18,420', '7,368'],
      ['2026-09', '2026-08', '49,870', '34,909', '17,950', '7,180'],
    ] },
    landing: '附表6 光伏发电', unit: '行',
    modalProps: () => ({
      templateCols: ['记账月份', '发生月份', '消纳电量', '消纳电费金额', '上网电量', '上网收益'],
      customParse: (matrix: string[][]) => importPvSections(matrix),
    }),
    run: async (payload, ctx) => {
      const rows = recsOf(payload)
      if (!rows.length) return zero()
      const res = await pvApi.importRows(rows.map(toPvRow))
      splitByZone(ctx, res, rows.map(r => r.phaseId))   // 一次请求几个期区:一个期区一条导入记录
      return res
    },
    target: (_ctx, picks) => byZone(recsOf(picks), r => r.phaseId, r => r.acctMonth),
    viewLink: (l) => (live(l) && y4(l.periodTo) ? periodLink('pv-income', { p: y4(l.periodTo)!, extra: { mode: 'summary' } }) : null),
  },
  // ── 光伏分栋抄表(PV-METER-SPEC §3):长表一行=一站一日,(电站,日期)幂等 upsert ──
  {
    key: 'pvMeter', icon: 'gauge', module: ['pv-income:reading'],
    group: '出账 · 每月工序', name: '光伏抄表', desc: '各栋光伏每天的发电读数',
    sub: '各栋光伏每天的发电读数，导进光伏分栋抄表',
    // 照 md-v2-pick 图(比对照表多「列的先后不要紧，按表头名字认」半句,图为准)
    rules: ['一行是一个楼栋一天；列的先后不要紧，按表头名字认', '同一楼栋同一天再导，用新数盖掉旧数', '认不出的楼栋或日期单独列出来，不耽误别的行'],
    sample: { head: PV_METER_HEAD, rows: [
      ['一期', '1栋', '2026-09-01', '812.4', '640.2', '172.2', ''],
      ['二期', '7栋', '2026-09-01', '640.2', '512.0', '128.2', '换过表'],
    ] },
    landing: '光伏分栋抄表', unit: '行',
    modalProps: () => ({
      templateCols: PV_METER_HEAD,
      // 日期认不出 / 电量为负的行解析时就交 bad(核对页列出,不发);表头识别失败才整批拦
      customParse: (matrix: string[][]) => parsePvMeterRows(matrix),
    }),
    // ponytail: 直调端点不经 api/pvMeter.ts——该文件归视图域(Wave2-A)所有,双代理并行互不阻塞;A 落地后可换 pvMeterApi
    run: async (payload) => {
      const rows = payload as ImportRec[]
      if (!rows.length) return zero()
      return http.post<ImportResultDTO>('/pv-meter/import', { rows }, SILENT)
    },
    target: (_ctx, picks) => [T(span(recsOf(picks).map(r => r.readDate as string)))],
    viewLink: (l) => (live(l) && ym7(l.periodTo) ? periodLink('pv-income', { p: ym7(l.periodTo)!, extra: { mode: 'meter' } }) : null),
  },
  // ── 充电桩分桩明细(CP-METER-SPEC §3):长表一行=一桩一日,(桩,日)幂等 upsert;与附表7/8 月度汇总完全独立 ──
  {
    key: 'cpMeter', icon: 'plug', module: ['car-charging:reading', 'ebike-charging:reading'],
    group: '出账 · 每月工序', name: '充电桩抄表', desc: '各桩每天的充电明细', sub: '各桩每天的充电明细，导进充电桩分桩明细',
    rules: ['一行是一个桩一天', '同桩同一天再导，新数盖掉旧数', '认不出的桩名或日期单独列出'],
    sample: { head: CP_METER_HEAD, rows: [
      ['A充电', '快充1', '2026-09-01', '850.5', '42.5', '680.0', ''],
      ['B充电', '慢充1', '2026-09-01', '312.0', '15.6', '249.6', ''],
    ] },
    landing: '充电桩分桩明细', unit: '行',
    modalProps: () => ({
      templateCols: CP_METER_HEAD,
      // 日期认不出 / 金额为负的行解析时就交 bad(同 pvMeter);表头识别失败才整批拦
      customParse: (matrix: string[][]) => parseCpMeterRows(matrix),
    }),
    // ponytail: 直调端点不经 api/cpMeter.ts——该文件归视图域(W2-A)所有,双代理并行互不阻塞;A 落地后可换 cpMeterApi
    run: async (payload) => {
      const rows = payload as ImportRec[]
      if (!rows.length) return zero()
      return http.post<ImportResultDTO>('/cp-meter/import', { rows }, SILENT)
    },
    target: (_ctx, picks) => [T(span(recsOf(picks).map(r => r.readDate as string)))],
    // ponytail: 记录里不分汽车 / 电动车,去看落汽车充电桩屏的分桩运营账;要分得让 import_log 多记一列桩型
    viewLink: (l) => (live(l) && ym7(l.periodTo) ? periodLink('car-charging', { p: ym7(l.periodTo)!, extra: { mode: 'meter' } }) : null),
  },
  // ── 园区抄表(METER-SPEC §4):整册多 sheet(一期/二期/宿舍×电/水),每 sheet 月份自理;
  //    表按 (分区,类别,标识) 自动建档,读数按 (表,月) 幂等覆盖;认不出的 sheet(租户缴费单等)列成导不了的段 ──
  {
    key: 'meter', icon: 'gauge', module: ['meters:edit'],
    group: '出账 · 每月工序', name: '园区抄表', desc: '各期区水电表读数', sub: '各期区水表、电表的本月读数',
    rules: ['整本抄表册：每个区的电、水各一张表，标题写年月', '直接粘一块也行，下一步问是哪个月哪个区', '同表同月再导，新数盖掉旧数', '没抄到的表记成漏抄'],
    sample: { head: ['区域', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '本月行至'], rows: [
      ['1栋', '恒毅', '户内用电', '电表①', '230220001238', '1', '12,034', '12,890'],
      ['1栋', '叙丰', '户内用电', '电表②', '230220001239', '40', '332.1', '351.6'],
    ] },
    landing: '园区抄表', unit: '块表',
    modalProps: (ctx) => {
      // v2 拆分(§6.2/§6.3)要租户库(带 id 才能挂 tenantId)+楼栋清单:打开弹窗即预取进模块缓存
      // (同 budget 预取模式,解析在用户选完文件后通常已就绪);视图喂的 ctx.tenantNames/ctx.buildings 作后备。
      // 取不到也不拦——正则拆分照跑,租户/楼栋 id 空、档案可改。
      prefetchMeterMaster()
      const now = new Date()
      const ym = ctx.year && ctx.month
        ? `${ctx.year}-${String(ctx.month).padStart(2, '0')}`
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      // 区的选项与 sheet 识别同一份期区清单(ctx.zones;拉不到回落 meterExcel 的写死三区)
      const zones = resolveZones(ctx.zones)
      return {
        templateCols: METER_TEMPLATE_COLS,
        // 标题缺月份 / 区 / 表类任一项时的补问值(三项都预填:月份取抄表页当前年月);解析结果的 ask 说缺的是哪几项
        fallbackPicker: {
          ym, zone: zones[0].code, kind: 'elec',
          zones: zones.map(z => ({ value: z.code, label: z.name })),
          kinds: Object.entries(METER_KIND_LABEL).map(([value, label]) => ({ value, label })),
        },
        parseWorkbook: (sheets: { name: string; matrix: string[][] }[], fb?: { ym: string; zone: string; kind: string }) =>
          parseMeterWorkbook(sheets, {
            tenants: meterTenants ?? ctx.tenantNames?.map(n => ({ companyName: n })),
            buildings: meterBuildings ?? ctx.buildings,
          }, fb, ctx.zones),
      }
    },
    // sections 勾选段与单段平铺两种 payload 形态都可能到达(parseWorkbook 契约)
    run: async (payload, ctx, fileName) => {
      const rows = recsOf(payload)
      if (!rows.length) return zero()
      // fileName 进档案变更记录(METER-TIMELINE-SPEC §1.4),抽屉「档案变更」与撤销导入靠它认出是哪一次
      const res = await http.post<ImportResultDTO>('/meters/import', { rows, fileName }, SILENT)
      splitByZone(ctx, res, rows.map(r => r.zone))   // 一次请求几个区:一个区一条导入记录
      // matches 透传:结果弹层显示 按编码命中/按位置命中/按标识命中/新建 四档(METER-IMPORT-SPEC §4)
      // notices 透传:换楼/企业名称空保留/人工设定未覆盖这些「已导入、仅需知会」的提示,漏了弹层就收不到
      // batchId / changes 透传:撤销这次导入的档案改动、结果弹层列「表 · 字段 · 旧 → 新 · 影响月」(SPEC §3.2 §3.5)
      return {
        imported: res.imported, skipped: res.skipped, errors: res.errors, matches: res.matches, notices: res.notices,
        batchId: res.batchId, changes: res.changes,
      }
    },
    target: (_ctx, picks) => byZone(recsOf(picks), r => r.zone, r => r.ym),
    viewLink: (l) => (live(l) && ym7(l.periodTo) ? periodLink('meters', { p: ym7(l.periodTo)! }) : null),
  },
  // ── 合同计费行(BILL-FORWARD 刀1 三次返工 §1.2):月度租金工作簿整册提取,
  //    sheet=租户,块探测 A1~A7 七型;停止收敛——每费项行 1:1 出一条计费行(位置+13枚举+面积/单价/系数/房数);
  //    叠单合并/表头转置修正/列文本映射/按间房数三写法;multiPick 银纳按位置类型路由(厂房→厂房合同/宿舍→宿舍合同);
  //    无合同户报「须先建合同」;须手录 sheet 逐条报告不整批拦;后端按 source 覆盖(manual 保留,import 覆盖);
  //    导入成功自动落「到户报告」CSV(282 户逐户有名) ──
  {
    key: 'billingTerms', icon: 'file-text', module: ['contracts:edit'],
    group: '档案', name: '合同 · 月度租金工作簿', desc: '每户一张，更新计费行', sub: '每户一张表的月度租金工作簿，用来更新合同计费行',
    rules: ['一户有厂房、宿舍两份合同时按位置分开', '同名的几份合同下一步让你选', '没合同的户要先建合同', '导完自动下载一份逐户报告'],
    sample: { head: ['物业名称', '收费项目', '面积', '单价', '本月金额'], rows: [
      ['1栋3楼', '厂房租金', '1,200', '25', '30,000'],
      ['1栋3楼', '企业管理服务费', '1,200', '3.5', '4,200'],
    ] },
    landing: '合同管理', unit: '户',
    modalProps: (ctx) => {
      prefetchBillingContracts()
      return {
        templateCols: BILLING_TERM_TEMPLATE_COLS,
        // 须手录 / 须先建合同 / 名字像好几户的 sheet 也列成段(records 空、不勾、reason 写原因)
        parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => {
          const { sections, report } = parseBillingTermsWorkbook(sheets, { contracts: billingContracts ?? [] })
          ctx._bfReport = report
          if (!sections.length) return { error: '没识别到通知单块:sheet 需含「收费项目」表头。' }
          return { sections }
        },
      }
    },
    // sections 勾选段与单段平铺两种 payload 形态都可能到达(parseWorkbook 契约,同 meter)
    run: async (payload, ctx) => {
      const recs = recsOf(payload)
      if (!recs.length) return zero()
      // 剥去 __preview 等 UI 字段,只上契约字段(§1.7 Row{contractId, lines})
      const rows: BillingLinesImportRow[] = recs.map(r => ({
        contractId: r.contractId as number, lines: (r.lines ?? []) as BillingLinesImportRow['lines'],
      }))
      const res = await contractApi.importBillingLines(rows)
      // 到户报告 CSV(§1.2-8):解析期清点,注:手录(manual)行后端保留,报告以册内提取行为准
      if (ctx._bfReport?.length) downloadCsv('计费字段到户报告', billingReportCsv(ctx._bfReport))
      return res
    },
    target: () => [T()],   // 合同不按期
    viewLink: (l) => (live(l) ? { path: '/contracts', query: {} } : null),
  },
  // ── 合同汇总册(园区租户租金合同明细汇总):一户一行 = 期限四件套 + 整组计费行 → POST /contracts/import-full。
  //    明细长表出计费行(1:1,按位置聚段)、汇总宽表出期限四件套与 AB 对账;租户匹配/合同新建在后端(全称优先,简称+期兜底);
  //    导入后自动下载到户报告 CSV(逐户:费项数/位置段数/期限/AB 差异/问题 + 后端匹配还是新建) ──
  {
    key: 'contractFull', icon: 'file-text', module: ['contracts:edit'],
    group: '档案', name: '合同 · 汇总册', desc: '期限和计费行，新户自动建合同', sub: '整本合同汇总册（明细表 + 汇总表）',
    rules: ['一户一份合同，新户自动建', '缺租期的户标成待补', '导完自动下载一份逐户报告'],
    sample: { head: ['期', '租户', '企业全称', '物业名称', '收费项目', '面积', '单价', '月单价'], rows: [
      ['一期', '恒毅', '恒毅精密制造有限公司', '1栋3楼', '厂房租金', '1,200', '25', '30,000'],
      ['一期', '恒毅', '恒毅精密制造有限公司', '1栋3楼', '企业管理服务费', '1,200', '3.5', '4,200'],
    ] },
    landing: '合同管理', unit: '户',
    modalProps: (ctx) => ({
      templateCols: CONTRACT_FULL_TEMPLATE_COLS,
      parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => {
        const { rows, report, bad, error } = parseContractWorkbook(sheets)
        ctx._cfReport = report
        if (error) return { error }
        if (!rows.length && !bad.length) return { error: '没解析到任何租户行:请确认整册含「明细」「汇总」两表。' }
        return {
          bad,
          records: rows.map((r, i) => ({ ...r, __preview: [
            r.phase ? `${r.phase}期` : '', r.tenantName, r.tenantFullName, r.buildingHint,
            r.lines.length, report[i]?.detailTotal ?? '', r.startDate ? `${r.startDate}~${r.endDate}` : '待人工补', r.termType ?? '',
          ] })),
        }
      },
    }),
    run: async (payload, ctx) => {
      // ContractFullRow 是 type 而非 interface(见 importContractSummary.ts),自带隐式索引签名,
      // 与 ImportRec 可比 —— 单次断言即可,不必 `as unknown as`
      const rows = payload as ContractFullRow[]
      if (!rows.length) return zero()
      const res = await http.post<{ result: ImportResultDTO; matched: number; created: number
        report: { rowIndex: number; contractNo: string | null; action: string; message: string | null }[] }>(
        '/contracts/import-full', { rows }, SILENT)
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
      return res.result
    },
    target: () => [T()],   // 合同不按期
    viewLink: (l) => (live(l) ? { path: '/contracts', query: {} } : null),
  },
  ...([7, 8] as const).map((no): ImportTypeEntry => ({
    key: `charging_${no}`,
    icon: no === 7 ? 'car' : 'bike',
    module: [no === 7 ? 'car-charging:edit' : 'ebike-charging:edit'],
    group: '记账 · 按年', name: no === 7 ? '附表7 汽车充电桩' : '附表8 电动车充电桩',
    desc: no === 7 ? '全年分月汽车充电收入' : '全年分月电动车充电收入',
    sub: no === 7 ? '汽车充电桩的损益明细' : '电动车充电桩的损益明细',
    rules: ['按运营商、按月份认行'],
    sample: no === 7
      ? { head: ['充电桩类别', '月份', '充电电量', '充电收入金额', '手续费及服务费金额', '充电成本金额'], rows: [
          ['A充电', '2026-08', '12,480', '14,976', '449', '9,360'],
          ['', '2026-09', '13,020', '15,624', '469', '9,765'],
        ] }
      : { head: ['充电桩类别', '月份', '充电电量', '充电金额收入', '充电成本'], rows: [
          ['B充电', '2026-08', '3,260', '2,934', '1,956'],
          ['', '2026-09', '3,410', '3,069', '2,046'],
        ] },
    landing: no === 7 ? '附表7 汽车充电桩' : '附表8 电动车充电桩', unit: '行',
    modalProps: (ctx: ImportCtx) => ({
      templateCols: ['充电桩类别', '记账月', '充电电量', '手续费及服务费', '充电成本'],
      // 月份认不出 / 运营商没登记的行解析时就交 bad;表头识别失败才整批拦
      customParse: (matrix: string[][]) => importChargingRows(matrix, no, ctx.cats ?? []),
    }),
    run: async (payload: ImportRec[] | Pick[]) => {
      const rows = payload as ImportRec[]
      return chargingApi.importRows(no, { rows: rows.map(toChargingRow) })
    },
    target: (_ctx, picks) => [T(span(recsOf(picks).map(r => r.acctMonth as string)))],
    viewLink: (l) => (live(l) && y4(l.periodTo)
      ? periodLink(no === 7 ? 'car-charging' : 'ebike-charging', { p: y4(l.periodTo)!, extra: { mode: 'summary' } }) : null),
  })),
  {
    key: 'elec', icon: 'zap', module: ['elec-cost:edit'],
    group: '记账 · 按年', name: '附表11 电费成本', desc: '全年分月电费成本', sub: '电费成本附表，两行表头',
    rules: ['按记账月和期区分开'],
    sample: { head: ['记账期', '期', '用电时段', '开票日期', '用电类别', '单位', '电量', '不含税单价', '税率'], rows: [
      ['202609', '一期', '峰', '2026-09-28', '大工业', 'kWh', '182,400', '0.8812', '13%'],
      ['', '', '谷', '2026-09-28', '大工业', 'kWh', '96,300', '0.3125', '13%'],
    ] },
    landing: '附表11 电费成本', unit: '行',
    modalProps: () => ({
      templateCols: ['类型', '期', '记账月份', '用电类别/计费需量', '电量', '单价', '税率'],
      customParse: (matrix: string[][]) => importElecRows(matrix),
    }),
    run: async (payload, ctx) => {
      const rows = payload as ImportRec[]
      const res = await elecApi.importRows(rows.map(toElecRow))
      splitByZone(ctx, res, rows.map(r => r.phaseId))   // 一次请求几个期:一个期一条导入记录
      return res
    },
    target: (_ctx, picks) => byZone(recsOf(picks), r => r.phaseId, r => r.acctMonth),
    viewLink: (l) => (live(l) && y4(l.periodTo) ? periodLink('elec-cost', { p: y4(l.periodTo)!, extra: { mode: 'summary' } }) : null),
  },
  // ── 园区电费成本模型(ELEC-COST-SPEC §5):长表一行=一表一费项一月,(表,月,费项,拆分)幂等 upsert;
  //    与附表11(上一条 elec)完全独立零改动 ──
  {
    key: 'elecCost', icon: 'zap', module: ['elec-cost:edit'],
    group: '记账 · 按年', name: '园区电费模型', desc: '各总表每月电费单费项', sub: '各总表每月电费单的费项',
    rules: ['一行是一块表一个费项一个月', '同表同月同费项再导，新数盖掉旧数', '认不出的表或费项单独列出'],
    sample: { head: ['电表', '费项', '拆分', '月份', '金额 元', '电量 kWh', '备注'], rows: [
      ['1号总表', '工业分时电价', '', '2026-09', '85,000', '120,000', ''],
      ['1号总表', '工业基本电费', '', '2026-09', '12,600', '', ''],
    ] },
    landing: '园区电费模型', unit: '行',
    modalProps: () => ({
      templateCols: ELEC_COST_TEMPLATE_COLS,
      // 费项 / 拆分 / 月份 / 金额认不出的行解析时就交 bad(同 pvMeter);表头识别失败才整批拦
      customParse: (matrix: string[][]) => parseElecCostRows(matrix),
    }),
    // ponytail: 直调端点不经 api/elecCost.ts——该文件归视图域所有,双代理并行互不阻塞;视图域落地后可换 elecCostApi
    run: async (payload) => {
      const rows = payload as ImportRec[]
      if (!rows.length) return zero()
      return http.post<ImportResultDTO>('/elec-cost/import', { rows }, SILENT)
    },
    target: (_ctx, picks) => [T(span(recsOf(picks).map(r => r.month as string)))],
    viewLink: (l) => (live(l) && ym7(l.periodTo) ? periodLink('elec-cost', { p: ym7(l.periodTo)!, extra: { mode: 'cost' } }) : null),
  },
  {
    key: 'salary', icon: 'wallet', module: ['salary:edit'],   // 2026-10-04 起工资写单列
    group: '记账 · 按月', name: '附表12 工资明细', desc: '全员工资表', sub: '整张工资表，可以一次导几个月',
    rules: ['每月一段，标题写「2026年9月工资表」', '按姓名认人', '下一步核对年月'],
    sample: { head: ['姓名', '职种/职务', '基本工资', '岗位工资', '绩效奖金', '社保'], rows: [
      ['张敏', '会计', '4,800', '1,200', '800', '520'],
      ['李工', '电工', '4,200', '1,000', '600', '480'],
    ] },
    landing: '附表12 工资明细', unit: '行',
    modalProps: (ctx) => ({
      templateCols: ['姓名', ...SALARY_COLUMN_MAP.map(c => c.label)],
      columnMap: SALARY_COLUMN_MAP, nameLabels: ['姓名'], sectionTitleRe: SALARY_SECTION_RE,
      defaultYear: ctx.year, defaultMonth: ctx.month ?? 1,
    }),
    run: async (payload, ctx) => {
      const picks = payload as Pick[]
      const agg = zero()
      for (const [k, p] of picks.entries()) {
        const y = p.year ?? ctx.year!; const m = p.month ?? ctx.month ?? 1
        const res = await salaryApi.importRows(y, m, { rows: p.records.map(toSalaryRow) })
        agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
        ctx._seg?.(k, res)              // 一个月一条导入记录
        ctx._run?.wrote(agg.imported)   // 逐月一次请求:后面哪月被拒,前面的月不回滚
      }
      return agg
    },
    target: (ctx, picks) => ((picks ?? []) as Pick[]).map(p => T(one(ymOf(p.year ?? ctx.year!, p.month ?? ctx.month ?? 1)))),
    viewLink: (l) => (live(l) && l.periodFrom ? periodLink('salary', { p: l.periodFrom }) : null),
  },
  ...([13, 14] as const).map((no): ImportTypeEntry => ({
    key: `office_${no}`,
    icon: 'plug', module: ['utilities:edit'],
    group: '记账 · 按年', name: no === 13 ? '附表13 办公水电' : '附表14 三期水电',
    desc: no === 13 ? '全年分月办公水电' : '全年分月三期水电',
    sub: no === 13 ? '办公逐月水电表' : '三期逐月水电表',
    rules: ['按表头名字认列，按月份认行'],
    sample: { head: ['月份', '用电量', '基准用电单价', '用水量', '基准用水单价', '所属月份'], rows: [
      ['2026-08', '3,240', '0.92', '186', '4.10', '2026-07'],
      ['2026-09', '3,105', '0.92', '172', '4.10', '2026-08'],
    ] },
    landing: '办公·三期水电', unit: '行',
    modalProps: () => ({
      templateCols: ['月份', ...UTILITIES_COLUMN_MAP.map(c => c.label)],
      // 按表头认列;月份认不出的行解析时就交 bad(改前到 run 里才记成错误)。认出的行带上 acctMonth / belongMonth
      customParse: (matrix: string[][]) => {
        const m = matchByHeader(matrix, UTILITIES_COLUMN_MAP, ['月份'])
        if (m.error) return { error: m.error }
        const records: ImportRec[] = []
        const bad: BadRow[] = []
        m.records.forEach((r, i) => {
          const ym = parseYearMonth(r.tenantName)
          if (!ym) { bad.push({ row: m.rows![i] + 1, cells: (r.__preview ?? []).map(v => String(v ?? '')), reason: '月份认不出' }); return }
          const acctMonth = ymOf(ym.year, ym.month)
          const bm = parseYearMonth(r.belongMonth, ym.year)
          records.push({ ...r, acctMonth, belongMonth: bm ? ymOf(bm.year, bm.month) : acctMonth })
        })
        return { records, bad }
      },
    }),
    run: async (payload: ImportRec[] | Pick[], ctx: ImportCtx) => {
      const agg = zero()
      for (const [k, rows] of officeByYear(payload as ImportRec[]).entries()) {
        const res = await utilitiesApi.importRows(no, { rows })
        agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
        ctx._seg?.(k, res)              // 一年一条导入记录
        ctx._run?.wrote(agg.imported)   // 逐年一次请求:后面哪年被拒,前面的年不回滚
      }
      return agg
    },
    target: (_ctx, picks) => officeByYear(recsOf(picks)).map(rows => T(span(rows.map(r => r.acctMonth)))),
    viewLink: (l) => (live(l) && y4(l.periodTo)
      ? periodLink('utilities', { p: y4(l.periodTo)!, extra: { tab: no === 13 ? 'office' : 'phase3' } }) : null),
  })),
  {
    key: 'report_is', icon: 'trending-up', module: ['income-statement:edit'],
    group: '账簿与报表', name: '利润表', desc: '各公司利润表', sub: '几家公司合在一张的利润表',
    rules: ['两行表头，每家公司本月、本年累计两列', '认不出的公司会新建'],
    sample: { head: ['项目', '行次', '本月金额', '本年累计金额'], rows: [
      ['一、营业收入', '1', '1,286,400', '10,912,300'],
      ['减：营业成本', '2', '702,100', '6,014,800'],
    ] },
    landing: '利润表', unit: '行',
    modalProps: () => ({
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
      let made = 0
      for (const p of picks) {
        const name = (p.label ?? '').trim()
        if (!name) continue
        if (!byName.has(name)) {
          const created = await companyApi.create(name, true)   // 未匹配自动新建
          byName.set(name, created.id)
          made++
        }
        p.companyId = byName.get(name)   // target 记「导到哪家」
        const cells: ReportCell[] = []
        for (const r of p.records) {
          const rowKey = String(r.rowKey)
          cells.push({ rowKey, field: 'cur', amount: Number(r.cur) || 0 })
          cells.push({ rowKey, field: 'ytd', amount: Number(r.ytd) || 0 })
        }
        sections.push({ companyName: name, cells })
      }
      const res = await keptOnFail(ctx, made, () => reportApi.import('is', ctx.year!, ctx.month!, { sections }))
      splitByCompany(ctx, res, sections)   // 一家公司一条导入记录
      return res
    },
    target: (ctx, picks) => namedPicks(picks).map(p => T({ ...one(ctxYm(ctx)), companyId: p.companyId ?? null })),
    viewLink: (l) => (live(l) && l.periodFrom && l.companyId != null ? periodLink('income-statement', { p: l.periodFrom, co: l.companyId }) : null),
  },
  {
    key: 'report_bs', icon: 'scale', module: ['balance-sheet:edit'],
    group: '账簿与报表', name: '资产负债表', desc: '各公司资产负债表', sub: '几家公司合在一张的资产负债表',
    rules: ['左右两栏，每家公司一列期末余额', '认不出的公司会新建'],
    sample: { head: ['资产', '行次', '期末余额', '负债和所有者权益', '行次', '期末余额'], rows: [
      ['货币资金', '1', '2,316,500', '短期借款', '31', '0'],
      ['应收账款', '4', '846,200', '应付账款', '34', '412,300'],
    ] },
    landing: '资产负债表', unit: '行',
    modalProps: () => ({
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
      let made = 0
      for (const p of picks) {
        const name = (p.label ?? '').trim()
        if (!name) continue
        if (!byName.has(name)) {
          const created = await companyApi.create(name, true)   // 未匹配自动新建
          byName.set(name, created.id)
          made++
        }
        p.companyId = byName.get(name)   // target 记「导到哪家」
        const cells: ReportCell[] = p.records.map(r => ({
          rowKey: String(r.rowKey), field: 'end', amount: Number(r.end) || 0,
        }))
        sections.push({ companyName: name, cells })
      }
      const res = await keptOnFail(ctx, made, () => reportApi.import('bs', ctx.year!, ctx.month!, { sections }))
      splitByCompany(ctx, res, sections)   // 一家公司一条导入记录
      return res
    },
    target: (ctx, picks) => namedPicks(picks).map(p => T({ ...one(ctxYm(ctx)), companyId: p.companyId ?? null })),
    viewLink: (l) => (live(l) && l.periodFrom && l.companyId != null ? periodLink('balance-sheet', { p: l.periodFrom, co: l.companyId }) : null),
  },
  {
    key: 'report_tb', icon: 'table-2', module: ['trial-balance:edit'],
    group: '账簿与报表', name: '科目余额表', desc: '各公司科目余额表', sub: '整本科目余额表，每家公司一张',
    rules: ['每张叫「余额表」的表是一家公司', '认不出的公司会新建'],
    sample: { head: ['科目代码', '科目名称', '期初借方', '期初贷方', '本期借方', '本期贷方', '期末借方', '期末贷方'], rows: [
      ['1001', '库存现金', '12,400', '', '36,800', '35,100', '14,100', ''],
      ['1122', '应收账款', '846,200', '', '1,286,400', '1,102,300', '1,030,300', ''],
    ] },
    landing: '科目余额表', unit: '行',
    modalProps: () => ({
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
      let made = 0
      for (const p of picks) {
        const name = (p.label ?? '').trim()
        if (!name) continue
        if (!byName.has(name)) {
          const created = await companyApi.create(name, true)   // 未匹配自动新建
          byName.set(name, created.id)
          made++
        }
        p.companyId = byName.get(name)   // target 记「导到哪家」
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
      const res = await keptOnFail(ctx, made, () => reportApi.import('tb', ctx.year!, ctx.month!, { sections }))
      splitByCompany(ctx, res, sections)   // 一家公司一条导入记录
      return res
    },
    target: (ctx, picks) => namedPicks(picks).map(p => T({ ...one(ctxYm(ctx)), companyId: p.companyId ?? null })),
    viewLink: (l) => (live(l) && l.periodFrom && l.companyId != null ? periodLink('trial-balance', { p: l.periodFrom, co: l.companyId }) : null),
  },
  // ── 损益附表 1–5(P2-D):5 条同构由 PNL_SCHEDULES 生成;年从标题自动识,识别失败回退屏当前年槽(ctx.year) ──
  ...PNL_SCHEDULES.map((config, i): ImportTypeEntry => ({
    key: `pnl_${config.schedule}`,
    // 损益附表 1–5 落 /api/pnl/{s1..s5}/**,各归各的附表屏(route = 屏 value)
    icon: ['trending-up', 'zap', 'droplets', 'wrench', 'banknote'][i], module: [`${config.route}:edit`],
    // 名字跟侧栏一字不差(用户 10-10 拍板 U2;图上「附表1 租金损益明细」是附表标题,和侧栏、去处下拉、「去 X 看」对不上)
    group: '账簿与报表', name: PNL_NAV_LABEL[i],
    desc: ['全年分月租金损益', '全年分月电费损益', '全年分月水费损益', '全年分月其他运管收益', '全年分月费用支出'][i],
    sub: '年度统计母册里的这张附表，整年替换',
    rules: ['传整本母册或只粘这张表都行', '年份从标题认'],
    sample: { head: [config.groupCol, '科目细分', '1月', '2月', '3月', '…', '12月', '备注'], rows: [
      [['一期', '厂房租金', '286,400', '286,400', '291,200'], ['电费收入', '一期', '182,400', '176,900', '190,300'],
        ['水费收入', '一期', '8,640', '8,210', '8,930'], ['管理费', '一期', '46,200', '46,200', '46,200'],
        ['管理费用', '工资', '186,000', '186,000', '192,000']][i],
      [['二期', '厂房租金', '198,600', '198,600', '198,600'], ['电费成本', '一期', '151,200', '148,600', '157,800'],
        ['水费成本', '一期', '7,120', '6,980', '7,350'], ['停车费', '一期', '3,800', '3,650', '3,900'],
        ['管理费用', '办公费', '4,300', '3,900', '5,100']][i],
    ].map(r => [...r, '…', '', '']) },
    landing: PNL_NAV_LABEL[i], unit: '行',
    modalProps: () => ({
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
      // toPnlRow 只搬 PnlRowDTO 的键,__yearDetected 自然被挡下(不再需要单独 destructure 剥离)
      const res = await pnlApi.import(config.schedule, y, { rows: rows.map(toPnlRow) })
      return Object.assign(res, { __usedYear: y })
    },
    target: (ctx, picks) => {
      const y = (recsOf(picks)[0]?.__yearDetected as number | null | undefined) ?? ctx.year
      return [T(one(y ? String(y) : null))]
    },
    viewLink: (l) => (live(l) && y4(l.periodFrom) ? periodLink(config.route, { p: y4(l.periodFrom)! }) : null),
  })),
  // ── 年度预算(P3-P1 预算对比):解析规则见 importBudget.ts 头注释;确认屏按年分段,run 聚合整包一次导入 ──
  {
    // 年度预算只在导入中心导,归导入中心的编辑权(RBAC-SPEC §15.2)
    key: 'budget', icon: 'target', module: ['import:edit'],
    group: '账簿与报表', name: '年度预算', desc: '全年预算和往年实际', sub: '全面预算总表',
    rules: ['按年分段核对', '2025年起的发生额用系统算的，文件里的这一列跳过'],
    sample: { head: ['项目', '2025年发生额', '2026年预算', '备注'], rows: [
      ['收入总计', '92,705,203', '101,200,000', ''],
      ['利润总额', '22,593,088', '24,800,000', ''],
    ] },
    landing: '预算对比', unit: '行',
    modalProps: () => {
      // 收入核对要五张损益附表一次拉齐(fetchPnlSummary 缺一张整个失败):少一张查看就不取,也不拿旧缓存核对
      const canPnl = PNL_SCHEDULES.every(c => useAuthStore().can(`${c.route}:view`))
      if (canPnl) prefetchBudgetPnlRevenue()
      return {
        templateCols: ['项目', 'YYYY年发生额(可多列)', 'YYYY年预算', '备注'],
        sheetMatch: BUDGET_SHEET_RE,
        // 看不了全部损益附表:这次不核对,核对页的提示条上说一句(改前写在标题下那句里,那句现在只写「这是什么文件」)
        parseWorkbook: (sheets: { name: string; matrix: string[][] }[]) => {
          const r = importBudget(sheets, canPnl ? budgetPnlRevenue : undefined)
          return canPnl ? r : { ...r, warning: [r.warning, BUDGET_NO_PNL].filter(Boolean).join(' ') }
        },
      }
    },
    // 勾选段(年)平铺成单 payload:后端按 payload 内出现的 year 整年替换
    run: async (payload) => {
      const rows = (payload as Pick[]).flatMap(p => p.records)
      if (!rows.length) return zero()
      return budgetApi.import({ rows: rows.map(toBudgetRow) })
    },
    target: (_ctx, picks) => [T(span(recsOf(picks).map(r => String(r.year))))],
    viewLink: (l) => (live(l) ? { path: '/budget', query: {} } : null),   // 预算对比屏不认期参数
  },
]
export const IMPORT_TYPES: ImportTypeEntry[] = TYPES.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))

// 各屏与导入中心用:取该类型的解析配置(= modalProps 去掉 defaults)+ 弹窗要的那几样字(标题「导入」+ 名 / sub / 规矩 / 小样表 / 单位,
// 只在 registry 一处)。屏自己给 :default-*。单一事实源:columnMap/customParse/phaseLayouts/nameLabels/templateCols 都出自这里。
// 台账另带 precheck(parsed, ym?):绑好 ctx 的核对页预检,ym = 改成导到文件里的那个月时按它查;
// 回来的 ym / company 是「导到 X · 公司」那一条(弹窗不知道 ctx)。
export function parserProps(key: string, ctx: ImportCtx = {}): { title: string; templateCols: string[]; sub: string } & Record<string, unknown> {
  const entry = IMPORT_TYPES.find(t => t.key === key)
  if (!entry) throw new Error('unknown import type: ' + key)
  const { defaultYear, defaultMonth, defaultPhase, ...parser } = entry.modalProps(ctx)
  void defaultYear; void defaultMonth; void defaultPhase
  const pre = entry.precheck
  return {
    ...parser, title: `导入${entry.name}`, sub: entry.sub, rules: entry.rules, sample: entry.sample, unit: entry.unit,
    ...(pre ? { precheck: async (parsed: { records?: ImportRec[] }, ym?: string) => {
      const c = ym ? { ...ctx, year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) } : ctx
      return { ...(await pre(c, parsed)), ym: ctxYm(c) ?? undefined, company: c.companyName }
    } } : {}),
  } as { title: string; templateCols: string[]; sub: string } & Record<string, unknown>
}

// 几个落点并成一条(没分段报结果的整次一条 / 被拒那一条):期取首尾,公司 / 期区只有一个时才写
function mergeTargets(ts: ImportTarget[]): ImportTarget {
  const only = (k: 'companyId' | 'zone') => { const v = new Set(ts.map(t => t[k])); return v.size === 1 ? [...v][0] : null }
  return T({ ...span(ts.flatMap(t => [t.periodFrom, t.periodTo])), companyId: only('companyId') as number | null, zone: only('zone') as string | null })
}

// 唯一导入入口:执行 entry.run → 记导入记录(best-effort,记不上不阻断) → 返回 { res, logIds }(logIds 给导入中心高亮新记录行)。
// 一个落点一条记录(导入中心「导到哪」逐行出、行数按段计):run 每写完一个落点报 ctx._seg,没报的整次一条。
// 整单被拒(后端 4xx 信封,含审核闸)也记一条 rejected + 信封里的原因;断网 / 5xx / nginx 自己挡的(413 太大等,没信封)
// 不记被拒(没导成,不是被拒),断之前已经写进去的段照记。
// 核对页里导不了、这次没发的行(ctx._run.bad)记进第一条的「要核对」。
export async function runImport(
  key: string, payload: ImportRec[] | Pick[], ctx: ImportCtx, fileName: string,
): Promise<{ res: ImportResultDTO; logIds: number[] }> {
  const entry = IMPORT_TYPES.find(t => t.key === key)
  if (!entry) throw new Error('unknown import type: ' + key)
  const segs: ImportResultDTO[] = []
  const c: ImportCtx = { ...ctx, _seg: (k, r) => { segs[k] = r } }
  const logIds: number[] = []
  let extra = ctx._run?.bad ?? 0
  const record = async (t: ImportTarget, r: ImportResultDTO | null, note?: string) => {
    // 后端写口 skipped 就是 errors 的条数:两者取大,不重复算
    const warn = r ? Math.max(r.skipped, r.errors.length) + extra : 0
    const ok = r?.imported ?? 0
    if (r) extra = 0
    try {
      // 一段的行全被后端逐行拒掉(记成被拒):原因取第一条,不然「被拒」页签里那一行没有原因
      const why = note ?? (r && ok === 0 && r.errors.length
        ? r.errors[0].reason + (r.errors.length > 1 ? ` 等 ${r.errors.length} 行` : '') : undefined)
      const log = await importLogApi.record({
        dataType: entry.key, typeLabel: entry.name, fileName: fileName || '（粘贴）', ...t, note: why,
        rows: ok + warn, ok, warn, status: r ? deriveStatus({ imported: ok, skipped: warn, errors: [] }) : 'rejected',
      })
      if (log?.id != null) logIds.push(log.id)
    } catch (e) { console.warn('[import-log] 记录失败(不影响导入):', e) }
  }
  const recordSegs = async (targets: ImportTarget[]) => {
    for (const [k, r] of segs.entries()) if (r) await record(targets[k] ?? T(), r)
  }
  let res: ImportResultDTO
  try {
    res = await entry.run(payload, c, fileName)
  } catch (e) {
    const targets = entry.target(c, payload)
    if (segs.some(r => r?.imported)) invalidateAnaCache()
    await recordSegs(targets)
    if (failKind(e) === 'reject' && typeof (e as { code?: unknown } | null)?.code === 'number') {
      const from = ctx._run?.from ?? 0
      await record(mergeTargets(targets.filter((_, k) => k >= from && !segs[k])), null, failReason(e))
    }
    throw e
  }
  // 有行入库即让分析层缓存整体失效:空态→去导入→回分析屏立即见新数据(复审:缓存陈旧闭环)
  if (res.imported > 0) invalidateAnaCache()
  ctx._run?.recording()   // 导入弹窗进度卡走到「记下这次导入」
  const targets = entry.target(c, payload)
  if (segs.length) await recordSegs(targets)
  else await record(mergeTargets(targets), res)
  return { res, logIds }
}
