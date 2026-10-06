<script setup lang="ts">
// 「各栋每千瓦日均发电」新卡的图(2026-10-06 改稿,画板 pv-v2 第一排右边那张 s4)。
// 笔法照 PvRevenueBars:一栋一行,期别点 + 楼名 + 条(期别色)+ 条尾值,右边几列是比较(按月比上月、比去年同月;按年在网、比去年)。
// 几何照画板 build.mjs perKwCard 抄:行高 20、上 18、楼名列 64、列距 8,条区右缘 = 卡宽 − 列宽 − 40;
// 横轴 0 起、每 2 一格,量程 = 没超 24 kWh 的栋里最大的 × 1.5;超过 24 kWh 的条画满条区 + 两道斜线截断,值写琥珀。
// 按年在条上画合格线(每千瓦每天 = 一年合格线 ÷ 当年天数),虚线压在条上面、底下衬一道底色,深蓝条上也看得见;
// 线名写在列头那一行,居中压在线上(另起一行参照会让按年第一排比按月高,段控切期间会跳)。
// 数据整形(排序、列里的字、「—」)全在 pvAnaV4.logic perKwCard,这里只做像素几何。
// 悬停出提示框、点一行换选中(稿上没画;照同屏「每千瓦日均和合格线的差」那张的做法,同一屏的条都能点);选中栋楼名加粗。
// 刻度步长按像素挑:卡窄(1281–1439 宽时条区只有 30–80px)时相邻刻度字至少隔 20px,不叠成一串。
import { computed, ref } from 'vue'
import { tipWidth } from '@/components/ana/chartTip'
import { useWidth } from '@/components/ana/useWidth'
import { PV } from '@/components/ana/anaSentence'
import { PHASE_COLORS, PV_COLORS as C } from './pvAnaColors'
import { phaseName, type PerKwCard, type PerKwRow } from './pvAnaV4.logic'

const props = defineProps<{ data: PerKwCard; selId: number | null }>()
const emit = defineEmits<{ pick: [id: number] }>()

const ROW = 20, TOP = 18, PL = 64, GAPC = 8
/** 1440 下卡内宽 293(画板);jsdom 量不到宽时用它 */
const { el, width: W } = useWidth(293)
// ponytail: 11px 字估宽(数字等宽 6.7、汉字和全角标点 11),够判列宽和叠不叠
const monoW = (s: string) => [...s].reduce((w, ch) => w + (/[一-鿿＀-￯　-〿]/.test(ch) ? 11 : 6.7), 0)

const n = computed(() => props.data.rows.length)
const HH = computed(() => TOP + n.value * ROW + 20)
const bottom = computed(() => TOP + n.value * ROW)
const cw = computed(() => props.data.heads.map((h, k) =>
  Math.ceil(Math.max(monoW(h), ...props.data.rows.map(r => monoW(r.cols[k] ?? ''))))))
/** 每一列右对齐的 x(从卡右缘往左排) */
const ends = computed(() => {
  const out: number[] = []
  let e = W.value
  for (let k = cw.value.length - 1; k >= 0; k--) { out[k] = e; e -= cw.value[k] + GAPC }
  return out
})
const colsW = computed(() => cw.value.reduce((a, b) => a + b, 0) + GAPC * Math.max(0, cw.value.length - 1))
// 不低于 PL:换视口那一拍卡宽可能量到 160 上下,条区算成负数时 <rect width> 会是负值(浏览器报错)
const BR = computed(() => Math.max(PL, W.value - colsW.value - 40))
const dom = computed(() => {
  const normal = props.data.rows.flatMap(r => (r.perDay != null && r.perDay <= PV.limitDay ? [r.perDay] : []))
  return normal.length ? Math.max(2, Math.ceil(Math.max(...normal) * 1.5)) : 6
})
const s = computed(() => (BR.value - PL) / dom.value)
/** 刻度步长:每 2 一格起,相邻两格不到 20px 就放大(2 → 5 → 10 …) */
const step = computed(() => [2, 5, 10, 20, 50, 100].find(k => k * s.value >= 20) ?? 100)
const grid = computed(() => {
  const out: { v: number; x: number }[] = []
  for (let v = 0; v <= dom.value; v += step.value) out.push({ v, x: +(PL + v * s.value).toFixed(1) })
  return out
})

