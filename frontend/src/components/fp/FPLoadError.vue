<script setup lang="ts">
/**
 * 加载失败（十件 ⑦ 的 error 档，画布 06-B ⑦ / 06-D 右格 / 03-B）= `FPEmpty tone="error"` 的封装。
 *
 *   <FPLoadError v-if="loadErr" sub="屏上不显示上个月的数字" @retry="load">2023 年 8 月的数据没读到</FPLoadError>
 *   <table v-else …>
 *
 * - 默认插槽一句，`sub` 副句，按钮恒为「重试」。role=alert（读屏用户要知道加载失败了）。
 * - 2026-10-01 起**换掉内容区本身**，不再是表格上方那条流内红条（LAYOUT-STABILITY §3）。
 *   调用处要让它和表格互斥（v-if / v-else）—— S3/S4 逐屏改；改完之前它仍长在表格上方，
 *   外形只长高、不溢出、不挡别的按钮（FPEmpty 只长不缩）。
 * - `retryText` 只为兼容保留，新代码别传。
 */
import FPEmpty from '@/components/fp/FPEmpty.vue'

withDefaults(defineProps<{
  sub?: string
  /** 兼容旧调用；规范里按钮恒为「重试」 */
  retryText?: string
}>(), { retryText: '重试' })

defineEmits<{ retry: [] }>()
</script>

<template>
  <FPEmpty tone="error" :sub="sub" :action="retryText" @action="$emit('retry')">
    <slot />
  </FPEmpty>
</template>

<style scoped>
/* 旧调用的两行堆叠（抄表屏「读数」与「表档案」各自成行，别让一条盖掉另一条的原因） */
.fp-empty :deep(.msg) { display: flex; flex-direction: column; gap: 3px; }
</style>
