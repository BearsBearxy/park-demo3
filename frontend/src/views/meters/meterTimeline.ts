// 表档案按月记录(METER-TIMELINE-SPEC)抽屉里几处共用的纯函数:月份区间怎么说、状态/来源怎么叫、
// 变更记录的前后像怎么译成一句话。组件只管排版,措辞集中在这里,测试也打在这里。
import type {
  MeterArchiveLogRow, MeterAssignMode, MeterLockedMonth, MeterRowSrc, MeterStatusValue,
} from '@/api/meters'

/** 改归属 / 改绑定对话框选定的改法(MeterAssignDialog → 调用方的 run)。 */
export interface AssignChoice { mode: MeterAssignMode; siblingIds: number[]; alsoMigrate: boolean }

export const STATUS_LABEL: Record<MeterStatusValue, string> = { active: '在用', retired: '停用', removed: '已拆' }
export const SRC_LABEL: Record<MeterRowSrc, string> = {
  import: '导入', manual: '手改', migrate: '按旧档案补记', contract: '合同终止',
}

/** 建表缺省的起始月:「一直在册」。屏上不写这个数。 */
export const EARLIEST = '1900-01'

export function shiftYm(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 一段的月份:until = 本段最后一个月(含),null = 往后各月。 */
export function rangeText(from: string, until: string | null): string {
  if (from === EARLIEST) return until == null ? '各月' : `${until} 及以前`
  if (until == null) return `${from} 起`
  return from === until ? from : `${from} ~ ${until}`
}

/** 链上第 i 段的最后一个月 = 下一段起始月的前一个月。 */
export function untilOf(froms: string[], i: number): string | null {
  return i + 1 < froms.length ? shiftYm(froms[i + 1], -1) : null
}

export const lockedText = (ls: MeterLockedMonth[]): string =>
  ls.map(l => `${l.ym} ${l.reason}`).join('、')

// ── 变更记录:前后像(meter_assign / meter_status 整行 JSON)译成一句话 ──

const ASSIGN_FIELDS: [string, string][] = [
  ['tenantName', '企业名称'], ['tenantId', '租户'], ['ownership', '归属'], ['buildingId', '楼栋'],
  ['area', '区域'], ['spot', '位置原文'], ['floorLabel', '楼层'], ['side', '方位'], ['roomNo', '房号'],
  ['subName', '表名称'], ['contractId', '人工绑定的合同'],
  ['tenantManual', '租户'], ['ownerManual', '归属/楼栋'], ['locManual', '楼层/方位/房号'],
]
const MANUAL_KEYS = new Set(['tenantManual', 'ownerManual', 'locManual'])
const LOC_BITS: [number, string][] = [[1, '楼层'], [2, '方位'], [4, '房号']]

export interface LogFmt {
  tenant: (id: number) => string | undefined
  building: (id: number) => string | undefined
  ownership: (o: string) => string
}

function parse(s: string | null): Record<string, unknown> | null {
  if (!s) return null
  try { return JSON.parse(s) as Record<string, unknown> } catch { return null }
}

function fmtVal(key: string, v: unknown, f: LogFmt): string {
  if (key === 'locManual') {
    const n = Number(v ?? 0)
    const on = LOC_BITS.filter(([b]) => (n & b) !== 0).map(([, l]) => l)
    return on.length ? `人工设定 ${on.join('、')}` : '按册子'
  }
  if (MANUAL_KEYS.has(key)) return Number(v ?? 0) === 1 ? '人工设定' : '按册子'
  if (v == null || v === '') return '空'
  if (key === 'tenantId') return f.tenant(Number(v)) ?? `#${v}`
  if (key === 'buildingId') return f.building(Number(v)) ?? `#${v}`
  if (key === 'ownership') return f.ownership(String(v))
  if (key === 'contractId') return `#${v}`
  return String(v)
}

/** 一条变更记录的明细行:状态行比状态;归属行 update 列出改了的每一格,insert 列出这一段有值的格,delete 说删了哪段。 */
export function logLines(e: MeterArchiveLogRow, f: LogFmt): string[] {
  const b = parse(e.beforeJson), a = parse(e.afterJson)
  if (e.tbl === 'status') {
    const s = (x: Record<string, unknown> | null) => STATUS_LABEL[x?.status as MeterStatusValue] ?? '—'
    if (e.action === 'insert') return [`加一行:${s(a)}`]
    if (e.action === 'delete') return [`删掉这一行:${s(b)}`]
    return [`${s(b)} → ${s(a)}`]
  }
  if (e.action === 'delete') return [`删掉这一段(企业名称 ${fmtVal('tenantName', b?.tenantName, f)})`]
  if (e.action === 'insert') {
    const on = ASSIGN_FIELDS.filter(([k]) => !MANUAL_KEYS.has(k) && a?.[k] != null && a?.[k] !== '')
    const manual = ASSIGN_FIELDS.filter(([k]) => MANUAL_KEYS.has(k) && Number(a?.[k] ?? 0) !== 0)
    return ['新写一段', ...on.map(([k, l]) => `${l}:${fmtVal(k, a?.[k], f)}`),
      ...manual.map(([k, l]) => `${l}:${fmtVal(k, a?.[k], f)}`)]
  }
  const out = ASSIGN_FIELDS
    .filter(([k]) => fmtVal(k, b?.[k], f) !== fmtVal(k, a?.[k], f))
    .map(([k, l]) => `${l}:${fmtVal(k, b?.[k], f)} → ${fmtVal(k, a?.[k], f)}`)
  return out.length ? out : ['来源或批次变了,各格的值没变']
}

/** 撤销导入写下的那几条记录:row_ref = 「撤销导入 <batchId>」。返回被撤过的批次。 */
export function revertedBatches(log: MeterArchiveLogRow[]): Set<string> {
  const P = '撤销导入 '
  return new Set(log.filter(l => l.rowRef?.startsWith(P)).map(l => l.rowRef!.slice(P.length)))
}
