// 顶栏死钮清理(SIDEBAR-UX-REDESIGN §6):★ 接 tabs.pin,☀ 删,搜索钮只承诺它做得到的。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTabsStore } from '@/stores/tabs'

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'tenants', page: '租户管理', layerLabel: '数据中心' }, path: '/tenants' }),
  useRouter: () => ({ push: vi.fn() }),
}))
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

import Toolbar from '../Toolbar.vue'

const mountBar = () => mount(Toolbar, { global: { stubs: { FPPresenceBar: true } } })

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('Toolbar · 死钮清理(§6)', () => {
  it('★ = 把当前屏固定为常驻页签;已固定时按钮呈激活态', async () => {
    const w = mountBar()
    const tabs = useTabsStore()
    const star = w.find('button[aria-label="固定为常驻页签"]')
    expect(tabs.tabs.map(t => t.value)).not.toContain('tenants')
    expect(star.attributes('data-active')).toBeUndefined()
    await star.trigger('click')
    expect(tabs.tabs.map(t => t.value)).toContain('tenants')
    expect(w.find('button[aria-label="固定为常驻页签"]').attributes('data-active')).toBe('')
  })
  it('主题钮删除;搜索钮只承诺「页面 / 分组」', () => {
    const w = mountBar()
    expect(w.find('button[aria-label="浅色/深色模式"]').exists()).toBe(false)
    expect(w.find('.fp-search-btn').attributes('title')).toBe('搜索页面 / 分组（Ctrl K）')
    expect(w.find('.fp-search-btn').text()).toContain('搜索页面 / 分组')
    expect(w.find('.fp-search-btn').text()).not.toContain('租户')
  })

  // ⚠ 本文件的 route 桩是 meta.value = 'tenants'(:8),挂载辅助叫 mountBar(:25) ——
  //   写 'ledger' 的 ctx / pin 一个都读不到,实现全对也会红。
  it('上下文 chip 常驻:无期显「—」,有期显 期 · 公司(预留位不 v-if —— 一进一出会把面包屑推着走)', async () => {
    const w = mountBar()
    expect(w.find('.fp-ctx-chip').exists()).toBe(true)
    expect(w.find('.fp-ctx-chip').text()).toBe('—')
    useTabsStore().setCtx('tenants', { p: '2025-06', coName: '一期公司' })
    await nextTick()
    expect(w.find('.fp-ctx-chip').text()).toBe('2025-06 · 一期公司')
  })

  it('收藏 ★ 带 aria-pressed(屏读要念出「已固定 / 未固定」,:active 只是视觉)', async () => {
    const w = mountBar()
    const star = w.find('[aria-label="固定为常驻页签"]')
    expect(star.attributes('aria-pressed')).toBe('false')
    useTabsStore().pin('tenants')
    await nextTick()
    expect(star.attributes('aria-pressed')).toBe('true')
  })
})
