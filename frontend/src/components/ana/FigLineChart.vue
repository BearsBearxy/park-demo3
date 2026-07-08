<script setup lang="ts">
// 经营营收折线(移植 app/fig-line-chart.jsx):
// ① 主题切换(同比/预算/构成)= 淡入;② 粒度切换(月/季/年)= 同主题内 morph 平滑过渡。
// 纯 SVG;数据全由 model 驱动(屏组件从 anaData 聚合出 FigModel)。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Segmented from '@/components/ds/Segmented.vue'
import { iconFor } from '@/components/ds/icon'
import { useWidth } from './useWidth'
import { smoothSegs, type Pt } from './anaFmt'

export interface FigLine {
  name: string
  color: string
  kind: 'area' | 'compare' | 'target' | 'stack'
  pts: number[]
}
export interface FigSlice {
  lines: FigLine[]
  labels: string[]
  stacked?: boolean
  value: string
  delta: string
  up: boolean
  rangeLabel: string
}
export interface FigTheme { name: string; sub: string; gran: Record<string, FigSlice> }
export interface FigModel { unit?: string; valuePrefix?: string; themes: FigTheme[] }

const props = withDefaults(defineProps<{ model: FigModel; title?: string; height?: number }>(),
  { title: '营收趋势', height: 224 })

const FIG_BLUE = 'rgb(28,28,28)'
const COMPARE = 'rgb(150,152,158)'
const TARGET = 'rgb(150,152,158)'
const N = 76 // 统一重采样分辨率,便于平滑 morph

function resample(pts: number[] | undefined, n: number): number[] {
  if (!pts || !pts.length) return new Array(n).fill(0)
  if (pts.length === n) return pts.slice()
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (pts.length - 1)
    const lo = Math.floor(t), hi2 = Math.min(pts.length - 1, lo + 1), f = t - lo
    out[i] = pts[lo] + (pts[hi2] - pts[lo]) * f
  }
  return out
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const pathD = (c: Pt[]) => (c.length ? `M ${c[0].x.toFixed(2)} ${c[0].y.toFixed(2)}` + smoothSegs(c) : '')
function bandD(top: Pt[], bot: Pt[]): string { // 上沿正向 + 下沿反向闭合 → 堆叠层
  const rb = bot.slice().reverse()
  return pathD(top) + ` L ${rb[0].x.toFixed(2)} ${rb[0].y.toFixed(2)}` + smoothSegs(rb) + ' Z'
}

const unit = computed(() => props.model.unit ?? '万')
const prefix = computed(() => props.model.valuePrefix ?? '¥')
const themeNames = computed(() => props.model.themes.map((t) => t.name))
const grans = computed(() => Object.keys(props.model.themes[0].gran))

const themeName = ref(props.model.themes[0].name)
const gran = ref(Object.keys(props.model.themes[0].gran)[0])
const theme = computed(() => props.model.themes.find((t) => t.name === themeName.value) ?? props.model.themes[0])
const slice = computed(() => theme.value.gran[gran.value])

const { el: wrapRef, width: w } = useWidth(560)
const hoverIdx = ref<number | null>(null)

const target = computed(() => slice.value.lines.map((l) => resample(l.pts, N)))
const disp = ref<number[][]>(target.value.map((a) => a.slice()))
let prevTheme = themeName.value
let raf = 0
let snapTimer: ReturnType<typeof setTimeout> | undefined

// 切换 → 同主题内 morph;换主题/线数变化/后台 → 直接落位(淡入衔接)
watch([themeName, gran], () => {
  const to = target.value
  cancelAnimationFrame(raf)
  clearTimeout(snapTimer)
  const from = disp.value
  if (prevTheme !== themeName.value || from.length !== to.length || (typeof document !== 'undefined' && document.hidden)) {
    prevTheme = themeName.value
    disp.value = to.map((a) => a.slice())
    return
  }
  const f = from.map((a) => a.slice())
  const t0 = performance.now(), dur = 660
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / dur), e = easeInOut(t)
    disp.value = to.map((arr, li) => arr.map((v, i) => f[li][i] + (v - f[li][i]) * e))
    if (t < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  snapTimer = setTimeout(() => { disp.value = target.value.map((a) => a.slice()) }, dur + 220)
})
// model 变化(期间切换重新聚合)→ 直接落位
watch(() => props.model, () => {
  if (!props.model.themes.find((t) => t.name === themeName.value)) themeName.value = props.model.themes[0].name
  if (!theme.value.gran[gran.value]) gran.value = Object.keys(theme.value.gran)[0]
  disp.value = target.value.map((a) => a.slice())
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(snapTimer) })

const padT = 26, padB = 18
const H = computed(() => props.height)
const stacked = computed(() => !!slice.value.stacked)
const lines = computed(() => slice.value.lines)

