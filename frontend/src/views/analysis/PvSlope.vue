<script setup lang="ts">
// PV-ANALYSIS-SPEC §06.5 B4 —— 年档等效小时 slopegraph(去年 → 今年),内联 SVG。
// 两个时点比 13 个实体:两点线段 + 两端 direct label,墨迹比 13 条 12 点折线少一个量级,
// 交叉与陡降靠位置自己暴露(Tufte 1983 p.158)。无图例、无坐标轴 —— 数值就印在两端。
// 两端共用同一根纵轴(共一套 min/max),否则两端的高低没法比。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { fnum } from '@/components/ana/anaFmt'

export interface SlopePoint { name: string; prev: number | null; cur: number | null }

/** selName = 队列里当前选中的那一栋 —— 只有它上焦点色(§06.7)。不传则整图墨阶。 */
const props = defineProps<{ points: SlopePoint[]; selName?: string }>()
const emit = defineEmits<{ (e: 'pick', name: string): void }>()

const { el, width: w } = useWidth(640)
const H = 226, padL = 96, padR = 96, padT = 26, padB = 14

// prev 或 cur 缺一端就画不出斜率 —— 不画线段,在图注里计数。
const drawn = computed(() =>
  props.points.filter((p): p is { name: string; prev: number; cur: number } =>
    p.prev != null && p.cur != null))
const skipN = computed(() => props.points.length - drawn.value.length)

const x1 = padL
const x2 = computed(() => Math.max(padL + 60, w.value - padR))
const dom = computed(() => {
  const vs = drawn.value.flatMap((p) => [p.prev, p.cur])
  if (!vs.length) return { lo: 0, span: 1 }
  const lo = Math.min(...vs), hi = Math.max(...vs)
  return { lo, span: hi - lo || Math.abs(lo) || 1 }
})
const Y = (v: number) => padT + (1 - (v - dom.value.lo) / dom.value.span) * (H - padT - padB)

// 选中那条排到最后画:SVG 按文档顺序涂,排在中间会被后面 12 条墨线压过去。
// sort 是稳定的,其余各栋维持原顺序。
const segs = computed(() => drawn.value
  .map((p) => ({ ...p, y1: Y(p.prev), y2: Y(p.cur) }))
  .sort((a, b) => Number(a.name === props.selName) - Number(b.name === props.selName)))

// 标签防叠:按 y 排序逐个比,间距 < 12px 的那个只留栋名、隐去数值。
// 两端同一套规则 —— 左端挤在一起时同样读不出,规则只写右端会在左端留下一堆糊字。
const crowd = (ys: { name: string; y: number }[]) => {
  const hid = new Set<string>()
  let last = -Infinity
  for (const p of [...ys].sort((a, b) => a.y - b.y)) {
    if (p.y - last < 12) hid.add(p.name)
    last = p.y
  }
  return hid
}
const hidL = computed(() => crowd(segs.value.map((s) => ({ name: s.name, y: s.y1 }))))
const hidR = computed(() => crowd(segs.value.map((s) => ({ name: s.name, y: s.y2 }))))

const hov = ref<string | null>(null)
const fh = (v: number) => fnum(v, 0)
</script>

<template>
  <div ref="el" class="pv-slope">
    <svg :width="w" :height="H" style="display: block">
      <text :x="x1" y="12" class="hd" text-anchor="middle">去年</text>
      <text :x="x2" y="12" class="hd" text-anchor="middle">今年</text>

      <g v-for="s in segs" :key="s.name" :class="{ on: hov === s.name, sel: s.name === selName }"
        @mouseenter="hov = s.name" @mouseleave="hov = null" @click="emit('pick', s.name)">
        <title>{{ s.name }} 去年 {{ fh(s.prev) }} → 今年 {{ fh(s.cur) }}</title>
        <line class="hit" :x1="x1" :y1="s.y1" :x2="x2" :y2="s.y2" />
        <line class="seg" :x1="x1" :y1="s.y1" :x2="x2" :y2="s.y2" />
        <text class="lb" :x="x1 - 8" :y="s.y1 + 3.5" text-anchor="end">
          {{ s.name }}<tspan v-if="!hidL.has(s.name)" class="vl"> {{ fh(s.prev) }}</tspan>
        </text>
        <text class="lb" :x="x2 + 8" :y="s.y2 + 3.5">
          {{ s.name }}<tspan v-if="!hidR.has(s.name)" class="vl"> {{ fh(s.cur) }}</tspan>
        </text>
      </g>
    </svg>
    <div class="cap">
      年等效小时 kWh/kWp<template v-if="skipN">　·　去年或今年无抄表 {{ skipN }} 栋不参与</template>
    </div>
  </div>
</template>

<style scoped>
.pv-slope { position: relative; width: 100%; }
.hd { font-size: 11px; fill: var(--text-muted); }
/* 群体全部同色同粗(墨色 20%)—— 13 栋仍然没有任何一栋拥有自己的颜色。
   焦点色编码的是「当前选中」这一个状态:点谁谁亮,换一栋就还回墨阶。
   出范围不在这里上色:--hue-orange 只在 L0/L1(§06.0),L2 的区分由焦点承担。
   状态不只靠颜色 —— 选中那条同时加粗到 2px、两端栋名加重。 */
.seg { stroke: var(--ink-300); stroke-width: 1; fill: none; }
.hit { stroke: transparent; stroke-width: 12; cursor: pointer; }
.lb { font-size: 11px; fill: var(--text-secondary); pointer-events: none; }
.vl { font-family: var(--font-mono); font-variant-numeric: tabular-nums; fill: var(--text-primary); }
g.on .seg { stroke: var(--ink-900); stroke-width: 2; }
g.on .lb { fill: var(--text-primary); font-weight: 600; }
/* 排在 .on 之后:选中那条被悬停时,焦点色压过临时的墨色高亮。两端 direct label 保持墨阶。 */
g.sel .seg { stroke: var(--hue-blue); stroke-width: 2; }
g.sel .lb { fill: var(--text-primary); font-weight: 600; }
.cap { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
</style>
