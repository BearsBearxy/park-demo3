<script setup lang="ts">
/**
 * 「没加载出来 + 重试」的标准件（加载态设计稿 §10 第 5 步）。
 *
 * 收编前有 6 份手搓：`lg-bar err` / `pl-bar err` / `pm-bar err` / `sr-bar err` /
 * `su-bar err` / `mt-empty bad`。**它们的 `.err` 那一档逐字节相同** ——
 * 同一个红边、同一个 `rgb(255,238,237)` 底、同一句「重试」，
 * 只是分别长在六个文件的 `<style scoped>` 里，谁都不知道另外五份存在。
 * 改一次配色要翻六个地方，而漏掉一个不报错、也没人发现。
 *
 * ⚠ **只收「加载失败」这一档**。各屏的基类（`.pl-bar` 还有 warn 档、
 *   `.lg-bar` 还有普通档）仍归各屏自己 —— 那些是不同的东西，一起收会把语义搅浑。
 *
 * 文案走插槽而不是 prop：六处的内层结构本就不同（有单行、有两行堆叠），
 * 让调用方原样搬过来，收编这件事就不会附带改版面。
 *
 * 阻断性错误保持**流内条** —— LAYOUT-STABILITY §6 明确允许：
 * 「加载失败、无权限本就该打断流程」。它不是那种要被收进抽屉的状态型告警。
 */
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

withDefaults(defineProps<{
  /** 重试按钮文案。个别屏叫「重新加载」之类时才传 */
  retryText?: string
}>(), { retryText: '重试' })

defineEmits<{ retry: [] }>()
</script>

<template>
  <!-- role=alert:收编前六处都没有,读屏用户过去完全不知道加载失败了 -->
  <div class="fp-lderr" role="alert">
    <component :is="iconFor('alert-triangle')" :size="14" />
    <slot />
    <Button variant="outline" size="sm" @click="$emit('retry')">{{ retryText }}</Button>
  </div>
</template>

<style scoped>
.fp-lderr {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--hue-red);
  border-radius: var(--radius-md);
  background: rgb(255, 238, 237);
  color: var(--hue-red);
  font-size: var(--fs-label);
  flex-wrap: wrap;
}
/* 两行堆叠那一档（抄表屏「读数」与「表档案」各自成行，别让一条盖掉另一条的原因） */
.fp-lderr :deep(.msg) {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
</style>
