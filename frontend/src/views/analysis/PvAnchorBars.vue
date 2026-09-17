<script setup lang="ts">
// A2 · 年等效小时双向条(PV-ANALYSIS-SCREEN-V4 §3.6;画布 ../运维文档/设计稿/已实现/光伏分栋分析v4定稿-2026-09-13/Abs.dc.html)。
// 画布 卡内宽 × (上 8 + 行数 × 26 + 下 34);栋名列 96(计划 §1 #19,名字右对齐于 86);右侧预留 176;
// 0 线 = 锚点,落在绘图宽 22% 处;条长 = 比锚点多几小时,条高 14、圆角 3;每 50 h 一条竖网格。
// 行点击只选中该栋(计划 §1 #12),不开抽屉。数据口径在 pvAnaV4.logic.ts 的 anchorBars()。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useEnterPhase, useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth } from '@/components/ana/chartTip'
import '@/components/ana/ana.css'   // @keyframes fp-wipe + ana-morph
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import { phaseName, type AnchorRow, type PvAnchorBarsProps } from './pvAnaV4.logic'

const props = defineProps<PvAnchorBarsProps>()
const emit = defineEmits<{ pick: [id: number] }>()

const PL = 96, NAME_X = 86, RIGHT = 176, TOP = 8, ROW = 26, BOTTOM = 34
const { el, width } = useWidth(999)
// 切到「绝对水平」挂上来时在视口内擦入 320;换期 200 形变:条长走 rect 几何,名次变了整行走行 g 的 translateY
const first = useEnterPhase(el)
const hold = useMorphHold(width, first)
const plotW = computed(() => width.value - PL - RIGHT)
const zero = computed(() => PL + 0.22 * plotW.value)
const nRows = computed(() => props.data.rows.length + props.data.unborn.length)
const H = computed(() => TOP + nRows.value * ROW + BOTTOM)
const bottom = computed(() => TOP + nRows.value * ROW)

/** 每小时多少 px:最长的正条留 5% 余量顶到右界;有负条时左边 22% 也要装得下 */
const scale = computed(() => {
  const ds = props.data.rows.map(r => r.delta)
  const pos = Math.max(0, ...ds), neg = Math.max(0, ...ds.map(d => -d))
  const s = Math.min(
    pos > 0 ? (width.value - RIGHT - zero.value) / (pos * 1.05) : Infinity,
    neg > 0 ? (zero.value - PL) / (neg * 1.05) : Infinity,
  )
  return Number.isFinite(s) ? s : 1
})

const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')
const grid = computed(() => {
  const s = scale.value
  let step = 50
  while (step * s < 40) step *= 2   // 值域很宽时加大步长,刻度字不叠
  const hasNeg = props.data.rows.some(r => r.delta < 0)
  const from = hasNeg ? Math.ceil((PL - zero.value) / s / step) : 0
  const to = Math.floor((width.value - RIGHT - zero.value) / s / step)
  const out: { x: number; label: string }[] = []
  for (let k = from; k <= to; k++) out.push({ x: zero.value + k * step * s, label: k === 0 ? '0' : `${sign(k)}${Math.abs(k * step)}` })
  return out
})

