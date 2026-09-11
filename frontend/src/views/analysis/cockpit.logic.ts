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
import { isOutlierMonth, type CollectRate, type PnlSummary, type S10PhaseMonthly } from '@/analysis/anaData'
import { bandSeries } from '@/components/ana/anaTheme'
import { matchBudgetKey } from '@/analysis/budget'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { BudgetRowDTO } from '@/api/budget'
import type { CompareMode } from '@/analysis/useCompare'
import { CMP_BASELINE, CMP_BUDGET, fint, fnum } from '@/components/ana/anaFmt'

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
  yMin: number | undefined         // y 轴下限:所有录入月里 rev/profit 的最小值(含 0);一个月都没录 → undefined 交 ECharts 自动定
}
export function mainChart(pnl: PnlSummary | null, budgetYearAmount: number | null): MainChartData | null {
  if (!pnl) return null
  const labels = Array.from({ length: 12 }, (_, i) => i + 1 + '月')
  const rev = pnl.revenue.map(wan)
  const profit = pnl.profit.map(wan)
  const prevRev = rev.map((_, i) => (i > 0 ? rev[i - 1] : null))
  const outlierMonths = pnl.months.filter((m) => isOutlierMonth(pnl.revenue, m))
  // 量程罩住所有录入了的月(2026-09-12:柱子画的是真值,轴就不能把它切掉)。
  // 改前这里用 usableMonths 剔掉负收入月,轴到 0 为止,那根负柱子被画在轴外。
  const usableVals = pnl.months
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
  // 用户 2026-09-12 拍板:「用户是什么数据就使用什么数据」,拟合 / 全年 / 达成率全部算进去。
  // 改前这里还有一个 `!isOutlierMonth(rev, m)`,把收入为负的月份从**所有**年度口径里摘掉
  // (拟合、营收合计、成本、利润、达成率、按节奏推全年、回测,全走这一个函数)。
  // 只保留「这个月有没有录入」这一条 —— null 是没有数,不是一个值。
  return rev.map((_, i) => i + 1).filter((m) => rev[m - 1] != null)
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
  // 达成率分母 = 所有录入了的月(2026-09-12 起不再排除负收入月,见 pnlYearMonths)。
  // 实测后果照实记:2025 达成率从 95.31% 变成 94.62%,与「屏上旧值」那一档相同,
  // 所以那块对照瓦同时删掉了 —— 两个数已经是同一个数,并排印着只会让人以为哪里算错了。
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

/**
 * F3(修复轮1,design-boards):覆盖表派给 T1 的文案 ——「预算达成」瓦标题按稿补齐覆盖区间
 * (稿:「预算达成(1–11 月)」)。区间取 ach.usedMonths 实测值,不写死「1–11」——换年、
 * 换离群月都可能不是 1-11 月,写死到明年就是假话。
 */
export function achLabelText(ach: BudgetAch | null): string {
  return ach ? `预算达成(${monthRangeLabel(ach.usedMonths)})` : '预算达成'
}

/**
 * F3(修复轮1,design-boards):「N 期收入」瓦的 note 按稿改成「N 期,已剔 M 月」(稿:「11 期,
 * 已剔 12 月」)。N = 训练月数(yearMonths.length),M = 被剔月份(outlierMonths,可能不止一个);
 * 都是实测,不写死「12」—— 那正是 F4 要修的同一种坑。月粒度下没有覆盖区间可印,回落 fallback
 * (调用方传 pnlRange,与其余两瓦的 note 同源)。
 */
export function revNoteText(isMonth: boolean, yearMonths: number[], outlierMonths: number[], fallback: string): string | undefined {
  if (isMonth) return undefined
  if (!yearMonths.length) return fallback || undefined
  return `${yearMonths.length}期` + (outlierMonths.length ? `,已剔${outlierMonths.join('、')}月` : '')
}

// ── T1/T2(design-boards 2026-09-11,驾驶舱护栏):月度收入 OLS 拟合 —— 全屏唯一一份 ──
// 结构决定(任务书原话):KPI 瓦(按节奏推全年/月均增速)与主图(趋势线/拟合区间/离群残差倍数)
// 必须读同一份 fit,不许各自再拟合一次 —— 两套实现算同一条回归,是「增速与线对不上」这类缺陷的根源
// (前序分支刚修过同类问题,见文件头 I3/I4)。x=月序(1..12),y=该月收入(万);训练集=pnlYearMonths,
// 与预算达成/构成环共用同一批月(离群/缺月不进训练)。训练点 <3 → 拟合没有意义,返回 null。
export interface RevenueFit {
  months: number[]              // 训练月(升序;供上层拼「参照 X-Y 月拟合」,不必重算)
  slope: number                 // 万/月
  intercept: number             // 万(月序=0 处的截距)
  r2: number                    // 拟合优度(0~1)
  fitted: (number | null)[]     // 12 长度:intercept+slope×月序,训练/外推月都算
  residualScale: number         // 残差标准差(万;自由度 = 训练点数−2;<3 点时为 0)
}
export function fitRevenueTrend(pnl: PnlSummary | null): RevenueFit | null {
  if (!pnl) return null
  const months = pnlYearMonths(pnl)
  const n = months.length
  if (n < 3) return null
  const ys = months.map((m) => wan(pnl.revenue[m - 1]) as number)
  const xbar = months.reduce((a, b) => a + b, 0) / n
  const ybar = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (months[i] - xbar) * (ys[i] - ybar)
    sxx += (months[i] - xbar) ** 2
    syy += (ys[i] - ybar) ** 2
  }
  const slope = sxx ? sxy / sxx : 0
  const intercept = ybar - slope * xbar
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0
  // fitted 用未四舍五入的 slope/intercept 算,只在落盘时才 toFixed —— 12 月那一格外推值
  // 若先拿舍入过的斜率去乘,乘以 12 的误差会被放大到看得见(958 万那一档的量级经不起二次舍入)。
  const fitted = Array.from({ length: 12 }, (_, i) => +(intercept + slope * (i + 1)).toFixed(2))
  let ssRes = 0
  for (let i = 0; i < n; i++) ssRes += (ys[i] - (intercept + slope * months[i])) ** 2
  const residualScale = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0
  return { months, slope: +slope.toFixed(2), intercept: +intercept.toFixed(2), r2: +r2.toFixed(4), fitted, residualScale: +residualScale.toFixed(2) }
}

