// expiry.logic 纯函数单测(v2 抽出;统计口径=v1,Pareto 累计占比对全量合计)
import { describe, expect, it } from 'vitest'
import type { ContractDTO } from '@/types/contract'
import {
  buildExpiringSoon, buildExpiryStats, buildExpiryWall, buildPareto, buildRentRoll,
  concentrationOption, lockedCountByMonth, lockedRentByMonth, nearestGap, paretoOption, renewalVariance,
  rentRollOption, rentRollRefText, rentRollSentence, simulateRenewalDraws, wallOption,
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

  // T4(design-boards):「未来12月到期」瓦读 byExpMonth 的桶,不是原始 pool——a4(2099-12-31 到期)
  // 落进 pool(仍在租、无后继),但视界 12 个月里没有一个月的月末晚于它,ek<mb.endKey 对每个月
  // 都不成立,永远进不了任何一个桶。若瓦直接数 pool.length 会把 a1/a4 都算成"到期",多算一份。
  it('❗T4:expiringCount/expiringRentSum 只数真的落进桶的合同,覆盖到视界外的(a4)不算"到期"', () => {
    const r = buildRentRoll(CONTRACTS, '2025-12-01', 12)
    // 池子里有 a1(2026-01-31 到期,落进桶)和 a4(2099-12-31 到期,视界内全程锁定,不进任何桶)。
    expect(r.expiringCount).toBe(1)
    expect(r.expiringRentSum).toBe(1000)   // 只有 a1 的月租
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

  // T4(design-boards,对抗复查):coveringMonth 的在租判据从白名单{active,renewed}改成黑名单
  // {draft,expired,terminated}——白名单会把 status='expiring'/'future' 的合同整个滤掉,而这两个
  // 都是后端 effectiveStatus 派生出的"仍在租"展示态细分(实测 live API:23 份 expiring¥37.8万/月、
  // 27 份 future¥76.6万/月),不是"不在租"。
  it('❗T4:status=expiring(签的是 active,只是快到期)算在租,不是"不认识的状态就滤掉"', () => {
    const c = ct({ monthlyRent: 1000, startDate: '2020-01-01', endDate: '2026-03-01', status: 'expiring' })
    expect(lockedRentByMonth([c], '2026-01-01', 1)[0]).toBe(1000)
  })

  it('❗T4:status=future(签的是 active,只是还没起租)—— 起租前不算在租,起租后照算,判据落在日期不落在状态', () => {
    const c = ct({ monthlyRent: 1000, startDate: '2026-03-01', endDate: '2027-01-01', status: 'future' })
    const locked = lockedRentByMonth([c], '2026-01-01', 4)
    expect(locked).toEqual([0, 0, 1000, 1000])   // 1/2 月还没到 3/1,3 月起才覆盖月末
  })

  it('❗T4:draft/expired/terminated 三个终态仍然不算在租(黑名单没有把它们放进来)', () => {
    for (const status of ['draft', 'expired', 'terminated']) {
      const c = ct({ monthlyRent: 1000, startDate: '2020-01-01', endDate: '2099-01-01', status })
      expect(lockedRentByMonth([c], '2026-01-01', 1)[0], `status=${status} 不该算在租`).toBe(0)
    }
  })

  // F1(修复轮1,design-boards 对抗复查):把"黑名单比白名单多认多少"这个数钉成断言,免得文件顶部
  // 注释里的百分比又变成一句没人核过的散文。同一批合同,四个覆盖当月的桶(active/renewed 落
  // 白名单,expiring/future 只落黑名单)+ 三个两边都不算的终态(draft/expired/terminated)。
  // 用精确金额断言(不是 >= 或 toBeGreaterThan)是故意的:一条方向写反的比例断言("黑名单不小于
  // 白名单")在数字错一倍时也可能照样绿。
  it('❗F1:黑名单比白名单多认 expiring+future,做小比例钉住(不是松散的 >= 断言)', () => {
    const cs = [
      ct({ monthlyRent: 1000, startDate: '2020-01-01', endDate: '2026-06-30', status: 'active' }),
      ct({ monthlyRent: 200, startDate: '2020-01-01', endDate: '2026-06-30', status: 'renewed' }),
      ct({ monthlyRent: 300, startDate: '2020-01-01', endDate: '2026-02-15', status: 'expiring' }),
      ct({ monthlyRent: 400, startDate: '2025-12-01', endDate: '2026-06-30', status: 'future' }),
      ct({ monthlyRent: 999, startDate: '2020-01-01', endDate: '2026-06-30', status: 'draft' }),
      ct({ monthlyRent: 999, startDate: '2020-01-01', endDate: '2026-06-30', status: 'expired' }),
      ct({ monthlyRent: 999, startDate: '2020-01-01', endDate: '2026-06-30', status: 'terminated' }),
    ]
    const denylistSum = lockedRentByMonth(cs, '2026-01-01', 1)[0]
    expect(denylistSum).toBe(1900)   // 1000+200+300+400,draft/expired/terminated 排除在外
    const whitelistSum = 1000 + 200   // 旧口径:只认 active/renewed,同一批合同手算(不是重新实现旧滤镜)
    expect(whitelistSum).toBe(1200)
    // 做小比例:相对黑名单(当前/正确口径)15.1% 这条真实数字的合成版本 —— 这里刻意选另一组数,
    // 逼近但不等于生产的 15.1%/17.8%,免得断言看起来像是从生产数字倒推出来的巧合。
    expect((denylistSum - whitelistSum) / denylistSum).toBeCloseTo(700 / 1900, 5)   // ≈36.8%,相对黑名单
    expect((denylistSum - whitelistSum) / whitelistSum).toBeCloseTo(700 / 1200, 5)  // ≈58.3%,相对白名单
  })

  it('❗T4:status=expiring 的合同也进续签抽样池 —— 它离到期最近,最该被建模"续不续得上"', () => {
    const c = ct({ monthlyRent: 1000, startDate: '2020-01-01', endDate: '2026-02-15', status: 'expiring' })
    const r = buildRentRoll([c], '2026-01-01', 3)
    const idx = r.months.findIndex((m) => m.month === '2026-02')
    expect(r.months[idx].renewalHi).toBeGreaterThan(0)   // 落进了抽样池,续签区间不是恒零
  })

  it('F6:同一单元同月多于一份合同 —— 都计入,不假设是重复行(实测单元 455:两个不同租户并行租约)', () => {
    const tenantA = ct({ unitId: 9, monthlyRent: 800, startDate: '2024-01-01', endDate: '2026-02-28' })
    const tenantB = ct({ unitId: 9, monthlyRent: 900, startDate: '2026-01-01', endDate: '2027-01-31' })
    expect(lockedRentByMonth([tenantA, tenantB], '2026-01-01', 1)[0]).toBe(1700)   // 不再是 900(去重时的旧值)
  })

  // T4(design-boards):「当前合约租金」瓦的「N 份在租」读这个函数,判据必须与锁定金额逐字一致——
  // 否则金额和份数会各自代表不同的合同集合,读者拿两个数一除会得出一个假的"户均租金"。
  it('T4:lockedCountByMonth 与 lockedRentByMonth 同一判据,只换成计数', () => {
    const tenantA = ct({ unitId: 9, monthlyRent: 800, startDate: '2024-01-01', endDate: '2026-02-28' })
    const tenantB = ct({ unitId: 9, monthlyRent: 900, startDate: '2026-01-01', endDate: '2027-01-31' })
    expect(lockedCountByMonth([tenantA, tenantB], '2026-01-01', 1)[0]).toBe(2)
    // 已到期的不算在租
    const gone = ct({ monthlyRent: 500, startDate: '2020-01-01', endDate: '2025-12-31' })
    expect(lockedCountByMonth([tenantA, tenantB, gone], '2026-01-01', 1)[0]).toBe(2)
  })

  it('F6 前提守卫:同一租户在同一单元上有两份合同同时覆盖同一个月末 —— 当场报错,不许悄悄多算', () => {
    const dup1 = ct({ unitId: 61, tenantId: 999, monthlyRent: 1000, startDate: '2024-01-01', endDate: '2026-06-30' })
    const dup2 = ct({ unitId: 61, tenantId: 999, monthlyRent: 1200, startDate: '2024-06-01', endDate: '2026-12-31' })
    expect(() => lockedRentByMonth([dup1, dup2], '2026-01-01', 6)).toThrow(/同一单元|前提被打破/)
  })

  it('整租(kind=master_lease)不进 locked,单列在 months[].masterLease', () => {
    const master = ct({ unitId: 20, monthlyRent: 5000, startDate: '2020-01-01', endDate: '2099-01-01', kind: 'master_lease' })
    const r = buildRentRoll([master], '2026-01-01', 1)
    expect(r.locked[0]).toBe(0)
    expect(r.months[0].masterLease).toBe(5000)
  })

  it('F6:masterLeaseByMonth 同一单元同月多于一份整租合同 —— 都计入(不再去重,理由同 lockedRentByMonth)', () => {
    const tenantA = ct({ unitId: 40, monthlyRent: 5000, startDate: '2020-01-01', endDate: '2099-01-01', kind: 'master_lease' })
    const tenantB = ct({ unitId: 40, monthlyRent: 6000, startDate: '2026-01-01', endDate: '2099-01-01', kind: 'master_lease' })
    const r = buildRentRoll([tenantA, tenantB], '2026-01-01', 1)
    expect(r.months[0].masterLease).toBe(11000)   // 不再是去重后的 6000
  })

  it('F6:pool 同一单元同月多于一份合同 —— 都计入抽样池,不假设是重复行', () => {
    const tenantA = ct({ unitId: 30, monthlyRent: 1000, startDate: '2024-01-01', endDate: '2026-05-15', status: 'active' })
    const tenantB = ct({ unitId: 30, monthlyRent: 1200, startDate: '2026-01-01', endDate: '2026-05-15', status: 'active' })
    const r = buildRentRoll([tenantA, tenantB], '2026-01-01', 6)
    const idx = r.months.findIndex((m) => m.month === '2026-05')
    // 不去重:两份合同都进抽样池,和能顶到 2200(两个都命中)—— 去重版本这里断言过 ≤1200,
    // 现在两份都保留,只要求上界能超过旧的 1200 上限(具体数受蒙特卡洛种子影响,不钉死等于 2200)。
    expect(r.months[idx].renewalHi).toBeGreaterThan(1200)
  })

  it('F4:decided 故意不去重 —— 同一单元先后两段历史租约是两次独立的续签结果,不是重复数据', () => {
    const first = ct({ id: 510, unitId: 50, monthlyRent: 800, startDate: '2018-01-01', endDate: '2020-12-31', status: 'renewed' })
    const firstNext = ct({ unitId: 50, monthlyRent: 850, startDate: '2021-01-01', parentContractId: 510, linkType: 'renew' })
    const second = ct({ unitId: 50, monthlyRent: 900, startDate: '2021-01-01', endDate: '2023-12-31', status: 'active' })
    const r = buildRentRoll([first, firstNext, second], '2026-01-01', 1)
    expect(r.renewalN).toBe(2)      // 两段历史都算,不因同一单元被 dedup 掉(firstNext 未到期,不进分母)
    expect(r.renewalHits).toBe(1)   // 只有 first 命中(后继 linkType=renew)
  })

  // ── C1(对抗复查):递增段 ≠ 续签换约 ──────────────────────────────────────────
  // 这两条是这条缺陷活下来的原因:改前全部 fixture 都没设过 linkType,于是「后继 = 续签」
  // 这个错口径在 fixture 里和正确口径长得一模一样,十几轮复查一条断言都碰不到它。
  it('❗C1:后继是递增段(linkType=escalation)的,既不算续签命中,本身也不进分母 —— 它只是同一份租约的上一个价格档', () => {
    // 一份租约拆成两个价格档:tier1 → tier2(escalation),tier2 到期后没人续。
    const tier1 = ct({ id: 601, unitId: 60, monthlyRent: 1000, startDate: '2023-01-01', endDate: '2023-12-31', status: 'renewed' })
    const tier2 = ct({ id: 602, unitId: 60, monthlyRent: 1100, startDate: '2024-01-01', endDate: '2024-12-31', status: 'active', parentContractId: 601, linkType: 'escalation' })
    const r = buildRentRoll([tier1, tier2], '2026-01-01', 1)
    // 改前:分母 2(两个档各算一次到期)、命中 2(tier1 有后继 + status=renewed,tier2 status 也曾被算)
    expect(r.renewalN).toBe(1)      // 折成一份租约:只有末档 tier2 是一次真到期
    expect(r.renewalHits).toBe(0)   // 换价格档不是续签
    expect(r.renewalP).toBe(0)
  })

  it('❗C1:同一条链上递增段在前、真续签在后 —— 只有末档进分母,且它算一次命中', () => {
    const tier1 = ct({ id: 701, monthlyRent: 1000, endDate: '2023-12-31', status: 'renewed' })
    const tier2 = ct({ id: 702, monthlyRent: 1100, endDate: '2024-12-31', status: 'renewed', parentContractId: 701, linkType: 'escalation' })
    const renew = ct({ id: 703, monthlyRent: 1200, startDate: '2025-01-01', endDate: '2025-12-31', status: 'active', parentContractId: 702, linkType: 'renew' })
    const r = buildRentRoll([tier1, tier2, renew], '2026-01-01', 1)
    expect(r.renewalN).toBe(2)      // tier2(末档,已到期)+ renew(也已到期,自己没再续)
    expect(r.renewalHits).toBe(1)   // 只有 tier2 命中;tier1 是中间价格档,根本不在分母里
    expect(r.renewalP).toBeCloseTo(0.5, 5)
  })

  it('❗C1:status=renewed 不再是命中路径 —— 拆链脚本给中间价格档也打这个状态(SPEC §1「中间档 status=renewed」)', () => {
    // 有 renewed 状态、有后继,但后继是递增段:改前这条两条路径都判命中,改后一条都不算。
    const mid = ct({ id: 801, endDate: '2024-06-30', status: 'renewed' })
    const tier = ct({ id: 802, endDate: '2025-06-30', status: 'active', parentContractId: 801, linkType: 'escalation' })
    // 另一份:只有状态标记、没有任何后继(实测库里 0 条,但状态字段本身不该再被当判据)
    const flagOnly = ct({ endDate: '2024-08-31', status: 'renewed' })
    const r = buildRentRoll([mid, tier, flagOnly], '2026-01-01', 1)
    expect(r.renewalN).toBe(2)      // tier(末档)+ flagOnly
    expect(r.renewalHits).toBe(0)   // 一条都不算续签
  })

  it('❗C1:后继的 linkType 不是 renew(缺失 / new / 以后新增的类型)一律不算命中 —— 判据是「链上写着这是续签」,不是「有后继」', () => {
    // 折链之后,末档身上剩下的后继在今天的库里只可能是 renew,所以光看「有没有后继」也能算对 ——
    // 这条断言钉的是**判据本身**:数据一旦脏(老行没回填 link_type、以后加了新的链接类型),
    // 「有后继就算续签」会立刻把它们当成续签,而这正是 C1 的原样重演。
    const a = ct({ id: 851, endDate: '2024-01-31', status: 'active' })
    const aNext = ct({ startDate: '2024-02-01', parentContractId: 851 })                    // linkType 缺失(老数据行)
    const b = ct({ id: 861, endDate: '2024-02-29', status: 'active' })
    const bNext = ct({ startDate: '2024-03-01', parentContractId: 861, linkType: 'new' })   // 链指针在、但不是续签
    const r = buildRentRoll([a, aNext, b, bNext], '2026-01-01', 1)
    expect(r.renewalN).toBe(2)
    expect(r.renewalHits).toBe(0)
  })

  it('历史回测分母/命中由 asOf 现算(不是写死的 18/90):命中只认 linkType=renew 的后继,草稿/整租/未到期都不进分母', () => {
    const parent = ct({ id: 301, endDate: '2025-02-01', status: 'active' })     // 命中:续签链落地(状态未同步也算)
    const child = ct({ startDate: '2025-02-02', parentContractId: 301, linkType: 'renew' })
    const miss = ct({ endDate: '2025-03-01', status: 'active' })                // 未续签
    const draft = ct({ endDate: '2025-01-05', status: 'draft' })                // 草稿,不算"已知结果"
    const master = ct({ endDate: '2025-01-05', status: 'active', kind: 'master_lease' })   // 整租,不进分母
    const future = ct({ endDate: '2099-01-01', status: 'active' })              // 还没到期,不进分母
    const r = buildRentRoll([parent, child, miss, draft, master, future], '2026-01-01', 1)
    expect(r.renewalN).toBe(2)      // parent / miss(child 无 endDate,不进分母)
    expect(r.renewalHits).toBe(1)   // parent
    expect(r.renewalP).toBeCloseTo(0.5, 5)
  })

  it('❗C1:续签率直接决定带的上沿 —— 把递增段当续签会把上沿抬高一大截(这是屏上那条带唯一的不确定性来源)', () => {
    // 照着实测库的形状造:16 份租约各被拆成两个价格档、4 份租约真的换约续了租。
    //   正确口径:分母 20 份租约(16 个末档 + 4 份续了的),命中 4 → p = 0.20
    //   把递增当续签:分母 36 个合同行(16×2 + 4),命中 20(16 个首档 + 4 份) → p ≈ 0.56
    // 同一个未来到期池,两种口径画出来的上沿必须差出一截。
    const tiers = [...Array(16)].flatMap((_, i) => {
      const t1 = ct({ id: 2000 + i * 2, endDate: '2024-06-30', status: 'renewed' })
      const t2 = ct({ id: 2001 + i * 2, endDate: '2025-06-30', status: 'active', parentContractId: t1.id, linkType: 'escalation' })
      return [t1, t2]
    })
    const renewed = [...Array(4)].flatMap((_, i) => {
      const p = ct({ id: 2100 + i * 2, endDate: '2024-09-30', status: 'renewed' })
      return [p, ct({ id: 2101 + i * 2, startDate: '2024-10-01', parentContractId: p.id, linkType: 'renew' })]
    })
    // 未来池:10 份等额合同都在 2026-02 到期(上沿 = 其中能续下来多少份)
    const pool = [...Array(10)].map(() => ct({ monthlyRent: 10000, startDate: '2025-06-01', endDate: '2026-01-31', status: 'active' }))
    const cs = [...tiers, ...renewed, ...pool]
    const r = buildRentRoll(cs, '2026-01-01', 2)
    expect(r.renewalN).toBe(20)
    expect(r.renewalHits).toBe(4)
    // 对照组:把 escalation 全改标成 renew(= 改前那套「有后继就算续签」的口径)
    const wrong = buildRentRoll(
      cs.map((c) => (c.linkType === 'escalation' ? { ...c, linkType: 'renew' as const } : c)), '2026-01-01', 2)
    expect(wrong.renewalN).toBe(36)
    expect(wrong.renewalHits).toBe(20)
    expect(r.months[1].renewalHi).toBeLessThan(wrong.months[1].renewalHi)
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
    // T4:renewalMid(「预计」中线)与 Lo/Hi 同一批抽样,池空则连中线也该是 0,不是漏了没算。
    expect(r.months.every((m) => m.renewalLo === 0 && m.renewalMid === 0 && m.renewalHi === 0)).toBe(true)
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
    // T4:中线必须落在 [Lo, Hi] 之间 —— 三者是同一批 drawSums 的三个分位,顺序钉死。
    expect(last.renewalMid).toBeGreaterThanOrEqual(last.renewalLo)
    expect(last.renewalMid).toBeLessThanOrEqual(last.renewalHi)
  })

  // T4:上面那条池子只有 1 份合同,分布退化成二值(0 或全额),中线经常跟上/下界之一重合,
  // 掩盖不了"quantile 分位取错、三者恒相等"这类缺陷。这里换一个够杂的池子(10 份不同金额、
  // 同一个月到期),专门钉「中线是真的居中,不是常数或误取了 Lo/Hi 本身」。
  it('T4:续签池够杂时,50 分位中线真的落在 10/90 分位之间(不是与某一端重合)', () => {
    const decided = [...Array(10)].flatMap((_, i) => {
      const parent = ct({ id: 9000 + i, endDate: '2025-01-01', status: i < 5 ? 'renewed' : 'active' })
      return i < 5 ? [parent, ct({ startDate: '2025-01-02', parentContractId: parent.id, linkType: 'renew' })] : [parent]
    })
    const pool = [...Array(10)].map((_, i) => ct({ endDate: '2026-06-15', monthlyRent: (i + 1) * 137, unitId: 300 + i }))
    const r = buildRentRoll([...decided, ...pool], '2026-01-01', 6)
    expect(r.renewalN).toBe(10)
    expect(r.renewalHits).toBe(5)
    const last = r.months[r.months.length - 1]
    expect(last.renewalLo).toBeLessThan(last.renewalMid)
    expect(last.renewalMid).toBeLessThan(last.renewalHi)
  })

  it('F8:endDate 恰好等于视界最后一个月月末 —— 整个视界都算 locked,不进续签池(不是漏算)', () => {
    // asOf=2026-01-01,n=3 → 视界 2026-01/02/03,最后一月月末=2026-03-31,与合同 endDate 精确相等。
    const c = ct({ unitId: 70, monthlyRent: 1000, startDate: '2020-01-01', endDate: '2026-03-31', status: 'active' })
    const r = buildRentRoll([c], '2026-01-01', 3)
    expect(r.locked).toEqual([1000, 1000, 1000])   // 三个月都锁定,包括最后一月
    expect(r.months.every((m) => m.renewalLo === 0 && m.renewalMid === 0 && m.renewalHi === 0)).toBe(true)   // 没有落进任何续签桶
  })

  // F10(修复轮3):已有后继合同的那份不进续签池 —— 它的续签结果已经发生了,后继就是那个结果。
  // 交接重叠期(实测单元 418 的 296→424 重叠 10 天)取 asOf 落在重叠窗口里,是这条判据的用武之地:
  // 不排除的话,同一段租约会以两份合同的身份进池,被当成两次独立的伯努利。
  it('F10:已有后继合同的不进续签池 —— 续签结果已知,不该再当一次待掷的骰子', () => {
    const old = ct({ id: 900, unitId: 80, tenantId: 5, monthlyRent: 1000, startDate: '2020-01-01', endDate: '2026-02-14', status: 'renewed' })
    const next = ct({ id: 901, unitId: 80, tenantId: 5, monthlyRent: 1000, startDate: '2026-02-04', endDate: '2026-03-31', parentContractId: 900 })
    // asOf 落在两份合同的重叠窗口内(2026-02-04..2026-02-14),两份的 endDate 都 ≥ asOf。
    const r = buildRentRoll([old, next], '2026-02-10', 2)
    // 池里只该有 next 一份:old 的续签已经兑现成 next,不是待定问题。
    // 若 old 也进池,它会在 2026-02 桶里再添一份 1000 的不确定性,末月上界随之变高。
    const two = buildRentRoll([old, { ...next, parentContractId: null }], '2026-02-10', 2)
    expect(r.months[0].renewalHi).toBeLessThan(two.months[0].renewalHi)
  })
})

// T4/T5(design-boards):「最近的缺口」瓦 + 图上缺口标注共用同一个值。
describe('nearestGap(T4/T5,design-boards):最近一次到期造成的锁定线下跌', () => {
  it('找到最早出现下跌的月份,把拉低它的合同按月租降序列出(1 份到期的简单情形)', () => {
    const big = ct({ tenantName: '大户', monthlyRent: 1200, startDate: '2020-01-01', endDate: '2099-12-31' })
    const small = ct({ tenantName: '小户', monthlyRent: 800, startDate: '2020-01-01', endDate: '2026-02-15' })
    const cs = [big, small]
    const locked = lockedRentByMonth(cs, '2026-01-01', 4)
    expect(locked).toEqual([2000, 1200, 1200, 1200])   // 小户 2/15 到期,2 月起不再覆盖月末
    const gap = nearestGap(cs, '2026-01-01', locked)
    expect(gap).not.toBeNull()
    expect(gap!.monthsAway).toBe(1)
    expect(gap!.count).toBe(1)
    expect(gap!.totalRentSum).toBe(800)
    expect(gap!.names).toEqual(['小户'])
  })

  it('多份合同同一次到期造成同一次下跌 —— names 只取月租前两名,count/totalRentSum 给真实总数', () => {
    const big = ct({ tenantName: '力灏', monthlyRent: 3610, startDate: '2020-01-01', endDate: '2099-12-31' })
    const c1 = ct({ tenantName: '开利暖通', monthlyRent: 2060, startDate: '2020-01-01', endDate: '2026-01-31' })
    const c2 = ct({ tenantName: '丙户', monthlyRent: 500, startDate: '2020-01-01', endDate: '2026-01-31' })
    const c3 = ct({ tenantName: '丁户', monthlyRent: 300, startDate: '2020-01-01', endDate: '2026-01-31' })
    const cs = [big, c1, c2, c3]
    const locked = lockedRentByMonth(cs, '2026-01-01', 3)
    const gap = nearestGap(cs, '2026-01-01', locked)
    expect(gap).not.toBeNull()
    expect(gap!.monthsAway).toBe(1)
    expect(gap!.count).toBe(3)
    expect(gap!.names).toEqual(['开利暖通', '丙户'])   // 降序取前两名,力灏没到期不该出现
    expect(gap!.totalRentSum).toBe(2060 + 500 + 300)
  })

  it('锁定线全程持平或上涨(无到期造成的下跌)→ 没有缺口,不是凭空报一个', () => {
    const c = ct({ monthlyRent: 1000, startDate: '2020-01-01', endDate: '2099-12-31' })
    const locked = lockedRentByMonth([c], '2026-01-01', 6)
    expect(nearestGap([c], '2026-01-01', locked)).toBeNull()
  })

  it('下跌若是整月免租退出造成的(不是到期)—— 不算缺口,继续找下一个真正的到期', () => {
    const c = ct({ monthlyRent: 1000, startDate: '2020-01-01', endDate: '2099-12-31', rentFree: [{ start: '2026-02-01', end: '2026-02-28' }] })
    const locked = lockedRentByMonth([c], '2026-01-01', 3)
    expect(locked).toEqual([1000, 0, 1000])   // 2 月整月免租,锁定线跌到 0,3 月恢复
    expect(nearestGap([c], '2026-01-01', locked)).toBeNull()   // 这份合同压根没到期,不该被当成"缺口"
  })
})

// F3(修复轮1,design-boards 对抗复查):T5 真正的交付物(图例四项、预测起点竖线、缺口标注、
// 新的散点与线系列)之前一层测试都没读过它的返回值——挂载测里 AnaEChart 是打桩的,没有一条
// findComponent(...).props('option')。这里直接单测 rentRollOption() 的返回对象,不经挂载。
describe('rentRollOption(T4/T5,design-boards):图上的家具(图例/预测起点线/缺口标注)钉断言', () => {
  const a1 = ct({ unitId: 1, monthlyRent: 1000, startDate: '2024-01-01', endDate: '2026-01-31' })

  it('❗F4:图例四项且顺序照稿——已实现/预计/80%区间/已锁定', () => {
    const r = buildRentRoll([a1], '2025-12-01', 12)
    const opt = rentRollOption(r) as { legend: { data: string[] } }
    expect(opt.legend.data).toEqual(['已实现', '预计', '80%区间', '已锁定'])
  })

  it('❗已锁定是 step line,markLine 钉在第 0 月(xAxis:0),标签值=锁定线第 0 项', () => {
    const r = buildRentRoll([a1], '2025-12-01', 12)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opt = rentRollOption(r) as any
    const locked = opt.series.find((s: { name: string }) => s.name === '已锁定')
    expect(locked.type).toBe('line')
    expect(locked.step).toBe('end')
    expect(locked.markLine.data).toEqual([{ xAxis: 0 }])
    expect(locked.markLine.label.formatter).toContain('预测起点')
    expect(locked.markLine.label.formatter).toContain(String(locked.data[0]))
  })

  it('❗已实现是只有第 0 月一个值的 scatter(其余月份为 null),不是隐藏线的 line', () => {
    const r = buildRentRoll([a1], '2025-12-01', 12)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opt = rentRollOption(r) as any
    const realized = opt.series.find((s: { name: string }) => s.name === '已实现')
    expect(realized.type).toBe('scatter')
    expect(realized.data[0]).not.toBeNull()
    expect(realized.data.slice(1).every((v: unknown) => v === null)).toBe(true)
  })

  it('❗预计是虚线 line,值=(locked+renewalMid)折万,与第 0 月 KPI 瓦同一份计算', () => {
    const r = buildRentRoll([a1], '2025-12-01', 12)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opt = rentRollOption(r) as any
    const mid = opt.series.find((s: { name: string }) => s.name === '预计')
    expect(mid.type).toBe('line')
    expect(mid.lineStyle.type).toBe('dashed')
    expect(mid.data[0]).toBeCloseTo((r.months[0].locked + r.months[0].renewalMid) / 10000, 2)
  })

  it('❗80%区间是 bandSeries 出的两条 line(空名的下界 + 具名的宽度,带 areaStyle)', () => {
    const r = buildRentRoll([a1], '2025-12-01', 12)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opt = rentRollOption(r) as any
    const names = opt.series.map((s: { name: string }) => s.name)
    expect(names.filter((n: string) => n === '80%区间')).toHaveLength(1)   // 具名的那一条只有一条
    expect(names.filter((n: string) => n === '')).toHaveLength(1)          // 无名的下界那一条
    const band = opt.series.find((s: { name: string }) => s.name === '80%区间')
    expect(band.type).toBe('line')
    expect(band.areaStyle).toBeTruthy()
  })

  it('❗有缺口时 markPoint 落在 gap.monthsAway,坐标与「最近的缺口」瓦读同一份 gap;无缺口时不出现', () => {
    const big = ct({ tenantName: '大户', monthlyRent: 1200, startDate: '2020-01-01', endDate: '2099-12-31' })
    const small = ct({ tenantName: '小户', monthlyRent: 800, startDate: '2020-01-01', endDate: '2026-02-15' })
    const withGap = buildRentRoll([big, small], '2026-01-01', 4)
    expect(withGap.gap).not.toBeNull()   // 复用 nearestGap 那条已验证过的 fixture(1 月后,小户 800)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optWithGap = rentRollOption(withGap) as any
    const lockedWithGap = optWithGap.series.find((s: { name: string }) => s.name === '已锁定')
    expect(lockedWithGap.markPoint).toBeTruthy()
    expect(lockedWithGap.markPoint.data).toEqual([
      { coord: [withGap.gap!.monthsAway, +((withGap.months[withGap.gap!.monthsAway].locked) / 10000).toFixed(2)] },
    ])
    expect(lockedWithGap.markPoint.label.formatter).toContain('小户')

    const noGapContract = ct({ monthlyRent: 1000, startDate: '2020-01-01', endDate: '2099-12-31' })
    const withoutGap = buildRentRoll([noGapContract], '2026-01-01', 6)
    expect(withoutGap.gap).toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optNoGap = rentRollOption(withoutGap) as any
    const lockedNoGap = optNoGap.series.find((s: { name: string }) => s.name === '已锁定')
    expect(lockedNoGap.markPoint).toBeUndefined()
  })
})

describe('rentRollSentence / rentRollRefText(F1 修复轮1:句子只说区间,n/hits 按真实身份搬进小字)', () => {
  it('句子只说区间,不再暗示任何历史战绩(小样本也照样出句,不再有 sFreq 那道<5 闭嘴口)', () => {
    const cs = [ct({ endDate: '2025-01-01', status: 'renewed' })]
    const r = buildRentRoll(cs, '2026-01-01', 3)
    const s = rentRollSentence(r)
    expect(s).not.toBeNull()
    expect(s).not.toMatch(/过去|次中|次/)   // 不再是「过去N次中k次」那句战绩
    expect(s).not.toMatch(/%/)
    expect([...(s as string)].length).toBeLessThanOrEqual(30)
  })

  // 措辞本身钉一条:上面几条只查「不含什么」,删掉整句话也照样全绿。
  it('句子原文:说「预计」不说「拟合」—— 这条带不是回归拟合的', () => {
    const cs = [ct({ startDate: '2025-01-01', endDate: '2027-01-01', monthlyRent: 100000 })]
    const r = buildRentRoll(cs, '2026-01-01', 1)
    expect(rentRollSentence(r)).toBe('末月租金预计 10~10')
    expect(rentRollSentence(r)).not.toMatch(/拟合/)
  })

  it('rentRollRefText:口径 + 单位 + 续签统计,按真实身份标注(不叫"回测样本")', () => {
    const r = buildRentRoll([], '2026-01-01', 1)
    expect(rentRollRefText(r)).toBe('月度口径 · 万元 · 过去0份到期中0份续签')
  })

  it('rentRollRefText:n 与 hits 同屏可见(D1),≤28 可见字', () => {
    const cs = [...Array(5)].map((_, i) => ct({ endDate: '2025-01-01', status: i < 2 ? 'renewed' : 'active' }))
    const r = buildRentRoll(cs, '2026-01-01', 3)
    const ref = rentRollRefText(r)
    expect(ref).toBe(`月度口径 · 万元 · 过去${r.renewalN}份到期中${r.renewalHits}份续签`)
    expect([...ref].length).toBeLessThanOrEqual(28)
  })
})

describe('F3(修复轮1):蒙特卡洛的实际离散度要与 renewalVariance 闭式解绑在一起验', () => {
  // k=20 份等额续签合同、历史回测 n=20/hits=4(p=0.2):选这组数是为了让两项方差刻意五五开
  // (byWhichTenants=byRateUncertainty=3,200,000)—— 这样如果有人把第二项弄丢,总方差会砍半,
  // 而不是砍掉几个百分点,断言才有真实的区分力(而不是容差随便设都能过)。
  const rents = Array(20).fill(1000)
  const n = 20, hits = 4
  const a = hits + 0.5, b = n - hits + 0.5

  it('❗蒙特卡洛经验方差与闭式解相符(比方差不比分位数 —— 分布是块状多峰,分位数没有意义)', () => {
    const draws = simulateRenewalDraws([rents], a, b, 10000, 42)[0]
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length
    const empiricalVar = draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length
    const closed = renewalVariance(rents, hits / n, n)
    const closedVar = closed.byWhichTenants + closed.byRateUncertainty
    const relErr = Math.abs(empiricalVar - closedVar) / closedVar
    // 容差 8%:闭式解用点估计 p=hits/n 与近似的 Var(p̂)=p(1-p)/n,蒙特卡洛用的是完整
    // Beta(a,b) 后验(均值/方差都略有偏移)+ 10000 次抽样自身的采样噪声,两者不会逐位重合;
    // 8% 远小于「漏掉第二项」造成的 ~50% 落差,足够区分"闭式解错了/没接上"与"正常数值噪声"。
    expect(relErr).toBeLessThan(0.08)
  })

  // 破坏验证(不是常驻测试 —— 做法见 task-7-fix-1.md「把共享 p 改成每户各抽一个」):
  // 手工把 simulateRenewalDraws 里的 `const p = sampleBeta(a, b, rng)` 从外层(每轮一次)
  // 挪到最内层(每户一次)、跑上面这条断言、确认它变红、再还原,结果记在 task-7-report.md。
  // 不把这份 mutation 写成第二条常驻测试:那需要在测试文件里独立复刻一份 PRNG/Gamma/Beta,
  // 而它本该测的是生产代码本身,复刻一份只会制造两份要维护的代码却什么也多测不到。
})
