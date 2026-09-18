// 版本更新的三处入口与两个弹窗(VERSION-UPDATE-SPEC §1/§2/§4)。
// 断言钉的是会上屏的东西:蓝点在不在、点了开哪个、尺寸与分组对不对。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useUpdateStore } from '@/stores/update'
import { useAuthStore } from '@/stores/auth'
import { CHANGELOG } from '@/changelog'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'tenants', page: '租户管理', layerLabel: '数据中心' }, path: '/tenants' }),
  useRouter: () => ({ push }),
}))
vi.mock('@/components/shell/CommandPalette.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/fp/GradientWave.vue', () => ({ default: { name: 'GradientWaveStub', render: () => null } }))
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
import IconRail from '../IconRail.vue'
import WhatsNewDialog from '../WhatsNewDialog.vue'
import ChangelogDialog from '../ChangelogDialog.vue'

const CUR = CHANGELOG[0]

function login(who = 'zhou') {
  const auth = useAuthStore()
  auth.me = who
  auth.displayName = '周明'
  const upd = useUpdateStore()
  upd.loadSeen()
  return { auth, upd }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  push.mockClear()
  document.body.innerHTML = ''
})

describe('入口:顶栏 ✦', () => {
  it('有没看过的更新 ⇒ ✦ 上一颗蓝点;看过就没有', async () => {
    const { upd } = login()
    const w = mount(Toolbar, { global: { stubs: { FPPresenceBar: true } } })
    expect(w.find('.fp-upd-dot').exists()).toBe(true)

    upd.markSeen()
    await nextTick()
    expect(w.find('.fp-upd-dot').exists()).toBe(false)
  })

  it('点 ✦ 开「更新记录」;悬停说明带版本号(TAB-BAR-SPEC §6.4)', async () => {
    const { upd } = login()
    vi.useFakeTimers()
    const w = mount(Toolbar, { global: { stubs: { FPPresenceBar: true } }, attachTo: document.body })
    const btn = w.find('button[aria-label="版本更新"]')
    btn.element.parentElement!.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(document.body.querySelector('.fp-tip')!.textContent).toBe(`版本更新v${upd.version}这一版改了什么`)
    vi.useRealTimers()
    await btn.trigger('click')
    expect(upd.historyOpen).toBe(true)
    w.unmount()
  })

  it('看完弹窗后 ✦ 下方提示一次入口在哪', async () => {
    const { upd } = login()
    const w = mount(Toolbar, { global: { stubs: { FPPresenceBar: true } } })
    expect(w.find('.fp-upd-coach').exists()).toBe(false)
    upd.showCoachOnce()
    await nextTick()
    expect(w.find('.fp-upd-coach').text()).toBe('更新记录随时在这里看')
  })
})

describe('入口:账号菜单', () => {
  it('菜单里有「版本更新」一行,右侧写当前版本号,未读时带蓝点', async () => {
    const { upd } = login()
    const w = mount(IconRail)
    await w.find('button[aria-label="当前账号"]').trigger('click')
    const row = w.findAll('.fp-user-row').find((b) => b.text().includes('版本更新'))
    expect(row).toBeTruthy()
    expect(row!.text()).toContain(`v${upd.version}`)
    expect(row!.find('.dot').exists()).toBe(true)

    await row!.trigger('click')
    expect(upd.historyOpen).toBe(true)
  })
})

