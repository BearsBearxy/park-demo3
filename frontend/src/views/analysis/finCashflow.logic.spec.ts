// fin-cashflow v2 纯函数单测:应收实收分组柱折万、点柱下钻欠费清单过滤/排序、欠费账龄 FIFO 分桶、
// 家族映射器(spec §B/W2)。
import { describe, expect, it } from 'vitest'
import type { AnalysisLedgerRow } from '@/api/analysis'
import { buildFamilyMap } from '@/analysis/anaFamily'
import { agingBuckets, arrearsOf, collectionRows, mergeFamilyRows, rcGroupOption } from './finCashflow.logic'

describe('rcGroupOption', () => {
  it('两系列(应收/实收)按期折万,类目=ym', () => {
    const o = rcGroupOption([
      { ym: '2025-01', receivable: 6906575.32, collected: 6912742.59 },
      { ym: '2025-10', receivable: 8726843.38, collected: 7090624.15 },
    ]) as { xAxis: { data: string[] }; series: { name: string; data: number[] }[] }
    expect(o.xAxis.data).toEqual(['2025-01', '2025-10'])
    expect(o.series.map((s) => s.name)).toEqual(['应收', '实收'])
    expect(o.series[0].data[1]).toBeCloseTo(872.684338, 6)
    expect(o.series[1].data[0]).toBeCloseTo(691.274259, 6)
  })
})

const row = (p: Partial<AnalysisLedgerRow>): AnalysisLedgerRow => ({
  companyId: 1, companyName: '甲公司', year: 2025, month: 10,
  tenantId: 1, tenantName: '租户A',
  balancePrev: 0, receivable: 100, collected: 0, balanceEnd: 100,
  ...p,
})

describe('arrearsOf(点柱 → 该期欠费租户清单)', () => {
  const rows = [
    row({ tenantName: 'A', balanceEnd: 500 }),
    row({ tenantName: 'B', balanceEnd: 900 }),
    row({ tenantName: 'C', balanceEnd: 0 }),                       // 无欠费不入
    row({ tenantName: 'D', month: 1, balanceEnd: 700 }),           // 其他期不入
    row({ tenantName: 'E', companyId: 2, companyName: '乙公司', balanceEnd: 800 }),
  ]
  it('按期过滤、剔除无欠费、欠费降序;全部公司含跨公司', () => {
    expect(arrearsOf(rows, '0', '2025-10').map((r) => r.tenantName)).toEqual(['B', 'E', 'A'])
  })
  it('公司过滤(法人口径)', () => {
    expect(arrearsOf(rows, '2', '2025-10').map((r) => r.tenantName)).toEqual(['E'])
    expect(arrearsOf(rows, '1', '2025-01').map((r) => r.tenantName)).toEqual(['D'])
  })
})

