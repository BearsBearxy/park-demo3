// 光伏分栋分析屏 v4 · 数据整形层(PV-ANALYSIS-SCREEN-V4 §3;实施计划 2026-09-13 §3 T0)。
//
// 输入全是 pvMeterAna.logic.ts 已经算好的快照 / 工作台 / 抽屉结构,这里**不另起一次计算**
// (唯一例外是 KPI 迷你线要逐月跑 buildSnapshot,见 kpiSparks)。
// 叶子组件只做像素几何,数据口径(谁算读不出、缺抄怎么数、按什么排、带宽取多少)全在这里,
// 每个叶子组件的 props 类型也从这里导出(文件末尾)。单测 pvAnaV4.logic.spec.ts。
//
// 屏上文案只写测量,不写定性;不写统计名词。

import {
  buildSnapshot, median, robustSigma,
  type AnaSnapshot, type BoardRow, type Gran, type LabResult, type ReadingRow,
  type SnapshotInput, type StationDetail, type TickState,
} from './pvMeterAna.logic'

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
  if (b.center == null) return b.baseNote
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
    }
  })
  const byKey = (a: ChipItem, b: ChipItem) => Number(b.hasRun) - Number(a.hasRun) || b.outDays - a.outDays
  const late = (c: ChipItem) => (c.kind === 'unreadable' ? 1 : 0)
  const shown = items
    .filter(c => c.kind === 'hit' || c.kind === 'unreadable' || c.selected)
    .sort((a, b) => late(a) - late(b) || byKey(a, b))
  const folded = items
    .filter(c => !shown.includes(c))
    .sort((a, b) => Number(a.kind === 'unborn') - Number(b.kind === 'unborn') || byKey(a, b))
  return { shown, folded, unit: unitOf(snap.gran) }
}

/** B1 大图图头的三段式事实句:出范围几天(低/高)· 连续段 · 缺抄几天。读不出的栋只写原因,不出判据结论(§07) */
export function dayFact(row: BoardRow, snap: AnaSnapshot): string {
  const why = unreadableWhy(row, snap)
  if (why) return `读不出 · ${why}`
  if (row.lo == null) return row.baseNote
  const unit = unitOf(snap.gran)
  if (row.seenN === 0) return `这一段还没有抄表`
  const suf = snap.gran === 'month' ? '日' : '月'
  const lab = (i: number) => snap.tickLabels[i].replace('月', '')
  const below = row.out.filter(v => v === -1).length
  const above = row.out.filter(v => v === 1).length
  const parts = [row.outN
    ? `${row.outN} ${unit}出范围（低 ${below} 高 ${above}）`
    : `${row.seenN} ${unit}都在范围内`]
  // 段末端正好是数据截止日 = 仍在持续,不写闭区间(§03.8)
  const runs = row.runs.map(r => {
    const dir = r.dir < 0 ? '低于' : '高于'
    return r.live ? `${lab(r.from)} ${suf}起${dir}（仍在持续）` : `${lab(r.from)}–${lab(r.to)} ${suf}${dir}`
  })
  if (runs.length) parts.push(runs.join('、'))
  const miss = missingN(row, snap.ticks)
  if (miss) parts.push(`缺抄 ${miss} ${unit}`)
  return parts.join(' · ')
}

// ── B0 KPI 行(§3.1;§1 #10 #11)───────────────────────────────────────────

/** 与 AnaKpiTile 的 props 同形 */
export interface KpiTile { label: string; value: string; note: string; noteTone?: 'warn' }

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

