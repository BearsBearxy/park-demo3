// 被踢回登录页时说清楚为什么(画布 06-E「登录页，不进铃铛」组:账号被停用、登录过期)。
// 这里不 mock '@/api' / auth store:原因从 api 拦截器或路由守卫写进 sessionStorage,登录页读出来,
// 三段是一条链,只 mock 中间任何一段都测不到「真的说出来了」。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { routerKey, routeLocationKey } from 'vue-router'
import http, { AUTH_REASON_KEY } from '@/api'
import router from '@/router'
import LoginView from '@/views/LoginView.vue'

// 登录页两层 canvas 在 jsdom 里拿不到 2d 上下文(组件自己已判 null 跳过)
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']

/** 造一张 exp 在指定秒数的令牌(只有载荷有意义,签名前端不验) */
const jwt = (expSec: number) => `h.${btoa(JSON.stringify({ sub: 'zhang', exp: expSec }))}.s`
const EXPIRED = jwt(Math.floor(Date.now() / 1000) - 60)
const LIVE = jwt(Math.floor(Date.now() / 1000) + 3600)

const adapter0 = http.defaults.adapter

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => { http.defaults.adapter = adapter0 })

const mountLogin = () => mount(LoginView, {
  global: { provide: { [routerKey as symbol]: { push: vi.fn() }, [routeLocationKey as symbol]: { query: {} } } },
})

describe('登录页的一句', () => {
  // 破坏验证:删掉 `r === 'expired' ? '登录已过期，请重新登录'` 那一档 → 红
  it('❗原因 = expired ⇒ 「登录已过期，请重新登录」', async () => {
    sessionStorage.setItem(AUTH_REASON_KEY, 'expired')
    const w = mountLogin()
    await flushPromises()
    expect(w.find('.lg-err .lg-kicked').text()).toBe('登录已过期，请重新登录')
    expect(sessionStorage.getItem(AUTH_REASON_KEY), '读完即删').toBeNull()
  })

  /** 登录口回一个失败信封(HTTP 200 + code≠0,同后端 BizException 的口径) */
  function loginReplies(body: { code: number; message: string; data: unknown }) {
    http.defaults.adapter = async (config) => ({ data: { ...body, traceId: null }, status: 200, statusText: 'OK', headers: {}, config })
  }
  async function submit(w: ReturnType<typeof mountLogin>) {
    await w.find('input[autocomplete="username"]').setValue('zhang')
    await w.find('input[type="password"]').setValue('pw12345678')
    await w.find('form').trigger('submit')
    await flushPromises()
  }

  // 后端 AuthService:密码对、账号已停用 → BizException(FORBIDDEN,「账号已停用，请联系管理员」)。
  // 破坏验证:catch 里不再读信封的 message(只认 e?.msg)→ 红
  it('❗密码对、账号已停用 ⇒ 登录页照显后端那句「账号已停用，请联系管理员」', async () => {
    loginReplies({ code: 403, message: '账号已停用，请联系管理员', data: null })
    const w = mountLogin()
    await submit(w)
    expect(w.find('.lg-err').text()).toBe('账号已停用，请联系管理员')
  })
})

describe('api 层 401 记原因', () => {
  beforeEach(() => { history.replaceState(null, '', '/login') })   // 已在登录页:拦截器不做整页跳转

  function reply401(headers: Record<string, string>) {
    http.defaults.adapter = (config) => Promise.reject({ config, response: { status: 401, statusText: '', headers, data: {}, config } })
  }

  // 破坏验证:拦截器清单里去掉 'superAdmin' → 红(同机下一个人登录前,界面还按系统管理员画)
  it('❗401 清身份时 superAdmin 一起清', async () => {
    localStorage.setItem('token', LIVE)
    localStorage.setItem('superAdmin', '1')
    reply401({ 'x-auth-reason': 'relogin' })
    await http.get('/tenants').catch(() => {})
    expect(localStorage.getItem('superAdmin')).toBeNull()
  })

  // 破坏验证:拦截器里去掉 `?? (tokenExpired(...) ? 'expired' : null)` → 红
  it('❗401 没带原因头、本地令牌已过期 ⇒ 记 expired', async () => {
    localStorage.setItem('token', EXPIRED)
    reply401({})
    await http.get('/tenants').catch(() => {})
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBe('expired')
    expect(localStorage.getItem('token'), '令牌照旧清掉').toBeNull()
  })

  // 破坏验证:把过期判据去掉(没头一律记 expired)→ 红
  it('❗401 没带原因头、令牌没过期 ⇒ 不乱说「过期」', async () => {
    localStorage.setItem('token', LIVE)
    reply401({})
    await http.get('/tenants').catch(() => {})
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBeNull()
  })

  // 真 JWT 的载荷是 base64url(- _ 代替 + /、不补 =)。前端得换回 atob 认的字母表,不换就解析失败、按「没过期」算。
  // 破坏验证:tokenExpired 去掉 .replace(/-/g,'+').replace(/_/g,'/') → 红
  it('❗令牌载荷是 base64url(带 - / _)、已过期 ⇒ 照样记 expired', async () => {
    const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    // sub 里的 >>> / ??? 让标准 base64 出现 + 和 /,换成 base64url 后就是 - 和 _
    const payload = b64url({ sub: '>>>???', exp: Math.floor(Date.now() / 1000) - 60 })
    expect(payload, '前置:载荷里真有 - 或 _').toMatch(/[-_]/)
    localStorage.setItem('token', `h.${payload}.s`)
    reply401({})
    await http.get('/tenants').catch(() => {})
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBe('expired')
  })

  // 破坏验证:让过期判断压过原因头(`tokenExpired(...) ? 'expired' : header`)→ 红
  it('❗带了原因头 disabled ⇒ 记 disabled(令牌恰好也过期了,以后端的为准)', async () => {
    localStorage.setItem('token', EXPIRED)
    reply401({ 'x-auth-reason': 'disabled' })
    await http.get('/tenants').catch(() => {})
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBe('disabled')
  })
})

describe('路由守卫因过期拦回', () => {
  // 守卫放行后 router 会空闲预热各屏 chunk(setTimeout 兜底);测试里不让它跑
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout'] }) })
  afterEach(() => { vi.useRealTimers() })

  // 破坏验证:守卫里删掉写 expired 那一行 → 红
  it('❗本地令牌已过期 ⇒ 拦回登录页并记 expired', async () => {
    localStorage.setItem('token', EXPIRED)
    await router.push('/tenants')
    expect(router.currentRoute.value.path).toBe('/login')
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBe('expired')
  })

  // 破坏验证:去掉 `if (auth.token)`(没令牌也记)→ 红。从没登录过的人不该看到「登录已过期」
  it('❗压根没有令牌 ⇒ 拦回登录页,不说「过期」', async () => {
    await router.push('/buildings')
    expect(router.currentRoute.value.path).toBe('/login')
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBeNull()
  })
})
