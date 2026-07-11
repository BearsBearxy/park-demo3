<script setup lang="ts">
// 统一附表页头 — 共享脚手架。返回 + 标题 + 年份徽标 + 编辑模式徽标 + 编辑/完成。
// 1:1 移植 ledger-common.jsx LedgerHeader(.lc-head/.lc-yearbadge/.lc-editbadge)。
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'

defineProps<{
  icon: string
  title: string
  sub?: string
  year: number
  edit: boolean
}>()
const emit = defineEmits<{ back: []; 'toggle-edit': [] }>()
</script>

<template>
  <div class="lc-head">
    <div class="lc-head-l">
      <button class="lc-back" @click="emit('back')" title="返回年份选择">
        <component :is="iconFor('arrow-left')" :size="17" />
      </button>
      <div>
        <h2 class="lc-title"><component :is="iconFor(icon)" :size="20" />{{ title }}</h2>
        <p v-if="sub" class="lc-sub">{{ sub }}</p>
      </div>
    </div>
    <div class="lc-head-actions">
      <span class="lc-yearbadge"><component :is="iconFor('calendar')" :size="14" />{{ year }} 年</span>
      <span v-if="edit" class="lc-editbadge"><component :is="iconFor('pencil')" :size="13" />编辑模式</span>
      <slot v-if="edit" name="edit-actions" />
      <!-- idle-actions:仅非编辑态(spec 2026-07-11 导入流程统一:导入/导出常驻非编辑态,编辑态只留行级操作) -->
      <slot v-if="!edit" name="idle-actions" />
      <slot name="static-actions" />
      <Button variant="filled" size="sm" @click="emit('toggle-edit')">
        <template #leading><component :is="iconFor(edit ? 'check' : 'pencil')" :size="14" /></template>
        {{ edit ? '完成' : '编辑表格' }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from ledger-common.jsx LedgerCommonStyles (.lc-head 段,44-55) */
.lc-head { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lc-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.lc-back { width:36px; height:36px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lc-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.lc-title { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); display:flex; align-items:center; gap:10px; }
.lc-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lc-head-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.lc-yearbadge { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:var(--accent-blue); color:var(--hue-blue); font-size:12.5px; font-weight:var(--fw-semibold); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.lc-editbadge { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:rgb(255,243,230); color:var(--hue-orange); font-size:12.5px; font-weight:var(--fw-medium); white-space:nowrap; }
</style>
