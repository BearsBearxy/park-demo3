<script setup lang="ts">
// 状态胶囊(移植 ana-kit.jsx StatusPill):good/watch/risk/info/neutral。
import { computed } from 'vue'
import { STATUS, type AnaStatusLevel } from './anaFmt'
import './ana.css'

const props = defineProps<{ level: AnaStatusLevel }>()
const s = computed(() => STATUS[props.level] ?? STATUS.neutral)
</script>

<template>
  <span class="ak-tile-status" :style="{ background: s.soft, color: s.color }">
    <span :style="{ width: '6px', height: '6px', borderRadius: '50%', background: s.color }"></span>{{ s.label }}
  </span>
</template>
