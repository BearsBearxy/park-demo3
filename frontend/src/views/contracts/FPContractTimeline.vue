<script setup lang="ts">
// 合同期时间轴(F2):纯 CSS 横条,不用 ECharts——蓝淡色=计租期,红淡色=免租期,深色竖线=今天;
// hover 用原生 title 显示区间日期+备注。无起止日期显示「待签约」空态。
import { computed } from 'vue'
import type { RentFreePeriod } from '@/types/contract'

const props = defineProps<{
  startDate: string | null
  endDate: string | null
  rentFree?: RentFreePeriod[] | null
}>()

const DAY = 86400000
const ms = (d: string) => new Date(d + 'T00:00:00').getTime()   // 本地零点,避免 UTC 解析跨日偏移

// 合同期区间(端点含当日:右端 +1 天,单日免租段也画得出宽度)
const range = computed(() => {
  if (!props.startDate || !props.endDate) return null
  const s = ms(props.startDate), e = ms(props.endDate) + DAY
  return Number.isFinite(s) && Number.isFinite(e) && e > s ? { s, e } : null
})

const pctOf = (t: number) => {
  const { s, e } = range.value!
  return Math.min(100, Math.max(0, ((t - s) / (e - s)) * 100))
}

// 免租段:裁剪进合同期;日期非法/倒挂/完全越界的段丢弃(读侧兜底,与 api 层 try-parse 同口径)
const freeSegs = computed(() => {
  if (!range.value) return []
  return (props.rentFree ?? [])
    .map((p) => {
      if (!p?.start || !p?.end) return null
      const s = ms(p.start), e = ms(p.end) + DAY
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null
      const left = pctOf(s), width = pctOf(e) - left
      if (width <= 0) return null
      return { left, width, title: `免租期 ${p.start} → ${p.end}${p.note ? ' · ' + p.note : ''}` }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
})

const now = new Date()
const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const todayPct = computed(() => {
  if (!range.value) return null
  const t = ms(todayStr)
  return t >= range.value.s && t < range.value.e ? pctOf(t + DAY / 2) : null   // 取当日正午,首尾日不贴边被圆角裁掉
})
</script>

<template>
  <div v-if="range" class="ctl">
    <div class="ctl-bar" :title="`计租期 ${startDate} → ${endDate}`">
      <div v-for="(f, i) in freeSegs" :key="i" class="ctl-free"
           :style="{ left: f.left + '%', width: f.width + '%' }" :title="f.title" />
      <div v-if="todayPct != null" class="ctl-today" :style="{ left: todayPct + '%' }" :title="`今天 ${todayStr}`" />
    </div>
    <div class="ctl-legend">
      <span><i class="ctl-dot rent" /> 计租期</span>
      <span><i class="ctl-dot free" /> 免租期</span>
      <span v-if="todayPct != null"><i class="ctl-dot today" /> 今天</span>
    </div>
  </div>
  <div v-else class="ctl-empty">待签约 · 起止日期未定</div>
</template>

<style scoped>
.ctl { display:flex; flex-direction:column; gap:6px; }
.ctl-bar { position:relative; height:12px; border-radius:var(--radius-full); background:color-mix(in srgb, var(--hue-blue) 28%, white); overflow:hidden; }
.ctl-free { position:absolute; top:0; bottom:0; background:color-mix(in srgb, var(--hue-red) 32%, white); }
.ctl-today { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:var(--ink-900); }
.ctl-legend { display:flex; gap:14px; font-size:var(--fs-micro); color:var(--text-muted); }
.ctl-legend span { display:inline-flex; align-items:center; gap:4px; }
.ctl-dot { display:inline-block; width:9px; height:9px; border-radius:3px; }
.ctl-dot.rent  { background:color-mix(in srgb, var(--hue-blue) 28%, white); }
.ctl-dot.free  { background:color-mix(in srgb, var(--hue-red) 32%, white); }
.ctl-dot.today { width:2px; height:10px; border-radius:0; background:var(--ink-900); }
.ctl-empty { font-size:var(--fs-label); color:var(--text-disabled); padding:4px 0; }
</style>
