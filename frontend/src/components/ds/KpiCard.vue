<script setup lang="ts">
import { computed } from "vue";

export interface KpiCardProps {
  label?: unknown;
  value?: unknown;
  delta?: unknown;
  /** Muted subtitle under the value. No trend arrow (use when there's no historical baseline). */
  sub?: unknown;
  trend?: "up" | "down";
  tint?: "slate" | "sky" | "blue" | "cyan" | "plain";
  icon?: unknown;
  style?: Record<string, string>;
}

// 重设计:扁平白卡 + 色点标签(不再整卡上底色);tint 现映射为标签色点色
const DOTS: Record<string, string> = {
  slate: "var(--fill-slate)",
  sky: "var(--hue-cyan)",
  blue: "var(--hue-blue)",
  cyan: "var(--hue-cyan)",
  plain: "var(--border-strong)",
};

const props = withDefaults(defineProps<KpiCardProps>(), {
  tint: "slate",
});

const dot = computed(() => DOTS[props.tint] ?? DOTS.slate);

const up = computed(() => {
  if (props.trend === "up") return true;
  if (props.trend === "down") return false;
  if (props.delta != null) return String(props.delta).trim().startsWith("+");
  return false;
});

const rootStyle = computed(() => ({
  background: "var(--surface-white)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-lg)",
  padding: "16px 18px",
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
    <!-- header row: 色点 + label + optional icon -->
    <div style="display:flex;align-items:center;gap:7px;justify-content:space-between">
      <span style="display:inline-flex;align-items:center;gap:7px;min-width:0">
        <span aria-hidden="true" :style="{ width:'7px', height:'7px', borderRadius:'50%', background: dot, flex:'0 0 auto' }"></span>
        <span style="font-size:var(--fs-label);color:var(--text-muted);white-space:nowrap">
          <slot name="label">{{ label }}</slot>
        </span>
      </span>
      <span v-if="$slots.icon || icon" style="display:inline-flex;color:var(--text-disabled)">
        <slot name="icon">{{ icon }}</slot>
      </span>
    </div>

    <!-- value row: big metric + delta -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px">
      <span style="flex:1 1 auto;min-width:0;overflow:hidden;display:flex;align-items:flex-end">
        <span style="font-family:var(--font-mono);font-size:var(--fs-h1);font-weight:var(--fw-semibold);line-height:1.1;color:var(--text-primary);letter-spacing:var(--ls-tight)">
          <slot>{{ value }}</slot>
        </span>
      </span>

      <span
        v-if="delta != null"
        style="display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;font-family:var(--font-sans);font-size:var(--fs-label);font-weight:var(--fw-medium);color:var(--text-primary);white-space:nowrap"
      >
        <slot name="delta">{{ delta }}</slot>
        <span aria-hidden="true" style="font-size:14px;line-height:1">{{ up ? "↗" : "↘" }}</span>
      </span>
    </div>

    <!-- muted subtitle (no trend arrow) -->
    <div
      v-if="$slots.sub || sub != null"
      style="font-family:var(--font-sans);font-size:var(--fs-label);font-weight:var(--fw-medium);color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
    >
      <slot name="sub">{{ sub }}</slot>
    </div>
  </div>
</template>
