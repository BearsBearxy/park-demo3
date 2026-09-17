<script setup lang="ts">
// B6 · 台账装机 vs 板数 × 标称(PV-ANALYSIS-SCREEN-V4 §3.7;画布 ../运维文档/设计稿/已实现/光伏分栋分析v4定稿-2026-09-13/Abs.dc.html)。
// 左 300×300 正方区(+34 轴字):绘图区 248×248(padL 40 / padR 12 / padT 12),两轴同一把刻度,
// 所以虚线 y = x 是 45°;±容差是沿对角线的斜带。右栏说明 + 录入入口(emit record,由屏去跳楼栋档案)。
// 一栋没录也照样画框线、对角线与带,只是没有点(计划 §1 #4)。画板无悬停,这里也不加。
import { computed, ref } from 'vue'
import { useEnterPhase } from '@/components/ana/anaMotion'
import '@/components/ana/ana.css'   // @keyframes fp-wipe + ana-morph
import { PV_COLORS } from './pvAnaColors'
import type { PvLedgerScatterProps } from './pvAnaV4.logic'

const props = defineProps<PvLedgerScatterProps>()
const emit = defineEmits<{ record: [] }>()

const SQ = 300, PL = 40, PT = 12, P = 248
const B = PT + P
// 切到「绝对水平」挂上来时在视口内点组擦入 320;换期 200 同键形变(点按栋、带跟量程)。
// 画布定宽不随容器变,hold 只看擦入
const el = ref<HTMLElement | null>(null)
const first = useEnterPhase(el)
// 没有点时没有值域可言:取一段只为画出带的形状,不出刻度字。
// 下沿 : 上沿 = 3 : 8 时带的上沿在右端正好不冲出画布顶(y ≈ 0)
const EMPTY_DOMAIN = { min: 3, max: 8 }

const niceStep = (raw: number) => {
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map(m => m * p).find(v => v >= raw)!
}

const dom = computed(() => {
  const pts = props.data.points
  if (!pts.length) return null
  const vs = pts.flatMap(p => [p.x, p.y])
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const pad = (hi - lo) * 0.1 || hi * 0.1
  return { min: Math.floor((lo - pad) / 10) * 10, max: Math.ceil((hi + pad) / 10) * 10 }
})
const d = computed(() => dom.value ?? EMPTY_DOMAIN)
const px = (v: number) => PL + ((v - d.value.min) / (d.value.max - d.value.min)) * P
const py = (v: number) => B - ((v - d.value.min) / (d.value.max - d.value.min)) * P

const ticks = computed(() => {
  const m = dom.value
  if (!m) return []
  const step = niceStep((m.max - m.min) / 3)
  const out: number[] = []
  for (let v = Math.ceil(m.min / step) * step; v <= m.max; v += step) if (v > m.min) out.push(v)
  return out
})

const band = computed(() => {
  const t = props.data.tolerance, { min, max } = d.value
  return `M${px(min)},${py(min * (1 - t))} L${px(max)},${py(max * (1 - t))} L${px(max)},${py(max * (1 + t))} L${px(min)},${py(min * (1 + t))} Z`
})

const pct = computed(() => `${Math.round(props.data.tolerance * 100)}%`)
const note = computed(() => {
  const { points, unrecorded } = props.data
  if (unrecorded > 0) return `${unrecorded} 栋板数或单块标称功率未录，这些栋不画点。${points.length ? '' : '录几栋出几个点。'}`
  return points.length ? '' : '还没有能画的点。'
})
</script>

