<script setup lang="ts">
import { ref, computed, useId } from 'vue'

export type InputSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  hint?: string
  error?: string
  size?: InputSize
  disabled?: boolean
  type?: string
  placeholder?: string
  id?: string
}>(), {
  size: 'md',
  disabled: false,
  type: 'text',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const focus = ref(false)
const inputId = props.id ?? useId()

const HEIGHT: Record<InputSize, number> = { sm: 32, md: 36, lg: 44 }

const borderColor = computed(() =>
  props.error ? 'var(--hue-red)' : focus.value ? 'var(--border-strong)' : 'var(--border-subtle)'
)

const wrapStyle = computed(() => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  height: `${HEIGHT[props.size]}px`,
  padding: '0 12px',
  background: props.disabled ? 'var(--bg-sunken)' : 'var(--surface-white)',
  border: `1px solid ${borderColor.value}`,
  borderRadius: 'var(--radius-sm)',
  transition: 'border-color var(--dur-fast) var(--ease-standard)',
  opacity: props.disabled ? 0.6 : 1,
}))
</script>

<template>
  <div style="display:flex;flex-direction:column;gap:6px">
    <label
      v-if="label"
      :for="inputId"
      style="font:var(--type-label);color:var(--text-secondary);font-weight:var(--fw-medium)"
    >{{ label }}</label>

    <div :style="wrapStyle">
      <span v-if="$slots.leadingIcon" style="display:inline-flex;color:var(--text-muted)">
        <slot name="leadingIcon" />
      </span>
      <input
        :id="inputId"
        :type="type"
        :value="modelValue"
        :disabled="disabled"
        :placeholder="placeholder"
        style="flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:var(--font-sans);font-size:var(--fs-body);color:var(--text-primary)"
        @focus="focus = true"
        @blur="focus = false"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="$slots.trailingIcon" style="display:inline-flex;color:var(--text-muted)">
        <slot name="trailingIcon" />
      </span>
    </div>

    <span
      v-if="error || hint"
      :style="{ font: 'var(--type-label)', color: error ? 'var(--hue-red)' : 'var(--text-muted)' }"
    >{{ error || hint }}</span>
  </div>
</template>
