// churn.logic 纯函数单测(v2 抽出;口径=v1:缴费40/收入30/用能30 缺项归一,gone10 记满分)
import { describe, expect, it } from 'vitest'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import { buildChurnModel, churnFlowOption, churnScatterOption } from './churn.logic'

function led(p: Partial<AnalysisLedgerRow>): AnalysisLedgerRow {
  return {
    companyId: 1, companyName: '甲公司', year: 2025, month: 1,
    tenantId: 1, tenantName: '租户A', balancePrev: 0, receivable: 0, collected: 0, balanceEnd: 0, ...p,
  }
}
function s10(p: Partial<AnalysisS10Row>): AnalysisS10Row {
  return { acctMonth: '2025-01', phase: 1, tenantId: 1, tenantName: '租户A', elec: 0, water: 0, total: 0, ...p }
}

const TH = 60

describe('buildChurnModel', () => {
  it('空台账 → null', () => {
    expect(buildChurnModel([], [], TH)).toBeNull()
  })

  it('已流失=首期在租∩末期缺席;churnedRecv=首期应收Σ;在租按缺项归一评分', () => {
    const ledger = [
      // A:两期都在。首期 recv 100;末期 recv 100 / coll 50 → payRate 50、payScore 50
      led({ tenantName: 'A', month: 1, receivable: 100, collected: 100 }),
      led({ tenantName: 'A', month: 10, receivable: 100, collected: 50 }),
      // B:仅首期(跨两公司合计 200+40)→ 已流失,公司取应收大者
      led({ tenantName: 'B', month: 1, receivable: 200, companyName: '甲公司' }),
      led({ tenantName: 'B', month: 1, receivable: 40, companyName: '乙公司' }),
      // C:仅末期,recv 0 → payScore 0、payRate null
      led({ tenantName: 'C', month: 10, receivable: 0, collected: 0 }),
    ]
    const s10Rows = [
      // A:01→02 收入 100→80(-20% → revScore 20),电 50→60(上行 → elecScore 0)
      s10({ tenantName: 'A', acctMonth: '2025-01', total: 100, elec: 50 }),
      s10({ tenantName: 'A', acctMonth: '2025-02', total: 80, elec: 60 }),
      // C:s10 仅 01 出现、末期(02)缺席 → gone10,rev/elec 记满分
      s10({ tenantName: 'C', acctMonth: '2025-01', total: 10, elec: 5 }),
    ]
    const m = buildChurnModel(ledger, s10Rows, TH)!
    expect(m.firstYm).toBe('2025-01')
    expect(m.lastYm).toBe('2025-10')
    // 已流失:B(recv=240,公司=甲)
    expect(m.churned).toEqual([{ name: 'B', recv: 240, company: '甲公司' }])
    expect(m.churnedRecv).toBe(240)
    // A:score = round(0.4*50+0.3*20+0.3*0) = 26 → low(<TH-20)
    const a = m.list.find((t) => t.name === 'A')!
    expect(a.payScore).toBe(50)
    expect(a.revMom).toBe(-20)
    expect(a.revScore).toBe(20)
    expect(a.elecScore).toBe(0)
    expect(a.score).toBe(26)
    expect(a.tier).toBe('low')
    // C:payScore 0(recv=0)+ gone10 满分 → (0.4*0+0.3*100+0.3*100)/1 = 60 → high
    const c = m.list.find((t) => t.name === 'C')!
    expect(c.gone10).toBe(true)
    expect(c.score).toBe(60)
    expect(c.tier).toBe('high')
    expect(m.counts).toEqual({ high: 1, mid: 0, low: 1 })
    // overallRate:仅 A 有应收 → 50/100 = 50%
    expect(m.overallRate).toBe(50)
    // flows:01→02,C 消失 1;新出现 0
    expect(m.flows).toEqual([{ label: '1月→2月', appeared: 0, disappeared: 1 }])
    expect(m.avgScore).toBe(Math.round((26 + 60) / 2))
  })

  it('缺项归一:无 s10 → 仅缴费分/0.4', () => {
    const ledger = [
      led({ tenantName: 'A', month: 1, receivable: 100, collected: 0 }),
      led({ tenantName: 'A', month: 10, receivable: 100, collected: 0 }),
    ]
    const m = buildChurnModel(ledger, [], TH)!
    // payScore 100,rev/elec 缺 → score = 0.4*100/0.4 = 100
    expect(m.list[0].score).toBe(100)
    expect(m.list[0].revScore).toBeNull()
    expect(m.list[0].elecScore).toBeNull()
  })
})

describe('ECharts option 构建', () => {
  const ledger = [
    led({ tenantName: 'A', month: 1, receivable: 100, collected: 100 }),
    led({ tenantName: 'A', month: 10, receivable: 100, collected: 50 }),
    led({ tenantName: 'C', month: 10, receivable: 0 }),
  ]
  const s10Rows = [
    s10({ tenantName: 'A', acctMonth: '2025-01', total: 100, elec: 50 }),
    s10({ tenantName: 'A', acctMonth: '2025-02', total: 80, elec: 60 }),
  ]
  const m = buildChurnModel(ledger, s10Rows, TH)!

  it('散点仅含 revMom+payRate 双非空租户;markLine 十字=x均值/整体收款率', () => {
    const opt = churnScatterOption(m.list, m.overallRate) as {
      series: { data: { name: string; value: [number, number] }[]; markLine: { data: { xAxis?: number; yAxis?: number }[] } }[]
    }
    expect(opt.series[0].data.map((d) => d.name)).toEqual(['A'])   // C 无 revMom/payRate
    expect(opt.series[0].data[0].value).toEqual([-20, 50])
    expect(opt.series[0].markLine.data[0].xAxis).toBe(-20)         // 均值(单点)
    expect(opt.series[0].markLine.data[1].yAxis).toBe(m.overallRate)
  })

  it('正负柱:新出现为正、消失取负', () => {
    const opt = churnFlowOption([{ label: '1月→2月', appeared: 3, disappeared: 2 }]) as {
      xAxis: { data: string[] }; series: { name: string; data: number[] }[]
    }
    expect(opt.xAxis.data).toEqual(['1月→2月'])
    expect(opt.series[0].data).toEqual([3])
    expect(opt.series[1].data).toEqual([-2])
  })
})
