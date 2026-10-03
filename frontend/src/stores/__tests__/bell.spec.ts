// 铃铛状态(PAGE-BEHAVIOR-SPEC §5.3,画布 06-G「一天里记号怎么变」+ 规则表前 5 行;06-F「三类怎么消失」)。
// 夹具走真心跳:服务端状态放在 server 里,api.put('/presence/ping') 按它回 —— 数从哪来和线上同一条路。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import api from '@/api'
import { useBellStore } from '../bell'
import { usePresenceStore } from '../presence'
import { useUpdateStore } from '../update'
import { useAuthStore } from '../auth'
import type { Pending } from '@/api/approvals'
import type { Notice, SystemSeen } from '@/api/notices'
import type { ReturnedItem } from '@/api/review'
import type { PendingItem } from '@/types/review'

vi.mock('@/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(() => Promise.resolve()) },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

const VER = __APP_VERSION__

const APPROVAL: Pending = {
  id: 'ap-1', requester: 'zhang', requesterName: '张会计', requesterRole: '会计',
  perms: ['meters:edit'], permLabels: ['改读数'],
  page: '园区抄表 2026-09', action: '修改读数', impact: '影响 B座 3 块表', leftMs: 102_000,
}
const REVIEW: PendingItem = {
  key: 'ledger:7:2026-08', kind: 'ledger', scope: '7', period: '2026-08',
  label: '月度台账 2026-08', submittedBy: 'li', submittedAt: '2026-09-30T09:10:00',
}
const RETURNED: ReturnedItem = {
  key: 'meters:2026-08', kind: 'meters', scope: null, period: '2026-08', label: '园区抄表 2026-08',
  reviewedBy: 'lishen', reviewedByName: '李审', reviewedAt: '2026-09-30T09:12:00', reason: 'B座 3 块表读数比上月小',
}
const notice = (id: number, seen: boolean): Notice => ({
  id, kind: 'review_approved', title: '你交的公共电核算 2026-08 审核通过', detail: null,
  ref: 'alloc:2026-08', actor: 'lishen', actorName: '李审', createdAt: '2026-09-30T10:30:00', seen,
})

/** 服务端此刻的样子 —— 心跳、清单、标看过都读写它 */
let server: {
  approvals: Pending[]; pendingReviews: number; myReturned: number
  notices: Notice[]; systemSeen: SystemSeen | null
  reviews: PendingItem[]; returned: ReturnedItem[]
}
const unseen = () => server.notices.filter((n) => !n.seen).length

function wire() {
  vi.mocked(api.put).mockImplementation(async (url: string) => {
    if (url !== '/presence/ping') return undefined
    return {
      users: [], evictions: null, outcome: null, reviewRev: 0,
      approvals: server.approvals, pendingReviews: server.pendingReviews, myReturned: server.myReturned,
      unseenResults: unseen(), elevated: null, systemSeen: server.systemSeen,
    }
  })
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/notices') return server.notices.map((n) => ({ ...n }))
    if (url === '/review/pending') return server.reviews
    if (url === '/review/returned') return server.returned
    throw new Error(`unexpected GET ${url}`)
  })
  vi.mocked(api.post).mockImplementation(async (url: string, body?: unknown) => {
    if (url === '/notices/seen') server.notices = server.notices.map((n) => ({ ...n, seen: true }))
    if (url === '/notices/system-seen') {
      const b = body as Partial<SystemSeen>
      const cur = server.systemSeen ?? { changelogVersion: null, bellKey: null }
      server.systemSeen = { changelogVersion: b.changelogVersion ?? cur.changelogVersion, bellKey: b.bellKey ?? cur.bellKey }
    }
    return undefined
  })
}

/** 登录、版本号当作已看过(只测系统组的用例自己改),再跑一拍心跳 */
async function boot(who = 'zhou') {
  useAuthStore().me = who
  const upd = useUpdateStore()
  upd.loadSeen()
  upd.markSeen()
  const bell = useBellStore()
  await usePresenceStore().ping()
  return bell
}
const calls = (m: unknown, url: string) =>
  (m as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === url)

