import { describe, it, expect } from 'vitest'
import { groupUnits, toggleUnit, makePrimary, unitChips, unitLabel, selectedAreaSums, prefillRentArea, type FPUnitOption } from './fpUnitPicker'

const U = (id: number, buildingId: number, buildingName: string, floor: number, unitNo: string): FPUnitOption =>
  ({ id, buildingId, buildingName, floor, unitNo })

const LIST: FPUnitOption[] = [
  U(1, 10, '8号楼', 1, '101'),
  U(2, 10, '8号楼', 4, '402'),
  U(3, 20, '9号楼', 2, '201'),
  U(4, 30, '宿舍楼四座', 6, '644'),
]

describe('groupUnits — 全楼栋分组候选(栋名小节头)', () => {
  it('空 q → 全量,按传入序分组,单元归组', () => {
    const gs = groupUnits(LIST, '')
    expect(gs.map((g) => g.buildingName)).toEqual(['8号楼', '9号楼', '宿舍楼四座'])
    expect(gs[0].units.map((u) => u.id)).toEqual([1, 2])
    expect(gs[2].units.map((u) => u.id)).toEqual([4])
  })

  it('q 命中单元号 → 只留命中单元,空组剔除', () => {
    const gs = groupUnits(LIST, '402')
    expect(gs.length).toBe(1)
    expect(gs[0].buildingName).toBe('8号楼')
    expect(gs[0].units.map((u) => u.id)).toEqual([2])
  })

  it('q 命中栋名 → 整栋保留;归一化(括号/空白)同租户选择器', () => {
    expect(groupUnits(LIST, '9号楼')[0].units.map((u) => u.id)).toEqual([3])
    expect(groupUnits(LIST, '宿舍楼 四座').length).toBe(1)   // 空白剔除后命中
    expect(groupUnits(LIST, '不存在')).toEqual([])
  })
})

describe('toggleUnit — 有序选中,首个=主单元', () => {
  it('勾选追加尾部(主不被抢),再点剔除', () => {
    let sel: number[] = []
    sel = toggleUnit(sel, 2)
    sel = toggleUnit(sel, 3)
    expect(sel).toEqual([2, 3])
    sel = toggleUnit(sel, 3)
    expect(sel).toEqual([2])
  })

  it('剔除主单元后,次个自动补位为主', () => {
    expect(toggleUnit([2, 3, 4], 2)).toEqual([3, 4])
  })
})

describe('makePrimary — 星标换主', () => {
  it('提到首位,其余相对序不变', () => {
    expect(makePrimary([2, 3, 4], 4)).toEqual([4, 2, 3])
  })
  it('未选中 id 原样返回', () => {
    expect(makePrimary([2, 3], 99)).toEqual([2, 3])
  })
})

describe('unitChips — 跨栋/缺档 id 全部可见(隐形id炸弹修复)', () => {
  it('chips 带栋名,跨栋单元一眼可辨', () => {
    expect(unitChips([2, 3], LIST)).toEqual([
      { id: 2, label: '8号楼 4F-402', missing: false },
      { id: 3, label: '9号楼 2F-201', missing: false },
    ])
  })

  it('候选缺档 id 也出 chip 且标 missing(不再静默隐形)', () => {
    const chips = unitChips([999, 2], LIST)
    expect(chips[0]).toEqual({ id: 999, label: '#999 未知单元', missing: true })
    expect(chips[1].missing).toBe(false)
  })

  it('unitLabel = 栋名 + 楼层F-单元号', () => {
    expect(unitLabel(U(9, 1, 'C座', 3, '301'))).toBe('C座 3F-301')
  })
})

// ─── 标的面积预填(a方案联动半):选中单元面积Σ分桶 + 租金行空格才填 ───
describe('selectedAreaSums / prefillRentArea — 标的面积预填', () => {
  const AU = (id: number, phase: number, area: number | null): FPUnitOption =>
    ({ id, buildingId: 10 + phase, buildingName: 'D座', floor: 2, unitNo: String(200 + id), area, phase })
  // 非宿舍(phase1) 300+189.5;宿舍(phase4) 45;0/空面积各一
  const LIST2: FPUnitOption[] = [AU(1, 1, 300), AU(2, 1, 189.5), AU(3, 4, 45), AU(4, 4, 0), AU(5, 1, null)]
  const SUMS = { dorm: 45, nonDorm: 489.5 }

  it('分桶Σ:宿舍=phase4栋,非宿舍=其余;仅计 area>0', () => {
    expect(selectedAreaSums([1, 2, 3, 4, 5], LIST2)).toEqual({ dorm: 45, nonDorm: 489.5 })
    expect(selectedAreaSums([3], LIST2)).toEqual({ dorm: 45, nonDorm: null })
  })

  it('空格自动填:面积空或0 → 填同类型Σ', () => {
    expect(prefillRentArea('rent_factory', null, SUMS)).toBe(489.5)
    expect(prefillRentArea('rent_office', 0, SUMS)).toBe(489.5)
  })

  it('已填不覆盖:用户已填值绝不动', () => {
    expect(prefillRentArea('rent_factory', 120, SUMS)).toBeNull()
    expect(prefillRentArea('rent_dorm', 30.5, SUMS)).toBeNull()
  })

  it('型匹配分路:宿舍行走宿舍桶,商铺走非宿舍桶;空地/非租金行不填', () => {
    expect(prefillRentArea('rent_dorm', null, SUMS)).toBe(45)
    expect(prefillRentArea('rent_shop', 0, SUMS)).toBe(489.5)
    expect(prefillRentArea('rent_land', null, SUMS)).toBeNull()
    expect(prefillRentArea('mgmt', null, SUMS)).toBeNull()
  })

  it('无面积单元不触发:选中全为0/空面积 → 桶=null → 不填', () => {
    expect(selectedAreaSums([4, 5], LIST2)).toEqual({ dorm: null, nonDorm: null })
    expect(prefillRentArea('rent_factory', null, { dorm: null, nonDorm: null })).toBeNull()
    expect(prefillRentArea('rent_dorm', 0, { dorm: null, nonDorm: null })).toBeNull()
  })

  it('chips 面积尾注:area>0 显「· n㎡」,0/空不显', () => {
    const chips = unitChips([1, 4], LIST2)
    expect(chips[0].label).toBe('D座 2F-201 · 300㎡')
    expect(chips[1].label).toBe('D座 2F-204')
  })
})
