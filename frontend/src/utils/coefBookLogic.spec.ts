import { describe, expect, it } from 'vitest'
import type { PriceCfgDTO } from '@/api/priceCfg'
import { groupByBuilding } from './billNoticeLogic'
import {
  COEF_KEYS, buildCoefRows, buildFloorPlan, buildPricePlan, coefMeta, floorMemberships,
  floorStashAfter, poolsOfFeeKey, resolveCoefPrice,
  type CoefPoolIn, type CoefRuleIn, type CoefStash,
} from './coefBookLogic'

// ── COEF_KEYS 注册表(S14 §3:九键=价目户级例外全部 overridable 键 + 二期层份) ──
describe('COEF_KEYS 注册表', () => {
  it('九键齐全且 id 唯一,顺序=spec §3 下拉序', () => {
    expect(COEF_KEYS.map(k => k.id)).toEqual([
      'mgmt_fee', 'elevator_share', 'fire_share', 'water', 'capacity_fee',
      'green_rate', 'elec_package', 'share_elec_fixed', 'share_water_fixed',
    ])
    expect(new Set(COEF_KEYS.map(k => k.id)).size).toBe(9)
  })
  it('电力管理费=双键同值成对写(tenant-price-exceptions 惯例)', () => {
    expect(coefMeta('mgmt_fee').writes).toEqual([{ key: 'mgmt_fee' }, { key: 'mgmt_fee_commercial' }])
  })
  it('水价配套 water_pipe=0 同写', () => {
    expect(coefMeta('water').writes).toEqual([{ key: 'water' }, { key: 'water_pipe', fixed: 0 }])
  })
  it('包干电价配套双 mgmt 键=0(包干价已含管理费)', () => {
    expect(coefMeta('elec_package').writes).toEqual([
      { key: 'elec_package' }, { key: 'mgmt_fee', fixed: 0 }, { key: 'mgmt_fee_commercial', fixed: 0 },
    ])
  })
  it('层份两键 floorShare 且各挂对应池费项,不走价目写计划', () => {
    expect(coefMeta('elevator_share').floorShare).toBe(true)
    expect(coefMeta('elevator_share').feeKey).toBe('share_elec_elevator')
    expect(coefMeta('fire_share').floorShare).toBe(true)
    expect(coefMeta('fire_share').feeKey).toBe('share_elec_fire')
    expect(coefMeta('elevator_share').writes).toEqual([])
    expect(coefMeta('fire_share').writes).toEqual([])
  })
  it('单键四项各写自身', () => {
    for (const id of ['capacity_fee', 'green_rate', 'share_elec_fixed', 'share_water_fixed'])
      expect(coefMeta(id).writes).toEqual([{ key: id }])
  })
})

// ── 行构建(期归属复用 billNoticeLogic.resolvePhase;按楼栋分组直接走 groupByBuilding) ──
describe('buildCoefRows 行构建', () => {
  const buildings = [
    { id: 1, phase: 2, name: 'B座' }, { id: 2, phase: 1, name: '一车间' },
    { id: 3, phase: 4, name: '宿舍楼一座' },
  ]
  const c = (tenantId: number, tenantName: string, buildingId: number, rentArea: number) =>
    ({ tenantId, tenantName, buildingId, buildingName: buildings.find(b => b.id === buildingId)?.name, rentArea })

  it('期归属=合同楼栋 phase(宿舍类归一期,resolvePhase 同源)', () => {
    const rows = buildCoefRows([c(7, '甲', 1, 100), c(8, '乙', 2, 50), c(9, '丙', 3, 30)], buildings)
    expect(rows.find(r => r.tenantId === 7)?.phase).toBe(2)
    expect(rows.find(r => r.tenantId === 8)?.phase).toBe(1)
    expect(rows.find(r => r.tenantId === 9)?.phase).toBe(1)
  })
  it('同租户多合同并一行,主楼栋=租赁面积最大', () => {
    const rows = buildCoefRows([c(7, '甲', 2, 40), c(7, '甲', 1, 200)], buildings)
    expect(rows).toHaveLength(1)
    expect(rows[0].bld.main?.name).toBe('B座')
    expect(rows[0].bld.all.map(b => b.name)).toEqual(['B座', '一车间'])
  })
  it('groupByBuilding 可直接消费(totalAmount 占位 0)', () => {
    const rows = buildCoefRows([c(7, '甲', 1, 100), c(8, '乙', 1, 50)], buildings)
    const gs = groupByBuilding(rows, r => r.bld.main)
    expect(gs).toHaveLength(1)
    expect(gs[0].name).toBe('B座')
    expect(gs[0].count).toBe(2)
  })
})

