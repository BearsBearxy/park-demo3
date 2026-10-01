// src/stores/bell.ts — 顶栏铃铛的状态(PAGE-BEHAVIOR-SPEC §5.1 / §5.3,画布 06-F / 06-G)。
//
// 记号两种,只挂在铃铛上:
//   · 红数字 = 等你处理的件数(授权请求 + 待审的表 + 被退回的表,三个数都由服务端算、顺心跳来)。
//     事情办完才减,**打开铃铛不减**。
//   · 蓝点   = 没有要动手的,只有没看过的结果或更新。打开铃铛就灭。两种都有时只显示红数字。
// 「看过」记在服务端(有结果了 → noticesApi.seen;系统类 → noticesApi.markSystemSeen),
// 蓝点才跨标签页 / 跨电脑一致(06-G 末行);服务端读写失败时退回按账号记的 localStorage。
import { defineStore } from 'pinia'
import { computed, ref, watch, type Ref } from 'vue'
import { usePresenceStore } from '@/stores/presence'
import { useUpdateStore } from '@/stores/update'
import { useAuthStore } from '@/stores/auth'
import { noticesApi, type Notice } from '@/api/notices'
import { reviewApi, type ReturnedItem } from '@/api/review'
import type { PendingItem } from '@/types/review'
import { cmpVersion } from '@/changelog'

const sysKeyOf = (who: string) => `fp-bell-sys:${who}`
const parts = (k: string | null | undefined) => (k ? k.split('|') : [])
function lsGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* 隐私模式 / 配额满:只是少一层兜底 */ }
}

/**
 * 面板的一份明细:独立错误槽 + seq 竞态守卫,错误只在成功分支清(房内失败态定型写法)。
 * has() 为假(心跳说没有)时不打请求,直接清空 —— 待审明细只有审核员取得到,没有就别去问。
 * loaded = 取回来过一次(成功或失败都算):没取回来之前空清单不等于「没有」,面板不能据此说「现在没有通知」。
 */
function source<T>(fetch: () => Promise<T[]>, has: () => boolean) {
  const list = ref([]) as Ref<T[]>
  const err = ref<string | null>(null)
  const loaded = ref(false)
  let seq = 0
  async function load() {
    const my = ++seq
    if (!has()) { list.value = []; err.value = null; loaded.value = true; return }
    try {
      const r = await fetch()
      if (my !== seq) return
      list.value = r ?? []
      err.value = null
      loaded.value = true
    } catch (e) {
      if (my !== seq) return
      err.value = (e as { message?: string })?.message || '没取到'
      loaded.value = true
    }
  }
  return { list, err, loaded, load }
}

