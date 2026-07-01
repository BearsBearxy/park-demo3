// 导入类型单一事实源(registry)+ runImport 记录链。
// 各屏与导入中心 hub 都从这里取「解析配置(modalProps) + 执行(run)」,导入后统一上报 import_log。
// 注:本轮(P-Import-3 hub-first)hub 消费本文件;7 个原屏本轮暂未改造(仍用各自屏内配置),
//     故工资/办公列映射在此临时复制,下一轮 T5 dedup 时各屏改为从此取、消除重复。
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
import { importPvSections } from '@/utils/importPvSections'
import { importChargingRows } from '@/utils/importChargingRows'
import { importElecRows } from '@/utils/importElecRows'
import { parseYearMonth } from '@/utils/parseYearMonth'
import { FEE_KEYS, lgColumns } from '@/utils/ledgerColumns'
import { PHASE_LAYOUT, leavesOf } from '@/views/sales-income/layout'

// ── 解析工具/常量(临时复制自各屏,T5 dedup 时归并) ─────────────
const cleanNum = (x: unknown): number => { const v = parseFloat(String(x).replace(/[, ¥%]/g, '')); return isNaN(v) ? 0 : v }
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

// ledger: 租户 + 21 费用列(顺序 = FEE_KEYS)
function ledgerImportCols(): string[] {
  const labelByKey: Record<string, string> = {}
  for (const g of lgColumns(0).groups) for (const c of g.cols) labelByKey[c.key] = c.label
  return ['租户', ...FEE_KEYS.map(k => labelByKey[k])]
}
function ledgerParseRow(c: string[]): ImportRec | null {
  const name = (c[0] || '').trim(); if (!name) return null
  const fees: Record<string, number> = {}
  FEE_KEYS.forEach((k, i) => { fees[k] = cleanNum(c[i + 1]) })
  return { tenantName: name, ...fees, __preview: [name, ...FEE_KEYS.map((_k, i) => cleanNum(c[i + 1]) || '')] }
}
const phaseLayoutsCol = {
  office: leavesOf('office').map(l => ({ label: l.label, key: l.colId })),
  factory: leavesOf('factory').map(l => ({ label: l.label, key: l.colId })),
}

// ── 类型 ────────────────────────────────────────────────
export type ImportStatus = 'complete' | 'partial' | 'rejected'
type Pick = { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }
// ctx:hub 每次导入创建一个,同一引用同时传给 modalProps 与 run(charging 用它在解析期暂存 parseErrors)
export interface ImportCtx {
  companyId?: number; companyName?: string; year?: number; month?: number
  cats?: unknown[]; _parseErrors?: { rowIndex: number; label: string; reason: string }[]
}
export interface ImportTypeEntry {
  key: string; label: string; tag: string; icon: string
  context: 'none' | 'ledger'
  modalProps: (ctx: ImportCtx) => Record<string, unknown>
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

export const IMPORT_TYPES: ImportTypeEntry[] = [
  {
    key: 'ledger', label: '月度台账', tag: '凭证', icon: 'book-open', context: 'ledger',
    modalProps: (ctx) => ({
      title: '导入 月度台账' + (ctx.companyName ? ' · ' + ctx.companyName : ''),
      sub: `列顺序 = 租户 + 各费用项,按租户名匹配在租租户后导入到 ${ctx.year} 年 ${ctx.month} 月`,
      templateCols: ledgerImportCols(), parseRow: ledgerParseRow,
    }),
    run: async (payload, ctx) => {
      const rows = payload as ImportRec[]
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
]

// 唯一导入入口:执行 entry.run → 上报 import_log(best-effort,失败不阻断) → 返回 result。
export async function runImport(
  key: string, payload: ImportRec[] | Pick[], ctx: ImportCtx, fileName: string,
): Promise<ImportResultDTO> {
  const entry = IMPORT_TYPES.find(t => t.key === key)
  if (!entry) throw new Error('unknown import type: ' + key)
  const res = await entry.run(payload, ctx)
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
