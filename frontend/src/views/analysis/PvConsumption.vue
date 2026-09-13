<script setup lang="ts">
// B7 · 消纳结构与损耗率(PV-ANALYSIS-SCREEN-V4 §3.8;画布 _design/pv-ana-redesign/v2/Ledger.dc.html)。
// 画布 卡内宽 × 272,padL 46 / padR 46 / padT 22 / padB 26;每刻度一个槽,柱宽 = 槽宽 × 0.6;
// 左轴 万度 = 最高那根柱 × 1.12 四等分;右轴损耗率钉死 0–6%,超出的刻度折线断开 + 轴外三角 + 数值。
// 堆叠自下而上 = 自己用了 / 卖上网 / 路上损掉,只有最顶一段圆角(≤ 3)。数据口径在 consumption()。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { PV_COLORS } from './pvAnaColors'
import { LOSS_AXIS_MAX, type PvConsumptionProps } from './pvAnaV4.logic'

const props = defineProps<PvConsumptionProps>()

const H = 272, PL = 46, PR = 46, PT = 22, PB = 26
const IH = H - PT - PB
const WAN = 10000
/** V4 §3.8:损耗率到这条线,气泡里那一行转琥珀 */
const LOSS_TIP_WARN = 3
const { el, width } = useWidth(999)
const iw = computed(() => width.value - PL - PR)
const n = computed(() => props.data.ticks.length)
const slot = computed(() => iw.value / Math.max(1, n.value))
const bw = computed(() => slot.value * 0.6)
const cx = (i: number) => PL + (i + 0.5) * slot.value
const lastIdx = computed(() => (props.data.futureFrom ?? n.value) - 1)

const ymax = computed(() => {
  const m = Math.max(0, ...props.data.ticks.map(t => (t.self + t.grid + t.loss) / WAN))
  return m > 0 ? m * 1.12 : 1
})
const yLoss = (pct: number) => PT + IH - (pct / LOSS_AXIS_MAX) * IH

const grid = computed(() => [0, 1, 2, 3].map(k => ({
  y: PT + IH - (k / 3) * IH,
  left: ((k / 3) * ymax.value).toFixed(1),
  right: `${(k / 3) * LOSS_AXIS_MAX}%`,
})))

/** 自下而上三段;最顶那段非零的画圆角顶 */
const bars = computed(() => props.data.ticks.map((t, i) => {
  const x = cx(i) - bw.value / 2
  const hs = [t.self, t.grid, t.loss].map(v => (v / WAN / ymax.value) * IH)
  const top = hs.reduce((k, h, j) => (h > 0 ? j : k), -1)
  let y = PT + IH
  const segs = hs.map((h, j) => {
    y -= h
    return { key: ['self', 'grid', 'loss'][j], y, h, round: j === top }
  }).filter(s => s.h > 0)
  return { i, x, segs }
}).filter(b => b.segs.length))

const SEG_FILL: Record<string, string> = { self: PV_COLORS.FOCUS, grid: PV_COLORS.MID, loss: PV_COLORS.LOSS }
function roundTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(3, h), yb = y + h
  return `M${x},${yb} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${yb} Z`
}

const lossRuns = computed(() => {
  const out: number[][] = []
  let cur: number[] = []
  props.data.ticks.forEach((t, i) => {
    if (t.lossPct != null && !t.over) cur.push(i)
    else if (cur.length) { out.push(cur); cur = [] }
  })
  if (cur.length) out.push(cur)
  return out
})
const lossPath = computed(() => lossRuns.value
  .map(r => `M${r.map(i => `${cx(i)},${yLoss(props.data.ticks[i].lossPct!)}`).join(' L')}`).join(' '))
const lossDots = computed(() => lossRuns.value.flat().map(i => ({ i, x: cx(i), y: yLoss(props.data.ticks[i].lossPct!) })))
const overs = computed(() => props.data.ticks.flatMap((t, i) => (t.over && t.lossPct != null ? [{ i, x: cx(i), text: `${t.lossPct.toFixed(1)}%` }] : [])))

