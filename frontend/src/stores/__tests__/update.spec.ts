// 版本更新 store(VERSION-UPDATE-SPEC §3 / §6)。
// 断言钉的是「什么时候弹 / 什么时候出提示条」这两件会上屏的事。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUpdateStore, POLL_MS, POPUP_DELAY_MS } from '../update'
import { useAuthStore } from '../auth'
import { CHANGELOG } from '@/changelog'

vi.mock('@/api', () => ({
  default: { post: vi.fn(() => Promise.resolve(undefined)), delete: vi.fn(() => Promise.resolve(undefined)) },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

// 构建时注入的版本号 = package.json 的 version;测试里它同样有值。
const VER = __APP_VERSION__

function login(who = 'zhou') {
  const auth = useAuthStore()
  auth.me = who
  return auth
}

describe('update store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('没登录时不算未读(蓝点不亮)', () => {
    const u = useUpdateStore()
    expect(u.unread).toBe(false)
  })

  it('登录后、没看过当前版本 ⇒ 未读', () => {
    login()
    const u = useUpdateStore()
    u.loadSeen()
    expect(u.unread).toBe(true)
  })

  it('已读按账号分开记:另一个人登录还要再弹一次', () => {
    localStorage.setItem(`fp-seen-version:zhou`, VER)
    login('zhou')
    const a = useUpdateStore()
    a.loadSeen()
    expect(a.unread).toBe(false)

    login('li')
    a.loadSeen()
    expect(a.unread).toBe(true)
  })

  it('markSeen 关窗并落盘,之后不再未读', () => {
    login()
    const u = useUpdateStore()
    u.loadSeen()
    u.popupOpen = true
    u.markSeen()
    expect(u.popupOpen).toBe(false)
    expect(localStorage.getItem('fp-seen-version:zhou')).toBe(VER)
    expect(u.unread).toBe(false)
  })

  it('首屏安顿后才弹,且只弹一次', () => {
    login()
    const u = useUpdateStore()
    u.loadSeen()
    u.scheduleFirstPopup()
    expect(u.popupOpen).toBe(false)      // 还没到点:不压在骨架上
    vi.advanceTimersByTime(POPUP_DELAY_MS)
    expect(u.popupOpen).toBe(true)

    u.markSeen()
    u.scheduleFirstPopup()
    vi.advanceTimersByTime(POPUP_DELAY_MS * 3)
    expect(u.popupOpen).toBe(false)      // 本次会话已经弹过
  })

  it('同一个页面里换账号登录 ⇒ 新账号照样弹一次', () => {
    const auth = login('zhou')
    const u = useUpdateStore()
    u.loadSeen()
    u.scheduleFirstPopup()
    vi.advanceTimersByTime(POPUP_DELAY_MS)
    expect(u.popupOpen).toBe(true)
    u.markSeen()

    auth.me = 'li'          // 退出后另一个人进来(外壳重挂,store 还是同一个)
    u.loadSeen()
    u.scheduleFirstPopup()
    vi.advanceTimersByTime(POPUP_DELAY_MS)
    expect(u.popupOpen).toBe(true)
  })

  it('等待期间进了编辑态 ⇒ 到点也不弹', () => {
    const auth = login()
    const u = useUpdateStore()
    u.loadSeen()
    u.scheduleFirstPopup()
    auth.openEditor(Symbol('ledger'))
    vi.advanceTimersByTime(POPUP_DELAY_MS)
    expect(u.popupOpen).toBe(false)
  })

  it('入口提示每个账号只出一次,4 秒后收起', () => {
    login()
    const u = useUpdateStore()
    u.showCoachOnce()
    expect(u.coachOn).toBe(true)
    vi.advanceTimersByTime(4000)
    expect(u.coachOn).toBe(false)

    u.showCoachOnce()
    expect(u.coachOn).toBe(false)        // 第二次不再出
  })

  it('入口提示点屏幕任意处也收起', () => {
    login()
    const u = useUpdateStore()
    u.showCoachOnce()
    expect(u.coachOn).toBe(true)
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(u.coachOn).toBe(false)
  })

  it('从「本次更新」进来的更新记录才记来路(手机上给返回)', () => {
    login()
    const u = useUpdateStore()
    u.openHistory(true)
    expect(u.historyFromWhatsNew).toBe(true)
    u.historyOpen = false
    u.openHistory()
    expect(u.historyFromWhatsNew).toBe(false)
  })

  it('轮询到服务器换了版本 ⇒ 提示条出「有新版」', async () => {
    login()
    const u = useUpdateStore()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '9.9.9' }) })))
    await u.checkVersion()
    expect(u.serverVersion).toBe('9.9.9')
    expect(u.barKind).toBe('new')
  })

  it('服务器版本和自己一样 ⇒ 不出提示条', async () => {
    login()
    const u = useUpdateStore()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: VER }) })))
    await u.checkVersion()
    expect(u.barKind).toBe(null)
  })

  it('取版本失败(断网)不上屏', async () => {
    const u = useUpdateStore()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    await u.checkVersion()
    expect(u.serverVersion).toBe(null)
    expect(u.barKind).toBe(null)
  })

  it('按需加载失败压过「有新版」,文案换成第二种', async () => {
    const u = useUpdateStore()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '9.9.9' }) })))
    await u.checkVersion()
    u.reportBlocked()
    expect(u.barKind).toBe('blocked')
  })

  it('点 × 只压住这一版的「有新版」;之后真打不开仍然出', async () => {
    const u = useUpdateStore()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '9.9.9' }) })))
    await u.checkVersion()
    u.dismissBar()
    expect(u.barKind).toBe(null)
    u.reportBlocked()
    expect(u.barKind).toBe('blocked')
    u.dismissBar()                       // 关掉第二种后,被压住的第一种不复活
    expect(u.barKind).toBe(null)
  })

  it('轮询:每 POLL_MS 问一次,切回标签页额外问一次', () => {
    const u = useUpdateStore()
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: VER }) }))
    vi.stubGlobal('fetch', fetchMock)
    u.startPolling()
    vi.advanceTimersByTime(POLL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchMock).toHaveBeenCalledTimes(2)   // jsdom 默认 visibilityState = 'visible'
    u.stopPolling()
    vi.advanceTimersByTime(POLL_MS * 2)
    expect(fetchMock).toHaveBeenCalledTimes(2)   // 停了就不再问
  })

  it('取的是不缓存的 /version.json(缓存住等于这条提示永远不出)', async () => {
    const u = useUpdateStore()
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: VER }) }))
    vi.stubGlobal('fetch', fetchMock)
    await u.checkVersion()
    expect(fetchMock).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
  })

  it('当前版本必须写进 changelog,否则不弹也不点蓝点', () => {
    login()
    const u = useUpdateStore()
    u.loadSeen()
    // 这条同时是发版清单的门禁:改了 package.json 版本号却忘了写 changelog.ts,本用例会红。
    expect(CHANGELOG[0].version).toBe(VER)
    expect(u.note?.version).toBe(VER)
    expect(u.unread).toBe(true)
  })
})
