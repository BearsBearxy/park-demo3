// pvRoi.logic 单测:累计序列/跨年進位/外推回收点/分期汇总(口径=v1)+ 分栋抄表效率/消纳/收益。
import { describe, expect, it } from 'vitest'
import type { PvPhaseDTO, PvRecordDTO } from '@/types/pv'
import {
  buildRamp, consumptionRows, cumSeries, monthlyEfficiency, nextYm, phaseMonthly, phaseSummaries,
  revenueByStation, stationEfficiency, type MeterReading, type MeterStation,
} from './pvRoi.logic'

const rec = (phase: string, ym: string, selfAmt: number, gridAmt: number): PvRecordDTO => ({
  id: 0, phase, phaseName: phase, acctMonth: ym, occurMonth: ym,
  selfKwh: 0, selfAmt, gridKwh: 0, gridAmt, gen: 0, fee: selfAmt + gridAmt, note: null, source: 'seed',
})
const phase = (id: string): PvPhaseDTO => ({ id, name: id, short: id, online: null })

describe('cumSeries / nextYm', () => {
  it('同月多期合并、按月升序累计', () => {
    const out = cumSeries([rec('p2', '2025-02', 10, 0), rec('p1', '2025-01', 5, 5), rec('p1', '2025-02', 0, 20)])
    expect(out).toEqual([{ ym: '2025-01', cum: 10 }, { ym: '2025-02', cum: 40 }])
  })
  it('nextYm 跨年進位', () => {
    expect(nextYm('2025-12')).toBe('2026-01')
    expect(nextYm('2025-09')).toBe('2025-10')
  })
})

describe('buildRamp', () => {
  const pts = [{ ym: '2025-11', cum: 100 }, { ym: '2025-12', cum: 250 }]
  it('未回收 → 虚线按月均外推,越线月=hitIdx,projected 与实际线衔接', () => {
    const r = buildRamp(pts, 100, 500)
    expect(r.labels).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03'])
    expect(r.actual).toEqual([100, 250, null, null, null])
    expect(r.projected).toEqual([null, 250, 350, 450, 550])
    expect(r.hitIdx).toBe(4)
  })
  it('已回收 → hitIdx 落实际段,不外推', () => {
    const r = buildRamp(pts, 100, 200)
    expect(r.hitIdx).toBe(1)
    expect(r.labels).toHaveLength(2)
    expect(r.projected).toEqual([null, null])
  })
  it('月均≤0 / 投资额≤0 / 空序列 → 不外推 hitIdx=null;maxMonths 封顶', () => {
    expect(buildRamp(pts, 0, 500).hitIdx).toBeNull()
    expect(buildRamp(pts, 100, 0).hitIdx).toBeNull()
    expect(buildRamp([], 100, 500).labels).toEqual([])
    const capped = buildRamp(pts, 1, 1e9, 3)
    expect(capped.hitIdx).toBeNull()
    expect(capped.labels).toHaveLength(5)   // 2 实际 + 3 外推
  })
})

describe('phaseSummaries / phaseMonthly', () => {
  const records = [rec('p1', '2025-01', 60, 40), rec('p1', '2025-02', 50, 50), rec('p2', '2025-02', 80, 20)]
  it('分期累计/自消纳/年化/占比(口径=v1)', () => {
    const [a, b] = phaseSummaries([phase('p1'), phase('p2')], records)
    expect(a).toMatchObject({ months: 2, cum: 200, selfAmt: 110, gridAmt: 90, annual: 1200, share: 200 / 300 })
    expect(b).toMatchObject({ months: 1, cum: 100, annual: 1200, share: 100 / 300 })
  })
  it('无记录期 → 全 0;明细按月升序', () => {
    const [c] = phaseSummaries([phase('p3')], records)
    expect(c).toMatchObject({ months: 0, cum: 0, annual: 0, share: 0 })
    expect(phaseMonthly(records, 'p1').map((r) => r.ym)).toEqual(['2025-01', '2025-02'])
  })
})

// ══ 分栋抄表分析(ENERGY-ANALYSIS-SPEC §2)══
const st = (id: number, name: string, cap: number | null): MeterStation => ({ id, name, capacityKwp: cap })
const rd = (stationId: number, readDate: string, gen: number, self: number, grid: number, revenue = 0): MeterReading =>
  ({ stationId, readDate, genTotal: gen, selfUse: self, gridFeed: grid, revenue })

