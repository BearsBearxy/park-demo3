<script setup lang="ts">
// B7 · 自用、上网和损耗(PV-ANALYSIS-SCREEN-V4 §3.8;2026-10-06 改稿画板 pv-v2-m-ledger / y-ledger)。
// 画布 卡内宽 × 272,padL 46 / padR 46 / padT 22 / padB 26;每刻度一个槽,柱宽 = 槽宽 × 0.6;
// 左轴 万kWh = 最高那根柱 × 1.12 四等分;右轴损耗率钉死 0–6%,超出的刻度折线断开 + 轴外三角 + 数值。
// 堆叠自下而上 = 自己用了 / 卖上网 / 损耗,只有最顶一段圆角(≤ 3)。数据口径在 consumption()。
// 2026-10-06:损耗率折线与右轴字改墨阶虚线(橙只留给「高于平时 / 超限」,超 6% 的三角照旧橙);
// 按年读数句点到的两个月柱顶出深色气泡,某期并网的月柱顶标「几期并网」(轴字同款灰)。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useEnterPhase, useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import '@/components/ana/ana.css'   // @keyframes fp-wipe
import { PV } from '@/components/ana/anaSentence'
import { PV_COLORS } from './pvAnaColors'
import { LOSS_AXIS_MAX, type PvConsumptionProps } from './pvAnaV4.logic'

const props = defineProps<PvConsumptionProps>()

const PL = 46, PR = 46, PT = 22, PB = 26
const WAN = 10000
/** V4 §3.8:损耗率到这条线,气泡里那一行转琥珀 */
const LOSS_TIP_WARN = 3
const { el, width } = useWidth(999)
// 手机稿 §⑤:判容器宽(不判视口,桌面 .av2-s4 窄栏同样只有 300 多)。窄档换几何,不缩整幅、字号不动。
const narrow = computed(() => width.value < 420)
const H = computed(() => (narrow.value ? 230 : 272))
const IH = computed(() => H.value - PT - PB)
// 挂载时在视口内擦入 320,否则瞬到;换期 200 同键形变(柱按刻度、损耗线按段起点刻度),擦入中 / 改宽时 hold 关掉
const first = useEnterPhase(el)
const hold = useMorphHold(width, first)
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
const yLoss = (pct: number) => PT + IH.value - (pct / LOSS_AXIS_MAX) * IH.value

const grid = computed(() => [0, 1, 2, 3].map(k => ({
  y: PT + IH.value - (k / 3) * IH.value,
  left: ((k / 3) * ymax.value).toFixed(1),
  right: `${(k / 3) * LOSS_AXIS_MAX}%`,
})))

/** 自下而上三段;最顶那段非零的画圆角顶 */
const bars = computed(() => props.data.ticks.map((t, i) => {
  const x = cx(i) - bw.value / 2
  const hs = [t.self, t.grid, t.loss].map(v => (v / WAN / ymax.value) * IH.value)
  const top = hs.reduce((k, h, j) => (h > 0 ? j : k), -1)
  let y = PT + IH.value
  const segs = hs.map((h, j) => {
    y -= h
    return { key: ['self', 'grid', 'loss'][j], y, h, round: j === top }
  }).filter(s => s.h > 0)
  return { i, x, segs }
}).filter(b => b.segs.length))

// computed:切外观时损耗段的墨色跟着换(页签常驻不重挂载)
const SEG_FILL = computed<Record<string, string>>(() => ({ self: PV_COLORS.FOCUS, grid: PV_COLORS.MID, loss: PV_COLORS.LOSS }))
function roundTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(3, h), yb = y + h
  return `M${x},${yb} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${yb} Z`
}

/** 第 i 根柱的槽心与柱顶(三段里最高那段的上沿);没柱(没发电)= null */
function topOf(i: number): { x: number; y: number } | null {
  const b = bars.value.find(x => x.i === i)
  return b ? { x: cx(i), y: Math.min(...b.segs.map(s => s.y)) } : null
}
/** 柱顶上方 6px:并网短标(SVG 字)与读数句气泡(HTML,translate(-50%, -100%) 往上长) */
const joinTexts = computed(() => props.data.joins.flatMap(j => { const t = topOf(j.i); return t ? [{ ...t, y: t.y - 6, text: j.text, i: j.i }] : [] }))
const callouts = computed(() => props.data.marks.flatMap(k => { const t = topOf(k.i); return t ? [{ ...t, y: t.y - 6, text: k.text, i: k.i }] : [] }))

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
/** 损耗线拆成相邻两刻度一段、按起点刻度作键:每段同一「M L」结构才能形变;超轴 / 空的刻度两侧不出段 = 断开 */
const lossSegs = computed(() => lossRuns.value.flatMap(r => r.slice(1).map((j, k) => {
  const i = r[k]
  return { i, d: `M${cx(i)},${yLoss(props.data.ticks[i].lossPct!)} L${cx(j)},${yLoss(props.data.ticks[j].lossPct!)}` }
})))
const lossDots = computed(() => lossRuns.value.flat().map(i => ({ i, x: cx(i), y: yLoss(props.data.ticks[i].lossPct!) })))
const overs = computed(() => props.data.ticks.flatMap((t, i) => (t.over && t.lossPct != null ? [{ i, x: cx(i), text: `${t.lossPct.toFixed(1)}%` }] : [])))

