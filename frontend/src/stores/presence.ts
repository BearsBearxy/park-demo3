import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api, { readToken } from '@/api'
import type { Eviction } from '@/api/locks'
import type { Pending, Outcome } from '@/api/approvals'
import { NAV_SCOPE_PREFIX, scopeNote, scopePeriod } from '@/utils/lockScopes'

/** 在线的一个人（服务端算好时长与排序）。 */
export interface Seat {
  sid: string
  user: string
  displayName: string
  role: string | null
  scope: string | null
  /** 人话的「在哪一屏」，如「月度台账 · 一泽 2025-06」 */
  label: string | null
  mode: 'view' | 'edit'
  /** 这个会话握着的**全部**锁。徽标逐把匹配它,不再看单槽 scope。 */
  editScopes: string[]
  /** 在这一屏待了多久 */
  sinceMs: number
  /** 距上次心跳多久 —— 用来淡显「快掉线」的人 */
  idleMs: number
  self: boolean
}

/**
 * 在场（PRESENCE 设计稿 §02）。**全站唯一的轮询**，20 秒一拍。
 *
 * 一条通道两件事：登记「我在哪一屏」，顺带在编辑态续锁、并把「你被接管了」带回来。
 * 分成两条的话编辑态每 20 秒发两个请求，而且两边的「最后一次活动」各记各的 ——
 * 空闲判定会出现两个不一致的答案，而它决定接管要不要叫主管。
 *
 * 做成 Pinia store 而不是模块级单例：单测里 `setActivePinia(createPinia())` 天然重置，
 * 不必为了可测性在生产代码里留一个 `__reset()` 后门。
 */
