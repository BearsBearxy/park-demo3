<script setup lang="ts">
// 解读列表(移植 ana-kit.jsx ReadList):红黄蓝信号点 + 文本(可含 <b>,由调用方给纯文本)。
import { STATUS, type AnaStatusLevel } from './anaFmt'
import './ana.css'

export interface ReadItem { tone: AnaStatusLevel; text: string }
defineProps<{ items: ReadItem[] }>()
const dotColor = (tone: AnaStatusLevel) => (STATUS[tone] ?? STATUS.neutral).color
</script>

<template>
  <div class="ak-read">
    <div v-for="(it, i) in items" :key="i" class="ak-read-item">
      <span class="ak-read-dot" :style="{ background: dotColor(it.tone) }"></span><span>{{ it.text }}</span>
    </div>
  </div>
</template>
