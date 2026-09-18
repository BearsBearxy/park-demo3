// src/stores/tabs.ts — 页签模型(TAB-BAR-SPEC §1 §2)。用法和 Chrome 一样:
//   普通点击 = 在当前页签打开;Ctrl / 中键 = 新页签;页面里的链接 = 新页签紧挨当前页签右边。
// 一个页签 = 一屏(路由 value)。同一屏只开一份 —— 筛选、展开都在那一份 KeepAlive 实例里。
// 第 1 格恒为「首页」(固定、关不掉、拖不动);「新标签页」同时最多一个。
//
// **导航落定后才动页签条**(router.afterEach → commit):调用方在 push 之前只登记「这一跳想开在哪」
// (open / openDeep / newTab / reopenClosed),导航被取消、chunk 加载失败、被守卫踢走时页签条一格不动 ——
// 先改页签再导航的话,这三种情况都会留下一格从没打开过的「幽灵页签」,或把来源页签换没(2026-09-18 对抗复查)。
//
// 取代 2026-09-03 的「固定页签 + 单个斜体预览槽」模型(SIDEBAR-UX-REDESIGN §4.3 / §6)。
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { fpBuildRoutes } from '@/nav/fpNav'
import { useAuthStore } from '@/stores/auth'
import { useViewport } from '@/composables/useViewport'

export interface Tab { value: string; pinned?: boolean }

/** 页签上下文 —— 页签标题与顶栏 chip 要显示的「这一签停在哪」。 */
export interface TabCtx { p?: string; coName?: string }

export const HOME = 'home'
export const NEWTAB = 'newtab'

const ROUTES = fpBuildRoutes()
/** 不在导航里、但能当页签的两屏。 */
const EXTRA: Record<string, { page: string; icon: string }> = {
  [HOME]: { page: '首页', icon: 'home' },
  [NEWTAB]: { page: '新标签页', icon: 'plus' },
}
/** 页签能认的 value:导航里的屏 + 首页 + 新标签页。 */
export const isTabValue = (v: string): boolean => !!ROUTES[v] || v in EXTRA
/** 页签上画什么:屏名、图标、层名(首页 / 新标签页没有层)。 */
export function tabMeta(v: string): { page: string; icon: string; layerLabel?: string } | undefined {
  const r = ROUTES[v]
  return r ? { page: r.page, icon: r.icon, layerLabel: r.layerLabel } : EXTRA[v]
}

const MAX_RECENT = 8
const MAX_CLOSED = 10

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

/** 首页补在最前且固定;去重、去掉认不得的;固定的排前面(各区内部保序)。 */
function normalize(list: Tab[]): Tab[] {
  const seen = new Set<string>([HOME])
  const rest: Tab[] = []
  for (const t of list) {
    if (!isTabValue(t.value) || seen.has(t.value)) continue
    seen.add(t.value)
    rest.push({ value: t.value, ...(t.pinned ? { pinned: true } : {}) })
  }
  return [{ value: HOME, pinned: true }, ...rest.filter(t => t.pinned), ...rest.filter(t => !t.pinned)]
}

/** 按人分开存:`fp-app-tabs:<username>`。没登录不存。 */
function storeKey(base: string): string | null {
  const me = useAuthStore().me
  return me ? `${base}:${me}` : null
}
/** 读这个人的;没有就读一次改版前不分人的旧键(那时换人会清,所以旧键就是这个人的),读完删掉旧键。 */
function loadOwn<T>(base: string, fallback: T): T {
  const k = storeKey(base)
  const own = k ? loadJSON<T | null>(k, null) : null
  const legacy = loadJSON<T | null>(base, null)
  localStorage.removeItem(base)
  return own ?? legacy ?? fallback
}

