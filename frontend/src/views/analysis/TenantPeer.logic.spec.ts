import { describe, expect, it } from 'vitest'
import type { BillingLineDTO, ContractDTO } from '@/types/contract'
import type { AnalysisS10Row } from '@/api/analysis'
import {
  MIN_SAMPLE, isInForce, buildPeerRows, primaryRowOf, eligibleTenants, phaseZoneLabel,
  percentBelow, phaseStatsOf, buildUnitRentHist, unitRentReadout, unitRentRefText,
  unitRentHistOption, dominantPropertyType,
  phaseTableRowOf, phaseTableRows, phaseTableReadout, phaseTableRefText,
  latestElecSpread, elecTrapReadout, elecTrapRefText,
  type PeerRow, type PhaseStats, type PhaseTableRow, type ElecSpread,
} from './TenantPeer.logic'

let seq = 0
function ct(p: Partial<ContractDTO>): ContractDTO {
  seq++
  return {
    id: seq, contractNo: 'HT' + seq, tenantId: seq, tenantName: '租户' + seq,
    buildingId: 1, buildingName: 'A栋', unitId: null, floorInfo: '1F',
    rentArea: 100, monthlyRent: 1000, deposit: 0,
    startDate: '2025-01-01', endDate: '2026-12-31', signDate: '2025-01-01',
    status: 'active', kind: 'normal', termMonths: 24, daysToEnd: null, remark: null,
    billingLineCount: 1, ...p,   // 默认有租金计费行;F1 用例显式传 0 测排除
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
  it('排除无租金计费行的合同(F1:monthly_rent 只有维护费,不是便宜)——查库验过的合同 162 原型:' +
    '面积 9263、月租 20075.48(=9263×1.96+1590+330,全是维护/电梯/变压器费),billingLineCount=0', () => {
    const cs = [
      ct({ buildingId: 1, monthlyRent: 2000, rentArea: 100, billingLineCount: 1 }),   // 保留:有租金计费行
      ct({ buildingId: 1, monthlyRent: 20075.48, rentArea: 9263, billingLineCount: 0 }),   // 排除:合同 162 原型
    ]
    const rows = buildPeerRows(cs, phaseOf, '2025-06-01')
    expect(rows).toHaveLength(1)
    expect(rows[0].monthlyRent).toBe(2000)
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
    const opts = eligibleTenants(rows, new Map([[1, 1], [2, 2]]))
    expect(opts.map((o) => o.id)).toEqual([2, 1])
    expect(opts[1].name).toBe('乙公司')
  })
  it('徽章期区取 tenant.phase,不是 row.phase(building.phase)——F4:两者可能不一致' +
    '(查库验过:可盈 tenant.phase=1、其主合同所在楼栋 phase=4)', () => {
    // 乙公司(tenantId=1)行的 row.phase(building.phase)都是 1,tenantPhaseOf 给它 4——钉住取的是后者
    const opts = eligibleTenants(rows, new Map([[1, 4], [2, 2]]))
    expect(opts.find((o) => o.id === 1)?.phase).toBe(4)
  })
  it('tenantPhaseOf 查不到时 phase=null(不是回退 row.phase)', () => {
    const opts = eligibleTenants(rows, new Map([[2, 2]]))   // 故意不给 tenantId=1
    expect(opts.find((o) => o.id === 1)?.phase).toBeNull()
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
  const h = buildUnitRentHist([5, 15, 25, 35, 45], 34)
  const stats: PhaseStats = { n: 5, p10: 6, median: 25, p90: 34 }
  function opt() {
    return unitRentHistOption(h, stats, '鑫皇', 28.11) as {
      series: {
        data: unknown[]
        markArea: { label: { formatter: string } }
        markLine: { data: { label: { formatter: string } }[] }
      }[]
    }
  }
  it('结构:1 个 bar 系列,数据=4 常规档+1 溢出档,4 条 markLine', () => {
    const o = opt()
    expect(o.series).toHaveLength(1)
    expect(o.series[0].data).toHaveLength(5)
    expect(o.series[0].markLine.data).toHaveLength(4)
  })
  // F3(修复轮1):读数句拆分时「80% 的同类在…」与 p10/p90 数字从受门禁的 .ana-read 搬到了图上
  // markArea/markLine 标签——那里没有任何门禁扫,markArea 整段被删/p10/p90 的 formatter 被清空,
  // 上面那条「结构」用例照样绿。钉住标签内容,堵这个静默消失口。
  it('F3:markArea 标签含「80% 的同类在这段」,p10/p90 两条 markLine 的 formatter 等于对应分位数值', () => {
    const o = opt()
    expect(o.series[0].markArea.label.formatter).toBe('80% 的同类在这段')
    const [p10Line, medianLine, p90Line] = o.series[0].markLine.data
    expect(p10Line.label.formatter).toBe(stats.p10.toFixed(1))
    expect(medianLine.label.formatter).toBe('中位 ' + stats.median.toFixed(1))
    expect(p90Line.label.formatter).toBe(stats.p90.toFixed(1))
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

// ── T10「哪些期区能给区间」───────────────────────────────────────────────
describe('phaseTableRowOf / phaseTableRows', () => {
  it('样本 < MIN_SAMPLE:中位数照给,p10/p90 留 null', () => {
    const vals = Array.from({ length: 19 }, (_, i) => i + 1)   // 1..19
    const r = phaseTableRowOf(2, vals)
    expect(r.n).toBe(19)
    expect(r.median).toBeCloseTo(10, 6)
    expect(r.p10).toBeNull()
    expect(r.p90).toBeNull()
  })
  it('样本达标(边界 n=20):p10/中位/p90 都给,与 anaFmt.quantile 同一套线性插值', () => {
    const vals = Array.from({ length: 20 }, (_, i) => i + 1)   // 1..20
    const r = phaseTableRowOf(1, vals)
    expect(r.n).toBe(20)
    expect(r.p10).not.toBeNull()
    expect(r.p90).not.toBeNull()
    expect(r.median).toBeCloseTo(10.5, 6)
  })
  it('n=0:中位数也是 null,不是假装算出 0(quantile 空数组回退 0 的那个 0 不该被当真实中位数)', () => {
    const r = phaseTableRowOf(3, [])
    expect(r.n).toBe(0)
    expect(r.median).toBeNull()
  })
  it('phaseTableRows:按期区分组、按期区升序排列(不依赖入参顺序)', () => {
    const rows: PeerRow[] = [
      { contractId: 1, tenantId: 1, tenantName: 'A', buildingId: 1, phase: 2, rentArea: 100, monthlyRent: 1000, unitRent: 10 },
      { contractId: 2, tenantId: 2, tenantName: 'B', buildingId: 2, phase: 1, rentArea: 100, monthlyRent: 2000, unitRent: 20 },
      { contractId: 3, tenantId: 3, tenantName: 'C', buildingId: 1, phase: 2, rentArea: 100, monthlyRent: 3000, unitRent: 30 },
    ]
    const out = phaseTableRows(rows)
    expect(out.map((r) => r.phase)).toEqual([1, 2])   // 升序,不是入参出现顺序(2 先出现)
    expect(out.find((r) => r.phase === 2)?.n).toBe(2)   // 期区二两份(unitRent 10/30)
  })
})

describe('phaseTableReadout / phaseTableRefText', () => {
  // 与今天(asOf=2026-09-11)查库实测的真实口径同一形状:期区一样本够(51≥20),二/三/四不够(17/1/1)。
  const REAL_ROWS: PhaseTableRow[] = [
    { phase: 1, n: 51, median: 23.0, p10: 14.7, p90: 34.5 },
    { phase: 2, n: 17, median: 18.6, p10: null, p90: null },
    { phase: 3, n: 1, median: 19.9, p10: null, p90: null },
    { phase: 4, n: 1, median: 17.4, p10: null, p90: null },
  ]
  it('数的是「能给区间」(p10 非空)的期区数,不是「有中位数」的期区数——四行都有中位数,答案不能是 4', () => {
    const s = phaseTableReadout(REAL_ROWS)
    expect(s).toContain('4')
    expect(s).toContain('1')
    expect([...s].length).toBeLessThanOrEqual(30)
  })
  it('参照系小字含期间', () => {
    expect(phaseTableRefText('2026-09')).toContain('2026-09')
  })
})

// ── T10「同一招式，用在电费上会翻车」─────────────────────────────────────
const s10 = (tenantName: string, acctMonth: string, elec: number): AnalysisS10Row =>
  ({ acctMonth, phase: 1, tenantId: null, tenantName, elec, water: 0, total: elec })
function s10Map(rows: AnalysisS10Row[]): Map<string, AnalysisS10Row[]> {
  const m = new Map<string, AnalysisS10Row[]>()
  for (const r of rows) m.set(r.tenantName, [...(m.get(r.tenantName) ?? []), r])
  return m
}

describe('latestElecSpread', () => {
  it('取全库最新一期(不是某个租户自己最新的一期)', () => {
    const m = s10Map([s10('甲', '2025-11', 100), s10('乙', '2025-12', 200)])
    expect(latestElecSpread(m)?.period).toBe('2025-12')
  })
  it('同一租户同一期多条求和折叠(镜像 TenantEnergy.logic.ts buildTenantRows 口径)', () => {
    const m = s10Map([s10('甲', '2025-12', 100), s10('甲', '2025-12', 50)])
    const sp = latestElecSpread(m)
    expect(sp?.n).toBe(1)          // 折叠成 1 户,不是 2 条
    expect(sp?.p10).toBe(150)      // 100+50
  })
  it('无 s10 记录 → null', () => {
    expect(latestElecSpread(new Map())).toBeNull()
  })
  it('n/p10/p90/max 与线性插值分位同一套算法', () => {
    const rows = Array.from({ length: 10 }, (_, i) => s10('户' + i, '2025-12', (i + 1) * 10))   // 10,20,...,100
    const sp = latestElecSpread(s10Map(rows))!
    expect(sp.n).toBe(10)
    expect(sp.max).toBe(100)
    expect(sp.p10).toBeCloseTo(19, 6)   // quantile([10..100],0.1) 线性插值
  })
})

describe('elecTrapReadout / elecTrapRefText', () => {
  it('比值 = p90/p10 四舍五入,不是反过来(p10/p90)', () => {
    const spread: ElecSpread = { period: '2025-12', n: 263, p10: 62.62, p90: 11685.75, max: 101645.94 }
    const s = elecTrapReadout(spread)
    expect(s).toContain('187')   // round(11685.75/62.62)=186.6→187,不是 round(62.62/11685.75)
    expect([...(s as string)].length).toBeLessThanOrEqual(30)
  })
  it('p10<=0:比值没有意义,返回 null(不是除零得 Infinity 印上屏)', () => {
    expect(elecTrapReadout({ period: '2025-12', n: 1, p10: 0, p90: 100, max: 100 })).toBeNull()
  })
  it('参照系小字含样本量与期间,≤28 可见字', () => {
    const r = elecTrapRefText({ period: '2025-12', n: 263, p10: 62.62, p90: 11685.75, max: 101645.94 })
    expect(r).toContain('263')
    expect(r).toContain('2025-12')
    expect([...r].length).toBeLessThanOrEqual(28)
  })
})
