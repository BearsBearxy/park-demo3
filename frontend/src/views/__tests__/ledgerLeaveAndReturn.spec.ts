// 「去租户管理加个别名,回来接着干」这条动线的两条铁律(2026-08-28 用户拍板):
//
//  · 去租户管理必须**新开一个页签**,不能顶掉台账那个 —— open() 不带 pin 会进预览槽,
//    而预览槽全局只有一个,进去就把原来那页顶没了。
//  · 回到台账时,抽屉该在原处 —— 抽屉挂在 body 上,停用时必须关(VUE-03,否则会浮到别的
//    页签上),但"关掉"不等于"忘掉"。
//
// 第二条有两个**故意不恢复**的例外,它们比恢复本身更容易被后人好心改错,所以单独钉住。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import LedgerView from '@/views/ledger/LedgerView.vue'
import { booksApi } from '@/api/books'
import { ledgerApi, companyApi } from '@/api/ledger'
import type { Book } from '@/types/book'

vi.mock('@/api/books')
vi.mock('@/api/ledger')
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

const book: Book = {
  id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司',
  ver: 1, latestVer: 1,
  definition: { groups: [{ id: 'g1', label: '租金', cols: [
    { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
  ] }] },
}

beforeEach(() => {
  // tabs store 把页签/预览写进 localStorage,不清就跨用例漏:上一条 pin 过的 tenants
  // 会让下一条的 open('tenants') 走「已固定,直接导航」分支,预览槽纹丝不动
  localStorage.removeItem('fp-app-tabs')
  localStorage.removeItem('fp-app-preview')
  localStorage.removeItem('fp-app-recent')
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.mocked(booksApi.list).mockResolvedValue([book])
  vi.mocked(booksApi.templateAt).mockResolvedValue(book)
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 9, name: '甲公司', short: '甲' } as never,
  ])
  vi.mocked(ledgerApi.years).mockResolvedValue([])
})

describe('去租户管理:新开页签,不顶掉台账', () => {
  it('pin 打开不动预览槽 —— 台账那页还在', () => {
    const tabs = useTabsStore()
    tabs.open('ledger')                      // 台账进预览槽
    expect(tabs.preview?.value).toBe('ledger')

    tabs.open('tenants', { pin: true })      // 去租户管理

    expect(tabs.preview?.value).toBe('ledger')
    expect(tabs.tabs.map(t => t.value)).toContain('tenants')
  })

  it('反例:不带 pin 会把台账顶掉(这正是改动前的行为)', () => {
    const tabs = useTabsStore()
    tabs.open('ledger')
    tabs.open('tenants')                     // 不带 pin
    expect(tabs.preview?.value).toBe('tenants')   // 台账没了
  })

  it('不能用 openFresh:它 bump epoch,回来时 KeepAlive 会丢掉台账的实例', () => {
    const tabs = useTabsStore()
    const before = tabs.epochOf('ledger')
    tabs.open('tenants', { pin: true })
    expect(tabs.epochOf('ledger')).toBe(before)
  })
})

describe('回到台账:抽屉回到原处', () => {
  /** 把 LedgerView 包进 KeepAlive,用 alive 开关模拟切走/切回。 */
  function keptAlive() {
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(LedgerView) : null) }),
    }))
    return { w, alive }
  }

  it('未绑定问题抽屉:切走时关掉(不许浮到别的页签),切回来重新打开', async () => {
    const { w, alive } = keptAlive()
    await flushPromises()
    const vm = w.findComponent(LedgerView).vm as unknown as Record<string, unknown>
    ;(vm as { issuesOpen: boolean }).issuesOpen = true
    await flushPromises()

    alive.value = false                                  // 切去租户管理
    await flushPromises()
    expect((vm as { issuesOpen: boolean }).issuesOpen).toBe(false)

    alive.value = true                                   // 切回台账
    await flushPromises()
    expect((vm as { issuesOpen: boolean }).issuesOpen).toBe(true)
    w.unmount()
  })

  it('模板面板**故意不恢复**:它的编辑锁随 open 释放,恢复会开在无锁状态', async () => {
    const { w, alive } = keptAlive()
    await flushPromises()
    const vm = w.findComponent(LedgerView).vm as unknown as { tplOpen: boolean }
    vm.tplOpen = true
    await flushPromises()

    alive.value = false
    await flushPromises()
    alive.value = true
    await flushPromises()

    expect(vm.tplOpen).toBe(false)
    w.unmount()
  })
})
