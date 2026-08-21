<script setup lang="ts">
import { computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { fpFindLayer } from '@/nav/fpNav'
import { visibleLayers } from '@/nav/navAccess'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import SidebarNav from '@/components/ds/SidebarNav.vue'

const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const auth = useAuthStore()

// 与 IconRail 同口径:按角色的 navLayers 过滤('system' 层不进 navLayers,按 system:view 判)
const layers = computed(() => visibleLayers(auth.navLayers, auth.can('system:view')))

// ponytail: route-derived, same pattern as IconRail
// 当前屏属于不可见层时(读全开,深链能进)不展开那一层的目录,退回第一个可见层
const activeLayer = computed(() => {
  const L = fpFindLayer((route.meta as Record<string, string>).value ?? '')
  return layers.value.includes(L) ? L : (layers.value[0] ?? L)
})

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
  // 侧边栏点击 = 全新状态:openFresh 递增 epoch,即使该页有 KeepAlive 缓存也重置(spec 2026-07-07 §二)
  tabs.openFresh(value)
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
