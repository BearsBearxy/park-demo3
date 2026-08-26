import { ref, computed, watch, onDeactivated, onUnmounted, getCurrentInstance } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useEditLock } from '@/composables/useEditLock'

export interface EditModeOpts {
  /**
   * 本屏当前这一期的锁作用域（CONCURRENCY-SPEC §3.1），如 `ledger:3:2025-06`。
   *
   * 传函数而不是字符串：作用域跟着公司/年月变，进编辑态那一刻才算得准。
   * **不传（或返回 null）= 这一屏不上锁**，toggle 行为与加锁之前一个字不差 ——
   * P1 只铺台账 + 附表族，其余十几屏原样不动。
   */
  scope?: () => string | null
}

/**
 * 编辑模式 + 提权入口（EDIT-MODE-SPEC v3 / ELEVATION-SPEC）。
 *
 * 每个可编辑页面声明「这一页的编辑模式会碰到哪些权限」，其余全在这里。
 *
 * ── 点「编辑模式」会发生什么 ──
 *   权限齐全        → 直接进，不打扰
 *   缺任何一项      → **当场弹授权窗**（不是进去之后再提示 —— 用户拍板 2026-08-22）
 *   连提权都不能问  → 按钮根本不出现（只读账号 / 园区股东）
 *
 * ── 授权窗里两条路 ──
 *   [确认授权] → 主管当场输账号密码 → 补齐 → 进编辑模式
 *   [取消]     → **什么都没发生**，留在浏览态。
 *
 * 用户原话（2026-08-22）：「我说的不是如果没通过授权的话依旧是非编辑模式吗，
 * 现在重新生成，完成这些按钮不是进入编辑模式下的按钮吗」。
 * 上一版「取消 → 带着现有权限进编辑模式，缺的那几档锁着」到此作废。
 *
 * ── 由此推出的两条铁律 ──
 *
 * ① **进得了编辑模式 ⇒ 本页权限一定齐**。所以编辑态内不再存在「点不动的控件」，
 *    页面那层「点了转成授权请求」的包装（askPolicy / askMonthly 之流）请拆掉，
 *    控件在编辑态直接可用。页面里那条「本页有 N 项需要主管权限」的提示条也一并删掉
 *    （连 CSS）——它把整页内容顶下去一截（LAYOUT-STABILITY-SPEC §4），
 *    而这个信息授权弹窗已经给过一遍了。
 *
 *    代价写明：财务专员（有 billing-run 没 param-policy）要用公共电核算的
 *    「生成本月」，现在也得先请主管授权 param-policy 那一档。用户看过两个方案后
 *    选了这个 —— 宁可每月多叫一次主管，也不要「编辑态里一半控件是死的」。
 *
 * ② 授权有 30 分钟 TTL，到期那一刻用户可能**还在编辑模式里**。权限一旦不齐就
 *    自动退出编辑模式（见下面 watch([editMode, missing])），否则控件会突然集体
 *    点不动，正好绕回 ① 要根治的那个毛病。
 *
 * ⚠ **v3 改掉了 v2 的「切页签即回浏览态」**（2026-08-22 用户反馈）：
 *   专员切去别的页面核对一眼回来，编辑态和刚拿到的授权全没了，等于逼人一口气改完。
 *   现在切页签只关浮层，编辑态跟着页面实例留着（KeepAlive）。
 *   浮层仍必须关：抽屉/弹窗 Teleport 到 body，不随实例停用移出，会浮在别的页面上。
 *
 * 授权的作废点因此收敛成两个：**主动点「完成」** 和 **30 分钟到期**。切页面不作废。
 */