const bars = computed(() => props.data.rows.map((r, i) => {
  const y = TOP + i * ROW
  const fill = PHASE_COLORS[r.phase] ?? C.REF
  if (r.perDay == null) return { r, y, fill, w: 0, over: false, val: null as string | null, vx: 0 }
  const over = r.perDay > PV.limitDay
  const w = over ? BR.value - PL : r.perDay * s.value
  return { r, y, fill, w: +w.toFixed(1), over, val: r.perDay.toFixed(1), vx: +(PL + w + 6).toFixed(1) }
}))

const anchorX = computed(() => (props.data.anchorDay == null ? null : +(PL + props.data.anchorDay * s.value).toFixed(1)))

/** 斜线样例用超限那几栋的期别色(都同一期时),否则焦点蓝 */
const overRows = computed(() => props.data.rows.filter(r => r.perDay != null && r.perDay > PV.limitDay))
const swFill = computed(() => {
  const o = overRows.value
  return o.length && o.every(r => r.phase === o[0].phase) ? PHASE_COLORS[o[0].phase] ?? C.FOCUS : C.FOCUS
})
// ── 悬停:整行命中,气泡写这栋的数和右边几列 ──
const hover = ref<number | null>(null)
function tipLines(r: PerKwRow): string[] {
  return [
    `${r.name} · ${phaseName(r.phase)}`,
    r.perDay == null ? (r.born ? '这一段没有读数' : PV.notYet) : `每千瓦日均 ${r.perDay.toFixed(2)} kWh · ${r.days} 天`,
    ...(r.perDay == null ? [] : props.data.heads.flatMap((h, k) => (r.cols[k] && h !== PV.online ? [`${h} ${r.cols[k]}`] : []))),
  ]
}
const tip = computed(() => {
  const i = hover.value
  const b = i == null ? null : bars.value[i]
  if (!b) return null
  const lines = tipLines(b.r)
  const tw = tipWidth(lines, 22)
  return {
    lines,
    left: Math.max(0, Math.min(PL + b.w - 40, W.value - tw)),
    // 上半的行气泡放行下,下半的放行上
    top: i! < bars.value.length / 2 ? b.y + ROW + 2 : Math.max(0, b.y - 18 * lines.length - 14),
  }
})
const PHASES = [1, 2, 3] as const
const PHASE_NAME = ['', '一期', '二期', '三期']
</script>

