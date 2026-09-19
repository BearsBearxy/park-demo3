<script setup lang="ts">
// 抽屉 B12 · 逐刻度明细(PV-ANALYSIS-SCREEN-V4 §3.20;画布 v2/Drawer.dc.html)。
// 五列 108 / 104 / 84 / 96 / 余宽;行高 32;表头 24 吸顶,可见 8 行、表内上下滚,打开时停在最后 8 行。
// 出范围行左侧 2px 色条(低于红 / 高于琥珀)+ 数值与状态同色;缺抄行整行淡底、数值「—」、备注「没抄表」。
// 行由 pvAnaV4.logic.ts 的 detailRows 给好:未到的刻度不出现,漏抄的出现。
import { computed, nextTick, ref, watch } from 'vue'
import '@/components/ana/ana.css'
import { PV_COLORS as C } from './pvAnaColors'
import type { DetailRow, PvDetailTableProps } from './pvAnaV4.logic'

const props = defineProps<PvDetailTableProps>()

const ROW_H = 32, HEAD_H = 24, VISIBLE = 8

const unit = computed(() => (props.gran === 'month' ? '天' : '个月'))
/** 日期列:月档「8 月 21 日」,年档「2 月」;表脚的「第 a–b 天」也用这个日 / 月序号 */
const ordinal = (key: string) => Number(props.gran === 'month' ? key.slice(8, 10) : key.slice(5, 7))
const dateText = (key: string) =>
  props.gran === 'month' ? `${Number(key.slice(5, 7))} 月 ${ordinal(key)} 日` : `${ordinal(key)} 月`

// computed:切外观时跟着换(页签常驻不重挂载;琥珀字暗色下是 --warn-text)
const OUT = computed(() => ({
  '-1': { text: '低于下沿', bar: C.BELOW, ink: C.BELOW },
  '1': { text: '高于上沿', bar: C.ABOVE, ink: C.AMBER_TEXT },
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
    state: noRatio || r.out == null ? '—' : o ? o.text : '在范围内',
    note: miss ? '没抄表' : noRatio ? '有抄表，发电不为正，不算比值' : r.runDay != null ? `连续第 ${r.runDay} ${unit.value}` : '',
  }
}))

// ── 滚动:打开 / 换数据时停在最后 8 行;表脚跟着写停在哪几行 ──
const box = ref<HTMLElement | null>(null)
const first = ref(0)
watch(() => props.rows, async (rows) => {
  first.value = Math.max(0, rows.length - VISIBLE)
  await nextTick()
  if (box.value) box.value.scrollTop = first.value * ROW_H
}, { immediate: true })
function onScroll() {
  if (box.value) first.value = Math.min(Math.max(0, props.rows.length - VISIBLE), Math.round(box.value.scrollTop / ROW_H))
}

const foot = computed(() => {
  const n = props.rows.length
  const miss = props.gran === 'month' ? '那天' : '那个月'
  if (n <= VISIBLE) return { scroll: '', miss }
  const a = ordinal(props.rows[first.value].key), b = ordinal(props.rows[first.value + VISIBLE - 1].key)
  const dir = first.value + VISIBLE >= n ? '滚上去看' : first.value === 0 ? '滚下去看' : '上下滚动看'
  return { scroll: `表内可上下滚，这里停在第 ${a}–${b} ${unit.value}，其余 ${n - VISIBLE} ${unit.value}${dir}`, miss }
})
</script>

<template>
  <div class="av2-card pv-b12">
    <div class="av2-card-h">
      <span class="t">逐刻度明细</span>
      <span class="hint">这一栋这一段，{{ gran === 'month' ? '每天' : '每个月' }}的原始读数</span>
    </div>
    <div ref="box" class="scroll" :style="{ maxHeight: HEAD_H + VISIBLE * ROW_H + 'px' }" @scroll="onScroll">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width: 108px;">{{ gran === 'month' ? '日期' : '月份' }}</th>
            <th style="width: 104px;">{{ gran === 'month' ? '当日' : '当月' }}发电 度</th>
            <th style="width: 84px;">比值</th>
            <th style="width: 96px;">在不在范围内</th>
            <th class="note">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in view" :key="r.key" :class="{ miss: r.miss, out: !!r.bar }" :style="{ background: r.miss ? 'var(--surface-sunken)' : undefined }">
            <td class="date"><span class="bar" :style="{ background: r.bar ?? 'transparent' }"></span>{{ r.date }}</td>
            <td class="mono" :style="{ color: r.ink ?? undefined }">{{ r.gen }}</td>
            <td class="mono" :style="{ color: r.ink ?? undefined }">{{ r.ratio }}</td>
            <td class="state" :style="{ color: r.ink ?? undefined }">{{ r.state }}</td>
            <td class="note">{{ r.note }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="ana-ref">
      只列这一栋、只列本段<template v-if="foot.scroll"> · {{ foot.scroll }}</template> · 空行不是 0，是{{ foot.miss }}没抄表
    </p>
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
