// 单元图 / 单元多选器的悬停说明(十件 ⑩):原生 title 换成 v-tip,条件分支照旧。
// 判据读指令挂在元素上的 _tip(与 salaryFixedCols / S10Table 同法),并断言原生 title 已不在。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FPUnitMap, { type UnitDTO } from '../FPUnitMap.vue'
import FPUnitPicker from '../FPUnitPicker.vue'
import type { FPUnitOption } from '../fpUnitPicker'

type TipEl = HTMLElement & { _tip?: { text: string } }
const tip = (el: Element) => (el as TipEl)._tip?.text

describe('FPUnitMap · 悬停说明', () => {
  // 两个单元一个录了面积、一个只有合同派生面积:说明只该挂在后者上(条件不是恒真)
  const units: UnitDTO[] = [
    { id: 1, floor: 1, unitNo: '101', area: 320, status: 'occupied', companyName: '鑫诚精密', derivedArea: null },
    { id: 2, floor: 1, unitNo: '102', area: null, status: 'occupied', companyName: '嘉华新材', derivedArea: 180 },
  ]
  const w = mount(FPUnitMap, { props: { building: { units, floorCount: 1 }, canAdd: true } })

  it('派生面积格挂说明,录了面积的格不挂;都不是原生 title', () => {
    const ar = w.findAll('.u-ar')
    expect(ar.map(a => a.text())).toEqual(['320 ㎡', '≈180 ㎡'])
    expect(tip(ar[0].element)).toBeUndefined()
    expect(tip(ar[1].element)).toBe('合同派生面积(单元未录面积,取占用合同计费行面积)')
    expect(ar[1].attributes('title')).toBeUndefined()
  })

  it('行尾「+」只有图标:说明带楼层,并补成读屏名', () => {
    const add = w.get('button.fp-add')
    expect(tip(add.element)).toBe('在 1F 添加单元')
    expect(add.attributes('aria-label')).toBe('在 1F 添加单元')
    expect(add.attributes('title')).toBeUndefined()
  })
})

describe('FPUnitPicker · 悬停说明', () => {
  const units: FPUnitOption[] = [
    { id: 11, buildingId: 1, buildingName: 'A座', floor: 1, unitNo: '101', area: 320, status: 'occupied' },
    { id: 12, buildingId: 1, buildingName: 'A座', floor: 2, unitNo: '201', area: 0, status: 'vacant' },
  ]
  // 选中 11(主)+ 99(候选里没有 → 缺档 chip)
  const w = mount(FPUnitPicker, { props: { units, modelValue: [11, 99] } })
  const chips = w.findAll('.fp-up-chip')

  it('缺档 chip 挂说明,正常 chip 不挂', () => {
    expect(chips.map(c => c.classes('missing'))).toEqual([false, true])
    expect(tip(chips[0].element)).toBeUndefined()
    expect(tip(chips[1].element)).toBe('候选中无此单元(可能已删除或候选未加载),保存仍保留;移除请点 ×')
    expect(chips[1].attributes('title')).toBeUndefined()
  })

  it('★ 按主/附分两句;× 说「移除」', () => {
    expect(chips.map(c => tip(c.get('button.star').element))).toEqual(['主单元', '设为主单元'])
    expect(tip(chips[0].get('button.rm').element)).toBe('移除')
    expect(chips[0].get('button.rm').attributes('title')).toBeUndefined()
  })
})
