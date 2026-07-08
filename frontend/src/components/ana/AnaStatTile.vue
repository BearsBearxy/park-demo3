<script setup lang="ts">
// 主指标磁贴(移植 ana-kit.jsx StatTile)。ponytail: 原型 exec/analyst 模式上下文省略 —
// demo3 分析层恒为 analyst 密度,传 cur 即显 spark。
import { iconFor } from '@/components/ds/icon'
import AnaDelta from './AnaDelta.vue'
import AnaKitSpark from './AnaKitSpark.vue'
import AnaStatusPill from './AnaStatusPill.vue'
import type { AnaStatusLevel } from './anaFmt'
import './ana.css'

withDefaults(defineProps<{
  icon?: string
  label: string
  value: string
  status?: AnaStatusLevel
  yoy?: number | null
  mom?: number | null
  yoyUnit?: string
  momUnit?: string
  invert?: boolean
  tint?: 'slate' | 'sky' | 'blue' | 'cyan' | 'plain'
  cur?: number[] | null
  prev?: number[] | null
}>(), { tint: 'plain' })
</script>

<template>
  <div :class="'ak-tile t-' + tint">
    <div class="ak-tile-top">
      <span v-if="icon" class="ak-tile-ic"><component :is="iconFor(icon)" :size="15" /></span>
      <span class="ak-tile-label">{{ label }}</span>
      <AnaStatusPill v-if="status" :level="status" />
    </div>
    <div class="ak-tile-val">{{ value }}</div>
    <div class="ak-tile-deltas">
      <AnaDelta v-if="yoy != null" k="同比" :v="yoy" :unit="yoyUnit" :invert="invert" />
      <AnaDelta v-if="mom != null" k="环比" :v="mom" :unit="momUnit" :invert="invert" />
    </div>
    <div v-if="cur && cur.length" class="ak-tile-spark"><AnaKitSpark :cur="cur" :prev="prev" /></div>
  </div>
</template>
