import { describe, expect, it } from 'vitest'
import type { BillingLineDTO, ContractDTO } from '@/types/contract'
import {
  MIN_SAMPLE, isInForce, buildPeerRows, primaryRowOf, eligibleTenants, phaseZoneLabel,
  percentBelow, phaseStatsOf, buildUnitRentHist, unitRentReadout, unitRentRefText,
  unitRentHistOption, dominantPropertyType, type PeerRow, type PhaseStats,
} from './TenantPeer.logic'

let seq = 0
function ct(p: Partial<ContractDTO>): ContractDTO {
  seq++
  return {
    id: seq, contractNo: 'HT' + seq, tenantId: seq, tenantName: '租户' + seq,
    buildingId: 1, buildingName: 'A栋', unitId: null, floorInfo: '1F',
    rentArea: 100, monthlyRent: 1000, deposit: 0,
    startDate: '2025-01-01', endDate: '2026-12-31', signDate: '2025-01-01',
    status: 'active', kind: 'normal', termMonths: 24, daysToEnd: null, remark: null, ...p,
  }
}
function bl(p: Partial<BillingLineDTO>): BillingLineDTO {
  return { id: 1, contractId: 1, location: '主', feeKey: 'rent_factory', billMode: 'per_sqm_month', unitPrice: 10, ...p }
}

describe('isInForce', () => {
  it('草稿/整体承租一律排除', () => {
    expect(isInForce(ct({ status: 'draft' }), '2025-06-01')).toBe(false)
    expect(isInForce(ct({ kind: 'master_lease' }), '2025-06-01')).toBe(false)
  })
  it('起止日期缺一不可', () => {
    expect(isInForce(ct({ startDate: null }), '2025-06-01')).toBe(false)
    expect(isInForce(ct({ endDate: null }), '2025-06-01')).toBe(false)
  })
  it('闭区间:两端相等算在租,越界不算', () => {
    const c = ct({ startDate: '2025-01-01', endDate: '2025-12-31' })
    expect(isInForce(c, '2025-01-01')).toBe(true)
    expect(isInForce(c, '2025-12-31')).toBe(true)
    expect(isInForce(c, '2024-12-31')).toBe(false)
    expect(isInForce(c, '2026-01-01')).toBe(false)
  })
})

describe('buildPeerRows', () => {
  const phaseOf = new Map([[1, 1], [2, 2]])
  it('过滤不在租/零面积/未知期区,单位租金=月租/面积', () => {
    const cs = [
      ct({ buildingId: 1, monthlyRent: 2000, rentArea: 100 }),          // 20.00
      ct({ buildingId: 1, status: 'draft' }),                            // 排除:草稿
      ct({ buildingId: 1, rentArea: 0 }),                                 // 排除:零面积
      ct({ buildingId: 9, monthlyRent: 500, rentArea: 50 }),              // 排除:期区未知(9 不在 phaseOf)
    ]
    const rows = buildPeerRows(cs, phaseOf, '2025-06-01')
    expect(rows).toHaveLength(1)
    expect(rows[0].unitRent).toBe(20)
    expect(rows[0].phase).toBe(1)
  })
})

describe('primaryRowOf / eligibleTenants', () => {
  const rows: PeerRow[] = [
    { contractId: 5, tenantId: 1, tenantName: '乙公司', buildingId: 1, phase: 1, rentArea: 100, monthlyRent: 1000, unitRent: 10 },
    { contractId: 2, tenantId: 1, tenantName: '乙公司', buildingId: 1, phase: 1, rentArea: 50, monthlyRent: 600, unitRent: 12 },
    { contractId: 3, tenantId: 2, tenantName: '甲公司', buildingId: 2, phase: 2, rentArea: 80, monthlyRent: 400, unitRent: 5 },
  ]
  it('主合同取 id 最小的一份', () => {
    expect(primaryRowOf(rows, 1)?.contractId).toBe(2)
    expect(primaryRowOf(rows, 999)).toBeNull()
  })
  it('候选去重且按名称 zh 排序(甲在乙前)', () => {
    const opts = eligibleTenants(rows)
    expect(opts.map((o) => o.id)).toEqual([2, 1])
    expect(opts[1].name).toBe('乙公司')
  })
})

describe('phaseZoneLabel', () => {
  it('1~4 对应板上叫法,超出用阿拉伯数字兜底', () => {
    expect(phaseZoneLabel(1)).toBe('期区一')
    expect(phaseZoneLabel(4)).toBe('期区四')
    expect(phaseZoneLabel(11)).toBe('期区11')
  })
})