const shade = computed(() => {
  const f = props.data.futureFrom
  return f == null ? null : { x: PL + f * slot.value, w: iw.value - f * slot.value }
})

const xLabels = computed(() => {
  const T = props.data.ticks
  const keep = props.data.gran === 'year'
    ? T.map((_, i) => i)
    : T.map((_, i) => i).filter(i => i === 0 || i === T.length - 1 || (Number(T[i].label) % 5 === 0 && T.length - 1 - i >= 3))
  return keep.map(i => ({ x: cx(i), text: T[i].label }))
})

// ── 悬停 ──
const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  if (lastIdx.value < 0) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const i = Math.floor(((e.clientX - r.left - PL) / iw.value) * n.value)
  hover.value = Math.max(0, Math.min(lastIdx.value, i))
}
interface TipLine { t: string; c: string; o?: number; b?: number }
const WHITE = 'var(--text-on-solid)'
const tip = computed(() => {
  const i = hover.value
  const d = props.data
  if (i == null || i > lastIdx.value) return null
  const t = d.ticks[i]
  const lines: TipLine[] = [
    { t: d.gran === 'month' ? `${t.label} 日` : t.label.replace('月', ' 月'), c: WHITE, b: 600 },
    { t: `自己用了 ${(t.self / WAN).toFixed(2)} 万度`, c: PV_COLORS.TIP_SEL },
    { t: `卖上网 ${(t.grid / WAN).toFixed(2)} 万度`, c: PV_COLORS.BAND },
    { t: `路上损掉 ${(t.loss / WAN).toFixed(3)} 万度`, c: WHITE, o: 0.72 },
    t.lossPct == null
      ? { t: '损耗率 —', c: WHITE, o: 0.72 }
      : t.lossPct >= LOSS_TIP_WARN
        ? { t: `损耗率 ${t.lossPct.toFixed(2)}%`, c: PV_COLORS.TIP_ABOVE }
        : { t: `损耗率 ${t.lossPct.toFixed(2)}%`, c: WHITE, o: 0.72 },
  ]
  const x = cx(i)
  return { x, lines, left: tipX(x, tipWidth(lines.map(l => l.t), 22), { width: width.value, padL: 0, padR: 0 }, 14) }
})
</script>