export function kpiTiles(snap: AnaSnapshot): KpiTile[] {
  const k = kpiCounts(snap)
  const c = snap.crit
  const list = (xs: string[]) => (xs.length ? xs.join(' · ') : '—')
  const metered = snap.stations.filter(s => s.metered).length
  const noPanel = snap.quality.noPanel.length
  const due = k.seen + k.missing
  const warn = (on: boolean) => (on ? { noteTone: 'warn' as const } : {})
  return [
    { label: '本段出范围栋数', value: `${k.out.length} 栋`, note: list(k.out.map(b => b.name)), ...warn(k.out.length > 0) },
    {
      label: '读不出', value: `${k.unreadable.length} 栋`,
      note: k.unreadable.length
        ? list(k.unreadable.map(b => b.name))
        : `${k.born.length} 栋覆盖都 ≥ ${pct0(c.coverMonth)}`,
    },
    { label: '未装表', value: `${snap.quality.noMeter.length} 栋`, note: list(snap.quality.noMeter) },
    { label: '已录板数', value: `${metered - noPanel}/${metered}`, note: noPanel ? `${noPanel} 栋未录` : '—' },
    { label: '缺抄条数', value: `${k.missing} 条`, note: list(k.miss.map(x => `${x.name} ${x.n}`)), ...warn(k.missing > 0) },
    {
      label: '数据到', value: snap.dataThrough ? snap.dataThrough.slice(5) : '—',
      note: `已过去 ${snap.elapsedN}/${snap.ticks.length} ${unitOf(snap.gran)} · 已抄 ${k.seen}/${due} · ${due ? `${Math.round((k.seen / due) * 100)}%` : '—'}`,
    },
  ]
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
  items: { key: 'band' | 'run' | 'cover' | 'ledger' | 'yield'; text: string }[]
  /** 选中栋的范围是拿哪一段估的(§1 #9);没选中 = null;画不出范围时是原因句 */
  baseNote: string | null
  /** 判据脚末尾那句(§1 #8) */
  tail: string
}

export function critFoot(snap: AnaSnapshot, selId: number | null): CritFoot {
  const c = snap.crit
  const row = snap.board.find(b => b.id === selId) ?? null
  const base = row?.base
  return {
    items: [
      { key: 'band', text: `范围 = 这栋自己的水平 ± ${c.bandSigma} 倍稳健波动` },
      { key: 'run', text: `连续 ≥ ${c.bandRun} ${snap.gran === 'year' ? '个月' : '天'}出范围计一段` },
      { key: 'cover', text: `抄表覆盖 ≥ ${pct0(c.coverMonth)} 才判` },
      { key: 'ledger', text: `台账差 ±${pct0(c.ledger)}` },
      { key: 'yield', text: `年等效 ≥ ${+(c.anchorHours * c.yieldRatio).toFixed(1)} h` },
    ],
    // 窗口不一定连续(月档排掉了当段),只写首末会撒谎,所以带上条数
    // 为凑够样本放宽了哪几条也要写出来 —— 静默放宽等于屏上说「同批在网」而实际没限(§03.7)
    baseNote: !row ? null
      : base ? `范围按 ${base.from.slice(5)}~${base.to} 算，共 ${base.n} ${base.unit}${base.relaxed.length ? `，放宽 ${base.relaxed.length} 档：${base.relaxed.join('、')}` : ''}`
        : row.baseNote,
    tail: '未列出 ≠ 没问题',
  }
}

// ── B3 等效小时轨迹(§3.5;§1 #13)────────────────────────────────────────

export interface YieldBand {
  gran: Gran
  labels: string[]
  /** 选中栋逐刻度等效小时;漏抄 / 未到 / 没选中 = null */
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
  /** 数据截止日(最后一条抄表)落在第几个刻度;截止日在段末或段外 = null */
  throughIdx: number | null
  onlineN: number
  unbornN: number
  denomNote: string
}

/** 等效小时分母的口径句(§07:未录板数退回台账装机并写明) */
export function denomNote(snap: AnaSnapshot): string {
  const metered = snap.stations.filter(s => s.metered).length
  const n = snap.quality.noPanel.length
  if (n === 0) return '分母 = 板数 × 单块标称'
  if (n === metered) return `分母 = 台账装机（${n} 栋未录板数）`
  return `分母 = 板数 × 单块标称；${n} 栋未录板数，用台账装机`
}

