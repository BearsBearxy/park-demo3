<script setup lang="ts">
// B3 · 每千瓦发电走势(PV-ANALYSIS-SCREEN-V4 §3.5;2026-10-06 改稿画板 pv-v2-m-abs / y-abs / m-trail-over)。
// 画布 卡内宽 × 250(容器 < 420 时 210),padL 44 / padR 84 / padT 12 / padB 24;x = 刻度落点(首尾贴边),月档逐日、年档逐月;
// y = 数据极值各外扩 18%,下沿封在 0(发电不会是负的);4 条横网格;线尾直标最小间距 13。
// 选中栋超过 data.cap(每千瓦一天 24 kWh)的点压到 cap 画、碰到它的线段画虚线,纵轴上沿就是 cap(不再被撑到 52)。
// 「全园中间」走墨阶(原来浅蓝和三期同值)。
// 数据口径(分母、在网 < 3 栋留空、漏抄置空)全在 pvAnaV4.logic.ts 的 yieldBand(),这里只画。
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useEnterPhase, useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import '@/components/ana/ana.css'   // @keyframes fp-wipe + ana-morph
import { PV } from '@/components/ana/anaSentence'
import { PV_COLORS } from './pvAnaColors'
import type { PvYieldBandProps } from './pvAnaV4.logic'

const props = defineProps<PvYieldBandProps>()

const BAND_NAME = '各栋中间一半'
// 右留白放得下最长的线尾字(画板便签 better#3):原来 62,「各栋中间一半」放不下被往左推、压在最后一个点上
const PL = 44, PR = 8 + tipWidth([BAND_NAME], 0) + 4, PT = 12, PB = 24, GAP = 13
const { el, width } = useWidth(999)
// 窄容器换几何(手机屏,和桌面 .av2-s4 窄栏 —— 同一张图两处都只有 300 多):高 250→210,年档月标签隔一标。
// 判容器宽不判视口宽;点数、字号、线宽一个都不动。
const narrow = computed(() => width.value < 420)
const H = computed(() => (narrow.value ? 210 : 250))
const IH = computed(() => H.value - PT - PB)
// 切到「绝对水平」挂上来时在视口内擦入 320;换栋 / 换期 200 同键形变(线段与带按刻度作键),擦入中 / 改宽时 hold 关掉
const first = useEnterPhase(el)
const hold = useMorphHold(width, first)
const iw = computed(() => width.value - PL - PR)
const n = computed(() => props.data.labels.length)
const xOf = (i: number) => PL + (n.value > 1 ? (i / (n.value - 1)) * iw.value : iw.value / 2)
/** 最后一个已过去的刻度;悬停与线尾标签都不越过它 */
const lastIdx = computed(() => (props.data.futureFrom ?? n.value) - 1)

/** 超过 cap 的点压到 cap 画;气泡里写真值。cap 按年是逐刻度的(24 × 当月天数) */
const capAt = (i: number): number | null => {
  const c = props.data.cap
  return c == null ? null : typeof c === 'number' ? c : c[i] ?? null
}
const over = (v: number | null, i: number) => { const c = capAt(i); return c != null && v != null && v > c }
const selDrawn = computed(() => props.data.sel.map((v, i) => (over(v, i) ? capAt(i) : v)))
const capped = computed(() => props.data.sel.some(over))
const dom = computed(() => {
  const d = props.data
  const vs = [...selDrawn.value, ...d.med, ...d.lo, ...d.hi].filter((v): v is number => v != null)
  if (!vs.length) return null
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.18 || 1
  // 压顶时上沿就是压到的那个上限(压过的点是最高的点),不再外扩
  return { min: Math.max(0, lo - pad), max: capped.value ? hi : hi + pad }
})
const yOf = (v: number) => {
  const d = dom.value!
  return PT + IH.value - ((v - d.min) / (d.max - d.min)) * IH.value
}

