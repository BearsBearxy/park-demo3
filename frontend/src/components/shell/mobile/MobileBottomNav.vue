<script setup lang="ts">
// 手机底栏(S 档,RESPONSIVE-LAYOUT-SPEC §4.1):层级导航,IconRail 在手机上的化身。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fpFindLayer } from '@/nav/fpNav'
import { visibleLayers } from '@/nav/navAccess'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const tabsStore = useTabsStore()

// 与 IconRail 同口径:按角色 navLayers 过滤,'system' 层不进 navLayers、跟 system:view 走
const layers = computed(() => visibleLayers(auth.navLayers, auth.can('system:view')))
const activeLayer = computed(() =>
  fpFindLayer((route.meta as Record<string, string>).value ?? '')
)

// 层切换=显式导航 → 全新状态(openFresh,IconRail.goLayer 同语义)
function goLayer(home: string) {
  tabsStore.openFresh(home)
  router.push('/' + home)
}
</script>

<template>
  <nav class="mbn">
    <button
      v-for="layer in layers"
      :key="layer.id"
      class="mbn-tab"
      :class="{ on: layer.id === activeLayer.id }"
      @click="goLayer(layer.home)"
    >
      <span class="mbn-ic">
        <component :is="iconFor(layer.icon)" :size="20" />
      </span>
      <span>{{ layer.short }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mbn {
  /* safe-area 由栏自身 padding 承接(规范 §10 S 档高度链裁定,不用 fixed) */
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
  flex: 0 0 auto;
  display: flex;
  border-top: 1px solid var(--divider);
  background: var(--surface-white);
}

/* 每格 flex:1 定宽居中:激活态的胶囊/配色变化不挪动相邻格(零位移) */
.mbn-tab {
  flex: 1 1 0;
  min-width: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  transition: color var(--dur-fast) var(--ease-standard);
}
.mbn-tab.on { color: var(--text-primary); }

.mbn-ic {
  display: grid;
  place-items: center;
  width: 44px;
  height: 26px;
  border-radius: var(--radius-full);
}
.mbn-tab.on .mbn-ic { background: var(--accent-slate); }
</style>
