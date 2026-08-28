// ECharts 按需装配（P2-1 二次优化）。全站唯一装配 echarts 的地方，只被 AnaEChart.vue 动态 import。
//
// 为什么要单独一个模块，而不是在 AnaEChart 里 await import 四个子路径：
//   · 摇树只认顶层具名 import 或 `const { A } = await import(...)` 解构。实测把 `await Promise.all([...])`
//     的结果按命名空间取值（charts.BarChart）Rollup 会放弃分析、整包原样保留 —— 一字节没省。
//   · 解构写法能摇树，但四条子路径要写成四个串行 await（并发写法又退回命名空间取值），首屏多几个 RTT。
//   本文件用顶层具名 import（摇树成立）+ 被上游一次动态 import（单请求成立），两头都要到。
//
// ⚠ 新增图表类型（如 radar）或新用 visualMap/toolbox 之类的 component 时，必须同步加进 import 和 use([...])。
//   漏了的表现：series 报 `Series xxx is used but not imported`，component 则静默不渲染（更难发现）。
// ⚠ 单测里本模块整体被 vi.mock（jsdom 无 canvas），**漏注册测不出来**，只能在浏览器里看控制台。
//   四类独苗屏漏一个就是整屏白图：园区经营(treemap) / 园区能耗(sankey) / 资产负债分析(gauge) / 带 dataZoom 的屏。
//
// 清单来源：2026-08-11 审计静态全扫（src/views/analysis + src/components/ana）。
//   axisPointer 全站都嵌在 tooltip 里 → TooltipComponent 覆盖；log 轴 → GridComponent 覆盖。
//   全站无 visualMap/toolbox/graphic/geo/timeline/brush/polar/radar/calendar/dataset/parallel，无 SVGRenderer——
//   后者 2026-08-29 起在装配层按档启用（见文末），审计结论仍成立：option 层无人依赖它。
import { init as ecInit, registerTheme, use } from 'echarts/core'
import {
  BarChart,        // 49 处
  LineChart,       // 34 处
  PieChart,        // 7 处
  ScatterChart,    // 5 处
  TreemapChart,    // 1 处 ParkView 园区经营
  SankeyChart,     // 1 处 ParkEnergyView 园区能耗
  GaugeChart,      // 1 处 finBalance.logic 资产负债分析
} from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  MarkLineComponent, MarkPointComponent, MarkAreaComponent, DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

// S 档(视口 ≤600)换 SVGRenderer(RESPONSIVE-LAYOUT-SPEC §5.2;AnaEChart DPR 注释预留的出路):
// 矢量在任何 DPR 都锐利、文字走浏览器排版引擎,省掉 canvas「ceil 且下限 2」带来的 4 倍背景缓冲显存
// ——手机上这份显存最金贵。DPR 不降:AnaEChart 照传,SVG 根本不看它。
// matchMedia 只在模块求值时判一次:本模块随分析 chunk 每页只加载一次,手机不改窗宽,
// 旋屏走整页重挂载(重新求值),不必也不该跟随 resize。
// canvas 路径(>600)装配与行为原样零变化;两个渲染器都进包是代价——按档是运行时才知道的,摇不掉。
const useSvg = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches

use([
  BarChart, LineChart, PieChart, ScatterChart, TreemapChart, SankeyChart, GaugeChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  MarkLineComponent, MarkPointComponent, MarkAreaComponent, DataZoomComponent,
  useSvg ? SVGRenderer : CanvasRenderer,
])

// 渲染器选择收口在这里:S 档只注册了 SVG,init 不注入 renderer:'svg' 会按默认 canvas 找不到渲染器。
// 导出名与形状不变(init/registerTheme),AnaEChart 的动态 import 契约与单测 mock 都不用动。
const init: typeof ecInit = (dom, theme, opts) =>
  useSvg ? ecInit(dom, theme, { ...opts, renderer: 'svg' }) : ecInit(dom, theme, opts)

export { init, registerTheme }
