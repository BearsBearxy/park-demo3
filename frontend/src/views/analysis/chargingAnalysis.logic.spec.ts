// chargingAnalysis.logic 单测:手续费率/损耗率口径 + 年汇总加权平均 + 桩月分桶/运营商聚合(spec §3)。
import { describe, expect, it } from 'vitest'
import { feeRate, lossRate, lossSeries, monthOf, operatorTotals, stationMonthly, yearSummary } from './chargingAnalysis.logic'

const st = (id: number, name: string, operator: string, sortNo = id) => ({ id, name, operator, sortNo })
const rd = (stationId: number, readDate: string, chargeKwh: number, fee: number, revenue: number) =>
  ({ stationId, readDate, chargeKwh, fee, revenue })
const pu = (operator: string, month: number, meterKwh: number | null, sumChargeKwh: number) =>
  ({ operator, month, meterKwh, sumChargeKwh })

describe('feeRate / lossRate(spec §3 口径)', () => {
  it('手续费率 = 手续费÷(收益+手续费);分母 0 → null', () => {
    expect(feeRate(5, 95)).toBeCloseTo(0.05)
    expect(feeRate(0, 0)).toBeNull()
  })
  it('损耗率 = (电表−Σ充电)÷电表;可为负;未录/0 电表 → null', () => {
    expect(lossRate(100, 90)).toBeCloseTo(0.1)
    expect(lossRate(100, 120)).toBeCloseTo(-0.2)   // 计量异常保留负值
    expect(lossRate(null, 50)).toBeNull()
    expect(lossRate(0, 0)).toBeNull()
  })
})

describe('yearSummary(结论条:Σ三金额 + 电表已录行加权损耗率)', () => {
  it('平均损耗率 = Σ(电表)−Σ(充电,仅电表已录行) ÷ Σ电表', () => {
    const s = yearSummary(
      [rd(1, '2025-01-10', 100, 5, 95), rd(1, '2025-02-10', 200, 10, 190)],
      [pu('小桔', 1, 100, 90), pu('小桔', 2, null, 50), pu('万城万', 2, 200, 190)],
    )
    expect(s).toMatchObject({ chargeKwh: 300, fee: 15, revenue: 285 })
    expect(s.avgLossRate).toBeCloseTo((300 - 280) / 300)   // null 电表行不入加权
  })
  it('全年无电表行 → avgLossRate=null(不画假 0)', () => {
    expect(yearSummary([rd(1, '2025-01-10', 10, 1, 9)], [pu('小桔', 1, null, 10)]).avgLossRate).toBeNull()
  })
})

describe('stationMonthly(图1:桩×12月充电分桶 + 月收益合计)', () => {
  it('同桩同月求和、桩按 sortNo 序、无记录桩不入图;收益线=全部桩月合计', () => {
    const out = stationMonthly(
      [st(2, '慢充1', '小桔', 2), st(1, '快充1', '小桔', 1), st(3, '空桩', '万城万', 3)],
      [rd(1, '2025-01-05', 10, 1, 9), rd(1, '2025-01-20', 5, 0.5, 4.5), rd(2, '2025-03-01', 20, 2, 18)],
    )
    expect(out.stations.map((s) => s.name)).toEqual(['快充1', '慢充1'])
    expect(out.stations[0].charge[0]).toBe(15)
    expect(out.stations[1].charge[2]).toBe(20)
    expect(out.revenue[0]).toBeCloseTo(13.5)
    expect(out.revenue[2]).toBe(18)
    expect(monthOf('2025-12-31')).toBe(12)
  })
})

describe('operatorTotals(图2:运营商聚合 + 手续费率,收益降序)', () => {
  it('同运营商多桩合并;未知桩记录跳过;费率=fee÷(rev+fee)', () => {
    const out = operatorTotals(
      [st(1, 'a', '小桔'), st(2, 'b', '小桔'), st(3, 'c', '万城万')],
      [rd(1, '2025-01-01', 0, 5, 45), rd(2, '2025-02-01', 0, 5, 45), rd(3, '2025-01-01', 0, 20, 180), rd(99, '2025-01-01', 0, 9, 9)],
    )
    expect(out).toEqual([
      { operator: '万城万', revenue: 180, fee: 20, feeRate: 0.1 },
      { operator: '小桔', revenue: 90, fee: 10, feeRate: 0.1 },
    ])
  })
})

describe('lossSeries(图3:每运营商 12 槽,无电表月 null 断点)', () => {
  it('12 槽定长;有电表月落率(负值保留),其余 null', () => {
    const out = lossSeries([pu('小桔', 2, 100, 90), pu('小桔', 5, 100, 120), pu('小桔', 6, null, 30)])
    expect(out).toHaveLength(1)
    expect(out[0].rates).toHaveLength(12)
    expect(out[0].rates[1]).toBeCloseTo(0.1)
    expect(out[0].rates[4]).toBeCloseTo(-0.2)
    expect(out[0].rates[5]).toBeNull()   // 电表未录 → 断点
    expect(out[0].rates[0]).toBeNull()
  })
})
