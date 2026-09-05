// 异常规则引擎纯函数单测(G1 屏组):四规则触发/不触发边界 + 汇总行剔除 + 排序。
import { describe, expect, it } from 'vitest'
import { buildAnomalies, isS10AggregateRow, type AnomalyInputs } from './anaData'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'

function ledger(p: Partial<AnalysisLedgerRow>): AnalysisLedgerRow {
  return {
    companyId: 1, companyName: '甲公司', year: 2025, month: 10,
    tenantId: 1, tenantName: '租户A', balancePrev: 0, receivable: 100, collected: 100, balanceEnd: 0,
    ...p,
  }
}
function s10(p: Partial<AnalysisS10Row>): AnalysisS10Row {
  return { acctMonth: '2025-10', phase: 1, tenantId: 1, tenantName: '租户A', elec: 0, water: 0, total: 100, ...p }
}
const empty: AnomalyInputs = { ledger: [], s10: [], energy: [] }

describe('规则① 收缴率<目标(公司×期)', () => {
  it('低于目标才触发;差>20pt 定 risk;数字进 detail', () => {
    const inputs: AnomalyInputs = {
      ...empty,
      ledger: [
        ledger({ companyName: '达标', receivable: 1000, collected: 990 }),        // 99% ≥ 96 → 不触发
        ledger({ companyName: '轻微', receivable: 1000, collected: 900 }),        // 90% → watch
        ledger({ companyName: '严重', receivable: 1000, collected: 500 }),        // 50% → risk(差 46pt)
      ],
    }
    const out = buildAnomalies(inputs, { collectTarget: 96 })
    expect(out.map((a) => a.title)).toEqual([
      '严重 2025-10 收缴率 50.0%', '轻微 2025-10 收缴率 90.0%',
    ])
    expect(out[0].sev).toBe('risk')
    expect(out[1].sev).toBe('watch')
    expect(out[0].detail).toContain('应收 ¥1,000')
    expect(out[0].link).toBe('/fin-cashflow')
  })

  it('阈值参数化:目标调低即不触发', () => {
    const inputs: AnomalyInputs = { ...empty, ledger: [ledger({ receivable: 1000, collected: 900 })] }
    expect(buildAnomalies(inputs, { collectTarget: 96 })).toHaveLength(1)
    expect(buildAnomalies(inputs, { collectTarget: 85 })).toHaveLength(0)
  })
})

describe('规则② 能耗环比突变 >±40%', () => {
  it('相邻自然月比,|Δ|>40 触发,≥60 定 risk;隔月缺数不比', () => {
    const inputs: AnomalyInputs = {
      ...empty,
      energy: [{
        name: '园区购电电量', unit: ' kWh',
        series: { '2025-01': 1000, '2025-02': 500, '2025-04': 2000, '2025-05': 900, '2025-06': 1050 },
        // 01→02 = −50% watch;02→04 隔月不比;04→05 = −55% watch;05→06 = +16.7% 不触发
      }],
    }
    const out = buildAnomalies(inputs, { collectTarget: 0 })
    expect(out.map((a) => a.ym)).toEqual(['2025-05', '2025-02'])
    expect(out.every((a) => a.sev === 'watch')).toBe(true)
    const risk = buildAnomalies(
      { ...empty, energy: [{ name: 'x', unit: 'kWh', series: { '2025-01': 100, '2025-02': 30 } }] },
      { collectTarget: 0 })
    expect(risk[0].sev).toBe('risk')   // −70% ≥ 60
    expect(risk[0].detail).toContain('环比 −70.0%')
  })
})

