<script setup lang="ts">
// A2 · 每千瓦日均和合格线的差(PV-ANALYSIS-SCREEN-V4 §3.6;2026-10-06 改稿画板 pv-v2-m-abs,只在按月出)。
// 画布 卡内宽 × (上 8 + 行数 × 26 + 下 34);栋名列 96(名字右对齐于 86);右侧预留 176;(这些是桌面档,窄档见下 narrow)
// 0 线 = 合格线摊到每天,落在绘图宽 22% 处;条长 = 比合格线每天多几 kWh,条高 14、圆角 3;竖网格从每 0.5 起。
// 右边三列:差(两位小数、不带单位,卡头写了 kWh)| 百分比 | 比去年。
// 行点击只选中该栋(计划 §1 #12),不开抽屉。数据口径在 pvAnaV4.logic.ts 的 anchorBars()。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useEnterPhase, useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth } from '@/components/ana/chartTip'
import '@/components/ana/ana.css'   // @keyframes fp-wipe + ana-morph
import { PV, pvAnchorLeg, pvAnchorZero } from '@/components/ana/anaSentence'
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import { phaseName, type AnchorRow, type PvAnchorBarsProps } from './pvAnaV4.logic'

const props = defineProps<PvAnchorBarsProps>()
const emit = defineEmits<{ pick: [id: number] }>()

const TOP = 8, BOTTOM = 34
const { el, width } = useWidth(999)
// 窄容器(手机,以及桌面 .av2-s4 窄栏)换几何,不缩放、不改字号:行高抬到触点 30、栋名列 76 且左对齐、
// 条尾两枚数改成行尾直标(RESPONSIVE-V2-PLAN §P2 §③)。判容器宽不判视口宽 —— 窄栏里视口判据失效。
const narrow = computed(() => width.value < 420)
const PL = computed(() => (narrow.value ? 76 : 96))
const NAME_X = computed(() => (narrow.value ? 0 : 86))
// 窄档右侧 160 = 值 53 + 4 + 百分比 33 + 6 + 比去年 54 + 右边距 6 + 条尾余 4(mono 11 按 6.6/字符)
const RIGHT = computed(() => (narrow.value ? 160 : 176))
const ROW = computed(() => (narrow.value ? 30 : 26))
const BAR_Y = computed(() => (narrow.value ? 8 : 6))   // 条高 14 居中于行
const TEXT_Y = computed(() => (narrow.value ? 19 : 17))
// 切到「按装机比」挂上来时在视口内擦入 320;换期 200 形变:条长走 rect 几何,名次变了整行走行 g 的 translateY
const first = useEnterPhase(el)
const hold = useMorphHold(width, first)
const plotW = computed(() => width.value - PL.value - RIGHT.value)
const zero = computed(() => PL.value + 0.22 * plotW.value)
const nRows = computed(() => props.data.rows.length + props.data.unborn.length)
const H = computed(() => TOP + nRows.value * ROW.value + BOTTOM)
const bottom = computed(() => TOP + nRows.value * ROW.value)

/** 每 kWh 多少 px:最长的正条留 5% 余量顶到右界;有负条时左边 22% 也要装得下 */
const scale = computed(() => {
  const ds = props.data.rows.map(r => r.delta)
  const pos = Math.max(0, ...ds), neg = Math.max(0, ...ds.map(d => -d))
  const s = Math.min(
    pos > 0 ? (width.value - RIGHT.value - zero.value) / (pos * 1.05) : Infinity,
    neg > 0 ? (zero.value - PL.value) / (neg * 1.05) : Infinity,
  )
  return Number.isFinite(s) ? s : 1
})

const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')
const grid = computed(() => {
  const s = scale.value
  let step = 0.5
  while (step * s < 40) step *= 2   // 值域很宽时加大步长,刻度字不叠
  const hasNeg = props.data.rows.some(r => r.delta < 0)
  const from = hasNeg ? Math.ceil((PL.value - zero.value) / s / step) : 0
  const to = Math.floor((width.value - RIGHT.value - zero.value) / s / step)
  const out: { x: number; label: string }[] = []
  for (let k = from; k <= to; k++) out.push({ x: zero.value + k * step * s, label: k === 0 ? '0' : `${sign(k)}${Math.abs(k * step)}` })
  return out
})

