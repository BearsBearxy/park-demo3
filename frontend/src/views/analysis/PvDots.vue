<script setup lang="ts">
// 各站年等效小时 —— **点图(Cleveland dot plot),不是零起点条形**。
//
// 为什么换掉 bullet:这些值天然聚在一条窄带里(实测 978~1 038 h,6%;
// 模拟器修好后也只有 16%)。**零起点的条形把 6% 的差画成 13 根一样长的柱**,
// 差异按构造就看不见 —— 与「各站发电效率排名图是一堵齐平的墙」是同一个病。
// 条形必须从 0 起,因为它用**长度**编码;点用**位置**编码,轴可以贴着实际值域,
// 于是同样的 6% 展得开。这正是 Cleveland 当年发明点图要解决的事。
//
// 从锚点出发的细杆:让「离锚点多远」同时有长度可读(共用刻度上的位置 + 长度,
// Cleveland-McGill 里最靠前的两档)。杆不是从 0 起的条,不构成零基线问题。
//
// 用内联 SVG 不用 ECharts:ECharts 的 bar 只能从 0 起,做不出「从锚点长出去」的杆;
// custom series 在本仓的 echartsBundle 里没注册。spec §06.5 记的也是 inline-svg。
import { computed } from 'vue'
import { useWidth } from '@/components/ana/useWidth'

const props = defineProps<{
  rows: { name: string; value: number }[]
  target: number
  unit?: string
}>()
const emit = defineEmits<{ (e: 'pick', name: string): void }>()

const { el, width } = useWidth(420)

const ML = 96          // 栋名列 —— 与队列 / slopegraph / 抽屉表同宽同左缘(§06.7 的隐形基线)
const MR = 44          // 右侧留给数值
const RH = 22          // 行高
const MT = 8
const MB = 22

const vw = computed(() => Math.max(300, Math.round(width.value)))
const vh = computed(() => MT + props.rows.length * RH + MB)
const iw = computed(() => vw.value - ML - MR)

/** 轴域贴着实际值域 + 锚点,再各外扩 8% —— 点是位置编码,不需要零起点 */
const dom = computed(() => {
  const vs = props.rows.map(r => r.value).concat([props.target])
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const pad = Math.max((hi - lo) * 0.18, 12)
  return { lo: lo - pad, hi: hi + pad }
})
const X = (v: number) => ML + ((v - dom.value.lo) / (dom.value.hi - dom.value.lo)) * iw.value

/** 按值降序 —— 顺序本身就是「排行」,不需要再上色 */
const sorted = computed(() => [...props.rows].sort((a, b) => b.value - a.value))
const tx = computed(() => X(props.target))

/** x 轴刻度:锚点 + 两端,只标三个,不铺一排灰噪声 */
const ticks = computed(() => {
  const { lo, hi } = dom.value
  return [lo + (hi - lo) * 0.08, props.target, hi - (hi - lo) * 0.08]
    .map(v => ({ v: Math.round(v), x: X(v) }))
})
</script>

<template>
  <div ref="el" class="pv-dots">
    <svg :viewBox="`0 0 ${vw} ${vh}`" :width="vw" :height="vh" role="img"
      :aria-label="`各站年等效小时点图，锚点 ${target}${unit ?? ''}。` +
        sorted.map(r => `${r.name} ${r.value}`).join('，')">
      <!-- 锚点竖线:全图唯一的参照 -->
      <line class="tgt" :x1="tx" :x2="tx" :y1="MT - 2" :y2="MT + sorted.length * RH" />

      <g v-for="(r, i) in sorted" :key="r.name"
        class="row" @click="emit('pick', r.name)">
        <rect class="hit" :x="0" :y="MT + i * RH" :width="vw" :height="RH" />
        <text class="nm" :x="ML - 8" :y="MT + i * RH + RH / 2 + 4">{{ r.name }}</text>
        <!-- 从锚点长出去的细杆:偏离同时有长度可读 -->
        <line class="stem" :x1="tx" :x2="X(r.value)"
          :y1="MT + i * RH + RH / 2" :y2="MT + i * RH + RH / 2" />
        <circle class="dot" :cx="X(r.value)" :cy="MT + i * RH + RH / 2" r="4" />
        <text class="vl" :x="vw - MR + 6" :y="MT + i * RH + RH / 2 + 4">{{ r.value }}</text>
      </g>

      <line class="ax" :x1="ML" :x2="vw - MR" :y1="MT + sorted.length * RH + 4"
        :y2="MT + sorted.length * RH + 4" />
      <text v-for="t in ticks" :key="t.v" class="xt" :x="t.x"
        :y="MT + sorted.length * RH + 17">{{ t.v }}</text>
    </svg>
  </div>
</template>

<style scoped>
.pv-dots { width: 100%; }
.pv-dots svg { display: block; width: 100%; height: auto; }

/* 13 栋同一支墨色,没有任何一栋有自己的颜色(§06.7) */
.dot { fill: var(--ink-700); }
.stem { stroke: var(--ink-300); stroke-width: 2; }
.tgt { stroke: var(--ink-500); stroke-width: 1.4; stroke-dasharray: 3 3; }
.ax { stroke: var(--ink-100); }

.nm {
  font-size: var(--fs-label); fill: var(--text-secondary); text-anchor: end;
}
.vl {
  font-size: var(--fs-micro); fill: var(--text-secondary); text-anchor: start;
  font-family: var(--font-mono);
}
.xt {
  font-size: var(--fs-micro); fill: var(--text-muted); text-anchor: middle;
  font-family: var(--font-mono);
}
.hit { fill: transparent; }
.row { cursor: pointer; }
.row:hover .hit { fill: var(--bg-hover); }
.row:hover .nm { fill: var(--text-primary); }
</style>