/** KPI「按节奏推全年」:训练月用实际值、其余月(离群/未覆盖)用拟合值补齐,Σ12月 ÷ 预算。 */
export interface PaceKpi { totalWan: number; rate: number | null }
export function paceFullYear(pnl: PnlSummary | null, fit: RevenueFit | null, budgetYuan: number | null): PaceKpi | null {
  if (!pnl || !fit) return null
  const used = new Set(fit.months)
  let total = 0
  for (let m = 1; m <= 12; m++) total += (used.has(m) ? wan(pnl.revenue[m - 1]) : fit.fitted[m - 1]) ?? 0
  total = +total.toFixed(2)
  return { totalWan: total, rate: budgetYuan ? (total * 10000 / budgetYuan) * 100 : null }
}



/** 离群月相对拟合值的残差倍数(主图标注 + 读数句共用同一个数,不各算一份)。 */
export interface OutlierResidual { month: number; actualWan: number; residuals: number }
export function outlierResidual(fit: RevenueFit | null, revWan: (number | null)[], outlierMonths: number[]): OutlierResidual | null {
  if (!fit || !fit.residualScale || !outlierMonths.length) return null
  const month = outlierMonths[0]
  const actualWan = revWan[month - 1]
  const fitted = fit.fitted[month - 1]
  if (actualWan == null || fitted == null) return null
  return { month, actualWan, residuals: Math.abs(actualWan - fitted) / fit.residualScale }
}

