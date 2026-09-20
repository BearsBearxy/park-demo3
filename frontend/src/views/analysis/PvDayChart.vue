<script setup lang="ts">
// B1 通栏逐刻度比值图(PV-ANALYSIS-SCREEN-V4 §3.2)。几何照画布 v2/Main.dc.html 的 renderVals 抄:
// 画布 宽 = 实测 × 高 236(容器窄 200),padL 44 / padR 14 / padT 12 / padB 24;坐标保留一位小数。
//
// 三态(§03.8)是两种视觉:漏抄 = 折线断开 + 底部 2×7 琥珀刻度;未到 = 右侧淡底。不写「未到 / 漏」字(V4 §0)。
// 量程是这栋自己的(已抄点 ∪ 带上下沿 + 12% 余量),不共用、不钳位;x 轴画满整段,带画满整宽。
// 这里只做像素几何,事实句 fact 由 pvAnaV4.logic.ts 的 dayFact 拼好传进来。
// 读不出的栋(unreadable)照样画线和带,但不画连续段底色、不给点按出范围着色、气泡不写在不在范围内(§07 不出判据结论)。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useEnterPhase, useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { FP_ANA_THEME } from '@/components/ana/anaTheme'
import '@/components/ana/ana.css'
import { PV_COLORS as C } from './pvAnaColors'
import type { PvDayChartProps } from './pvAnaV4.logic'

const props = defineProps<PvDayChartProps>()

const padL = 44, padR = 14, padT = 12, padB = 24
const AXIS_LINE = FP_ANA_THEME.categoryAxis.axisLine.lineStyle.color

const { el, width: W } = useWidth(1025)
// 容器窄就换几何,不整幅缩放、不动字号(PvCharts1 稿 §①)。判容器不判视口:桌面 .av2-s4 窄栏同样只有 300 多。
const narrow = computed(() => W.value < 420)
const H = computed(() => (narrow.value ? 200 : 236))
const iH = computed(() => H.value - padT - padB)
/** x 标签基线 / 缺抄刻度顶,跟着 H 走(桌面仍是 230 / 205,刻度底压在轴线上) */
const axY = computed(() => H.value - 6)
const missY = computed(() => H.value - padB - 7)
// 首挂在视口内 320 擦入;换栋 / 换期 200 同键形变(2026-09-16 行为矩阵):同一刻度上的点、线段从旧值滑到新值。
// first 在 animationend.self **与 animationcancel.self** 摘掉。擦入期间与改宽那两帧 hold 关掉形变,两个效果不叠。
const first = useEnterPhase(el)
const hold = useMorphHold(W, first)
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
  return +(padT + ((mx - v) / (mx - mn)) * iH.value).toFixed(1)
}

const grid = computed(() => [0, 1, 2, 3].map(k => {
  const d = dom.value
  if (!d) return { y: +(padT + (iH.value * (3 - k)) / 3).toFixed(1), label: '' }
  const v = d.mn + (k * (d.mx - d.mn)) / 3
  return { y: Y(v), label: v.toFixed(2) }
}))

const band = computed(() => {
  const { lo, hi } = props.row
  if (lo == null || hi == null || !dom.value) return null
  return { y: Y(hi), h: +(Y(lo) - Y(hi)).toFixed(1), hiTop: Y(hi) - 15, loTop: Y(lo) + 2, hi: hi.toFixed(3), lo: lo.toFixed(3) }
})

/** 折线拆成相邻两刻度一段、按起点刻度作键:每段都是「M L」同一结构,换栋时 d 能过渡;漏抄处不出那一段 = 断开。
 *  拆 M 子路径的单条 path 做不到 —— 断点位置一变,命令结构就变,d 直接跳。圆头线帽叠出来与圆角连接一样。 */
const lineSegs = computed(() => {
  const out: { i: number; d: string }[] = []
  for (let i = 0; i + 1 < n.value; i++) {
    if (seen(i) && seen(i + 1)) out.push({ i, d: `M${X(i)},${Y(props.row.ratio[i]!)} L${X(i + 1)},${Y(props.row.ratio[i + 1]!)}` })
  }
  return out
})

const pts = computed(() => {
  const out: { i: number; x: number; y: number; fill: string }[] = []
  if (props.unreadable) return out
  for (let i = 0; i < n.value; i++) {
    const o = props.row.out[i]
    if (seen(i) && o) out.push({ i, x: X(i), y: Y(props.row.ratio[i]!), fill: o < 0 ? C.BELOW : C.ABOVE })
  }
  return out
})

/** 连续段底色,夹进绘图区 */
const runs = computed(() => {
  const half = iW.value / (n.value - 1) / 2
  return (props.unreadable ? [] : props.row.runs).map(r => {
    const x = Math.max(padL, X(r.from) - half), x2 = Math.min(W.value - padR, X(r.to) + half)
    return { from: r.from, x: +x.toFixed(1), w: +(x2 - x).toFixed(1), fill: r.dir < 0 ? C.BELOW : C.ABOVE }
  })
})

