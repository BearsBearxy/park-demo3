// expiry.logic 纯函数单测(v2 抽出;统计口径=v1,Pareto 累计占比对全量合计)
import { describe, expect, it } from 'vitest'
import type { ContractDTO } from '@/types/contract'
import { buildExpiringSoon, buildExpiryStats, buildExpiryWall, buildPareto, concentrationOption, paretoOption, wallOption } from './expiry.logic'

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

describe('buildExpiryWall', () => {
  const today = new Date(2026, 6, 12)   // 2026-07-12(Q3)

  it('空输入:恒 8 季全零标签跨年滚动', () => {
    const w = buildExpiryWall([], today)
    expect(w.quarters.map((q) => q.label)).toEqual([
      '2026Q3', '2026Q4', '2027Q1', '2027Q2', '2027Q3', '2027Q4', '2028Q1', '2028Q2',
    ])
    expect(w.quarters.every((q) => q.rentSum === 0 && q.count === 0)).toBe(true)
    expect(w.totalCount).toBe(0)
  })

  it('逐季聚合;8 季窗口外/状态不入围不计', () => {
    const w = buildExpiryWall([
      ct({ monthlyRent: 100, endDate: '2026-08-01' }),                        // 2026Q3
      ct({ monthlyRent: 200, endDate: '2026-09-30', status: 'expiring' }),    // 2026Q3
      ct({ monthlyRent: 50, endDate: '2027-01-15' }),                         // 2027Q1(跨年)
      ct({ monthlyRent: 999, endDate: '2028-07-01' }),                        // 第 9 季,窗口外
      ct({ monthlyRent: 999, endDate: '2026-08-01', status: 'terminated' }),  // 状态不入围
    ], today)
    expect(w.quarters[0]).toEqual({ label: '2026Q3', rentSum: 300, count: 2 })
    expect(w.quarters[2]).toEqual({ label: '2027Q1', rentSum: 50, count: 1 })
    expect(w.totalCount).toBe(3)
  })

  it('today 当天到期计入;已过期(status 仍 active)按日期剔除;无日期跳过', () => {
    const w = buildExpiryWall([
      ct({ monthlyRent: 10, endDate: '2026-07-12' }),   // 当天到期,计入
      ct({ monthlyRent: 99, endDate: '2026-07-11' }),   // 昨天到期,status=active 也剔除
      ct({ monthlyRent: 99, endDate: null }),           // 无日期跳过
    ], today)
    expect(w.quarters[0].rentSum).toBe(10)
    expect(w.totalCount).toBe(1)
  })

  it('第 8 季最后一天计入(窗口右边界含);12 月起步 Q4 跨年滚动标签正确', () => {
    // today 落在 Q4:2026-12-15 → 窗口 2026Q4..2028Q3,第 8 季末日 = 2028-09-30
    const dec = new Date(2026, 11, 15)
    const w = buildExpiryWall([
      ct({ monthlyRent: 7, endDate: '2028-09-30' }),   // 第 8 季最后一天,计入
      ct({ monthlyRent: 9, endDate: '2028-10-01' }),   // 第 9 季首日,剔除
    ], dec)
    expect(w.quarters.map((q) => q.label)).toEqual(['2026Q4', '2027Q1', '2027Q2', '2027Q3', '2027Q4', '2028Q1', '2028Q2', '2028Q3'])
    expect(w.quarters[7].rentSum).toBe(7)
    expect(w.totalCount).toBe(1)
  })
})

describe('buildExpiringSoon', () => {
  const today = new Date(2026, 6, 12)

  it('90 天闭区间两端计入,区间外/无日期/状态不入围剔除,按 endDate 升序', () => {
    const rows = buildExpiringSoon([
      ct({ tenantName: '乙', endDate: '2026-10-10' }),   // today+90,右端点计入
      ct({ tenantName: '甲', endDate: '2026-07-12' }),   // 当天,左端点计入
      ct({ endDate: '2026-10-11' }),                     // 第 91 天,出界
      ct({ endDate: '2026-07-11' }),                     // 昨天,出界
      ct({ endDate: null }),                             // 无日期跳过
      ct({ endDate: '2026-08-01', status: 'expired' }),  // 状态不入围
    ], today)
    expect(rows.map((r) => r.tenantName)).toEqual(['甲', '乙'])
    expect(rows.map((r) => r.daysLeft)).toEqual([0, 90])
  })

  it('空输入 → 空数组;行字段齐全', () => {
    expect(buildExpiringSoon([], today)).toEqual([])
    const [r] = buildExpiringSoon([ct({ contractNo: 'HT-X', tenantName: '丙', monthlyRent: 8000, endDate: '2026-08-01' })], today)
    expect(r).toMatchObject({ tenantName: '丙', contractNo: 'HT-X', monthlyRent: 8000, endDate: '2026-08-01', daysLeft: 20 })
  })
})

describe('wallOption', () => {
  it('柱=折万,tooltip 含户数', () => {
    const w = buildExpiryWall([ct({ monthlyRent: 25000, endDate: '2026-08-01' })], new Date(2026, 6, 12))
    const opt = wallOption(w) as {
      xAxis: { data: string[] }
      series: { data: number[] }[]
      tooltip: { formatter: (ps: { name: string; value: number; dataIndex: number }[]) => string }
    }
    expect(opt.xAxis.data).toHaveLength(8)
    expect(opt.series[0].data[0]).toBe(2.5)   // 25000 元 → 2.5 万
    expect(opt.tooltip.formatter([{ name: '2026Q3', value: 2.5, dataIndex: 0 }])).toBe('2026Q3<br/>¥2.5万 · 1 份合同')
  })
})