/**
 * 离群点相对拟合值的残差倍数 —— 按点各算各的,不像 outlierResidual 那样固定认第一个月。
 *
 * F4(design-boards 修复轮1):主图 markPoint 给每个离群月都钉一根 pin,改前 label 的 formatter
 * 是一句固定文案(取的是 outlierResidual(...)的 outlierMonths[0]),同年若有两个离群月,两根 pin
 * 会显示同一个数字(都是第一个月的倍数)。这里逐月各算一份;读数句/参照系小字(outlierReadout/
 * outlierRefText)结构上只讲「一个」离群月(2025 也确实只有一个),不受影响,继续用 outlierResidual
 * 的单点版本 —— 两个函数不是重复,是「讲一个月的句子」与「给每根 pin 各自标数」两件不同的事。
 */
export function outlierResidualsByMonth(
  fit: RevenueFit | null, revWan: (number | null)[], outlierMonths: number[],
): Map<number, number> {
  const out = new Map<number, number>()
  if (!fit || !fit.residualScale) return out
  for (const month of outlierMonths) {
    const actualWan = revWan[month - 1]
    const fitted = fit.fitted[month - 1]
    if (actualWan != null && fitted != null) out.set(month, Math.abs(actualWan - fitted) / fit.residualScale)
  }
  return out
}

/** 读数句(门禁 anaCopyLint ≤30 可见字):月份+实际值+离几倍残差(取整 —— 「倍」本就是概数)。 */
export function outlierReadout(fit: RevenueFit | null, o: OutlierResidual | null): string | null {
  if (!fit || !o) return null
  const sign = o.actualWan < 0 ? '−' : ''
  return `${o.month}月收入 ${sign}${fint(Math.abs(o.actualWan))}万，离${monthRangeLabel(fit.months)}的正常波动 ${Math.floor(o.residuals)}倍残差`
}

/** 参照系小字(门禁 anaCopyLint ≤28 可见字):训练区间 + 残差绝对值(万);判据细节留给口径浮层。 */
export function outlierRefText(fit: RevenueFit | null): string {
  if (!fit) return ''
  return `参照${monthRangeLabel(fit.months)}拟合 · 残差${fint(fit.residualScale)}万`
}

/**
 * 拟合区间(仅用来抓离群,不许在屏上说成「能兜住未来」——稿注:滚动回测 5 次中 2 次,标百分比是编的)。
 * 标准 OLS 预测区间公式:t(双侧80%,自由度=训练点数−2) × 预测标准误。
 * t 表只铺到 df=9 —— 月度收入训练点撑死 11(=12个月刨掉1个离群月),df 到不了两位数,再宽用不到
 * (ponytail:这是有意的封顶,月度收入拟合以外的场景要更大 df 得先扩表)。
 */
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
export function fitBandAt(fit: RevenueFit | null, month: number): FitBand | null {
  if (!fit) return null
  const n = fit.months.length
  const t = t80(n - 2)
  if (!t) return null
  const mid = fit.fitted[month - 1]
  if (mid == null) return null
  const xbar = fit.months.reduce((a, b) => a + b, 0) / n
  const sxx = fit.months.reduce((s, x) => s + (x - xbar) ** 2, 0)
  if (!sxx) return null
  const se = fit.residualScale * Math.sqrt(1 + 1 / n + (month - xbar) ** 2 / sxx)
  const half = t * se
  return { month, mid, lo: +(mid - half).toFixed(2), hi: +(mid + half).toFixed(2) }
}

/**
 * F1(对抗复查,adversarial-survived.md):主图(趋势线/拟合区间 markArea/离群 markPoint)原先整段
 * 写在 CockpitView.vue 的 <script setup> computed 里——没有抽成纯函数,也没有挂载测摸得到 option
 * 对象,vitest/tsc/anaCopyLint 全绿情况下整段删掉、markArea 的 formatter 清空、markPoint 退回
 * 固定文案都不会被抓到。照姊妹图(expiry.logic.ts 的 rentRollOption、TenantPeer.logic.ts 的
 * unitRentHistOption)抽成纯函数,cockpit.logic.spec.ts 直接测 option 对象里的三块交付物。
 */
