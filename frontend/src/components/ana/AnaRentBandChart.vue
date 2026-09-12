<script setup lang="ts">
// 「合约租金 · 未来 12 个月」自绘 SVG —— 照设计稿(board-expiry)实现,含悬停。
// 坐标全部由 rentBandChart.logic.ts 的纯函数算好,这里只负责画与交互。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { rentBandGeo, type GapInput, type RentBandCol } from '@/views/analysis/rentBandChart.logic'
import type { ChartBox } from '@/views/analysis/forecastChart.logic'

const props = withDefaults(defineProps<{
  cols: RentBandCol[] | null
  splitIdx?: number | null
  gaps?: GapInput[]
  height?: number
}>(), { height: 300, splitIdx: null, gaps: () => [] })

const host = ref<HTMLElement | null>(null)
const w = ref(900)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!host.value) return
  ro = new ResizeObserver((es) => { const cw = es[0]?.contentRect.width; if (cw && cw > 40) w.value = Math.round(cw) })
  ro.observe(host.value)
  w.value = Math.round(host.value.clientWidth) || 900
})
onBeforeUnmount(() => ro?.disconnect())

const box = computed<ChartBox>(() => ({ width: w.value, height: props.height, padL: 54, padR: 52, padT: 26, padB: 26 }))
const geo = computed(() => rentBandGeo(props.cols, box.value, props.splitIdx, props.gaps))

const hoverIdx = ref<number | null>(null)
const hoverCol = computed(() => (hoverIdx.value == null ? null : props.cols?.[hoverIdx.value] ?? null))
const hoverX = computed(() => {
  const g = geo.value
  if (!g || hoverIdx.value == null) return null
  const innerW = g.box.width - g.box.padL - g.box.padR
  return +(g.box.padL + (innerW * hoverIdx.value) / (g.cols.length - 1)).toFixed(2)
})
function onMove(e: MouseEvent) {
  const g = geo.value
  if (!g || !host.value) return
  const rect = host.value.getBoundingClientRect()
  const px = e.clientX - rect.left
  const innerW = g.box.width - g.box.padL - g.box.padR
  const i = Math.round(((px - g.box.padL) / innerW) * (g.cols.length - 1))
  hoverIdx.value = Math.min(Math.max(i, 0), g.cols.length - 1)
}
const f1 = (v: number) => v.toFixed(1)
const tipLines = computed(() => {
  const c = hoverCol.value
  if (!c) return []
  const out = [c.month]
  if (c.realized != null) out.push(`已实现 ${f1(c.realized)} 万`)
  if (c.locked != null) out.push(`已锁定 ${f1(c.locked)} 万`)
  if (c.mid != null) out.push(`预计 ${f1(c.mid)} 万`)
  if (c.lo != null && c.hi != null) out.push(`80% 在 ${f1(c.lo)} ~ ${f1(c.hi)}`)
  // 这一列若是够格的到期缺口,气泡里直说是谁走了 —— 图上那三行小字只够写两个名字。
  // 读 geo.gapMarks 不读 props.gaps:阈值只在几何里判一次,气泡与批注不会各显各的。
  const gm = geo.value?.gapMarks.find((x) => x.colIndex === hoverIdx.value)
  if (gm) out.push(gm.tip)
  return out
})
const CJK = /[　-鿿＀-￯]/
const tipW = computed(() => {
  let m = 0
  for (const l of tipLines.value) {
    let px = 0
    for (const ch of l) px += CJK.test(ch) ? 12 : 6.6
    m = Math.max(m, px)
  }
  return Math.ceil(m) + 20
})
const tipH = computed(() => 12 + tipLines.value.length * 16)
const tipX = computed(() => {
  const hx = hoverX.value
  if (hx == null) return 0
  const right = box.value.width - box.value.padR
  return hx + 12 + tipW.value <= right ? hx + 12 : Math.max(box.value.padL, hx - 12 - tipW.value)
})
</script>

