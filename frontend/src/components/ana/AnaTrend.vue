<script setup lang="ts">
// 趋势面积图(移植 ana-kit.jsx AnaTrend):今年实线+面积 vs 去年虚线,平滑 + hover 十字。
import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { smoothPath, type Pt } from './anaFmt'
import './ana.css'

const props = withDefaults(defineProps<{
  labels: string[]
  cur: number[]
  prev?: number[] | null
  unit?: string
  height?: number
  curName?: string
  prevName?: string
}>(), { unit: '万', height: 200, curName: '今年', prevName: '去年同期' })

const { el, width: w } = useWidth(520)
const hi = ref<number | null>(null)

const padT = 16, padB = 22
const n = computed(() => props.cur.length)
const dom = computed(() => {
  const all = props.cur.concat(props.prev ?? [])
  let lo = all.length ? Math.min(...all) : 0
  let hiV = all.length ? Math.max(...all) : 1
  const pad = (hiV - lo) * 0.16 || 1
  return { lo: lo - pad, hi: hiV + pad }
})
const X = (i: number) => (n.value <= 1 ? 0 : (i / (n.value - 1)) * w.value)
const Y = (v: number) => padT + (1 - (v - dom.value.lo) / (dom.value.hi - dom.value.lo)) * (props.height - padT - padB)
const co = (a: number[]): Pt[] => a.map((v, i) => ({ x: X(i), y: Y(v) }))
const curPath = computed(() => smoothPath(co(props.cur)))
const prevPath = computed(() => (props.prev && props.prev.length ? smoothPath(co(props.prev)) : ''))
const areaPath = computed(() =>
  curPath.value + ' L ' + w.value.toFixed(1) + ' ' + (props.height - padB) + ' L 0 ' + (props.height - padB) + ' Z')

// 取数单入口:mouse/touch/pen 统一走 pointer 事件族——触屏靠 pointerdown 立即定位、
// pointermove 跟随;鼠标同路,桌面行为与原 mousemove 等价(换算逻辑不变)。
function onMove(e: PointerEvent) {
  const node = el.value
  if (!node) return
  const r = node.getBoundingClientRect()
  const x = Math.max(0, Math.min(w.value, e.clientX - r.left))
  hi.value = Math.round((x / w.value) * (n.value - 1))
}
</script>

<template>
  <div>
    <!-- touch-action:pan-y——横向划归十字线取数、纵向滚动放行;不加这条,触屏一划就滚页取不了数 -->
    <div ref="el" :style="{ position: 'relative', width: '100%', height: height + 'px', cursor: 'crosshair', touchAction: 'pan-y' }"
      @pointerdown="onMove" @pointermove="onMove" @pointerleave="hi = null" @pointercancel="hi = null">
      <svg :width="w" :height="height" style="display: block; overflow: visible">
        <defs>
          <linearGradient id="akTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgb(28,28,28)" stop-opacity="0.11" />
            <stop offset="100%" stop-color="rgb(28,28,28)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line v-for="g in [0, 0.5, 1]" :key="g" x1="0" :x2="w"
          :y1="padT + g * (height - padT - padB)" :y2="padT + g * (height - padT - padB)" stroke="var(--divider)" stroke-width="1" />
        <path v-if="prevPath" :d="prevPath" fill="none" stroke="rgb(160,162,170)" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" />
        <path :d="areaPath" fill="url(#akTrendGrad)" />
        <path :d="curPath" fill="none" stroke="rgb(28,28,28)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <template v-for="(l, i) in labels" :key="i">
          <text v-if="i % 2 === 0 || i === n - 1" :x="X(i)" :y="height - 6" font-size="10" fill="var(--text-muted)"
            :text-anchor="i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'" font-family="var(--font-sans)">{{ l }}</text>
        </template>
        <g v-if="hi != null">
          <line :x1="X(hi)" :y1="padT" :x2="X(hi)" :y2="height - padB" stroke="rgb(28,28,28)" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="4 4" />
          <circle :cx="X(hi)" :cy="Y(cur[hi])" r="5" fill="#fff" stroke="rgb(28,28,28)" stroke-width="2.5" />
          <circle v-if="prev && prev.length" :cx="X(hi)" :cy="Y(prev[hi])" r="4" fill="#fff" stroke="rgb(160,162,170)" stroke-width="2.5" />
        </g>
      </svg>
      <div v-if="hi != null" class="ana-trend-tip" :style="{ left: Math.max(0, Math.min(w - 150, X(hi) - 75)) + 'px' }">
        <div class="lb">{{ labels[hi] }}</div>
        <div class="row"><span class="sw" style="background: #fff"></span><span class="nm">{{ curName }}</span><span class="vv">{{ Number(cur[hi]).toFixed(1) }}{{ unit }}</span></div>
        <div v-if="prev && prev.length" class="row" style="margin-top: 4px">
          <span class="sw" style="background: rgb(160,162,170); height: 2px"></span><span class="nm">{{ prevName }}</span><span class="vv">{{ Number(prev[hi]).toFixed(1) }}{{ unit }}</span>
        </div>
      </div>
    </div>
    <div class="ak-legend" style="justify-content: center; margin-top: 8px">
      <span class="ak-leg"><span class="ln" style="border-top: 2.5px solid rgb(28,28,28)"></span>{{ curName }}</span>
      <span v-if="prev && prev.length" class="ak-leg"><span class="ln" style="border-top: 2px dashed rgb(160,162,170)"></span>{{ prevName }}</span>
    </div>
  </div>
</template>

<style scoped>
.ana-trend-tip { position: absolute; top: 2px; min-width: 134px; pointer-events: none; background: rgb(40,52,66); color: #fff; border-radius: 10px; padding: 9px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.ana-trend-tip .lb { font-size: 11px; opacity: 0.65; margin-bottom: 6px; }
.ana-trend-tip .row { display: flex; align-items: center; gap: 8px; }
.ana-trend-tip .sw { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto; }
.ana-trend-tip .nm { font-size: var(--fs-micro); opacity: 0.8; flex: 1; }
.ana-trend-tip .vv { font-family: var(--font-mono); font-weight: 600; font-size: var(--fs-label); }
</style>
