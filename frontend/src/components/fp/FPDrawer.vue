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
  <Teleport to="body">
    <div v-if="open" class="fp-dwr-backdrop" @mousedown="emit('close')">
    <div class="fp-dwr" :style="{ width: `min(${width}px, 94vw)` }" role="dialog" aria-modal="true" @mousedown.stop>
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
    </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 居中弹窗(取代原型右抽屉;参考 CommandPalette 居中卡)。见 DESIGN-FIDELITY §7。 */
.fp-dwr-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(28, 28, 28, .34);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  opacity: 0;
  animation: fpDwrFade .18s var(--ease-standard, ease) forwards;
}
@keyframes fpDwrFade { to { opacity: 1; } }

.fp-dwr {
  z-index: 301;
  display: flex;
  flex-direction: column;
  max-height: min(85vh, 760px);
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(28, 28, 28, .28);
  overflow: hidden;
  transform: translateY(8px) scale(.985);
  opacity: 0;
  animation: fpDwrIn .2s var(--ease-standard, ease) forwards;
}
@keyframes fpDwrIn { to { transform: none; opacity: 1; } }

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
