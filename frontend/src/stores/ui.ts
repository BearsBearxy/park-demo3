// src/stores/ui.ts — sidebar open/close state + persistence; 全局网络错误提示。
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // default true; "0" means closed (mirrors app.jsx toggleSb)
  const sbOpen = ref(localStorage.getItem('fp-app-sb') !== '0')

  function toggleSidebar() {
    sbOpen.value = !sbOpen.value
    localStorage.setItem('fp-app-sb', sbOpen.value ? '1' : '0')
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

  return { sbOpen, toggleSidebar, netError, reportNetError, dismissNetError }
})
