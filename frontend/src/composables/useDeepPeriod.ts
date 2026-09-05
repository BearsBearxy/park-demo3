// src/composables/useDeepPeriod.ts — 目标屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2)。
//
// 首次:**setup 期同步**跑一次。spec 写的是 onMounted;提前到 setup 是因为五屏的 watch(ym) 与 onMounted 取数
//   都在 setup 里注册 —— 期若晚于它们落定,参数屏会多拉一次;且 ?edit=1 / ?generate=1 的 toggleEdit 必须在期
//   落定之后(否则占到 billing-chain:0-00 的假锁,见 ParamCenterView.applyHandoff 的注释)。首跑不查 dirty:全新实例没有草稿。
// 再次:KeepAlive 切回(onReactivated,7 屏在用,天然跳过首次 activated)。
// 去重键 = route.fullPath(单测的 route 桩多半没有 fullPath,退回 query 序列化)。
// 三不动:parsePeriod 为 null / 与当前 (period, co) 相同 / 目标屏有未保存改动(dirty > 0 → 不切期,只在 note 里说)。
// 去重键在判断之前就记下 —— 被拒的地址在同一实例上不再重试(用户已经看过提示);下一次真的 apply 时 note 清空。
import { ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { parsePeriod, periodOf, type DeepPeriod } from '@/nav/deepLink'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { useTabsStore } from '@/stores/tabs'

export interface DeepPeriodOpts {
  /** 屏此刻的期与公司,用来判「与当前相同 → 不动」;p 用 periodOf 的形状,co 缺省视同 null */
  current: () => { p: string | null; co?: number | 'all' | string | null }
  apply: (t: DeepPeriod) => void
  /** 未保存改动数;不传 = 没有草稿态的屏 */
  dirty?: () => number
  /**
   * 写进页签上下文的期与公司名(spec §4.3)。不传就用 `current().p` ——
   * 传的理由只有两个:① 本屏有公司 / 期区维度(台账、三大报表、附10);
   * ② 本屏的 `current().p` 是为深链相等判造的、与用户看到的期不是一回事
   *    (三大报表矩阵态 `current.p` 是光秃秃一个年份,那是「只有年的链停在矩阵」的相等条件,
   *     不是用户选了期 —— 照抄进页签会写出「利润表 · 2025」而用户没点月格)。
   */
  ctx?: () => { p: string | null; coName?: string | null } | null
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
    // 侧栏点击自 P3 起是「恢复现场」,实例不再重建 —— 被 dirty 闸拒过的那条提示会跟着实例活下来,
    // 存完盘绕一圈回来还挂着一句已经不成立的话(改前 openFresh 连实例一起丢掉它)。
    if (!t) { note.value = ''; return }
    const want = periodOf(t.year, t.month)
    const cur = o.current()
    if (cur.p === want && (cur.co ?? null) === t.co) return
    const n = initial ? 0 : (o.dirty?.() ?? 0)
    if (n > 0) { note.value = `地址栏要求 ${want} 期，本期有 ${n} 处未保存`; return }
    note.value = ''
    o.apply(t)
  }
  run(true)
  onReactivated(() => run(false))

  // ── 把本屏的期寄存进页签上下文(spec §4.3) ─────────────────
  // 收在这里而不是散在 billingPeriod.pick / screenPeriod.pick / LedgerView / useFinStatementScreen
  // 四处:所有有期的屏本来就都经过这条路,而这里天然拿得到「我是哪个页签」(route.meta.value)
  // 与「期变了」的时机。深链落期与屏内自己换期走的是同一个 current(),两条路一起覆盖。
  // typeof 判是把 unknown 收窄给 TS 用的;运行时那道白名单在 tabs.setCtx 里(未知 value 不写)。
  const navValue = (route.meta as Record<string, unknown>)?.value
  if (typeof navValue === 'string' && navValue) {
    const tabs = useTabsStore()
    watch(
      () => (o.ctx ? o.ctx() : { p: o.current().p, coName: null }),
      (c) => { if (c) tabs.setCtx(navValue, { p: c.p ?? undefined, coName: c.coName ?? undefined }) },
      { immediate: true },
    )
  }

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
