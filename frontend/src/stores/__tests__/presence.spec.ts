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
  readToken: vi.fn(() => 'test-token'),
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

  it('待批的授权请求顺着同一条 ping 回来，不开第二条通道', async () => {
    // 「要做通知机制」是 CONCURRENCY-SPEC §4.3 当初否掉远程授权的两条理由之一。
    // 心跳建好之后，它的边际成本就只是响应体多两个字段。
    const p = usePresenceStore()
    vi.mocked(api.put).mockResolvedValue({
      users: [], evicted: null,
      approvals: [{ id: 'a1', requester: 'zhangsan', requesterName: '张三', requesterRole: null,
                    perms: ['param-policy:edit'], permLabels: ['计费口径'],
                    page: '计费参数 · 一泽 2025-06', action: '修改 loss_rate · A 座',
                    impact: '本月 A 座 41 户', leftMs: 92_000 }],
      outcome: null,
    } as never)

    await p.ping()

    expect(p.approvals).toHaveLength(1)
    expect(p.approvals[0].action).toBe('修改 loss_rate · A 座')
  })

  it('自己请的那次批了没有，也走同一条 ping', async () => {
    const p = usePresenceStore()
    vi.mocked(api.put).mockResolvedValue({
      users: [], evicted: null, approvals: [],
      outcome: { id: 'a1', approved: true, approverName: '李主管' },
    } as never)

    await p.ping()

    expect(p.outcome?.approverName).toBe('李主管')
  })

  it('结果放成 ref，不是单槽回调 —— 每个屏都挂着一个授权窗', async () => {
    // FPElevateDialog 在**每个可编辑屏都有一个实例**。做成 `onOutcome = fn` 的单槽回调时，
    // 最后挂载的那个实例赢，结果就派发给了一个根本没打开的弹窗 ——
    // 表现正是「主管批了，请求者那边窗口关掉了却没进编辑模式」。
    // 改成 ref 之后，由**发起请求的那个弹窗**按 id 自己认领。
    const p = usePresenceStore()
    vi.mocked(api.put).mockResolvedValue({
      users: [], evicted: null, approvals: [],
      outcome: { id: 'mine', approved: true, approverName: '李主管' },
    } as never)

    await p.ping()

    // 两个「弹窗」各自判断这条是不是自己那次请求的结果
    expect(p.outcome?.id === 'mine', '发起请求的那个认得出来').toBe(true)
    expect(p.outcome?.id === 'someone-else', '没发过请求的那个不认领').toBe(false)
  })

  it('没在编辑时，换屏正常改写作用域', async () => {
    const p = usePresenceStore()
    p.enter('a:1', '甲屏')

    p.enter('b:1', '乙屏')
    await p.ping()

    expect(lastPing()).toMatchObject({ scope: 'b:1', label: '乙屏', mode: 'view' })
  })
})

describe('关页面时的收尾', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('关浏览器要主动销号,不能等 60 秒 TTL 自然过期', () => {
    // 用户 2026-08-26 实测:「admin 开着编辑模式关掉浏览器之后,别的账号的编辑模式按钮
    // 还是显示 admin 在编辑中,但是又能打开编辑模式,并且过了很久才更新下线」。
    //
    // 根因:beforeunload 上只挂了**还锁**(locksApi.releaseOnUnload),座位什么都没发。
    // 于是锁立刻没了(所以别人进得去),座位却要挂满 PRESENCE_TTL=60 秒 ——
    // 别人的按钮读的是**座位**,就一直显示「admin 编辑中」。两个登记只拆了一个。
    //
    // ⚠ 必须 fetch keepalive:卸载路径上普通 XHR 会被浏览器连同页面一起掐掉。
    //   (不用 sendBeacon —— 它带不了 Authorization 头,令牌只能塞查询串。同 locks.ts 的理由。)
    const f = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', f)
    const presence = usePresenceStore()

    window.dispatchEvent(new Event('pagehide'))

    // 按**本 store 的 sid** 认领:store 里注册的监听器活得比单个测试长,
    // 同一个 jsdom window 上会积累好几个(各自 sid 不同),按 '/presence/' 找会撞上别人的。
    const call = f.mock.calls.find((c) => String(c[0]).includes(presence.sid))
    expect(call, '关页面必须发销号请求').toBeTruthy()
    const init = call![1] as RequestInit
    expect(init.method).toBe('DELETE')
    expect(init.keepalive, '不带 keepalive 的话请求会被连页面一起掐掉').toBe(true)
    vi.unstubAllGlobals()
  })
})
