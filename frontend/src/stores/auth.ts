import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const displayName = ref<string | null>(localStorage.getItem('displayName'))
  const role = ref<string | null>(localStorage.getItem('role'))

  // JWT exp 过期感知:过期 token 视为未登录,路由守卫直接拦回登录页,
  // 不再"放行→骨架屏→首个 API 401 才弹回"。解析失败按有效处理(交给后端 401 兜底)。
  function notExpired(t: string): boolean {
    try {
      const { exp } = JSON.parse(atob(t.split('.')[1]))
      return typeof exp !== 'number' || exp * 1000 > Date.now()
    } catch { return true }
  }
  const isAuthed = computed(() => !!token.value && notExpired(token.value))
  // 只读角色(审计建议#8):viewer 仅 GET,后端 SecurityConfig 强制;此标志供 UI 按需降噪(非安全边界)
  const isReadonly = computed(() => role.value === 'viewer')

  async function login({ username, password }: { username: string; password: string }) {
    const { token: t, displayName: dn, role: r } = await api.post<{ token: string; displayName: string; role?: string }>('/auth/login', { username, password })
    token.value = t
    displayName.value = dn
    role.value = r ?? null   // 旧后端(无 role 字段)登录不落 "undefined" 字符串
    localStorage.setItem('token', t)
    localStorage.setItem('displayName', dn)
    if (r) localStorage.setItem('role', r)
    else localStorage.removeItem('role')
  }

  function logout() {
    token.value = null
    displayName.value = null
    role.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('displayName')
    localStorage.removeItem('role')
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

  return { token, displayName, role, isAuthed, isReadonly, login, logout, setToken }
})