<template>
  <div class="pcs">
    <div ref="el" class="pcs-plot" :style="{ height: H + 'px' }">
      <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="pcs-svg" role="img" aria-label="消纳结构与损耗率">
        <template v-for="g in grid" :key="'g' + g.y">
          <line class="pcs-gl" :x1="PL" :x2="PL + iw" :y1="g.y" :y2="g.y" />
          <text class="pcs-ax pcs-mut pcs-yl" :x="PL - 6" :y="g.y + 4" text-anchor="end">{{ g.left }}</text>
          <text class="pcs-ax pcs-yr" :x="PL + iw + 6" :y="g.y + 4" :fill="PV_COLORS.AMBER_TEXT">{{ g.right }}</text>
        </template>
        <rect v-if="shade" class="pcs-future" :x="shade.x" :y="PT" :width="shade.w" :height="IH" :fill="PV_COLORS.FUTURE" />
        <rect v-if="tip" class="pcs-hair" :x="tip.x - bw / 2 - 3" :y="PT" :width="bw + 6" :height="IH" rx="3" />
        <g v-for="b in bars" :key="'b' + b.i" class="pcs-bar" :data-i="b.i">
          <template v-for="s in b.segs" :key="s.key">
            <path v-if="s.round" :class="['pcs-seg', 'pcs-' + s.key]" :d="roundTop(b.x, s.y, bw, s.h)" :fill="SEG_FILL[s.key]" />
            <rect v-else :class="['pcs-seg', 'pcs-' + s.key]" :x="b.x" :y="s.y" :width="bw" :height="s.h" :fill="SEG_FILL[s.key]" />
          </template>
        </g>
        <line class="pcs-axl" :x1="PL" :x2="PL + iw" :y1="PT + IH" :y2="PT + IH" />
        <text v-for="t in xLabels" :key="'x' + t.x" class="pcs-ax pcs-mut pcs-xl" :x="t.x" :y="H - 8" text-anchor="middle">{{ t.text }}</text>
        <path v-if="lossPath" class="pcs-lossline" :d="lossPath" fill="none" :stroke="PV_COLORS.ABOVE" stroke-width="1.5" stroke-linejoin="round" />
        <circle v-for="p in lossDots" :key="'d' + p.i" class="pcs-lossdot" :cx="p.x" :cy="p.y" r="2.5" :stroke="PV_COLORS.ABOVE" stroke-width="1.5" />
        <template v-for="o in overs" :key="'o' + o.i">
          <polygon class="pcs-over" :points="`${o.x - 4},${PT - 2} ${o.x + 4},${PT - 2} ${o.x},${PT - 9}`" :fill="PV_COLORS.ABOVE" />
          <text class="pcs-ax pcs-overt" :x="o.x + 6" :y="PT - 3" :fill="PV_COLORS.AMBER_TEXT">{{ o.text }}</text>
        </template>
        <text class="pcs-ax pcs-mut" :x="PL - 6" y="10" text-anchor="end">万度</text>
        <text class="pcs-ax" :x="PL + iw + 6" y="10" :fill="PV_COLORS.AMBER_TEXT">损耗率</text>
      </svg>
      <div class="pcs-hit" @mousemove="onMove" @mouseleave="hover = null" />
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: tip.left + 'px', top: '8px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, opacity: l.o, fontWeight: l.b }">{{ l.t }}</span>
      </div>
    </div>
    <div class="pv-leg">
      <span><b class="pv-sw" :style="{ background: PV_COLORS.FOCUS }" />自己用了</span>
      <span><b class="pv-sw" :style="{ background: PV_COLORS.MID }" />卖上网</span>
      <span><b class="pv-sw" :style="{ background: PV_COLORS.LOSS }" />路上损掉</span>
      <span><i class="pv-line" :style="{ background: PV_COLORS.ABOVE }" />损耗率（右轴）</span>
    </div>
    <!-- 图注写在模板里,不走整句插值:文案门禁(anaCopyLint)扫得到 -->
    <p class="ana-ref">左轴 = 万度，三段自下而上 = 自己用了 / 卖上网 / 路上损掉 · 右轴 = 损耗率，刻度钉死在 0–{{ LOSS_AXIS_MAX }}% 不随数据缩放<template v-if="overs.length"> · {{ overs.length }} {{ data.gran === 'month' ? '天' : '个月' }}超过 {{ LOSS_AXIS_MAX }}%，折线在那里断开，轴外三角标数值</template><template v-if="data.throughIdx != null"> · 数据到 {{ data.ticks[data.throughIdx].label }}{{ data.gran === 'month' ? ' 日' : '' }}</template></p>
  </div>
</template>

<style scoped>
.pcs-plot { position: relative; width: 100%; }
.pcs-svg { display: block; }
.pcs-hit { position: absolute; inset: 0; }
.pcs-gl { stroke: var(--ink-100); stroke-width: 1; }
.pcs-axl { stroke: var(--ink-300); stroke-opacity: .75; stroke-width: 1; }
.pcs-hair { fill: var(--ink-050); }
.pcs-lossdot { fill: var(--surface-page); }
/* 字形与颜色分开:琥珀字靠 fill 属性上色,类里写了 fill 会把属性盖掉 */
.pcs-ax { font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pcs-mut { fill: var(--text-muted); }
.pv-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pv-leg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.pv-leg span { display: inline-flex; align-items: center; gap: 5px; }
.pv-sw { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.pv-line { display: inline-block; width: 14px; height: 2px; border-radius: 2px; }
</style>