const grid = computed(() => {
  const d = dom.value
  if (!d) return []
  return [0, 1, 2, 3].map(k => ({ y: PT + IH.value - (k / 3) * IH.value, label: (d.min + (k / 3) * (d.max - d.min)).toFixed(1) }))
})

const shade = computed(() => {
  const f = props.data.futureFrom
  if (f == null || n.value < 2) return null
  const x = f === 0 ? PL : xOf(f) - iw.value / (n.value - 1) / 2
  return { x, w: PL + iw.value - x }
})

const xLabels = computed(() => {
  const L = props.data.labels
  // 月档:1 日、逢 5 的日、最后一日(离最后一日不足 3 天的逢 5 日让位,31 日月份不标 30);年档逐月全标,窄容器隔一标(12 个月标 1/3/5/7/9/11)
  const keep = props.data.gran === 'year'
    ? L.map((_, i) => i).filter(i => !narrow.value || i % 2 === 0)
    : L.map((_, i) => i).filter(i => i === 0 || i === L.length - 1 || (Number(L[i]) % 5 === 0 && L.length - 1 - i >= 3))
  return keep.map(i => ({ x: xOf(i), text: L[i] }))
})

/** 连续非空的下标段 */
function runsOf(ok: (i: number) => boolean): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  for (let i = 0; i < n.value; i++) {
    if (ok(i)) cur.push(i)
    else if (cur.length) { out.push(cur); cur = [] }
  }
  if (cur.length) out.push(cur)
  return out
}
/** 线拆成相邻两刻度一段、按起点刻度作键:每段同一「M L」结构,换栋 / 换期时 d 能过渡;空刻度两侧不出段 = 断开。
 *  拆 M 子路径的单条 path 做不到 —— 断点位置一变命令结构就变,d 直接跳。圆头线帽叠出来与圆角连接一样。
 *  dot:单独一个点也要看得见(漏抄夹着的那一天)—— 同点再连一次,圆头线帽画成点(只给选中栋;全园线原来就不出点) */
function lineSegs(vals: (number | null)[], dot: boolean, dash?: (i: number) => boolean): { i: number; d: string; dash: boolean }[] {
  if (!dom.value) return []
  const p = (i: number) => `${xOf(i)},${yOf(vals[i]!)}`
  const out: { i: number; d: string; dash: boolean }[] = []
  for (let i = 0; i < n.value; i++) {
    if (vals[i] == null) continue
    if (i + 1 < n.value && vals[i + 1] != null) out.push({ i, d: `M${p(i)} L${p(i + 1)}`, dash: !!dash && (dash(i) || dash(i + 1)) })
    else if (dot && (i === 0 || vals[i - 1] == null)) out.push({ i, d: `M${p(i)} L${p(i)}`, dash: !!dash && dash(i) })
  }
  return out
}
/** 带按连续段各一块、按段起点刻度作键:段的起止不变时 d 结构不变、能过渡;段数 / 段长变了就跳 */
const bandPaths = computed(() => {
  const { lo, hi } = props.data
  if (!dom.value) return []
  return runsOf(i => lo[i] != null && hi[i] != null).map(r => {
    const up = r.map(i => `${xOf(i)},${yOf(hi[i]!)}`)
    const dn = [...r].reverse().map(i => `${xOf(i)},${yOf(lo[i]!)}`)
    return { i: r[0], d: `M${[...up, ...dn].join(' L')} Z` }
  })
})
const medSegs = computed(() => lineSegs(props.data.med, false))
// 碰到压顶点的线段画虚线(画板 m-trail-over:dasharray 2 5)
const selSegs = computed(() => lineSegs(selDrawn.value, true, i => over(props.data.sel[i], i)))