/** 「数据到」写哪个刻度:最后一条抄表所在的刻度。不拿 elapsedN —— 那是按今天算的,今天晚于最后抄表时会把今天写成「数据到」 */
function throughIdx(snap: AnaSnapshot): number | null {
  const dt = snap.dataThrough
  if (!dt) return null
  let k = -1
  snap.ticks.forEach((t, i) => { if (t <= dt.slice(0, t.length)) k = i })
  return k >= 0 && k < snap.ticks.length - 1 ? k : null
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
  return {
    gran: snap.gran,
    labels: snap.tickLabels,
    sel: row ? (eh.get(row.id) ?? snap.ticks.map(() => null)).map((v, i) => (row.state[i] === 'seen' ? v : null)) : snap.ticks.map(() => null),
    selState: row ? row.state.map((s, i) => (s === 'missing' && preBorn(row, snap.ticks[i]) ? 'pre' : s)) : [],
    selName: row?.name ?? null,
    med, lo, hi,
    futureFrom: snap.elapsedN < snap.ticks.length ? snap.elapsedN : null,
    throughIdx: throughIdx(snap),
    onlineN: snap.board.filter(b => b.bornBySeg).length,
    unbornN: snap.board.filter(b => !b.bornBySeg).length,
    denomNote: denomNote(snap),
  }
}

// ── A2 年等效小时(§3.6;§1 #12 #19)──────────────────────────────────────

export interface AnchorRow {
  id: number; name: string; phase: number
  yieldHours: number
  /** 比锚点多几小时(负 = 少) */
  delta: number
  /** (年等效 ÷ 锚点 − 1) × 100 */
  deltaPct: number
  /** 比上一年多几小时,按两年都有抄表的月对齐(§07);当年没录满的那个月不参与;
   *  上一年无抄表 / 没有共同月份 / 上一年数据没取到 = null */
  prevDelta: number | null
  /** 参与对齐的月数 */
  prevMonths: number
}
export interface AnchorBars {
  /** 锚点 = anchorHours × yieldRatio */
  anchor: number
  /** 按年等效降序 */
  rows: AnchorRow[]
  /** 整年一条抄表都没有 */
  unborn: { id: number; name: string; phase: number }[]
  /** 在网 < minOnlineDays,移出不画、不年化,图注计数 */
  short: string[]
  /** 没有装机分母 */
  noDenom: string[]
  /** prevDelta 为 null 的行数 */
  noPrev: number
  /** 上一年的抄表取回来了没有(还在请求 / 请求失败 = false)。false 时不许写成「去年无抄表」 */
  prevLoaded: boolean
  /** 等效小时分母口径(§07,与 B3 同一句) */
  denomNote: string
}

export function anchorBars(snap: AnaSnapshot, rows: ReadingRow[], prevRows: ReadingRow[] | undefined): AnchorBars {
  const c = snap.crit
  const anchor = c.anchorHours * c.yieldRatio
  const denom = denomOf(snap)
  // 数据截止日不是月末 → 那个月今年没录满,拿它去减去年整月会把每栋都拉低半个月的量
  const dt = snap.dataThrough
  const partial = dt && Number(dt.slice(8, 10)) < new Date(Date.UTC(Number(dt.slice(0, 4)), Number(dt.slice(5, 7)), 0)).getUTCDate()
    ? dt.slice(5, 7) : null
  const byMonth = (rs: ReadingRow[]) => {
    const m = new Map<number, Map<string, number>>()
    for (const r of rs) {
      if (!(r.gen > 0) || r.date.slice(5, 7) === partial) continue
      let s = m.get(r.stationId)
      if (!s) { s = new Map(); m.set(r.stationId, s) }
      const k = r.date.slice(5, 7)
      s.set(k, (s.get(k) ?? 0) + r.gen)
    }
    return m
  }
  const cur = byMonth(rows)
  const prev = byMonth(prevRows ?? [])
  const firstOf = new Map(snap.board.map(b => [b.id, b.firstDate]))
  const out: AnchorBars = {
    anchor, rows: [], unborn: [], short: [], noDenom: [], noPrev: 0,
    prevLoaded: prevRows !== undefined, denomNote: denomNote(snap),
  }
  for (const s of snap.stations) {
    if (!s.metered) continue
    if (firstOf.get(s.id) == null) { out.unborn.push({ id: s.id, name: s.name, phase: s.phase }); continue }
    if (s.yieldHours == null) { out.noDenom.push(s.name); continue }
    if (s.days < c.minOnlineDays) { out.short.push(s.name); continue }
    const a = cur.get(s.id), p = prev.get(s.id), d = denom.get(s.id)!
    const shared = a && p ? [...a.keys()].filter(k => p.has(k)) : []
    const prevDelta = shared.length
      ? shared.reduce((t, k) => t + a!.get(k)! - p!.get(k)!, 0) / d
      : null
    if (prevDelta == null) out.noPrev++
    out.rows.push({
      id: s.id, name: s.name, phase: s.phase,
      yieldHours: s.yieldHours,
      delta: s.yieldHours - anchor,
      deltaPct: (s.yieldHours / anchor - 1) * 100,
      prevDelta, prevMonths: shared.length,
    })
  }
  out.rows.sort((x, y) => y.yieldHours - x.yieldHours)
  return out
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
}

