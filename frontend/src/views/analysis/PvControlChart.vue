<script setup lang="ts">
// 抽屉 B10 · 逐日偏离与两道范围线(PV-ANALYSIS-SCREEN-V4 §3.18;画布 v2/Drawer.dc.html)。
// 画布 宽 = 实测 × 高 250,padL 46 / padR 14 / padT 14 / padB 26;x 与 B9 同一把(pvDrawerAxis)。
// 两层带:里面那道 50%、更宽的那道 25%;点三档 —— 在里面 墨 28% r1.8 / 超出里面那道 琥珀 r2.8 /
// 超出外面那道 红 r3。估计窗口画成绘图区底部 10px 墨阶底条并直标取的是哪一段。
// 参照系小字只写估计窗口与对照关系,不写「是这次变化本身,不是新的异常」(实施计划 §1 #18)。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { FP_ANA_THEME } from '@/components/ana/anaTheme'
import '@/components/ana/ana.css'
import { PV_COLORS as C } from './pvAnaColors'
import type { PvControlChartProps } from './pvAnaV4.logic'
import { dayOfX, md, monthStartDays, nearestIndex, PAD_L, PAD_R, r1, xOfDay, yAxis } from './pvDrawerAxis'

// segMonth:当前期间的月(轴字标蓝,与 B9 同);ControlChart 本身不带当段,由调用方传 driftChart 的 seg.month
const props = defineProps<PvControlChartProps & { segMonth?: number | null }>()

const H = 250, padT = 14, padB = 26
const iH = H - padT - padB
const AXIS_LINE = FP_ANA_THEME.categoryAxis.axisLine.lineStyle.color

const { el, width: W } = useWidth(646)
// 抽屉里的图不擦入(只有卡片上浮,原则 7);上一栋 / 下一栋 200 同键形变(点按日作键,两道带与中线跟着滑,点的档位半径也过渡)。
// 改宽那两帧 hold 关掉;直标字瞬到
const hold = useMorphHold(W, ref(false))
const days = computed(() => props.data.daysInYear)
const X = (doy: number) => xOfDay(doy, W.value, days.value)

const axis = computed(() => {
  const d = props.data
  const vals = [d.center, d.outer.lo, d.outer.hi]
  for (const p of d.points) vals.push(p.v)
  return yAxis(vals, padT, H - padB, { top: 50, bottom: 25 })
})
const Y = (v: number) => axis.value.y(v)
const tickLabel = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2)

const months = computed(() => monthStartDays(days.value).map((d, i) => ({ m: i + 1, x: X(d) })))

const future = computed(() => {
  const f = props.data.futureFromDoy
  if (f == null) return null
  const x = X(f - 1)
  return { x, w: r1(W.value - PAD_R - x) }
})

const bands = computed(() => {
  const { inner, outer } = props.data
  const yi = Y(inner.hi), yo = Y(outer.hi)
  return {
    inner: { y: yi, h: r1(Y(inner.lo) - yi) },
    outer: { y: yo, h: r1(Y(outer.lo) - yo) },
    // 两条直标挨得比一行字还近时只留「平时的起伏」—— 图例里两道都有
    outerLabel: yi - yo >= 12,
  }
})

const dateText = (date: string) => { const a = md(date); return `${a.m} 月 ${a.d} 日` }

const win = computed(() => {
  const w = props.data.window
  if (!w) return null
  const x = X(w.fromDoy)
  // 底条盖到窗口末日的下一天为止(画布:1/1–6/8 的底条止于 6/9 的 x)
  const x2 = Math.min(W.value - PAD_R, X(w.toDoy + 1))
  return { x, w: r1(x2 - x), from: dateText(w.from), to: dateText(w.to) }
})

const LEVEL = [
  { r: 1.8, fill: C.CROWD_B10, text: '在里面', tip: C.TIP_IN },
  { r: 2.8, fill: C.ABOVE, text: '超出里面那道', tip: C.TIP_ABOVE },
  { r: 3, fill: C.BELOW, text: '超出外面那道', tip: C.TIP_BELOW },
] as const

const pts = computed(() => props.data.points.map(p => ({ doy: p.doy, x: X(p.doy), y: Y(p.v), ...LEVEL[p.level] })))

// ── 悬停:取最近的一天,竖线 + 三行气泡(B10 不画高亮点,照画布) ──
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
  const at = md(p.date), lv = LEVEL[p.level]
  const lines = [
    { t: `${at.m}月${at.d}日`, b: true },
    { t: `偏差 ${p.v > 0 ? '+' : ''}${p.v.toFixed(3)}` },
    { t: lv.text, c: lv.tip },
  ] as { t: string; c?: string; b?: boolean }[]
  const x = X(p.doy)
  const w = tipWidth(lines.map(l => l.t), 22)
  return { x, lines, left: r1(tipX(x, w, { width: W.value, padL: PAD_L, padR: PAD_R })) }
})
</script>

