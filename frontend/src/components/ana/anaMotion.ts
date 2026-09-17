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
import { computed, getCurrentInstance, onActivated, onDeactivated, onMounted, ref, watch, type Ref } from 'vue'

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

/** 与 C6-06 同一条判据:在视口内且标签页在前台。AnaEChart 与自绘图共用。 */
export function inViewport(el: Element | null | undefined): boolean {
  const r = el?.getBoundingClientRect()
  return !!r && !document.hidden && r.bottom > 0 && r.top < innerHeight
}

/** KeepAlive「切回页签」:只在**先停用过**之后的那次激活里调 fn。
 *  KeepAlive 根组件挂载时 Vue 会顺带调一次 activated(挂载期注册的后代钩子也在根上一起调)——
 *  那次不是「切回」,靠「之前停用过」这一条挡掉,不数次数(挂载之后才 v-if 出来的后代没有那一次)。
 *  页签停用期间才挂上的后代(数据在后台到、v-if 挂在缓存容器里)从没收到过 deactivated,
 *  但用户第一次看见它正是下一次切回 —— 挂载时根节点不在文档里,就当它已经「停用过」。 */
export function onReactivated(fn: () => void): void {
  let away = false
  const inst = getCurrentInstance()
  onMounted(() => { if (inst?.subTree.el?.isConnected === false) away = true })
  onDeactivated(() => { away = true })
  onActivated(() => {
    if (!away) return
    away = false
    fn()
  })
}

/** 自绘 SVG / DOM 图的擦入相(2026-09-16 行为矩阵,压过 C6-25 的屏级 entered):
 *
 *  - 挂载时在视口内 → `first` 为真(消费者挂 fp-wipe 320);离屏 / 后台 → 假(瞬到,不补播)。
 *    不再看屏级标志:换期不重挂之后,「一张图被挂上来」只剩首进 / 切子屏 / 空态↔图互换,三者都该擦。
 *  - 切回页签(KeepAlive 重新激活)且在视口内 → 下一帧把 `first` 置真,wipe 重播。
 *    停用时已置假(见下),DOM 上类名先摘、下一帧再挂,CSS 动画才会重启(true→true 不重启)。
 *  - `{ entrance: false }`:永不擦(抽屉 / 弹窗里的图,只有卡片上浮,原则 7)。
 *  - reduced-motion 不在这里判:全局 1ms 规则已把 wipe 压成瞬到。
 *
 *  `first` 可写:消费者在 animationend.self **和 animationcancel.self** 上置假。
 */
export function useEnterPhase(el: Ref<Element | null>, opts: { entrance?: boolean } = {}): Ref<boolean> {
  const first = ref(false)
  const on = opts.entrance !== false
  onMounted(() => { first.value = on && inViewport(el.value) })
  // KeepAlive 停用会把整棵 DOM 挪进缓存容器 —— 运行中的动画被取消,只发 animationcancel 不发 animationend;
  // 这里当场摘掉(= 「先置假」),不指望消费者的监听(C6-17 / C6-25)。
  onDeactivated(() => { first.value = false })
  onReactivated(() => {
    if (!on || !inViewport(el.value)) return
    // 下一帧再置真;帧内又被停用(连点页签,DOM 已回缓存容器)就不挂
    requestAnimationFrame(() => { if (el.value?.isConnected) first.value = true })
  })
  return first
}

/** 自绘图同键形变的压制开关:给数据组 `:class="['ana-morph', { hold }]"`(ana.css)。
 *
 *  两种时候不许形变 —— 为真时 `.ana-morph.hold` 把过渡关掉:
 *  - `first` 为真(wipe 进行中);
 *  - 宽度刚变(挂载时的真实宽度校正、ResizeObserver 改宽、切回页签重算宽)。
 *    宽度变化与 hold 落在**同一次** patch 里(pre watcher 先于组件重渲),该帧的样式计算看到
 *    「新几何 + 无过渡」;两帧后摘掉 —— 单帧不够:在 rAF 阶段之前的微任务里改宽时,
 *    一帧后的回调仍赶在同一帧的样式计算之前,会把过渡放回来。
 *
 *  `width`:消费者已有的宽度 ref(useWidth 的 width,或自己 RO 写的 w)。
 */
export function useMorphHold(width: Ref<number>, first: Ref<boolean>): Ref<boolean> {
  const resizing = ref(false)
  watch(width, () => {
    resizing.value = true
    requestAnimationFrame(() => requestAnimationFrame(() => { resizing.value = false }))
  })
  return computed(() => first.value || resizing.value)
}
