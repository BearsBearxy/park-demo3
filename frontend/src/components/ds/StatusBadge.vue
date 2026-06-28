<script setup lang="ts">
import Badge from "./Badge.vue";

export type FactoryParkStatus =
  | "active" | "occupied" | "paid" | "complete"
  | "pending" | "inprogress" | "expiring" | "approved"
  | "overdue" | "rejected" | "vacant" | "draft";

export interface StatusBadgeProps {
  /** Domain status; maps to the right tone + label. */
  status: FactoryParkStatus | string;
  /** "subtle" (dot + text, default) or "solid" (filled tint). */
  variant?: "solid" | "subtle";
}

const props = withDefaults(defineProps<StatusBadgeProps>(), {
  variant: "subtle",
});

// ponytail: same STATUS_MAP as JSX, verbatim
const STATUS_MAP: Record<string, { tone: "blue" | "cyan" | "orange" | "red" | "neutral"; label: string }> = {
  active:     { tone: "blue",    label: "生效中" },
  occupied:   { tone: "blue",    label: "已入驻" },
  paid:       { tone: "blue",    label: "已缴清" },
  complete:   { tone: "blue",    label: "已完成" },
  pending:    { tone: "cyan",    label: "待处理" },
  inprogress: { tone: "cyan",    label: "进行中" },
  expiring:   { tone: "orange",  label: "即将到期" },
  approved:   { tone: "orange",  label: "已审批" },
  overdue:    { tone: "red",     label: "已逾期" },
  rejected:   { tone: "neutral", label: "已驳回" },
  vacant:     { tone: "neutral", label: "空置" },
  draft:      { tone: "neutral", label: "草稿" },
};

import { computed, useSlots } from "vue";

const slots = useSlots();

const resolved = computed(() => {
  const key = String(props.status ?? "").toLowerCase().replace(/\s+/g, "");
  return STATUS_MAP[key] ?? { tone: "neutral" as const, label: props.status };
});
</script>

<template>
  <Badge :tone="resolved.tone" :variant="variant">
    <slot>{{ resolved.label }}</slot>
  </Badge>
</template>
