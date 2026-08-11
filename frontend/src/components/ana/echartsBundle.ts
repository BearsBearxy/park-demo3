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
//   全站无 visualMap/toolbox/graphic/geo/timeline/brush/polar/radar/calendar/dataset/parallel，无 SVGRenderer。
import { init, registerTheme, use } from 'echarts/core'
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
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart, LineChart, PieChart, ScatterChart, TreemapChart, SankeyChart, GaugeChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  MarkLineComponent, MarkPointComponent, MarkAreaComponent, DataZoomComponent,
  CanvasRenderer,
])

export { init, registerTheme }
