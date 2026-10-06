// src/views/analysis/pvRules.logic.ts — 异常提醒中心「光伏触发规则的楼栋」卡的两条规则(2026-10 改稿 pv-v2-anomaly;单测 pvRules.logic.spec.ts)。
// 检测只读调用光伏分栋分析屏同一套算法,切到光伏屏选同一个月对得上:
//   ① 每千瓦日发电超 24 kWh:这栋这个月发电合计 ÷ 台账装机 ÷ 抄了几天 > 24(一天只有 24 小时)。
//      只算逐日抄表、录了装机的栋 —— 月抄一条就是一个月的量,摊不成每天。
//   ② 连着 3 天以上偏离平时:buildSnapshot 月档每栋的 runs(连着 bandRun 天同向出平时范围);读不出的栋不算(同光伏屏 KPI)。
// 一栋一个月一条。不进 anaData.buildAnomalies:铃铛、驾驶舱「本月触发的规则」都不出(便签:接真电表后先看一个月的命中再定)。
import { buildSnapshot, type Criteria, type ReadingRow, type StationCfg } from './pvMeterAna.logic'
import { unreadableWhy } from './pvAnaV4.logic'
import { PVR } from '@/components/ana/anaSentence'

export interface PvRuleInput {
  year: number
  months: number[]            // 这一年有读数的月(升序)
  stations: StationCfg[]
  rows: ReadingRow[]          // 整年(平时范围要拿整年来估,同光伏屏)
  crit: Partial<Criteria>
}
interface HitBase { id: string; m: number; stationId: number; name: string }
export interface PvOverHit extends HitBase { kind: 'over'; perDay: number; over: number; days: number; cap: number }
export interface PvRunHit extends HitBase { kind: 'run'; outN: number; run: number; runs: { from: number; to: number; dir: -1 | 1 }[] }
export type PvHit = PvOverHit | PvRunHit

/** 一个月的命中。一次 buildSnapshot(13 栋整年约 30ms)—— 调用方逐月让出主线程。
 *  id 稳定(楼栋 id + 年月):处置状态按它记在 localStorage,跨会话不丢。 */
export function pvMonthHits(inp: PvRuleInput, m: number): PvHit[] {
  const ym = `${inp.year}-${String(m).padStart(2, '0')}`
  const snap = buildSnapshot({ year: inp.year, gran: 'month', month: m, stations: inp.stations, rows: inp.rows, gridPrice: 0, crit: inp.crit })   // gridPrice 只进收益,规则不用
  const daily = new Set(snap.stations.filter((s) => s.cadence === 'daily').map((s) => s.id))
  const hits: PvHit[] = []
  for (const s of inp.stations) {
    const cap = s.capKwp
    if (!s.metered || cap == null || cap <= 0 || !daily.has(s.id)) continue
    const rs = inp.rows.filter((r) => r.stationId === s.id && r.date.startsWith(ym))
    if (!rs.length) continue
    const perDay = rs.reduce((t, r) => t + r.gen, 0) / cap / rs.length
    if (perDay > PVR.dayLimit) {
      hits.push({ kind: 'over', id: `pv-over:${s.id}:${ym}`, m, stationId: s.id, name: s.name, perDay,
        over: rs.filter((r) => r.gen / cap > PVR.dayLimit).length, days: rs.length, cap })
    }
  }
  for (const b of snap.board) {
    if (!b.runs.length || unreadableWhy(b, snap)) continue
    hits.push({ kind: 'run', id: `pv-run:${b.id}:${ym}`, m, stationId: b.id, name: b.name, outN: b.outN, run: snap.crit.bandRun,
      runs: b.runs.map((r) => ({ from: r.from + 1, to: r.to + 1, dir: r.dir })) })
  }
  return hits
}

/** 排序:月降序;同月里超 24 kWh 在前,连着偏离按最后一段的结束日降序;再按楼栋 id */
const endOf = (h: PvHit): number => (h.kind === 'over' ? 99 : Math.max(...h.runs.map((r) => r.to)))
export const pvSort = (hits: PvHit[]): PvHit[] => [...hits].sort((a, b) => b.m - a.m || endOf(b) - endOf(a) || a.stationId - b.stationId)

/** 每栋最近一条(卡上露前几行,「看全部」出全部)。sorted = pvSort 的结果 */
export function pvLatest(sorted: PvHit[]): PvHit[] {
  const seen = new Set<number>()
  return sorted.filter((h) => {
    if (seen.has(h.stationId)) return false
    seen.add(h.stationId)
    return true
  })
}
