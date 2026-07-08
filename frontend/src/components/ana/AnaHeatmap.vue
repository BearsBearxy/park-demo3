<script setup lang="ts">
// 热力表(移植 ana-kit.jsx Heatmap):板块×月;yoy 模式蓝(正)/红(负),value 模式蓝深浅。
import { computed } from 'vue'
import './ana.css'

export interface HeatRow { name: string; values: number[] }

const props = withDefaults(defineProps<{
  cols: string[]
  rows: HeatRow[]
  mode?: 'yoy' | 'value'
}>(), { mode: 'yoy' })

const maxAbs = computed(() => {
  const flat = props.rows.flatMap((r) => r.values)
  return (flat.length ? Math.max(...flat.map((v) => Math.abs(v))) : 0) || 1
})

function cellStyle(v: number): Record<string, string> {
  if (props.mode === 'yoy') {
    const t = Math.min(1, Math.abs(v) / maxAbs.value)
    if (v >= 0) return { background: 'rgba(24,134,254,' + (0.08 + t * 0.5).toFixed(2) + ')', color: t > 0.6 ? '#fff' : 'var(--text-secondary)' }
    return { background: 'rgba(255,59,48,' + (0.08 + t * 0.5).toFixed(2) + ')', color: t > 0.6 ? '#fff' : 'var(--text-secondary)' }
  }
  const t = Math.min(1, v / maxAbs.value)
  return { background: 'rgba(120,140,176,' + (0.1 + t * 0.7).toFixed(2) + ')', color: t > 0.55 ? '#fff' : 'var(--text-secondary)' }
}
const fmt = (v: number) => (props.mode === 'yoy' ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) : v.toFixed(0))
</script>

<template>
  <table class="ak-hm">
    <thead>
      <tr><th class="row"></th><th v-for="(c, i) in cols" :key="i">{{ c }}</th></tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.name">
        <td class="ak-hm-name">{{ r.name }}</td>
        <td v-for="(v, i) in r.values" :key="i"><div class="ak-hm-cell" :style="cellStyle(v)">{{ fmt(v) }}</div></td>
      </tr>
    </tbody>
  </table>
</template>
