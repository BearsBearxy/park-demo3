<script setup lang="ts">
// 同比/环比 delta(移植 ana-kit.jsx Delta):箭头 + 色随方向;invert 反转好坏。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { deltaColor } from './anaFmt'
import './ana.css'

const props = defineProps<{ k: string; v: number; unit?: string; invert?: boolean }>()

const num = computed(() => (typeof props.v === 'number' ? props.v : 0))
const col = computed(() => deltaColor(num.value, props.invert))
const arrow = computed(() => (num.value >= 0 ? 'arrow-up-right' : 'arrow-down-right'))
const txt = computed(() => (num.value >= 0 ? '+' : '−') + Math.abs(num.value).toFixed(1) + (props.unit || '%'))
</script>

<template>
  <span class="ak-delta">
    <span class="k">{{ k }}</span>
    <span class="v" :style="{ color: col }"><component :is="iconFor(arrow)" :size="11" />{{ txt }}</span>
  </span>
</template>
