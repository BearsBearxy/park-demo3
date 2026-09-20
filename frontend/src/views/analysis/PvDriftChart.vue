<script setup lang="ts">
// 抽屉 B9 · 这一年的偏离与水平变化(PV-ANALYSIS-SCREEN-V4 §3.17;画布 v2/Drawer.dc.html)。
// 画布 宽 = 实测 × 高 300(容器 < 420 时 240),padL 46 / padR 14 / padT 14 / padB 26;x 与 B10 同一把(pvDrawerAxis)。
// 趋势线照画布的平滑写法:相邻点用 Catmull-Rom(÷6)转三次贝塞尔;估计范围是直线折边的闭合面。
// 变点区间补淡红 12% 底(实施计划 §1 #17);变点直标第二行写区间,不写「抬上去了」(§1 #18)。
// 这里只做像素几何,数据由 pvAnaV4.logic.ts 的 driftChart 整形好传进来。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { FP_ANA_THEME } from '@/components/ana/anaTheme'
import '@/components/ana/ana.css'
import { PV_COLORS as C } from './pvAnaColors'
import type { PvDriftChartProps } from './pvAnaV4.logic'
import { dayOfX, md, monthStartDays, nearestIndex, PAD_L, PAD_R, r1, xOfDay, yAxis } from './pvDrawerAxis'

const props = defineProps<PvDriftChartProps>()

const padT = 14, padB = 26
const AXIS_LINE = FP_ANA_THEME.categoryAxis.axisLine.lineStyle.color

const { el, width: W } = useWidth(646)
// 窄容器换几何(手机稿 §1 改后①):图高 300 → 240、月标隔一标。判容器宽不判视口宽 ——
// 同一张图也出现在桌面 .av2-s4 窄栏里(那里也只有 300 多)。字号一律不动。
const narrow = computed(() => W.value < 420)
const H = computed(() => (narrow.value ? 240 : 300))
const iH = computed(() => H.value - padT - padB)
// 抽屉里的图不擦入(只有卡片上浮,原则 7);上一栋 / 下一栋 200 同键形变(点按日作键,区间与变点竖线跟着滑)。
// 趋势线与估计范围的点数随栋变,点数不同的那一下 d 结构变了,直接跳。改宽那两帧 hold 关掉
const hold = useMorphHold(W, ref(false))
const days = computed(() => props.data.daysInYear)
const X = (doy: number) => xOfDay(doy, W.value, days.value)

const axis = computed(() => {
  const vals = [0]
  for (const p of props.data.points) vals.push(p.v)
  for (const t of props.data.trend) vals.push(t.lo, t.hi)
  return yAxis(vals, padT, H.value - padB, { top: 59, bottom: 37 })
})
const Y = (v: number) => axis.value.y(v)
const tickLabel = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2)

const year = computed(() => props.data.points[0]?.date.slice(0, 4) ?? '')

// 窄档月标隔一标(1/3/5/7/9/11):12 个标挤在 300 多宽里字会叠,当前期间那个月由图内「当前期间 N 月」认领
const months = computed(() => monthStartDays(days.value)
  .map((d, i) => ({ m: i + 1, x: X(d) }))
  .filter(t => !narrow.value || t.m % 2 === 1))

const future = computed(() => {
  const f = props.data.futureFromDoy
  if (f == null) return null
  const x = X(f - 1)
  return { x, w: r1(W.value - PAD_R - x) }
})
const seg = computed(() => {
  const s = props.data.seg
  return s && { month: s.month, x: X(s.fromDoy), w: r1(X(s.toDoy) - X(s.fromDoy)), cx: r1((X(s.fromDoy) + X(s.toDoy)) / 2) }
})

