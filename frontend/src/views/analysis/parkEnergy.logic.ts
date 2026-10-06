// parkEnergy.logic.ts — 园区能耗（2026-10 改稿 energy-v2）的取数变换与屏上每一句字，纯函数（单测 parkEnergy.logic.spec.ts）。
// 算法照画布出稿脚本 energy-v2/build.mjs 移植：按月四张瓦都和上个月比；能量流按金额，节点旁直接标本期和上期；
// 「电这块赚多少」只留售电收益 = 售电收入 − 购电成本（售电收入 = 销售收入表逐户电费合计，用户 2026-10-05 定）。
// 屏上两数相减：先按显示位数四舍五入再减（屏上两数相减必须等于屏上写的差）。
// 字一律从句型库出，这里只挑数、挑句型。

import * as S from '@/components/ana/anaSentence'
import type { EnergyMonth } from '@/analysis/anaData'

// ── 结构化最小输入类型(真实 DTO 为其超集,单测夹具可极小) ──
export interface ElecRowsLike { rows: { acctMonth: string; total: number }[] }
export interface PvRowLike { acctMonth: string; selfAmt: number }
export interface ChargingLike { rows: { acctMonth: string; cost: number }[] }
export interface OfficeLike { rows: { acctMonth: string; elecAmt: number }[] }
export interface S10Like { acctMonth: string; elec: number }

/** 逐月金额行(元;缺数据源 = null,契约头规则同 anaData.EnergyMonth)。 */
export interface AmtMonth {
  ym: string
  buyCost: number | null    // 购电成本(energy+basic 价税合计)
  pvSelfAmt: number | null  // 光伏自用金额
  s10Elec: number | null    // 售电收入(销售收入表逐户电费合计)
  officeAmt: number | null  // 办公和三期用电金额(附表13+14 elecAmt)
  chgCost: number | null    // 充电桩用电金额(附表7+8 cost)
}
type AmtKey = Exclude<keyof AmtMonth, 'ym'>

/** 合并各源为目标年逐月金额行(与 anaData.buildEnergyMonths 同构,只取金额侧字段)。 */
export function buildAmtMonths(
  year: number,
  elec: { energy: ElecRowsLike; basic: ElecRowsLike },
  pv: PvRowLike[],
  charging: ChargingLike[],
  office: OfficeLike[],
  s10: S10Like[],
): AmtMonth[] {
  const map = new Map<string, AmtMonth>()
  const prefix = year + '-'
  const add = (ym: string, key: AmtKey, v: number): void => {
    if (!ym.startsWith(prefix)) return
    let m = map.get(ym)
    if (!m) {
      m = { ym, buyCost: null, pvSelfAmt: null, s10Elec: null, officeAmt: null, chgCost: null }
      map.set(ym, m)
    }
    m[key] = (m[key] ?? 0) + v
  }
  for (const r of elec.energy.rows) add(r.acctMonth, 'buyCost', r.total)
  for (const r of elec.basic.rows) add(r.acctMonth, 'buyCost', r.total)
  for (const r of pv) add(r.acctMonth, 'pvSelfAmt', r.selfAmt)
  for (const dto of charging) for (const r of dto.rows) add(r.acctMonth, 'chgCost', r.cost)
  for (const dto of office) for (const r of dto.rows) add(r.acctMonth, 'officeAmt', r.elecAmt)
  for (const r of s10) add(r.acctMonth, 's10Elec', r.elec)
  return [...map.values()].sort((a, b) => a.ym.localeCompare(b.ym))
}

/** 能量流月锚:所选月销售收入表有数 → 该月;否则 ≤所选的最近有数月;再无 → 最早有数月;全无 → null。
 *  (yms 为升序有数月;回退结果 ≠ 所选月时卡头贴「显示 x月」) */
export function anchorS10Ym(yms: string[], ym: string): string | null {
  if (!yms.length) return null
  if (yms.includes(ym)) return ym
  const le = yms.filter((m) => m <= ym)
  return le.length ? le[le.length - 1] : yms[0]
}

