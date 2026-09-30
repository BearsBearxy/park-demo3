<script setup lang="ts">
/**
 * 就地标记（十件 ①，画布 01-A 卡1 / 06-B ①）：问题属于某一行、某一格 → 标在它身上。
 * 6px 圆点 + 12px 字，橙 / 红 / 灰。不占新位置，意思写在字上，不靠悬停。
 *
 *   <FPMark tone="warn">缺起止日期</FPMark>   <FPMark tone="danger">比上月少 1.43</FPMark>
 */
defineProps<{ tone: 'warn' | 'danger' | 'muted' }>()
</script>

<template>
  <span class="fp-mark" :class="tone"><i class="dot" aria-hidden="true" /><slot /></span>
</template>

<style scoped>
.fp-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-label);
  line-height: 18px;
  white-space: nowrap;
}
.warn { color: var(--orange-text); }
.danger { color: var(--delta-down-text); }
.muted { color: var(--text-muted); }
.dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
</style>
