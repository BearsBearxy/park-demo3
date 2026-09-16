import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LoginView from '@/views/LoginView.vue'
import ChangePasswordView from '@/views/ChangePasswordView.vue'

// 动效稿 C4-02 + C7-03 ⑤:登录 / 改密的「接口成功」与「导航成功」是两个错误域 ——
// 落地懒块 404(router/index.ts 已知路径)不许冒充密码错误,按钮要停在提交态直到落地确认。

const h = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), login: vi.fn(), post: vi.fn(), mustChangePassword: { value: false },
}))
const { push, replace, login, post, mustChangePassword } = h

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: h.push, replace: h.replace }),
  useRoute: () => ({ query: {} }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    login: h.login,
    landing: '/data',
    get mustChangePassword() { return h.mustChangePassword.value },
    clearMustChangePassword: vi.fn(),
    logout: vi.fn(),
  }),
}))

vi.mock('@/api', () => ({ default: { post: h.post }, AUTH_REASON_KEY: 'authReason' }))

// 登录页两层 canvas 在 jsdom 里拿不到 2d 上下文(组件自己已判 null 跳过),
// 桩掉只为把 jsdom 的 6 段 not-implemented 栈从测试输出里赶走
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']

beforeEach(() => {
  push.mockReset().mockResolvedValue(undefined)
  replace.mockReset().mockResolvedValue(undefined)
  login.mockReset().mockResolvedValue(undefined)
  post.mockReset().mockResolvedValue(undefined)
  mustChangePassword.value = false
  sessionStorage.clear()
})

async function fillAndSubmit(w: ReturnType<typeof mount>) {
  await w.find('input[autocomplete="username"]').setValue('zhang')
  await w.find('input[type="password"]').setValue('pw12345678')
  await w.find('form').trigger('submit')
}

describe('C4-02 登录 → 导航两个错误域', () => {
  it('落地懒块加载失败写自己的话,不冒充密码错误;按钮到那时才复位', async () => {
    push.mockRejectedValue(new Error('Failed to fetch dynamically imported module'))
    const w = mount(LoginView)
    await fillAndSubmit(w)
    await flushPromises()
    expect(w.find('.lg-err').text()).toBe('页面加载失败，请刷新重试')
    expect(w.find('.lg-submit').attributes('disabled')).toBeUndefined()
  })

  it('登录成功后按钮停在「登录中…」直到 push 落定', async () => {
    let settle!: () => void
    push.mockReturnValue(new Promise<void>(r => { settle = r }))
    const w = mount(LoginView)
    await fillAndSubmit(w)
    await flushPromises()
    expect(w.find('.lg-submit').text()).toBe('登录中…')
    settle()
    await flushPromises()
    expect(w.find('.lg-submit').text()).toBe('登录')
  })

  it('登录接口失败仍报密码错误,不走导航', async () => {
    login.mockRejectedValue({ msg: '账号或密码不正确' })
    const w = mount(LoginView)
    await fillAndSubmit(w)
    await flushPromises()
    expect(w.find('.lg-err').text()).toBe('账号或密码不正确')
    expect(push).not.toHaveBeenCalled()
  })

  it('改密页:落地失败不冒充「修改失败」', async () => {
    replace.mockRejectedValue(new Error('chunk 404'))
    const w = mount(ChangePasswordView)
    const inputs = w.findAll('.cp-field input')
    await inputs[0].setValue('old12345678')
    await inputs[1].setValue('new12345678')
    await inputs[2].setValue('new12345678')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('.cp-err').text()).toBe('页面加载失败，请刷新重试')
    expect(post).toHaveBeenCalledOnce()
  })
})

describe('C7-03 ⑤ 被踢原因住进常驻错误位', () => {
  it('被踢原因渲染在 .lg-err 里,没有自己的 <p>', async () => {
    sessionStorage.setItem('authReason', 'relogin')
    const w = mount(LoginView)
    await flushPromises()
    expect(w.findAll('p.lg-kicked')).toHaveLength(0)
    expect(w.find('.lg-err .lg-kicked').text()).toBe('你的账号在另一台设备登录，本设备已退出')
  })

  it('报错时错误红字顶掉被踢原因,行还是同一行', async () => {
    sessionStorage.setItem('authReason', 'relogin')
    login.mockRejectedValue({ msg: '账号或密码不正确' })
    const w = mount(LoginView)
    await fillAndSubmit(w)
    await flushPromises()
    expect(w.findAll('.lg-err')).toHaveLength(1)
    expect(w.find('.lg-err').text()).toBe('账号或密码不正确')
  })
})