const OUTLIER_RED = '#E24B4A'   // 同 breakeven.logic.ts RED(统一主题语义红)
export function mainChartOption(
  d: MainChartData | null, outlierResByMonth: Map<number, number>, cmpMode: CompareMode,
): object | null {
  if (!d || !d.covered) return null
  const yMin = d.yMin
  const revData = d.rev.map((v, i) => (d.outlierMonths.includes(i + 1) ? { value: v, itemStyle: { color: OUTLIER_RED } } : v))
  const series: object[] = [
    {
      name: '收入', type: 'bar', data: revData, barMaxWidth: 26, itemStyle: { borderRadius: [3, 3, 0, 0] },
      markPoint: d.outlierMonths.length ? {
        symbol: 'pin', symbolSize: 30, itemStyle: { color: OUTLIER_RED },
        label: {
          fontSize: 10, color: '#fff',
          // F4(修复轮1):逐点各取自己月份的残差倍数(outlierResByMonth)——改前是一句固定文案
          // (取 outlierMonths[0]),真有两个离群月时,两根 pin 会显示同一个数字。
          formatter: (p: { data: { month?: number } }) => {
            const r = p.data.month != null ? outlierResByMonth.get(p.data.month) : undefined
            return r != null ? `离群\n${Math.floor(r)}倍残差` : '离群'
          },
        },
        data: d.outlierMonths.map((m) => ({ coord: [m - 1, yMin ?? 0], month: m })),
      } : undefined,
      markLine: d.budgetAvgWan != null ? {
        silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: CMP_BUDGET },
        // 图表清晰化 §1:标签画在绘图区内,不许被图边裁切
        label: { position: 'insideEndTop', formatter: `预算月均 ${d.budgetAvgWan}万`, fontSize: 11, color: CMP_BUDGET },
        data: [{ yAxis: d.budgetAvgWan }],
      } : undefined,
    },
    { name: '利润', type: 'line', data: d.profit, smooth: true, symbolSize: 5, connectNulls: true, itemStyle: { color: '#185FA5' } },
  ]
  if (cmpMode === 'mom') {
    series.push({ name: '上月收入', type: 'line', data: d.prevRev, lineStyle: { type: 'dashed', width: 1.5 }, itemStyle: { color: CMP_BASELINE }, symbol: 'none', connectNulls: true })
  }
  if (cmpMode === 'budget' && d.budgetAvgWan != null) {
    series.push({ name: '预算月均', type: 'line', data: d.labels.map(() => d.budgetAvgWan), lineStyle: { type: 'dashed', width: 1.5, color: CMP_BUDGET }, itemStyle: { color: CMP_BUDGET }, symbol: 'none' })
  }
  // 趋势线与拟合区间 2026-09-12 搬去 trendChartOption(用户:「现在完全看不见」)——
  // 这张图是 0 起的柱图,三条线只能挤在柱顶那一小段里。理由见那个函数的头注。
  return {
    grid: { left: 52, right: 18, top: 32, bottom: 42 },
    legend: { top: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : fnum(v) + '万') },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 12, bottom: 6, borderColor: 'transparent' }],
    xAxis: { type: 'category', data: d.labels },
    yAxis: { type: 'value', min: yMin, axisLabel: { formatter: '{value}万' } },
    series,
  }
}



/**
 * 整条拟合区间(每个月一个上下沿),不是只有离群月那一列。
 *
 * 改前:屏上只在**离群月**那一列画一个色块,判据是 `outlierRes ? fitBandAt(...) : null` ——
 * 没有离群月的年份,这条带一整年都不出现。加上上面 T80 查不到就返回 null 那条,
 * 一共两道让带子**静默消失**的门,都跟「准不准」无关,纯粹是实现留下的。
 * 用户 2026-09-12:「我不管你中几次都显示预测带」。两道都拆掉:只要拟合得出来就整年都画。
 *
 * 带宽随离拟合中心的距离变宽(se 里的 (month−xbar)²/sxx 那一项),外推月自然比中间月宽,
 * 这正是它该有的形状 —— 一条等宽的带才是假的。
 */
