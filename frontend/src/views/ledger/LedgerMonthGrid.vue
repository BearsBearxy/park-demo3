<script setup lang="ts">
// ① 年/月选择 — 1:1 from screen-ledger.jsx month-selection branch (462-521).
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import KpiCard from '@/components/ds/KpiCard.vue'
import LedgerCompanyBadge from './LedgerCompanyBadge.vue'
import type { LedgerOverviewDTO, MonthMeta } from '@/types/ledger'

const props = defineProps<{
  overview: LedgerOverviewDTO
  companyName: string
  companyShort: string
  year: number
  maxYear: number // 当前年:年份胶囊上限
}>()
const emit = defineEmits<{
  'switch-company': []
  'back': []                    // 返回年份门
  'year': [year: number]
  'pick-month': [month: number]
}>()

// jsx lgWan
function lgWan(v: number): string {
  const neg = v < 0
  return (neg ? '−¥' : '¥') + (Math.abs(v) / 10000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' 万'
}

// month meta keyed by month number; absent month → empty card (jsx 497)
const metaByMonth = computed<Record<number, MonthMeta>>(() => {
  const m: Record<number, MonthMeta> = {}
  for (const x of props.overview.months) m[x.month] = x
  return m
})
</script>

<template>
  <div class="lg-page">
    <div class="lg-head">
      <div class="lg-head-l">
        <button class="lg-back" title="返回年份选择" @click="emit('back')"><component :is="iconFor('arrow-left')" :size="16" /></button>
        <div>
          <h2 class="lg-title">月度台账</h2>
          <p class="lg-sub">{{ companyName }} · <span class="mono">{{ year }} 年</span> · 按月归集一行一租户的应收与收款明细</p>
        </div>
      </div>
      <div class="lg-head-actions">
        <LedgerCompanyBadge :name="companyName" :short="companyShort" @switch="emit('switch-company')" />
        <span class="lg-ypill">
          <button @click="emit('year', year - 1)" title="上一年"><component :is="iconFor('chevron-left')" :size="15" /></button>
          <span class="v">{{ year }}</span>
          <button @click="emit('year', Math.min(year + 1, maxYear))" title="下一年" :disabled="year >= maxYear"><component :is="iconFor('chevron-right')" :size="15" /></button>
        </span>
        <!-- 导入 Excel 改到月度宽表(LedgerWideTable):彼处公司+年+月皆已选,可定向 upsert -->
      </div>
    </div>

    <div class="lg-kpis">
      <KpiCard tint="slate" label="已录入月份"><span class="lg-kval">{{ overview.monthsWithData }} / 12</span>
        <template #icon><component :is="iconFor('calendar-check')" :size="16" /></template>
      </KpiCard>
      <KpiCard tint="blue" label="全年累计应收"><span class="lg-kval">{{ lgWan(overview.ytdRecv) }}</span>
        <template #icon><component :is="iconFor('wallet')" :size="16" /></template>
      </KpiCard>
      <KpiCard tint="sky" label="月均应收"><span class="lg-kval">{{ lgWan(overview.avgRecv) }}</span>
        <template #icon><component :is="iconFor('trending-up')" :size="16" /></template>
      </KpiCard>
      <KpiCard tint="cyan" label="记账租户"><span class="lg-kval">{{ overview.activeTenants }} 户</span>
        <template #icon><component :is="iconFor('users')" :size="16" /></template>
      </KpiCard>
    </div>

    <div class="lg-mlabel">{{ year }} 年 <span class="hint">· {{ companyName }} · 点击月份进入台账;空月进入后可录入 / 导入 / 从上月复制</span></div>
    <div class="lg-mgrid">
      <template v-for="m in 12" :key="m">
        <!-- 空月:虚线卡,点击进入开始记账(宽表空表,经 编辑·添加租户行/导入/从上月复制 录入) -->
        <div v-if="!metaByMonth[m] || metaByMonth[m].status === 'empty'" class="lg-mcard empty"
             @click="emit('pick-month', m)">
          <div class="lg-mc-head"><div class="lg-mc-month">{{ m }}<span class="u">月</span></div></div>
          <div class="lg-mc-empty">暂无数据 · 点击开始记账</div>
        </div>
        <!-- 已录/当前月:可点 -->
        <div v-else
             class="lg-mcard" :class="{ cur: metaByMonth[m].status === 'current' }"
             @click="emit('pick-month', m)">
          <div class="lg-mc-head">
            <div class="lg-mc-month">{{ m }}<span class="u">月</span></div>
            <span v-if="metaByMonth[m].status === 'current'" class="lg-mc-tag">当前</span>
            <span v-else class="lg-mc-dot"></span>
          </div>
          <div class="lg-mc-amt">{{ lgWan(metaByMonth[m].recv) }}</div>
          <div class="lg-mc-sub">{{ metaByMonth[m].status === 'current' ? '进行中' : '已录入' }} · {{ metaByMonth[m].tenants }} 户租户</div>
        </div>
      </template>
    </div>

    <p class="lg-foot">
      <component :is="iconFor('info')" :size="13" />
      每家管理公司各自维护一份独立总表;同一租户可向多家公司交费,不归本公司收的费用列保持留空。应收合计 = 各费用项之和。
    </p>
  </div>
</template>

<style scoped>
/* 1:1 from screen-ledger.jsx LgStyles 70-81, 143-173, 217-218 */
.lg-page { display:flex; flex-direction:column; gap:16px; width:100%; font-family:var(--font-sans); color:var(--text-primary); }
.lg-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lg-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.lg-title { margin:0; font:var(--type-h2); color:var(--text-primary); }
.lg-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lg-sub .mono { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.lg-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lg-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.lg-head-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

/* 年份切换胶囊 */
.lg-ypill { display:inline-flex; align-items:center; gap:2px; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:3px; }
.lg-ypill button { width:28px; height:28px; border:none; background:transparent; border-radius:var(--radius-full); cursor:pointer; color:var(--text-secondary); display:grid; place-items:center; transition:background var(--dur-fast) var(--ease-standard); }
.lg-ypill button:hover { background:var(--bg-hover); color:var(--text-primary); }
.lg-ypill button:disabled { opacity:.4; cursor:not-allowed; }
.lg-ypill .v { font-size:13.5px; font-weight:var(--fw-semibold); color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; padding:0 8px; white-space:nowrap; }

/* KPI 概览 */
.lg-kpis { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
.lg-kpis .lg-kval { white-space:nowrap; font-size:clamp(14px, 1.5vw, 23px); }

/* 月份卡片网格 */
.lg-mlabel { flex:0 0 auto; display:flex; align-items:center; gap:8px; font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-mlabel .hint { font-size:12px; font-weight:var(--fw-regular); color:var(--text-muted); }
.lg-mgrid { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; }
.lg-mcard { position:relative; display:flex; flex-direction:column; min-height:120px; padding:16px 18px; box-sizing:border-box;
  background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); cursor:pointer;
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.lg-mcard:hover { border-color:var(--border-strong); box-shadow:0 4px 16px rgba(28,28,28,.07); }
.lg-mcard.cur { background:var(--accent-blue); border-color:transparent; }
.lg-mcard.cur:hover { box-shadow:0 8px 22px rgba(28,28,28,.12); }
.lg-mcard.empty { background:transparent; border-style:dashed; }
.lg-mcard.empty:hover { border-color:var(--hue-blue); box-shadow:none; }
.lg-mcard.empty:hover .lg-mc-empty { color:var(--hue-blue); }
.lg-mc-head { display:flex; align-items:flex-start; justify-content:space-between; }
.lg-mc-month { font-size:23px; font-weight:var(--fw-semibold); letter-spacing:-0.02em; line-height:1; color:var(--text-primary); }
.lg-mc-month .u { font-size:13px; font-weight:var(--fw-medium); color:var(--text-muted); margin-left:3px; }
.lg-mc-dot { width:7px; height:7px; border-radius:50%; background:var(--status-info); flex:0 0 auto; margin-top:6px; }
.lg-mc-tag { font-size:10.5px; font-weight:var(--fw-semibold); padding:2px 9px; border-radius:var(--radius-full); background:var(--ink-900); color:#fff; }
.lg-mc-amt { margin-top:auto; font-size:17px; font-weight:var(--fw-semibold); letter-spacing:-0.01em; font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); }
.lg-mc-sub { font-size:11.5px; color:var(--text-muted); margin-top:5px; }
.lg-mc-empty { margin-top:auto; font-size:12.5px; color:var(--text-disabled); }

.lg-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
