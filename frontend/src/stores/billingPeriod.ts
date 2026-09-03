// 出账链的**组级账期**(2026-08-28 设计稿 §3.1 / §⑤,2026-08-29 拍板「只记会话内」)。
//
// 计费参数 → 园区抄表 → 公共电核算 → 楼栋损耗 → 催缴单 是同一个月的五道工序,
// `lockScopes.ts` 早把这件事钉死了:前四屏共占一把 `billing-chain:{年}-{月}` 月锁。
// 但改造前五屏各存各的 year/month —— 用户在抄表停在 3 月、切到催缴单看到 9 月,两屏都不提示,
// 而它们抢的是同一把锁。期存在这里,那种不一致在结构上不再可能。
//
// ⚠ 为什么必须是 store 而不是屏内 ref:侧栏点击走 `tabs.openFresh()` → epoch 递增 →
//   `App.vue` 的 KeepAlive key(`value:epoch`)变 → 组件**全新重建走 onMounted**。
//   期若是屏内 ref,每次点侧栏都被清掉、每次都撞选期矩阵,正是用户担心的
//   「我想随意打开某个表来看怎么办」。
//
// ⚠ 只记会话内:不写 localStorage、不同步进 URL。刷新 / 重开浏览器过一次矩阵是**有意**的 ——
//   隔天回来重新确认一次期,成本一次点击;换来的是「永远不会停在三个月前的月还以为是最新」。
//   既有的屏间深链(`/params?ym=...` 那四处)走 adoptYm 认领,见下。
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { metersApi } from '@/api/meters'
import { allocApi } from '@/api/alloc'
import { billNoticesApi } from '@/api/billNotices'
import { paramsApi } from '@/api/params'

/** 一个出账月的进度。四道工序 + 一个月级的「上游改过」。 */
export interface ChainCell {
  meters: boolean    // 有读数
  pool: boolean      // 有池快照
  loss: boolean      // 有损耗快照
  notices: boolean   // 有催缴单
  /** 参数改动晚于快照 —— 屏上数字是旧的。**月的属性,不是某一道工序的**。 */
  stale: boolean
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const pad2 = (n: number) => String(n).padStart(2, '0')
const EMPTY: ChainCell = Object.freeze({
  meters: false, pool: false, loss: false, notices: false, stale: false,
})

export const useBillingPeriodStore = defineStore('billingPeriod', () => {
  // ── 期(会话内) ───────────────────────────────────────────
  const year = ref<number | null>(null)
  const month = ref<number | null>(null)
  const picked = computed(() => year.value != null && month.value != null)
  const ym = computed(() => (picked.value ? `${year.value}-${pad2(month.value!)}` : null))

  function pick(y: number, m: number) {
    year.value = y
    month.value = m
  }
  /** 「换出账月」—— 回到选期矩阵。 */
  function clear() {
    year.value = null
    month.value = null
  }
  /**
   * 「只在还没有期时认领」—— 已经选好期的人不该被一条链接顶到别的月去。
   * 2026-09-03 起显式深链(?p= / 旧 ?ym=)走 composables/useDeepPeriod(会覆盖已选期,D2);
   * 本函数只剩一个调用方:分析层「去改常数」的 adopt=YYYY-12(ParamCenterView.applyHandoff)——那不是选月。
   */
  function adoptYm(v: string | null | undefined) {
    if (picked.value || !v || !YM.test(v)) return
    pick(+v.slice(0, 4), +v.slice(5, 7))
  }

  // ── 矩阵格子(五屏共读一份) ───────────────────────────────
  const cells = ref<Map<string, ChainCell>>(new Map())
  const loaded = ref(false)
  const loadErr = ref<string | null>(null)
  let inflight: Promise<void> | null = null

  const cellOf = (m: string): ChainCell => cells.value.get(m) ?? EMPTY

  /** 四个来源出现过的年,升序去重。连续补满由视图层 utils/matrixYears 负责。 */
  const dataYears = computed(() =>
    [...new Set([...cells.value.keys()].map(m => +m.slice(0, 4)))].sort((a, b) => a - b))

  async function fetchAll() {
    loadErr.value = null
    let map: Map<string, ChainCell>
    try {
      // 四个 /months 端点互不依赖 → 并发,一个往返取齐。全是 'YYYY-MM' 升序全集。
      const [meters, pool, loss, notices] = await Promise.all([
        metersApi.months(), allocApi.poolMonths(), allocApi.lossMonths(), billNoticesApi.months(),
      ])
      map = new Map()
      const mark = (ms: readonly string[], k: 'meters' | 'pool' | 'loss' | 'notices') => {
        for (const m of ms) {
          if (!YM.test(m)) continue   // 脏数据不进矩阵,免得多出一列没人认识的月
          const c = map.get(m) ?? { ...EMPTY }
          c[k] = true
          map.set(m, c)
        }
      }
      mark(meters, 'meters'); mark(pool, 'pool'); mark(loss, 'loss'); mark(notices, 'notices')
    } catch (e) {
      // 半张矩阵比没有矩阵更坏:缺的那一列会被读成「这些月没做过」。宁可整屏说加载失败。
      loadErr.value = (e as { message?: string })?.message ?? '出账月数据加载失败'
      loaded.value = false
      return
    }

    // stale 全集只要**一次** status:后端的 otherMonthsAffected 就是「其它已生成月里同样过期的账期」
    // (ParamService.status 遍历 alloc_pool_result 的 distinct ym 逐月判 snap.stale)。
    // 拿最新一个有数据的月去问,回包里 self + others 合起来即全集。
    // ⚠ 已知边界:others 只遍历有池快照的月,只有催缴单没有池快照的月不会出现在里面。
    //   那种月本身就不该有「快照过期」的说法(没有池快照可过期),不补。
    const latest = [...map.keys()].sort().pop()
    if (latest) {
      try {
        const st = await paramsApi.status(latest)
        const stale = new Set(st.otherMonthsAffected ?? [])
        if (st.stale) stale.add(latest)
        for (const m of stale) {
          const c = map.get(m)
          if (c) c.stale = true
        }
      } catch { /* stale 拉不到不阻断:四个工序点照常,只是这一屏暂时不标「需重算」 */ }
    }

    cells.value = map
    loaded.value = true
  }

  /** 进屏调用。已经加载过就直接返回 —— 五屏切来切去不重复打网络。 */
  async function loadChain(): Promise<void> {
    if (loaded.value) return
    inflight ??= fetchAll().finally(() => { inflight = null })
    return inflight
  }

  /** 写操作之后(生成本月 / 重算 / 保存读数)强制重取,矩阵立刻反映。 */
  async function reloadChain(): Promise<void> {
    loaded.value = false
    inflight = null
    return loadChain()
  }

  return {
    year, month, picked, ym, pick, clear, adoptYm,
    cells, cellOf, dataYears, loaded, loadErr, loadChain, reloadChain,
  }
})