<template>
  <div class="pls">
    <div ref="el" class="pls-fig">
      <svg :width="SQ" :height="SQ + 34" :viewBox="`0 0 ${SQ} ${SQ + 34}`" class="pls-svg" role="img" aria-label="台账装机 vs 板数 × 标称">
        <template v-for="v in ticks" :key="v">
          <line class="pls-gl" :x1="px(v)" :x2="px(v)" :y1="PT" :y2="B" />
          <line class="pls-gl" :x1="PL" :x2="PL + P" :y1="py(v)" :y2="py(v)" />
          <text class="pls-ax pls-tx" :x="px(v)" :y="B + 16" text-anchor="middle">{{ v }}</text>
          <text class="pls-ax pls-ty" :x="PL - 6" :y="py(v) + 4" text-anchor="end">{{ v }}</text>
        </template>
        <!-- 带是框的一部分(没有点也画),不擦,只跟量程形变 -->
        <g :class="['pls-bandg', 'ana-morph', { hold: first }]"><path class="pls-band" :d="band" /></g>
        <line class="pls-diag" :x1="PL" :y1="B" :x2="PL + P" :y2="PT" :stroke="PV_COLORS.REF_DIAG" stroke-width="1" stroke-dasharray="4 3" />
        <text class="pls-ax" x="186.3" y="140">虚线 = 两者相等</text>
        <g :class="['pls-data', 'ana-morph', { first, hold: first }]" @animationend.self="first = false" @animationcancel.self="first = false">
          <circle v-for="p in data.points" :key="p.id" class="pls-pt" :cx="px(p.x)" :cy="py(p.y)" r="5"
            :fill="PV_COLORS.FOCUS" fill-opacity=".22" :stroke="PV_COLORS.FOCUS" stroke-opacity=".35" />
        </g>
        <line class="pls-axl pls-axl-x" :x1="PL" :x2="PL + P" :y1="B" :y2="B" />
        <line class="pls-axl pls-axl-y" :x1="PL" :x2="PL" :y1="PT" :y2="B" />
        <text class="pls-ax" :x="PL + P" :y="B + 30" text-anchor="end">板数 × 单块标称 ÷ 1000（kWp）</text>
        <text class="pls-ax" :x="PL - 6" :y="PT + 10">台账装机（kWp）</text>
      </svg>
    </div>
    <div class="pls-side">
      <div v-if="note" class="pls-note">{{ note }}</div>
      <div class="pls-leg">
        <svg width="22" height="14" viewBox="0 0 22 14"><line x1="1" y1="13" x2="21" y2="1" :stroke="PV_COLORS.REF_DIAG" stroke-width="1" stroke-dasharray="4 3" /></svg>
        <span><b>虚线 = 两者相等</b>：台账上写的装机，正好等于 板数 × 单块标称 ÷ 1000。点落在线上就是对得上。</span>
      </div>
      <div class="pls-leg">
        <svg width="22" height="14" viewBox="0 0 22 14"><rect x="1" y="3" width="20" height="8" rx="2" class="pls-band" /></svg>
        <span><b>灰带 = 相差 ±{{ pct }} 以内</b>：算对得上。落在带外面的栋，台账和板数 × 标称差得超过 {{ pct }}。</span>
      </div>
      <div class="pls-leg">
        <svg width="22" height="14" viewBox="0 0 22 14"><circle cx="11" cy="7" r="5" :fill="PV_COLORS.FOCUS" fill-opacity=".22" :stroke="PV_COLORS.FOCUS" stroke-opacity=".35" /></svg>
        <span><b>一个点 = 一栋</b>：横轴是现场板子算出来的，纵轴是台账写的，两轴同一把刻度，单位 kWp。</span>
      </div>
      <button type="button" class="pls-link" @click="emit('record')">去楼栋档案录入板数与单块标称功率 →</button>
    </div>
  </div>
</template>

<style scoped>
.pls { display: flex; gap: 32px; align-items: flex-start; }
.pls-fig { flex: 0 0 300px; }
.pls-svg { display: block; }
/* 首挂:点组自左擦出一次;fp-wipe 在 ana.css,不能写进 scoped(名字会被加 hash) */
.pls-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
.pls-side { flex: 1 1 auto; max-width: 460px; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding-top: 6px; }
.pls-gl { stroke: var(--ink-100); stroke-width: 1; }
.pls-axl { stroke: var(--ink-300); stroke-opacity: .75; stroke-width: 1; }
.pls-band { fill: var(--ink-050); }
.pls-ax { font-size: var(--fs-micro); font-family: var(--font-mono); fill: var(--text-muted); font-variant-numeric: tabular-nums; }
.pls-note { font-size: var(--fs-label); line-height: 1.55; padding: 8px 12px; border-radius: 8px; background: var(--surface-sunken); color: var(--text-primary); }
.pls-leg { display: flex; align-items: flex-start; gap: 10px; font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); }
.pls-leg svg { flex: 0 0 22px; }
.pls-leg b { font-weight: 600; color: var(--text-primary); }
.pls-link { align-self: flex-start; padding: 0; border: 0; background: none; font: inherit; font-size: var(--fs-label); color: var(--text-link); cursor: pointer; }
.pls-link:hover { color: var(--brand-deep); }
</style>