const bars = computed(() => props.data.rows.map((r, i) => {
  const top = TOP + i * ROW
  const end = zero.value + r.delta * scale.value
  const hText = `${sign(r.delta)}${Math.abs(r.delta).toFixed(1)} h`
  const labX = Math.max(end, zero.value) + 8
  const pd = r.prevDelta == null ? null : Math.round(r.prevDelta)
  return {
    r, top, end,
    x: Math.min(zero.value, end), w: Math.abs(end - zero.value),
    fill: PHASE_COLORS[r.phase] ?? PV_COLORS.REF,
    sel: r.id === props.selId,
    hText, labX,
    pctText: `${sign(r.deltaPct)}${Math.abs(Math.round(r.deltaPct))}%`,
    pctX: labX + Math.max(58, tipWidth([hText], 0) + 5),   // 画布量得:8 个字符的「+x h」字尾后留 5px 起百分比
    arrow: pd == null || pd === 0 ? null : pd > 0 ? '▲' : '▼',
    dText: pd == null ? '—' : `${sign(pd)}${Math.abs(pd)} h`,
    dTone: pd == null ? 'none' : pd < 0 ? 'down' : 'up',
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
const unbornRows = computed(() => props.data.unborn.map((u, k) => ({ ...u, top: TOP + (props.data.rows.length + k) * ROW })))

// ── 悬停 ──
const hover = ref<number | null>(null)
interface TipLine { t: string; c: string; o?: number; b?: number }
const WHITE = 'var(--text-on-solid)'
function tipLines(r: AnchorRow): TipLine[] {
  const more = r.delta >= 0
  const lines: TipLine[] = [
    { t: `${r.name} · ${phaseName(r.phase)}`, c: WHITE, b: 600 },
    { t: `年等效 ${Math.round(r.yieldHours)} h`, c: WHITE, o: 0.82 },
    { t: `比锚点${more ? '多' : '少'} ${Math.abs(r.delta).toFixed(1)} h（${sign(r.deltaPct)}${Math.abs(Math.round(r.deltaPct))}%）`, c: PV_COLORS.TIP_SEL },
  ]
  // 没取到(还在请求 / 请求失败)≠ 去年没抄表 —— 前者不许写成后者
  if (!props.data.prevLoaded) lines.push({ t: '上一年数据没取到', c: WHITE, o: 0.62 })
  else if (r.prevDelta == null) lines.push({ t: '去年同月无抄表，比不了', c: WHITE, o: 0.62 })
  else {
    const pd = Math.round(r.prevDelta)
    lines.push({ t: `比去年${pd >= 0 ? '多' : '少'} ${Math.abs(pd)} h · 按 ${r.prevMonths} 个月对齐`, c: pd >= 0 ? PV_COLORS.TIP_IN : PV_COLORS.TIP_ABOVE })
  }
  return lines
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
    top: i! < bars.value.length / 2 ? b.top + ROW + 4 : Math.max(0, b.top - 88),
  }
})

const anchorText = computed(() => `${props.data.anchor.toFixed(1)} h`)
</script>

<template>
  <div class="pan">
    <div ref="el" class="pan-plot" :style="{ height: H + 'px' }">
      <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="pan-svg" role="img" aria-label="年等效小时">
        <template v-for="g in grid" :key="'g' + g.label">
          <line class="pan-gl" :x1="g.x" :x2="g.x" :y1="TOP" :y2="bottom" />
          <text class="pan-ax" :x="g.x" :y="bottom + 16" text-anchor="middle">{{ g.label }}</text>
        </template>
        <line class="pan-anchor" :x1="zero" :x2="zero" :y1="TOP" :y2="bottom + 4" :stroke="PV_COLORS.REF"
          stroke-width="1.5" stroke-dasharray="5 4" />
        <text class="pan-ax pan-anchor-t" :x="zero" :y="bottom + 30" text-anchor="middle">0 = {{ anchorText }} 那条线</text>

        <!-- 栋名在数据组外(尺子先在,数据擦上去);两段各一组行 g,按栋作键、纵向只靠 translateY:换期名次变了整行滑到新行 -->
        <g :class="['pan-names', 'ana-morph', { hold }]">
          <g v-for="b in drawn" :key="'n' + b.r.id" class="pan-rowg" :style="rowT(b.top)">
            <text :class="['pan-name', { 'pan-name-sel': b.sel }]" :x="NAME_X" y="17" text-anchor="end">{{ b.r.name }}</text>
          </g>
        </g>
        <g :class="['pan-data', 'ana-morph', { first, hold }]" @animationend.self="first = false" @animationcancel.self="first = false">
          <g v-for="b in drawn" :key="b.r.id" class="pan-rowg" :style="rowT(b.top)">
            <rect :class="['pan-bar', { 'pan-bar-sel': b.sel }]" :data-id="b.r.id" :x="b.x" y="6" :width="b.w" height="14" rx="3"
              :fill="b.fill" :fill-opacity="b.sel ? 1 : 0.85" />
            <text class="pan-val pan-h" :x="b.labX" y="17" :font-weight="b.sel ? 600 : 400">{{ b.hText }}</text>
            <text class="pan-val pan-pct" :x="b.pctX" y="17">{{ b.pctText }}</text>
            <text v-if="b.arrow" :class="['pan-val', 'pan-arrow', 'pan-' + b.dTone]" :x="width - 60" y="17"
              :fill="b.dTone === 'down' ? PV_COLORS.ABOVE : undefined">{{ b.arrow }}</text>
            <text :class="['pan-val', 'pan-d', 'pan-d-' + b.dTone]" :x="width - 6" y="17" text-anchor="end"
              :fill="b.dTone === 'down' ? PV_COLORS.AMBER_TEXT : undefined">{{ b.dText }}</text>
          </g>
        </g>
        <template v-for="u in unbornRows" :key="'u' + u.id">
          <text class="pan-name pan-name-off" :x="NAME_X" :y="u.top + 17" text-anchor="end">{{ u.name }}</text>
          <text class="pan-val pan-off" :x="zero + 6" :y="u.top + 17">未投产 · 没有可算的年等效</text>
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
      <span><i class="pv-line" :style="{ background: PV_COLORS.REF }" />0 = {{ anchorText }}</span>
      <span class="pv-leg-m">条长 = 比 {{ anchorText }} 多多少小时</span>
    </div>
    <!-- 图注写在模板里,不走整句插值:文案门禁(anaCopyLint)扫得到 -->
    <p class="ana-ref">横轴不从 0 h 起：0 就是 {{ anchorText }} 那条线，条长只代表离标杆多远，不能照着长度算年等效的倍数 · 最右一列 ▲▼ = 比去年同月多 / 少，<template v-if="data.prevLoaded">去年同月无抄表显 —</template><template v-else>上一年数据没取到，先显 —</template><template v-if="data.short.length"> · 在网天数不足 {{ data.short.length }} 栋，不画、不年化（{{ data.short.join('、') }}）</template><template v-if="data.noDenom.length"> · 没有装机分母 {{ data.noDenom.length }} 栋，不画（{{ data.noDenom.join('、') }}）</template> · {{ data.denomNote }}</p>
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
.pan-up.pan-arrow { fill: var(--hue-green); }
.pan-d-up { fill: var(--text-secondary); }
.pan-d-none, .pan-off { fill: var(--ink-500); }
.pv-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pv-leg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.pv-leg span { display: inline-flex; align-items: center; gap: 5px; }
.pv-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
.pv-line { display: inline-block; width: 12px; height: 2px; border-radius: 2px; }
.pv-leg-m { color: var(--text-muted); }
</style>
