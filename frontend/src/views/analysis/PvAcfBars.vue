<script setup lang="ts">
/**
 * PvAcfBars —— 高级分析档 L2「昨天偏高，今天还会偏高吗」(PV-ANALYSIS-SCREEN-V4 §3.14)。
 *
 * 自绘 SVG 竖柱 + 淡带,几何照画板 Main.dc.html `4e`:画布 卡内宽 × 138,绘图区 x 30 … 宽 − 8、
 * y 10 … 116;柱宽 = 槽宽 × 0.56、顶圆角 2;横网格每 0.3 一条;x 标 1、每隔 3、末一个。
 * 纵轴上端 = max(最高柱, 带) 取到 0.1、下端 = min(最低柱, −带) 取到 0.05(画板数据算出来正好 0.7 / −0.15)。
 * 淡带半宽与「在不在带里」由 pvAnaV4.logic.ts acfBars 定;带内柱浅一档。
 */
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { PV_COLORS } from './pvAnaColors'
import type { PvAcfBarsProps } from './pvAnaV4.logic'

const props = defineProps<PvAcfBarsProps>()

const H = 138, PAD_L = 30, PAD_R = 8, TOP = 10, BASE = 116
const r1 = (v: number) => +v.toFixed(1)
const { el, width } = useWidth(312)

const geo = computed(() => {
  const W = width.value
  const bars = props.data.bars
  const thr = Number.isFinite(props.data.threshold) ? props.data.threshold : 0
  const yMax = Math.ceil(Math.max(thr, ...bars.map(b => b.rho)) * 10) / 10
  const yMin = Math.floor(Math.min(-thr, ...bars.map(b => b.rho)) * 20) / 20
  const Y = (v: number) => r1(TOP + (yMax - v) / (yMax - yMin) * (BASE - TOP))
  const y0 = Y(0)
  const grid: { y: number; label: string }[] = []
  for (let k = Math.ceil(yMin / 0.3); k * 0.3 <= yMax + 1e-9; k++) grid.push({ y: Y(k * 0.3), label: (k * 0.3).toFixed(1) })
  const slot = (W - PAD_L - PAD_R) / Math.max(1, bars.length)
  const bw = r1(slot * 0.56)
  const last = bars.length ? bars[bars.length - 1].lag : 0
  const cols = bars.map((b, i) => {
    const x = r1(PAD_L + i * slot + (slot - bw) / 2)
    const yv = Y(b.rho)
    const r = Math.min(2, Math.abs(yv - y0))
    // 正值顶端圆角、负值底端圆角
    const d = b.rho >= 0
      ? `M${x},${y0} L${x},${r1(yv + r)} Q${x},${yv} ${r1(x + r)},${yv} L${r1(x + bw - r)},${yv} Q${r1(x + bw)},${yv} ${r1(x + bw)},${r1(yv + r)} L${r1(x + bw)},${y0} Z`
      : `M${x},${y0} L${x},${r1(yv - r)} Q${x},${yv} ${r1(x + r)},${yv} L${r1(x + bw - r)},${yv} Q${r1(x + bw)},${yv} ${r1(x + bw)},${r1(yv - r)} L${r1(x + bw)},${y0} Z`
    return {
      ...b, x, d, slotX: r1(PAD_L + i * slot), cx: r1(x + bw / 2),
      fill: b.inside ? PV_COLORS.MID : PV_COLORS.FOCUS,
      tick: b.lag === last || (b.lag % 3 === 1 && b.lag <= last - 2),
    }
  })
  return {
    W, grid, y0, cols, slot: r1(slot),
    band: thr > 0 ? { y: Y(thr), h: r1(Y(-thr) - Y(thr)) } : null,
  }
})

interface TipLine { t: string; b?: number; dim?: number; c?: string }
const hover = ref<number | null>(null)
const tip = computed(() => {
  const c = hover.value == null ? null : geo.value.cols[hover.value]
  if (!c) return null
  const lines: TipLine[] = [
    { t: `隔 ${c.lag} 天`, b: 600 },
    c.inside ? { t: `${c.rho.toFixed(2)}　在淡带里，算没有规律`, dim: 0.72 } : { t: `${c.rho.toFixed(2)}　还看得出关系`, c: PV_COLORS.TIP_SEL },
  ]
  const w = tipWidth(lines.map(l => l.t), 22)
  // 画板:柱左 + 16 放右边,放不下放到柱左 − 8 − 宽
  return { lines, left: tipX(c.x + 4, w, { width: geo.value.W, padL: 0, padR: 0 }, 12) }
})

