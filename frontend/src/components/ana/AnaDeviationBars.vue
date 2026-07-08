<script setup lang="ts">
// 偏离均值的横向发散条(移植 ana-charts.jsx DeviationBars):±σ 参考带 + z 着色。
import { computed } from 'vue'
import { useWidth } from './useWidth'
import { fnum, NEG, POS, sgn, WARN } from './anaFmt'

export interface DeviationItem { name: string; value: number }

const props = withDefaults(defineProps<{
  items: DeviationItem[]
  mean: number
  std: number
  unit?: string
  fmt?: (v: number) => string
  rowH?: number
  height?: number
}>(), { unit: '', rowH: 26 })

const { el, width: w } = useWidth(520)
const f = computed(() => props.fmt ?? ((v: number) => fnum(v, 1) + props.unit))

const padL = 100, padR = 52, padT = 6, padB = 16
const maxDev = computed(() => {
  const devs = props.items.map((it) => Math.abs(it.value - props.mean))
  return Math.max(props.std * 2.2, devs.length ? Math.max(...devs) : 0) || 1
})
const iw = computed(() => Math.max(40, w.value - padL - padR))
const mid = computed(() => padL + iw.value / 2)
const X = (d: number) => mid.value + (d / maxDev.value) * (iw.value / 2)
const H = computed(() => props.height ?? props.items.length * props.rowH + padT + padB)
const sigW = computed(() => (props.std / maxDev.value) * (iw.value / 2))
const zOf = (v: number) => (props.std ? (v - props.mean) / props.std : 0)
const colOf = (v: number) => {
  const d = v - props.mean, z = zOf(v)
  return Math.abs(z) >= 1.5 ? (d >= 0 ? NEG : POS) : Math.abs(z) >= 1 ? WARN : 'var(--fill-slate)'
}
</script>

<template>
  <div ref="el" style="position: relative; width: 100%">
    <svg :width="w" :height="H" style="display: block; overflow: visible">
      <rect :x="mid - sigW" :y="padT" :width="sigW * 2" :height="H - padT - padB" fill="var(--ink-050)" />
      <rect :x="mid - sigW * 2" :y="padT" :width="sigW * 4" :height="H - padT - padB" fill="var(--ink-040)" />
      <line :x1="mid" :x2="mid" :y1="padT" :y2="H - padB" stroke="var(--border-strong)" stroke-width="1.2" />
      <text :x="mid" :y="H - 4" font-size="9" fill="var(--text-muted)" text-anchor="middle">均值 {{ f(mean) }}</text>
      <text :x="mid + sigW" :y="padT + 8" font-size="8.5" fill="var(--text-disabled)" text-anchor="middle">+1σ</text>
      <text :x="mid - sigW" :y="padT + 8" font-size="8.5" fill="var(--text-disabled)" text-anchor="middle">−1σ</text>
      <g v-for="(it, i) in items" :key="i">
        <text :x="padL - 8" :y="padT + i * rowH + rowH / 2 + 3.5" font-size="11" fill="var(--text-primary)" text-anchor="end">{{ it.name }}</text>
        <rect :x="it.value - mean >= 0 ? mid : X(it.value - mean)" :y="padT + i * rowH + rowH / 2 - 7"
          :width="Math.max(1.5, Math.abs(X(it.value - mean) - mid))" height="14" rx="3" :fill="colOf(it.value)" />
        <text :x="it.value - mean >= 0 ? X(it.value - mean) + 5 : X(it.value - mean) - 5" :y="padT + i * rowH + rowH / 2 + 3.5"
          font-size="10" :fill="Math.abs(zOf(it.value)) >= 1 ? colOf(it.value) : 'var(--text-muted)'"
          :text-anchor="it.value - mean >= 0 ? 'start' : 'end'" font-family="var(--font-mono)" font-weight="600">{{ sgn(zOf(it.value), 1, 'σ') }}</text>
      </g>
    </svg>
  </div>
</template>
