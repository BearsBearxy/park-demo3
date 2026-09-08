import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { reviewApi } from '@/api/review'
import { usePresenceStore } from '@/stores/presence'
import { LOCKING, periodOfKey, reviewNoteOf, type ReviewRow, type ReviewStatus } from '@/types/review'

/**
 * 审核态(SIDEBAR-UX-REDESIGN §7.5)。**两条取数道,别混**:
 *
 *  · **闸道**(`states`,按年)—— 12 个编辑入口用。后端 `GET /api/review/states?year=` 只发
 *    已落库的行,不跑聚合、不算前置。按年取有两个理由:附表族本来就是年表屏(一屏 12 个月),
 *    而单月屏在屏内换月时也能命中同一份,不必每换一次月打一趟。
 *  · **清单道**(`board`,按月)—— 只有本月出账屏用。它要**全部**键(含派生 entered)与
 *    通过前置缺项,那两样只有 `GET /api/review?period=` 给得出,代价是内部跑一遍首页聚合。
 *
 * 混用的后果:拿闸道的数据当清单,会把「还没交审」显示成「这个月没有这张表」;
 * 拿清单道喂闸,会让 12 个屏的编辑入口挂在本仓最贵的端点之一上。
 *
 * 没有 TTL,靠三处主动失效:本人做完动作、切回本月出账屏、**别人审了**(2026-09-08 补,
 * 顺 presence 那条 3 秒心跳带回来的 `reviewRev`)。第三处原先只在这行注释里写着
 * 「靠 ping 的 pendingReviews 变化覆盖」,而那个 watcher 从来没接上 —— 写下预期然后
 * 没实现,比不写更坏:后面的人读到这句会以为它成立。
 */
