import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const displayName = ref<string | null>(localStorage.getItem('displayName'))

  // JWT exp 过期感知:过期 token 视为未登录,路由守卫直接拦回登录页,
  // 不再"放行→骨架屏→首个 API 401 才弹回"。解析失败按有效处理(交给后端 401 兜底)。
  function notExpired(t: string): boolean {
    try {
      const { exp } = JSON.parse(atob(t.split('.')[1]))
      return typeof exp !== 'number' || exp * 1000 > Date.now()
    } catch { return true }
  }
  const isAuthed = computed(() => !!token.value && notExpired(token.value))

  async function login({ username, password }: { username: string; password: string }) {
    const { token: t, displayName: dn } = await api.post<{ token: string; displayName: string }>('/auth/login', { username, password })
    token.value = t
    displayName.value = dn
    localStorage.setItem('token', t)
    localStorage.setItem('displayName', dn)
  }

  function logout() {
    token.value = null
    displayName.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('displayName')
    // 一并清标签页/预览/最近访问持久化,避免共享机器上残留上一用户的页面清单
    localStorage.removeItem('fp-app-tabs')
    localStorage.removeItem('fp-app-preview')
    localStorage.removeItem('fp-app-recent')
  }

  // ponytail: kept for backwards-compat with P0-B code that calls setToken
  function setToken(t: string | null) {
    token.value = t
    if (t) localStorage.setItem('token', t)
    else localStorage.removeItem('token')
  }

  return { token, displayName, isAuthed, login, logout, setToken }
})
