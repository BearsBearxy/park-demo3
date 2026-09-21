// src/stores/ui.ts — sidebar open/close state + persistence; 全局网络错误提示。
import { defineStore } from 'pinia'
import { ref, type Component } from 'vue'

/** 手机顶栏的屏级主动作(RESPONSIVE-LAYOUT-SPEC §5.10:一屏只留一个)。
 *  label 始终上屏,也是它的无障碍名;icon 可选(顶栏另外三件都是图标,不带图标的位等于半个位)。 */
export type TopBarAction = { label: string; icon?: Component; onClick: () => void }

export const useUiStore = defineStore('ui', () => {
  // default true; "0" means closed (mirrors app.jsx toggleSb)
  const sbOpen = ref(localStorage.getItem('fp-app-sb') !== '0')

  function toggleSidebar() {
    sbOpen.value = !sbOpen.value
    localStorage.setItem('fp-app-sb', sbOpen.value ? '1' : '0')
  }

  // 浮层侧栏的点外关/Esc 关(spec §3.2):用户触发但不是偏好——「临时看一眼」结束。
  // 不能走 toggleSidebar:它无条件写 fp-app-sb,会把 '0' 落盘污染用户的宽屏偏好。
  function closeTransient() {
    sbOpen.value = false
  }

  // ── T1 侧栏自动折叠(spec 2026-07-12 responsive-shrink)──
  // ≤1280px 进窄档自动收起、回宽档自动展开;窄档内手动 toggle 照常(仅跨断点时覆盖)。
  // 挂在 store 初始化:pinia store 为单例,真实应用中 addEventListener 只执行一次。
  // 自动收/放不写 localStorage(自动是临时让位,手动才是用户偏好)。
  // jsdom/SSR 无 matchMedia 时跳过(guard);测试需自行 mock window.matchMedia。
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(max-width: 1280px)')
    if (mql.matches) sbOpen.value = false // 初始即窄档 → 收起
    mql.addEventListener('change', (e) => { sbOpen.value = !e.matches })
  }

  // 全局网络错误 toast(api/index.ts 拦截器上报;读路径加载失败不再只剩静默转圈)
  const netError = ref<string | null>(null)
  let netErrTimer: number | undefined
  function reportNetError(msg: string) {
    netError.value = msg
    clearTimeout(netErrTimer)
    netErrTimer = window.setTimeout(() => { netError.value = null }, 8000)
  }
  function dismissNetError() { clearTimeout(netErrTimer); netError.value = null }

  // 路由导航中(P2-3):45 屏全是 () => import(),chunk 下载完才 confirm 导航,
  // 这段空窗里页签高亮/面包屑/内容区全停在上一页 —— 本 flag 是那期间唯一的可见反馈来源。
  const navigating = ref(false)
  function startNav() { navigating.value = true }
  function endNav() { navigating.value = false }

  // 首页的搜索框要打开命令面板,而面板长在外壳里(AppShell 的 paletteOpen)。
  // 页面够不着外壳的 ref,就递一个计数过去 —— AppShell watch 它,变了就开面板。
  const paletteReq = ref(0)
  function requestPalette() { paletteReq.value++ }

  // 屏级主动作(§5.10「动作 → 顶栏右:1 个主动作」)。走 store 不走具名插槽:
  // 屏渲染在 AppShell 的默认 slot 里,顶栏是 AppShell 自己模板的节点 —— 屏不是顶栏的父级,
  // 插槽递不过去;让屏 import AppShell 又成环。与 paletteReq 同一条路子。
  // 不判档:顶栏只在 S 档挂载(AppShell.vue:168),别档设了没人渲染。
  // ⚠ 别裸写这个字段,走 composables/useTopBarAction.ts —— 它管换屏/KeepAlive 停用时的清场。
  const topBarAction = ref<TopBarAction | null>(null)

  return { sbOpen, toggleSidebar, closeTransient, netError, reportNetError, dismissNetError, navigating, startNav, endNav, paletteReq, requestPalette, topBarAction }
})
