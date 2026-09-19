<script lang="ts">
// mobilizeOption —— setOption 前的移动化注入(移动阅读设计稿 §03),抽成纯函数便测。
// 原则:只补屏侧**没写**的键,显式设置一律尊重;不原地突变入参 —— option 来自屏侧
// computed,原地改会写回响应式源(还会让 deep watch 空转),触碰到的路径全部浅拷贝。
type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

// 轴:axisLabel 未设 hideOverlap 补 true(S 档类目密时标签互相叠死)。已显式设(或奇形值)不碰。
function mobAxis(ax: unknown): unknown {
  if (!isObj(ax)) return ax
  const lbl = ax.axisLabel
  if (lbl !== undefined && !isObj(lbl)) return ax
  if (isObj(lbl) && lbl.hideOverlap !== undefined) return ax
  return { ...ax, axisLabel: { ...(lbl as Rec | undefined), hideOverlap: true } }
}

// line/scatter 触点加粗:手指命中面积比鼠标粗。数字 +2、未设给 6;函数/数组形态不猜,跳过。
function mobSeries(s: unknown): unknown {
  if (!isObj(s) || (s.type !== 'line' && s.type !== 'scatter') || s.symbol === 'none') return s
  if (typeof s.symbolSize === 'number') return { ...s, symbolSize: s.symbolSize + 2 }
  if (s.symbolSize === undefined) return { ...s, symbolSize: 6 }
  return s
}

export function mobilizeOption(option: object, isS: boolean): object {
  const o: Rec = { ...(option as Rec) }
  // 全档注入 confine:贴边数据点的 tooltip 会溢出视口/容器(设计稿 §03 明示全档)。
  // 数组形态(多 tooltip)不逐项猜,跳过;没有 tooltip 键也不凭空造。
  if (isObj(o.tooltip) && o.tooltip.confine === undefined) o.tooltip = { ...o.tooltip, confine: true }
  if (!isS) return o

  // 图例改滚动:S 档窄幅下 plain 图例换行会吃掉图高
  if (isObj(o.legend) && o.legend.type === undefined) o.legend = { ...o.legend, type: 'scroll' }

  // dataZoom:slider 是拖把手交互,S 档又占高又难点 → 剔除;inside(捏合/平移)保留。
  // 只认显式 type==='slider',别的形态不猜;剔成空数组则整键删掉。
  const dz = o.dataZoom
  if (Array.isArray(dz)) {
    const kept = dz.filter((z: unknown) => !(isObj(z) && z.type === 'slider'))
    if (kept.length === 0) delete o.dataZoom
    else if (kept.length !== dz.length) o.dataZoom = kept
  } else if (isObj(dz) && dz.type === 'slider') {
    delete o.dataZoom
  }

  for (const k of ['xAxis', 'yAxis'] as const) {
    const ax = o[k]
    if (Array.isArray(ax)) o[k] = ax.map(mobAxis)
    else if (isObj(ax)) o[k] = mobAxis(ax)
  }

  if (Array.isArray(o.series)) o.series = o.series.map(mobSeries)
  else if (isObj(o.series)) o.series = mobSeries(o.series)
  return o
}

// 切回页签重播要先 clear,clear + notMerge 会把用户拖出来的缩放窗口、点掉的图例一起清掉。
// 重播前从实例读回这两样(getOption 的列表与上次下发的 mobilize 后列表同序),下发前按下标并回去。
export interface ViewKeep { dz: Rec[]; sel: Rec | null }
export function readView(cur: Rec): ViewKeep {
  const num = (z: unknown): Rec =>
    (isObj(z) ? Object.fromEntries(['start', 'end'].filter((k) => typeof z[k] === 'number').map((k) => [k, z[k]])) : {})
  const lg = Array.isArray(cur.legend) ? cur.legend[0] : null
  return {
    dz: Array.isArray(cur.dataZoom) ? cur.dataZoom.map(num) : [],
    sel: isObj(lg) && isObj(lg.selected) ? lg.selected : null,
  }
}
export function keepView(opt: Rec, k: ViewKeep): Rec {
  const o = { ...opt }
  const dz = o.dataZoom
  if (Array.isArray(dz)) o.dataZoom = dz.map((z: unknown, i) => (isObj(z) ? { ...z, ...k.dz[i] } : z))
  else if (isObj(dz)) o.dataZoom = { ...dz, ...k.dz[0] }
  if (k.sel && isObj(o.legend)) o.legend = { ...o.legend, selected: { ...(o.legend.selected as Rec | undefined), ...k.sel } }
  return o
}
</script>

