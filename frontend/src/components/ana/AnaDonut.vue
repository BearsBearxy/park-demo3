<script setup lang="ts">
// 环形图(移植 DS DonutChart _ds_bundle.js:平行径向缺口 + 小圆角扇区 + 中心值/占比 tooltip)。
// fin-balance/cockpit/park-energy/tenant-portfolio 共用;负值/零值段自动跳过(环图不表达负数)。
import { computed, ref } from 'vue'
import './ana.css'

export interface DonutDatum { label: string; value: number; color: string }

const props = withDefaults(defineProps<{
  data: DonutDatum[]
  size?: number
  thickness?: number
  gap?: number
  cornerRadius?: number
  centerValue?: string
  centerLabel?: string
  fmt?: (v: number) => string
}>(), { size: 140, gap: 8, cornerRadius: 6 })

const TAU = Math.PI * 2
const polar = (cx: number, cy: number, radius: number, ang: number): [number, number] =>
  [cx + radius * Math.cos(ang), cy + radius * Math.sin(ang)]

// 圆角环形扇区:平行径向边 + 角部 corner radius c(1:1 移植 DS sectorPath)
function sectorPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number, c: number): string {
  const dcO = Math.min(c / R, (a1 - a0) / 2)
  const dcI = Math.min(c / r, (a1 - a0) / 2)
  const large = a1 - a0 - dcO * 2 > Math.PI ? 1 : 0
  const largeI = a1 - a0 - dcI * 2 > Math.PI ? 1 : 0
  const p = (radius: number, ang: number) => polar(cx, cy, radius, ang).map((v) => v.toFixed(2)).join(',')
  return [
    `M${p(R, a0 + dcO)}`, `A${R},${R} 0 ${large} 1 ${p(R, a1 - dcO)}`, `Q${p(R, a1)} ${p(R - c, a1)}`,
    `L${p(r + c, a1)}`, `Q${p(r, a1)} ${p(r, a1 - dcI)}`, `A${r},${r} 0 ${largeI} 0 ${p(r, a0 + dcI)}`,
    `Q${p(r, a0)} ${p(r + c, a0)}`, `L${p(R - c, a0)}`, `Q${p(R, a0)} ${p(R, a0 + dcO)}`, 'Z',
  ].join(' ')
}

const hov = ref(-1)
const th = computed(() => props.thickness ?? Math.round(props.size * 0.18))
const shown = computed(() => props.data.filter((d) => d.value > 0))
const total = computed(() => shown.value.reduce((a, d) => a + d.value, 0) || 1)
const f = computed(() => props.fmt ?? ((v: number) => String(v)))

interface Seg extends DonutDatum { i: number; path: string }
const segs = computed<Seg[]>(() => {
  const cx = props.size / 2, cy = props.size / 2
  const R = props.size / 2, r = props.size / 2 - th.value
  const gapA = props.gap / ((R + r) / 2)
  let acc = -Math.PI / 2
  const out: Seg[] = []
  shown.value.forEach((d, i) => {
    const span = (d.value / total.value) * TAU
    const a0 = acc + gapA / 2
    const a1 = acc + span - gapA / 2
    acc += span
    if (a1 <= a0) return
    out.push({ ...d, i, path: sectorPath(cx, cy, R, r, a0, a1, Math.min(props.cornerRadius, th.value / 2 - 1)) })
  })
  return out
})
const tip = computed(() => (hov.value < 0 ? null : segs.value.find((s) => s.i === hov.value) ?? null))
</script>

<template>
  <div style="position: relative; display: inline-flex">
    <svg :width="size" :height="size">
      <path v-for="s in segs" :key="s.i" :d="s.path" :fill="s.color"
        :opacity="hov === -1 || hov === s.i ? 1 : 0.35"
        style="transition: opacity var(--dur-fast) var(--ease-standard); cursor: default"
        @mouseenter="hov = s.i" @mouseleave="hov = -1" />
    </svg>
    <div v-if="centerLabel || centerValue"
      style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none">
      <span v-if="centerValue" style="font-family: var(--font-sans); font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary)">{{ centerValue }}</span>
      <span v-if="centerLabel" style="font-size: var(--fs-micro); color: var(--text-muted)">{{ centerLabel }}</span>
    </div>
    <div v-if="tip" class="cz-tip" style="left: 50%; top: -8px; transform: translate(-50%, -100%)">
      <div class="h">{{ tip.label }}</div>
      <div class="r"><span :style="{ width: '8px', height: '8px', borderRadius: '2px', background: tip.color, display: 'inline-block' }"></span>
        <span class="nm">金额</span><span class="vv">{{ f(tip.value) }}</span></div>
      <div class="r"><span class="nm">占比</span><span class="vv">{{ (tip.value / total * 100).toFixed(1) }}%</span></div>
    </div>
  </div>
</template>
