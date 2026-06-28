<script setup lang="ts">
import { computed, useId } from "vue";

export interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  label?: string;
  disabled?: boolean;
  id?: string;
  modelValue?: boolean;
  style?: Record<string, string>;
}

const props = withDefaults(defineProps<CheckboxProps>(), {
  checked: false,
  indeterminate: false,
  disabled: false,
});

const emit = defineEmits<{
  change: [value: boolean];
  "update:modelValue": [value: boolean];
}>();

// ponytail: modelValue controls v-model; checked prop is the uncontrolled path (matches React duality)
const resolvedChecked = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.checked
);

const cbId = props.id ?? useId();

const on = computed(() => resolvedChecked.value || props.indeterminate);

const labelStyle = computed(() => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  cursor: props.disabled ? "not-allowed" : "pointer",
  opacity: props.disabled ? "0.5" : "1",
  font: "var(--type-body)",
  color: "var(--text-primary)",
  ...props.style,
}));

const boxStyle = computed(() => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "16px",
  height: "16px",
  flex: "0 0 auto",
  borderRadius: "5px",
  background: on.value ? "var(--control-solid)" : "var(--surface-white)",
  border: on.value ? "1px solid var(--control-solid)" : "1px solid var(--border-strong)",
  transition: "background var(--dur-fast), border-color var(--dur-fast)",
}));

function handleChange(e: Event) {
  const val = (e.target as HTMLInputElement).checked;
  emit("change", val);
  emit("update:modelValue", val);
}
</script>

<template>
  <label :for="cbId" :style="labelStyle">
    <input
      :id="cbId"
      type="checkbox"
      :checked="resolvedChecked"
      :disabled="disabled"
      style="position: absolute; opacity: 0; width: 0; height: 0"
      @change="handleChange"
    />
    <span aria-hidden="true" :style="boxStyle">
      <svg
        v-if="resolvedChecked && !indeterminate"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span
        v-if="indeterminate"
        style="width: 8px; height: 2px; background: #fff; border-radius: 1px"
      />
    </span>
    <span v-if="label">{{ label }}</span>
  </label>
</template>
