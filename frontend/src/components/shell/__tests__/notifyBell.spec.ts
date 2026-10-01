// 铃铛按钮与记号(PAGE-BEHAVIOR-SPEC §5.3,画布 06-G「长什么样」+ 规则表 封顶 / 0 / 位置和大小 / 出现和消失 / 读屏)。
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import NotifyBell from '../NotifyBell.vue'
import ShellTip from '../ShellTip.vue'
import { usePresenceStore } from '@/stores/presence'
import { useBellStore } from '@/stores/bell'
import type { Pending } from '@/api/approvals'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve(undefined)),
    put: vi.fn(() => Promise.resolve(undefined)),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
// 面板是 FE-PANEL 的件,这里只要「点开时挂上、它说关就关」
vi.mock('@/components/shell/NotifyPanel.vue', () => ({
  __esModule: true,   // defineAsyncComponent 靠它认出「这是模块,取 default」
  default: defineComponent({
    name: 'NotifyPanel',
    props: { mobile: Boolean, anchor: { type: Object, default: null } },
    emits: ['close'],
    setup: (_, { emit }) => () => h('div', { class: 'np-stub', onMousedown: () => emit('close') }),
  }),
}))

const APPROVAL: Pending = {
  id: 'ap-1', requester: 'zhang', requesterName: '张会计', requesterRole: '会计',
  perms: ['meters:edit'], permLabels: ['改读数'],
  page: '园区抄表 2026-09', action: '修改读数', impact: '影响 B座 3 块表', leftMs: 102_000,
}

describe('铃铛按钮与记号', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // 破坏:记号文字改读 bell.red → 99+ 那条红;按钮名字不读 bell.ariaLabel → 第一条红
  it('❗红 4 → 记号写 4,按钮名字「通知，4 件等你处理」;记号本身 aria-hidden', () => {
    const p = usePresenceStore()
    p.approvals = [APPROVAL]; p.pendingReviews = 2; p.myReturned = 1
    const w = mount(NotifyBell)
    expect(w.get('.nb-num').text()).toBe('4')
    expect(w.get('.nb-num').attributes('aria-hidden')).toBe('true')
    expect(w.get('button').attributes('aria-label')).toBe('通知，4 件等你处理')
    expect(w.find('.nb-dot').exists()).toBe(false)
  })

  it('❗红 120 → 记号写 99+', () => {
    usePresenceStore().pendingReviews = 120
    const w = mount(NotifyBell)
    expect(w.get('.nb-num').text()).toBe('99+')
  })

  // 破坏:v-else-if="bell.blue" 改成 v-else-if="true" → 「都没有」那条红;删掉蓝点那行 → 这条红
  it('❗红 0、有没看过的结果 → 只有蓝点,没有数字;名字「通知，有新消息」', () => {
    usePresenceStore().unseenResults = 1
    const w = mount(NotifyBell)
    expect(w.get('.nb-dot').attributes('aria-hidden')).toBe('true')
    expect(w.find('.nb-num').exists()).toBe(false)
    expect(w.get('button').attributes('aria-label')).toBe('通知，有新消息')
  })

  it('❗都没有 → 整个记号不出现,名字只写「通知」', () => {
    const w = mount(NotifyBell)
    expect(w.find('.nb-num').exists()).toBe(false)
    expect(w.find('.nb-dot').exists()).toBe(false)
    expect(w.get('button').attributes('aria-label')).toBe('通知')
  })

  // 破坏:ShellTip title 改字 / 改读 bell.ariaLabel → 红;手机按钮 aria-label 写死(哪怕写「通知」)→ 红
  // 夹具用红 4:「通知」与按钮名字在这个状态下不同,写死成「通知」才分得出来
  it('❗悬停说明只写「通知」(桌面);手机按钮 44 档、无悬停说明,名字跟着记号', () => {
    const p = usePresenceStore()
    p.approvals = [APPROVAL]; p.pendingReviews = 2; p.myReturned = 1
    const d = mount(NotifyBell)
    expect(d.getComponent(ShellTip).props('title')).toBe('通知')
    expect(d.getComponent(ShellTip).props('sub')).toBeUndefined()
    const m = mount(NotifyBell, { props: { mobile: true } })
    expect(m.findComponent(ShellTip).exists()).toBe(false)
    expect(m.get('button.nb-mbtn').attributes('aria-label')).toBe('通知，4 件等你处理')
  })

  // 破坏:toggle 里 openPanel 换成空 → 红;去掉 v-if="bell.open" 的面板 → np-stub 恒在,红
  it('❗点铃铛 → 打开面板(懒加载挂上);再点 → 关', async () => {
    const w = mount(NotifyBell)
    expect(w.find('.np-stub').exists()).toBe(false)
    await w.get('button').trigger('click')
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(useBellStore().open).toBe(true)
    expect(w.find('.np-stub').exists()).toBe(true)
    expect(w.get('button').attributes('aria-expanded')).toBe('true')
    await w.get('button').trigger('click')
    await flushPromises()
    expect(useBellStore().open).toBe(false)
    expect(w.find('.np-stub').exists()).toBe(false)
  })

  // 破坏:NotifyBell 不传 :anchor="host" → 红(面板挂在 body 上,桌面靠它按铃铛的位置摆)
  it('❗面板拿到铃铛这个元素当锚点', async () => {
    const w = mount(NotifyBell)
    await w.get('button').trigger('click')
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(w.getComponent({ name: 'NotifyPanel' }).props('anchor')).toBe(w.get('.nb').element)
  })

  // 破坏:删掉 closedAt 判断 → 面板被 mousedown 关掉后,紧跟的 click 又把它开了,红
  it('❗面板被「点外面」关掉的那一下落在铃铛上 → 不重开', async () => {
    const w = mount(NotifyBell)
    await w.get('button').trigger('click')
    await vi.dynamicImportSettled()
    await flushPromises()
    await w.get('.np-stub').trigger('mousedown')   // 面板说关(等同点外面)
    await w.get('button').trigger('click')          // 同一下的 click 落到铃铛上
    await flushPromises()
    expect(useBellStore().open).toBe(false)
  })
})

