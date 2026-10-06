// 光伏分栋分析屏 v4 · 数据整形层(PV-ANALYSIS-SCREEN-V4 §3;实施计划 2026-09-13 §3 T0)。
//
// 输入全是 pvMeterAna.logic.ts 已经算好的快照 / 工作台 / 抽屉结构,这里**不另起一次计算**
// (唯一例外是 KPI 迷你线要逐月跑 buildSnapshot,见 kpiSparks)。
// 叶子组件只做像素几何,数据口径(谁算读不出、缺抄怎么数、按什么排、带宽取多少)全在这里,
// 每个叶子组件的 props 类型也从这里导出(文件末尾)。单测 pvAnaV4.logic.spec.ts。
//
// 屏上文案只写测量,不写定性;不写统计名词。

import {
  BASE_MIN_N, buildSnapshot, median, robustSigma,
  type AnaSnapshot, type BoardRow, type Gran, type LabResult, type ReadingRow,
  type SnapshotInput, type StationDetail, type TickState,
} from './pvMeterAna.logic'
import {
  PV, PVH, PVK, monthLabel, num, yuan, vsLabel, pvBaseNote, pvDashNew, pvDashGap, pvDashLy, pvDashPast, pvDashRef, pvDevFact, pvFoot,
  pvLimitRef, pvAnchorLine, pvPerKwRead, pvShortRef, type PvDelta, type PvSaid, type Said,
  pvYearCover, pvAnchorRefs, pvAnchorBadge, pvDenomRef, pvTrailCapRef, pvConsGrowth, pvSampleRef, pvLossRef,
  pvConsYear, pvConsMark, pvRevRead, pvRevRefs, pvRevShortRef, nB,
} from '@/components/ana/anaSentence'

// ── 共用小件 ─────────────────────────────────────────────────────────────

const PHASE_NAME: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期' }
export const phaseName = (p: number): string => PHASE_NAME[p] ?? `${p} 期`

const unitOf = (g: Gran) => (g === 'month' ? '天' : '个月')
const pct0 = (v: number) => `${Math.round(v * 100)}%`
const DAY = 86400000

/** 一年里的第几天(1 起)。走 UTC,本地时区解析会差一天 */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY) + 1
}
const daysInYear = (y: number) => Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY)

/** 该刻度早于这栋第一条抄表 = 那时还没投产。**不算漏抄**(未投产 ≠ 漏抄,3ceefe0 栽过) */
function preBorn(b: BoardRow, tick: string): boolean {
  return b.firstDate == null || b.firstDate.slice(0, tick.length) > tick
}

/** 本段漏抄的刻度数:已过去、没抄到、且那时已投产 */
export function missingN(b: BoardRow, ticks: string[]): number {
  let n = 0
  for (let i = 0; i < ticks.length; i++) if (b.state[i] === 'missing' && !preBorn(b, ticks[i])) n++
  return n
}

/**
 * 「读不出」的原因句(§07);读得出 / 未投产 = null。已投产,且满足任一 ——
 * 月抄 / 本段一个刻度都没抄 / 画不出范围 / 已抄 ÷ 应抄 < 覆盖线 / 在网 < minOnlineDays。
 * 应抄 = 已抄 + 漏抄(不含投产前),分母是已过去不是整段(§03.8)。
 *
 * 「在网 < 90 天」只管**在已载入数据里才出现的栋**(首条抄表晚于全园最早那条):
 * 从年初就在的栋,年初几个月当年抄表天数必然不满 90,那是日历位置,不是它投产不满 90 天 ——
 * 不这样分,每年 1–3 月全园都读不出。
 * ponytail: 只看当年数据。整园都是今年才投产(第一年)时分不出来,要准得接上一年首条抄表日。
 */
export function unreadableWhy(b: BoardRow, snap: AnaSnapshot): string | null {
  if (!b.bornBySeg) return null
  const unit = unitOf(snap.gran)
  const due = b.seenN + missingN(b, snap.ticks)
  if (b.cadence === 'monthly') return '只有月抄记录，逐日比不了'
  if (b.seenN === 0) return snap.gran === 'month' ? '本月一天都没抄' : '本年没有抄表记录'
  if (b.center == null) return PV.noBase
  if (b.seenN < due * snap.crit.coverMonth) return `已抄 ${b.seenN}/${due} ${unit}，覆盖不到 ${pct0(snap.crit.coverMonth)}`
  const days = shortDays(b, snap)
  if (days != null) return `在网 ${days} 天，不足 ${snap.crit.minOnlineDays} 天`
  return null
}

export const isUnreadable = (b: BoardRow, snap: AnaSnapshot): boolean => unreadableWhy(b, snap) != null

/**
 * 「在网 < minOnlineDays」单拿出来(口径同上):命中返回在网天数,否则 null。
 * α 排序 / 年内走势 / 核对表是整年口径,只认这一条,不认本段覆盖 —— 在网 31 天的栋拿去年化排名,
 * 一个月的量摊到装机上就是几倍的「先天水平」(§07:在网不足 90 天不出任何判据结论)。
 */
export function shortDays(b: BoardRow, snap: AnaSnapshot): number | null {
  const parkFirst = snap.board.reduce<string | null>((m, x) => (x.firstDate != null && (m == null || x.firstDate < m) ? x.firstDate : m), null)
  const days = snap.stations.find(s => s.id === b.id)?.days ?? 0
  return b.firstDate != null && parkFirst != null && b.firstDate > parkFirst && days < snap.crit.minOnlineDays ? days : null
}
/** 整年卡的卡头覆盖:这一年读数的首末月(满 1–12 月写「2025年全年」,不满写「1–6月」)—— 不看读数就写「全年」,导入半年数据时卡头和工具条对不上 */
export function coverOf(snap: AnaSnapshot): string {
  const fs = snap.board.flatMap(b => (b.firstDate ? [b.firstDate] : [])).sort()
  return pvYearCover(snap.year, fs.length ? Number(fs[0].slice(5, 7)) : 1, snap.dataThrough ? Number(snap.dataThrough.slice(5, 7)) : 12)
}
const shortMap = (snap: AnaSnapshot) =>
  new Map(snap.board.flatMap(b => { const d = shortDays(b, snap); return d == null ? [] : [[b.id, d] as const] }))

/** 出范围的主导方向:低于的刻度多 → −1,否则 +1;没出范围 → null */
function outDir(b: BoardRow): -1 | 1 | null {
  if (!b.outN) return null
  return b.out.reduce<number>((a, v) => a + (v ?? 0), 0) < 0 ? -1 : 1
}

// ── B1 芯片条(§1 #5 #7)──────────────────────────────────────────────────

export type ChipKind = 'hit' | 'plain' | 'unreadable' | 'unborn'
export interface ChipItem {
  id: number; name: string; phase: number
  /** hit = 本段有连续出范围段(方向色底);plain = 读得出、没有连续段(可能零散出过几天);
   *  unreadable = 读不出(灰虚线边 + 徽标);unborn = 本段还没投产(灰字禁用) */
  kind: ChipKind
  /** 徽标「N 天」= 排序键;hit 与 plain 都给,读不出 / 未投产为 0 */
  outDays: number
  hasRun: boolean
  /** 连续段栋的主导方向(低于的刻度多 → −1);其余 null */
  dir: -1 | 1 | null
  selected: boolean
  /** 未投产不可点 */
  clickable: boolean
  /** 读不出是因为历史不够(画不出平时范围 / 在网不足 minOnlineDays),徽标写「历史不够」;别的读不出写「缺抄」 */
  history: boolean
  /** 读不出是因为只有月抄记录(一月一条,不是缺抄):徽标写「只有月抄」 */
  monthly?: boolean
}
export interface ChipGroups {
  /** 常显 = 出范围(有连续段)∪ 读不出 ∪ 选中。有连续段在前 → 出范围天数降序 → 读不出其后;同键按楼栋固定顺序 */
  shown: ChipItem[]
  /** 收进「其余 N 栋」:出范围天数降序,未投产垫底 */
  folded: ChipItem[]
  /** 徽标单位:月档「天」,年档「个月」(年档数的是出范围的月) */
  unit: string
}

// 「出范围的栋」按**有连续段**算,与 KPI「本段出范围栋数」同口径(§6.2 数段不数点)。
// 不按「出范围天数 > 0」:±2 倍的带按构造每天漏出约 4.6%,一个月每栋期望 1.3 天,
// 按天数算几乎每栋都常显,「其余 N 栋」收不起任何东西(夹具实测:读得出的栋全有零散出范围日)。
export function chipGroups(snap: AnaSnapshot, selId: number | null): ChipGroups {
  const items = snap.board.map<ChipItem>(b => {
    const kind: ChipKind = !b.bornBySeg ? 'unborn'
      : isUnreadable(b, snap) ? 'unreadable'
        : b.runs.length > 0 ? 'hit' : 'plain'
    const counted = kind === 'hit' || kind === 'plain'
    return {
      id: b.id, name: b.name, phase: b.phase, kind,
      outDays: counted ? b.outN : 0,
      hasRun: kind === 'hit',
      dir: kind === 'hit' ? outDir(b) : null,
      selected: b.id === selId,
      clickable: kind !== 'unborn',
      history: kind === 'unreadable' && historyShort(b, snap),
      monthly: kind === 'unreadable' && b.cadence === 'monthly',
    }
  })
  const byKey = (a: ChipItem, b: ChipItem) => Number(b.hasRun) - Number(a.hasRun) || b.outDays - a.outDays
  // 常显组分三档:命中 → 读不出 → 只因选中才常显的栋(钉末位,C2-05)。
  // 钉末位后位移只发生在行尾:点行内芯片时被点的那枚不动,旧选中从行尾移出。
  const late = (c: ChipItem) => (c.kind === 'hit' ? 0 : c.kind === 'unreadable' ? 1 : 2)
  const shown = items
    .filter(c => c.kind === 'hit' || c.kind === 'unreadable' || c.selected)
    .sort((a, b) => late(a) - late(b) || byKey(a, b))
  const folded = items
    .filter(c => !shown.includes(c))
    .sort((a, b) => Number(a.kind === 'unborn') - Number(b.kind === 'unborn') || byKey(a, b))
  return { shown, folded, unit: unitOf(snap.gran) }
}

