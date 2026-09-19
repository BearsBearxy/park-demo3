// 外观 store(DARK-MODE-SPEC §3):浅色 / 深色 / 跟随系统,按账号记,另存一份给首帧。
// 断言钉的是上屏的那件事 —— <html data-theme> 是什么 —— 和两把 localStorage 键。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useAppearanceStore, resolvedTheme, LAST_KEY, appearanceKey, FADE_MS } from '../appearance'
import { useAuthStore } from '../auth'

vi.mock('@/api', () => ({
  default: { post: vi.fn(() => Promise.resolve(undefined)), delete: vi.fn(() => Promise.resolve(undefined)) },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

const theme = () => document.documentElement.dataset.theme

/** 桩一个系统深浅:matches 可改,change 事件可手动派发 */
function stubSystem(dark: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = []
  const mq = { matches: dark, addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn) }
  window.matchMedia = vi.fn((q: string) => (q.includes('prefers-color-scheme') ? mq : { matches: false, addEventListener() {} }) as unknown as MediaQueryList)
  return { flip(v: boolean) { mq.matches = v; listeners.forEach((fn) => fn({ matches: v })) } }
}

const origMM = window.matchMedia
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  delete document.documentElement.dataset.theme
  resolvedTheme.value = 'light'
  window.matchMedia = origMM
})
afterEach(() => { window.matchMedia = origMM; vi.restoreAllMocks() })

describe('appearance store', () => {
  it('什么都没存 = 浅色(M3),并写上 data-theme="light"', () => {
    const a = useAppearanceStore()
    expect(a.mode).toBe('light')
    expect(theme()).toBe('light')
  })

  it('选深色:立刻写 data-theme、模块级 resolvedTheme 跟着变;按账号存 + 存一份 last', async () => {
    useAuthStore().me = 'zhou'
    const a = useAppearanceStore()
    a.set('dark')
    await nextTick()
    expect(theme()).toBe('dark')
    expect(resolvedTheme.value).toBe('dark')
    expect(localStorage.getItem(appearanceKey('zhou'))).toBe('dark')
    expect(localStorage.getItem(LAST_KEY)).toBe('dark')
  })

  it('手机状态栏颜色(theme-color)跟画布色 --surface-page 走,切回浅色也跟回来', async () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = 'white'
    const css = document.createElement('style')
    css.textContent = ':root { --surface-page: white } :root[data-theme="dark"] { --surface-page: black }'
    document.head.append(meta, css)
    try {
      const a = useAppearanceStore()
      a.set('dark')
      await nextTick()
      expect(meta.content).toBe('black')
      a.set('light')
      await nextTick()
      expect(meta.content).toBe('white')
    } finally { meta.remove(); css.remove() }
  })

  it('登录后按这个账号的选择设;这个账号没选过 = 浅色,不沿用上一个人的(last 也跟着改)', async () => {
    localStorage.setItem(LAST_KEY, 'dark')              // 上一个人选的深色
    localStorage.setItem(appearanceKey('li'), 'dark')
    const auth = useAuthStore()
    const a = useAppearanceStore()
    expect(a.mode).toBe('dark')                          // 登录前按 last(首帧同口径)
    auth.me = 'wang'
    a.load()
    await nextTick()
    expect(a.mode).toBe('light')
    expect(theme()).toBe('light')
    expect(localStorage.getItem(LAST_KEY)).toBe('light')
    auth.me = 'li'
    a.load()
    await nextTick()
    expect(theme()).toBe('dark')
  })

  it('跟随系统:按 prefers-color-scheme 取,系统切换时实时跟', async () => {
    const sys = stubSystem(true)
    const a = useAppearanceStore()
    a.set('system')
    await nextTick()
    expect(a.resolved).toBe('dark')
    expect(theme()).toBe('dark')
    sys.flip(false)
    await nextTick()
    expect(theme()).toBe('light')
    expect(localStorage.getItem(LAST_KEY)).toBe('system')   // 存的是「跟随系统」,不是当时解出来的明暗
  })

  it('localStorage 读写抛错(隐私窗口)时不崩:读不到 = 浅色,点了照样生效', async () => {
    useAuthStore().me = 'zhou'   // auth 自己初始化也读 localStorage,先建好再让存储抛
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const a = useAppearanceStore()
    expect(a.mode).toBe('light')
    a.load()
    a.set('dark')
    await nextTick()
    expect(theme()).toBe('dark')
  })
})

