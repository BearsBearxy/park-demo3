// 异常提醒中心纯函数单测(铁律⑦):突变检测(相邻自然月/双向/上月≤0 跳过)、没数的项记 0、
// 风险分与分层边界、末期未收聚合、规则 id 稳定、灰带分位、期别汇总行剔除、清单按未收从多到少(不分组)、
// 默认选中、底部两张计数卡、电量到哪个月。
import { describe, expect, it } from 'vitest'
import { buildMonitorModel, coSummary, defaultPick, detectSpikes, energyAsof, nrgSummary, owedYuan, weighScore } from './monitor.logic'
import * as S from '@/components/ana/anaSentence'
import { buildAnomalies, type EnergySeries } from '@/analysis/anaData'
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

describe('detectSpikes(环比突变)', () => {
  it('双向 |Δ|>阈值;上月≤0 不比;不给月份 = 数组相邻两项照比', () => {
    expect(detectSpikes([100, 150, 150, 40], 40)).toEqual([
      { idx: 1, chg: 50 },
      { idx: 3, chg: (40 / 150 - 1) * 100 },
    ])
    expect(detectSpikes([0, 100], 40)).toEqual([])
    expect(detectSpikes([100], 40)).toEqual([])
  })

  it('给了月份只比相邻自然月:隔着缺月的那一对不比(av2-ask 4);跨年 12→1 月照比', () => {
    const months = ['2024-12', '2025-01', '2025-02', '2025-06', '2025-07']
    // 12→1 +100%、1→2 +50%、2→6 隔了 3–5 月 +100% 不比、6→7 −75%
    expect(detectSpikes([100, 200, 300, 600, 150], 40, months)).toEqual([
      { idx: 1, chg: 100 },
      { idx: 2, chg: 50 },
      { idx: 4, chg: -75 },
    ])
  })
})

describe('weighScore(40/30/30;没数的项记 0,不再按其余项归一放大)', () => {
  it('单项/两项/三项/全缺', () => {
    expect(weighScore({ pay: 100, rev: null, energy: null })).toBe(40)   // 原来归一 = 100:只有台账、一分没收就满分
    expect(weighScore({ pay: 80, rev: 40, energy: null })).toBe(44)      // 0.4·80+0.3·40
    expect(weighScore({ pay: 80, rev: 40, energy: 100 })).toBe(74)
    expect(weighScore({ pay: null, rev: null, energy: null })).toBe(0)
  })
})

