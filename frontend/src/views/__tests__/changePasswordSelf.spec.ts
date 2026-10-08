// 改密三件(用户 2026-10-04「首次登录强制改密，现在自己改不了自己的密码，并且在系统用户管理里面重置密码后，
// 到登录的时候又要强制改一遍」)。前端这一半:改密页自己来改有「返回」、强制态只有「退出登录」;改完换上服务端给的新令牌
// (写回原来那一轨);服务端 428(还带着管理员给的密码)→ 整页跳改密页,不报错、不退出。
// 不 mock '@/api':令牌从回包到 store 到 storage、428 从拦截器到 storage 是一条链,mock 中间一段就测不到。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { routerKey } from 'vue-router'
import type { InternalAxiosRequestConfig } from 'axios'
import http, { AUTH_REASON_KEY, PASSWORD_CHANGE_REQUIRED } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { receipts } from '@/utils/receipt'
import ChangePasswordView from '@/views/ChangePasswordView.vue'

const adapter0 = http.defaults.adapter
const router = { back: vi.fn(), replace: vi.fn(() => Promise.resolve()) }

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  receipts.splice(0)
  router.back.mockClear()
  router.replace.mockClear()
  history.replaceState(null, '', '/change-password')
})
afterEach(() => { http.defaults.adapter = adapter0 })

const mountPage = () => mount(ChangePasswordView, { global: { provide: { [routerKey as symbol]: router } } })
const btn = (w: ReturnType<typeof mountPage>, text: string) => w.findAll('button').find((b) => b.text() === text)

/** 改密口回一个成功信封(带新令牌) */
function changeReplies(token: string) {
  http.defaults.adapter = async (config) => ({ data: { code: 0, message: 'ok', data: { token }, traceId: null }, status: 200, statusText: 'OK', headers: {}, config })
}
async function fillAndSubmit(w: ReturnType<typeof mountPage>) {
  const [cur, nx, cf] = w.findAll('input[type="password"]')
  await cur.setValue('old-pass-1')
  await nx.setValue('new-pass-12')
  await cf.setValue('new-pass-12')
  await w.find('form').trigger('submit')
  await flushPromises()
}

describe('改密页 · 自己来改', () => {
  // 破坏验证:模板去掉 v-else 那颗「返回」(只留退出登录)→ 红
  it('❗有「返回」、没有「退出登录」,说明写的是本机保持登录', () => {
    localStorage.setItem('token', 'old')
    const w = mountPage()
    expect(btn(w, '返回')).toBeTruthy()
    expect(btn(w, '退出登录')).toBeUndefined()
    expect(w.find('.cp-sub').text()).toBe('修改后这台设备保持登录。')
  })

  // 破坏验证:goBack 不看 history.state.back、一律 back() → 第二段红;一律 replace → 第一段红
  it('❗「返回」回上一页;直接打开这个地址的(没有上一页)落首页', async () => {
    localStorage.setItem('token', 'old')
    history.replaceState({ back: '/ledger' }, '', '/change-password')
    await btn(mountPage(), '返回')!.trigger('click')
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()

    history.replaceState(null, '', '/change-password')
    await btn(mountPage(), '返回')!.trigger('click')
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/home')
  })

  // 破坏验证:submit 里去掉 `if (r?.token) auth.setToken(r.token)` → 令牌断言红;
  //          setToken 写死 localStorage → 「不记住登录」那一轨断言红
  it('❗改完换上新令牌,写回原来那一轨(没勾记住登录的不被改成记住),回原页并报一句', async () => {
    sessionStorage.setItem('token', 'old')
    history.replaceState({ back: '/ledger' }, '', '/change-password')
    changeReplies('fresh')
    const w = mountPage()
    await fillAndSubmit(w)
    expect(useAuthStore().token).toBe('fresh')
    expect(sessionStorage.getItem('token')).toBe('fresh')
    expect(localStorage.getItem('token'), '没勾记住登录:不往 localStorage 写').toBeNull()
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(receipts.map((r) => r.text)).toEqual(['密码已修改'])
  })
})

describe('改密页 · 强制态', () => {
  // 破坏验证:「退出登录」去掉 v-if="forced"(两种都显示)→ 「返回」那条红;forced 改回 computed → 提交后按钮翻成「返回」红
  it('❗只有「退出登录」没有「返回」;改完换新令牌、清标志、落首页,按钮不在提交中翻成「返回」', async () => {
    localStorage.setItem('token', 'old')
    localStorage.setItem('mustChangePassword', '1')
    history.replaceState({ back: '/ledger' }, '', '/change-password')
    changeReplies('fresh')
    const w = mountPage()
    expect(btn(w, '退出登录')).toBeTruthy()
    expect(btn(w, '返回')).toBeUndefined()
    await fillAndSubmit(w)
    expect(localStorage.getItem('token')).toBe('fresh')
    expect(useAuthStore().mustChangePassword).toBe(false)
    expect(router.replace).toHaveBeenCalledWith('/home')
    expect(router.back, '强制改密不回「上一页」').not.toHaveBeenCalled()
    expect(btn(w, '返回')).toBeUndefined()
  })
})

