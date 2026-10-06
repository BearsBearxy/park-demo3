// src/views/analysis/cockpit.logic.ts — 驾驶舱数据变换纯函数(铁律⑦:屏内变换抽出单测)。
// 输入均为 anaData 既有聚合器返回值:只做取期/折万/整形,**不改数字口径**。
// 2026-10 改稿(画板 cockpit-month-v2 ×3 / cockpit-year-v2)的整块在文件末尾 monthBoard / yearBoard。
import type { AnaAnomaly, CollectRate, PnlSummary, S10PhaseMonthly } from '@/analysis/anaData'
import { matchBudgetKey } from '@/analysis/budget'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'
import { hues, inkA } from '@/components/ana/anaFmt'
import { CALLOUT, anaPalette, bandSeries, calloutMark } from '@/components/ana/anaTheme'
import * as S from '@/components/ana/anaSentence'

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
 *  否则 ≤所选的最近覆盖月,更早无 → 最早覆盖月。回退时调用方必须在期间选择旁标出(FPStateTag,禁静默)。 */
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

/** 单板块 12 月趋势(万,只取有数月;点构成条弹层用)。 */
export function schedTrend(pnl: PnlSummary | null, key: string): { labels: string[]; vals: number[] } {
  const labels: string[] = [], vals: number[] = []
  const arr = pnl?.bySchedule[key]?.rev ?? []
  arr.forEach((v, i) => { if (v != null) { labels.push(i + 1 + '月'); vals.push(wan(v)!) } })
  return { labels, vals }
}

// 期区名(layout.ts phase 4 = 宿舍区;FPPhaseTabs / FPTenantPicker 同)
export const PHASE_ZH = ['一期', '二期', '三期', '宿舍']

