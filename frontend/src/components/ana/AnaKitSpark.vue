<script setup lang="ts">
// 迷你 sparkline(移植 ana-kit.jsx Spark):今年实线 + 去年虚线可选。
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  cur: number[]
  prev?: number[] | null
  w?: number
  h?: number
}>(), { w: 88, h: 26 })

const all = computed(() => (props.prev ?? []).concat(props.cur))
const lo = computed(() => Math.min(...all.value))
const hi = computed(() => Math.max(...all.value))
const X = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * props.w)
const Y = (v: number) => (hi.value - lo.value < 1e-6 ? props.h / 2 : props.h - 4 - ((v - lo.value) / (hi.value - lo.value)) * (props.h - 8))
const path = (a: number[]) => a.map((v, i) => (i ? 'L' : 'M') + X(i, a.length).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')
const col = 'var(--ink-900)'
</script>

<template>
  <svg :width="w" :height="h" style="display: block; overflow: visible">
    <path v-if="prev && prev.length" :d="path(prev)" fill="none" stroke="rgb(170,172,178)" stroke-width="1.4" stroke-dasharray="3 3" />
    <path :d="path(cur)" fill="none" :stroke="col" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <circle :cx="X(cur.length - 1, cur.length)" :cy="Y(cur[cur.length - 1])" r="2.6" :fill="col" />
  </svg>
</template>
