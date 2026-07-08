<script setup lang="ts">
// 迷你折线网格(移植 ana-charts.jsx SparkGrid):每户/每栋一格,含调用方算好的环比。
import { computed } from 'vue'
import AnaSpark from './AnaSpark.vue'
import { fint, NEG, POS, sgn } from './anaFmt'
import './ana.css'

export interface SparkItem {
  name: string
  series: number[]
  cur: number
  mom?: number | null
  note?: string
  unit?: string
  color?: string
  invert?: boolean
  [key: string]: unknown
}

const props = withDefaults(defineProps<{
  items: SparkItem[]
  cols?: number
  valueFmt?: (it: SparkItem) => string
  deltaKey?: string
}>(), { cols: 3, deltaKey: 'mom' })

const vf = computed(() => props.valueFmt ?? ((it: SparkItem) => fint(it.cur)))
const deltaOf = (it: SparkItem): number | null => {
  const dv = it[props.deltaKey]
  return typeof dv === 'number' ? dv : null
}
const colOf = (it: SparkItem): string => {
  const dv = deltaOf(it)
  if (dv == null) return 'var(--text-muted)'
  return dv >= 0 ? (it.invert ? NEG : POS) : (it.invert ? POS : NEG)
}
</script>

<template>
  <div class="cz-spark" :style="{ gridTemplateColumns: 'repeat(' + cols + ',1fr)' }">
    <div v-for="(it, i) in items" :key="i" class="cz-sp">
      <div class="top"><span class="nm">{{ it.name }}</span><span class="vl">{{ vf(it) }}</span></div>
      <AnaSpark :series="it.series" :color="it.color" />
      <div class="sub">
        <span style="color: var(--text-muted)">{{ it.note || '' }}</span>
        <span v-if="deltaOf(it) != null" :style="{ color: colOf(it) }">{{ sgn(deltaOf(it)!, 1, it.unit || '%') }}</span>
      </div>
    </div>
  </div>
</template>