describe('切换动画:整页渐变(DARK-MODE-SPEC §3.1)', () => {
  type VT = { ready: Promise<void>; finished: Promise<void> }
  let vt: ReturnType<typeof vi.fn>
  let anim: ReturnType<typeof vi.fn>
  let switchingAtStart = false
  beforeEach(() => {
    // 跑回调(换外观)再交出 ready,和浏览器顺序一样:先拍旧图 → 回调 → 新图就绪
    vt = vi.fn((cb: () => unknown) => {
      switchingAtStart = 'themeSwitching' in document.documentElement.dataset
      const done = Promise.resolve(cb()).then(() => undefined)
      return { ready: done, finished: done.then(() => new Promise<void>((r) => setTimeout(r, 5))) } as VT
    })
    anim = vi.fn()
    ;(document as unknown as { startViewTransition?: unknown }).startViewTransition = vt
    document.documentElement.animate = anim as unknown as typeof document.documentElement.animate
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })
  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  })

  it('❗点深色:过渡回调里换成深色,新外观那层整页 opacity 0 → 1(FADE_MS,停在全显)', async () => {
    const a = useAppearanceStore()
    a.set('dark')
    expect(vt).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(anim).toHaveBeenCalledTimes(1))
    expect(theme()).toBe('dark')
    expect(a.mode).toBe('dark')
    const [frames, opts] = anim.mock.calls[0]
    expect(frames).toEqual({ opacity: [0, 1] })
    expect(opts).toMatchObject({ duration: FADE_MS, pseudoElement: '::view-transition-new(root)', fill: 'forwards' })
  })

  it('❗切回浅色也渐变', async () => {
    const a = useAppearanceStore()
    a.set('dark')
    await vi.waitFor(() => expect(theme()).toBe('dark'))
    await vi.waitFor(() => expect('themeSwitching' in document.documentElement.dataset).toBe(false))
    a.set('light')
    expect(vt).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(anim).toHaveBeenCalledTimes(2))
    expect(theme()).toBe('light')
  })

  it('❗过渡期间打上 data-theme-switching(新外观那层先透明、关过渡、停循环动画),过渡结束拿掉', async () => {
    const a = useAppearanceStore()
    a.set('dark')
    expect(switchingAtStart).toBe(true)
    await vi.waitFor(() => expect('themeSwitching' in document.documentElement.dataset).toBe(false))
  })

  it('❗计时从就绪后的第一帧开始:ready 之后、下一帧之前不起动画(截画面卡住时渐变不会整段落在卡顿里)', async () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length })
    const a = useAppearanceStore()
    a.set('dark')
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0))
    expect(anim).not.toHaveBeenCalled()
    frames.splice(0).forEach((cb) => cb(0))
    await vi.waitFor(() => expect(anim).toHaveBeenCalledTimes(1))
    raf.mockRestore()
  })

  it('❗系统开了「减少动态效果」:直接换,不动画', async () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('reduced-motion'), addEventListener() {} }) as unknown as MediaQueryList)
    const a = useAppearanceStore()
    a.set('dark')
    await nextTick()
    expect(vt).not.toHaveBeenCalled()
    expect(theme()).toBe('dark')
  })

  it('❗明暗没变(浅色时选「跟随系统」而系统也是浅色):不动画', async () => {
    stubSystem(false)
    const a = useAppearanceStore()
    a.set('system')
    await nextTick()
    expect(vt).not.toHaveBeenCalled()
    expect(a.mode).toBe('system')
  })

  it('❗渐变播放中再点:不开第二个过渡(浏览器会跳过正在播的那个 = 直接跳到终态);只记最后点的,播完再渐变到它', async () => {
    let finish!: () => void
    vt.mockImplementationOnce((cb: () => unknown) => {
      const done = Promise.resolve(cb()).then(() => undefined)
      return { ready: done, finished: new Promise<void>((r) => { finish = r }) } as VT
    })
    const a = useAppearanceStore()
    a.set('dark')
    await vi.waitFor(() => expect(theme()).toBe('dark'))
    a.set('light')
    a.set('system')
    a.set('light')
    expect(vt).toHaveBeenCalledTimes(1)
    expect(a.shown).toBe('light')      // 段控当场显示最后点的
    expect(a.mode).toBe('dark')        // 外观还没动,等这次播完
    finish()
    await vi.waitFor(() => expect(vt).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(theme()).toBe('light'))
    expect(a.mode).toBe('light')
    expect(a.shown).toBe('light')
  })

  it('❗motion.css:切换期间新外观那层先透明、关掉过渡、暂停循环动画;默认的整页动画关掉', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'styles', 'motion.css'), 'utf8')
    const block = css.match(/:root\[data-theme-switching\] \*,[^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(block).toMatch(/transition:\s*none\s*!important/)
    expect(block).toMatch(/animation-play-state:\s*paused\s*!important/)
    expect(css).toMatch(/:root\[data-theme-switching\]::view-transition-new\(root\)\s*\{\s*opacity:\s*0;?\s*\}/)
    expect(css).toMatch(/::view-transition-new\(root\)\s*\{\s*animation:\s*none;/)
  })

  it('浏览器不支持 View Transitions:照样立刻换', async () => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
    const a = useAppearanceStore()
    a.set('dark')
    await nextTick()
    expect(theme()).toBe('dark')
  })
})

describe('index.html 首帧脚本', () => {
  // 取 <head> 里那段内联脚本原样执行:键名 / 取值要和 store 对得上,否则首帧按一个没人写的键去读,永远浅色
  const html = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8')
  const code = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
  const run = () => new Function(code)()

  it('在任何样式表 / 模块脚本之前', () => {
    const at = html.indexOf('<script>')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(html.indexOf('<style>'))
    expect(at).toBeLessThan(html.indexOf('type="module"'))
  })

  it('按 last 设 data-theme:深色 → dark;跟随系统 + 系统深色 → dark;没存 → light', () => {
    localStorage.setItem(LAST_KEY, 'dark'); run()
    expect(theme()).toBe('dark')
    stubSystem(true)
    localStorage.setItem(LAST_KEY, 'system'); run()
    expect(theme()).toBe('dark')
    localStorage.removeItem(LAST_KEY); run()
    expect(theme()).toBe('light')
  })
})
