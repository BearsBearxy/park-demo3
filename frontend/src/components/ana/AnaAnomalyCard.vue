<script setup lang="ts">
// 异常卡(移植 ana-kit.jsx AnomalyCard):sev 定色/图标,点击 emit go(link) 由调用方路由。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { STATUS, type AnaStatusLevel } from './anaFmt'
import './ana.css'

export interface Anomaly {
  id: string
  sev: 'risk' | 'watch' | 'info'
  dim?: string
  type: string
  metric: string
  title: string
  detail?: string
  value: string
  link?: string
}
const props = defineProps<{ a: Anomaly }>()
const emit = defineEmits<{ go: [link: string | undefined] }>()

const s = computed(() => STATUS[props.a.sev as AnaStatusLevel] ?? STATUS.neutral)
const icon = computed(() => (props.a.sev === 'risk' ? 'alert-octagon' : props.a.sev === 'watch' ? 'alert-triangle' : 'info'))
</script>

<template>
  <div class="ak-anom" @click="emit('go', a.link)">
    <span class="ak-anom-bar" :style="{ background: s.color }"></span>
    <span class="ak-anom-ic" :style="{ background: s.soft, color: s.color }"><component :is="iconFor(icon)" :size="17" /></span>
    <div class="ak-anom-body">
      <div class="ak-anom-t">{{ a.title }}<span class="ak-anom-tag">{{ a.type }} · {{ a.metric }}</span></div>
      <div v-if="a.detail" class="ak-anom-d">{{ a.detail }}</div>
    </div>
    <span class="ak-anom-v" :style="{ color: s.color }">{{ a.value }}</span>
    <span class="ak-anom-go"><component :is="iconFor('chevron-right')" :size="18" /></span>
  </div>
</template>