describe('铃铛记号', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    server = { approvals: [], pendingReviews: 0, myReturned: 0, notices: [], systemSeen: null, reviews: [], returned: [] }
    wire()
  })

  // 破坏:red 改成 open ? 0 : … → openPanel 后红
  it('❗09:00/09:01 一条授权请求 → 红 1;打开铃铛不减', async () => {
    server.approvals = [APPROVAL]
    const bell = await boot()
    expect(bell.red).toBe(1)
    expect(bell.markText).toBe('1')
    await bell.openPanel()
    expect(bell.red).toBe(1)
    expect(bell.markText).toBe('1')
  })

  // 破坏:删掉 openPanel 里 resultsAck.value = true → 刚点开那一下仍是蓝点
  // 破坏:openPanel 不调 noticesApi.seen → 最后一条红
  it('❗10:30/10:32 授权清空 + 1 条没看过的结果 → 蓝点;打开铃铛当下就灭,服务端也记成看过', async () => {
    server.notices = [notice(5, false)]
    const bell = await boot()
    expect(bell.red).toBe(0)
    expect(bell.blue).toBe(true)
    const p = bell.openPanel()
    expect(bell.blue).toBe(false)
    await p
    expect(bell.blue).toBe(false)
    expect(server.notices.every((n) => n.seen)).toBe(true)
  })

  // 破坏:删掉 openPanel 末尾(finally 里)那句 resultsAck.value = false → 红:开过一次之后再来的结果永远点不亮蓝点
  it('❗开过一次、关上之后又来一条结果 → 蓝点再亮', async () => {
    server.notices = [notice(19, false)]
    const bell = await boot()
    await bell.openPanel()
    bell.closePanel()
    expect(bell.blue).toBe(false)
    server.notices.unshift(notice(20, false))
    await usePresenceStore().ping()
    expect(bell.blue).toBe(true)
    expect(bell.ariaLabel).toBe('通知，有新消息')
  })

  // 破坏:openPanel 去掉 `if (!notices.err.value)`(清单失败照样标看过)→ 红
  it('❗清单没取到:不标看过(人没看见),错误进槽,蓝点留着', async () => {
    server.notices = [notice(21, false)]
    const bell = await boot()
    const ok = vi.mocked(api.get).getMockImplementation()!
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/notices') throw { message: '服务异常' }
      return ok(url)
    })
    await bell.openPanel()
    expect(calls(api.post, '/notices/seen')).toHaveLength(0)
    expect(server.notices[0].seen).toBe(false)
    expect(bell.noticesErr).toBe('服务异常')
    expect(bell.blue).toBe(true)
  })

  // 破坏:blue 去掉 red.value === 0 && → 红
  it('❗11:00 两件等你处理 + 1 条结果 → 只显示红数字,不挂蓝点', async () => {
    server.pendingReviews = 2
    server.notices = [notice(6, false)]
    const bell = await boot()
    expect(bell.markText).toBe('2')
    expect(bell.blue).toBe(false)
  })

  // 破坏:三句任一换字 → 红
  it('❗读屏名字依次是「通知，4 件等你处理」「通知，有新消息」「通知」', async () => {
    server.approvals = [APPROVAL]; server.pendingReviews = 2; server.myReturned = 1
    server.notices = [notice(7, false)]
    const bell = await boot()
    expect(bell.ariaLabel).toBe('通知，4 件等你处理')
    server.approvals = []; server.pendingReviews = 0; server.myReturned = 0
    await usePresenceStore().ping()
    expect(bell.ariaLabel).toBe('通知，有新消息')
    await bell.openPanel()
    expect(bell.ariaLabel).toBe('通知')
  })

  // 破坏:> 99 改成 >= 99 → 99 那条红;0 时返回 '0' → 最后一条红
  it('❗封顶 99+,0 不写', async () => {
    server.pendingReviews = 99
    const bell = await boot()
    expect(bell.markText).toBe('99')
    server.pendingReviews = 100
    await usePresenceStore().ping()
    expect(bell.markText).toBe('99+')
    server.pendingReviews = 120
    await usePresenceStore().ping()
    expect(bell.markText).toBe('99+')
    server.pendingReviews = 0
    await usePresenceStore().ping()
    expect(bell.markText).toBe(null)
  })
})

