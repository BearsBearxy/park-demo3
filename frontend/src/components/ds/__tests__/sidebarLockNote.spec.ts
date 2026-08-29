import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SidebarNav from '@/components/ds/SidebarNav.vue'
import { usePresenceStore } from '@/stores/presence'

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

/**
 * 侧栏「有人在编辑」标记的共锁注解(2026-08-26 用户投诉「莫名其妙」的那条修复)。
 *
 * ⚠ 2026-08-30 presence 改版时被静默回退过一次:scopeNote 原来喂的是 seat.scope,
 *   而改版后它只是「在哪一屏」(生产里 AppShell 恒传 null),锁挪进了 editScopes ——
 *   注解从此永远渲染不出来,且当时零测试覆盖。这份 spec 就是那次回退的赎罪。
 */
describe('侧栏 · 共锁注解', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function seed() {
    usePresenceStore().users = [{
      sid: 's1', user: 'zhangsan', displayName: '张三', role: null,
      // ⚠ scope 必须按生产实况给 null(AppShell 恒传 null) —— 给了值等于把回退遮住
      scope: null, label: '催缴单', mode: 'edit',
      editScopes: ['billing-chain:2026-08'], sinceMs: 1000, idleMs: 0, self: false,
    }]
  }

  const ITEMS = [{ value: 'bill-notices', label: '催缴单' }]

  it('❗共锁屏的编辑点要带「为什么四个一起亮」的解释', () => {
    seed()
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    const dot = w.find('span[title*="共用同一把月锁"]')
    expect(dot.exists(), 'scopeNote 必须从 editScopes 里命中前缀的那把锁取,不是 seat.scope').toBe(true)
    expect(dot.attributes('title')).toContain('张三 正在编辑')
  })

  it('没人编辑时不画点', () => {
    const w = mount(SidebarNav, { props: { sections: [{ items: ITEMS }] } })
    expect(w.find('span[title*="正在编辑"]').exists()).toBe(false)
  })
})