// ── 当前生效值:价目键 tenant 级联 + 常数键版本前滚(resolvePrice 同规则,附命中 scope) ──
describe('resolveCoefPrice tenant 级联', () => {
  let id = 0
  const row = (scope: string, cfgKey: string, acctMonth: string, value: number): PriceCfgDTO =>
    ({ id: ++id, scope, cfgKey, acctMonth, value, note: null, updatedAt: '2026-01-01T00:00:00', tenantName: null })

  it('tenant 行优先命中且回报例外 scope', () => {
    const rows = [row('', 'mgmt_fee', '', 0.16), row('tenant:7', 'mgmt_fee', '', 0.1)]
    expect(resolveCoefPrice(rows, 'mgmt_fee', '2026-06', 7, 'p2'))
      .toEqual({ value: 0.1, effMonth: '', scope: 'tenant:7' })
  })
  it('无户级行回落 zone,再回落全园', () => {
    const rows = [row('', 'water', '', 3.95), row('p2', 'water', '', 4.2)]
    expect(resolveCoefPrice(rows, 'water', '2026-06', 7, 'p2'))
      .toEqual({ value: 4.2, effMonth: '', scope: 'p2' })
    expect(resolveCoefPrice(rows, 'water', '2026-06', 7, null))
      .toEqual({ value: 3.95, effMonth: '', scope: '' })
  })
  it('常数键版本前滚:取 acctMonth≤ym 最大版本,更晚版本不生效', () => {
    const rows = [
      row('tenant:7', 'water', '', 4.0), row('tenant:7', 'water', '2026-03', 4.45),
      row('tenant:7', 'water', '2026-09', 5.0),
    ]
    expect(resolveCoefPrice(rows, 'water', '2026-06', 7, null))
      .toEqual({ value: 4.45, effMonth: '2026-03', scope: 'tenant:7' })
    expect(resolveCoefPrice(rows, 'water', '2026-02', 7, null))
      .toEqual({ value: 4.0, effMonth: '', scope: 'tenant:7' })
  })
  it('整链无行 → null', () => {
    expect(resolveCoefPrice([], 'capacity_fee', '2026-06', 7, 'p1')).toBeNull()
  })
})

// ── 层份键:池成员行取值(GET /alloc/pools?ym 已按月解析,weight+src) ──
const pool = (over: Partial<CoefPoolIn>): CoefPoolIn => ({
  ruleId: 1, zone: 'p2', name: 'B座·电梯', buildingId: 1, floorLabel: null, side: null, feeName: '电梯',
  method: 'floor', stdKind: null, roundScale: 2, baseKey: null, note: null,
  meters: [{ meterId: 11, sign: 1 }], links: [], members: [], ...over,
})
const RULES: CoefRuleIn[] = [
  { id: 1, feeKey: 'share_elec_elevator', coefficient: 6, extraQty: 170 },
  { id: 2, feeKey: 'share_elec_fire', coefficient: 5, extraQty: 0 },
  { id: 3, feeKey: 'share_elec_elevator', coefficient: 4, extraQty: 0 },
]

describe('poolsOfFeeKey / floorMemberships', () => {
  const pools = [
    pool({ ruleId: 1, members: [{ tenantId: 7, weight: 1, src: 'default' }] }),
    pool({ ruleId: 2, name: 'B座·消防', members: [{ tenantId: 7, weight: 0.5, src: 'month' }] }),
    pool({ ruleId: 3, zone: 'p1', name: 'A座·电梯', members: [{ tenantId: 7, weight: 2, src: 'default' }] }),
  ]
  it('按 rules.feeKey 过滤且仅收二期池(层份仅二期开放)', () => {
    expect(poolsOfFeeKey(pools, RULES, 'share_elec_elevator').map(p => p.ruleId)).toEqual([1])
    expect(poolsOfFeeKey(pools, RULES, 'share_elec_fire').map(p => p.ruleId)).toEqual([2])
  })
  it('成员命中返回 weight+src', () => {
    expect(floorMemberships(poolsOfFeeKey(pools, RULES, 'share_elec_fire'), 7))
      .toEqual([{ ruleId: 2, poolName: 'B座·消防', weight: 0.5, src: 'month' }])
  })
  it('非成员 → 空', () => {
    expect(floorMemberships(poolsOfFeeKey(pools, RULES, 'share_elec_elevator'), 99)).toEqual([])
  })
})

