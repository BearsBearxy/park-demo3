import { describe, it, expect } from 'vitest'
import { buildColumnMap } from './templateColumnMap'
import { normalizeHeader } from './importHeaderMatch'
import type { BookDef } from '@/types/book'

// 匹配词典 = 现行版模板 显示名+别名(标准列与自定义列同权,含 hidden);键为 normalizeHeader 归一名
const def: BookDef = {
  groups: [
    {
      id: 'g1', label: '租金类',
      cols: [
        { id: 'rent', std: true, label: '厂房租金', aliases: ['厂房 租金', '租金'], slot: 'rent', hidden: false },
        { id: 'dormRent', std: true, label: '宿舍租金', aliases: [], slot: 'rent', hidden: true },   // hidden 列
      ],
    },
    {
      id: 'g2', label: null,
      cols: [
        { id: 'c_parking', std: false, label: '停车费', aliases: ['车位费'], slot: 'misc', hidden: false },
      ],
    },
  ],
}

describe('buildColumnMap — 模板 → 导入匹配词典(SPEC §4)', () => {
  it('label 与每条 alias 都指向 col.id(键为归一名)', () => {
    const { map, warnings } = buildColumnMap(def)
    expect(map[normalizeHeader('厂房租金')]).toBe('rent')
    expect(map[normalizeHeader('租金')]).toBe('rent')
    expect(map[normalizeHeader('停车费')]).toBe('c_parking')
    expect(map[normalizeHeader('车位费')]).toBe('c_parking')
    expect(warnings).toEqual([])
  })

  it('hidden 列进词典(导入仍要认它,命中后由调用方提示)', () => {
    const { map } = buildColumnMap(def)
    expect(map[normalizeHeader('宿舍租金')]).toBe('dormRent')
  })

  it('同列 label/alias 归一后撞车 → 去重不告警(「厂房租金」vs「厂房 租金」)', () => {
    const { map, warnings } = buildColumnMap(def)
    expect(map[normalizeHeader('厂房 租金')]).toBe('rent')
    expect(warnings).toEqual([])
  })

  it('跨列冲突:先到先得 + 收集 warning', () => {
    const conflicted: BookDef = {
      groups: [{
        id: 'g', label: null,
        cols: [
          { id: 'a', std: true, label: '管理费', aliases: [], slot: 'mgmt', hidden: false },
          { id: 'b', std: false, label: '物业管理费', aliases: ['管理费'], slot: 'mgmt', hidden: false },
        ],
      }],
    }
    const { map, warnings } = buildColumnMap(conflicted)
    expect(map[normalizeHeader('管理费')]).toBe('a')          // 先到先得
    expect(map[normalizeHeader('物业管理费')]).toBe('b')       // 不冲突的名字照常收
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('管理费')
    expect(warnings[0]).toContain('先到先得')
  })

  it('空名/纯标点名跳过,不产出空键', () => {
    const weird: BookDef = {
      groups: [{
        id: 'g', label: null,
        cols: [{ id: 'x', std: false, label: '电费', aliases: ['', '、'], slot: 'elec', hidden: false }],
      }],
    }
    const { map } = buildColumnMap(weird)
    expect(Object.keys(map)).toEqual([normalizeHeader('电费')])
  })
})
