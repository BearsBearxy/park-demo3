import { describe, it, expect } from 'vitest'
import { applyColDecisions } from './bookMapDecisions'
import type { BookDef } from '@/types/book'

// 导入列映射决策合成(BOOK-WORKBENCH §4):map=追别名 / create=建自定义列 / ignore=清单。

function defOf(): BookDef {
  return {
    groups: [
      {
        id: 'g_rent', label: '租金',
        cols: [
          { id: 'factoryRent', std: true, label: '厂房租金', aliases: ['厂租'], slot: 'rent', hidden: false, w: 96 },
        ],
      },
    ],
  }
}

describe('applyColDecisions', () => {
  it('全忽略:模板不动(changed=false),表头进 ignore 清单', () => {
    const def = defOf()
    const r = applyColDecisions(def, [
      { header: '备注列', action: 'ignore' },
      { header: '装饰列', action: 'ignore' },
    ])
    expect(r.changed).toBe(false)
    expect(r.ignore).toEqual(['备注列', '装饰列'])
    expect(r.def).toBe(def)   // 未拷贝,原引用直通
  })

  it('map:表头追进目标列 aliases;等于显示名或别名已有则不算改动', () => {
    const r = applyColDecisions(defOf(), [
      { header: '宿舍区租金', action: 'map', targetColId: 'factoryRent' },
    ])
    expect(r.changed).toBe(true)
    expect(r.def.groups[0].cols[0].aliases).toEqual(['厂租', '宿舍区租金'])

    // 表头 = 显示名 → 词典本来就命中,不动模板
    const same = applyColDecisions(defOf(), [
      { header: '厂房租金', action: 'map', targetColId: 'factoryRent' },
    ])
    expect(same.changed).toBe(false)
    // 别名已存在 → 同样不动
    const dup = applyColDecisions(defOf(), [
      { header: '厂租', action: 'map', targetColId: 'factoryRent' },
    ])
    expect(dup.changed).toBe(false)
  })

  it('create:补「自定义」组并建 c_ 列挂 other 槽;改了显示名时原表头留作别名', () => {
    const r = applyColDecisions(defOf(), [
      { header: '停车费', action: 'create', newLabel: '停车费' },
      { header: '2024临时费', action: 'create', newLabel: '临时费' },
    ])
    expect(r.changed).toBe(true)
    const g = r.def.groups.find(x => x.id === 'g_custom')!
    expect(g.label).toBe('自定义')
    expect(g.cols).toHaveLength(2)
    const [a, b] = g.cols
    expect(a.id).toMatch(/^c_/)
    expect(b.id).toMatch(/^c_/)
    expect(a.id).not.toBe(b.id)               // 同一批建两列 id 不撞
    expect(a.std).toBe(false)
    expect(a.slot).toBe('other')
    expect(a.aliases).toEqual([])              // 显示名 = 表头,无需别名
    expect(b.label).toBe('临时费')
    expect(b.aliases).toEqual(['2024临时费'])  // 改名后原表头留别名,重解析才对得上
  })

  it('混合决策合成一次:map+create+ignore 各归各位,原定义不被就地改动', () => {
    const def = defOf()
    const r = applyColDecisions(def, [
      { header: '宿舍区租金', action: 'map', targetColId: 'factoryRent' },
      { header: '停车费', action: 'create', newLabel: '停车费' },
      { header: '合计校验', action: 'ignore' },
    ])
    expect(r.changed).toBe(true)
    expect(r.ignore).toEqual(['合计校验'])
    expect(r.def.groups).toHaveLength(2)
    expect(def.groups).toHaveLength(1)                       // 入参未被改
    expect(def.groups[0].cols[0].aliases).toEqual(['厂租'])  // 入参别名未被改
  })
})
