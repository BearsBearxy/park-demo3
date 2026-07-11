// parkEnergy.logic.spec.ts — 桑基纯函数单测。守恒锚点用 dev 库 SQL 回验值(2026-07-08):
//   s10 覆盖月 = 2025-01/02/06/07/10;
//   购电成本 Σ=4,473,101.45(附表11 energy+basic qty*price*(1+rate))、光伏消纳 Σself_amt=1,124,467.37、
//   售电 Σ(elec_basic+elec_std+elec_maint)=6,510,495.38(剔期别汇总行)、办公 Σelec_qty*elec_price=6,265.23、
//   充电 Σcost=27,067.23 → 轧差 = 5,597,568.82 − 6,543,827.84 = −946,259.02(毛差记流入侧)。
import { describe, expect, it } from 'vitest'
import { anchorS10Ym, boardOfSankeyClick, boardSeries, buildAmtMonths, buildSankey, buildSankeyReading, comboSeries, HUB, type AmtMonth } from './parkEnergy.logic'

// dev 库 SQL 月度真值(见头注释)
const SQL_MONTHS: AmtMonth[] = [
  { ym: '2025-01', buyCost: 877041.27, pvSelfAmt: 71185.96, s10Elec: 602398.47, officeAmt: 912.29, chgCost: 1594.42 },
  { ym: '2025-02', buyCost: 731376.69, pvSelfAmt: 86636.25, s10Elec: 1127726.53, officeAmt: 1263.60, chgCost: 1494.66 },
  { ym: '2025-06', buyCost: 1018481.35, pvSelfAmt: 141538.35, s10Elec: 1413566.55, officeAmt: 1181.45, chgCost: 2210.60 },
  { ym: '2025-07', buyCost: 845573.55, pvSelfAmt: 384289.99, s10Elec: 1494888.59, officeAmt: 1366.51, chgCost: 2486.08 },
  { ym: '2025-10', buyCost: 1000628.59, pvSelfAmt: 440816.82, s10Elec: 1871915.24, officeAmt: 1541.38, chgCost: 19281.47 },
  { ym: '2025-03', buyCost: 674924.03, pvSelfAmt: 83601.31, s10Elec: null, officeAmt: 1066.44, chgCost: 2207.94 }, // 非覆盖月不入桑基
]
const COVERED = ['2025-01', '2025-02', '2025-06', '2025-07', '2025-10']

const inflow = (s: { links: { source: string; target: string; value: number }[] }) =>
  s.links.filter((l) => l.target === HUB).reduce((a, l) => a + l.value, 0)
const outflow = (s: { links: { source: string; target: string; value: number }[] }) =>
  s.links.filter((l) => l.source === HUB).reduce((a, l) => a + l.value, 0)

describe('buildSankey', () => {
  it('SQL 锚点:仅覆盖月同口径,轧差 −946,259.02(毛差记流入侧),流入=流出守恒', () => {
    const s = buildSankey(SQL_MONTHS, COVERED)!
    expect(s).not.toBeNull()
    expect(s.residual).toBeCloseTo(-946259.02, 2)
    // 各边 = SQL 聚合真值
    const link = (a: string, b: string) => s.links.find((l) => l.source === a && l.target === b)!.value
    expect(link('购电', HUB)).toBeCloseTo(4473101.45, 2)
    expect(link('光伏消纳', HUB)).toBeCloseTo(1124467.37, 2)
    expect(link('转供毛差', HUB)).toBeCloseTo(946259.02, 2)
    expect(link(HUB, '售电(转供)')).toBeCloseTo(6510495.38, 2)
    expect(link(HUB, '办公')).toBeCloseTo(6265.23, 2)
    expect(link(HUB, '充电桩')).toBeCloseTo(27067.23, 2)
    // 守恒:流入合计 ≡ 流出合计;毛差为负 → 无「损耗差额」节点
    expect(inflow(s)).toBeCloseTo(outflow(s), 6)
    expect(s.nodes.map((n) => n.name)).not.toContain('损耗差额')
  })

  it('轧差为正 → 流出侧「损耗差额」,守恒不变', () => {
    const s = buildSankey(
      [{ ym: '2025-01', buyCost: 1000, pvSelfAmt: 200, s10Elec: 800, officeAmt: 100, chgCost: 50 }],
      ['2025-01'],
    )!
    expect(s.residual).toBeCloseTo(250, 10)
    expect(s.links.find((l) => l.target === '损耗差额')!.value).toBeCloseTo(250, 10)
    expect(s.nodes.map((n) => n.name)).not.toContain('转供毛差')
    expect(inflow(s)).toBeCloseTo(outflow(s), 10)
  })

  it('选中期无 s10 → null(空态,不画假图)', () => {
    expect(buildSankey(SQL_MONTHS, ['2025-03'])).toBeNull()
    expect(buildSankey(SQL_MONTHS, [])).toBeNull()
  })
})

describe('buildSankeyReading(C6 人话句,金额取运行时数据)', () => {
  it('residual<0(毛差)→ 结尾「为转供加价收益」', () => {
    const s = buildSankey(SQL_MONTHS, COVERED)!
    expect(buildSankeyReading(s)).toBe(
      '本期园区买电 ¥447.3万,光伏自用 ¥112.4万;向租户售电 ¥651.0万,办公/充电自用 ¥3.3万;差额 ¥94.6万 为转供加价收益')
  })

  it('residual>0(损耗)→ 结尾「为线损与未计口径」', () => {
    const s = buildSankey(
      [{ ym: '2025-01', buyCost: 2_000_000, pvSelfAmt: 500_000, s10Elec: 1_500_000, officeAmt: 200_000, chgCost: 100_000 }],
      ['2025-01'],
    )!
    expect(buildSankeyReading(s)).toBe(
      '本期园区买电 ¥200.0万,光伏自用 ¥50.0万;向租户售电 ¥150.0万,办公/充电自用 ¥30.0万;差额 ¥70.0万 为线损与未计口径')
  })
})

