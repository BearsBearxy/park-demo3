// TenantEnergy.logic 纯函数单测(铁律⑦;jsdom 无 canvas → 屏测试只测纯函数)。
import { describe, expect, it } from 'vitest'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { buildFamilyMap } from '@/analysis/anaFamily'
import { buildPayRows, buildTenantRows, familyBars, moverOutlier, parkQuartiles, pastYm, prevYm, splitLogPoints, tenantPeriods, yearRows } from './TenantEnergy.logic'

const s10 = (tenantName: string, acctMonth: string, elec: number, water = 0, phase = 1): AnalysisS10Row =>
  ({ acctMonth, phase, tenantId: null, tenantName, elec, water, total: elec + water })

const map = (rows: AnalysisS10Row[]): Map<string, AnalysisS10Row[]> => {
  const m = new Map<string, AnalysisS10Row[]>()
  for (const r of rows) m.set(r.tenantName, [...(m.get(r.tenantName) ?? []), r])
  return m
}
const lr = (tenantName: string, year: number, month: number, receivable: number, collected: number, balanceEnd = receivable - collected, companyId = 1): AnalysisLedgerRow => ({
  companyId, companyName: `公司${companyId}`, year, month, tenantId: null, tenantName,
  balancePrev: 0, receivable, collected, balanceEnd,
})

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

describe('pastYm / prevYm(改稿:回退只往前,te2-ask 4)', () => {
  const ms = ['2025-01', '2025-02', '2025-06', '2025-07', '2025-10', '2025-11', '2025-12']
  it('取 ≤ 所选月的最近一月:4月 → 2月;12月 → 12月', () => {
    expect(pastYm(ms, '2025-04')).toBe('2025-02')
    expect(pastYm(ms, '2025-12')).toBe('2025-12')
    expect(pastYm(ms, '2026-03')).toBe('2025-12')
  })
  it('❗前面一个月都没有 → null,不拿以后的 2025年1月顶替 2024年12月(原来会往未来回退)', () => {
    expect(pastYm(ms, '2024-12')).toBeNull()
    expect(pastYm([], '2025-12')).toBeNull()
  })
  it('上一个月跨年', () => {
    expect(prevYm('2025-01')).toBe('2024-12')
    expect(prevYm('2025-10')).toBe('2025-09')
  })
})

describe('yearRows(按年:这一年有数的月合计)', () => {
  it('只合计这一年的月、一户一行按合计降序;这一年一个月都没有的户不进', () => {
    const tm = map([
      s10('甲', '2024-12', 9999), s10('甲', '2025-01', 100), s10('甲', '2025-02', 50), s10('甲', '2025-02', 25),
      s10('乙', '2025-06', 300, 7),
      s10('丙', '2024-11', 500),
    ])
    const rows = yearRows(tm, ['2025-01', '2025-02', '2025-06'], 'elec')
    expect(rows.map((r) => [r.name, r.cur])).toEqual([['乙', 300], ['甲', 175]])
    expect([...rows[1].vals]).toEqual([['2025-01', 100], ['2025-02', 75]])
    expect(yearRows(tm, ['2025-06'], 'water').map((r) => [r.name, r.cur])).toEqual([['乙', 7]])
  })
})

describe('familyBars(按家族:开关挪到主卡卡头)', () => {
  const fam = buildFamilyMap([
    { companyName: '广联', parentName: null },
    { companyName: '广联（宿舍）', parentName: '广联' },
    { companyName: '广联（饭堂）', parentName: '广联' },
    { companyName: '安达', parentName: null },
  ])
  const bar = (name: string, cur: number, prev: number | null) => ({ name, cur, prev, pick: name })
  it('本期、上期分别加总重排;根在截面 → 点家族条选中根', () => {
    const fb = familyBars([bar('安达', 400, 380), bar('广联', 100, 90), bar('广联（宿舍）', 300, null), bar('广联（饭堂）', 50, 10)], fam)
    expect(fb).toEqual([
      { name: '广联', cur: 450, prev: 100, pick: '广联' },        // 家族合计 450 > 400 反超;上期缺的成员按 0 加
      { name: '安达', cur: 400, prev: 380, pick: '安达' },
    ])
  })
  it('根不在截面 → 选本期最大的成员;成员上期全缺 → 上期 null;不在主数据的名称自成一族', () => {
    const fb = familyBars([bar('广联（宿舍）', 80, null), bar('广联（饭堂）', 120, null), bar('已注销租户', 999, 5)], fam)
    expect(fb.find((b) => b.name === '广联')).toEqual({ name: '广联', cur: 200, prev: null, pick: '广联（饭堂）' })
    expect(fb.find((b) => b.name === '已注销租户')).toEqual({ name: '已注销租户', cur: 999, prev: 5, pick: '已注销租户' })
  })
})

