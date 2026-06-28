<script setup lang="ts">
import { computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fpFindLayer } from '@/nav/fpNav'
import { iconFor } from '@/components/ds/icon'
import SidebarNav from '@/components/ds/SidebarNav.vue'

const route = useRoute()
const router = useRouter()

// ponytail: route-derived, same pattern as IconRail — no store needed
const activeLayer = computed(() =>
  fpFindLayer((route.meta as Record<string, string>).value ?? '')
)

const activeValue = computed(() =>
  (route.meta as Record<string, string>).value ?? ''
)

// Map FP_NAV sections → DS SidebarNav shape (drop `kind`)
const sections = computed(() =>
  activeLayer.value.sections.map(s => ({
    title: s.title,
    items: s.items.map(it => ({
      value: it.value,
      label: it.label,
      icon: h(iconFor(it.icon) as any, { size: 16 }),
    })),
  }))
)

function onSelect(value: string) {
  router.push('/' + value)
}
</script>

<template>
  <div class="fp-panel">
    <!-- header: layer icon + label -->
    <div class="fp-panel-hdr">
      <component :is="iconFor(activeLayer.icon)" :size="18" />
      <span class="nm">{{ activeLayer.label }}</span>
    </div>
    <!-- full-bleed divider -->
    <div class="fp-panel-div" />
    <!-- nav body -->
    <SidebarNav
      :sections="sections"
      :active="activeValue"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.fp-panel {
  width: 234px;
  flex: 0 0 234px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px 14px;
  box-sizing: border-box;
  overflow-y: auto;
}

.fp-panel-hdr {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 6px;
  color: var(--text-primary);
}

.fp-panel-hdr .nm {
  font-size: 16px;
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
}

/* full-bleed: margin compensates parent padding */
.fp-panel-div {
  height: 1px;
  background: var(--divider);
  margin: 0 -14px;
}
</style>
