// 出账链的定义 —— 五道工序的顺序、屏名、以及从一个月的进度推出链路条状态。
// 顺序即业务时序（fpNav「出账链 · 应收派生」那一组，BILL-FORWARD 第 0 刀）。
// 屏名从 fpNav 取，不在这里写第二遍：链路条上的字与侧栏对不上，用户就不知道自己点到哪去了。
import { fpBuildRoutes } from '@/nav/fpNav'
import type { Step } from '@/components/fp/FPStepStrip.vue'
import type { ChainCell } from '@/stores/billingPeriod'

const ROUTES = fpBuildRoutes()

export const chainLabel = (v: string): string => ROUTES[v]?.page ?? v

/** 五道工序，顺序不可改 —— 前一道的产出是后一道的输入。 */
export const CHAIN: readonly { value: string; label: string }[] =
  ['params', 'meters', 'alloc', 'alloc-loss', 'bill-notices']
    .map(value => ({ value, label: chainLabel(value) }))

/**
 * 链路条状态。
 *
 * **计费参数恒为 done**：参数是 from 模式长期继承的，任何月都有生效值，
 * 「这个月配过参数没有」不是一个有答案的问题。它的 done 读作「参数与快照一致」，
 * stale 时才变橙 —— 而那正是要去这一屏点「重算本月」的时候。
 *
 * **园区抄表不吃 stale**：读数是人抄进来的原始数据，不是参数派生的快照，参数改了它不会过期。
 * 会过期的是下游那三张快照（池 / 损耗 / 催缴单）。
 *
 * **没做过的不会因为 stale 变橙**：没生成过就无所谓过期。
 */
export function chainStepsOf(c: ChainCell): Step[] {
  const snap = (done: boolean): Step['state'] => (done ? (c.stale ? 'stale' : 'done') : 'todo')
  return [
    { ...CHAIN[0], state: c.stale ? 'stale' : 'done' },
    { ...CHAIN[1], state: c.meters ? 'done' : 'todo' },
    { ...CHAIN[2], state: snap(c.pool) },
    { ...CHAIN[3], state: snap(c.loss) },
    { ...CHAIN[4], state: snap(c.notices) },
  ]
}

/**
 * 矩阵格子里的点 —— **四个，不含计费参数**。
 * 参数恒为「就绪」，一颗永远亮着的灯不携带信息，只会占掉格子宽度。
 * 月级的「需重算」由格子底色表达（BookMonthMatrix 的 .stale），不占一个点位。
 */
export const pipsOf = (c: ChainCell): boolean[] => [c.meters, c.pool, c.loss, c.notices]