export function fitBandAll(fit: RevenueFit | null): { lo: (number | null)[]; hi: (number | null)[] } | null {
  if (!fit) return null
  const lo: (number | null)[] = []
  const hi: (number | null)[] = []
  let any = false
  for (let m = 1; m <= fit.fitted.length; m++) {
    const b = fitBandAt(fit, m)
    lo.push(b ? b.lo : null)
    hi.push(b ? b.hi : null)
    if (b) any = true
  }
  return any ? { lo, hi } : null
}

/**
 * 「收入趋势 · 拟合区间」独立图(用户 2026-09-12:「把趋势、拟合区间和已录入折线拆出来新开一个
 * 可视化,现在完全看不见」)。
 *
 * 拆的理由是实测量级:主图是 0 起的柱图,2025 年 1–11 月收入在 714~941 万之间,波动幅度只占
 * 轴高的两成多,趋势线的斜率(月均 +25.8 万)与拟合区间的宽度在屏上都读不出来。
 *
 * 两处与主图不同,都是为了让波动看得见,也都只在这张图成立:
 * ① y 轴 `scale: true`,不从 0 起。这张图里**没有柱子** —— 截断轴会放大的是面积,而这里只有
 *    线的位置,位置本来就得照轴刻度读。主图有柱子,原样保持 0 起,不动。
 * ② 离群月不进折线(填 null,留一个看得见的断口)。−64 万那一个点会把 700~940 这段压成平线,
 *    正是用户说的「完全看不见」。它的真实值不藏:那一列照标竖线,标签写值与「离群」。
 */
export function trendChartOption(
  d: MainChartData | null, fit: RevenueFit | null,
  band: { lo: (number | null)[]; hi: (number | null)[] } | null,
): object | null {
  if (!d || !d.covered || !fit) return null
  // 用户 2026-09-12:「用户是什么数据就使用什么数据」。改前这里把收入为负的月份换成 null,
  // 屏上留一个断口 —— 那是替用户判断他的数据该不该出现。现在**原样画**,一个月都不剔。
  // 代价照实说:12 月 −64 万进了量程,1–11 月那段 714~941 万的波动又被压回去一截。
  const revLine = d.rev
  const series: object[] = [
    {
      name: '已录入', type: 'line', data: revLine, symbolSize: 6, connectNulls: false,
      lineStyle: { width: 2, color: '#378ADD' }, itemStyle: { color: '#378ADD' },
      // 竖线只标位置,不带标签 —— 标签原本写在这里,和拟合区间的 997/958/919 落在同一列,
      // 屏上两行字叠成一团(用户截图可见)。文字改由 trendOutlierHint 出到卡头 hint,
      // 那里有整行的宽度,且不会跟图里任何东西抢位置。

    },
    {
      name: '趋势', type: 'line', data: fit.fitted, symbol: 'none',
      lineStyle: { type: 'dashed', width: 1.5, color: '#9CA3AF' }, z: 2,
    },
  ]
  // 整年一条带,不再是离群月那一列的色块 —— 见 fitBandAll 头注。
  if (band) series.push(...bandSeries(band.lo, band.hi, { name: '拟合区间（未校准）', color: 'rgba(124,58,237,0.10)', dp: 1 }))
  return {
    grid: { left: 52, right: 18, top: 32, bottom: 28 },
    legend: { top: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : fnum(v) + '万') },
    xAxis: { type: 'category', data: d.labels },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: '{value}万' } },
    series,
  }
}

/**
 * 主图口径浮层(F6,对抗复查):原文照稿抄「判据：底带收入行 m12 < 0，全年仅命中 s1 一行」——
 * 月份(m12)、附表(s1)都写死了,而代码里的判据是 isOutlierMonth(anaData.ts:110):对任意月判
 * revenue<0,不分附表、不认哪一行。换年、换离群月、或某年不止一个月离群,这句话就变成假话。
 * 改成由实测的 outlierMonths 驱动,且不再声称"只命中哪张附表的哪一行"——那句本就不是判据本身说的事。
 */