// ── 欠费清单(点收缴率条弹层:该期 租户Σ应收−Σ实收 > 0,降序;company 给了只看那家公司的台账) ──
export interface ArrearsRow { name: string; company: string; recv: number; coll: number; arr: number }
export function arrearsOf(ledger: AnalysisLedgerRow[], ym: string, company?: string | null): { rows: ArrearsRow[]; total: number } {
  const by = new Map<string, { recv: number; coll: number; company: string; mx: number }>()
  for (const r of ledger) {
    if (r.year + '-' + String(r.month).padStart(2, '0') !== ym || (company && r.companyName !== company)) continue
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

/** 当年收入预算(总表「收入总计」行)。 */
export function budgetRevenueOf(budgetRows: BudgetRowDTO[], year: number): number | null {
  return budgetRows.find((r) => r.year === year && matchBudgetKey(r.label, r.sub) === 'revenue')?.budget ?? null
}

/** 年粒度损益的可用月(1-12):有收入数的月。 */
export function pnlYearMonths(pnl: PnlSummary | null): number[] {
  const rev = pnl?.revenue ?? []
  // 用户 2026-09-12 拍板:「用户是什么数据就使用什么数据」,拟合 / 全年 / 达成率全部算进去。
  // 改前这里还有一个 `!isOutlierMonth(rev, m)`,把收入为负的月份从**所有**年度口径里摘掉
  // (拟合、营收合计、成本、利润、达成率、按节奏推全年、回测,全走这一个函数)。
  // 只保留「这个月有没有录入」这一条 —— null 是没有数,不是一个值。
  return rev.map((_, i) => i + 1).filter((m) => rev[m - 1] != null)
}

/**
 * t 分布双侧 80% 分位(单侧 0.90)按自由度查表。
 *
 * ⚠ 这张表原来只有 df 1~9,查不到就 `return null`,**整条带消失**。后果不是「保守」,是无声:
 * 拟合月份一满 11 个(df=9)以上 —— 比如一个 12 个月都干净的年份 —— 带子就不画了,屏上什么
 * 提示都没有。用户 2026-09-12 的要求是「不管中几次都显示预测带」,这种因为查表查不到而
 * 静默消失的行为首先得去掉。补到 df 30,再往上用正态极限 1.2816(df>30 时两者差 <1%)。
 */
const T80: Record<number, number> = {
  1: 3.078, 2: 1.886, 3: 1.638, 4: 1.533, 5: 1.476, 6: 1.440, 7: 1.415, 8: 1.397, 9: 1.383,
  10: 1.372, 11: 1.363, 12: 1.356, 13: 1.350, 14: 1.345, 15: 1.341, 16: 1.337, 17: 1.333,
  18: 1.330, 19: 1.328, 20: 1.325, 21: 1.323, 22: 1.321, 23: 1.319, 24: 1.318, 25: 1.316,
  26: 1.315, 27: 1.314, 28: 1.313, 29: 1.311, 30: 1.310,
}
const T80_INF = 1.2816   // 正态极限
export function t80(df: number): number | null {
  if (df < 1) return null           // 少于 3 个拟合点,没有残差自由度,这时候是真的算不出
  return T80[df] ?? T80_INF
}
export interface FitBand { month: number; mid: number; lo: number; hi: number }

// ═════════════ 2026-10 改稿:按月 = 选中那个月里面的事;按年 = 这一年逐月 + 和往年比 ═════════════
// 画板 cockpit-month-v2(-m06/-m11) · cockpit-year-v2。算法照抄出稿脚本 cockpit-v2/build.mjs;
// 屏上每一句都从句型库(anaSentence)出,这里只算数、挑项、拼 ECharts option。钱一律先折成万再交给句型库。

const CK = S.CK
const w4 = (v: number | null | undefined): number | null => (v == null ? null : v / 1e4)
const r1 = (v: number): number => Math.round(v * 10) / 10
const rr = (v: number | null): number | null => (v == null ? null : r1(v))
const sumN = (a: (number | null)[]): number => a.reduce<number>((s, v) => s + (v ?? 0), 0)
const ym2 = (y: number, m: number): string => `${y}-${String(m).padStart(2, '0')}`
const lastOf = <T>(a: T[]): T | undefined => a[a.length - 1]
const moneyTip = (v: unknown): string => (typeof v === 'number' ? S.yuan(v) : '—')
const pctTip = (v: unknown): string => (typeof v === 'number' ? v.toFixed(1) + '%' : '—')

/** 板块:损益表附表 → 名字(画板顺序)。往年从预算表「收入总计」下面的子行按科目名归进来。 */
export const CK_SEGS: [string, string][] = [['租金', 's1'], ['用电', 's2'], ['运营配套', 's4'], ['用水', 's3']]
const segOfBudget = (label: string): string =>
  (label.includes('租金') ? '租金' : label.includes('电费') ? '用电' : label.includes('水费') ? '用水' : '运营配套')

// ── 期间 ──
const yearsOf = (yms: string[]): number[] => [...new Set(yms.map((m) => +m.slice(0, 4)))].sort((a, b) => a - b)
const countIn = (yms: string[], y: number): number => yms.filter((m) => m.startsWith(y + '-')).length
/** 按月:所选月损益表没数 → 整页显示 ≤ 所选月的最近有数月;更早都没有 → null(整页空状态)。
 *  只往前退,不拿以后的月顶替(对抗复查 10-05:选 2024年10月曾显示 2025年1月的数;同用能与缴费 te2-ask 4)。 */
export function pnlShownYm(pnlYms: string[], sel: string): string | null {
  const le = pnlYms.filter((m) => m <= sel).sort()
  return le.length ? le[le.length - 1] : null
}
/** 最近一个损益表 12 个月录满的年;一年都没录满 → 最近有数的年。 */
export function fullPnlYear(pnlYms: string[]): number | null {
  const ys = yearsOf(pnlYms).reverse()
  return ys.find((y) => countIn(pnlYms, y) >= 12) ?? ys[0] ?? null
}
/** 按年(cv2-ask 7,用户 2026-10-05 照推荐):所选年有数就画它;0 个月 → null(整页空状态 + 「看 2025年」,不画 0 柱)。
 *  不再分「默认 / 亲手选」两条路:那样同一个选择因来路不同(驾驶舱页签开没开过)一会儿回退一会儿空(10-05 第二轮复查)。
 *  默认落到哪一年由期间单例管(进分析层默认停在最近有损益数据的月,即 2025 年)。 */
export function pnlShownYear(pnlYms: string[], sel: number): number | null {
  return countIn(pnlYms, sel) > 0 ? sel : null
}

// ── 预测区间与回测站:用 m 之前录了的月算 m 月,标准 OLS 预测区间,t 双侧 80% ──
// 全精度算,只在落字时舍(句型库):先把斜率 / 残差舍到 0.01 再乘,画板上 4月末 787.9、9月末 888.6
// 会差成 788.0、888.7。
export function revBandAt(revWan: (number | null)[], m: number): FitBand | null {
  const pts = revWan.slice(0, m - 1).flatMap((y, i) => (y == null ? [] : [{ x: i + 1, y }]))
  const n = pts.length, t = t80(n - 2)
  if (n < 3 || !t) return null
  const xb = pts.reduce((s, q) => s + q.x, 0) / n, yb = pts.reduce((s, q) => s + q.y, 0) / n
  const sxx = pts.reduce((s, q) => s + (q.x - xb) ** 2, 0)
  if (!sxx) return null
  const slope = pts.reduce((s, q) => s + (q.x - xb) * (q.y - yb), 0) / sxx, ic = yb - slope * xb
  const se = Math.sqrt(pts.reduce((s, q) => s + (q.y - ic - slope * q.x) ** 2, 0) / (n - 2))
  const mid = ic + slope * m, half = t * se * Math.sqrt(1 + 1 / n + (m - xb) ** 2 / sxx)
  return { month: m, mid, lo: mid - half, hi: mid + half }
}
export interface Station { target: number; hit: boolean; b: FitBand; a: number }
/** 回测站:站 v = 用 1..v 月算 v+1 月(训练 ≥ 3 个月);不晚于所选月 M 的最近 6 站。 */
export function stationsUpTo(revWan: (number | null)[], M: number): Station[] {
  const st: Station[] = []
  for (let v = 3; v <= M && v < 12; v++) {
    const b = revBandAt(revWan, v + 1), a = revWan[v]
    if (b && a != null) st.push({ target: v + 1, hit: a >= b.lo && a <= b.hi, b, a })
  }
  return st.slice(-6)
}

// ── 图的零件 ──
/** 数值轴:按可见值取整到 step 的倍数;bars 时把 0 包进来。 */
function axisOf(vals: (number | null | undefined)[], step: number, bars = true): { min?: number; max?: number; interval?: number } {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x))
  if (bars) v.push(0)
  if (!v.length) return {}
  return { min: Math.floor(Math.min(...v) / step) * step, max: Math.ceil(Math.max(...v) / step) * step, interval: step }
}
const goalMark = (target: number, position: string): object => {
  const c = anaPalette().cmp.baseline
  return { silent: true, symbol: 'none', lineStyle: { color: c, type: 'dashed', width: 1 }, label: { position, formatter: S.goalLine(target), color: c, fontSize: 11 } }
}
const goalColor = (v: number, target: number): string => (v >= target ? hues().blue : hues().amber)   // 橙只给没到目标
const blueMark = (coord: number[], text: string): object => calloutMark(CALLOUT.blue, hues().blue, [{ coord, lines: [text] }])
const pctLabel = (q: { value: number }): string => q.value.toFixed(1) + '%'