describe('percentBelow / phaseStatsOf', () => {
  const vals = Array.from({ length: 20 }, (_, i) => i + 1)   // 1..20
  it('严格小于计数', () => {
    expect(percentBelow(vals, 11)).toBe(50)    // 1..10 共10个 < 11,10/20=50%
    expect(percentBelow(vals, 1)).toBe(0)
    expect(percentBelow([], 5)).toBe(0)
  })
  it('样本 < MIN_SAMPLE(20)→ null,不给区间', () => {
    expect(phaseStatsOf(vals.slice(0, 19))).toBeNull()
  })
  it('样本达标 → 五数(与 anaFmt.quantile 同一套线性插值)', () => {
    const s = phaseStatsOf(vals) as PhaseStats
    expect(s.n).toBe(20)
    expect(s.median).toBeCloseTo(10.5, 6)
  })
})

describe('buildUnitRentHist', () => {
  it('binWidth 由 p90 推 4 档等宽,capHi=binWidth×4,capHi 以上归溢出档', () => {
    // p90=34.48 → niceStep(34.48/4=8.62)→ 10;capHi=40
    const vals = [7.45, 9, 16.5, 22.6, 28.11, 39.76, 60.98]
    const h = buildUnitRentHist(vals, 34.48)
    expect(h.binWidth).toBe(10)
    expect(h.capHi).toBe(40)
    expect(h.overflowCount).toBe(1)          // 只有 60.98 ≥ 40
    expect(h.overflowMax).toBe(60.98)
    const total = h.bins.reduce((s, b) => s + b.count, 0) + h.overflowCount
    expect(total).toBe(vals.length)
  })
  it('边界值 v=capHi 精确落溢出档,不落最后一个常规档', () => {
    const h = buildUnitRentHist([39, 40], 40)   // binWidth=niceStep(10)=10,capHi=40
    expect(h.bins[3].count).toBe(1)    // 39 落 [30,40)
    expect(h.overflowCount).toBe(1)    // 40 落溢出档(>=capHi)
  })
})

describe('unitRentReadout / unitRentRefText', () => {
  const vals = Array.from({ length: 25 }, (_, i) => (i + 1) * 2)   // 2,4,...,50
  it('样本不足→闭嘴', () => {
    expect(unitRentReadout(10, vals.slice(0, 19), '期区一')).toBeNull()
  })
  it('高于半数走"高于"分支,数字=严格小于占比', () => {
    const s = unitRentReadout(40, vals, '期区一')   // 40:严格小于的有 2..38 共19个/25=76%
    expect(s).toContain('高于')
    expect(s).toContain('76%')
  })
  it('低于半数走"低于"分支,数字=严格大于占比', () => {
    const s = unitRentReadout(4, vals, '期区一')   // 4:严格大于的有 6..50 共23个/25=92%
    expect(s).toContain('低于')
    expect(s).toContain('92%')
  })
  it('比较方向的边界:below 恰好 50% 时走"高于"分支(>=,不是 >)', () => {
    // 20 个值 1..20(凑够 MIN_SAMPLE),value=10.5(不在样本里):严格小于的有 1..10 共10个/20=50%
    const s = unitRentReadout(10.5, Array.from({ length: 20 }, (_, i) => i + 1), '期区一')
    expect(s).toContain('高于')
    expect(s).toContain('50%')
  })
  it('参照系小字含样本量/分组口径/期间', () => {
    const r = unitRentRefText(51, '期区一', '2026-09')
    expect(r).toContain('51')
    expect(r).toContain('期区一')
    expect(r).toContain('2026-09')
  })
})

describe('unitRentHistOption', () => {
  it('结构:1 个 bar 系列,数据=4 常规档+1 溢出档,4 条 markLine', () => {
    const h = buildUnitRentHist([5, 15, 25, 35, 45], 34)
    const stats: PhaseStats = { n: 5, p10: 6, median: 25, p90: 34 }
    const opt = unitRentHistOption(h, stats, '鑫皇', 28.11) as {
      series: { data: unknown[]; markLine: { data: unknown[] } }[]
    }
    expect(opt.series).toHaveLength(1)
    expect(opt.series[0].data).toHaveLength(5)
    expect(opt.series[0].markLine.data).toHaveLength(4)
  })
})

describe('dominantPropertyType', () => {
  it('无租金行 → null', () => {
    expect(dominantPropertyType([bl({ feeKey: 'mgmt' })])).toBeNull()
  })
  it('多条租金行取面积最大的一条(顺序打乱、物业类型各不相同,排除"永远取第一条"这种巧合)', () => {
    const lines = [
      bl({ feeKey: 'rent_dorm', propertyType: 'dorm', area: 820 }),     // 排第一但面积较小
      bl({ feeKey: 'rent_office', propertyType: 'office', area: 1640 }), // 面积最大,应取这条
    ]
    expect(dominantPropertyType(lines)).toBe('office')
  })
  it('propertyType 空时按 feeKey 反推(inferPropertyType 口径)', () => {
    expect(dominantPropertyType([bl({ feeKey: 'rent_dorm', propertyType: null, area: 50 })])).toBe('dorm')
  })
})
