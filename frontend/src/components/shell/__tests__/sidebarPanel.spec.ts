// 侧栏分组折叠(SIDEBAR-UX-REDESIGN §3.2):展开集合是内存态,换层清空;路由变化只追加含当前屏的组,不收回用户手动展开的组。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'

const route = reactive({ meta: { value: 'data-home' } as Record<string, string>, path: '/data-home' })
const push = vi.fn()
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push }) }))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import SidebarPanel from '../SidebarPanel.vue'

async function go(value: string) {
  route.meta = { value }
  route.path = '/' + value
  await nextTick()
  await nextTick()
}
const titleBtn = (w: VueWrapper, title: string) =>
  w.findAll('button.fp-sbnav-title').find(b => b.text().startsWith(title))!
const rows = (w: VueWrapper) => w.findAll('.fp-sbnav-row').map(b => b.text())
const mountPanel = () => mount(SidebarPanel)
const rowByText = (w: VueWrapper, text: string) =>
  w.findAll('.fp-sbnav-row').find(b => b.text().includes(text))

beforeEach(() => {
  setActivePinia(createPinia())
  route.meta = { value: 'data-home' }
  route.path = '/data-home'
  push.mockClear()
})

describe('SidebarPanel · 分组折叠(§3.2)', () => {
  it('站在首页:出账组展开,其余带标题组折叠,无标题项常显', () => {
    const w = mount(SidebarPanel)
    expect(rows(w)).toContain('本月出账')
    expect(rows(w)).toContain('导入中心')
    expect(rows(w)).toContain('计费参数')
    expect(rows(w)).not.toContain('租户管理')
    expect(rows(w)).not.toContain('月度台账')
    expect(titleBtn(w, '档案').attributes('aria-expanded')).toBe('false')
    expect(titleBtn(w, '出账 · 每月工序').attributes('aria-expanded')).toBe('true')
  })

  it('路由进组内屏只追加那一组,不收回用户手动展开的组', async () => {
    const w = mount(SidebarPanel)
    await titleBtn(w, '档案').trigger('click')
    expect(rows(w)).toContain('租户管理')
    await go('salary')
    expect(rows(w)).toContain('附表12 工资明细')   // 追加「记账 · 按月」
    expect(rows(w)).toContain('租户管理')          // 手动开的档案没被收回
    expect(rows(w)).toContain('计费参数')          // 首页默认开的出账也没被收回
  })

  it('点标题再点一次收起;换层清空展开集合', async () => {
    const w = mount(SidebarPanel)
    await titleBtn(w, '出账 · 每月工序').trigger('click')
    expect(rows(w)).not.toContain('计费参数')
    await titleBtn(w, '档案').trigger('click')
    await go('reports-home')                              // 换层:报表层首页默认开三大报表
    expect(rows(w)).toContain('利润表')
    expect(rows(w)).not.toContain('附表1 租金损益')
    await go('data-home')                                 // 回来:内存态已清,只剩首页默认的出账
    expect(rows(w)).toContain('计费参数')
    expect(rows(w)).not.toContain('租户管理')
  })

  it('换屏后把当前项 scrollIntoView(nearest)', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy   // jsdom 没有这个方法
    const w = mount(SidebarPanel)
    expect(spy).not.toHaveBeenCalled()       // 首次挂载不滚
    await go('import')
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' })
    expect(w.find('.fp-sbnav-row[data-on]').text()).toBe('导入中心')
  })
})

describe('SidebarPanel · 点击语义(§4.1)', () => {
  it('点当前项:不 push、不动页签', async () => {
    const w = mountPanel()
    const tabs = useTabsStore()
    push.mockClear()
    await rowByText(w, '本月出账')!.trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(tabs.epochOf('data-home')).toBe(0)
  })

  it('点别的项 = open(恢复 KeepAlive 现场,epoch 不动)+ push', async () => {
    const w = mountPanel()
    const tabs = useTabsStore()
    await rowByText(w, '园区抄表')!.trigger('click')
    expect(tabs.epochOf('meters')).toBe(0)
    expect(tabs.preview?.value).toBe('meters')
    expect(push).toHaveBeenCalledWith('/meters')
  })

  it('Shift + 点当前项:仍然重建(epoch++),但不 push(路由没变)', async () => {
    const w = mountPanel()
    const tabs = useTabsStore()
    push.mockClear()
    await rowByText(w, '本月出账')!.trigger('click', { shiftKey: true })
    expect(tabs.epochOf('data-home')).toBe(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('Shift + 点击 = openFresh(epoch++ 全新实例)', async () => {
    const w = mountPanel()
    const tabs = useTabsStore()
    await rowByText(w, '园区抄表')!.trigger('click', { shiftKey: true })
    expect(tabs.epochOf('meters')).toBe(1)
    expect(push).toHaveBeenCalledWith('/meters')
  })
})

afterEach(() => {
  // @ts-expect-error jsdom 原本没有 scrollIntoView,恢复成没有
  delete Element.prototype.scrollIntoView
})