export function useEditMode(perms: string[], opts: EditModeOpts = {}) {
  const auth = useAuthStore()
  const meId = Symbol('edit-mode')

  /**
   * 编辑锁（CONCURRENCY-SPEC §4）。占 / 续 / 还 / 被接管的机制在 useEditLock，
   * 与附表族页头（SchedHeader）共用同一份。
   *
   * ⚠ 权限齐 ≠ 进得去。这是 P1 加的第二道闸 —— 在它之前，两个都有 entry:edit 的人
   *   同一秒进同一期，两边都成功，后保存的整片覆盖前一个，且两边都提示「保存成功」。
   */
  const lock = useEditLock(() => exit())
  const { lockedBy, evictedBy } = lock
  /** 这一期此刻被谁占着（不用点按钮就知道）。自己不算。 */
  const heldByOther = lock.watchScope(() => opts.scope?.() ?? null)

  const editMode = ref(false)
  // 用 watch 而不是在 toggle() 里加减：深链(?edit=1 / gotoDiff)会直接写 editMode.value = true，
  // 只在 toggle 里记的话那些路径进了编辑态却没登记，最后一个关掉时算不准。
  watch(editMode, (on) => {
    if (on) auth.openEditor(meId)
    else auth.closeEditor(meId)
  })
  /** 提权弹窗要补的权限点。非空即打开弹窗。 */
  const asking = ref<string[] | null>(null)

  /** 这一页里当前改不了的权限点（已提权的不算缺）。 */
  const missing = computed(() => perms.filter((p) => !auth.can(p)))
  // 至少能改一部分 —— 只剩「按钮画不画」这一个用途了（取消授权不再半途进编辑态），
  // 所以不再对外导出。
  const hasAny = computed(() => perms.some((p) => auth.can(p)))
  /** 编辑模式按钮画不画。 */
  const canEnter = computed(() => hasAny.value || auth.can('elevate:request'))

  async function toggle() {
    if (editMode.value) { exit(); return }
    // 缺任何一项就当场弹授权窗 —— 不进去之后再用提示条告诉他
    if (missing.value.length) { asking.value = [...missing.value]; return }
    await enter()
  }

  /**
   * 权限齐之后的第二道闸：占锁。
   *
   * 不上锁的屏（没传 scope）直接进，行为与加锁之前完全一致。
   */
  async function enter() {
    const scope = opts.scope?.() ?? null
    if (!scope) { editMode.value = true; return }   // 不上锁的屏，行为与加锁之前一个字不差
    if (await lock.acquire(scope)) editMode.value = true
  }

  /**
   * 关掉授权窗（用户点了取消，或点了窗外）。
   *
   * 取消 = 这次交互没发生过，留在浏览态。用户原话：
   * 「我说的不是如果没通过授权的话依旧是非编辑模式吗」。
   */
  function cancelAsk() {
    asking.value = null
  }

  /**
   * 主动弹授权窗。不传参数=把这一页缺的全要了（等价于 toggle 走的那条路）。
   *
   * ⚠ 铁律 ① 之后**只剩浏览态一个用途**：页面有自己的编辑按钮逻辑、不走 toggle()
   *   时用它（如抄表屏的 onEditBtn）。编辑态里已经不会有缺权限的控件，
   *   别再把控件包成 askFor(单个权限点) —— 只补一档而另一档还缺时，
   *   onElevated() 进编辑模式会被下面的守卫当场弹回来，用户那一下等于白点。
   */
  function askFor(...want: string[]) {
    const list = want.length ? want.filter((p) => !auth.can(p)) : [...missing.value]
    if (list.length) asking.value = list
  }

  /** 授权成功：权限已进 auth store，missing 自动变空。 */
  function onElevated() {
    asking.value = null
    editMode.value = true
  }

  /**
   * 退出编辑模式 —— 同时结束全部授权。
   * 「我编完了」就是编完了，不该留一个还能改口径的窗口在后台跑着。
   */
  function exit() {
    editMode.value = false
    asking.value = null
    lock.release()
    // ⚠ 必须**显式**出集合，不能指望上面那个 watch —— watch 默认 pre flush，
    //    要到下一个微任务才跑，而 endElevation() 就在下一行同步执行：
    //    那时集合里还躺着自己，size>0，守卫会让它不作为，授权永远结束不了。
    //    watch 留着是给深链那条路径用的（直接写 editMode.value = true）。
    auth.closeEditor(meId)
    // 还有别的页面在编辑态时 endElevation() 自己会不作为（守卫在 store 里）
    void auth.endElevation()
  }

  // 「在编辑模式里权限却不齐」这个状态一秒都不许存在(铁律 ①)。两条路会走到这里:
  //   · 授权 30 分钟到期 —— auth 每秒 tick nowMs,过期授权掉出 can(),missing 转非空
  //   · 深链(?edit=1 / ?generate=1)直接写 editMode.value = true,绕过了 toggle 的检查
  // 两条都由这一个守卫兜住,不必让 7 个页面各自记得。
  // 不会自激:exit() 把 editMode 置 false,再次触发时被 on 挡掉。
  watch([editMode, missing], ([on, m]) => { if (on && m.length) exit() })

  // 组件外调用(单测)时没有实例可挂,Vue 会 warn。这两个钩子是收尾动作,不是核心语义。
  if (getCurrentInstance()) {
    onDeactivated(() => { asking.value = null })
    // 页面实例被销毁(关标签页 / KeepAlive 淘汰)也要出集合,否则里面
    // 永远躺着一个死页面,size 再也回不到 0 —— 授权就再也不会自动结束了
    onUnmounted(() => {
      auth.closeEditor(meId)
      // 同理:实例没了还留着一个每 20 秒发一次的定时器,和一把没人认领的锁。
      lock.release()
    })
  }

  return { editMode, canEnter, missing, asking, lockedBy, evictedBy, heldByOther, toggle, askFor, cancelAsk, onElevated, exit }
}
