<script setup lang="ts">
// 「数据待录入」统一空态卡(spec 通用降级规则②):说明缺什么、去哪录,深链到录入屏,不画假图。
// to 为路由路径(如 '/contracts');不传则纯提示(移植 ana-charts.jsx Empty 的语义)。
defineProps<{ label?: string; hint?: string; to?: string; toText?: string }>()
</script>

<template>
  <div class="ana-empty">
    <div class="lb">{{ label || '当前筛选下暂无数据' }}</div>
    <div v-if="hint" class="ht">{{ hint }}</div>
    <RouterLink v-if="to" class="go" :to="to">{{ toText || '去录入' }} →</RouterLink>
    <slot />
  </div>
</template>

<style scoped>
.ana-empty { padding: 44px 0; text-align: center; color: var(--text-disabled); }
.lb { font-size: 13.5px; color: var(--text-muted); }
.ht { font-size: 12px; margin-top: 4px; }
.go { display: inline-block; margin-top: 10px; font-size: 12px; color: var(--text-link); text-decoration: none; }
.go:hover { text-decoration: underline; }
</style>
