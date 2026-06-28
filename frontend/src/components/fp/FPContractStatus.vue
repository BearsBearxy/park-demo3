<script setup lang="ts">
import { computed } from 'vue'
import Badge from '@/components/ds/Badge.vue'

const props = withDefaults(defineProps<{
  status: string
  variant?: 'solid' | 'subtle'
}>(), { variant: 'subtle' })

// ponytail: 1:1 from fp-master-ui.jsx CONTRACT_STATUS
const MAP: Record<string, { tone: 'neutral' | 'blue' | 'orange' | 'red'; label: string }> = {
  draft:      { tone: 'neutral', label: '草稿' },
  active:     { tone: 'blue',   label: '执行中' },
  expiring:   { tone: 'orange', label: '即将到期' },
  expired:    { tone: 'red',    label: '已到期' },
  terminated: { tone: 'neutral', label: '已终止' },
}

const m = computed(() => MAP[props.status] ?? { tone: 'neutral' as const, label: props.status })
</script>

<template>
  <Badge :tone="m.tone" :variant="variant">{{ m.label }}</Badge>
</template>