export function ledgerScatter(snap: AnaSnapshot): LedgerScatter {
  const ms = snap.stations.filter(s => s.metered)
  return {
    points: ms.filter(s => s.theoKwp != null && s.capKwp != null && s.capKwp > 0 && s.ledgerDiff != null)
      .map(s => ({ id: s.id, name: s.name, phase: s.phase, x: s.theoKwp!, y: s.capKwp!, diff: s.ledgerDiff! })),
    unrecorded: snap.quality.noPanel.length,
    metered: ms.length,
    tolerance: snap.crit.ledger,
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
  /** 数据截止日所在刻度(图注「数据到」);截止日在段末或段外 = null */
  throughIdx: number | null
}

export function consumption(snap: AnaSnapshot): Consumption {
  const L = snap.ledger
  return {
    gran: snap.gran,
    ticks: snap.ticks.map((_, i) => {
      const gen = L.self[i] + L.grid[i] + L.loss[i]
      const lossPct = gen > 0 ? (L.loss[i] / gen) * 100 : null
      return {
        label: snap.tickLabels[i], self: L.self[i], grid: L.grid[i], loss: L.loss[i],
        lossPct, over: lossPct != null && lossPct > LOSS_AXIS_MAX,
      }
    }),
    futureFrom: snap.elapsedN < snap.ticks.length ? snap.elapsedN : null,
    throughIdx: throughIdx(snap),
  }
}

// ── B8 各栋收益堆叠条(§3.9)────────────────────────────────────────────

export interface RevenueRow {
  id: number; name: string; phase: number
  /** 本段发电 kWh */
  gen: number
  /** 自己用了 ¥ = Σ 录入时的 revenue(单价快照,调价不改历史) */
  self: number
  /** 卖上网 ¥ = Σ 上网电量 × gridPrice */
  grid: number
  total: number
}
export interface RevenueBars {
  /** 按合计降序;本段没有发电的栋不出行 */
  rows: RevenueRow[]
  gridPrice: number
  /** 本段还没录满时的「截至 M/D」;整段录满或数据在段外 = null */
  through: string | null
}

export function revenueBars(snap: AnaSnapshot, rows: ReadingRow[], gridPrice: number): RevenueBars {
  const inSeg = snap.gran === 'month' && snap.ym
    ? (d: string) => d.startsWith(snap.ym!)
    : (d: string) => d.startsWith(String(snap.year))
  const acc = new Map<number, { gen: number; self: number; grid: number }>()
  for (const r of rows) {
    if (!inSeg(r.date)) continue
    const a = acc.get(r.stationId) ?? { gen: 0, self: 0, grid: 0 }
    a.gen += r.gen; a.self += r.revenue; a.grid += r.gridFeed * gridPrice
    acc.set(r.stationId, a)
  }
  const out: RevenueRow[] = []
  for (const s of snap.stations) {
    const a = acc.get(s.id)
    if (!s.metered || !a || !(a.gen > 0)) continue
    out.push({ id: s.id, name: s.name, phase: s.phase, gen: a.gen, self: a.self, grid: a.grid, total: a.self + a.grid })
  }
  out.sort((x, y) => y.total - x.total)
  const segStart = snap.gran === 'month' ? snap.ticks[0] : `${snap.year}-01-01`
  const segEnd = snap.gran === 'month' ? snap.ticks[snap.ticks.length - 1] : `${snap.year}-12-31`
  const dt = snap.dataThrough
  return {
    rows: out, gridPrice,
    through: dt && dt >= segStart && dt < segEnd ? `${Number(dt.slice(5, 7))}/${Number(dt.slice(8, 10))}` : null,
  }
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
  return {
    rows, thresholds: th,
    currentMonth: snap.gran === 'month' && snap.ym ? Number(snap.ym.slice(5, 7)) : null,
    throughMonth: through,
    outsideN: rows.filter(r => !r.inModel).length,
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

// ── L2 隔几天的相关柱 + 淡带(§3.14;§1 #15)─────────────────────────────

export interface AcfBars {
  id: number; name: string
  /** 该栋有效天数 */
  n: number
  /** 淡带半宽 = 1.96 / √n */
  threshold: number
  /** 从隔 1 天起;上限由 logic 按 min(30, ⌊n/4⌋) 定 */
  bars: { lag: number; rho: number; inside: boolean }[]
}

/** 跟选中栋走;选中栋不在模型里就退回 L4 那一栋,再退回第一栋 */
export function acfBars(lab: LabResult, selId: number | null): AcfBars | null {
  const a = lab.acf.find(x => x.id === selId) ?? lab.acf.find(x => x.id === lab.nullDist?.id) ?? lab.acf[0]
  if (!a) return null
  const n = lab.tests.find(t => t.id === a.id)?.days ?? 0
  const threshold = n > 0 ? 1.96 / Math.sqrt(n) : Infinity
  return {
    id: a.id, name: a.name, n, threshold,
    bars: a.rho.slice(1).map((rho, k) => ({ lag: k + 1, rho, inside: Math.abs(rho) <= threshold })),
  }
}

// ── L4 打乱重算的直方图(§3.15)──────────────────────────────────────────

export const NULL_BINS = 16

export interface NullHist {
  id: number; name: string
  bins: { lo: number; hi: number; count: number }[]
  /** 这一段真实的偏差 */
  obs: number
  /** 比它更极端(同侧、含相等)的次数 */
  extreme: number
  /** 「1000 遍」= 重算次数 + 1 */
  total: number
}

export function nullHist(lab: LabResult): NullHist | null {
  const nd = lab.nullDist
  if (!nd?.dist.length) return null
  let lo = nd.obs, hi = nd.obs
  for (const v of nd.dist) { if (v < lo) lo = v; if (v > hi) hi = v }
  const w = (hi - lo) / NULL_BINS || 1
  const bins = Array.from({ length: NULL_BINS }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, count: 0 }))
  let right = 0, left = 0
  for (const v of nd.dist) {
    bins[Math.min(NULL_BINS - 1, Math.floor((v - lo) / w))].count++
    if (v >= nd.obs) right++
    if (v <= nd.obs) left++
  }
  return { id: nd.id, name: nd.name, bins, obs: nd.obs, extreme: Math.min(right, left), total: nd.dist.length + 1 }
}

// ── L7 逐栋核对表(§3.16;§1 #16)──────────────────────────────────────────

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
}