// ═════════ 改稿 energy-v2 ═════════
const E = S.ENERGY
const w = (v: number | null | undefined): number | null => (v == null ? null : v / 1e4)
const r1 = (v: number): number => Math.round(v * 10) / 10
const r3 = (v: number): number => Math.round(v * 1000) / 1000
const d1 = (a: number, b: number): number => r1(r1(a) - r1(b))
const d3 = (a: number, b: number): number => r3(r3(a) - r3(b))
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0)
const mOf = (ym: string): number => +ym.slice(5, 7)
const ymOf = (y: number, m: number): string => `${y}-${String(m).padStart(2, '0')}`
const prevYmOf = (ym: string): string => (mOf(ym) === 1 ? ymOf(+ym.slice(0, 4) - 1, 12) : ymOf(+ym.slice(0, 4), mOf(ym) - 1))

/** 这一年和上一年的逐月行(上一年给 1 月比 12 月、按年比往年用)。 */
export interface EnergyData { year: number; mon: EnergyMonth[]; monPast: EnergyMonth[]; amt: AmtMonth[]; amtPast: AmtMonth[] }

export interface Tile { label: string; value: string; dval?: string; ddir?: 'up' | 'dn'; dkey?: string; dtone?: 'up'; note?: string }
export type FlowKey = 'buy' | 'pvSelf' | 'sell' | 'chg' | 'office'
export interface FlowNode { key: FlowKey; side: 'l' | 'r'; name: string; value: number; val: string; prev: string }
/** 卡底一句读数句(空串 = 闭嘴,行照留)+ 参照若干 */
export interface CardText { hint: string; read: string; refs: string[] }
export interface FlowCard extends CardText { nodes: FlowNode[]; tag: string }
export interface MonthModel {
  kpis: Tile[]
  flow: FlowCard | null           // null = 这一年销售收入表一个月都没有
  flowEmpty: string
  earn: CardText & { cats: string[]; prev: (number | null)[]; cur: (number | null)[]; prevName: string; curName: string }
}
export interface YearModel {
  kpis: Tile[]
  flow: FlowCard | null
  flowEmpty: string
  bars: CardText & { months: string[]; sell: (number | null)[]; buy: (number | null)[]; gap: (number | null)[]; marks: number[] }
  unit: CardText & { months: string[]; values: (number | null)[]; his: number[]; los: number[] }
  earn: CardText & { items: { name: string; value: number | null; label: string }[]; mark: { value: number; lines: string[] } | null }
}