const bars = computed(() => props.data.rows.map((r, i) => {
  const top = TOP + i * ROW.value
  const end = zero.value + r.delta * scale.value
  const hText = `${sign(r.delta)}${Math.abs(r.delta).toFixed(2)}`
  // 窄档两枚数不跟条尾跑,右对齐钉成两列(条最长只到 width − RIGHT,不会压上来)
  const labX = narrow.value ? width.value - 103 : Math.max(end, zero.value) + 8
  return {
    r, top, end,
    x: Math.min(zero.value, end), w: Math.abs(end - zero.value),
    fill: PHASE_COLORS[r.phase] ?? PV_COLORS.REF,
    sel: r.id === props.selId,
    hText, labX,
    pctText: `${sign(r.deltaPct)}${Math.abs(Math.round(r.deltaPct))}%`,
    pctX: narrow.value ? width.value - 66 : labX + Math.max(58, tipWidth([hText], 0) + 5),   // 画布量得:字尾后留 5px 起百分比
    none: r.prev === PV.dash,
  }
}))
// ponytail: SVG 行的 DOM 顺序只追加、不重排 —— Chromium 里被挪动的节点丢过渡(实测),换期名次一变挪动的行会瞬移。
// 首挂按名次排;之后留着旧顺序、新栋追到尾巴。纵向位置全靠行 g 的 translateY,DOM 顺序不影响画面。
let order: number[] = []
const drawn = computed(() => {
  const by = new Map(bars.value.map(b => [b.r.id, b]))
  order = [...order.filter(id => by.has(id)), ...[...by.keys()].filter(id => !order.includes(id))]
  return order.map(id => by.get(id)!)
})
const rowT = (top: number) => ({ transform: `translate(0px, ${top}px)` })
const unbornRows = computed(() => props.data.unborn.map((u, k) => ({ ...u, top: TOP + (props.data.rows.length + k) * ROW.value })))

// ── 悬停 ──
const hover = ref<number | null>(null)
interface TipLine { t: string; c: string; o?: number; b?: number }
const WHITE = 'var(--text-on-solid)'
function tipLines(r: AnchorRow): TipLine[] {
  const more = r.delta >= 0
  return [
    { t: `${r.name} · ${phaseName(r.phase)}`, c: WHITE, b: 600 },
    { t: `每千瓦日均 ${r.perDay.toFixed(2)} kWh · ${r.days} 天`, c: WHITE, o: 0.82 },
    { t: `比合格线每天${more ? '多' : '少'} ${Math.abs(r.delta).toFixed(2)} kWh（${sign(r.deltaPct)}${Math.abs(Math.round(r.deltaPct))}%）`, c: PV_COLORS.TIP_SEL },
    ...(r.prev === PV.dash ? [] : [{ t: `比去年 ${r.prev}`, c: WHITE, o: 0.82 }]),
  ]
}
const tip = computed(() => {
  const i = hover.value
  const b = i == null ? null : bars.value[i]
  if (!b) return null
  const lines = tipLines(b.r)
  const tw = tipWidth(lines.map(l => l.t), 22)
  return {
    lines,
    left: Math.max(zero.value, Math.min(b.end - 60, width.value - tw - 70)),
    // 行命中类:上半行气泡放行下,下半行放行上
    top: i! < bars.value.length / 2 ? b.top + ROW.value + 4 : Math.max(0, b.top - 88),
  }
})
</script>

