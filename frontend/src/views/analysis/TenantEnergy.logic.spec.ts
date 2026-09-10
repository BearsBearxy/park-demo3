// TenantEnergy.logic 纯函数单测(铁律⑦;jsdom 无 canvas → 屏测试只测纯函数)。
import { describe, expect, it } from 'vitest'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { buildFamilyMap } from '@/analysis/anaFamily'
import { bandReadout, bandRefText, buildFamilyRows, buildParkBand, buildPayRows, buildTenantRows, splitLogPoints, tenantSeries, type TenantRow } from './TenantEnergy.logic'

const s10 = (tenantName: string, acctMonth: string, elec: number, water = 0, phase = 1): AnalysisS10Row =>
  ({ acctMonth, phase, tenantId: null, tenantName, elec, water, total: elec + water })

const map = (rows: AnalysisS10Row[]): Map<string, AnalysisS10Row[]> => {
  const m = new Map<string, AnalysisS10Row[]>()
  for (const r of rows) m.set(r.tenantName, [...(m.get(r.tenantName) ?? []), r])
  return m
}

// buildParkBand 只读 .vals,直接造最小 TenantRow 免去经 buildTenantRows 的间接层(D3 门槛测试用)。
const fakeRow = (name: string, vals: Record<string, number>): TenantRow => ({
  name, phase: 1, rank: 0, cur: 0, mom: null, vsAvg: null, sd: 0, z: 0,
  winTotal: 0, win: [], monthlyRent: null, vals: new Map(Object.entries(vals)),
})
const mkRows = (n: number, val = 100): TenantRow[] =>
  Array.from({ length: n }, (_, i) => fakeRow(`户${i}`, { '2025-01': val }))

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
  // D3 门槛(<20 不画带)下,原 2 租户例子会整段判 null —— 补 18 户凑到 20 户,
  // 且两月对称拆 10/10(甲/摆 两户在两月间互换阵营)保持 mean/σ 与改前一致,可心算验证。
  const jia = fakeRow('甲', { '2025-01': 100, '2025-03': 300 })
  const swing = fakeRow('摆', { '2025-01': 300, '2025-03': 100 })
  const lo9 = Array.from({ length: 9 }, (_, i) => fakeRow(`低${i}`, { '2025-01': 100, '2025-03': 100 }))
  const hi9 = Array.from({ length: 9 }, (_, i) => fakeRow(`高${i}`, { '2025-01': 300, '2025-03': 300 }))
  const rows = [jia, swing, ...lo9, ...hi9]   // 20 户:每月各 10@100 + 10@300

  it('逐月均值±σ(lo 截 0),该月无租户 → null;租户缺月 → null;n 传出(D3 门槛 ≥20)', () => {
    const band = buildParkBand(rows, ['2025-01', '2025-02', '2025-03'])
    expect(band.mean).toEqual([200, null, 200])                     // 逐月跨户均值;2月无数据
    expect(band.lo[0]).toBe(100)                                    // 200-σ(=100)
    expect(band.hi[0]).toBe(300)
    expect(band.lo[2]).toBe(100)
    expect(band.n).toEqual([20, 0, 20])
    expect(tenantSeries(jia, ['2025-01', '2025-02', '2025-03'])).toEqual([100, null, 300])
    expect(tenantSeries(null, ['2025-01'])).toEqual([null])
  })

  it('❗n = 19 不返回带(D3 三档:<20 不画),n 仍传出', () => {
    const band = buildParkBand(mkRows(19), ['2025-01'])
    expect(band.lo[0]).toBeNull()
    expect(band.n[0]).toBe(19)
  })

  it('❗n = 20 返回带,且 n 一并传出供参照系小字印', () => {
    const band = buildParkBand(mkRows(20), ['2025-01'])
    expect(band.lo[0]).not.toBeNull()
    expect(band.n[0]).toBe(20)
  })

  it('❗n<20 时 buildParkBand 出 null,bandReadout 跟着自动闭嘴(不用它自己另判 n)', () => {
    const band = buildParkBand(mkRows(15, 200), ['2025-01'])
    expect(bandReadout(200, band.lo[0], band.hi[0], '电费')).toBeNull()
  })
})

describe('bandReadout(主图读数句)', () => {
  it('高于上界 / 低于下界 / 落在区间内 / 缺数据(cur/lo/hi 任一为 null)→ null', () => {
    expect(bandReadout(400, 100, 300, '电费')).toBe('电费高于跨户区间 ¥100~¥300')
    expect(bandReadout(50, 100, 300, '电费')).toBe('电费低于跨户区间 ¥100~¥300')
    expect(bandReadout(200, 100, 300, '电费')).toBe('电费落在跨户区间 ¥100~¥300')
    expect(bandReadout(null, 100, 300, '电费')).toBeNull()
    expect(bandReadout(200, null, 300, '电费')).toBeNull()
    expect(bandReadout(200, 100, null, '电费')).toBeNull()
  })
})

describe('bandRefText(参照系小字,F2 修复轮1:只说样本量/口径/单位,不提灰带画没画)', () => {
  it('n 有值(即便<20)→ 样本N户;n 缺 → 样本未知', () => {
    expect(bandRefText(251)).toBe('记账月口径 · 元 · 样本251户')
    expect(bandRefText(15)).toBe('记账月口径 · 元 · 样本15户')   // <20 也照实报数,不夹带「不画带」判断
    expect(bandRefText(null)).toBe('记账月口径 · 元 · 样本未知')
  })

  it('❗F1:不许出现原始列名 acct_month —— 屏上写中文「记账月」', () => {
    expect(bandRefText(251)).not.toContain('acct_month')
    expect(bandRefText(251)).toContain('记账月')
  })

  it('❗F2:句子里不再出现「灰带」「断点」—— 带画不画/断不断点不影响这句话真假', () => {
    expect(bandRefText(251)).not.toContain('灰带')
    expect(bandRefText(251)).not.toContain('断点')
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
