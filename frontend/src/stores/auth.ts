import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api, { bindSession, sessionDrifted } from '@/api'

/** 一次授权:哪个权限点、谁授权的、什么时候到期(毫秒时间戳)。与后端 ElevationDtos.GrantDTO 对齐。 */
export interface Grant {
  perm: string
  permLabel: string
  authorizer: string
  authorizerName: string
  expiresAt: number
}

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
  // ── 跨标签页身份漂移 ──
  // localStorage 按域名共享、不分标签页：别的标签页登了另一个账号，本页界面还是旧身份，
  // 但请求会带着新令牌发出去 —— 事就记在别人头上了。api 层已在请求拦截器拒发，
  // 这里只负责让用户看见发生了什么（AppShell 的横幅）。
  // 不自动刷新：CONCURRENCY-SPEC 铁律「永远不刷新用户正在编辑的表格」，由用户点。
  const drifted = ref(false)
  if (typeof window !== 'undefined') {
    // storage 事件只在**其它**标签页改动时触发，本页自己的 setItem 不会触发
    window.addEventListener('storage', (e) => {
      if (e.key === 'token') drifted.value = sessionDrifted()
    })
  }

  // ── 主管当场授权提权(ELEVATION-SPEC) ──
  // 授权是**服务端**的状态(内存,30 分钟)。这里不落 localStorage —— 落了就等于给了一个
  // 前端改改就能续期的权限,而权限的真身在后端。刷新页面靠 GET 重新取回。
  const grants = ref<Grant[]>([])
  // 到点自动失效不能只靠后端:横幅倒计时归零时,界面上的写入口必须同时消失,
  // 否则用户点下去才发现 403。ticker 只在有授权时跑,平时零开销。
  const nowMs = ref(Date.now())
  let tick: ReturnType<typeof setInterval> | null = null
  function retick() {
    const need = grants.value.length > 0
    if (need && !tick) tick = setInterval(() => { nowMs.value = Date.now() }, 1000)
    if (!need && tick) { clearInterval(tick); tick = null }
  }
  const liveGrants = computed(() => grants.value.filter((g) => g.expiresAt > nowMs.value))
  const elevatedSet = computed(() => new Set(liveGrants.value.map((g) => g.perm)))
  /** 最早到期的那个 —— 横幅显示剩余多少秒。没有授权时为 0。 */
  const elevationLeftMs = computed(() =>
    liveGrants.value.length ? Math.max(0, Math.min(...liveGrants.value.map((g) => g.expiresAt)) - nowMs.value) : 0)

  const isAuthed = computed(() => !!token.value && notExpired(token.value))
  // 侧栏每次渲染要查几十次,Set 只在 permissions 变时重建;can 本身是普通函数(读 computed 仍被模板追踪)
  const permSet = computed(() => new Set(permissions.value))
  /**
   * 有没有这项权限 —— **角色给的或主管当场授权的**,一视同仁。
   *
   * 把提权并进 can() 而不是让 59 个调用点各自判,是因为写入口的判定天然就是这个语义:
   * 「现在能不能改」。也因此导航那几处(system:view)完全不受影响 ——
   * system:* 在后端属于不可提权名单,永远不会出现在 elevatedSet 里。
   */
  function can(key: string): boolean {
    return permSet.value.has(key) || elevatedSet.value.has(key)
  }
  /** 角色本身给的(不含提权)。判断「这一项需不需要请人授权」用这个。 */
  function hasOwn(key: string): boolean {
    return permSet.value.has(key)
  }
  /** 这项权限是谁授权的?没有授权(或本来就有)返回 null —— 横幅与提示文案用。 */
  function authorizerOf(key: string): string | null {
    return liveGrants.value.find((g) => g.perm === key)?.authorizerName ?? null
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
    bindSession(t)      // 本标签页主动登录 → 重新绑定，别被漂移守卫误伤
    drifted.value = false
    grants.value = []   // 上一个账号的授权残留不能带进新会话
    retick()
    if (mustChangePassword.value) target.setItem('mustChangePassword', '1')
    else target.removeItem('mustChangePassword')
  }

  // ── 提权动作 ──

  /** 请主管当场授权。失败抛错(后端信封里的中文原因),由弹窗展示。 */
  async function requestElevation(perms: string[], authorizer: string, password: string) {
    grants.value = await api.post<Grant[]>('/auth/elevate', { perms, authorizer, password })
    nowMs.value = Date.now()
    retick()
  }

  // 当前处于编辑态的页面。v3 之后编辑态跨页签存活,**同时两个页面在编辑态是常态**
  // (KeepAlive 标签页)。退出其中一个就清授权的话,另一个页面的写入口会在用户改到一半时
  // 无声地锁回去。所以「结束授权」只在最后一个编辑态关掉时才真的发生。
  //
  // 放在 store 而不是 composable 的模块作用域:附表页头与系数簿/收款簿两个窗口是直接调
  // endElevation() 的(它们各有自己的退出语义,没套 composable),守卫放在调用方就漏了它们。
  const editors = ref(new Set<symbol>())
  function openEditor(id: symbol) { editors.value.add(id) }
  function closeEditor(id: symbol) { editors.value.delete(id) }

  /**
   * 结束授权。退出编辑模式 / 主动点「结束授权」/ 登出都走这里。
   * force=true 跳过「还有别的编辑页开着」的判断 —— 用户在横幅上主动点的那一下就是 force。
   */
  async function endElevation(force = false) {
    if (!grants.value.length) return
    if (!force && editors.value.size > 0) return
    grants.value = []
    retick()
    try { await api.delete('/auth/elevate') } catch { /* 服务端 30 分钟后自然过期,兜得住 */ }
  }

  /** 刷新页面后恢复(授权在服务端还活着,横幅要跟着回来)。 */
  async function refreshElevation() {
    if (!isAuthed.value) return
    try {
      grants.value = await api.get<Grant[]>('/auth/elevate')
      nowMs.value = Date.now()
      retick()
    } catch { grants.value = []; retick() }
  }

  /** 改密成功后清标志(两轨都清:不知道当初勾没勾「记住登录」) */
  function clearMustChangePassword() {
    mustChangePassword.value = false
    localStorage.removeItem('mustChangePassword')
    sessionStorage.removeItem('mustChangePassword')
  }

  function logout() {
    // ⚠ 顺序:先发结束授权的请求,再清令牌。反过来的话请求没有令牌可带,直接 401 ——
    // 授权就留在服务端了,同一台电脑下一个人登进来白捡 30 分钟。
    // 不 await:登出不能被一个网络请求卡住;服务端 30 分钟 TTL 兜底。
    if (grants.value.length) api.delete('/auth/elevate').catch(() => { /* TTL 兜底 */ })
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
    bindSession(null)
    drifted.value = false
    grants.value = []
    retick()
  }

  // ponytail: kept for backwards-compat with P0-B code that calls setToken
  function setToken(t: string | null) {
    token.value = t
    if (t) localStorage.setItem('token', t)
    else localStorage.removeItem('token')
  }

  return { token, me, drifted, displayName, role, permissions, navLayers, mustChangePassword, isAuthed, isReadonly,
           can, hasOwn, authorizerOf, grants: liveGrants, elevationLeftMs, requestElevation, endElevation, refreshElevation,
           openEditor, closeEditor,
           login, logout, clearMustChangePassword, setToken }
})
