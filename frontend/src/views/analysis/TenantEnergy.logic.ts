// TenantEnergyView(用能与缴费)数据变换纯函数(v2 铁律⑦:抽出单测,不碰 DOM/ECharts)。
// 口径:s10 = 销售收入表费用金额(元),电=基本+标准+维护电费、水=标准+维护水费;台账应收/实收/期末结余沿 AnalysisLedgerRow。
// 2026-10 改稿(画布 tenant-energy-v2 七块板):期间只往前回退(pastYm,不拿未来的月顶替);按年 = 这一年有数的月合计(yearRows)。
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { familyRootOf } from '@/analysis/anaFamily'
import { mean as aMean, quantile, std as aStd } from '@/components/ana/anaFmt'

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

/** ≤ end 的最近一月;前面一个月都没有 → null(改稿:只往前回退,2024年12月不拿 2025年1月顶替)。ms 升序。 */
export function pastYm(ms: string[], end: string): string | null {
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i] <= end) return ms[i]
  return null
}
export const prevYm = (ym: string): string => {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** 按年:这一年有数的几个月,每户合计(有一个月有数就进),按合计降序。 */
export function yearRows(tenantMap: Map<string, AnalysisS10Row[]>, months: string[], metric: 'elec' | 'water'): { name: string; cur: number; vals: Map<string, number> }[] {
  const set = new Set(months)
  const out: { name: string; cur: number; vals: Map<string, number> }[] = []
  for (const [name, rs] of tenantMap) {
    const vals = new Map<string, number>()
    for (const r of rs) if (set.has(r.acctMonth)) vals.set(r.acctMonth, (vals.get(r.acctMonth) ?? 0) + (metric === 'elec' ? r.elec : r.water))
    if (vals.size) out.push({ name, cur: [...vals.values()].reduce((a, b) => a + b, 0), vals })
  }
  return out.sort((a, b) => b.cur - a.cur)
}

/** 主卡一根条:pick = 点这根条选中哪一户(按家族时是主租户)。 */
export interface Bar { name: string; cur: number; prev: number | null; pick: string }

/** 按家族(07-11 方案A,开关挪到主卡卡头):成员本期、上期分别加总重排;
 *  主租户 = 根自身在截面里取根,否则取本期最大的成员(点家族条选中它)。 */
export function familyBars(bars: Bar[], familyMap: Map<string, string>): Bar[] {
  const acc = new Map<string, Bar[]>()
  for (const b of bars) {
    const root = familyRootOf(familyMap, b.name)
    const g = acc.get(root)
    if (g) g.push(b); else acc.set(root, [b])
  }
  return [...acc].map(([root, ms]) => ({
    name: root,
    cur: ms.reduce((s, m) => s + m.cur, 0),
    prev: ms.every((m) => m.prev == null) ? null : ms.reduce((s, m) => s + (m.prev ?? 0), 0),
    pick: (ms.find((m) => m.name === root) ?? ms.reduce((a, b) => (b.cur > a.cur ? b : a))).name,
  })).sort((a, b) => b.cur - a.cur)
}

/** 全园中间一半:逐月对「该月这项费用大于 0 的户」取 P25/P50/P75;不足 20 户的月不建 key
 *  (同异常提醒中心 monitor.logic 的灰带,那边只算电费、不带 P50)。 */
export interface Quart { p25: number; p50: number; p75: number; n: number }
export function parkQuartiles(tenantMap: Map<string, AnalysisS10Row[]>, metric: 'elec' | 'water'): Record<string, Quart> {
  const by = new Map<string, number[]>()
  for (const rs of tenantMap.values()) {
    const m = new Map<string, number>()
    for (const r of rs) m.set(r.acctMonth, (m.get(r.acctMonth) ?? 0) + (metric === 'elec' ? r.elec : r.water))
    for (const [ym, v] of m) {
      if (!(v > 0)) continue
      const a = by.get(ym)
      if (a) a.push(v); else by.set(ym, [v])
    }
  }
  const out: Record<string, Quart> = {}
  for (const [ym, vs] of by) if (vs.length >= 20) out[ym] = { p25: quantile(vs, 0.25), p50: quantile(vs, 0.5), p75: quantile(vs, 0.75), n: vs.length }
  return out
}

/** 一户的台账逐期(几家公司相加,升序,只取 ≤ upto 的期);end = 期末结余(collect 的 balEnd,te2-ask 16)。 */
export function tenantPeriods(ledgerRows: AnalysisLedgerRow[], name: string, upto: string): { ym: string; recv: number; coll: number; end: number }[] {
  const by = new Map<string, { ym: string; recv: number; coll: number; end: number }>()
  for (const r of ledgerRows) {
    if (r.tenantName !== name) continue
    const ym = `${r.year}-${String(r.month).padStart(2, '0')}`
    if (ym > upto) continue
    const a = by.get(ym) ?? { ym, recv: 0, coll: 0, end: 0 }
    a.recv += r.receivable; a.coll += r.collected; a.end += r.balanceEnd
    by.set(ym, a)
  }
  return [...by.values()].sort((a, b) => a.ym.localeCompare(b.ym))
}

/** 按年「各户期末欠费变动」(te2-ask 6):读数句点到的那户比其余各户最大的值还大 4 倍以上时,单独一行写数、不画条,
 *  横轴只按其余几户定。返回要单独写的那户名,不需要时 null。
 *  ponytail: 4 倍是看图定的(火炬 2,164.8 万 vs 其余最大约 200 万);要改成按像素算条宽再说 */
export function moverOutlier(rows: { name: string; prev: number; cur: number }[], top: string | null | undefined): string | null {
  const t = rows.find((r) => r.name === top)
  if (!t || rows.length < 2) return null
  const rest = Math.max(0, ...rows.filter((r) => r !== t).map((r) => Math.max(r.prev, r.cur)))
  return Math.max(t.prev, t.cur) > 4 * rest ? t.name : null
}

// ── 散点对数轴数据准备(spec §T2):log 下金额≤0 无法取对数 → 过滤并披露计数;线性全量原样(park.logic 转出口给出租屏用) ──
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