<script setup lang="ts">
// ECharts 薄封装(spec §一):init(el,'fpAnaTheme') / option 深比较 setOption(notMerge) /
// ResizeObserver resize / onUnmounted dispose / 'click' 透传为 chart-click。
// echarts 动态 import → 分析层独立 chunk(非分析路由不加载);加载中显浅色占位。
// 按需装配在 ./echartsBundle(P2-1):包根 'echarts' 是全量注册(实测 1.13MB / gzip 382kB),
// 把 themeRiver/sunburst/candlestick/registerMap 这些一个没用到的全拖进首屏。
// ⚠ 新增图表类型要改的是 echartsBundle.ts,不是这里。
// jsdom 无 canvas:组件测试 vi.mock('../echartsBundle')(见 __tests__/anaEChart.spec.ts 契约)。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { anaThemeName, calloutsOf, placeCallout, registerFpAnaTheme, type CalloutSide, type CalloutSpec } from './anaTheme'
import { DUR, inViewport, motionize, onReactivated } from './anaMotion'
import { chartHeightFor, isSViewport } from './anaChartHeight'
import { resolvedTheme } from '@/stores/appearance'

// 最小实例形状(不顶层 import echarts 类型,保住懒加载;mock 也按此契约)
interface ChartInst {
  setOption(option: object, opts?: { notMerge?: boolean }): void
  getOption(): Record<string, unknown>
  resize(): void
  getWidth(): number
  getHeight(): number
  clear(): void
  dispose(): void
  on(event: string, handler: (params: unknown) => void): void
  convertToPixel?(finder: { seriesIndex: number }, value: (number | string | null)[]): number[]
  containPixel?(finder: string, value: number[]): boolean
}

/** height 只能取这 5 档(2026-08-20 立)。改前 59 张图用了 **24 种**高度(286/290/298/300/304
 *  这样 18px 内挤 5 个值),每屏各自目测拍数;`.av2-grid` 会把同一行的卡拉成等高,于是高度不同
 *  变成「图下方空白不均」——并排两张卡,一张图填满、一张图上面飘着下面一大块空。
 *
 *    xs 170  全宽条带(能耗板块损益 / 板块月度趋势)
 *    sm 200  小环 / 仪表 / 集中度
 *    md 250  常规单图
 *    lg 300  主图 / 瀑布 / 帕累托 / 散点
 *    xl 440  多行横条(Top20)与需要纵向空间的散点
 *
 *  ⚠ 真正的约束是**同一行**,不是同一栅格类 —— s8 与 s4 会并排在一行(8+4=12),
 *    这两张的高度必须相等。加新图时按「它和谁并排」选档,别按「它是几列宽」选。
 *  自查:scratchpad/row_check.py 模拟 12 列换行,逐行比高度,应输出 0。 */
// entrance:只认 false = 永不入场(抽屉 / 弹窗里的图瞬现,只有卡片上浮,原则 7);不传 = 挂载即入场。
// default: undefined 是必须写的 —— Vue 对**声明为 Boolean 的缺省 prop**会强制转成 false
// (resolvePropValue 的 isAbsent && !hasDefault),那样 54 张图全部被当成 entrance=false、零入场。
const props = withDefaults(defineProps<{ option: object; height?: number; entrance?: boolean }>(), { height: 250, entrance: undefined })
const emit = defineEmits<{ 'chart-click': [params: unknown] }>()

// S 档(视口 ≤600)图高降档:映射表与判据在 ./anaChartHeight(顶替本图的骨架 AnaSkelChart 共用同一张表)。
const isS = isSViewport()
const chartHeight = computed(() => chartHeightFor(props.height))

