import { ref, computed } from 'vue'
import { locksApi, type LockHolder, type Eviction } from '@/api/locks'
import { usePresenceStore } from '@/stores/presence'

/**
 * 编辑锁的客户端一半（CONCURRENCY-SPEC §4）：占 / 续 / 还 / 被接管。
 *
 * **两个消费方**，所以必须抽出来：
 *   · `useEditMode` —— 台账等自持编辑态的屏
 *   · `SchedHeader` —— 附表族 7 屏共用的页头，它自己管权限门、不走 useEditMode
 * 抄两份的结果不是两份一样的锁，是其中一份先烂掉而没人发现。
 *
 * 谁进得来的判定全在服务端（PresenceStore，有单测钉死）。这里只负责：
 * 把答案接住、按 20 秒续、被接管时当场喊停。
 */
export function useEditLock(onEvicted?: () => void) {
  /** 这一期被谁占着。非空 = 刚才想进但被挡下了，页面据此开接管抽屉。 */
  const lockedBy = ref<LockHolder | null>(null)
  /** 被谁接管了。非空 = 当场弹提示。 */
  const evictedBy = ref<Eviction | null>(null)
  /** 当前握着的那把锁。释放要用它，不能进去再算一次 —— 期可能已经被用户切走了。 */
  const held = ref<string | null>(null)

  // ⚠ **这里没有第二条轮询。** 续锁挂在在场那条唯一的 ping 上（20 秒一拍）——
  // 分成两条的话编辑态每 20 秒发两个请求，而且两边的「最后一次活动」各记各的，
  // 空闲判定就会有两个不一致的答案，而它决定接管要不要叫主管。
  //
  // 服务端 3 分钟判心跳超时 = **9 拍的容错**，网络抖几下掉不了锁。后台标签页被浏览器
  // 节流到约 1 分钟一拍，仍在 3 分钟之内 —— 切页签、去开会都不掉锁（那一格由服务端的
  // 「空闲 20 分钟」独立计时器管，见 CONCURRENCY-SPEC §4.3）。
  const presence = usePresenceStore()

  /**
   * 这一期**此刻**正被谁编辑 —— 从在场那条 ping 直接推出来，不必先点一下撞门。
   *
   * 设计稿 C-2 画的就是「不点也显示 [张] 张三 编辑中」。只在 acquire 被拒之后才知道，
   * 等于让每个人都先去撞一次门；而「谁在哪个 scope 编辑」ping 早就带回来了。
   *
   * 排除自己：本人重入是放行的，把自己显示成「占用中」会让人以为进不去。
   * `lockedBy` 仍然保留 —— 它带着 heldMs / idleMs / idle（接管走哪条路要用），
   * 那几个数只有 acquire 被拒时服务端才算给我们。
   */
  function watchScope(scopeOf: () => string | null) {
    return computed(() => {
      const sc = scopeOf()
      if (!sc) return null
      const other = presence.editorsUnder(sc).find((e) => !e.self)
      if (!other) return null
      return lockedBy.value?.user === other.user
        ? lockedBy.value                       // 撞过门,有精确的时长与空闲判定
        : { user: other.user, displayName: other.displayName,
            heldMs: other.sinceMs, idleMs: other.idleMs, idle: false }
    })
  }

  // 键鼠事件刷新活动时间戳，随 ping 报上去。
  const ACTIVITY = ['keydown', 'mousedown', 'input', 'change'] as const
  const touch = () => presence.touch()
  const onUnload = () => { if (held.value) locksApi.releaseOnUnload(held.value) }

  /** 拿到锁返回 true；被别人占着返回 false 并填好 lockedBy。 */
  async function acquire(scope: string): Promise<boolean> {
    let r
    try {
      r = await locksApi.acquire(scope)
    } catch {
      // 拿不准就不进。网络抖一下就放两个人进同一期，正是这套机制要防的事。
      return false
    }
    if (!r.granted) { lockedBy.value = r.holder; return false }
    lockedBy.value = null
    held.value = scope
    start()
    return true
  }

  /** 还锁。不还的话下一个人要么等 3 分钟心跳超时，要么去走接管 —— 都是白受的摩擦。 */
  function release() {
    stop()
    lockedBy.value = null
    if (!held.value) return
    // 不 await：退出编辑不该被一个网络请求卡住，服务端超时兜得住。
    locksApi.release(held.value).catch(() => { /* 心跳超时兜底 */ })
    held.value = null
  }

  function start() {
    ACTIVITY.forEach((e) => window.addEventListener(e, touch, true))
    window.addEventListener('beforeunload', onUnload)
    presence.handleEviction((e) => {
      // 被接管：锁已经不是我们的了 —— 先清 held，免得 release() 再发一个注定无效的请求
      evictedBy.value = e
      held.value = null
      release()
      // 锁没了，编辑态也必须当场退 —— 让他继续改一个已经不归他的期，
      // 只会在他点保存时撞一个 403，而那时草稿已经又多了十几处。
      onEvicted?.()
    })
    presence.setMode('edit', held.value)
  }

  function stop() {
    ACTIVITY.forEach((e) => window.removeEventListener(e, touch, true))
    window.removeEventListener('beforeunload', onUnload)
    presence.handleEviction(null)
    presence.setMode('view')
  }

  return { lockedBy, evictedBy, held, acquire, release, watchScope }
}
