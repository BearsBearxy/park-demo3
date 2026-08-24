<script setup lang="ts">
export type BadgeTone = "neutral" | "blue" | "cyan" | "slate" | "orange" | "red";

export interface BadgeProps {
  tone?: BadgeTone;
  variant?: "solid" | "subtle";
  dot?: boolean;
  style?: string | Record<string, string>;
}

const props = withDefaults(defineProps<BadgeProps>(), {
  tone: "neutral",
  variant: "solid",
  dot: true,
});

const TONES: Record<BadgeTone, { dot: string; fill: string; text: string }> = {
  neutral: { dot: "var(--ink-500)", fill: "var(--ink-040)", text: "var(--text-secondary)" },
  blue:    { dot: "var(--hue-blue)", fill: "rgba(24,134,254,0.12)", text: "var(--hue-blue)" },
  cyan:    { dot: "var(--hue-cyan)", fill: "rgba(50,173,230,0.14)", text: "rgb(22,140,195)" },
  slate:   { dot: "var(--fill-slate)", fill: "rgba(120,140,176,0.14)", text: "rgb(90,110,150)" },
  orange:  { dot: "var(--hue-orange)", fill: "rgba(255,149,0,0.14)", text: "rgb(190,110,0)" },
  red:     { dot: "var(--hue-red)", fill: "rgba(255,59,48,0.12)", text: "var(--hue-red)" },
};

import { computed } from "vue";

const t = computed(() => TONES[props.tone] ?? TONES.neutral);
const filled = computed(() => props.variant === "solid");

const spanStyle = computed(() => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  height: "22px",
  padding: filled.value ? "0 10px" : "0 2px",
  borderRadius: "var(--radius-sm)",
  background: filled.value ? t.value.fill : "transparent",
  color: t.value.text,
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-label)",
  fontWeight: "var(--fw-medium)",
  lineHeight: "1",
  whiteSpace: "nowrap",
  // 徽标唯一的动效场景是「状态变了」(如一条记录从「进行中」跳到「已缴清」),
  // 改前没有 transition,是硬跳。只过渡颜色,不碰尺寸 —— 徽标常在表格行里,
  // 任何尺寸变化都会推动同行其它列(LAYOUT-STABILITY-SPEC)。
  transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)",
}));

const dotStyle = computed(() => ({
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: t.value.dot,
  flex: "0 0 auto",
  transition: "background var(--dur-fast) var(--ease-standard)",
}));
</script>

<template>
  <span :style="[spanStyle, style as any]" v-bind="$attrs">
    <span v-if="dot" :style="dotStyle" />
    <slot />
  </span>
</template>