const domain = computed(() => {
  let lo: number, hi: number
  if (stacked.value) {
    lo = 0; hi = 0
    for (let i = 0; i < N; i++) {
      let s = 0
      for (let li = 0; li < disp.value.length; li++) s += disp.value[li][i]
      if (s > hi) hi = s
    }
    hi *= 1.06
  } else {
    lo = Infinity; hi = -Infinity
    disp.value.forEach((a) => a.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v }))
    const pad = (hi - lo) * 0.14 || 1
    lo -= pad; hi += pad
  }
  if (hi - lo < 1e-6) hi = lo + 1
  return { lo, hi }
})
const X = (i: number) => (i / (N - 1)) * w.value
const Y = (v: number) => padT + (1 - (v - domain.value.lo) / (domain.value.hi - domain.value.lo)) * (H.value - padT - padB)
const co = (arr: number[]): Pt[] => arr.map((v, i) => ({ x: X(i), y: Y(v) }))

// 堆叠累计坐标
const cum = computed(() => {
  if (!stacked.value) return null
  const out: { bottom: number[]; top: number[] }[] = []
  const running = new Array<number>(N).fill(0)
  for (let li = 0; li < disp.value.length; li++) {
    const bottom = running.slice()
    for (let i = 0; i < N; i++) running[i] += disp.value[li][i]
    out.push({ bottom, top: running.slice() })
  }
  return out
})

const realLen = computed(() => (lines.value[0]?.pts ?? []).length || 1)
function onMove(e: MouseEvent) {
  const node = wrapRef.value
  if (!node) return
  const r = node.getBoundingClientRect()
  const x = Math.max(0, Math.min(w.value, e.clientX - r.left))
  hoverIdx.value = Math.round((x / w.value) * (N - 1))
}

