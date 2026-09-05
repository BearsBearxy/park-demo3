import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'
import { usePresenceStore } from '@/stores/presence'

const route = reactive({ meta: { value: 'data-home' } as Record<string, string>, path: '/data-home' })
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }))
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

import AppShell from '../AppShell.vue'

function mountShell() {
  return mount(AppShell, {
    global: {
      stubs: { Teleport: true, IconRail: true, SidebarPanel: true, TabStrip: true, Toolbar: true, CommandPalette: true },
    },
  })
}

describe('AppShell · 预览页签被顶提示(§4.3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    route.meta = { value: 'data-home' }
    route.path = '/data-home'
  })

  afterEach(() => {
    usePresenceStore().stop()
  })

  it('被顶的屏本人没在编辑 → 静默(不出提示)', async () => {
    const w = mountShell()
    const tabs = useTabsStore()
    tabs.open('ledger'); tabs.open('tenants')          // 顶掉 ledger
    await nextTick()
    expect(w.find('.fp-evict-toast').exists()).toBe(false)
  })

  it('被顶的屏本人正握着锁 → 出提示,带屏名', async () => {
    const w = mountShell()
    const presence = usePresenceStore()
    presence.holdLock('ledger:1:2025-06', () => {})    // 台账的锁根
    const tabs = useTabsStore()
    tabs.open('ledger'); tabs.open('tenants')
    await nextTick()
    expect(w.find('.fp-evict-toast').text()).toContain('月度台账')
  })

  it('点「固定它」把被顶的屏钉回固定页签并收起提示', async () => {
    const w = mountShell()
    const presence = usePresenceStore()
    presence.holdLock('ledger:1:2025-06', () => {})
    const tabs = useTabsStore()
    tabs.open('ledger'); tabs.open('tenants')
    await nextTick()
    await w.find('.fp-evict-toast .act').trigger('click')
    expect(useTabsStore().tabs.map(t => t.value)).toContain('ledger')
    expect(w.find('.fp-evict-toast').exists()).toBe(false)
  })
})
