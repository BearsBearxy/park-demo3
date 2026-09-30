<script setup lang="ts">
/**
 * 块内提示（十件 ④，画布 01-A 卡3 / 06-B ④）：只和某一块有关 → 放在那块里面，宽度跟着块走，一行说完。
 * 12px、圆角 8、蓝 / 黄 / 红三档；不加竖条、不加虚线。左侧是状态图标，不是可点的 ⓘ。
 *
 *   <FPNote tone="warn" @action="goBind">租金行还没绑单元<template #action>去绑定</template></FPNote>
 *
 * #action 插槽的字放进行尾按钮，点了 emit action。字多了折行（高度从 32 往下长），不截断。
 */
import { iconFor } from '@/components/ds/icon'

defineProps<{ tone: 'info' | 'warn' | 'danger' }>()
defineEmits<{ action: [] }>()
</script>

<template>
  <div class="fp-note" :class="tone">
    <component :is="iconFor(tone === 'danger' ? 'alert-triangle' : 'info')" class="ic" :size="12" aria-hidden="true" />
    <span class="tx"><slot /></span>
    <button v-if="$slots.action" type="button" class="act" @click="$emit('action')"><slot name="action" /></button>
  </div>
</template>

<style scoped>
.fp-note {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 7px 12px;
  box-sizing: border-box;
  border-radius: var(--radius-sm);
  font-size: var(--fs-label);
  line-height: 18px;
}
.info { background: var(--info-soft); color: var(--info-text-on-tint); }
.warn { background: var(--caution-soft); color: var(--caution-text); }
.danger { background: var(--danger-soft); color: var(--delta-down-text); }
.ic { flex: none; }
.tx { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.act {
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font: inherit;
  font-weight: var(--fw-medium);
  color: var(--text-link);
  white-space: nowrap;
}
.act:hover { text-decoration: underline; }
</style>