/** B1 大图图头的事实句(2026-10-06 改稿):零散偏离和连着偏离分开说,屏顶 KPI 只数连着的。
 *  和图例同排,放不下长句 —— 哪几天连着、缺抄几天由图自己画(段底色 / 底部刻度)。
 *  读不出的栋只写原因,不出判据结论(§07) */
export function dayFact(row: BoardRow, snap: AnaSnapshot): string {
  const why = unreadableWhy(row, snap)
  if (why) return why
  if (row.lo == null) return PV.noBase
  if (row.seenN === 0) return `这一段还没有抄表`
  const below = row.out.filter(v => v === -1).length
  const above = row.out.filter(v => v === 1).length
  return pvDevFact(row.outN, unitOf(snap.gran), below, above, row.seenN, row.runs.length)
}

/** 读不出是因为历史不够:画不出平时范围,或在网不足 minOnlineDays。别的读不出(覆盖不够、月抄、一天没抄)不算 */
export function historyShort(b: BoardRow, snap: AnaSnapshot): boolean {
  return isUnreadable(b, snap) && b.cadence !== 'monthly' && b.seenN > 0 && (b.center == null || shortDays(b, snap) != null)
}

/** 主卡大图下那句(thin):历史不够的楼哪天才有第一条读数、还差多少。两种拦法两种写法:
 *  年档画不出范围 = 有读数的月不够 BASE_MIN_N.year(「只有 1 个月读数，满 6 个月才判」);
 *  其余(月档画不出范围、或在网不足 minOnlineDays)= 按在网天数(「读数从12月1日起，还差 59 天满 90 天」)。
 *  ponytail: 只说第一栋那一组(同一种拦法、首条读数同一天 / 同样几个月);几组不同时其余组不写 —— 这一句只有一行的地方 */
export function shortRefOf(snap: AnaSnapshot): PvSaid | null {
  const days = (b: BoardRow) => snap.stations.find(s => s.id === b.id)?.days ?? 0
  const min = snap.crit.minOnlineDays
  const byMonths = (b: BoardRow) => snap.gran === 'year' && b.center == null
  // 按天说的那种,天数已满线却仍画不出范围(月档 1 月:年内没有段外的历史)说「还差」不成立,不出
  const xs = snap.board.filter(b => b.bornBySeg && historyShort(b, snap) && (byMonths(b) || days(b) < min))
  if (!xs.length) return null
  const f = xs[0]
  if (byMonths(f)) {
    const g = xs.filter(b => byMonths(b) && b.seenN === f.seenN)
    return pvShortRef({ names: g.map(b => b.name), months: f.seenN, needMonths: BASE_MIN_N.year })
  }
  const g = xs.filter(b => !byMonths(b) && b.firstDate === f.firstDate && days(b) === days(f))
  return pvShortRef({ names: g.map(b => b.name), first: f.firstDate!, days: days(f), minDays: min })
}

/** 默认选中(2026-10-06 改稿):本段偏离天数最多、且判得了的那栋;有连着偏离的优先。
 *  一栋都判不了 → 芯片顺序第一枚能点的 */
export function defaultPick(snap: AnaSnapshot): number | null {
  const g = chipGroups(snap, null)
  const all = [...g.shown, ...g.folded]
  const judged = all.filter(c => c.kind === 'hit' || c.kind === 'plain')
    .sort((a, b) => Number(b.hasRun) - Number(a.hasRun) || b.outDays - a.outDays)
  return judged[0]?.id ?? all.find(c => c.clickable)?.id ?? null
}

// ── B0 KPI 行(§3.1;§1 #10 #11)───────────────────────────────────────────

