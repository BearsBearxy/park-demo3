// src/views/analysis/cockpit.logic.ts — 驾驶舱 v2 数据变换纯函数(铁律⑦:屏内变换抽出单测)。
// 输入均为 anaData 既有聚合器返回值:只做取期/折万/整形,**不改数字口径**(数值锚点与 v1 一致:
// 2025-10 营收 930.2万 / 收缴率 81.3% / 2025 预算达成 94.6%,SQL 回验见 dataChecks)。
import type { CollectRate, PnlSummary, S10PhaseMonthly } from '@/analysis/anaData'
import { matchBudgetKey } from '@/analysis/budget'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'

const wan = (v: number | null): number | null => (v == null ? null : +(v / 10000).toFixed(2))

/** 期间取值:月=当月;年=有数月Σ;缺月保持 null 不补 0(v1 atPeriod 原样抽出为纯函数)。 */
export function atPeriod(arr: (number | null)[] | undefined, isMonth: boolean, mi: number): number | null {
  if (!arr) return null
  if (isMonth) return arr[mi] ?? null
  let sum = 0, has = false
  for (const v of arr) if (v != null) { sum += v; has = true }
  return has ? sum : null
}

/** §五策略2 月锚回退:covered = pnl.months(1-12 升序);所选月已覆盖/无覆盖 → 原月;
 *  否则 ≤所选的最近覆盖月,更早无 → 最早覆盖月。回退时调用方必须渲染 AnaPeriodBanner(禁静默)。 */
export function anchorMonth(covered: number[], want: number): number {
  if (!covered.length || covered.includes(want)) return want
  const le = covered.filter((m) => m <= want)
  return le.length ? le[le.length - 1] : covered[0]
}

/** 环比 = 对比上一有数月(v1 mom 原样抽出;年粒度/无当月值 → null)。 */
export function momOf(arr: (number | null)[] | undefined, isMonth: boolean, mi: number): number | null {
  if (!arr || !isMonth) return null
  const cur = arr[mi]
  if (cur == null) return null
  for (let i = mi - 1; i >= 0; i--) {
    const p = arr[i]
    if (p != null) return p ? (cur / p - 1) * 100 : null
  }
  return null
}

// ── 主图:收入柱+利润线(万) + 环比虚线(上月收入右移一格) + 预算月均(年预算/12) ──
export interface MainChartData {
  labels: string[]                 // '1月'..'12月'
  rev: (number | null)[]           // 万
  profit: (number | null)[]        // 万
  prevRev: (number | null)[]       // 上月收入右移一格(万,对比开关=环比时叠加)
  budgetAvgWan: number | null      // 年预算/12(万;无预算 → null)
  covered: number                  // 覆盖期数(诚实标注)
}
export function mainChart(pnl: PnlSummary | null, budgetYearAmount: number | null): MainChartData | null {
  if (!pnl) return null
  const labels = Array.from({ length: 12 }, (_, i) => i + 1 + '月')
  const rev = pnl.revenue.map(wan)
  const profit = pnl.profit.map(wan)
  const prevRev = rev.map((_, i) => (i > 0 ? rev[i - 1] : null))
  return {
    labels, rev, profit, prevRev,
    budgetAvgWan: budgetYearAmount != null ? +(budgetYearAmount / 12 / 10000).toFixed(1) : null,
    covered: pnl.months.length,
  }
}

