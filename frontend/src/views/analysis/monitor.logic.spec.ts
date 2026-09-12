// 监控中心纯函数单测(铁律⑦):突变检测(相邻有数月/双向/上月≤0 跳过)、缺项归一、
// 风险分与分层边界、末期欠费聚合、规则 id 稳定、灰带分位、期别汇总行剔除、最差在前排序。
import { describe, expect, it } from 'vitest'
import { buildMonitorModel, detectSpikes, elecBandRef, elecReadout, tenantLedgerBars, weighScore } from './monitor.logic'
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
const OPTS = { collectTarget: 96, spikeTh: 40, riskTh: 60 }

describe('detectSpikes(相邻有数月环比突变)', () => {
  it('双向 |Δ|>阈值;上月≤0 不比', () => {
    expect(detectSpikes([100, 150, 150, 40], 40)).toEqual([
      { idx: 1, chg: 50 },
      { idx: 3, chg: (40 / 150 - 1) * 100 },
    ])
    expect(detectSpikes([0, 100], 40)).toEqual([])
    expect(detectSpikes([100], 40)).toEqual([])
  })
})

describe('weighScore(40/30/30 缺项按权重归一)', () => {
  it('单项/两项/三项/全缺', () => {
    expect(weighScore({ pay: 80, rev: null, energy: null })).toBe(80)
    expect(weighScore({ pay: 80, rev: 40, energy: null })).toBe(63)   // (0.4·80+0.3·40)/0.7
    expect(weighScore({ pay: 80, rev: 40, energy: 100 })).toBe(74)
    expect(weighScore({ pay: null, rev: null, energy: null })).toBe(0)
  })
})

describe('buildMonitorModel(评分/分层/规则/汇总卡/灰带)', () => {
  // A:欠费+营收骤降+电费激增 → risk;B:计费中断(gone)→ 顶格因子;
  // E:仅台账欠费 → watch;D:仅 s10 平稳 → normal;期别汇总行「202510二期」剔除。
  const led = [
    ledger({ tenantName: '租户A', companyName: '甲', receivable: 600, collected: 300 }),
    ledger({ tenantName: '租户A', companyName: '乙', receivable: 400, collected: 200 }),
    ledger({ tenantName: '租户B', receivable: 1000, collected: 1000 }),
    ledger({ tenantName: '租户E', receivable: 1000, collected: 550 }),
    ledger({ tenantName: '旧租户', month: 1, receivable: 999, collected: 0 }),   // 仅早期 → 不入末期口径
  ]
  const s10rows = [
    s10({ tenantName: '租户A', acctMonth: '2025-09', total: 1000, elec: 500, water: 10 }),
    s10({ tenantName: '租户A', acctMonth: '2025-10', total: 400, elec: 900, water: 10 }),
    s10({ tenantName: '租户B', acctMonth: '2025-09', total: 500, elec: 300 }),   // 末月缺席 → gone
    s10({ tenantName: '租户D', acctMonth: '2025-09', total: 100, elec: 100 }),
    s10({ tenantName: '租户D', acctMonth: '2025-10', total: 100, elec: 105 }),
    s10({ tenantName: '202510二期', acctMonth: '2025-10', total: 88888 }),        // 汇总行剔除
  ]
  const m = buildMonitorModel(led, s10rows, OPTS)
  const by = (n: string) => m.list.find((t) => t.name === n)!

  it('末期欠费:跨公司求和,公司取应收最大;旧期不计', () => {
    const a = by('租户A')
    expect(m.lastLedgerYm).toBe('2025-10')
    expect(a.recv).toBe(1000)
    expect(a.payRate).toBe(50)
    expect(a.arrears).toBe(500)
    expect(a.company).toBe('甲')
    expect(m.list.some((t) => t.name === '旧租户')).toBe(false)
    expect(m.list.some((t) => t.name === '202510二期')).toBe(false)
  })

  it('因子与评分:A=62(50/60/80);B gone → rev/energy 顶格=60;E=45;D 归一后≈3', () => {
    expect(by('租户A').parts).toEqual({ pay: 50, rev: 60, energy: 80 })
    expect(by('租户A').score).toBe(62)
    expect(by('租户B').gone).toBe(true)
    expect(by('租户B').parts).toEqual({ pay: 0, rev: 100, energy: 100 })
    expect(by('租户B').score).toBe(60)
    expect(by('租户E').parts).toEqual({ pay: 45, rev: null, energy: null })
    expect(by('租户D').score).toBe(3)   // (0.3·0+0.3·5)/0.6
  })

  it('分层边界(风险线 60):62/60 → risk;45 → watch;3 → normal;最差在前', () => {
    expect(by('租户A').tier).toBe('risk')
    expect(by('租户B').tier).toBe('risk')
    expect(by('租户E').tier).toBe('watch')
    expect(by('租户D').tier).toBe('normal')
    expect(m.list.map((t) => t.name)).toEqual(['租户A', '租户B', '租户E', '租户D'])
  })

  it('规则命中 id 稳定;突变 ≥1.5×阈值 定 risk', () => {
    const a = by('租户A')
    expect(a.rules.map((r) => r.id)).toEqual(['mon:arr:2025-10:租户A', 'mon:spike:elec:2025-10:租户A'])
    expect(a.rules[0].sev).toBe('risk')   // 收缴差 46pt > 20
    expect(a.rules[1].sev).toBe('risk')   // +80% ≥ 60%
    expect(by('租户D').rules).toEqual([])
  })

  it('汇总卡:risk/watch/欠费合计/突变户数', () => {
    expect(m.cards).toEqual({ risk: 2, watch: 1, arrearsTotal: 950, arrearsCount: 2, spikeTenants: 1 })
  })

})

