<script setup lang="ts">
import { ref, computed } from "vue";

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

const VARIANTS: Record<string, { rest: Record<string, string>; hover: Record<string, string> }> = {
  borderless: {
    rest: { background: "transparent", color: "var(--text-primary)", border: "1px solid transparent" },
    hover: { background: "var(--surface-card)" },
  },
  gray: {
    rest: { background: "var(--surface-card)", color: "var(--text-primary)", border: "1px solid transparent" },
    hover: { background: "var(--ink-100)" },
  },
  outline: {
    rest: { background: "var(--surface-white)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" },
    hover: { background: "var(--surface-card)" },
  },
  filled: {
    rest: { background: "var(--ink-900)", color: "var(--control-solid-text)", border: "1px solid transparent" },
    hover: { background: "rgb(58, 58, 58)" },
  },
  danger: {
    rest: { background: "var(--hue-red)", color: "#fff", border: "1px solid transparent" },
    hover: { background: "rgb(224, 49, 39)" },
  },
};

const SIZES: Record<string, { height: number; padding: string; font: string; gap: number; icon: number }> = {
  sm: { height: 28, padding: "0 12px", font: "var(--fs-label)", gap: 6, icon: 14 },
  md: { height: 36, padding: "0 16px", font: "var(--fs-body)", gap: 8, icon: 16 },
  lg: { height: 48, padding: "0 20px", font: "var(--fs-body)", gap: 8, icon: 20 },
};

const hover = ref(false);

const buttonStyle = computed(() => {
  const key = VARIANT_ALIAS[props.variant] ?? props.variant;
  const v = VARIANTS[key] ?? VARIANTS.filled;
  const s = SIZES[props.size] ?? SIZES.md;
  const state = hover.value && !props.disabled ? { ...v.rest, ...v.hover } : v.rest;

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: `${s.gap}px`,
    height: `${s.height}px`,
    padding: s.padding,
    width: props.fullWidth ? "100%" : "auto",
    fontFamily: "var(--font-sans)",
    fontSize: s.font,
    fontWeight: "var(--fw-regular)",
    lineHeight: 1,
    letterSpacing: "var(--ls-normal)",
    borderRadius: props.shape === "rounded" ? "var(--radius-sm)" : "var(--radius-full)",
    cursor: props.disabled ? "not-allowed" : "pointer",
    opacity: props.disabled ? 0.4 : 1,
    whiteSpace: "nowrap",
    transition: "background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast)",
    ...state,
  };
});

const iconStyle = (size: number) => ({
  display: "inline-flex",
  width: `${size}px`,
  height: `${size}px`,
  alignItems: "center",
  justifyContent: "center",
});

const iconSize = computed(() => (SIZES[props.size] ?? SIZES.md).icon);
const resolvedVariantKey = computed(() => VARIANT_ALIAS[props.variant] ?? props.variant);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :data-variant="resolvedVariantKey"
    :style="buttonStyle"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
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