export function labTableRows(lab: LabResult, snap: AnaSnapshot): LabTableRow[] {
  const ab = alphaBars(lab, snap)
  const alpha = new Map(ab.rows.map(r => [r.id, r]))
  const tests = new Map(lab.tests.map(t => [t.id, t]))
  const season = new Map(lab.season.map(s => [s.id, s]))
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
    }
  })
  const key = (r: LabTableRow) => (r.unborn ? 3e9 : r.rank ?? 2e9)
  return out.sort((x, y) => key(x) - key(y))
}

// ── 抽屉 B9 B10:共用一年逐日的 x(dayOfYear)────────────────────────────

export interface DriftChart {
  daysInYear: number
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
  }
}

export interface ControlChart {
  daysInYear: number
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
export interface PvAlphaBarsProps { data: AlphaBars; stability: PolishStability; selId: number | null }
export interface PvResidualHeatProps { data: ResidualGrid; selId: number | null }
export interface PvQualityGridProps { data: QualityCalendar }
export interface PvAcfBarsProps { data: AcfBars }
export interface PvNullHistProps { data: NullHist }
export interface PvLabTableProps {
  rows: LabTableRow[]
  /** 常年水平 / 名次 / 区间 / 变点 / 有效月数吃的整年(表脚写明,§6.5b) */
  year: number
}
export interface PvDriftChartProps { data: DriftChart }
export interface PvControlChartProps { data: ControlChart }
export interface PvBetaChartProps { slots: BetaSlot[] }
export interface PvDetailTableProps { rows: DetailRow[]; gran: Gran }
