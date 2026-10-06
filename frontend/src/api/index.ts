import axios, { type AxiosRequestConfig } from 'axios'

// 下方响应拦截器已把 Result 信封解包为业务数据,方法返回类型同步声明为 Promise<T>(而非 AxiosResponse<T>)
declare module 'axios' {
  export interface AxiosInstance {
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    post<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
    put<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
    patch<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  }
}

const http = axios.create({ baseURL: '/api' })

export function readToken(): string | null {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token')
}

/** storage 里当前是谁。口径同 readToken:localStorage(记住登录)优先,sessionStorage 兜底。 */
export function readUser(): string | null {
  return localStorage.getItem('username') ?? sessionStorage.getItem('username')
}

/** 401 的原因,由后端 X-Auth-Reason 给;登录页读它决定提示哪一句。
 *  'expired' 是前端自己判的:令牌到点了(后端对过期令牌不带原因头),或路由守卫因过期拦回。 */
export type AuthReason = 'relogin' | 'password' | 'disabled' | 'self' | 'expired'
export const AUTH_REASON_KEY = 'authReason'

/** 账号还带着管理员给的密码(初始 / 被别人重置的)没改:服务端除改密页用到的几条外一律 403 + 这个 body.code(后端 ResultCode) */
export const PASSWORD_CHANGE_REQUIRED = 428

/** 令牌的 exp 已经过了。解析不了按没过(交给后端判),口径同 stores/auth.ts 的 notExpired。
 *  载荷是 base64url,先换回 atob 认的字母表 —— 不换的话载荷里碰上 - / _ 就解析失败,当成没过期。 */
function tokenExpired(t: string | null): boolean {
  if (!t) return false
  try {
    const { exp } = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof exp === 'number' && exp * 1000 <= Date.now()
  } catch { return false }
}

// ── 跨标签页身份漂移守卫 ─────────────────────────────────────────────
//
// localStorage 是**按域名共享、不分标签页**的。同一台机器上：同事甲登着、走开了，
// 同事乙在新标签页登自己的账号 —— 甲那个标签页的界面还是甲的（Pinia 内存里的权限没变），
// 但请求拦截器每次都现读 storage，于是**甲后续做的每件事都带着乙的令牌发出去，记在乙头上**。
//
// 这正好把审计体系作废：它的全部意义就是「谁做的」。
//
// 所以守在这里 —— 请求拦截器是唯一的咽喉。页面加载/登录时把当前令牌「绑定」到本标签页，
// 之后每个请求比一次；对不上就**拒发**，而不是替另一个人把事做了。
// 只做拒发不做自动刷新：CONCURRENCY-SPEC 的铁律是「永远不刷新用户正在编辑的表格」，
// 由 App.vue 出一条横幅让用户自己点。
//
// ⚠ 绑的是**用户名**,不是令牌串(2026-09-12 改)。改前绑令牌串,于是三种完全不同的事
// 被算成同一件、还都印成「已在别的标签页登录为另一个账号」:
//   ① 别的标签页登了别人  → 真漂移,界面代表的人不对了,必须拦。
//   ② 别的标签页登出了    → 令牌变成 null。没有任何人登录成别人,那句话是假的。
//   ③ 同一个人重新登了一次 → 令牌换了串,人没变。拦它纯属误伤,而单会话上线之后
//      这种情况会很常见(每次重新登录都换一串新令牌)。
// 按人比之后:② 和 ③ 各走各的分支,③ 静默采用新令牌,不打扰正在干活的人。
let boundUser: string | null = readUser()

/** 本标签页登录/登出后重新绑定（同标签页内的正常切换不该被守卫误伤）。 */
export function bindSession(username: string | null): void {
  boundUser = username
}

/** 本页绑的人 vs storage 里的人。'same' 才放行。 */
export function sessionState(): 'same' | 'other-user' | 'signed-out' {
  const now = readUser()
  if (now === boundUser) return 'same'
  return now == null ? 'signed-out' : 'other-user'
}

/** 令牌在别处被换掉了 —— 本标签页的界面已经不代表当前身份。 */
export function sessionDrifted(): boolean {
  return sessionState() !== 'same'
}

export class SessionDriftError extends Error {
  constructor() {
    super('本页的登录状态已在别处改变，请重新载入页面。')
    this.name = 'SessionDriftError'
  }
}

