<script setup lang="ts">
// 「单位租金对标」直方图,自绘 SVG,照 board-peer 实现,含悬停。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { unitRentHistGeo, type HistBinIn } from '@/views/analysis/unitRentHistChart.logic'
import type { ChartBox } from '@/views/analysis/forecastChart.logic'

const props = withDefaults(defineProps<{
  bins: HistBinIn[] | null
  capHi: number
  overflowCount: number
  overflowMax: number
  stats: { p10: number; median: number; p90: number } | null
  selfValue: number | null
  selfName: string
  height?: number
}>(), { height: 280 })

const host = ref<HTMLElement | null>(null)
const w = ref(700)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!host.value) return
  ro = new ResizeObserver((es) => { const cw = es[0]?.contentRect.width; if (cw && cw > 40) w.value = Math.round(cw) })
  ro.observe(host.value)
  w.value = Math.round(host.value.clientWidth) || 700
})
onBeforeUnmount(() => ro?.disconnect())

const box = computed<ChartBox>(() => ({ width: w.value, height: props.height, padL: 40, padR: 20, padT: 30, padB: 46 }))
const geo = computed(() => unitRentHistGeo(
  props.bins, props.capHi, props.overflowCount, props.overflowMax, props.stats, props.selfValue, props.selfName, box.value))

const hoverI = ref<number | null>(null)
const hoverBar = computed(() => (hoverI.value == null ? null : geo.value?.bars[hoverI.value] ?? null))
function onMove(e: MouseEvent) {
  const g = geo.value
  if (!g || !host.value) return
  const px = e.clientX - host.value.getBoundingClientRect().left
  const i = g.bars.findIndex((b) => px >= b.x - 1 && px <= b.x + b.w + 1)
  hoverI.value = i >= 0 ? i : null
}
const tipLines = computed(() => {
  const b = hoverBar.value
  if (!b) return []
  const head = b.overflow ? `> ${Math.round(b.lo)} 元/㎡·月` : `${b.lo.toFixed(1)} ~ ${b.hi.toFixed(1)} 元/㎡·月`
  const out = [head, `${b.count} 户`]
  if (b.overflow) out.push(`最高 ${props.overflowMax.toFixed(1)}`)
  else out.push(b.inBand ? '在 80% 区间内' : '在区间外')
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
  const b = hoverBar.value
  if (!b) return 0
  const right = box.value.width - box.value.padR
  return b.x + b.w + 10 + tipW.value <= right ? b.x + b.w + 10 : Math.max(box.value.padL, b.x - 10 - tipW.value)
})
</script>

<template>
  <div ref="host" class="auh-host" @mousemove="onMove" @mouseleave="hoverI = null">
    <svg v-if="geo" class="auh" :width="box.width" :height="box.height" :viewBox="`0 0 ${box.width} ${box.height}`" role="img">
      <line v-for="t in geo.yTicks" :key="'g' + t.v" :x1="box.padL" :x2="box.width - box.padR" :y1="t.y" :y2="t.y" class="auh-grid" />
      <text v-for="t in geo.yTicks" :key="'y' + t.v" :x="box.padL - 8" :y="t.y + 4" class="auh-ylab">{{ t.label }}</text>

      <!-- p10~p90 底色块:稿上那一片浅蓝,柱子压在上面 -->
      <rect v-if="geo.bandRect" :x="geo.bandRect.x" :y="box.padT" :width="geo.bandRect.w"
        :height="box.height - box.padT - box.padB" class="auh-bandrect" />

      <rect v-for="(b, i) in geo.bars" :key="'b' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h"
        :class="['auh-bar', b.overflow ? 'auh-bar-of' : b.inBand ? 'auh-bar-in' : 'auh-bar-out', hoverI === i ? 'auh-bar-hot' : '']" />

      <!-- p10 / 中位 / p90 -->
      <template v-for="m in geo.marks" :key="m.kind">
        <line :x1="m.x" :x2="m.x" :y1="box.padT" :y2="box.height - box.padB" class="auh-mark" />
        <text :x="m.x" :y="box.height - box.padB + 16" :class="['auh-marklab', m.kind === 'median' ? 'auh-marklab-mid' : '']">{{ m.label }}</text>
      </template>

      <!-- 本户:一条竖线 + 顶上的点 + 名字 -->
      <template v-if="geo.self">
        <line :x1="geo.self.x" :x2="geo.self.x" :y1="box.padT" :y2="box.height - box.padB" class="auh-self" />
        <circle :cx="geo.self.x" :cy="geo.self.dotY" r="4" class="auh-selfdot" />
        <text :x="geo.self.x" :y="box.padT - 10" class="auh-selflab">{{ geo.self.label }}</text>
      </template>

      <text v-if="geo.bandCaption" :x="geo.bandCaption.x" :y="geo.bandCaption.y" class="auh-cap">80% 的同类在这段</text>
      <text v-if="geo.overflowNote" :x="box.width - box.padR" :y="geo.bandCaption ? geo.bandCaption.y : box.height - 6" class="auh-of">{{ geo.overflowNote }}</text>

      <template v-if="tipLines.length && hoverBar">
        <g :transform="`translate(${tipX}, ${box.padT})`">
          <rect :width="tipW" :height="tipH" rx="8" class="auh-tip" />
          <text v-for="(l, i) in tipLines" :key="i" x="10" :y="20 + i * 16"
            :class="['auh-tiptext', i === 0 ? 'auh-tiptitle' : '']">{{ l }}</text>
        </g>
      </template>
    </svg>
  </div>
</template>

<style scoped>
.auh-host { width: 100%; }
.auh { display: block; }
.auh-grid { stroke: #EEF0F4; stroke-width: 1; }
.auh-ylab { fill: #94A3B8; font-size: 11px; text-anchor: end; font-variant-numeric: tabular-nums; }
.auh-bandrect { fill: #DCEAFB; fill-opacity: 0.55; }
.auh-bar { transition: none; }
.auh-bar-in { fill: #6AA9E9; }
.auh-bar-out { fill: #C8CDD6; }
.auh-bar-of { fill: #C8CDD6; }
.auh-bar-hot { fill: #185FA5; }
.auh-mark { stroke: #9AA4B2; stroke-width: 1; stroke-dasharray: 3 3; }
.auh-marklab { fill: #94A3B8; font-size: 11px; text-anchor: middle; font-variant-numeric: tabular-nums; }
.auh-marklab-mid { fill: #6B7280; }
.auh-self { stroke: #1C1C1C; stroke-width: 1.5; }
.auh-selfdot { fill: #1C1C1C; }
.auh-selflab { fill: #1C1C1C; font-size: 12px; font-weight: 600; text-anchor: middle; }
.auh-cap { fill: #4F79A8; font-size: 11px; text-anchor: middle; }
.auh-of { fill: #94A3B8; font-size: 11px; text-anchor: end; }
.auh-tip { fill: #1E293B; }
.auh-tiptext { fill: #E2E8F0; font-size: 11px; font-variant-numeric: tabular-nums; }
.auh-tiptitle { fill: #fff; font-weight: 600; font-size: 12px; }
</style>
