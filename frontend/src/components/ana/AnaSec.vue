<script setup lang="ts">
// 区块标题(移植 ana-kit.jsx Sec):标题 + 可选 chip/提示 + 分隔线。
import { computed } from 'vue'
import { STATUS, type AnaStatusLevel } from './anaFmt'
import './ana.css'

const props = defineProps<{ title: string; hint?: string; chip?: string; chipTone?: AnaStatusLevel }>()
const s = computed(() => (props.chipTone ? STATUS[props.chipTone] ?? STATUS.neutral : null))
</script>

<template>
  <div class="ak-sec">
    <span class="t">{{ title }}</span>
    <span v-if="chip" class="chip" :style="{ background: s ? s.soft : 'var(--surface-sunken)', color: s ? s.color : 'var(--text-muted)' }">{{ chip }}</span>
    <span v-if="hint" class="hint">{{ hint }}</span>
    <span class="ln"></span>
  </div>
</template>
