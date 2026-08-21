<script setup lang="ts">
// FinCompanyPicker — L1 公司选择。1:1 移植 fin-common.jsx FinCompanyPicker + .fin-pick* 样式。
// 全部汇总卡 + 各公司卡(重命名/删除) + 新增公司卡。
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import { useAuthStore } from '@/stores/auth'

export interface FinCompany { id: number | string; name: string; short?: string }

// 新增/重命名/删除公司写的是 management_company,归 master 不归 report(RBAC §5.6:
// 删公司同事务级联删该公司 monthly_ledger + report_*)。公司卡本身照常显示,只藏这三个写入口。
const auth = useAuthStore()

const props = defineProps<{
  title: string
  sub: string
  companies: FinCompany[]
  summaryOf?: (c: FinCompany) => string
}>()

const emit = defineEmits<{
  pickAll: []
  pick: [id: number | string]
  new: []
  edit: [c: FinCompany]
  delete: [c: FinCompany]
}>()

function shortOf(c: FinCompany) {
  return (c.short || c.name).slice(0, 2)
}
</script>

<template>
  <div class="fin-page">
    <div class="fin-head">
      <div class="fin-head-l">
        <div>
          <h2 class="fin-title">{{ title }}</h2>
          <p class="fin-sub">{{ sub }}</p>
        </div>
      </div>
      <div class="fin-actions">
        <Button v-if="auth.can('master:edit')" variant="filled" size="sm" @click="emit('new')">
          <template #leading><component :is="iconFor('plus')" /></template>
          新增公司
        </Button>
      </div>
    </div>

    <div class="fin-pick-grid">
      <div class="fin-pickcard all" @click="emit('pickAll')">
        <span class="fin-pc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="fin-pc-top">
          <span class="fin-pc-av"><component :is="iconFor('layers')" :size="20" /></span>
          <div>
            <div class="fin-pc-name">全部汇总</div>
            <div class="fin-pc-desc">跨 {{ companies.length }} 家公司只读求和</div>
          </div>
        </div>
        <div class="fin-pc-foot">
          <span class="fin-pc-desc" style="margin-top:0">合并查看所有管理公司</span>
        </div>
      </div>

      <div v-for="c in companies" :key="c.id" class="fin-pickcard" @click="emit('pick', c.id)">
        <span class="fin-pc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="fin-pc-top">
          <span class="fin-pc-av">{{ shortOf(c) }}</span>
          <div>
            <div class="fin-pc-name">{{ c.name }}</div>
            <div class="fin-pc-desc">{{ summaryOf ? summaryOf(c) : '独立报表' }}</div>
          </div>
        </div>
        <div v-if="auth.can('master:edit')" class="fin-pc-foot" @click.stop>
          <button class="fin-pc-act" title="重命名" @click="emit('edit', c)"><component :is="iconFor('pencil')" :size="14" /></button>
          <button class="fin-pc-act danger" title="删除公司" @click="emit('delete', c)"><component :is="iconFor('trash-2')" :size="14" /></button>
        </div>
      </div>

      <div v-if="auth.can('master:edit')" class="fin-picknew" @click="emit('new')">
        <span class="ic"><component :is="iconFor('plus')" :size="22" /></span>
        <span class="t">新增管理公司</span>
      </div>
    </div>

    <p class="fin-foot"><component :is="iconFor('info')" :size="13" />每家管理公司各自维护一份独立报表;选「全部汇总」可跨公司合并查看(只读)。常驻报表项无数据时留空,可在正文中为大类添加子类。</p>
  </div>
</template>

<style scoped>
.fin-page { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.fin-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.fin-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.fin-title { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.fin-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

.fin-pick-grid { flex:0 0 auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(264px,1fr)); gap:16px; }
.fin-pickcard { position:relative; display:flex; flex-direction:column; min-height:158px; padding:20px 22px; box-sizing:border-box; cursor:pointer; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.fin-pickcard:hover { border-color:var(--border-strong); box-shadow:0 8px 24px rgba(28,28,28,.10); transform:translateY(-2px); }
.fin-pickcard.all { background:var(--accent-slate); border-color:transparent; }
.fin-pc-top { display:flex; align-items:center; gap:13px; }
.fin-pc-av { width:46px; height:46px; flex:0 0 auto; border-radius:50%; background:var(--accent-blue); color:var(--hue-blue); display:grid; place-items:center; font-size:15px; font-weight:var(--fw-semibold); }
.fin-pickcard.all .fin-pc-av { background:#fff; color:var(--hue-blue); }
.fin-pc-name { font-size:15.5px; font-weight:var(--fw-semibold); color:var(--text-primary); line-height:1.3; }
.fin-pc-desc { font-size:12px; color:var(--text-muted); margin-top:3px; }
.fin-pc-go { position:absolute; top:20px; right:20px; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; color:var(--text-disabled); background:var(--surface-card); opacity:0; transform:translateX(-4px); transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.fin-pickcard:hover .fin-pc-go { opacity:1; transform:translateX(0); background:var(--ink-900); color:#fff; }
.fin-pc-foot { display:flex; align-items:center; gap:6px; margin-top:auto; padding-top:16px; }
.fin-pc-act { width:30px; height:30px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle); background:var(--surface-white); color:var(--text-muted); display:grid; place-items:center; cursor:pointer; transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.fin-pc-act:hover { background:var(--bg-hover); color:var(--text-primary); }
.fin-pc-act.danger:hover { background:rgb(255,238,237); color:var(--hue-red); border-color:rgba(255,59,48,.3); }
.fin-picknew { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; min-height:158px; cursor:pointer; background:transparent; border:1px dashed var(--border-strong); border-radius:var(--radius-lg); color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.fin-picknew:hover { background:var(--accent-blue); color:var(--hue-blue); border-color:var(--hue-blue); }
.fin-picknew .ic { width:44px; height:44px; border-radius:50%; background:var(--surface-card); display:grid; place-items:center; transition:background var(--dur-fast) var(--ease-standard); }
.fin-picknew:hover .ic { background:#fff; }
.fin-picknew .t { font-size:13.5px; font-weight:var(--fw-semibold); }

.fin-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
