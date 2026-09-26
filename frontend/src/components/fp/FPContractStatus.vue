<script setup lang="ts">
import { computed } from 'vue'
import Badge from '@/components/ds/Badge.vue'
import { contractStatusOf } from './contractStatus'

const props = withDefaults(defineProps<{
  status: string
  variant?: 'solid' | 'subtle'
  label?: string   // 覆盖默认叫法(递增段的前一段显示「已递增」,色仍按 status)
}>(), { variant: 'subtle' })

// MAP 已抽到 ./contractStatus.ts —— 分析层够不着内联常量,于是自己抄了一套并把红/灰抄反了。
const m = computed(() => contractStatusOf(props.status))
</script>

<template>
  <Badge :tone="m.tone" :variant="variant">{{ label ?? m.label }}</Badge>
</template>
