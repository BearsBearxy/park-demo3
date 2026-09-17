// 刷新提示条(VERSION-UPDATE-SPEC §6)与自动弹出的挂载点(§3),都长在 AppShell 上。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useUpdateStore, POPUP_DELAY_MS } from '@/stores/update'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore } from '@/stores/presence'
import { BRAND } from '@/brand'

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

// Teleport 不 stub:提示条与弹窗都 Teleport 到 body,stub 掉就断言不到真实位置。
const mountShell = () =>
  mount(AppShell, {
    attachTo: document.body,
    global: { stubs: { IconRail: true, SidebarPanel: true, TabStrip: true, Toolbar: true, CommandPalette: true } },
  })

async function serverSays(version: string) {
  const upd = useUpdateStore()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version }) })))
  await upd.checkVersion()
  await nextTick()
  return upd
}

describe('AppShell · 刷新提示条', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    usePresenceStore().stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('服务器换了版本 ⇒ 底部出提示条,写新版本号', async () => {
    const w = mountShell()
    await serverSays('9.9.9')
    const bar = document.querySelector('.fp-upd-toast')!
    expect(bar).toBeTruthy()
    expect(bar.textContent).toContain(`${BRAND.name}已更新到 v9.9.9`)
    expect(bar.textContent).toContain('刷新后生效')
    w.unmount()
  })

  it('编辑态换一句话:先保存再刷新', async () => {
    const w = mountShell()
    useAuthStore().openEditor(Symbol('ledger'))
    await serverSays('9.9.9')
    expect(document.querySelector('.fp-upd-toast')!.textContent).toContain('你正在编辑，保存后再刷新')
    w.unmount()
  })

  it('按需加载失败 ⇒ 换成「这一页属于新版本」', async () => {
    const w = mountShell()
    const upd = useUpdateStore()
    upd.reportBlocked()
    await nextTick()
    expect(document.querySelector('.fp-upd-toast')!.textContent).toContain('这一页属于新版本，刷新后才能打开')
    w.unmount()
  })

  it('点「刷新」重新打开当前地址', async () => {
    const w = mountShell()
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await serverSays('9.9.9')
    const btn = [...document.querySelectorAll('.fp-upd-toast .act')].find((b) => b.textContent === '刷新')!
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(reload).toHaveBeenCalled()
    w.unmount()
  })

  it('点 × 收起;这一版不再提示', async () => {
    const w = mountShell()
    const upd = await serverSays('9.9.9')
    const x = [...document.querySelectorAll('.fp-upd-toast .act')].find((b) => b.textContent === '×')!
    x.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('.fp-upd-toast')).toBeNull()
    expect(upd.barKind).toBe(null)
    w.unmount()
  })

  it('下面还有别的提示条时往上让位(--lift 数的是下面几条)', async () => {
    const w = mountShell()
    const upd = await serverSays('9.9.9')
    const bar = () => document.querySelector('.fp-upd-toast') as HTMLElement
    expect(bar().style.getPropertyValue('--lift')).toBe('0')

    useUiStore().reportNetError('读取失败，请检查网络')
    await nextTick()
    expect(bar().style.getPropertyValue('--lift')).toBe('1')
    expect(upd.barKind).toBe('new')
    w.unmount()
  })

  it('「本次更新」开着时先不出,关掉弹窗才出(提示档会压住弹窗按钮)', async () => {
    const w = mountShell()
    const upd = await serverSays('9.9.9')
    upd.popupOpen = true
    await nextTick()
    expect(document.querySelector('.fp-upd-toast')).toBeNull()

    upd.popupOpen = false
    await nextTick()
    expect(document.querySelector('.fp-upd-toast')).toBeTruthy()
    w.unmount()
  })

  it('自己这一版和服务器一样 ⇒ 不出提示条', async () => {
    const w = mountShell()
    const upd = useUpdateStore()
    await serverSays(upd.version)
    expect(document.querySelector('.fp-upd-toast')).toBeNull()
    w.unmount()
  })
})

describe('AppShell · 自动弹出', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    usePresenceStore().stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('没登录不弹', async () => {
    vi.useFakeTimers()
    const w = mountShell()
    vi.advanceTimersByTime(POPUP_DELAY_MS * 2)
    await nextTick()
    expect(useUpdateStore().popupOpen).toBe(false)
    w.unmount()
  })

  it('登录且没看过 ⇒ 等首屏安顿后置位(弹窗本体懒加载)', async () => {
    vi.useFakeTimers()
    const auth = useAuthStore()
    auth.me = 'zhou'
    const w = mountShell()
    const upd = useUpdateStore()
    upd.loadSeen()
    upd.scheduleFirstPopup()
    expect(upd.popupOpen).toBe(false)
    vi.advanceTimersByTime(POPUP_DELAY_MS)
    await nextTick()
    expect(upd.popupOpen).toBe(true)
    w.unmount()
  })
})
