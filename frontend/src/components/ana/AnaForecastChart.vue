<script setup lang="ts">
// 自绘 SVG 折线图 —— 用户 2026-09-12:「echart画不出来这个可视化就不要用echart的,改为自己设计
// linechart」。视觉取自他指定的 Figma 稿(Animated Line Charts,节点 2310:2628)。
// 这个组件只负责画与交互:所有坐标由 forecastChart.logic.ts 的纯函数算好,便于逐条断言。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { forecastChartGeo, type ChartBox, type RollingRow } from '@/views/analysis/forecastChart.logic'

const props = withDefaults(defineProps<{
  rows: RollingRow[] | null
  height?: number
  /** 上一年接没接上:none 没有上一年数据 / mismatch 附表口径不同没接 / spliced 已接。 */
  prevState?: 'none' | 'mismatch' | 'spliced'
}>(), { height: 280, prevState: 'none' })

// 用实测宽度当 viewBox 宽度,1 个 SVG 单位 = 1 个 CSS 像素。
// 改前 viewBox 写死 900 配 height:auto —— 卡片一宽,整幅按比例放大,280 的图在 1900px 宽的卡上
// 涨到 590 高,字号跟着一起放大(用户 2026-09-12:「整个图缩放不对」)。
const host = ref<HTMLElement | null>(null)
const w = ref(900)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!host.value) return
  ro = new ResizeObserver((es) => { const cw = es[0]?.contentRect.width; if (cw && cw > 40) w.value = Math.round(cw) })
  ro.observe(host.value)
  w.value = Math.round(host.value.clientWidth) || 900
})
onBeforeUnmount(() => ro?.disconnect())

const box = computed<ChartBox>(() => ({
  width: w.value, height: props.height, padL: 52, padR: 62, padT: 18, padB: 26,
}))
const geo = computed(() => forecastChartGeo(props.rows, box.value))
const fRow = computed(() => props.rows?.find((r) => r.isForecast && r.mid != null) ?? null)
// 前几个月没带时,把**原因**写在图上。三种原因不一样,不能都写「样本不足」糊过去。
const gapNote = computed(() => {
  const first = geo.value?.firstBandMonth
  if (!first || first <= 1) return ''
  const head = `1–${first - 1}月无带：`
  if (props.prevState === 'mismatch') return head + '上一年附表口径与本年不同，未接入'
  if (props.prevState === 'spliced') return head + '上一年可用月也不足 3 个'
  return head + '没有上一年数据可接，身前不足 3 个月'
})
const fint = (v: number) => Math.round(v).toLocaleString('zh-CN')

// x 轴标签按可用宽度抽稀,月份多、卡片窄时不挤成一团
const xShown = computed(() => {
  const t = geo.value?.xTicks ?? []
  if (!t.length) return t
  const per = (box.value.width - box.value.padL - box.value.padR) / t.length
  const step = per < 28 ? 3 : per < 46 ? 2 : 1
  return t.filter((_, i) => i % step === 0 || i === t.length - 1)
})

/* ── 悬停 ──────────────────────────────────────────────────────────
   命中判据:鼠标 x 离哪个月的刻度最近就选哪个月。不做「必须落在点上」——
   折线图上要求对准 3.5px 的圆点,等于没有 tooltip。 */
