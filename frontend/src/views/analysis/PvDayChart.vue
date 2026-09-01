<script setup lang="ts">
// 单栋逐日大图(PV-ANALYSIS-SPEC §06.3 右栏 / 三态 §03.8)。
//
// **内联 SVG,不用 ECharts。** 要画的三态(未到淡底 + 竖界 / 漏抄断开 + 缺口记号)、
// 连续段底色、上下沿标注,用 markArea/markLine 拼比手写更难保证;而且这是**一张**图不是
// 十三张,没有共用轴的负担 —— 共用纵轴正是 v2.1 那版把 F座 那行压成平线的根因(§00 v3-1)。
//
// **量程是这栋自己的,不共用、不钳位。** 一次只画一栋,横向可比性由「带是它自己的历史」
// 承担(§06.3),所以钳位没有任何理由存在。
//
// **x 轴永远画满整段**,不随录到哪天伸缩 —— 日期位置稳定,明天打开不会整体位移(§03.8)。
// **范围带照常画满整宽** —— 带来自 §3.7 的段外窗口,与本段抄了几天无关。
//
// ⚠ 文案(§05):只说明可视化在做什么。图脚复述的是 x 轴口径、带是拿哪一段估的、
//   已过去/已抄几个刻度 —— 全是数据里直接读得出来的事实,没有判词、成因与建议。
import { computed } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { PV_COLORS } from './pvAnaColors'
import type { BoardRow, Criteria } from './pvMeterAna.logic'

const props = defineProps<{ row: BoardRow; tickLabels: string[]; fact: string; crit: Criteria }>()

// 结构灰走 CSS 令牌变量(内联 SVG 在 DOM 里,拿得到自定义属性);
// 只有强调色从镜像取 —— 它同时要给同屏的 ECharts 块用,两处必须是同一个字面值。
const OUT = PV_COLORS.OUT

// §06.3 的画布:1006×206,ML=52 MR=10 MT=10 MB=24。
// 高度**固定 206**,只有宽度跟容器走 —— viewBox 宽取实测像素宽,1 单位 = 1px,
// 这样等比缩放不会把 11px 的轴标缩到 10px 以下(§06.7 字号铁律)。
const VBH = 206, ML = 52, MR = 10, MT = 10, MB = 24
const Y1 = VBH - MB          // 绘图区下沿 182
const IH = Y1 - MT           // 绘图区高 172

const { el, width } = useWidth(1006)
const vw = computed(() => Math.max(420, Math.round(width.value)))
const xR = computed(() => vw.value - MR)
const iw = computed(() => xR.value - ML)

const n = computed(() => props.tickLabels.length)
const step = computed(() => (n.value > 1 ? iw.value / (n.value - 1) : 0))
const half = computed(() => (n.value > 1 ? step.value / 2 : iw.value / 2))
const X = (i: number) => ML + i * step.value

/** 刻度单位:年档的短标签是「6月」,月档是「6」。图脚与判据措辞跟着它变。 */
const unit = computed(() => (props.tickLabels[0]?.endsWith('月') ? '个月' : '天'))

/** 这栋自己的量程:已抄的点 + 带上下沿 + 中心,留 8% 余量。**不钳位。** */
const dom = computed(() => {
  const vs: number[] = []
  props.row.ratio.forEach((v, i) => { if (v != null && props.row.state[i] === 'seen') vs.push(v) })
  for (const b of [props.row.lo, props.row.hi, props.row.center]) if (b != null) vs.push(b)
  if (!vs.length) return { min: 0, max: 1 }
  let mn = Math.min(...vs), mx = Math.max(...vs)
  if (mx - mn < 1e-9) { mn -= 0.05; mx += 0.05 }
  const pad = (mx - mn) * 0.08
  return { min: mn - pad, max: mx + pad }
})
const Y = (v: number) => Y1 - ((v - dom.value.min) / (dom.value.max - dom.value.min)) * IH

const grid = computed(() => [0, 1, 2, 3].map(k => {
  const v = dom.value.min + (dom.value.max - dom.value.min) * (k / 3)
  return { v, y: Y(v) }
}))

const band = computed(() => {
  const { lo, hi } = props.row
  if (lo == null || hi == null) return null
  return { yHi: Y(hi), h: Math.max(1, Y(lo) - Y(hi)), lo, hi }
})

