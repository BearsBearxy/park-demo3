<script setup lang="ts">
/**
 * PvNullHist —— 高级分析档 L4「这个偏差有多难碰巧出现」(PV-ANALYSIS-SCREEN-V4 §3.15)。
 *
 * 自绘 SVG 直方图 + 观测竖线,几何照画板 Main.dc.html `4f`:画布 卡内宽 × 138,绘图区 x 30 … 宽 − 8、
 * y 12 … 116;16 格,格 x 与格宽各取 1 位小数后柱两侧各内缩 0.5;纵轴上端 = 最高格 × 1.12;顶圆角 2(矮柱按柱高收);
 * 横轴在第 3 / 7 / 11 / 15 格左缘标数;观测线 2px,上端伸出绘图区 4px,线左直标两行(左边放不下挪到线右)。
 * 分箱、「比它更极端」次数、「N 遍」由 pvAnaV4.logic.ts nullHist 定。
 */
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { PV_COLORS } from './pvAnaColors'
import type { PvNullHistProps } from './pvAnaV4.logic'

// period:观测窗口的说法(当段 / 退回了哪个月)。NullHist 没带窗口,由 view 传 lab.window
const props = defineProps<PvNullHistProps & { period?: string }>()

const H = 138, PAD_L = 30, PAD_R = 8, TOP = 12, BASE = 116
const r1 = (v: number) => +v.toFixed(1)
const { el, width } = useWidth(312)

const fmtObs = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`

const geo = computed(() => {
  const W = width.value
  const bins = props.data.bins
  const lo = bins[0].lo, hi = bins[bins.length - 1].hi
  const span = hi - lo || 1
  const plotW = W - PAD_L - PAD_R
  const X = (v: number) => r1(PAD_L + (v - lo) / span * plotW)
  const raw = plotW / bins.length
  const bw = r1(raw)
  const yMax = Math.max(1, ...bins.map(b => b.count)) * 1.12
  const cols = bins.map((b, i) => {
    const x = r1(PAD_L + i * raw)
    const y = r1(BASE - b.count / yMax * (BASE - TOP))
    const r = Math.min(2, r1(BASE - y))
    const xl = r1(x + 0.5), xr = r1(x + bw - 0.5)
    const d = b.count > 0
      ? `M${xl},${BASE} L${xl},${r1(y + r)} Q${xl},${y} ${r1(xl + r)},${y} L${r1(xr - r)},${y} Q${xr},${y} ${xr},${r1(y + r)} L${xr},${BASE} Z`
      : ''
    return { ...b, x, bw, y, d }
  })
  const ticks = [3, 7, 11, 15].filter(i => i < bins.length).map(i => ({ x: cols[i].x, label: bins[i].lo.toFixed(3) }))
  const ox = X(props.data.obs)
  const l1 = `这一段 ${fmtObs(props.data.obs)}`
  const l2 = `比它更极端的只有 ${props.data.extreme}/${props.data.total} 次`
  const left = ox - 6 - tipWidth([l1, l2], 0) >= PAD_L
  return { W, cols, ticks, obs: { x: ox, l1, l2, tx: left ? r1(ox - 6) : r1(ox + 6), anchor: left ? 'end' : 'start' } }
})

interface TipLine { t: string; b?: number; dim?: number }
const hover = ref<number | null>(null)
const tip = computed(() => {
  const c = hover.value == null ? null : geo.value.cols[hover.value]
  if (!c) return null
  const lines: TipLine[] = [
    { t: `${c.lo.toFixed(3)} ~ ${c.hi.toFixed(3)}`, b: 600 },
    { t: `${props.data.total} 遍里落在这一格 ${c.count} 遍`, dim: 0.82 },
  ]
  const w = tipWidth(lines.map(l => l.t), 22)
  // 画板:格左 + 16 放右边,放不下放到格左 − 8 − 宽
  return { lines, left: tipX(c.x + 4, w, { width: geo.value.W, padL: 0, padR: 0 }, 12) }
})
</script>

<template>
  <section class="av2-card pnh">
    <div class="av2-card-h">
      <span class="t">这个偏差有多难碰巧出现</span>
      <span class="hint">把 {{ data.name }} 的日子打乱重算 {{ data.total }} 遍，看能不能碰出这么大的偏差</span>
    </div>
    <div ref="el" class="pnh-plot" @mouseleave="hover = null">
      <svg :width="geo.W" :height="H" :viewBox="`0 0 ${geo.W} ${H}`" class="pnh-svg" role="img"
        :aria-label="`${geo.obs.l1}，${geo.obs.l2}`">
        <text v-for="t in geo.ticks" :key="t.label" class="ax" :x="t.x" :y="130" text-anchor="middle">{{ t.label }}</text>
        <rect v-if="hover != null && geo.cols[hover]" class="pnh-slot" :x="geo.cols[hover].x" :y="TOP"
          :width="geo.cols[hover].bw" :height="BASE - TOP" />
        <template v-for="(c, i) in geo.cols" :key="i">
          <path v-if="c.d" class="pnh-bar" :data-i="i" :d="c.d" :fill="PV_COLORS.BAND" fill-opacity=".85" />
        </template>
        <line class="axl" :x1="PAD_L" :x2="geo.W - PAD_R" :y1="BASE" :y2="BASE" />
        <line class="pnh-obs" :x1="geo.obs.x" :x2="geo.obs.x" :y1="TOP - 4" :y2="BASE" :stroke="PV_COLORS.BELOW" stroke-width="2" />
        <text class="ax pnh-l1" :x="geo.obs.tx" y="22" :text-anchor="geo.obs.anchor" :style="{ fill: PV_COLORS.BELOW }">{{ geo.obs.l1 }}</text>
        <text class="ax pnh-l2" :x="geo.obs.tx" y="36" :text-anchor="geo.obs.anchor" :style="{ fill: PV_COLORS.AMBER_TEXT }">{{ geo.obs.l2 }}</text>
        <rect v-for="(c, i) in geo.cols" :key="`h${i}`" class="pnh-hit" :x="c.x" :y="TOP" :width="c.bw" :height="BASE - TOP"
          fill="transparent" @mouseenter="hover = i" />
      </svg>
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: `${tip.left}px`, top: '6px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ fontWeight: l.b ?? 400, opacity: l.dim }">{{ l.t }}</span>
      </div>
    </div>
    <p class="ana-read">{{ data.total }} 遍里有 {{ data.extreme }} 遍比这一段更偏。</p>
    <p class="ana-ref">横轴 = 打乱之后算出来的偏差 · 柱高 = {{ data.total }} 遍里落在这一格的次数 · 红线 = 这一段真实的偏差<template v-if="period"> · 这一段 = {{ period }}</template></p>
  </section>
</template>

<style scoped>
.pnh-plot { position: relative; width: 100%; height: 138px; }
.pnh-svg { display: block; }
.ax { font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums; fill: var(--text-muted); }
.pnh-l1 { font-weight: var(--fw-semibold); }
.axl { stroke: var(--ink-900); stroke-opacity: .15; stroke-width: 1; }
.pnh-slot { fill: var(--ink-050); }
.pv-tip {
  display: flex; flex-direction: column; gap: 3px; white-space: nowrap;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-on-solid);
}
</style>