<template>
  <div ref="host" class="arb-host" @mousemove="onMove" @mouseleave="hoverIdx = null">
    <svg v-if="geo" class="arb" :width="box.width" :height="box.height" :viewBox="`0 0 ${box.width} ${box.height}`" role="img">
      <!-- 预测段底色:稿上右半边整片浅灰,一眼分出「已经发生」与「还没发生」 -->
      <rect v-if="geo.shade" :x="geo.shade.x" :y="box.padT" :width="geo.shade.w" :height="box.height - box.padT - box.padB" class="arb-shade" />

      <line v-for="t in geo.yTicks" :key="'g' + t.v" :x1="box.padL" :x2="box.width - box.padR" :y1="t.y" :y2="t.y" class="arb-grid" />
      <text v-for="t in geo.yTicks" :key="'y' + t.v" :x="box.padL - 10" :y="t.y + 4" class="arb-ylab">{{ t.label }}</text>
      <text :x="box.padL - 10" :y="box.padT - 8" class="arb-unit">万元</text>

      <path v-if="geo.bandPath" :d="geo.bandPath" class="arb-band" />
      <path v-if="geo.lockedPath" :d="geo.lockedPath" class="arb-locked" />
      <path v-if="geo.midPath" :d="geo.midPath" class="arb-mid" />
      <path v-if="geo.realizedPath" :d="geo.realizedPath" class="arb-real" />

      <!-- 预测起点:竖线 + 标题 + 那一点的值 -->
      <template v-if="geo.splitX != null">
        <line :x1="geo.splitX" :x2="geo.splitX" :y1="box.padT" :y2="box.height - box.padB" class="arb-split" />
        <text :x="geo.splitX + 6" :y="box.padT + 10" class="arb-splitlab">预测起点</text>
      </template>
      <template v-if="geo.startDot">
        <circle :cx="geo.startDot.x" :cy="geo.startDot.y" r="4" class="arb-dot" />
        <text :x="geo.startDot.x - 8" :y="geo.startDot.y - 8" class="arb-startnum">{{ geo.startDot.text }}</text>
      </template>

      <!-- 缺口批注:常态下一点痕迹都不留(用户 2026-09-12:「常态下把那条红色线也去掉」),
           引线连同三行小字都只在悬停到这一列时出现 -->
      <template v-for="(gm, gi) in geo.gapMarks.filter((m) => m.colIndex === hoverIdx)" :key="'g' + gi">
        <line :x1="gm.x" :x2="gm.x" :y1="gm.y" :y2="gm.y + 26" class="arb-gapline" />
        <text v-for="(l, i) in gm.lines" :key="'gm' + gi + '-' + i"
          :x="gm.x - 6" :y="gm.y + 38 + i * 13"
          :class="['arb-gaptext', i === 0 ? 'arb-gapnum' : '']">{{ l }}</text>
      </template>

      <!-- 右端贴线尾的数(已在几何里按 y 拉开,不叠字) -->
      <text v-for="e in geo.endLabels" :key="e.kind" :x="box.width - box.padR + 6" :y="e.y + 4"
        :class="['arb-end', 'arb-end-' + e.kind]">{{ e.text }}</text>

      <text v-for="t in geo.xTicks" :key="'x' + t.i" :x="t.x" :y="box.height - box.padB + 16" class="arb-xlab">{{ t.label.slice(2) }}</text>

      <template v-if="hoverX != null && tipLines.length">
        <line :x1="hoverX" :x2="hoverX" :y1="box.padT" :y2="box.height - box.padB" class="arb-hair" />
        <g :transform="`translate(${tipX}, ${box.padT + 4})`">
          <rect :width="tipW" :height="tipH" rx="8" class="arb-tip" />
          <text v-for="(l, i) in tipLines" :key="i" x="10" :y="20 + i * 16"
            :class="['arb-tiptext', i === 0 ? 'arb-tiptitle' : '']">{{ l }}</text>
        </g>
      </template>
    </svg>
  </div>
</template>

<style scoped>
.arb-host { width: 100%; }
.arb { display: block; }
.arb-shade { fill: #F5F6F9; }
.arb-grid { stroke: #E9EBEF; stroke-width: 1; }
.arb-ylab { fill: #94A3B8; font-size: 11px; text-anchor: end; font-variant-numeric: tabular-nums; }
.arb-unit { fill: #94A3B8; font-size: 10px; text-anchor: end; }
.arb-xlab { fill: #94A3B8; font-size: 11px; text-anchor: middle; }
.arb-band { fill: #BFD8F5; fill-opacity: 0.55; }
.arb-real { fill: none; stroke: #2E7CD6; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.arb-mid { fill: none; stroke: #2E7CD6; stroke-width: 2; stroke-dasharray: 5 4; }
.arb-locked { fill: none; stroke: #98A2B3; stroke-width: 1.6; }
.arb-dot { fill: #2E7CD6; stroke: #fff; stroke-width: 2; }
.arb-startnum { fill: #1C1C1C; font-size: 12px; font-weight: 600; text-anchor: end; font-variant-numeric: tabular-nums; }
.arb-split { stroke: #C6CCD6; stroke-width: 1; stroke-dasharray: 3 3; }
.arb-splitlab { fill: #94A3B8; font-size: 10px; }
.arb-gapline { stroke: #D97757; stroke-width: 1.6; }
.arb-gaptext { fill: #8A9099; font-size: 10px; text-anchor: end; }
.arb-gapnum { fill: #D97757; font-size: 11px; font-weight: 600; }
.arb-end { font-size: 11px; font-variant-numeric: tabular-nums; }
.arb-end-hi, .arb-end-lo { fill: #94A3B8; }
.arb-end-mid { fill: #1C1C1C; font-weight: 600; }
.arb-end-locked { fill: #98A2B3; }
.arb-hair { stroke: #C7D2FE; stroke-width: 1; }
.arb-tip { fill: #1E293B; }
.arb-tiptext { fill: #E2E8F0; font-size: 11px; font-variant-numeric: tabular-nums; }
.arb-tiptitle { fill: #fff; font-weight: 600; font-size: 12px; }
</style>
