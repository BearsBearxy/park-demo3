<script setup lang="ts">
// B1 通栏逐刻度比值图(PV-ANALYSIS-SCREEN-V4 §3.2)。几何照画布 v2/Main.dc.html 的 renderVals 抄:
// 画布 宽 = 实测 × 高 236,padL 44 / padR 14 / padT 12 / padB 24;坐标保留一位小数。
//
// 三态(§03.8)是两种视觉:漏抄 = 折线断开 + 底部 2×7 琥珀刻度;未到 = 右侧淡底。不写「未到 / 漏」字(V4 §0)。
// 量程是这栋自己的(已抄点 ∪ 带上下沿 + 12% 余量),不共用、不钳位;x 轴画满整段,带画满整宽。
// 这里只做像素几何,事实句 fact 由 pvAnaV4.logic.ts 的 dayFact 拼好传进来。
// 读不出的栋(unreadable)照样画线和带,但不画连续段底色、不给点按出范围着色、气泡不写在不在范围内(§07 不出判据结论)。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { FP_ANA_THEME } from '@/components/ana/anaTheme'
import '@/components/ana/ana.css'
import { PV_COLORS as C } from './pvAnaColors'
import type { PvDayChartProps } from './pvAnaV4.logic'

const props = defineProps<PvDayChartProps>()

const H = 236, padL = 44, padR = 14, padT = 12, padB = 24
const iH = H - padT - padB
const AXIS_LINE = FP_ANA_THEME.categoryAxis.axisLine.lineStyle.color

const { el, width: W } = useWidth(1025)
const iW = computed(() => W.value - padL - padR)
const n = computed(() => props.ticks.length)
/** 第 i 个刻度(0 起,可带小数)的 x */
const X = (i: number) => +(padL + (i / (n.value - 1)) * iW.value).toFixed(1)

const seen = (i: number) => props.row.state[i] === 'seen' && props.row.ratio[i] != null
// 同 pvAnaV4.logic.ts 的 missingN:早于第一条抄表的刻度是还没投产,不是漏抄
const preBorn = (i: number) => props.row.firstDate == null || props.row.firstDate.slice(0, props.ticks[i].length) > props.ticks[i]

/** 量程:已抄的比值 ∪ 带上下沿,再各留 12%。一个值都没有 = null(空态只画框线) */
const dom = computed(() => {
  const vs = props.row.ratio.filter((v, i): v is number => v != null && seen(i))
  for (const b of [props.row.lo, props.row.hi]) if (b != null) vs.push(b)
  if (!vs.length) return null
  let mn = Math.min(...vs), mx = Math.max(...vs)
  const vpad = (mx - mn || Math.abs(mx) || 1) * 0.12
  mn -= vpad; mx += vpad
  return { mn, mx }
})
const Y = (v: number) => {
  const { mn, mx } = dom.value!
  return +(padT + ((mx - v) / (mx - mn)) * iH).toFixed(1)
}

const grid = computed(() => [0, 1, 2, 3].map(k => {
  const d = dom.value
  if (!d) return { y: +(padT + (iH * (3 - k)) / 3).toFixed(1), label: '' }
  const v = d.mn + (k * (d.mx - d.mn)) / 3
  return { y: Y(v), label: v.toFixed(2) }
}))

const band = computed(() => {
  const { lo, hi } = props.row
  if (lo == null || hi == null || !dom.value) return null
  return { y: Y(hi), h: +(Y(lo) - Y(hi)).toFixed(1), hiTop: Y(hi) - 15, loTop: Y(lo) + 2, hi: hi.toFixed(3), lo: lo.toFixed(3) }
})

const linePath = computed(() => {
  let d = '', pen = false
  for (let i = 0; i < n.value; i++) {
    if (!seen(i)) { pen = false; continue }
    d += (pen ? ' L' : ' M') + X(i) + ',' + Y(props.row.ratio[i]!)
    pen = true
  }
  return d
})

const pts = computed(() => {
  const out: { x: number; y: number; fill: string }[] = []
  if (props.unreadable) return out
  for (let i = 0; i < n.value; i++) {
    const o = props.row.out[i]
    if (seen(i) && o) out.push({ x: X(i), y: Y(props.row.ratio[i]!), fill: o < 0 ? C.BELOW : C.ABOVE })
  }
  return out
})

