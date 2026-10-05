import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import http, { bindSession } from '@/api'
import { useAuthStore } from '../auth'

// 不 mock @/api:要验的正是真拦截器 + 真 axios 下,登出那一发带没带令牌。
// auth.spec.ts 把 api.post 整个 mock 掉了,只断言「调用过」—— 令牌根本没带出去的那几个月里它一直是绿的。
// 原因:请求拦截器是异步执行的,等它去 storage 里读令牌,logout 后面几行早把令牌清掉了(2026-10-03 安全审计 F01)。
// 破坏验证:把 logout 里显式的 Authorization 头去掉 → 这里拿到 undefined,红。

type Sent = { url?: string; auth?: unknown }

describe('登出', () => {
  let sent: Sent[]

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    sent = []
    // 只换掉最底层的发送,拦截器、信封解包都是真的
    http.defaults.adapter = async (config) => {
      sent.push({ url: config.url, auth: config.headers?.Authorization })
      return { data: { code: 0, data: null }, status: 200, statusText: 'OK', headers: {}, config }
    }
  })

  it('❗登出请求带着当时的令牌出门,不是等拦截器去已经清空的 storage 里找', async () => {
    localStorage.setItem('token', 'tok-1')
    localStorage.setItem('username', 'a')
    bindSession('a')
    const auth = useAuthStore()
    auth.setToken('tok-1')

    auth.logout()
    await new Promise((r) => setTimeout(r, 0))

    expect(sent).toContainEqual({ url: '/auth/logout', auth: 'Bearer tok-1' })
    expect(localStorage.getItem('token'), '本地照样清掉').toBeNull()
  })
})
