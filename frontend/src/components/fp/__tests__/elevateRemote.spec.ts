import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { usePresenceStore } from '@/stores/presence'
import { useAuthStore } from '@/stores/auth'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import api from '@/api'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({})),
    put: vi.fn(() => Promise.resolve({ users: [], evicted: null, approvals: [], outcome: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
vi.mock('@/api/perms', () => ({
  permLabel: (p: string) => p,
  loadPermDict: () => Promise.resolve(),
}))

const PERM = 'param-policy:edit'

type Vm = { send: () => Promise<void>; picked: string | null; tab: string }

/** 打开弹窗、切到远程那条路、并选好授权人 —— send() 开头有 `if (!picked) return`。 */
async function openPicked() {
  // 切到远程那条路会去拉候选名单，拉回来之后组件自己把 picked 设成第一个在线的人。
  // 所以这里给一份真名单，而不是外部硬塞 picked（塞了也会被覆盖）。
  vi.mocked(api.get).mockResolvedValueOnce([
    { username: 'admin', displayName: '周明', role: 'admin', online: true, idleMs: 1000 },
  ] as never)
  const w = open()
  const vm = w.vm as unknown as Vm
  vm.tab = 'remote'
  await w.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await w.vm.$nextTick()
  return { w, vm }
}

function open() {
  return mount(FPElevateDialog, {
    props: {
      perms: [PERM], what: '修改计费口径',
      page: '计费参数 · 一泽 2025-06', action: '修改 loss_rate',
    },
    global: { stubs: { Teleport: true } },
  })
}

describe('远程授权 · 请求端', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear()
    // refreshElevation() 开头有 `if (!isAuthed) return` —— 没令牌它直接空转。
    localStorage.setItem('token', 'test-token')
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('批准到达时先把服务端的授权拉回来，再喊进编辑模式', async () => {
    // 授权是**服务端**状态。当场授权那条路由 requestElevation() 顺带写进 auth store；
    // 远程这条路没人写 —— 不补一次 refreshElevation 的话，auth.can() 还是 false，
    // useEditMode 那道「权限不齐就退出编辑态」的守卫会当场把人弹回来。
    // 症状：主管批了，请求者这边窗口关掉了，却进不去编辑模式。
    const { w, vm } = await openPicked()
    const presence = usePresenceStore()

    // 发出请求，拿到一个 id
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'req-1', leftMs: 120_000 } as never)
    await vm.send()

    // 主管批了 —— 结果顺着 ping 回来
    vi.mocked(api.get).mockResolvedValueOnce([
      { perm: PERM, permLabel: '计费口径', authorizer: 'admin',
        authorizerName: '周明', expiresAt: Date.now() + 1_800_000 },
    ] as never)
    presence.outcome = { id: 'req-1', approved: true, approverName: '周明' }
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toContain('/auth/elevate')
    expect(useAuthStore().can(PERM), '拉回来之后本地才认这份授权').toBe(true)
    expect(w.emitted('elevated'), '然后才喊进编辑模式').toBeTruthy()
  })

  it('被拒绝时不拉授权、不进编辑模式', async () => {
    const { w, vm } = await openPicked()
    const presence = usePresenceStore()

    vi.mocked(api.post).mockResolvedValueOnce({ id: 'req-2', leftMs: 120_000 } as never)
    await vm.send()

    presence.outcome = { id: 'req-2', approved: false, approverName: '周明' }
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(w.emitted('elevated')).toBeFalsy()
    // 拒绝的原因落在常驻的字段报错位(十件 ⑤ .fp-field-err),不是自写的报错行
    expect(w.find('.fp-field-err').text()).toBe('周明 拒绝了这次请求。')
  })

  it('别人那次请求的结果，本弹窗不认领', async () => {
    // 每个可编辑屏都挂着一个本组件的实例。不按 id 认的话，结果会被某个没打开的弹窗吃掉。
    const { w, vm } = await openPicked()
    const presence = usePresenceStore()

    vi.mocked(api.post).mockResolvedValueOnce({ id: 'mine', leftMs: 120_000 } as never)
    await vm.send()

    presence.outcome = { id: 'someone-else', approved: true, approverName: '周明' }
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(w.emitted('elevated')).toBeFalsy()
  })
})