interface FlowTotals { buy: number; pvSelf: number; sell: number | null; office: number; chg: number }
function totals(rows: AmtMonth[]): FlowTotals {
  const s = (k: AmtKey) => rows.reduce<number | null>((x, m) => (m[k] == null ? x : (x ?? 0) + m[k]!), null)
  return { buy: s('buyCost') ?? 0, pvSelf: s('pvSelfAmt') ?? 0, sell: s('s10Elec'), office: s('officeAmt') ?? 0, chg: s('chgCost') ?? 0 }
}
// 能量流节点:左 = 电从哪来(购电成本、光伏自用),右 = 到哪去(售电收入、充电桩用电、办公和三期用电);值为 0 的不画。
// 按年(nM)节点写「¥X万 · n 个月」,和屏顶 12 个月合计的瓦分开
function flowNodes(cur: FlowTotals, prev: { label: string; t: FlowTotals } | null, nM?: number): FlowNode[] {
  const node = (key: FlowKey, side: 'l' | 'r'): FlowNode => {
    const v = cur[key] ?? 0
    const f = S.flowLabel(E.node[key], w(v)!, prev && { label: prev.label, v: w(prev.t[key]) })
    return { key, side, name: f.name, value: v, val: nM ? S.yuanN(w(v)!, nM) : f.val, prev: f.prev }
  }
  return [node('buy', 'l'), node('pvSelf', 'l'), node('sell', 'r'), node('chg', 'r'), node('office', 'r')].filter((n) => n.value > 0)
}
// 主卡差额句:售电收入 − 购电成本(同节点一位小数),上期两项都有才带上期
function flowGap(cur: FlowTotals, prev: { label: string; t: FlowTotals } | null): string {
  const p = prev && prev.t.sell != null ? { label: prev.label, a: r1(w(prev.t.sell)!), b: r1(w(prev.t.buy)!) } : null
  return S.gap({ aName: E.node.sell, bName: E.node.buy, a: cur.sell == null ? null : r1(w(cur.sell)!), b: r1(w(cur.buy)!), prev: p })?.text ?? ''
}
// 三项收益(万元):售电收益 = 销售收入表有数月的售电收入 − 同月购电成本(按显示值相减);光伏收益 = pv fee;充电桩收益 = 毛利
function segs(rows: EnergyMonth[]) {
  const cov = rows.filter((m) => m.s10Elec != null)
  const nz = (k: 'pvAmt' | 'chgProfit') => { const v = rows.filter((m) => m[k] != null); return { v: v.length ? w(sum(v.map((m) => m[k]!))) : null, n: v.length } }
  const pv = nz('pvAmt'), chg = nz('chgProfit')
  return {
    resale: cov.length ? d1(w(sum(cov.map((m) => m.s10Elec!)))!, w(sum(cov.map((m) => m.buyCost ?? 0)))!) : null, resaleN: cov.length,
    pv: pv.v, pvN: pv.n, chg: chg.v, chgN: chg.n,
  }
}
const s10YmsOf = (amt: AmtMonth[]) => amt.filter((m) => m.s10Elec != null).map((m) => m.ym)
const unitOf = (m?: EnergyMonth) => (m && m.buyKwh && m.buyCost != null ? m.buyCost / m.buyKwh : null)
const genOf = (m?: EnergyMonth) => (m && (m.pvSelfKwh != null || m.pvGridKwh != null) ? (m.pvSelfKwh ?? 0) + (m.pvGridKwh ?? 0) : null)
const shareOf = (m?: EnergyMonth) => (m && m.buyKwh != null && m.pvSelfKwh != null && m.buyKwh + m.pvSelfKwh > 0 ? m.pvSelfKwh / (m.buyKwh + m.pvSelfKwh) * 100 : null)

