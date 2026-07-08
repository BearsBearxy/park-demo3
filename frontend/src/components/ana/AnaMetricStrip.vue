<script setup lang="ts">
// 指标条(移植 ana-kit.jsx MetricStrip):分析师密度,细条无卡片。
import { deltaColor } from './anaFmt'
import './ana.css'

export interface MetricItem {
  label: string
  value: string
  color?: string
  delta?: number | null
  invert?: boolean
  deltaUnit?: string
  deltaKind?: string
  note?: string
}
defineProps<{ items: MetricItem[] }>()
</script>

<template>
  <div class="ak-strip">
    <div v-for="(m, i) in items" :key="i" class="ak-strip-item">
      <span class="ak-strip-l">{{ m.label }}</span>
      <span class="ak-strip-v" :style="m.color ? { color: m.color } : undefined">{{ m.value }}</span>
      <span v-if="m.delta != null" class="ak-strip-d" :style="{ color: deltaColor(m.delta, m.invert) }">
        {{ m.delta >= 0 ? '+' : '−' }}{{ Math.abs(m.delta).toFixed(1) }}{{ m.deltaUnit || '%' }} {{ m.deltaKind || '' }}</span>
      <span v-if="m.note" class="ak-strip-d" style="color: var(--text-muted)">{{ m.note }}</span>
    </div>
  </div>
</template>
