import { describe, expect, it } from 'vitest'
import {
  MONTHLY_KEYS, PRICE_KEYS, POWER_TYPE_WORDS, SCOPE_LABEL,
  buildPriceGrid, buildVersionStatus, matchPowerType, resolvePrice,
} from './priceCfgLogic'
import type { PriceCfgDTO } from '@/api/priceCfg'

let id = 0
const row = (scope: string, cfgKey: string, value: number, acctMonth = '', updatedAt = '2099-01-01T00:00:00'): PriceCfgDTO =>
  ({ id: ++id, scope, cfgKey, acctMonth, value, note: null, updatedAt, tenantName: null })

const YM = '2099-05'

describe('PRICE_KEYS 注册表(§2,V62 定格 19 键)', () => {
  it('19 键且唯一(五个月推键已删)', () => {
    expect(PRICE_KEYS).toHaveLength(19)
    expect(new Set(PRICE_KEYS.map(k => k.key)).size).toBe(19)
    for (const dead of ['green_water', 'green_water_hi', 'lamp_sqm', 'fire_sqm', 'elevator_sqm'])
      expect(PRICE_KEYS.some(k => k.key === dead)).toBe(false)
  })
  it('5 组按序', () => {
    expect([...new Set(PRICE_KEYS.map(k => k.group))]).toEqual(
      ['电价·月变', '附加与开关', '容量与水', '月推参数', '特殊轨道'])
  })
  it('月变键=电价 6 键', () => {
    expect([...MONTHLY_KEYS].sort()).toEqual(
      ['elec_commercial', 'elec_flat', 'elec_peak', 'elec_resident', 'elec_sharp', 'elec_valley'])
    expect(PRICE_KEYS.filter(k => k.monthly).map(k => k.key)).toEqual(
      ['elec_peak', 'elec_sharp', 'elec_flat', 'elec_valley', 'elec_resident', 'elec_commercial'])
  })
  it('户级可覆盖集合=待录清单五键', () => {
    expect(PRICE_KEYS.filter(k => k.overridable).map(k => k.key)).toEqual(
      ['mgmt_fee', 'capacity_fee', 'water', 'elec_package', 'elevator_package'])
  })
})

describe('resolvePrice v2 版本链(§3)', () => {
  it('常数键:版本自动前滚跨月(2099-01 版本在 2099-05 仍生效)', () => {
    const r = resolvePrice([row('', 'water', 4.1, '2099-01')], 'water', YM)!
    expect(r.value).toBe(4.1)
    expect(r.effMonth).toBe('2099-01')
  })
  it('常数键:多版本取 <=ym 最大起点,未来版本不生效', () => {
    const all = [
      row('', 'water', 3.95, ''),
      row('', 'water', 4.1, '2099-03'),
      row('', 'water', 4.45, '2099-06'), // 未来版本
    ]
    expect(resolvePrice(all, 'water', '2099-02')!).toMatchObject({ value: 3.95, effMonth: '' })
    expect(resolvePrice(all, 'water', '2099-03')!).toMatchObject({ value: 4.1, effMonth: '2099-03' })
    expect(resolvePrice(all, 'water', YM)!).toMatchObject({ value: 4.1, effMonth: '2099-03' })
    expect(resolvePrice(all, 'water', '2099-06')!.value).toBe(4.45)
  })
  it("常数键:''=初始版本自始生效", () => {
    const r = resolvePrice([row('', 'water', 3.95, '')], 'water', '2000-01')!
    expect(r.value).toBe(3.95)
    expect(r.effMonth).toBe('')
  })
  it('月变键:仅精确命中当月版本,绝不前滚', () => {
    const all = [row('', 'elec_peak', 1.20606875, '2099-04')]
    expect(resolvePrice(all, 'elec_peak', '2099-04')!.value).toBe(1.20606875)
    expect(resolvePrice(all, 'elec_peak', YM)).toBeNull() // 缺当月=null→派生门禁
  })
  it('返回 updatedAt 版本时间戳', () => {
    const r = resolvePrice([row('', 'water', 4.1, '', '2099-02-03T10:30:00')], 'water', YM)!
    expect(r.updatedAt).toBe('2099-02-03T10:30:00')
  })
  it('scope 级联仍三级:tenant → zone → 全园,首中即返', () => {
    const all = [
      row('', 'water', 1, ''),
      row('dorm', 'water', 3, '2099-02'),
      row('tenant:9', 'water', 5, '2099-04'),
    ]
    expect(resolvePrice(all, 'water', YM, 9, 'dorm')!.value).toBe(5)
    expect(resolvePrice(all, 'water', '2099-03', 9, 'dorm')!.value).toBe(3) // 户级版本未生效→zone
    expect(resolvePrice(all, 'water', '2099-01', 9, 'dorm')!.value).toBe(1) // zone 亦未生效→全园
    expect(resolvePrice(all, 'water', YM, null, 'dorm')!.value).toBe(3)     // 不传 tenant 不误吃户级
    expect(resolvePrice(all, 'water', YM)!.value).toBe(1)                   // 不传 zone 从全园起
  })
  it('全缺=null', () => expect(resolvePrice([], 'water', YM, 9, 'dorm')).toBeNull())
})