const shade = computed(() => {
  const f = props.data.futureFrom
  return f == null ? null : { x: PL + f * slot.value, w: iw.value - f * slot.value }
})

const xLabels = computed(() => {
  const T = props.data.ticks
  // 窄档年表隔一标(1/3/5/7/9/11 月);日表本来就只标 1 / 5 的倍数 / 末尾,已经够疏
  const keep = props.data.gran === 'year'
    ? T.map((_, i) => i).filter(i => !narrow.value || i % 2 === 0)
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
    { t: `自己用了 ${(t.self / WAN).toFixed(2)} 万kWh`, c: PV_COLORS.TIP_SEL },
    { t: `卖上网 ${(t.grid / WAN).toFixed(2)} 万kWh`, c: PV_COLORS.BAND },
    { t: `${PV.consLoss} ${(t.loss / WAN).toFixed(3)} 万kWh`, c: WHITE, o: 0.72 },
    t.lossPct == null
      ? { t: '损耗率 —', c: WHITE, o: 0.72 }
      : t.lossPct >= LOSS_TIP_WARN
        ? { t: `损耗率 ${t.lossPct.toFixed(2)}%`, c: WHITE }   // 不用琥珀(橙只留给「高于平时 / 超限」),只比别的行亮
        : { t: `损耗率 ${t.lossPct.toFixed(2)}%`, c: WHITE, o: 0.72 },
  ]
  const x = cx(i)
  return { x, lines, left: tipX(x, tipWidth(lines.map(l => l.t), 22), { width: width.value, padL: 0, padR: 0 }, 14) }
})
</script>

