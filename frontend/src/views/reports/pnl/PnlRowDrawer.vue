<script setup lang="ts">
// S 档卡片点开后的第二形态(响应式稿 WideCardVariants 板 §3):一行科目的 12 个月值 + 本年合计。
// 卡面上只留 科目细分 / 本年合计 / 分组名,12 根月列没地方放 —— 点开在这里逐月列。
// 壳用现成 FPDrawer(≤600 自己全屏 sheet,不另造抽屉);内容就是两列列表,不画图不加指标。
// 只在 S 档由 PnlTable 挂载,宽档不渲染(桌面照旧看横滚表的 12 根列)。
import { computed } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import { rowYearTotal } from '@/reports/pnlSchedules'
import { finSigned } from '@/utils/finFmt'
import type { PnlRowDTO } from '@/types/pnl'

const props = defineProps<{
  row: PnlRowDTO | null
  groupCol: string
  year: number
}>()
defineEmits<{ close: [] }>()

// null=未录,显 '–' 区分真 0(与 PnlTable 月格同一口径)
const months = computed(() =>
  (props.row?.m ?? []).map((v, i) => ({ label: `${i + 1}月`, v })),
)
const total = computed(() => (props.row ? rowYearTotal(props.row.m) : null))
</script>

<template>
  <FPDrawer
    :open="!!row"
    :title="row?.label ?? ''"
    :subtitle="`${groupCol} ${row?.groupLabel || '—'} · ${year}年 · 单位:元`"
    icon="trending-up"
    :width="420"
    @close="$emit('close')"
  >
    <dl class="pmd">
      <div v-for="m in months" :key="m.label" class="pmd-r">
        <dt>{{ m.label }}</dt>
        <dd :class="{ 'is-null': m.v === null, neg: m.v !== null && m.v < 0 }">
          {{ m.v === null ? '–' : finSigned(m.v) }}
        </dd>
      </div>
      <div class="pmd-r is-total">
        <dt>本年合计</dt>
        <dd :class="{ 'is-null': total === null, neg: total !== null && total < 0 }">
          {{ total === null ? '–' : finSigned(total) }}
        </dd>
      </div>
    </dl>
  </FPDrawer>
</template>

<style scoped>
.pmd { margin:0; display:flex; flex-direction:column; }
.pmd-r { display:flex; align-items:center; justify-content:space-between; gap:12px; height:40px; border-bottom:1px solid var(--divider); }
.pmd-r dt { margin:0; font-size:13px; color:var(--text-secondary); }
.pmd-r dd { margin:0; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:13px; color:var(--text-primary); }
.pmd-r dd.is-null { color:var(--text-disabled); }
.pmd-r dd.neg { color:var(--hue-red); }
.pmd-r.is-total { height:44px; border-bottom:none; border-top:2px solid var(--border-strong); }
.pmd-r.is-total dt, .pmd-r.is-total dd { font-weight:var(--fw-semibold); color:var(--text-primary); }
</style>
