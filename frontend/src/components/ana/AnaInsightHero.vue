<script setup lang="ts">
// 管理层结论卡(移植 ana-kit.jsx InsightHero):大数 + 同比/环比 + headline/解读列表。
// headline 支持 slot(屏可用 <b class="up|down|warn"> 强调);read 走 AnaReadList。
import AnaDelta from './AnaDelta.vue'
import AnaReadList, { type ReadItem } from './AnaReadList.vue'
import AnaStatusPill from './AnaStatusPill.vue'
import type { AnaStatusLevel } from './anaFmt'
import './ana.css'

defineProps<{
  label: string
  value: string
  status?: AnaStatusLevel
  yoy?: number | null
  mom?: number | null
  yoyUnit?: string
  momUnit?: string
  invert?: boolean
  headline?: string
  read?: ReadItem[]
}>()
</script>

<template>
  <div class="ak-hero">
    <div class="ak-hero-main">
      <span class="ak-hero-label">{{ label }}<AnaStatusPill v-if="status" :level="status" /></span>
      <span class="ak-hero-val">{{ value }}</span>
      <span class="ak-hero-deltas">
        <AnaDelta v-if="yoy != null" k="同比" :v="yoy" :unit="yoyUnit" :invert="invert" />
        <AnaDelta v-if="mom != null" k="环比" :v="mom" :unit="momUnit" :invert="invert" />
      </span>
    </div>
    <div class="ak-hero-div"></div>
    <div class="ak-hero-say">
      <p v-if="headline || $slots.headline" class="ak-hero-headline"><slot name="headline">{{ headline }}</slot></p>
      <AnaReadList v-if="read && read.length" :items="read" />
    </div>
  </div>
</template>
