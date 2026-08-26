import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePresenceStore } from '@/stores/presence'
import api from '@/api'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [], evicted: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

/** 最近一次 ping 的请求体 */
const lastPing = () => {
  const calls = vi.mocked(api.put).mock.calls.filter((c) => c[0] === '/presence/ping')
  return calls.length ? (calls[calls.length - 1][1] as Record<string, unknown>) : null
}

describe('在场', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('切到别的页签不会把编辑态的锁作用域清掉', async () => {
    // EDIT-MODE-SPEC v3：编辑态跨页签存活（「专员切去别的页面核对一眼回来，
    // 编辑态和刚拿到的授权全没了，等于逼人一口气改完」）。
    // 那么切页签时 enter() 若把 scope 清成 null、mode 降回 view，
    // 锁就**停止续期**了 —— 人还在编辑态里，3 分钟后锁自己掉，别人直接进得来。
    const p = usePresenceStore()
    p.enter('ledger:3:2025-06', '月度台账')
    p.setMode('edit', 'ledger:3:2025-06')

    p.enter(null, '租户档案')          // 切到另一个页签
    await p.ping()

    expect(lastPing()).toMatchObject({ scope: 'ledger:3:2025-06', mode: 'edit' })
  })

  it('切页签仍然更新「在哪一屏」的文案', async () => {
    // 上一条不能矫枉过正:锁要跟着，但顶栏该显示他现在真正在看的那一屏。
    const p = usePresenceStore()
    p.setMode('edit', 'ledger:3:2025-06')

    p.enter(null, '租户档案')
    await p.ping()

    expect(lastPing()).toMatchObject({ label: '租户档案' })
  })

  it('年份卡按前缀找人:这一年里任何一个月有人在改都要标出来', async () => {
    // 按月锁的屏(工资、附表10)锁的是 `sched:salary:2025-06`,而年份卡问的是
    // 「2025 这一年有没有人在改」。精确匹配在这类屏上永远命不中 —— 标记等于没做。
    const p = usePresenceStore()
    p.users = [
      { sid: 's1', user: 'zhangsan', displayName: '张三', role: null,
        scope: 'sched:salary:2025-06', label: '工资', mode: 'edit',
        sinceMs: 1000, idleMs: 0, self: false },
    ]

    expect(p.editorsUnder('sched:salary:2025').map(e => e.displayName)).toEqual(['张三'])
    expect(p.editorsUnder('sched:salary:2024')).toEqual([])
  })

  it('前缀匹配不许误伤相邻的年份键', async () => {
    // `sched:pv:2025` 不能匹配到 `sched:pv:20251`(将来若有更长的键),
    // 也不能让 `sched:salary:2025` 匹配 `sched:salary:2025X`。边界必须是分隔符或结尾。
    const p = usePresenceStore()
    p.users = [
      { sid: 's1', user: 'a', displayName: '甲', role: null, scope: 'sched:pv:20251',
        label: '', mode: 'edit', sinceMs: 1, idleMs: 0, self: false },
    ]

    expect(p.editorsUnder('sched:pv:2025')).toEqual([])
  })

  it('每次换屏都立刻补一拍，不等下一个 20 秒', async () => {
    // 头像组本来就是自动更新的（20 秒一拍），但**换屏那一下**必须立刻发：
    // 否则你切到别的页面后，自己的「在哪一屏」和别人的名单都要等最多 20 秒才对得上，
    // 用起来就像「要刷新页面才更新」。
    const p = usePresenceStore()
    p.enter('a:1', '甲屏')                    // 首次:开轮询 + 立刻一拍
    const first = vi.mocked(api.put).mock.calls.length

    p.enter('b:1', '乙屏')                    // 再换屏

    expect(vi.mocked(api.put).mock.calls.length,
      '换屏没有立刻补拍 —— 名单会滞后最多 20 秒').toBeGreaterThan(first)
  })

  it('没在编辑时，换屏正常改写作用域', async () => {
    const p = usePresenceStore()
    p.enter('a:1', '甲屏')

    p.enter('b:1', '乙屏')
    await p.ping()

    expect(lastPing()).toMatchObject({ scope: 'b:1', label: '乙屏', mode: 'view' })
  })
})
