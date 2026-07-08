<script setup lang="ts">
// v2 KPI 瓦片(spec §一 KPI 条,置于 AnaShell #kpis 槽 .av2-kpis 容器):
// label + 值(mono) + delta 副行(方向取色,成本/欠费类 invert 反转;无 delta 可给灰色 note)。
import { deltaColor, sgn } from './anaFmt'
import './ana.css'

withDefaults(defineProps<{
  label: string
  value: string
  delta?: number | null   // 副行数值(null/undefined 不渲染)
  kind?: string           // 副行说明(如「环比」「vs 目标」)
  unit?: string           // delta 单位
  invert?: boolean        // 越低越好(成本/逾期类)
  note?: string           // 无 delta 时的灰色副行(如覆盖期数,诚实原则)
  noteTone?: 'warn'       // note 警示色(期间回退等半显式披露升级,复审)
}>(), { unit: '%' })
</script>

<template>
  <div class="av2-kpi">
    <span class="l">{{ label }}</span>
    <span class="v">{{ value }}</span>
    <span v-if="delta != null" class="d" :style="{ color: deltaColor(delta, invert) }">{{ sgn(delta, 1, unit) }} {{ kind || '' }}</span>
    <span v-else-if="note" class="d" :style="{ color: noteTone === 'warn' ? '#854F0B' : 'var(--text-muted)' }">{{ note }}</span>
  </div>
</template>

<style scoped>
.av2-kpi { background: var(--surface-white); border: 0.5px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.av2-kpi .l { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.av2-kpi .v { font-size: 17px; font-weight: 600; font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); letter-spacing: -0.01em; white-space: nowrap; }
.av2-kpi .d { font-size: 10.5px; font-family: var(--font-mono); white-space: nowrap; }
</style>