describe('规则③ s10 收入中断(最近两期)', () => {
  it('上期>0 本期无行触发;期别汇总行剔除;金额分级 sev', () => {
    const inputs: AnomalyInputs = {
      ...empty,
      s10: [
        s10({ acctMonth: '2025-07', tenantName: '大额走', total: 20000 }),   // risk
        s10({ acctMonth: '2025-07', tenantName: '中额走', total: 500 }),     // watch
        s10({ acctMonth: '2025-07', tenantName: '尾差走', total: 2 }),       // info
        s10({ acctMonth: '2025-07', tenantName: '还在', total: 300 }),
        s10({ acctMonth: '2025-07', tenantName: '202507二期', total: 999999 }),  // 汇总行剔除
        s10({ acctMonth: '2025-10', tenantName: '还在', total: 310 }),
        s10({ acctMonth: '2025-01', tenantName: '早期走', total: 888 }),     // 非最近两期,不参与
      ],
    }
    const out = buildAnomalies(inputs, { collectTarget: 0 })
    expect(out.map((a) => [a.title, a.sev])).toEqual([
      ['大额走 2025-10 无计费记录', 'risk'],
      ['中额走 2025-10 无计费记录', 'watch'],
      ['尾差走 2025-10 无计费记录', 'info'],
    ])
    expect(out[0].detail).toContain('2025-07 计费 ¥20,000')
    expect(out[0].link).toBe('/churn')
  })

  it('isS10AggregateRow 识别 YYYYMM 前缀汇总行', () => {
    expect(isS10AggregateRow('202507二期')).toBe(true)
    expect(isS10AggregateRow('火炬创新创业园')).toBe(false)
  })
})

describe('规则④ 负值行', () => {
  it('s10 合计/电/水为负 与 台账应收/实收为负 各触发一条', () => {
    const inputs: AnomalyInputs = {
      ...empty,
      s10: [s10({ acctMonth: '2025-06', tenantName: '创显宿舍', total: -936.73 })],
      ledger: [ledger({ tenantName: '易通达', companyName: '一泽', receivable: -32055.63, collected: 0 })],
    }
    const out = buildAnomalies(inputs, { collectTarget: 0 })
    expect(out).toHaveLength(2)
    const led = out.find((a) => a.type === '负值行' && a.dim === '管理公司')!
    expect(led.sev).toBe('risk')                       // |−32055| ≥ 10000
    expect(led.value).toBe('−¥32,056')
    expect(led.link).toBe('/ledger')
    const s = out.find((a) => a.dim === '租户')!
    expect(s.sev).toBe('watch')
    expect(s.link).toBe('/sales-income')
  })

  it('附10 负值行异常带 co(=该行 phase)与 tenant;台账负值行异常带 company 与 tenant', () => {
    const inputs: AnomalyInputs = {
      ...empty,
      s10: [s10({ acctMonth: '2025-06', tenantName: '创显宿舍', total: -936.73 })],
      ledger: [ledger({ tenantName: '易通达', companyName: '一泽', receivable: -32055.63, collected: 0 })],
    }
    const out = buildAnomalies(inputs, { collectTarget: 0 })
    const led = out.find((a) => a.type === '负值行' && a.dim === '管理公司')!
    expect(led.company).toBe('一泽')
    expect(led.tenant).toBe('易通达')
    const s = out.find((a) => a.dim === '租户')!
    expect(s.co).toBe(1)          // s10 夹具默认 phase: 1
    expect(s.tenant).toBe('创显宿舍')
  })
})

describe('排序', () => {
  it('risk 先于 watch 先于 info', () => {
    const inputs: AnomalyInputs = {
      ...empty,
      s10: [
        s10({ acctMonth: '2025-07', tenantName: '大额走', total: 20000 }),
        s10({ acctMonth: '2025-07', tenantName: '尾差走', total: 1 }),
        s10({ acctMonth: '2025-10', tenantName: '还在', total: 1 }),
      ],
      ledger: [ledger({ receivable: 1000, collected: 900 })],
    }
    const out = buildAnomalies(inputs, { collectTarget: 96 })
    expect(out.map((a) => a.sev)).toEqual(['risk', 'watch', 'info'])
  })
})