/** 连续段底色。**夹进绘图区** —— 首末刻度的段不许外溢到轴标区(§06.3)。 */
const runRects = computed(() => props.row.runs.map(r => {
  const a = Math.max(ML, X(r.from) - half.value)
  const b = Math.min(xR.value, X(r.to) + half.value)
  return { x: a, w: Math.max(1, b - a) }
}))

/** 折线:missing 与 future 处**断开,不插值**(§03.8)。单点不成线,靠圆点表示。 */
const segs = computed(() => {
  const out: string[] = []
  let cur: string[] = []
  for (let i = 0; i < n.value; i++) {
    const v = props.row.ratio[i]
    if (props.row.state[i] === 'seen' && v != null) cur.push(`${X(i)},${Y(v)}`)
    else { if (cur.length > 1) out.push(cur.join(' ')); cur = [] }
  }
  if (cur.length > 1) out.push(cur.join(' '))
  return out
})

const dots = computed(() => {
  const out: { x: number; y: number; out: boolean }[] = []
  for (let i = 0; i < n.value; i++) {
    const v = props.row.ratio[i]
    if (props.row.state[i] !== 'seen' || v == null) continue
    out.push({ x: X(i), y: Y(v), out: !!props.row.out[i] })
  }
  return out
})

/** 漏抄:底部缺口记号(两道竖杠夹一道空)+「漏」。与「未到」是**两种形状**。 */
const gaps = computed(() => {
  const out: number[] = []
  for (let i = 0; i < n.value; i++) if (props.row.state[i] === 'missing') out.push(X(i))
  return out
})

/** 未到:淡底 + 一条虚线竖界 + 标注。未到按定义是段尾,取第一个即可。 */
const fut = computed(() => {
  const i = props.row.state.findIndex(s => s === 'future')
  if (i < 0 || i >= n.value) return null
  const x = Math.min(xR.value, Math.max(ML, X(i) - half.value))
  // ponytail: 短标签只有日号/月份,拿不到 M/D 的 M —— 月份写在卡头,这里补单位不补月
  const at = unit.value === '个月' ? props.tickLabels[i] : `${props.tickLabels[i]} 日`
  return { x, w: Math.max(0, xR.value - x), at }
})

/** 标首 / 中 / 末与 5 的倍数;未到那段的刻度淡化(§03.8)。 */
const xTicks = computed(() => {
  const last = n.value - 1, mid = Math.floor(last / 2)
  const out: { x: number; t: string; dim: boolean }[] = []
  props.tickLabels.forEach((t, i) => {
    const num = Number(t.replace(/\D/g, ''))
    if (i === 0 || i === last || i === mid || (Number.isFinite(num) && num > 0 && num % 5 === 0)) {
      out.push({ x: X(i), t, dim: props.row.state[i] === 'future' })
    }
  })
  return out
})

const aria = computed(() => `${props.row.name} 逐${unit.value === '个月' ? '月' : '日'}比值图。${props.fact}`)

const foot = computed(() => {
  const u = unit.value
  const parts = [
    `淡带 = 这栋的正常范围（${props.crit.bandSigma} 倍波动），${props.row.baseNote}`,
    ...(u === '天' ? [`琥珀底 = 连续 ≥${props.crit.bandRun} 个已抄刻度同向`] : []),
    `横轴 = 本段全部 ${n.value} ${u}，画满不伸缩`,
    `已过去 ${props.row.elapsedN} ${u}，已抄 ${props.row.seenN} ${u}`,
  ]
  return parts.join(' · ')
})
</script>

