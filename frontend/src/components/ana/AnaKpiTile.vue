<script setup lang="ts">
// v2 KPI 瓦片(spec §一 KPI 条,置于 AnaShell #kpis 槽 .av2-kpis 容器):
// label + 值(mono) + delta 副行(方向取色,成本/欠费类 invert 反转;无 delta 可给灰色 note)。
// 可选 trend 迷你趋势线(spec 2026-07-11 §B:值行右侧 56×20 inline SVG,null 断点分段,可画段不足不渲染)。
import { computed } from 'vue'
import { deltaColor, sgn, trendPath } from './anaFmt'
import './ana.css'

const props = withDefaults(defineProps<{
  label: string
  value: string
  delta?: number | null   // 副行数值(null/undefined 不渲染)
  kind?: string           // 副行说明(如「环比」「vs 目标」)
  unit?: string           // delta 单位
  invert?: boolean        // 越低越好(成本/逾期类)
  note?: string           // 无 delta 时的灰色副行(如覆盖期数,诚实原则)
  noteTone?: 'warn'       // note 警示色(期间回退等半显式披露升级,复审)
  trend?: (number | null)[]   // 12 月序列(形状展示,量纲无关;无月度序列的瓦片不传)
}>(), { unit: '%' })

const spark = computed(() => (props.trend ? trendPath(props.trend, 56, 20) : ''))
</script>

<template>
  <div class="av2-kpi">
    <span class="l">{{ label }}</span>
    <span class="vr">
      <span class="v">{{ value }}</span>
      <svg v-if="spark" class="spk" viewBox="0 0 56 20" aria-hidden="true">
        <path :d="spark" fill="none" stroke="var(--text-muted)" stroke-width="1.2" stroke-linecap="round" />
      </svg>
    </span>
    <span v-if="delta != null" class="d" :style="{ color: deltaColor(delta, invert) }">{{ sgn(delta, 1, unit) }} {{ kind || '' }}</span>
    <span v-else-if="note" class="d" :style="{ color: noteTone === 'warn' ? '#854F0B' : 'var(--text-muted)' }">{{ note }}</span>
  </div>
</template>

<style scoped>
.av2-kpi { background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.av2-kpi .l { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.av2-kpi .vr { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
/* min-width:0 + 省略号:窄屏(≤1366px)瓦片挤到 ~110px 时长数值原本会溢出瓦片右边框,只能截断而非撑破 */
.av2-kpi .v { font-size: var(--fs-h3); font-weight: var(--fw-semibold); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); letter-spacing: -0.01em; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* sparkline 可压缩(0 1 56px):形状展示,窄屏让位给数值比保持 56px 宽更重要 */
.av2-kpi .spk { width: 56px; height: 20px; flex: 0 1 56px; opacity: 0.75; }
/* 副行允许换行:nowrap 会把「−14.7pt vs 目标96% · 取 2025-10」在瓦片边界切成「取 202…」 */
.av2-kpi .d { font-size: var(--fs-micro); font-family: var(--font-mono); line-height: 1.35; overflow-wrap: anywhere; }
</style>