const cp = computed(() => {
  const c = props.data.cp
  if (!c) return null
  const at = md(c.date), a = md(c.from), b = md(c.to)
  const lines = [`${at.m}月${at.d}日起`, `区间 ${a.m}月${a.d}日–${b.m}月${b.d}日`]
  const x = X(c.doy)
  // 直标放竖线右侧;右边放不下就挪到左侧、右对齐
  const right = x + 5 + tipWidth(lines, 0) <= W.value - PAD_R
  return {
    x, lines, doy: c.doy, m: at.m, d: at.d,
    sx: X(c.fromDoy), sw: r1(X(c.toDoy) - X(c.fromDoy)),
    tx: right ? x + 5 : x - 5, anchor: right ? 'start' : 'end',
  }
})

const pts = computed(() => props.data.points.map(p => ({ doy: p.doy, x: X(p.doy), y: Y(p.v) })))

const trendPath = computed(() => {
  const P = props.data.trend.map(t => [X(t.doy), Y(t.fit)] as const)
  if (!P.length) return ''
  let d = `M${P[0][0]},${P[0][1]}`
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]
    d += ` C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)}`
      + ` ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`
  }
  return d
})

const bandPath = computed(() => {
  const t = props.data.trend
  if (!t.length) return ''
  const up = t.map(s => `${X(s.doy)},${Y(s.hi)}`)
  const dn = t.slice().reverse().map(s => `${X(s.doy)},${Y(s.lo)}`)
  return 'M' + [...up, ...dn].join(' L') + ' Z'
})

// ── 悬停:取最近的一天(画布 near,两侧各 6 天内),竖线 + 高亮点 + 三行气泡 ──
const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  const ps = props.data.points
  if (!ps.length) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const d = dayOfX(e.clientX - r.left, W.value, days.value, ps[ps.length - 1].doy)
  hover.value = nearestIndex(ps.map(p => p.doy), d)
}

const tip = computed(() => {
  const p = hover.value == null ? null : props.data.points[hover.value]
  if (!p) return null
  const at = md(p.date)
  const lines = [
    { t: `${at.m}月${at.d}日`, b: true },
    { t: `偏离 ${p.v > 0 ? '+' : ''}${p.v.toFixed(3)}`, c: p.v > 0 ? C.TIP_SEL : C.TIP_ABOVE },
  ] as { t: string; c?: string; b?: boolean; dim?: boolean }[]
  if (cp.value) lines.push({ t: `在 ${cp.value.m} 月 ${cp.value.d} 日水平变化之${p.doy >= cp.value.doy ? '后' : '前'}`, dim: true })
  const x = X(p.doy)
  const w = tipWidth(lines.map(l => l.t), 22)
  return { x, y: Y(p.v), lines, left: r1(tipX(x, w, { width: W.value, padL: PAD_L, padR: PAD_R })) }
})
</script>

