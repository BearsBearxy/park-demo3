// 小调整不弹、功能更新都弹(RELEASE-NOTES-SPEC §7;用户 2026-09-19 拍板)。
// 用一份假的更新记录:0.15.1 小调整 ← 0.15.0 功能更新 ← 0.14.0 功能更新,浏览器里跑的是 0.15.1。
// 「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import type { ReleaseNote } from '@/types/changelog'

// vi.mock 会被提到文件最顶上执行,假数据要跟着一起提上去
const FIXTURE: ReleaseNote[] = vi.hoisted(() => [
  { version: '0.15.1', date: '2026-10-02', headline: '几处小调整', added: [], improved: [{ icon: 'info', title: '提示更清楚', desc: '保存失败时写清是哪一行。' }], fixed: [] },
  {
    version: '0.15.0', date: '2026-10-01', headline: '新增对账单', added: [], improved: [], fixed: [],
    feature: { icon: 'file-text', title: '对账单', desc: '新屏' },
  },
  { version: '0.14.0', date: '2026-09-19', headline: '页签', added: [], improved: [], fixed: [] },
])
vi.mock('@/changelog', async (orig) => {
  const real = await orig<typeof import('@/changelog')>()
  return { ...real, CHANGELOG: FIXTURE, APP_VERSION: '0.15.1', noteOf: (v: string) => FIXTURE.find((n) => n.version === v) }
})
vi.mock('@/api', () => ({
  default: { post: vi.fn(() => Promise.resolve(undefined)), delete: vi.fn(() => Promise.resolve(undefined)) },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ path: '/home' }) }))

import { useUpdateStore, POPUP_DELAY_MS } from '../update'
import { useAuthStore } from '../auth'
import WhatsNewDialog from '@/components/shell/WhatsNewDialog.vue'

function login(seen: string | null) {
  if (seen) localStorage.setItem('fp-seen-version:zhou', seen)
  useAuthStore().me = 'zhou'
  const u = useUpdateStore()
  u.loadSeen()
  return u
}

describe('小调整不弹、功能更新都弹', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('❗看过上一版功能更新,现在是小调整 → 不弹,只亮蓝点', () => {
    const u = login('0.15.0')
    expect(u.unread, '蓝点要亮(更新记录里标「新」)').toBe(true)
    expect(u.popupDue).toBe(false)
    u.scheduleFirstPopup()
    vi.advanceTimersByTime(POPUP_DELAY_MS + 10)
    expect(u.popupOpen).toBe(false)
  })

  it('❗那版功能更新没看过(那几天没登录)→ 照样弹,弹的是功能更新那一版', () => {
    const u = login('0.14.0')
    expect(u.popupNote?.version).toBe('0.15.0')
    u.scheduleFirstPopup()
    vi.advanceTimersByTime(POPUP_DELAY_MS + 10)
    expect(u.popupOpen).toBe(true)
    u.markSeen()
    expect(u.seen, '看过记的是当前版本,之后连蓝点也灭').toBe('0.15.1')
    expect(u.popupDue).toBe(false)
    expect(u.unread).toBe(false)
  })

  it('❗小调整不弹,翻一下更新记录蓝点就灭(不然它永远灭不掉)', () => {
    const u = login('0.15.0')
    expect(u.unread).toBe(true)
    u.openHistory()
    expect(u.unread).toBe(false)
    expect(u.seen).toBe('0.15.1')
  })

  it('从没看过任何一版 → 弹最新那版功能更新', () => {
    const u = login(null)
    expect(u.popupDue).toBe(true)
    expect(u.popupNote?.version).toBe('0.15.0')
  })

  it('❗弹窗里显示的是那版功能更新的内容,不是当前这版小调整', () => {
    login('0.14.0')
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    expect(document.body.textContent).toContain('v0.15.0')
    expect(document.body.textContent).toContain('对账单')
    expect(document.body.textContent).not.toContain('几处小调整')
    w.unmount()
    document.body.innerHTML = ''
  })
})