describe('mergeFamilyRows(家族映射器 spec §B/W2:rows 先合并再走现有 arrearsOf/agingBuckets)', () => {
  const fam = buildFamilyMap([
    { companyName: '广联', parentName: null },
    { companyName: '广联（宿舍）', parentName: '广联' },
    { companyName: '广联（饭堂）', parentName: '广联' },
    { companyName: '安达', parentName: null },
  ])

  it('广联三兄弟同月合并为一行:根名、金额四字段求和、members=3', () => {
    const out = mergeFamilyRows([
      row({ tenantName: '广联', balancePrev: 10, receivable: 100, collected: 60, balanceEnd: 50 }),
      row({ tenantName: '广联（宿舍）', balancePrev: 0, receivable: 30, collected: 30, balanceEnd: 0 }),
      row({ tenantName: '广联（饭堂）', balancePrev: 5, receivable: 20, collected: 0, balanceEnd: 25 }),
    ], fam)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      tenantName: '广联', members: 3,
      balancePrev: 15, receivable: 150, collected: 90, balanceEnd: 75,
    })
  })

  it('预收抵欠:一成员负余额抵减另一成员欠费 → 家族净额(合计小于逐户)', () => {
    const out = mergeFamilyRows([
      row({ tenantName: '广联（宿舍）', receivable: 100, collected: 0, balanceEnd: 500 }),
      row({ tenantName: '广联（饭堂）', receivable: 0, collected: 200, balanceEnd: -200 }),  // 预收/多收
    ], fam)
    expect(out[0].balanceEnd).toBe(300)
    // 合并流水再走现有函数:清单只剩净额一行;FIFO 账龄同月净额 −100 无欠费
    expect(arrearsOf(out, '0', '2025-10')).toHaveLength(1)
    expect(arrearsOf(out, '0', '2025-10')[0]).toMatchObject({ tenantName: '广联', balanceEnd: 300 })
    expect(agingBuckets(out, '0').total).toBe(0)
  })

  it('单户家族不变:非家族租户与不在主数据的名称各自成行,members=1', () => {
    const out = mergeFamilyRows([
      row({ tenantName: '安达', balanceEnd: 80 }),
      row({ tenantName: '已注销租户', balanceEnd: 60 }),
    ], fam)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.tenantName)).toEqual(['安达', '已注销租户'])
    expect(out.every((r) => r.members === 1)).toBe(true)
  })

  it('跨月/跨公司不合并:FIFO 逐月流水与法人口径保留', () => {
    const out = mergeFamilyRows([
      row({ tenantName: '广联', month: 9 }),
      row({ tenantName: '广联（宿舍）', month: 10 }),
      row({ tenantName: '广联（饭堂）', month: 10, companyId: 2, companyName: '乙公司' }),
    ], fam)
    expect(out).toHaveLength(3)
    expect(out.every((r) => r.tenantName === '广联' && r.members === 1)).toBe(true)
  })
})

describe('agingBuckets(欠费账龄 FIFO 分桶,月龄距全局最新台账月)', () => {
  it('单租户单月欠费:net>0 按月龄入桶(当月 → ≤1月)', () => {
    const r = agingBuckets([row({ month: 10, receivable: 100, collected: 40 })], '0')
    expect(r.buckets.map((b) => b.label)).toEqual(['≤1月', '2~3月', '4~6月', '>6月'])
    expect(r.buckets[0]).toMatchObject({ amount: 60, tenantCount: 1 })
    expect(r.total).toBe(60)
  })

  it('跨月部分冲抵:负 net 以 FIFO 先冲最旧欠费,可跨多笔', () => {
    const r = agingBuckets([
      row({ month: 7, receivable: 100, collected: 0 }),   // 最旧 +100(月龄3 → 2~3月)
      row({ month: 9, receivable: 50, collected: 0 }),    // +50(月龄1 → ≤1月)
      row({ month: 10, receivable: 0, collected: 120 }),  // −120:冲净 100 全笔,再冲 50 的 20
    ], '0')
    expect(r.buckets[1]).toMatchObject({ amount: 0, tenantCount: 0 })
    expect(r.buckets[0]).toMatchObject({ amount: 30, tenantCount: 1 })
    expect(r.total).toBe(30)
  })

  it('超额冲抵清零:多余冲抵额忽略,不产生负桶', () => {
    const r = agingBuckets([
      row({ month: 9, receivable: 100, collected: 0 }),
      row({ month: 10, receivable: 0, collected: 250 }),
    ], '0')
    expect(r.total).toBe(0)
    expect(r.buckets.every((b) => b.amount === 0 && b.tenantCount === 0)).toBe(true)
  })

  it('期初旧账:最早覆盖月 balancePrev>0 视为最老(先被冲),余额固定入 >6月 桶', () => {
    const r = agingBuckets([
      row({ month: 10, balancePrev: 200, receivable: 0, collected: 150 }),
    ], '0')
    expect(r.buckets[3]).toMatchObject({ amount: 50, tenantCount: 1 })
    expect(r.buckets[0].amount).toBe(0)
    expect(r.total).toBe(50)
  })

  it('多租户聚合+公司过滤:桶额累加、户数去重;过滤后月龄仍距全局最新月', () => {
    const rows = [
      row({ tenantName: 'A', month: 8, receivable: 100 }),
      row({ tenantName: 'B', month: 8, receivable: 80 }),
      row({ tenantName: 'C', companyId: 2, companyName: '乙公司', month: 10, receivable: 60 }),
    ]
    const all = agingBuckets(rows, '0')
    expect(all.buckets[0]).toMatchObject({ amount: 60, tenantCount: 1 })   // C(月龄0)
    expect(all.buckets[1]).toMatchObject({ amount: 180, tenantCount: 2 })  // A+B(月龄2)
    expect(all.total).toBe(240)
    // cid=1 过滤掉乙公司,但基准仍为全局最新 2025-10 → A/B 月龄2 落 2~3月而非 ≤1月
    const c1 = agingBuckets(rows, '1')
    expect(c1.buckets[0].amount).toBe(0)
    expect(c1.buckets[1]).toMatchObject({ amount: 180, tenantCount: 2 })
    expect(c1.total).toBe(180)
  })
})