// 线尾直标:按期望 y 排序后自上而下推开,间距不足 13 就往下挤。
// 期望 y:带取上沿 + 2,两条线取线尾 + 4(文字基线)—— 与画布三枚标签的位置逐一对得上。
const tails = computed(() => {
  const d = props.data
  if (!dom.value || lastIdx.value < 0) return []
  const last = (a: (number | null)[]) => {
    for (let i = lastIdx.value; i >= 0; i--) if (a[i] != null) return a[i]
    return null
  }
  const items: { key: string; text: string; y: number; fill: string | undefined; bold: boolean }[] = []
  const h = last(d.hi), m = last(d.med), s = last(selDrawn.value)
  if (h != null) items.push({ key: 'band', text: BAND_NAME, y: yOf(h) + 2, fill: undefined, bold: false })
  if (m != null) items.push({ key: 'med', text: PV.med, y: yOf(m) + 4, fill: PV_COLORS.AXIS_TEXT, bold: false })
  if (s != null && d.selName) items.push({ key: 'sel', text: d.selName, y: yOf(s) + 4, fill: PV_COLORS.FOCUS, bold: true })
  items.sort((a, b) => a.y - b.y)
  // ponytail: 只往下推。y 值域外扩 18% 给底下留出 28px,三枚标签最多往下挤 26 + 2,挤不出绘图区
  for (let k = 1; k < items.length; k++) items[k].y = Math.max(items[k].y, items[k - 1].y + GAP)
  const x0 = xOf(lastIdx.value) + 8
  // 整段都已过去时线尾贴右缘,标签右侧放不下就往左收,不让字切出画布
  return items.map(it => ({ ...it, x: Math.min(x0, width.value - tipWidth([it.text], 0)) }))
})

// ── 悬停 ──
const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  if (lastIdx.value < 0) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const i = Math.round(((e.clientX - r.left - PL) / iw.value) * Math.max(1, n.value - 1))
  hover.value = Math.max(0, Math.min(lastIdx.value, i))
}

interface TipLine { t: string; c: string; o?: number; b?: number }
const WHITE = 'var(--text-on-solid)'
const tip = computed(() => {
  const i = hover.value
  const d = props.data
  if (i == null || i > lastIdx.value) return null
  const label = d.labels[i]
  const unitDay = d.gran === 'month'
  const lines: TipLine[] = [{ t: unitDay ? `${label} 日` : label.replace('月', ' 月'), c: WHITE, b: 600 }]
  if (d.selName) {
    const v = d.sel[i]
    if (v != null) lines.push({ t: `${d.selName} ${v.toFixed(2)} kWh`, c: PV_COLORS.TIP_SEL })
    // 没抄,或抄了但发电不为正(两种都不出点,这里分不出);不用琥珀,橙只留给「高于平时 / 超限」
    else if (d.selState[i] === 'missing') lines.push({ t: `${d.selName} ${unitDay ? '这天' : '这个月'}没抄表或发电不为正`, c: WHITE, o: 0.72 })
    else lines.push({ t: `${d.selName} —`, c: WHITE, o: 0.62 })
  }
  const med = d.med[i], lo = d.lo[i], hi = d.hi[i]
  if (med != null) lines.push({ t: `${PV.med} ${med.toFixed(2)} kWh`, c: WHITE, o: 0.82 })
  else lines.push({ t: '在网不足 3 栋，全园线留空', c: WHITE, o: 0.82 })
  if (lo != null && hi != null) lines.push({ t: `中间一半 ${lo.toFixed(2)} – ${hi.toFixed(2)} kWh`, c: WHITE, o: 0.62 })
  const x = xOf(i)
  const w = tipWidth(lines.map(l => l.t), 22)
  const sv = selDrawn.value[i]
  return {
    x, lines,
    left: tipX(x, w, { width: width.value, padL: 0, padR: 0 }),
    dotY: sv != null && dom.value ? yOf(sv) : null,
  }
})
</script>

