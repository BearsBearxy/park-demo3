// expiry.logic 纯函数单测(v2 抽出;统计口径=v1,Pareto 累计占比对全量合计)
import { describe, expect, it } from 'vitest'
import type { ContractDTO } from '@/types/contract'
import {
  buildExpiringSoon, buildExpiryStats, buildExpiryWall, buildPareto, buildRentRoll,
  concentrationOption, lockedRentByMonth, paretoOption, renewalVariance,
  rentRollRefText, rentRollSentence, wallOption,
} from './expiry.logic'

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

describe('合约租金带(FORECAST §1.1)', () => {
  // a1 在 2025-12 在租、2026-09 已到期(保证两个锚点算出不同的锁定线);a2 历史续签命中;
  // a3 历史未续签(active 但早已到期、无后续合同);a4 全程覆盖两个视界,不进抽样池。
  const a1 = ct({ unitId: 1, monthlyRent: 1000, startDate: '2024-01-01', endDate: '2026-01-31' })
  const a2 = ct({ unitId: 2, monthlyRent: 2000, startDate: '2023-01-01', endDate: '2025-06-30', status: 'renewed' })
  const a3 = ct({ unitId: 3, monthlyRent: 1500, startDate: '2023-01-01', endDate: '2025-08-31' })
  const a4 = ct({ unitId: 4, monthlyRent: 3000, startDate: '2025-01-01', endDate: '2099-12-31' })
  const CONTRACTS = [a1, a2, a3, a4]

  it('❗锚点必须显式传入 —— 用真实时钟会算出完全不同的带', () => {
    const a = buildRentRoll(CONTRACTS, '2025-12-01', 12)
    const b = buildRentRoll(CONTRACTS, '2026-09-10', 12)
    expect(a.locked).not.toEqual(b.locked)
  })

  it('❗锁定部分零随机量 —— 画实线,不许套带', () => {
    const r = buildRentRoll(CONTRACTS, '2025-12-01', 12)
    expect(r.lockedBand).toBeUndefined()
  })

  it('❗续签方差两项分开算:逐户金额平方和 + p 本身不准', () => {
    const v = renewalVariance([100, 100, 100], 0.2, 90)
    // 第一项 p(1−p)Σr² = .16 × 30000 = 4800;第二项 Var(p̂)(Σr)² = .001778 × 90000 = 160
    expect(v.byWhichTenants).toBeCloseTo(4800, 0)
    expect(v.byRateUncertainty).toBeCloseTo(160, 0)
  })

  it('❗只用 Wilson 会把带画到三分之一宽 —— 这条断言就是「不能只用 Wilson」的可执行形式', () => {
    const v = renewalVariance([100, 100, 100], 0.2, 90)
    const wilsonOnly = Math.sqrt(v.byRateUncertainty)
    const full = Math.sqrt(v.byWhichTenants + v.byRateUncertainty)
    expect(wilsonOnly / full).toBeLessThan(0.4)
  })

  it('该月整月落在免租区间内 → 不计;区间只盖月中一部分则仍计全额(brief 字面条件,不按天折算)', () => {
    const withFree = ct({ unitId: 10, monthlyRent: 1000, startDate: '2025-01-01', endDate: '2026-01-31', rentFree: [{ start: '2025-06-01', end: '2025-06-30' }] })
    const locked = lockedRentByMonth([withFree], '2025-06-01', 2)   // month0=2025-06(整月免租) / month1=2025-07
    expect(locked[0]).toBe(0)
    expect(locked[1]).toBe(1000)
    const partialFree = ct({ unitId: 11, monthlyRent: 1000, startDate: '2025-01-01', endDate: '2026-01-31', rentFree: [{ start: '2025-06-01', end: '2025-06-15' }] })
    expect(lockedRentByMonth([partialFree], '2025-06-01', 1)[0]).toBe(1000)
  })

  it('同一单元同月多于一份合同(实测园区 2 例):只计 startDate 最新的一份,不许双计', () => {
    const older = ct({ unitId: 9, monthlyRent: 800, startDate: '2024-01-01', endDate: '2026-02-28' })
    const newer = ct({ unitId: 9, monthlyRent: 900, startDate: '2026-01-01', endDate: '2027-01-31' })
    expect(lockedRentByMonth([older, newer], '2026-01-01', 1)[0]).toBe(900)   // 不是 1700
  })

  it('整租(kind=master_lease)不进 locked,单列在 months[].masterLease', () => {
    const master = ct({ unitId: 20, monthlyRent: 5000, startDate: '2020-01-01', endDate: '2099-01-01', kind: 'master_lease' })
    const r = buildRentRoll([master], '2026-01-01', 1)
    expect(r.locked[0]).toBe(0)
    expect(r.months[0].masterLease).toBe(5000)
  })

  it('历史回测分母/命中由 asOf 现算(不是写死的 18/90):状态标记与续签链两种命中路径都算,草稿/整租/未到期都不进分母', () => {
    const byFlag = ct({ endDate: '2025-01-01', status: 'renewed' })              // 命中①:状态标记
    const parent = ct({ endDate: '2025-02-01', status: 'active' })              // 命中②:续签链(状态未同步)
    const child = ct({ startDate: '2025-02-02', parentContractId: parent.id })  // parent 的后续合同
    const miss = ct({ endDate: '2025-03-01', status: 'active' })                // 未续签
    const draft = ct({ endDate: '2025-01-05', status: 'draft' })                // 草稿,不算"已知结果"
    const master = ct({ endDate: '2025-01-05', status: 'active', kind: 'master_lease' })   // 整租,不进分母
    const future = ct({ endDate: '2099-01-01', status: 'active' })              // 还没到期,不进分母
    const r = buildRentRoll([byFlag, parent, child, miss, draft, master, future], '2026-01-01', 1)
    expect(r.renewalN).toBe(3)      // byFlag / parent / miss
    expect(r.renewalHits).toBe(2)   // byFlag / parent
    expect(r.renewalP).toBeCloseTo(2 / 3, 5)
  })

  it('续签区间确定性可重放(种子固定,不是 Math.random —— 同一份数据两次调用逐字节相同)', () => {
    // 池子刻意做大做杂(10 份、各不相同的月租、分摊在 6 个月各自到期):
    // 只用 1~2 份合同时,10~90 分位落在"非0即整份租金"两档,换成 Math.random 也大概率巧合撞上同一档,
    // 测不出问题 —— 这是本次实现时踩过的坑,数量/金额都要够杂,分位数才会对随机源敏感。
    const decided = [...Array(10)].map((_, i) => ct({ endDate: '2025-01-01', status: i < 5 ? 'renewed' : 'active' }))
    const pool = [...Array(10)].map((_, i) => ct({ endDate: `2026-0${(i % 6) + 1}-15`, monthlyRent: (i + 1) * 137, unitId: 100 + i }))
    const cs = [...decided, ...pool]
    const r1 = buildRentRoll(cs, '2026-01-01', 6)
    const r2 = buildRentRoll(cs, '2026-01-01', 6)
    expect(r1.months.map((m) => m.renewalLo)).toEqual(r2.months.map((m) => m.renewalLo))
    expect(r1.months.map((m) => m.renewalHi)).toEqual(r2.months.map((m) => m.renewalHi))
  })

  it('抽样池为空(所有合同全程覆盖视界或已决出)→ 续签区间恒为 0,不是凭空给宽度', () => {
    const alwaysLocked = ct({ startDate: '2020-01-01', endDate: '2099-01-01', status: 'active' })
    const r = buildRentRoll([alwaysLocked], '2026-01-01', 6)
    expect(r.months.every((m) => m.renewalLo === 0 && m.renewalHi === 0)).toBe(true)
  })

  it('抽样池非空时上下界不重合(真的在抽样,不是常数占位)', () => {
    const cs = [
      ct({ endDate: '2025-06-01', status: 'renewed' }),
      ct({ endDate: '2025-07-01', status: 'active' }),
      ct({ endDate: '2026-03-01', status: 'active', monthlyRent: 5000, unitId: 20 }),
    ]
    const r = buildRentRoll(cs, '2026-01-01', 6)
    expect(r.renewalN).toBe(2)
    const last = r.months[r.months.length - 1]
    expect(last.renewalHi).toBeGreaterThan(0)
    expect(last.renewalHi).toBeGreaterThanOrEqual(last.renewalLo)
  })
})