export function mainChartOutlierNote(outlierMonths: number[]): string {
  return `判据：${outlierMonths.join('、')}月收入<0 即判离群（任意附表口径，不锁哪一行）· 带子用来抓离群，不用来押未来`
}

// ── T3(design-boards 2026-09-11):「全年会落在哪」+「这条带过去准不准」两张卡 ──

/** 卡「全年会落在哪」表头小字:预算整数万(与 fint 同风格,不带小数)。 */
export function yearOutlookBudgetHint(budgetYuan: number | null): string {
  return budgetYuan != null ? `预算${fint(budgetYuan / 10000)}万` : ''
}

export interface YearOutlookRow { label: string; totalWan: number; rate: number | null }
/**
 * 「全年会落在哪」四行:按训练月节奏(=paceFullYear,同一个 fit,不再拟合)/ 拟合下沿 / 拟合上沿 /
 * 含离群月冲回(屏上现值,=旧口径 Σ全年实际)。下沿/上沿把 fit 之外的月份换成 fitBandAt 的 lo/hi
 * 再求和(与 paceFullYear 用 fitted 中心值求和是同一种拼法,只是换一个分量)。
 */
export function yearOutlookRows(pnl: PnlSummary | null, fit: RevenueFit | null, budgetYuan: number | null): YearOutlookRow[] | null {
  if (!pnl || !fit) return null
  const pace = paceFullYear(pnl, fit, budgetYuan)
  if (!pace) return null
  // 2026-09-12:不再排除任何月份之后,一个**十二个月全部录入**的年份没有任何一格要靠拟合补 ——
  // 四行会是同一个数,读数句变成「全年在94%上下,不是94.6%」(自己跟自己比)。
  // 这张卡答的是「还没录的月按拟合补,全年会落在哪」,没有要补的格就没有问题要答,闭嘴。
  if (Array.from({ length: 12 }, (_, i) => i + 1).every((m) => fit.months.includes(m))) return null
  const rateOf = (t: number): number | null => (budgetYuan ? (t * 10000 / budgetYuan) * 100 : null)
  let lo = 0, hi = 0, old = 0
  for (let m = 1; m <= 12; m++) {
    const actual = wan(pnl.revenue[m - 1]) ?? 0
    old += actual
    if (fit.months.includes(m)) { lo += actual; hi += actual } else {
      const b = fitBandAt(fit, m)
      lo += b?.lo ?? (fit.fitted[m - 1] ?? 0)
      hi += b?.hi ?? (fit.fitted[m - 1] ?? 0)
    }
  }
  lo = +lo.toFixed(2); hi = +hi.toFixed(2); old = +old.toFixed(2)
  // 第四行原来叫「含 X 月负收入(屏上现值)」—— 负收入月现在**每一行都含**,那个标签不再区分任何东西。
  // 它真正与第一行的差别是:缺月按 0 计,而第一行按拟合补。照这个实际差别命名。
  const untrainedM = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !fit.months.includes(m))
  const oldLabel = `缺 ${untrainedM.join('、')} 月按 0 计`
  return [
    { label: `按${monthRangeLabel(fit.months)}节奏`, totalWan: pace.totalWan, rate: pace.rate },
    { label: '拟合下沿', totalWan: lo, rate: rateOf(lo) },
    { label: '拟合上沿', totalWan: hi, rate: rateOf(hi) },
    { label: oldLabel, totalWan: old, rate: rateOf(old) },
  ]
}

/** 读数句(≤30 可见字):全年落点(向下取整,概数——同 outlierReadout 的「倍」不四舍五入)vs 屏上旧值(精确到 1 位)。 */
export function yearOutlookReadout(rows: YearOutlookRow[] | null): string | null {
  if (!rows || rows.length < 4) return null
  const pace = rows[0].rate, old = rows[3].rate
  if (pace == null || old == null) return null
  return `全年在${Math.floor(pace)}%上下，不是${old.toFixed(1)}%`
}

