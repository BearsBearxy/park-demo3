<script setup lang="ts">
// 气泡散点(移植 ana-charts.jsx Scatter):强度 vs 规模,含均值参考线 + hover 提示。
import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { FILL, fint, fnum, WARN } from './anaFmt'
import './ana.css'

export interface ScatterPoint {
  x: number; y: number; r?: number; label?: string; color?: string
  extra?: { k: string; v: string }
}

const props = withDefaults(defineProps<{
  points: ScatterPoint[]
  xLabel?: string
  yLabel?: string
  xFmt?: (v: number) => string
  yFmt?: (v: number) => string
  benchmark?: { x?: number | null; y?: number | null }
  height?: number
  rMax?: number
}>(), { xLabel: '', yLabel: '', height: 300, rMax: 16 })

const { el, width: w } = useWidth(520)
const hi = ref<number | null>(null)
const xf = computed(() => props.xFmt ?? ((v: number) => fint(v)))
const yf = computed(() => props.yFmt ?? ((v: number) => fnum(v, 1)))

const padL = 40, padR = 16, padT = 12, padB = 34
const dom = computed(() => {
  const xs = props.points.map((p) => p.x), ys = props.points.map((p) => p.y)
  let xlo = xs.length ? Math.min(...xs) : 0, xhi = xs.length ? Math.max(...xs) : 1
  const xp = (xhi - xlo) * 0.12 || 1; xlo -= xp; xhi += xp
  let ylo = ys.length ? Math.min(...ys) : 0, yhi = ys.length ? Math.max(...ys) : 1
  const yp = (yhi - ylo) * 0.14 || 1; ylo -= yp; yhi += yp
  const rs = props.points.map((p) => p.r ?? 1)
  return { xlo, xhi, ylo, yhi, rlo: rs.length ? Math.min(...rs) : 0, rhi: rs.length ? Math.max(...rs) : 1 }
})
const iw = computed(() => Math.max(40, w.value - padL - padR))
const ih = computed(() => props.height - padT - padB)
const X = (v: number) => padL + (v - dom.value.xlo) / (dom.value.xhi - dom.value.xlo) * iw.value
const Y = (v: number) => padT + (1 - (v - dom.value.ylo) / (dom.value.yhi - dom.value.ylo)) * ih.value
const Rr = (v: number) => 4 + (dom.value.rhi > dom.value.rlo ? (v - dom.value.rlo) / (dom.value.rhi - dom.value.rlo) : 0) * (props.rMax - 4)
const tipPoint = computed(() => (hi.value == null ? null : props.points[hi.value]))
const WARN_ = WARN
const FILLS = FILL
</script>

<template>
  <div ref="el" style="position: relative; width: 100%">
    <svg :width="w" :height="height" style="display: block; overflow: visible">
      <line v-for="t in [0, 0.5, 1]" :key="'h' + t" :x1="padL" :x2="w - padR" :y1="padT + t * ih" :y2="padT + t * ih" stroke="var(--divider)" stroke-width="1" />
      <g v-if="benchmark && benchmark.y != null">
        <line :x1="padL" :x2="w - padR" :y1="Y(benchmark.y)" :y2="Y(benchmark.y)" :stroke="WARN_" stroke-width="1.2" stroke-dasharray="5 4" />
        <text :x="w - padR" :y="Y(benchmark.y) - 4" font-size="9.5" :fill="WARN_" text-anchor="end">均值 {{ yf(benchmark.y) }}</text>
      </g>
      <line v-if="benchmark && benchmark.x != null" :x1="X(benchmark.x)" :x2="X(benchmark.x)" :y1="padT" :y2="padT + ih" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="3 3" />
      <g v-for="(p, i) in points" :key="i" style="cursor: pointer" @mouseenter="hi = i" @mouseleave="hi = null">
        <circle :cx="X(p.x)" :cy="Y(p.y)" :r="Rr(p.r ?? 1)" :fill="p.color || FILLS[1]" :fill-opacity="hi === i ? 0.85 : 0.5" :stroke="p.color || FILLS[1]" stroke-width="1.3" />
      </g>
      <text :x="padL" :y="height - 6" font-size="9.5" fill="var(--text-muted)">{{ xf(dom.xlo) }}</text>
      <text :x="w - padR" :y="height - 6" font-size="9.5" fill="var(--text-muted)" text-anchor="end">{{ xLabel }} →</text>
      <text :x="padL - 4" :y="padT + 4" font-size="9.5" fill="var(--text-muted)" text-anchor="end"
        :transform="`rotate(-90 ${padL - 28} ${padT + ih / 2})`">{{ yLabel }} →</text>
    </svg>
    <div v-if="tipPoint" class="cz-tip" :style="{ left: Math.min(w - 150, X(tipPoint.x) + 10) + 'px', top: Math.max(0, Y(tipPoint.y) - 20) + 'px' }">
      <div class="h">{{ tipPoint.label }}</div>
      <div class="r"><span class="nm">{{ yLabel }}</span><span class="vv">{{ yf(tipPoint.y) }}</span></div>
      <div class="r"><span class="nm">{{ xLabel }}</span><span class="vv">{{ xf(tipPoint.x) }}</span></div>
      <div v-if="tipPoint.extra" class="r"><span class="nm">{{ tipPoint.extra.k }}</span><span class="vv">{{ tipPoint.extra.v }}</span></div>
    </div>
  </div>
</template>
