// 客户园区只看装机那一版之后的更新(2026-10-05 用户拍板「按你建议修改」;后端 RELEASE_BASELINE → GET /api/app/config)。
// 我园生产 baseline=0.0.0,一切照旧;部署配置没到之前一版都不算 —— 弹窗不先闪出旧更新。
// 夹具:0.12.0 功能更新(当前)← 0.11.1 小调整 ← 0.11.0 ← 0.10.0 ← 0.10.0-beta.1 ← 0.9.0。「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import type { ReleaseNote } from '@/types/changelog'

const FIXTURE: ReleaseNote[] = vi.hoisted(() => ['0.12.0', '0.11.1', '0.11.0', '0.10.0', '0.10.0-beta.1', '0.9.0'].map((v) => ({
  version: v, date: '2026-10-01', headline: `第 ${v} 版`, added: [], improved: [{ icon: 'info', title: v, desc: '说明' }], fixed: [],
})))
vi.mock('@/changelog', async (orig) => {
  const real = await orig<typeof import('@/changelog')>()
  return { ...real, CHANGELOG: FIXTURE, APP_VERSION: '0.12.0', noteOf: (v: string) => FIXTURE.find((n) => n.version === v) }
})
const get = vi.hoisted(() => vi.fn())
vi.mock('@/api', () => ({
  default: { get, post: vi.fn(() => Promise.resolve(undefined)), delete: vi.fn(() => Promise.resolve(undefined)) },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ path: '/home' }) }))

import { cmpVersion } from '@/changelog'
import { useUpdateStore, POPUP_DELAY_MS } from '../update'
import { useAuthStore } from '../auth'
import { useAppConfigStore } from '../appConfig'
import { ourPark, customerPark } from '@/test-utils/appConfig'
import ChangelogDialog from '@/components/shell/ChangelogDialog.vue'

const versions = () => useUpdateStore().notes.map((n) => n.version)
function login() {
  useAuthStore().me = 'zhou'
  const u = useUpdateStore()
  u.loadSeen()
  return u
}

describe('版本号比较认预发布后缀', () => {
  it('❗数字相同时带后缀的更旧;两个都带按后缀自然序比', () => {
    expect(cmpVersion('0.10.0-beta.1', '0.10.0')).toBeLessThan(0)
    expect(cmpVersion('0.10.0', '0.10.0-beta.1')).toBeGreaterThan(0)
    expect(cmpVersion('0.10.0-beta.2', '0.10.0-beta.10')).toBeLessThan(0)
    expect(cmpVersion('0.10.0-beta.1', '0.10.0-beta.1')).toBe(0)
    expect(cmpVersion('0.10.0-beta.1', '0.9.0')).toBeGreaterThan(0)
    expect(cmpVersion('0.11.0', '0.10.0')).toBeGreaterThan(0)
  })
})