describe('buildAmtMonths', () => {
  it('各源金额并入目标年逐月;缺源 = null 不补 0;跨年行剔除', () => {
    const out = buildAmtMonths(2025,
      { energy: { rows: [{ acctMonth: '2025-01', total: 100 }, { acctMonth: '2024-12', total: 999 }] }, basic: { rows: [{ acctMonth: '2025-01', total: 50 }] } },
      [{ acctMonth: '2025-01', selfAmt: 30 }],
      [{ rows: [{ acctMonth: '2025-01', cost: 7 }] }, { rows: [{ acctMonth: '2025-02', cost: 3 }] }],
      [{ rows: [{ acctMonth: '2025-01', elecAmt: 5 }] }],
      [{ acctMonth: '2025-01', elec: 200 }, { acctMonth: '2025-01', elec: 40 }],
    )
    expect(out.map((m) => m.ym)).toEqual(['2025-01', '2025-02'])
    expect(out[0]).toEqual({ ym: '2025-01', buyCost: 150, pvSelfAmt: 30, s10Elec: 240, officeAmt: 5, chgCost: 7 })
    expect(out[1]).toEqual({ ym: '2025-02', buyCost: null, pvSelfAmt: null, s10Elec: null, officeAmt: null, chgCost: 3 })
  })
})

describe('anchorS10Ym(§五策略2 桑基月锚)', () => {
  it('命中覆盖月 → 原月;缺月 → ≤所选最近;更早无 → 最早覆盖月;全无 → null', () => {
    expect(anchorS10Ym(COVERED, '2025-06')).toBe('2025-06')       // 命中不回退
    expect(anchorS10Ym(COVERED, '2025-03')).toBe('2025-02')       // 回退最近覆盖月
    expect(anchorS10Ym(COVERED, '2025-12')).toBe('2025-10')       // 尾部回退
    expect(anchorS10Ym(['2025-06'], '2025-01')).toBe('2025-06')   // 更早无 → 最早覆盖月
    expect(anchorS10Ym([], '2025-01')).toBeNull()                 // 年内无 s10 → 空态
  })
})

describe('comboSeries(T4 购售电组合:双柱分组/环比只叠购电/预算只留购电月均)', () => {
  const buy = [10, 20, null, 30]
  const sell = [5, null, null, 15]   // 稀疏售电(仅 s10 覆盖月)
  const names = (s: object[]) => s.map((x) => (x as { name: string }).name)

  it('基础:购电/售电均为柱(稀疏月自然缺柱),数据原样', () => {
    const s = comboSeries(buy, sell, 'none', null)
    expect(names(s)).toEqual(['购电成本', '售电收入'])
    expect(s.map((x) => (x as { type: string }).type)).toEqual(['bar', 'bar'])
    expect((s[1] as { data: (number | null)[] }).data).toEqual(sell)
  })

  it('环比:只叠「购电成本·上月」(无售电·上月线),数据 = 购电右移一位', () => {
    const s = comboSeries(buy, sell, 'mom', null)
    expect(names(s)).toEqual(['购电成本', '售电收入', '购电成本·上月'])
    expect((s[2] as { data: (number | null)[] }).data).toEqual([null, 10, 20, null])
  })

  it('预算:只留「购电预算·月均」(售电预算线移除),月均 = 年额/12 万元;无预算不画线', () => {
    const s = comboSeries(buy, sell, 'budget', 1_200_000)
    expect(names(s)).toEqual(['购电成本', '售电收入', '购电预算·月均'])
    expect((s[2] as { data: (number | null)[] }).data).toEqual([10, 10, 10, 10])
    expect(names(comboSeries(buy, sell, 'budget', null))).toEqual(['购电成本', '售电收入'])
  })
})

describe('boardOfSankeyClick / boardSeries', () => {
  it('点边取非中枢端;点节点按名映射;中枢/未知 → null', () => {
    expect(boardOfSankeyClick({ dataType: 'edge', data: { source: HUB, target: '办公' } })).toBe('office')
    expect(boardOfSankeyClick({ dataType: 'edge', data: { source: '购电', target: HUB } })).toBe('buy')
    expect(boardOfSankeyClick({ dataType: 'node', name: '转供毛差' })).toBe('residual')
    expect(boardOfSankeyClick({ dataType: 'node', name: HUB })).toBeNull()
    expect(boardOfSankeyClick({})).toBeNull()
  })

  it('boardSeries:普通板块取非 null 月;residual 仅 s10 覆盖月轧差', () => {
    const s10 = boardSeries(SQL_MONTHS, 's10')
    expect(s10.yms).toEqual(COVERED.slice().sort())
    const res = boardSeries(SQL_MONTHS, 'residual')
    expect(res.yms).toEqual(COVERED.slice().sort())
    // 2025-10 轧差 = (1000628.59+440816.82) − (1871915.24+1541.38+19281.47) = −451,292.68(SQL 回验)
    expect(res.values[res.yms.indexOf('2025-10')]).toBeCloseTo(-451292.68, 2)
    const buy = boardSeries(SQL_MONTHS, 'buy')
    expect(buy.yms.length).toBe(6)   // 含非覆盖 3 月(购电有值)
  })
})
