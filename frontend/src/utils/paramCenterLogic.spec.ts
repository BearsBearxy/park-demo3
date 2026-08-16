import { describe, expect, it } from 'vitest'
import {
  copyPrevMonthKeys, forbiddenText, groupRows, pendingSummary, prevYm, rangeBadge, sourceLabel, staleText,
  type ParamRow, type ParamStatus,
} from './paramCenterLogic'

let id = 0
const row = (p: Partial<ParamRow> & Pick<ParamRow, 'key' | 'group' | 'scope' | 'scopeLabel'>): ParamRow => ({
  label: p.key, unit: '', value: 1, valueText: '1', mode: 'from', acctMonth: '', rangeText: '长期（初始版本）',
  sourceChain: [`${p.scopeLabel}:1`], formula: null, hint: null, editable: true, monthlyCheck: false,
  hasMonthRow: false, rowId: ++id, note: null, ...p,
})

describe('groupRows 四区分配(spec §5.1)', () => {
  it('monthly/constant 按 group;rule 按作用范围折叠;tenant: 作用域一律归 ④(即使键的主场是常数)', () => {
    const rows: ParamRow[] = [
      row({ key: 'elec_peak', group: 'monthly', scope: '', scopeLabel: '全园' }),
      row({ key: 'loss_adj_qty', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座' }),
      row({ key: 'mgmt_fee', group: 'constant', scope: '', scopeLabel: '全园' }),
      row({ key: 'mgmt_fee', group: 'constant', scope: 'tenant:5', scopeLabel: '力灏' }),
      row({ key: 'coefficient', group: 'constant', scope: 'rule:23', scopeLabel: '招商中心净电（池）' }),
      row({ key: 'loss_variant', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座' }),
      row({ key: 'loss_denom_cable', group: 'rule', scope: 'p2', scopeLabel: '二期' }),
      row({ key: 'loss_recon', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座' }),
      row({ key: 'elec_package', group: 'tenant', scope: 'tenant:9', scopeLabel: '鑫皇' }),
    ]
    const g = groupRows(rows)
    expect(g.monthly.map(r => r.key)).toEqual(['elec_peak', 'loss_adj_qty'])
    expect(g.constant.map(r => r.key)).toEqual(['mgmt_fee', 'coefficient'])
    expect(g.tenant.map(r => `${r.scope}/${r.key}`)).toEqual(['tenant:5/mgmt_fee', 'tenant:9/elec_package'])
    // ③ 同一栋的两条并到一组,组顺序按首现;非相邻同标签仍归同组
    expect(g.rule.map(x => x.scopeLabel)).toEqual(['一期 B座', '二期'])
    expect(g.rule[0].rows.map(r => r.key)).toEqual(['loss_variant', 'loss_recon'])
    expect(g.rule[1].rows.map(r => r.key)).toEqual(['loss_denom_cable'])
  })
  it('空输入四区皆空', () => {
    expect(groupRows([])).toEqual({ monthly: [], constant: [], rule: [], tenant: [] })
  })
})

describe('rangeBadge 三态(spec §5.2 生效区间)', () => {
  const base = { key: 'extra_qty', group: 'monthly' as const, scope: 'rule:23', scopeLabel: '招商中心净电（池）' }
  it('month 行 → 仅 X 月', () => {
    expect(rangeBadge(row({ ...base, mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02' })))
      .toEqual({ text: '仅 2024-02', tone: 'month' })
  })
  it('from 行 → X 起长期 / 区间 / 初始版本', () => {
    expect(rangeBadge(row({ ...base, mode: 'from', acctMonth: '2023-11', rangeText: '2023-11 起长期' })))
      .toEqual({ text: '2023-11 起长期', tone: 'from' })
    expect(rangeBadge(row({ ...base, mode: 'from', acctMonth: '', rangeText: '长期（初始版本）' })))
      .toEqual({ text: '长期（初始版本）', tone: 'from' })
    expect(rangeBadge(row({ ...base, mode: 'from', acctMonth: '2023-08', rangeText: '2023-08 ~ 2023-10' })).tone).toBe('from')
  })
  it('无命中行(默认语义,mode 空) → inherit;文案取后端 rangeText,空则「未设置」', () => {
    expect(rangeBadge(row({ ...base, mode: null, acctMonth: '', rangeText: '', rowId: null, sourceChain: [] })))
      .toEqual({ text: '未设置', tone: 'inherit' })
    expect(rangeBadge(row({ ...base, mode: null, rangeText: '沿用默认', rowId: null })))
      .toEqual({ text: '沿用默认', tone: 'inherit' })
  })
})

describe('sourceLabel 「来自」列(spec §5.2 命中链尾)', () => {
  const base = { key: 'mgmt_fee', group: 'constant' as const }
  it('首项作用域 == 本行 → 本栋/本池/本期设定;全园 → 全园默认', () => {
    expect(sourceLabel(row({ ...base, scope: 'building:13', scopeLabel: '一期 A座', sourceChain: ['一期 A座:0.16 元/度', '全园:0.16 元/度'] }))).toBe('本栋设定')
    expect(sourceLabel(row({ ...base, scope: 'rule:23', scopeLabel: '招商中心净电（池）', sourceChain: ['招商中心净电（池）:-670 度'] }))).toBe('本池设定')
    expect(sourceLabel(row({ ...base, scope: 'p1', scopeLabel: '一期', sourceChain: ['一期:80000 ㎡'] }))).toBe('本期设定')
    expect(sourceLabel(row({ ...base, scope: '', scopeLabel: '全园', sourceChain: ['全园:0.16 元/度'] }))).toBe('全园默认')
  })
  it('首项来自上级 → 继承X / 全园默认', () => {
    expect(sourceLabel(row({ ...base, scope: 'building:20', scopeLabel: '一期 B座', sourceChain: ['一期:0.003 比率', '全园:0.003 比率'] }))).toBe('继承一期')
    expect(sourceLabel(row({ ...base, scope: 'building:20', scopeLabel: '一期 B座', sourceChain: ['全园:0.16 元/度'] }))).toBe('全园默认')
  })
  it('户级例外带「覆盖 上级值」;无链 → 未设置', () => {
    expect(sourceLabel(row({ ...base, scope: 'tenant:5', scopeLabel: '力灏（户）', sourceChain: ['力灏（户）:0.15 元/度', '全园:0.16 元/度'] }))).toBe('户级例外（覆盖 全园 0.16 元/度）')
    expect(sourceLabel(row({ ...base, scope: 'tenant:5', scopeLabel: '力灏（户）', sourceChain: ['力灏（户）:0.15 元/度'] }))).toBe('户级例外')
    expect(sourceLabel(row({ ...base, scope: 'building:20', scopeLabel: '一期 B座', sourceChain: [] }))).toBe('未设置')
  })
})

describe('forbiddenText 页面禁词(spec §5.2 / §8.4)', () => {
  it.each(['building:13', 'rule:23', 'meter:307', 'tenant:5', 'p1', 'p2', 'dorm', '默认·所有月份', '组C只取此总表 building:13 默认·所有月份'])(
    '「%s」→ 禁', s => expect(forbiddenText(s)).toBe(true))
  it.each(['一期 B座', '招商中心净电（池）', '仅 2024-02', '2023-11 起长期', '长期（初始版本）', '', '损耗按纯公摊算（率 = 公摊度数 ÷ 总表 + 加点）'])(
    '「%s」→ 放行', s => expect(forbiddenText(s)).toBe(false))
})

describe('pendingSummary 状态条文案(spec §5.1 / §5.5)', () => {
  const st = (p: Partial<ParamStatus> = {}): ParamStatus => ({
    priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
    poolSnapshotAt: '2026-08-16T14:02:11', billBatchAt: '2026-08-16T14:03:40', stale: false, otherMonthsAffected: [], ...p,
  })
  it('一致:电价齐 + 快照与参数一致 + 生成时间', () => {
    expect(pendingSummary(st())).toBe('本月电价 6/6 ✓ · 快照与参数一致 ✓ 生成于 08-16 14:02')
  })
  it('过期:参数已改 N 项 + 旧快照警告', () => {
    expect(pendingSummary(st({ pendingChanges: 3, stale: true })))
      .toBe('本月电价 6/6 ✓ · 参数已改 3 项，池核算 / 楼栋损耗 / 催缴单为旧快照 ⚠')
  })
  it('电价缺项', () => {
    expect(pendingSummary(st({ priceOk: 4 }))).toContain('本月电价 4/6 ⚠ 缺 2 项')
  })
  it('本月尚未生成快照', () => {
    expect(pendingSummary(st({ poolSnapshotAt: null, billBatchAt: null }))).toBe('本月电价 6/6 ✓ · 本月尚未生成池核算')
  })
  it('其它月份受 from 影响 → 提示切月重算', () => {
    expect(pendingSummary(st({ pendingChanges: 1, stale: true, otherMonthsAffected: ['2024-02', '2024-03'] })))
      .toBe('本月电价 6/6 ✓ · 参数已改 1 项，池核算 / 楼栋损耗 / 催缴单为旧快照 ⚠ · 另有 2024-02、2024-03 也受影响，请切到该月重算')
  })
})

describe('staleText 其它三屏 stale 条(spec §5.5.3:池屏看池快照,催缴单看批次)', () => {
  const st = (p: Partial<ParamStatus> = {}): ParamStatus => ({
    priceOk: 6, priceTotal: 6, pendingChanges: 1, lastChangeAt: '2026-08-16T15:30:00',
    poolSnapshotAt: '2026-08-16T14:02:11', billBatchAt: '2026-08-16T14:03:40', stale: true, otherMonthsAffected: [], ...p,
  })
  it('改动晚于池快照 → 池屏文案', () => {
    expect(staleText(st(), 'pool')).toBe('参数于 08-16 15:30 更新，本屏为旧快照')
  })
  it('池已重生成、催缴单未重生成 → 池屏一致,催缴单屏仍旧', () => {
    const s = st({ poolSnapshotAt: '2026-08-16T15:31:00' })
    expect(staleText(s, 'pool')).toBe('')
    expect(staleText(s, 'bill')).not.toBe('')
  })
  it('未生成 / 从未改过参数 / 状态接口不可用 → 不算旧', () => {
    expect(staleText(st({ poolSnapshotAt: null }), 'pool')).toBe('')
    expect(staleText(st({ lastChangeAt: null }), 'bill')).toBe('')
    expect(staleText(null, 'pool')).toBe('')
  })
})

describe('copyPrevMonthKeys / prevYm(复制上月电价)', () => {
  it('电价 6 键(注册表里默认 month 的裸电价键)', () => {
    expect([...copyPrevMonthKeys()].sort()).toEqual(
      ['elec_commercial', 'elec_flat', 'elec_peak', 'elec_resident', 'elec_sharp', 'elec_valley'])
  })
  it('prevYm 跨年', () => {
    expect(prevYm('2024-02')).toBe('2024-01')
    expect(prevYm('2024-01')).toBe('2023-12')
    expect(prevYm('2023-10')).toBe('2023-09')
  })
})