/** 横向成对条:上期浅、本期实;上期整体没数只画本期;负值照实往左画。只给读数句点到的那一项标数(S-45)。 */
export function pairBarsOption(cats: string[], prev: (number | null)[], cur: (number | null)[], prevName: string, curName: string, mark?: string): object {
  const p = anaPalette()
  const all = [...prev, ...cur].filter((v): v is number => v != null)
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all), pad = (hi - lo) * 0.22
  const raw = (hi - lo + 2 * pad) / 4, mag = raw > 0 ? 10 ** Math.floor(Math.log10(raw)) : 1
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag   // 横轴按 1/2/5 取整
  const lab = (color: string) => (v: number | null, x: number) => (v == null || cats[x] !== mark ? v
    : { value: v, label: { show: true, position: v < 0 ? 'left' : 'right', formatter: S.num(v), color, fontSize: 11 } })
  const series = [
    ...(prev.some((v) => v != null) ? [{ name: prevName, type: 'bar', barWidth: 12, barGap: '20%', itemStyle: { color: p.cat[7] }, data: prev.map(lab(p.label)) }] : []),
    { name: curName, type: 'bar', barWidth: 12, itemStyle: { color: p.cat[0] }, data: cur.map(lab(p.legend)) },
  ]
  return {
    legend: { top: 0, data: series.map((s) => s.name) },
    grid: { left: 64, right: 56, top: 30, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: moneyTip },
    xAxis: { type: 'value', min: lo < 0 ? Math.floor((lo - pad) / step) * step : 0, max: Math.ceil((hi + pad) / step) * step, interval: step, axisLabel: { formatter: S.axisWan } },
    yAxis: { type: 'category', inverse: true, data: cats, axisLine: { lineStyle: { color: p.axis } }, axisLabel: { color: p.legend, fontSize: 11 } },
    series,
  }
}

/** 某月台账按管理公司的收缴率(实收 / 应收;应收 ≤ 0 的公司不进),从低到高 —— 同规则引擎 ① 的公司口径。 */
export function coRates(ledger: AnalysisLedgerRow[], ym: string): S.NamedValue[] {
  const by = new Map<string, { recv: number; coll: number }>()
  for (const r of ledger) {
    if (ym2(r.year, r.month) !== ym) continue
    const a = by.get(r.companyName) ?? { recv: 0, coll: 0 }
    a.recv += r.receivable
    a.coll += r.collected
    by.set(r.companyName, a)
  }
  return [...by].filter(([, g]) => g.recv > 0).map(([name, g]) => ({ name, value: (g.coll / g.recv) * 100 })).sort((a, b) => a.value - b.value)
}

// ── KPI 瓦(AnaKpiTile 的 props;副行由句型库写好整段传) ──
export interface Tile { label: string; value: string; dval?: string; ddir?: 'up' | 'dn'; dkey?: string; dtone?: 'up' | 'down'; note?: string }
type Tone = (d: number) => 'up' | 'down' | undefined
// 绿 = 向好;红只给利润下滑;收入、成本差额为负不标红(S-41)
const TONE: Record<'rev' | 'cost' | 'profit', Tone> = { rev: (d) => (d >= 0 ? 'up' : undefined), cost: (d) => (d <= 0 ? 'up' : undefined), profit: (d) => (d >= 0 ? 'up' : 'down') }
function moneyTile(label: string, cur: number | null, d: { d: number; val: string; key: string } | null, tone: Tone): Tile {
  if (cur == null) return { label, value: '—' }
  return d ? { label, value: S.yuan(cur), dval: d.val, ddir: d.d < 0 ? 'dn' : 'up', dkey: d.key, dtone: tone(d.d) } : { label, value: S.yuan(cur) }
}

/** 一张图卡:标题、卡头、图、读数句、参照(参照一行一句);empty = 图画不了时空状态那一句。 */
export interface Card { title: string; hint: string; option: object | null; read: string | null; refs: string[]; empty?: string }

