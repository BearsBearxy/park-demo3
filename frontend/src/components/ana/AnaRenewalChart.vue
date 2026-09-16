<script setup lang="ts">
// 「续签率从哪来」自绘 SVG:堆叠条 + 0~100% 数轴,照 board-expiry 实现,含悬停。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { renewalGeo, type RenewalBox } from '@/views/analysis/renewalChart.logic'
import { useEnterPhase } from './anaMotion'
import './ana.css'   // @keyframes fp-wipe

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

// 首绘擦入(C6-25):合同快照无期,只有 RO 改宽,更新永远瞬算。
const first = useEnterPhase(host)

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
      <!-- 数轴的尺子部分:区间色块 + 轴线 + 刻度。留在数据组外先在(C6-25) -->
      <rect v-if="geo.band" :x="geo.band.x" :y="geo.axis.y - 13" :width="geo.band.w" height="26" class="arn-band" />
      <line :x1="geo.axis.x0" :x2="geo.axis.x1" :y1="geo.axis.y" :y2="geo.axis.y" class="arn-axis" />
      <text v-for="t in geo.ticks" :key="t.v" :x="t.x" :y="geo.axis.y + 26"
        :class="['arn-tick', t.strong ? 'arn-tick-strong' : '']">{{ t.label }}</text>

      <!-- 数据组:首进屏擦入一次(C6-25),条与观测竖线一起自左露出 -->
      <g class="arn-data" :class="{ first }" @animationend.self="first = false">
        <!-- 堆叠条:蓝=续签,灰=未续签 -->
        <rect :x="geo.bar.x" :y="geo.bar.y" :width="geo.bar.totalW" :height="geo.bar.h" rx="4" class="arn-track" />
        <rect :x="geo.bar.x" :y="geo.bar.y" :width="geo.bar.hitW" :height="geo.bar.h" rx="4" class="arn-hit" />
        <text :x="geo.barLabels.hit.x" :y="geo.barLabels.hit.y"
          :class="geo.barLabels.hit.inside ? 'arn-hitlab' : 'arn-hitlab-out'">{{ geo.barLabels.hit.text }}</text>
        <text v-if="geo.barLabels.miss" :x="geo.barLabels.miss.x" :y="geo.barLabels.miss.y" class="arn-misslab">{{ geo.barLabels.miss.text }}</text>

        <!-- 观测值竖线 -->
        <template v-if="geo.marker">
          <line :x1="geo.marker.x" :x2="geo.marker.x" :y1="geo.axis.y - 13" :y2="geo.axis.y + 13" class="arn-marker" />
        </template>
      </g>

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
/* 首绘:数据组自左擦出一次(C6-25);fp-wipe 在 ana.css,不能写进 scoped(名字会被加 hash) */
.arn-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
.arn-track { fill: #E9EBEF; }
.arn-hit { fill: #2E7CD6; }
.arn-hitlab { fill: #fff; font-size: 12px; font-weight: 600; }
.arn-hitlab-out { fill: #185FA5; font-size: 12px; font-weight: 600; }
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
