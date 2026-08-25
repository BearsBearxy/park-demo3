<script setup lang="ts">
// 屏级告警入口 chip(LAYOUT-STABILITY-SPEC §6):位置固定、两态常驻——
// 有待处理=实底警示色+计数;无待处理=quiet 静默态(仍渲染,不留空洞不挪版)。
// 与台账/附表10 的「未绑定 N」chip 同款手感。
// ⭐count 口径全站钉死 = **待处理条目数**(Σ 各组 items.length,无 items 的组按 1 计),
//   不是组数——同一枚 chip 在不同屏上数字含义必须一致(否则用户学不会这个数字)。
import { iconFor } from '@/components/ds/icon'

const props = withDefaults(defineProps<{
  count: number
  label?: string        // 有待处理时的名词,默认「待处理」
  quietLabel?: string   // 无待处理时的文案,默认「无待处理」
}>(), { label: '待处理', quietLabel: '无待处理' })

defineEmits<{ (e: 'open'): void }>()
</script>

<template>
  <button class="fac" :class="{ quiet: props.count === 0 }" type="button"
          :title="props.count ? `${props.count} 项待处理 · 点击查看` : '没有待处理事项'"
          @click="$emit('open')">
    <component :is="iconFor(props.count ? 'alert-triangle' : 'check-circle-2')" :size="13" />
    <span v-if="props.count">{{ props.label }} {{ props.count }}</span>
    <span v-else>{{ props.quietLabel }}</span>
  </button>
</template>

<style scoped>
.fac {
  flex: none;
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 11px;
  border: 1px solid var(--status-warning); border-radius: var(--radius-full);
  background: rgb(252, 243, 232);
  cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); font-weight: var(--fw-medium);
  color: var(--status-warning); white-space: nowrap;
  transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
}
.fac:hover { background: rgb(250, 236, 218); }
/* 静默态:同尺寸同位置,只换色——切换有无告警时工具条不挪一像素 */
.fac.quiet {
  border-color: var(--border-subtle); background: transparent; color: var(--text-disabled);
}
.fac.quiet:hover { border-color: var(--border-strong); color: var(--text-muted); }
</style>
