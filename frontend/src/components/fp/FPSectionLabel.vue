<script setup lang="ts">
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{ icon?: string }>()

// ponytail: 1:1 from fp-master-ui.jsx FPSectionLabel + .fp-sec-label CSS
const IconComp = computed(() => props.icon ? iconFor(props.icon) : null)
</script>

<template>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
    <span style="font-size:var(--fs-micro);font-weight:var(--fw-semibold);letter-spacing:.04em;color:var(--text-disabled);text-transform:uppercase;display:flex;align-items:center;gap:7px;margin:0">
      <component v-if="IconComp" :is="IconComp" :size="13" />
      <slot />
    </span>
    <slot name="right" />
  </div>
</template>