/** 连续段底色,夹进绘图区 */
const runs = computed(() => {
  const half = iW.value / (n.value - 1) / 2
  return (props.unreadable ? [] : props.row.runs).map(r => {
    const x = Math.max(padL, X(r.from) - half), x2 = Math.min(W.value - padR, X(r.to) + half)
    return { x: +x.toFixed(1), w: +(x2 - x).toFixed(1), fill: r.dir < 0 ? C.BELOW : C.ABOVE }
  })
})

const misses = computed(() => props.row.state.flatMap((s, i) => (s === 'missing' && !preBorn(i) ? [+(X(i) - 1).toFixed(1)] : [])))

const future = computed(() => {
  if (props.elapsedN >= n.value) return null
  const x = X(props.elapsedN - 0.5)
  return { x, w: +(X(n.value - 1) - x).toFixed(1) }
})

/** 月档标 1 / 5 / 10 … / 末日(末日前一格的 5 的倍数让给末日);年档 12 个月全标 */
const xTicks = computed(() => props.tickLabels.flatMap((t, i) => {
  const d = i + 1
  const show = props.gran === 'year' || i === 0 || i === n.value - 1 || (d % 5 === 0 && d <= n.value - 2)
  return show ? [{ x: X(i), t }] : []
}))

// ── 悬停:取 x 最近的已过去刻度,不要求对准点 ──
const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  if (props.elapsedN < 1) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const i = Math.round(((e.clientX - r.left - padL) / iW.value) * (n.value - 1))
  hover.value = Math.max(0, Math.min(props.elapsedN - 1, i))
}

const tip = computed(() => {
  const i = hover.value
  if (i == null || preBorn(i)) return null
  const row = props.row, t = props.ticks[i]
  const miss = row.state[i] === 'missing'
  const lines: { t: string; c?: string; b?: boolean; dim?: boolean }[] = [{
    t: props.gran === 'month' ? `${Number(t.slice(5, 7))} 月 ${Number(t.slice(8, 10))} 日` : `${t.slice(0, 4)} 年 ${Number(t.slice(5, 7))} 月`,
    b: true,
  }]
  if (miss) lines.push({ t: props.gran === 'month' ? '这天没抄表' : '这个月没抄表', c: C.TIP_ABOVE })
  else if (seen(i)) {
    lines.push({ t: `比值 ${row.ratio[i]!.toFixed(3)}` })
    if (row.lo != null && row.hi != null) lines.push({ t: `范围 ${row.lo.toFixed(3)} – ${row.hi.toFixed(3)}`, dim: true })
    const o = row.out[i]
    if (o != null && !props.unreadable) lines.push(o < 0 ? { t: '低于下沿', c: C.TIP_BELOW } : o > 0 ? { t: '高于上沿', c: C.TIP_ABOVE } : { t: '在范围内', c: C.TIP_IN })
  }
  const x = X(i)
  const w = tipWidth(lines.map(l => l.t), 22)
  return {
    x, lines,
    left: tipX(x, w, { width: W.value, padL, padR }),
    dotY: seen(i) ? Y(row.ratio[i]!) : null,
  }
})
</script>