// ═════════ 按月 ═════════
export interface MonthBoardIn {
  pnl: PnlSummary; prevPnl: PnlSummary | null; month: number
  s10: S10PhaseMonthly | null; collects: CollectRate[]; ledger: AnalysisLedgerRow[]; anomalies: AnaAnomaly[]; target: number
}
export interface RuleRow { a: AnaAnomaly; title: string; value: string }
export interface MonthBoard {
  ym: string
  kpis: { rev: Tile; cost: Tile; profit: Tile; rate: Tile }
  fc: Card
  compo: Card
  phase: Card & { phases: number[]; prevYm: string; curName: string }
  coll: Card & { tag: string; ym: string | null }
  rules: { hint: string; rows: RuleRow[]; refs: string[] }
  bt: { title: string; hint: string; rows: string[][]; ref: string }
}

/** 营业收入趋势 · 预测:选 M 月预测 M+1 月(12 月看 12 月本身,用 1–11 月算);回测不到 5 次只出点、不画区间。 */
function forecastCard(rev: (number | null)[], M: number, Y: number): { card: Card; bt: MonthBoard['bt'] } {
  const p = anaPalette()
  const yearEnd = M === 12, t = yearEnd ? 12 : M + 1, ti = t - 1
  const st = stationsUpTo(rev, M), drawBand = st.length >= 5
  const bT = revBandAt(rev, t), actual = rev[ti] ?? null
  const bands = new Map(st.map((s) => [s.target, s.b] as [number, FitBand]))
  if (bT) bands.set(t, bT)
  const months = Array.from({ length: t }, (_, x) => S.monthLabel(x + 1))
  const bandAt = (x: number): FitBand | undefined => (drawBand ? bands.get(x + 1) : undefined)
  const bandVals = drawBand ? [...bands.values()].flatMap((b) => [b.lo, b.hi]) : bT ? [bT.mid] : []
  const ax = axisOf([...rev.slice(0, ti), ...bandVals, actual], 150, false)   // 实际值照实画,轴把它包进来
  const bt = S.backtest({ stations: st })
  const fc = S.forecast({ targetLabel: S.monthLabel(t), band: bT, actual, drawBand, trainN: rev.slice(0, ti).filter((v) => v != null).length, actualShown: t === M })
  const series: object[] = [{
    name: CK.rev, type: 'line', symbol: 'circle', symbolSize: 5, z: 3, itemStyle: { color: p.cat[0] }, lineStyle: { width: 2, color: p.cat[0] },
    data: months.map((_, x) => rev[x] ?? null),
    markPoint: fc.mark && actual != null ? blueMark([ti, r1(actual)], fc.mark) : undefined,
  }]
  const legend = [CK.rev]
  if (drawBand && bt.legend) {
    // 全站唯一的带子写法(anaTheme.bandSeries);stackStrategy 'all':下沿为负时也照常叠(默认 samesign 遇负数不叠,带会断)
    series.unshift(...bandSeries(months.map((_, x) => bandAt(x)?.lo ?? null), months.map((_, x) => bandAt(x)?.hi ?? null),
      { name: bt.legend, color: p.band, dp: 1, series: { z: 1, stackStrategy: 'all', itemStyle: { color: inkA(0.18) } } }))
    legend.push(bt.legend)
  } else if (bT) {
    series.push({ name: CK.est, type: 'scatter', z: 4, symbol: 'circle', symbolSize: 9, itemStyle: { color: p.calloutCore, borderColor: p.cat[0], borderWidth: 2 },
      data: months.map((_, x) => (x === ti ? r1(bT.mid) : null)) })
    legend.push(CK.est)
  }
  // 悬停:区间那两条叠起来的线读的是下沿和宽度,不能直接上提示框 —— 只报营业收入 / 预计,区间按月份查回 lo~hi
  const tip = (ps: { seriesName: string; value: unknown; axisValue: string; marker: string; dataIndex: number }[]): string => {
    const b = ps.length ? bandAt(ps[0].dataIndex) : undefined
    return [ps[0]?.axisValue ?? '',
      ...ps.filter((x) => (x.seriesName === CK.rev || x.seriesName === CK.est) && typeof x.value === 'number').map((x) => `${x.marker}${x.seriesName} ${S.yuan(x.value as number)}`),
      ...(b && bt.legend ? [`${bt.legend} ${S.yuanSpan(b.lo, b.hi)}`] : [])].join('<br/>')
  }
  return {
    card: {
      title: yearEnd ? CK.card.fcEnd : CK.card.fc, hint: S.hint(S.yearSpan(Y, 1, t), '万元'),
      option: {
        legend: { top: 0, data: legend },
        grid: { left: 52, right: 16, top: 34, bottom: 26 },
        tooltip: { trigger: 'axis', formatter: tip },
        xAxis: { type: 'category', data: months },
        yAxis: { type: 'value', ...ax, axisLabel: { formatter: S.axisWan } },
        series,
      },
      read: fc.text, refs: [bt.text, yearEnd ? S.yearEndBasis(M) : ''].filter(Boolean),
    },
    // 回测表(S-09 查过有用户拍板,恢复;放首屏以下 S-06)。只验过不到 5 次不画区间:标题不说「这条带」
    bt: { title: drawBand ? CK.card.bt : CK.card.btNoBand, hint: S.hint(S.coverN(st.length, '', '次')), rows: st.map((s) => S.btRow(s.target - 1, s.b, s.a)), ref: S.btBasis },
  }
}

