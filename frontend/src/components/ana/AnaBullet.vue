<script setup lang="ts">
// 子弹图(移植 ana-charts.jsx Bullet):实际 vs 目标线。
import { computed } from 'vue'
import { useWidth } from './useWidth'
import { fnum, INK, POS, WARN } from './anaFmt'
import { useEnterPhase, useMorphHold } from './anaMotion'
import './ana.css'   // .ana-morph / fp-wipe

export interface BulletRow { name: string; value: number; target?: number; color?: string }

const props = withDefaults(defineProps<{
  rows: BulletRow[]
  max?: number
  target?: number
  unit?: string
  height?: number
}>(), { unit: '%' })

const { el, width: w } = useWidth(480)
/// 视口内首挂 / 切回页签擦入 320;换年同行 200 形变(2026-09-16 矩阵);改宽瞬算。
// first 在 animationend.self **与 animationcancel.self** 摘掉;擦入期间 hold 关掉形变。
const first = useEnterPhase(el)
const hold = useMorphHold(w, first)
const padL = 96, padR = 56, rowH = 30
const iw = computed(() => Math.max(40, w.value - padL - padR))
const mx = computed(() =>
  props.max ?? Math.max(...props.rows.map((r) => Math.max(r.value, r.target ?? props.target ?? 0))) * 1.1)
const X = (v: number) => padL + Math.min(1, v / mx.value) * iw.value
const H = computed(() => props.height ?? props.rows.length * rowH + 10)
const targetOf = (r: BulletRow) => r.target ?? props.target
const colOf = (r: BulletRow) => r.color ?? (r.value >= (targetOf(r) ?? 0) ? POS : WARN)
const INK_ = INK
</script>

<template>
  <div ref="el" style="position: relative; width: 100%">
    <svg :width="w" :height="H" :class="['bul-svg', 'ana-morph', { first, hold }]" style="display: block; overflow: visible"
      @animationend.self="first = false" @animationcancel.self="first = false">
      <!-- 键 = 行位 + 名:同一项留在同一行才形变;某项缺席、下面的行上移时换新元素瞬到,不从别的项滑过来 -->
      <g v-for="(r, i) in rows" :key="`${i}:${r.name}`">
        <text :x="padL - 10" :y="8 + i * rowH + rowH / 2" font-size="11.5" fill="var(--text-primary)" text-anchor="end">{{ r.name }}</text>
        <rect :x="padL" :y="8 + i * rowH + rowH / 2 - 10" :width="iw" height="12" rx="6" fill="var(--ink-050)" />
        <rect :x="padL" :y="8 + i * rowH + rowH / 2 - 10" :width="Math.max(2, X(r.value) - padL)" height="12" rx="6" :fill="colOf(r)" />
        <!-- 目标线用 path:<line> 的端点过渡不了,量程一变条在滑、线会先跳 -->
        <path v-if="targetOf(r) != null" :d="`M${X(targetOf(r)!)},${8 + i * rowH + rowH / 2 - 14} V${8 + i * rowH + rowH / 2 + 6}`"
          :stroke="INK_" stroke-width="2" />
        <text :x="w - padR + 8" :y="8 + i * rowH + rowH / 2" font-size="11" fill="var(--text-primary)" font-family="var(--font-mono)" font-weight="600">
          {{ fnum(r.value, r.value % 1 ? 1 : 0) }}{{ unit }}</text>
      </g>
    </svg>
    <div v-if="target != null" class="ana-bullet-target">
      <span :style="{ width: '2px', height: '11px', background: INK_, display: 'inline-block' }"></span>目标线 {{ target }}{{ unit }}
    </div>
  </div>
</template>

<style scoped>
/* 首挂擦入:整张子弹图一笔从左到右(行名与条同属数据,没有独立的尺子层);fp-wipe 在 ana.css */
.bul-svg.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
.ana-bullet-target { font-size: var(--fs-micro); color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-top: 2px; }
</style>