// 减动效:与上面的 isS 同法,挂载时 matchMedia 判一次(canvas 绕过 motion.css 的全局 1ms 规则,
// 是全站唯一不响应系统设置的动效源)。
const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// 挂载即入场(2026-09-16 行为矩阵,取代屏级 anaEntered):换期不再重挂之后,「一张图被挂上来」
// 只剩首进 / 切子屏 / 空态↔图互换三种原因,三者都该入场;换期走 watch → 更新相 200 形变。
// painted 实例级:挂载时 option 为空 {}、数据随后才到的图(Breakeven 等)首次真数据仍走 enter。
let painted = false
// 入场起点。起点之后 320 内到的 option(回签静默重取、两趟到数)仍按 enter 相下发:
// 按 update 相(animationDuration 0)下发的话,LineView 更新路径对旧裁剪 initProps 走 enter 时长 = 0,
// 折线的左→右揭示当场跳到终态(echarts 6.1 LineView.js:587 → basicTransition stopAnimation + attr)。
let enterAt = -Infinity

const el = ref<HTMLDivElement | null>(null)
const ready = ref(false)
let chart: ChartInst | null = null
let ro: ResizeObserver | null = null
// 动态 import 回来的装配包与 DPR:切外观重建实例时要再 init 一次
let ec: typeof import('./echartsBundle') | null = null
let dpr = 2

// 只画看得见的:离屏 / 后台标签页那次 setOption 关动画瞬到,滚到时已画好,不补播(不加 IntersectionObserver)。
// KeepAlive 停用的页签 rect 全 0,也走这条。
const visible = () => inViewport(el.value)

// setOption 前过 mobilizeOption + motionize(onMounted 与 watch 同一通道,别只改一处)
const apply = (o: object, keep?: ViewKeep) => {
  if (!chart) return
  const mob = mobilizeOption(o, isS) as Record<string, unknown>
  const opt = keep ? keepView(mob, keep) : mob
  const list = Array.isArray(opt.series) ? opt.series : opt.series ? [opt.series] : []
  const shown = visible()
  const entering = props.entrance !== false && (!painted || performance.now() - enterAt < DUR.enter)
  if (entering && !painted && list.length && shown) enterAt = performance.now()
  if (list.length) painted = true
  chart.setOption(motionize(opt, entering ? 'enter' : 'update', { reduced, isS, visible: shown }), { notMerge: true })
  // 气泡先藏,等这一轮动画走完('finished')按点的终点位置摆好再显 —— 形变途中不跟着飘
  callouts.value = calloutsOf(opt).map((c, i) => ({ ...c, key: i, left: 0, top: 0, tipX: 0, side: c.spec.prefer, show: false }))
}

// 图上点标注的气泡(anaTheme.calloutMark,设计稿方案 A):HTML 叠层,不进 zrender ——
// zrender 初始化会清空挂载节点,所以叠层与图是兄弟节点,外面包一层 .ana-echart-box。
interface CalloutView {
  key: number; seriesIndex: number; coord: (number | string | null)[]; spec: CalloutSpec
  left: number; top: number; tipX: number; side: CalloutSide; show: boolean
}
const callouts = ref<CalloutView[]>([])
// v-for 里的数组 ref 不保证与列表同序,按 key 收
const bubbleEls = new Map<number, HTMLElement>()
const setBubble = (key: number, e: unknown) => { if (e instanceof HTMLElement) bubbleEls.set(key, e); else bubbleEls.delete(key) }
const hideCallouts = () => { for (const c of callouts.value) c.show = false }
async function layoutCallouts() {
  if (!chart?.convertToPixel || !callouts.value.length) return
  await nextTick()
  const w = chart.getWidth(), h = chart.getHeight()
  callouts.value.forEach((c) => {
    const box = bubbleEls.get(c.key)
    let px: number[] | undefined
    try { px = chart!.convertToPixel!({ seriesIndex: c.seriesIndex }, c.coord) } catch { px = undefined }
    // 拖选 / 捏合缩放把点移出绘图区时不显
    if (!box || !px || !chart!.containPixel?.('grid', px)) { c.show = false; return }
    Object.assign(c, placeCallout({ x: px[0], y: px[1] }, { w: box.offsetWidth, h: box.offsetHeight }, { w, h }, c.spec.prefer), { show: true })
  })
}

