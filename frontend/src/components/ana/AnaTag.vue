<script setup lang="ts">
// 动态标签胶囊(移植 ana-charts.jsx Tag):tag 为 null 不渲染;色随 tone。
import { computed } from 'vue'
import { NEG, POS, WARN, type AnaTagData } from './anaFmt'

const props = defineProps<{ tag: AnaTagData | null | undefined }>()

const color = computed(() => {
  const t = props.tag?.tone
  return t === 'good' ? POS : t === 'risk' ? NEG : t === 'warn' ? WARN : 'var(--text-muted)'
})
const bg = computed(() => {
  const t = props.tag?.tone
  return t === 'good' ? 'var(--accent-blue)' : t === 'risk' ? 'rgb(255,238,237)' : t === 'warn' ? 'rgb(255,243,230)' : 'var(--surface-sunken)'
})
</script>

<template>
  <span v-if="tag" class="ana-tag" :style="{ color, background: bg }">{{ tag.text }}</span>
</template>

<style scoped>
.ana-tag { font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
</style>
