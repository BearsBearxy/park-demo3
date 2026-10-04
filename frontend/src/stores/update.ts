// src/stores/update.ts — 版本更新(VERSION-UPDATE-SPEC)。
// 管三件事:
//   ① 这个账号看没看过当前这一版 → 顶栏 ✦ 的蓝点;还有没看过的功能更新 → 自动弹「本次更新」(小调整不弹);
//   ② 服务器上是不是已经换了新版 → hasNewVersion,进铃铛「系统」一行(2026-09-30 改,原来是底部刷新提示条);
//   ③ 按需加载失败(发版后旧 hash 404,router/index.ts 的 onError)→ 底部提示条「这一页属于新版本」(只剩这一种)。
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { APP_VERSION, CHANGELOG, cmpVersion, isFeatureVersion, noteOf } from '@/changelog'
import { useAuthStore } from '@/stores/auth'
import { useAppConfigStore } from '@/stores/appConfig'

/** 轮询间隔。发版不是高频事件,5 分钟足够;切回标签页时还会额外问一次。 */
export const POLL_MS = 5 * 60 * 1000
/** 自动弹窗前的等待:首屏数据大多在这之内到齐,不让弹窗压在骨架上(SPEC §3)。 */
export const POPUP_DELAY_MS = 1200

const seenKey = (who: string) => `fp-seen-version:${who}`
const coachKey = (who: string) => `fp-update-coach:${who}`

