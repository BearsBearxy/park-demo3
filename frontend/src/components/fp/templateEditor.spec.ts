import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import TemplateEditorPanel from './TemplateEditorPanel.vue'
import { booksApi } from '@/api/books'
import type { Book, BookDef, TemplateVersion } from '../../types/book'

// 账册模板面板(BOOK-WORKBENCH-SPEC §3)。双模式:默认只读查看,canEdit 才能进编辑态。
// 除历史版预览走 booksApi.versionDefinition(此处 mock)外仍纯受控:props in / emit out。

vi.mock('@/api/books', () => ({ booksApi: { versionDefinition: vi.fn() } }))

// 账册模板自 P4 起也上编辑锁(锁到账册,不锁到期 —— 模板改动影响这本账册所有月份)。
// 不 mock 的话 locksApi 走真 axios,jsdom 里抛错 → 被「拿不准就不进」兜住 → 编辑态永远进不去。
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
// 面板通过 useEditLock 用到在场 store(Pinia)
beforeEach(() => { setActivePinia(createPinia()) })

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

// 历史版(v2)定义:列名不同,便于断言主区确实切换了
const histDef: BookDef = {
  groups: [
    {
      id: 'g1', label: '旧租金类',
      cols: [
        { id: 'rent', std: true, label: '旧租金', aliases: [], slot: 'rent', hidden: false, w: null },
      ],
    },
  ],
}

function mountPanel(canEdit = true) {
  return mount(TemplateEditorPanel, {
    props: { open: true, book: makeBook(), versions, saving: false, canEdit },
    // Teleport 落到组件树内,便于 DOM 查询
    global: { stubs: { teleport: true } },
  })
}

/** 挂载并进入编辑态。 */
async function mountEdit() {
  const w = mountPanel()
  await w.find('button.te-editbtn').trigger('click')
  return w
}

beforeEach(() => {
  vi.mocked(booksApi.versionDefinition).mockReset()
})

describe('TemplateEditorPanel · 双模式', () => {
  it('默认只读:分组/别名 chips 纯展示,无任何编辑控件;版本链渲染', () => {
    const w = mountPanel()
    expect(w.findAll('.te-group')).toHaveLength(2)
    expect(w.find('.te-gname-ro').text()).toBe('租金类')
    // 编辑控件全部不在
    expect(w.find('input.te-name').exists()).toBe(false)
    expect(w.find('button.te-save').exists()).toBe(false)
    expect(w.find('button.te-addcol').exists()).toBe(false)
    expect(w.find('.te-rollback').exists()).toBe(false) // 回滚也是编辑态控件
    // 别名 chip 纯展示,无删除钮
    const chip = w.find('.te-chip')
    expect(chip.text()).toBe('厂房租金')
    expect(chip.find('.te-chip-x').exists()).toBe(false)
    // 版本链
    const items = w.findAll('.te-vitem')
    expect(items).toHaveLength(2)
    expect(items[0].find('.te-curbadge').exists()).toBe(true)
    w.unmount()
  })

  it('canEdit=false:不渲染「编辑模式」按钮', () => {
    const w = mountPanel(false)
    expect(w.find('button.te-editbtn').exists()).toBe(false)
    w.unmount()
  })

  it('点「编辑模式」进入编辑态(控件齐),「完成」退回只读', async () => {
    const w = await mountEdit()
    expect(w.find('input.te-name').exists()).toBe(true)
    expect(w.find('button.te-save').exists()).toBe(true)
    expect(w.find('.te-rollback').exists()).toBe(true) // 编辑态才出回滚
    await w.find('button.te-donebtn').trigger('click')
    expect(w.find('input.te-name').exists()).toBe(false)
    expect(w.find('button.te-editbtn').exists()).toBe(true)
    w.unmount()
  })
})