describe('buildMonitorModel(评分/分层/规则/汇总卡/灰带)', () => {
  // A:未收+营收骤降+电费激增 → risk;B:计费中断(gone)→ 收入、能耗两项按没数记 0(10-05 第二轮,原来顶格 100)= 0 → normal;
  // F:只有台账、10月一分没收 → 40 → watch(原来归一成 100);E:只有台账、收了 55% → 18 → normal;
  // H:gone + 10月一分没收 → 40 → watch;D:只有 s10 平稳 → normal;G:s10 隔着 9 月(8→10 月)→ 不算突变、不算涨跌;期别汇总行「202510二期」剔除。
  const led = [
    ledger({ tenantName: '租户A', companyName: '甲', receivable: 600, collected: 300 }),
    ledger({ tenantName: '租户A', companyName: '乙', receivable: 400, collected: 200 }),
    ledger({ tenantName: '租户A', month: 9, receivable: 900, collected: 900 }),
    ledger({ tenantName: '租户B', receivable: 1000, collected: 1000 }),
    ledger({ tenantName: '租户E', receivable: 1000, collected: 550 }),
    ledger({ tenantName: '租户F', receivable: 800, collected: 0 }),
    ledger({ tenantName: '租户H', receivable: 100, collected: 0 }),
    ledger({ tenantName: '旧租户', month: 1, receivable: 999, collected: 0 }),   // 仅早期 → 不入末期口径
  ]
  const s10rows = [
    s10({ tenantName: '租户A', acctMonth: '2025-09', total: 1000, elec: 500, water: 10 }),
    s10({ tenantName: '租户A', acctMonth: '2025-10', total: 400, elec: 900, water: 10 }),
    s10({ tenantName: '租户B', acctMonth: '2025-09', total: 500, elec: 300 }),   // 末月缺席 → gone
    s10({ tenantName: '租户H', acctMonth: '2025-09', total: 50, elec: 30 }),     // gone + 一分没收 → 40 分(停了的两项按没数)
    s10({ tenantName: '租户D', acctMonth: '2025-09', total: 100, elec: 100 }),
    s10({ tenantName: '租户D', acctMonth: '2025-10', total: 100, elec: 105 }),
    s10({ tenantName: '租户G', acctMonth: '2025-08', total: 100, elec: 100, water: 10 }),
    s10({ tenantName: '租户G', acctMonth: '2025-10', total: 50, elec: 300, water: 40 }),   // 隔着 9 月:+200% 不算
    s10({ tenantName: '202510二期', acctMonth: '2025-10', total: 88888 }),        // 汇总行剔除
  ]
  const m = buildMonitorModel(led, s10rows, OPTS)
  const by = (n: string) => m.list.find((t) => t.name === n)!

  it('末期未收:跨公司求和,公司取应收最大;旧期不计;每户有台账的月', () => {
    const a = by('租户A')
    expect(m.lastLedgerYm).toBe('2025-10')
    expect(a.recv).toBe(1000)
    expect(a.payRate).toBe(50)
    expect(a.arrears).toBe(500)
    expect(a.company).toBe('甲')
    expect(a.ledYms).toEqual(['2025-09', '2025-10'])
    expect(by('租户D').ledYms).toEqual([])
    expect(m.list.some((t) => t.name === '旧租户')).toBe(false)
    expect(m.list.some((t) => t.name === '202510二期')).toBe(false)
    expect(m.s10Months).toEqual(['2025-08', '2025-09', '2025-10'])
  })

  it('因子与评分:A=62(50/60/80);B gone → 后两项按没数 = 0;H gone 一分没收 = 40;F 只有台账没收 = 40;E = 18;D ≈ 2', () => {
    expect(by('租户A').parts).toEqual({ pay: 50, rev: 60, energy: 80 })
    expect(by('租户A').score).toBe(62)
    expect(by('租户B').gone).toBe(true)
    expect(by('租户B').parts).toEqual({ pay: 0, rev: null, energy: null })
    expect(by('租户B').score).toBe(0)
    expect(by('租户H').score).toBe(40)
    expect(by('租户F').parts).toEqual({ pay: 100, rev: null, energy: null })
    expect(by('租户F').score).toBe(40)
    expect(by('租户E').parts).toEqual({ pay: 45, rev: null, energy: null })
    expect(by('租户E').score).toBe(18)
    expect(by('租户D').score).toBe(2)   // 0.3·0 + 0.3·5 = 1.5
  })

  it('隔着缺月不比:G 8→10 月电费 +200% 不算突变,收入降幅、电费涨跌都没数', () => {
    const g = by('租户G')
    expect(g.spikes).toEqual([])
    expect(g.revMom).toBeNull()
    expect(g.elecMom).toBeNull()
    expect(g.parts).toEqual({ pay: null, rev: null, energy: null })
    expect(g.score).toBe(0)
  })

  it('分层边界(风险线 60):62 → risk;40 → watch;18 / 0 → normal;清单不分组,整张按未收从多到少,未收一样按分数', () => {
    expect(by('租户A').tier).toBe('risk')
    expect(by('租户B').tier).toBe('normal')
    expect(by('租户F').tier).toBe('watch')
    expect(by('租户H').tier).toBe('watch')
    expect(by('租户E').tier).toBe('normal')
    expect(by('租户D').tier).toBe('normal')
    // 未收:F 800 > A 500(分数更高也排在后面)> E 450 > H 100;没未收的 D(2)、B(0)、G(0)按分数,同分按名字
    expect(m.list.map((t) => t.name)).toEqual(['租户F', '租户A', '租户E', '租户H', '租户D', '租户B', '租户G'])
  })

  it('规则命中 id 稳定;突变 ≥1.5×阈值 定 risk', () => {
    const a = by('租户A')
    expect(a.rules.map((r) => r.id)).toEqual(['mon:arr:2025-10:租户A', 'mon:spike:elec:2025-10:租户A'])
    expect(a.rules[0].sev).toBe('risk')   // 收缴差 46pt > 20
    expect(a.rules[1].sev).toBe('risk')   // +80% ≥ 60%
    expect(by('租户D').rules).toEqual([])
  })

  it('汇总卡:risk/watch/欠费合计/突变户数', () => {
    expect(m.cards).toEqual({ risk: 1, watch: 2, arrearsTotal: 1850, arrearsCount: 4, spikeTenants: 1 })
  })

  it('默认选中:清单第一户有数据的(收缴率有、电费 2 个月以上、台账 2 期以上);都没有就第一户', () => {
    expect(defaultPick(m.list)?.name).toBe('租户A')
    expect(defaultPick(m.list.filter((t) => t.name !== '租户A'))?.name).toBe('租户F')   // 都不够数 → 第一户
    expect(defaultPick([])).toBeNull()
  })
})

