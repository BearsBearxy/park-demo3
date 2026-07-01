<script setup lang="ts">
// FinMonthGrid — L2 月历。1:1 移植 fin-common.jsx FinMonthGrid + .fin-mgrid/.fin-mcard 样式。
// 年切换胶囊 + 12 月卡;当前月/hasData/预览均由传入 months 判定(不耦合 new Date())。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'

// 每月一格:hasData=是否已录入;current=是否当前进行中月;preview=月卡展示金额(已格式化字符串)
export interface FinMonthMeta { month: number; hasData: boolean; current?: boolean; preview?: string }

const props = defineProps<{
  companyName: string | null   // null = 全部汇总
  year: number
  months: FinMonthMeta[]       // 长度 12(month 1..12);缺项按无数据处理
  maxYear: number
}>()

const emit = defineEmits<{
  pick: [m: number]
  back: []
  year: [y: number]
}>()

const title = computed(() => props.companyName ?? '全部汇总')
const byMonth = computed(() => {
  const map = new Map<number, FinMonthMeta>()
  for (const m of props.months) map.set(m.month, m)
  return map
})
function meta(m: number): FinMonthMeta {
  return byMonth.value.get(m) ?? { month: m, hasData: false }
}
</script>

<template>
  <div class="fin-page">
    <div class="fin-head">
      <div class="fin-head-l">
        <button class="fin-back" @click="emit('back')" title="返回公司选择"><component :is="iconFor('arrow-left')" :size="16" /></button>
        <div>
          <h2 class="fin-title">{{ title }}</h2>
          <p class="fin-sub">选择年 / 月,进入对应期间报表</p>
        </div>
      </div>
      <div class="fin-actions">
        <button class="fin-cobadge" @click="emit('back')" title="切换管理公司">
          <span class="av" :class="{ all: companyName === null }">
            <component v-if="companyName === null" :is="iconFor('layers')" :size="13" />
            <template v-else>{{ companyName.slice(0, 2) }}</template>
          </span>
          <span class="nm">{{ companyName === null ? '全部汇总' : companyName }}</span>
          <span class="sw"><component :is="iconFor('repeat')" :size="12" />切换</span>
        </button>
        <span class="fin-ypill">
          <button @click="emit('year', year - 1)" title="上一年"><component :is="iconFor('chevron-left')" :size="15" /></button>
          <span class="v">{{ year }}</span>
          <button @click="emit('year', Math.min(year + 1, maxYear))" :disabled="year >= maxYear" title="下一年"><component :is="iconFor('chevron-right')" :size="15" /></button>
        </span>
      </div>
    </div>

    <div class="fin-mlabel">{{ year }} 年 <span class="hint">· 点击已录入的月份查看报表</span></div>

    <div class="fin-mgrid">
      <template v-for="m in 12" :key="m">
        <div v-if="!meta(m).hasData" class="fin-mcard empty">
          <div class="fin-mc-head"><div class="fin-mc-month">{{ m }}<span class="u">月</span></div></div>
          <div class="fin-mc-empty">暂无数据</div>
        </div>
        <div v-else class="fin-mcard" :class="{ cur: meta(m).current }" @click="emit('pick', m)">
          <div class="fin-mc-head">
            <div class="fin-mc-month">{{ m }}<span class="u">月</span></div>
            <span v-if="meta(m).current" class="fin-mc-tag">当前</span>
            <span v-else class="fin-mc-dot"></span>
          </div>
          <div v-if="meta(m).preview != null" class="fin-mc-amt">{{ meta(m).preview }}</div>
          <div class="fin-mc-sub">{{ meta(m).current ? '进行中' : '已录入' }}</div>
        </div>
      </template>
    </div>

    <p class="fin-foot"><component :is="iconFor('info')" :size="13" />尚未录入数据的月份留空显示「暂无数据」;切换年份查看历史期间。</p>
  </div>
</template>

<style scoped>
.fin-page { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.fin-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.fin-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.fin-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.fin-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.fin-title { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.fin-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

/* 当前公司徽标 */
.fin-cobadge { display:inline-flex; align-items:center; gap:9px; height:36px; padding:0 12px 0 7px; cursor:pointer; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); transition:background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.fin-cobadge:hover { background:var(--bg-hover); border-color:var(--border-strong); }
.fin-cobadge .av { width:24px; height:24px; flex:0 0 auto; border-radius:50%; background:var(--ink-900); color:#fff; display:grid; place-items:center; font-size:10px; font-weight:var(--fw-semibold); }
.fin-cobadge .av.all { background:var(--hue-blue); }
.fin-cobadge .nm { font-size:12.5px; font-weight:var(--fw-semibold); color:var(--text-primary); white-space:nowrap; max-width:200px; overflow:hidden; text-overflow:ellipsis; }
.fin-cobadge .sw { display:inline-flex; align-items:center; gap:3px; font-size:11px; color:var(--hue-blue); font-weight:var(--fw-medium); padding-left:5px; border-left:1px solid var(--divider); }

/* 年份切换胶囊 */
.fin-ypill { display:inline-flex; align-items:center; gap:2px; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:3px; }
.fin-ypill button { width:28px; height:28px; border:none; background:transparent; border-radius:var(--radius-full); cursor:pointer; color:var(--text-secondary); display:grid; place-items:center; transition:background var(--dur-fast) var(--ease-standard); }
.fin-ypill button:hover:not(:disabled) { background:var(--bg-hover); color:var(--text-primary); }
.fin-ypill button:disabled { opacity:.4; cursor:not-allowed; }
.fin-ypill .v { font-size:13.5px; font-weight:var(--fw-semibold); color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; padding:0 8px; white-space:nowrap; }

.fin-mlabel { flex:0 0 auto; display:flex; align-items:center; gap:8px; font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-mlabel .hint { font-size:12px; font-weight:var(--fw-regular); color:var(--text-muted); }
.fin-mgrid { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; }
.fin-mcard { position:relative; display:flex; flex-direction:column; min-height:116px; padding:16px 18px; box-sizing:border-box; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); cursor:pointer; transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.fin-mcard:hover { border-color:var(--border-strong); box-shadow:0 4px 16px rgba(28,28,28,.07); }
.fin-mcard.cur { background:var(--accent-blue); border-color:transparent; }
.fin-mcard.cur:hover { box-shadow:0 8px 22px rgba(28,28,28,.12); }
.fin-mcard.empty { background:transparent; border-style:dashed; cursor:not-allowed; }
.fin-mcard.empty:hover { border-color:var(--border-subtle); box-shadow:none; }
.fin-mc-head { display:flex; align-items:flex-start; justify-content:space-between; }
.fin-mc-month { font-size:23px; font-weight:var(--fw-semibold); letter-spacing:-0.02em; line-height:1; color:var(--text-primary); }
.fin-mc-month .u { font-size:13px; font-weight:var(--fw-medium); color:var(--text-muted); margin-left:3px; }
.fin-mc-dot { width:7px; height:7px; border-radius:50%; background:var(--status-info); flex:0 0 auto; margin-top:6px; }
.fin-mc-tag { font-size:10.5px; font-weight:var(--fw-semibold); padding:2px 9px; border-radius:var(--radius-full); background:var(--ink-900); color:#fff; }
.fin-mc-amt { margin-top:auto; font-size:16px; font-weight:var(--fw-semibold); letter-spacing:-0.01em; font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); }
.fin-mc-sub { font-size:11.5px; color:var(--text-muted); margin-top:5px; }
.fin-mc-empty { margin-top:auto; font-size:12.5px; color:var(--text-disabled); }

.fin-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