const hoverIdx = ref<number | null>(null)
const hoverRow = computed(() => (hoverIdx.value == null ? null : props.rows?.[hoverIdx.value] ?? null))
const hoverTick = computed(() => (hoverIdx.value == null ? null : geo.value?.xTicks[hoverIdx.value] ?? null))
function onMove(e: MouseEvent) {
  const g = geo.value
  if (!g || !host.value) return
  const rect = host.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  let best = 0, bd = Infinity
  g.xTicks.forEach((t, i) => { const d = Math.abs(t.x - x); if (d < bd) { bd = d; best = i } })
  hoverIdx.value = best
}
const tipLines = computed(() => {
  const r = hoverRow.value
  if (!r) return []
  const out: string[] = [`${r.month}月`]
  if (r.actual != null) out.push(`已录入 ${fint(r.actual)}万`)
  if (r.lo != null && r.hi != null) {
    out.push(r.isForecast ? `预测 ${fint(r.mid as number)}万` : `当时预测 ${fint(r.mid as number)}万`)
    out.push(`区间 ${fint(r.lo)}~${fint(r.hi)}`)
  } else if (!r.isForecast) {
    out.push('身前不足 3 个月，算不出带')
  }
  return out
})
// 气泡宽度按最长那行算,不写死 —— 写死 132 时「身前不足 3 个月,算不出带」那行会被切掉。
// 中日韩字按 12px 估宽,其余按 6.6px(11~12px 字号下够用,宁可略宽也不切字)。
const CJK = /[　-鿿＀-￯]/
const tipW = computed(() => {
  let w = 0
  for (const l of tipLines.value) {
    let px = 0
    for (const ch of l) px += CJK.test(ch) ? 12 : 6.6
    w = Math.max(w, px)
  }
  return Math.ceil(w) + 20
})
const tipX = computed(() => {
  const t = hoverTick.value
  if (!t) return 0
  const right = box.value.width - box.value.padR
  // 右侧放不下就翻到竖线左边,不让气泡掉出绘图区
  const wantRight = t.x + 12
  return wantRight + tipW.value <= right ? wantRight : Math.max(box.value.padL, t.x - 12 - tipW.value)
})
const tipH = computed(() => 12 + tipLines.value.length * 16)
</script>

<template>
  <div ref="host" class="afc-host" @mousemove="onMove" @mouseleave="hoverIdx = null">
    <svg v-if="geo" class="afc" :width="box.width" :height="box.height" :viewBox="`0 0 ${box.width} ${box.height}`" role="img">
      <!-- 只有横向网格线,没有纵向(照稿) -->
      <line v-for="t in geo.yTicks" :key="'g' + t.v" :x1="box.padL" :x2="box.width - box.padR" :y1="t.y" :y2="t.y" class="afc-grid" />
      <text v-for="t in geo.yTicks" :key="'y' + t.v" :x="box.padL - 10" :y="t.y + 4" class="afc-ylab">{{ t.label }}</text>

      <!-- 逐月预测带:每个月的上下沿来自它自己那一次拟合(见 rollingForecastRows 头注) -->
      <path v-for="(d, i) in geo.bandPaths" :key="'b' + i" :d="d" class="afc-band" />
      <path v-if="geo.midPath" :d="geo.midPath" class="afc-mid" />

      <!-- 前几个月没有带,是算不出来,不是漏画了 —— 在图上说清楚,别让人以为是 bug -->
      <text v-if="gapNote" :x="box.padL + 4" :y="box.height - box.padB - 6" class="afc-note">{{ gapNote }}</text>

      <!-- 已录入:实线 + 点(2026-09-12 按用户要求去掉线下渐变) -->
      <path v-if="geo.linePath" :d="geo.linePath" class="afc-line" />
      <circle v-for="d in geo.dots" :key="'d' + d.month" :cx="d.x" :cy="d.y" r="3.5" class="afc-dot" />

      <!-- 「今天」分界:左边是录入的,右边是预测的 -->
      <template v-if="geo.todayX != null">
        <line :x1="geo.todayX" :x2="geo.todayX" :y1="box.padT" :y2="box.height - box.padB" class="afc-today" />
        <text :x="geo.todayX + 5" :y="box.padT + 10" class="afc-todaylab">今天</text>
      </template>

      <!-- 预测月:上下沿短横 + 竖线 + 空心中位点 + 右侧三个数 -->
      <template v-if="geo.forecast && fRow">
        <line :x1="geo.forecast.x" :x2="geo.forecast.x" :y1="geo.forecast.yHi" :y2="geo.forecast.yLo" class="afc-fbar" />
        <line :x1="geo.forecast.x - 5" :x2="geo.forecast.x + 5" :y1="geo.forecast.yHi" :y2="geo.forecast.yHi" class="afc-fcap" />
        <line :x1="geo.forecast.x - 5" :x2="geo.forecast.x + 5" :y1="geo.forecast.yLo" :y2="geo.forecast.yLo" class="afc-fcap" />
        <circle :cx="geo.forecast.x" :cy="geo.forecast.yMid" r="4.5" class="afc-fdot" />
        <text :x="geo.forecast.x + 9" :y="geo.forecast.yHi + 4" class="afc-fnum">{{ fint(fRow.hi as number) }}</text>
        <text :x="geo.forecast.x + 9" :y="geo.forecast.yMid + 4" class="afc-fnum afc-fnum-mid">{{ fint(fRow.mid as number) }}</text>
        <text :x="geo.forecast.x + 9" :y="geo.forecast.yLo + 4" class="afc-fnum">{{ fint(fRow.lo as number) }}</text>
      </template>

      <text v-for="t in xShown" :key="'x' + t.month" :x="t.x" :y="box.height - box.padB + 17" class="afc-xlab">{{ t.label }}</text>

      <!-- 悬停:竖发丝 + 深色气泡(照稿的 tooltip pill) -->
      <template v-if="hoverTick && tipLines.length">
        <line :x1="hoverTick.x" :x2="hoverTick.x" :y1="box.padT" :y2="box.height - box.padB" class="afc-hair" />
        <circle v-if="hoverRow?.actual != null" :cx="hoverTick.x"
          :cy="geo.dots.find((d) => d.month === hoverRow!.month)?.y ?? 0" r="5" class="afc-hdot" />
        <g :transform="`translate(${tipX}, ${box.padT + 4})`">
          <rect :width="tipW" :height="tipH" rx="8" class="afc-tip" />
          <text v-for="(l, i) in tipLines" :key="i" x="10" :y="20 + i * 16"
            :class="['afc-tiptext', i === 0 ? 'afc-tiptitle' : '']">{{ l }}</text>
        </g>
      </template>
    </svg>
  </div>