function collCoOption(rows: S.NamedValue[], target: number, low?: S.NamedValue): object {
  const p = anaPalette()
  return {
    grid: { left: 52, right: 40, top: 24, bottom: 22 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: pctTip },
    xAxis: { type: 'value', min: 0, max: Math.max(100, Math.ceil(Math.max(...rows.map((r) => r.value)) / 20) * 20), interval: 20, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), axisLabel: { color: p.legend, fontSize: 11 } },
    series: [{
      name: CK.rate, type: 'bar', barWidth: 16,
      // 只标读数句点到的最低那家(S-45);数标在条外
      data: rows.map((r) => ({ value: r1(r.value), itemStyle: { color: goalColor(r.value, target) },
        label: { show: r === low, position: 'right', formatter: pctLabel, color: p.legend, fontSize: 11 } })),
      markLine: { ...goalMark(target, 'start'), data: [{ xAxis: target }] },
    }],
  }
}

export function monthBoard(d: MonthBoardIn): MonthBoard {
  const { pnl, month: M, target } = d
  const Y = pnl.year, ym = ym2(Y, M)
  // 上个月:1 月比上一年的 12 月(prevPnl)
  const pm = M > 1 ? M - 1 : 12, prevYm = M > 1 ? ym2(Y, pm) : ym2(Y - 1, 12)
  const mL = S.monthLabel(M), pL = S.monthLabel(pm)
  const at = (cur: (number | null)[] | undefined, prevYear: (number | null)[] | undefined) => ({ c: w4(cur?.[M - 1]), p: w4(M > 1 ? cur?.[M - 2] : prevYear?.[11]) })
  const vsP = S.vsLabel(pL)   // 「比11月」,不写「环比」(S-13)
  const dOf = (x: { c: number | null; p: number | null }) => (x.c != null && x.p != null ? { d: x.c - x.p, val: S.dWan(x.c - x.p), key: vsP } : null)
  const rev = at(pnl.revenue, d.prevPnl?.revenue), cost = at(pnl.cost, d.prevPnl?.cost), prof = at(pnl.profit, d.prevPnl?.profit)

  // 收缴率:所选月没台账 → 不晚于它的最近一期,瓦标签和卡头都写出是哪个月
  const cRow = lastOf(d.collects.filter((c) => c.ym <= ym)) ?? null
  const collYm = cRow?.ym ?? null, collFallback = collYm !== ym, collM = collYm ? +collYm.slice(5) : M
  const kpis = {
    rev: moneyTile(CK.rev, rev.c, dOf(rev), TONE.rev),
    cost: moneyTile(CK.cost, cost.c, dOf(cost), TONE.cost),
    profit: moneyTile(CK.profit, prof.c, dOf(prof), TONE.profit),
    rate: cRow
      ? { label: S.tileLabel(CK.rate, collFallback ? S.monthLabel(collM) : ''), value: cRow.rate.toFixed(1) + '%', note: S.vsTarget(cRow.rate, target) }
      : { label: CK.rate, value: '—' },
  }

  // 营业收入构成:四个板块,上月 / 本月并排
  const segPrev = CK_SEGS.map(([, s]) => w4(M > 1 ? pnl.bySchedule[s]?.rev[M - 2] : d.prevPnl?.bySchedule[s]?.rev[11]))
  const segCur = CK_SEGS.map(([, s]) => w4(pnl.bySchedule[s]?.rev[M - 1]))
  const mvCompo = S.movers({ items: CK_SEGS.map(([n], x) => ({ name: n, prev: segPrev[x], cur: segCur[x] })), prevLabel: pL, table: CK.tbl.pnl })
  const compo: Card = {
    title: S.cardTitle(CK.card.compo), hint: S.hint(S.coverN(CK_SEGS.length, '个', '板块'), segPrev.some((v) => v != null) && S.cmpWith(pm), '万元'),
    option: pairBarsOption(CK_SEGS.map(([n]) => n), segPrev.map(rr), segCur.map(rr), pL, mL, mvCompo?.top),
    read: mvCompo?.text ?? null, refs: [],
  }

  // 分期收入(销售收入表按期区,和营业收入分开记)
  const s10 = d.s10, phases = s10?.phases ?? []
  const phAt = (k: string) => phases.map((ph) => (s10?.months.includes(k) ? w4(s10.totals[ph]?.[k]) : null))
  const phPrev = phAt(prevYm), phCur = phAt(ym)
  const hasPrev = phPrev.some((v) => v != null), hasCur = phCur.some((v) => v != null)
  const phName = phases.map((ph) => PHASE_ZH[ph - 1] ?? `${ph}期`)
  const mvPh = hasCur ? S.movers({ items: phases.map((_, x) => ({ name: phName[x], prev: phPrev[x], cur: phCur[x] })), prevLabel: pL, table: S.SOURCE.phaseTable }) : null
  const phase = {
    title: S.cardTitle(CK.card.phase), hint: S.hint(S.coverN(phases.length, '个', '期区'), hasPrev && hasCur && S.cmpWith(pm), '万元'),
    option: hasCur ? pairBarsOption(phName, phPrev.map(rr), phCur.map(rr), pL, mL, mvPh?.top) : null,
    read: mvPh?.text ?? null, refs: [S.SOURCE.phase],
    empty: hasCur ? undefined : S.thin({ table: S.SOURCE.phaseTable, noMonth: mL, cant: CK.card.phase }).text,
    phases, prevYm, curName: mL,
  }

  // 各公司收缴率(台账那一期)
  const rows = collYm ? coRates(d.ledger, collYm) : []
  const gCo = S.goal({ items: rows, target, q: '家' })
  const coll = {
    title: CK.card.coll, tag: collYm && collFallback ? S.fallbackTag(collM) : '', ym: collYm,
    hint: S.hint(S.coverN(rows.length, '家', '管理公司'), CK.tbl.ledger, '%'),
    option: rows.length ? collCoOption(rows, target, gCo?.low) : null,
    read: gCo?.text ?? null, refs: collYm ? [S.SOURCE.coll(S.monthLabel(collM))] : [],
  }

  // 触发的规则:产品规则引擎这个月的命中,产品排序,前 3 条;标题、卡头不带期间(S-17)
  const hits = d.anomalies.filter((a) => a.ym === ym), top = hits.slice(0, 3)
  const rules = {
    hint: S.hint(top.length ? S.ruleTop(top.length) : ''),
    rows: top.map((a) => ({ a, ...S.ruleRow(a) })),
    refs: [S.ruleCount(M, hits.length)?.text, collFallback ? S.thin({ noLedger: mL }).text : undefined].filter((x): x is string => !!x),
  }

  const f = forecastCard(pnl.revenue.map(w4), M, Y)
  return { ym, kpis, fc: f.card, compo, phase, coll, rules, bt: f.bt }
}