describe('更新记录按装机版本算', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    get.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('我园(0.0.0):六版全算,当前版亮蓝点、弹当前版', () => {
    ourPark()
    const u = login()
    expect(versions()).toEqual(['0.12.0', '0.11.1', '0.11.0', '0.10.0', '0.10.0-beta.1', '0.9.0'])
    expect(u.unread).toBe(true)
    expect(u.popupNote?.version).toBe('0.12.0')
  })

  it('❗客户装机就是当前版:一版都不算 —— 不亮蓝点、不弹', () => {
    customerPark('0.12.0')
    const u = login()
    expect(versions()).toEqual([])
    expect(u.note).toBeUndefined()
    expect(u.unread).toBe(false)
    expect(u.popupDue).toBe(false)
    u.scheduleFirstPopup()
    vi.advanceTimersByTime(POPUP_DELAY_MS * 3)
    expect(u.popupOpen).toBe(false)
  })

  it('❗客户装机在 0.11.0:只算之后的两版,弹的是 0.12.0', () => {
    customerPark('0.11.0')
    const u = login()
    expect(versions()).toEqual(['0.12.0', '0.11.1'])
    expect(u.popupNote?.version).toBe('0.12.0')
  })

  it('❗装机版本带预发布后缀:0.10.0-beta.1 装的看得到 0.10.0;0.10.0 装的看不到它的 beta', () => {
    customerPark('0.10.0-beta.1')
    expect(versions()).toContain('0.10.0')
    expect(versions()).not.toContain('0.10.0-beta.1')
    customerPark('0.10.0')
    expect(versions()).toEqual(['0.12.0', '0.11.1', '0.11.0'])
  })

  it('❗部署配置没到:一版都不算,弹窗等它;到了(我园)才弹', async () => {
    let arrive!: (v: unknown) => void
    get.mockReturnValue(new Promise((r) => { arrive = r }))
    const u = login()
    expect(versions()).toEqual([])
    u.scheduleFirstPopup()
    await vi.advanceTimersByTimeAsync(POPUP_DELAY_MS * 5)
    expect(u.popupOpen, '配置没到不许弹(会先闪出客户看不到的旧版)').toBe(false)
    expect(get).toHaveBeenCalledWith('/app/config')

    arrive({ parkTools: true, releaseBaseline: '0.0.0' })
    await vi.advanceTimersByTimeAsync(POPUP_DELAY_MS + 10)
    expect(u.popupOpen).toBe(true)
    expect(u.popupNote?.version).toBe('0.12.0')
  })

  // 发版重启那几秒刷新的人:第一次拉配置 502,外壳换屏时重拉成功 —— 弹窗照样弹,不等下次登录
  it('❗第一次拉配置失败:之后哪一次拉到了(我园)照样弹', async () => {
    get.mockRejectedValueOnce(new Error('502')).mockResolvedValue({ parkTools: true, releaseBaseline: '0.0.0' })
    const u = login()
    u.scheduleFirstPopup()
    await vi.advanceTimersByTimeAsync(POPUP_DELAY_MS * 3)
    expect(u.popupOpen).toBe(false)
    await useAppConfigStore().ensure()   // 外壳换屏重拉(AppShell 的 route watch)
    await vi.advanceTimersByTimeAsync(POPUP_DELAY_MS + 10)
    expect(u.popupOpen).toBe(true)
    expect(u.popupNote?.version).toBe('0.12.0')
  })

  it('退出登录(外壳卸载)之后配置才到:不弹', async () => {
    let arrive!: (v: unknown) => void
    get.mockReturnValue(new Promise((r) => { arrive = r }))
    const u = login()
    u.scheduleFirstPopup()
    u.stopPolling()
    arrive({ parkTools: true, releaseBaseline: '0.0.0' })
    await vi.advanceTimersByTimeAsync(POPUP_DELAY_MS * 3)
    expect(u.popupOpen).toBe(false)
  })

  it('❗部署配置到了是客户装机当前版:始终不弹', async () => {
    get.mockResolvedValue({ parkTools: false, releaseBaseline: '0.12.0' })
    const u = login()
    u.scheduleFirstPopup()
    await vi.advanceTimersByTimeAsync(POPUP_DELAY_MS * 5)
    expect(u.popupOpen).toBe(false)
  })

  it('❗拉失败不当成拿到了:下次 ensure 再拉;拿到之后不再发请求', async () => {
    const cfg = useAppConfigStore()
    get.mockRejectedValueOnce(new Error('断网')).mockResolvedValue({ parkTools: true, releaseBaseline: '0.0.0' })
    await cfg.ensure()
    expect(cfg.cfg).toBeNull()
    expect(cfg.parkTools, '没拿到按客户园区算').toBe(false)
    await cfg.ensure()
    expect(cfg.parkTools).toBe(true)
    await cfg.ensure()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('❗回包不像部署配置(没有 releaseBaseline)也不当拿到', async () => {
    const cfg = useAppConfigStore()
    get.mockResolvedValue([])
    await cfg.ensure()
    expect(cfg.cfg).toBeNull()
  })
})

describe('更新记录弹窗只列算数的版本', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.innerHTML = ''
    get.mockReset()
    get.mockReturnValue(new Promise(() => {}))   // 弹窗挂载时会补拉一次;各用例自己定配置
    login()
  })
  const items = () => [...document.querySelectorAll('.cl-item .v')].map((e) => e.textContent?.replace('新', '').trim())

  const foot = () => document.querySelector('.cl-foot')!.textContent

  it('我园:六版全列', () => {
    ourPark()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    expect(items()).toHaveLength(6)
    expect(foot()).toContain('更早的版本没有整理记录')
    w.unmount()
  })

  it('❗客户装机在 0.11.0:只列之后的两版,默认停在当前版', () => {
    customerPark('0.11.0')
    const w = mount(ChangelogDialog, { attachTo: document.body })
    expect(items()).toEqual(['v0.12.0', 'v0.11.1'])
    expect(document.querySelector('.cl-vv')!.textContent).toContain('v0.12.0')
    // 更早的版本有记录,只是不列 —— 不许说「没有整理记录」
    expect(foot()).toContain('v0.11.0 及更早的版本不在这里列出')
    expect(foot()).not.toContain('没有整理记录')
    w.unmount()
  })

  it('❗客户装机就是当前版:列表空,右边说一句;配置没到时不说', async () => {
    const w = mount(ChangelogDialog, { attachTo: document.body })
    expect(items()).toEqual([])
    expect(document.body.textContent).not.toContain('装好以后还没有更新过')
    customerPark('0.12.0')
    await w.vm.$nextTick()
    expect(items()).toEqual([])
    expect(document.querySelector('.cl-detail')!.textContent).toBe('装好以后还没有更新过。')
    w.unmount()
  })
})
