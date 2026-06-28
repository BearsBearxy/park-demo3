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
