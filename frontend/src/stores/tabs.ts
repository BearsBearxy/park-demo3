// src/stores/tabs.ts — browser-style tab model, ported from app.jsx go/pinTab/closeTab.
// Pinned tabs: persistent multi-tab list (fp-app-tabs).
// Preview slot: single slot replaced on each navigation (fp-app-preview).
// Recent: deduplicated last-8 list (fp-app-recent).
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { fpBuildRoutes } from '@/nav/fpNav'
import { useAuthStore } from '@/stores/auth'

export interface Tab { value: string }

/** 页签上下文 —— 页签标题与顶栏 chip 要显示的「这一签停在哪」。 */
export interface TabCtx { p?: string; coName?: string }

const MAX_RECENT = 8
// 固定标签第一格。data-home 属「数据中心」层,园区股东看不到那一层 ——
// 恒给他一个通向不可见层的入口,是他登录后第一眼就看见的坏。按导航可见层取首页。
// logout() 会清 fp-app-tabs,换人登录不会继承上一个人的标签。
function baseHome(): string {
  return useAuthStore().navLayers.includes('data') ? 'data-home' : 'cockpit'
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

export const useTabsStore = defineStore('tabs', () => {
  const ROUTES = fpBuildRoutes()

  // ── initial state (mirrors app.jsx init logic) ──
  const rawTabs: string[] = (loadJSON<string[]>('fp-app-tabs', []) || []).filter(v => ROUTES[v])
  const initTabs: Tab[] = (rawTabs.length ? rawTabs : [baseHome()]).map(v => ({ value: v }))

  let rawPreview = localStorage.getItem('fp-app-preview') ?? ''
  // preview only valid if it's a known route AND not already pinned
  const initPreview: Tab | null =
    (ROUTES[rawPreview] && !initTabs.some(t => t.value === rawPreview))
      ? { value: rawPreview }
      : null

  const rawRecent: string[] = (loadJSON<string[]>('fp-app-recent', []) || []).filter(v => ROUTES[v])

  const tabs = ref<Tab[]>(initTabs)
  const preview = ref<Tab | null>(initPreview)
  const recent = ref<string[]>(rawRecent)
  // v4:每 value 的「新鲜度」纪元 — App.vue KeepAlive key = value:epoch。
  // 内存态不持久化:刷新后全新是合理默认(spec 2026-07-07 §二)。
  const epoch = ref<Record<string, number>>({})

  // ── 页签上下文(spec §4.3) ──────────────────────────────
  // 未激活的页签早已卸载,屏内的 year/month/companyId 拿不到 —— 屏在换期时把期寄存到这里,
  // 页签条与顶栏才说得出「月度台账 · 2025-06 · 一期公司」。**只在内存**:三个 localStorage
  // 键的格式是铁律(§8.1),而这份东西刷新后本来就该跟着屏的实例一起重来。
  const ctx = ref<Record<string, TabCtx>>({})
  // 预览槽被顶掉时记下被顶的那个 value。出不出提示由 AppShell 判(只有本人正在编辑那屏才出)。
  const evicted = ref<string | null>(null)

  // ── persistence ──
  watch(tabs, t => localStorage.setItem('fp-app-tabs', JSON.stringify(t.map(x => x.value))), { deep: true })
  watch(preview, p => localStorage.setItem('fp-app-preview', p?.value ?? ''))
  watch(recent, r => localStorage.setItem('fp-app-recent', JSON.stringify(r)), { deep: true })

  // ── actions ──

  /** Open/navigate to a page. Non-pin: enters preview slot (replaces prior preview).
   *  Pin: added directly to pinned tabs (command palette "new tab" mode). */
  function open(value: string, opts: { pin?: boolean } = {}) {
    if (!ROUTES[value]) return

    // dedupe+cap recent
    recent.value = [value, ...recent.value.filter(x => x !== value)].slice(0, MAX_RECENT)

    if (opts.pin) {
      if (!tabs.value.some(t => t.value === value)) tabs.value.push({ value })
      // if this was the preview, clear it
      if (preview.value?.value === value) preview.value = null
    } else if (tabs.value.some(t => t.value === value)) {
      // already pinned: just navigate (clear preview if it matched)
      if (preview.value?.value === value) preview.value = null
    } else {
      // 预览槽是单槽:换一个屏进来,上一个就没了。被顶的是不是正在编辑,由 AppShell 判。
      const out = preview.value?.value
      if (out && out !== value) evicted.value = out
      // enter preview slot (replaces previous preview)
      preview.value = { value }
    }
  }

  /** 当前纪元(缺省 0)。 */
  function epochOf(value: string): number {
    return epoch.value[value] ?? 0
  }

  /** 全新打开:epoch++ 使 KeepAlive 丢弃缓存实例,再走 open。
   *  侧边栏点击 / 收入核对跳转语义;TabStrip 点击仍走 open(恢复缓存)。 */
  function openFresh(value: string, opts: { pin?: boolean } = {}) {
    if (!ROUTES[value]) return
    epoch.value[value] = epochOf(value) + 1
    open(value, opts)
  }

  /** Promote preview → pinned tab (double-click or pin button). */
  function pin(value: string) {
    if (!ROUTES[value]) return
    if (!tabs.value.some(t => t.value === value)) tabs.value.push({ value })
    if (preview.value?.value === value) preview.value = null
  }

  /** Close a pinned tab. Only removes when >1 total view (pinned + preview) remains.
   *  Returns the value to navigate to if the closed tab was active (caller decides). */
  function close(value: string): string | null {
    const order = [
      ...tabs.value.map(t => t.value),
      ...(preview.value && !tabs.value.some(t => t.value === preview.value!.value)
        ? [preview.value.value] : []),
    ]
    if (order.length <= 1) return null // refuse: last view

    // ponytail: guard the invariant — never remove the last pinned base tab
    const isPinned = tabs.value.some(t => t.value === value)
    if (isPinned && tabs.value.length <= 1) return null

    const i = order.indexOf(value)
    const neighbor = i >= 0 ? (order[i + 1] ?? order[i - 1] ?? null) : null

    if (preview.value?.value === value) preview.value = null
    tabs.value = tabs.value.filter(t => t.value !== value)
    // 弃状态不在此处做:关闭激活 tab 时 epoch++ 若先于导航生效,当前路由 key 立变 →
    // 被关视图以新 key 瞬时重挂载(onMounted 重跑+快照污染缓存,复审实测)。由调用方导航完成后 dropState。
    clearCtx(value)

    return neighbor
  }

  /** 弃置某页缓存状态(epoch++):关闭 tab 后由调用方在路由离开后调,或任意需要强制全新的场合。 */
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

  function clearEvicted() { evicted.value = null }

  /**
   * 深链跳转的 pin 缺省(spec §4.3):**来源屏正坐在预览槽 → 目标钉住**,否则目标照常占预览槽。
   * 来源在预览槽时若让目标也占预览槽,一跳就把来源顶没了,用户回不去 ——
   * 这正是 `LedgerView.gotoTenants` 当年硬写 `pin: true` 的理由,这里把它一般化。
   *
   * ponytail: 来源 = `recent[0]` —— `open()` 每次都把目标推到队首,所以进本函数时队首还是上一屏,
   * 不必再往 store 里塞一份「当前屏」或把 router 引进来(会成环)。
   * 天花板:刷新后的第一次跳转,`recent[0]` 来自 localStorage、未必等于当前屏 ——
   * 代价上限是多钉或少钉一个页签,不丢任何数据。
   */
  function openDeep(value: string) {
    const from = recent.value[0]
    openFresh(value, { pin: !!from && from !== value && preview.value?.value === from })
  }

  // 换人(登入 / 登出)清掉本次会话的内存态。auth.logout() 只清三个 localStorage 键、
  // 不重置已实例化的 store(tabs / preview / recent / epoch 至今都留着) —— 整体重置留给 P5,
  // 这里先保证新用户看不到上一个人的期与公司名。
  watch(() => useAuthStore().me, () => { ctx.value = {}; evicted.value = null })

  return {
    tabs, preview, recent, epoch, open, pin, close, epochOf, openFresh, dropState,
    ctx, evicted, setCtx, clearCtx, clearEvicted, openDeep,
  }
})