describe('TemplateEditorPanel · 历史版预览', () => {
  it('点历史版:调 versionDefinition(bookId, ver),主区切该版列名 + 横幅;回到现行版还原', async () => {
    vi.mocked(booksApi.versionDefinition).mockResolvedValue(histDef)
    const w = mountPanel()
    await w.findAll('.te-vitem')[1].trigger('click')
    await flushPromises()
    expect(booksApi.versionDefinition).toHaveBeenCalledWith(1, 2)
    expect(w.find('.te-histbar').text()).toContain('正在查看 v2')
    expect(w.findAll('.te-roname')[0].text()).toBe('旧租金')
    // 一键回现行版
    await w.find('button.te-histback').trigger('click')
    expect(w.find('.te-histbar').exists()).toBe(false)
    expect(w.findAll('.te-roname')[0].text()).toBe('租金')
    w.unmount()
  })

  it('正在看历史版时点「编辑模式」:先切回现行版再进入编辑(编辑的是现行定义)', async () => {
    vi.mocked(booksApi.versionDefinition).mockResolvedValue(histDef)
    const w = mountPanel()
    await w.findAll('.te-vitem')[1].trigger('click')
    await flushPromises()
    await w.find('button.te-editbtn').trigger('click')
    expect(w.find('.te-histbar').exists()).toBe(false)
    expect((w.findAll('input.te-name')[0].element as HTMLInputElement).value).toBe('租金')
    w.unmount()
  })
})

describe('TemplateEditorPanel · 编辑态', () => {
  it('改显示名(轻改动)后保存:emit 的 def 带新 label,且不出升版提示', async () => {
    const w = await mountEdit()
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
    const w = await mountEdit()
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

  it('标准列无删除按钮(给「可隐藏」文案),自定义列可删', async () => {
    const w = await mountEdit()
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
    const w = await mountEdit()
    expect(w.find('.te-verbump').exists()).toBe(false)
    await w.find('input.te-hide').setValue(true)
    expect(w.find('.te-verbump').text()).toContain('升版 v4')
    // 切回去提示消失(与原定义无结构差异)
    await w.find('input.te-hide').setValue(false)
    expect(w.find('.te-verbump').exists()).toBe(false)
    w.unmount()
  })

  it('回滚按钮 emit rollback(ver),不动草稿', async () => {
    const w = await mountEdit()
    await w.find('.te-rollback').trigger('click')
    expect(w.emitted('rollback')![0]).toEqual([2])
    expect(w.emitted('save')).toBeUndefined()
    w.unmount()
  })
})

describe('TemplateEditorPanel · 别名录入', () => {
  it('点「+ 别名」变输入框;blur 提交成 chip 且直接点保存不丢', async () => {
    const w = await mountEdit()
    await w.findAll('button.te-aliasadd')[0].trigger('click')
    const input = w.find('input.te-aliasin')
    expect(input.exists()).toBe(true)
    await input.setValue('新别名')
    // 不按回车,直接失焦(等价于直接去点保存):blur 必须提交
    await input.trigger('blur')
    expect(w.findAll('.te-colrow')[0].findAll('.te-chip').map(c => c.text())).toContain('新别名')
    expect(w.find('input.te-aliasin').exists()).toBe(false) // 收回「+ 别名」按钮
    await w.find('button.te-save').trigger('click')
    const [def] = w.emitted('save')![0] as [BookDef, string]
    expect(def.groups[0].cols[0].aliases).toEqual(['厂房租金', '新别名'])
    w.unmount()
  })

  it('IME 守卫:isComposing 的 Enter 不提交(输入框不收起,chips 不变)', async () => {
    const w = await mountEdit()
    await w.findAll('button.te-aliasadd')[0].trigger('click')
    const input = w.find('input.te-aliasin')
    await input.setValue('pinyin')
    await input.trigger('keydown.enter', { isComposing: true })
    expect(w.find('input.te-aliasin').exists()).toBe(true)
    expect(w.findAll('.te-colrow')[0].findAll('.te-chip')).toHaveLength(1)
    w.unmount()
  })

  it('连续加两个别名:Enter 提交后回到按钮,可再点再加', async () => {
    const w = await mountEdit()
    async function add(text: string) {
      await w.findAll('button.te-aliasadd')[0].trigger('click')
      const input = w.find('input.te-aliasin')
      await input.setValue(text)
      await input.trigger('keydown.enter')
    }
    await add('别名甲')
    expect(w.find('input.te-aliasin').exists()).toBe(false) // 提交后原位回到「+ 别名」
    await add('别名乙')
    expect(w.findAll('.te-colrow')[0].findAll('.te-chip').map(c => c.text()))
      .toEqual(['厂房租金', '别名甲', '别名乙'])
    w.unmount()
  })
})
