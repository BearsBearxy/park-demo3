// 异常提醒中心光伏两条规则的夹具(pvRules.logic.spec / anomalyPvCard.spec 共用)。2025年1–4月逐日,每种情形自己造出来:
//   S3 1月5–8日、3月10–14日高 1.5 倍(两个月各一段连着高于);S4 4月20–23日低到 0.55(连着低于);
//   S2 4月 13 日、27 日各一天低(零散,不算连着);
//   S5 2月只抄了 1–20 日(覆盖不到 90%,读不出)、其中 10–13 日高 → 有连着偏离也不判;
//   小楼(2 kWp)4月1日才并网、逐日抄(4月5日漏抄)→ 每千瓦日发电远超 24;
//   月抄楼一个月一条(摊不成每天,不判每千瓦);未装表楼没有读数。噪声是确定性 LCG ±6%(先取噪声再判漏抄,漏抄不挪动别的栋)。
import type { PvReadingDTO, PvStationDTO } from '@/api/pvMeter'
import type { ReadingRow, StationCfg } from '../pvMeterAna.logic'

const pad = (n: number) => String(n).padStart(2, '0')
const dim = (m: number) => new Date(Date.UTC(2025, m, 0)).getUTCDate()
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const st = (id: number, name: string, cap: number, metered = true): StationCfg => ({ id, name, phase: 1, metered, capKwp: cap, panelCount: null, panelWatt: null })
export const PV_STATIONS: StationCfg[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => st(i, `S${i}`, 300 + i * 10)),
  st(9, '小楼', 2), st(10, '月抄楼', 3), st(11, '未装表楼', 300, false),
]
const factor = (id: number, m: number, d: number): number =>
  id === 3 && ((m === 3 && d >= 10 && d <= 14) || (m === 1 && d >= 5 && d <= 8)) ? 1.5
    : id === 4 && m === 4 && d >= 20 && d <= 23 ? 0.55
      : id === 2 && m === 4 && (d === 13 || d === 27) ? 0.55
        : id === 5 && m === 2 && d >= 10 && d <= 13 ? 1.5 : 1

export const PV_ROWS: ReadingRow[] = (() => {
  const rnd = lcg(20251006)
  const rows: ReadingRow[] = []
  for (let m = 1; m <= 4; m++) {
    for (let d = 1; d <= dim(m); d++) {
      const date = `2025-${pad(m)}-${pad(d)}`
      const weather = 1 + 0.3 * Math.sin((m * 31 + d) * 0.7)
      for (const s of PV_STATIONS) {
        const noise = 1 + 0.12 * (rnd() - 0.5)
        if (s.id === 11) continue
        if (s.id === 9 && (m < 4 || d === 5)) continue
        if (s.id === 5 && m === 2 && d > 20) continue
        if (s.id === 10 && d !== dim(m)) continue
        const perKw = s.id === 10 ? 3.2 * dim(m) : 3.2
        const gen = (s.id === 9 ? 300 * 3.2 : s.capKwp! * perKw) * weather * noise * factor(s.id, m, d)
        rows.push({ stationId: s.id, date, gen, selfUse: gen * 0.7, gridFeed: gen * 0.28, revenue: gen * 0.7 * 0.8, priceSnap: 0.8 })
      }
    }
  }
  return rows
})()

/** 同一份数换成接口的样子(异常屏挂载测走 anaData.fetchPvRuleInput 的整条映射) */
export const PV_STATION_DTOS: PvStationDTO[] = PV_STATIONS.map((s, i) => ({
  id: s.id, name: s.name, phase: s.phase, metered: s.metered ? 1 : 0, capacityKwp: s.capKwp, panelCount: null, panelWatt: null, priceYuan: 0.8, sortNo: i,
}))
export const PV_READING_DTOS: PvReadingDTO[] = PV_ROWS.map((r, i) => ({
  id: i + 1, stationId: r.stationId, stationName: PV_STATIONS.find((s) => s.id === r.stationId)!.name, readDate: r.date,
  genTotal: r.gen, selfUse: r.selfUse, gridFeed: r.gridFeed, priceSnap: r.priceSnap, revenue: r.revenue, note: null, source: 'simulated' as const,
}))
