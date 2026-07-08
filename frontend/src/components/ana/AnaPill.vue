<script setup lang="ts">
// 口径徽章(移植 ana-charts.jsx Pill):tone warn/legal/ops/默认。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{ tone?: 'warn' | 'legal' | 'ops'; icon?: string }>()

const color = computed(() =>
  props.tone === 'warn' ? 'var(--hue-orange)'
  : props.tone === 'legal' ? 'var(--hue-cyan)'
  : props.tone === 'ops' ? 'var(--fill-slate)'
  : 'var(--text-muted)')
const bg = computed(() => (props.tone === 'warn' ? 'rgb(255,243,230)' : 'var(--surface-sunken)'))
</script>

<template>
  <span class="ana-pill" :style="{ color, background: bg }">
    <component :is="iconFor(icon)" v-if="icon" :size="12" />
    <slot />
  </span>
</template>

<style scoped>
.ana-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
</style>
