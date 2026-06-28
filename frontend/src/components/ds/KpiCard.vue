<script setup lang="ts">
import { computed } from "vue";
import FitText from "./FitText.vue";

export interface KpiCardProps {
  label?: unknown;
  value?: unknown;
  delta?: unknown;
  trend?: "up" | "down";
  tint?: "slate" | "sky" | "blue" | "cyan" | "plain";
  icon?: unknown;
  style?: Record<string, string>;
}

const TINTS: Record<string, string> = {
  slate: "var(--accent-slate)",
  sky: "var(--accent-sky)",
  blue: "var(--accent-blue)",
  cyan: "var(--accent-cyan)",
  plain: "var(--bg-panel)",
};

const props = withDefaults(defineProps<KpiCardProps>(), {
  tint: "slate",
});

const up = computed(() => {
  if (props.trend === "up") return true;
  if (props.trend === "down") return false;
  if (props.delta != null) return String(props.delta).trim().startsWith("+");
  return false;
});

const rootStyle = computed(() => ({
  background: TINTS[props.tint] ?? TINTS.slate,
  borderRadius: "var(--radius-lg)",
  padding: "24px",
  minWidth: 0,
  boxSizing: "border-box" as const,
  display: "flex",
  flexDirection: "column" as const,
  gap: "8px",
  ...props.style,
}));
</script>

<template>
  <div :style="rootStyle">
    <!-- header row: label + optional icon -->
    <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
      <span style="font:var(--type-card-title);color:var(--text-primary);white-space:nowrap">
        <slot name="label">{{ label }}</slot>
      </span>
      <span v-if="$slots.icon || icon" style="display:inline-flex;color:var(--text-secondary)">
        <slot name="icon">{{ icon }}</slot>
      </span>
    </div>

    <!-- value row: big metric + delta -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px">
      <span style="flex:1 1 auto;min-width:0;overflow:hidden;display:flex;align-items:flex-end">
        <FitText
          :max="28"
          :min="16"
          :style="{
            fontFamily: 'var(--font-sans)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text-primary)',
            letterSpacing: 'var(--ls-tight)',
          }"
        >
          <slot>{{ value }}</slot>
        </FitText>
      </span>

      <span
        v-if="delta != null"
        style="display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;font-family:var(--font-sans);font-size:var(--fs-label);font-weight:var(--fw-medium);color:var(--text-primary);white-space:nowrap"
      >
        <slot name="delta">{{ delta }}</slot>
        <span aria-hidden="true" style="font-size:14px;line-height:1">{{ up ? "↗" : "↘" }}</span>
      </span>
    </div>
  </div>
</template>
