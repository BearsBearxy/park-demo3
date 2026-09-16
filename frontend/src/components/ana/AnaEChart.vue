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
</script>

<script setup lang="ts">
// ECharts 薄封装(spec §一):init(el,'fpAnaTheme') / option 深比较 setOption(notMerge) /
// ResizeObserver resize / onUnmounted dispose / 'click' 透传为 chart-click。
// echarts 动态 import → 分析层独立 chunk(非分析路由不加载);加载中显浅色占位。
// 按需装配在 ./echartsBundle(P2-1):包根 'echarts' 是全量注册(实测 1.13MB / gzip 382kB),
// 把 themeRiver/sunburst/candlestick/registerMap 这些一个没用到的全拖进首屏。
// ⚠ 新增图表类型要改的是 echartsBundle.ts,不是这里。
// jsdom 无 canvas:组件测试 vi.mock('../echartsBundle')(见 __tests__/anaEChart.spec.ts 契约)。
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { registerFpAnaTheme } from './anaTheme'
import { motionize } from './anaMotion'

// 最小实例形状(不顶层 import echarts 类型,保住懒加载;mock 也按此契约)
interface ChartInst {
  setOption(option: object, opts?: { notMerge?: boolean }): void
  resize(): void
  getWidth(): number
  getHeight(): number
  dispose(): void
  on(event: string, handler: (params: unknown) => void): void
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
// entrance:可选覆盖首绘相(不传 = 由屏级 entered 决定)。default: undefined 是必须写的 ——
// Vue 对**声明为 Boolean 的缺省 prop**会强制转成 false(resolvePropValue 的 isAbsent && !hasDefault),
// 那样 props.entrance ?? ... 永远短路成 false,54 张图全部退化成更新相、零入场。
const props = withDefaults(defineProps<{ option: object; height?: number; entrance?: boolean }>(), { height: 250, entrance: undefined })
const emit = defineEmits<{ 'chart-click': [params: unknown] }>()

// S 档(视口 ≤600)图高降档:xl/lg→260、md→220、sm→180、xs→150(RESPONSIVE-LAYOUT-SPEC §5.2)。
// matchMedia 挂载时初判一次即可,不跟随 resize——手机不改窗宽,旋屏走整页重挂载;
// 也因此零响应式重排,同一视口内高度即终态(LAYOUT-STABILITY §1)。
// 上面五档注释里「同一行卡等高」的约束,在 S 档随单列堆叠自然失效——一行只有一张卡,
// 没有并排可对齐;降档只需整组同改(xl 与 lg 合并到 260 正是这个意思),无需逐行核对。
const S_HEIGHT: Record<number, number> = { 440: 260, 300: 260, 250: 220, 200: 180, 170: 150 }
const isS = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches
const chartHeight = computed(() => (isS ? S_HEIGHT[props.height] ?? props.height : props.height))

// 减动效:与上面的 isS 同法,挂载时 matchMedia 判一次(canvas 绕过 motion.css 的全局 1ms 规则,
// 是全站唯一不响应系统设置的动效源)。
const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// 首绘相由**屏级**标志决定,不是每张图自己猜:AnaShell provide('anaEntered'),这里 inject。
// 段控 / 粒度 / 抽屉 / v-if 重挂时 entered 已真 → 自动走更新相,**永不重播入场**。
// 没有 AnaShell 的宿主(单测、独立用)拿默认 ref(false) → 当作首进屏。
const entered = inject<Ref<boolean>>('anaEntered', ref(false))
let enterPhase = false
// 实例级:挂载时 option 为空 {}、数据随后才到的图(Breakeven 等)首次真数据仍走 enter。
let painted = false

const el = ref<HTMLDivElement | null>(null)
const ready = ref(false)
let chart: ChartInst | null = null
let ro: ResizeObserver | null = null

// 只画看得见的:离屏 / 后台标签页那次 setOption 关动画瞬到,滚到时已画好,不补播(不加 IntersectionObserver)。
// KeepAlive 停用的页签 rect 全 0,也走这条。
const visible = () => {
  const r = el.value?.getBoundingClientRect()
  return !!r && !document.hidden && r.bottom > 0 && r.top < innerHeight
}

// setOption 前过 mobilizeOption + motionize(onMounted 与 watch 同一通道,别只改一处)
const apply = (o: object) => {
  if (!chart) return
  const opt = mobilizeOption(o, isS) as Record<string, unknown>
  const list = Array.isArray(opt.series) ? opt.series : opt.series ? [opt.series] : []
  const phase = enterPhase && !painted ? 'enter' : 'update'
  if (list.length) painted = true
  chart.setOption(motionize(opt, phase, { reduced, isS, visible: visible() }), { notMerge: true })
}

onMounted(async () => {
  // 第一句,await 之前同步快照:同一 tick 里挂载的图全看到 entered 为假,nextTick 后置真。
  enterPhase = props.entrance ?? !entered.value
  nextTick(() => { entered.value = true })
  // 一次动态 import 拉整个装配好的包:单请求 + 摇树两头都要到(理由见 echartsBundle.ts 头注释)。
  // ⚠ 切忌把它提到文件顶层 import —— 那会把 echarts 拉回主包,连懒加载一起废掉。
  const ec = await import('./echartsBundle')
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
  const dpr = Math.max(2, Math.ceil(window.devicePixelRatio || 1))
  chart = ec.init(el.value, 'fpAnaTheme', { devicePixelRatio: dpr }) as unknown as ChartInst
  apply(props.option)
  chart.on('click', (params) => emit('chart-click', params))
  // 尺寸**真变**才 resize:observe 之后引擎会立刻空回调一次,resize() 以 animation:{duration:0}
  // 的 payload 走 update(echarts.js:998-1003),payload 优先级最高(basicTransition.js:80-84)→
  // el.attr 直设终态,首绘在首帧被截断为零。真窗口缩放仍会截断动画,接受,不补播。
  // 空批次守卫:原生 RO 规范上不派发空 entries,但 polyfill / 测试替身会 —— 解构 entries[0] 再读
  // contentRect 会在观察者任务里抛 TypeError,那一批所有图的 resize 一起被跳过且无人察觉。
  ro = new ResizeObserver((es) => {
    const r = es[0]?.contentRect
    if (!r || !chart) return
    const w = Math.round(r.width), h = Math.round(r.height)
    if (w !== chart.getWidth() || h !== chart.getHeight()) chart.resize()
  })
  ro.observe(el.value)
  ready.value = true
})

watch(() => props.option, apply, { deep: true })

onBeforeUnmount(() => {
  ro?.disconnect(); ro = null
  chart?.dispose(); chart = null
})
</script>

<template>
  <div ref="el" class="ana-echart" :class="{ loading: !ready }" :style="{ height: chartHeight + 'px' }" />
</template>

<style scoped>
.ana-echart { width: 100%; min-width: 0; }
.ana-echart.loading { background: var(--surface-1, var(--surface-sunken)); border-radius: 8px; }
</style>
