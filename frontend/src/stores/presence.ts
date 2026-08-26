import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'
import type { Eviction } from '@/api/locks'

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
  const PING_MS = 20_000

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
      if (u.mode !== 'edit' || !u.scope) continue
      const list = m.get(u.scope) ?? []
      list.push(u)
      m.set(u.scope, list)
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
    return users.value.filter((u) =>
      u.mode === 'edit' && u.scope != null &&
      (u.scope === prefix || u.scope.startsWith(prefix + ':') || u.scope.startsWith(prefix + '-')))
  }

  // 我此刻在哪一屏。屏进来时登记，锁拿到时把 mode 翻成 edit。
  let scope: string | null = null
  let label: string | null = null
  let mode: 'view' | 'edit' = 'view'
  let lastActivityAt = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null

  /** 被接管的回调 —— 由 useEditLock 注册，ping 带回来时当场喊停。 */
  let onEvicted: ((e: Eviction) => void) | null = null
  function handleEviction(fn: ((e: Eviction) => void) | null) { onEvicted = fn }

  /** 键鼠活动。**不能用「最后一次写请求」代替** —— 用户在表格里录了 10 分钟还没点保存，那不是空闲。 */
  function touch() { lastActivityAt = Date.now() }

  /**
   * 进了某一屏（浏览态）。label 是给人看的一句话。
   *
   * ⚠ **编辑态下只换文案，不动 scope/mode。** EDIT-MODE-SPEC v3 允许编辑态跨页签存活
   *   （「切去别的页面核对一眼回来，编辑态全没了，等于逼人一口气改完」）。
   *   这里若把 scope 清成 null、mode 降回 view，锁就**停止续期** ——
   *   人还在编辑态里，3 分钟后锁自己掉，别人直接进得来。
   *   顶栏那句「在哪一屏」照常跟着走：锁归锁，他现在确实在看别的屏。
   */
  function enter(s: string | null, l: string | null) {
    label = l
    if (mode !== 'edit') { scope = s; mode = 'view' }
    ensureTimer()
    // ⚠ **每次换屏都补一拍**，不能交给 ensureTimer —— 它在轮询已跑时会直接返回，
    //   于是第一次之后就再也不立刻发了：你切到别的页面，自己的「在哪一屏」和别人的名单
    //   都要等最多 20 秒才对得上，用起来就像「要刷新页面才更新」。
    void ping()
  }

  /**
   * 拿到锁 / 还了锁。
   *
   * ⚠ **不立刻发一拍。** 立刻发会让「你被接管了」在 acquire() 还没返回时就送达，
   *   于是 exit() 跑在 enter() 里那句 `editMode = true` 之前、被它盖掉 ——
   *   表现为「刚拿到锁就被接管，人却照样进了编辑模式」。
   *   续锁也不需要立刻：刚占的锁有整整 3 分钟，下一拍（≤20 秒）绰绰有余。
   */
  function setMode(m: 'view' | 'edit', s?: string | null) {
    mode = m
    if (s !== undefined) scope = s
    if (m === 'edit') { lastActivityAt = Date.now(); ensureTimer() }
  }

  async function ping() {
    try {
      const r = await api.put<{ users: Seat[]; evicted: Eviction | null }>('/presence/ping',
        { sid, scope, label, mode, lastActivityAt })
      users.value = r?.users ?? []
      if (r?.evicted) onEvicted?.(r.evicted)
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

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    users.value = []
    // 主动销号:不发的话他会在别人的头像组里多挂 60 秒
    api.delete(`/presence/${sid}`).catch(() => { /* TTL 兜底 */ })
  }

  return { sid, users, others, editorsByScope, editorsUnder, enter, setMode, touch, handleEviction, stop, ping }
})
