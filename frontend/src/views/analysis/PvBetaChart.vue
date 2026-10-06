<script setup lang="ts">
// 抽屉 B11 · 跟全园一起涨落的程度(PV-ANALYSIS-SCREEN-V4 §3.19;2026-10-06 改稿 pv-v2-drawer)。
// 画布 宽 = 实测 × 高 200(容器 < 420 时 180),padL 46 / padR 14 / padT 16 / padB 30;12 个等宽月槽固定,空槽不删月:
// 刻度字淡(墨 28%);原因一段连着的空槽只写一次,放在那段空槽正中、最低那条网格上方 8px(「并网前」/ 不足 / 未到),
// 连线在空槽处断开。「1 是和全园同步」开头有一段放得下它的空槽时挪到左边空槽里,不压点。
// 悬停命中每槽中心 28px 宽的竖条,气泡在竖条右侧 12px(= 槽中心 + 26),放不下翻左(画布 renderVals)。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { FP_ANA_THEME } from '@/components/ana/anaTheme'
import '@/components/ana/ana.css'
import { PV_COLORS as C } from './pvAnaColors'
import { PV, PVH, pvBetaRef } from '@/components/ana/anaSentence'
import type { BetaSlot, PvBetaChartProps } from './pvAnaV4.logic'
import { PAD_L, PAD_R, r1, slotCenter, slotWidth, yAxis } from './pvDrawerAxis'

// year:气泡首行「2025 年 8 月」要年份,BetaSlot 只带月
const props = defineProps<PvBetaChartProps & { year: number }>()

const padT = 16, padB = 30
const AXIS_LINE = FP_ANA_THEME.categoryAxis.axisLine.lineStyle.color
const WHY: Record<NonNullable<BetaSlot['why']>, { tick: string; tip: string }> = {
  pre: { tick: PV.betaPre, tip: PV.betaPre },
  thin: { tick: '不足', tip: '样本不足' },
  future: { tick: '未到', tip: '还没到' },
}

const { el, width: W } = useWidth(646)
// 窄容器只降高 200→180(手机体验稿 §1 改后③):点数只有 12、字本来就在图上,画法一个都不动。
// 判容器宽不判视口宽 —— 这张图也出现在桌面 .av2-s4 窄栏里,那里容器同样只有 300 多。
const narrow = computed(() => W.value < 420)
const H = computed(() => (narrow.value ? 180 : 200))
const iH = computed(() => H.value - padT - padB)
// 抽屉里的图不擦入(只有卡片上浮,原则 7);上一栋 / 下一栋 200 同键形变(点与连线段都按月作键)。
// 改宽那两帧 hold 关掉;参照线与网格跟纵轴瞬到
const hold = useMorphHold(W, ref(false))

const axis = computed(() => {
  const vals = [1]
  for (const s of props.slots) if (s.beta != null) vals.push(s.beta)
  return yAxis(vals, padT, H.value - padB, { top: 34, bottom: 48 }, 1)
})
const Y = (v: number) => axis.value.y(v)
const dec = computed(() => [1, 2, 3].find(d => Math.abs(Math.round(axis.value.step * 10 ** d) - axis.value.step * 10 ** d) < 1e-6) ?? 3)

const cols = computed(() => props.slots.map(s => ({ ...s, cx: slotCenter(s.month, W.value) })))
/** 一段连着、原因相同的空槽 → 一个字,放在那段正中 */
const whyRuns = computed(() => {
  const out: { why: NonNullable<BetaSlot['why']>; a: number; b: number; cx: number }[] = []
  for (const c of cols.value) {
    const last = out[out.length - 1]
    if (c.why && last && last.why === c.why && last.b === c.month - 1) { last.b = c.month; last.cx = r1((slotCenter(last.a, W.value) + c.cx) / 2) }
    else if (c.why) out.push({ why: c.why, a: c.month, b: c.month, cx: c.cx })
  }
  return out
})
/** 「1 是和全园同步」:开头那段空槽(从 1 月起)放得下就挪进去,左对齐;放不下照旧在右端 */
const refLab = computed(() => {
  const r = whyRuns.value[0]
  const room = r && r.a === 1 ? r.b * slotWidth(W.value) - 8 : 0
  return room >= tipWidth([PV.beta1], 0) ? { x: PAD_L + 4, anchor: 'start' } : { x: W.value - PAD_R - 4, anchor: 'end' }
})
const cur = computed(() => {
  const s = props.slots.find(x => x.current)
  return s ? { month: s.month, cx: slotCenter(s.month, W.value), x: r1(PAD_L + (s.month - 1) * slotWidth(W.value)), w: r1(slotWidth(W.value)) } : null
})

const dots = computed(() => cols.value.flatMap(c => (c.beta == null ? [] : [{ m: c.month, x: c.cx, y: Y(c.beta) }])))
/** 相邻有值的月才连线,空槽处断开。拆成一月一段、按起点月作键:每段同一「M L」结构,换栋时 d 能过渡
 *  (拆 M 子路径的单条 path 做不到 —— 空槽位置一变命令结构就变,d 直接跳) */
const lineSegs = computed(() => dots.value.slice(1).flatMap((p, k) => {
  const a = dots.value[k]
  return p.m === a.m + 1 ? [{ m: a.m, d: `M${a.x},${a.y} L${p.x},${p.y}` }] : []
}))

