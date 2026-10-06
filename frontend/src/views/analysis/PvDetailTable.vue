<script setup lang="ts">
// 抽屉 B12 · 每天的读数(PV-ANALYSIS-SCREEN-V4 §3.20;2026-10-06 改稿 pv-v2-drawer;按年一行一个月)。
// 五列 108 / 104 / 84 / 96 / 备注按最长一条定宽,余宽落进行末空列 .fp-fill(LIST-PAGE-SPEC §4,2026-10-02);
// 行高 32;表头 24 吸顶,可见 8 行、表内上下滚,打开时停在最后 8 行。
// 出范围行左侧 2px 色条(低于红 / 高于琥珀)+ 数值与状态同色;缺抄行整行淡底、数值「—」、备注「没抄表」。
// 行由 pvAnaV4.logic.ts 的 detailRows 给好:未到的刻度不出现,漏抄的出现。
import { computed, nextTick, ref, watch } from 'vue'
import '@/components/ana/ana.css'
import { textW } from '@/composables/useWideTable'
import { PV_COLORS as C } from './pvAnaColors'
import { PV, PVH, pvRowsRef } from '@/components/ana/anaSentence'
import type { DetailRow, PvDetailTableProps } from './pvAnaV4.logic'

const props = defineProps<PvDetailTableProps>()

const ROW_H = 32, HEAD_H = 24, VISIBLE = 8

const unit = computed<'天' | '个月'>(() => (props.gran === 'month' ? '天' : '个月'))
/** 日期列:月档「8 月 21 日」,年档「2 月」 */
const ordinal = (key: string) => Number(props.gran === 'month' ? key.slice(8, 10) : key.slice(5, 7))
const dateText = (key: string) =>
  props.gran === 'month' ? `${Number(key.slice(5, 7))} 月 ${ordinal(key)} 日` : `${ordinal(key)} 月`

// computed:切外观时跟着换(页签常驻不重挂载;琥珀字暗色下是 --warn-text)
const OUT = computed(() => ({
  '-1': { text: PV.table.below, bar: C.BELOW, ink: C.BELOW },
  '1': { text: PV.table.above, bar: C.ABOVE, ink: C.AMBER_TEXT },
}) as Record<string, { text: string; bar: string; ink: string }>)

const view = computed(() => props.rows.map((r: DetailRow) => {
  // 有记录但发电 ≤ 0(比值算不出,state 也是 missing)≠ 没抄表:发电照写,不标「没抄表」(V4 §0 gen=0 与离线分开)
  const miss = r.state === 'missing' && r.gen == null
  const noRatio = r.state === 'missing'
  const o = r.out ? OUT.value[String(r.out)] : null
  return {
    key: r.key, miss, bar: o?.bar ?? null, ink: o?.ink ?? null,
    date: dateText(r.key),
    gen: r.gen == null ? '—' : Math.round(r.gen).toLocaleString('en-US'),
    ratio: noRatio || r.ratio == null ? '—' : r.ratio.toFixed(3),
    state: noRatio || r.out == null ? '—' : o ? o.text : PV.table.in,
    note: miss ? '没抄表' : noRatio ? '有抄表，发电不为正，不算比值' : r.runDay != null ? `连续第 ${r.runDay} ${unit.value}` : '',
  }
}))

// 备注列:本段全部备注里最长的一条(12px 字 + 左右内边距 16)
const noteW = computed(() => textW(['备注', ...view.value.map(r => r.note)], 12, 16))

// ── 滚动:打开 / 换数据时停在最后 8 行(最近的日子);表脚只说屏外还有几行、空行是什么 ──
const box = ref<HTMLElement | null>(null)
watch(() => props.rows, async (rows) => {
  await nextTick()
  if (box.value) box.value.scrollTop = Math.max(0, rows.length - VISIBLE) * ROW_H
}, { immediate: true })

/** 卡头:这栋 · 几月几天(按年:几个月)· kWh */
const hint = computed(() => (props.gran === 'month'
  ? PVH.rows(props.name, Number(props.rows[0]?.key.slice(5, 7) ?? 0), props.rows.length)
  : PVH.rowsY(props.name, props.rows.length)))
const foot = computed(() => pvRowsRef(Math.max(0, props.rows.length - VISIBLE), unit.value))
</script>

<template>
  <div class="av2-card pv-b12">
    <div class="av2-card-h">
      <span class="t">{{ PV.card.rows }}</span>
      <span class="hint">{{ hint }}</span>
    </div>
    <div ref="box" class="scroll" :style="{ maxHeight: HEAD_H + VISIBLE * ROW_H + 'px' }">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width: 108px;">{{ gran === 'month' ? '日期' : '月份' }}</th>
            <th style="width: 104px;">{{ gran === 'month' ? '当日' : '当月' }}发电 kWh</th>
            <th style="width: 84px;">{{ PV.table.ratio }}</th>
            <th style="width: 96px;">{{ PV.table.inBand }}</th>
            <th class="note" :style="{ width: noteW + 'px' }">备注</th>
            <th class="fp-fill" aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in view" :key="r.key" :class="{ miss: r.miss, out: !!r.bar }" :style="{ background: r.miss ? 'var(--surface-sunken)' : undefined }">
            <td class="date"><span class="bar" :style="{ background: r.bar ?? 'transparent' }"></span>{{ r.date }}</td>
            <td class="mono" :style="{ color: r.ink ?? undefined }">{{ r.gen }}</td>
            <td class="mono" :style="{ color: r.ink ?? undefined }">{{ r.ratio }}</td>
            <td class="state" :style="{ color: r.ink ?? undefined }">{{ r.state }}</td>
            <td class="note">{{ r.note }}</td>
            <td class="fp-fill" aria-hidden="true"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="ana-ref">{{ foot.text }}</p>
  </div>
</template>

<style scoped>
.scroll { overflow-y: auto; }
.tbl { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.tbl th {
  position: sticky; top: 0; z-index: 1; height: 24px; box-sizing: border-box; background: var(--surface-white);
  text-align: right; font-size: 11px; font-weight: 600; color: var(--text-muted);
  padding: 0 8px 8px; white-space: nowrap; border-bottom: 1px solid var(--divider);
}
.tbl th:first-child { text-align: left; }
.tbl th.note { text-align: left; }
.tbl td {
  padding: 0 8px; height: 32px; box-sizing: border-box; font-size: 12px; color: var(--text-primary);
  border-bottom: 1px solid var(--divider); text-align: right; white-space: nowrap;
}
.tbl td.date { position: relative; padding-left: 12px; text-align: left; }
.tbl td.note { text-align: left; color: var(--text-muted); }
.tbl .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.bar { position: absolute; left: 0; top: 4px; bottom: 4px; width: 2px; border-radius: 2px; }
.tbl tr.miss td { color: var(--ink-500); }
</style>