// ── 提交计划:价目键 → PUT /price-cfg 序列(含配套键);清除=全部配套键删该月版本 ──
describe('buildPricePlan', () => {
  it('每户按写计划展开:mgmt 双键同值', () => {
    const stash: CoefStash = new Map([[7, 0.1]])
    expect(buildPricePlan(coefMeta('mgmt_fee'), stash, '2026-06')).toEqual([{
      tenantId: 7,
      reqs: [
        { scope: 'tenant:7', cfgKey: 'mgmt_fee', acctMonth: '2026-06', value: 0.1, note: '系数簿批量' },
        { scope: 'tenant:7', cfgKey: 'mgmt_fee_commercial', acctMonth: '2026-06', value: 0.1, note: '系数簿批量' },
      ],
    }])
  })
  it('fixed 配套键写死值(water_pipe=0),不吃用户值', () => {
    const [it7] = buildPricePlan(coefMeta('water'), new Map([[7, 4.45]]), '2026-06')
    expect(it7.reqs.map(r => [r.cfgKey, r.value])).toEqual([['water', 4.45], ['water_pipe', 0]])
  })
  it('清除模式(null)=全部配套键 value null 删该月版本回退', () => {
    const [it7] = buildPricePlan(coefMeta('elec_package'), new Map([[7, null]]), '2026-06')
    expect(it7.reqs.map(r => [r.cfgKey, r.value])).toEqual([
      ['elec_package', null], ['mgmt_fee', null], ['mgmt_fee_commercial', null],
    ])
    expect(it7.reqs.every(r => r.note == null)).toBe(true)
  })
  it('空暂存 → 空计划', () => {
    expect(buildPricePlan(coefMeta('water'), new Map(), '2026-06')).toEqual([])
  })
})

// ── 提交计划:层份键 → 按池分组,当月解析成员组套暂存,整组写月版本(memberMonth=ym) ──
describe('buildFloorPlan', () => {
  const pools = [
    pool({ ruleId: 1, members: [
      { tenantId: 7, weight: 1, src: 'default' }, { tenantId: 8, weight: 0.5, src: 'default' },
    ] }),
    pool({ ruleId: 2, name: 'B座·消防', members: [{ tenantId: 9, weight: 1, src: 'default' }] }),
    pool({ ruleId: 3, zone: 'p1', name: 'A座·电梯', members: [{ tenantId: 7, weight: 2, src: 'default' }] }),
  ]
  it('只出含暂存户的池;members=解析组套暂存,未触及成员原样;memberMonth=ym', () => {
    const items = buildFloorPlan(pools, RULES, 'share_elec_elevator', new Map([[7, 2]]), '2026-06')
    expect(items).toHaveLength(1)
    expect(items[0].ruleId).toBe(1)
    expect(items[0].touched).toEqual([7])
    expect(items[0].req.members).toEqual([{ tenantId: 7, weight: 2 }, { tenantId: 8, weight: 0.5 }])
    expect(items[0].req.memberMonth).toBe('2026-06')
  })
  it('清除(null)→weight null 回按楼层自动分', () => {
    const items = buildFloorPlan(pools, RULES, 'share_elec_elevator', new Map([[7, null]]), '2026-06')
    expect(items[0].req.members[0]).toEqual({ tenantId: 7, weight: null })
  })
  it('req 字段齐全:定位/方法/绑表 sign/引擎参数取池行,coefficient/extraQty/feeKey 取 rule', () => {
    const [item] = buildFloorPlan(pools, RULES, 'share_elec_elevator', new Map([[8, 1]]), '2026-06')
    expect(item.req).toMatchObject({
      zone: 'p2', name: 'B座·电梯', buildingId: 1, floorLabel: null, side: null, feeName: '电梯',
      method: 'floor', coefficient: 6, extraQty: 170, feeKey: 'share_elec_elevator',
      meterIds: [11], meters: [{ meterId: 11, sign: 1 }], links: [],
      roundScale: 2, stdKind: null, baseKey: null,
    })
  })
  it('非二期池不入计划(层份仅二期);无池触及 → 空', () => {
    expect(buildFloorPlan(pools, RULES, 'share_elec_elevator', new Map([[99, 1]]), '2026-06')).toEqual([])
  })
})

// ── 失败中断续算:已提交池覆盖的户出暂存,余下保留(顺序提交中断语义) ──
describe('floorStashAfter', () => {
  const items = [
    { ruleId: 1, poolName: 'a', touched: [7, 8], req: {} as never },
    { ruleId: 2, poolName: 'b', touched: [8, 9], req: {} as never },
  ]
  it('全部触及池已提交的户移除,仍有未提交池的户保留', () => {
    const rest = floorStashAfter(items, [1], new Map([[7, 1], [8, 1], [9, null]]))
    expect([...rest.keys()]).toEqual([8, 9])   // 7 只在池1(已提交)→出;8 还挂池2 → 留
    expect(rest.get(9)).toBeNull()             // 清除值原样保留
  })
})
