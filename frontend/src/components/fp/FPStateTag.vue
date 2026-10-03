<script setup lang="ts">
/**
 * 页面状态（十件 ⑥，画布 01-A 卡4 / 06-B ⑥ / 03-B）：整页处在什么状态 → 贴在标题或期间选择旁的 22 高标签，不另起一行。
 *
 *   <FPStateTag tone="warn">本月未生成</FPStateTag>            黄底 + 圆点
 *   <FPStateTag tone="edit">编辑中 · 3 处改动</FPStateTag>     橙底 + 笔
 *   <FPStateTag tone="muted">显示 2026-08 · 9 月无数据</FPStateTag>  灰底
 */
import { iconFor } from '@/components/ds/icon'

defineProps<{ tone: 'warn' | 'edit' | 'muted' }>()
</script>

<template>
  <span class="fp-state" :class="tone">
    <i v-if="tone === 'warn'" class="dot" aria-hidden="true" />
    <component :is="iconFor('pencil')" v-else-if="tone === 'edit'" :size="12" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.fp-state {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: 6px;
  font-size: var(--fs-label);
  font-weight: var(--fw-medium);
  line-height: 1;
  white-space: nowrap;
}
.warn { background: var(--caution-soft); color: var(--caution-text); }
.edit { background: var(--warn-soft); color: var(--orange-text); }
.muted { background: var(--ink-050); color: var(--text-secondary); }
.dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
</style>