<template>
  <div class="ppk">
    <div ref="el" class="ppk-plot" :style="{ height: HH + 'px' }" @mouseleave="hover = null">
      <svg :width="W" :height="HH" :viewBox="`0 0 ${W} ${HH}`" class="ppk-svg" role="img" :aria-label="PV.card.perKw">
        <template v-for="g in grid" :key="'g' + g.v">
          <line class="ppk-gl" :x1="g.x" :x2="g.x" :y1="TOP" :y2="bottom" />
          <text class="ppk-ax" :x="g.x" :y="HH - 6" text-anchor="middle">{{ g.v }}</text>
        </template>
        <text v-for="(h, k) in data.heads" :key="'h' + k" class="ppk-ax" :x="ends[k]" y="11" text-anchor="end">{{ h }}</text>
        <g v-for="b in bars" :key="b.r.id" class="ppk-row" :data-id="b.r.id">
          <template v-if="b.val == null">
            <text class="ppk-name" x="14" :y="b.y + 14">{{ b.r.name }}</text>
            <text class="ppk-ax" :x="PL" :y="b.y + 14">{{ b.r.born ? PV.dash : PV.notYet }}</text>
          </template>
          <template v-else>
            <circle class="ppk-dot" cx="6" :cy="b.y + ROW / 2" r="3.5" :fill="b.fill" />
            <text :class="['ppk-name', { 'ppk-name-sel': b.r.id === selId }]" x="14" :y="b.y + 14">{{ b.r.name }}</text>
            <rect class="ppk-bar" :x="PL" :y="b.y + 4" :width="b.w" height="12" rx="3" :fill="b.fill" />
            <path v-for="dx in (b.over ? [-16, -11] : [])" :key="dx" class="ppk-cut" :d="`M${BR + dx} ${b.y + 17} L${BR + dx + 5} ${b.y + 3}`" />
            <text class="ppk-val" :x="b.vx" :y="b.y + 14" :style="b.over ? { fill: C.AMBER_TEXT } : undefined">{{ b.val }}</text>
            <template v-for="(t, k) in b.r.cols" :key="'c' + k">
              <text v-if="t" class="ppk-ax" :x="ends[k]" :y="b.y + 14" text-anchor="end">{{ t }}</text>
            </template>
          </template>
        </g>
        <template v-if="anchorX != null">
          <line class="ppk-anchor-bg" :x1="anchorX" :x2="anchorX" :y1="TOP - 2" :y2="bottom" />
          <line class="ppk-anchor" :x1="anchorX" :x2="anchorX" :y1="TOP - 2" :y2="bottom" :stroke="C.REF" />
          <text class="ppk-ax" :x="anchorX" y="11" text-anchor="middle">{{ data.anchorLabel }}</text>
        </template>
        <line class="ppk-axl" :x1="PL" :x2="BR" :y1="bottom" :y2="bottom" />
      </svg>
      <div v-for="(b, i) in bars" :key="'r' + b.r.id" class="ppk-hit" :data-id="b.r.id"
        :style="{ top: b.y + 'px', height: ROW + 'px', background: hover === i ? 'var(--ink-050)' : 'transparent' }"
        @mouseenter="hover = i" @click="emit('pick', b.r.id)" />
      <div v-if="tip" class="cz-tip ppk-tip" :style="{ left: tip.left + 'px', top: tip.top + 'px' }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ fontWeight: k ? 400 : 600, opacity: k > 1 ? 0.82 : undefined }">{{ l }}</span>
      </div>
    </div>
    <div class="ppk-leg">
      <span v-for="p in PHASES" :key="p"><i class="ppk-ldot" :style="{ background: PHASE_COLORS[p] }" />{{ PHASE_NAME[p] }}</span>
      <span v-if="overRows.length">
        <svg class="ppk-sw" aria-hidden="true" width="16" height="10" viewBox="0 0 16 10"><rect width="16" height="10" rx="2" :fill="swFill" /><path d="M6 10 L9 0 M10 10 L13 0" class="ppk-cut" /></svg>{{ PV.perKwOver }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.ppk-plot { position: relative; width: 100%; }
.ppk-svg { display: block; }
/* 整行命中层压在 SVG 上(同 PvAnchorBars .pan-row):底色只在悬停时淡淡一层 */
.ppk-hit { position: absolute; left: 0; right: 0; border-radius: 4px; cursor: pointer; }
.ppk-tip { display: flex; flex-direction: column; gap: 3px; white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.ppk-gl { stroke: var(--ink-100); stroke-width: 1; }
.ppk-axl { stroke: var(--ink-300); stroke-opacity: .75; stroke-width: 1; }
.ppk-ax { font-size: var(--fs-micro); font-family: var(--font-mono); fill: var(--text-muted); font-variant-numeric: tabular-nums; }
.ppk-name { font-size: var(--fs-micro); font-family: var(--font-sans); fill: var(--text-secondary); }
.ppk-name-sel { fill: var(--text-primary); font-weight: 600; }
.ppk-val { font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums; fill: var(--text-primary); font-weight: 600; }
/* 截断斜线与合格线的衬底 = 卡片底色:暗色下跟着换 */
.ppk-cut { stroke: var(--surface-white); stroke-width: 2; fill: none; }
.ppk-anchor-bg { stroke: var(--surface-white); stroke-width: 3.5; }
.ppk-anchor { stroke-width: 1.5; stroke-dasharray: 5 4; }
/* 图例钉一行高 16:骨架照这个数留位 */
.ppk-leg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; height: 16px; overflow: hidden; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.ppk-leg span { display: inline-flex; align-items: center; gap: 5px; }
.ppk-ldot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.ppk-sw { flex: 0 0 auto; }
</style>
