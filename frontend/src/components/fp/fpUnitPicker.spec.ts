import { describe, it, expect } from 'vitest'
import { groupUnits, toggleUnit, makePrimary, unitChips, unitLabel, type FPUnitOption } from './fpUnitPicker'

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
