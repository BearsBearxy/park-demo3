// 首页 / 新标签页(TAB-BAR-SPEC §5)。「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTabsStore, HOME, NEWTAB } from '@/stores/tabs'
import { useFavoritesStore } from '@/stores/favorites'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const r = vi.hoisted(() => ({ value: 'home', push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: r.value } }),
  useRouter: () => ({ push: r.push }),
}))
vi.mock('@/api', () => ({
  default: { get: vi.fn(() => Promise.resolve([])), post: vi.fn(() => Promise.resolve()), delete: vi.fn(() => Promise.resolve()) },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import HomeView from '../HomeView.vue'
import { landNav } from '@/test-utils/landNav'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  r.value = 'home'
  r.push.mockReset()
  r.push.mockImplementation(landNav)
  const auth = useAuthStore()
  auth.me = 'zhou'
  auth.permissions = ['ledger:edit']
})

const tileNames = (w: ReturnType<typeof mount>) => w.findAll('.hm-tile .tl').map(x => x.text())

describe('首页', () => {
  it('❗第一次登录:收藏里预置一格,标题旁写「先放好了你最常用的一屏」;最近打开整块不出', () => {
    const w = mount(HomeView)
    expect(tileNames(w)).toEqual(['本月出账'])
    expect(w.find('.hm-hint').text()).toBe('先放好了你最常用的一屏 · 在页面上点 ☆ 加更多')
    expect(w.find('.hm-sec-rec').exists()).toBe(false)
  })

  it('收藏过之后写「N 个 · 在页面上点 ☆ 加进来」', async () => {
    useFavoritesStore().toggle('ledger')
    const w = mount(HomeView)
    await nextTick()
    expect(w.find('.hm-hint').text()).toBe('2 个 · 在页面上点 ☆ 加进来')
  })

  it('❗在首页上点收藏:开在最右边的新页签,首页还在', async () => {
    const tabs = useTabsStore()
    tabs.setActive(HOME)
    const w = mount(HomeView)
    await w.find('.hm-tile').trigger('click')
    expect(tabs.tabs.map(t => t.value)).toEqual([HOME, 'data-home'])
    expect(r.push).toHaveBeenCalledWith('/data-home')
  })

  it('❗在新标签页上点收藏:这一格变成那一页', async () => {
    r.value = NEWTAB
    const tabs = useTabsStore()
    tabs.openBackground('ledger')
    tabs.newTab()
    tabs.commit(NEWTAB)                        // 新标签页那一格落定
    tabs.setActive(NEWTAB)
    const w = mount(HomeView)
    tabs.markInPage()                          // 格子长在内容区里:AppShell 会登记这次点击
    await w.find('.hm-tile').trigger('click')
    expect(tabs.tabs.map(t => t.value)).toEqual([HOME, 'ledger', 'data-home'])
  })

  it('格子上的 × 去掉收藏,不触发跳转;去光了出虚线空态', async () => {
    const w = mount(HomeView)
    await w.find('.hm-tile .tx').trigger('click')
    expect(r.push).not.toHaveBeenCalled()
    expect(useFavoritesStore().list).toEqual([])
    expect(w.find('.hm-empty').text()).toContain('还没有收藏')
    expect(w.find('.hm-hint').exists()).toBe(false)
  })

  it('在格子里的 × 上按 Enter:只去掉收藏,不跳转', async () => {
    const w = mount(HomeView)
    await w.find('.hm-tile .tx').trigger('keydown', { key: 'Enter' })
    expect(r.push).not.toHaveBeenCalled()
  })

  it('最近打开:列屏名与层名', async () => {
    const tabs = useTabsStore()
    tabs.commit('ledger')
    tabs.commit('balance-sheet')
    const w = mount(HomeView)
    await nextTick()
    const rows = w.findAll('.hm-rec-r').map(x => [x.find('.nm').text(), x.find('.ly').text()])
    expect(rows).toEqual([['资产负债表', '账簿与报表'], ['月度台账', '数据中心']])
  })

  it('搜索框打开命令面板', async () => {
    const w = mount(HomeView)
    await w.find('.hm-search').trigger('click')
    expect(useUiStore().paletteReq).toBe(1)
  })
})
