<script setup lang="ts">
// 通用进度条行(移植 ana-kit.jsx BarRow):出租率/构成等,可带目标线与 delta。
import { computed } from 'vue'
import { deltaColor } from './anaFmt'
import './ana.css'

const props = withDefaults(defineProps<{
  name: string
  value: number
  max?: number
  target?: number | null
  fill?: string
  delta?: number | null
  deltaInvert?: boolean
  suffix?: string
}>(), { fill: 'var(--fill-blue)', suffix: '%' })

const wPct = computed(() => Math.min(100, (props.value / (props.max || 100)) * 100))
const tPct = computed(() => (props.target != null ? Math.min(100, (props.target / (props.max || 100)) * 100) : null))
const valText = computed(() => props.value.toFixed(props.value % 1 ? 1 : 0))
</script>

<template>
  <div class="ak-bar-row">
    <span class="ak-bar-name">{{ name }}</span>
    <!-- 定位壳:track 有 overflow:hidden 会裁掉出界文字,目标小字只能挂壳上 -->
    <div class="ak-bar-twrap">
      <div class="ak-bar-track">
        <div class="ak-bar-fill" :style="{ width: wPct + '%', background: fill }"></div>
        <span v-if="tPct != null" class="ak-bar-target" :style="{ left: tPct + '%' }"></span>
      </div>
      <!-- 触屏无 hover 取不到 title → 改常驻小字贴目标线;绝对定位不占行高(LAYOUT-STABILITY:等高) -->
      <span v-if="tPct != null" class="ak-bar-tlabel" :style="{ left: tPct + '%' }">目标 {{ target }}{{ suffix }}</span>
    </div>
    <span class="ak-bar-val">{{ valText }}{{ suffix }}</span>
    <span v-if="delta != null" class="ak-bar-delta" :style="{ color: deltaColor(delta, deltaInvert) }">
      {{ delta >= 0 ? '+' : '−' }}{{ Math.abs(delta).toFixed(1) }}</span>
  </div>
</template>

<style scoped>
/* 壳接管 track 原来的 flex:1;自身高度仍由 8px track 撑起 → 行高与加字前完全一致 */
.ak-bar-twrap { flex: 1; position: relative; }
.ak-bar-tlabel { position: absolute; top: calc(100% + 1px); transform: translateX(-50%); font-size: var(--fs-micro); line-height: 1; color: var(--text-muted); white-space: nowrap; pointer-events: none; }
</style>