// ═════════ 按年 ═════════
export interface YearBoardIn { pnl: PnlSummary; budget: BudgetRowDTO[]; collects: CollectRate[]; target: number }
export interface YearBoard {
  kpis: { rev: Tile; cost: Tile; profit: Tile; budget: Tile; rate: Tile }
  hist: Card; cum: Card; monthly: Card; histCompo: Card; collM: Card
}
/** 往年(早于 Y、预算表录了全年实际的年):营业收入 = 「收入总计」,园区利润 = 「利润总额」,板块 = 收入总计下面的子行。万。 */
function pastYears(budget: BudgetRowDTO[], Y: number): { year: number; rev: number; profit: number; seg: Record<string, number> }[] {
  return [...new Set(budget.map((r) => r.year))].filter((y) => y < Y).sort((a, b) => a - b).flatMap((y) => {
    const rows = budget.filter((r) => r.year === y).sort((a, b) => a.sortOrder - b.sortOrder)
    const i0 = rows.findIndex((r) => matchBudgetKey(r.label, r.sub) === 'revenue')
    const rev = rows[i0]?.actual, profit = rows.find((r) => matchBudgetKey(r.label, r.sub) === 'profit')?.actual
    if (rev == null || profit == null) return []
    const seg: Record<string, number> = Object.fromEntries(CK_SEGS.map(([n]) => [n, 0]))
    for (let i = i0 + 1; i < rows.length && rows[i].sub; i++) seg[segOfBudget(rows[i].label)] += (rows[i].actual ?? 0) / 1e4
    return [{ year: y, rev: rev / 1e4, profit: profit / 1e4, seg }]
  })
}

