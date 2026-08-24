<script setup lang="ts">
export interface PopoverItemProps {
  danger?: boolean;
}

withDefaults(defineProps<PopoverItemProps>(), { danger: false });
const emit = defineEmits<{ (e: "click"): void }>();
</script>

<template>
  <button
    type="button"
    class="ds-popitem"
    :data-danger="danger ? '' : undefined"
    @click="emit('click')"
  >
    <span v-if="$slots.icon" class="ds-popitem-ic"><slot name="icon" /></span>
    <slot />
  </button>
</template>

<style scoped>
/* 改前整块样式是 script 里一个 base 对象 + 内联 :style,hover 靠
   e.currentTarget.style.background 手写 DOM(同 IconButton)。
   菜单项是键盘导航的重灾区,而内联 :style 连 :hover 都写不了。
   焦点环由 base.css 的全局兜底负责(选择器含 button),这里不重复定义。 */
.ds-popitem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: var(--type-body);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease-standard);
}

.ds-popitem[data-danger] { color: var(--hue-red); }

.ds-popitem:hover { background: var(--bg-hover); }

.ds-popitem-ic { display: inline-flex; }
</style>
