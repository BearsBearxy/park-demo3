// 顶栏在线的人(TAB-BAR-SPEC §7)。「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { usePresenceStore, type Seat } from '@/stores/presence'
import { personNick } from '@/utils/personNick'
import { tipState } from '@/components/shell/ShellTip.vue'

vi.mock('@/api', () => ({
  default: { get: vi.fn(() => Promise.resolve([])), post: vi.fn(() => Promise.resolve({})), delete: vi.fn(() => Promise.resolve()) },
  readToken: vi.fn(() => 't'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import FPPresenceBar from '../FPPresenceBar.vue'

enableAutoUnmount(afterEach)

const seat = (user: string, displayName: string, o: Partial<Seat> = {}): Seat => ({
  sid: 's-' + user, user, displayName, role: null, scope: null, label: '月度台账', mode: 'view',
  editScopes: [], sinceMs: 252_000, idleMs: 0, self: false, ...o,
})
function people(n: number) {
  const names = [['li', '李娜'], ['wang', '王涛'], ['zhang', '张伟'], ['chen', '陈静'], ['liu', '刘洋'], ['zhao', '赵磊'], ['oy', '欧阳明']]
  usePresenceStore().users = [
    seat('zhou', '周明', { self: true }),
    ...names.slice(0, n).map(([u, d], i) => seat(u, d, i === 0 ? { mode: 'edit' } : {})),
  ]
}

beforeEach(() => {
  setActivePinia(createPinia())
  tipState.lastHide = 0
})
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('personNick', () => {
  it('❗中文名两个字写全名,三个字以上写后两个字;不是中文名交回首字母', () => {
    expect(personNick('李娜')).toBe('李娜')
    expect(personNick('欧阳明')).toBe('阳明')
    expect(personNick('张')).toBe('张')
    expect(personNick('John Smith')).toBeUndefined()
    expect(personNick(null)).toBeUndefined()
  })
})

describe('在线的人', () => {
  it('❗头像写两个字;「N 人在线」的 N 包括自己;头像里不放自己', async () => {
    people(3)
    const w = mount(FPPresenceBar)
    await nextTick()
    const avs = w.findAll('.pb-av')
    expect(avs.map(a => a.text())).toEqual(['李娜', '王涛', '张伟'])
    expect(w.find('.pb-n').text()).toBe('4 人在线')
    expect(avs[0].classes()).toContain('edit')
  })

  it('❗最多 4 个头像,多出来的写「+N」', async () => {
    people(7)
    const w = mount(FPPresenceBar)
    await nextTick()
    expect(w.findAll('.pb-av').length).toBe(4)
    expect(w.find('.pb-more').text()).toBe('+3')
    expect(w.find('.pb-n').text()).toBe('8 人在线')
  })

  it('只有自己:写「只有你在线」,没有头像', async () => {
    people(0)
    const w = mount(FPPresenceBar)
    await nextTick()
    expect(w.findAll('.pb-av').length).toBe(0)
    expect(w.find('.pb-alone').text()).toBe('只有你在线')
  })

  it('❗停在一个头像上:名字 + 在干什么 + 在哪一屏', async () => {
    vi.useFakeTimers()
    people(2)
    const w = mount(FPPresenceBar, { attachTo: document.body })
    await nextTick()
    w.find('.pb-av').element.parentElement!.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(document.body.querySelector('.fp-tip')!.textContent).toBe('李娜　正在编辑 · 04:12月度台账')
  })

  it('名单:头部「在线 N 人 · 其中 M 人在编辑」,自己置顶带「你」,头像同样两个字', async () => {
    people(3)
    const w = mount(FPPresenceBar, { attachTo: document.body })
    await nextTick()
    await w.find('.pb').trigger('click')
    await nextTick()
    const pp = document.body.querySelector('.pp')!
    expect(pp.querySelector('.pp-h b')!.textContent).toBe('在线 4 人')
    expect(pp.querySelector('.pp-h span')!.textContent).toBe('· 其中 1 人在编辑')
    const first = pp.querySelector('.pp-row')!
    expect(first.querySelector('.pp-you')!.textContent).toBe('你')
    expect(first.textContent).toContain('周明')
    expect([...pp.querySelectorAll('.pp-row')].map(r => r.querySelector('span')!.textContent)).toEqual(['周明', '李娜', '王涛', '张伟'])
  })

  it('尺寸:头像 30、名单头像 34、整组定宽 256;窄于 1280 收成「人形图标 N 人」', async () => {
    people(1)
    const w = mount(FPPresenceBar)
    await nextTick()
    expect(w.find('.pb-av').attributes('style')).toContain('width: 30px')
    expect(w.find('.pb-count').text()).toBe('2 人')
    const css = readFileSync(join(__dirname, '..', 'FPPresenceBar.vue'), 'utf8')
    expect(css).toMatch(/\.pb \{\s*width: 256px/)
    expect(css).toMatch(/@media \(max-width: 1280px\)[\s\S]*\.pb-count \{\s*display: inline-flex/)
  })
})
