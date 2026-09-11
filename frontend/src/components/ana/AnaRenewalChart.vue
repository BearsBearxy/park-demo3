<script setup lang="ts">
// 「续签率从哪来」自绘 SVG:堆叠条 + 0~100% 数轴,照 board-expiry 实现,含悬停。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { renewalGeo, type RenewalBox } from '@/views/analysis/renewalChart.logic'

const props = withDefaults(defineProps<{
  hits: number
  n: number
  band?: { lo: number; hi: number } | null
  height?: number
}>(), { band: null, height: 108 })

const host = ref<HTMLElement | null>(null)
const w = ref(560)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!host.value) return
  ro = new ResizeObserver((es) => { const cw = es[0]?.contentRect.width; if (cw && cw > 40) w.value = Math.round(cw) })
  ro.observe(host.value)
  w.value = Math.round(host.value.clientWidth) || 560
})
onBeforeUnmount(() => ro?.disconnect())

const box = computed<RenewalBox>(() => ({ width: w.value, height: props.height, padL: 6, padR: 6 }))
const geo = computed(() => renewalGeo(props.hits, props.n, props.band, box.value))

// 悬停:落在堆叠条上报「哪一段、多少份、占几成」;落在数轴上报区间与观测值。
const hover = ref<'hit' | 'miss' | 'axis' | null>(null)
function onMove(e: MouseEvent) {
  const g = geo.value
  if (!g || !host.value) return
  const r = host.value.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  if (y >= g.bar.y && y <= g.bar.y + g.bar.h) hover.value = x <= g.bar.x + g.bar.hitW ? 'hit' : 'miss'
  else hover.value = 'axis'
}
const pct = computed(() => (props.n > 0 ? (props.hits / props.n) * 100 : 0))
const tipLines = computed(() => {
  const g = geo.value
  if (!g || !hover.value) return []
  if (hover.value === 'hit') return ['续签', `${props.hits} 份 / 共 ${props.n} 份`, `占 ${pct.value.toFixed(1)}%`]
  if (hover.value === 'miss') return ['未续签', `${props.n - props.hits} 份 / 共 ${props.n} 份`, `占 ${(100 - pct.value).toFixed(1)}%`]
  const out = ['续签率', `观测 ${pct.value.toFixed(1)}%`]
  if (props.band) out.push(`80% 落在 ${Math.round(props.band.lo * 100)}% ~ ${Math.round(props.band.hi * 100)}%`)
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
  const g = geo.value
  if (!g) return 0
  const anchor = hover.value === 'miss' ? g.bar.x + g.bar.hitW + 20 : g.marker ? g.marker.x + 12 : g.bar.x + 20
  return Math.min(Math.max(anchor, 0), box.value.width - tipW.value)
})
</script>

<template>
  <div ref="host" class="arn-host" @mousemove="onMove" @mouseleave="hover = null">
    <svg v-if="geo" class="arn" :width="box.width" :height="box.height" :viewBox="`0 0 ${box.width} ${box.height}`" role="img">
      <!-- 堆叠条:蓝=续签,灰=未续签 -->
      <rect :x="geo.bar.x" :y="geo.bar.y" :width="geo.bar.totalW" :height="geo.bar.h" rx="4" class="arn-track" />
      <rect :x="geo.bar.x" :y="geo.bar.y" :width="geo.bar.hitW" :height="geo.bar.h" rx="4" class="arn-hit" />
      <text :x="geo.barLabels.hit.x" :y="geo.barLabels.hit.y" class="arn-hitlab">{{ geo.barLabels.hit.text }}</text>
      <text v-if="geo.barLabels.miss" :x="geo.barLabels.miss.x" :y="geo.barLabels.miss.y" class="arn-misslab">{{ geo.barLabels.miss.text }}</text>

      <!-- 数轴:区间色块 + 轴线 + 刻度 + 观测值竖线 -->
      <rect v-if="geo.band" :x="geo.band.x" :y="geo.axis.y - 13" :width="geo.band.w" height="26" class="arn-band" />
      <line :x1="geo.axis.x0" :x2="geo.axis.x1" :y1="geo.axis.y" :y2="geo.axis.y" class="arn-axis" />
      <template v-if="geo.marker">
        <line :x1="geo.marker.x" :x2="geo.marker.x" :y1="geo.axis.y - 13" :y2="geo.axis.y + 13" class="arn-marker" />
      </template>
      <text v-for="t in geo.ticks" :key="t.v" :x="t.x" :y="geo.axis.y + 26"
        :class="['arn-tick', t.strong ? 'arn-tick-strong' : '']">{{ t.label }}</text>

      <template v-if="tipLines.length">
        <g :transform="`translate(${tipX}, 0)`">
          <rect :width="tipW" :height="tipH" rx="8" class="arn-tip" />
          <text v-for="(l, i) in tipLines" :key="i" x="10" :y="20 + i * 16"
            :class="['arn-tiptext', i === 0 ? 'arn-tiptitle' : '']">{{ l }}</text>
        </g>
      </template>
    </svg>
  </div>
</template>

<style scoped>
.arn-host { width: 100%; }
.arn { display: block; }
.arn-track { fill: #E9EBEF; }
.arn-hit { fill: #2E7CD6; }
.arn-hitlab { fill: #fff; font-size: 12px; font-weight: 600; }
.arn-misslab { fill: #6B7280; font-size: 12px; }
.arn-band { fill: #BFD8F5; fill-opacity: 0.6; }
.arn-axis { stroke: #D7DBE2; stroke-width: 1; }
.arn-marker { stroke: #185FA5; stroke-width: 2; }
.arn-tick { fill: #94A3B8; font-size: 11px; text-anchor: middle; font-variant-numeric: tabular-nums; }
.arn-tick-strong { fill: #1C1C1C; font-weight: 600; font-size: 12px; }
.arn-tip { fill: #1E293B; }
.arn-tiptext { fill: #E2E8F0; font-size: 11px; font-variant-numeric: tabular-nums; }
.arn-tiptitle { fill: #fff; font-weight: 600; font-size: 12px; }
</style>
