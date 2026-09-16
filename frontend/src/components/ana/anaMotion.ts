// src/components/ana/anaMotion.ts —— 分析层 ECharts 动效注入(动效设计稿 §8.2/§8.3,C6-02~C6-06)。
//
// ECharts 主题与 option 是纯 JSON,引不了 CSS 变量 → 这里是 tokens.css 的**镜像**:
// DUR 三档逐字对应 --dur-slow(320)/--dur-base(200)/--dur-fast(120),EASE 取 zrender 里
// 与 --ease-out / 标准缓出同族的两条。改这三个常量 = 改全站 54 张图,不要在屏侧另发明数字。
//
// 为什么顶层键不够、必须**逐系列**注入:Model.js:87-97 的 getShallow 只在系列自身缺键时才
// 回落到全局,而 PieSeries / LineSeries / TreemapSeries / SankeySeries 的 defaultOption 经
// Component.js:62-67 merge 已经把 animation* 填在系列层了 —— 顶层写了也被系列自己的默认值压住。
// 同理 reduced 分支要逐系列 animation:false(TreemapSeries.js:220 系列默认 animation:true)。
//
// 注入顺序 `{...keys, ...top, ...stagger, ...s}`:屏侧显式键(顶层 top 或系列 s)永远优先 ——
// 注入的是「屏没写时的缺省」,不是覆盖。Breakeven 顶层 animationDurationUpdate:0 靠这条压过 200。
import { inject, nextTick, onDeactivated, onMounted, ref, type Ref } from 'vue'

export const DUR = { enter: 320, update: 200, state: 120 } as const   // 镜像 --dur-slow / --dur-base / --dur-fast
export const EASE = { enter: 'quarticOut', update: 'cubicOut' } as const
export const STAGGER = { step: 12, cap: 12, maxN: 24 } as const       // ECharts 专用错峰,无 CSS 对应

const ANIM_KEYS = ['animationDuration', 'animationEasing', 'animationDelay', 'animationDurationUpdate', 'animationEasingUpdate', 'animationDelayUpdate'] as const

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const pick = (o: Rec): Rec => Object.fromEntries(ANIM_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]] as [string, unknown]))

/** setOption 前的动效注入(纯函数,不原地改入参 —— option 来自屏侧 computed)。 */
export function motionize(o: Rec, phase: 'enter' | 'update', env: { reduced: boolean; isS: boolean; visible: boolean }): Rec {
  const list = Array.isArray(o.series) ? o.series : o.series ? [o.series] : []
  const off = (s: unknown) => (isObj(s) ? { ...s, animation: false } : s)
  if (env.reduced) return { ...o, animation: false, stateAnimation: { duration: 0 }, series: list.map(off) }
  // 离屏/后台:只关 animation,**不动 stateAnimation** —— 否则折叠区的图 hover 永远 0ms,直到下次换期
  if (!env.visible) return { ...o, animation: false, series: list.map(off) }
  const enter = phase === 'enter'
  const keys: Rec = {
    animationDuration: enter ? (env.isS ? DUR.update : DUR.enter) : 0,
    animationEasing: enter ? EASE.enter : EASE.update,
    animationDelay: 0,
    animationDurationUpdate: env.isS ? 0 : DUR.update,
    animationEasingUpdate: EASE.update,
    animationDelayUpdate: 0,
  }
  const top = pick(o)
  const stagger = (i: number) => Math.min(i, STAGGER.cap) * STAGGER.step
  const series = list.map((s) => {
    if (!isObj(s)) return s
    const n = Array.isArray(s.data) ? s.data.length : 0
    const st = enter && !env.isS && (s.type === 'bar' || s.type === 'scatter') && n > 0 && n <= STAGGER.maxN && s.animationDelay === undefined
      ? { animationDelay: stagger }
      : {}
    return { ...keys, ...top, ...st, ...s }
  })
  return { ...keys, ...o, series }
}

/** 自绘 SVG / DOM 图的首绘相(C6-25):这次挂载要不要擦入。
 *
 * 与 AnaEChart 读**同一个**屏级标志(AnaShell `provide('anaEntered')`)—— 段控 / 粒度 / 抽屉 /
 * v-if 重挂时 entered 已真,自动瞬到,不用给每张图写 :entrance。
 * 默认 `ref(true)` 而不是 AnaEChart 的 `ref(false)`:AnaShell 之外(单测、独立用)当作「已进屏」= 不擦。
 * 置真放 onMounted 里自己做:纯自绘屏(光伏分栋)一张 AnaEChart 都没有,没人替它置。
 */
export function useEnterPhase(el: Ref<Element | null>): Ref<boolean> {
  const entered = inject<Ref<boolean>>('anaEntered', ref(true))
  const first = ref(false)
  onMounted(() => {
    // 与 C6-06 同一条 visible() 判据:离屏 / 后台标签页那次不擦,滚到时已画好,不补播。
    const r = el.value?.getBoundingClientRect()
    first.value = !entered.value && !!r && !document.hidden && r.bottom > 0 && r.top < innerHeight
    nextTick(() => { entered.value = true })
  })
  // KeepAlive 停用会把整棵 DOM 挪进缓存容器 —— 运行中的动画被取消,只发 animationcancel 不发 animationend,
  // 消费者挂在 animationend 上的摘类收不到,标志卡在 true,切回页签重插 DOM 就把「一生一次」的擦入重播一遍。
  // 收在这里而不是七张图各写一遍(C6-17 / C6-25)。
  onDeactivated(() => { first.value = false })
  return first
}
