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
