// src/composables/useDeepPeriod.ts — 目标屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2)。
//
// 首次:**setup 期同步**跑一次。spec 写的是 onMounted;提前到 setup 是因为五屏的 watch(ym) 与 onMounted 取数
//   都在 setup 里注册 —— 期若晚于它们落定,参数屏会多拉一次;且 ?edit=1 / ?generate=1 的 toggleEdit 必须在期
//   落定之后(否则占到 billing-chain:0-00 的假锁,见 ParamCenterView.applyHandoff 的注释)。首跑不查 dirty:全新实例没有草稿。
// 再次:KeepAlive 切回(onReactivated,7 屏在用,天然跳过首次 activated)。
// 去重键 = route.fullPath(单测的 route 桩多半没有 fullPath,退回 query 序列化)。
// 三不动:parsePeriod 为 null / 与当前 (period, co) 相同 / 目标屏有未保存改动(dirty > 0 → 不切期,只在 note 里说)。
import { ref, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { parsePeriod, periodOf, type DeepPeriod } from '@/nav/deepLink'
import { useBillingPeriodStore } from '@/stores/billingPeriod'

export interface DeepPeriodOpts {
  /** 屏此刻的期与公司,用来判「与当前相同 → 不动」;p 用 periodOf 的形状,co 缺省视同 null */
  current: () => { p: string | null; co?: number | 'all' | string | null }
  apply: (t: DeepPeriod) => void
  /** 未保存改动数;不传 = 没有草稿态的屏 */
  dirty?: () => number
}

export function useDeepPeriod(o: DeepPeriodOpts): { note: Ref<string> } {
  const route = useRoute()
  const note = ref('')
  let applied = ''
  function run(initial: boolean) {
    const key = route.fullPath ?? JSON.stringify(route.query)
    if (key === applied) return
    applied = key
    const t = parsePeriod(route.query as Record<string, unknown>)
    if (!t) return
    const want = periodOf(t.year, t.month)
    const cur = o.current()
    if (cur.p === want && (cur.co ?? null) === t.co) return
    const n = initial ? 0 : (o.dirty?.() ?? 0)
    if (n > 0) { note.value = `地址栏要求 ${want} 期，本期有 ${n} 处未保存`; return }
    o.apply(t)
  }
  run(true)
  onReactivated(() => run(false))
  return { note }
}

/** 出账链五屏的接法:apply = billingPeriod.pick + 补 loadChain(ChainMonthGate 是它的唯一调用方,门被深链跳过就没人加载,P1 复查 F1);
 *  链屏没有公司维度,co 不看;只有年的链接不动(链屏只认整月)。 */
export function useChainDeepPeriod(dirty?: () => number): { note: Ref<string> } {
  const period = useBillingPeriodStore()
  return useDeepPeriod({
    current: () => ({ p: period.ym }),
    apply: (t) => {
      if (t.month == null) return
      period.pick(t.year, t.month)
      void period.loadChain().catch(() => {})
    },
    dirty,
  })
}