// 画布 06-E「你请的远程授权超时」问题列:点了「取消请求」照样报超时。
// 撤回走 DELETE /auth/approvals/{id},撤回的不算超时、不进铃铛(实现规范 §1.10 末条)。
describe('远程授权 · 等待中撤回请求', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear()
    localStorage.setItem('token', 'test-token')
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  const cancels = () => vi.mocked(api.delete).mock.calls.filter((c) => String(c[0]).startsWith('/auth/approvals/'))

  // 破坏验证:watch(open) 关闭分支里不调 cancelRequest(改回只清 myId)→ 红
  it('❗发出请求后关掉弹窗 → 以该 id 撤回一次', async () => {
    const { w, vm } = await openPicked()
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'req-9', leftMs: 120_000 } as never)
    await vm.send()
    await w.setProps({ perms: null })
    expect(cancels()).toEqual([['/auth/approvals/req-9']])
  })

  // 破坏验证:把 cancelRequest 里的 `myId.value &&` 去掉 → 没有 id 也发 DELETE → 红
  it('没发请求就关 → 不撤', async () => {
    const { w } = await openPicked()
    await w.setProps({ perms: null })
    expect(cancels()).toHaveLength(0)
  })

  // 破坏验证:「取消请求」按钮改回 @click="waiting = false" → 红
  it('❗点「取消请求」→ 撤回,之后再关弹窗不重复撤', async () => {
    const { w, vm } = await openPicked()
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'req-7', leftMs: 120_000 } as never)
    await vm.send()
    await w.vm.$nextTick()
    const btn = w.findAll('button').find((b) => b.text() === '取消请求')!
    await btn.trigger('click')
    expect(cancels(), '点下去当场就撤,不是等关弹窗').toEqual([['/auth/approvals/req-7']])
    await w.setProps({ perms: null })
    expect(cancels()).toEqual([['/auth/approvals/req-7']])
  })

  // 只切页签不撤的话,2 分钟后框里报超时、铃铛冒「远程授权超时」,人早就改走另一条路了。
  // 破坏验证:去掉 watch(tab) 那条 cancelRequest → 红
  it('❗等待中点「改为请人走过来」→ 当场撤回、倒计时停,之后不报超时', async () => {
    const { w, vm } = await openPicked()
    vi.useFakeTimers()
    try {
      vi.mocked(api.post).mockResolvedValueOnce({ id: 'req-3', leftMs: 120_000 } as never)
      await vm.send()
      await w.vm.$nextTick()
      await w.findAll('button').find((b) => b.text() === '改为请人走过来')!.trigger('click')
      expect(cancels()).toEqual([['/auth/approvals/req-3']])
      expect(vm.tab).toBe('onsite')
      vi.advanceTimersByTime(130_000)
      await w.vm.$nextTick()
      expect(w.find('.fp-field-err').text()).toBe('')
    } finally { vi.useRealTimers() }
  })

  // 破坏验证:把 cancelRequest 里的 `leftMs.value > 0` 去掉 → 超时后关也撤 → 红。
  // 超时了的请求不能撤:撤掉的话服务端那条「授权超时」就不写了,人永远不知道它超时了。
  it('倒数到 0 之后再关 → 不撤(那次算超时)', async () => {
    const { w, vm } = await openPicked()
    vi.useFakeTimers()
    try {
      vi.mocked(api.post).mockResolvedValueOnce({ id: 'req-5', leftMs: 1_000 } as never)
      await vm.send()
      vi.advanceTimersByTime(1_000)
      await w.setProps({ perms: null })
      expect(cancels()).toHaveLength(0)
    } finally { vi.useRealTimers() }
  })
})
