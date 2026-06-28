<script setup lang="ts">
import type { VNode } from "vue";
import { computed } from "vue";

export type SegmentedOption =
  | string
  | { value: string; label: string | VNode; icon?: VNode };

export interface SegmentedProps {
  options?: SegmentedOption[];
  /** Controlled value; also used as v-model target via modelValue alias */
  value?: string;
  modelValue?: string;
  size?: "sm" | "md" | "lg";
}

const props = withDefaults(defineProps<SegmentedProps>(), {
  options: () => [],
  size: "md",
});

const emit = defineEmits<{
  change: [value: string];
  "update:modelValue": [value: string];
}>();

const heightMap = { sm: 28, md: 32, lg: 38 } as const;

const items = computed(() =>
  props.options.map((o) =>
    typeof o === "string" ? { value: o, label: o, icon: undefined } : o
  )
);

// Controlled: prefer modelValue (v-model), then value, then first item
const active = computed(
  () => props.modelValue ?? props.value ?? items.value[0]?.value
);

function handleClick(val: string) {
  emit("change", val);
  emit("update:modelValue", val);
}
</script>

<template>
  <div
    role="tablist"
    :style="{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '2px',
      padding: '3px',
      height: `${heightMap[size]}px`,
      background: 'var(--bg-sunken)',
      borderRadius: 'var(--radius-full)',
      boxSizing: 'border-box',
    }"
    v-bind="$attrs"
  >
    <button
      v-for="it in items"
      :key="it.value"
      role="tab"
      :aria-selected="it.value === active"
      :style="{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '100%',
        padding: '0 14px',
        border: 'none',
        borderRadius: 'var(--radius-full)',
        background: it.value === active ? 'var(--surface-white)' : 'transparent',
        color: it.value === active ? 'var(--text-primary)' : 'var(--text-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-body)',
        fontWeight: 'var(--fw-medium)',
        cursor: 'pointer',
        boxShadow: it.value === active ? 'var(--shadow-pill)' : 'none',
        transition:
          'background var(--dur-fast) var(--ease-standard), color var(--dur-fast)',
        whiteSpace: 'nowrap',
      }"
      @click="handleClick(it.value)"
    >
      <component :is="it.icon" v-if="it.icon" />
      {{ it.label }}
    </button>
  </div>
</template>