<template>
  <div class="pan">
    <div ref="el" class="pan-plot" :style="{ height: H + 'px' }">
      <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="pan-svg" role="img" :aria-label="PV.card.anchor">
        <template v-for="g in grid" :key="'g' + g.label">
          <line class="pan-gl" :x1="g.x" :x2="g.x" :y1="TOP" :y2="bottom" />
          <text class="pan-ax" :x="g.x" :y="bottom + 16" text-anchor="middle">{{ g.label }}</text>
        </template>
        <line class="pan-anchor" :x1="zero" :x2="zero" :y1="TOP" :y2="bottom + 4" :stroke="PV_COLORS.REF"
          stroke-width="1.5" stroke-dasharray="5 4" />
        <text class="pan-ax pan-anchor-t" :x="zero" :y="bottom + 30" text-anchor="middle">{{ pvAnchorZero() }}</text>

        <!-- 栋名在数据组外(尺子先在,数据擦上去);两段各一组行 g,按栋作键、纵向只靠 translateY:换期名次变了整行滑到新行 -->
        <g :class="['pan-names', 'ana-morph', { hold }]">
          <g v-for="b in drawn" :key="'n' + b.r.id" class="pan-rowg" :style="rowT(b.top)">
            <text :class="['pan-name', { 'pan-name-sel': b.sel }]" :x="NAME_X" :y="TEXT_Y"
              :text-anchor="narrow ? 'start' : 'end'">{{ b.r.name }}</text>
          </g>
        </g>
        <g :class="['pan-data', 'ana-morph', { first, hold }]" @animationend.self="first = false" @animationcancel.self="first = false">
          <g v-for="b in drawn" :key="b.r.id" class="pan-rowg" :style="rowT(b.top)">
            <rect :class="['pan-bar', { 'pan-bar-sel': b.sel }]" :data-id="b.r.id" :x="b.x" :y="BAR_Y" :width="b.w" height="14" rx="3"
              :fill="b.fill" :fill-opacity="b.sel ? 1 : 0.85" />
            <text class="pan-val pan-h" :x="b.labX" :y="TEXT_Y" :text-anchor="narrow ? 'end' : undefined"
              :font-weight="b.sel ? 600 : 400">{{ b.hText }}</text>
            <text class="pan-val pan-pct" :x="b.pctX" :y="TEXT_Y" :text-anchor="narrow ? 'end' : undefined">{{ b.pctText }}</text>
            <text :class="['pan-val', 'pan-d', b.none ? 'pan-d-none' : 'pan-d-up']" :x="width - 6" :y="TEXT_Y" text-anchor="end">{{ b.r.prev }}</text>
          </g>
        </g>
        <template v-for="u in unbornRows" :key="'u' + u.id">
          <text class="pan-name pan-name-off" :x="NAME_X" :y="u.top + TEXT_Y"
            :text-anchor="narrow ? 'start' : 'end'">{{ u.name }}</text>
          <text class="pan-val pan-off" :x="zero + 6" :y="u.top + TEXT_Y">{{ PV.notYet }}</text>
        </template>
        <text class="pan-ax" :x="width - 6" y="9" text-anchor="end">比去年</text>
      </svg>
      <div v-for="(b, i) in bars" :key="'r' + b.r.id" class="pan-row" :data-id="b.r.id"
        :style="{ top: b.top + 'px', height: ROW + 'px', background: hover === i ? 'var(--ink-050)' : 'transparent' }"
        @mouseenter="hover = i" @mouseleave="hover = null" @click="emit('pick', b.r.id)" />
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: tip.left + 'px', top: tip.top + 'px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, opacity: l.o, fontWeight: l.b }">{{ l.t }}</span>
      </div>
    </div>
    <div class="pv-leg">
      <span><i class="pv-dot" :style="{ background: PV_COLORS.PHASE1 }" />一期</span>
      <span><i class="pv-dot" :style="{ background: PV_COLORS.PHASE2 }" />二期</span>
      <span><i class="pv-dot" :style="{ background: PV_COLORS.PHASE3 }" />三期</span>
      <span><i class="pv-line" :style="{ background: PV_COLORS.REF }" />{{ pvAnchorLeg() }}</span>
      <span class="pv-leg-m">{{ PV.anchorLegend }}</span>
    </div>
    <!-- 参照(合格线一年多少、每期按几天平均、哪几栋在网太短不画)由屏接着写在卡里,走句型库 PV 段 -->
  </div>
</template>

<style scoped>
.pan-plot { position: relative; width: 100%; }
.pan-svg { display: block; }
/* 首挂:数据组自左擦出一次;fp-wipe 在 ana.css,不能写进 scoped(名字会被加 hash) */
.pan-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
/* 行 g 的纵向形变(ana-morph 只管 rect / path / circle 的几何属性,g 的 transform 在这里);hold 同样关掉。字的横向位置瞬到 */
.pan-rowg { transition: transform var(--dur-base) var(--ease-out); }
.hold > .pan-rowg { transition: none; }
.pan-row { position: absolute; left: 0; right: 0; border-radius: 4px; cursor: pointer; }
.pan-gl { stroke: var(--ink-100); stroke-width: 1; }
.pan-ax { font-size: var(--fs-micro); font-family: var(--font-mono); fill: var(--text-muted); font-variant-numeric: tabular-nums; }
.pan-name { font-size: var(--fs-label); font-family: var(--font-sans); fill: var(--text-secondary); }
.pan-bar-sel { stroke: var(--ink-900); stroke-width: 1.5; }
.pan-name-sel { fill: var(--text-primary); font-weight: 600; }
.pan-name-off { fill: var(--ink-500); }
.pan-val { font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pan-h { fill: var(--text-secondary); }
.pan-pct { fill: var(--text-muted); }
.pan-d-up { fill: var(--text-secondary); }
.pan-d-none, .pan-off { fill: var(--ink-500); }
.pv-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pv-leg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.pv-leg span { display: inline-flex; align-items: center; gap: 5px; }
.pv-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
.pv-line { display: inline-block; width: 12px; height: 2px; border-radius: 2px; }
.pv-leg-m { color: var(--text-muted); }
</style>
