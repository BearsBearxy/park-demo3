<script setup lang="ts">
// B8 · 各栋消纳收益与上网收益堆叠横条(PV-ANALYSIS-SCREEN-V4 §3.9;画布 ../运维文档/设计稿/已实现/光伏分栋分析v4定稿-2026-09-13/Ledger.dc.html)。
// 画布 卡内宽 × (上 6 + 行数 × 27 + 下 26);栋名列 96(期别点 x=10、栋名 x=22),条从 104 起、条尾合计右留 84;
// 横轴 万元 从 0 起,最长那条留 4% 余量;条高 16、圆角 3;段内写得下才写数(按估出的字宽判断)。
// 行序照 revenueBars() 给的(按合计降序),这里不重排。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useEnterPhase } from '@/components/ana/anaMotion'
import { tipWidth } from '@/components/ana/chartTip'
import '@/components/ana/ana.css'   // @keyframes fp-wipe
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import { phaseName, type PvRevenueBarsProps } from './pvAnaV4.logic'

const props = defineProps<PvRevenueBarsProps>()

const PL = 104, RIGHT = 84, TOP = 6, ROW = 27, BOTTOM = 26
const WAN = 10000
const { el, width } = useWidth(999)
// C6-25:默认档可能出现在首屏——挂载时屏级 entered 为假且在视口内才擦入 320,否则瞬到;换期重排瞬移
const first = useEnterPhase(el)
const n = computed(() => props.data.rows.length)
const H = computed(() => TOP + n.value * ROW + BOTTOM)
const bottom = computed(() => TOP + n.value * ROW)
const domain = computed(() => Math.max(0, ...props.data.rows.map(r => r.total / WAN)) * 1.04 || 1)
const s = computed(() => (width.value - RIGHT - PL) / domain.value)

const niceStep = (raw: number) => {
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map(m => m * p).find(v => v >= raw)!
}
/** 整数刻度;值域宽了步长跟着放大,最多 8 格 */
const grid = computed(() => {
  const step = Math.max(1, niceStep(domain.value / 8))
  const out: number[] = []
  for (let v = 0; v <= domain.value; v += step) out.push(v)
  return out.map(v => ({ v, x: PL + v * s.value }))
})

/** 段内写数的门槛:段宽 ≥ 估出的字宽 + 左右各 6 */
const fits = (w: number, text: string) => w >= tipWidth([text], 0) + 12
const bars = computed(() => props.data.rows.map((r, i) => {
  const top = TOP + i * ROW
  const selfW = (r.self / WAN) * s.value
  const gridW = (r.grid / WAN) * s.value
  const selfEnd = PL + selfW
  const selfT = (r.self / WAN).toFixed(2), gridT = (r.grid / WAN).toFixed(2)
  return {
    r, top, selfEnd, gridW,
    totEnd: selfEnd + gridW,
    // 自用段往右多伸进上网段底下(≤ 6),把自己的右圆角藏起来,两段接缝是直的
    selfDrawW: selfW + (gridW > 0 ? Math.min(6, gridW) : 0),
    selfT: fits(selfW, selfT) ? selfT : null,
    gridT: fits(gridW, gridT) ? gridT : null,
    totT: (r.total / WAN).toFixed(2),
    dot: PHASE_COLORS[r.phase] ?? PV_COLORS.REF,
    sel: r.id === props.selId,
  }
}))

// ── 悬停 ──
const hover = ref<number | null>(null)
interface TipLine { t: string; c: string; o?: number; b?: number }
const WHITE = 'var(--text-on-solid)'
const tip = computed(() => {
  const i = hover.value
  const b = i == null ? null : bars.value[i]
  if (!b) return null
  const r = b.r
  const w2 = (v: number) => (v / WAN).toFixed(2)
  const lines: TipLine[] = [
    { t: `${r.name} · ${phaseName(r.phase)}`, c: WHITE, b: 600 },
    { t: `本段发电 ${w2(r.gen)} 万度`, c: WHITE, o: 0.72 },
    { t: `自己用了 ¥${w2(r.self)} 万`, c: PV_COLORS.TIP_SEL },
    { t: `卖上网 ¥${w2(r.grid)} 万`, c: PV_COLORS.BAND },
    { t: `合计 ¥${w2(r.total)} 万`, c: WHITE, b: 600 },
  ]
  const tw = tipWidth(lines.map(l => l.t), 22)
  return {
    lines,
    left: Math.min(b.totEnd + 60, width.value - tw - 8),
    // 行命中类:上半行气泡放行下,下半行放行上
    top: i! < n.value / 2 ? b.top + 30 : Math.max(0, b.top - 104),
  }
})

const price = computed(() => `¥${props.data.gridPrice.toFixed(2)}/度`)
</script>

