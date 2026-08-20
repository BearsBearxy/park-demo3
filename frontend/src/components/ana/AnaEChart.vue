<script setup lang="ts">
// ECharts 薄封装(spec §一):init(el,'fpAnaTheme') / option 深比较 setOption(notMerge) /
// ResizeObserver resize / onUnmounted dispose / 'click' 透传为 chart-click。
// echarts 动态 import → 分析层独立 chunk(非分析路由不加载);加载中显浅色占位。
// 按需装配在 ./echartsBundle(P2-1):包根 'echarts' 是全量注册(实测 1.13MB / gzip 382kB),
// 把 themeRiver/sunburst/candlestick/registerMap 这些一个没用到的全拖进首屏。
// ⚠ 新增图表类型要改的是 echartsBundle.ts,不是这里。
// jsdom 无 canvas:组件测试 vi.mock('../echartsBundle')(见 __tests__/anaEChart.spec.ts 契约)。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { registerFpAnaTheme } from './anaTheme'

// 最小实例形状(不顶层 import echarts 类型,保住懒加载;mock 也按此契约)
interface ChartInst {
  setOption(option: object, opts?: { notMerge?: boolean }): void
  resize(): void
  dispose(): void
  on(event: string, handler: (params: unknown) => void): void
}

const props = withDefaults(defineProps<{ option: object; height?: number }>(), { height: 260 })
const emit = defineEmits<{ 'chart-click': [params: unknown] }>()

const el = ref<HTMLDivElement | null>(null)
const ready = ref(false)
let chart: ChartInst | null = null
let ro: ResizeObserver | null = null

onMounted(async () => {
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
  const dpr = Math.max(2, Math.ceil(window.devicePixelRatio || 1))
  chart = ec.init(el.value, 'fpAnaTheme', { devicePixelRatio: dpr }) as unknown as ChartInst
  chart.setOption(props.option, { notMerge: true })
  chart.on('click', (params) => emit('chart-click', params))
  ro = new ResizeObserver(() => chart?.resize())
  ro.observe(el.value)
  ready.value = true
})

watch(() => props.option, (o) => { chart?.setOption(o, { notMerge: true }) }, { deep: true })

onBeforeUnmount(() => {
  ro?.disconnect(); ro = null
  chart?.dispose(); chart = null
})
</script>

<template>
  <div ref="el" class="ana-echart" :class="{ loading: !ready }" :style="{ height: height + 'px' }" />
</template>

<style scoped>
.ana-echart { width: 100%; min-width: 0; }
.ana-echart.loading { background: var(--surface-1, var(--surface-sunken)); border-radius: 8px; }
</style>
