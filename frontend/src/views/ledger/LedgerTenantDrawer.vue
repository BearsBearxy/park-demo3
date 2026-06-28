<script setup lang="ts">
// ③ 租户明细抽屉 — 1:1 from screen-ledger.jsx drawer branch (669-715).
// 数据用②已加载的行(无额外请求)。
import { computed } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPStat from '@/components/fp/FPStat.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import { lgColumns } from '@/utils/ledgerColumns'
import type { LedgerRowDTO } from '@/types/ledger'

const props = defineProps<{
  row: LedgerRowDTO | null
  companyName: string
  year: number
  monthNo: number
  prevMonth: number
}>()
const emit = defineEmits<{ close: [] }>()

// jsx lgFmt: 0/empty → "" (drawer shows "0.00" fallback, jsx 681-683)
function lgFmt(v: number | null | undefined): string {
  if (v == null || v === 0) return ''
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmt0 = (v: number | null | undefined) => lgFmt(v) || '0.00'

const groups = computed(() => lgColumns(props.prevMonth).groups)

// 仅非零费用,按组分组并算组内小计 (jsx 693-705)
const feeGroups = computed(() => {
  const r = props.row
  if (!r) return []
  return groups.value
    .map(g => {
      const items = g.cols.filter(c => Number((r as any)[c.key]) > 0)
      const gsum = items.reduce((s, c) => s + Number((r as any)[c.key]), 0)
      return { name: g.name, items, gsum }
    })
    .filter(g => g.items.length > 0)
})
const hasFees = computed(() => feeGroups.value.length > 0)

const balTone = computed(() => {
  const b = props.row?.balanceEnd ?? 0
  return b < 0 ? 'var(--hue-red)' : b > 0 ? 'var(--hue-orange)' : 'var(--text-primary)'
})
</script>

<template>
  <FPDrawer
    :open="!!row"
    :title="row?.tenantName ?? ''"
    :subtitle="`${year} 年 ${monthNo} 月 · ${companyName} · 租户台账明细`"
    icon="user"
    :width="560"
    @close="emit('close')"
  >
    <template v-if="row">
      <!-- 3 stat: 应收 / 收款 / 结余(结余正橙负红)jsx 680-684 -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
        <FPStat label="应收合计" :value="fmt0(row.totalReceivable)" tint="blue" />
        <FPStat label="本月收款" :value="fmt0(row.totalCollected)" tint="slate" />
        <div :style="{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }">
          <span style="font-size:var(--fs-micro);color:var(--text-muted);white-space:nowrap">本月结余</span>
          <span :style="{ fontSize: '19px', fontWeight: 'var(--fw-semibold)', fontFamily: 'var(--font-mono)', lineHeight: '1.1', color: balTone }">{{ fmt0(row.balanceEnd) }}</span>
        </div>
      </div>

      <!-- 结转:上月结余 jsx 686-689 -->
      <div>
        <FPSectionLabel icon="corner-down-right">结转</FPSectionLabel>
        <div class="lg-dw-row"><span class="fee">{{ prevMonth }} 月结余</span><span class="amt">{{ fmt0(row.balancePrev) }}</span></div>
      </div>

      <!-- 费用分组(仅非零,按组 + 组内小计)jsx 693-705 -->
      <div v-if="!hasFees" class="lg-dw-empty">该租户在 {{ companyName }} 暂无费用记账</div>
      <div v-for="g in feeGroups" :key="g.name">
        <div class="lg-dw-gt"><span>{{ g.name }}</span><b>{{ lgFmt(g.gsum) }}</b></div>
        <div v-for="c in g.items" :key="c.key" class="lg-dw-row">
          <span class="fee">{{ c.label }}</span><span class="amt">{{ lgFmt((row as any)[c.key]) }}</span>
        </div>
      </div>

      <!-- 备注 jsx 706-711 -->
      <div v-if="row.note">
        <FPSectionLabel icon="sticky-note">备注</FPSectionLabel>
        <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.6">{{ row.note }}</p>
      </div>
    </template>
  </FPDrawer>
</template>

<style scoped>
/* 1:1 from screen-ledger.jsx LgStyles 241-249 */
.lg-dw-empty { padding:40px 0; text-align:center; color:var(--text-disabled); font-size:13px; }
.lg-dw-gt { font-size:11.5px; font-weight:var(--fw-semibold); color:var(--text-muted); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; }
.lg-dw-gt b { color:var(--text-secondary); font-family:var(--font-mono); }
.lg-dw-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid var(--divider); font-size:12.5px; }
.lg-dw-row:last-child { border-bottom:none; }
.lg-dw-row .fee { color:var(--text-secondary); }
.lg-dw-row .amt { font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); font-weight:var(--fw-medium); }
</style>
