<script setup lang="ts">
// 方法/口径说明脚注(移植 ana-charts.jsx MethodNote)。
import { iconFor } from '@/components/ds/icon'
</script>

<template>
  <p class="ana-note">
    <span class="ic"><component :is="iconFor('flask-conical')" :size="13" /></span>
    <span><slot /></span>
  </p>
</template>

<style scoped>
.ana-note { font-size: 11px; color: var(--text-muted); margin: 10px 0 0; display: flex; gap: 6px; line-height: 1.5; }
.ic { flex: 0 0 auto; margin-top: 1px; }
</style>