onMounted(async () => {
  // 一次动态 import 拉整个装配好的包:单请求 + 摇树两头都要到(理由见 echartsBundle.ts 头注释)。
  // ⚠ 切忌把它提到文件顶层 import —— 那会把 echarts 拉回主包,连懒加载一起废掉。
  ec = await import('./echartsBundle')
  registerFpAnaTheme(ec)
  if (!el.value) return   // 懒加载期间已卸载
  // devicePixelRatio 向上取整、且不低于 2(2026-08-20 用户报障「每个图都很糊,像素不高」)。
  //
  // 根因是**非整数缩放**:Windows 显示缩放 125% 时 window.devicePixelRatio = 1.14(实测本机值)。
  // ECharts 默认拿这个值当倍率,于是 canvas 背景缓冲 = CSS 宽 × 1.14。而 CSS 宽本身常是
  // flex/grid 算出来的小数(如 613.33px),两个小数相乘几乎必然不是整数像素 → 整张 canvas 被
  // 浏览器重采样一次,坐标轴线、网格线、刻度文字全被反锯齿摊开成灰边。
  // 周围的 DOM 文字由排版引擎按物理像素渲染、不受影响,一对比图就显得"糊"。
  //
  // 取 ceil 且下限 2:等于用 2 倍超采样再缩回去,重采样误差被摊薄到看不出来。
  // 代价是显存 —— 背景缓冲面积从 1.14²≈1.3 倍涨到 4 倍(单张 600×300 的图约 2.8MB)。
  // 一屏最多 7 张图(PvRoiView),约 20MB,可接受;真嫌重的话下一步是换 SVGRenderer
  // (矢量,任何 DPR 都锐利,且文字走浏览器排版引擎),但那要动 echartsBundle 的渲染器装配。
  // —— S 档(≤600)已走这条出路:echartsBundle 按档装配 SVG(DPR 照传不降,SVG 根本不看它),
  //    canvas 路径(>600)零变化。选择收口在 echartsBundle,这里不用感知。
  dpr = Math.max(2, Math.ceil(window.devicePixelRatio || 1))
  initChart()
  apply(props.option)
  // 尺寸**真变**才 resize:observe 之后引擎会立刻空回调一次,resize() 以 animation:{duration:0}
  // 的 payload 走 update(echarts.js:998-1003),payload 优先级最高(basicTransition.js:80-84)→
  // el.attr 直设终态,首绘在首帧被截断为零。真窗口缩放仍会截断动画,接受,不补播。
  // 空批次守卫:原生 RO 规范上不派发空 entries,但 polyfill / 测试替身会 —— 解构 entries[0] 再读
  // contentRect 会在观察者任务里抛 TypeError,那一批所有图的 resize 一起被跳过且无人察觉。
  // 0×0 不 resize:KeepAlive 停用把 DOM 挪进脱离文档的缓存容器,RO 报 0×0;跟着缩到 0 的话,
  // 切回页签时 RO 再报真尺寸 → resize(duration 0 payload)把刚起步的重播入场截断成终态。
  ro = new ResizeObserver((es) => {
    const r = es[0]?.contentRect
    if (!r || !chart) return
    const w = Math.round(r.width), h = Math.round(r.height)
    if (!w || !h) return
    if (w !== chart.getWidth() || h !== chart.getHeight()) chart.resize()
  })
  ro.observe(el.value)
  ready.value = true
})

watch(() => props.option, (o) => apply(o), { deep: true })   // 不直接传 apply:第二参是 oldValue,会被当成 keep

/** init + 挂事件(首次挂载与切外观重建共用一处,别只改一边)。主题按当前外观取(DARK-MODE-SPEC §6)。 */
function initChart() {
  chart = ec!.init(el.value!, anaThemeName(), { devicePixelRatio: dpr }) as unknown as ChartInst
  chart.on('click', (params) => emit('chart-click', params))
  chart.on('finished', () => { void layoutCallouts() })
  chart.on('datazoom', hideCallouts)
}