export const useTabsStore = defineStore('tabs', () => {
  // ── 初始状态 ──
  const rawTabs = loadOwn<string[]>('fp-app-tabs', [])
  const rawPinned = new Set(loadOwn<string[]>('fp-app-pinned', []))
  // 旧模型的单个预览槽:没有对应物了,读一次就扔(TAB-BAR-SPEC §1)
  localStorage.removeItem('fp-app-preview')
  const tabs = ref<Tab[]>(normalize((Array.isArray(rawTabs) ? rawTabs : []).map(v => ({ value: v, pinned: rawPinned.has(v) }))))
  const recent = ref<string[]>((loadOwn<string[]>('fp-app-recent', []) || []).filter(v => ROUTES[v]))
  /** 路由当前所在的那一格(router.afterEach 写)。open() 调用时它还是导航**之前**那一屏。 */
  const active = ref('')
  /** 最近关掉的,供「重新打开关闭的页签」。只在内存。 */
  const closed = ref<string[]>([])
  // 每 value 的「新鲜度」纪元 — App.vue KeepAlive key = value:epoch。内存态,刷新后全新。
  const epoch = ref<Record<string, number>>({})
  // 页签上下文:未激活的页签早已卸载,屏在换期时把期寄存到这里,页签条与顶栏才说得出
  // 「月度台账 · 2025-06 · 一期公司」。只在内存。
  const ctx = ref<Record<string, TabCtx>>({})

  // ── 持久化 ──
  function save(base: string, v: string[]) {
    const k = storeKey(base)
    if (k) localStorage.setItem(k, JSON.stringify(v))
  }
  watch(tabs, t => {
    save('fp-app-tabs', t.map(x => x.value))
    save('fp-app-pinned', t.filter(x => x.pinned).map(x => x.value))
  }, { deep: true })
  watch(recent, r => save('fp-app-recent', r), { deep: true })

  const idx = (v: string) => tabs.value.findIndex(t => t.value === v)
  const has = (v: string) => idx(v) >= 0
  const pinnedCount = () => tabs.value.filter(t => t.pinned).length

  function touchRecent(v: string) {
    if (!ROUTES[v]) return   // 首页、新标签页不进「最近打开」
    recent.value = [v, ...recent.value.filter(x => x !== v)].slice(0, MAX_RECENT)
  }

  /** 这一屏我是不是正在编辑(auth 的编辑态登记表里有登记在这一屏的)。 */
  function editingHere(v: string): boolean {
    return useAuthStore().editingOn(v)
  }

  // ── 这一跳想开在哪(导航落定前登记,commit 时兑现)──
  type Mode = 'current' | 'right' | 'end' | 'newtab'
  let intent: { v: string; mode: Mode; after?: string } | null = null
  /** 页面内容区里刚有一次点击(AppShell 在 .fp-content 上 capture 登记,本轮宏任务内有效)。 */
  let inPage = false
  function markInPage() {
    inPage = true
    setTimeout(() => { inPage = false })
  }

  /** 紧挨当前页签右边插一格(不进固定区)。 */
  function insertRight(v: string) {
    const i = idx(active.value)
    const at = i < 0 ? tabs.value.length : Math.max(i + 1, pinnedCount())
    tabs.value.splice(at, 0, { value: v })
  }

  /**
   * 登记「下一跳去 value,开在哪」(TAB-BAR-SPEC §2)。调用方随后 router.push;导航落定时 commit 兑现。
   * - `pin: true`(页面里的链接):新页签紧挨当前页签右边 —— 来源屏不被换掉。
   * - 否则在**当前页签**打开。显式调用会盖过「页面里的点击」的默认(首页格子、出账工序步骤条靠这个)。
   */
  function open(value: string, opts: { pin?: boolean } = {}) {
    if (!isTabValue(value)) return
    intent = { v: value, mode: opts.pin ? 'right' : 'current' }
  }

  /**
   * router.beforeEach:没人登记过这一跳时补上默认 ——
   * 页面内容区里点出来的(链接、「去看看」、空态的「去录入」)= 页面里的链接,开在右边;
   * 浏览器后退 / 前进到一个已经关掉的屏,也开在右边(不把正看着的那一格换掉)。
   */
  function beforeNav(value: string, pop = false) {
    if (intent?.v === value) return
    if (inPage || pop) intent = { v: value, mode: 'right' }
  }
  /** 导航没落地(取消、失败、被踢走):丢掉登记,页签条不动。 */
  function clearIntent() { intent = null }

  /**
   * router.afterEach(导航已落定):兑现登记。已经开着 → 什么都不做(路由切过去就是切页签)。
   * 在当前页签打开时两个例外开在最右边的新页签:
   *   当前是首页(首页永远是首页)/ 当前这屏我正在编辑(不换掉正在编辑的页面)。
   * 被换下去的屏当场卸载,和关掉一样(不然它占着缓存,还不是页签)。
   */
  function commit(value: string) {
    const it = intent?.v === value ? intent : null
    intent = null
    if (!isTabValue(value)) return
    touchRecent(value)
    // 手机上没有页签条、也关不了页签:只留首页 + 固定的 + 正在编辑的 + 这一页,别的换掉即卸载。
    // 去的是已经开着的那格(首页、固定的)也要清 —— 不然上一屏在看不见的地方一直挂着。
    if (useViewport().tier.value === 's') {
      const keep = (t: Tab) => t.pinned || t.value === value || editingHere(t.value)
      for (const t of tabs.value) if (!keep(t)) dropState(t.value)
      tabs.value = tabs.value.filter(keep)
      if (!has(value)) tabs.value.push({ value })
      return
    }
    if (has(value)) return
    const mode = it?.mode ?? 'current'
    if (mode === 'right') { insertRight(value); return }
    if (mode === 'end') { tabs.value.push({ value }); return }
    if (mode === 'newtab') {
      const i = it?.after ? idx(it.after) : -1
      if (i < 0) tabs.value.push({ value })
      else tabs.value.splice(Math.max(i + 1, pinnedCount()), 0, { value })
      return
    }
    const cur = active.value
    const i = idx(cur)
    if (i < 0 || cur === HOME || editingHere(cur)) { tabs.value.push({ value }); return }
    tabs.value.splice(i, 1, { value, ...(tabs.value[i].pinned ? { pinned: true } : {}) })
    dropState(cur)
  }

  /** 当前纪元(缺省 0)。 */
  function epochOf(value: string): number {
    return epoch.value[value] ?? 0
  }

  /**
   * 全新打开:epoch++ 换一个新实例(App.vue 的 KeepAlive 随即卸掉旧的),再走 open。
   * 这一屏我正在编辑时**不换**,只切过去 —— 深链 / 换层 / Shift + 点都不该把没保存的改动冲掉。
   */
  function openFresh(value: string, opts: { pin?: boolean } = {}) {
    if (!isTabValue(value)) return
    if (!editingHere(value)) epoch.value[value] = epochOf(value) + 1
    open(value, opts)
  }

  /** 页面里的链接:全新实例,新页签紧挨来源右边(来源不被换掉)。 */
  function openDeep(value: string) {
    openFresh(value, { pin: true })
  }

  /** Ctrl + 点 / 中键点左边导航:放最右边,不跳过去(调用方不 push)。 */
  function openBackground(value: string) {
    if (!ROUTES[value] || has(value)) return
    tabs.value.push({ value })
  }

  /** + / 右键「在右侧新建页签」。已有新标签页就只切过去(同时最多一个)。调用方随后 push('/newtab')。 */
  function newTab(after?: string) {
    intent = { v: NEWTAB, mode: 'newtab', after }
  }

  function remember(v: string) {
    closed.value = [v, ...closed.value.filter(x => x !== v)].slice(0, MAX_CLOSED)
  }

  /**
   * 关掉一格。首页关不掉(返回 null)。返回「关的若是当前页签该跳去哪」:右边那格,没有就左边那格。
   * 弃状态不在这里做:关当前页签时 epoch++ 若先于导航生效,被关视图会以新 key 瞬时重挂载
   * (复审实测)—— 由调用方导航完成后 dropState。
   */
  function close(value: string): string | null {
    const i = idx(value)
    if (value === HOME || i < 0) return null
    const order = tabs.value.map(t => t.value)
    tabs.value.splice(i, 1)
    remember(value)
    clearCtx(value)
    return order[i + 1] ?? order[i - 1] ?? HOME
  }

  /** 关掉除它和固定页签以外的所有页签。返回被关的 value(调用方逐个 dropState)。 */
  function closeOthers(value: string): string[] {
    const gone = tabs.value.filter(t => !t.pinned && t.value !== value).map(t => t.value)
    for (const v of gone) close(v)
    return gone
  }

  /** 关掉它右边的普通页签。 */
  function closeRight(value: string): string[] {
    const i = idx(value)
    if (i < 0) return []
    const gone = tabs.value.slice(i + 1).filter(t => !t.pinned).map(t => t.value)
    for (const v of gone) close(v)
    return gone
  }

  /** 重新打开最近关掉的那个(给了 v 就开那一个),放最右边。返回它(调用方 push);没有可重开的返回 null。 */
  function reopenClosed(v?: string): string | null {
    const got = v && closed.value.includes(v) ? v : closed.value.find(isTabValue)
    if (!got) return null
    closed.value = closed.value.filter(x => x !== got)
    intent = { v: got, mode: 'end' }
    return got
  }

  /** Chrome 的固定:挪到固定区最后,只剩图标。 */
  function pin(value: string) {
    const i = idx(value)
    if (i < 0 || tabs.value[i].pinned) return
    tabs.value.splice(i, 1)
    tabs.value.splice(pinnedCount(), 0, { value, pinned: true })
  }

  /** 取消固定:挪到普通区最前。首页不行。 */
  function unpin(value: string) {
    const i = idx(value)
    if (value === HOME || i < 0 || !tabs.value[i].pinned) return
    tabs.value.splice(i, 1)
    tabs.value.splice(pinnedCount(), 0, { value })
  }

  /** 拖动换位:只在同一区里换;首页不动,别的也换不到它前面。 */
  function move(from: number, to: number) {
    const t = tabs.value[from]
    if (!t || from === to || t.value === HOME) return
    const pc = pinnedCount()
    const lo = t.pinned ? 1 : pc
    const hi = t.pinned ? pc - 1 : tabs.value.length - 1
    const dest = Math.min(Math.max(to, lo), hi)
    if (dest === from) return
    tabs.value.splice(from, 1)
    tabs.value.splice(dest, 0, t)
  }

  /** router.afterEach:路由落定后记下当前页签。 */
  function setActive(value: string) {
    active.value = value
  }

  /** 弃置某页缓存状态(epoch++):关闭 tab 后由调用方在路由离开后调,或「重新加载」。 */
  function dropState(value: string) {
    epoch.value[value] = epochOf(value) + 1
    clearCtx(value)
  }

  function setCtx(value: string, c: TabCtx) {
    if (!ROUTES[value]) return
    // 整条替换而不是浅合并:期变了公司也可能变,合并会把上一家公司的名字留在标题里。
    const next: TabCtx = {}
    if (c.p) next.p = c.p
    if (c.coName) next.coName = c.coName
    ctx.value = { ...ctx.value, [value]: next }
  }

  function clearCtx(value?: string) {
    if (value == null) { ctx.value = {}; return }
    if (!(value in ctx.value)) return
    const next = { ...ctx.value }
    delete next[value]
    ctx.value = next
  }

  // 每次登录 / 登出整体重置,登录后只有首页(TAB-BAR-SPEC §1)。换人时尤其要清:共享机器上上一个人的
  // 页签、最近访问原样都在,而其中一半可能是他这个角色看不见的层的屏。同一个人过期重登 me 不变,
  // 所以还要看 loginSeq。auth 只清 localStorage,store 实例还活着。
  watch([() => useAuthStore().me, () => useAuthStore().loginSeq], () => {
    tabs.value = normalize([])
    recent.value = []
    closed.value = []
    // epoch 不清:它只是 KeepAlive key 的命名空间,单调增就行。清零的话登出那一拍前台那屏
    // key 从 A:n 变回 A:0 → 在跳去登录页之前被重挂一遍、拿着已清掉的令牌发请求(2026-09-19 对抗复查)。
    ctx.value = {}
    active.value = ''
    intent = null
  })

  return {
    tabs, recent, closed, active, epoch, ctx,
    open, openFresh, openDeep, openBackground, newTab, beforeNav, clearIntent, commit, markInPage,
    isEditing: editingHere,
    close, closeOthers, closeRight, reopenClosed, pin, unpin, move,
    setActive, epochOf, dropState, setCtx, clearCtx, has,
  }
})
