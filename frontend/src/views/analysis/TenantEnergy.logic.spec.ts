// TenantEnergy.logic 纯函数单测(铁律⑦;jsdom 无 canvas → 屏测试只测纯函数)。
import { describe, expect, it } from 'vitest'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { buildFamilyMap } from '@/analysis/anaFamily'
import { buildFamilyRows, buildParkBand, buildPayRows, buildTenantRows, tenantSeries } from './TenantEnergy.logic'

const s10 = (tenantName: string, acctMonth: string, elec: number, water = 0, phase = 1): AnalysisS10Row =>
  ({ acctMonth, phase, tenantId: null, tenantName, elec, water, total: elec + water })

const map = (rows: AnalysisS10Row[]): Map<string, AnalysisS10Row[]> => {
  const m = new Map<string, AnalysisS10Row[]>()
  for (const r of rows) m.set(r.tenantName, [...(m.get(r.tenantName) ?? []), r])
  return m
}

describe('buildTenantRows', () => {
  const months = ['2025-01', '2025-02', '2025-03']
  it('同月多行合并、按本期降序排名、环比/均值偏离/z 与 v1 口径一致', () => {
    const tm = map([
      s10('甲', '2025-01', 100), s10('甲', '2025-02', 200), s10('甲', '2025-03', 300), s10('甲', '2025-03', 100),  // 3月合并 400
      s10('乙', '2025-02', 500), s10('乙', '2025-03', 250),
    ])
    const rows = buildTenantRows(tm, '2025-03', months, 'elec', new Map([['甲', 8000]]))
    expect(rows.map((r) => r.name)).toEqual(['甲', '乙'])          // 400 > 250
    expect(rows[0].rank).toBe(1)
    expect(rows[0].cur).toBe(400)
    expect(rows[0].mom).toBe(100)                                   // (400-200)/200
    expect(rows[0].winTotal).toBe(700)
    expect(rows[0].vsAvg).toBe(+(((400 - 700 / 3) / (700 / 3)) * 100).toFixed(1))
    expect(rows[0].monthlyRent).toBe(8000)
    expect(rows[1].mom).toBe(-50)                                   // 500 → 250
    expect(rows[1].monthlyRent).toBeNull()
  })
  it('本期无记录的租户不进截面;水费口径取 water 列;超本期的月份忽略', () => {
    const tm = map([
      s10('甲', '2025-01', 100, 30), s10('甲', '2025-02', 100, 60), s10('甲', '2025-03', 999, 999),
      s10('丙', '2025-01', 700, 5),
    ])
    const rows = buildTenantRows(tm, '2025-02', ['2025-01', '2025-02'], 'water', new Map())
    expect(rows).toHaveLength(1)                                    // 丙 2025-02 无行 → 剔除
    expect(rows[0].cur).toBe(60)
    expect(rows[0].vals.has('2025-03')).toBe(false)
  })
})

describe('buildParkBand / tenantSeries', () => {
  it('逐月均值±σ(lo 截 0),该月无租户 → null;租户缺月 → null', () => {
    const tm = map([s10('甲', '2025-01', 100), s10('甲', '2025-03', 300), s10('乙', '2025-01', 300), s10('乙', '2025-03', 100)])
    const rows = buildTenantRows(tm, '2025-03', ['2025-01', '2025-03'], 'elec', new Map())
    const band = buildParkBand(rows, ['2025-01', '2025-02', '2025-03'])
    expect(band.mean).toEqual([200, null, 200])                     // 逐月跨户均值;2月无数据
    expect(band.lo[0]).toBe(100)                                    // 200-σ(=100)
    expect(band.hi[0]).toBe(300)
    expect(band.lo[2]).toBe(100)
    const jia = rows.find((r) => r.name === '甲') ?? null
    expect(tenantSeries(jia, ['2025-01', '2025-02', '2025-03'])).toEqual([100, null, 300])
    expect(tenantSeries(null, ['2025-01'])).toEqual([null])
  })
})

describe('buildFamilyRows(spec §B/W3 家族榜单)', () => {
  const months = ['2025-01', '2025-02']
  const fam = buildFamilyMap([
    { companyName: '广联', parentName: null },
    { companyName: '广联（宿舍）', parentName: '广联' },
    { companyName: '广联（饭堂）', parentName: '广联' },
    { companyName: '安达', parentName: null },
  ])
  it('家族成员本期金额加总重排;根在截面 → mainName=根;单户家族原样', () => {
    const tm = map([
      s10('广联', '2025-02', 100), s10('广联（宿舍）', '2025-02', 300), s10('广联（饭堂）', '2025-02', 50),
      s10('安达', '2025-02', 400),
    ])
    const rows = buildTenantRows(tm, '2025-02', months, 'elec', new Map())
    expect(rows[0].name).toBe('安达')                               // 按户第一名是安达
    const fr = buildFamilyRows(rows, fam)
    expect(fr.map((r) => r.root)).toEqual(['广联', '安达'])          // 家族合计 450 > 400 反超
    expect(fr[0]).toMatchObject({ cur: 450, memberCount: 3, mainName: '广联', rank: 1 })
    expect(fr[1]).toMatchObject({ root: '安达', cur: 400, memberCount: 1, mainName: '安达', rank: 2 })
  })
  it('根不在本期截面 → mainName 取金额最大成员;不在主数据的名称自成一族', () => {
    const tm = map([
      s10('广联（宿舍）', '2025-02', 80), s10('广联（饭堂）', '2025-02', 120),
      s10('已注销租户', '2025-02', 999),
    ])
    const rows = buildTenantRows(tm, '2025-02', months, 'elec', new Map())
    const fr = buildFamilyRows(rows, fam)
    expect(fr.find((r) => r.root === '广联')).toMatchObject({ cur: 200, memberCount: 2, mainName: '广联（饭堂）' })
    expect(fr.find((r) => r.root === '已注销租户')).toMatchObject({ cur: 999, memberCount: 1, mainName: '已注销租户' })
  })
})

describe('buildPayRows', () => {
  const lr = (tenantName: string, month: number, receivable: number, collected: number, companyId = 1): AnalysisLedgerRow => ({
    companyId, companyName: `公司${companyId}`, year: 2025, month, tenantId: null, tenantName,
    balancePrev: 0, receivable, collected, balanceEnd: receivable - collected,
  })
  it('按租户名跨公司聚合;结清/部分/未缴状态与 v1 一致;只取指定期', () => {
    const rows = buildPayRows([
      lr('甲', 10, 100, 100, 1), lr('甲', 10, 50, 20, 2),   // 跨公司合并:recv 150 coll 120 bal 30 → partial
      lr('乙', 10, 80, 0),                                   // none
      lr('丙', 10, 60, 60),                                  // normal
      lr('甲', 1, 999, 0),                                   // 其他期忽略
    ], '2025-10')
    expect(rows).toHaveLength(3)
    const jia = rows.find((r) => r.name === '甲')
    expect(jia).toMatchObject({ recv: 150, coll: 120, bal: 30, rate: 80, status: 'partial' })
    expect(rows.find((r) => r.name === '乙')?.status).toBe('none')
    expect(rows.find((r) => r.name === '丙')?.status).toBe('normal')
  })
})
