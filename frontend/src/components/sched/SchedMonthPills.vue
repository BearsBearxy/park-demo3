<script setup lang="ts">
// 月份选择胶囊 — 共享脚手架(按月录入附表复用)。
// 1:1 移植 ledger-common.jsx LedgerMonthPills(.lc-mpills/.lc-mpill):
// 12 等分 sunken 轨 + 白色 active 药丸 + has(m) 为假时淡显「暂无数据」月。
defineProps<{
  value: number
  has?: (m: number) => boolean   // 该月有数据?无则淡显
}>()
const emit = defineEmits<{ change: [m: number] }>()
const months = Array.from({ length: 12 }, (_, i) => i + 1)
</script>

<template>
  <div class="lc-mpills" role="tablist">
    <button
      v-for="m in months"
      :key="m"
      role="tab"
      :aria-selected="m === value"
      :class="['lc-mpill', { on: m === value, empty: has && !has(m) }]"
      :title="has && !has(m) ? '暂无数据' : undefined"
      @click="emit('change', m)"
    >{{ m }}月</button>
  </div>
</template>

<style scoped>
/* 1:1 from ledger-common.jsx LedgerCommonStyles (.lc-mpills 段,57-62) */
.lc-mpills { display:grid; grid-template-columns:repeat(12, minmax(0,1fr)); gap:2px; padding:3px; background:var(--bg-sunken, var(--surface-sunken)); border-radius:var(--radius-full); box-sizing:border-box; }
.lc-mpill { position:relative; height:30px; border:none; background:transparent; border-radius:var(--radius-full); cursor:pointer; font-family:var(--font-sans); font-size:12.5px; color:var(--text-muted); display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lc-mpill:hover:not(.on) { color:var(--text-primary); }
.lc-mpill.on { background:var(--surface-white); color:var(--text-primary); font-weight:var(--fw-semibold); box-shadow:var(--shadow-pill, 0 1px 4px rgba(28,28,28,.12)); }
.lc-mpill.empty { color:var(--text-disabled); }
</style>
