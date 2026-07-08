<script setup lang="ts">
// 多轴雷达(移植 ana-charts.jsx Radar):分期/楼栋多指标对比。
import './ana.css'

export interface RadarSeries { name: string; color: string; values: number[] }

const props = withDefaults(defineProps<{
  axes: string[]
  series: RadarSeries[]
  size?: number
  max?: number
}>(), { size: 260, max: 100 })

const cx = () => props.size / 2
const cy = () => props.size / 2
const R = () => props.size / 2 - 34
const ang = (i: number) => -Math.PI / 2 + (i / props.axes.length) * 2 * Math.PI
const pt = (i: number, r: number): [number, number] => [cx() + Math.cos(ang(i)) * r, cy() + Math.sin(ang(i)) * r]
const gridPoly = (t: number) => props.axes.map((_, i) => pt(i, R() * t).join(',')).join(' ')
const poly = (vals: number[]) => vals.map((v, i) => pt(i, R() * Math.min(1, v / props.max)).join(',')).join(' ')
const dot = (v: number, i: number) => pt(i, R() * Math.min(1, v / props.max))
const anchorOf = (i: number) => {
  const [lx] = pt(i, R() + 16)
  return Math.abs(lx - cx()) < 6 ? 'middle' : lx > cx() ? 'start' : 'end'
}
</script>

<template>
  <div style="display: flex; flex-direction: column; align-items: center; gap: 12px">
    <svg :width="size" :height="size" style="overflow: visible">
      <polygon v-for="t in [0.25, 0.5, 0.75, 1]" :key="t" :points="gridPoly(t)" fill="none" stroke="var(--divider)" stroke-width="1" />
      <g v-for="(ax, i) in axes" :key="i">
        <line :x1="cx()" :y1="cy()" :x2="pt(i, R())[0]" :y2="pt(i, R())[1]" stroke="var(--divider)" stroke-width="1" />
        <text :x="pt(i, R() + 16)[0]" :y="pt(i, R() + 16)[1] + 3" font-size="10.5" fill="var(--text-secondary)" :text-anchor="anchorOf(i)">{{ ax }}</text>
      </g>
      <g v-for="(s, si) in series" :key="'s' + si">
        <polygon :points="poly(s.values)" :fill="s.color" fill-opacity="0.16" :stroke="s.color" stroke-width="2" stroke-linejoin="round" />
        <circle v-for="(v, i) in s.values" :key="i" :cx="dot(v, i)[0]" :cy="dot(v, i)[1]" r="2.6" :fill="s.color" />
      </g>
    </svg>
    <div class="cz-legend">
      <span v-for="(s, i) in series" :key="i" class="cz-leg"><span class="sw" :style="{ background: s.color }"></span>{{ s.name }}</span>
    </div>
  </div>
</template>