function kpiCounts(snap: AnaSnapshot) {
  const born = snap.board.filter(b => b.bornBySeg)
  const unreadable = born.filter(b => isUnreadable(b, snap))
  // 主数统计**段所在的栋数**,不数点(§6.2);读不出的栋不出判据结论(§07)
  const out = born.filter(b => !unreadable.includes(b) && b.runs.length > 0)
  const miss = born.map(b => ({ name: b.name, n: missingN(b, snap.ticks) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
  return {
    born, unreadable, out, miss,
    seen: born.reduce((t, b) => t + b.seenN, 0),
    missing: miss.reduce((t, x) => t + x.n, 0),
  }
}

// ── v2 首屏(2026-10-06 改稿,画板 pv-v2):KPI 五瓦 + 「各栋每千瓦日均发电」新卡 ─────────────
// 比较按数据齐全时的样子做成真功能(用户 10-06):上一年读数照取,有数就算,没数写「—」。
// 每千瓦日均 = Σ发电 ÷ Σ(台账装机 × 抄表天数),没录台账装机的栋不进分子分母。
// 月抄的楼一条读数是一整月的量:天数按那个月的日历天数算(按条数算会放大约 30 倍)。

const pad2 = (n: number) => String(n).padStart(2, '0')
const r1 = (v: number) => Math.round(v * 10) / 10
/** 'YYYY-MM…' 那个月有几天 */
const daysInMonth = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate()

/** 上网单价:按读数所在的月取('YYYY-MM' → ¥/kWh;没读到 = null)。给数字 = 每个月都是这个价 */
export type PriceOf = (ym: string) => number | null
export type PriceIn = number | PriceOf
const priceFn = (p: PriceIn): PriceOf => (typeof p === 'number' ? () => p : p)

/** 一条读数算几天:日抄 1 天,月抄 = 那个月的日历天数 */
function daysFn(snap: AnaSnapshot): (r: ReadingRow) => number {
  const monthly = new Set(snap.stations.filter(s => s.cadence === 'monthly').map(s => s.id))
  return r => (monthly.has(r.stationId) ? daysInMonth(r.date) : 1)
}

/** 一段(月 'YYYY-MM' / 年 'YYYY')的全园合计与逐栋发电、抄表天数。这段一条读数都没有 = null。
 *  keep 给了只取它放行的日子(本段没读满时,上一期 / 去年同期截到同一天);revOk = 这段每个月的上网单价都读到了 */
interface SegSum { gen: number; self: number; rev: number; revOk: boolean; last: string; by: Map<number, { gen: number; days: number }> }
function segSum(rows: ReadingRow[] | undefined, pre: string, price: PriceOf, days: (r: ReadingRow) => number, keep?: (d: string) => boolean): SegSum | null {
  if (!rows) return null
  const o: SegSum = { gen: 0, self: 0, rev: 0, revOk: true, last: '', by: new Map() }
  let n = 0
  for (const r of rows) {
    if (!r.date.startsWith(pre) || (keep && !keep(r.date))) continue
    n++
    o.gen += r.gen; o.self += r.selfUse
    const p = price(r.date.slice(0, 7))
    if (p == null) o.revOk = false
    o.rev += r.revenue + r.gridFeed * (p ?? 0)   // 同 revenueBars:自用按录入时的单价,上网按那个月的系统上网单价
    const a = o.by.get(r.stationId) ?? { gen: 0, days: 0 }
    a.gen += r.gen; a.days += days(r)
    o.by.set(r.stationId, a)
    if (r.date > o.last) o.last = r.date
  }
  return n ? o : null
}

/** 每千瓦日均。ids 给了只算这批栋(比上期时只拿两期都有读数的那批:新并网的楼掺进来会改平均) */
function perDayOf(seg: SegSum, cap: Map<number, number>, ids?: number[]): number | null {
  let g = 0, d = 0
  for (const [id, a] of seg.by) {
    const c = cap.get(id)
    if (!c || !a.days || (ids && !ids.includes(id))) continue
    g += a.gen; d += c * a.days
  }
  return d ? g / d : null
}
const capOf = (snap: AnaSnapshot) => new Map(snap.stations.filter(s => s.capKwp != null && s.capKwp > 0).map(s => [s.id, s.capKwp!]))
/** 两段都有读数(且有台账装机)的栋 */
const bothIds = (a: SegSum, b: SegSum, cap: Map<number, number>) => [...a.by.keys()].filter(id => cap.has(id) && b.by.has(id))

/** 这一年读数到哪天了:没到年末 = 只拿上一年同一个月日之前的读数比(年初到今天 ≠ 去年整年) */
function yearKeep(rows: ReadingRow[], y: number): ((d: string) => boolean) | undefined {
  let last = ''
  for (const r of rows) if (r.date.startsWith(String(y)) && r.date > last) last = r.date
  const md = last.slice(5)
  return last && last < `${y}-12-31` ? (d: string) => d.slice(5) <= md : undefined
}

/** 每栋每月的发电与天数('MM' → …),比去年用 */
type MonthMap = Map<string, { gen: number; days: number }>
function monthAgg(rows: ReadingRow[] | undefined, yr: number, days: (r: ReadingRow) => number, keep?: (d: string) => boolean): Map<number, MonthMap> {
  const m = new Map<number, MonthMap>()
  for (const r of rows ?? []) {
    if (!r.date.startsWith(String(yr)) || (keep && !keep(r.date))) continue
    let s = m.get(r.stationId)
    if (!s) { s = new Map(); m.set(r.stationId, s) }
    const k = r.date.slice(5, 7), a = s.get(k) ?? { gen: 0, days: 0 }
    a.gen += r.gen; a.days += days(r)
    s.set(k, a)
  }
  return m
}
/** 比上一年(一栋):只拿两年都有读数的月,各自摊到每天再比 —— 年中才并网的楼拿 6–12 月去比去年整年,冬天会把它拉低。
 *  比不了 = 「—」。新卡按年那列和「每千瓦日均和合格线的差」那列走同一个函数,同一栋两处同一个数 */
function sharedPct(a: MonthMap | undefined, b: MonthMap | undefined): string {
  if (!a || !b) return PV.dash
  const ks = [...a.keys()].filter(k => b.has(k))
  const pd = (m: MonthMap) => { let g = 0, d = 0; for (const k of ks) { const x = m.get(k)!; g += x.gen; d += x.days } return d ? g / d : null }
  const x = pd(a), z = pd(b)
  return x != null && z ? PVK.pct(x, z).val : PV.dash
}

/** 本段、上一期(按月才有;1 月取上一年 12 月)、去年同期三段。
 *  本段还没读满(最后一条读数早于段末)时,上一期和去年同期截到同一个日号(按月)/ 同一个月日(按年)——
 *  不截的话月初看当月就是拿 10 天比 30 天 */
function segsOf(snap: AnaSnapshot, rows: ReadingRow[], prevRows: ReadingRow[] | undefined, gridPrice: PriceIn) {
  const y = snap.year
  const m = snap.gran === 'month' && snap.ym ? Number(snap.ym.slice(5, 7)) : null
  const pm = m == null ? null : m > 1 ? m - 1 : 12
  const price = priceFn(gridPrice), days = daysFn(snap)
  const cur = segSum(rows, m == null ? String(y) : `${y}-${pad2(m)}`, price, days)
  const end = m == null ? `${y}-12-31` : `${y}-${pad2(m)}-${pad2(daysInMonth(`${y}-${pad2(m)}`))}`
  const cut = cur && cur.last < end ? cur.last : null
  const keep = !cut ? undefined : m == null ? (d: string) => d.slice(5) <= cut.slice(5) : (d: string) => d.slice(8) <= cut.slice(8)
  return {
    y, m, pm, price, days,
    /** 上一期怎么叫:1 月比的是上一年 12 月,写「去年12月」(和消纳卡读数句同一个叫法) */
    pmLabel: m == null ? null : m > 1 ? monthLabel(pm!) : '去年12月',
    cur,
    prev: m == null ? null : m > 1 ? segSum(rows, `${y}-${pad2(pm!)}`, price, days, keep) : segSum(prevRows, `${y - 1}-12`, price, days, keep),
    ly: segSum(prevRows, m == null ? String(y - 1) : `${y - 1}-${pad2(m)}`, price, days, keep),
    keep,
  }
}

export interface PvKpi {
  label: string
  value: string
  /** 副行两行:比上期(按年没有)+ 比去年同期;val null = 没数,写「—」 */
  rows?: PvDelta[]
  note?: string
}

export function pvKpis(snap: AnaSnapshot, rows: ReadingRow[], prevRows: ReadingRow[] | undefined, gridPrice: PriceIn): PvKpi[] {
  const { y, m, pmLabel, cur, prev, ly } = segsOf(snap, rows, prevRows, gridPrice)
  const cap = capOf(snap)
  const keyP = pmLabel == null ? '' : vsLabel(pmLabel), keyL = m == null ? PVK.vsY(y - 1) : PVK.vsLY(m)
  type Diff = Omit<PvDelta, 'key'> | null
  /** 一行副行:两段都有数才算 */
  const vs = (p: SegSum | null, key: string, f: (c: SegSum, p: SegSum) => Diff): PvDelta =>
    ({ ...((cur && p ? f(cur, p) : null) ?? { val: null }), key })
  const two = (f: (c: SegSum, p: SegSum) => Diff, keyOfP = keyP) =>
    (m == null ? [] : [vs(prev, keyOfP, f)]).concat([vs(ly, keyL, f)])
  const selfPct = (x: SegSum) => (x.gen > 0 ? r1((x.self / x.gen) * 100) : null)
  const pdPair = (c: SegSum, p: SegSum): Diff => {
    const ids = bothIds(c, p, cap), a = perDayOf(c, cap, ids), b = perDayOf(p, cap, ids)
    return a != null && b ? PVK.pct(a, b) : null
  }
  const k = kpiCounts(snap)
  const over = cur ? [...cur.by].filter(([id, a]) => { const c = cap.get(id); return !!c && a.days > 0 && a.gen / c / a.days > PV.limitDay }).length : 0
  const hist = k.unreadable.filter(b => historyShort(b, snap)).length
  const pd = cur ? perDayOf(cur, cap) : null
  const sp = cur ? selfPct(cur) : null
  return [
    { label: PV.tile.gen, value: cur ? `${num(cur.gen / 1e4)}万kWh` : PV.dash, rows: two((c, p) => (p.gen > 0 ? PVK.pct(c.gen, p.gen) : null)) },
    {
      label: PV.tile.perKw, value: pd == null ? PV.dash : `${pd.toFixed(1)} kWh`,
      // 比上期那行写明比的是哪一批(只拿两期都有读数的栋);比去年同期那行同样只拿两期都有的,key 不另说
      rows: two(pdPair, cur && prev && pmLabel != null ? PVK.vsSame(bothIds(cur, prev, cap).length, pmLabel) : keyP),
    },
    {
      label: PV.tile.dev(snap.crit.bandRun, unitOf(snap.gran)), value: `${k.out.length} 栋`,
      note: over ? PVK.over(over) : PVK.dev(k.born.length - k.unreadable.length, hist),
    },
    { label: PV.tile.self, value: sp == null ? PV.dash : `${sp.toFixed(1)}%`, rows: two((c, p) => { const a = selfPct(c), b = selfPct(p); return a != null && b != null ? PVK.pt(a, b) : null }) },
    // 「−4.8万」= 屏上一位小数相减,不拿没舍入的差(两张瓦的数相减对得上)。有月份的上网单价没读到 = 算不出,写「—」
    {
      label: PV.tile.rev, value: cur?.revOk ? yuan(cur.rev / 1e4) : PV.dash,
      rows: two((c, p) => (c.revOk && p.revOk ? PVK.wan(r1(c.rev / 1e4), r1(p.rev / 1e4)) : null)),
    },
  ]
}

/** 主卡卡头「判了 N 栋楼」:本段已投产、读得出的栋 */
export function judgedN(snap: AnaSnapshot): number {
  const k = kpiCounts(snap)
  return k.born.length - k.unreadable.length
}

export interface PerKwRow {
  id: number; name: string; phase: number
  /** null = 这段没读数(还没并网)或没录台账装机 */
  perDay: number | null
  /** 这段有读数的天数 */
  days: number
  /** 本段结束时并网了没有(首条读数不晚于段末)。没读数的行:并网了写「—」(这段没抄),没并网写「还没并网」 */
  born: boolean
  /** 右边几列的字(按月:比上月、比去年同月;按年:在网、比去年);没数写「—」 */
  cols: string[]
}
export interface PerKwCard {
  /** 按每千瓦日均降序(一位小数相同按楼栋顺序),这段没读数的栋垫底、占住一行(切期间这一排不缩) */
  rows: PerKwRow[]
  heads: string[]
  hint: string
  /** 合格线摊到每天(按年才画);按月 null */
  anchorDay: number | null
  anchorLabel: string | null
  read: PvSaid | Said | null
  refs: PvSaid[]
}

export function perKwCard(snap: AnaSnapshot, rows: ReadingRow[], prevRows: ReadingRow[] | undefined, gridPrice: PriceIn): PerKwCard {
  const { y, m, pmLabel, cur, prev, ly, days: daysOfRow, keep } = segsOf(snap, rows, prevRows, gridPrice)
  const cap = capOf(snap)
  const pdOne = (seg: SegSum | null, id: number) => {
    const a = seg?.by.get(id), c = cap.get(id)
    return a && c && a.days ? a.gen / c / a.days : null
  }
  const pct = (a: number | null, b: number | null) => (a != null && b ? PVK.pct(a, b).val : PV.dash)
  const yDays = daysInYear(y)
  const order = new Map(snap.stations.map((s, i) => [s.id, i]))
  const born = new Map(snap.board.map(b => [b.id, b.bornBySeg]))
  // 按年那列比去年:两年都有读数的月(同「每千瓦日均和合格线的差」);这一年没到年末时去年也截到同一个月日
  const curM = m == null ? monthAgg(rows, y, daysOfRow) : null
  const lyM = m == null ? monthAgg(prevRows, y - 1, daysOfRow, keep) : null
  const out: PerKwRow[] = snap.stations.filter(s => s.metered).map(s => {
    const pd = pdOne(cur, s.id), days = cur?.by.get(s.id)?.days ?? 0
    const lyCol = m == null ? (pd == null ? PV.dash : sharedPct(curM!.get(s.id), lyM!.get(s.id))) : pct(pd, pdOne(ly, s.id))
    return {
      id: s.id, name: s.name, phase: s.phase, perDay: pd, days, born: born.get(s.id) ?? false,
      cols: m == null ? [days && days < yDays ? `${days} 天` : '', lyCol] : [pct(pd, pdOne(prev, s.id)), lyCol],
    }
  }).sort((a, b) => Number(a.perDay == null) - Number(b.perDay == null)
    || (a.perDay != null && b.perDay != null ? r1(b.perDay) - r1(a.perDay) : 0)
    || order.get(a.id)! - order.get(b.id)!)
  const have = out.filter((r): r is PerKwRow & { perDay: number } => r.perDay != null)
  // 「—」是什么,一张卡说一次。上一期没有这栋的读数分两种:第一条读数落在这一段里的(才并网),
  // 早有读数、只是上一期整段没抄的(只写测量,不说原因)。上一年没取到(prevRows 为 undefined)不说「还没有」—— 那是没读到,不是没有
  const first = new Map(snap.board.map(b => [b.id, b.firstDate]))
  const segStart = m == null ? '' : `${y}-${pad2(m)}-01`
  const fresh: string[] = [], gap: string[] = []
  if (m != null && pmLabel != null && prev) {
    for (const r of have) {
      if (prev.by.has(r.id)) continue
      const f = first.get(r.id)
      const isNew = f != null && f >= segStart && (m > 1 || !prevRows?.some(x => x.stationId === r.id))
      ;(isNew ? fresh : gap).push(r.name)
    }
  }
  const lastYearAny = !!prevRows?.some(r => r.date.startsWith(String(y - 1)))
  const dash = [
    ...(fresh.length ? [pvDashNew(m!, pmLabel!)] : []),
    ...(gap.length ? [pvDashGap(gap.length <= 2 ? gap.join('、') : nB(gap.length), pmLabel!)] : []),
    ...(prevRows && !lastYearAny ? [pvDashPast(y - 1)]
      : prevRows && !ly ? [pvDashLy(m == null ? `${y - 1}年同期` : `去年${monthLabel(m)}`)] : []),
  ]
  const anchor = +(snap.crit.anchorHours * snap.crit.yieldRatio).toFixed(1)
  const anchorDay = m == null ? anchor / yDays : null
  return {
    rows: out,
    heads: m == null || pmLabel == null ? [PV.online, PVK.vsY(y - 1)] : [vsLabel(pmLabel), PVK.vsLY(m)],
    hint: m == null || pmLabel == null ? PVH.perKwY(out.length, y - 1) : PVH.perKwM(out.length, pmLabel),
    anchorDay,
    anchorLabel: anchorDay == null ? null : pvAnchorLine(anchor, anchorDay),
    read: pvPerKwRead(have),
    refs: [dash.length ? pvDashRef(dash) : null, pvLimitRef(have.filter(r => r.perDay > PV.limitDay).length)].filter((x): x is PvSaid => x != null),
  }
}

/** 两条迷你线的序列:1 月 … 当前月,逐月各跑一次 buildSnapshot(月档) */
export interface KpiSparks { months: number[]; out: number[]; missing: number[] }

export function kpiSparks(input: SnapshotInput): KpiSparks {
  const last = input.gran === 'month' && input.month != null
    ? input.month
    : Math.max(0, ...input.rows.map(r => Number(r.date.slice(5, 7))))
  const s: KpiSparks = { months: [], out: [], missing: [] }
  for (let m = 1; m <= last; m++) {
    const k = kpiCounts(buildSnapshot({ ...input, gran: 'month', month: m, prevRows: undefined }))
    s.months.push(m); s.out.push(k.out.length); s.missing.push(k.missing)
  }
  return s
}

/** 计时辅助:§1 #11「12 个月合计 > 80ms 就不画迷你线」由 T5 用它量 */
export function timeKpiSparks(input: SnapshotInput, now: () => number = () => performance.now()): KpiSparks & { ms: number } {
  const t0 = now()
  const s = kpiSparks(input)
  return { ...s, ms: now() - t0 }
}

// ── B2 判据脚(§3.3;§1 #8 #9)───────────────────────────────────────────

export interface CritFoot {
  items: { key: 'band' | 'run' | 'cover'; text: string }[]
  /** 选中栋的范围是拿哪一段估的(§1 #9);没选中 / 画不出范围 = null(画不出的原因大图图头已经写了) */
  baseNote: string | null
  /** 判据脚末尾那句(§1 #8) */
  tail: string
}

export function critFoot(snap: AnaSnapshot, selId: number | null): CritFoot {
  const c = snap.crit
  const row = snap.board.find(b => b.id === selId) ?? null
  const base = row?.base
  // 2026-10-06 改稿:三条判据(台账差、年等效挪去「按装机比」那档);窗口句写首末 + 条数,
  // 放宽里只说读者看得懂的两档(含这栋刚并网那段 / 含别的楼刚并网的月份)
  return {
    items: [
      { key: 'band', text: pvFoot.band(c.bandSigma) },
      { key: 'run', text: pvFoot.run(c.bandRun, unitOf(snap.gran)) },
      { key: 'cover', text: pvFoot.cover(Math.round(c.coverMonth * 100)) },
    ],
    baseNote: row && base ? pvBaseNote(base, row.firstDate, `${snap.year}-01-01`) : null,
    tail: PV.tail,
  }
}

// ── B3 每千瓦发电走势(§3.5;2026-10-06 改稿:卡名、封 0、超 24 压顶、参照只留分母那句)──────────

export interface YieldBand {
  gran: Gran
  labels: string[]
  /** 选中栋逐刻度每千瓦发电 kWh;漏抄 / 未到 / 没选中 = null */
  sel: (number | null)[]
  /** pre = 这栋那时还没投产(不写「没抄表」) */
  selState: (TickState | 'pre')[]
  selName: string | null
  /** 全园中位与各栋中间一半(p25–p75);当刻度在网 < 3 栋整列留空 */
  med: (number | null)[]
  lo: (number | null)[]
  hi: (number | null)[]
  /** 从这个下标起是还没到的刻度;整段都已过去 = null */
  futureFrom: number | null
  /** 选中栋超过它的点压到它画、碰到的线段画虚线。按月 = 每千瓦一天 24 kWh;按年逐刻度 = 24 × 当月天数(一个点是一个月的合计);null = 不压 */
  cap: number | number[] | null
  hint: string
  refs: PvSaid[]
}

const denomOf = (snap: AnaSnapshot) => new Map(snap.stations.filter(s => s.metered)
  .map(s => [s.id, s.theoKwp ?? (s.capKwp != null && s.capKwp > 0 ? s.capKwp : null)]))

/** 月档逐日、年档逐月:每栋每刻度的等效小时 = 该刻度发电合计 ÷ 分母 */
export function yieldBand(snap: AnaSnapshot, rows: ReadingRow[], selId: number | null): YieldBand {
  const denom = denomOf(snap)
  const idx = new Map(snap.ticks.map((t, i) => [t, i]))
  const keyOf = snap.gran === 'month' ? (d: string) => d : (d: string) => d.slice(0, 7)
  const eh = new Map<number, (number | null)[]>()
  for (const r of rows) {
    const i = idx.get(keyOf(r.date))
    const d = denom.get(r.stationId)
    if (i == null || !d || !(r.gen > 0)) continue
    let arr = eh.get(r.stationId)
    if (!arr) { arr = snap.ticks.map(() => null); eh.set(r.stationId, arr) }
    arr[i] = (arr[i] ?? 0) + r.gen / d
  }
  const med: (number | null)[] = [], lo: (number | null)[] = [], hi: (number | null)[] = []
  snap.ticks.forEach((_, i) => {
    const col = [...eh.values()].map(a => a[i]).filter((v): v is number => v != null).sort((a, b) => a - b)
    if (col.length < 3) { med.push(null); lo.push(null); hi.push(null); return }
    const q = (f: number) => col[Math.min(col.length - 1, Math.floor(f * (col.length - 1)))]
    med.push(median(col)); lo.push(q(0.25)); hi.push(q(0.75))
  })
  const row = snap.board.find(b => b.id === selId) ?? null
  const sel = row ? (eh.get(row.id) ?? snap.ticks.map(() => null)).map((v, i) => (row.state[i] === 'seen' ? v : null)) : snap.ticks.map(() => null)
  const cap = snap.gran === 'month' ? PV.limitDay : snap.ticks.map(t => PV.limitDay * daysInMonth(t))
  const capAt = (i: number) => (typeof cap === 'number' ? cap : cap[i])
  return {
    gran: snap.gran,
    labels: snap.tickLabels,
    sel,
    selState: row ? row.state.map((s, i) => (s === 'missing' && preBorn(row, snap.ticks[i]) ? 'pre' : s)) : [],
    selName: row?.name ?? null,
    med, lo, hi,
    futureFrom: snap.elapsedN < snap.ticks.length ? snap.elapsedN : null,
    cap,
    hint: row ? PVH.trail(row.name, snap.gran === 'month' ? '每天' : '每月') : '',
    refs: [
      pvDenomRef(snap.quality.noPanel.length, snap.stations.filter(s => s.metered).length),
      sel.some((v, i) => v != null && v > capAt(i)) ? pvTrailCapRef(snap.gran === 'year') : null,
    ].filter((x): x is PvSaid => x != null),
  }
}

// ── A2 每千瓦日均和合格线的差(§3.6;2026-10-06 改稿)──────────────────────────────
// 原来比的是年等效小时(全年发电 ÷ 装机):二期 6 月才并网,一年只发了 7 个月,被排到一期后面。
// 改成每栋按自己有读数的天数摊到每天,合格线一年 807.5 也摊到每天,再比差。
// 只在按月出(用户 10-06「按推荐」):按年它和新卡「各栋每千瓦日均发电」是同一组数,合格线画进新卡。
// 分母同新卡用台账装机 —— 两张卡同一栋同一年要对得上(新卡二期 4.6 = 合格线 2.21 + 这里的 +2.36)。

export interface AnchorRow {
  id: number; name: string; phase: number
  /** 全年每千瓦日均 kWh = Σ发电 ÷ (台账装机 × 有读数的天数) */
  perDay: number
  /** 有读数的天数(摊到每天的分母) */
  days: number
  /** 比合格线每天多几 kWh(负 = 少) */
  delta: number
  /** (每千瓦日均 ÷ 合格线每天 − 1) × 100 */
  deltaPct: number
  /** 比上一年:只拿两年都有读数的月,各自摊到每天再比(涨跌 %)—— 二期今年 6–12 月拿去比去年整年,冬天会把它拉低;
   *  上一年这栋没读数 / 没有共同的月 / 上一年没取到 = 「—」 */
  prev: string
}
export interface AnchorBars {
  /** 合格线摊到每天 = anchorHours × yieldRatio ÷ 当年天数 */
  anchorDay: number
  /** 按差降序(两位小数一样的按楼栋顺序) */
  rows: AnchorRow[]
  /** 整年一条读数都没有:占一行写「还没并网」 */
  unborn: { id: number; name: string; phase: number }[]
  hint: string
  /** 上一年取到了、却一条分栋读数都没有 →「2024年没有分栋读数」;没取到不说(那是没读到,不是没有) */
  badge: string | null
  refs: PvSaid[]
}

export function anchorBars(snap: AnaSnapshot, rows: ReadingRow[], prevRows: ReadingRow[] | undefined): AnchorBars {
  const c = snap.crit, y = snap.year
  const anchor = +(c.anchorHours * c.yieldRatio).toFixed(1)
  const anchorDay = anchor / daysInYear(y)
  const cap = capOf(snap)
  const days = daysFn(snap)
  const cur = monthAgg(rows, y, days), prev = monthAgg(prevRows, y - 1, days, yearKeep(rows, y))
  /** 这几个月合起来摊到每天、每千瓦 */
  const perDayOver = (ms: MonthMap, keys: string[], k: number) => {
    let g = 0, d = 0
    for (const key of keys) { const a = ms.get(key)!; g += a.gen; d += a.days }
    return d ? g / k / d : null
  }
  const order = new Map(snap.stations.map((s, i) => [s.id, i]))
  const out: AnchorRow[] = [], unborn: AnchorBars['unborn'] = [], short: { name: string; days: number }[] = []
  for (const s of snap.stations) {
    if (!s.metered) continue
    const a = cur.get(s.id), k = cap.get(s.id)
    if (!a) { unborn.push({ id: s.id, name: s.name, phase: s.phase }); continue }
    // ponytail: 没录台账装机的楼没有「每千瓦」可言,不画也不另说(库里都录了);要说时在 refs 里加一句
    if (!k) continue
    if (s.days < c.minOnlineDays) { short.push({ name: s.name, days: s.days }); continue }
    const keys = [...a.keys()]
    const perDay = perDayOver(a, keys, k)!
    out.push({
      id: s.id, name: s.name, phase: s.phase, perDay,
      days: [...a.values()].reduce((t, x) => t + x.days, 0),
      delta: perDay - anchorDay,
      deltaPct: (perDay / anchorDay - 1) * 100,
      prev: sharedPct(a, prev.get(s.id)),
    })
  }
  out.sort((a, b) => Math.round(b.delta * 100) - Math.round(a.delta * 100) || order.get(a.id)! - order.get(b.id)!)
  const ph = new Map<number, number[]>()
  for (const r of out) ph.set(r.phase, [...(ph.get(r.phase) ?? []), r.days])
  const phaseDays = [...ph].sort((a, b) => a[0] - b[0]).map(([p, ds]): [number, number, number] => [p, Math.min(...ds), Math.max(...ds)])
  return {
    anchorDay, rows: out, unborn,
    hint: PVH.anchor(out.length, coverOf(snap)),
    badge: prevRows !== undefined && !prevRows.some(r => r.date.startsWith(String(y - 1))) ? pvAnchorBadge(y - 1) : null,
    refs: pvAnchorRefs({ anchor, anchorDay, phaseDays, short, minDays: c.minOnlineDays }),
  }
}

// ── B6 台账装机 vs 板数 × 标称(§3.7;§1 #4)──────────────────────────────

export interface LedgerPoint { id: number; name: string; phase: number; x: number; y: number; diff: number }
export interface LedgerScatter {
  /** x = 板数 × 单块标称 ÷ 1000,y = 台账装机;缺任一不出点 */
  points: LedgerPoint[]
  /** 已装表但板数或单块标称未录的栋数 */
  unrecorded: number
  metered: number
  /** 带宽 = crit.ledger(±3% 那条) */
  tolerance: number
  hint: string
  /** 一栋都没录板数(2026-10-06 改稿):整张卡收成一行字 +「去录入 →」,不画空图;录了一栋以上照画散点 */
  empty: string | null
}

export function ledgerScatter(snap: AnaSnapshot): LedgerScatter {
  const ms = snap.stations.filter(s => s.metered)
  const points = ms.filter(s => s.theoKwp != null && s.capKwp != null && s.capKwp > 0 && s.ledgerDiff != null)
    .map(s => ({ id: s.id, name: s.name, phase: s.phase, x: s.theoKwp!, y: s.capKwp!, diff: s.ledgerDiff! }))
  return {
    points,
    unrecorded: snap.quality.noPanel.length,
    metered: ms.length,
    tolerance: snap.crit.ledger,
    hint: PVH.ledger(ms.length),
    empty: ms.length && !points.length && snap.quality.noPanel.length === ms.length ? PV.ledgerEmpty(ms.length) : null,
  }
}

// ── B7 消纳结构与损耗率(§3.8)────────────────────────────────────────────

/** 副轴固定 0–6%,按物理区间取,不随数据缩放 */
export const LOSS_AXIS_MAX = 6

export interface ConsumptionTick {
  label: string
  /** kWh */
  self: number; grid: number; loss: number
  /** 损耗率 %;这一刻度没发电(未到 / 全园没抄)= null,不画成 0 */
  lossPct: number | null
  /** 超出副轴 → 折线断开 + 轴外三角 + 数值 */
  over: boolean
}
export interface Consumption {
  gran: Gran; ticks: ConsumptionTick[]; futureFrom: number | null
  hint: string
  /** 按月:上网电量比上月(growth);按年:发电最高最低的月(extremes)。比不了 = null(行位留着) */
  read: Said | null
  refs: PvSaid[]
  /** 按年:读数句点到的两个月,柱顶深色气泡(S-45);按月没有 */
  marks: { i: number; text: string }[]
  /** 按年:某一期第一条分栋读数落在哪个月,那根柱顶标「几期并网」(数据的第一个月不标;和气泡同月时让给气泡) */
  joins: { i: number; text: string }[]
}

/** 2026-10-06 改稿:卡下的长图注换成读数句 + 参照;按年加柱顶气泡与并网短标。
 *  prevRows 只给 1 月的「比上月」用(上一年 12 月) */
export function consumption(snap: AnaSnapshot, rows: ReadingRow[], prevRows: ReadingRow[] | undefined): Consumption {
  const L = snap.ledger
  const ticks = snap.ticks.map((_, i) => {
    const gen = L.self[i] + L.grid[i] + L.loss[i]
    const lossPct = gen > 0 ? (L.loss[i] / gen) * 100 : null
    return {
      label: snap.tickLabels[i], self: L.self[i], grid: L.grid[i], loss: L.loss[i],
      lossPct, over: lossPct != null && lossPct > LOSS_AXIS_MAX,
    }
  })
  const metered = snap.stations.filter(s => s.metered).length
  // 卡头「全部 N 栋楼合计」只在这一段每栋都有读数时写「全部」,和参照「按 N 栋楼 … 条抄表算」同一个数
  const segPre = snap.gran === 'month' && snap.ym ? snap.ym : String(snap.year)
  const seg = rows.filter(r => r.date.startsWith(segPre))
  const segN = new Set(seg.map(r => r.stationId)).size
  const base = { gran: snap.gran, ticks, futureFrom: snap.elapsedN < snap.ticks.length ? snap.elapsedN : null, hint: PVH.cons(seg.length ? segN : metered, metered) }
  if (snap.gran === 'month' && snap.ym) {
    const m = Number(snap.ym.slice(5, 7))
    const pre = m > 1 ? `${snap.year}-${pad2(m - 1)}` : `${snap.year - 1}-12`
    // 本月还没读满时上月只取到同一个日号(10 天比 30 天,比的是天数不是发电)
    const last = seg.reduce((t, r) => (r.date > t ? r.date : t), '')
    const cut = last && last < `${snap.ym}-${pad2(daysInMonth(snap.ym))}` ? last.slice(8) : null
    const prev = (m > 1 ? rows : prevRows ?? []).filter(r => r.date.startsWith(pre) && (!cut || r.date.slice(8) <= cut))
    const grid = (rs: ReadingRow[]) => rs.reduce((t, r) => t + r.gridFeed, 0)
    return {
      ...base,
      read: seg.length && prev.length
        ? pvConsGrowth({ m: monthLabel(m), pm: m > 1 ? monthLabel(m - 1) : '去年12月', a: grid(prev), b: grid(seg) }) : null,
      refs: [...(seg.length ? [pvSampleRef(segN, seg.length, metered)] : []), pvLossRef()],
      marks: [], joins: [],
    }
  }
  const read = pvConsYear(ticks.flatMap(t => {
    const gen = t.self + t.grid + t.loss
    return gen > 0 ? [{ label: t.label, value: gen }] : []
  }))
  const marks = read ? [read.hi, read.lo].map(x => ({ i: ticks.findIndex(t => t.label === x.label), text: pvConsMark(x.label, x.value) })) : []
  // 并网月 = 这一期第一条分栋读数的月;一年里的第一个月不算(那是数据从这里起,不是并网)
  const phaseOf = new Map(snap.stations.map(s => [s.id, s.phase]))
  const first = new Map<number, string>()
  let d0: string | null = null
  for (const r of rows) {
    if (!r.date.startsWith(String(snap.year))) continue
    const p = phaseOf.get(r.stationId)
    if (p != null && (!first.has(p) || r.date < first.get(p)!)) first.set(p, r.date)
    if (d0 == null || r.date < d0) d0 = r.date
  }
  const joins: Consumption['joins'] = []
  for (const [p, d] of [...first].sort((a, b) => a[0] - b[0])) {
    const i = Number(d.slice(5, 7)) - 1
    // ponytail: 两期同月并网只标先那期,和气泡同月让给气泡 —— 一根柱顶只放得下一个标
    if (d.slice(0, 7) > d0!.slice(0, 7) && !marks.some(k => k.i === i) && !joins.some(j => j.i === i)) joins.push({ i, text: PV.join(p) })
  }
  return { ...base, read, refs: [pvLossRef()], marks, joins }
}

// ── B8 各栋收益堆叠条(§3.9)────────────────────────────────────────────

export interface RevenueRow {
  id: number; name: string; phase: number
  /** 本段发电 kWh */
  gen: number
  /** 自己用了 ¥ = Σ 录入时的 revenue(单价快照,调价不改历史) */
  self: number
  /** 卖上网 ¥ = Σ 上网电量 × 那个月的上网单价(没读到的月按 0,参照里写明) */
  grid: number
  total: number
}
export interface RevenueBars {
  /** 按合计降序(条尾两位小数一样的按楼栋顺序);本段没有发电的栋不出行 */
  rows: RevenueRow[]
  /** 这一段只用到一个上网单价时是它;几个月不同价或有月份没读到 = null */
  gridPrice: number | null
  /** 本段还没录满时的「截至 M/D」;整段录满或数据在段外 = null */
  through: string | null
  hint: string
  read: Said | null
  /** 上网单价、自用单价两句;按年另加「哪几栋不是整年都有读数」 */
  refs: PvSaid[]
}

export function revenueBars(snap: AnaSnapshot, rows: ReadingRow[], gridPrice: PriceIn): RevenueBars {
  const price = priceFn(gridPrice)
  const used = new Set<number>()
  let missing = false
  const inSeg = snap.gran === 'month' && snap.ym
    ? (d: string) => d.startsWith(snap.ym!)
    : (d: string) => d.startsWith(String(snap.year))
  const acc = new Map<number, { gen: number; self: number; grid: number; first: string; last: string }>()
  for (const r of rows) {
    if (!inSeg(r.date)) continue
    const a = acc.get(r.stationId) ?? { gen: 0, self: 0, grid: 0, first: r.date, last: r.date }
    const p = price(r.date.slice(0, 7))
    if (p == null) missing = true
    else used.add(p)
    a.gen += r.gen; a.self += r.revenue; a.grid += r.gridFeed * (p ?? 0)
    if (r.date < a.first) a.first = r.date
    if (r.date > a.last) a.last = r.date
    acc.set(r.stationId, a)
  }
  const out: RevenueRow[] = []
  for (const s of snap.stations) {
    const a = acc.get(s.id)
    if (!s.metered || !a || !(a.gen > 0)) continue
    out.push({ id: s.id, name: s.name, phase: s.phase, gen: a.gen, self: a.self, grid: a.grid, total: a.self + a.grid })
  }
  const order = new Map(snap.stations.map((s, i) => [s.id, i]))
  const w2 = (v: number) => Math.round(v / 100)   // 条尾写的是万元两位小数
  out.sort((x, y) => w2(y.total) - w2(x.total) || order.get(x.id)! - order.get(y.id)!)
  const segStart = snap.gran === 'month' ? snap.ticks[0] : `${snap.year}-01-01`
  const segEnd = snap.gran === 'month' ? snap.ticks[snap.ticks.length - 1] : `${snap.year}-12-31`
  const dt = snap.dataThrough
  const metered = snap.stations.filter(s => s.metered)
  return {
    rows: out, gridPrice: used.size === 1 && !missing ? [...used][0] : null,
    through: dt && dt >= segStart && dt < segEnd ? `${Number(dt.slice(5, 7))}/${Number(dt.slice(8, 10))}` : null,
    hint: PVH.rev(out.length, metered.length),
    read: pvRevRead(out),
    refs: [...(used.size || missing ? pvRevRefs([...used], missing) : []), ...(snap.gran === 'year' ? [partialYear(out, acc, metered)] : [])].filter((x): x is PvSaid => x != null),
  }
}

/** 按年:第一条读数晚于全园第一个月的楼(年中才并网)。按第一条读数的月分组,晚的在前;
 *  两栋以内写楼名,正好是一整期写「二期」,其余写「N 栋楼」 */
function partialYear(out: RevenueRow[], acc: Map<number, { first: string; last: string }>, metered: { id: number; phase: number }[]): PvSaid | null {
  const mOf = (d: string) => Number(d.slice(5, 7))
  const fs = out.map(r => mOf(acc.get(r.id)!.first))
  if (!fs.length) return null
  const m0 = Math.min(...fs), m1 = Math.max(...out.map(r => mOf(acc.get(r.id)!.last)))
  // 组内楼名按楼栋顺序写(out 是按合计排的)
  const pos = new Map(metered.map((s, k) => [s.id, k]))
  const by = new Map<number, RevenueRow[]>()
  out.forEach((r, k) => { if (fs[k] > m0) by.set(fs[k], [...(by.get(fs[k]) ?? []), r].sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)) })
  return pvRevShortRef([...by].sort((a, b) => b[0] - a[0]).map(([from, g]) => {
    const p = g[0].phase
    const whole = g.every(r => r.phase === p) && metered.filter(s => s.phase === p).length === g.length
    return { who: g.length <= 2 ? g.map(r => r.name).join('、') : whole ? phaseName(p) : nB(g.length), from, to: m1, n: g.length }
  }))
}

// ── L1 α 排序条 + L5 那一行(§3.10 §3.11;§1 #3)────────────────────────

export interface AlphaBar {
  id: number; name: string; phase: number
  alphaPct: number
  /** 95% 区间(congenitalCheck 取 2.5% / 97.5%) */
  ciLo: number; ciHi: number
  /** 1 = 最高 */
  rank: number
  crossesZero: boolean
}
export interface AlphaBars {
  /** 按 α 降序 */
  rows: AlphaBar[]
  /** 没进模型的已装表栋(未投产 / 未录容量),占行写字不画条 */
  rest: { id: number; name: string; phase: number }[]
  /** 在网不足 minOnlineDays 天,不进排序,占行写天数 */
  short: { id: number; name: string; phase: number; days: number }[]
  /** 台账与铭牌对不上被踢出排序的栋名,必须写出来 */
  excluded: string[]
}

export function alphaBars(lab: LabResult, snap: AnaSnapshot): AlphaBars {
  const phase = new Map(snap.stations.map(s => [s.id, s.phase]))
  const shortD = shortMap(snap)
  const rows = [...lab.alphaRows].filter(r => !shortD.has(r.id)).sort((a, b) => b.alphaPct - a.alphaPct).map((r, i) => ({
    id: r.id, name: r.name, phase: phase.get(r.id) ?? 0,
    alphaPct: r.alphaPct, ciLo: r.ciLo, ciHi: r.ciHi, rank: i + 1,
    crossesZero: r.ciLo <= 0 && r.ciHi >= 0,
  }))
  const short = snap.stations.filter(s => shortD.has(s.id)).map(s => ({ id: s.id, name: s.name, phase: s.phase, days: shortD.get(s.id)! }))
  const seen = new Set([...rows.map(r => r.name), ...lab.alphaExcluded, ...short.map(s => s.name)])
  return {
    rows,
    short,
    rest: snap.stations.filter(s => s.metered && !seen.has(s.name)).map(s => ({ id: s.id, name: s.name, phase: s.phase })),
    excluded: lab.alphaExcluded,
  }
}

export interface PolishStability {
  n: number
  sameN: number
  /** 两种扫描顺序下名次变了的栋;名次 1 = 最高 */
  moved: { name: string; from: number; to: number }[]
  /** 变动的栋挪的位数都一样时给这个数(「各挪了 k 位」);不一样或没人动 = null */
  sameShift: number | null
}

export function polishStability(lab: LabResult, snap: AnaSnapshot): PolishStability {
  const c = lab.convergence
  const shortD = shortMap(snap)
  const shortNames = new Set(snap.stations.filter(s => shortD.has(s.id)).map(s => s.name))
  // 名次只在进 α 排序的栋里排(与 alphaBars 同一批);logic 的 rank 1 = α 最低,屏上 1 = 最高
  const idx = c.names.flatMap((name, i) => (shortNames.has(name) ? [] : [i]))
  const place = (rank: number[]) => new Map([...idx].sort((a, b) => rank[b] - rank[a]).map((i, k) => [i, k + 1]))
  const rp = place(c.rowRank), cp = place(c.colRank)
  const n = idx.length
  const moved = idx.flatMap(i => (rp.get(i) === cp.get(i) ? [] : [{ name: c.names[i], from: rp.get(i)!, to: cp.get(i)! }]))
  const shifts = new Set(moved.map(m => Math.abs(m.to - m.from)))
  return {
    n, sameN: n - moved.length, moved,
    sameShift: shifts.size === 1 ? [...shifts][0] : null,
  }
}

// ── L3 13 × 12 残差格(§3.12;§1 #14)────────────────────────────────────

export interface ResidualCell {
  month: number
  /** 残差中位数换算成 % = (eᵛ − 1) × 100;空格 = null */
  pct: number | null
  /** 色阶 0–4:|pct| 落在 thresholds 哪一档(0 = 接近 0 的墨 4% 格) */
  level: 0 | 1 | 2 | 3 | 4
  sign: -1 | 0 | 1
  /** value = 有数;empty = 有效抄表不足 / 投产前;future = 还没到 */
  state: 'value' | 'empty' | 'future'
  /** 这个月数据没录满 */
  partial: boolean
}
export interface ResidualRow { id: number; name: string; phase: number; inModel: boolean; cells: ResidualCell[] }
export interface ResidualGrid {
  /** 按楼栋固定顺序,不按年内极差排 */
  rows: ResidualRow[]
  /** 四条档位线(%),由 seasonHalf 定:半幅 × 0.2 / 0.4 / 0.7 / 1 */
  thresholds: [number, number, number, number]
  /** 当段月(列头实底);年档 = null */
  currentMonth: number | null
  /** 数据截止月;之后的月是 future */
  throughMonth: number
  /** 没进模型的行数(整行空格) */
  outsideN: number
  /** 其中在网不足 minOnlineDays 天的行数(图例右侧「N 栋楼在网太短，没算」) */
  shortN: number
  /** 某期年内并网那个月,老的那一期在网各栋那一格冲到最深一档以上:写出范围(颜色封顶了,数要说出来)。
   *  p = 并网的那一期,p0 = 最早那一期;没有这种月 = null */
  join: { m: number; p: number; p0: number; n: number; lo: number; hi: number } | null
  /** 这一年里每一期第一条读数落在的月(最早那一期除外):这个月全园中间那栋跟着变,别的期的格子不全是自己的变化 */
  joins?: { m: number; p: number }[]
}

export function residualGrid(lab: LabResult, snap: AnaSnapshot): ResidualGrid {
  const half = (Math.exp(lab.seasonHalf) - 1) * 100
  const th: [number, number, number, number] = [half * 0.2, half * 0.4, half * 0.7, half]
  const through = snap.dataThrough ? Number(snap.dataThrough.slice(5, 7)) : 0
  const season = new Map(lab.season.map(s => [s.id, s]))
  const shortD = shortMap(snap)
  const levelOf = (p: number): ResidualCell['level'] => {
    const a = Math.abs(p)
    return a < th[0] ? 0 : a < th[1] ? 1 : a < th[2] ? 2 : a < th[3] ? 3 : 4
  }
  const rows = snap.board.map<ResidualRow>(b => {
    // 在网不足 minOnlineDays 天的栋整行空格,不拿一个月的残差上色
    const s = shortD.has(b.id) ? undefined : season.get(b.id)
    return {
      id: b.id, name: b.name, phase: b.phase, inModel: !!s,
      cells: Array.from({ length: 12 }, (_, k) => {
        const month = k + 1
        const v = s?.months[k] ?? null
        const state: ResidualCell['state'] = s && month > through ? 'future' : v == null ? 'empty' : 'value'
        const pct = state === 'value' ? (Math.exp(v!) - 1) * 100 : null
        return {
          month, pct,
          level: pct == null ? 0 : levelOf(pct),
          sign: pct == null ? 0 : (Math.sign(pct) as -1 | 0 | 1),
          state,
          partial: lab.seasonPartial === k,
        }
      }),
    }
  })
  // 每期第一条读数晚于 1 月 1 日 = 这一年里并网的(同 buildDetail 跳过并网月的判据)。
  // 新的一期并网那个月全园中间那栋被拉低,最早那一期的楼那一格冲到几百 %;只在冲过最深一档时写
  const phaseFirst = new Map<number, string>()
  for (const b of snap.board) {
    const cur = phaseFirst.get(b.phase)
    if (b.firstDate && (cur == null || b.firstDate < cur)) phaseFirst.set(b.phase, b.firstDate)
  }
  const p0 = Math.min(...phaseFirst.keys())
  let join: ResidualGrid['join'] = null
  for (const [p, f] of [...phaseFirst].sort((a, b) => a[0] - b[0])) {
    if (join || p === p0 || f <= `${snap.year}-01-01`) continue
    const m = Number(f.slice(5, 7))
    const v = rows.filter(r => r.phase === p0 && r.inModel).flatMap(r => (r.cells[m - 1].pct == null ? [] : [r.cells[m - 1]]))
    if (v.some(c => c.level === 4)) {
      const pc = v.map(c => c.pct!)
      join = { m, p, p0, n: v.length, lo: Math.min(...pc), hi: Math.max(...pc) }
    }
  }
  return {
    rows, thresholds: th,
    currentMonth: snap.gran === 'month' && snap.ym ? Number(snap.ym.slice(5, 7)) : null,
    throughMonth: through,
    outsideN: rows.filter(r => !r.inModel).length,
    shortN: rows.filter(r => shortD.has(r.id)).length,
    join,
    joins: [...phaseFirst].filter(([p, f]) => p !== p0 && f > `${snap.year}-01-01`).map(([p, f]) => ({ m: Number(f.slice(5, 7)), p })),
  }
}

// ── L6 数据质量日历 + 缺抄榜(§3.13)────────────────────────────────────

export type CalKind = 'full' | 'miss' | 'drop' | 'todo'
export interface CalCell {
  date: string
  day: number
  /** 第几周(0 起,周一开头) */
  col: number
  /** 周一 = 0 … 周日 = 6 */
  row: number
  /** full 全齐 / miss 有栋没抄 / drop 整日剔除 / todo 还没到(按今天,不按数据截止日) */
  kind: CalKind
  missNames: string[]
  /** 当天已投产、在模型里的栋数(「N 栋全齐」的 N) */
  bornN: number
  /** 当天真进了矩阵的栋数(snap.quality.onDay),**不许从格子里数** */
  readN: number
}
export interface MissRow {
  id: number; name: string; phase: number
  /** counted = 数了缺抄天数;noModel = 已装表但没进模型(未录容量);unborn = 这一段还没投产 */
  kind: 'counted' | 'noModel' | 'unborn'
  missDays: number | null
}
export interface QualityCalendar {
  cells: CalCell[]
  weeks: number
  /** 已装表的栋全列:缺抄天数降序 → 没进模型 → 未投产 */
  missRows: MissRow[]
  maxMiss: number
}

export function qualityCalendar(lab: LabResult, snap: AnaSnapshot): QualityCalendar {
  const q = lab.quality
  const utc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  // 月档按自然月铺满(格位稳定,明天再打开不整体位移);年档铺首末抄表日之间
  let span: string[] = q.dates
  if (snap.gran === 'month' && snap.ym) {
    const [y, m] = snap.ym.split('-').map(Number)
    span = []
    for (let t = Date.UTC(y, m - 1, 1); new Date(t).getUTCMonth() === m - 1; t += DAY) span.push(iso(t))
  }
  const metered = new Set(snap.stations.filter(s => s.metered).map(s => s.id))
  const inRows = q.rows.filter(r => r.inMatrix && metered.has(r.id))
  const at = new Map(q.dates.map((d, i) => [d, i]))
  // 「还没到」按今天切(与 B1 / KPI 的 tickState 同一条线):数据截止日之后、今天及之前的日子是缺抄,不是未到。
  // 月档刻度就是日期,今天 = 最后一个已过去的刻度;年档日历只铺到数据截止日,没有这一段
  const elapsedTo = snap.gran === 'month' ? (snap.elapsedN > 0 ? snap.ticks[snap.elapsedN - 1] : '') : null
  const firstOf = new Map(snap.board.map(b => [b.id, b.firstDate]))
  const bornOn = (id: number, date: string) => { const f = firstOf.get(id); return f != null && f <= date }
  /** 截止日之后已过去的日子(只在月档出现) */
  const lateDays = elapsedTo == null ? [] : span.filter(d => !at.has(d) && d <= elapsedTo && (!snap.dataThrough || d > snap.dataThrough))
  const t0 = span.length ? utc(span[0]) : 0
  const dow = (t: number) => (new Date(t).getUTCDay() + 6) % 7
  const gridStart = t0 - dow(t0) * DAY
  const cells = span.map<CalCell>(date => {
    const i = at.get(date)
    const missNames: string[] = []
    let bornN = 0, dropped = false
    if (i != null) {
      for (const r of inRows) {
        const s = r.states[i]
        if (s === 'pre') continue
        bornN++
        if (s === 'missing') missNames.push(r.name)
        else if (s === 'dropped') dropped = true
      }
    } else if (lateDays.includes(date)) {
      for (const r of inRows) if (bornOn(r.id, date)) { bornN++; missNames.push(r.name) }
    }
    const t = utc(date)
    return {
      date, day: Number(date.slice(8, 10)),
      col: Math.floor((t - gridStart) / DAY / 7), row: dow(t),
      kind: dropped ? 'drop' : bornN === 0 ? 'todo' : missNames.length ? 'miss' : 'full',
      missNames, bornN,
      readN: snap.quality.onDay.get(date) ?? 0,
    }
  })
  const phase = new Map(snap.stations.map(s => [s.id, s.phase]))
  const rank = { counted: 0, noModel: 1, unborn: 2 }
  const missRows = q.rows.filter(r => metered.has(r.id)).map<MissRow>(r => {
    const born = r.states.some(s => s !== 'pre')
    const kind: MissRow['kind'] = !born ? 'unborn' : r.inMatrix ? 'counted' : 'noModel'
    return {
      id: r.id, name: r.name, phase: phase.get(r.id) ?? 0, kind,
      missDays: kind === 'counted' ? r.states.filter(s => s === 'missing').length + lateDays.filter(d => bornOn(r.id, d)).length : null,
    }
  }).sort((a, b) => rank[a.kind] - rank[b.kind] || (b.missDays ?? 0) - (a.missDays ?? 0))
  return {
    cells,
    weeks: cells.length ? cells[cells.length - 1].col + 1 : 0,
    missRows,
    maxMiss: Math.max(0, ...missRows.map(r => r.missDays ?? 0)),
  }
}

// ── L7 逐栋核对表(§3.16;§1 #16)──────────────────────────────────────────
// 2026-10-06 改稿:「隔几天的相关柱」「打乱重算的直方图」两张卡下线,一栋一个数并进这张表(隔天像不像 / 碰巧更偏)

/** 变点显著线:与 baselineWindow「p 不显著就不切」同一条。L7 与抽屉 B9 共用,两处不会一处有一处无 */
export const CP_P_MAX = 0.05

export interface LabTableRow {
  id: number; name: string; phase: number
  /** 未投产 / 没进模型 / 在网不足 minOnlineDays 天:合并单元格灰字 */
  unborn: boolean
  /** 在网不足 minOnlineDays 天时的在网天数(合并格写它);其余 null */
  shortDays: number | null
  alphaPct: number | null
  /** 1 = 常年水平最高;被踢出排序的栋 = null */
  rank: number | null
  ciLo: number | null; ciHi: number | null
  /** 变点区间(日期);不显著或没有 = null */
  cpFrom: string | null; cpTo: string | null
  validMonths: number | null
  /** 数据截止月 = 有效月数的分母 */
  monthsSoFar: number
  /** 本段有连续出范围段时的主导方向(左侧色条);读不出的栋不给 */
  runDir: -1 | 1 | null
  /** 隔天像不像:整年逐日偏差隔 1 天的相关(lab.acf 的 ρ₁);不排的栋 = null */
  rho1: number | null
  /** 碰巧更偏:观测窗口那段打乱重算里一样偏或更偏的次数(TestRow.chance);不排的栋 = null */
  chance: number | null
}

export function labTableRows(lab: LabResult, snap: AnaSnapshot): LabTableRow[] {
  const ab = alphaBars(lab, snap)
  const alpha = new Map(ab.rows.map(r => [r.id, r]))
  const tests = new Map(lab.tests.map(t => [t.id, t]))
  const season = new Map(lab.season.map(s => [s.id, s]))
  const rho1 = new Map(lab.acf.map(a => [a.id, a.rho[1] ?? null]))
  const monthsSoFar = snap.dataThrough ? Number(snap.dataThrough.slice(5, 7)) : 0
  const out = snap.board.map<LabTableRow>(b => {
    const t = tests.get(b.id), a = alpha.get(b.id)
    const sd = shortDays(b, snap)
    const cp = t && sd == null && t.p <= CP_P_MAX && t.cpRange.includes('~') ? t.cpRange.split('~').map(x => x.trim()) : null
    return {
      id: b.id, name: b.name, phase: b.phase, unborn: !t || sd != null, shortDays: sd,
      alphaPct: t && sd == null ? t.alphaPct : null,
      rank: a?.rank ?? null, ciLo: a?.ciLo ?? null, ciHi: a?.ciHi ?? null,
      cpFrom: cp?.[0] ?? null, cpTo: cp?.[1] ?? null,
      validMonths: season.get(b.id)?.months.filter(v => v != null).length ?? null,
      monthsSoFar,
      runDir: b.runs.length && !isUnreadable(b, snap) ? outDir(b) : null,
      rho1: t && sd == null ? rho1.get(b.id) ?? null : null,
      chance: t && sd == null ? t.chance : null,
    }
  })
  const key = (r: LabTableRow) => (r.unborn ? 3e9 : r.rank ?? 2e9)
  return out.sort((x, y) => key(x) - key(y))
}

// ── 抽屉 B9 B10:共用一年逐日的 x(dayOfYear)────────────────────────────

export interface DriftChart {
  daysInYear: number
  /** 卡头的覆盖(coverOf);不给按整年写 */
  cover?: string
  points: { date: string; doy: number; v: number }[]
  trend: { doy: number; fit: number; lo: number; hi: number }[]
  /** 变点竖线与区间阴影(§1 #17);不显著或没有 = null */
  cp: { date: string; doy: number; from: string; fromDoy: number; to: string; toDoy: number } | null
  /** 当前期间底色,只画到数据截止日(§6.6);年档 = null */
  seg: { month: number; fromDoy: number; toDoy: number } | null
  /** 数据截止日之后的淡底从这天起;截到年末 = null */
  futureFromDoy: number | null
}

function futureFrom(snap: AnaSnapshot): number | null {
  if (!snap.dataThrough) return null
  const d = dayOfYear(snap.dataThrough) + 1
  return d <= daysInYear(snap.year) ? d : null
}

/** 抽屉里的变点算不算数:B9 画不画竖线、B10 切不切估计窗口,都走这一道 —— 两图不会一张有一张无 */
const sigCp = (d: StationDetail) => !!(d.cp && d.cp.p <= CP_P_MAX && d.cpDate && d.cpLo && d.cpHi)

/** 抽屉在网 < 8 天(detail = null)或样条点数不够 → 整块不画 */
export function driftChart(detail: StationDetail | null, snap: AnaSnapshot): DriftChart | null {
  if (!detail || !detail.spline.length) return null
  const cp = sigCp(detail) && detail.cpDate && detail.cpLo && detail.cpHi
    ? {
        date: detail.cpDate, doy: dayOfYear(detail.cpDate),
        from: detail.cpLo, fromDoy: dayOfYear(detail.cpLo),
        to: detail.cpHi, toDoy: dayOfYear(detail.cpHi),
      }
    : null
  let seg: DriftChart['seg'] = null
  if (snap.gran === 'month' && snap.ym && snap.dataThrough && snap.dataThrough >= snap.ticks[0]) {
    const last = snap.ticks[snap.ticks.length - 1]
    const to = snap.dataThrough < last ? snap.dataThrough : last
    seg = { month: Number(snap.ym.slice(5, 7)), fromDoy: dayOfYear(snap.ticks[0]), toDoy: dayOfYear(to) }
  }
  return {
    daysInYear: daysInYear(snap.year),
    points: detail.dates.map((date, i) => ({ date, doy: dayOfYear(date), v: detail.resid[i] })),
    trend: detail.spline.map(s => ({ doy: dayOfYear(s.date), fit: s.fit, lo: s.lo, hi: s.hi })),
    cp, seg,
    futureFromDoy: futureFrom(snap),
    cover: coverOf(snap),
  }
}

export interface ControlChart {
  daysInYear: number
  /** 卡头的覆盖(coverOf);不给按整年写 */
  cover?: string
  center: number
  /** 内带 = 中线 ± 2 倍,外带 = ± 3 倍(屏上不写倍数的名字) */
  inner: { lo: number; hi: number }
  outer: { lo: number; hi: number }
  /** level:0 在里面 / 1 超出里面那道 / 2 超出外面那道 */
  points: { date: string; doy: number; v: number; level: 0 | 1 | 2 }[]
  /** [在里面, 超出里面那道, 超出外面那道] 天数,三者互斥 */
  counts: [number, number, number]
  /** 两道线的估计窗口 */
  window: { from: string; fromDoy: number; to: string; toDoy: number } | null
  /** 变点前段不足 8 点,退回拿全期估 —— 要如实标出 */
  wholePeriod: boolean
  futureFromDoy: number | null
}

export function controlChart(detail: StationDetail | null, snap: AnaSnapshot): ControlChart | null {
  if (!detail) return null
  // buildDetail 按变点位置切窗口不看显著性;变点不算数时 B9 不画线,这里也不许按它切 —— 退回全期估
  const whole = !sigCp(detail)
  const center = whole ? median(detail.resid) : detail.center
  const sigma = whole ? robustSigma(detail.resid) : detail.sigma
  const limitFrom = whole ? detail.dates[0] ?? null : detail.limitFrom
  const limitTo = whole ? detail.dates[detail.dates.length - 1] ?? null : detail.limitTo
  const counts: [number, number, number] = [0, 0, 0]
  const points = detail.dates.map((date, i) => {
    const v = detail.resid[i]
    const dev = Math.abs(v - center)
    const level: 0 | 1 | 2 = dev > 3 * sigma ? 2 : dev > 2 * sigma ? 1 : 0
    counts[level]++
    return { date, doy: dayOfYear(date), v, level }
  })
  return {
    daysInYear: daysInYear(snap.year),
    center,
    inner: { lo: center - 2 * sigma, hi: center + 2 * sigma },
    outer: { lo: center - 3 * sigma, hi: center + 3 * sigma },
    points, counts,
    window: limitFrom && limitTo
      ? { from: limitFrom, fromDoy: dayOfYear(limitFrom), to: limitTo, toDoy: dayOfYear(limitTo) }
      : null,
    wholePeriod: limitTo === detail.dates[detail.dates.length - 1],
    futureFromDoy: futureFrom(snap),
    cover: coverOf(snap),
  }
}

// ── B11 十二个月槽(§3.19)──────────────────────────────────────────────

export interface BetaSlot {
  month: number
  beta: number | null
  /** 空槽原因:pre 投产前 / thin 样本不足 / future 还没到;有值 = null */
  why: 'pre' | 'thin' | 'future' | null
  /** 当段月(底色);年档恒 false */
  current: boolean
}

export function betaSlots(snap: AnaSnapshot, stationId: number): BetaSlot[] {
  const rows = new Map((snap.slopes.get(stationId) ?? []).map(r => [Number(r.key.slice(5, 7)), r]))
  const first = snap.board.find(b => b.id === stationId)?.firstDate ?? null
  const firstMonth = first ? Number(first.slice(5, 7)) : 13
  const through = snap.dataThrough ? Number(snap.dataThrough.slice(5, 7)) : 0
  const cur = snap.gran === 'month' && snap.ym ? Number(snap.ym.slice(5, 7)) : null
  return Array.from({ length: 12 }, (_, k) => {
    const month = k + 1
    const r = rows.get(month)
    const ok = r != null && r.n >= 3 && isFinite(r.se) && isFinite(r.beta)
    const why: BetaSlot['why'] = month > through ? 'future' : month < firstMonth ? 'pre' : ok ? null : 'thin'
    return { month, beta: why == null ? r!.beta : null, why, current: month === cur }
  })
}

// ── B12 逐刻度明细(§3.20)──────────────────────────────────────────────

export interface DetailRow {
  key: string
  label: string
  /** 当刻度发电度数;没抄 = null(不是 0) */
  gen: number | null
  ratio: number | null
  state: 'seen' | 'missing'
  out: -1 | 0 | 1 | null
  /** 在连续段里时是「连续第 k 个刻度」(跨过的漏抄不计) */
  runDay: number | null
}

/** 只列这一栋、本段、已过去且已投产的刻度,时间升序。未到的不出现,漏抄的出现 */
export function detailRows(snap: AnaSnapshot, rows: ReadingRow[], stationId: number): DetailRow[] {
  const b = snap.board.find(x => x.id === stationId)
  if (!b) return []
  const keyOf = snap.gran === 'month' ? (d: string) => d : (d: string) => d.slice(0, 7)
  const gen = new Map<string, number>()
  for (const r of rows) {
    if (r.stationId !== stationId) continue
    const k = keyOf(r.date)
    gen.set(k, (gen.get(k) ?? 0) + r.gen)
  }
  const runDay = new Map<number, number>()
  for (const r of b.runs) {
    let k = 0
    for (let i = r.from; i <= r.to; i++) if (b.out[i] === r.dir) runDay.set(i, ++k)
  }
  return snap.ticks.flatMap((t, i) => {
    const st = b.state[i]
    if (st === 'future' || preBorn(b, t)) return []
    return [{
      key: t, label: snap.tickLabels[i],
      gen: gen.get(t) ?? null,
      ratio: b.ratio[i], state: st, out: b.out[i] as DetailRow['out'],
      runDay: runDay.get(i) ?? null,
    }]
  })
}

// ── 叶子组件的 props(T1 按这里接)──────────────────────────────────────

export interface PvChipsProps { groups: ChipGroups }
export interface PvDayChartProps {
  row: BoardRow
  ticks: string[]
  tickLabels: string[]
  gran: Gran
  /** 前 elapsedN 个刻度已过去,之后画未到淡底 */
  elapsedN: number
  /** dayFact(row, snap) */
  fact: string
  /** isUnreadable(row, snap):读不出的栋不画连续段底色、不给点按出范围着色(§07 不出判据结论) */
  unreadable: boolean
}
export interface PvYieldBandProps { data: YieldBand }
export interface PvAnchorBarsProps { data: AnchorBars; selId: number | null }
export interface PvLedgerScatterProps { data: LedgerScatter }
export interface PvConsumptionProps { data: Consumption }
export interface PvRevenueBarsProps { data: RevenueBars; selId: number | null }
export interface PvAlphaBarsProps {
  data: AlphaBars; stability: PolishStability; selId: number | null
  /** 卡头的覆盖:按月写「2025年全年」(整年的卡放在按月的屏上,S-17);按年 null → 写「N 栋楼」 */
  cover: string | null
}
export interface PvResidualHeatProps { data: ResidualGrid; selId: number | null }
export interface PvQualityGridProps { data: QualityCalendar }
export interface PvLabTableProps {
  rows: LabTableRow[]
  /** 卡头的覆盖:按月「2025年全年」,按年 null(和工具条同一个期不写) */
  cover: string | null
  /** 「碰巧更偏」打乱的是哪个月(LabResult.window.label 的月);表脚写它 */
  winMonth: number | null
}
export interface PvDriftChartProps { data: DriftChart }
export interface PvControlChartProps { data: ControlChart }
export interface PvBetaChartProps { slots: BetaSlot[] }
/** name:卡头写这一栋的名字(PVH.rows) */
export interface PvDetailTableProps { rows: DetailRow[]; gran: Gran; name: string }
