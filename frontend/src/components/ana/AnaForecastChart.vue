<script setup lang="ts">
// 自绘 SVG 折线图 —— 用户 2026-09-12:「echart画不出来这个可视化就不要用echart的,改为自己设计
// linechart」。视觉取自他指定的 Figma 稿(Animated Line Charts,节点 2310:2628)。
// 这个组件只负责画:所有坐标由 forecastChart.logic.ts 的纯函数算好传进来,便于逐条断言。
import { computed } from 'vue'
import { forecastChartGeo, type ChartBox, type RollingRow } from '@/views/analysis/forecastChart.logic'

const props = withDefaults(defineProps<{
  rows: RollingRow[] | null
  height?: number
  /** 画布宽度:SVG 用 viewBox 等比缩放,这个值只决定内部坐标的横纵比例。 */
  width?: number
}>(), { height: 300, width: 900 })

const box = computed<ChartBox>(() => ({
  width: props.width, height: props.height, padL: 52, padR: 58, padT: 18, padB: 28,
}))
const geo = computed(() => forecastChartGeo(props.rows, box.value))
const fRow = computed(() => props.rows?.find((r) => r.isForecast && r.mid != null) ?? null)
const fint = (v: number) => Math.round(v).toLocaleString('zh-CN')
// x 轴标签按可用宽度抽稀,月份多时不挤成一团
const xShown = computed(() => {
  const t = geo.value?.xTicks ?? []
  const step = t.length > 9 ? 2 : 1
  return t.filter((_, i) => i % step === 0 || i === t.length - 1)
})
</script>

<template>
  <svg v-if="geo" class="afc" :viewBox="`0 0 ${box.width} ${box.height}`" preserveAspectRatio="xMidYMid meet" role="img">
    <defs>
      <linearGradient :id="'afc-fill'" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4F46E5" stop-opacity="0.16" />
        <stop offset="100%" stop-color="#4F46E5" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- 只有横向网格线,没有纵向(照稿) -->
    <g>
      <line v-for="t in geo.yTicks" :key="'g' + t.v" :x1="box.padL" :x2="box.width - box.padR" :y1="t.y" :y2="t.y" class="afc-grid" />
      <text v-for="t in geo.yTicks" :key="'y' + t.v" :x="box.padL - 10" :y="t.y + 4" class="afc-ylab">{{ t.label }}</text>
    </g>

    <!-- 逐月预测带:每个月的上下沿来自它自己那一次拟合(见 rollingForecastRows 头注) -->
    <path v-for="(d, i) in geo.bandPaths" :key="'b' + i" :d="d" class="afc-band" />
    <path v-if="geo.midPath" :d="geo.midPath" class="afc-mid" />

    <!-- 已录入:线下渐变 + 实线 + 点 -->
    <path v-if="geo.areaPath" :d="geo.areaPath" fill="url(#afc-fill)" />
    <path v-if="geo.linePath" :d="geo.linePath" class="afc-line" />
    <circle v-for="d in geo.dots" :key="'d' + d.month" :cx="d.x" :cy="d.y" r="3.5" class="afc-dot" />

    <!-- 「今天」分界:左边是录入的,右边是预测的 -->
    <template v-if="geo.todayX != null">
      <line :x1="geo.todayX" :x2="geo.todayX" :y1="box.padT" :y2="box.height - box.padB" class="afc-today" />
      <text :x="geo.todayX + 5" :y="box.padT + 10" class="afc-todaylab">今天</text>
    </template>

    <!-- 预测月:上下沿短横 + 竖线 + 空心中位点 + 右侧三个数(照抖音那张卡的读法) -->
    <template v-if="geo.forecast && fRow">
      <line :x1="geo.forecast.x" :x2="geo.forecast.x" :y1="geo.forecast.yHi" :y2="geo.forecast.yLo" class="afc-fbar" />
      <line :x1="geo.forecast.x - 5" :x2="geo.forecast.x + 5" :y1="geo.forecast.yHi" :y2="geo.forecast.yHi" class="afc-fcap" />
      <line :x1="geo.forecast.x - 5" :x2="geo.forecast.x + 5" :y1="geo.forecast.yLo" :y2="geo.forecast.yLo" class="afc-fcap" />
      <circle :cx="geo.forecast.x" :cy="geo.forecast.yMid" r="4.5" class="afc-fdot" />
      <text :x="geo.forecast.x + 10" :y="geo.forecast.yHi + 4" class="afc-fnum">{{ fint(fRow.hi as number) }}</text>
      <text :x="geo.forecast.x + 10" :y="geo.forecast.yMid + 4" class="afc-fnum afc-fnum-mid">{{ fint(fRow.mid as number) }}</text>
      <text :x="geo.forecast.x + 10" :y="geo.forecast.yLo + 4" class="afc-fnum">{{ fint(fRow.lo as number) }}</text>
    </template>

    <text v-for="t in xShown" :key="'x' + t.month" :x="t.x" :y="box.height - box.padB + 18" class="afc-xlab">{{ t.label }}</text>
  </svg>
</template>

<style scoped>
/* 取色自 Figma 稿(节点 2310:2628):主线 #4F46E5 / 浅带 #C7D2FE / 网格 #E5EAF0 / 轴标签 #CBD5E1 */
.afc { width: 100%; height: auto; display: block; }
.afc-grid { stroke: #E5EAF0; stroke-width: 1; }
.afc-ylab { fill: #94A3B8; font-size: 11px; text-anchor: end; font-variant-numeric: tabular-nums; }
.afc-xlab { fill: #94A3B8; font-size: 11px; text-anchor: middle; }
.afc-band { fill: #C7D2FE; fill-opacity: 0.42; }
.afc-mid { fill: none; stroke: #A5B4FC; stroke-width: 1.2; stroke-dasharray: 4 4; }
.afc-line { fill: none; stroke: #4F46E5; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.afc-dot { fill: #fff; stroke: #4F46E5; stroke-width: 2; }
.afc-today { stroke: #CBD5E1; stroke-width: 1; stroke-dasharray: 3 3; }
.afc-todaylab { fill: #94A3B8; font-size: 10px; }
.afc-fbar { stroke: #4F46E5; stroke-width: 1.5; stroke-opacity: 0.55; }
.afc-fcap { stroke: #4F46E5; stroke-width: 1.5; stroke-opacity: 0.55; }
.afc-fdot { fill: #fff; stroke: #4F46E5; stroke-width: 2.5; }
.afc-fnum { fill: #94A3B8; font-size: 11px; font-variant-numeric: tabular-nums; }
.afc-fnum-mid { fill: #1E293B; font-weight: 600; }
</style>