describe('系统组的蓝点(看过存服务端,失败退回本机)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    server = { approvals: [], pendingReviews: 0, myReturned: 0, notices: [], systemSeen: null, reviews: [], returned: [] }
    wire()
  })

  // 破坏:markSystemSeen 不发 bellKey → 服务端那条红
  it('❗发了新版本 → 蓝点;打开铃铛灭,并把系统组键记到服务端', async () => {
    const bell = await boot()
    useUpdateStore().serverVersion = '99.0.0'
    expect(bell.blue).toBe(true)
    await bell.openPanel()
    expect(bell.blue).toBe(false)
    expect(server.systemSeen?.bellKey).toBe('n:99.0.0')
  })

  // 破坏:sysNew 改成「键不相等就亮」→ 「看看」后那条红
  it('❗开过之后又来一版 → 再亮;只是某项消失(看过更新记录)不亮', async () => {
    const bell = await boot()
    const upd = useUpdateStore()
    upd.seen = null                     // 更新记录没看过
    upd.serverVersion = '99.0.0'
    await bell.openPanel()
    bell.closePanel()
    expect(bell.blue).toBe(false)
    upd.markSeen()                      // 「看看」:更新记录那行消失
    expect(bell.blue).toBe(false)
    upd.serverVersion = '99.1.0'        // 又发了一版
    expect(bell.blue).toBe(true)
  })

  // 破坏:sysNew 不读 presence.systemSeen.bellKey → 红
  it('❗别的电脑开过铃铛(心跳带来的 bellKey)→ 这台也不亮', async () => {
    const bell = await boot()
    useUpdateStore().serverVersion = '99.0.0'
    expect(bell.blue).toBe(true)
    server.systemSeen = { changelogVersion: null, bellKey: 'n:99.0.0' }
    await usePresenceStore().ping()
    expect(bell.blue).toBe(false)
  })

  // 破坏:markSystemSeen 不写 localStorage → 重开页面后那条红
  it('❗服务端写失败:按账号记在本机,重开页面照样不亮', async () => {
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === '/notices/system-seen') throw new Error('500')
      return undefined
    })
    const bell = await boot()
    useUpdateStore().serverVersion = '99.0.0'
    await bell.openPanel()
    expect(localStorage.getItem('fp-bell-sys:zhou')).toBe('n:99.0.0')
    setActivePinia(createPinia())       // 重开页面
    const again = await boot()
    useUpdateStore().serverVersion = '99.0.0'
    expect(again.blue).toBe(false)
  })

  // 破坏:changelogUnread 不看 presence.systemSeen.changelogVersion → 第一条红
  // 破坏:删掉 watch(update.seen) 那段 → 第二条红
  it('❗更新记录看过也跨电脑:服务端记过这一版就不算没看;本机看过要写回服务端', async () => {
    useAuthStore().me = 'zhou'
    const bell = useBellStore()
    server.systemSeen = { changelogVersion: VER, bellKey: null }
    await usePresenceStore().ping()
    expect(bell.changelogUnread).toBe(false)
    server.systemSeen = null
    await usePresenceStore().ping()
    expect(bell.changelogUnread).toBe(true)
    useUpdateStore().markSeen()
    await nextTick()
    expect(server.systemSeen).toEqual({ changelogVersion: VER, bellKey: null })
  })

  // 破坏:changelogUnread 的 `cmpVersion(s, update.version) >= 0` 换成恒真(服务端记过任意版本就算看过)→ 红
  it('❗服务端记的是更老的版本(别的电脑看过上一版)→ 这一版仍算没看过', async () => {
    useAuthStore().me = 'zhou'
    const bell = useBellStore()
    server.systemSeen = { changelogVersion: '0.0.1', bellKey: null }
    await usePresenceStore().ping()
    expect(bell.changelogUnread).toBe(true)
  })

  // 破坏:openPanel 里先 markSystemSeen() 再拍 sysSeenAtOpen → 两行都灰,第一次打开那条红
  it('❗系统组:上次开铃铛时就在的那一段画灰,这次新来的不灰(06-F)', async () => {
    const bell = await boot()
    const upd = useUpdateStore()
    upd.seen = null                     // 更新记录没看过
    upd.serverVersion = '99.0.0'
    await bell.openPanel()
    expect([bell.newVersionRead, bell.changelogRead], '第一次打开:两行都是新的').toEqual([false, false])
    bell.closePanel()
    upd.serverVersion = '99.1.0'        // 又发了一版
    await bell.openPanel()
    expect([bell.newVersionRead, bell.changelogRead], '更新记录上次就在,新版本是新来的').toEqual([false, true])
  })
})

