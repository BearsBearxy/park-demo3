<script setup lang="ts">
// 半环比率表(移植 ana-charts.jsx RatioArc):关键财务比率。
import { computed } from 'vue'
import { fnum, NEG, POS, WARN } from './anaFmt'

const props = withDefaults(defineProps<{
  value: number
  max?: number
  label?: string
  sub?: string
  fmt?: (v: number) => string
  tone?: 'good' | 'warn' | 'risk'
  size?: number
}>(), { max: 1, size: 132 })

const f = computed(() => props.fmt ?? ((v: number) => fnum(v, 2)))
const pct = computed(() => Math.max(0, Math.min(1, props.value / props.max)))
const r = computed(() => props.size / 2 - 12)
const cx = computed(() => props.size / 2)
const cy = computed(() => props.size / 2 + 6)
const pol = (a: number): [number, number] => [cx.value + Math.cos(a) * r.value, cy.value - Math.sin(a) * r.value]
const arc = (s: number, e: number): string => {
  const [x0, y0] = pol(s), [x1, y1] = pol(e)
  const large = s - e > Math.PI ? 1 : 0
  return `M ${x0} ${y0} A ${r.value} ${r.value} 0 ${large} 1 ${x1} ${y1}`
}
const bgPath = computed(() => arc(Math.PI, 0))
const fgPath = computed(() => arc(Math.PI, Math.PI * (1 - pct.value)))
const col = computed(() => (props.tone === 'risk' ? NEG : props.tone === 'warn' ? WARN : POS))
</script>

<template>
  <div style="display: flex; flex-direction: column; align-items: center">
    <svg :width="size" :height="size / 2 + 22">
      <path :d="bgPath" fill="none" stroke="var(--ink-050)" stroke-width="9" stroke-linecap="round" />
      <path :d="fgPath" fill="none" :stroke="col" stroke-width="9" stroke-linecap="round" />
      <text :x="cx" :y="cy - 4" font-size="22" font-weight="600" font-family="var(--font-mono)" fill="var(--text-primary)" text-anchor="middle">{{ f(value) }}</text>
      <text :x="cx" :y="cy + 13" font-size="10.5" fill="var(--text-muted)" text-anchor="middle">{{ sub }}</text>
    </svg>
    <div class="ana-arc-label">{{ label }}</div>
  </div>
</template>

<style scoped>
.ana-arc-label { font-size: 12px; color: var(--text-secondary); font-weight: 500; margin-top: 2px; }
</style>
