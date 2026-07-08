// fin-cashflow v2 纯函数单测:应收实收分组柱折万、点柱下钻欠费清单过滤/排序。
import { describe, expect, it } from 'vitest'
import type { AnalysisLedgerRow } from '@/api/analysis'
import { arrearsOf, rcGroupOption } from './finCashflow.logic'

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
