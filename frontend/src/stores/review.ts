import { defineStore } from 'pinia'
import { ref } from 'vue'
import { reviewApi } from '@/api/review'
import { LOCKING, periodOfKey, reviewNoteOf, type ReviewRow } from '@/types/review'

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
 * ponytail: 没有 TTL。审核是低频动作,四个动作都会主动失效两道;别人在别的浏览器审的,
 *   靠 ping 的 pendingReviews 变化 + 进屏重取覆盖。要实时到秒再上 WebSocket。
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

  async function ensureYear(year: number | null): Promise<void> {
    if (year == null || byYear.value.has(year)) return
    let p = yearInflight.get(year)
    if (!p) {
      p = reviewApi
        .states(year)
        .then((rows) => { byYear.value = new Map(byYear.value).set(year, rows) })
        .catch(() => { /* 拉失败不挡编辑(D-R2-7);清单屏另有 failed 留痕 */ })
        .finally(() => { yearInflight.delete(year) })
      yearInflight.set(year, p)
    }
    return p
  }

  /** 清单道。只有本月出账屏调。 */
  async function ensure(period: string | null): Promise<void> {
    if (!period || byPeriod.value.has(period)) return
    let p = periodInflight.get(period)
    if (!p) {
      p = reviewApi
        .list(period)
        .then((rows) => {
          byPeriod.value = new Map(byPeriod.value).set(period, rows)
          const f = new Set(failed.value)
          f.delete(period)
          failed.value = f
        })
        .catch(() => { failed.value = new Set(failed.value).add(period) })
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

  function invalidate(period: string | null) {
    if (!period) return
    const m = new Map(byPeriod.value)
    m.delete(period)
    byPeriod.value = m
    periodInflight.delete(period)
    // 两道一起失效 —— 只失效一道的话,屏上清单已经翻成「已审核」而编辑按钮还画得出来。
    const y = yearOf(period)
    if (y != null) {
      const ym = new Map(byYear.value)
      ym.delete(y)
      byYear.value = ym
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
   * 四个动作做完一律失效当月**两道**并重取。
   * 不是「把这一行改掉就行」—— 通过一把键会改变下游键的 blockedBy,只改一行屏上就对不上。
   */
  async function act(fn: () => Promise<unknown>, key: string) {
    await fn()
    const p = periodOfKey(key)
    invalidate(p)
    await Promise.all([ensure(p), ensureYear(yearOf(p))])
  }

  const submit = (k: string) => act(() => reviewApi.submit(k), k)
  const approve = (k: string) => act(() => reviewApi.approve(k), k)
  const returnBack = (k: string, reason: string) => act(() => reviewApi.returnBack(k, reason), k)
  const withdraw = (k: string, reason: string) => act(() => reviewApi.withdraw(k, reason), k)

  return {
    byPeriod, byYear, failed,
    ensure, ensureYear, ensureFor, blockOf, lockedMonths,
    rowsOf, rowOf, isLoaded, isFailed, yearLoaded, invalidate,
    submit, approve, returnBack, withdraw,
  }
})
