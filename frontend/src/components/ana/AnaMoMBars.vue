<script setup lang="ts">
// 环比变化柱(移植 ana-kit.jsx MoMBars):零轴居中,蓝增/红减;series 传原值,内部算环比%。
import { computed, ref } from 'vue'
import { useWidth } from './useWidth'

const props = withDefaults(defineProps<{
  labels: string[]
  series: number[]
  height?: number
  unit?: string
}>(), { height: 150, unit: '%' })

const { el, width: w } = useWidth(440)
const hi = ref<number | null>(null)

const moms = computed(() => props.series.map((v, i) => (i === 0 ? 0 : props.series[i - 1] ? (v / props.series[i - 1] - 1) * 100 : 0)))
const data = computed(() => moms.value.slice(1))
const labs = computed(() => props.labels.slice(1))
const maxAbs = computed(() => Math.max(1, ...data.value.map((d) => Math.abs(d))))
const n = computed(() => data.value.length)
const gap = 6
const bw = computed(() => Math.max(6, (w.value - gap * (n.value - 1)) / n.value))
const mid = computed(() => props.height / 2)
</script>

<template>
  <div ref="el" :style="{ position: 'relative', width: '100%', height: height + 16 + 'px' }" @mouseleave="hi = null">
    <svg :width="w" :height="height + 16" style="display: block; overflow: visible">
      <line x1="0" :x2="w" :y1="mid" :y2="mid" stroke="var(--border-strong)" stroke-width="1" />
      <g v-for="(d, i) in data" :key="i" @mouseenter="hi = i">
        <rect :x="i * (bw + gap)" :y="d >= 0 ? mid - (Math.abs(d) / maxAbs) * (mid - 8) : mid"
          :width="bw" :height="Math.max(1, (Math.abs(d) / maxAbs) * (mid - 8))" :rx="Math.min(4, bw / 2)"
          :fill="hi === i ? (d >= 0 ? 'var(--fill-slate)' : 'rgb(220,40,30)') : (d >= 0 ? 'var(--fill-blue)' : 'var(--hue-red)')" />
        <text :x="i * (bw + gap) + bw / 2" :y="height + 12" font-size="9.5" fill="var(--text-muted)" text-anchor="middle">{{ labs[i] }}</text>
      </g>
    </svg>
    <div v-if="hi != null" class="ana-mom-tip" :style="{ left: Math.max(0, Math.min(w - 90, hi * (bw + gap) + bw / 2 - 45)) + 'px' }">
      <div style="opacity: 0.7">{{ labs[hi] }}</div>
      <div class="vv">{{ data[hi] >= 0 ? '+' : '−' }}{{ Math.abs(data[hi]).toFixed(1) }}{{ unit }}</div>
    </div>
  </div>
</template>

<style scoped>
.ana-mom-tip { position: absolute; top: 0; width: 90px; text-align: center; pointer-events: none; background: rgb(40,52,66); color: #fff; border-radius: 8px; padding: 5px 8px; font-size: 11px; }
.ana-mom-tip .vv { font-family: var(--font-mono); font-weight: 700; font-size: 13px; }
</style>