// ── 收入构成(s1~s4 板块,当期;>0 降序,与 v1 compo 同口径) ──
export const SEG: [string, string][] = [['s1', '租金'], ['s2', '用电'], ['s3', '用水'], ['s4', '运营配套']]
export interface CompoItem { key: string; label: string; value: number }
export function compoData(pnl: PnlSummary | null, isMonth: boolean, mi: number): CompoItem[] {
  if (!pnl) return []
  return SEG.map(([key, label]) => ({ key, label, value: atPeriod(pnl.bySchedule[key]?.rev, isMonth, mi) ?? 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** 单板块 12 月趋势(万,只取有数月;构成环点扇区弹层用)。 */
export function schedTrend(pnl: PnlSummary | null, key: string): { labels: string[]; vals: number[] } {
  const labels: string[] = [], vals: number[] = []
  const arr = pnl?.bySchedule[key]?.rev ?? []
  arr.forEach((v, i) => { if (v != null) { labels.push(i + 1 + '月'); vals.push(wan(v)!) } })
  return { labels, vals }
}

// ── 分期收入堆叠(s10 期别×月,万;点击深链附表10) ──
export const PHASE_ZH = ['一期', '二期', '三期', '四期', '五期', '六期']
export interface PhaseStackData { months: string[]; series: { phase: number; name: string; data: (number | null)[] }[] }
export function phaseStack(ph: S10PhaseMonthly | null): PhaseStackData | null {
  if (!ph || !ph.months.length) return null
  return {
    months: ph.months,
    series: ph.phases.map((p) => ({
      phase: p,
      name: PHASE_ZH[p - 1] ?? p + '期',
      data: ph.months.map((m) => wan(ph.totals[p]?.[m] ?? null)),
    })),
  }
}

// ── 收缴率取期(v1 colPick 原样抽出:月=取 ≤当前月最近一期;年=并该年各期) ──
export function colPick(collects: CollectRate[], isMonth: boolean, year: number, ym: string | null): { ym: string; rate: number } | null {
  if (!collects.length) return null
  if (!isMonth) {
    const ys = collects.filter((c) => c.ym.startsWith(year + '-'))
    if (!ys.length) return null
    const recv = ys.reduce((s, c) => s + c.receivable, 0)
    const coll = ys.reduce((s, c) => s + c.collected, 0)
    return { ym: ys.map((c) => +c.ym.slice(5) + '月').join('/'), rate: recv ? (coll / recv) * 100 : 0 }
  }
  const le = collects.filter((c) => c.ym <= (ym ?? ''))
  return le.length ? { ym: le[le.length - 1].ym, rate: le[le.length - 1].rate } : null
}

// ── 欠费清单(收缴率条点击弹层:该期 租户Σ应收−Σ实收 > 0,降序) ──
export interface ArrearsRow { name: string; company: string; recv: number; coll: number; arr: number }
export function arrearsOf(ledger: AnalysisLedgerRow[], ym: string): { rows: ArrearsRow[]; total: number } {
  const by = new Map<string, { recv: number; coll: number; company: string; mx: number }>()
  for (const r of ledger) {
    if (r.year + '-' + String(r.month).padStart(2, '0') !== ym) continue
    const acc = by.get(r.tenantName) ?? { recv: 0, coll: 0, company: '', mx: -1 }
    acc.recv += r.receivable
    acc.coll += r.collected
    if (r.receivable > acc.mx) { acc.mx = r.receivable; acc.company = r.companyName }
    by.set(r.tenantName, acc)
  }
  const rows = [...by.entries()]
    .map(([name, v]) => ({ name, company: v.company, recv: v.recv, coll: v.coll, arr: v.recv - v.coll }))
    .filter((r) => r.arr > 0.005)
    .sort((a, b) => b.arr - a.arr)
  return { rows, total: rows.reduce((s, r) => s + r.arr, 0) }
}

/** 当年收入预算(总表「收入总计」行;主图 markLine=该值/12)。 */
export function budgetRevenueOf(budgetRows: BudgetRowDTO[], year: number): number | null {
  return budgetRows.find((r) => r.year === year && matchBudgetKey(r.label, r.sub) === 'revenue')?.budget ?? null
}

// ── 预算达成(v1 budgetAch 原样抽出:预算行=当年收入总计,实际=pnl 收入年Σ) ──
export interface BudgetAch { budget: number; actual: number; rate: number; gap: number }
export function budgetAch(budgetRows: BudgetRowDTO[], pnl: PnlSummary | null, year: number): BudgetAch | null {
  const b = budgetRows.find((r) => r.year === year && matchBudgetKey(r.label, r.sub) === 'revenue')?.budget
  if (!b) return null
  const vals = (pnl?.revenue ?? []).filter((v): v is number => v != null)
  if (!vals.length) return null
  const actual = vals.reduce((s, v) => s + v, 0)
  return { budget: b, actual, rate: (actual / b) * 100, gap: b - actual }
}
