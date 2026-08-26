import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useEditMode } from '@/composables/useEditMode'
import { usePresenceStore } from '@/stores/presence'
import api from '@/api'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve()),
  },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

const PERMS = ['entry:edit']
const SCOPE = 'ledger:3:2025-06'

/** 后端 POST /api/locks/{scope} 的两种回答 */
const GRANTED = { granted: true, holder: null }
const HELD_BY_ZHANG = {
  granted: false,
  holder: { user: 'zhangsan', displayName: '张三', heldMs: 761_000, idleMs: 120_000, idle: false },
}

describe('编辑模式 × 编辑锁', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('权限齐、这一期没人占 → 拿到锁，进编辑态', async () => {
    useAuthStore().permissions = PERMS
    vi.mocked(api.post).mockResolvedValueOnce(GRANTED as never)

    const { editMode, toggle } = useEditMode(PERMS, { scope: () => SCOPE })
    await toggle()

    expect(api.post).toHaveBeenCalledWith(`/locks/${SCOPE}`)
    expect(editMode.value).toBe(true)
  })

  it('权限齐、但这一期被张三占着 → 不进编辑态，交出持有人是谁', async () => {
    // 这条就是用户报的那个 bug:A 在编辑态里,B 照样进得去,后保存的完全覆盖。
    // 权限齐**不等于**可以进 —— 这是 P1 加的第二道闸。
    useAuthStore().permissions = PERMS
    vi.mocked(api.post).mockResolvedValueOnce(HELD_BY_ZHANG as never)

    const { editMode, toggle, lockedBy } = useEditMode(PERMS, { scope: () => SCOPE })
    await toggle()

    expect(editMode.value).toBe(false)
    expect(lockedBy.value?.displayName).toBe('张三')
  })

  it('退出编辑模式 → 把锁还回去', async () => {
    // 不还的话下一个人要等 3 分钟心跳超时,或者去走接管 —— 都是本可以避免的摩擦。
    useAuthStore().permissions = PERMS
    vi.mocked(api.post).mockResolvedValueOnce(GRANTED as never)

    const { toggle } = useEditMode(PERMS, { scope: () => SCOPE })
    await toggle()
    await toggle()

    expect(api.delete).toHaveBeenCalledWith(`/locks/${SCOPE}`)
  })

  it('编辑态里每 20 秒续一次锁', async () => {
    // 不续的话，录到第 3 分钟锁自己掉了，别人直接进得来 —— 比不加锁还糟。
    vi.useFakeTimers()
    try {
      useAuthStore().permissions = PERMS
      vi.mocked(api.post).mockResolvedValueOnce(GRANTED as never)
      vi.mocked(api.put).mockResolvedValue({ users: [], evicted: null } as never)

      const { toggle } = useEditMode(PERMS, { scope: () => SCOPE })
      await toggle()
      await vi.advanceTimersByTimeAsync(20_000)

      // 一条通道两件事：登记在场 + 编辑态续锁。分成两条的话编辑态每 20 秒发两个请求，
      // 而且两边的「最后一次活动」各记各的 —— 空闲判定就有两个不一致的答案。
      expect(api.put).toHaveBeenCalledWith('/presence/ping',
        expect.objectContaining({ scope: SCOPE, mode: 'edit' }))
      expect(api.put).not.toHaveBeenCalledWith(
        expect.stringContaining('/heartbeat'), expect.anything())
    } finally { vi.useRealTimers() }
  })

  it('心跳带回「你被接管了」→ 当场退出编辑态，并交出接管者是谁', async () => {
    // 「必须是当面提示，不是等他保存时才 403」(CONCURRENCY-SPEC §4.3)。
    // 心跳是现成的通道，最迟 20 秒到 —— 不需要 WebSocket。
    vi.useFakeTimers()
    try {
      useAuthStore().permissions = PERMS
      vi.mocked(api.post).mockResolvedValueOnce(GRANTED as never)
      vi.mocked(api.put).mockResolvedValue({
        users: [],
        evicted: { scope: SCOPE, by: 'lisi', byDisplayName: '李四', authorizerName: '张主管' },
      } as never)

      const { editMode, toggle, evictedBy } = useEditMode(PERMS, { scope: () => SCOPE })
      await toggle()
      expect(editMode.value).toBe(true)

      await vi.advanceTimersByTimeAsync(20_000)

      expect(editMode.value, '被接管后必须退回浏览态').toBe(false)
      expect(evictedBy.value?.byDisplayName).toBe('李四')
      expect(evictedBy.value?.authorizerName).toBe('张主管')
    } finally { vi.useRealTimers() }
  })

  it('别人在编辑时，按钮不点也知道被占了', async () => {
    // 设计稿 C-2 画的是「不点就显示 [张] 张三 编辑中」。
    // 只在「点了、被拒了」之后才知道，等于让每个人都先去撞一次门 ——
    // 而在场那条 ping 早就把「谁在哪个 scope 编辑」带回来了，只是没人去查。
    useAuthStore().permissions = PERMS
    const presence = usePresenceStore()
    presence.users = [
      { sid: 's1', user: 'zhangsan', displayName: '张三', role: 'finance_clerk',
        scope: SCOPE, label: '月度台账', mode: 'edit', sinceMs: 761_000, idleMs: 5_000, self: false },
    ]

    const { heldByOther } = useEditMode(PERMS, { scope: () => SCOPE })

    expect(heldByOther.value?.displayName).toBe('张三')
  })

  it('别人占着时，接管抽屉不许自己弹出来', async () => {
    // 「按钮不点也显示被占」与「抽屉不点不弹」是两回事。
    // 把 heldByOther 直接接到抽屉的 holder 上，一进这一期就当脸糊一个「本期正被他人编辑」
    // 的弹窗 —— 而他可能只是来看看。抽屉只在**他点了按钮、并被服务端拒绝**之后才开。
    useAuthStore().permissions = PERMS
    const presence = usePresenceStore()
    presence.users = [
      { sid: 's1', user: 'zhangsan', displayName: '张三', role: null,
        scope: SCOPE, label: '月度台账', mode: 'edit', sinceMs: 1000, idleMs: 0, self: false },
    ]

    const { heldByOther, lockedBy } = useEditMode(PERMS, { scope: () => SCOPE })

    expect(heldByOther.value?.displayName, '按钮要知道').toBe('张三')
    expect(lockedBy.value, '抽屉的开关不许被它带起来').toBeNull()
  })

  it('自己在编辑不算「被别人占了」', async () => {
    useAuthStore().permissions = PERMS
    const presence = usePresenceStore()
    presence.users = [
      { sid: 's1', user: 'me', displayName: '我', role: null,
        scope: SCOPE, label: '月度台账', mode: 'edit', sinceMs: 1000, idleMs: 0, self: true },
    ]

    const { heldByOther } = useEditMode(PERMS, { scope: () => SCOPE })

    expect(heldByOther.value).toBeNull()
  })

  it('没传 scope 的屏一切照旧，不占锁', async () => {
    // P1 只铺台账 + 附表族;其余十几屏这一轮不接锁,它们的 toggle 必须一个字都没变。
    useAuthStore().permissions = PERMS

    const { editMode, toggle } = useEditMode(PERMS)
    await toggle()

    expect(editMode.value).toBe(true)
    expect(api.post).not.toHaveBeenCalled()
  })
})
