<script setup lang="ts">
/**
 * PvSeasonRows —— 高级分析档 L3「各栋残差的年内走势」。小倍数折线(Trellis sparkline rows)。
 *
 * **为什么不是散点。** 上一版把 13 栋 × 365 天 ≈ 4745 个残差点汇在一张年积日散点里。
 * 那不是「点云糊」的观感问题,是**按构造答不了**:medianPolish 的 sweepCol 收敛后,
 * 每一天的跨栋残差中位数 ≡ 0(到 TOL),13 栋汇成一朵云,中心永远贴着零线 ——
 * 季节抛没抛干净都长同一个样。抛光之后剩得下的年周期只可能是**某一栋自己的**
 * (西侧被邻栋冬季遮挡、组件夏季高温衰减),而且各栋相位不同还会互相抵消。
 * 所以分析单元必须是**栋**,一栋一行。
 *
 * **排序是这张图的杠杆。** 按年内极差降序 → 13 行的扫描退化成**看第一行**:
 * 第一行平,全园就平,问题当场答完。
 *
 * **用内联 SVG 不用 ECharts。** 13 个共轴小图在 ECharts 里要 13 个 grid,
 * 而 boxplot / custom 在本仓的 echartsBundle 里没注册。本仓已有先例:
 * PvQualityGrid(CSS Grid)、PvDots / PvSlope / PvDayChart(inline SVG)。
 *
 * 配色(§06.7):群体一律墨阶,13 栋没有任何一栋拥有自己的颜色;焦点蓝只编码
 * 「队列里选中那一栋」这一个状态。**强调橙 #9D5D17 与暖黄一次都不出现**。
 * 状态不只靠颜色 —— 选中那行同时加粗、栋名加重,黑白打印与色觉障碍下照样读得出。
 * 栋名列 96px:与队列 / PvSlope / PvDots / 抽屉表同宽同左缘(§06.7 的隐形基线)。
 */
import { computed } from 'vue'
import { useWidth } from '@/components/ana/useWidth'

const props = defineProps<{
  rows: { id: number; name: string; months: (number | null)[]; amp: number | null }[]
  /** 常态带:全部进图月中位数的中间一半。null = 进图的栋太少,不画 */
  band: { lo: number; hi: number } | null
  /** 共用纵轴的半幅(对数) */
  half: number
  /** 数据未录满的那个月 0–11。该月的点画空心圈 —— 形状通道,不靠颜色也不靠一句话 */
  partialMo: number | null
  /** 月档当段 0–11;年档 null */
  segMo: number | null
  selId: number | null
}>()
const emit = defineEmits<{ (e: 'pick', id: number): void }>()

const { el, width } = useWidth(420)

const ML = 96          // 栋名列 —— §06.7 的隐形基线
const MR = 56          // 行末年内极差
const MT = 8
const RH = 18
const AXH = 22
const MB = 4

const vw = computed(() => Math.max(300, Math.round(width.value)))
const vh = computed(() => MT + props.rows.length * RH + AXH + MB)
const iw = computed(() => vw.value - ML - MR)
const axY = computed(() => MT + props.rows.length * RH + 4)

const X = (m: number) => ML + ((m + 0.5) / 12) * iw.value
const top = (i: number) => MT + i * RH
const HH = RH / 2 - 3          // 行内半高 6px
/** 共用同一把 half,13 行的形状才可比 —— 各行自适应等于每行换一把尺。
 *  half 取 90 分位(见 logic),所以**会有点超出轴** —— 一律夹到行边,由 clip 标出来。 */
const Y = (v: number, i: number) =>
  top(i) + RH / 2 - Math.max(-1, Math.min(1, v / props.half)) * HH
/** 超出共用轴的点。**不静默钉在边上** —— 画成尖角,title 里给真值。 */
const isClip = (v: number) => Math.abs(v) > props.half

/** null 处 M 重起:线在那里**断开,不插值**(与 L6「看见的空就是真的空」同一条规矩) */
function pathOf(months: (number | null)[], i: number): string {
  let d = '', pen = false
  months.forEach((v, m) => {
    if (v == null) { pen = false; return }
    d += `${pen ? 'L' : 'M'}${X(m).toFixed(1)} ${Y(v, i).toFixed(1)} `
    pen = true
  })
  return d.trim()
}

