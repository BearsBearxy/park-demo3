<template>
  <div class="gallery fp-scroll">
    <h1 class="gallery__title">Design System Gallery</h1>
    <p v-if="componentNames.length === 0" class="gallery__empty">
      No components yet — add <code>.vue</code> files to <code>src/components/ds/</code>.
    </p>
    <div v-else class="gallery__grid">
      <div
        v-for="name in componentNames"
        :key="name"
        class="gallery__cell"
      >
        <p class="gallery__label">{{ name }}</p>
        <component :is="mods[name]" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// ponytail: eager glob — new DS components appear here without editing this file
const rawMods = import.meta.glob('../components/ds/*.vue', { eager: true }) as Record<string, { default: unknown }>

// Map filename stem -> component default export
const mods = computed(() =>
  Object.fromEntries(
    Object.entries(rawMods).map(([path, mod]) => {
      const name = path.replace('../components/ds/', '').replace('.vue', '')
      return [name, mod.default]
    }),
  ),
)

const componentNames = computed(() => Object.keys(mods.value))
</script>

<style scoped>
.gallery {
  height: 100%;
  padding: var(--space-8);
  background: var(--bg-app);
}

.gallery__title {
  font: var(--type-h1);
  color: var(--text-primary);
  margin-bottom: var(--space-6);
}

.gallery__empty {
  font: var(--type-body);
  color: var(--text-muted);
}

.gallery__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-6);
}

.gallery__cell {
  background: var(--bg-panel);
  border: var(--border-width) solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
}

.gallery__label {
  font: var(--type-label);
  color: var(--text-muted);
  margin-bottom: var(--space-4);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
}
</style>