// 原例(A/B/D 三户 s10rows)每月同类数远低于 20,改用独立小模型验证分位算法与 D3 门槛,
// 不动上面共用的 m/s10rows(那边有 m.list 的精确排序/构成断言,混进填户会连带弄红)。
describe('灰带 = 各月租户电费 P25/P75(线性分位;D3 门槛 <20 户不建带)', () => {
  const mkTenantElec = (n: number, ym: string, elec: number, offset = 0): AnalysisS10Row[] =>
    Array.from({ length: n }, (_, i) => s10({ tenantName: `户${offset + i}`, acctMonth: ym, elec, total: elec }))

  it('20 户按分位算出带,且 n 一并传出;同月不足 20 户 → 不建 key', () => {
    const rows = [
      ...mkTenantElec(10, '2025-09', 100),
      ...mkTenantElec(10, '2025-09', 500, 10),
      ...mkTenantElec(5, '2025-10', 999),   // 同月仅 5 户,不足 20
    ]
    const mm = buildMonitorModel([], rows, OPTS)
    expect(mm.band['2025-09']).toEqual({ p25: 100, p75: 500, n: 20 })
    expect(mm.band['2025-10']).toBeUndefined()
  })
})

describe('elecReadout(电费读数句)', () => {
  it('高于上界 / 低于下界 / 落在区间内 / 缺数据(v 为 null 或 band 缺月)→ null', () => {
    expect(elecReadout(500, { p25: 200, p75: 400 })).toBe('电费高于全园区间 ¥200~¥400')
    expect(elecReadout(100, { p25: 200, p75: 400 })).toBe('电费低于全园区间 ¥200~¥400')
    expect(elecReadout(300, { p25: 200, p75: 400 })).toBe('电费落在全园区间 ¥200~¥400')
    expect(elecReadout(null, { p25: 200, p75: 400 })).toBeNull()
    expect(elecReadout(300, undefined)).toBeNull()
  })

  it('❗n<20 时 buildMonitorModel 该月不建 band key,elecReadout 跟着自动闭嘴(不用它自己另判 n)', () => {
    const rows = Array.from({ length: 19 }, (_, i) => s10({ tenantName: `户${i}`, acctMonth: '2025-09', elec: 100, total: 100 }))
    const mm = buildMonitorModel([], rows, OPTS)
    expect(elecReadout(500, mm.band['2025-09'])).toBeNull()
  })

  // N6(对抗复查修复轮2):这条带是按全部计费租户建的,不是按可比分组 ——
  // 「同类」声称的比数据撑得住的多,句子里不许再出现这个词。
  it('❗N6:句子里不许出现「同类」—— 带是按全园全部计费租户建的,不是按可比分组', () => {
    expect(elecReadout(500, { p25: 200, p75: 400 })).not.toContain('同类')
  })
})

describe('elecBandRef(参照系小字,F2 修复轮1:只说样本量/口径/单位,不提灰带画没画)', () => {
  it('n 有值 → 样本N户;n 缺(全园不足20户)→ 不画带的话不进这句,只说不足20户', () => {
    expect(elecBandRef(251)).toBe('记账月口径 · 元 · 样本251户')
    expect(elecBandRef(null)).toBe('记账月口径 · 元 · 全园不足20户')
  })

  it('❗F1:不许出现原始列名 acct_month —— 屏上写中文「记账月」', () => {
    expect(elecBandRef(251)).not.toContain('acct_month')
    expect(elecBandRef(251)).toContain('记账月')
  })

  it('❗F2:句子里不再出现「灰带」二字 —— 带画不画不影响这句话真假', () => {
    expect(elecBandRef(251)).not.toContain('灰带')
    expect(elecBandRef(null)).not.toContain('灰带')
  })

  it('❗N6:句子里不许出现「同类」', () => {
    expect(elecBandRef(null)).not.toContain('同类')
  })
})

describe('tenantLedgerBars(应收vs实收各期,跨公司求和)', () => {
  it('按期升序对齐', () => {
    const rows = [
      ledger({ tenantName: 'A', month: 10, companyName: '甲', receivable: 600, collected: 300 }),
      ledger({ tenantName: 'A', month: 10, companyName: '乙', receivable: 400, collected: 200 }),
      ledger({ tenantName: 'A', month: 1, receivable: 100, collected: 90 }),
      ledger({ tenantName: 'B', month: 1, receivable: 7, collected: 7 }),
    ]
    expect(tenantLedgerBars(rows, 'A')).toEqual({ yms: ['2025-01', '2025-10'], recv: [100, 1000], coll: [90, 500] })
    expect(tenantLedgerBars(rows, 'C')).toEqual({ yms: [], recv: [], coll: [] })
  })
})