<template>
  <div class="av2-card pv-b10">
    <div class="av2-card-h">
      <span class="t">逐日偏离与两道范围线</span>
      <span class="hint">每天的偏差有没有超出它平时的起伏</span>
    </div>
    <div ref="el" class="plot" :style="{ height: H + 'px' }" @mousemove="onMove" @mouseleave="hover = null">
      <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="逐日偏离与两道范围线">
        <template v-for="v in axis.ticks" :key="'g' + v">
          <line class="gl" :x1="PAD_L" :x2="W - PAD_R" :y1="Y(v)" :y2="Y(v)" :stroke="C.GRID" />
          <text class="ax" :x="PAD_L - 6" :y="Y(v) + 4" text-anchor="end" :fill="C.AXIS_TEXT">{{ tickLabel(v) }}</text>
        </template>
        <!-- 数据组:只形变不擦入;悬停层(竖线 / 气泡)是 SVG 外的 HTML,0ms -->
        <g :class="['b10-data', 'ana-morph', { hold }]">
          <rect v-if="future" class="future" :x="future.x" :y="padT" :width="future.w" :height="iH" :fill="C.FUTURE" />
          <rect class="outer" :x="PAD_L" :y="bands.outer.y" :width="W - PAD_L - PAD_R" :height="bands.outer.h" :fill="C.BAND" fill-opacity="0.25" />
          <rect class="inner" :x="PAD_L" :y="bands.inner.y" :width="W - PAD_L - PAD_R" :height="bands.inner.h" :fill="C.BAND" fill-opacity="0.5" />
          <!-- 中线用 path:<line> 的端点过渡不了 -->
          <path class="center" :d="`M${PAD_L},${Y(data.center)} H${W - PAD_R}`" fill="none" :stroke="C.MID" stroke-width="1.5" />
          <template v-if="win">
            <rect class="win" :x="win.x" :y="H - padB - 10" :width="win.w" height="10" fill="var(--ink-100)" />
            <text class="ax winlab" :x="win.x + 4" :y="H - padB - 14" text-anchor="start" :fill="C.AXIS_TEXT">
              <template v-if="data.wholePeriod">这两道线是拿全期 {{ win.from }} – {{ win.to }} 估的</template>
              <template v-else>这两道线是拿 {{ win.from }} – {{ win.to }} 这一段估的</template>
            </text>
          </template>
          <circle v-for="p in pts" :key="'p' + p.doy" class="pt" :cx="p.x" :cy="p.y" :r="p.r" :fill="p.fill" />
        </g>
        <line class="axl" :x1="PAD_L" :x2="W - PAD_R" :y1="H - padB" :y2="H - padB" :stroke="AXIS_LINE" stroke-width="1" />
        <text
          v-for="t in months" :key="'m' + t.m" class="ax mlab" :x="t.x" :y="H - padB + 18" text-anchor="middle"
          :fill="t.m === segMonth ? C.FOCUS : C.AXIS_TEXT" :font-weight="t.m === segMonth ? 600 : 400"
        >{{ t.m }}月</text>
        <text class="ax bandlab" :x="W - PAD_R - 4" :y="bands.inner.y - 4" text-anchor="end" :fill="C.AXIS_TEXT">平时的起伏</text>
        <text v-if="bands.outerLabel" class="ax bandlab" :x="W - PAD_R - 4" :y="bands.outer.y - 4" text-anchor="end" :fill="C.AXIS_TEXT">更宽的那道</text>
      </svg>
      <template v-if="tip">
        <span class="hair" :style="{ left: tip.x + 'px', top: padT + 'px', height: iH + 'px', background: C.TIP_HAIR }"></span>
        <div class="cz-tip dtip" :style="{ left: tip.left + 'px', top: '8px' }">
          <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, fontWeight: l.b ? 600 : 400 }">{{ l.t }}</span>
        </div>
      </template>
    </div>
    <div class="leg">
      <span><u :style="{ background: LEVEL[0].fill }"></u>在里面 {{ data.counts[0] }} 天</span>
      <span><u :style="{ background: LEVEL[1].fill }"></u>超出里面那道 {{ data.counts[1] }} 天</span>
      <span><u :style="{ background: LEVEL[2].fill }"></u>超出外面那道 {{ data.counts[2] }} 天</span>
      <span><b :style="{ background: C.BAND, opacity: 0.5 }"></b>平时的起伏</span>
      <span><b :style="{ background: C.BAND, opacity: 0.25 }"></b>更宽的那道</span>
    </div>
    <!-- C5-11:估计窗口为空时整段图注常驻占一行(win.from / win.to 挪进内层 template) -->
    <p class="ana-ref hold">
      <template v-if="win">中线与两道范围<template v-if="!data.wholePeriod">都用 {{ win.to }} 及之前那一段估，之后的日子拿来对照</template><template v-else>用全期 {{ win.from }} – {{ win.to }} 估，没有留出对照的日子</template></template>
    </p>
  </div>
</template>

<style scoped>
.plot { position: relative; }
.plot svg { display: block; }
.ax { font-size: 11px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.hair { position: absolute; width: 1px; pointer-events: none; }
.dtip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; color: var(--text-on-solid); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.leg { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--text-secondary); white-space: nowrap; flex-wrap: wrap; margin-top: 8px; }
.leg span { display: inline-flex; align-items: center; gap: 5px; }
.leg b { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.leg u { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
</style>
