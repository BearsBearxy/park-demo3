// src/views/analysis/pvRoi.logic.ts — 光伏投资回收 v2 纯数据变换(单测 pvRoi.logic.spec.ts)。
// 口径与 v1 一致:收益=fee(自消纳+上网,后端派生);年化=各期 累计/活跃月×12;金额一律元。
import type { PvPhaseDTO, PvRecordDTO } from '@/types/pv'

export interface CumPoint { ym: string; cum: number }

/** 按记账月聚合逐月收益并累计(全期爬坡,升序)。 */
export function cumSeries(records: Pick<PvRecordDTO, 'acctMonth' | 'fee'>[]): CumPoint[] {
  const by = new Map<string, number>()
  for (const r of records) by.set(r.acctMonth, (by.get(r.acctMonth) ?? 0) + r.fee)
  let c = 0
  return [...by.keys()].sort().map((ym) => { c += by.get(ym)!; return { ym, cum: c } })
}

export function nextYm(ym: string): string {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export interface Ramp { labels: string[]; actual: (number | null)[]; projected: (number | null)[]; hitIdx: number | null }

/** 爬坡+外推:实际累计线之后按月均收益虚线外推,至越过投资额(=预估回收点 hitIdx)或 maxMonths 封顶。
 *  已回收(实际线已越投资额)→ hitIdx 落在实际段;月均≤0 → 不外推,hitIdx=null。 */
export function buildRamp(points: CumPoint[], monthlyGain: number, invest: number, maxMonths = 96): Ramp {
  const labels = points.map((p) => p.ym)
  const actual: (number | null)[] = points.map((p) => p.cum)
  const projected: (number | null)[] = points.map(() => null)
  if (!points.length) return { labels, actual, projected, hitIdx: null }
  const last = points[points.length - 1]
  if (invest > 0 && last.cum >= invest) {
    return { labels, actual, projected, hitIdx: actual.findIndex((v) => (v ?? 0) >= invest) }
  }
  if (monthlyGain <= 0 || invest <= 0) return { labels, actual, projected, hitIdx: null }
  projected[points.length - 1] = last.cum   // 与实际线衔接
  let ym = last.ym, cum = last.cum, hitIdx: number | null = null
  for (let i = 0; i < maxMonths; i++) {
    ym = nextYm(ym); cum += monthlyGain
    labels.push(ym); actual.push(null); projected.push(cum)
    if (cum >= invest) { hitIdx = labels.length - 1; break }
  }
  return { labels, actual, projected, hitIdx }
}

export interface PhaseRow {
  p: PvPhaseDTO; months: number; cum: number; selfAmt: number; gridAmt: number
  annual: number   // 累计/活跃月×12(无月 → 0)
  share: number    // 占全园累计收益比(全园 0 → 0)
}

/** 分期汇总(v1 rows 同口径)。 */
export function phaseSummaries(phases: PvPhaseDTO[], records: PvRecordDTO[]): PhaseRow[] {
  const totCum = records.reduce((a, r) => a + r.fee, 0)
  return phases.map((p) => {
    const recs = records.filter((r) => r.phase === p.id)
    const cum = recs.reduce((a, r) => a + r.fee, 0)
    const selfAmt = recs.reduce((a, r) => a + r.selfAmt, 0)
    const months = recs.length
    return {
      p, months, cum, selfAmt, gridAmt: cum - selfAmt,
      annual: months ? (cum / months) * 12 : 0,
      share: totCum ? cum / totCum : 0,
    }
  })
}

/** 某期逐月明细(记账月升序)。 */
export function phaseMonthly(records: PvRecordDTO[], phaseId: string): { ym: string; fee: number; selfAmt: number; gridAmt: number }[] {
  return records
    .filter((r) => r.phase === phaseId)
    .map((r) => ({ ym: r.acctMonth, fee: r.fee, selfAmt: r.selfAmt, gridAmt: r.gridAmt }))
    .sort((a, b) => a.ym.localeCompare(b.ym))
}

// ══ 分栋抄表分析(ENERGY-ANALYSIS-SPEC §2)——效率/消纳/收益纯变换 ══
// 结构化最小类型(PvStationDTO/PvReadingDTO 的子集,spec 夹具轻量)。电量 kWh、金额 元。
export interface MeterStation { id: number; name: string; capacityKwp: number | null }
export interface MeterReading {
  stationId: number; readDate: string   // YYYY-MM-DD,发生月 = 前 7 位
  genTotal: number; selfUse: number; gridFeed: number
  revenue: number                        // 后端派生 = 自消纳×price_snap(快照口径,与抄表屏全等)
}

export interface StationEffRow { name: string; eff: number }   // eff = kWh/kWp(等效小时)
/** 各站发电效率 = Σ发电总量 ÷ 装机容量;无容量站不入 rows 并列名 noCap(覆盖率护栏),
 *  该年无抄表站不入(缺数不补 0);capN = 已录容量站数(含无抄表站,护栏分子)。 */
export function stationEfficiency(stations: MeterStation[], readings: MeterReading[]): { rows: StationEffRow[]; noCap: string[]; capN: number } {
  const gen = new Map<number, number>()
  for (const r of readings) gen.set(r.stationId, (gen.get(r.stationId) ?? 0) + r.genTotal)
  const rows: StationEffRow[] = [], noCap: string[] = []
  let capN = 0
  for (const s of stations) {
    const hasCap = s.capacityKwp != null && s.capacityKwp > 0
    if (hasCap) capN++
    if (!gen.has(s.id)) continue
    if (hasCap) rows.push({ name: s.name, eff: gen.get(s.id)! / s.capacityKwp! })
    else noCap.push(s.name)
  }
  return { rows, noCap, capN }
}

export interface EffTrend { yms: string[]; park: (number | null)[]; sel: (number | null)[] | null }
/** 效率月度趋势(按发生日期汇月,月升序):全园加权 = Σ有容量站该月发电 ÷ Σ该月有抄表的有容量站容量
 *  (无容量站不入加权;仅无容量站抄表的月 → null 断点);selId 给出时并出单站线(该站无容量/无抄表月 → null)。 */
export function monthlyEfficiency(stations: MeterStation[], readings: MeterReading[], selId?: number): EffTrend {
  const cap = new Map(stations.filter((s) => s.capacityKwp != null && s.capacityKwp > 0).map((s) => [s.id, s.capacityKwp!]))
  const byYm = new Map<string, Map<number, number>>()
  for (const r of readings) {
    const ym = r.readDate.slice(0, 7)
    const m = byYm.get(ym) ?? new Map<number, number>()
    m.set(r.stationId, (m.get(r.stationId) ?? 0) + r.genTotal)
    byYm.set(ym, m)
  }
  const yms = [...byYm.keys()].sort()
  const park = yms.map((ym) => {
    let g = 0, c = 0
    for (const [sid, sg] of byYm.get(ym)!) { const sc = cap.get(sid); if (sc) { g += sg; c += sc } }
    return c ? g / c : null
  })
  const selCap = selId != null ? cap.get(selId) : undefined
  const sel = selId == null ? null : yms.map((ym) => {
    const g = byYm.get(ym)!.get(selId)
    return selCap && g != null ? g / selCap : null
  })
  return { yms, park, sel }
}

export interface ConsRow { key: string; self: number; grid: number; loss: number; lossRate: number | null }
/** 消纳结构:损耗 = 发电总量 − 自消纳 − 上网(负值=计量异常,照实返回);损耗率 = 损耗÷发电(发电 0 → null)。
 *  by='station' 按站(站序,无抄表站不入);by='month' 按发生月升序。 */
export function consumptionRows(stations: MeterStation[], readings: MeterReading[], by: 'station' | 'month'): ConsRow[] {
  const acc = new Map<string, { self: number; grid: number; gen: number }>()
  // ponytail: 13 站规模,站名反查线性扫即可
  const keyOf = by === 'station'
    ? (r: MeterReading): string => stations.find((s) => s.id === r.stationId)?.name ?? '站' + r.stationId
    : (r: MeterReading): string => r.readDate.slice(0, 7)
  for (const r of readings) {
    const k = keyOf(r)
    const a = acc.get(k) ?? { self: 0, grid: 0, gen: 0 }
    a.self += r.selfUse; a.grid += r.gridFeed; a.gen += r.genTotal
    acc.set(k, a)
  }
  const keys = by === 'station' ? stations.map((s) => s.name).filter((n) => acc.has(n)) : [...acc.keys()].sort()
  return keys.map((k) => {
    const a = acc.get(k)!
    const loss = a.gen - a.self - a.grid
    return { key: k, self: a.self, grid: a.grid, loss, lossRate: a.gen ? loss / a.gen : null }
  })
}

export interface RevRow { name: string; selfRev: number; gridRev: number }
/** 消纳收益(快照单价口径:Σ后端派生 revenue,与抄表屏全等)+ 上网收益(Σ上网×gridPrice 参数价),按站序,无抄表站不入。 */
export function revenueByStation(stations: MeterStation[], readings: MeterReading[], gridPrice: number): RevRow[] {
  const acc = new Map<number, { selfRev: number; gridKwh: number }>()
  for (const r of readings) {
    const a = acc.get(r.stationId) ?? { selfRev: 0, gridKwh: 0 }
    a.selfRev += r.revenue; a.gridKwh += r.gridFeed
    acc.set(r.stationId, a)
  }
  return stations.filter((s) => acc.has(s.id)).map((s) => {
    const a = acc.get(s.id)!
    return { name: s.name, selfRev: a.selfRev, gridRev: a.gridKwh * gridPrice }
  })
}
