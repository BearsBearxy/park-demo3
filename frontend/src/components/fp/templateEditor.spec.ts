import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TemplateEditorPanel from './TemplateEditorPanel.vue'
import type { Book, BookDef, TemplateVersion } from '../../types/book'

// 账册模板编辑器(BOOK-WORKBENCH-SPEC §3)。纯受控组件:全部断言走 props in / emit out。

const makeDef = (): BookDef => ({
  groups: [
    {
      id: 'g1', label: '租金类',
      cols: [
        { id: 'rent', std: true, label: '租金', aliases: ['厂房租金'], slot: 'rent', hidden: false, w: 120 },
        { id: 'c_park', std: false, label: '停车费', aliases: [], slot: 'other', hidden: false, w: null },
      ],
    },
    {
      id: 'g2', label: null,
      cols: [
        { id: 'elec', std: true, label: '电费', aliases: [], slot: 'elec', hidden: false, w: null },
      ],
    },
  ],
})

const makeBook = (): Book => ({
  id: 1, screen: 'ledger', companyId: 1, phase: null,
  name: '公司A台账', ver: 3, definition: makeDef(),
})

const versions: TemplateVersion[] = [
  { id: 31, ver: 3, note: '加停车费', createdBy: 'admin', createdAt: '2026-08-20T10:00:00', current: true },
  { id: 21, ver: 2, note: null, createdBy: 'admin', createdAt: '2026-08-10T09:00:00', current: false },
]

function mountPanel() {
  return mount(TemplateEditorPanel, {
    props: { open: true, book: makeBook(), versions, saving: false },
    // Teleport 落到组件树内,便于 DOM 查询
    global: { stubs: { teleport: true } },
  })
}

describe('TemplateEditorPanel', () => {
  it('open 时渲染分组卡片与版本链', () => {
    const w = mountPanel()
    const groups = w.findAll('.te-group')
    expect(groups).toHaveLength(2)
    expect((w.find('.te-gname').element as HTMLInputElement).value).toBe('租金类')
    // 版本链:v3 现行无回滚按钮,v2 历史版有
    const items = w.findAll('.te-vitem')
    expect(items).toHaveLength(2)
    expect(items[0].find('.te-curbadge').exists()).toBe(true)
    expect(items[0].find('.te-rollback').exists()).toBe(false)
    expect(items[1].find('.te-rollback').exists()).toBe(true)
    w.unmount()
  })

  it('改显示名(轻改动)后保存:emit 的 def 带新 label,且不出升版提示', async () => {
    const w = mountPanel()
    await w.findAll('input.te-name')[0].setValue('厂房租金合计')
    expect(w.find('.te-verbump').exists()).toBe(false) // 轻改动不升版
    await w.find('input.te-note').setValue('统一显示名口径')
    await w.find('button.te-save').trigger('click')
    const [def, note] = w.emitted('save')![0] as [BookDef, string]
    expect(def.groups[0].cols[0].label).toBe('厂房租金合计')
    expect(note).toBe('统一显示名口径')
    w.unmount()
  })

  it('添加自定义列:id 以 c_ 开头,slot 默认 other,std=false', async () => {
    const w = mountPanel()
    await w.findAll('button.te-addcol')[0].trigger('click')
    expect(w.findAll('.te-group')[0].findAll('.te-colrow')).toHaveLength(3)
    await w.find('button.te-save').trigger('click')
    const [def] = w.emitted('save')![0] as [BookDef, string]
    const added = def.groups[0].cols[2]
    expect(added.id).toMatch(/^c_/)
    expect(added.id).not.toBe('c_park') // 与既有自定义列不撞 id
    expect(added.std).toBe(false)
    expect(added.slot).toBe('other')
    w.unmount()
  })

  it('标准列无删除按钮(给「可隐藏」文案),自定义列可删', () => {
    const w = mountPanel()
    const rows = w.findAll('.te-group')[0].findAll('.te-colrow')
    // rent 是标准列
    expect(rows[0].find('.te-del').exists()).toBe(false)
    expect(rows[0].find('.te-nodel').text()).toBe('可隐藏')
    // c_park 是自定义列
    expect(rows[1].find('.te-del').exists()).toBe(true)
    expect(rows[1].find('.te-nodel').exists()).toBe(false)
    w.unmount()
  })

  it('结构改动(隐藏切换)出现升版提示条 v{n+1}', async () => {
    const w = mountPanel()
    expect(w.find('.te-verbump').exists()).toBe(false)
    await w.find('input.te-hide').setValue(true)
    expect(w.find('.te-verbump').text()).toContain('升版 v4')
    // 切回去提示消失(与原定义无结构差异)
    await w.find('input.te-hide').setValue(false)
    expect(w.find('.te-verbump').exists()).toBe(false)
    w.unmount()
  })

  it('回滚按钮 emit rollback(ver),不动草稿', async () => {
    const w = mountPanel()
    await w.find('.te-rollback').trigger('click')
    expect(w.emitted('rollback')![0]).toEqual([2])
    expect(w.emitted('save')).toBeUndefined()
    w.unmount()
  })
})