<template>
  <div class="pcs">
    <div ref="el" class="pcs-plot" :style="{ height: H + 'px' }">
      <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="pcs-svg" role="img" :aria-label="PV.card.cons">
        <template v-for="g in grid" :key="'g' + g.y">
          <line class="pcs-gl" :x1="PL" :x2="PL + iw" :y1="g.y" :y2="g.y" />
          <text class="pcs-ax pcs-mut pcs-yl" :x="PL - 6" :y="g.y + 4" text-anchor="end">{{ g.left }}</text>
          <text class="pcs-ax pcs-yr" :x="PL + iw + 6" :y="g.y + 4" :fill="PV_COLORS.AXIS_TEXT">{{ g.right }}</text>
        </template>
        <rect v-if="shade" class="pcs-future" :x="shade.x" :y="PT" :width="shade.w" :height="IH" :fill="PV_COLORS.FUTURE" />
        <rect v-if="tip" class="pcs-hair" :x="tip.x - bw / 2 - 3" :y="PT" :width="bw + 6" :height="IH" rx="3" />
        <!-- 轴线与 x 刻度挪到柱前,留在数据组外(C6-25) -->
        <line class="pcs-axl" :x1="PL" :x2="PL + iw" :y1="PT + IH" :y2="PT + IH" />
        <text v-for="t in xLabels" :key="'x' + t.x" class="pcs-ax pcs-mut pcs-xl" :x="t.x" :y="H - 8" text-anchor="middle">{{ t.text }}</text>
        <!-- 组按粒度作键:刻度下标跨粒度不是同一类目,按月 ↔ 按年整组换新元素瞬到 -->
        <g :key="data.gran" :class="['pcs-data', 'ana-morph', { first, hold }]" @animationend.self="first = false" @animationcancel.self="first = false">
          <g v-for="b in bars" :key="'b' + b.i" class="pcs-bar" :data-i="b.i">
            <template v-for="s in b.segs" :key="s.key">
              <path v-if="s.round" :class="['pcs-seg', 'pcs-' + s.key]" :d="roundTop(b.x, s.y, bw, s.h)" :fill="SEG_FILL[s.key]" />
              <rect v-else :class="['pcs-seg', 'pcs-' + s.key]" :x="b.x" :y="s.y" :width="bw" :height="s.h" :fill="SEG_FILL[s.key]" />
            </template>
          </g>
          <path v-for="s in lossSegs" :key="'l' + s.i" class="pcs-lossline" :data-i="s.i" :d="s.d" fill="none" :stroke="PV_COLORS.REF" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="4 3" />
          <circle v-for="p in lossDots" :key="'d' + p.i" class="pcs-lossdot" :cx="p.x" :cy="p.y" r="2.5" :stroke="PV_COLORS.REF" stroke-width="1.5" />
          <!-- 轴外三角 + 数值整组按槽心平移:<polygon> 的 points 与 <text> 的 x 都过渡不了,槽宽一变柱在滑、它们先跳。
               组的 transform 走 .pcs-overg 的过渡(ana-morph 只管 rect / path / circle 的几何属性) -->
          <g v-for="o in overs" :key="'o' + o.i" class="pcs-overg" :style="{ transform: `translate(${o.x}px, 0px)` }">
            <path class="pcs-over" :d="`M-4,${PT - 2} L4,${PT - 2} L0,${PT - 9} Z`" :fill="PV_COLORS.ABOVE" />
            <text class="pcs-ax pcs-overt" x="6" :y="PT - 3" :fill="PV_COLORS.AXIS_TEXT">{{ o.text }}</text>
          </g>
          <text v-for="j in joinTexts" :key="'j' + j.i" class="pcs-ax pcs-join" :x="j.x" :y="j.y" text-anchor="middle">{{ j.text }}</text>
        </g>
        <text class="pcs-ax pcs-mut" :x="PL - 6" y="10" text-anchor="end">万kWh</text>
        <text class="pcs-ax" :x="PL + iw + 6" y="10" :fill="PV_COLORS.AXIS_TEXT">损耗率</text>
      </svg>
      <div class="pcs-hit" @mousemove="onMove" @mouseleave="hover = null" />
      <div v-for="k in callouts" :key="'c' + k.i" class="pcs-callout" :style="{ left: k.x + 'px', top: k.y + 'px' }">{{ k.text }}</div>
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: tip.left + 'px', top: '8px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, opacity: l.o, fontWeight: l.b }">{{ l.t }}</span>
      </div>
    </div>
    <div class="pv-leg">
      <span><b class="pv-sw" :style="{ background: PV_COLORS.FOCUS }" />自己用了</span>
      <span><b class="pv-sw" :style="{ background: PV_COLORS.MID }" />卖上网</span>
      <span><b class="pv-sw" :style="{ background: PV_COLORS.LOSS }" />{{ PV.consLoss }}</span>
      <span><i class="pv-line" :style="{ background: `repeating-linear-gradient(90deg, ${PV_COLORS.REF} 0 4px, transparent 4px 7px)` }" />损耗率（右轴）</span>
    </div>
    <!-- 读数句与参照由屏接着写在卡里,走句型库 PV 段 -->
  </div>
</template>

<style scoped>
.pcs-plot { position: relative; width: 100%; }
.pcs-svg { display: block; }
/* 首绘:数据组自左擦出一次(C6-25);fp-wipe 在 ana.css,不能写进 scoped(名字会被加 hash) */
.pcs-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
.pcs-overg { transition: transform var(--dur-base) var(--ease-out); }
.hold > .pcs-overg { transition: none; }
.pcs-hit { position: absolute; inset: 0; }
.pcs-gl { stroke: var(--ink-100); stroke-width: 1; }
.pcs-axl { stroke: var(--ink-300); stroke-opacity: .75; stroke-width: 1; }
.pcs-hair { fill: var(--ink-050); }
.pcs-lossdot { fill: var(--surface-page); }
/* 字形与颜色分开:琥珀字靠 fill 属性上色,类里写了 fill 会把属性盖掉 */
.pcs-ax { font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pcs-mut { fill: var(--text-muted); }
.pcs-join { fill: var(--text-secondary); }
/* 读数句点到的月:柱顶深色气泡(同 AnaEChart 的 .ana-callout 样子 —— 那份是 scoped,这里抄一份;自绘 SVG 不走 calloutMark) */
.pcs-callout {
  position: absolute; z-index: 1; pointer-events: none; transform: translate(-50%, -100%);
  padding: 4px 8px; border-radius: 6px; background: var(--tip-bg); color: var(--text-on-solid);
  font-size: var(--fs-micro); line-height: 15px; font-weight: var(--fw-semibold); white-space: nowrap;
  box-shadow: var(--shadow-tip);
}
.pcs-callout::after {
  content: ''; position: absolute; top: 100%; left: calc(50% - 6px);
  border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 6px solid var(--tip-bg);
}
.pv-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pv-leg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.pv-leg span { display: inline-flex; align-items: center; gap: 5px; }
.pv-sw { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.pv-line { display: inline-block; width: 14px; height: 2px; border-radius: 2px; }
</style>
