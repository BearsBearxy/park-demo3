// src/stores/appearance.ts — 外观:浅色 / 深色 / 跟随系统(DARK-MODE-SPEC §3)。
// 全站**只有这里**(和 index.html 的首帧脚本)写 <html data-theme>;tokens.css 的
// :root[data-theme="dark"] 按它换整套颜色令牌。
// 记法同「版本更新看没看过」:按账号存 localStorage["fp-appearance:<账号>"],换电脑要重选一次;
// 另写一份 fp-appearance:last 给首帧脚本 —— 那时还不知道是谁登录。
import { defineStore } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

export type AppearanceMode = 'light' | 'dark' | 'system'
export type Resolved = 'light' | 'dark'

/** 段控三格,账号菜单与手机抽屉共用(顺序即屏上顺序)。 */
export const APPEARANCE_OPTIONS: { value: AppearanceMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

export const LAST_KEY = 'fp-appearance:last'
export const appearanceKey = (who: string) => `fp-appearance:${who}`

const isMode = (v: unknown): v is AppearanceMode => v === 'light' || v === 'dark' || v === 'system'
// 隐私窗口 / 禁用站点数据时 localStorage 访问会抛:读不到 = 没选过(M3 默认浅色),写不进 = 这次会话有效
function read(key: string): AppearanceMode | null {
  try { const v = localStorage.getItem(key); return isMode(v) ? v : null } catch { return null }
}
function write(key: string, v: AppearanceMode) {
  try { localStorage.setItem(key, v) } catch { /* 存不下就只在本次会话生效 */ }
}

/**
 * 当前生效的明暗。模块级而不是 store 里:anaTheme 的纯函数(logic 单测里没有 pinia)也要读它,
 * 视图的图表 option 读了它就会在切外观时重算。初值取首帧脚本已经设好的 data-theme。
 */
export const resolvedTheme = ref<Resolved>(
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

// ── 切换动画:整页渐变(DARK-MODE-SPEC §3.1,2026-09-20 用户改:「放弃扩散,改为整个页面渐变」)──
// View Transitions:浏览器先拍下旧外观,回调里换成新外观,新外观那层整页从透明渐显盖过旧外观。
// 不支持的浏览器、系统开了「减少动态效果」、页面在后台:直接换,不动画。
export const FADE_MS = 450   // 渐变时长(毫秒)。2026-09-20 用户嫌 320 太快
type VTDoc = Document & { startViewTransition?: (cb: () => unknown) => { ready: Promise<void>; finished: Promise<void> } }
function canFade(): boolean {
  if (typeof document === 'undefined' || document.hidden) return false
  if (typeof (document as VTDoc).startViewTransition !== 'function') return false
  return !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}
/** 返回的 promise 在这次过渡拆掉后落定(成功、被跳过都算)。 */
function crossfade(update: () => Promise<void>): Promise<void> {
  const root = document.documentElement
  // data-theme-switching(motion.css):① 新外观那层先透明,动画开始前不会整页先闪一下新外观;
  // ② 关掉全站颜色过渡、暂停循环动画 —— 新外观那层是实时画面,页面上有东西在动就得每帧整页重画,渐变会卡。
  root.dataset.themeSwitching = ''
  const t = (document as VTDoc).startViewTransition!(update)
  // 计时从「就绪后画出的第一帧」开始,不从 ready 那一刻:截新画面那一下可能卡住(2026-09-20 实测内嵌浏览器面板
  // 0.4–1 秒),从 ready 起算的话渐变会整段落在卡顿里,恢复时已经播完 = 看上去直接切换。
  // fill: forwards —— 播完到过渡拆掉之间隔了一帧也停在全显,不会退回透明露出旧外观。
  t.ready
    .then(() => new Promise<void>((ok) => requestAnimationFrame(() => ok())))
    .then(() => root.animate(
      { opacity: [0, 1] },
      { duration: FADE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards', pseudoElement: '::view-transition-new(root)' },
    ))
    .catch(() => { /* 过渡被跳过:外观已经换好,不补动画 */ })
  const clear = () => { delete root.dataset.themeSwitching }
  return t.finished.then(clear, clear)
}

export const useAppearanceStore = defineStore('appearance', () => {
  const auth = useAuthStore()
  const mode = ref<AppearanceMode>(read(LAST_KEY) ?? 'light')

  // 跟随系统:系统切深色(夜间自动切换)时实时跟,不用刷新
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const systemDark = ref(!!mq?.matches)
  mq?.addEventListener?.('change', (e) => { systemDark.value = e.matches })

  const resolveOf = (m: AppearanceMode): Resolved => (m === 'system' ? (systemDark.value ? 'dark' : 'light') : m)
  const resolved = computed<Resolved>(() => resolveOf(mode.value))
  function apply(r: Resolved) {
    resolvedTheme.value = r
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = r
    // 手机状态栏跟画布色:直接读切换后的 --surface-page(index.html 首帧脚本里写的是同一对值)
    const page = getComputedStyle(document.documentElement).getPropertyValue('--surface-page').trim()
    if (page) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page)
  }
  watch(resolved, apply, { immediate: true })

  /** 登录后按这个账号的选择再设一次(外壳挂载时调)。没选过 = 浅色,不沿用上一个人的。 */
  function load() {
    const who = auth.me
    if (!who) return
    mode.value = read(appearanceKey(who)) ?? 'light'
    write(LAST_KEY, mode.value)   // 下次首帧就按这个人的来,不先闪上一个人的
  }

  // 渐变播放中再点:不打断(再开一个过渡会让浏览器跳过正在播的那个 = 直接跳到终态,2026-09-20 用户截图「快速切换卡在这部分」),
  // 只记下最后点的那个,这次播完再渐变到它。段控当场显示最后点的那个(shown)。
  let fading = false
  const queued = ref<AppearanceMode | null>(null)
  /** 段控上显示选中的那格:排队中的优先,点了马上有反应。 */
  const shown = computed<AppearanceMode>(() => queued.value ?? mode.value)

  /** 点一下立刻生效:不刷新、不关菜单。明暗真的会变时整页渐变过去。 */
  function set(m: AppearanceMode) {
    if (fading) { queued.value = m; return }
    const commit = () => {
      mode.value = m
      if (auth.me) write(appearanceKey(auth.me), m)
      write(LAST_KEY, m)
    }
    const next = resolveOf(m)
    if (next === resolved.value || !canFade()) { commit(); return }
    fading = true
    void crossfade(async () => { apply(next); commit(); await nextTick() }).then(() => {
      fading = false
      const q = queued.value
      queued.value = null
      if (q) set(q)
    })
  }

  return { mode, shown, resolved, load, set }
})