describe('parkQuartiles(全园中间一半)', () => {
  it('同户同月先合计;只算大于 0 的户;不足 20 户的月不建;P25/P50/P75 线性插值', () => {
    // 2025-12:户0..户19 电费 1..20(户0 拆两行 0.4+0.6),另有 0 元户、为负的户不算 → 20 户
    const rows = Array.from({ length: 20 }, (_, i) => s10(`户${i}`, '2025-12', i + 1, 0))
    rows[0] = s10('户0', '2025-12', 0.4); rows.push(s10('户0', '2025-12', 0.6), s10('零', '2025-12', 0), s10('负', '2025-12', -5))
    rows.push(...Array.from({ length: 19 }, (_, i) => s10(`户${i}`, '2025-11', 10)))   // 11月只有 19 户
    const q = parkQuartiles(map(rows), 'elec')
    expect(Object.keys(q)).toEqual(['2025-12'])
    expect(q['2025-12']).toEqual({ p25: 5.75, p50: 10.5, p75: 15.25, n: 20 })
    expect(parkQuartiles(map(rows), 'water')).toEqual({})          // 水费全是 0
  })
})

describe('tenantPeriods(选中户台账逐期,collect 的 balEnd)', () => {
  it('几家公司相加、只取这户、只取 ≤ upto 的期、升序;end = 期末结余合计', () => {
    const ps = tenantPeriods([
      lr('甲', 2025, 10, 100, 120, 50, 1), lr('甲', 2025, 10, -30, 0, 120, 2),   // 罗立剑那种:一家当月应收为负,实收比应收多,期末仍欠
      lr('甲', 2025, 9, 80, 0, 80), lr('甲', 2025, 11, 1, 1), lr('乙', 2025, 10, 5, 5),
    ], '甲', '2025-10')
    expect(ps).toEqual([
      { ym: '2025-09', recv: 80, coll: 0, end: 80 },
      { ym: '2025-10', recv: 70, coll: 120, end: 170 },
    ])
  })
})

describe('moverOutlier(按年欠费变动:撑开横轴的那户单独一行写数,te2-ask 6)', () => {
  const rows = [{ name: '火炬', prev: 956.6, cur: 2164.8 }, { name: '碧沃丰', prev: 222.3, cur: 173.1 }, { name: '可莱恩', prev: 0, cur: 40.1 }]
  it('读数句点到的那户比其余最大的值大 4 倍以上 → 单独写', () => {
    expect(moverOutlier(rows, '火炬')).toBe('火炬')   // 2,164.8 > 4 × 222.3
  })
  it('不到 4 倍、或读数句没点名、或只有一户 → null(照画条)', () => {
    expect(moverOutlier([{ name: '火炬', prev: 500, cur: 800 }, ...rows.slice(1)], '火炬')).toBeNull()   // 800 < 889.2
    expect(moverOutlier(rows, null)).toBeNull()
    expect(moverOutlier(rows, '碧沃丰')).toBeNull()
    expect(moverOutlier(rows.slice(0, 1), '火炬')).toBeNull()
  })
})

describe('splitLogPoints(spec §T2 散点对数轴数据准备)', () => {
  const pts = [{ n: '零租金户', v: 0 }, { n: '正常户', v: 0.8 }, { n: '负值户', v: -3 }]
  it('log:金额≤0 的点过滤,hidden 计数披露', () => {
    const r = splitLogPoints(pts, (p) => p.v, true)
    expect(r.shown.map((p) => p.n)).toEqual(['正常户'])
    expect(r.hidden).toBe(2)
  })
  it('线性:全量不过滤,hidden=0', () => {
    const r = splitLogPoints(pts, (p) => p.v, false)
    expect(r.shown).toHaveLength(3)
    expect(r.hidden).toBe(0)
  })
})

describe('buildPayRows', () => {
  it('按租户名跨公司聚合;结清/部分/未缴状态与 v1 一致;只取指定期', () => {
    const rows = buildPayRows([
      lr('甲', 2025, 10, 100, 100, 0, 1), lr('甲', 2025, 10, 50, 20, 30, 2),   // 跨公司合并:recv 150 coll 120 bal 30 → partial
      lr('乙', 2025, 10, 80, 0),                                   // none
      lr('丙', 2025, 10, 60, 60),                                  // normal
      lr('甲', 2025, 1, 999, 0),                                   // 其他期忽略
    ], '2025-10')
    expect(rows).toHaveLength(3)
    const jia = rows.find((r) => r.name === '甲')
    expect(jia).toMatchObject({ recv: 150, coll: 120, bal: 30, rate: 80, status: 'partial' })
    expect(rows.find((r) => r.name === '乙')?.status).toBe('none')
    expect(rows.find((r) => r.name === '丙')?.status).toBe('normal')
  })
})
