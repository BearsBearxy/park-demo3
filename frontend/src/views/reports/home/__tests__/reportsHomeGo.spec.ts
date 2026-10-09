// 报表中心点卡带期(SIDEBAR-UX-REDESIGN §4.2):走 periodLink,co=all → 三大报表直落「全部汇总」。
import { landNav } from '@/test-utils/landNav'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { grantViews } from '@/test-utils/perms'
import { loadHomeData, NO_VIEW, type HomeCard } from '@/reports/reportsHome'

const push = vi.fn(landNav)
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {}, meta: {} }) }))
// 权限点人话名来自后端 Perm.META;这里只给要用的一项
vi.mock('@/api/perms', () => ({
  loadPermDict: () => Promise.resolve(),
  permLabel: (k: string) => ({ 'income-statement:view': '利润表 · 查看' } as Record<string, string>)[k] ?? k,
}))
vi.mock('@/reports/reportsHome', async (o) => ({
  ...(await o<object>()),
  defaultPeriod: vi.fn().mockResolvedValue({ year: 2025, month: 6 }),
  loadHomeData: vi.fn().mockResolvedValue({ cards: [], tieout: [], year: 2025, month: 6 }),
}))

import ReportsHomeView from '../ReportsHomeView.vue'

beforeEach(() => { setActivePinia(createPinia()); grantViews(); localStorage.clear(); push.mockClear() })

describe('报表中心 · 点卡带期', () => {
  it('go 走 periodLink:p=本屏选好的期,co=all;显式导航仍是全新状态(openFresh)', async () => {
    const w = mount(ReportsHomeView)
    await flushPromises()
    ;(w.vm as unknown as { go: (v: string) => void }).go('income-statement')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2025-06', co: 'all' } })
    expect(useTabsStore().epochOf('income-statement')).toBe(1)
  })

  // ❗TAB-BAR-SPEC §2:页面里的链接 = 新页签紧挨本页右边,报表中心那一格不被换掉
  it('❗点卡开在报表中心右边的新页签,报表中心还在', async () => {
    const tabs = useTabsStore()
    tabs.commit('reports-home')
    tabs.setActive('reports-home')
    tabs.openBackground('ledger')
    const w = mount(ReportsHomeView)
    await flushPromises()
    ;(w.vm as unknown as { go: (v: string) => void }).go('income-statement')
    expect(tabs.tabs.map(t => t.value)).toEqual(['home', 'reports-home', 'income-statement', 'ledger'])
  })
})

// RBAC v4(2026-10-09,RBAC-SPEC §15.7):看不了的报表照样列出(人知道本来有这张),置灰、悬停写缺哪一项、点了不跳 ——
// v3 不判,点进去落「无权查看」页。夹具不退化:一张看得了、一张看不了,两张都点。
// 破坏验证:go() 去掉 lack 那一行 → 红;卡去掉 :class off → 红;「本期报表」行去掉 :disabled → 红
const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string } })._tip?.text
const card = (key: HomeCard['key'], name: string, go: string, locked: boolean): HomeCard => ({
  key, name, desc: '', icon: 'table-2', go, metric: '—', value: locked ? NO_VIEW : '100.00', updated: '—', tie: 'none', locked,
})
describe('报表中心 · 看不了的报表', () => {
  it('❗卡与「本期报表」行照样列出、置灰,悬停写缺哪一项;点看不了的不跳,点看得了的照跳', async () => {
    useAuthStore().permissions = ['reports-home:view', 'balance-sheet:view']
    vi.mocked(loadHomeData).mockResolvedValueOnce({
      cards: [card('is', '利润表', 'income-statement', true), card('bs', '资产负债表', 'balance-sheet', false)],
      tieout: [], year: 2025, month: 6,
    })
    const w = mount(ReportsHomeView)
    await flushPromises()
    const [is, bs] = w.findAll('.rh-rc')
    expect(is.classes()).toContain('off')
    expect(is.text()).toContain('没有查看权')
    expect(tipOf(is.element)).toBe('需要「利润表 · 查看」权限')
    expect(bs.classes()).not.toContain('off')
    expect(tipOf(bs.element), '看得了的卡不挂说明').toBeUndefined()
    await is.trigger('click')
    expect(push).not.toHaveBeenCalled()
    await bs.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/balance-sheet', query: { p: '2025-06', co: 'all' } })

    ;(w.vm as unknown as { view: string }).view = '期间'
    await flushPromises()
    const [isRow, bsRow] = w.findAll('.rh-row')
    expect(isRow.attributes('disabled')).toBeDefined()
    expect(tipOf(isRow.element)).toBe('需要「利润表 · 查看」权限')
    expect(bsRow.attributes('disabled')).toBeUndefined()
  })
})