describe('本次更新弹窗', () => {
  it('页头写版本号与一句话标题,三组条数与 changelog 一致', () => {
    login()
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    const dlg = document.querySelector('.wn')!
    expect(dlg.querySelector('.wn-ver')!.textContent).toBe(`v${CUR.version}`)
    expect(dlg.querySelector('.wn-sub')!.textContent).toBe(CUR.headline)
    // 「新增」把重点那条也算进去(它在弹窗顶上单独一张卡)
    expect(dlg.querySelectorAll('.wn-sec')[0].textContent).toContain(`${CUR.added.length + 1} 项`)
    expect(dlg.querySelectorAll('.wn-sec')[1].textContent).toContain(`${CUR.improved.length} 项`)
    expect(dlg.querySelectorAll('.wn-fix li').length).toBe(CUR.fixed.length)
    w.unmount()
  })

  it('「知道了」= 看过了(四条关闭路径之一),并提示一次入口', async () => {
    const { upd } = login()
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    upd.popupOpen = true
    const btn = [...document.querySelectorAll('.wn-foot button')].find((b) => b.textContent?.includes('知道了'))!
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(upd.seen).toBe(upd.version)
    expect(upd.popupOpen).toBe(false)
    expect(upd.coachOn).toBe(true)
    w.unmount()
  })

  it('点遮罩、按 Esc 一样算看过', async () => {
    const { upd } = login()
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    document.querySelector('.wn-scrim')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(upd.seen).toBe(upd.version)
    w.unmount()

    localStorage.clear()
    const { upd: u2 } = login()
    const w2 = mount(WhatsNewDialog, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(u2.seen).toBe(u2.version)
    w2.unmount()
  })

  it('点弹窗里的条目:算看过、跳到那一屏', async () => {
    const { upd } = login()
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    const first = CUR.added.find((i) => i.to)!
    // 按标题精确找行:别的条目的说明里也可能出现这几个字(0.14.0 重点卡的说明里就有「首页」)
    const row = [...document.querySelectorAll('.wn-row')].find((r) => r.querySelector('.t')?.textContent === first.title)!
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(push).toHaveBeenCalledWith('/' + first.to)
    expect(upd.seen).toBe(upd.version)
    w.unmount()
  })

  it('「查看全部更新记录」换成更新记录弹窗', async () => {
    const { upd } = login()
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    const lnk = [...document.querySelectorAll('.wn-foot button')].find((b) => b.textContent?.includes('查看全部更新记录'))!
    lnk.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(upd.historyOpen).toBe(true)
    expect(upd.popupOpen).toBe(false)
    w.unmount()
  })
})

describe('更新记录弹窗', () => {
  it('默认选中当前版本,当前版本带「当前版本」标记', () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    expect(document.querySelector('.cl-vv')!.textContent).toContain(`v${CUR.version}`)
    expect(document.querySelector('.cl-cur')).toBeTruthy()
    expect(document.querySelectorAll('.cl-item').length).toBe(CHANGELOG.length)
    w.unmount()
  })

  it('返回按钮只在从「本次更新」进来时给', async () => {
    const { upd } = login()
    upd.openHistory()                       // 从顶栏 ✦ 进来
    const w = mount(ChangelogDialog, { attachTo: document.body })
    expect(document.querySelector('.cl-back')).toBeNull()
    w.unmount()

    upd.openHistory(true)                   // 从「本次更新」进来
    const w2 = mount(ChangelogDialog, { attachTo: document.body })
    expect(document.querySelector('.cl-back')).toBeTruthy()
    w2.unmount()
  })

  it('未读时当前版本带「新」,看过就没有', async () => {
    const { upd } = login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    expect(document.querySelector('.cl-new')).toBeTruthy()
    upd.markSeen()
    await nextTick()
    expect(document.querySelector('.cl-new')).toBeNull()
    w.unmount()
  })

  it('切到旧版本:只换右边内容,且旧版本条目不给「去看看」', async () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    const items = document.querySelectorAll('.cl-item')
    items[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('.cl-vv')!.textContent).toContain(`v${CHANGELOG[1].version}`)
    expect(document.querySelector('.cl-cur')).toBeNull()
    expect(document.querySelectorAll('.cl-lnk').length).toBe(0)
    // 列表本身没变(弹窗不变尺寸,只换右边)
    expect(document.querySelectorAll('.cl-item').length).toBe(CHANGELOG.length)
    w.unmount()
  })

  it('当前版本里能跳的条目点了就跳并关窗', async () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    const it = CUR.added.find((i) => i.to)!
    const row = [...document.querySelectorAll('.cl-row')].find((r) => r.querySelector('.t')?.textContent === it.title)!
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(push).toHaveBeenCalledWith('/' + it.to)
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})