<template>
  <div class="pyb">
    <div ref="el" class="pyb-plot" :style="{ height: H + 'px' }">
      <svg :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`" class="pyb-svg" role="img" :aria-label="PV.card.trail">
        <template v-for="g in grid" :key="'g' + g.y">
          <line class="pyb-gl" :x1="PL" :x2="PL + iw" :y1="g.y" :y2="g.y" />
          <text class="pyb-ax" :x="PL - 6" :y="g.y + 4" text-anchor="end">{{ g.label }}</text>
        </template>
        <rect v-if="shade" class="pyb-future" :x="shade.x" :y="PT" :width="shade.w" :height="IH" :fill="PV_COLORS.FUTURE" />
        <!-- 尺子先在,数据擦上去:轴线与 x 刻度挪到数据组之前 -->
        <line class="pyb-axl" :x1="PL" :x2="PL + iw" :y1="PT + IH" :y2="PT + IH" />
        <text v-for="t in xLabels" :key="'x' + t.x" class="pyb-ax" :x="t.x" :y="H - 6" text-anchor="middle">{{ t.text }}</text>
        <!-- 悬停层(竖线 / 高亮点)在组外,0ms;线尾字瞬到 -->
        <!-- 组按粒度作键:刻度下标跨粒度不是同一类目,按月 ↔ 按年整组换新元素瞬到 -->
        <g :key="data.gran" :class="['pyb-data', 'ana-morph', { first, hold }]" @animationend.self="first = false" @animationcancel.self="first = false">
          <path v-for="b in bandPaths" :key="'b' + b.i" class="pyb-band" :d="b.d" :fill="PV_COLORS.BAND" fill-opacity=".45" />
          <path v-for="s in medSegs" :key="'m' + s.i" class="pyb-med" :data-i="s.i" :d="s.d" fill="none" :stroke="PV_COLORS.REF" stroke-width="2"
            stroke-linecap="round" />
          <path v-for="s in selSegs" :key="'s' + s.i" class="pyb-sel" :data-i="s.i" :d="s.d" fill="none" :stroke="PV_COLORS.FOCUS" stroke-width="2.5"
            stroke-linecap="round" :stroke-dasharray="s.dash ? '2 5' : undefined" />
          <text v-for="t in tails" :key="t.key" :class="['pyb-tail', 'pyb-tail-' + t.key]" :x="t.x" :y="t.y"
            :fill="t.fill" :font-weight="t.bold ? 600 : 400">{{ t.text }}</text>
        </g>
        <template v-if="tip">
          <line class="pyb-hair" :x1="tip.x" :x2="tip.x" :y1="PT" :y2="PT + IH" :stroke="PV_COLORS.TIP_HAIR" stroke-width="1" />
          <circle v-if="tip.dotY != null" class="pyb-dot" :cx="tip.x" :cy="tip.dotY" r="3.5" :fill="PV_COLORS.FOCUS" />
        </template>
      </svg>
      <div class="pyb-hit" @mousemove="onMove" @mouseleave="hover = null" />
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: tip.left + 'px', top: '8px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ color: l.c, opacity: l.o, fontWeight: l.b }">{{ l.t }}</span>
      </div>
    </div>
    <!-- 参照(分母那句、超 24 压顶那句)由屏接着写在卡里,走句型库 PV 段 -->
  </div>
</template>

<style scoped>
.pyb-plot { position: relative; width: 100%; }
.pyb-svg { display: block; }
/* 首挂:数据组自左擦出一次;fp-wipe 在 ana.css,不能写进 scoped(名字会被加 hash) */
.pyb-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
.pyb-hit { position: absolute; inset: 0; }
.pyb-gl { stroke: var(--ink-100); stroke-width: 1; }
.pyb-axl { stroke: var(--ink-300); stroke-opacity: .75; stroke-width: 1; }
.pyb-ax { font-size: var(--fs-micro); font-family: var(--font-mono); fill: var(--text-muted); font-variant-numeric: tabular-nums; }
.pyb-tail { font-size: var(--fs-label); font-family: var(--font-sans); }
.pyb-tail-band { fill: var(--ink-500); }
.pyb-dot { stroke: var(--surface-page); stroke-width: 2; }
.pv-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
</style>
