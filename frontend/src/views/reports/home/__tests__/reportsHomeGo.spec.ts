// 报表中心点卡带期(SIDEBAR-UX-REDESIGN §4.2):走 periodLink,co=all → 三大报表直落「全部汇总」。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {}, meta: {} }) }))
vi.mock('@/reports/reportsHome', async (o) => ({
  ...(await o<object>()),
  defaultPeriod: vi.fn().mockResolvedValue({ year: 2025, month: 6 }),
  loadHomeData: vi.fn().mockResolvedValue({ cards: [], tieout: [], year: 2025, month: 6 }),
}))

import ReportsHomeView from '../ReportsHomeView.vue'

beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); push.mockClear() })

describe('报表中心 · 点卡带期', () => {
  it('go 走 periodLink:p=本屏选好的期,co=all;显式导航仍是全新状态(openFresh)', async () => {
    const w = mount(ReportsHomeView)
    await flushPromises()
    ;(w.vm as unknown as { go: (v: string) => void }).go('income-statement')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2025-06', co: 'all' } })
    expect(useTabsStore().epochOf('income-statement')).toBe(1)
  })
})
