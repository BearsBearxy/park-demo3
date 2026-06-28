<script setup lang="ts">
// 当前公司徽标(①/② 页头,点击返回⓪切换) — 1:1 from screen-ledger.jsx LgCompanyBadge (337-345).
import { iconFor } from '@/components/ds/icon'

defineProps<{ name: string; short: string }>()
const emit = defineEmits<{ switch: [] }>()
</script>

<template>
  <button class="lg-cobadge" @click="emit('switch')" title="切换记账公司">
    <span class="av">{{ (short || name).slice(0, 2) }}</span>
    <span class="nm">{{ name }}</span>
    <span class="sw"><component :is="iconFor('repeat')" :size="12" />切换</span>
  </button>
</template>

<style scoped>
/* 1:1 from screen-ledger.jsx LgStyles 111-117 */
.lg-cobadge { display:inline-flex; align-items:center; gap:9px; height:36px; padding:0 12px 0 7px; cursor:pointer;
  background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full);
  transition:background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.lg-cobadge:hover { background:var(--bg-hover); border-color:var(--border-strong); }
.lg-cobadge .av { width:24px; height:24px; flex:0 0 auto; border-radius:50%; background:var(--ink-900); color:#fff; display:grid; place-items:center; font-size:10px; font-weight:var(--fw-semibold); }
.lg-cobadge .nm { font-size:12.5px; font-weight:var(--fw-semibold); color:var(--text-primary); white-space:nowrap; max-width:180px; overflow:hidden; text-overflow:ellipsis; }
.lg-cobadge .sw { display:inline-flex; align-items:center; gap:3px; font-size:11px; color:var(--hue-blue); font-weight:var(--fw-medium); padding-left:5px; border-left:1px solid var(--divider); }
</style>
