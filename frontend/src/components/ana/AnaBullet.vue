<script setup lang="ts">
// 子弹图(移植 ana-charts.jsx Bullet):实际 vs 目标线。
import { computed } from 'vue'
import { useWidth } from './useWidth'
import { fnum, INK, POS, WARN } from './anaFmt'

export interface BulletRow { name: string; value: number; target?: number; color?: string }

const props = withDefaults(defineProps<{
  rows: BulletRow[]
  max?: number
  target?: number
  unit?: string
  height?: number
}>(), { unit: '%' })

const { el, width: w } = useWidth(480)
const padL = 96, padR = 56, rowH = 30
const iw = computed(() => Math.max(40, w.value - padL - padR))
const mx = computed(() =>
  props.max ?? Math.max(...props.rows.map((r) => Math.max(r.value, r.target ?? props.target ?? 0))) * 1.1)
const X = (v: number) => padL + Math.min(1, v / mx.value) * iw.value
const H = computed(() => props.height ?? props.rows.length * rowH + 10)
const targetOf = (r: BulletRow) => r.target ?? props.target
const colOf = (r: BulletRow) => r.color ?? (r.value >= (targetOf(r) ?? 0) ? POS : WARN)
const INK_ = INK
</script>

<template>
  <div ref="el" style="position: relative; width: 100%">
    <svg :width="w" :height="H" style="display: block; overflow: visible">
      <g v-for="(r, i) in rows" :key="i">
        <text :x="padL - 10" :y="8 + i * rowH + rowH / 2" font-size="11.5" fill="var(--text-primary)" text-anchor="end">{{ r.name }}</text>
        <rect :x="padL" :y="8 + i * rowH + rowH / 2 - 10" :width="iw" height="12" rx="6" fill="var(--ink-050)" />
        <rect :x="padL" :y="8 + i * rowH + rowH / 2 - 10" :width="Math.max(2, X(r.value) - padL)" height="12" rx="6" :fill="colOf(r)" />
        <line v-if="targetOf(r) != null" :x1="X(targetOf(r)!)" :x2="X(targetOf(r)!)"
          :y1="8 + i * rowH + rowH / 2 - 14" :y2="8 + i * rowH + rowH / 2 + 6" :stroke="INK_" stroke-width="2" />
        <text :x="w - padR + 8" :y="8 + i * rowH + rowH / 2" font-size="11" fill="var(--text-primary)" font-family="var(--font-mono)" font-weight="600">
          {{ fnum(r.value, r.value % 1 ? 1 : 0) }}{{ unit }}</text>
      </g>
    </svg>
    <div v-if="target != null" class="ana-bullet-target">
      <span :style="{ width: '2px', height: '11px', background: INK_, display: 'inline-block' }"></span>目标线 {{ target }}{{ unit }}
    </div>
  </div>
</template>

<style scoped>
.ana-bullet-target { font-size: var(--fs-micro); color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-top: 2px; }
</style>
