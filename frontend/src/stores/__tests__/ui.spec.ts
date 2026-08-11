// src/stores/__tests__/ui.spec.ts
// T1 侧栏自动折叠(spec 2026-07-12 responsive-shrink):跨 1280 断点自动收/放,窄档内手动 toggle 照常。
// jsdom 无 matchMedia,此处手写 mock(可控 matches + 手动触发 change)。
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '../ui'

// 可控的 matchMedia mock:记录 change 监听器,fire() 模拟跨断点
let listeners: Array<(e: { matches: boolean }) => void> = []
function mockMatchMedia(initialMatches: boolean) {
  listeners = []
  ;(window as any).matchMedia = (media: string) => ({
    media,
    matches: initialMatches,
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: () => {},
  })
}
function fire(matches: boolean) {
  listeners.forEach((cb) => cb({ matches }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('ui store — 侧栏自动折叠(≤1280px)', () => {
  it('宽档初始:sbOpen 默认 true', () => {
    mockMatchMedia(false)
    expect(useUiStore().sbOpen).toBe(true)
  })

  it('初始即窄档 → sbOpen false', () => {
    mockMatchMedia(true)
    expect(useUiStore().sbOpen).toBe(false)
  })

  it('进窄档 → 自动收起;出窄档 → 自动展开', () => {
    mockMatchMedia(false)
    const ui = useUiStore()
    fire(true)
    expect(ui.sbOpen).toBe(false)
    fire(false)
    expect(ui.sbOpen).toBe(true)
  })

  it('窄档内手动 toggle 照常生效(保持到下次跨断点)', () => {
    mockMatchMedia(true)
    const ui = useUiStore()
    expect(ui.sbOpen).toBe(false)
    ui.toggleSidebar() // 窄档内手动展开
    expect(ui.sbOpen).toBe(true)
    fire(false) // 跨回宽档 → 自动展开(仍 true)
    expect(ui.sbOpen).toBe(true)
  })

  it('自动收/放不写 localStorage(手动才是用户偏好)', () => {
    mockMatchMedia(false)
    useUiStore()
    fire(true)
    expect(localStorage.getItem('fp-app-sb')).toBeNull()
  })

  it('无 matchMedia 环境(guard)不抛错,sbOpen 走 localStorage 默认', () => {
    delete (window as any).matchMedia
    expect(useUiStore().sbOpen).toBe(true)
  })
})

describe('ui store — 导航进度(P2-3)', () => {
  it('默认 false;startNav 置位、endNav 复位', () => {
    mockMatchMedia(false)
    const ui = useUiStore()
    expect(ui.navigating).toBe(false)
    ui.startNav()
    expect(ui.navigating).toBe(true)
    ui.endNav()
    expect(ui.navigating).toBe(false)
  })
})
