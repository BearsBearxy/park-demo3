// src/views/analysis/cockpit.logic.ts — 驾驶舱 v2 数据变换纯函数(铁律⑦:屏内变换抽出单测)。
// 输入均为 anaData 既有聚合器返回值:只做取期/折万/整形,**不改数字口径**(数值锚点与 v1 一致:
// 2025-10 营收 930.2万 / 收缴率 81.3%,SQL 回验见 dataChecks)。
//
// I3(对抗复查,2026-09-11 实测 park_demo3):这一行原来写着「达成率改为 ~105.6%」,
// 那个数从计划里一路被转述成源码注释、文件头锚点和提交标题,**没有人查过**。实测:
//   Σ m1..m11 = 88,358,126.19   m12 = −636,050.65   预算(收入总计) = 92,705,202.87
//   含 12 月 87,722,075.54 / 92,705,202.87 = 94.62%;剔 12 月 88,358,126.19 / … = 95.31%
// 也就是 94.6% → 95.3%,**涨 0.69 个点、方向相同、从不越过 100%**。8,800 万的基数里拿掉
// 63.6 万,本来也不可能动 11 个点。护栏本身是对的,它的自述价值是错的。
// 这两个率由 cockpit.logic.spec.ts 的「I3 实测量级」用例钉住,再写谎会当场红。
import { isOutlierMonth, usableMonths, type CollectRate, type PnlSummary, type S10PhaseMonthly } from '@/analysis/anaData'
import { matchBudgetKey } from '@/analysis/budget'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'
import { fint } from '@/components/ana/anaFmt'

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
  outlierMonths: number[]          // 离群月(1-12,收入为负);只管点怎么画(标红/markPoint),不参与量程
  yMin: number | undefined         // y 轴下限:usableMonths 挑出的月里 rev/profit 的最小值(含 0);无可用值 → undefined 交 ECharts 自动定
}
export function mainChart(pnl: PnlSummary | null, budgetYearAmount: number | null): MainChartData | null {
  if (!pnl) return null
  const labels = Array.from({ length: 12 }, (_, i) => i + 1 + '月')
  const rev = pnl.revenue.map(wan)
  const profit = pnl.profit.map(wan)
  const prevRev = rev.map((_, i) => (i > 0 ? rev[i - 1] : null))
  const outlierMonths = pnl.months.filter((m) => isOutlierMonth(pnl.revenue, m))
  // 量程只看可用月(FORECAST §2.7):usableMonths 剔掉离群月,不被 2025-12 那种极端负值拉爆。
  // usableMonths 的「全离群→原样返回」兜底是给分母消费者(budgetAch 等)保的,不能为 0;
  // 量程消费者的需求正相反 —— 全离群时轴不该被钉在被污染月的极端值上,该放弃 yMin 交 ECharts 自动定。
  // 所以这里在调 usableMonths 之前先把「全离群」这个退化场景摘出来,不指望共享兜底替量程操心。
  const allOutlier = pnl.months.length > 0 && outlierMonths.length === pnl.months.length
  const usableVals = allOutlier ? [] : usableMonths(pnl.months, pnl.revenue)
    .flatMap((m) => [rev[m - 1], profit[m - 1]])
    .filter((v): v is number => v != null)
  return {
    labels, rev, profit, prevRev,
    budgetAvgWan: budgetYearAmount != null ? +(budgetYearAmount / 12 / 10000).toFixed(1) : null,
    covered: pnl.months.length,
    outlierMonths,
    yMin: usableVals.length ? Math.min(0, ...usableVals) : undefined,
  }
}

// ── 收入构成(s1~s4 板块,当期;>0 降序,与 v1 compo 同口径) ──
export const SEG: [string, string][] = [['s1', '租金'], ['s2', '用电'], ['s3', '用水'], ['s4', '运营配套']]
export interface CompoItem { key: string; label: string; value: number }
/**
 * N1(对抗复查修复轮2):年粒度按 months(= 调用方的 pnlYearMonths)过滤,与 KPI 营收合计
 * (atPnlPeriod)共用同一批月份 —— 改前这里走的是不剔离群月的 atPeriod,同一屏上「营收合计」
 * 与「收入构成合计」是两个不同的数(差的正是被剔掉那个离群月),环图图例百分比的基数也因此对不上
 * 表头。I4 把三个损益读数搬到 pnlYearMonths 口径,这里是被漏掉的第四个。
 */