const drawnRows = computed(() => props.rows.filter(r => r.amp != null))
/** 尖角:超轴的点用三角代替圆,朝向就是它跑出去的那一边 */
const caret = (v: number, m: number, i: number) => {
  const x = X(m), y = Y(v, i), d = v > 0 ? -1 : 1
  return `M${(x - 3).toFixed(1)} ${(y - d * 3).toFixed(1)} L${(x + 3).toFixed(1)} ${(y - d * 3).toFixed(1)} L${x.toFixed(1)} ${(y + d * 1).toFixed(1)} Z`
}
/** 极差是不是几乎全来自那一两个超轴的月 —— 是的话不许把它叫「年周期」 */
const spikeOf = (r: { months: (number | null)[] }) => {
  const out: number[] = []
  r.months.forEach((v, m) => { if (v != null && isClip(v)) out.push(m + 1) })
  return out
}
const skipN = computed(() => props.rows.length - drawnRows.value.length)
/** 第一条「量不出」的行 —— 它的上缘画一条 hairline,把两批隔开 */
const sepAt = computed(() => props.rows.findIndex(r => r.amp == null))

const MON = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
/** 只标 1/4/7/10 四个月;当段不在这四个里就额外印一个并加重 */
const ticks = computed(() => {
  const base = [0, 3, 6, 9]
  const ms = props.segMo != null && !base.includes(props.segMo) ? [...base, props.segMo] : base
  return ms.sort((a, b) => a - b).map(m => ({ m, x: X(m), on: m === props.segMo }))
})

const extreme = (r: { months: (number | null)[] }, hi: boolean) => {
  let best = -1
  r.months.forEach((v, m) => {
    if (v == null) return
    const cur = r.months[best] as number | undefined
    if (best < 0 || (hi ? v > cur! : v < cur!)) best = m
  })
  return best < 0 ? '—' : MON[best]
}
const titleOf = (r: { name: string; months: (number | null)[]; amp: number | null }) => {
  if (r.amp == null) return `${r.name} 有效月 ${r.months.filter(v => v != null).length} 个，量不出年内极差`
  const sp = spikeOf(r)
  return `${r.name} 年内极差 ${r.amp.toFixed(3)}（对数），最高 ${extreme(r, true)} 月，最低 ${extreme(r, false)} 月`
    + (sp.length ? `；${sp.join('、')} 月超出共用轴（画成尖角），真值 ${sp.map(m => r.months[m - 1]!.toFixed(3)).join('、')}` : '')
}

// 读屏拿不到颜色也拿不到位置,这段就是这张图的全部内容
const aria = computed(() =>
  `各栋残差年内走势小倍数图，共 ${props.rows.length} 栋，纵轴共用 ±${props.half.toFixed(3)}（对数）。`
  + `按年内极差降序：`
  + drawnRows.value.map(r => `${r.name} ${r.amp!.toFixed(3)}，最高 ${extreme(r, true)} 月，最低 ${extreme(r, false)} 月`).join('；')
  + '。'
  + (props.band ? `常态带 ${props.band.lo.toFixed(3)} 至 ${props.band.hi.toFixed(3)}。` : '进图的栋太少，画不出常态带。')
  + (skipN.value ? `${skipN.value} 栋有效月不足 8 个，不画线。` : '')
  + (clipN.value ? `另有 ${clipN.value} 个月的值超出共用轴，画成尖角，真值在各行的悬停里。` : ''))

/** 超轴的点共几个 —— 图注要报出来,不许静默夹边 */
const clipN = computed(() =>
  drawnRows.value.reduce((a, r) => a + spikeOf(r).length, 0))

/** 13 行不挂 13 个监听:事件委托,命中区上带 data-id */
function onClick(e: MouseEvent) {
  const id = (e.target as HTMLElement | null)?.dataset?.id
  if (id) emit('pick', Number(id))
}
</script>

