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

const baseStyle = computed<Record<string, string>>(() => {
  if (props.variant === "soft") return { background: "var(--control-soft)" };
  if (props.variant === "outline")
    return { background: "transparent", border: "1px solid var(--border-subtle)" };
  // borderless
  return { background: props.active ? "var(--bg-hover)" : "transparent" };
});

const buttonStyle = computed(() => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: dims.value + "px",
  height: dims.value + "px",
  flex: "0 0 auto",
  borderRadius: "var(--radius-sm)",
  border: "1px solid transparent",
  color: props.active ? "var(--text-primary)" : "var(--text-secondary)",
  cursor: props.disabled ? "not-allowed" : "pointer",
  opacity: props.disabled ? "0.4" : "1",
  transition:
    "background var(--dur-fast) var(--ease-standard), color var(--dur-fast)",
  ...baseStyle.value,
}));

function onMouseEnter(e: MouseEvent) {
  if (!props.disabled && props.variant === "borderless" && !props.active) {
    (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
  }
}

function onMouseLeave(e: MouseEvent) {
  if (props.variant === "borderless" && !props.active) {
    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
  }
}

function onClick(e: MouseEvent) {
  if (!props.disabled) emit("click", e);
}
</script>

<template>
  <button
    type="button"
    :aria-label="ariaLabel"
    :disabled="disabled"
    :style="[buttonStyle, style as any]"
    @click="onClick"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <slot />
  </button>
</template>
