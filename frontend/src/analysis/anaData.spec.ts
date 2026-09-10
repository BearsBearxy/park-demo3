// anaData 聚合器纯函数单测:vi.mock api 层 → 断言聚合形状与数字 + 模块级缓存防重复拉取。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __clearAnaCacheForTest, extractPnlBand, fetchCollectRates, fetchPnlSummary,
  fetchS10PhaseMonthly, fetchS10TenantMap,
} from './anaData'
import { analysisApi } from '@/api/analysis'
import { pnlApi } from '@/api/pnl'
import type { PnlRowDTO, PnlYearDTO } from '@/types/pnl'

vi.mock('@/api/analysis', () => ({
  analysisApi: { months: vi.fn(), s10TenantMonths: vi.fn(), ledgerTenantMonths: vi.fn() },
}))
vi.mock('@/api/pnl', () => ({ pnlApi: { year: vi.fn() } }))

const M = (v1: number | null, v2: number | null = null): (number | null)[] =>
  [v1, v2, null, null, null, null, null, null, null, null, null, null]

function row(p: Partial<PnlRowDTO>): PnlRowDTO {
  return { rowKey: 'r1', groupLabel: '', label: '', kind: 'detail', note: null, m: M(null), sortOrder: 0, ...p }
}
function pnlYear(rows: PnlRowDTO[]): PnlYearDTO { return { year: 2025, rows } }

// 附表底带 fixture(形状对齐真实库:group_label='' 的园区总计带;s5 走费用合计)
const FIXTURES: Record<string, PnlYearDTO> = {
  s1: pnlYear([
    row({ label: '厂房租金', kind: 'detail', groupLabel: '一期、宿舍', m: M(999) }),  // 明细行必须被忽略
    row({ label: '园区总租金收入', kind: 'total', m: M(1000) }),
    row({ label: '园区总租金成本', kind: 'total', m: M(600) }),
    row({ label: '园区租金总损益', kind: 'pnl', m: M(400) }),
  ]),
  s2: pnlYear([
    row({ label: '园区用电总收入', kind: 'total', m: M(200) }),
    row({ label: '园区用电总成本', kind: 'total', m: M(100) }),
    row({ label: '园区用电总损益', kind: 'pnl', m: M(100) }),
  ]),
  s3: pnlYear([
    row({ label: '水费+用水维护费总收入', kind: 'total', m: M(50) }),
    row({ label: '水费+用水维护费总成本', kind: 'total', m: M(60) }),
    row({ label: '水费+用水维护费总损益', kind: 'pnl', m: M(-10) }),
  ]),
  s4: pnlYear([
    row({ label: '基础设施维护费等运营费用收入合计', kind: 'total', m: M(300) }),
    row({ label: '基础设施维护费等运营费用成本合计', kind: 'total', m: M(30) }),
    row({ label: '基础设施维护费等运营费用损益合计', kind: 'pnl', m: M(270) }),
  ]),
  s5: pnlYear([
    row({ label: '销售费用合计', kind: 'total', groupLabel: '销售费用', m: M(888) }),      // 子合计不计(防双算)
    row({ label: '保洁费用小计', kind: 'subtotal', groupLabel: '管理费用', m: M(777) }),   // 小计不计
    row({ label: '管理费用总计：', kind: 'total', m: M(666) }),                            // 子合计不计(防双算)
    row({ label: '运营费用总计', kind: 'total', m: M(100) }),                              // 底带大合计 = s5 成本
  ]),
}

beforeEach(() => {
  __clearAnaCacheForTest()
  vi.clearAllMocks()
})

describe('extractPnlBand', () => {
  it('s1~s4:只取分组列为空的园区总计带', () => {
    const band = extractPnlBand('s1', FIXTURES.s1)
    expect(band.rev[0]).toBe(1000)
    expect(band.cost[0]).toBe(600)
    expect(band.pnl[0]).toBe(400)
    expect(band.rev[1]).toBeNull()   // 未覆盖月保持 null
  })

  it('s5:只取底带「运营费用总计」,小计/子合计不双算', () => {
    const band = extractPnlBand('s5', FIXTURES.s5)
    expect(band.cost[0]).toBe(100)
    expect(band.rev[0]).toBeNull()
    expect(band.pnl[0]).toBeNull()
  })
})

describe('fetchPnlSummary', () => {
  it('园区口径:revenue=Σs1~s4收入;cost=Σs1~s4成本+s5三费;profit=差;稀疏月null', async () => {
    vi.mocked(pnlApi.year).mockImplementation(async (s: string) => FIXTURES[s])
    const sum = await fetchPnlSummary(2025)
    expect(sum.revenue[0]).toBe(1550)   // 1000+200+50+300
    expect(sum.cost[0]).toBe(890)       // 600+100+60+30 + 100
    expect(sum.profit[0]).toBe(660)
    expect(sum.revenue[1]).toBeNull()
    expect(sum.profit[1]).toBeNull()
    expect(sum.months).toEqual([1])
    expect(sum.bySchedule.s2.pnl[0]).toBe(100)
  })

  it('模块级缓存:重复调用只拉一轮(5 附表各 1 次)', async () => {
    vi.mocked(pnlApi.year).mockImplementation(async (s: string) => FIXTURES[s])
    await fetchPnlSummary(2025)
    await fetchPnlSummary(2025)
    expect(pnlApi.year).toHaveBeenCalledTimes(5)
  })
})

