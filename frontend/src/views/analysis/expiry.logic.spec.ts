// expiry.logic 纯函数单测(v2 抽出;统计口径=v1,Pareto 累计占比对全量合计)
import { describe, expect, it } from 'vitest'
import type { ContractDTO } from '@/types/contract'
import { buildExpiryStats, buildPareto, concentrationOption, paretoOption } from './expiry.logic'

let seq = 0
function ct(p: Partial<ContractDTO>): ContractDTO {
  seq++
  return {
    id: seq, contractNo: 'HT' + seq, tenantId: seq, tenantName: '租户' + seq,
    buildingId: 1, buildingName: 'A栋', unitId: null, floorInfo: '1F',
    rentArea: 0, monthlyRent: 0, deposit: 0,
    startDate: null, endDate: null, signDate: null,
    status: 'active', termMonths: 0, daysToEnd: null, remark: null, ...p,
  }
}

describe('buildExpiryStats', () => {
  it('空 → null', () => {
    expect(buildExpiryStats([])).toBeNull()
  })

  it('合计/零租金/日期缺失/Top10 集中度(=v1 口径)', () => {
    // 12 份:租金 120..10(降序)+ 零租金 1 份;一份有日期
    const cs = [...Array(12)].map((_, i) => ct({ monthlyRent: (12 - i) * 10 }))
    cs.push(ct({ monthlyRent: 0 }))
    cs[0].startDate = '2025-01-01'
    const s = buildExpiryStats(cs)!
    expect(s.total).toBe(13)
    expect(s.rentSum).toBe(780)          // 10+20+…+120
    expect(s.withRent).toBe(12)
    expect(s.zeroRent).toBe(1)
    expect(s.dateMissing).toBe(12)       // 有日期的 1 份除外
    expect(s.top10Sum).toBe(750)         // 120..30
    expect(s.top10Pct).toBe(+(750 / 780 * 100).toFixed(1))
    expect(s.medRent).toBe(65)           // 12 值中位 =(60+70)/2
  })
})

describe('buildPareto / option', () => {
  const cs = [
    ct({ tenantName: '甲', monthlyRent: 300 }),
    ct({ tenantName: '乙', monthlyRent: 100 }),
    ct({ tenantName: '丙', monthlyRent: 100 }),
  ]

  it('TopN 降序 + 累计占比对全量', () => {
    const p = buildPareto(cs, 2)
    expect(p.tenants).toEqual(['甲', '乙'])
    expect(p.rents).toEqual([300, 100])
    expect(p.cumPct).toEqual([60, 80])   // 300/500、400/500
    expect(p.ids).toHaveLength(2)
  })

  it('paretoOption:柱=万、线走第二轴;concentrationOption:两片=Top10/其余', () => {
    const opt = paretoOption(buildPareto(cs, 2)) as {
      series: { name: string; data: number[]; yAxisIndex?: number }[]
    }
    expect(opt.series[0].data).toEqual([0.03, 0.01])   // 元→万
    expect(opt.series[1].yAxisIndex).toBe(1)
    const ring = concentrationOption(400, 500) as { series: { data: { name: string; value: number }[] }[] }
    expect(ring.series[0].data.map((d) => d.value)).toEqual([400, 100])
  })
})
