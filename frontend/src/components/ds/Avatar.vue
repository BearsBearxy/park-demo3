<script setup lang="ts">
import { computed } from "vue";

export interface AvatarProps {
  src?: string;
  name?: string;
  size?: number;
  ring?: boolean;
}

const props = withDefaults(defineProps<AvatarProps>(), {
  name: "",
  size: 28,
  ring: false,
});

const PALETTE = [
  "var(--fill-blue)",
  "var(--fill-slate)",
  "var(--hue-cyan)",
  "var(--brand-accent)",
  "var(--brand-deep)",
  "var(--fill-cyan)",
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

const bg = computed(() =>
  PALETTE[(props.name.charCodeAt(0) || 0) % PALETTE.length]
);

const spanStyle = computed(() => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: `${props.size}px`,
  height: `${props.size}px`,
  flex: "0 0 auto",
  borderRadius: "50%",
  overflow: "hidden",
  background: props.src ? "var(--bg-sunken)" : bg.value,
  color: "#fff",
  fontFamily: "var(--font-sans)",
  fontSize: `${Math.max(9, Math.round(props.size * 0.38))}px`,
  fontWeight: "var(--fw-semibold)",
  boxShadow: props.ring ? "0 0 0 2px var(--surface-white)" : "none",
  userSelect: "none" as const,
}));
</script>

<template>
  <span :title="name" :style="spanStyle" v-bind="$attrs">
    <img
      v-if="src"
      :src="src"
      :alt="name"
      style="width: 100%; height: 100%; object-fit: cover"
    />
    <template v-else>{{ initials(name) }}</template>
  </span>
</template>
