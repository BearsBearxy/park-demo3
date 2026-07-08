<script setup lang="ts">
// 一行派生统计量条(移植 ana-charts.jsx StatBar):均值/σ/CV/极值等,全部由调用方算出传入。
import { deltaColor, sgn } from './anaFmt'
import './ana.css'

export interface StatBarItem {
  label: string
  value: string
  color?: string
  delta?: number | null
  invert?: boolean
  unit?: string
  kind?: string
  note?: string
}
defineProps<{ items: StatBarItem[] }>()
</script>

<template>
  <div class="cz-statbar">
    <div v-for="(m, i) in items" :key="i" class="cz-stat">
      <span class="l">{{ m.label }}</span>
      <span class="v" :style="m.color ? { color: m.color } : undefined">{{ m.value }}</span>
      <span v-if="m.delta != null" class="d" :style="{ color: deltaColor(m.delta, m.invert) }">
        {{ sgn(m.delta, 1, m.unit || '%') }} {{ m.kind || '' }}
      </span>
      <span v-if="m.note" class="d" style="color: var(--text-muted)">{{ m.note }}</span>
    </div>
  </div>
</template>
