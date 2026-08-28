// src/composables/__tests__/useViewport.spec.ts
// 视口档位单例(RESPONSIVE-LAYOUT-SPEC §1):四档判定 + hover:none 触屏 + 无 matchMedia guard。
// jsdom 无 matchMedia,按 ui.spec.ts 的可控 mock 模式手写;useViewport 挂多条查询,
// 故 mock 按查询串算 matches(宽度对 max-width、touch 对 hover: none)。
import { describe, it, expect, beforeEach } from 'vitest'
import { useViewport, _resetViewportForTest } from '../useViewport'

let listeners: Array<{ media: string; cb: (e: { matches: boolean }) => void }> = []
let widthPx = 1440
let touch = false

function matchesFor(media: string): boolean {
  const mw = media.match(/max-width:\s*(\d+)px/)
  if (mw) return widthPx <= Number(mw[1])
  if (media.includes('hover: none')) return touch
  return false
}

function mockMatchMedia(width: number, isTouch = false) {
  widthPx = width
  touch = isTouch
  listeners = []
  ;(window as any).matchMedia = (media: string) => ({
    media,
    get matches() { return matchesFor(media) },
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) =>
      listeners.push({ media, cb }),
    removeEventListener: () => {},
  })
}

// 模拟拖窗跨断点:改宽度后给每条查询发 change(真实浏览器只给跨界的查询发,
// 多发无害——compute 读的是 mql.matches 现值,幂等)
function setWidth(width: number) {
  widthPx = width
  listeners.forEach(({ media, cb }) => cb({ matches: matchesFor(media) }))
}
function setTouch(v: boolean) {
  touch = v
  listeners.forEach(({ media, cb }) => cb({ matches: matchesFor(media) }))
}

beforeEach(() => {
  _resetViewportForTest()
})

describe('useViewport — 档位判定', () => {
  it('初始 1440 → xl', () => {
    mockMatchMedia(1440)
    expect(useViewport().tier.value).toBe('xl')
  })

  it('初始 800 → m(601–960 档)', () => {
    mockMatchMedia(800)
    expect(useViewport().tier.value).toBe('m')
  })

  it('初始 390 → s(≤600 档)', () => {
    mockMatchMedia(390)
    expect(useViewport().tier.value).toBe('s')
  })

  it('边界值归属:600→s、960→m、1280→l(max-width 含等号)', () => {
    mockMatchMedia(600)
    expect(useViewport().tier.value).toBe('s')
    _resetViewportForTest()
    mockMatchMedia(960)
    expect(useViewport().tier.value).toBe('m')
    _resetViewportForTest()
    mockMatchMedia(1280)
    expect(useViewport().tier.value).toBe('l')
  })

  it('跨档 change 事件更新 tier(全程同一份 Ref)', () => {
    mockMatchMedia(1440)
    const { tier } = useViewport()
    setWidth(1000)
    expect(tier.value).toBe('l')
    setWidth(800)
    expect(tier.value).toBe('m')
    setWidth(390)
    expect(tier.value).toBe('s')
    setWidth(1440)
    expect(tier.value).toBe('xl')
  })

  it('单例:两次调用返回同一组 Ref', () => {
    mockMatchMedia(1440)
    expect(useViewport().tier).toBe(useViewport().tier)
  })
})

describe('useViewport — isTouch(hover: none)', () => {
  it('初始触屏 → true;change 跟随(如 iPad 外接鼠标)', () => {
    mockMatchMedia(768, true)
    const { isTouch } = useViewport()
    expect(isTouch.value).toBe(true)
    setTouch(false)
    expect(isTouch.value).toBe(false)
  })

  it('初始非触屏 → false', () => {
    mockMatchMedia(1440, false)
    expect(useViewport().isTouch.value).toBe(false)
  })
})

describe('useViewport — 无 matchMedia 环境(guard)', () => {
  it('不抛错,默认 tier=xl、isTouch=false', () => {
    delete (window as any).matchMedia
    const { tier, isTouch } = useViewport()
    expect(tier.value).toBe('xl')
    expect(isTouch.value).toBe(false)
  })
})