// ═════════ 按月 ═════════
export function monthModel(d: EnergyData, M: number): MonthModel {
  const ym = ymOf(d.year, M), pym = prevYmOf(ym), pm = mOf(pym)
  const rowOf = (x: string) => (x.startsWith(d.year + '-') ? d.mon : d.monPast).find((m) => m.ym === x)
  const amtOf = (x: string) => (x.startsWith(d.year + '-') ? d.amt : d.amtPast).find((m) => m.ym === x)
  const c = rowOf(ym), p = rowOf(pym), mL = S.monthLabel(M), pL = S.monthLabel(pm)

  // 电从哪来、到哪去:销售收入表这个月没数 → 退到之前最近有数的月,卡头贴「显示 x月」
  const used = anchorS10Ym(s10YmsOf(d.amt), ym)
  let flow: FlowCard | null = null
  if (used) {
    const uM = mOf(used), fallback = used !== ym, upYm = prevYmOf(used), pa = amtOf(upYm)
    const cur = totals([amtOf(used)!])
    const prev = pa ? { label: S.monthLabel(mOf(upYm)), t: totals([pa]) } : null   // 上个月销售收入表没数:节点照标购电等,售电写「没有」
    flow = {
      nodes: flowNodes(cur, prev),
      tag: fallback ? S.fallbackTag(uM) : '',
      hint: S.hint(E.byAmt, prev ? S.cmpWith(mOf(upYm)) : '', '万元'),
      read: flowGap(cur, prev),
      refs: [S.flowDef, fallback ? S.thin({ table: E.table, noMonth: mL, shown: S.monthLabel(uM) }).text : ''].filter(Boolean),
    }
  }

  // KPI:都和上个月比(同一排同一种基准)。售电收入、购电成本两张瓦撤掉(sp-ask2 第 2 条):就是主卡流向图节点的金额;
  // 主卡画的不是这个月(回退 / 没有)时,这个月的购电成本只有瓦上有,留着
  const T = E.tile, vs = S.vsLabel(pL)
  const tile = (label: string, value: string | null, cur: number | null, prev: number | null, diff: (a: number, b: number) => number, fmt: (v: number) => string, lowerIsGood = false): Tile => {
    const t: Tile = { label, value: value ?? '—' }
    if (cur == null || prev == null) return t
    const dv = diff(cur, prev)
    return { ...t, dval: fmt(dv), ddir: dv < 0 ? 'dn' : 'up', dkey: vs, dtone: lowerIsGood && dv <= 0 ? 'up' : undefined }   // 收入、成本差额为负不标红;电量、比例只写测量
  }
  const unitC = unitOf(c), gen = genOf(c), share = shareOf(c)
  const kpis = [
    ...(used !== ym ? [tile(T.buy, c?.buyCost != null ? S.yuan(w(c.buyCost)!) : null, w(c?.buyCost), w(p?.buyCost), d1, S.dWan, true)] : []),
    tile(T.unit, unitC == null ? null : unitC.toFixed(3) + E.unitU, unitC, unitOf(p), d3, S.dYuan3, true),
    tile(T.kwh, c?.buyKwh != null ? S.num(w(c.buyKwh)!) + '万kWh' : null, w(c?.buyKwh), w(p?.buyKwh), d1, S.dKwh),
    tile(T.pv, gen == null ? null : S.num(w(gen)!) + '万kWh', w(gen), w(genOf(p)), d1, S.dKwh),
    tile(T.pvShare, share == null ? null : share.toFixed(1) + '%', share, shareOf(p), d1, S.dPt),
  ]

  // 各项收益:本月和上月成对比
  const sc = segs(c ? [c] : []), sp = segs(p ? [p] : [])
  const cats = [E.seg.resale, E.seg.pv, E.seg.chg]
  const cv = [sc.resale, sc.pv, sc.chg], pv = [sp.resale, sp.pv, sp.chg]
  const missM = cv[0] == null ? M : pv[0] == null ? pm : null
  return {
    kpis, flow,
    flowEmpty: S.thin({ table: E.table, gaps: S.yearLabel(d.year) }).text,
    earn: {
      cats, prevName: pL, curName: mL,
      prev: pv.map((v) => (v == null ? null : r1(v))), cur: cv.map((v) => (v == null ? null : r1(v))),
      hint: S.hint(S.cmpWith(pm), '万元'),
      read: S.movers({ items: cats.map((name, i) => ({ name, prev: pv[i], cur: cv[i] })), prevLabel: pL, table: E.table })?.text ?? '',
      refs: [S.earnDef, S.pvEarnDef, S.chgEarnDef, missM ? S.thin({ table: E.table, noMonth: S.monthLabel(missM), cant: E.seg.resale }).text : ''].filter(Boolean),
    },
  }
}