describe('rentRollSentence / rentRollRefText(D1 可执行形式:样本量与命中数同屏)', () => {
  it('回测样本 < 5 → 闭嘴(sFreq 自带的 D1 对称规矩)', () => {
    const cs = [ct({ endDate: '2025-01-01', status: 'renewed' })]
    const r = buildRentRoll(cs, '2026-01-01', 3)
    expect(rentRollSentence(r)).toBeNull()
  })

  it('回测样本 ≥ 5 → 出句,含样本量与命中数,不写百分比,≤30 可见字', () => {
    const cs = [...Array(5)].map((_, i) => ct({ endDate: '2025-01-01', status: i < 2 ? 'renewed' : 'active' }))
    const r = buildRentRoll(cs, '2026-01-01', 3)
    const s = rentRollSentence(r)
    expect(s).not.toBeNull()
    expect(s).toContain(`过去 ${r.renewalN} 次中 ${r.renewalHits} 次`)
    expect(s).not.toMatch(/%/)
    expect([...(s as string)].length).toBeLessThanOrEqual(30)
  })

  it('rentRollRefText:口径 + 单位 + 回测分母', () => {
    const r = buildRentRoll([], '2026-01-01', 1)
    expect(rentRollRefText(r)).toBe('月度口径 · 万元 · 回测样本0份')
  })
})
