<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { iconFor } from '@/components/ds/icon'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  subtitle?: string
  icon?: string
  width?: number
}>(), { width: 640 })

const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
// re-register on open change so handler is always live
watch(() => props.open, () => {})
</script>

<template>
  <template v-if="open">
    <div class="fp-dwr-backdrop" @click="emit('close')" />
    <aside class="fp-dwr" :style="{ width: `min(${width}px, 94vw)` }" role="dialog" aria-modal="true">
      <div class="fp-dwr-hd">
        <span v-if="icon" class="fp-dwr-icon">
          <component :is="iconFor(icon)" :size="20" />
        </span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h3 style="margin:0;font-size:var(--fs-h3);font-weight:var(--fw-semibold);color:var(--text-primary)">{{ title }}</h3>
            <slot name="badge" />
          </div>
          <p v-if="subtitle" style="margin:4px 0 0;font-size:var(--fs-label);color:var(--text-muted)">{{ subtitle }}</p>
        </div>
        <button class="fp-dwr-x" @click="emit('close')" aria-label="关闭">
          <component :is="iconFor('x')" :size="18" />
        </button>
      </div>
      <div class="fp-dwr-body">
        <slot />
      </div>
      <div v-if="$slots.footer" class="fp-dwr-ft">
        <slot name="footer" />
      </div>
    </aside>
  </template>
</template>

<style scoped>
.fp-dwr-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(28, 28, 28, .34);
  backdrop-filter: blur(2px);
  opacity: 0;
  animation: fpDwrFade .18s var(--ease-standard, ease) forwards;
}
@keyframes fpDwrFade { to { opacity: 1; } }

.fp-dwr {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 301;
  display: flex;
  flex-direction: column;
  background: var(--surface-white);
  box-shadow: -12px 0 40px rgba(28, 28, 28, .18);
  transform: translateX(24px);
  opacity: 0;
  animation: fpDwrIn .22s var(--ease-standard, ease) forwards;
}
@keyframes fpDwrIn { to { transform: translateX(0); opacity: 1; } }

.fp-dwr-hd {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--divider);
}

.fp-dwr-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--surface-card);
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  flex: 0 0 auto;
}

.fp-dwr-x {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background var(--dur-fast), color var(--dur-fast);
}
.fp-dwr-x:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.fp-dwr-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.fp-dwr-ft {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--divider);
  background: var(--surface-card);
}
</style>
