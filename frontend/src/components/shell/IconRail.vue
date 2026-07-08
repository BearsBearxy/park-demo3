<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FP_NAV, fpFindLayer } from '@/nav/fpNav'
import { useTabsStore } from '@/stores/tabs'
import { iconFor } from '@/components/ds/icon'
import Avatar from '@/components/ds/Avatar.vue'

const emit = defineEmits<{ 'open-command': [] }>()

const route = useRoute()
const router = useRouter()

// ponytail: activeLayer derived from route — no store needed in this task
const activeLayer = computed(() =>
  fpFindLayer((route.meta as Record<string, string>).value ?? '')
)

// 层切换=侧边栏级显式导航 → 全新状态(openFresh,复审:非侧边栏入口语义)
const tabsStore = useTabsStore()
function goLayer(home: string) {
  tabsStore.openFresh(home)
  router.push('/' + home)
}
</script>

<template>
  <div class="fp-rail">
    <!-- brand mark: 40×40 radius 13 white bg hairline -->
    <div class="fp-rail-mark">
      <img src="@/assets/factory-park-mark.svg" width="22" height="22" alt="Factory Park" />
    </div>

    <!-- separator: 30×1px margin 9/7 -->
    <div class="fp-railsep" />

    <!-- layer buttons -->
    <button
      v-for="layer in FP_NAV"
      :key="layer.id"
      class="fp-rail-btn"
      :class="{ on: layer.id === activeLayer.id }"
      @click="goLayer(layer.home)"
    >
      <component :is="iconFor(layer.icon)" :size="20" />
      <span>{{ layer.short }}</span>
    </button>

    <!-- footer: margin-top auto -->
    <div class="fp-rail-foot">
      <!-- command button: emits open-command for Task 6 to wire -->
      <button class="fp-rail-cmd" @click="emit('open-command')">
        <component :is="iconFor('command')" :size="16" />
      </button>
      <Avatar name="周明" :size="32" />
    </div>
  </div>
</template>

<style scoped>
.fp-rail {
  width: 66px;
  flex: 0 0 66px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 9px;
  gap: 5px;
  box-sizing: border-box;
  background: var(--surface-sunken);
}

.fp-rail-mark {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.fp-rail-mark img {
  display: block;
}

.fp-railsep {
  width: 30px;
  height: 1px;
  background: var(--border-subtle);
  margin: 9px 0 7px;
  flex: 0 0 auto;
}

.fp-rail-btn {
  width: 48px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 15px;
  cursor: pointer;
  padding: 9px 0 7px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: var(--fw-medium);
  flex: 0 0 auto;
  transition: color var(--dur-fast) var(--ease-standard);
}

.fp-rail-btn:hover {
  background: rgba(28, 28, 28, 0.05);
  color: var(--text-secondary);
}

.fp-rail-btn.on,
.fp-rail-btn.on:hover {
  background: var(--ink-900);
  color: #fff;
  box-shadow: 0 6px 16px rgba(28, 28, 28, 0.2);
}

.fp-rail-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  padding-top: 10px;
}

.fp-rail-cmd {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-white);
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}

.fp-rail-cmd:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
