<script setup lang="ts">
// ponytail: separate from FPPhaseTabs (phase=building period 1-4); this is contract lifecycle
const LIFECYCLE = [
  { k: 'all',        label: '全部' },
  { k: 'draft',      label: '草稿' },
  { k: 'active',     label: '执行中' },
  { k: 'expiring',   label: '即将到期' },
  { k: 'expired',    label: '已到期' },
  { k: 'terminated', label: '已终止' },
]

const props = defineProps<{
  modelValue: string
  counts: Record<string, number>
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
</script>

<template>
  <div class="fp-phasetabs">
    <button
      v-for="t in LIFECYCLE"
      :key="t.k"
      class="fp-phasetab"
      :class="{ on: modelValue === t.k }"
      @click="emit('update:modelValue', t.k)"
    >
      {{ t.label }}
      <span v-if="counts[t.k] != null" class="ct">{{ counts[t.k] }}</span>
    </button>
  </div>
</template>

<style scoped>
/* ponytail: 1:1 copy of FPPhaseTabs scoped styles (those are scoped, not global —
   this separate component must carry its own pill styling) */
.fp-phasetabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--surface-sunken);
  border-radius: var(--radius-full);
}

.fp-phasetab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 16px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  white-space: nowrap;
  transition: color var(--dur-fast), background var(--dur-fast);
}

.fp-phasetab:hover {
  color: var(--text-secondary);
}

.fp-phasetab.on {
  background: var(--surface-white);
  color: var(--text-primary);
  box-shadow: 0 1px 4px rgba(28, 28, 28, 0.12);
}

.fp-phasetab .ct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--text-disabled);
}

.fp-phasetab.on .ct {
  color: var(--hue-blue);
}
</style>