describe('清单排序按整元未收(不足 ¥1 当 0)', () => {
  it('只差几毛钱的户不排到高风险户前面;行内不写「收了 100.0%」', () => {
    const m2 = buildMonitorModel([
      ledger({ tenantName: '差一毛', receivable: 1000, collected: 999.6 }),
      ledger({ tenantName: '高分没欠', receivable: 0, collected: 0 }),
      ledger({ tenantName: '欠两块', receivable: 1000, collected: 998 }),
    ], [
      s10({ tenantName: '高分没欠', acctMonth: '2025-09', total: 1000, elec: 100 }),
      s10({ tenantName: '高分没欠', acctMonth: '2025-10', total: 100, elec: 400 }),
      s10({ tenantName: '差一毛', acctMonth: '2025-10', total: 100, elec: 100 }),
    ], OPTS)
    expect(m2.list.map((t) => t.name)).toEqual(['欠两块', '高分没欠', '差一毛'])
    const t = m2.list.find((x) => x.name === '差一毛')!
    expect(owedYuan(t)).toBe(0)
    expect(S.rowSub(t, { ledYm: '2025-10', spikeTh: 40, ledYms: new Set(t.ledYms) })).not.toContain('收了')
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

describe('底部两张计数卡 + 电量到哪个月', () => {
  it('收缴率没到目标的公司:一家一行,n = 没到的期数,of = 应收 > 0 的期数,last = 最近一次;没到的多的在前', () => {
    const led = [
      ledger({ companyName: '甲', month: 9, receivable: 100, collected: 50 }),    // 50%
      ledger({ companyName: '甲', month: 10, receivable: 100, collected: 100 }),
      ledger({ companyName: '乙', month: 9, receivable: 100, collected: 50 }),
      ledger({ companyName: '乙', month: 10, receivable: 100, collected: 60 }),
      ledger({ companyName: '乙', month: 8, receivable: 0, collected: 0 }),        // 应收 0 的期不算进 of
    ]
    const rows = coSummary(buildAnomalies({ ledger: led, s10: [], energy: [] }, { collectTarget: 96 }), led)
    expect(rows.map((r) => [r.name, r.n, r.of, r.last.ym, r.last.value])).toEqual([
      ['乙', 2, 2, '2025-10', '60.0%'],
      ['甲', 1, 2, '2025-09', '50.0%'],
    ])
  })

  it('园区电量变动:门槛跟设置走;一项一行;隔着缺月不比;没命中的项不出行', () => {
    const energy: EnergySeries[] = [
      { name: '购电', unit: 'kWh', series: { '2025-01': 100, '2025-02': 200, '2025-03': 100, '2025-05': 500 } },
      { name: '充电', unit: 'kWh', series: { '2025-01': 100, '2025-02': 150 } },
    ]
    const at = (th: number) => nrgSummary(buildAnomalies({ ledger: [], s10: [], energy }, { collectTarget: 96, spikeTh: th }), energy)
      .map((r) => [r.name, r.n, r.last.ym])
    expect(at(40)).toEqual([['购电', 2, '2025-03'], ['充电', 1, '2025-02']])
    expect(at(60)).toEqual([['购电', 1, '2025-02']])   // +100% 过 60,−50% 不过
  })

  it('电量到哪个月:多数序列的最后一个月;比它晚的几项、到哪个月', () => {
    const e = (last: string) => ({ name: last, unit: 'kWh', series: { '2025-11': 1, [last]: 1 } })
    expect(energyAsof([e('2025-12'), e('2025-12'), e('2026-01')])).toEqual({ ym: '2025-12', later: { n: 1, ym: '2026-01' } })
    expect(energyAsof([e('2025-12')])).toEqual({ ym: '2025-12', later: null })
    expect(energyAsof([])).toBeNull()
  })
})
