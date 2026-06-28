<template>
  <div class="placeholder-wrap">
    <div class="placeholder-card">
      <p class="layer-label">{{ route.meta.layerLabel }}</p>
      <h1 class="page-name">{{ route.meta.page }}</h1>
      <p class="hint">（本屏将在后续阶段实现）</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<style scoped>
.placeholder-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-app);
}
.placeholder-card {
  padding: var(--space-8) var(--space-10);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  text-align: center;
  min-width: 280px;
}
.layer-label {
  font-size: var(--fs-label);
  color: var(--text-muted);
  margin: 0 0 var(--space-2);
}
.page-name {
  font-size: var(--fs-h2);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  margin: 0 0 var(--space-4);
}
.hint {
  font-size: var(--fs-label);
  color: var(--text-muted);
  margin: 0;
}
</style>
