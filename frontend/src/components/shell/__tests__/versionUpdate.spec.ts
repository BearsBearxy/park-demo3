// 版本更新的三处入口与两个弹窗(VERSION-UPDATE-SPEC §1/§2/§4)。
// 断言钉的是会上屏的东西:蓝点在不在、点了开哪个、尺寸与分组对不对。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useUpdateStore } from '@/stores/update'
import { useAuthStore } from '@/stores/auth'
import { CHANGELOG } from '@/changelog'
import { RELEASE_ART } from '@/components/shell/release/art'

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
  // 弹的是「最新那版功能更新」(当前是小调整时就不是当前版本,stores/update.ts popupNote)
  it('页头写版本号与一句话标题,三组条数与 changelog 一致', () => {
    const { upd } = login()
    const POP = upd.popupNote!
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    const dlg = document.querySelector('.wn')!
    expect(dlg.querySelector('.wn-ver')!.textContent).toBe(`v${POP.version}`)
    expect(dlg.querySelector('.wn-sub')!.textContent).toBe(POP.headline)
    // 按 chip 认块,不按下标 —— 空的那组整块不渲染(v-if),这版没有「新增」时 wn-sec[0] 就是「改进」。
    // 同一份 spec 底下那条早写过这个教训(0.14.0 两次撞上:写死位置,换一版内容就坏)。
    const secN = (chip: string) => {
      const sec = [...dlg.querySelectorAll('.wn-sec')].find(s => s.querySelector(`.wn-chip.${chip}`))
      return sec ? Number(/(\d+) 项/.exec(sec.textContent ?? '')?.[1]) : 0
    }
    // 「新增」把重点那条也算进去(它在弹窗顶上单独一张卡)
    expect(secN('add')).toBe(POP.added.length + (POP.feature ? 1 : 0))
    expect(secN('imp')).toBe(POP.improved.length)
    expect(secN('fix')).toBe(POP.fixed.length)
    expect(dlg.querySelectorAll('.wn-fix li').length).toBe(POP.fixed.length)
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
    const POP = upd.popupNote!
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    // 弹窗那版里第一条能跳的:可能是重点卡(点它的「去看看」),也可能是新增 / 改进里的一行(按标题精确找行 ——
    // 别的条目说明里也可能出现这几个字)。写死「新增里那条」的话,换一版内容这条就坏(0.14.0 两次撞上)。
    const first = [POP.feature, ...POP.added, ...POP.improved].find((i) => i?.to)
    if (!first) {
      // 这一版没有能跳的条目(0.15.0:外观是设置、不是一屏):那就一个「去看看」都不许出。能跳的正路径在 releaseCard.spec 用假数据钉
      expect(document.querySelector('.rfc-lnk')).toBeNull()
      w.unmount()
      return
    }
    const el = first === POP.feature
      ? document.querySelector('.rfc .rfc-lnk')!
      : [...document.querySelectorAll('.wn-row')].find((r) => r.querySelector('.t')?.textContent === first.title)!
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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
    expect(document.querySelectorAll('.rfc-lnk').length, '旧版本的重点卡也不给「去看看」').toBe(0)
    // 列表本身没变(弹窗不变尺寸,只换右边)
    expect(document.querySelectorAll('.cl-item').length).toBe(CHANGELOG.length)
    w.unmount()
  })

  // 「能跳的点了就跳」这条正路径用假数据钉在 releaseCard.spec.ts(当前版本可能根本没有能跳的,比如小调整版);
  // 这里只钉真数据下的对应关系:当前版本有几条能跳的,就出几个「去看看」
  it('当前版本有几条能跳的条目,就出几个「去看看」', () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    const n = [CUR.feature, ...CUR.added, ...CUR.improved].filter((i) => i?.to).length
    expect(document.querySelectorAll('.cl-lnk, .rfc-lnk').length).toBe(n)
    w.unmount()
  })

  it('❗重点卡和配图在更新记录里也有(关掉弹窗后还看得到);没重点卡的版本不出卡', async () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    const items = [...document.querySelectorAll('.cl-item')]
    for (const [i, n] of CHANGELOG.entries()) {
      items[i].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await nextTick()
      const card = document.querySelector('.cl-detail .rfc')
      expect(!!card, `v${n.version} 重点卡`).toBe(!!n.feature)
      if (n.feature) {
        expect(card!.querySelector('h3')!.textContent).toBe(n.feature.title)
        expect(!!card!.querySelector('.rfc-pic'), `v${n.version} 配图`).toBe(!!RELEASE_ART[n.version])
        // 重点那条只在卡上出现,不在「新增」行里再列一遍
        expect([...document.querySelectorAll('.cl-row .t')].some((t) => t.textContent === n.feature!.title)).toBe(false)
      }
    }
    w.unmount()
  })

  // 左栏标题:<button> 在 Chrome 里默认把内容居中排 —— 不写 align-items 标题就按自身宽度居中、两边撑出框
  // (2026-09-19 用户截图)。jsdom 不排版,这里钉样式源码;真排版在浏览器里量过
  it('❗左栏版本标题撑满栏宽、最多两行,不按自身宽度居中', () => {
    const src = readFileSync(join(__dirname, '..', 'ChangelogDialog.vue'), 'utf8')
    expect(src).toMatch(/\.cl-item \{[^}]*align-items: stretch/)
    expect(src).toMatch(/\.cl-item \.hl \{[^}]*-webkit-line-clamp: 2/)
    expect(src).not.toMatch(/\.cl-item \.hl \{[^}]*white-space: nowrap/)
  })
})
