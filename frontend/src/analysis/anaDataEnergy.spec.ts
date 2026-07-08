// buildEnergyMonths 纯聚合单测(park-energy 屏地基):多源合并、缺月保 null、跨年行丢弃、升序。
import { describe, expect, it } from 'vitest'
import { buildEnergyMonths } from './anaData'
import type { AnalysisS10Row } from '@/api/analysis'
import type { ChargingYearDTO } from '@/types/charging'
import type { ElecYearDTO } from '@/types/elec'
import type { PvRecordDTO } from '@/types/pv'
import type { OfficeYearDTO } from '@/types/utilities'

// fixture 只填聚合器读到的字段,其余走 cast(形状对齐真实 DTO)
const elecYear = (rows: object[]): ElecYearDTO => ({ rows } as unknown as ElecYearDTO)
const eRow = (acctMonth: string, qty: number | null, total: number) => ({ acctMonth, qty, total })
const pvRow = (acctMonth: string, selfKwh: number, gridKwh: number, fee: number): PvRecordDTO =>
  ({ acctMonth, selfKwh, gridKwh, fee } as PvRecordDTO)
const chgYear = (rows: object[]): ChargingYearDTO => ({ rows } as unknown as ChargingYearDTO)
const offYear = (rows: object[]): OfficeYearDTO => ({ rows } as unknown as OfficeYearDTO)
const s10Row = (acctMonth: string, elec: number, water: number): AnalysisS10Row =>
  ({ acctMonth, elec, water } as AnalysisS10Row)

describe('buildEnergyMonths', () => {
  it('购电 energy+basic 合并成本;basic 行(qty=null)不计电量', () => {
    const out = buildEnergyMonths(2025,
      { energy: elecYear([eRow('2025-01', 968400, 767047.02)]), basic: elecYear([eRow('2025-01', null, 109994.25)]) },
      [], [], [], [])
    expect(out).toHaveLength(1)
    expect(out[0].buyKwh).toBe(968400)
    expect(out[0].buyCost).toBeCloseTo(877041.27, 2)
  })

  it('多源同月合并;s10 未覆盖月保持 null(不补 0)', () => {
    const out = buildEnergyMonths(2025,
      { energy: elecYear([eRow('2025-03', 100, 90), eRow('2025-04', 200, 180)]), basic: elecYear([]) },
      [pvRow('2025-03', 50, 10, 66)],
      [chgYear([{ acctMonth: '2025-03', kwh: 5, profit: 3 }]), chgYear([{ acctMonth: '2025-03', kwh: 7, profit: 4 }])],
      [offYear([{ acctMonth: '2025-03', elecQty: 8 }])],
      [s10Row('2025-03', 1000, 20)])
    expect(out.map((m) => m.ym)).toEqual(['2025-03', '2025-04'])
    const m3 = out[0]
    expect(m3.pvSelfKwh).toBe(50)
    expect(m3.pvGridKwh).toBe(10)
    expect(m3.pvAmt).toBe(66)
    expect(m3.chgKwh).toBe(12)      // 附表7+8 合并
    expect(m3.chgProfit).toBe(7)
    expect(m3.officeKwh).toBe(8)
    expect(m3.s10Elec).toBe(1000)
    expect(m3.s10Water).toBe(20)
    const m4 = out[1]
    expect(m4.s10Elec).toBeNull()   // 该月 s10 未录 → null
    expect(m4.pvSelfKwh).toBeNull()
  })

  it('跨年行丢弃;输出按月升序', () => {
    const out = buildEnergyMonths(2025,
      { energy: elecYear([]), basic: elecYear([]) },
      [pvRow('2024-12', 1, 1, 1), pvRow('2025-02', 2, 2, 2), pvRow('2025-01', 3, 3, 3), pvRow('2026-01', 9, 9, 9)],
      [], [], [])
    expect(out.map((m) => m.ym)).toEqual(['2025-01', '2025-02'])
    expect(out[0].pvSelfKwh).toBe(3)
  })
})
