import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export const useAuthStore = defineStore('auth', () => {
  // 「记住登录状态」双轨:勾选走 localStorage(跨会话),不勾走 sessionStorage(关标签页即失效)。
  // 初始化两边都看;api/index.ts 请求拦截器取 token 同此口径。
  const token = ref<string | null>(localStorage.getItem('token') ?? sessionStorage.getItem('token'))
  const displayName = ref<string | null>(localStorage.getItem('displayName') ?? sessionStorage.getItem('displayName'))
  const role = ref<string | null>(localStorage.getItem('role') ?? sessionStorage.getItem('role'))

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

  async function login({ username, password }: { username: string; password: string }, remember = true) {
    const { token: t, displayName: dn, role: r } = await api.post<{ token: string; displayName: string; role?: string }>('/auth/login', { username, password })
    token.value = t
    displayName.value = dn
    role.value = r ?? null   // 旧后端(无 role 字段)登录不落 "undefined" 字符串
    // 目标之外的另一份必须清:否则上次「记住」的旧 token 会盖过本次「不记住」的选择
    const target = remember ? localStorage : sessionStorage
    const other = remember ? sessionStorage : localStorage
    for (const k of ['token', 'displayName', 'role']) other.removeItem(k)
    target.setItem('token', t)
    target.setItem('displayName', dn)
    if (r) target.setItem('role', r)
    else target.removeItem('role')
  }

  function logout() {
    token.value = null
    displayName.value = null
    role.value = null
    for (const k of ['token', 'displayName', 'role']) {
      localStorage.removeItem(k)
      sessionStorage.removeItem(k)
    }
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
