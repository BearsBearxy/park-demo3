// pvRoi.logic 单测:累计序列/跨年進位/外推回收点/分期汇总(口径=v1)。
// 分栋抄表那四个函数已随抄表区一并卸掉(PV-ANALYSIS-SPEC §00/§09):
// 新屏 pv-meter-analysis 的口径完全不同(不是搬过去,是重做),它有自己的 pvMeterAna.logic.spec.ts;
// 其中「损耗为负 = 计量异常」这一条被接进了新屏的数据质量通道,没有随删丢掉。
import { describe, expect, it } from 'vitest'
import type { PvPhaseDTO, PvRecordDTO } from '@/types/pv'
import { buildRamp, cumSeries, nextYm, phaseMonthly, phaseSummaries } from './pvRoi.logic'

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