// ── 悬停:整槽命中 ──
const hover = ref<number | null>(null)
const tip = computed(() => {
  const c = hover.value == null ? null : cols.value[hover.value]
  if (!c) return null
  const head = { t: `${props.year} 年 ${c.month} 月`, b: true }
  let line: { t: string; c?: string; dim?: number }
  if (c.beta == null) line = { t: `${WHY[c.why!].tip}，这个月不出点`, dim: 0.72 }   // 不用琥珀:橙只留给「高于平时 / 超限」
  else {
    const v = Number(c.beta.toFixed(2))
    const say = v > 1 ? '全园多发时它比全园还多' : v < 1 ? '全园多发时它跟得没那么足' : '与全园同步'
    line = { t: `${c.beta.toFixed(2)}　${say}`, dim: 0.82 }
  }
  const lines = [head, line] as { t: string; c?: string; b?: boolean; dim?: number }[]
  const w = tipWidth(lines.map(l => l.t), 22)
  return { lines, left: r1(tipX(c.cx, w, { width: W.value, padL: PAD_L, padR: PAD_R }, 26)) }
})
</script>

<template>
  <div class="av2-card pv-b11">
    <div class="av2-card-h">
      <span class="t">{{ PV.card.beta }}</span>
      <span class="hint">{{ PVH.beta() }}</span>
    </div>
    <div ref="el" class="plot" :style="{ height: H + 'px' }">
      <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="跟全园一起涨落的程度">
        <template v-for="v in axis.ticks" :key="'g' + v">
          <line class="gl" :x1="PAD_L" :x2="W - PAD_R" :y1="Y(v)" :y2="Y(v)" :stroke="C.GRID" />
          <text class="ax" :x="PAD_L - 6" :y="Y(v) + 4" text-anchor="end" :fill="C.AXIS_TEXT">{{ v.toFixed(dec) }}</text>
        </template>
        <template v-if="cur">
          <rect class="cur" :x="cur.x" :y="padT" :width="cur.w" :height="iH" :fill="C.SEG_B11" />
          <text class="ax curlab" :x="cur.cx" :y="padT - 4" text-anchor="middle" :fill="C.FOCUS" fill-opacity="0.9" font-weight="600">当段</text>
        </template>
        <line class="ref" :x1="PAD_L" :x2="W - PAD_R" :y1="Y(1)" :y2="Y(1)" stroke="var(--ink-500)" stroke-width="1" stroke-dasharray="4 3" />
        <text class="ax reflab" :x="refLab.x" :y="Y(1) - 6" :text-anchor="refLab.anchor" fill="var(--ink-900)" fill-opacity="0.55">{{ PV.beta1 }}</text>
        <text v-for="r in whyRuns" :key="'w' + r.a" class="ax whylab" :x="r.cx" :y="Y(axis.ticks[0]) - 8" text-anchor="middle" :fill="C.AXIS_TEXT">{{ WHY[r.why].tick }}</text>
        <!-- 数据组:只形变不擦入;悬停命中条与气泡是 SVG 外的 HTML,0ms -->
        <g :class="['b11-data', 'ana-morph', { hold }]">
          <path v-for="s in lineSegs" :key="'l' + s.m" class="line" :data-m="s.m" :d="s.d" fill="none" :stroke="C.FOCUS" stroke-width="2" stroke-linecap="round" />
          <circle v-for="p in dots" :key="'d' + p.m" class="dot" :cx="p.x" :cy="p.y" r="7" :fill="C.FOCUS" stroke="var(--surface-white)" stroke-width="2.5" />
        </g>
        <line class="axl" :x1="PAD_L" :x2="W - PAD_R" :y1="H - padB" :y2="H - padB" :stroke="AXIS_LINE" stroke-width="1" />
        <template v-for="c in cols" :key="'m' + c.month">
          <text
            class="ax mlab" :class="{ empty: c.beta == null }" :x="c.cx" :y="H - padB + 18" text-anchor="middle"
            :fill="c.beta == null ? 'var(--ink-900)' : c.current ? C.FOCUS : C.AXIS_TEXT"
            :fill-opacity="c.beta == null ? 0.28 : undefined" :font-weight="c.beta != null && c.current ? 600 : 400"
          >{{ c.month }}月</text>
        </template>
      </svg>
      <span
        v-for="(c, i) in cols" :key="'h' + c.month" class="hit"
        :style="{ left: r1(c.cx - 14) + 'px', top: padT + 'px', height: iH + 'px' }"
        @mouseenter="hover = i" @mouseleave="hover = null"
      ></span>
      <div v-if="tip" class="cz-tip dtip" :style="{ left: tip.left + 'px', top: '8px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, fontWeight: l.b ? 600 : 400, opacity: l.dim }">{{ l.t }}</span>
      </div>
    </div>
    <p class="ana-ref">{{ pvBetaRef().text }}</p>
  </div>
</template>

<style scoped>
.plot { position: relative; }
.plot svg { display: block; }
.ax { font-size: 11px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.hit { position: absolute; width: 28px; }
.dtip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; color: var(--text-on-solid); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
</style>
