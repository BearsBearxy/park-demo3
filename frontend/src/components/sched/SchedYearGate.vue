<script setup lang="ts">
// ⓪ 年份选择层 — 共享附表脚手架(附表 7/8/10/11/12 复用)。
// 1:1 移植 sched-common.jsx SchedYearGate 的 .sm-gate/.sm-ycard 样式与结构,
// 去掉年份增删管理(managing/add/del):年份范围由后端 overview 确定性派生。
import { iconFor } from '@/components/ds/icon'

export interface YearCard {
  year: number
  hasData: boolean
  metric: string   // 有数据时显示的主指标,如 "¥123.4万"
  label: string    // metric 下方说明,如 "全年电费收益 · 26 条"
}

defineProps<{
  icon: string
  title: string
  sub: string
  years: YearCard[]
  current: number  // 最新年(蓝高亮 + 「最新」角标)
  footer?: string
}>()
const emit = defineEmits<{ pick: [year: number] }>()
</script>

<template>
  <div class="sm-gate">
    <div class="sm-gate-head">
      <div>
        <h2 class="sm-gate-title">
          <span class="ic"><component :is="iconFor(icon)" :size="18" /></span>
          {{ title }}
        </h2>
        <p class="sm-gate-sub">{{ sub }}</p>
      </div>
    </div>
    <div class="sm-gate-labelrow">
      <div class="sm-gate-label">
        <component :is="iconFor('calendar')" :size="16" />选择年份
        <span class="hint">· 点击进入对应年份的明细表</span>
      </div>
    </div>
    <div class="sm-gate-grid">
      <div
        v-for="y in years"
        :key="y.year"
        :class="['sm-ycard', { cur: y.year === current }]"
        @click="emit('pick', y.year)"
      >
        <span class="sm-yc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="sm-yc-head">
          <div class="sm-yc-year">{{ y.year }}<span class="u">年</span></div>
          <span v-if="y.year === current" class="sm-yc-tag">最新</span>
        </div>
        <div v-if="y.hasData" class="sm-yc-foot">
          <div class="sm-yc-metric">{{ y.metric }}</div>
          <div class="sm-yc-mlabel">{{ y.label }}</div>
        </div>
        <div v-else class="sm-yc-wait">
          <component :is="iconFor('file-plus')" :size="14" />待录入 · 进入后可录入
        </div>
      </div>
    </div>
    <p v-if="footer" class="sm-foot"><component :is="iconFor('info')" :size="13" />{{ footer }}</p>
  </div>
</template>

<style scoped>
/* 1:1 from sched-common.jsx SchedStyles (.sm-gate / .sm-ycard 段,139-178) */
.sm-gate { display:flex; flex-direction:column; gap:18px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.sm-gate-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.sm-gate-title { margin:0; display:flex; align-items:center; gap:11px; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.sm-gate-title .ic { width:34px; height:34px; border-radius:10px; background:var(--surface-sunken); display:grid; place-items:center; color:var(--text-secondary); flex:0 0 auto; }
.sm-gate-sub { margin:6px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.sm-gate-labelrow { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.sm-gate-label { flex:0 0 auto; display:flex; align-items:center; gap:8px; font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.sm-gate-label .hint { font-size:12px; font-weight:var(--fw-regular); color:var(--text-muted); }

.sm-gate-grid { flex:0 0 auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(238px,1fr)); gap:16px; }
.sm-ycard { position:relative; display:flex; flex-direction:column; min-height:152px; padding:21px 23px; box-sizing:border-box; cursor:pointer; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.sm-ycard:hover { border-color:var(--border-strong); box-shadow:0 8px 24px rgba(28,28,28,.10); transform:translateY(-2px); }
.sm-ycard.cur { background:var(--accent-blue); border-color:transparent; }
.sm-ycard.cur:hover { box-shadow:0 10px 26px rgba(28,28,28,.13); }
.sm-yc-head { display:flex; align-items:flex-start; justify-content:space-between; }
.sm-yc-year { font-size:34px; font-weight:var(--fw-semibold); letter-spacing:-0.02em; line-height:1; color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.sm-yc-year .u { font-size:14px; font-weight:var(--fw-medium); color:var(--text-muted); margin-left:4px; font-family:var(--font-sans); }
.sm-yc-tag { font-size:10.5px; font-weight:var(--fw-semibold); padding:2px 9px; border-radius:var(--radius-full); background:var(--ink-900); color:#fff; }
.sm-yc-go { position:absolute; top:21px; right:21px; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; color:var(--text-disabled); background:var(--surface-card); opacity:0; transform:translateX(-4px); transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.sm-ycard:hover .sm-yc-go { opacity:1; transform:translateX(0); background:var(--ink-900); color:#fff; }
.sm-yc-foot { margin-top:auto; }
.sm-yc-metric { font-size:19px; font-weight:var(--fw-semibold); font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); letter-spacing:-0.01em; white-space:nowrap; }
.sm-yc-mlabel { font-size:11.5px; color:var(--text-muted); margin-top:5px; }
.sm-yc-wait { margin-top:auto; font-size:12.5px; color:var(--text-disabled); display:inline-flex; align-items:center; gap:6px; }

.sm-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
