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

  it('切到别的页签,锁照续 —— 续期跟着 editScopes,不跟「在哪一屏」', async () => {
    // EDIT-MODE-SPEC v3：编辑态跨页签存活。旧版靠「编辑态下不许动 scope 单槽」保这条,
    // 代价是第二个屏进编辑态就把第一把顶出心跳(2026-08-30 修掉的洞)。
    // 现在续期键是 editScopes 列表,scope 只剩「在哪一屏」,可以放心跟人走。
    const p = usePresenceStore()
    p.enter('ledger:3:2025-06', '月度台账')
    p.holdLock('ledger:3:2025-06', () => {})

    p.enter(null, '租户档案')          // 切到另一个页签
    await p.ping()

    expect(lastPing()).toMatchObject({ editScopes: ['ledger:3:2025-06'], label: '租户档案' })
  })

  it('❗第二个屏进编辑态,第一把锁不许被顶出心跳', async () => {
    // 被修掉的洞本体:旧版 setMode('edit', held) 是单槽,后来的覆盖先来的 ——
    // 第一把锁 3 分钟后被服务端当陈旧锁静默让给别人,且那条路不写 eviction,两边零提示。
    // 而「同时两个页面在编辑态」是明写的设计(auth.ts:142)。
    const p = usePresenceStore()
    const cbA = () => {}
    const cbB = () => {}
    p.holdLock('meters:2025', cbA)
    p.holdLock('pv-meter:2025', cbB)
    await p.ping()

    expect(lastPing()!.editScopes, '两把都要在心跳里')
      .toEqual(expect.arrayContaining(['meters:2025', 'pv-meter:2025']))

    p.dropLock('pv-meter:2025', cbB)  // 第二个屏退出编辑态
    await p.ping()
    expect(lastPing()!.editScopes, '只摘自己那把,第一把照续').toEqual(['meters:2025'])
  })

  it('❗同名 scope 两个屏各自登记 —— 一方退出不许把共用的续期摘掉', async () => {
    // 出账链四屏共一把 billing-chain 锁:催缴单编辑态里开系数簿再进编辑,
    // 就是两个 useEditLock 实例握同名 scope。单值 Map 时后来的覆盖先来的,
    // 任一方退出把共用续期整个摘掉 —— 宿主屏的锁静默停续,3 分钟后被人直接拿走。
    const p = usePresenceStore()
    const host = vi.fn()
    const inner = vi.fn()
    p.holdLock('billing-chain:2026-08', host)     // 催缴单
    p.holdLock('billing-chain:2026-08', inner)    // 系数簿(同一把)

    expect(p.dropLock('billing-chain:2026-08', inner), '还剩宿主一个登记者').toBe(1)
    await p.ping()
    expect(lastPing()!.editScopes, '宿主的续期必须还在').toEqual(['billing-chain:2026-08'])

    expect(p.dropLock('billing-chain:2026-08', host), '末位退出').toBe(0)
    await p.ping()
    expect(lastPing()!.editScopes).toEqual([])
  })

  it('❗同名 scope 的接管通知要派给**每一个**登记者 —— 两个屏都得退', async () => {
    const p = usePresenceStore()
    const host = vi.fn()
    const inner = vi.fn()
    p.holdLock('billing-chain:2026-08', host)
    p.holdLock('billing-chain:2026-08', inner)
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'billing-chain:2026-08', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)

    await p.ping()

    expect(host, '宿主屏也要收到 —— 漏一个就是留一个假编辑态').toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('❗迟到的响应不许砸在发拍之后才登记的新回调上', async () => {
    // 剧本:B 被跨页签失锁踢出 → 按弹窗指引立刻重进 → 新锁到手、新回调登记。
    // 此前锁空窗期发出的慢拍带着「锁没了」的合成通知这时才回来 ——
    // 没有代次守卫就砸在新回调上:刚进的编辑态 3 秒内再次被踢,而服务端那把新锁是活的,
    // 从此无人续也无人还,别人 acquire 被幽灵锁挡满 3 分钟。
    const p = usePresenceStore()
    const oldCb = vi.fn()
    const newCb = vi.fn()
    p.holdLock('meters:2025', oldCb)

    let settle!: (v: unknown) => void
    vi.mocked(api.put).mockReturnValueOnce(new Promise(r => { settle = r }) as never)
    const slow = p.ping()                      // 慢拍在途(带着 meters:2025)

    p.dropLock('meters:2025', oldCb)           // 被踢/退出
    p.holdLock('meters:2025', newCb)           // 立刻重进 —— 新回调,新锁

    settle({ users: [], evictions: [{ scope: 'meters:2025', by: null, byDisplayName: null, authorizerName: null }] })
    await slow

    expect(newCb, '发拍之后才登记的回调,拍里的失锁与它无关').not.toHaveBeenCalled()
    expect(oldCb, '旧回调已摘,也不该被叫').not.toHaveBeenCalled()
  })

  it('发拍之前就登记着的回调,响应回来照常派 —— 代次守卫不许把正常投递也拦了', async () => {
    const p = usePresenceStore()
    const cb = vi.fn()
    p.holdLock('meters:2025', cb)
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'meters:2025', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)

    await p.ping()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('❗by=null 的合成失锁(锁蒸发/别处还掉)也必须照常派发', async () => {
    // 有人在派发循环里加一句看似合理的 `if (!e.by) continue`,合成通知就被整个吞掉:
    // 用户留在假编辑态继续录,保存整片覆盖接管者数据 —— 派生失锁机制原地报废。
    const p = usePresenceStore()
    const cb = vi.fn()
    p.holdLock('meters:2025', cb)
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'meters:2025', by: null, byDisplayName: null, authorizerName: null }],
    } as never)

    await p.ping()
    expect(cb, '没有接管者的失锁同样要当面报').toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatchObject({ by: null })
  })

  it('❗被接管的通知只派给它自己那把锁的回调', async () => {
    // 旧版单槽回调连**别把锁**的通知都会派过去 —— 一次接管把无关的屏也踢出编辑态。
    const p = usePresenceStore()
    const hits: string[] = []
    p.holdLock('meters:2025', () => hits.push('meters'))
    p.holdLock('pv-meter:2025', () => hits.push('pv'))
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'pv-meter:2025', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)

    await p.ping()

    expect(hits, '只有被接管那把的回调该响').toEqual(['pv'])
  })

  it('年份卡按前缀找人:这一年里任何一个月有人在改都要标出来', async () => {
    // 按月锁的屏(工资、附表10)锁的是 `sched:salary:2025-06`,而年份卡问的是
    // 「2025 这一年有没有人在改」。精确匹配在这类屏上永远命不中 —— 标记等于没做。
    const p = usePresenceStore()
    p.users = [
      { sid: 's1', user: 'zhangsan', displayName: '张三', role: null,
        scope: 'sched:salary:2025-06', label: '工资', mode: 'edit',
        editScopes: ['sched:salary:2025-06'], sinceMs: 1000, idleMs: 0, self: false },
    ]

    expect(p.editorsUnder('sched:salary:2025').map(e => e.displayName)).toEqual(['张三'])
    expect(p.editorsUnder('sched:salary:2024')).toEqual([])
  })

  it('holdsEditUnder 的前缀边界与 editorsUnder 逐字同规则 —— 两个函数各写一遍,只有一边有护栏就会单边漂移', () => {
    const p = usePresenceStore()
    p.holdLock('sched:pv:20251', () => {})
    expect(p.holdsEditUnder('sched:pv:2025'), '20251 不是 2025 底下的').toBe(false)
    expect(p.holdsEditUnder('sched:pv:20251')).toBe(true)
    expect(p.holdsEditUnder(['nope', 'sched:pv:20251']), '数组形态的锁根也要吃').toBe(true)
    expect(p.holdsEditUnder(undefined)).toBe(false)
  })

  it('前缀匹配不许误伤相邻的年份键', async () => {
    // `sched:pv:2025` 不能匹配到 `sched:pv:20251`(将来若有更长的键),
    // 也不能让 `sched:salary:2025` 匹配 `sched:salary:2025X`。边界必须是分隔符或结尾。
    const p = usePresenceStore()
    p.users = [
      { sid: 's1', user: 'a', displayName: '甲', role: null, scope: 'sched:pv:20251',
        label: '', mode: 'edit', editScopes: ['sched:pv:20251'], sinceMs: 1, idleMs: 0, self: false },
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

    // mode 不再由客户端申报(服务端从 editScopes 派生),体里只有屏与空锁表
    expect(lastPing()).toMatchObject({ scope: 'b:1', label: '乙屏', editScopes: [] })
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