export const usePresenceStore = defineStore('presence', () => {
  /**
   * 轮询周期。**3 秒**，不是 20 —— 用户拍板 2026-08-26：「我要的是实时更新的结果，
   * 最多几秒钟的延迟」。20 秒时的实测体感是「一直不动，只好去刷新页面」。
   *
   * 3 秒在这个规模上很便宜：几十个账号 ≈ 10 req/s，服务端一拍是几次内存 Map 读
   * （身份只在会话第一拍查一次库，见 PresenceService）。
   *
   * ⚠ 服务端两个 TTL **不跟着缩**：
   *   · 锁 3 分钟 = 60 拍容错，网络抖动完全掉不了锁
   *   · 在场 60 秒 —— 浏览器把后台标签页节流到约 1 分钟一拍，缩了的话切到后台的人
   *     会从在线名单消失，而他手上的锁还在，别人的按钮就不再显示「李四 编辑中」
   */
  const PING_MS = 3_000

  /** 本标签页的会话 id。**按会话不按人** —— 一个人开两个标签页看两个屏是常态。 */
  const sid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

  const users = ref<Seat[]>([])
  /** 别人（自己在顶栏不占位置 —— 你知道自己在哪）。 */
  const others = computed(() => users.value.filter((u) => !u.self))
  /** 正在编辑的人，按 scope 索引 —— 入口标记查这张表。 */
  const editorsByScope = computed(() => {
    const m = new Map<string, Seat[]>()
    for (const u of users.value) {
      // 逐把锁登记 —— 一个会话可以同时握多把(多屏编辑态是明写的设计),单槽 scope 只剩「在哪一屏」
      for (const sc of u.editScopes ?? []) {
        const list = m.get(sc) ?? []
        list.push(u)
        m.set(sc, list)
      }
    }
    return m
  })

  /**
   * 某个作用域**前缀**下正在编辑的人。年份卡用它。
   *
   * 为什么不能只做精确匹配：按月锁的屏（工资 / 附表10）锁的是 `sched:salary:2025-06`，
   * 而年份卡问的是「2025 这一年有没有人在改」—— 精确匹配在那类屏上永远命不中，
   * 标记等于没做。
   *
   * 边界必须是分隔符或结尾，否则 `sched:pv:2025` 会误伤 `sched:pv:20251`。
   */
  function editorsUnder(prefix: string): Seat[] {
    return users.value.filter((u) => (u.editScopes ?? []).some((sc) =>
      sc === prefix || sc.startsWith(prefix + ':') || sc.startsWith(prefix + '-')))
  }

  /**
   * 这个导航项底下有没有人在编辑 —— 有则返回提示文案,无则 null。
   * 自 P2 起上提到 store:侧栏的点、清单行、主管条 chips 三处共用同一份文案,
   * 否则同一件事三份实现会各自漂(P3 的 holdsEditUnder / editorsUnder 就差点漂开)。
   * **只标编辑态**(设计稿 §04):标记要回答的只有「我点进去改得了吗」,别人在看不挡你。
   */
  function editingNote(navValue: string): string | null {
    // 一个导航项可能挂多个锁根(一屏两本账:报送台账 + 运营账),逐个查再并起来
    const prefix = NAV_SCOPE_PREFIX[navValue]
    if (!prefix) return null
    const ps = Array.isArray(prefix) ? prefix : [prefix]
    // 去重按 sid:同一个会话在多个锁根下都命中时(如台账编辑态里又开着模板面板),
    // flatMap 会把同一个 Seat 收两遍 —— 名字被拼两次,读成两个人在抢(2026-09-06 复查坐实)。
    const who = [...new Map(ps.flatMap((p) => editorsUnder(p)).map((e) => [e.sid, e])).values()]
    if (!who.length) return null
    const names = who.map((e) => `${e.displayName} 正在编辑`).join('、')
    // 共占锁的屏要说清楚为什么这几个一起亮 —— 否则看着像见鬼。
    // ⚠ 喂 scopeNote 的必须是**锁**(editScopes 里命中前缀的那把)。
    //   seat.scope 在 2026-08-30 之后只是「在哪一屏」,生产里 AppShell 恒传 null ——
    //   拿它喂的话这句解释永远渲染不出来,正是 2026-08-26 用户「莫名其妙」投诉的那条回退。
    const hit = (sc: string) => ps.some((p) => sc === p || sc.startsWith(p + ':') || sc.startsWith(p + '-'))
    const lockOf = (e: Seat) => e.editScopes.find(hit) ?? null
    // 期只在**所有人都在同一期**时才写。多人挂同一把锁根却在不同月时,
    // 拿 who[0] 的期安到整串名字上就是张冠李戴(2026-09-06 三镜头复查坐实,严重度最高的那条)。
    // 宁可不写期,也不写一个错的期 —— 这个点要回答的只有「我点进去改得了吗」,期是锦上添花。
    const periods = new Set(who.map((e) => scopePeriod(lockOf(e))).filter(Boolean))
    const period = periods.size === 1 ? [...periods][0] : null
    // §3.3:三段有几段写几段 —— 名字 · 期 · 共锁解释,与页签标题同一条口径
    return [names, period, scopeNote(lockOf(who[0]))].filter(Boolean).join(' · ')
  }

  // 我此刻在哪一屏。屏进来时登记。锁**不再**挤在这个单槽里 —— 见下面 editCallbacks。
  let scope: string | null = null
  let label: string | null = null
  let lastActivityAt = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null

  /**
   * 等我批的授权请求（设计稿 §07）。顶栏 Bell 的红点数就是它的长度。
   *
   * 走同一条 ping —— 「要做通知机制」是当初否掉远程授权的两条理由之一，
   * 心跳建好之后它的边际成本就只是响应体多两个字段。
   */
  const approvals = ref<Pending[]>([])

  /**
   * 我请的那次批了没有。
   *
   * ⚠ **必须是 ref，不能是单槽回调。** FPElevateDialog 在每个可编辑屏都有一个实例，
   *   写成 `onOutcome = fn` 时最后挂载的那个赢，结果就派发给了一个根本没打开的弹窗 ——
   *   表现是「主管批了，请求者那边窗口关掉了却没进编辑模式」。
   *   放成 ref，由**发起请求的那个弹窗**按 id 自己认领。
   */
  const outcome = ref<Outcome | null>(null)

  /**
   * 本会话此刻握着的锁 → 各自的被接管回调。
   *
   * ⚠ **按 scope 一把一槽,不是单槽。** 旧版是 `let onEvicted` 单槽 + scope/mode 单槽:
   *   同一标签页第二个屏进编辑态时,setMode('edit', held) 把第一个屏的锁**顶出心跳** ——
   *   服务端 3 分钟后当它陈旧,别人 acquire 直接拿走,且那条路不写 eviction,两边零提示。
   *   而「同时两个页面在编辑态」是明写的设计(auth.ts「同时两个页面在编辑态是常态」)。
   *   现在 ping 带全量 editScopes、服务端逐把续;通知按 scope 派回它自己的回调,
   *   不再谁后注册谁赢 —— 旧版连别把锁的通知都会派给唯一那个回调。
   */
  // ⚠ 值是 **Set,不是单个回调**(2026-08-30 复查):出账链四屏共一把 billing-chain 锁,
  //   催缴单编辑态里打开系数簿再进编辑 = 两个 useEditLock 实例握同名 scope。
  //   单值时后来的覆盖先来的,任一方退出就把共用的续期整个摘掉 ——
  //   宿主屏的锁静默停续,别人的「张三 编辑中」当场消失,3 分钟后锁被直接拿走。
  //   值再进一层 Map:回调 → **登记时的 ping 代次**。响应只派给「发拍之前就登记着」的回调 ——
  //   没有代次时,迟到的响应会把锁空窗期推导出的「锁没了」砸在**响应发出之后**才合法拿到
  //   新锁的回调上:刚进的编辑态 3 秒内再次被踢,而服务端那把新锁是活的、再无人续也无人还,
  //   别人 acquire 要被这把幽灵锁挡满 3 分钟(2026-08-30 第三轮复查坐实)。
  const editCallbacks = new Map<string, Map<(e: Eviction) => void, number>>()
  /** ping 发拍代次。holdLock 记下登记时的值,响应按它分辨新旧回调。 */
  let pingSeq = 0

  /**
   * 拿到一把锁:登记续期 + 被接管回调。
   *
   * ⚠ **不立刻发一拍**(原 setMode 的理由,原样成立):立刻发会让「你被接管了」在 acquire()
   *   还没返回时就送达,exit() 跑在 enter() 里那句 `editMode = true` 之前、被它盖掉 ——
   *   表现为「刚拿到锁就被接管,人却照样进了编辑模式」。
   *   续锁也不需要立刻:刚占的锁有整整 3 分钟,下一拍(≤20 秒)绰绰有余。
   */
  function holdLock(sc: string, onEvicted: (e: Eviction) => void) {
    const m = editCallbacks.get(sc) ?? new Map()
    m.set(onEvicted, pingSeq)          // 登记在第 pingSeq 拍之后 —— 更早的拍与我无关
    editCallbacks.set(sc, m)
    lastActivityAt = Date.now()
    ensureTimer()
  }
  /**
   * 还了一把锁:只摘**自己的登记**,返回同名 scope 还剩几个登记者。
   * 返回值给 useEditLock 判「服务端的锁能不能真的还」—— 共占的屏还有人在编辑时,
   * DELETE 发出去等于替别人还锁(服务端只认 user 不认屏)。
   */
  function dropLock(sc: string, onEvicted: (e: Eviction) => void): number {
    const m = editCallbacks.get(sc)
    if (!m) return 0
    m.delete(onEvicted)
    if (!m.size) editCallbacks.delete(sc)
    return m.size
  }

  /**
   * 本标签页此刻在不在某个锁根底下持锁 —— 「预览页签被顶掉要不要吭声」只看这个。
   *
   * 不查 `users` 里的座位:`mode` 是服务端字段(慢一拍),`self` 又是按 user 比对不按 sid ——
   * 同一个人开两个标签页,两条座位都是 self,拿它判「我这一页在编辑」会串台。
   * `editCallbacks` 是客户端持锁的真源(holdLock / dropLock 的落点),即时且只属于本页。
   */
  function holdsEditUnder(prefix: string | string[] | undefined): boolean {
    if (!prefix) return false
    const ps = Array.isArray(prefix) ? prefix : [prefix]
    for (const sc of editCallbacks.keys())
      // 边界与 editorsUnder 逐字同规则:`utilities:1` 是 `utilities` 底下的,`utilities13` 不是
      if (ps.some(p => sc === p || sc.startsWith(p + ':') || sc.startsWith(p + '-'))) return true
    return false
  }

  /** 键鼠活动。**不能用「最后一次写请求」代替** —— 用户在表格里录了 10 分钟还没点保存，那不是空闲。 */
  function touch() { lastActivityAt = Date.now() }

  /**
   * 进了某一屏（浏览态）。label 是给人看的一句话。
   *
   * scope 无条件跟着屏走 —— 它现在**只是**「在哪一屏」。旧版编辑态下不许动它,
   * 因为它兼任锁的续期键;续期改走 editScopes 之后那层顾虑不存在了,
   * 顶栏那句「在哪一屏」也终于在编辑态下跟得上人。
   */
  function enter(s: string | null, l: string | null) {
    label = l
    scope = s
    ensureTimer()
    // ⚠ **每次换屏都补一拍**，不能交给 ensureTimer —— 它在轮询已跑时会直接返回，
    //   于是第一次之后就再也不立刻发了：你切到别的页面，自己的「在哪一屏」和别人的名单
    //   都要等最多 20 秒才对得上，用起来就像「要刷新页面才更新」。
    void ping()
  }

  async function ping() {
    try {
      const myGen = ++pingSeq
      const editScopes = [...editCallbacks.keys()]
      const r = await api.put<{
        users: Seat[]; evictions: Eviction[] | null
        approvals: Pending[]; outcome: Outcome | null
      }>('/presence/ping', { sid, scope, label, lastActivityAt, editScopes })
      users.value = r?.users ?? []
      approvals.value = r?.approvals ?? []
      // 通知按 scope 派回**它自己的每一个**登记者(同名 scope 可能有多个屏,都得退)。
      // 拍快照再迭代:回调里会 dropLock,原地迭代会漏。
      // ⚠ 只派给「发拍之前就登记着」的(since < myGen):这拍发出之后才登记的回调,
      //   握的是一把比这拍**新**的锁 —— 拍里推导出的失锁与它无关,派了就是误杀。
      for (const e of r?.evictions ?? []) {
        for (const [fn, since] of [...(editCallbacks.get(e.scope) ?? [])]) {
          if (since < myGen) fn(e)
        }
      }
      if (r?.outcome) outcome.value = r.outcome
    } catch {
      // 抖一下不算数,下一拍再说。服务端 60 秒才判离线 = 3 拍容错。
    }
  }

  /**
   * 保证轮询在跑。**只管定时器，不发拍** —— 要不要立刻发由调用方决定：
   *   · 换屏 `enter()` 要发（名单立刻对上）
   *   · 拿到锁 `setMode('edit')` **不能发**：那一拍会让「你被接管了」在 acquire() 返回前送达，
   *     于是 exit() 跑在 `editMode = true` 之前被它盖掉（刚拿到锁就被接管、人却照样进了编辑模式）。
   */
  function ensureTimer() {
    if (timer) return
    timer = setInterval(() => void ping(), PING_MS)
  }

  /**
   * 关浏览器 / 关标签页时**主动销号**。
   *
   * 不做的话:卸载路径上只还了锁,座位却要挂满 PRESENCE_TTL=60 秒 ——
   * 而别人的「XX 编辑中」按钮和侧栏红点读的都是**座位**,不是锁。
   * 于是出现用户 2026-08-26 实测的那个自相矛盾的状态:
   * 「按钮显示 admin 在编辑中,但是又能打开编辑模式,并且过了很久才更新下线」
   * —— 锁没了(所以进得去),座位还在(所以还显示他)。两个登记只拆了一个。
   *
   * ⚠ 必须 fetch keepalive:卸载路径上普通 XHR 会被浏览器连同页面一起掐掉。
   *   不用 sendBeacon —— 它带不了自定义头,令牌只能塞查询串,而查询串会进 nginx
   *   访问日志、也会随 Referer 外泄(同 api/locks.ts releaseOnUnload 的理由)。
   *
   * ⚠ 挂 pagehide:beforeunload 会被「未保存」二次确认拦住并可能被取消,
   *   那时页面还活着,销号就销错了。
   */
  function leaveOnUnload() {
    const t = readToken()
    if (!t) return
    void fetch(`/api/presence/${sid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
      keepalive: true,
    }).catch(() => { /* 兜底:60 秒 TTL */ })
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', leaveOnUnload)

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    users.value = []
    // 主动销号:不发的话他会在别人的头像组里多挂 60 秒
    api.delete(`/presence/${sid}`).catch(() => { /* TTL 兜底 */ })
  }

  return { sid, users, others, approvals, outcome, editorsByScope, editorsUnder, editingNote, holdsEditUnder, enter, holdLock, dropLock, touch, stop, ping }
})