export function compoData(pnl: PnlSummary | null, isMonth: boolean, mi: number, months: number[]): CompoItem[] {
  if (!pnl) return []
  return SEG.map(([key, label]) => ({ key, label, value: atPnlPeriod(pnl.bySchedule[key]?.rev, isMonth, mi, months) ?? 0 }))
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
    // 取期标注紧凑化(2026-07-20 用户反馈:逐月枚举「1月/2月/…/10月」冗长看不懂):
    // 连续月区间 →「1-10月」;单月 →「3月」;有断月 →「N期」
    const mis = ys.map((c) => +c.ym.slice(5))
    const consecutive = mis.every((m, i) => i === 0 || m === mis[i - 1] + 1)
    const ymLabel = mis.length === 1 ? `${mis[0]}月` : consecutive ? `${mis[0]}-${mis[mis.length - 1]}月` : `${mis.length}期`
    return { ym: ymLabel, rate: recv ? (coll / recv) * 100 : 0 }
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

// ── 经营结论条(spec 2026-07-11 §A:数据模板生成分句,无写死结论;缺哪块数据省哪句) ──
// 取数全复用本屏既有取值函数(atPeriod/colPick/budgetAch),不另立聚合口径。
export interface ConclusionItem { text: string; tone: 'good' | 'watch' | 'risk' | 'neutral'; link?: string }
export function buildConclusion(
  pnl: PnlSummary | null,
  collects: CollectRate[],
  budgetRows: BudgetRowDTO[],
  ledgerRows: AnalysisLedgerRow[],
  anomalyCount: number,
  settings: { collectTarget: number },
  period: { isMonth: boolean; year: number; usedMi: number; ym: string | null },
): ConclusionItem[] {
  const { isMonth, year, usedMi, ym } = period
  const out: ConclusionItem[] = []
  const fw = (v: number): string => (v < 0 ? '−¥' : '¥') + fint(Math.abs(v) / 10000) + '万'

  // 收入利润句:取期同 KPI;预算达成为年度口径,仅年粒度并入(月收入配年达成会混期)。
  // I4:年粒度下收入/利润与达成率共用 pnlYearMonths —— 这句话里的三个数摆在一起,
  // 读者会拿收入除以预算、拿利润除以收入,分别对上达成率和利润率。用不同月份集算,
  // 除出来的数和印出来的数对不上(实测:收入含 12 月冲回、达成率不含,一除得 94.6% 而非 95.3%)。
  const yearMonths = pnlYearMonths(pnl)
  const rev = atPnlPeriod(pnl?.revenue, isMonth, usedMi, yearMonths)
  const prof = atPnlPeriod(pnl?.profit, isMonth, usedMi, yearMonths)
  const ach = isMonth ? null : budgetAch(budgetRows, pnl, year)
  if (rev != null) {
    let text = `${isMonth ? `${year}年${usedMi + 1}月` : `${year}年`}收入 ${fw(rev)}`
      + (ach ? `(预算达成 ${ach.rate.toFixed(1)}%)` : '')
    if (prof != null) text += `,园区利润 ${fw(prof)}` + (rev ? `(利润率 ${((prof / rev) * 100).toFixed(1)}%)` : '')
    const tone: ConclusionItem['tone'] =
      prof != null && prof < 0 ? 'risk' : ach && ach.rate < 100 ? 'watch' : prof != null || ach ? 'good' : 'neutral'
    out.push({ text, tone })
  }

  // 收缴句:取期与 KPI 完全同参(所选月 ym,非 pnl 月锚——两者回退语义不同,复审①);
  // 期末欠费 = 最新台账月 Σ balanceEnd>0(与 fin-cashflow KPI 同口径),台账缺则省略该分句
  const cp = colPick(collects, isMonth, year, ym)
  if (cp) {
    const below = cp.rate < settings.collectTarget
    let text = `收缴率 ${cp.rate.toFixed(1)}% ${below ? '低于' : '达到'}目标 ${settings.collectTarget}%`
    const latest = ledgerRows.reduce<string>((mx, r) => {
      const k = `${r.year}-${String(r.month).padStart(2, '0')}`
      return k > mx ? k : mx
    }, '')
    const arrears = ledgerRows.reduce((s, r) =>
      s + (`${r.year}-${String(r.month).padStart(2, '0')}` === latest && r.balanceEnd > 0 ? r.balanceEnd : 0), 0)
    if (arrears > 0) text += `,期末欠费 ${fw(arrears)}`
    out.push({ text, tone: below ? 'watch' : 'good' })
  }

  // 异常句:0 条也报(规则引擎无异常=good);经营数据全缺时结论条整体无意义 → []
  if (!out.length) return []
  out.push(anomalyCount > 0
    ? { text: `${anomalyCount} 条异常待处理`, tone: 'watch', link: '/anomaly' }
    : { text: '规则引擎无异常', tone: 'good' })
  return out
}

// ── 预算达成(v1 budgetAch 原样抽出:预算行=当年收入总计,实际=pnl 收入年Σ) ──
export interface BudgetAch { budget: number; actual: number; rate: number; gap: number; usedMonths: number[] }

/**
 * 年粒度损益的可用月(1-12):有收入数、且不是离群月。
 *
 * I4(对抗复查):抽出来是为了让**同一张卡上并排出现的数落在同一批月份上** ——
 * 达成率分母与营收/成本/利润取期共用这一个函数,不各算一份。改前 budgetAch 剔了 2025-12
 * 的年末冲回、atPeriod 却把它加进营收合计,于是卡上印着「营收 ¥8,772万」与「预算达成 95.3%」,
 * 读者拿这两个数一除得到的是 94.6%,两个数没有一个错、摆在一起就是错的。
 */
export function pnlYearMonths(pnl: PnlSummary | null): number[] {
  const rev = pnl?.revenue ?? []
  return rev.map((_, i) => i + 1).filter((m) => rev[m - 1] != null && !isOutlierMonth(rev, m))
}

/**
 * 年粒度损益取期:只累计 months 里的月;月粒度与 atPeriod 完全一致(离群月护栏是年度合计的事,
 * 单月卡就是要看那个月本身 —— 12 月点开就该看见那笔冲回,不是看见一片空白)。
 */
export function atPnlPeriod(
  arr: (number | null)[] | undefined, isMonth: boolean, mi: number, months: number[],
): number | null {
  if (isMonth) return atPeriod(arr, true, mi)
  return atPeriod(arr?.map((v, i) => (months.includes(i + 1) ? v : null)), false, mi)
}

export function budgetAch(budgetRows: BudgetRowDTO[], pnl: PnlSummary | null, year: number): BudgetAch | null {
  const b = budgetRows.find((r) => r.year === year && matchBudgetKey(r.label, r.sub) === 'revenue')?.budget
  if (!b) return null
  const rev = pnl?.revenue ?? []
  // 达成率分母排除离群月:2025-12 的年末冲回(收入 −63.6 万)无条件加进来会把达成率从
  // 95.31% 压到 94.62%(实测,见文件头 I3)。护栏的价值是「不让一笔冲回冒充一个经营月」,
  // 不是「把达成率抬过 100%」—— 它抬不动,方向也没反。
  const used = pnlYearMonths(pnl)
  if (!used.length) return null
  const actual = used.reduce((s, m) => s + (rev[m - 1] as number), 0)
  return { budget: b, actual, rate: (actual / b) * 100, gap: b - actual, usedMonths: used }
}

/** 月份区间小字(1-11月 / 单月 3月);月份列表为空 → ''。 */
export function monthRangeLabel(months: number[]): string {
  if (!months.length) return ''
  return months.length > 1 ? `${months[0]}-${months[months.length - 1]}月` : `${months[0]}月`
}

/**
 * N2(对抗复查修复轮2):预算达成小字。
 *
 * `budgetAch` 不吃 isMonth —— 达成率永远是年度口径,不随所选粒度变化。改前的 note 却接的是
 * 「月粒度下强制清空」的 pnlRange,于是默认(月粒度)打开驾驶舱看到 `¥9,271万 · `,
 * 分隔符后面什么都没有,而这个率覆盖哪几个月屏上从头到尾没说。这里改用 ach.usedMonths
 * 自己的区间(不借 isMonth 清空),范围为空时(理论上不会发生:budgetAch 非 null 时
 * usedMonths 必非空)连分隔符一起省掉,不留半句。
 */
export function achNoteText(ach: BudgetAch | null, budgetText: string, year: number): string {
  if (!ach) return `${year}年未导入预算`
  const range = monthRangeLabel(ach.usedMonths)
  return range ? `${budgetText} · ${range}` : budgetText
}
