<script setup lang="ts">
// 水平多组箱线图(移植 ana-charts.jsx BoxPlot):min/q1/中位/q3/max + 均值点 + 散点 + hover 提示。
import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { FILL, INK, fiveNum, fnum, type FiveNum } from './anaFmt'
import './ana.css'

export interface BoxGroup { name: string; values: number[]; color?: string }

const props = withDefaults(defineProps<{
  groups: BoxGroup[]
  unit?: string
  fmt?: (v: number) => string
  height?: number
  rowH?: number
  showPoints?: boolean
}>(), { unit: '', rowH: 34, showPoints: true })

const { el, width: w } = useWidth(520)
const hi = ref<number | null>(null)

const f = computed(() => props.fmt ?? ((v: number) => fnum(v, 1) + props.unit))

const padL = 86, padR = 14, padT = 6, padB = 22
const domain = computed(() => {
  const all = props.groups.flatMap((g) => g.values)
  let lo = all.length ? Math.min(...all) : 0
  let hiV = all.length ? Math.max(...all) : 1
  const pad = (hiV - lo) * 0.08 || 1
  return { lo: lo - pad, hi: hiV + pad }
})
const innerW = computed(() => Math.max(40, w.value - padL - padR))
const X = (v: number) => padL + (v - domain.value.lo) / (domain.value.hi - domain.value.lo) * innerW.value
const H = computed(() => props.height ?? props.groups.length * props.rowH + padT + padB)

interface BoxRow extends FiveNum { name: string; color?: string; values: number[] }
const rows = computed<BoxRow[]>(() =>
  props.groups.map((g) => ({ name: g.name, color: g.color, values: g.values, ...fiveNum(g.values) })))

const axisTicks = computed(() => {
  const { lo, hi: hiV } = domain.value
  return [lo, (lo + hiV) / 2, hiV]
})
const tipRow = computed(() => (hi.value == null ? null : rows.value[hi.value]))
const tipLeft = computed(() => (tipRow.value ? Math.min(w.value - 150, Math.max(0, X(tipRow.value.med) - 70)) : 0))
const FILLS = FILL
const INK_ = INK
</script>

<template>
  <div ref="el" style="position: relative; width: 100%">
    <svg :width="w" :height="H" style="display: block; overflow: visible">
      <line v-for="t in [0, 0.25, 0.5, 0.75, 1]" :key="'g' + t"
        :x1="padL + t * innerW" :x2="padL + t * innerW" :y1="padT" :y2="H - padB"
        stroke="var(--divider)" stroke-width="1" />
      <text v-for="(v, i) in axisTicks" :key="'t' + i"
        :x="i === 0 ? padL : i === 2 ? w - padR : padL + innerW / 2" :y="H - 6"
        font-size="9.5" fill="var(--text-muted)" :text-anchor="i === 0 ? 'start' : i === 2 ? 'end' : 'middle'"
        font-family="var(--font-mono)">{{ f(v) }}</text>
      <g v-for="(r, ri) in rows" :key="ri" @mouseenter="hi = ri" @mouseleave="hi = null">
        <text :x="padL - 10" :y="padT + ri * rowH + rowH / 2 + 3.5" font-size="11.5" fill="var(--text-primary)" text-anchor="end">{{ r.name }}</text>
        <line :x1="X(r.min)" :x2="X(r.max)" :y1="padT + ri * rowH + rowH / 2" :y2="padT + ri * rowH + rowH / 2" stroke="var(--border-strong)" stroke-width="1.4" />
        <line :x1="X(r.min)" :x2="X(r.min)" :y1="padT + ri * rowH + rowH / 2 - 5" :y2="padT + ri * rowH + rowH / 2 + 5" stroke="var(--border-strong)" stroke-width="1.4" />
        <line :x1="X(r.max)" :x2="X(r.max)" :y1="padT + ri * rowH + rowH / 2 - 5" :y2="padT + ri * rowH + rowH / 2 + 5" stroke="var(--border-strong)" stroke-width="1.4" />
        <rect :x="X(r.q1)" :y="padT + ri * rowH + rowH / 2 - 9" :width="Math.max(1, X(r.q3) - X(r.q1))" height="18" rx="4"
          :fill="r.color || FILLS[ri % FILLS.length]" :fill-opacity="hi === ri ? 0.5 : 0.32"
          :stroke="r.color || FILLS[ri % FILLS.length]" stroke-width="1.3" />
        <line :x1="X(r.med)" :x2="X(r.med)" :y1="padT + ri * rowH + rowH / 2 - 9" :y2="padT + ri * rowH + rowH / 2 + 9" :stroke="INK_" stroke-width="2" />
        <template v-if="showPoints">
          <circle v-for="(v, vi) in r.values" :key="vi" :cx="X(v)" :cy="padT + ri * rowH + rowH / 2 + (vi % 2 ? 11 : -11)" r="1.8"
            :fill="r.color || FILLS[ri % FILLS.length]" fill-opacity="0.55" />
        </template>
        <circle :cx="X(r.mean)" :cy="padT + ri * rowH + rowH / 2" r="3.4" fill="#fff" :stroke="INK_" stroke-width="2" />
      </g>
    </svg>
    <div v-if="tipRow && hi != null" class="cz-tip" :style="{ left: tipLeft + 'px', top: padT + hi * rowH - 4 + 'px' }">
      <div class="h">{{ tipRow.name }}</div>
      <div class="r"><span class="nm">中位</span><span class="vv">{{ f(tipRow.med) }}</span></div>
      <div class="r"><span class="nm">均值</span><span class="vv">{{ f(tipRow.mean) }}</span></div>
      <div class="r"><span class="nm">区间</span><span class="vv">{{ f(tipRow.min) }}~{{ f(tipRow.max) }}</span></div>
      <div class="r"><span class="nm">σ</span><span class="vv">{{ f(tipRow.std) }}</span></div>
    </div>
    <div class="cz-legend" style="margin-top: 8px">
      <span class="cz-leg"><span :style="{ width: '14px', height: 0, borderTop: '2px solid ' + INK_ }"></span>中位</span>
      <span class="cz-leg"><span :style="{ width: '9px', height: '9px', borderRadius: '50%', background: '#fff', border: '2px solid ' + INK_ }"></span>均值</span>
      <span class="cz-leg"><span class="sw" :style="{ background: FILLS[1], opacity: 0.4 }"></span>四分位区间 (IQR)</span>
    </div>
  </div>
</template>