// 位置和大小:把组件自己的 <style> 塞进 document 读 getComputedStyle(同 darkOverrides.spec 的做法;令牌 jsdom 不求值,判据是令牌名)
describe('记号的尺寸与动效', () => {
  const css = [...readFileSync(join(__dirname, '../NotifyBell.vue'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  afterAll(() => style.remove())
  const look = (cls: string, wrap = 'nb') => {
    const host = document.createElement('span')
    host.className = wrap
    host.innerHTML = `<span class="${cls}"></span>`
    document.body.appendChild(host)
    const s = getComputedStyle(host.firstElementChild!)
    const r = { pos: s.position, top: s.top, right: s.right, left: s.left, h: s.height, w: s.width, minW: s.minWidth, shadow: s.boxShadow, tr: s.transition }
    host.remove()
    return r
  }

  // 破坏:height 16 改 14 / 去掉 min-width / 改成 left 钉 → 红
  it('❗数字 16 高、至少 16 宽,右沿钉住只往宽里长;外圈 2px 底色描边', () => {
    const n = look('nb-num')
    expect(n).toMatchObject({ pos: 'absolute', h: '16px', minW: '16px', top: '-6px', right: '-6px', left: '' })
    expect(n.shadow).toBe('0 0 0 2px var(--surface-white)')
  })

  // 破坏:蓝点 8 改 6 / 描边改 1.5px → 红
  it('❗蓝点 8×8,同样 2px 描边', () => {
    const d = look('nb-dot')
    expect(d).toMatchObject({ pos: 'absolute', h: '8px', w: '8px' })
    expect(d.shadow).toBe('0 0 0 2px var(--surface-white)')
  })

  // 破坏:.nb-mbtn 的 width / height 改 32px → 红(RESPONSIVE §6.2 触达 ≥44;它不在 MobileTopBar 里,topBarAction.spec 管不到)
  // 破坏:.nb-m .nb-num / .nb-dot 的 top / right 改掉 → 红
  it('❗手机铃铛按钮 44×44;记号贴在 44 按钮里的铃铛右上', () => {
    expect(look('nb-mbtn')).toMatchObject({ w: '44px', h: '44px' })
    expect(look('nb-num', 'nb nb-m')).toMatchObject({ top: '3px', right: '3px' })
    expect(look('nb-dot', 'nb nb-m')).toMatchObject({ top: '8px', right: '8px' })
  })

  // 破坏:过渡时长改 --dur-base → 红
  it('❗出现、消失 120ms 淡入淡出(--dur-fast = 120ms)', () => {
    expect(look('nb-fade-enter-active').tr).toBe('opacity var(--dur-fast) linear')
    expect(look('nb-fade-leave-active').tr).toBe('opacity var(--dur-fast) linear')
    const tokens = readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8')
    expect(tokens).toMatch(/--dur-fast:\s*120ms;/)
  })
})
