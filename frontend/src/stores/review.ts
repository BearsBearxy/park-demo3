import { defineStore } from 'pinia'
import { ref } from 'vue'
import { reviewApi } from '@/api/review'
import { periodOfKey, type ReviewRow } from '@/types/review'

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
    ensure, rowsOf, rowOf, isLoaded, isFailed, invalidate,
    submit, approve, returnBack, withdraw,
  }
})
