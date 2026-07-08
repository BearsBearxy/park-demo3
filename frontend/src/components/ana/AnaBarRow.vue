<script setup lang="ts">
// 通用进度条行(移植 ana-kit.jsx BarRow):出租率/构成等,可带目标线与 delta。
import { computed } from 'vue'
import { deltaColor } from './anaFmt'
import './ana.css'

const props = withDefaults(defineProps<{
  name: string
  value: number
  max?: number
  target?: number | null
  fill?: string
  delta?: number | null
  deltaInvert?: boolean
  suffix?: string
}>(), { fill: 'var(--fill-blue)', suffix: '%' })

const wPct = computed(() => Math.min(100, (props.value / (props.max || 100)) * 100))
const tPct = computed(() => (props.target != null ? Math.min(100, (props.target / (props.max || 100)) * 100) : null))
const valText = computed(() => props.value.toFixed(props.value % 1 ? 1 : 0))
</script>

<template>
  <div class="ak-bar-row">
    <span class="ak-bar-name">{{ name }}</span>
    <div class="ak-bar-track">
      <div class="ak-bar-fill" :style="{ width: wPct + '%', background: fill }"></div>
      <span v-if="tPct != null" class="ak-bar-target" :style="{ left: tPct + '%' }" :title="'目标 ' + target + suffix"></span>
    </div>
    <span class="ak-bar-val">{{ valText }}{{ suffix }}</span>
    <span v-if="delta != null" class="ak-bar-delta" :style="{ color: deltaColor(delta, deltaInvert) }">
      {{ delta >= 0 ? '+' : '−' }}{{ Math.abs(delta).toFixed(1) }}</span>
  </div>
</template>
