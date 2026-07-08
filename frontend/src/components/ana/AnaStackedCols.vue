<script setup lang="ts">
// 堆叠/分组柱(移植 ana-charts.jsx StackedCols):多期×多类;mode='group' 即原型 GroupBars。
import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { fint } from './anaFmt'
import './ana.css'

export interface StackSeries { name: string; color: string; values: number[] }

const props = withDefaults(defineProps<{
  periods: string[]
  series: StackSeries[]
  unit?: string
  height?: number
  fmt?: (v: number) => string
  mode?: 'stack' | 'group'
}>(), { unit: '万', height: 220, mode: 'stack' })

const { el, width: w } = useWidth(480)
const hi = ref<number | null>(null)
const f = computed(() => props.fmt ?? ((v: number) => fint(v) + props.unit))

const padT = 14, padB = 26, padL = 4, padR = 4
const gap = 26
const n = computed(() => props.periods.length)
const totals = computed(() => props.periods.map((_, pi) => props.series.reduce((s, sr) => s + Math.abs(sr.values[pi] ?? 0), 0)))
const grpMax = computed(() =>
  props.mode === 'group'
    ? Math.max(...props.series.flatMap((sr) => sr.values), 0)
    : Math.max(...totals.value, 0))
const ih = computed(() => props.height - padT - padB)
const gw = computed(() => Math.max(24, (w.value - padL - padR - gap * (n.value - 1)) / n.value))
const Y = (v: number) => (v / (grpMax.value || 1)) * ih.value

// stack 模式:每期每层的 [y, h] 预算
const stackRects = computed(() =>
  props.periods.map((_, pi) => {
    let cum = 0
    return props.series.map((sr) => {
      const h = Y(Math.abs(sr.values[pi] ?? 0))
      const y = padT + ih.value - cum - h
      cum += h
      return { y, h, cum }
    })
  }))
</script>

<template>
  <div ref="el" style="position: relative; width: 100%">
    <svg :width="w" :height="height" style="display: block; overflow: visible">
      <line :x1="padL" :x2="w - padR" :y1="padT + ih" :y2="padT + ih" stroke="var(--border-strong)" stroke-width="1" />
      <template v-if="mode === 'group'">
        <g v-for="(p, pi) in periods" :key="pi" @mouseenter="hi = pi" @mouseleave="hi = null">
          <rect v-for="(sr, si) in series" :key="si"
            :x="padL + pi * (gw + gap) + si * (gw / series.length) + 1" :y="padT + ih - Y(sr.values[pi] ?? 0)"
            :width="gw / series.length - 2" :height="Math.max(1, Y(sr.values[pi] ?? 0))" rx="2"
            :fill="sr.color" :opacity="hi == null || hi === pi ? 1 : 0.5" />
          <text :x="padL + pi * (gw + gap) + gw / 2" :y="height - 8" font-size="10.5" fill="var(--text-muted)" text-anchor="middle">{{ p }}</text>
        </g>
      </template>
      <template v-else>
        <g v-for="(p, pi) in periods" :key="pi" @mouseenter="hi = pi" @mouseleave="hi = null">
          <rect v-for="(sr, si) in series" :key="si"
            :x="padL + pi * (gw + gap)" :y="stackRects[pi][si].y" :width="gw" :height="Math.max(1, stackRects[pi][si].h)"
            :fill="sr.color" stroke="#fff" stroke-width="1" :opacity="hi == null || hi === pi ? 1 : 0.5" />
          <text :x="padL + pi * (gw + gap) + gw / 2" :y="height - 8" font-size="10.5" fill="var(--text-muted)" text-anchor="middle">{{ p }}</text>
          <text v-if="series.length" :x="padL + pi * (gw + gap) + gw / 2" :y="stackRects[pi][series.length - 1].y - 5" font-size="9.5"
            fill="var(--text-secondary)" text-anchor="middle" font-family="var(--font-mono)">{{ fint(totals[pi]) }}</text>
        </g>
      </template>
    </svg>
    <div v-if="hi != null" class="cz-tip" :style="{ left: Math.min(w - 150, Math.max(0, padL + hi * (gw + gap) + gw / 2 - 70)) + 'px', top: '0px' }">
      <div class="h">{{ periods[hi] }}</div>
      <div v-for="(sr, si) in series" :key="si" class="r">
        <span :style="{ width: '8px', height: '8px', borderRadius: '2px', background: sr.color, display: 'inline-block' }"></span>
        <span class="nm">{{ sr.name }}</span><span class="vv">{{ f(sr.values[hi] ?? 0) }}</span>
      </div>
    </div>
    <div class="cz-legend" style="margin-top: 8px">
      <span v-for="(sr, i) in series" :key="i" class="cz-leg"><span class="sw" :style="{ background: sr.color }"></span>{{ sr.name }}</span>
    </div>
  </div>
</template>