export function yearBoard(d: YearBoardIn): YearBoard {
  const { pnl, target } = d, Y = pnl.year, p = anaPalette()
  const REV = pnl.revenue.map(w4), COST = pnl.cost.map(w4), PROFIT = pnl.profit.map(w4)
  const past = pastYears(d.budget, Y)
  const YRS = [...past.map((x) => x.year), Y], last = YRS.length - 1, prevY = last > 0 ? YRS[last - 1] : null
  const YREV = [...past.map((x) => x.rev), sumN(REV)]
  const YPROF = [...past.map((x) => x.profit), sumN(PROFIT)]
  const YCOST = [...past.map((x) => x.rev - x.profit), sumN(COST)]   // 往年成本费用 = 营业收入 − 园区利润(参照写明)
  const YSEG: Record<string, number[]> = Object.fromEntries(CK_SEGS.map(([n, s]) => [n, [...past.map((x) => x.seg[n]), sumN((pnl.bySchedule[s]?.rev ?? []).map(w4))]]))
  const yrL = YRS.map(S.yearLabel)
  const MONTHS = Array.from({ length: 12 }, (_, x) => S.monthLabel(x + 1))
  const rec = pnlYearMonths(pnl), nM = lastOf(rec) ?? 0

  // KPI:比上一年
  const vsY = prevY != null ? S.vsLabel(S.yearLabel(prevY)) : ''
  const gOf = (a: number[]) => {
    const b = a[last - 1]
    if (prevY == null || !(b > 0)) return null
    const g = (a[last] / b - 1) * 100
    return { d: g, val: S.signed(g) + '%', key: vsY }
  }
  const tgt = budgetRevenueOf(d.budget, Y), tW = tgt ? tgt / 1e4 : null
  const collRows = d.collects.filter((c) => c.ym.startsWith(Y + '-'))
  const cRecv = sumN(collRows.map((c) => c.receivable)), collRate = cRecv ? (sumN(collRows.map((c) => c.collected)) / cRecv) * 100 : null
  const cm0 = collRows.length ? +collRows[0].ym.slice(5) : 1, cm1 = collRows.length ? +collRows[collRows.length - 1].ym.slice(5) : 1
  const kpis = {
    rev: moneyTile(CK.rev, YREV[last], gOf(YREV), TONE.rev),
    cost: moneyTile(CK.cost, YCOST[last], gOf(YCOST), TONE.cost),
    profit: moneyTile(CK.profit, YPROF[last], gOf(YPROF), TONE.profit),
    budget: tW ? { label: CK.budgetHit, value: ((YREV[last] / tW) * 100).toFixed(1) + '%', note: S.vsBudget(YREV[last], tW) } : { label: CK.budgetHit, value: '—' },
    rate: collRate != null
      ? { label: S.tileLabel(CK.rate, S.monthSpan(cm0, cm1)), value: collRate.toFixed(1) + '%', note: S.vsTarget(+collRate.toFixed(1), target) }
      : { label: CK.rate, value: '—' },
  }

  // 历年营业收入、成本费用、园区利润:末年柱头气泡写读数句里的涨幅(金额 = KPI 营业收入,不说两遍 S-14)
  const gr = last > 0 ? S.growth({ firstLabel: yrL[0], lastLabel: yrL[last], metric: CK.rev, first: YREV[0], last: YREV[last] }) : null
  const src = past.length ? S.SOURCE.history(past[0].year, past[past.length - 1].year, Y) : ''
  const hist: Card = {
    title: CK.card.hist, hint: S.hint(S.coverN(YRS.length, '', '年'), '万元'),
    option: {
      legend: { top: 0, data: [CK.rev, CK.cost, CK.profit] },
      grid: { left: 60, right: 16, top: 34, bottom: 26 },
      tooltip: { trigger: 'axis', valueFormatter: moneyTip },
      xAxis: { type: 'category', data: yrL },
      yAxis: { type: 'value', ...axisOf([...YREV, ...YCOST, ...YPROF], 2000), axisLabel: { formatter: S.axisWan } },
      series: [
        { name: CK.rev, type: 'bar', barWidth: 34, barGap: '15%', itemStyle: { color: p.cat[0] }, data: YREV.map(r1), markPoint: gr ? blueMark([last, r1(YREV[last])], gr.mark) : undefined },
        { name: CK.cost, type: 'bar', barWidth: 34, itemStyle: { color: p.seq[2] }, data: YCOST.map(r1) },
        { name: CK.profit, type: 'line', symbol: 'circle', symbolSize: 6, lineStyle: { width: 1.5, color: p.seq[3] }, itemStyle: { color: p.seq[3] }, data: YPROF.map(r1) },
      ],
    },
    read: gr?.text ?? null, refs: [src, past.length ? S.SOURCE.costBasis(past[0].year, past[past.length - 1].year) : ''].filter(Boolean),
  }

  // 累计营业收入和全年预算:达成率在 KPI 上(S-14),句子只说累计怎么走
  let acc = 0
  const cumAt = MONTHS.map((_, x) => { const v = REV[x]; return v == null ? null : (acc += v) })
  const CUM = rec.map((m) => cumAt[m - 1] as number)
  const pt = tW && CUM.length ? S.ptd({ cum: CUM, labels: rec.map(S.monthLabel), target: tW, targetName: CK.budget, noPct: true }) : null
  const cum: Card = {
    title: CK.card.cum, hint: S.hint(S.yearCover(Y, 1, nM), '万元'),
    option: {
      grid: { left: 60, right: 14, top: 22, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: moneyTip },
      xAxis: { type: 'category', data: MONTHS, boundaryGap: false },
      yAxis: { type: 'value', ...axisOf([...CUM, tW], 2500), axisLabel: { formatter: S.axisWan } },
      series: [{
        name: CK.rev, type: 'line', symbol: 'circle', symbolSize: 5, connectNulls: true, itemStyle: { color: p.cat[0] }, lineStyle: { width: 2, color: p.cat[0] },
        areaStyle: { color: p.cat[0], opacity: 0.08 }, data: cumAt.map(rr),
        markLine: tW ? { silent: true, symbol: 'none', lineStyle: { color: p.cmp.baseline, type: 'dashed', width: 1 },
          label: { position: 'insideStartTop', formatter: S.budgetLine(tW), color: p.cmp.baseline, fontSize: 11 }, data: [{ yAxis: r1(tW) }] } : undefined,
        markPoint: pt ? blueMark([nM - 1, r1(CUM[CUM.length - 1])], pt.mark) : undefined,
      }],
    },
    read: pt?.text ?? null, refs: [],
  }

  // 各月营业收入和园区利润:只给读数句点到的最高、最低两根标数(S-45)
  const ex = S.extremes({ metric: CK.rev, items: rec.map((m) => ({ label: S.monthLabel(m), value: REV[m - 1] as number })), q: '个月' })
  const peak = new Set(ex ? [...ex.his, ...ex.los].map((i) => i.label) : [])
  const monthly: Card = {
    title: CK.card.monthly, hint: S.hint(S.yearCover(Y, 1, nM), '万元'),
    option: {
      legend: { top: 0, data: [CK.rev, CK.profit] },
      grid: { left: 52, right: 16, top: 34, bottom: 26 },
      tooltip: { trigger: 'axis', valueFormatter: moneyTip },
      xAxis: { type: 'category', data: MONTHS },
      yAxis: { type: 'value', ...axisOf([...REV, ...PROFIT], 300), axisLabel: { formatter: S.axisWan } },
      series: [
        { name: CK.rev, type: 'bar', barWidth: 30, z: 2, itemStyle: { color: p.cat[0] },
          data: REV.map((v, x) => (v == null ? null : !peak.has(MONTHS[x]) ? r1(v)
            : { value: r1(v), label: { show: true, position: v < 0 ? 'bottom' : 'top', formatter: S.yuan(v), color: p.legend, fontSize: 11 } })) },
        { name: CK.profit, type: 'line', symbol: 'circle', symbolSize: 5, z: 3, itemStyle: { color: p.seq[3] }, lineStyle: { width: 1.5, color: p.seq[3] }, data: PROFIT.map(rr) },
      ],
    },
    read: ex?.text ?? null, refs: [],
  }

  // 历年营业收入构成:读数句点到的那一段(本年占比最大的板块)标占比
  const big = CK_SEGS.map(([n]) => n).reduce((a, b) => (YSEG[b][last] > YSEG[a][last] ? b : a))
  // 上一年预算表没拆板块(子行全空)时比不了占比,不出句
  const sh = prevY != null && YREV[last - 1] && YREV[last] && CK_SEGS.some(([n]) => YSEG[n][last - 1] > 0)
    ? S.share({ name: big, total: CK.rev, prevLabel: S.yearLabel(prevY), curLabel: yrL[last], a: (YSEG[big][last - 1] / YREV[last - 1]) * 100, b: (YSEG[big][last] / YREV[last]) * 100 })
    : null
  const RAMP = [p.cat[5], p.cat[0], p.cat[6], p.cat[7]]
  const histCompo: Card = {
    title: CK.card.histCompo, hint: S.hint(S.coverN(YRS.length, '', '年'), '万元'),
    option: {
      legend: { top: 0 },
      grid: { left: 60, right: 16, top: 30, bottom: 24 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: moneyTip },
      xAxis: { type: 'category', data: yrL },
      yAxis: { type: 'value', ...axisOf(YREV, 2500), axisLabel: { formatter: S.axisWan } },
      series: CK_SEGS.map(([n], i) => ({
        name: n, type: 'bar', stack: 's', barWidth: 44, itemStyle: { color: RAMP[i] },
        data: YSEG[n].map(r1).map((v, x) => (sh && n === big && x === last ? { value: v, label: { show: true, position: 'right', formatter: sh.mark, color: p.legend, fontSize: 11 } } : v)),
      })),
    },
    read: sh?.text ?? null, refs: [src].filter(Boolean),
  }

  // 各月收缴率:时间在横轴,只标读数句点到的最低那个月(S-45)
  const mr = MONTHS.map((_, x) => collRows.find((c) => +c.ym.slice(5) === x + 1)?.rate ?? null)
  const gM = S.goal({ items: collRows.map((c) => ({ name: S.monthLabel(+c.ym.slice(5)), value: c.rate })), target, q: '个月' })
  const collM: Card = {
    title: CK.card.collM, hint: S.hint(collRows.length > 0 && S.yearCover(Y, cm0, cm1), CK.tbl.ledger, '%'),
    option: collRows.length ? {
      grid: { left: 44, right: 12, top: 22, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: pctTip },
      xAxis: { type: 'category', data: MONTHS },
      yAxis: { type: 'value', ...axisOf(mr, 30), axisLabel: { formatter: '{value}%' } },
      series: [{
        name: CK.rate, type: 'bar', barWidth: 18,
        data: mr.map((v, x) => (v == null ? null : { value: v, itemStyle: { color: goalColor(v, target) },
          label: { show: MONTHS[x] === gM?.low.name, position: 'top', formatter: pctLabel, color: p.legend, fontSize: 11 } })),
        markLine: { ...goalMark(target, 'insideEndTop'), data: [{ yAxis: target }] },
      }],
    } : null,
    read: gM?.text ?? null, refs: collRows.length ? [S.SOURCE.coll('各月')] : [],
  }

  return { kpis, hist, cum, monthly, histCompo, collM }
}
