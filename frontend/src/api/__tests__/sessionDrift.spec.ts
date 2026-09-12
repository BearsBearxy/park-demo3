import { describe, it, expect, beforeEach, vi } from 'vitest'

// 跨标签页身份漂移守卫。
//
// localStorage 按域名共享、不分标签页：同事甲登着走开了，同事乙在新标签页登自己的账号
// —— 甲那个标签页的界面还是甲的（Pinia 内存里的权限没变），但请求拦截器每次都现读
// storage，于是**甲后续做的每件事都带着乙的令牌发出去，记在乙头上**。
// 这正好把审计体系作废：它的全部意义就是「谁做的」。
//
// 最要紧的性质是**拒发**（横幅只是让人看见）。所以这里测的是：漂移之后请求发不出去，
// 而不是"发出去但界面提示了一下"。
//
// 2026-09-12:绑定从**令牌串**改成**用户名**。改前"同一个人重新登一次"也算漂移(令牌换了串),
// 而单会话上线后每次重新登录都会换串 —— 那会变成天天误伤。判据换成"换了个人才算"。

async function freshApi() {
  vi.resetModules()
  return await import('../index')
}

describe('跨标签页身份漂移', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('❗别的标签页登了另一个人 → 请求直接拒发，不带着别人的令牌出门', async () => {
    localStorage.setItem('token', 'token-of-A'); localStorage.setItem('username', 'a')
    const api = await freshApi()          // 页面加载时绑定 a

    // 另一个标签页登了 b（同一份 localStorage）
    localStorage.setItem('token', 'token-of-B'); localStorage.setItem('username', 'b')

    expect(api.sessionState()).toBe('other-user')
    await expect(api.default.get('/tenants')).rejects.toThrow(/登录状态已在别处改变/)
  })

  it('❗同一个人换了张新令牌不算漂移 —— 单会话之下这是每次重新登录的常态', async () => {
    localStorage.setItem('token', 'token-1'); localStorage.setItem('username', 'a')
    const api = await freshApi()

    // 别的标签页用同一个账号重登:令牌换串,人没变
    localStorage.setItem('token', 'token-2')

    expect(api.sessionState()).toBe('same')
    expect(api.sessionDrifted(), '改前这里是 true —— 正在干活的人会被一条横幅打断').toBe(false)
  })

  it('❗别的标签页登出 → 是 signed-out 不是 other-user（文案要分开，不能说成"登录为另一个账号"）', async () => {
    localStorage.setItem('token', 'token-of-A'); localStorage.setItem('username', 'a')
    const api = await freshApi()

    localStorage.removeItem('token'); localStorage.removeItem('username')

    expect(api.sessionState()).toBe('signed-out')
  })

  it('同一标签页内正常登录不会被误伤', async () => {
    localStorage.setItem('token', 'token-of-A'); localStorage.setItem('username', 'a')
    const api = await freshApi()

    // 本标签页主动登录成另一个账号 —— auth store 会调 bindSession
    localStorage.setItem('token', 'token-of-B'); localStorage.setItem('username', 'b')
    api.bindSession('b')

    expect(api.sessionDrifted()).toBe(false)
  })

  it('登出后解绑，不会拿着已作废的旧令牌比对', async () => {
    localStorage.setItem('token', 'token-of-A'); localStorage.setItem('username', 'a')
    const api = await freshApi()

    localStorage.removeItem('token'); localStorage.removeItem('username')
    api.bindSession(null)
    expect(api.sessionDrifted()).toBe(false)
  })

  it('未登录状态（两边都空）不算漂移', async () => {
    const api = await freshApi()
    expect(api.sessionDrifted()).toBe(false)
  })

  it('sessionStorage 是按标签页隔离的 —— 两个标签页各登各的正是靠它', async () => {
    // 不勾「记住登录状态」→ 走 sessionStorage。这里模拟本标签页只有 sessionStorage 的情形：
    // localStorage 为空 → 读取回落到 sessionStorage，绑定的就是本标签页自己的令牌。
    sessionStorage.setItem('token', 'tab-local-token'); sessionStorage.setItem('username', 'a')
    const api = await freshApi()
    expect(api.readToken()).toBe('tab-local-token')
    expect(api.sessionDrifted()).toBe(false)

    // 另一个标签页写自己的 sessionStorage 影响不到本页（jsdom 里 sessionStorage 就是本页的），
    // 但只要有人往 localStorage 写，优先级更高的它就会盖过来 —— 这正是「有一个勾了记住就破功」的原因
    localStorage.setItem('token', 'someone-remembered-me'); localStorage.setItem('username', 'b')
    expect(api.readToken()).toBe('someone-remembered-me')
    expect(api.sessionDrifted()).toBe(true)
  })
})
