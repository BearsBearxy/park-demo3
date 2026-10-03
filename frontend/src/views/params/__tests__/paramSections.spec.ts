// 计费参数六区纯逻辑(paramSections.ts):深链落点五条、本月改动按项去重、池名拆位置 + 名字、对象表格子短文字。
import { describe, it, expect } from 'vitest'
import type { ParamChangeDTO, ParamRowDTO } from '@/api/params'
import { cellText, changeStats, landingOf, poolName, secOf, tenantGroups, verLabel } from '../paramSections'

const r = (p: Partial<ParamRowDTO>): ParamRowDTO => ({
  key: 'x', label: '', unit: '', group: 'constant', scope: '', scopeLabel: '', value: 1, valueText: '1', mode: 'from', acctMonth: '',
  rangeText: '长期', sourceChain: [], formula: null, hint: null, editable: true, monthlyCheck: false, hasMonthRow: false, rowId: 1, note: null, ...p,
})

describe('landingOf 深链落点(画布 10-B 板下半)', () => {
  // 破坏验证:rule 分支挪到 section 判断之后 → 第一条红(落到全园与期级)
  it.each([
    [{ section: 'constant', rule: '23' }, { sec: 'pool', rule: 23, key: 'coefficient' }],
    [{ section: 'monthly', rule: '23' }, { sec: 'pool', rule: 23, key: 'extra_qty' }],
    // 公共电核算「取整位」那颗链带 key:闪取整位那一格,不是分摊基数;key 不是池参数的照 section 落
    [{ section: 'constant', rule: '23', key: 'round_scale' }, { sec: 'pool', rule: 23, key: 'round_scale' }],
    [{ section: 'constant', rule: '23', key: 'mgmt_fee' }, { sec: 'pool', rule: 23, key: 'coefficient' }],
    [{ section: 'constant', adopt: '2026-12' }, { sec: 'pv' }],
    [{ section: 'monthly' }, { sec: 'park', group: 'monthly' }],
    [{ section: 'constant' }, { sec: 'park', group: 'constant' }],
    [{ section: 'rule' }, { sec: 'loss' }],
    [{ section: 'loss' }, { sec: 'loss' }],
    [{ section: 'loss', building: '13', key: 'loss_adj_rate' }, { sec: 'loss', building: 13, key: 'loss_adj_rate' }],
    [{ section: 'loss', building: '13' }, { sec: 'loss', building: 13, key: '' }],
    [{ section: 'loss', building: 'x' }, { sec: 'loss' }],
    [{ section: 'pv' }, { sec: 'pv' }],
    [{ section: 'changes' }, { sec: 'changes' }],
    [{ edit: '1' }, { sec: 'park' }],
    [{ section: 'rule:23' }, { sec: 'park' }],
    [{ rule: 'abc' }, { sec: 'park' }],
  ])('%j → %j', (q, want) => expect(landingOf(q)).toEqual(want))
})

describe('secOf 行归区', () => {
  it.each([
    ['mgmt_fee', 'tenant:5', 'tenant'], ['coefficient', 'rule:23', 'pool'], ['loss_adj_qty', 'building:13', 'loss'],
    ['loss_exclude', 'meter:307', 'loss'], ['pv_band_sigma', '', 'pv'], ['elec_peak', '', 'park'], ['loss_supply_meter', 'p1', 'park'],
  ])('%s @ %s → %s', (k, s, want) => expect(secOf(k, s)).toBe(want))
})

describe('changeStats 本月改动', () => {
  // 破坏验证:items 改成按次数 → 第一条红
  it('一项 = 一个 (作用域, 键),改两次算一项;重算不算;池结构改动(key 空)算那个池的一项', () => {
    const c = (p: Partial<ParamChangeDTO>): ParamChangeDTO => ({
      ts: '', actor: 'a', action: 'set', acctMonth: '', mode: 'from', oldValue: null, newValue: null, oldText: null, newText: null, note: null, ...p,
    })
    const s = changeStats([
      c({ action: 'recalc' }),
      c({ key: 'elec_peak', scope: '' }), c({ key: 'elec_peak', scope: '' }),
      c({ key: 'mgmt_fee', scope: 'tenant:5' }),
      c({ key: '', scope: 'rule:24' }),
      c({ key: 'loss_exclude', scope: 'meter:307' }),
      c({ key: 'area', scope: 'unit:54' }),
    ])
    expect(s.items.size).toBe(4)
    expect(s.times).toBe(5)
    expect(s.bySec).toEqual({ park: 1, pool: 1, loss: 1, tenant: 1, pv: 0 })
    expect([...s.scopes].sort()).toEqual(['', 'meter:307', 'rule:24', 'tenant:5'])
  })
})

describe('格子文字', () => {
  it('池名拆位置灰字 + 名字;期前缀去掉', () => {
    expect(poolName('一期 A座·三楼西侧·公共用电（池）')).toEqual({ loc: 'A座·三楼西侧', name: '公共用电' })
    expect(poolName('一期园区·路灯（池）')).toEqual({ loc: '园区', name: '路灯' })
    expect(poolName('宿舍区·绿化水（池）')).toEqual({ loc: '宿舍区', name: '绿化水' })
    expect(poolName('孤池')).toEqual({ loc: '', name: '孤池' })
  })
  it('对象表短文字:带符号的调整量、百分数率、取整位、口径缩短、未生效为空', () => {
    expect(cellText(r({ key: 'loss_adj_qty', unit: '度', value: 300, valueText: '300 度' }))).toBe('+300')
    expect(cellText(r({ key: 'extra_qty', unit: '度', value: -670, valueText: '-670 度' }))).toBe('-670')
    expect(cellText(r({ key: 'loss_adj_rate', unit: '比率', value: 0.003, valueText: '0.003 比率' }))).toBe('0.30%')
    expect(cellText(r({ key: 'round_scale', valueText: '四舍五入到 3 位' }))).toBe('3 位')
    expect(cellText(r({ key: 'loss_variant', valueText: '仅按公摊分摊度数（率 = …）' }))).toBe('仅按公摊分摊度数')
    expect(cellText(r({ key: 'loss_head', valueText: '并入「二期 三车间」核算' }))).toBe('并入 三车间')
    expect(cellText(r({ key: 'loss_c_meter', valueText: '仅「A座总电」' }))).toBe('A座总电')
    expect(cellText(r({ key: 'coefficient', mode: null, valueText: '' }))).toBe('')
  })
  it('版本短名', () => {
    expect([verLabel('month', '2024-02'), verLabel('from', '2024-02'), verLabel('from', '')]).toEqual(['仅 2024-02', '2024-02 起', '长期'])
  })
  it('户级例外只收该户自己的版本行,按户分组,组序 = 行序', () => {
    const gs = tenantGroups([
      r({ scope: 'tenant:6', scopeLabel: '永龙（户）', key: 'a' }), r({ scope: 'tenant:5', scopeLabel: '力灏（户）', key: 'b' }),
      r({ scope: 'tenant:6', scopeLabel: '永龙（户）', key: 'c' }), r({ scope: 'tenant:5', scopeLabel: '力灏（户）', key: 'd', rowId: null }),
    ])
    expect(gs.map(g => [g.name, g.id, g.rows.map(x => x.key)])).toEqual([['永龙', 6, ['a', 'c']], ['力灏', 5, ['b']]])
  })
})