<template>
  <div ref="el" class="pv-season">
    <svg :viewBox="`0 0 ${vw} ${vh}`" :width="vw" :height="vh" role="img" :aria-label="aria" @click="onClick">
      <g v-for="(r, i) in rows" :key="r.id" class="row" :class="{ sel: r.id === selId }">
        <title>{{ titleOf(r) }}</title>
        <rect class="hit" :x="0" :y="top(i)" :width="vw" :height="RH" :data-id="r.id" />
        <!-- 常态带:恒宽、每行重复。sweepCol 已把逐月中心钉在 0,逐月带只会画出一条平带 -->
        <rect v-if="band" class="band" :x="ML" :y="Y(band.hi, i)" :width="iw"
          :height="Math.max(1, Y(band.lo, i) - Y(band.hi, i))" />
        <line class="zero" :x1="ML" :x2="vw - MR" :y1="Y(0, i)" :y2="Y(0, i)" />
        <path v-if="r.amp != null" class="ln" :d="pathOf(r.months, i)" />
        <template v-if="r.amp != null">
          <template v-for="(v, m) in r.months" :key="m">
            <path v-if="v != null && isClip(v)" class="pt cl" :d="caret(v, m, i)" />
            <circle v-else-if="v != null" class="pt" :class="{ hollow: m === partialMo }"
              :cx="X(m)" :cy="Y(v, i)" :r="1.6" />
          </template>
        </template>
        <text class="nm" :x="ML - 8" :y="top(i) + RH / 2 + 3.5">{{ r.name }}</text>
        <text class="vl" :x="vw - MR + 6" :y="top(i) + RH / 2 + 3.5">
          {{ r.amp == null ? '—' : r.amp.toFixed(3) }}
        </text>
      </g>

      <!-- 「量不出」的那批与画了线的隔开:少画一条线不许静默,行还在、名还在、可点 -->
      <line v-if="sepAt >= 0 && sepAt < rows.length" class="sep"
        :x1="0" :x2="vw" :y1="top(sepAt)" :y2="top(sepAt)" />
      <!-- 一条竖线换掉旧版「当段点加重」那一整层散点(那层在 4745 点里实际不可见) -->
      <line v-if="segMo != null" class="seg" :x1="X(segMo)" :x2="X(segMo)"
        :y1="MT" :y2="MT + rows.length * RH" />

      <line class="ax" :x1="ML" :x2="vw - MR" :y1="axY" :y2="axY" />
      <text v-for="t in ticks" :key="t.m" class="xt" :class="{ on: t.on }" :x="t.x" :y="axY + 13">
        {{ MON[t.m] }}月
      </text>
    </svg>
  </div>
</template>

<style scoped>
.pv-season { width: 100%; }
.pv-season svg { display: block; width: 100%; height: auto; }

.band { fill: var(--ink-050); }
.zero { stroke: var(--ink-100); }
.ln { fill: none; stroke: var(--ink-700); stroke-width: 1.25; stroke-linejoin: round; }
.pt { fill: var(--ink-700); }
/* 超出共用轴:尖角朝它跑出去的那一边。形状通道 —— 黑白打印下也认得出「这个点在图外」 */
.pt.cl { fill: var(--ink-900); }
/* 月中未录全那个月:空心圈。形状通道 —— 不靠颜色,也不用再写一句话 */
.pt.hollow { fill: none; stroke: var(--ink-700); stroke-width: 1; }
.sep { stroke: var(--ink-100); }
.seg { stroke: var(--ink-500); stroke-width: 1.4; stroke-dasharray: 3 3; }
.ax { stroke: var(--ink-100); }

/* 选中态四通道:颜色 + 线宽 + 字重 + 行末的数。黑白打印下照样读得出。 */
.row.sel .ln { stroke: var(--hue-blue); stroke-width: 1.75; }
.row.sel .pt { fill: var(--hue-blue); }
.row.sel .pt.hollow { fill: none; stroke: var(--hue-blue); }
.row.sel .nm { fill: var(--text-primary); font-weight: 600; }
.row.sel .vl { fill: var(--text-primary); }

.nm { font-size: var(--fs-label); fill: var(--text-secondary); text-anchor: end; }
.vl {
  font-size: var(--fs-micro); fill: var(--text-secondary); text-anchor: start;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
}
.xt {
  font-size: var(--fs-micro); fill: var(--text-muted); text-anchor: middle;
  font-family: var(--font-mono);
}
.xt.on { fill: var(--text-primary); font-weight: 600; }

.hit { fill: transparent; }
.row { cursor: pointer; }
.row:hover .hit { fill: var(--bg-hover); }
.row:hover .nm { fill: var(--text-primary); }
</style>