describe('面板明细', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    server = { approvals: [], pendingReviews: 0, myReturned: 0, notices: [], systemSeen: null, reviews: [], returned: [] }
    wire()
  })

  // 破坏:openPanel 里先调 noticesApi.seen 再取清单 → 小蓝点那条红
  // 破坏:closePanel 不改 seen → 最后一条红
  it('❗打开时先取清单再标看过:新来的行挂小蓝点;关面板后变灰', async () => {
    server.notices = [notice(9, false), notice(8, true)]
    const bell = await boot()
    await bell.openPanel()
    expect(bell.notices.map((n) => n.seen)).toEqual([false, true])
    bell.closePanel()
    expect(bell.notices.map((n) => n.seen)).toEqual([true, true])
  })

  // 破坏:source 成功分支不置 loaded → 第一条红;失败分支不置 → 第二条红(面板会一直写「加载中…」)
  it('❗清单取回来过才算 loaded(成功、失败都算);换账号清回没取过', async () => {
    const bell = await boot()
    expect(bell.noticesLoaded).toBe(false)
    await bell.openPanel()
    expect(bell.noticesLoaded).toBe(true)
    bell.closePanel()
    useAuthStore().me = 'li'
    await nextTick()
    expect(bell.noticesLoaded).toBe(false)
    vi.mocked(api.get).mockImplementationOnce(async () => { throw { message: '服务异常' } })
    await bell.loadNotices()
    expect(bell.noticesLoaded, '失败也算取回来过').toBe(true)
  })

  // 破坏:source 的 has() 判断去掉 → 不该取的那条红
  it('❗三份明细:心跳说有才去取;没有就不打请求', async () => {
    server.pendingReviews = 1; server.reviews = [REVIEW]
    server.myReturned = 1; server.returned = [RETURNED]
    const bell = await boot()
    await bell.openPanel()
    expect(bell.reviews).toEqual([REVIEW])
    expect(bell.returned).toEqual([RETURNED])
    bell.closePanel()
    server.myReturned = 0; server.returned = []
    await usePresenceStore().ping()
    vi.mocked(api.get).mockClear()
    await bell.openPanel()
    expect(calls(api.get, '/review/returned')).toHaveLength(0)
    expect(bell.returned).toEqual([])
  })

  // 破坏:删掉 watch(presence.pendingReviews) → 第一条红;删掉 watch(presence.myReturned) → 第二条红
  it('❗面板开着时待审数 / 被退回数变了 → 那份明细重取', async () => {
    server.pendingReviews = 1; server.reviews = [REVIEW]
    server.myReturned = 1; server.returned = [RETURNED]
    const bell = await boot()
    await bell.openPanel()
    server.pendingReviews = 0; server.reviews = []
    server.myReturned = 0; server.returned = []   // 重新交了
    await usePresenceStore().ping()
    await nextTick()
    expect(bell.reviews).toEqual([])
    expect(bell.returned).toEqual([])
  })

  // 破坏:source 去掉 if (my !== seq) return → 晚到的旧结果盖掉新的,红
  // 破坏:catch 里清 list → 失败那条红
  it('❗取明细失败进错误槽、旧清单不清;先发后到的旧结果不盖新的', async () => {
    server.pendingReviews = 1; server.reviews = [REVIEW]
    const bell = await boot()
    await bell.loadReviews()
    vi.mocked(api.get).mockImplementationOnce(async () => { throw { message: '服务异常' } })
    await bell.loadReviews()
    expect(bell.reviewsErr).toBe('服务异常')
    expect(bell.reviews).toEqual([REVIEW])

    let first!: (v: PendingItem[]) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((r) => { first = r as never }))
    const a = bell.loadReviews()
    const b = bell.loadReviews()          // 第二次走 wire():返回 [REVIEW]
    await b
    expect(bell.reviewsErr).toBe(null)
    first([{ ...REVIEW, key: 'stale:2026-07' }])
    await a
    expect(bell.reviews).toEqual([REVIEW])
  })

  // 破坏:markAllRead 不调 update.markSeen → 更新记录那条红
  it('❗全部标为已读:结果行全灰、更新记录标已看、服务端标看过', async () => {
    server.notices = [notice(11, false)]
    const bell = await boot()
    useUpdateStore().seen = null
    await bell.openPanel()
    server.notices = [notice(12, false), ...server.notices]   // 面板开着时又来一条
    vi.mocked(api.post).mockClear()
    await bell.markAllRead()
    expect(bell.notices.every((n) => n.seen)).toBe(true)
    expect(bell.changelogUnread).toBe(false)
    expect(calls(api.post, '/notices/seen')).toHaveLength(1)
  })

  // 破坏:watch(auth.me) 里不清明细 → 红
  it('❗换账号:上一个人的明细不留,面板关上', async () => {
    server.notices = [notice(13, false)]
    const bell = await boot('zhou')
    await bell.openPanel()
    expect(bell.notices).toHaveLength(1)
    useAuthStore().me = 'li'
    await nextTick()
    expect(bell.open).toBe(false)
    expect(bell.notices).toEqual([])
  })
})
