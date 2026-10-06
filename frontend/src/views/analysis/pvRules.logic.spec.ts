// pvRules.logic —— 异常提醒中心光伏两条规则(pv-v2-anomaly)。夹具见 __fixtures__/pvRules.fixture.ts(每种情形自己造,不用开发库)。
import { describe, expect, it } from 'vitest'
import { pvLatest, pvMonthHits, pvSort, type PvHit, type PvRuleInput } from './pvRules.logic'
import { PV_ROWS as ROWS, PV_STATIONS as STATIONS } from './__fixtures__/pvRules.fixture'
import * as S from '@/components/ana/anaSentence'

const INP: PvRuleInput = { year: 2025, months: [1, 2, 3, 4], stations: STATIONS, rows: ROWS, crit: {} }
const BY_M = new Map(INP.months.map((m) => [m, pvMonthHits(INP, m)]))
const ALL = INP.months.flatMap((m) => BY_M.get(m)!)
const perDayOf = (id: number, ym: string) => {
  const rs = ROWS.filter((r) => r.stationId === id && r.date.startsWith(ym))
  return rs.reduce((t, r) => t + r.gen, 0) / STATIONS.find((s) => s.id === id)!.capKwp! / rs.length
}

describe('pvMonthHits · 一栋一个月一条', () => {
  it('❗①每千瓦日发电超 24 kWh:只有小楼 4 月;数和抄表对得上(合计 ÷ 装机 ÷ 天数)', () => {
    const over = ALL.filter((h) => h.kind === 'over')
    expect(over.map((h) => [h.id, h.name, h.m])).toEqual([['pv-over:9:2025-04', '小楼', 4]])
    const h = over[0] as Extract<PvHit, { kind: 'over' }>
    expect(h.perDay).toBeCloseTo(perDayOf(9, '2025-04'), 9)
    expect(h.perDay).toBeGreaterThan(300)          // 300 kWp 的量摊在 2 kWp 上
    expect([h.days, h.over, h.cap]).toEqual([29, 29, 2])
  })

  it('❗月抄一条就是一个月的量:月抄楼不判①(摊到每天它也会远超 24);未装表楼不判', () => {
    expect(perDayOf(10, '2025-03') / 1).toBeGreaterThan(24)   // 不排除的话会误报
    expect(ALL.some((h) => h.stationId === 10 || h.stationId === 11)).toBe(false)
  })

  it('❗②连着 3 天以上偏离平时:S3 1月5–8日、3月10–14日高,S4 4月20–23日低,坐标逐日钉住;零散两天的 S2 不出', () => {
    const run = ALL.filter((h): h is Extract<PvHit, { kind: 'run' }> => h.kind === 'run')
    expect(run.map((h) => [h.id, h.runs, h.run])).toEqual([
      ['pv-run:3:2025-01', [{ from: 5, to: 8, dir: 1 }], 3],
      ['pv-run:3:2025-03', [{ from: 10, to: 14, dir: 1 }], 3],
      ['pv-run:4:2025-04', [{ from: 20, to: 23, dir: -1 }], 3],
    ])
    expect(run.map((h) => h.outN >= h.runs[0].to - h.runs[0].from + 1)).toEqual([true, true, true])
  })

  it('❗读不出的栋不判②:S5 2月覆盖不到 90%,10–13 日连着高也不出(同光伏屏 KPI)', () => {
    expect(ALL.some((h) => h.stationId === 5)).toBe(false)
    expect(BY_M.get(2)).toEqual([])
  })

  it('连着几天跟判据参数走:bandRun 改成 5,S4 那段 4 天不再算', () => {
    const h4 = pvMonthHits({ ...INP, crit: { bandRun: 5 } }, 4).filter((h) => h.kind === 'run')
    expect(h4.map((h) => h.stationId)).not.toContain(4)
    const h3 = pvMonthHits({ ...INP, crit: { bandRun: 5 } }, 3)
    expect(h3.map((h) => [h.id, h.kind === 'run' && h.run])).toEqual([['pv-run:3:2025-03', 5]])   // 名称「连着 5 天以上」跟着变
  })
})

describe('pvSort / pvLatest', () => {
  it('❗月从近到远;同月超 24 在前;每栋只留最近一条', () => {
    const sorted = pvSort(ALL)
    expect(sorted.map((h) => h.id)).toEqual(['pv-over:9:2025-04', 'pv-run:4:2025-04', 'pv-run:3:2025-03', 'pv-run:3:2025-01'])
    expect(pvLatest(sorted).map((h) => h.id)).toEqual(['pv-over:9:2025-04', 'pv-run:4:2025-04', 'pv-run:3:2025-03'])
  })
  it('同月两条连着偏离:最后一段结束得晚的在前,再按楼栋 id', () => {
    const mk = (id: number, to: number): PvHit => ({ kind: 'run', id: `x${id}`, m: 6, stationId: id, name: `S${id}`, outN: 3, run: 3, runs: [{ from: to - 2, to, dir: 1 }] })
    expect(pvSort([mk(1, 10), mk(2, 20), mk(3, 20)]).map((h) => h.stationId)).toEqual([2, 3, 1])
  })
})

describe('句型库 PVR 段(逐字对 pv-v2-anomaly 板)', () => {
  it('❗规则行:名称 / 值 / 明细', () => {
    expect(S.pvRuleOver({ name: '创业大厦', m: 12, perDay: 31.5428, over: 25, days: 31, cap: 9.3 })).toEqual({
      title: '创业大厦 12月每千瓦日均超 24 kWh', value: '12月每千瓦日均 31.5 kWh', detail: '31 天里 25 天超过 24 kWh · 台账装机 9.3 kWp',
    })
    expect(S.pvRuleRun({ name: '11栋', m: 10, run: 3, outN: 14, runs: [{ from: 20, to: 22, dir: 1 }, { from: 26, to: 29, dir: 1 }] })).toEqual({
      title: '11栋 10月连着 3 天以上偏离平时', value: '10月偏离平时 14 天', detail: '10月20–22日、26–29日连着高于平时范围',
    })
    expect(S.pvRuleRun({ name: 'S4', m: 4, run: 3, outN: 4, runs: [{ from: 20, to: 23, dir: -1 }] }).detail).toBe('4月20–23日连着低于平时范围')
    expect(S.pvRuleRun({ name: 'S4', m: 4, run: 3, outN: 9, runs: [{ from: 2, to: 4, dir: -1 }, { from: 20, to: 23, dir: 1 }] }).detail).toBe('4月2–4日、20–23日连着偏离平时范围')
  })
  it('❗读数句(count):只有超 24 / 只有连着偏离 / 两种都有 / 0 条不出句', () => {
    const o = (name: string) => ({ name, kind: 'over' as const }), r = (name: string) => ({ name, kind: 'run' as const })
    expect(S.pvCount(12, [o('创业大厦'), o('工业大厦')])?.text).toBe('12月 2 栋楼触发规则，都是每千瓦日均超 24 kWh')
    expect(S.pvCount(11, [r('13栋')])?.text).toBe('11月 1 栋楼触发规则，都是连着偏离平时')
    expect(S.pvCount(4, [o('小楼'), r('S4'), r('小楼')])?.text).toBe('4月 2 栋楼触发规则，共 3 条')
    expect(S.pvCount(4, [])).toBeNull()
  })
  it('卡头说明、工具条', () => {
    expect(S.pvHint(13, S.yearSpan(2025, 1, 12), 24)).toBe('13 栋楼 · 2025年1–12月 · 24 条')
    expect(S.pvAsof('2025-12')).toBe('光伏抄表到 2025年12月')
  })
})