</template>

<style scoped>
/* 取色自 Figma 稿(节点 2310:2628):主线 #4F46E5 / 浅带 #C7D2FE / 网格 #E5EAF0 / 轴标签 #94A3B8 / 气泡 #1E293B */
.afc-host { width: 100%; }
.afc { display: block; }
.afc-grid { stroke: #E5EAF0; stroke-width: 1; }
.afc-ylab { fill: #94A3B8; font-size: 11px; text-anchor: end; font-variant-numeric: tabular-nums; }
.afc-xlab { fill: #94A3B8; font-size: 11px; text-anchor: middle; }
.afc-note { fill: #B6BDC8; font-size: 10px; }
.afc-band { fill: #C7D2FE; fill-opacity: 0.45; }
.afc-mid { fill: none; stroke: #A5B4FC; stroke-width: 1.2; stroke-dasharray: 4 4; }
.afc-line { fill: none; stroke: #4F46E5; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.afc-dot { fill: #fff; stroke: #4F46E5; stroke-width: 2; }
.afc-today { stroke: #CBD5E1; stroke-width: 1; stroke-dasharray: 3 3; }
.afc-todaylab { fill: #94A3B8; font-size: 10px; }
.afc-fbar, .afc-fcap { stroke: #4F46E5; stroke-width: 1.5; stroke-opacity: 0.55; }
.afc-fdot { fill: #fff; stroke: #4F46E5; stroke-width: 2.5; }
.afc-fnum { fill: #94A3B8; font-size: 11px; font-variant-numeric: tabular-nums; }
.afc-fnum-mid { fill: #1E293B; font-weight: 600; }
.afc-hair { stroke: #C7D2FE; stroke-width: 1; }
.afc-hdot { fill: #4F46E5; stroke: #fff; stroke-width: 2; }
.afc-tip { fill: #1E293B; }
.afc-tiptext { fill: #E2E8F0; font-size: 11px; font-variant-numeric: tabular-nums; }
.afc-tiptitle { fill: #fff; font-weight: 600; font-size: 12px; }
</style>