// 读数句只写测量(§1 #18):隔 1 天、隔 3 天的值 + 带外几根
const read = computed(() => {
  const bs = props.data.bars
  const at = (k: number) => bs.find(b => b.lag === k)?.rho.toFixed(2) ?? null
  return { r1: at(1), r3: at(3), last: bs.length ? bs[bs.length - 1].lag : 0, outN: bs.filter(b => !b.inside).length }
})
</script>

<template>
  <section class="av2-card pacf">
    <div class="av2-card-h">
      <span class="t">昨天偏高，今天还会偏高吗</span>
      <span class="hint">偏差是一天天连着的，还是各天各的</span>
    </div>
    <div ref="el" class="pacf-plot" @mouseleave="hover = null">
      <svg :width="geo.W" :height="H" :viewBox="`0 0 ${geo.W} ${H}`" class="pacf-svg" role="img" :aria-label="`${data.name} 隔 1–${read.last} 天的相关柱`">
        <template v-for="g in geo.grid" :key="g.label">
          <line class="gl" :x1="PAD_L" :x2="geo.W - PAD_R" :y1="g.y" :y2="g.y" :stroke="PV_COLORS.GRID" />
          <text class="ax" :x="PAD_L - 5" :y="g.y + 4" text-anchor="end">{{ g.label }}</text>
        </template>
        <rect v-if="geo.band" class="pacf-band" :x="PAD_L" :y="geo.band.y" :width="geo.W - PAD_L - PAD_R" :height="geo.band.h"
          :fill="PV_COLORS.BAND" fill-opacity=".20" />
        <rect v-if="hover != null && geo.cols[hover]" class="pacf-slot" :x="geo.cols[hover].slotX" :y="TOP"
          :width="geo.slot" :height="BASE - TOP" />
        <path v-for="c in geo.cols" :key="c.lag" class="pacf-bar" :data-lag="c.lag" :d="c.d" :fill="c.fill" />
        <line class="axl" :x1="PAD_L" :x2="geo.W - PAD_R" :y1="geo.y0" :y2="geo.y0" />
        <template v-for="c in geo.cols" :key="`t${c.lag}`">
          <text v-if="c.tick" class="ax" :x="c.cx" :y="130" text-anchor="middle">{{ c.lag }}</text>
        </template>
        <rect v-for="(c, i) in geo.cols" :key="`h${c.lag}`" class="pacf-hit" :x="c.slotX" :y="TOP" :width="geo.slot"
          :height="BASE - TOP" fill="transparent" @mouseenter="hover = i" />
      </svg>
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: `${tip.left}px`, top: '6px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ fontWeight: l.b ?? 400, opacity: l.dim, color: l.c }">{{ l.t }}</span>
      </div>
    </div>
    <p v-if="read.r1" class="ana-read">隔 1 天 {{ read.r1 }}<template v-if="read.r3">，隔 3 天 {{ read.r3 }}</template> · 隔 1–{{ read.last }} 天里 {{ read.outN }} 根柱在淡带外。</p>
    <p class="ana-ref">横轴 = 隔几天 · 淡带之内算没有规律，柱子画浅一档 · 拿 {{ data.name }} 整年的逐日偏差算</p>
  </section>
</template>

<style scoped>
.pacf-plot { position: relative; width: 100%; height: 138px; }
.pacf-svg { display: block; }
.ax { font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums; fill: var(--text-muted); }
.axl { stroke: var(--ink-900); stroke-opacity: .15; stroke-width: 1; }
.gl { stroke-width: 1; }
.pacf-slot { fill: var(--ink-050); }
.pv-tip {
  display: flex; flex-direction: column; gap: 3px; white-space: nowrap;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-on-solid);
}
</style>