export const useUpdateStore = defineStore('update', () => {
  const auth = useAuthStore()
  const appCfg = useAppConfigStore()

  /** 浏览器里正在跑的这一版(构建时注入)。 */
  const version = APP_VERSION
  /**
   * 这一版算不算数:客户园区只算装机那一版之后的(releaseBaseline,2026-10-05 用户拍板「按你建议修改」;
   * 我园是 0.0.0 = 全部)。部署配置没到之前一版都不算 —— 弹窗、铃铛「系统」里的更新提示、更新记录都不先闪出旧更新。
   */
  const counts = (v: string) => appCfg.releaseBaseline != null && cmpVersion(v, appCfg.releaseBaseline) > 0
  /** 更新记录里列的那几版。 */
  const notes = computed(() => CHANGELOG.filter((n) => counts(n.version)))
  /** 当前版本在 changelog 里的那一段。忘了写(或不算数)就是 undefined —— 此时不点蓝点(changelog.spec 第一条会先红)。 */
  const note = computed(() => (counts(version) ? noteOf(version) : undefined))

  // 已读版本按账号分开记(换个人登录要各弹各的)。读写都过 localStorage,
  // 因此换电脑、清浏览器数据会再弹一次最新版 —— 这是明知的代价,不为它建表。
  const seen = ref<string | null>(null)
  let lastWho: string | null = null
  /** 本次会话弹过没有(登录期间只弹一次,SPEC §3)。换账号时在 loadSeen 里清掉。 */
  let popped = false
  function loadSeen() {
    const who = auth.me
    seen.value = who ? localStorage.getItem(seenKey(who)) : null
    // 换了个人登录(退出后另一个账号进来,外壳重挂但 store 还是同一个):
    // 「本次会话弹过了」要跟着清,否则第二个人这一版永远看不到弹窗。
    if (who !== lastWho) { lastWho = who; popped = false }
  }
  loadSeen()

  /** 有没看过的更新:有这一版的更新内容,且这个账号没看过。**只管 ✦ 蓝点和更新记录里的「新」**,不管弹不弹。 */
  const unread = computed(() => !!auth.me && !!note.value && seen.value !== version)

  /**
   * 自动弹的那一段:到当前版本为止最新的一版**功能更新**(版本号最后一位是 0,RELEASE-NOTES-SPEC §7)。
   * 小调整(0.15.1)不弹,只亮蓝点;可要是这个账号连它之前那版功能更新(0.15.0)都没看过 ——
   * 比如那几天没登录 —— 照样弹 0.15.0,不能因为最新一版是小调整就把功能更新漏掉。
   */
  const popupNote = computed(() =>
    notes.value.find((n) => isFeatureVersion(n.version) && cmpVersion(n.version, version) <= 0))
  /** 要不要自动弹:有功能更新,且这个账号看过的版本比它旧(或从没看过)。 */
  const popupDue = computed(() => !!auth.me && !!popupNote.value
    && (!seen.value || cmpVersion(seen.value, popupNote.value.version) < 0))

  // ── 自动弹出 ──
  const popupOpen = ref(false)
  const historyOpen = ref(false)
  let popupTimer: ReturnType<typeof setTimeout> | undefined
  /** 外壳挂载时部署配置还没到:等它到了再判。哪一次 ensure 拉到的都算(外壳换屏重拉的那次也算)。 */
  let waitCfg = false

  /**
   * 首屏安顿下来之后判断要不要弹。**推迟 POPUP_DELAY_MS 再判**:
   * 这是「首屏数据到齐」的近似 —— 各屏自己的 loading 没有统一信号,与其造一个全站信号,
   * 不如等一等;等待期间用户若进了编辑态,到点仍然不弹。
   */
  function scheduleFirstPopup() {
    // 部署配置到了才判:客户园区只算装机之后的版本,先判就会弹出那之前的。
    // 第一次拉失败也不放弃:下面的 watch 等外壳换屏重拉成功时再判(我园 0.29.x 发版重启那几秒刷新的人照样弹)
    if (!appCfg.cfg) { waitCfg = true; void appCfg.ensure(); return }
    waitCfg = false
    if (popped || !popupDue.value) return
    clearTimeout(popupTimer)
    popupTimer = setTimeout(() => {
      // 编辑态不打断(auth.editing 读的是全站唯一那张编辑态登记表)
      if (popped || !popupDue.value || auth.editing) return
      popped = true
      popupOpen.value = true
    }, POPUP_DELAY_MS)
  }
  function cancelScheduledPopup() { clearTimeout(popupTimer); waitCfg = false }
  watch(() => appCfg.cfg, (c) => { if (c && waitCfg) scheduleFirstPopup() })

  /** 看过了:知道了 / × / 点遮罩 / Esc 四条路都走这里。 */
  function markSeen() {
    popupOpen.value = false
    const who = auth.me
    if (!who) return
    seen.value = version
    localStorage.setItem(seenKey(who), version)
  }

  /** 看完弹窗后在 ✦ 下方出现一次的入口提示:每个账号只出一次,4 秒后或点任意处收起。 */
  const coachOn = ref(false)
  let coachTimer: ReturnType<typeof setTimeout> | undefined
  let coachOff: (() => void) | undefined
  function showCoachOnce(ms = 4000) {
    const who = auth.me
    if (!who || localStorage.getItem(coachKey(who))) return
    localStorage.setItem(coachKey(who), '1')
    coachOn.value = true
    clearTimeout(coachTimer)
    coachTimer = setTimeout(hideCoach, ms)
    // 点屏幕任意处也收起 —— 它只是指个路,不该挡在人和下一次点击之间。
    // 捕获阶段挂,收起这一下不吃掉那次点击本身(点的若是 ✦,照常打开更新记录)。
    coachOff?.()
    const onDown = () => hideCoach()
    document.addEventListener('mousedown', onDown, true)
    coachOff = () => { document.removeEventListener('mousedown', onDown, true); coachOff = undefined }
  }
  function hideCoach() { clearTimeout(coachTimer); coachOff?.(); coachOn.value = false }

  /** 从哪儿开的「更新记录」:从「本次更新」进来的,手机上左上角给一个返回(SPEC §4)。 */
  const historyFromWhatsNew = ref(false)
  function openHistory(fromWhatsNew = false) {
    // 翻过更新记录 = 看过了。小调整版不弹,没有这一句它的蓝点就永远灭不掉(2026-09-19 复查)
    markSeen()
    historyFromWhatsNew.value = fromWhatsNew
    historyOpen.value = true
    hideCoach()
  }

  // ── 新版本 / 刷新提示条 ──
  /** 服务器上的版本(轮询 /version.json 得到);还没问到时为 null。 */
  const serverVersion = ref<string | null>(null)
  /** 服务器换了新版:铃铛「系统」出一行「已更新到 v… · 刷新」,刷新才消失,没有 ×(VERSION-UPDATE-SPEC §6)。 */
  const hasNewVersion = computed(() => !!serverVersion.value && serverVersion.value !== version)
  /** 有按需加载失败过 —— 那时已经能确定就是「这一页属于新版本」。 */
  const blocked = ref(false)

  /** 底部提示条只剩这一种:这一页打不开了,当场要说(06-E「当场出现」)。有新版不再走底部条。 */
  const barKind = computed<'blocked' | null>(() => (blocked.value ? 'blocked' : null))

  function reportBlocked() { blocked.value = true }
  function dismissBar() { blocked.value = false }

  /** 问一次服务器现在是哪个版本。拿不到(断网、404)就当没发生,不打扰。 */
  async function checkVersion() {
    try {
      const r = await fetch('/version.json', { cache: 'no-store' })
      if (!r.ok) return
      const v = (await r.json())?.version
      if (typeof v === 'string' && v) serverVersion.value = v
    } catch {
      /* 断网时轮询失败很正常,不上屏 */
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined
  let onVisible: (() => void) | undefined
  function startPolling() {
    if (timer) return
    timer = setInterval(checkVersion, POLL_MS)
    onVisible = () => { if (document.visibilityState === 'visible') checkVersion() }
    document.addEventListener('visibilitychange', onVisible)
  }
  function stopPolling() {
    clearInterval(timer); timer = undefined
    if (onVisible) document.removeEventListener('visibilitychange', onVisible)
    onVisible = undefined
    cancelScheduledPopup()
    hideCoach()
  }

  return {
    version, notes, note, seen, unread, popupNote, popupDue, loadSeen,
    popupOpen, historyOpen, historyFromWhatsNew, scheduleFirstPopup, cancelScheduledPopup, markSeen, openHistory,
    coachOn, showCoachOnce, hideCoach,
    serverVersion, hasNewVersion, blocked, barKind, reportBlocked, dismissBar, checkVersion, startPolling, stopPolling,
  }
})