export const useReviewStore = defineStore('review', () => {
  // ── 闸道:按年 ──────────────────────────────────────────────
  const byYear = ref<Map<number, ReviewRow[]>>(new Map())
  const yearInflight = new Map<number, Promise<void>>()

  // ── 清单道:按月 ────────────────────────────────────────────
  const byPeriod = ref<Map<string, ReviewRow[]>>(new Map())
  const periodInflight = new Map<string, Promise<void>>()
  /**
   * 拉失败的月。清单屏要能区分「这个月一条审核记录都没有」和「审核态没取到」——
   * 前者显「未交审」,后者显「—」,显反了就是对用户撒谎。
   */
  const failed = ref<Set<string>>(new Set())

  const yearOf = (period: string | null): number | null => (period ? +period.slice(0, 4) : null)

  // ── 过期标记(2026-09-08 修「屏在闪」) ────────────────────────────
  //
  // 改前 invalidate 是**立刻删**,删完再拉。那一个往返里 byPeriod 没有这个月,
  // rowsOf 回空数组 → 整张清单退成「—」、动作按钮整组从 DOM 消失 → 数据回来再画一遍。
  // 一行多把键时这个来回要走 N 次,屏上就是「一个一个变绿 + 不停闪」。
  //
  // 改成**旧值留着、只标过期**:下一次 ensure 看见过期就重拉,但在新数据到达之前
  // 屏上一直是旧值。这就是 stale-while-revalidate,不是什么新发明 —— 改前那个形状
  // 只是最好写的形状,不是对的形状。
  //
  // 顺带治好另外两处同源的毛病:
  //   · 切回本月出账屏(onReactivated 也调 invalidate)同样不再闪;
  //   · invalidate 会连整年的闸道一起失效,而别的 KeepAlive 页签没有重取者 ——
  //     改前它们屏上的「已审核」提示会被静默抹平成可编辑,现在旧值还在,不会。
  const staleP = ref<Set<string>>(new Set())
  const staleY = ref<Set<number>>(new Set())
  // 每次失效给这个键换一个号。在途的那趟请求回来时号对不上,说明它取的是失效前的数,
  // 直接丢掉 —— 不丢的话「失效 → 新请求」与「旧请求回包」赛跑,旧的赢了就把过期数据写了回去。
  const seqP = new Map<string, number>()
  const seqY = new Map<number, number>()

  async function ensureYear(year: number | null): Promise<void> {
    if (year == null) return
    if (byYear.value.has(year) && !staleY.value.has(year)) return
    let p = yearInflight.get(year)
    if (!p) {
      const my = seqY.get(year) ?? 0
      p = reviewApi
        .states(year)
        .then((rows) => {
          if ((seqY.get(year) ?? 0) !== my) return       // 期间被失效过,这份是旧的
          byYear.value = new Map(byYear.value).set(year, rows)
          const s = new Set(staleY.value); s.delete(year); staleY.value = s
        })
        .catch(() => { /* 拉失败不挡编辑(D-R2-7);旧值留着比退回「不知道」强 */ })
        .finally(() => { yearInflight.delete(year) })
      yearInflight.set(year, p)
    }
    return p
  }

  /** 清单道。只有本月出账屏调。 */
  async function ensure(period: string | null): Promise<void> {
    if (!period) return
    if (byPeriod.value.has(period) && !staleP.value.has(period)) return
    let p = periodInflight.get(period)
    if (!p) {
      const my = seqP.get(period) ?? 0
      p = reviewApi
        .list(period)
        .then((rows) => {
          if ((seqP.get(period) ?? 0) !== my) return     // 同上:失效前发出的回包,丢掉
          byPeriod.value = new Map(byPeriod.value).set(period, rows)
          const s = new Set(staleP.value); s.delete(period); staleP.value = s
          const f = new Set(failed.value); f.delete(period); failed.value = f
        })
        // 手上一份旧的都没有才算「取不到」——有旧值就接着显旧值,别退回「—」。
        .catch(() => { if (!byPeriod.value.has(period)) failed.value = new Set(failed.value).add(period) })
        .finally(() => { periodInflight.delete(period) })
      periodInflight.set(period, p)
    }
    return p
  }

  /** 清单道:某月全部键(含派生 entered)。 */
  function rowsOf(period: string | null): ReviewRow[] {
    return (period && byPeriod.value.get(period)) || []
  }

  /** 闸道:单键。没有这一行 = 派生「录入中」,回 null(调用方按未锁处理)。 */
  function rowOf(key: string | null): ReviewRow | null {
    if (!key) return null
    const y = yearOf(periodOfKey(key))
    return (y != null && byYear.value.get(y)?.find((r) => r.key === key)) || null
  }

  const isLoaded = (period: string | null): boolean => !!period && byPeriod.value.has(period)
  const isFailed = (period: string | null): boolean => !!period && failed.value.has(period)
  const yearLoaded = (year: number | null): boolean => year != null && byYear.value.has(year)

  /**
   * 闸道:单键此刻的审核态。**null = 还不知道**(键为空,或这一年的闸道数据还没到手)。
   *
   * 「库里没这一行 = 派生 entered」这条判据本仓一度有**五份**逐字相同的抄写:动作簇、
   * 工资矩阵、S10 矩阵、台账矩阵、三大报表矩阵。后端闸道只发已落库的行
   * (submitted/approved/returned),`entered` 是前端派生出来的 —— 派生规则五份必漂移,
   * 漂移的表现是同一个月在两张屏上一个显「未交审」一个显空白(METRIC-SOURCE-SPEC §1)。
   *
   * ⚠ 「还不知道」与「未交审」**必须分开**:两者在 rowOf 那里都是 null。合并的后果分两处:
   *   · 矩阵屏 —— 进屏那几百毫秒整张矩阵先刷成一片灰点再翻牌;
   *   · 动作簇 —— 会给一张**已审核**的表画一颗「交审」,点下去吃 409,用户以为界面坏了。
   *   所以拿不准就回 null,让调用方自己决定画不画,与 blockOf「拿不准不挡」同一条口径。
   */
  function statusOf(key: string | null): ReviewStatus | null {
    if (!key) return null
    if (!yearLoaded(yearOf(periodOfKey(key)))) return null
    return rowOf(key)?.status ?? 'entered'
  }

  /** 标过期,**不删值**。理由见上面「过期标记」那段。 */
  function invalidate(period: string | null) {
    if (!period) return
    staleP.value = new Set(staleP.value).add(period)
    seqP.set(period, (seqP.get(period) ?? 0) + 1)
    periodInflight.delete(period)
    // 两道一起失效 —— 只失效一道的话,屏上清单已经翻成「已审核」而编辑按钮还画得出来。
    const y = yearOf(period)
    if (y != null) {
      staleY.value = new Set(staleY.value).add(y)
      seqY.set(y, (seqY.get(y) ?? 0) + 1)
      yearInflight.delete(y)
    }
  }

  // ── 三条编辑闸共用的判据 ─────────────────────────────────────────
  // useEditMode / SchedHeader / LedgerWideTable 是本仓仅有的三个编辑入口,判据必须是同一份:
  // 各写一份必漂移,而漂移的表现是同一个状态在不同屏上给出不同答案。

  const asList = (keys: string | string[] | null | undefined): string[] =>
    keys == null ? [] : Array.isArray(keys) ? keys : [keys]

  /** 一屏可能压着不止一把键(公共电核算屏同时管 alloc 与 alloc-loss)。按键涉及的年各取一次。 */
  async function ensureFor(keys: string | string[] | null | undefined): Promise<void> {
    const years = asList(keys).map((k) => yearOf(periodOfKey(k))).filter((y): y is number => y != null)
    await Promise.all([...new Set(years)].map(ensureYear))
  }

  /**
   * 这一屏此刻挡不挡编辑。null = 不挡。
   *
   * 多键取**任一把锁着就锁**:公共电核算屏的池结果与损耗结果是 AllocService.generate(ym)
   * 同一次算出来的,只锁住一半等于放行。
   */
  function blockOf(keys: string | string[] | null | undefined): { note: string; tip: string } | null {
    const list = asList(keys)
    if (!list.length) return null
    // 拉失败 / 还没到 ⇒ **不挡**(R2 拍板 D-R2-7)。
    //
    // 这一条与旁边编辑锁的口径**故意相反**(useEditLock 那边是「拿不准就不进」)。两者性质不同:
    //   · 锁失灵 ⇒ 两人同改同保存,后保存的整片覆盖前一个,且**双方都提示保存成功** —— 静默丢数据,不可逆。
    //   · 审核态失灵 ⇒ 后端那道闸(R1 的 ReviewGuard)照样拦,用户拿到的是一句准话
    //     「2024-02 附表12 已审核(李审 03-05),撤销审核后才能修改」。最坏是白录一次,不是丢数据。
    // 拿「一次白录」去换「12 屏的编辑入口挂在一个可能抖的端点上」不划算。
    if (list.some((k) => !yearLoaded(yearOf(periodOfKey(k))))) return null
    for (const k of list) {
      const r = rowOf(k)
      if (r && LOCKING.includes(r.status)) return { note: reviewNoteOf(r)!, tip: '撤销审核需审核员' }
    }
    return null
  }

  /**
   * 年表屏(附6/7/8/11、附13/14)按月份行上锁(D18)用:这一年里锁着的月份号(1..12)。
   *
   * `kinds` 是这一屏管的 kind(附表7/8 一屏两个 kind);`scope` 只在附13/14 用得上。
   * 年份数据还没到手时回空集 —— 与 blockOf 同一条口径(拿不准不挡)。
   */
  function lockedMonths(year: number | null, kinds: string[], scope: string | null = null): Set<number> {
    const out = new Set<number>()
    if (year == null) return out
    for (const r of byYear.value.get(year) ?? []) {
      if (!kinds.includes(r.kind)) continue
      if (scope != null && r.scope !== scope) continue
      if (!LOCKING.includes(r.status)) continue
      const p = periodOfKey(r.key)
      if (p) out.add(+p.slice(5, 7))
    }
    return out
  }

  /**
   * 一批键做完**只收一次尾**:全部写完 → 失效当月两道 → 重取。
   *
   * 收尾不能省,也不能只改本行:通过一把键会改变下游键的 blockedBy,只改一行屏上就对不上。
   * 但改前是**每把键各收一次尾** —— 月度台账 6 个公司点一次「交审」要跑
   * 6 次写 + 6 次失效 + 12 次重取,还是排队的。屏上就是逐个变绿加满屏闪。
   *
   * 键按**顺序**写、碰到第一个失败就停:后面的接着做只会让人分不清哪几把成了
   * (原 runEach 的口径,搬进来的)。失败也要收尾 —— 前几把已经写进去了,
   * 不收尾屏上就停在动作前的样子,人会以为一把都没成。
   */
  async function batch(keys: string[], fn: (k: string) => Promise<unknown>) {
    if (!keys.length) return
    const p = periodOfKey(keys[0])
    try {
      for (const k of keys) await fn(k)
    } finally {
      invalidate(p)
      await Promise.all([ensure(p), ensureYear(yearOf(p))])
    }
  }

  /**
   * 把手上**已经取过**的都标过期并重取。别人审了之后走这条。
   *
   * 只刷已经取过的,不去猜别的月:手上有的正是屏上正在显示的,刷它才有意义。
   * 靠上面那套「旧值留着」,这一趟在屏上是无声的 —— 数据换了行才跟着变,不闪。
   */
  async function refreshHeld(): Promise<void> {
    const ps = [...byPeriod.value.keys()]
    const ys = [...byYear.value.keys()]
    ps.forEach(invalidate)                      // invalidate 顺带把该月所属的年也标了
    ys.forEach((y) => {
      staleY.value = new Set(staleY.value).add(y)
      seqY.set(y, (seqY.get(y) ?? 0) + 1)
      yearInflight.delete(y)
    })
    await Promise.all([...ps.map(ensure), ...ys.map(ensureYear)])
  }

  /**
   * 跨账号同步:别人交审 / 通过 / 退回 / 撤销之后,这屏也要跟着变。
   *
   * 顺的是 presence 那条 3 秒心跳(它本来就在跑,带回一个号)。改前这里什么都没有 ——
   * 顶栏铃铛的数字会跳,正下方的审核条还写「暂无待审」,同一块屏上两个数当场打架;
   * 而 12 个编辑屏的闸也不会跟着锁上,人能进编辑态改半天,存的时候才被后端 423 拦回来。
   *
   * 监听方向是 review → presence:presence 不认识 review(它只管在场与心跳),
   * 反过来接会让心跳那条通道长出一根伸向业务的线。presence 实例化没有副作用
   * (定时器在 enter() 里才起),所以这里取它是安全的。
   *
   * 首个非零值不触发:那是本会话第一拍拿到的基线,不是「有人审了」。
   */
  const presence = usePresenceStore()
  watch(() => presence.reviewRev, (now, before) => {
    if (!before || now === before) return
    void refreshHeld()
  })

  // 单键仍留一个入口:调用方大多数时候手上就一把键,让它自己包一层数组没意义。
  const submit = (k: string) => batch([k], (x) => reviewApi.submit(x))
  const approve = (k: string) => batch([k], (x) => reviewApi.approve(x))
  const returnBack = (k: string, reason: string) => batch([k], (x) => reviewApi.returnBack(x, reason))
  const withdraw = (k: string, reason: string) => batch([k], (x) => reviewApi.withdraw(x, reason))
  const recall = (k: string) => batch([k], (x) => reviewApi.recall(x))

  const submitAll = (ks: string[]) => batch(ks, (k) => reviewApi.submit(k))
  const approveAll = (ks: string[]) => batch(ks, (k) => reviewApi.approve(k))
  const returnAll = (ks: string[], reason: string) => batch(ks, (k) => reviewApi.returnBack(k, reason))
  const withdrawAll = (ks: string[], reason: string) => batch(ks, (k) => reviewApi.withdraw(k, reason))
  // 公共电核算屏一屏两把键(alloc + alloc-loss)是一起交的 —— 交得了就得撤得回来,
  // 否则那一屏交审之后只能撤一半,剩下的那把要去求审核员退回。
  const recallAll = (ks: string[]) => batch(ks, (k) => reviewApi.recall(k))

  return {
    byPeriod, byYear, failed,
    ensure, ensureYear, ensureFor, blockOf, lockedMonths,
    // ⚠ statusOf 漏在这张表外不会报错 —— 组件里拿到的是 undefined,一调就 TypeError,
    //    而 setup store 的这一步本仓漏过。加函数就把名字加进来。
    rowsOf, rowOf, statusOf, isLoaded, isFailed, yearLoaded, invalidate,
    submit, approve, returnBack, withdraw, recall,
    submitAll, approveAll, returnAll, withdrawAll, recallAll,
  }
})