// 切外观:ECharts 主题只在 init 时生效,换主题 = 按新主题重建实例。缩放窗口与点掉的图例照切回页签那样带过去;
// 按 update 相下发(不重播入场)。flush:'post' —— 等父组件按新外观重算完 option 再画,不画两遍旧色。
watch(resolvedTheme, () => {
  if (!chart || !ec || !el.value) return
  const keep = readView(chart.getOption())
  chart.dispose()
  initChart()
  apply(props.option, keep)
}, { flush: 'post' })

// 切回页签:视口内的图 clear 后按 enter 相重下发,重播 320 入场。离屏 / 减动效 / entrance=false / 还没画过的不重播。
// (挂载伴随的那次 activated 由 onReactivated 挡掉;那时 chart 也还在 await import,双保险。)
// 离开期间容器改了尺寸(收侧栏 / 拖窗宽):先按新尺寸 resize 掉旧画面,否则同一帧随后的 RO 回调
// 发现尺寸不一致会 resize(duration 0 payload),把刚起步的重播截成终态。
onReactivated(() => {
  if (!chart || props.entrance === false || reduced || !painted || !visible()) return
  const w = el.value!.clientWidth, h = el.value!.clientHeight
  if (w && h && (w !== chart.getWidth() || h !== chart.getHeight())) chart.resize()
  const keep = readView(chart.getOption())
  chart.clear()
  painted = false
  apply(props.option, keep)
})

onBeforeUnmount(() => {
  ro?.disconnect(); ro = null
  chart?.dispose(); chart = null
})
</script>

<template>
  <div class="ana-echart-box">
    <div ref="el" class="ana-echart" :class="{ loading: !ready }" :style="{ height: chartHeight + 'px' }" />
    <div
      v-for="c in callouts" :key="c.key" :ref="(e) => setBubble(c.key, e)" class="ana-callout" :class="[c.side, { on: c.show }]"
      :style="{ left: c.left + 'px', top: c.top + 'px', '--tip-x': c.tipX + 'px' }"
    >
      <span v-for="(l, i) in c.spec.lines" :key="i" class="l">{{ l }}</span>
    </div>
  </div>
</template>

<style scoped>
.ana-echart-box { position: relative; width: 100%; min-width: 0; }
.ana-echart { width: 100%; min-width: 0; }
/* 深色气泡:与图表悬停提示框同一个样子(anaTheme tooltip:--tip-bg 底、白字 11;暗色下 --tip-bg 提亮一层) */
.ana-callout {
  --tip-x: 50%;   /* 行内 style 按点的像素覆盖 */
  position: absolute; left: 0; top: 0; z-index: 1; pointer-events: none;
  display: flex; flex-direction: column;
  padding: 4px 8px; border-radius: 6px; background: var(--tip-bg); color: var(--text-on-solid);
  font-size: var(--fs-micro); line-height: 15px; white-space: nowrap;
  box-shadow: var(--shadow-tip);
  visibility: hidden; opacity: 0;
}
.ana-callout.on { visibility: visible; opacity: 1; transition: opacity var(--dur-fast) var(--ease-out); }
.ana-callout .l:first-child { font-weight: var(--fw-semibold); }
.ana-callout .l + .l { color: color-mix(in srgb, var(--text-on-solid) 78%, transparent); }
/* 尖角:12×6,横向对准点(--tip-x 相对气泡左沿) */
.ana-callout::after {
  content: ''; position: absolute; left: calc(var(--tip-x) - 6px);
  border-left: 6px solid transparent; border-right: 6px solid transparent;
}
.ana-callout.top::after { top: 100%; border-top: 6px solid var(--tip-bg); }
.ana-callout.bottom::after { bottom: 100%; border-bottom: 6px solid var(--tip-bg); }
.ana-echart.loading { background: var(--surface-sunken); border-radius: 8px; }
</style>
