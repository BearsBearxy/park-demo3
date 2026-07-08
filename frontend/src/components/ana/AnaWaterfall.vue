<script setup lang="ts">
// 瀑布图(移植 ana-charts.jsx Waterfall):利润/收款逐项拆解;start/end 墨色,inc 蓝 dec 红。
import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { fint, INK, POS } from './anaFmt'
import './ana.css'

export interface WaterfallItem { name: string; value: number; type: 'start' | 'end' | 'inc' | 'dec' }

const props = withDefaults(defineProps<{
  items: WaterfallItem[]
  unit?: string
  height?: number
  fmt?: (v: number) => string
}>(), { unit: '万', height: 260 })

const { el, width: w } = useWidth(560)
const hi = ref<number | null>(null)
const f = computed(() => props.fmt ?? ((v: number) => '¥' + fint(v) + props.unit))

const padT = 22, padB = 46, padL = 4, padR = 4

interface Bar extends WaterfallItem { y0: number; y1: number; lo: number; hi: number }
const bars = computed<Bar[]>(() => {
  let run = 0
  return props.items.map((it) => {
    let y0: number, y1: number
    if (it.type === 'start' || it.type === 'end') { y0 = 0; y1 = it.value; run = it.value }
    else { y0 = run; run += it.value; y1 = run }
    return { ...it, y0, y1, lo: Math.min(y0, y1), hi: Math.max(y0, y1) }
  })
})
const maxV = computed(() => Math.max(...bars.value.map((b) => b.hi), 0))
const minV = computed(() => Math.min(...bars.value.map((b) => b.lo), 0))
const innerH = computed(() => props.height - padT - padB)
const Y = (v: number) => padT + (1 - (v - minV.value) / ((maxV.value - minV.value) || 1)) * innerH.value
const n = computed(() => bars.value.length)
const gap = 10
const bw = computed(() => Math.max(14, (w.value - padL - padR - gap * (n.value - 1)) / n.value))
const colorOf = (t: Bar['type']) =>
  t === 'start' || t === 'end' ? INK : t === 'inc' ? POS : t === 'dec' ? 'rgb(232,120,110)' : 'var(--fill-slate)'
const tipBar = computed(() => (hi.value == null ? null : bars.value[hi.value]))
</script>

<template>
  <div ref="el" style="position: relative; width: 100%">
    <svg :width="w" :height="height" style="display: block; overflow: visible">
      <line :x1="padL" :x2="w - padR" :y1="Y(0)" :y2="Y(0)" stroke="var(--border-strong)" stroke-width="1" />
      <g v-for="(b, i) in bars" :key="i" @mouseenter="hi = i" @mouseleave="hi = null">
        <line v-if="i < n - 1" :x1="padL + i * (bw + gap) + bw" :x2="padL + i * (bw + gap) + bw + gap"
          :y1="Y(b.y1)" :y2="Y(b.y1)" stroke="var(--border-strong)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="2 2" />
        <rect :x="padL + i * (bw + gap)" :y="Y(b.hi)" :width="bw" :height="Math.max(2, Math.abs(Y(b.lo) - Y(b.hi)))" rx="3"
          :fill="colorOf(b.type)" :opacity="hi == null || hi === i ? 1 : 0.55" />
        <text :x="padL + i * (bw + gap) + bw / 2" :y="Y(b.hi) - 5" font-size="10" fill="var(--text-secondary)"
          text-anchor="middle" font-family="var(--font-mono)" font-weight="600">{{ b.type === 'dec' ? '−' : b.type === 'inc' ? '+' : '' }}{{ fint(Math.abs(b.value)) }}</text>
        <text :x="padL + i * (bw + gap) + bw / 2" :y="height - padB + 14" font-size="9.5" fill="var(--text-muted)" text-anchor="middle">
          {{ b.name.length > 5 ? b.name.slice(0, 4) : b.name }}</text>
        <text v-if="b.name.length > 5" :x="padL + i * (bw + gap) + bw / 2" :y="height - padB + 26" font-size="9.5" fill="var(--text-muted)" text-anchor="middle">
          {{ b.name.slice(4, 9) }}</text>
      </g>
    </svg>
    <div v-if="tipBar && hi != null" class="cz-tip"
      :style="{ left: Math.min(w - 130, Math.max(0, padL + hi * (bw + gap) + bw / 2 - 60)) + 'px', top: Math.max(0, Y(tipBar.hi) - 52) + 'px' }">
      <div class="h">{{ tipBar.name }}</div>
      <div class="r"><span class="nm">{{ tipBar.type === 'dec' ? '减项' : tipBar.type === 'inc' ? '加项' : '金额' }}</span><span class="vv">{{ f(tipBar.value) }}</span></div>
      <div v-if="tipBar.type !== 'start' && tipBar.type !== 'end'" class="r"><span class="nm">累计</span><span class="vv">{{ f(tipBar.y1) }}</span></div>
    </div>
  </div>
</template>
