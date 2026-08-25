<script setup lang="ts">
import { computed } from "vue";

export interface IconButtonProps {
  size?: "sm" | "md" | "lg";
  variant?: "borderless" | "soft" | "outline";
  active?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  style?: string | Record<string, string>;
}

const props = withDefaults(defineProps<IconButtonProps>(), {
  size: "md",
  variant: "borderless",
  active: false,
  disabled: false,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const dims = computed(() => ({ sm: 24, md: 28, lg: 32 }[props.size] ?? 28));

// 只留尺寸。配色与 hover 交给 <style scoped>。
// 改前 onMouseEnter/onMouseLeave 里直接写 e.currentTarget.style.background ——
// 绕过 Vue 响应式的手写 DOM 改动,任何触发重渲染的状态变化都会把它冲掉;
// 且守卫写着 variant === "borderless",soft 与 outline 点上去根本没有反馈。
const sizeStyle = computed(() => ({
  width: dims.value + "px",
  height: dims.value + "px",
}));

function onClick(e: MouseEvent) {
  if (!props.disabled) emit("click", e);
}
</script>

<template>
  <button
    type="button"
    class="ds-iconbtn"
    :aria-label="ariaLabel"
    :disabled="disabled"
    :data-variant="variant"
    :data-active="active ? '' : undefined"
    :style="[sizeStyle, style as any]"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<style scoped>
.ds-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: var(--ds-ib-bg, transparent);
  color: var(--ds-ib-fg, var(--text-secondary));
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard),
              color var(--dur-fast) var(--ease-standard),
              opacity var(--dur-fast) var(--ease-standard);
}

.ds-iconbtn[data-variant="soft"]    { --ds-ib-bg: var(--control-soft); }
.ds-iconbtn[data-variant="outline"] { border-color: var(--border-subtle); }
.ds-iconbtn[data-active]            { --ds-ib-bg: var(--bg-hover); --ds-ib-fg: var(--text-primary); }

/* soft 与 outline 的 hover 是本次新增:改前那条 variant === "borderless" 守卫
   让这两个变体完全没有悬停反馈,用户无法判断它是否可点。 */
.ds-iconbtn[data-variant="borderless"]:hover:not(:disabled):not([data-active]) { --ds-ib-bg: var(--bg-hover); }
.ds-iconbtn[data-variant="soft"]:hover:not(:disabled):not([data-active])       { --ds-ib-bg: var(--ink-100); }
.ds-iconbtn[data-variant="outline"]:hover:not(:disabled):not([data-active])    { --ds-ib-bg: var(--surface-card); }

.ds-iconbtn:disabled { opacity: .4; cursor: not-allowed; }
</style>
