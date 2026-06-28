<script setup lang="ts">
import { computed } from "vue";

export interface CardProps {
  /** Optional card title (16px semibold). */
  title?: string;
  /** Inner padding in px. @default 24 */
  padding?: number;
  /** Surface fill. @default "panel" (off-white) */
  surface?: "panel" | "white" | "sunken";
  style?: string | Record<string, string>;
}

const props = withDefaults(defineProps<CardProps>(), {
  padding: 24,
  surface: "panel",
});

const bg = computed(() =>
  props.surface === "white"
    ? "var(--surface-white)"
    : props.surface === "sunken"
    ? "var(--bg-sunken)"
    : "var(--bg-panel)"
);

const sectionStyle = computed(() => ({
  background: bg.value,
  borderRadius: "var(--radius-xl)",
  padding: props.padding + "px",
  boxSizing: "border-box" as const,
  boxShadow: props.surface === "white" ? "var(--shadow-sm)" : "none",
  border: props.surface === "white" ? "1px solid var(--border-subtle)" : "none",
  overflow: props.surface === "white" ? "hidden" : undefined,
}));
</script>

<template>
  <section :style="sectionStyle" v-bind="$attrs">
    <header
      v-if="$slots.action || title"
      :style="{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '16px',
      }"
    >
      <h3
        v-if="title"
        :style="{
          margin: 0,
          font: 'var(--type-card-title)',
          color: 'var(--text-primary)',
        }"
      >
        {{ title }}
      </h3>
      <slot name="action" />
    </header>
    <slot />
  </section>
</template>
