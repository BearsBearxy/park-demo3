import { ref, computed, watch, onUnmounted, getCurrentInstance } from 'vue'
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
export function useEditLock(onExit?: () => void, canEdit?: () => boolean) {
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
  /**
   * 关页面时还锁。**挂 pagehide,不挂 beforeunload。**
   *
   * beforeunload 现在会被「未保存,确定要离开吗」的二次确认拦住(auth store 那道),
   * 而它**可能被取消** —— 用户点「留在此页」。还锁要是挂在那儿,那一下已经发出去了:
   * 人留在编辑态,锁却没了,别人随时能进来盖掉他正在改的东西 —— 比不加确认框更糟。
   * pagehide 只在页面**真的要走**时才触发,正是该放释放动作的地方。
   */
  const onUnload = () => { if (held.value) locksApi.releaseOnUnload(held.value) }

  /** 在 presence 登记过续期的那把锁。stop() 要摘的就是它 —— 那时 held 可能已被清掉(被接管路径)。 */
  let registered: string | null = null

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
    window.addEventListener('pagehide', onUnload)
    // 防御:同一实例不还锁直接换 scope 重占(现有调用方都不会,但漏网一次就是一把幽灵续期)
    if (registered && registered !== held.value) presence.dropLock(registered)
    registered = held.value
    presence.holdLock(registered!, (e) => {
      // 被接管：锁已经不是我们的了 —— 先清 held，免得 release() 再发一个注定无效的请求
      evictedBy.value = e
      held.value = null
      release()
      // 锁没了，编辑态也必须当场退 —— 让他继续改一个已经不归他的期，
      // 只会在他点保存时撞一个 403，而那时草稿已经又多了十几处。
      onExit?.()
    })
  }

  function stop() {
    ACTIVITY.forEach((e) => window.removeEventListener(e, touch, true))
    window.removeEventListener('pagehide', onUnload)
    // 只摘自己这把 —— 旧版 setMode('view') 会把整个会话降回浏览态,
    // 别的屏正握着的锁当场停续、座位也不再显示「编辑中」。
    if (registered) { presence.dropLock(registered); registered = null }
  }

  /**
   * 铁律①(EDIT-MODE-SPEC v4)「进得了编辑模式 ⇒ 本页权限一定齐」的**兜底**。
   *
   * 两条路会走到这里:授权 30 分钟到期,或者用户点了横幅上的「结束授权」。
   * useEditMode 早就有这道守卫(它那份 `watch([editMode, missing])`),可它只管得住走它的
   * 那 19 屏 —— 系数簿 / 账册模板 / 附表页头 / 三大报表**都不走 useEditMode**,
   * 于是四处各自都没有。
   *
   * 漏掉的表现不是报错,是:授权结束了人还留在编辑态,**锁还被那条 3 秒 ping 一直续着** ——
   * 连 3 分钟心跳自愈都等不到,别人只能干等 20 分钟空闲、或者去走接管。
   * (用户 2026-08-26 实测:「张三退出系数簿编辑模式后,别的账号依旧保持编辑中,
   *  侧边栏也在红点显示」。)
   *
   * 放在这里 = 六个消费方一次到位。让每一处都记得写一遍的约定,迟早有一处忘掉。
   */
  if (canEdit) watch(canEdit, (ok) => { if (!ok && held.value) { release(); onExit?.() } })

  /**
   * 宿主卸载(路由切走 / v-if 撤掉 / 抽屉整个销毁)时锁自己还回去。
   * 同上:六个消费方里只有 useEditMode 记得写,其余四个都指望「宿主会把 edit 翻假」——
   * 宿主没翻的时候,那把锁就没人认领了。
   * 组件外调用(单测)时没有实例可挂,Vue 会 warn —— 与 useEditMode 同一套处理。
   */
  if (getCurrentInstance()) onUnmounted(() => release())

  return { lockedBy, evictedBy, held, acquire, release, watchScope }
}
