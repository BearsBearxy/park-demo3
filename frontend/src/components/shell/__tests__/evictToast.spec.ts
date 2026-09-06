import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    vi.useRealTimers()
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

  it('4 秒后自己消失(删掉计时器 3 条照样全绿 —— 2026-09-06 T5 评审实测)', async () => {
    vi.useFakeTimers()
    const w = mountShell()
    usePresenceStore().holdLock('ledger:1:2025-06', () => {})
    const tabs = useTabsStore()
    tabs.open('ledger'); tabs.open('tenants')
    await nextTick()
    expect(w.find('.fp-evict-toast').exists()).toBe(true)
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(w.find('.fp-evict-toast').exists()).toBe(false)
  })

  it('同一个屏连着被顶两次,第二次照样出 —— evicted 不清的话值没变,watch 不触发,第二条提示就丢了', async () => {
    const w = mountShell()
    usePresenceStore().holdLock('ledger:1:2025-06', () => {})
    const tabs = useTabsStore()
    tabs.open('ledger'); tabs.open('tenants')
    await nextTick()
    await w.find('.fp-evict-toast .act.ghost').trigger('click')   // × 收起,不钉
    expect(w.find('.fp-evict-toast').exists()).toBe(false)
    tabs.open('ledger'); tabs.open('tenants')                     // 又被顶一次
    await nextTick()
    expect(w.find('.fp-evict-toast').exists()).toBe(true)
  })
})

describe('AppShell · 两条 toast 不叠字(§4.3)', () => {
  it('S 档也给 .stacked 抬一格 —— @media 不加特异度,桌面那条 84px 在手机上照样赢,而底下那条已经抬到 76px+safe', () => {
    const s = readFileSync(join(__dirname, '..', 'AppShell.vue'), 'utf8')
    expect(s, 'S 档 @media 里没给 .fp-evict-toast.stacked 抬高')
      // 收紧到规则形态:同一段里那句注释也含 `.fp-evict-toast.stacked{84px}`,
      // 只匹配选择器的话删掉真规则照样绿(2026-09-06 实测)。
      .toMatch(/@media \(max-width: 600px\)[\s\S]{0,700}\.fp-evict-toast\.stacked\s*\{\s*bottom:\s*calc\(/)
  })
})
