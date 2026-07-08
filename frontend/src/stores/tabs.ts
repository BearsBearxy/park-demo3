// src/stores/tabs.ts — browser-style tab model, ported from app.jsx go/pinTab/closeTab.
// Pinned tabs: persistent multi-tab list (fp-app-tabs).
// Preview slot: single slot replaced on each navigation (fp-app-preview).
// Recent: deduplicated last-8 list (fp-app-recent).
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { fpBuildRoutes } from '@/nav/fpNav'

export interface Tab { value: string }

const MAX_RECENT = 8
const BASE_HOME = 'data-home'

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
  const initTabs: Tab[] = (rawTabs.length ? rawTabs : [BASE_HOME]).map(v => ({ value: v }))

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

    return neighbor
  }

  /** 弃置某页缓存状态(epoch++):关闭 tab 后由调用方在路由离开后调,或任意需要强制全新的场合。 */
  function dropState(value: string) {
    epoch.value[value] = epochOf(value) + 1
  }

  return { tabs, preview, recent, epoch, open, pin, close, epochOf, openFresh, dropState }
})