<template>
  <div class="prb">
    <div ref="el" class="prb-plot" :style="{ height: H + 'px' }">
      <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="prb-svg" role="img" aria-label="各栋消纳收益与上网收益">
        <template v-for="g in grid" :key="'g' + g.v">
          <line class="prb-gl" :x1="g.x" :x2="g.x" :y1="TOP" :y2="bottom" />
          <text class="prb-ax" :x="g.x" :y="H - 10" text-anchor="middle">{{ g.v }}</text>
        </template>
        <!-- 期别点与栋名留在数据组外,v-for 拆两段(C6-25) -->
        <template v-for="b in bars" :key="'n' + b.r.id">
          <circle class="prb-dot" cx="10" :cy="b.top + 13.5" r="3.5" :fill="b.dot" />
          <text :class="['prb-name', { 'prb-name-sel': b.sel }]" x="22" :y="b.top + 17.5">{{ b.r.name }}</text>
        </template>
        <g class="prb-data" :class="{ first }" @animationend.self="first = false">
          <template v-for="b in bars" :key="b.r.id">
            <rect class="prb-self" :data-id="b.r.id" :x="PL" :y="b.top + 5.5" :width="b.selfDrawW" height="16" rx="3" :fill="PV_COLORS.FOCUS" />
            <rect v-if="b.gridW > 0" class="prb-grid" :data-id="b.r.id" :x="b.selfEnd" :y="b.top + 5.5" :width="b.gridW" height="16" rx="3" :fill="PV_COLORS.MID" />
            <text v-if="b.selfT" class="prb-val prb-in-self" :x="PL + 7" :y="b.top + 17.5">{{ b.selfT }}</text>
            <text v-if="b.gridT" class="prb-val prb-in-grid" :x="b.selfEnd + 7" :y="b.top + 17.5">{{ b.gridT }}</text>
            <text class="prb-val prb-tot" :data-id="b.r.id" :x="b.totEnd + 8" :y="b.top + 17.5">{{ b.totT }}</text>
          </template>
        </g>
        <line class="prb-axl" :x1="PL" :x2="width - RIGHT" :y1="bottom" :y2="bottom" />
      </svg>
      <div v-for="(b, i) in bars" :key="'r' + b.r.id" class="prb-row" :data-id="b.r.id"
        :style="{ top: b.top + 'px', height: ROW + 'px', background: hover === i ? 'var(--ink-040)' : 'transparent' }"
        @mouseenter="hover = i" @mouseleave="hover = null" />
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: tip.left + 'px', top: tip.top + 'px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, opacity: l.o, fontWeight: l.b }">{{ l.t }}</span>
      </div>
    </div>
    <div class="pv-leg">
      <span><b class="pv-sw" :style="{ background: PV_COLORS.FOCUS }" />自己用的（按录入时的单价）</span>
      <span><b class="pv-sw" :style="{ background: PV_COLORS.MID }" />卖上网的（上网 {{ price }}）</span>
      <span><i class="pv-dot" :style="{ background: PV_COLORS.PHASE1 }" />一期</span>
      <span><i class="pv-dot" :style="{ background: PV_COLORS.PHASE2 }" />二期</span>
      <span><i class="pv-dot" :style="{ background: PV_COLORS.PHASE3 }" />三期</span>
      <span class="pv-leg-m">条尾粗字 = 合计万元</span>
    </div>
    <!-- 图注写在模板里,不走整句插值:文案门禁(anaCopyLint)扫得到 -->
    <p class="ana-ref">横轴 = 万元，从 0 起 · 两段叠起来，条尾就是合计，不用心算 · 按合计从多到少排 · 两段单价口径不同（自用按录入时的单价、上网按 {{ price }}）<template v-if="data.through"> · 数据到 {{ data.through }}</template></p>
  </div>
</template>

<style scoped>
.prb-plot { position: relative; width: 100%; }
.prb-svg { display: block; }
/* 首绘:数据组自左擦出一次(C6-25);fp-wipe 在 ana.css,不能写进 scoped(名字会被加 hash) */
.prb-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
.prb-row { position: absolute; left: 0; right: 0; border-radius: 4px; }
.prb-gl { stroke: var(--ink-100); stroke-width: 1; }
.prb-axl { stroke: var(--ink-300); stroke-opacity: .75; stroke-width: 1; }
.prb-ax { font-size: var(--fs-micro); font-family: var(--font-mono); fill: var(--text-muted); font-variant-numeric: tabular-nums; }
.prb-name { font-size: var(--fs-label); font-family: var(--font-sans); fill: var(--text-secondary); }
.prb-name-sel { fill: var(--text-primary); font-weight: 600; }
.prb-val { font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.prb-in-self { fill: var(--text-on-solid); }
.prb-in-grid { fill: var(--text-secondary); }
.prb-tot { fill: var(--text-primary); font-weight: 600; }
.pv-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pv-leg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.pv-leg span { display: inline-flex; align-items: center; gap: 5px; }
.pv-sw { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.pv-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.pv-leg-m { color: var(--text-muted); }
</style>