// Attach token if present:localStorage(记住登录)优先,sessionStorage(不记住)兜底,口径同 stores/auth.ts
http.interceptors.request.use((config) => {
  const token = readToken()
  // ⚠ 拒发要在附带令牌之前 —— 不能「先发出去再说」，那一发就已经记在别人头上了。
  // 只有「换了个人」才拒发:同一个人换了张新令牌,照常用新的发出去,事还是记在他自己头上。
  if (sessionState() !== 'same') return Promise.reject(new SessionDriftError())
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// ── 令牌刚换的那一拍(改密 / 给自己重置密码,RBAC-SPEC §13.2) ─────────────────────────
// 服务端先作废旧令牌、回包才带来新令牌。这中间拿旧令牌发出去的请求(在场心跳每 3 秒一拍,同一浏览器
// 别的标签页也在发)撞 401 —— 不是被踢,是令牌刚换。照常清身份会把刚换上的新令牌一起抹掉,把改密的人
// 自己踢回登录页(用户 2026-10-04 报的就是「改完又被退回登录页」)。所以清之前先看两件事:
//   ① storage 里已经是另一张了 → 这个 401 说的是一张不用了的令牌,用新的重发一次;
//   ② 原因是 password、令牌还没换 → 改密的回包可能还在路上,等它落地(至多 PW_SWAP_WAIT_MS)再重发。
//      等不来才是真的被改了密码(别的设备、管理员重置),照常清身份 —— 代价是被踢的那一下晚到 3 秒。
// 每个请求只重发一次,重发再 401 就照常清。
const PW_SWAP_WAIT_MS = 3000
type Retriable = { headers?: Record<string, unknown>; _authRetried?: boolean }

/** 这个请求发出去时带的是哪张令牌 */
function sentToken(cfg: Retriable | undefined): string | null {
  const h = cfg?.headers?.Authorization
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null
}

/** 等 storage 里的令牌换成别的(不是空)。换了回 true */
async function tokenReplaced(old: string, ms: number): Promise<boolean> {
  for (let waited = 0; ; waited += 100) {
    const now = readToken()
    if (now !== old) return !!now
    if (waited >= ms) return false
    await new Promise((r) => setTimeout(r, 100))
  }
}

// Unwrap Result envelope; reject on non-zero code; stub 401 handler
http.interceptors.response.use(
  (response) => {
    const data = response.data
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code === 0) return data.data
      return Promise.reject(data)
    }
    return response.data
  },
  async (error) => {
    if (error.response?.status === 401) {
      const cfg = error.config as Retriable | undefined
      const sent = sentToken(cfg)
      if (cfg && sent && !cfg._authRetried) {
        const now = readToken()
        if ((!!now && now !== sent) || (error.response?.headers?.['x-auth-reason'] === 'password' && await tokenReplaced(sent, PW_SWAP_WAIT_MS))) {
          cfg._authRetried = true
          return http(cfg as AxiosRequestConfig)
        }
      }
      // 后端说明这张令牌为什么不认(X-Auth-Reason);没说、而本地令牌已经到点了,就是登录过期(06-E 登录页组)。
      // 要在下面清令牌**之前**判。
      const reason = error.response?.headers?.['x-auth-reason'] ?? (tokenExpired(readToken()) ? 'expired' : null)
      // permissions/navLayers/mustChangePassword 必须一起清:留在 storage 里,
      // 同一台机器下一个人登录会继承前一个人的权限(或被前一个人的改密标志拦住)
      for (const k of ['token', 'username', 'displayName', 'role', 'permissions', 'navLayers', 'mustChangePassword', 'superAdmin']) {
        localStorage.removeItem(k)
        sessionStorage.removeItem(k)
      }
      // 原因存进 sessionStorage 是因为下一句是整页跳转,内存里的任何东西都活不过去;登录页读完即删,不留痕。
      if (reason && reason !== 'self') sessionStorage.setItem(AUTH_REASON_KEY, String(reason))
      bindSession(null)   // 同步解绑,否则跳登录页后守卫还拿着已作废的旧身份比对
      // 整页跳转让 Pinia auth store 从（已清空的）localStorage 重新初始化为 null；
      // 带 redirect 以便登录后回到原页，且避免在登录页自身重复跳转
      if (!location.pathname.startsWith('/login')) {
        location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search)
      }
      return Promise.reject(error)
    }
    // 带着管理员给的密码还没改(用户 2026-10-04 拍板,改前只有路由守卫拦):本页还不知道 ——
    // 比如别的标签页刚用初始密码登进来,本页沿用了那张令牌。整页跳改密页,不报错、不退出登录;
    // 整页跳而不是 router 跳:外壳上的轮询(在场心跳、版本检查)跟着页面一起停,不在改密页背后接着撞。
    // 标志写进令牌所在那一轨,刷新后 store 读回来,路由守卫把人留在改密页。
    if (error.response?.status === 403 && error.response?.data?.code === PASSWORD_CHANGE_REQUIRED) {
      ;(localStorage.getItem('token') ? localStorage : sessionStorage).setItem('mustChangePassword', '1')
      if (!location.pathname.startsWith('/change-password')) {
        location.href = '/change-password'
        return new Promise(() => {})   // 页面马上换掉:不交给调用方,免得它报一句一闪而过的错
      }
      return Promise.reject(error.response.data)
    }
    // 非 2xx 也解包 Result 信封：校验错误(HTTP 400)/只读角色写拦截(HTTP 403)的后端中文 message
    // 直达视图 alert，不再退化成英文 AxiosError 文案（HTTP 状态口径见后端 GlobalExceptionHandler 头注释）
    const body = error.response?.data
    const enveloped = body && typeof body === 'object' && 'code' in body
    // 5xx / 断网：读路径普遍无 catch，全局 toast 兜底提示（动态 import 避免 pinia 未装载时的循环依赖）
    if (!error.response || error.response.status >= 500) {
      try {
        const { useUiStore } = await import('@/stores/ui')
        useUiStore().reportNetError(enveloped ? (body as { message?: string }).message ?? '服务异常' : '网络异常或服务不可用，请稍后重试')
      } catch { /* pinia 未就绪(极早期请求)时静默 */ }
    }
    return Promise.reject(enveloped ? body : error)
  },
)

export default http
