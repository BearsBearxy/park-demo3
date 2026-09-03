import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'data-home', page: '本月出账' } }),
  useRouter: () => ({ push }),
}))

import MobileNavDrawer from './MobileNavDrawer.vue'
import MobileBottomNav from './MobileBottomNav.vue'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  push.mockClear()
  setActivePinia(createPinia())
})

const mountDrawer = () =>
  mount(MobileNavDrawer, { props: { open: true }, global: { stubs: { teleport: true } } })

describe('MobileNavDrawer 手机导航抽屉', () => {
  it('渲染层胶囊(不含无权的系统层)、当前层目录与账号段退出入口', () => {
    const w = mountDrawer()
    const pills = w.findAll('.mnav-pill')
    expect(pills.map(p => p.text())).toEqual(['数据', '报表', '分析'])   // 默认 navLayers,无 system:view
    expect(pills[0].classes()).toContain('on')                          // data-home 属数据层
    expect(w.findAll('.mnav-row').some(r => r.text().includes('租户管理'))).toBe(true)
    expect(w.find('.mnav-logout').exists()).toBe(true)                  // S 档全站唯一退出入口
  })

  it('目录条目 = openFresh(epoch++ 全新状态)+ push + 关抽屉', async () => {
    const w = mountDrawer()
    const tabs = useTabsStore()
    await w.findAll('.mnav-row').find(r => r.text().includes('租户管理'))!.trigger('click')
    expect(tabs.epochOf('tenants')).toBe(1)
    expect(push).toHaveBeenCalledWith('/tenants')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('最近打开 = open(恢复 KeepAlive 现场,epoch 不动)+ push + 关抽屉', async () => {
    const tabs = useTabsStore()
    tabs.recent = ['contracts']
    const w = mountDrawer()
    await w.find('.mnav-recent').trigger('click')
    expect(tabs.epochOf('contracts')).toBe(0)   // 走 openFresh 会丢掉用户填一半的表单
    expect(push).toHaveBeenCalledWith('/contracts')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Esc 与点遮罩关闭;点面板内部不关', async () => {
    const w = mountDrawer()
    await w.find('.mnav').trigger('mousedown')
    expect(w.emitted('close')).toBeUndefined()
    await w.find('.mnav-backdrop').trigger('mousedown')
    expect(w.emitted('close')).toHaveLength(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toHaveLength(2)
  })

  it('退出登录 → push /login', async () => {
    const w = mountDrawer()
    await w.find('.mnav-logout').trigger('click')
    expect(push).toHaveBeenCalledWith('/login')
  })
})

describe('MobileBottomNav 手机底栏', () => {
  it('层 tab 点按 = openFresh(layer.home) + push,激活层高亮', async () => {
    const w = mount(MobileBottomNav)
    const tabs = useTabsStore()
    const btns = w.findAll('.mbn-tab')
    expect(btns.map(b => b.text())).toEqual(['数据', '报表', '分析'])
    expect(btns[0].classes()).toContain('on')
    await btns[1].trigger('click')
    expect(tabs.epochOf('reports-home')).toBe(1)
    expect(push).toHaveBeenCalledWith('/reports-home')
  })
})
