// TenantEnergyView(租户用能工作台)数据变换纯函数(v2 铁律⑦:抽出单测,不碰 DOM/ECharts)。
// 口径与 v1 完全一致:s10 费用金额(元),电=基本+标准+维护电费、水=标准+维护水费;
// 「本期」=≤所选期间的最近 s10 月;窗口=≤本期的全部 s10 月;台账应收/实收沿 AnalysisLedgerRow。
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { familyRootOf } from '@/analysis/anaFamily'
import { fint, mean as aMean, std as aStd } from '@/components/ana/anaFmt'

export interface TenantRow {
  name: string; phase: number; rank: number
  cur: number; mom: number | null; vsAvg: number | null; sd: number; z: number
  winTotal: number; win: number[]; vals: Map<string, number>
  monthlyRent: number | null
}

/** 每户统计(v1 rowsCur 语义原样):本期/环比/窗口均值/σ/z,按本期费额降序排名。 */
export function buildTenantRows(
  tenantMap: Map<string, AnalysisS10Row[]>,
  curYm: string,
  winMonths: string[],
  metric: 'elec' | 'water',
  rentByName: Map<string, number>,
): TenantRow[] {
  if (!curYm) return []
  const out: TenantRow[] = []
  for (const [name, rs] of tenantMap) {
    const vals = new Map<string, number>()
    for (const r of rs) {
      if (r.acctMonth > curYm) continue
      const v = metric === 'elec' ? r.elec : r.water
      vals.set(r.acctMonth, (vals.get(r.acctMonth) ?? 0) + v)
    }
    if (!vals.has(curYm)) continue   // 本期无 s10 记录 → 不进截面
    const win = winMonths.filter((m) => vals.has(m)).map((m) => vals.get(m) as number)
    const cur = vals.get(curYm) as number
    const prevM = [...vals.keys()].sort().filter((m) => m < curYm).pop()
    const prev = prevM != null ? (vals.get(prevM) as number) : null
    const mn = aMean(win)
    const sd = aStd(win)
    out.push({
      name, phase: rs[rs.length - 1]?.phase ?? 1, rank: 0,
      cur,
      mom: prev ? +(((cur - prev) / prev) * 100).toFixed(1) : null,
      vsAvg: mn ? +(((cur - mn) / mn) * 100).toFixed(1) : null,
      sd, z: sd ? (cur - mn) / sd : 0,
      winTotal: win.reduce((s, v) => s + v, 0), win, vals,
      monthlyRent: rentByName.get(name) ?? null,
    })
  }
  out.sort((a, b) => b.cur - a.cur)
  out.forEach((r, i) => { r.rank = i + 1 })
  return out
}

// ── 家族榜单(方案A,spec §B/W3):仅左列榜单按家族根名聚合重排;KPI/Top20/散点口径不动 ──
export interface FamilyRow {
  root: string; cur: number
  /** 本期有 s10 流水的成员数(>1 才显「含N户」徽标) */
  memberCount: number
  /** 主租户:根自身在本期截面则取根,否则取本期金额最大的成员;点击家族行降级选中该户 */
  mainName: string
  phase: number; rank: number
}

/** 按家族根名把本期金额加总重排(s10 金额加总,无净额口径问题);familyMap 见 anaFamily。 */
export function buildFamilyRows(rows: TenantRow[], familyMap: Map<string, string>): FamilyRow[] {
  const acc = new Map<string, TenantRow[]>()
  for (const r of rows) {
    const root = familyRootOf(familyMap, r.name)
    acc.set(root, [...(acc.get(root) ?? []), r])
  }
  const out: FamilyRow[] = [...acc.entries()].map(([root, members]) => {
    const main = members.find((m) => m.name === root) ?? members.reduce((a, b) => (b.cur > a.cur ? b : a))
    return { root, cur: members.reduce((s, m) => s + m.cur, 0), memberCount: members.length, mainName: main.name, phase: main.phase, rank: 0 }
  })
  out.sort((a, b) => b.cur - a.cur)
  out.forEach((r, i) => { r.rank = i + 1 })
  return out
}

export interface ParkBand { mean: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] }

/** 园区均值带:逐月对「该月有记录的租户」求均值±1σ(lo 截 0;该月无任何租户 → null)。 */
export function buildParkBand(rows: TenantRow[], months: string[]): ParkBand {
  const mean: (number | null)[] = [], lo: (number | null)[] = [], hi: (number | null)[] = []
  for (const m of months) {
    const vs = rows.filter((r) => r.vals.has(m)).map((r) => r.vals.get(m) as number)
    if (!vs.length) { mean.push(null); lo.push(null); hi.push(null); continue }
    const mn = aMean(vs), sd = aStd(vs)
    mean.push(+mn.toFixed(0))
    lo.push(+Math.max(0, mn - sd).toFixed(0))
    hi.push(+(mn + sd).toFixed(0))
  }
  return { mean, lo, hi }
}

/** 选中租户逐月序列(缺月 = null,不补 0)。 */
export function tenantSeries(row: TenantRow | null, months: string[]): (number | null)[] {
  return months.map((m) => (row?.vals.has(m) ? +(row.vals.get(m) as number).toFixed(0) : null))
}

/** 主图读数句:选中租户本期 vs 跨户区间(cur/lo/hi 任一缺 → 闭嘴,不写占位句)。 */
export function bandReadout(cur: number | null, lo: number | null, hi: number | null, metricLabel: string): string | null {
  if (cur == null || lo == null || hi == null) return null
  const pos = cur > hi ? '高于' : cur < lo ? '低于' : '落在'
  return `${metricLabel}${pos}跨户区间 ¥${fint(lo)}~¥${fint(hi)}`
}

// ── 散点对数轴数据准备(spec §T2):log 下金额≤0 无法取对数 → 过滤并披露计数;线性全量原样 ──
export function splitLogPoints<T>(rows: T[], valueOf: (r: T) => number, log: boolean): { shown: T[]; hidden: number } {
  if (!log) return { shown: rows, hidden: 0 }
  const shown = rows.filter((r) => valueOf(r) > 0)
  return { shown, hidden: rows.length - shown.length }
}

export interface PayRow { name: string; recv: number; coll: number; bal: number; rate: number; status: 'normal' | 'partial' | 'none' }

/** 台账某期各户应收/实收/期末结余(v1 payRows 语义原样,按租户名跨公司聚合)。 */
export function buildPayRows(ledgerRows: AnalysisLedgerRow[], ledgerYm: string): PayRow[] {
  const ymOf = (r: AnalysisLedgerRow): string => `${r.year}-${String(r.month).padStart(2, '0')}`
  const m = new Map<string, { recv: number; coll: number; bal: number }>()
  for (const r of ledgerRows) {
    if (ymOf(r) !== ledgerYm) continue
    const acc = m.get(r.tenantName) ?? { recv: 0, coll: 0, bal: 0 }
    acc.recv += r.receivable; acc.coll += r.collected; acc.bal += r.balanceEnd
    m.set(r.tenantName, acc)
  }
  return [...m.entries()].map(([name, v]) => ({
    name, recv: v.recv, coll: v.coll, bal: v.bal,
    rate: v.recv ? +((v.coll / v.recv) * 100).toFixed(1) : 0,
    status: v.bal <= 0.005 ? 'normal' as const : v.coll > 0 ? 'partial' as const : 'none' as const,
  }))
}