const misses = computed(() => props.row.state.flatMap((s, i) => (s === 'missing' && !preBorn(i) ? [{ i, x: +(X(i) - 1).toFixed(1) }] : [])))

const future = computed(() => {
  if (props.elapsedN >= n.value) return null
  const x = X(props.elapsedN - 0.5)
  return { x, w: +(X(n.value - 1) - x).toFixed(1) }
})

/** 月档标 1 / 5 / 10 … / 末日(末日前一格的 5 的倍数让给末日);容器窄改 7 天一标 = 1 / 8 / 15 / 22 / 末日共 5 个;年档 12 个月全标 */
const xTicks = computed(() => props.tickLabels.flatMap((t, i) => {
  const d = i + 1
  const mid = narrow.value ? d % 7 === 1 && d <= n.value - 4 : d % 5 === 0 && d <= n.value - 2
  const show = props.gran === 'year' || i === 0 || i === n.value - 1 || mid
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
      <!-- 上下沿标签与 SVG 数据组同一条类规则,但不挂 animationend:监听只在 g 上一份(C6-17) -->
      <div v-if="band" class="pdc-data pdc-bandlab" :class="{ first }">
        <span class="axh hi" :style="{ right: '18px', top: band.hiTop + 'px' }">上沿 {{ band.hi }}</span>
        <span class="axh lo" :style="{ right: '18px', top: band.loTop + 'px' }">下沿 {{ band.lo }}</span>
      </div>

      <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${row.name}：${fact}`">
        <line v-for="(g, k) in grid" :key="'g' + k" class="gl" :x1="padL" :x2="W - padR" :y1="g.y" :y2="g.y" :stroke="C.GRID" />
        <!-- 尺子先在,数据擦上去:轴线与 x 刻度挪到数据组之前(C6-17) -->
        <line class="axl" :x1="padL" :x2="W - padR" :y1="H - padB" :y2="H - padB" :stroke="AXIS_LINE" stroke-width="1" />
        <text v-for="t in xTicks" :key="'x' + t.t" class="ax" :x="t.x" :y="axY" text-anchor="middle" :fill="C.AXIS_TEXT">{{ t.t }}</text>
        <!-- 键全按刻度(runs 按起点刻度):换栋 / 换期元素复用才形变;悬停层(竖线 / 高亮点)在组外,0ms。
             刻度下标只在同一粒度里是同一类目 —— 组按粒度作键,按月 ↔ 按年整组换新元素瞬到,「5 日」不滑成「5 月」 -->
        <g :key="gran" :class="['pdc-data', 'ana-morph', { first, hold }]" @animationend.self="first = false"
          @animationcancel.self="first = false">
          <rect v-if="future" class="future" :x="future.x" :y="padT" :width="future.w" :height="iH" :fill="C.FUTURE" />
          <rect v-if="band" class="band" :x="padL" :y="band.y" :width="iW" :height="band.h" :fill="C.BAND" fill-opacity="0.4" />
          <path v-if="dom && row.center != null" class="ctr" :d="`M${padL},${Y(row.center)} H${W - padR}`" fill="none" :stroke="C.MID" stroke-width="1" stroke-dasharray="3 3" />
          <rect v-for="r in runs" :key="'r' + r.from" class="run" :x="r.x" :y="padT" :width="r.w" :height="iH" :fill="r.fill" fill-opacity="0.1" />
          <rect v-for="m in misses" :key="'m' + m.i" class="miss" :x="m.x" :y="missY" width="2" height="7" :fill="C.ABOVE" />
          <path v-for="s in lineSegs" :key="'s' + s.i" class="line" :d="s.d" fill="none" :stroke="C.FOCUS" stroke-width="2" stroke-linecap="round" />
          <circle v-for="p in pts" :key="'p' + p.i" class="pt" :cx="p.x" :cy="p.y" r="4" :fill="p.fill" stroke="var(--surface-white)" stroke-width="1.5" />
        </g>
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
/* C6-17 首挂:数据组一个 g 一条 clip-path,从左到右一笔(fp-wipe 在 ana.css,基态由消费者自己写)。
   换栋不再另挂淡入类:形变(ana-morph)只动几何属性,不碰 clip-path,擦入中途换栋也不会被裁成空图 */
.pdc-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
.pdc-bandlab { position: absolute; inset: 0; pointer-events: none; }
.axh { position: absolute; font-size: 11px; line-height: 14px; font-family: var(--font-mono); color: v-bind('C.AXIS_TEXT'); font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; }
.ax { font-size: 11px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pdc-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
</style>