export const useBellStore = defineStore('bell', () => {
  const presence = usePresenceStore()
  const update = useUpdateStore()
  const auth = useAuthStore()

  // ── 红数字:等你处理 ──
  const red = computed(() => presence.approvals.length + presence.pendingReviews + presence.myReturned)

  // ── 系统组 ──
  /** 服务器换了新版:系统组「已更新到 v…」一行,刷新才消失。没有为 null。 */
  const newVersion = computed(() => (update.hasNewVersion ? update.serverVersion : null))
  /** 更新记录没看过:系统组「v… 更新了什么」一行。本机看过(update.seen)或别处看过(服务端记的版本)都算看过。 */
  const changelogUnread = computed(() => {
    const s = presence.systemSeen?.changelogVersion
    return update.unread && !(s && cmpVersion(s, update.version) >= 0)
  })
  /** 系统组此刻的内容键,一项一段。蓝点只问「有没有上次开铃铛时没有的段」—— 某项消失不算新。 */
  const sysKey = computed(() =>
    [newVersion.value && `n:${newVersion.value}`, changelogUnread.value && `c:${update.version}`].filter(Boolean).join('|'))
  /** 本机记的上次开铃铛时的系统组键。服务端那份随心跳来(presence.systemSeen.bellKey),两份任一记过就算看过。 */
  const localSysSeen = ref<string | null>(null)
  const sysSeen = () => new Set([...parts(presence.systemSeen?.bellKey), ...parts(localSysSeen.value)])
  const sysNew = computed(() => {
    const seen = sysSeen()
    return parts(sysKey.value).some((p) => !seen.has(p))
  })
  /**
   * 这次打开之前就看过的系统段。面板据此把它们画灰(06-F 系统组:上次开铃铛时就在的「v… 更新了什么」是灰的,
   * 新来的「已更新到 v…」不灰)。要在 openPanel 记看过**之前**拍下来,记完就全是看过了。
   */
  const sysSeenAtOpen = ref<string[]>([])
  const newVersionRead = computed(() => !!newVersion.value && sysSeenAtOpen.value.includes(`n:${newVersion.value}`))
  const changelogRead = computed(() => changelogUnread.value && sysSeenAtOpen.value.includes(`c:${update.version}`))

  /**
   * 刚开过铃铛、服务端的「看过」还没随心跳回来的那几秒:有结果了的蓝点先按看过算。
   * 不这样的话,开铃铛前已发出的那一拍会带回旧的未读数,蓝点在面板旁边又亮 3 秒。
   */
  const resultsAck = ref(false)
  const blue = computed(() => red.value === 0 && ((presence.unseenResults > 0 && !resultsAck.value) || sysNew.value))

  /** 记号上的字:'4' / '99+';没有红数字为 null(0 不写)。 */
  const markText = computed(() => (red.value > 99 ? '99+' : red.value > 0 ? String(red.value) : null))
  /** 铃铛按钮的名字,读屏读它;记号本身 aria-hidden。 */
  const ariaLabel = computed(() =>
    red.value > 0 ? `通知，${red.value} 件等你处理` : blue.value ? '通知，有新消息' : '通知')

  // ── 面板 ──
  const open = ref(false)
  const reviews = source<PendingItem>(() => reviewApi.pending(), () => presence.pendingReviews > 0)
  const returned = source<ReturnedItem>(() => reviewApi.returned(), () => presence.myReturned > 0)
  const notices = source<Notice>(() => noticesApi.list(), () => true)

  // 面板开着时心跳里的数变了(别人审了 / 我重新交了)→ 明细跟着重取,别让组头的数和行数两句话打架
  watch(() => presence.pendingReviews, () => { if (open.value) void reviews.load() })
  watch(() => presence.myReturned, () => { if (open.value) void returned.load() })

  // 换账号:上一个人的「看过」和明细都不能留给下一个人
  watch(() => auth.me, (who) => {
    localSysSeen.value = who ? lsGet(sysKeyOf(who)) : null
    open.value = false
    reviews.list.value = []; returned.list.value = []; notices.list.value = []
    notices.loaded.value = false
  }, { immediate: true })

  // 更新记录看过(✦、「本次更新」、面板「看看」都走 update.markSeen)→ 也记到服务端,换台电脑同样算看过
  watch(() => update.seen, (v) => {
    if (v && v === update.version && presence.systemSeen?.changelogVersion !== v)
      noticesApi.markSystemSeen({ changelogVersion: v }).catch(() => { /* 本机 localStorage 仍记着 */ })
  })

  /** 系统组记成看过:本机一份(失败兜底、也让这一下立刻灭),服务端一份(跨电脑)。 */
  function markSystemSeen() {
    const k = sysKey.value
    if (!k) return
    localSysSeen.value = k
    if (auth.me) lsSet(sysKeyOf(auth.me), k)
    if (presence.systemSeen?.bellKey !== k)
      noticesApi.markSystemSeen({ bellKey: k }).catch(() => { /* 本机那份兜底 */ })
  }

  /**
   * 打开铃铛:系统项记看过 → 取三份明细 → 有结果了标为看过。红数字不动。
   * 先取清单再标看过 —— 反过来清单里就全是已读,「上次打开之后新来的行」挂不上小蓝点。
   */
  async function openPanel() {
    if (open.value) return
    open.value = true
    resultsAck.value = true
    try {
      sysSeenAtOpen.value = [...sysSeen()]
      markSystemSeen()
      void reviews.load()
      void returned.load()
      await notices.load()
      // 清单没取到就不标:人没看见,不能算看过
      if (!notices.err.value) {
        try { await noticesApi.seen() } catch { /* 下次打开再标 */ }
      }
      await presence.ping()
    } finally {
      // 中途哪一步抛了也得复位:卡在 true 的话,之后再来的结果永远点不亮蓝点,要刷新页面才好
      resultsAck.value = false
    }
  }

  /** 关面板:本次新来的行上的小蓝点变灰(06-G「关掉面板后变灰」)。 */
  function closePanel() {
    open.value = false
    notices.list.value = notices.list.value.map((n) => (n.seen ? n : { ...n, seen: true }))
  }

  /** 面板底「全部标为已读」= 有结果了全置已读 + 更新记录标已看。新版本那行照旧刷新才消失。 */
  async function markAllRead() {
    notices.list.value = notices.list.value.map((n) => (n.seen ? n : { ...n, seen: true }))
    sysSeenAtOpen.value = parts(sysKey.value)
    update.markSeen()
    try { await noticesApi.seen() } catch { /* 下次打开再标 */ }
  }

  return {
    red, blue, markText, ariaLabel,
    newVersion, changelogUnread, newVersionRead, changelogRead,
    open, openPanel, closePanel, markAllRead,
    reviews: reviews.list, reviewsErr: reviews.err, loadReviews: reviews.load,
    returned: returned.list, returnedErr: returned.err, loadReturned: returned.load,
    notices: notices.list, noticesErr: notices.err, noticesLoaded: notices.loaded, loadNotices: notices.load,
  }
})
