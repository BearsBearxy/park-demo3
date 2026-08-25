<script setup lang="ts">
import { computed } from "vue";

export type ButtonVariant =
  | "borderless" | "gray" | "outline" | "filled" | "danger"
  | "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: "pill" | "rounded";
  disabled?: boolean;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
}

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: "filled",
  size: "md",
  shape: "pill",
  disabled: false,
  fullWidth: false,
  type: "button",
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

// ponytail: same alias table as JSX
const VARIANT_ALIAS: Record<string, string> = { primary: "filled", secondary: "gray", ghost: "borderless" };

const SIZES: Record<string, { height: number; padding: string; font: string; gap: number; icon: number }> = {
  sm: { height: 28, padding: "0 12px", font: "var(--fs-label)", gap: 6, icon: 14 },
  md: { height: 36, padding: "0 16px", font: "var(--fs-body)", gap: 8, icon: 16 },
  lg: { height: 48, padding: "0 20px", font: "var(--fs-body)", gap: 8, icon: 20 },
};

// ⚠ 这里只留「不需要伪类」的部分:尺寸与形状。配色三件套交给下面的 <style scoped>。
//
// 改前整张 VARIANTS 配色表在本文件 script 里,由 hover = ref(false) 配合
// @mouseenter/@mouseleave 手动合并 rest 与 hover 两套值 —— 因为样式全写在内联 :style
// 对象里,而**内联样式装不下伪类**:写不了 :hover,更写不了 :focus-visible。
// 现在配色移进 CSS,hover 由 :hover 负责,那个 ref 与两个事件监听一并删除。
const buttonStyle = computed(() => {
  const s = SIZES[props.size] ?? SIZES.md;
  return {
    gap: s.gap + "px",
    height: s.height + "px",
    padding: s.padding,
    width: props.fullWidth ? "100%" : "auto",
    fontSize: s.font,
    borderRadius: props.shape === "rounded" ? "var(--radius-sm)" : "var(--radius-full)",
  };
});

const iconStyle = (size: number) => ({
  display: "inline-flex",
  width: size + "px",
  height: size + "px",
  alignItems: "center",
  justifyContent: "center",
});

const iconSize = computed(() => (SIZES[props.size] ?? SIZES.md).icon);
const resolvedVariantKey = computed(() => VARIANT_ALIAS[props.variant] ?? props.variant);
</script>

<template>
  <button
    class="ds-btn"
    :type="type"
    :disabled="disabled"
    :data-variant="resolvedVariantKey"
    :style="buttonStyle"
    @click="emit('click', $event)"
  >
    <span v-if="$slots.leading" :style="iconStyle(iconSize)">
      <slot name="leading" />
    </span>
    <slot />
    <span v-if="$slots.trailing" :style="iconStyle(iconSize)">
      <slot name="trailing" />
    </span>
  </button>
</template>

<style scoped>
.ds-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans);
  font-weight: var(--fw-regular);
  line-height: 1;
  letter-spacing: var(--ls-normal);
  white-space: nowrap;
  cursor: pointer;
  background: var(--ds-btn-bg);
  color: var(--ds-btn-fg);
  border: 1px solid var(--ds-btn-border);
  /* 改前只过渡 background 与 border-color,漏了 color —— 与 Segmented(含 color)不一致。 */
  transition: background var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard),
              color var(--dur-fast) var(--ease-standard),
              opacity var(--dur-fast) var(--ease-standard);
}

/* 配色表:改前在 script 里靠 JS 合并两套值,现在交回 CSS。
   焦点环不在这里写 —— base.css 已有覆盖 button 的全局 :focus-visible 兜底,
   组件再定义一遍只会两套规则打架。 */
.ds-btn[data-variant="borderless"] { --ds-btn-bg: transparent;          --ds-btn-fg: var(--text-primary);       --ds-btn-border: transparent; }
.ds-btn[data-variant="gray"]       { --ds-btn-bg: var(--surface-card);  --ds-btn-fg: var(--text-primary);       --ds-btn-border: transparent; }
.ds-btn[data-variant="outline"]    { --ds-btn-bg: var(--surface-white); --ds-btn-fg: var(--text-primary);       --ds-btn-border: var(--border-subtle); }
.ds-btn[data-variant="filled"]     { --ds-btn-bg: var(--control-solid); --ds-btn-fg: var(--control-solid-text); --ds-btn-border: transparent; }
.ds-btn[data-variant="danger"]     { --ds-btn-bg: var(--status-danger); --ds-btn-fg: var(--text-on-solid);      --ds-btn-border: transparent; }

.ds-btn[data-variant="borderless"]:hover:not(:disabled) { --ds-btn-bg: var(--surface-card); }
.ds-btn[data-variant="gray"]:hover:not(:disabled)       { --ds-btn-bg: var(--ink-100); }
.ds-btn[data-variant="outline"]:hover:not(:disabled)    { --ds-btn-bg: var(--surface-card); }
.ds-btn[data-variant="filled"]:hover:not(:disabled)     { --ds-btn-bg: var(--control-solid-hover); }
.ds-btn[data-variant="danger"]:hover:not(:disabled)     { --ds-btn-bg: var(--status-danger-hover); }

.ds-btn:disabled { opacity: .4; cursor: not-allowed; }
</style>