<template>
  <div class="av2-card pv-b9">
    <div class="av2-card-h">
      <span class="t">这一年的偏离与水平变化</span>
      <span class="hint">这一年里，这栋什么时候开始变了</span>
    </div>
    <div ref="el" class="plot" :style="{ height: H + 'px' }" @mousemove="onMove" @mouseleave="hover = null">
      <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="这一年的偏离与水平变化">
        <template v-for="v in axis.ticks" :key="'g' + v">
          <line class="gl" :x1="PAD_L" :x2="W - PAD_R" :y1="Y(v)" :y2="Y(v)" :stroke="C.GRID" />
          <text class="ax" :x="PAD_L - 6" :y="Y(v) + 4" text-anchor="end" :fill="C.AXIS_TEXT">{{ tickLabel(v) }}</text>
        </template>
        <!-- 数据组:只形变不擦入;悬停层(竖线 / 高亮点 / 气泡)是 SVG 外的 HTML,0ms;直标字瞬到 -->
        <g :class="['b9-data', 'ana-morph', { hold }]">
          <rect v-if="future" class="future" :x="future.x" :y="padT" :width="future.w" :height="iH" :fill="C.FUTURE" />
          <template v-if="seg">
            <rect class="seg" :x="seg.x" :y="padT" :width="seg.w" :height="iH" :fill="C.SEG_B9" />
            <text class="ax seglab" :x="seg.cx" :y="padT + 12" text-anchor="middle" :fill="C.FOCUS" fill-opacity="0.85">当前期间 {{ seg.month }} 月</text>
          </template>
          <rect v-if="cp" class="cpspan" :x="cp.sx" :y="padT" :width="cp.sw" :height="iH" :fill="C.BELOW" fill-opacity="0.12" />
          <path v-if="bandPath" class="band" :d="bandPath" :fill="C.BAND" fill-opacity="0.5" />
          <circle v-for="p in pts" :key="'p' + p.doy" class="pt" :cx="p.x" :cy="p.y" r="2" :fill="C.CROWD_B9" />
          <path v-if="trendPath" class="trend" :d="trendPath" fill="none" :stroke="C.FOCUS" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <template v-if="cp">
            <!-- 变点竖线用 path:<line> 的端点过渡不了 -->
            <path class="cp" :d="`M${cp.x},${padT} V${H - padB}`" fill="none" :stroke="C.BELOW" stroke-width="1.5" />
            <text class="ax cplab" :x="cp.tx" :y="padT + 28" :text-anchor="cp.anchor" :fill="C.BELOW" font-weight="600">{{ cp.lines[0] }}</text>
            <text class="ax cplab" :x="cp.tx" :y="padT + 42" :text-anchor="cp.anchor" :fill="C.BELOW">{{ cp.lines[1] }}</text>
          </template>
        </g>
        <line class="axl" :x1="PAD_L" :x2="W - PAD_R" :y1="H - padB" :y2="H - padB" :stroke="AXIS_LINE" stroke-width="1" />
        <text
          v-for="t in months" :key="'m' + t.m" class="ax mlab" :x="t.x" :y="H - padB + 18" text-anchor="middle"
          :fill="t.m === seg?.month ? C.FOCUS : C.AXIS_TEXT" :font-weight="t.m === seg?.month ? 600 : 400"
        >{{ t.m }}月</text>
      </svg>
      <template v-if="tip">
        <span class="hair" :style="{ left: tip.x + 'px', top: padT + 'px', height: iH + 'px', background: C.TIP_HAIR }"></span>
        <span class="hdot" :style="{ left: r1(tip.x - 4.5) + 'px', top: r1(tip.y - 4.5) + 'px', background: C.FOCUS }"></span>
        <div class="cz-tip dtip" :style="{ left: tip.left + 'px', top: '8px' }">
          <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, fontWeight: l.b ? 600 : 400, opacity: l.dim ? 0.72 : undefined }">{{ l.t }}</span>
        </div>
      </template>
    </div>
    <div class="leg">
      <span><u :style="{ background: C.CROWD_B9 }"></u>每天的偏离</span>
      <span><i :style="{ background: C.FOCUS, width: '14px', height: '2px' }"></i>这段时间的常态</span>
      <span><b :style="{ background: C.BAND }"></b>常态可能落的范围</span>
      <span v-if="cp"><i :style="{ background: C.BELOW, width: '2px', height: '11px' }"></i>这天前后水平变了</span>
    </div>
    <p class="ana-ref">
      纵轴 = 与全园同刻度中位的偏离（0 = 与全园同步）· 横轴 = {{ year }} 年逐日 · 缺抄日断开不画<template v-if="future"> · 右侧淡区还没到</template>
    </p>
  </div>
</template>

<style scoped>
.plot { position: relative; }
.plot svg { display: block; }
.ax { font-size: 11px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.hair { position: absolute; width: 1px; pointer-events: none; }
.hdot { position: absolute; width: 9px; height: 9px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--surface-white); pointer-events: none; }
.dtip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; color: var(--text-on-solid); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.leg { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--text-secondary); white-space: nowrap; flex-wrap: wrap; margin-top: 8px; }
.leg span { display: inline-flex; align-items: center; gap: 5px; }
.leg i { display: inline-block; border-radius: 2px; }
.leg b { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.leg u { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
</style>