// ═════════ 按年 ═════════
export function yearModel(d: EnergyData): YearModel {
  const Y = d.year, PAST = Y - 1, T = E.tile
  const MONTHS = Array.from({ length: 12 }, (_, i) => S.monthLabel(i + 1))
  const rows = MONTHS.map((_, i) => d.mon.find((m) => m.ym === ymOf(Y, i + 1)))
  const agg = (k: keyof Omit<EnergyMonth, 'ym'>, ms = d.mon) => ms.reduce<number | null>((x, m) => (m[k] == null ? x : (x ?? 0) + m[k]!), null)
  const nOf = (f: (m: EnergyMonth) => boolean) => d.mon.filter(f).length

  // KPI:钱在前;按年不比上期,写覆盖。售电收入瓦撤掉(同按月);购电成本瓦留着 —— 瓦是全年合计,流向图节点只算销售收入表有数的月
  const buyC = agg('buyCost'), buyK = agg('buyKwh'), self = agg('pvSelfKwh'), grid = agg('pvGridKwh')
  const both = d.mon.filter((m) => m.buyKwh && m.buyCost != null)   // 单价按两项都有的月合计算
  const gen = self == null && grid == null ? null : (self ?? 0) + (grid ?? 0)
  const pvPastM = d.monPast.filter((m) => m.pvSelfKwh != null).map((m) => mOf(m.ym))
  const nBuy = nOf((m) => m.buyCost != null), nKwh = nOf((m) => m.buyKwh != null)
  const kpis: Tile[] = [
    { label: T.buy, value: buyC == null ? '—' : S.yuan(w(buyC)!), note: nBuy ? S.sumNote(nBuy) : undefined },
    { label: T.unit, value: both.length ? (sum(both.map((m) => m.buyCost!)) / sum(both.map((m) => m.buyKwh!))).toFixed(3) + E.unitU : '—', note: both.length ? S.unitBasisNote(both.length) : undefined },
    { label: T.kwh, value: buyK == null ? '—' : S.num(w(buyK)!) + '万kWh', note: nKwh ? S.sumNote(nKwh) : undefined },
    // 往年只有几个月有光伏时照说(全有 / 全没有不写)
    { label: T.pv, value: gen == null ? '—' : S.num(w(gen)!) + '万kWh', note: pvPastM.length && pvPastM.length < 12 ? S.somePastNote(PAST, S.monthSpan(pvPastM[0], pvPastM[pvPastM.length - 1])) : undefined },
    { label: T.pvShare, value: buyK != null && self != null && buyK + self > 0 ? (self / (buyK + self) * 100).toFixed(1) + '%' : '—', note: S.pvShareNote },
  ]

  // 电从哪来、到哪去:只算销售收入表有数的月,卡头直说几个月;往年没数,不带上期
  const s10Yms = s10YmsOf(d.amt)
  let flow: FlowCard | null = null
  if (s10Yms.length) {
    const cur = totals(d.amt.filter((m) => s10Yms.includes(m.ym)))
    flow = { nodes: flowNodes(cur, null, s10Yms.length), tag: '', hint: S.hint(E.byAmt, S.coverTable(s10Yms.length), '万元'), read: flowGap(cur, null), refs: [S.flowDef] }
  }

  // 各月售电收入和购电成本:12 个月位都留着,销售收入表没数的月售电柱空着;售电收益线只连有数的月
  const sell = rows.map((m) => (m?.s10Elec == null ? null : r1(w(m.s10Elec)!)))
  const buy = rows.map((m) => (m?.buyCost == null ? null : r1(w(m.buyCost)!)))
  const gap = rows.map((_, i) => (sell[i] == null || buy[i] == null ? null : d1(sell[i]!, buy[i]!)))
  const ex = S.extremes({ metric: E.seg.resale, items: gap.flatMap((v, i) => (v == null ? [] : [{ label: MONTHS[i], value: v }])) })
  const at = (xs: { label: string }[]) => xs.map((x) => MONTHS.indexOf(x.label))
  const bars = {
    months: MONTHS, sell, buy, gap, marks: ex ? [...at(ex.his), ...at(ex.los)] : [],
    hint: S.hint('万元'), read: ex?.text ?? '',
    // 一个月都没有时说整年(「销售收入表里没有2026年」),不列「1–12月」(10-05 按推荐)
    refs: !s10Yms.length ? [S.thin({ table: E.table, gaps: S.yearLabel(Y) }).text]
      : s10Yms.length < 12 ? [S.thin({ table: E.table, gaps: S.gapsText(s10Yms, ymOf(Y, 1), ymOf(Y, 12)), nGap: 12 - s10Yms.length }).text] : [],
  }

  // 各月单位购电成本:最高最低(含按三位小数并列的月)都标在图上;单系列,读数句不带指标名
  const values = rows.map(unitOf)
  const exU = S.extremes({ metric: '', items: values.flatMap((v, i) => (v == null ? [] : [{ label: MONTHS[i], value: v }])), fmt: S.perKwh })
  const noPastBuy = d.monPast.every((m) => m.buyCost == null && m.buyKwh == null)
  const unit = {
    months: MONTHS, values, his: exU ? at(exU.his) : [], los: exU ? at(exU.los) : [],
    hint: S.hint(E.unitU), read: exU?.text ?? '',
    refs: [S.unitBasis, noPastBuy ? S.thin({ noPast: S.yearLabel(PAST), what: E.what.buy }).text : ''].filter(Boolean),
  }

  // 各项收益 · 全年:三项各自有数的月数写在条旁;光伏收益和往年同期比(两年都有数的月),比的两个数挂深色气泡
  const sg = segs(d.mon)
  const items = ([[E.seg.resale, sg.resale, sg.resaleN], [E.seg.pv, sg.pv, sg.pvN], [E.seg.chg, sg.chg, sg.chgN]] as const)
    .map(([name, v, n]) => ({ name, value: v == null ? null : r1(v), label: v == null ? '' : S.yuanN(v, n) }))
  const pastPv = d.monPast.filter((m) => m.pvAmt != null && rows[mOf(m.ym) - 1]?.pvAmt != null).map((m) => mOf(m.ym))
  let mark: YearModel['earn']['mark'] = null, read = '', onlySome = ''
  if (pastPv.length && sg.pv != null) {   // ponytail: 两年都有数的月按首尾写成一段,中间断开的情况库里没有
    const a0 = pastPv[0], a1 = pastPv[pastPv.length - 1], span = S.monthSpan(a0, a1)
    const pvSum = (ms: (EnergyMonth | undefined)[]) => r1(w(sum(pastPv.map((m) => ms.find((x) => x && mOf(x.ym) === m)!.pvAmt!)))!)
    const a = pvSum(rows), b = pvSum(d.monPast)
    mark = { value: r1(sg.pv), lines: S.compareMark(span, a, S.yearSpan(PAST, a0, a1), b) }
    read = S.gap({ aName: E.seg.pv + span, bName: S.yearLabel(PAST), a, b })?.text ?? ''
  }
  // 往年自己只有几个月有光伏收益时照说(按往年自己有数的月,不按两年重叠的月 —— 选 2026 时 2025 年 12 个月都有,不该说「只有1月」)
  const pastOwn = d.monPast.filter((m) => m.pvAmt != null).map((m) => mOf(m.ym))
  if (pastOwn.length && pastOwn.length < 12 && sg.pv != null) onlySome = S.thin({ onlySome: S.yearLabel(PAST), what: E.seg.pv, span: S.monthSpan(pastOwn[0], pastOwn[pastOwn.length - 1]) }).text
  return {
    kpis, flow, flowEmpty: S.thin({ table: E.table, gaps: S.yearLabel(Y) }).text, bars, unit,
    earn: { items, mark, hint: S.hint('万元'), read, refs: [S.earnDef, S.pvEarnDef, S.chgEarnDef, onlySome].filter(Boolean) },
  }
}

/** 工具条「数据截至」:购电、销售收入表、光伏各到哪个月(sources 来自 fetchAvailableMonths);缺一份就不写,退回外壳默认。
 *  room = 放得下几个字(手机上整句放不下,句型库退回「截至 最晚那个月」) */
export function asofOf(src: Record<string, string[]> | undefined, room = Infinity): string | undefined {
  const last = (k: string) => src?.[k]?.[src[k].length - 1]
  const buy = last('elec'), s10 = last('s10'), pv = last('pv')
  return buy && s10 && pv ? S.energyAsof({ buy, s10, pv }, room) : undefined
}