/**
 * 参照系小字(≤28 可见字):差距是不是「全部」来自冲回月,不敢标百分比——那句解释挪去 AnaMethodNote。
 *
 * F6(对抗复查):改前月份写死「12月」——换年、换离群月就是假话。现在月份由 outlierMonths(与
 * yearOutlookRows 里算 oldLabel 用的是同一条 isOutlierMonth 判据)现算。「全部」这个措辞也不再
 * 无条件说:它只在「未训练的月份(fit.months 之外)恰好等于离群月集合」时成立——一旦某年还缺一个
 * 月(既不离群、也没数据),差额里就混进了缺月那份,继续说「全部来自冲回」就是假话,这里改口。
 */
export function yearOutlookRefText(rows: YearOutlookRow[] | null, pnl: PnlSummary | null, fit: RevenueFit | null): string {
  if (!rows || rows.length < 4 || !pnl || !fit) return ''
  const pace = rows[0].rate, old = rows[3].rate
  if (pace == null || old == null) return ''
  const gap = Math.round(pace - old)
  const outlierMonths = pnl.months.filter((m) => isOutlierMonth(pnl.revenue, m))
  const untrained = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !fit.months.includes(m))
  const onlyOutliers = outlierMonths.length > 0 && untrained.length === outlierMonths.length
    && outlierMonths.every((m) => untrained.includes(m))
  // 2026-09-12:这三句原来都在说「冲回」——那是对数据的解读,而且现在负收入月根本没被摘出去。
  // 差额只可能来自**还没录入**的月(它们在第一行按拟合补,在第四行按 0 计)。
  if (onlyOutliers || !untrained.length) return `差${gap}个百分点来自未录入月`
  return `差${gap}个百分点来自${untrained.join('、')}月按拟合补的部分`
}

/**
 * 「这条带过去准不准」滚动起点回测:与 fitRevenueTrend **不是同一个计算** —— 那个只拟合一次
 * (训练月=全部非离群月);这里在每个站点月末重新只用当时已有的月再拟合一次,再预测下一个月。
 * 复用 fitRevenueTrend 会导致训练集包含尚未发生的未来月,回测就失去意义(任务书原话)。
 * 独立实现(不改 fitRevenueTrend,不共享其内部状态),OLS 公式与其一致。
 */
export function fitRevenueTrendUpTo(pnl: PnlSummary | null, maxMonth: number): RevenueFit | null {
  if (!pnl) return null
  const months = pnlYearMonths(pnl).filter((m) => m <= maxMonth)
  const n = months.length
  if (n < 3) return null
  const ys = months.map((m) => wan(pnl.revenue[m - 1]) as number)
  const xbar = months.reduce((a, b) => a + b, 0) / n
  const ybar = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (months[i] - xbar) * (ys[i] - ybar)
    sxx += (months[i] - xbar) ** 2
    syy += (ys[i] - ybar) ** 2
  }
  const slope = sxx ? sxy / sxx : 0
  const intercept = ybar - slope * xbar
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0
  const fitted = Array.from({ length: 12 }, (_, i) => +(intercept + slope * (i + 1)).toFixed(2))
  let ssRes = 0
  for (let i = 0; i < n; i++) ssRes += (ys[i] - (intercept + slope * months[i])) ** 2
  const residualScale = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0
  return { months, slope: +slope.toFixed(2), intercept: +intercept.toFixed(2), r2: +r2.toFixed(4), fitted, residualScale: +residualScale.toFixed(2) }
}

