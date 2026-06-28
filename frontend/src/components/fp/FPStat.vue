<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: string
  sub?: string
  tint?: 'blue' | 'slate' | 'sky' | 'cyan'
}>()

// ponytail: 1:1 from fp-master-ui.jsx FPStat
const bg = computed(() => props.tint ? `var(--accent-${props.tint})` : 'var(--surface-card)')
</script>

<template>
  <div :style="{ background: bg, borderRadius: 'var(--radius-lg)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }">
    <span style="font-size:var(--fs-micro);color:var(--text-muted);white-space:nowrap">{{ label }}</span>
    <span style="font-size:19px;font-weight:var(--fw-semibold);color:var(--text-primary);font-family:var(--font-mono);line-height:1.1">{{ value }}</span>
    <span v-if="sub" style="font-size:var(--fs-micro);color:var(--text-disabled)">{{ sub }}</span>
  </div>
</template>