describe('fetchCollectRates', () => {
  it('跨公司按月聚合应收/收款并算率', async () => {
    vi.mocked(analysisApi.ledgerTenantMonths).mockResolvedValue([
      { companyId: 1, companyName: '甲', year: 2025, month: 1, tenantId: 1, tenantName: 'A', balancePrev: 0, receivable: 1000, collected: 800, balanceEnd: 200 },
      { companyId: 2, companyName: '乙', year: 2025, month: 1, tenantId: 2, tenantName: 'B', balancePrev: 0, receivable: 1000, collected: 1000, balanceEnd: 0 },
      { companyId: 1, companyName: '甲', year: 2025, month: 10, tenantId: 1, tenantName: 'A', balancePrev: 0, receivable: 500, collected: 250, balanceEnd: 250 },
    ])
    const rates = await fetchCollectRates()
    expect(rates).toEqual([
      { ym: '2025-01', receivable: 2000, collected: 1800, rate: 90 },
      { ym: '2025-10', receivable: 500, collected: 250, rate: 50 },
    ])
    // 缓存:再次调用不重复拉
    await fetchCollectRates()
    expect(analysisApi.ledgerTenantMonths).toHaveBeenCalledTimes(1)
  })

  it('应收为 0 → 率 0(不除零)', async () => {
    vi.mocked(analysisApi.ledgerTenantMonths).mockResolvedValue([
      { companyId: 1, companyName: '甲', year: 2025, month: 1, tenantId: 1, tenantName: 'A', balancePrev: 0, receivable: 0, collected: 0, balanceEnd: 0 },
    ])
    const rates = await fetchCollectRates()
    expect(rates[0].rate).toBe(0)
  })
})

describe('s10 聚合', () => {
  const S10_ROWS = [
    { acctMonth: '2025-01', phase: 1, tenantId: 1, tenantName: '甲', elec: 10, water: 2, total: 100 },
    { acctMonth: '2025-01', phase: 2, tenantId: 2, tenantName: '乙', elec: 20, water: 3, total: 200 },
    { acctMonth: '2025-02', phase: 1, tenantId: 1, tenantName: '甲', elec: 12, water: 2, total: 110 },
    { acctMonth: '2025-02', phase: 1, tenantId: 3, tenantName: '丙', elec: 5, water: 1, total: 50 },
  ]

  it('fetchS10PhaseMonthly:phase→month Σtotal/Σelec + 月份/期次列表', async () => {
    vi.mocked(analysisApi.s10TenantMonths).mockResolvedValue(S10_ROWS)
    const pm = await fetchS10PhaseMonthly()
    expect(pm.months).toEqual(['2025-01', '2025-02'])
    expect(pm.phases).toEqual([1, 2])
    expect(pm.totals[1]['2025-02']).toBe(160)   // 110+50
    expect(pm.elec[1]['2025-02']).toBe(17)
    expect(pm.totals[2]['2025-01']).toBe(200)
  })

  it('fetchS10TenantMap:按租户名分组且月升序;与 PhaseMonthly 共享一次拉取', async () => {
    vi.mocked(analysisApi.s10TenantMonths).mockResolvedValue(S10_ROWS)
    const map = await fetchS10TenantMap()
    expect(map.get('甲')!.map((r) => r.acctMonth)).toEqual(['2025-01', '2025-02'])
    expect(map.get('丙')!.length).toBe(1)
    await fetchS10PhaseMonthly()
    expect(analysisApi.s10TenantMonths).toHaveBeenCalledTimes(1)
  })
})

import { usableMonths, isOutlierMonth } from './anaData'

describe('未闭月护栏(FORECAST §2.7 —— 逐格判,不整期丢)', () => {
  const rev = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, -636000]

  it('❗收入为负的月被判离群', () => {
    expect(isOutlierMonth(rev, 12)).toBe(true)
    expect(isOutlierMonth(rev, 11)).toBe(false)
  })

  it('❗可用月剔掉离群月,顺序不变', () => {
    expect(usableMonths([1, 2, 11, 12], rev)).toEqual([1, 2, 11])
  })

  it('❗全负时不返回空 —— 空数组会让分母为 0,屏上出 NaN%', () => {
    expect(usableMonths([1, 2], [-1, -2])).toEqual([1, 2])
  })

  it('❗null 不算离群 —— 缺数据月与被污染月是两件事', () => {
    expect(isOutlierMonth([null, 5], 1)).toBe(false)
  })
})