describe('collectionRows(催缴清单:逐户桶明细,与 agingBuckets 同源 FIFO)', () => {
  it('逐户展开 4 桶+合计,欠费合计降序;无余额户不入清单', () => {
    const rows = [
      row({ tenantName: 'A', month: 8, receivable: 100 }),                       // 月龄2 → 桶1
      row({ tenantName: 'A', month: 10, receivable: 50 }),                       // 月龄0 → 桶0
      row({ tenantName: 'B', month: 10, receivable: 900 }),
      row({ tenantName: 'C', month: 9, receivable: 100 }),
      row({ tenantName: 'C', month: 10, receivable: 0, collected: 100 }),        // 冲净 → 不入
    ]
    const out = collectionRows(rows, '0')
    expect(out.map((r) => r.tenantName)).toEqual(['B', 'A'])
    expect(out[1]).toMatchObject({ buckets: [50, 100, 0, 0], total: 150, oldestYm: '2025-08' })
    expect(out[0]).toMatchObject({ buckets: [900, 0, 0, 0], total: 900, oldestYm: '2025-10' })
  })

  it('期初旧账落 >6月 桶且最早欠费月标「期初旧账」;公司过滤生效', () => {
    const rows = [
      row({ tenantName: 'A', month: 10, balancePrev: 200, receivable: 30 }),
      row({ tenantName: 'E', companyId: 2, companyName: '乙公司', month: 10, receivable: 60 }),
    ]
    const out = collectionRows(rows, '1')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ buckets: [30, 0, 0, 200], total: 230, oldestYm: '期初旧账' })
  })

  it('空输入/全额冲净均返回 [](导出按钮空态守卫依赖此契约)', () => {
    expect(collectionRows([], '0')).toEqual([])
    expect(collectionRows([row({ receivable: 0, collected: 100 })], '0')).toEqual([])
  })

  it('浮点冲抵残差(元含分)不产生幽灵行:≤0.005 视为结清,账龄户数同步不虚增', () => {
    const rows = [
      row({ tenantName: 'F', month: 9, receivable: 0.1, collected: 0 }),
      row({ tenantName: 'F', month: 10, receivable: 0.2, collected: 0.3 }),   // 0.1+0.2−0.3 留 1e-17 级残差
    ]
    expect(collectionRows(rows, '0')).toEqual([])
    const a = agingBuckets(rows, '0')
    expect(a.total).toBe(0)
    expect(a.buckets.every((b) => b.tenantCount === 0)).toBe(true)
  })

  it('桶合计与 agingBuckets 全等(同源口径不漂移)', () => {
    const rows = [
      row({ tenantName: 'A', month: 7, receivable: 100 }),
      row({ tenantName: 'A', month: 10, receivable: 0, collected: 40 }),
      row({ tenantName: 'B', month: 10, balancePrev: 500, receivable: 80 }),
    ]
    const list = collectionRows(rows, '0')
    const { buckets, total } = agingBuckets(rows, '0')
    for (let i = 0; i < 4; i++)
      expect(list.reduce((s, r) => s + r.buckets[i], 0)).toBe(buckets[i].amount)
    expect(list.reduce((s, r) => s + r.total, 0)).toBe(total)
  })
})
