<script setup lang="ts">
// 迷你折线(移植 ana-charts.jsx Spark):单序列 + 末点圆点。
import { computed } from 'vue'
import { INK } from './anaFmt'

const props = withDefaults(defineProps<{
  series: number[]
  w?: number
  h?: number
  color?: string
}>(), { w: 96, h: 26, color: INK })

const lo = computed(() => Math.min(...props.series))
const hi = computed(() => Math.max(...props.series))
const X = (i: number) => (props.series.length <= 1 ? 0 : (i / (props.series.length - 1)) * props.w)
const Y = (v: number) => (hi.value - lo.value < 1e-6 ? props.h / 2 : props.h - 3 - ((v - lo.value) / (hi.value - lo.value)) * (props.h - 6))
const d = computed(() => props.series.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' '))
</script>

<template>
  <svg :width="w" :height="h" style="display: block">
    <path :d="d" fill="none" :stroke="color" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    <circle :cx="X(series.length - 1)" :cy="Y(series[series.length - 1])" r="2.3" :fill="color" />
  </svg>
</template>