// 服务端先作废旧令牌、回包才带来新令牌:这一拍里拿旧令牌发出去的请求(在场心跳每 3 秒一拍)撞 401 'password'。
// 照常清身份会把刚换上的新令牌一起抹掉,改密的人自己被踢回登录页。
describe('api 层 401:令牌刚换的那一拍', () => {
  beforeEach(() => { history.replaceState(null, '', '/login') })   // 真走到清身份时不整页跳(jsdom 跳不了)
  afterEach(() => { vi.useRealTimers() })

  const deny = (config: InternalAxiosRequestConfig, reason: string) => Promise.reject({
    config, response: { status: 401, statusText: '', headers: { 'x-auth-reason': reason }, data: {}, config },
  })
  const fine = (config: InternalAxiosRequestConfig) => Promise.resolve({
    data: { code: 0, message: 'ok', data: 'fine', traceId: null }, status: 200, statusText: 'OK', headers: {}, config,
  })
  /** 第一发:先跑 onFirst(模拟新令牌落地的时机),再回 401;之后照常成功。记下每一发带的令牌 */
  function firstDenied(onFirst: () => void, reason = 'password') {
    const sent: string[] = []
    http.defaults.adapter = (config) => {
      sent.push(String(config.headers.Authorization))
      if (sent.length > 1) return fine(config)
      onFirst()
      return deny(config, reason)
    }
    return sent
  }

  // 「回来时 storage 里已是另一张」不只改密:同一个人在别的标签页重新登录(原因 relogin)也是这样 ——
  // 这个 401 说的是一张不用了的令牌。用 relogin 钉,password 那一档的等待盖不住它。
  // 破坏验证:拦截器去掉「storage 里已是另一张 → 重发」那一档 → 红
  it('❗旧令牌在途、回来时本机已换上新令牌:用新的重发一次,身份不清', async () => {
    localStorage.setItem('token', 'old')
    localStorage.setItem('permissions', '["ledger:view"]')
    const sent = firstDenied(() => localStorage.setItem('token', 'new'), 'relogin')
    await expect(http.get('/presence/ping')).resolves.toBe('fine')
    expect(sent).toEqual(['Bearer old', 'Bearer new'])
    expect(localStorage.getItem('token')).toBe('new')
    expect(localStorage.getItem('permissions')).toBe('["ledger:view"]')
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBeNull()
  })

  // 破坏验证:拦截器去掉 password 那一档的等待(tokenReplaced)→ 红
  it('❗401 password 先到、新令牌后到:等它落地再重发', async () => {
    localStorage.setItem('token', 'old')
    const sent = firstDenied(() => { setTimeout(() => localStorage.setItem('token', 'new'), 300) })
    await expect(http.get('/presence/ping')).resolves.toBe('fine')
    expect(sent).toEqual(['Bearer old', 'Bearer new'])
    expect(localStorage.getItem('token')).toBe('new')
  })

  // 等不来就是真被改了密码(别的设备 / 管理员重置):照常清身份、记原因 —— 上面两条不是把 401 拆了
  it('❗等不来新令牌:照常清身份,登录页说密码已修改', async () => {
    vi.useFakeTimers()
    localStorage.setItem('token', 'old')
    const sent = firstDenied(() => {})
    const p = http.get('/presence/ping').then(() => 'ok', () => 'rejected')
    await vi.advanceTimersByTimeAsync(3200)
    expect(await p).toBe('rejected')
    expect(sent).toEqual(['Bearer old'])
    expect(localStorage.getItem('token')).toBeNull()
    expect(sessionStorage.getItem(AUTH_REASON_KEY)).toBe('password')
  })
})

describe('api 层 428:还带着管理员给的密码', () => {
  function reply428() {
    http.defaults.adapter = (config) => Promise.reject({
      config, response: { status: 403, statusText: '', headers: {}, config,
        data: { code: PASSWORD_CHANGE_REQUIRED, message: '请先修改初始密码，改完才能使用系统', data: null } },
    })
  }

  // 破坏验证:拦截器去掉 428 分支 → 标志没写、promise 被 reject(调用方会报错)→ 红;
  //          去掉 `return new Promise(() => {})` → settled 红
  it('❗不在改密页:记下标志(令牌那一轨)、不退出登录、不把错交给调用方', async () => {
    history.replaceState(null, '', '/ledger')
    sessionStorage.setItem('token', 'tok')
    reply428()
    const settled = vi.fn()
    http.get('/tenants').then(settled, settled)
    await flushPromises()
    expect(sessionStorage.getItem('mustChangePassword')).toBe('1')
    expect(localStorage.getItem('mustChangePassword')).toBeNull()
    expect(sessionStorage.getItem('token'), '不退出登录').toBe('tok')
    expect(settled, '页面马上整页跳走,调用方不报那一闪而过的错').not.toHaveBeenCalled()
  })

  it('已在改密页:不再跳,照常把错交回去', async () => {
    localStorage.setItem('token', 'tok')
    reply428()
    await expect(http.get('/tenants')).rejects.toMatchObject({ code: PASSWORD_CHANGE_REQUIRED })
    expect(localStorage.getItem('mustChangePassword')).toBe('1')
  })
})
