<script setup lang="ts">
import { computed } from 'vue'
import Badge from '@/components/ds/Badge.vue'

const props = withDefaults(defineProps<{
  status: number
  variant?: 'solid' | 'subtle'
}>(), { variant: 'subtle' })

// ponytail: 1:1 from fp-master-ui.jsx TENANT_STATUS
const MAP: Record<number, { tone: 'neutral' | 'blue' | 'red'; label: string }> = {
  1: { tone: 'blue',    label: '在租' },
  2: { tone: 'neutral', label: '已退租' },
  0: { tone: 'red',     label: '黑名单' },
}

const m = computed(() => MAP[props.status] ?? { tone: 'neutral' as const, label: '—' })
</script>

<template>
  <Badge :tone="m.tone" :variant="variant">{{ m.label }}</Badge>
</template>
