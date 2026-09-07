import { defineStore } from 'pinia'
import { ref } from 'vue'
import { reviewApi } from '@/api/review'
import { LOCKING, periodOfKey, reviewNoteOf, type ReviewRow } from '@/types/review'

/**
 * 审核态(SIDEBAR-UX-REDESIGN §7.5)。**按月一份**。
 *
 * 编辑闸要的是单键,但全月一趟(~20 键)比逐键 N 趟便宜,且切走再切回能命中缓存 ——
 * 而且 `GET /api/review` 本来就只有按月这一种形状。
 *
 * ponytail: 没有 TTL。审核是低频动作,四个动作都会主动失效当月;别人在别的浏览器审的,
 *   靠 ping 的 pendingReviews 变化 + 进屏重取覆盖。要实时到秒再上 WebSocket。
 */
export const useReviewStore = defineStore('review', () => {
  const byPeriod = ref<Map<string, ReviewRow[]>>(new Map())
  /** 同月并发去重 —— 一屏进来时编辑闸与清单可能同时要同一个月。 */
  const inflight = new Map<string, Promise<void>>()
  /**
   * 拉失败的月。屏上要能区分「这个月没有任何审核记录」和「不知道」——
   * 后者**不许**当成可编辑放行,否则一次网络抖动就等于把闸整个撤了。
   */
  const failed = ref<Set<string>>(new Set())

  async function ensure(period: string | null): Promise<void> {
    if (!period || byPeriod.value.has(period)) return
    let p = inflight.get(period)
    if (!p) {
      p = reviewApi
        .list(period)
        .then((rows) => {
          byPeriod.value = new Map(byPeriod.value).set(period, rows)
          const f = new Set(failed.value)
          f.delete(period)
          failed.value = f
        })
        .catch(() => {
          failed.value = new Set(failed.value).add(period)
        })
        .finally(() => {
          inflight.delete(period)
        })
      inflight.set(period, p)
    }
    return p
  }

  function rowsOf(period: string | null): ReviewRow[] {
    return (period && byPeriod.value.get(period)) || []
  }

  /** 单键。没有这一行 = 派生「录入中」,回 null(调用方按未锁处理)。 */
  function rowOf(key: string | null): ReviewRow | null {
    if (!key) return null
    return rowsOf(periodOfKey(key)).find((r) => r.key === key) ?? null
  }

  /** 这个月的数据到底有没有到。false 时编辑闸要**保守**(见 useEditMode)。 */
  const isLoaded = (period: string | null): boolean => !!period && byPeriod.value.has(period)
  const isFailed = (period: string | null): boolean => !!period && failed.value.has(period)

  // ── 三条编辑闸共用的判据 ─────────────────────────────────────────
  // useEditMode / SchedHeader / LedgerWideTable 是本仓仅有的三个编辑入口,判据必须是同一份:
  // 各写一份必漂移,而漂移的表现是同一个状态在不同屏上给出不同答案。

  const asList = (keys: string | string[] | null | undefined): string[] =>
    keys == null ? [] : Array.isArray(keys) ? keys : [keys]

  /** 一屏可能压着不止一把键(公共电核算屏同时管 alloc 与 alloc-loss)。按键涉及的月各取一次。 */
  async function ensureFor(keys: string | string[] | null | undefined): Promise<void> {
    const months = [...new Set(asList(keys).map(periodOfKey).filter(Boolean))] as string[]
    await Promise.all(months.map(ensure))
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
    //   · 锁失灵 ⇒ 两个人同改同保存,后保存的整片覆盖前一个,且**双方都提示保存成功** —— 静默丢数据,不可逆。
    //   · 审核态失灵 ⇒ 后端那道闸(R1 的 ReviewGuard)照样拦,用户拿到的是一句准话
    //     「2024-02 附表12 已审核(李审 03-05),撤销审核后才能修改」。最坏结果是白录一次,不是丢数据。
    // 而挡住的代价是实打实的:GET /api/review 内部要跑一遍首页聚合(十几条 count),
    // 是本仓较贵的端点之一;它一抖,12 个屏同时进不了编辑模式。
    // 拿「一次白录」去换「12 屏的可用性挂在一个贵端点上」不划算。
    if (list.some((k) => !isLoaded(periodOfKey(k)))) return null
    for (const k of list) {
      const r = rowOf(k)
      if (r && LOCKING.includes(r.status)) return { note: reviewNoteOf(r)!, tip: '撤销审核需审核员' }
    }
    return null
  }

  function invalidate(period: string | null) {
    if (!period) return
    const m = new Map(byPeriod.value)
    m.delete(period)
    byPeriod.value = m
    inflight.delete(period)
  }

  /**
   * 四个动作做完一律失效当月并重取。
   * 不是「把这一行改掉就行」—— 通过一把键会改变**下游键的 blockedBy**,只改一行屏上就对不上。
   */
  async function act(fn: () => Promise<unknown>, key: string) {
    await fn()
    const p = periodOfKey(key)
    invalidate(p)
    await ensure(p)
  }

  const submit = (k: string) => act(() => reviewApi.submit(k), k)
  const approve = (k: string) => act(() => reviewApi.approve(k), k)
  const returnBack = (k: string, reason: string) => act(() => reviewApi.returnBack(k, reason), k)
  const withdraw = (k: string, reason: string) => act(() => reviewApi.withdraw(k, reason), k)

  return {
    byPeriod, failed,
    ensure, ensureFor, blockOf, rowsOf, rowOf, isLoaded, isFailed, invalidate,
    submit, approve, returnBack, withdraw,
  }
})
