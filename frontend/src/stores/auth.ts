import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export const useAuthStore = defineStore('auth', () => {
  // 「记住登录状态」双轨:勾选走 localStorage(跨会话),不勾走 sessionStorage(关标签页即失效)。
  // 初始化两边都看;api/index.ts 请求拦截器取 token 同此口径。
  const token = ref<string | null>(localStorage.getItem('token') ?? sessionStorage.getItem('token'))
  const displayName = ref<string | null>(localStorage.getItem('displayName') ?? sessionStorage.getItem('displayName'))
  // 「这是我自己」判断用(用户管理屏要把自己那行的停用按钮预先置灰)。后端有自锁守卫兜底,
  // 但让人点一个注定 409 的按钮是坏体验。不解 JWT 的 sub 去猜 —— 猜错会误禁别人的行。
  const me = ref<string | null>(localStorage.getItem('username') ?? sessionStorage.getItem('username'))
  const role = ref<string | null>(localStorage.getItem('role') ?? sessionStorage.getItem('role'))

  // 存储里是 JSON 字符串;读坏(手改/旧格式)按缺省处理,不让整个 store 初始化炸掉
  function readArr(key: string): string[] | null {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key)
    if (!raw) return null
    try {
      const v = JSON.parse(raw)
      return Array.isArray(v) ? (v as string[]) : null
    } catch { return null }
  }
  // 导航层缺省全开:老 token(后端未返 navLayers)不能让人看不到导航
  const DEFAULT_NAV_LAYERS = ['data', 'reports', 'analysis']
  const permissions = ref<string[]>(readArr('permissions') ?? [])
  const navLayers = ref<string[]>(readArr('navLayers') ?? [...DEFAULT_NAV_LAYERS])
  // 首次登录强制改密(RBAC-SPEC 拍板 #3):管理员设初始密码,本人进系统前必须改掉。
  // 存 '1'/缺省,双轨口径同 token;老后端不返这个字段 → 缺省 false,不误拦既有账号
  const mustChangePassword = ref((localStorage.getItem('mustChangePassword') ?? sessionStorage.getItem('mustChangePassword')) === '1')

  // JWT exp 过期感知:过期 token 视为未登录,路由守卫直接拦回登录页,
  // 不再"放行→骨架屏→首个 API 401 才弹回"。解析失败按有效处理(交给后端 401 兜底)。
  function notExpired(t: string): boolean {
    try {
      const { exp } = JSON.parse(atob(t.split('.')[1]))
      return typeof exp !== 'number' || exp * 1000 > Date.now()
    } catch { return true }
  }
  const isAuthed = computed(() => !!token.value && notExpired(token.value))
  // 侧栏每次渲染要查几十次,Set 只在 permissions 变时重建;can 本身是普通函数(读 computed 仍被模板追踪)
  const permSet = computed(() => new Set(permissions.value))
  function can(key: string): boolean {
    return permSet.value.has(key)
  }
  // 只读账号(审计建议#8):一个 edit 权限都没有即为只读;此标志供 UI 按需降噪(非安全边界,后端才是)
  const isReadonly = computed(() => !permissions.value.some((p) => p.endsWith(':edit')))

  async function login({ username, password }: { username: string; password: string }, remember = true) {
    const { token: t, username: un, displayName: dn, role: r, permissions: ps, navLayers: nl, mustChangePassword: mcp } = await api.post<{ token: string; username?: string; displayName: string; role?: string; permissions?: string[]; navLayers?: string[]; mustChangePassword?: boolean }>('/auth/login', { username, password })
    token.value = t
    displayName.value = dn
    me.value = un ?? username
    role.value = r ?? null   // 旧后端(无 role 字段)登录不落 "undefined" 字符串
    permissions.value = ps ?? []
    navLayers.value = nl ?? [...DEFAULT_NAV_LAYERS]
    mustChangePassword.value = !!mcp
    // 目标之外的另一份必须清:否则上次「记住」的旧 token 会盖过本次「不记住」的选择
    const target = remember ? localStorage : sessionStorage
    const other = remember ? sessionStorage : localStorage
    for (const k of ['token', 'username', 'displayName', 'role', 'permissions', 'navLayers', 'mustChangePassword']) other.removeItem(k)
    target.setItem('token', t)
    if (me.value) target.setItem('username', me.value)
    target.setItem('displayName', dn)
    target.setItem('permissions', JSON.stringify(permissions.value))
    target.setItem('navLayers', JSON.stringify(navLayers.value))
    if (r) target.setItem('role', r)
    else target.removeItem('role')
    // 不置真时必须显式清:同机上一个账号留下的 '1' 会把这个账号也拦进改密页
    if (mustChangePassword.value) target.setItem('mustChangePassword', '1')
    else target.removeItem('mustChangePassword')
  }

  /** 改密成功后清标志(两轨都清:不知道当初勾没勾「记住登录」) */
  function clearMustChangePassword() {
    mustChangePassword.value = false
    localStorage.removeItem('mustChangePassword')
    sessionStorage.removeItem('mustChangePassword')
  }

  function logout() {
    token.value = null
    displayName.value = null
    me.value = null
    role.value = null
    permissions.value = []
    navLayers.value = [...DEFAULT_NAV_LAYERS]
    mustChangePassword.value = false
    for (const k of ['token', 'username', 'displayName', 'role', 'permissions', 'navLayers', 'mustChangePassword']) {
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

  return { token, me, displayName, role, permissions, navLayers, mustChangePassword, isAuthed, isReadonly, can, login, logout, clearMustChangePassword, setToken }
})