describe('stationEfficiency', () => {
  const stations = [st(1, 'A栋', 100), st(2, 'B栋', null), st(3, 'C栋', 200), st(4, 'D栋', 50)]
  it('效率=Σ发电÷容量;无容量站不入图并列名;无抄表站不入;capN 含无抄表站(护栏分子)', () => {
    const r = stationEfficiency(stations, [rd(1, '2025-01-05', 1000, 0, 0), rd(1, '2025-02-05', 500, 0, 0), rd(2, '2025-01-05', 800, 0, 0)])
    expect(r.rows).toEqual([{ name: 'A栋', eff: 15 }])   // (1000+500)/100
    expect(r.noCap).toEqual(['B栋'])
    expect(r.capN).toBe(3)   // A/C/D 已录容量(C/D 无抄表仍计覆盖率)
  })
  it('空抄表 → rows/noCap 全空', () => {
    expect(stationEfficiency(stations, [])).toEqual({ rows: [], noCap: [], capN: 3 })
  })
})

describe('monthlyEfficiency', () => {
  const stations = [st(1, 'A栋', 100), st(2, 'B栋', 300), st(3, 'C栋', null)]
  const readings = [
    rd(1, '2025-01-03', 1000, 0, 0), rd(1, '2025-01-20', 200, 0, 0),   // 1月 A=1200
    rd(1, '2025-02-03', 900, 0, 0), rd(2, '2025-02-05', 3000, 0, 0),   // 2月 A+B
    rd(3, '2025-03-05', 500, 0, 0),                                     // 3月仅无容量站
  ]
  it('全园加权=当月有抄表的有容量站 Σ发电÷Σ容量;仅无容量站月 → null 断点;月升序', () => {
    const t = monthlyEfficiency(stations, readings)
    expect(t.yms).toEqual(['2025-01', '2025-02', '2025-03'])
    expect(t.park).toEqual([12, (900 + 3000) / 400, null])
    expect(t.sel).toBeNull()
  })
  it('单站线=该站月发电÷容量,无抄表月 null;选无容量站 → 全 null', () => {
    expect(monthlyEfficiency(stations, readings, 1).sel).toEqual([12, 9, null])
    expect(monthlyEfficiency(stations, readings, 3).sel).toEqual([null, null, null])
  })
})

describe('consumptionRows / revenueByStation', () => {
  const stations = [st(1, 'A栋', 100), st(2, 'B栋', null), st(3, 'C栋', 80)]
  const readings = [
    rd(1, '2025-01-03', 1000, 700, 200, 350),   // 损耗 +100
    rd(1, '2025-02-03', 800, 500, 400, 250),    // 损耗 −100(计量异常)
    rd(2, '2025-01-05', 600, 600, 0, 0),        // 损耗 0
    rd(3, '2025-01-02', 0, 0, 0),               // 发电 0 → lossRate null
  ]
  it('按月:损耗=发电−自消纳−上网,负损耗照实;损耗率=损耗÷发电;月升序', () => {
    expect(consumptionRows(stations, readings, 'month')).toEqual([
      { key: '2025-01', self: 1300, grid: 200, loss: 100, lossRate: 100 / 1600 },
      { key: '2025-02', self: 500, grid: 400, loss: -100, lossRate: -100 / 800 },
    ])
  })
  it('按站:站序;发电 0 站 lossRate=null;无抄表站不入', () => {
    const rows = consumptionRows([...stations, st(9, '无数据', 50)], readings, 'station')
    expect(rows.map((r) => r.key)).toEqual(['A栋', 'B栋', 'C栋'])
    expect(rows[0]).toMatchObject({ self: 1200, grid: 600, loss: 0, lossRate: 0 })
    expect(rows[2].lossRate).toBeNull()
  })
  it('消纳收益=Σrevenue(快照口径);上网收益=Σ上网×参数价;站序,无抄表站不入', () => {
    expect(revenueByStation([...stations, st(9, '无数据', 50)], readings, 0.453)).toEqual([
      { name: 'A栋', selfRev: 600, gridRev: 600 * 0.453 },
      { name: 'B栋', selfRev: 0, gridRev: 0 },
      { name: 'C栋', selfRev: 0, gridRev: 0 },
    ])
  })
})