<template>
  <div ref="el" class="pdc">
    <div class="pdc-hd">
      <span class="nm">{{ row.name }}</span>
      <span class="fact">{{ fact }}</span>
      <div class="leg">
        <span><i :style="{ background: C.FOCUS }"></i>逐{{ gran === 'month' ? '日' : '月' }}比值</span>
        <span><b :style="{ background: C.BAND }"></b>这栋的范围</span>
        <span><u :style="{ background: C.BELOW }"></u>低于下沿</span>
        <span><u :style="{ background: C.ABOVE }"></u>高于上沿</span>
        <span><i class="tick" :style="{ background: C.ABOVE }"></i>缺抄</span>
      </div>
    </div>

    <div class="pdc-plot" :style="{ width: W + 'px', height: H + 'px' }" @mousemove="onMove" @mouseleave="hover = null">
      <span v-for="(g, k) in grid" v-show="g.label" :key="'gl' + k" class="axh" :style="{ left: '0px', width: '38px', textAlign: 'right', top: g.y - 7 + 'px' }">{{ g.label }}</span>
      <template v-if="band">
        <span class="axh hi" :style="{ right: '18px', top: band.hiTop + 'px' }">上沿 {{ band.hi }}</span>
        <span class="axh lo" :style="{ right: '18px', top: band.loTop + 'px' }">下沿 {{ band.lo }}</span>
      </template>

      <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${row.name}：${fact}`">
        <line v-for="(g, k) in grid" :key="'g' + k" class="gl" :x1="padL" :x2="W - padR" :y1="g.y" :y2="g.y" :stroke="C.GRID" />
        <rect v-if="future" class="future" :x="future.x" :y="padT" :width="future.w" :height="iH" :fill="C.FUTURE" />
        <rect v-if="band" class="band" :x="padL" :y="band.y" :width="iW" :height="band.h" :fill="C.BAND" fill-opacity="0.4" />
        <line v-if="dom && row.center != null" class="ctr" :x1="padL" :x2="W - padR" :y1="Y(row.center)" :y2="Y(row.center)" :stroke="C.MID" stroke-width="1" stroke-dasharray="3 3" />
        <rect v-for="(r, k) in runs" :key="'r' + k" class="run" :x="r.x" :y="padT" :width="r.w" :height="iH" :fill="r.fill" fill-opacity="0.1" />
        <line class="axl" :x1="padL" :x2="W - padR" :y1="H - padB" :y2="H - padB" :stroke="AXIS_LINE" stroke-width="1" />
        <text v-for="t in xTicks" :key="'x' + t.t" class="ax" :x="t.x" :y="230" text-anchor="middle" :fill="C.AXIS_TEXT">{{ t.t }}</text>
        <rect v-for="mx in misses" :key="'m' + mx" class="miss" :x="mx" :y="205" width="2" height="7" :fill="C.ABOVE" />
        <path v-if="linePath" class="line" :d="linePath" fill="none" :stroke="C.FOCUS" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle v-for="(p, k) in pts" :key="'p' + k" class="pt" :cx="p.x" :cy="p.y" r="4" :fill="p.fill" stroke="var(--surface-white)" stroke-width="1.5" />
        <template v-if="tip">
          <line class="hair" :x1="tip.x" :x2="tip.x" :y1="padT" :y2="H - padB" :stroke="C.TIP_HAIR" stroke-width="1" />
          <circle v-if="tip.dotY != null" class="hdot" :cx="tip.x" :cy="tip.dotY" r="5" :fill="C.FOCUS" stroke="var(--surface-white)" stroke-width="2" />
        </template>
      </svg>

      <div v-if="tip" class="cz-tip pdc-tip" :style="{ left: tip.left + 'px', top: '8px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, fontWeight: l.b ? 600 : 400, opacity: l.dim ? 0.72 : undefined }">{{ l.t }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdc { margin-top: 12px; display: flex; flex-direction: column; min-width: 0; }
.pdc-hd { display: flex; align-items: baseline; gap: 8px; height: 24px; min-width: 0; }
.pdc-hd .nm { font-size: 14px; font-weight: var(--fw-semibold); flex: 0 0 auto; white-space: nowrap; color: var(--text-primary); }
.pdc-hd .fact { font-size: 11px; color: var(--text-muted); flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.leg { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.leg span { display: inline-flex; align-items: center; gap: 5px; }
.leg i { display: inline-block; width: 12px; height: 3px; border-radius: 2px; }
.leg i.tick { width: 3px; height: 8px; }
.leg b { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.leg u { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--surface-white); box-shadow: 0 0 0 1px v-bind(AXIS_LINE); }
.pdc-plot { position: relative; }
.pdc-plot svg { display: block; }
.axh { position: absolute; font-size: 11px; line-height: 14px; font-family: var(--font-mono); color: v-bind('C.AXIS_TEXT'); font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; }
.ax { font-size: 11px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pdc-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
</style>