export interface BacktestRow {
  vantageMonth: number        // 站在哪个月末
  isLast: boolean             // 最新站点(板上「(今天)」后缀)
  predictMid: number          // 下月预测(万,拟合中心值)
  lo: number; hi: number      // 拟合区间(万)
  actualWan: number | null    // 实际(万);null = 待验(下月是离群月/无数据)
  hit: boolean | null         // 命中/落空;null = 待验
  under: boolean | null       // 落空时:true=低估(实际超上沿) false=高估(实际低于下沿)
  missPct: number | null      // 落空时 |实际-预测中心|/预测中心,一位小数
  fullYearRate: number | null // 同时推全年(站在这个月末,用这个月末的 fit 重跑 paceFullYear)
}
/** 最近 6 个站点(不足 6 个训练月则全取):每站只用到当时已有的月,预测下一个月,同时给出那一站推算的全年。 */
export function backtestRows(pnl: PnlSummary | null, budgetYuan: number | null): BacktestRow[] | null {
  if (!pnl) return null
  const vantages = pnlYearMonths(pnl).filter((m) => m < 12).slice(-6)
  if (!vantages.length) return null
  const lastV = vantages[vantages.length - 1]
  const rows: BacktestRow[] = []
  for (const v of vantages) {
    const fit = fitRevenueTrendUpTo(pnl, v)
    const nextM = v + 1
    const band = fit ? fitBandAt(fit, nextM) : null
    if (!fit || !band) return null   // 训练点不足(理论上 v≥3 就够,不该发生)——整表宁可不画也不半拉子
    const rawNext = pnl.revenue[nextM - 1]
    // 2026-09-12:负收入月也进评分 —— 改前它被跳过,那一站永远「待验」,等于挑掉了最难的一次。
    const actualWan = rawNext != null ? wan(rawNext) : null
    let hit: boolean | null = null, under: boolean | null = null, missPct: number | null = null
    if (actualWan != null) {
      hit = actualWan >= band.lo && actualWan <= band.hi
      if (!hit) {
        under = actualWan > band.hi
        missPct = +(Math.abs((actualWan - band.mid) / band.mid) * 100).toFixed(1)
      }
    }
    const pace = paceFullYear(pnl, fit, budgetYuan)
    rows.push({
      vantageMonth: v, isLast: v === lastV, predictMid: band.mid, lo: band.lo, hi: band.hi,
      actualWan, hit, under, missPct, fullYearRate: pace?.rate ?? null,
    })
  }
  return rows
}

export interface BacktestSummary { scored: number; hits: number; misses: number; unders: number; allUnder: boolean }
/** 只统计有实际值可比的站点(待验的最新一站不算数,板上「5 次里」不含它)。unders = 落空里偏低的那部分,
 *  不能拿 misses 顶替 —— 万一哪天出现一次高估,「N次偏低」就该只数偏低的那几次,不是数全部落空。 */
export function backtestSummary(rows: BacktestRow[] | null): BacktestSummary | null {
  if (!rows) return null
  const scored = rows.filter((r) => r.hit != null)
  const missRows = scored.filter((r) => r.hit === false)
  const unders = missRows.filter((r) => r.under).length
  return { scored: scored.length, hits: scored.length - missRows.length, misses: missRows.length, unders, allUnder: missRows.length > 0 && unders === missRows.length }
}

/** 读数句(≤30 可见字):带按 80%(t 表双侧 80%,fitBandAt 头注)画的,但落空占比与偏向都是实测,不是编的。 */
export function backtestReadout(sum: BacktestSummary | null): string | null {
  if (!sum || !sum.scored) return null
  if (!sum.misses) return `这条带按80%画的，${sum.scored}次全部命中`
  return `这条带按80%画的，${sum.scored}次里只中了${sum.hits}次，落空的${sum.misses}次全是${sum.allUnder ? '低估' : '有高有低'}`
}

/** 参照系小字(≤28 可见字):样本量 + 站点区间(铁律:印了百分比就得印样本量)。 */
export function backtestRefText(rows: BacktestRow[] | null): string {
  if (!rows) return ''
  const scored = rows.filter((r) => r.hit != null)
  if (!scored.length) return ''
  return `参照${scored[0].vantageMonth}-${scored[scored.length - 1].vantageMonth}月末起点·样本${scored.length}次`
}