<template>
  <div ref="el" class="pdc">
    <div class="pdc-hd">
      <span class="nm">{{ row.name }}</span>
      <span class="fact">{{ fact }}</span>
    </div>

    <svg class="pdc-svg" :viewBox="`0 0 ${vw} ${VBH}`" :width="vw" :height="VBH"
      role="img" :aria-label="aria">
      <title>{{ aria }}</title>

      <!-- y 网格 4 档 + 左侧刻度值(这栋自己的量程) -->
      <g>
        <line v-for="(g, i) in grid" :key="'g' + i" class="gl" :x1="ML" :x2="xR" :y1="g.y" :y2="g.y" />
        <text v-for="(g, i) in grid" :key="'gt' + i" class="gt" :x="ML - 6" :y="g.y + 3.5">{{ g.v.toFixed(2) }}</text>
      </g>

      <!-- 正常范围带:画满整宽,与本段抄了几天无关(§03.8) -->
      <rect v-if="band" class="band" :x="ML" :y="band.yHi" :width="iw" :height="band.h" />

      <!-- 连续段底色,夹进绘图区 -->
      <rect v-for="(r, i) in runRects" :key="'r' + i" :x="r.x" :y="MT" :width="r.w" :height="IH"
        :fill="OUT" fill-opacity="0.09" />

      <!-- 未到:淡底 + 虚线竖界 + 标注 -->
      <g v-if="fut">
        <rect class="fut" :x="fut.x" :y="MT" :width="fut.w" :height="IH" />
        <line class="futline" :x1="fut.x" :x2="fut.x" :y1="MT" :y2="Y1" />
        <text class="futlab" :x="fut.x + 5" :y="MT + 11">未到（{{ fut.at }}起）</text>
      </g>

      <!-- 中心虚线 + 带上下沿虚线,右端标数值 -->
      <template v-if="row.center != null">
        <line class="ctr" :x1="ML" :x2="xR" :y1="Y(row.center)" :y2="Y(row.center)" />
      </template>
      <template v-if="band">
        <line class="edge" :x1="ML" :x2="xR" :y1="Y(band.hi)" :y2="Y(band.hi)" />
        <line class="edge" :x1="ML" :x2="xR" :y1="Y(band.lo)" :y2="Y(band.lo)" />
        <text class="ev" :x="xR - 3" :y="Y(band.hi) - 3">{{ band.hi.toFixed(2) }}</text>
        <text class="ev" :x="xR - 3" :y="Y(band.lo) + 10">{{ band.lo.toFixed(2) }}</text>
      </template>

      <line class="ax" :x1="ML" :x2="xR" :y1="Y1" :y2="Y1" />

      <polyline v-for="(p, i) in segs" :key="'s' + i" class="ln" :points="p" />

      <circle v-for="(d, i) in dots" :key="'d' + i" :cx="d.x" :cy="d.y" :r="d.out ? 3.4 : 1.9"
        :fill="d.out ? OUT : 'var(--ink-500)'" />

      <!-- 漏抄:缺口记号 +「漏」。断开的折线已经说了「这天没数」,记号说「这天该有数」 -->
      <g v-for="(gx, i) in gaps" :key="'m' + i">
        <rect :x="gx - 4" :y="Y1 - 7" width="2" height="6" :fill="OUT" />
        <rect :x="gx + 2" :y="Y1 - 7" width="2" height="6" :fill="OUT" />
        <text class="gapl" :x="gx + 6" :y="Y1 - 1" :fill="OUT">漏</text>
      </g>

      <text v-for="(t, i) in xTicks" :key="'x' + i" class="xt" :class="{ dim: t.dim }"
        :x="t.x" :y="Y1 + 14">{{ t.t }}</text>
    </svg>

    <div class="pdc-ft">{{ foot }}</div>
  </div>
</template>

<style scoped>
.pdc { width: 100%; }
.pdc-hd { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
.pdc-hd .nm { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pdc-hd .fact { font-size: var(--fs-micro); color: var(--text-muted); }
.pdc-svg { display: block; max-width: 100%; }

.gl { stroke: var(--ink-100); stroke-width: 1; }
.gt { font-size: 11px; font-family: var(--font-mono); fill: var(--text-muted); text-anchor: end; }
.ax { stroke: var(--ink-300); stroke-width: 1; }

.band { fill: var(--ink-050); }
.edge { stroke: var(--ink-300); stroke-width: 1; stroke-dasharray: 4 3; }
.ctr { stroke: var(--ink-300); stroke-width: 1; stroke-dasharray: 2 3; }
.ev { font-size: 11px; font-family: var(--font-mono); fill: var(--text-muted); text-anchor: end; }

.fut { fill: var(--ink-050); }
.futline { stroke: var(--ink-300); stroke-width: 1; stroke-dasharray: 3 3; }
.futlab { font-size: 11px; fill: var(--text-muted); }

.ln { fill: none; stroke: var(--ink-700); stroke-width: 1.4; stroke-linejoin: round; }
.gapl { font-size: 11px; }

.xt { font-size: 11px; font-family: var(--font-mono); fill: var(--text-muted); text-anchor: middle; }
.xt.dim { fill: var(--ink-300); }
.pdc-ft { margin-top: 2px; font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.4; }
</style>
