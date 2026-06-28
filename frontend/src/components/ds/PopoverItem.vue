<script setup lang="ts">
export interface PopoverItemProps {
  danger?: boolean;
}

withDefaults(defineProps<PopoverItemProps>(), { danger: false });
const emit = defineEmits<{ (e: "click"): void }>();

const base: Record<string, string> = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  width: "100%",
  padding: "8px 10px",
  border: "none",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  font: "var(--type-body)",
  cursor: "pointer",
  textAlign: "left",
};

function enter(e: MouseEvent) {
  (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
}
function leave(e: MouseEvent) {
  (e.currentTarget as HTMLElement).style.background = "transparent";
}
</script>

<template>
  <button
    :style="{ ...base, color: danger ? 'var(--hue-red)' : 'var(--text-primary)' }"
    @click="emit('click')"
    @mouseenter="enter"
    @mouseleave="leave"
  >
    <span v-if="$slots.icon" style="display: inline-flex"><slot name="icon" /></span>
    <slot />
  </button>
</template>