describe('POWER_TYPE_WORDS 词表(决策⑤)', () => {
  it('映射固化', () => {
    expect(POWER_TYPE_WORDS['大工业']).toBe('industrial')
    expect(POWER_TYPE_WORDS['工业']).toBe('industrial')
    expect(POWER_TYPE_WORDS['一般工商业']).toBe('commercial')
    expect(POWER_TYPE_WORDS['商业']).toBe('commercial')
    expect(POWER_TYPE_WORDS['居民']).toBe('resident')
  })
  it('长词优先:一般工商业不被商业抢先', () => {
    expect(matchPowerType('一般工商业用电')).toBe('commercial')
    expect(matchPowerType('大工业(两部制)')).toBe('industrial')
    expect(matchPowerType('居民生活')).toBe('resident')
    expect(matchPowerType('光伏')).toBeNull()
  })
})

describe('buildPriceGrid 价目表行组装(左栏)', () => {
  const rows = [
    row('', 'water', 3.95), row('dorm', 'water', 3.85), row('', 'water', 4.1, YM),
    row('', 'elec_peak', 1.20606875, YM),
    row('tenant:9', 'water', 4.45), // 户级行不进网格
  ]
  const grid = buildPriceGrid(rows, YM)
  const find = (key: string, scope: string) =>
    grid.flatMap(g => g.rows).find(r => r.meta.key === key && r.scope === scope)!

  it('分组=§2 五组、行分组归位', () => {
    expect(grid.map(g => g.group)).toEqual(['电价·月变', '附加与开关', '容量与水', '月推参数', '特殊轨道'])
    expect(grid.find(g => g.group === '容量与水')!.rows.filter(r => r.meta.key === 'water')).toHaveLength(2)
  })
  it('全园 water:选定月版本行=cur,生效=该版本', () => {
    const r = find('water', '')
    expect(r.cur!.value).toBe(4.1)
    expect(r.eff!).toMatchObject({ value: 4.1, effMonth: YM })
  })
  it('dorm water:无当月版本,生效=分区初始版本前滚', () => {
    const r = find('water', 'dorm')
    expect(r.cur).toBeNull()
    expect(r.eff!).toMatchObject({ value: 3.85, effMonth: '' })
  })
  it('elec_peak 月变键:当月版本即生效', () => {
    const r = find('elec_peak', '')
    expect(r.cur!.value).toBe(1.20606875)
    expect(r.eff!.value).toBe(1.20606875)
  })
  it('无任何行的键给全园空行保留录入口', () => {
    const r = find('elec_package', '')
    expect(r.cur).toBeNull()
    expect(r.eff).toBeNull()
  })
  it('户级行不进网格', () => {
    expect(grid.flatMap(g => g.rows).some(r => r.scope.startsWith('tenant:'))).toBe(false)
  })
  it('scope 徽标文案', () => expect(SCOPE_LABEL['dorm']).toBe('宿舍'))
})

describe('buildVersionStatus 版本状态组装(右栏卡+徽标)', () => {
  it('电价月版本 n/6+缺失清单', () => {
    const vs = buildVersionStatus([
      row('', 'elec_peak', 1.2, YM), row('', 'elec_flat', 0.72, YM),
      row('', 'elec_valley', 0.29, '2099-04'), // 上月版本不算当月
    ], YM)
    expect(vs.monthlyHit).toBe(2)
    expect(vs.monthlyTotal).toBe(6)
    expect(vs.monthlyMissing).toEqual(['尖段电价(名义)', '谷段电价', '居民电价(宿舍)', '商业电价'])
  })
  it('各组生效键计数(常数前滚计入;户级行不计)', () => {
    const vs = buildVersionStatus([
      row('', 'water', 3.95, ''), row('dorm', 'water_pipe', 0, '2099-01'),
      row('', 'capacity_fee', 22.6, '2099-06'),   // 未来版本不算
      row('tenant:9', 'elec_package', 1.0, ''),   // 户级不计
    ], YM)
    const g = (name: string) => vs.groups.find(x => x.group === name)!
    expect(vs.groups.map(x => x.group)).toEqual(['电价·月变', '附加与开关', '容量与水', '月推参数', '特殊轨道'])
    expect(g('容量与水')).toMatchObject({ effective: 2, total: 3 })
    expect(g('电价·月变')).toMatchObject({ effective: 0, total: 6 })
    expect(g('特殊轨道')).toMatchObject({ effective: 0, total: 3 })
  })
  it('全簿最近更新=max updatedAt+费项名', () => {
    const vs = buildVersionStatus([
      row('', 'water', 3.95, '', '2099-01-01T08:00:00'),
      row('tenant:9', 'mgmt_fee', 0.15, '', '2099-03-02T09:30:00'), // 户级行也算全簿
    ], YM)
    expect(vs.latest).toEqual({ label: '电力管理费(分时/居民)', updatedAt: '2099-03-02T09:30:00' })
  })
  it('空簿 latest=null', () => expect(buildVersionStatus([], YM).latest).toBeNull())
})
