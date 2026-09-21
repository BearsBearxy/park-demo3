import { landNav } from '@/test-utils/landNav'
import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { reactive } from 'vue'

const push = vi.fn(landNav)
// meta 可变:要造「当前屏属不可见层」那一档(股东从书签进 /ledger)
const route = reactive({ meta: { value: 'data-home', page: '本月出账' } as Record<string, string> })
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}))

import MobileNavDrawer from './MobileNavDrawer.vue'
import MobileBottomNav from './MobileBottomNav.vue'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  push.mockClear()
  setActivePinia(createPinia())
  route.meta = { value: 'data-home', page: '本月出账' }
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

  it('目录条目 = open(恢复 KeepAlive 现场,epoch 不动)+ push + 关抽屉(P3 §4.1:与桌面侧栏同义)', async () => {
    const w = mountDrawer()
    const tabs = useTabsStore()
    await w.findAll('.mnav-row').find(r => r.text().includes('租户管理'))!.trigger('click')
    expect(tabs.epochOf('tenants')).toBe(0)
    expect(tabs.tabs.map(t => t.value)).toContain('tenants')
    expect(push).toHaveBeenCalledWith('/tenants')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('点当前屏的目录条目:不 push,但照常关抽屉', async () => {
    const w = mountDrawer()
    push.mockClear()
    await w.findAll('.mnav-row').find(r => r.text().includes('本月出账'))!.trigger('click')
    expect(push).not.toHaveBeenCalled()
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

  it('当前屏属不可见层时,唯一那颗胶囊照样点得动 —— guard 比的是不带兜底的当前层', async () => {
    useAuthStore().navLayers = ['analysis']
    route.meta = { value: 'ledger', page: '月度台账' }   // 数据层的屏(读全开,深链能进),但数据层不可见
    const w = mountDrawer()
    push.mockClear()
    await w.findAll('button').find(b => b.text().includes('分析'))!.trigger('click')
    expect(push, '兜底出来的层被当成「当前层」,胶囊变成死钮').toHaveBeenCalled()
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

  // 外观(DARK-MODE-SPEC §3,稿 Mobile):「版本更新」上面一行,三格都点得着;点了不关抽屉
  it('❗外观一行在「版本更新」上面,点「深色」立刻生效、抽屉不关', async () => {
    useAuthStore().me = 'zhou'
    const w = mountDrawer()
    const ver = w.find('.mnav-ver').html()
    expect(ver.indexOf('外观')).toBeGreaterThan(-1)
    expect(ver.indexOf('外观')).toBeLessThan(ver.indexOf('版本更新'))
    const seg = w.findAll('.mnav-appr-seg button')
    expect(seg.map((b) => b.text())).toEqual(['浅色', '深色', '跟随系统'])
    await seg[1].trigger('click')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('fp-appearance:zhou')).toBe('dark')
    expect(w.emitted('close')).toBeUndefined()
    await w.findAll('.mnav-appr-seg button')[0].trigger('click')
  })

})

describe('MobileBottomNav 手机底栏', () => {
  it('层 tab 点按 = openFresh(layer.home) + push,激活层高亮', async () => {
    const w = mount(MobileBottomNav)
    const tabs = useTabsStore()
    const btns = w.findAll('.mbn-tab')
    expect(btns.map(b => b.text())).toEqual(['首页', '数据', '报表', '分析'])
    expect(btns[1].classes()).toContain('on')
    await btns[2].trigger('click')
    expect(tabs.epochOf('reports-home')).toBe(1)
    expect(push).toHaveBeenCalledWith('/reports-home')
  })

  it('点当前层:不 push、不动页签(§4.1)', async () => {
    const w = mount(MobileBottomNav)
    const tabs = useTabsStore()
    push.mockClear()
    await w.findAll('button').find(b => b.text().includes('数据'))!.trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(tabs.epochOf('data-home')).toBe(0)
  })

  // ── 首页格(2026-09-21 补)──────────────────────────────────────────────
  // 补它的理由:S 档不渲染页签条,抽屉里也没有首页,而 'home' 不在 fpNav 里
  // → buildAllPages 滤掉它 → 命令面板与「最近打开」同样搜不到。
  // 登录落在首页,点走一次就再也回不来 —— 这三条钉的就是「回得来」。
  it('❗首页格 = open(纪元不动,恢复现场)+ push —— 用户拍板不走 openFresh', async () => {
    const w = mount(MobileBottomNav)
    const tabs = useTabsStore()
    const btn = w.findAll('.mbn-tab')[0]
    expect(btn.text(), '第一格不是首页').toBe('首页')
    await btn.trigger('click')
    expect(push).toHaveBeenCalledWith('/home')
    expect(tabs.epochOf('home'), 'openFresh 会 epoch++ 把首页的 KeepAlive 现场丢掉').toBe(0)
  })

  it('❗站在首页时只有首页高亮 —— 「数据」不许跟着亮', async () => {
    route.meta = { value: 'home', page: '首页' }
    const w = mount(MobileBottomNav)
    const btns = w.findAll('.mbn-tab')
    // 先证明选到的确实是那四格(不是空集合恒真)
    expect(btns.map(b => b.text())).toEqual(['首页', '数据', '报表', '分析'])
    expect(btns[0].classes()).toContain('on')
    // 'home' 不在 fpNav 任何一层里,fpFindLayer 取不到会回落 FP_NAV[0](数据)——
    // 不判 onHome 的话这一格会跟首页同时亮。
    expect(btns.filter(b => b.classes().includes('on')).map(b => b.text()),
      '两格同时高亮:fpFindLayer 回落到了数据层').toEqual(['首页'])
  })

  it('已在首页时再点首页:不 push(与点当前层同义)', async () => {
    route.meta = { value: 'home', page: '首页' }
    const w = mount(MobileBottomNav)
    push.mockClear()
    await w.findAll('.mbn-tab')[0].trigger('click')
    expect(push).not.toHaveBeenCalled()
  })
})
