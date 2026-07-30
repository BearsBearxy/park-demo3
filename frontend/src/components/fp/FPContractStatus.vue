<script setup lang="ts">
import { computed } from 'vue'
import Badge from '@/components/ds/Badge.vue'

const props = withDefaults(defineProps<{
  status: string
  variant?: 'solid' | 'subtle'
}>(), { variant: 'subtle' })

// ponytail: 1:1 from fp-master-ui.jsx CONTRACT_STATUS + renewed(后端 effectiveStatus 第6态)
const MAP: Record<string, { tone: 'neutral' | 'blue' | 'orange' | 'red' | 'slate'; label: string }> = {
  draft:      { tone: 'neutral', label: '草稿' },
  future:     { tone: 'neutral', label: '未生效' },   // 已签但起租日未到(后端 effectiveStatus,2026-07-28)
  active:     { tone: 'blue',   label: '执行中' },
  expiring:   { tone: 'orange', label: '即将到期' },
  expired:    { tone: 'red',    label: '已到期' },
  terminated: { tone: 'neutral', label: '已终止' },
  renewed:    { tone: 'slate',  label: '已续签' },   // 灰蓝:正常被新一期取代,区别于 terminated 的中性灰
}

const m = computed(() => MAP[props.status] ?? { tone: 'neutral' as const, label: props.status })
</script>

<template>
  <Badge :tone="m.tone" :variant="variant">{{ m.label }}</Badge>
</template>