interface HoverInfo { x: number; topY: number; label: string; rows: { name: string; color: string; val: number }[]; total: number | null }
const hv = computed<HoverInfo | null>(() => {
  if (hoverIdx.value == null) return null
  const hIdx = hoverIdx.value
  const ri = Math.round((hIdx / (N - 1)) * (realLen.value - 1))
  const rows = lines.value.map((l) => ({ name: l.name, color: l.color, val: l.pts[ri] ?? 0 }))
  let total: number | null = null, topY = padT
  if (stacked.value && cum.value) {
    total = rows.reduce((s, r) => s + r.val, 0)
    topY = Y(cum.value[cum.value.length - 1].top[hIdx])
  } else {
    topY = Math.min(...disp.value.map((a) => Y(a[hIdx])))
  }
  return { x: X(hIdx), topY, label: slice.value.labels[ri] ?? '', rows, total }
})
const headDelta = computed(() => (slice.value.up ? 'var(--delta-up)' : 'var(--delta-down)'))
const lineStroke = (kind: FigLine['kind']) => (kind === 'target' ? TARGET : COMPARE)
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 14px; width: 100%">
    <!-- 头部:标题 + 主题切换 -->
    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap">
      <div style="min-width: 0">
        <div style="font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary)">{{ title }}</div>
        <div style="font-size: var(--fs-label); color: var(--text-muted); margin-top: 3px">{{ theme.sub }} · {{ slice.rangeLabel }}</div>
      </div>
      <Segmented :options="themeNames" :model-value="themeName" size="sm" @update:model-value="themeName = $event" />
    </div>

    <!-- 大数 + delta(切换淡入) -->
    <div :key="themeName + gran" class="fig-rise" style="display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap">
      <span style="font-size: 32px; font-weight: var(--fw-semibold); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); letter-spacing: -0.02em">{{ slice.value }}</span>
      <span :style="{ fontSize: '13px', fontWeight: 'var(--fw-semibold)', color: headDelta, display: 'inline-flex', alignItems: 'center', gap: '3px' }">
        <component :is="iconFor(slice.up ? 'trending-up' : 'trending-down')" :size="14" />{{ slice.delta }}
      </span>
    </div>

    <!-- 图表 -->
    <div ref="wrapRef" :style="{ position: 'relative', width: '100%', height: H + 'px', cursor: 'crosshair' }"
      @mousemove="onMove" @mouseleave="hoverIdx = null">
      <svg :key="themeName" :width="w" :height="H" class="fig-fade" style="display: block; overflow: visible">
        <defs>
          <linearGradient id="figcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="FIG_BLUE" stop-opacity="0.13" />
            <stop offset="55%" :stop-color="FIG_BLUE" stop-opacity="0.04" />
            <stop offset="100%" :stop-color="FIG_BLUE" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line v-for="g in [0, 0.5, 1]" :key="'g' + g" x1="0" :x2="w"
          :y1="padT + g * (H - padT - padB)" :y2="padT + g * (H - padT - padB)"
          stroke="var(--divider)" stroke-opacity="0.7" stroke-width="1" />
        <template v-if="stacked && cum">
          <path v-for="(c, li) in cum" :key="li" :d="bandD(co(c.top), co(c.bottom))" :fill="lines[li].color" stroke="#fff" stroke-opacity="0.75" stroke-width="1" />
        </template>
        <template v-else>
          <template v-for="(l, li) in lines" :key="li">
            <g v-if="l.kind === 'area'">
              <path :d="pathD(co(disp[li])) + ` L ${w.toFixed(2)} ${H} L 0 ${H} Z`" fill="url(#figcGrad)" />
              <path :d="pathD(co(disp[li]))" fill="none" :stroke="FIG_BLUE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            </g>
            <path v-else :d="pathD(co(disp[li]))" fill="none" :stroke="lineStroke(l.kind)"
              :stroke-width="l.kind === 'target' ? 1.75 : 2" :stroke-dasharray="l.kind === 'target' ? '2 6' : '6 5'" stroke-linecap="round" />
          </template>
        </template>
        <g v-if="hv">
          <line :x1="hv.x" :y1="padT - 6" :x2="hv.x" :y2="H" :stroke="FIG_BLUE" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="4 4" />
          <template v-if="!stacked">
            <circle v-for="(a, li) in disp" :key="li" :cx="hv.x" :cy="Y(a[hoverIdx!])" :r="lines[li].kind === 'area' ? 5.5 : 4"
              fill="#fff" :stroke="lines[li].kind === 'area' ? FIG_BLUE : lineStroke(lines[li].kind)" stroke-width="2.5" />
          </template>
        </g>
      </svg>

      <div v-if="hv" class="fig-tip" :style="{
        left: Math.max(0, Math.min(w - 150, hv.x - 75)) + 'px',
        top: Math.max(0, hv.topY - (18 * hv.rows.length + (hv.total != null ? 26 : 8) + 30)) + 'px',
      }">
        <div class="lb">{{ hv.label }}</div>
        <div v-for="(r, i) in hv.rows" :key="i" class="row" :style="i ? { marginTop: '4px' } : undefined">
          <span class="sw" :style="{ background: r.color }"></span>
          <span class="nm">{{ r.name }}</span>
          <span class="vv">{{ prefix }}{{ Number(r.val).toFixed(1) }}{{ unit }}</span>
        </div>
        <div v-if="hv.total != null" class="total">
          <span style="font-size: 11.5px; opacity: 0.8">合计</span>
          <span class="vv" style="font-weight: 700; font-size: 13px">{{ prefix }}{{ Number(hv.total).toFixed(1) }}{{ unit }}</span>
        </div>
      </div>
    </div>

    <!-- 图例 -->
    <div :key="'lg' + themeName" class="fig-fade" style="display: flex; justify-content: center; gap: 18px; flex-wrap: wrap">
      <span v-for="(l, i) in lines" :key="i" style="display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-label); color: var(--text-secondary)">
        <span v-if="l.kind === 'area' || l.kind === 'stack'" :style="{ width: '12px', height: '12px', borderRadius: '3px', background: l.color, flex: '0 0 auto' }"></span>
        <span v-else :style="{ width: '16px', height: 0, borderTop: `2px dashed ${lineStroke(l.kind)}`, flex: '0 0 auto' }"></span>
        {{ l.name }}
      </span>
    </div>

    <!-- 粒度胶囊 -->
    <div style="display: flex; justify-content: center; gap: 8px">
      <button v-for="g in grans" :key="g" class="fig-gran" :class="{ on: g === gran }" @click="gran = g">{{ g }}</button>
    </div>
  </div>
</template>

<style scoped>
.fig-fade { animation: figcFade 0.42s var(--ease-standard); }
.fig-rise { animation: figcRise 0.4s var(--ease-standard); }
@keyframes figcFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes figcRise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.fig-tip { position: absolute; min-width: 138px; pointer-events: none; background: rgb(40,52,66); color: #fff; border-radius: 10px; padding: 9px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.18); box-sizing: border-box; }
.fig-tip .lb { font-size: 11px; opacity: 0.65; margin-bottom: 6px; }
.fig-tip .row { display: flex; align-items: center; gap: 8px; }
.fig-tip .sw { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto; }
.fig-tip .nm { font-size: 11.5px; opacity: 0.8; flex: 1; white-space: nowrap; }
.fig-tip .vv { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; font-size: 12.5px; }
.fig-tip .total { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.16); }
.fig-gran { border: none; cursor: pointer; border-radius: 43px; padding: 8px 22px; font-family: var(--font-sans); font-weight: 600; font-size: 12px; letter-spacing: 0.04em; transition: background 0.2s var(--ease-standard), color 0.2s var(--ease-standard); background: rgb(234,236,239); color: rgb(30,30,30); }
.fig-gran.on { background: rgb(40,52,66); color: rgb(234,236,239); }
</style>
