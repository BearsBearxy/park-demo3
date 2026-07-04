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
