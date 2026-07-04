<script setup lang="ts">
// ⓪ 选择记账公司页 — 1:1 from screen-ledger.jsx LgCompanyPicker (295-334).
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import type { CompanyDTO } from '@/types/ledger'

defineProps<{
  companies: CompanyDTO[]
  // per-company derived stats keyed by id (from ledgerApi.overview): 记账租户 + 当前月应收
  statsById: Record<number, { tenants: number; recv: number }>
  curMonth: number
}>()
const emit = defineEmits<{ pick: [id: number]; 'new-company': []; 'delete-company': [c: CompanyDTO] }>()

// jsx lgWan: ¥X.X 万
function lgWan(v: number): string {
  const neg = v < 0
  return (neg ? '−¥' : '¥') + (Math.abs(v) / 10000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' 万'
}
</script>

<template>
  <div class="lg-page">
    <div class="lg-head">
      <div class="lg-head-l">
        <div>
          <h2 class="lg-title">月度台账</h2>
          <p class="lg-sub">选择记账公司进入台账 · 每家公司各自维护一份独立总表,同一租户可向多家公司交费</p>
        </div>
      </div>
      <div class="lg-head-actions">
        <Button variant="filled" size="sm" @click="emit('new-company')">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新建公司
        </Button>
      </div>
    </div>

    <div class="lg-pick-grid">
      <div v-for="c in companies" :key="c.id" class="lg-pickcard" @click="emit('pick', c.id)">
        <span class="lg-pc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="lg-pc-top">
          <span class="lg-pc-av">{{ (c.short || c.name).slice(0, 2) }}</span>
          <span class="lg-pc-name">{{ c.name }}</span>
        </div>
        <div class="lg-pc-stats">
          <div class="lg-pc-stat">
            <div class="l">记账租户</div>
            <div class="v">{{ statsById[c.id]?.tenants ?? 0 }} <span class="u">户</span></div>
          </div>
          <div class="lg-pc-stat">
            <div class="l">{{ curMonth }} 月应收</div>
            <div class="v muted">{{ lgWan(statsById[c.id]?.recv ?? 0) }}</div>
          </div>
          <button class="lg-pc-del" title="删除公司" @click.stop="emit('delete-company', c)">
            <component :is="iconFor('trash-2')" :size="14" />
          </button>
        </div>
      </div>
      <div class="lg-picknew" @click="emit('new-company')">
        <span class="ic"><component :is="iconFor('plus')" :size="22" /></span>
        <span class="t">新建管理公司</span>
      </div>
    </div>

    <p class="lg-foot">
      <component :is="iconFor('info')" :size="13" />
      进入某公司台账后,不归本公司收的费用列保持留空;点击页头公司徽标可随时返回此页切换公司。
    </p>
  </div>
</template>

<style scoped>
/* 1:1 from screen-ledger.jsx LgStyles 70-108, 217-218 */
.lg-page { display:flex; flex-direction:column; gap:16px; width:100%; font-family:var(--font-sans); color:var(--text-primary); }
.lg-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lg-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.lg-title { margin:0; font:var(--type-h2); color:var(--text-primary); }
.lg-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lg-head-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

.lg-pick-grid { flex:0 0 auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(280px,1fr)); gap:16px; }
.lg-pickcard { display:flex; flex-direction:column; min-height:168px; padding:22px; box-sizing:border-box; cursor:pointer;
  background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); position:relative;
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.lg-pickcard:hover { border-color:var(--border-strong); box-shadow:0 8px 24px rgba(28,28,28,.10); transform:translateY(-2px); }
.lg-pc-top { display:flex; align-items:center; gap:13px; }
.lg-pc-av { width:48px; height:48px; flex:0 0 auto; border-radius:50%; background:var(--accent-blue); color:var(--hue-blue);
  display:grid; place-items:center; font-size:16px; font-weight:var(--fw-semibold); }
.lg-pc-name { font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); line-height:1.3; }
.lg-pc-go { position:absolute; top:22px; right:22px; width:30px; height:30px; border-radius:50%; display:grid; place-items:center;
  color:var(--text-disabled); background:var(--surface-card); opacity:0; transform:translateX(-4px);
  transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lg-pickcard:hover .lg-pc-go { opacity:1; transform:translateX(0); background:var(--ink-900); color:#fff; }
.lg-pc-stats { display:flex; gap:28px; margin-top:auto; padding-top:18px; }
.lg-pc-stat .l { font-size:11.5px; color:var(--text-muted); margin-bottom:5px; }
.lg-pc-stat .v { font-size:18px; font-weight:var(--fw-semibold); color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.lg-pc-stat .v.muted { color:var(--text-secondary); }
.lg-pc-stat .v .u { font-size:12px; font-weight:400; color:var(--text-muted); }
.lg-pc-del { margin-left:auto; align-self:flex-end; width:30px; height:30px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);
  background:var(--surface-white); color:var(--text-muted); display:grid; place-items:center; cursor:pointer; opacity:0;
  transition:opacity var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.lg-pickcard:hover .lg-pc-del { opacity:1; }
.lg-pc-del:hover { background:rgb(255,238,237); color:var(--hue-red); border-color:rgba(255,59,48,.3); }
.lg-picknew { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; min-height:168px; cursor:pointer;
  background:transparent; border:1px dashed var(--border-strong); border-radius:var(--radius-lg); color:var(--text-secondary);
  transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.lg-picknew:hover { background:var(--accent-blue); color:var(--hue-blue); border-color:var(--hue-blue); }
.lg-picknew .ic { width:46px; height:46px; border-radius:50%; background:var(--surface-card); display:grid; place-items:center; transition:background var(--dur-fast) var(--ease-standard); }
.lg-picknew:hover .ic { background:#fff; }
.lg-picknew .t { font-size:13.5px; font-weight:var(--fw-semibold); }

.lg-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
