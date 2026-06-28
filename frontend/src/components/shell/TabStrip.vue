<script setup lang="ts">
// TabStrip — browser-style tab bar. Ported from shell.jsx .fp-tabstrip.
// ponytail: overflow dropdown uses simple horizontal scroll — ResizeObserver overflow menu
// deferred (plan permits). Marked with overflow-scroll class.
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { fpBuildRoutes } from '@/nav/fpNav'
import { iconFor } from '@/components/ds/icon'
import { X, Pin, ChevronDown, Plus } from 'lucide-vue-next'

const emit = defineEmits<{ 'open-command': [mode: string] }>()

const router = useRouter()
const route = useRoute()
const tabs = useTabsStore()
const ROUTES = fpBuildRoutes()

// The ordered list of visible tabs: pinned first, then preview appended if not pinned
const order = computed(() => {
  const list = tabs.tabs.filter(t => ROUTES[t.value]).map(t => t.value)
  if (tabs.preview && ROUTES[tabs.preview.value] && !list.includes(tabs.preview.value)) {
    list.push(tabs.preview.value)
  }
  return list
})

// ponytail: per-chip close visibility — preview always closable; pinned only when >1 pinned tab
function canClose(value: string): boolean {
  if (tabs.preview?.value === value && !tabs.tabs.some(t => t.value === value)) return true
  return tabs.tabs.length > 1
}

// current active tab = route value
const activeValue = computed(() => (route.meta as Record<string, string>).value ?? '')

// overflow detection via ResizeObserver
const tabsRef = ref<HTMLElement | null>(null)
const overflow = ref(false)
const menuOpen = ref(false)

let ro: ResizeObserver | null = null
onMounted(() => {
  if (tabsRef.value) {
    const check = () => {
      overflow.value = (tabsRef.value?.scrollWidth ?? 0) - (tabsRef.value?.clientWidth ?? 0) > 2
    }
    check()
    ro = new ResizeObserver(check)
    ro.observe(tabsRef.value)
  }
  document.addEventListener('mousedown', onDocClick)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  document.removeEventListener('mousedown', onDocClick)
})

// re-check overflow when tab list changes
watch(order, () => nextTick(() => {
  if (!tabsRef.value) return
  overflow.value = tabsRef.value.scrollWidth - tabsRef.value.clientWidth > 2
}))

function onDocClick() {
  menuOpen.value = false
}

// scroll active tab into view
watch(activeValue, async () => {
  await nextTick()
  const el = tabsRef.value
  if (!el) return
  const node = el.querySelector<HTMLElement>(`[data-tabv="${activeValue.value}"]`)
  if (!node) return
  const l = node.offsetLeft, r = l + node.offsetWidth
  if (l < el.scrollLeft) el.scrollLeft = l - 8
  else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8
})

function selectTab(value: string) {
  tabs.open(value)
  router.push('/' + value)
  menuOpen.value = false
}

function pinTab(value: string) {
  tabs.pin(value)
}

function closeTab(value: string) {
  const current = activeValue.value
  const neighbor = tabs.close(value)
  // if we closed the active tab, navigate to neighbor
  if (value === current && neighbor) {
    router.push('/' + neighbor)
  }
}

function onNewTab() {
  emit('open-command', 'new')
}
</script>

<template>
  <div class="fp-tabstrip">
    <!-- scrollable tab list -->
    <div class="fp-tabs" ref="tabsRef">
      <div
        v-for="value in order"
        :key="value"
        :data-tabv="value"
        class="fp-tab"
        :class="{
          on: value === activeValue,
          preview: value === tabs.preview?.value && !tabs.tabs.some(t => t.value === value),
        }"
        :title="ROUTES[value]?.layerLabel + ' / ' + ROUTES[value]?.page"
        @click="selectTab(value)"
        @dblclick="pinTab(value)"
      >
        <span class="fp-tab-ic">
          <component :is="iconFor(ROUTES[value]?.icon ?? '')" :size="14" />
        </span>
        <span class="fp-tab-label">{{ ROUTES[value]?.page }}</span>
        <span class="fp-tab-trail">
          <!-- pin button for preview tabs -->
          <button
            v-if="value === tabs.preview?.value && !tabs.tabs.some(t => t.value === value)"
            class="fp-tab-btn"
            aria-label="固定标签页"
            @click.stop="pinTab(value)"
            title="固定为常驻标签"
          >
            <Pin :size="13" />
          </button>
          <!-- close button -->
          <button
            class="fp-tab-btn"
            aria-label="关闭标签页"
            :style="{ visibility: canClose(value) ? 'visible' : 'hidden' }"
            @click.stop="closeTab(value)"
          >
            <X :size="14" />
          </button>
        </span>
      </div>
    </div>

    <!-- actions: overflow dropdown + new tab -->
    <div class="fp-tab-actions">
      <button
        v-if="overflow"
        class="fp-tab-overflow"
        aria-label="全部标签页"
        @mousedown.stop
        @click="menuOpen = !menuOpen"
        title="全部标签页"
      >
        <ChevronDown :size="15" />
        <span>{{ order.length }}</span>
      </button>
      <button class="fp-tab-new" aria-label="新建标签页" @click="onNewTab" title="新建标签页">
        <Plus :size="16" />
      </button>
    </div>

    <!-- overflow dropdown menu -->
    <div
      v-if="menuOpen"
      class="fp-tablist-pop"
      @mousedown.stop
    >
      <div class="fp-tablist-hd">全部标签页 · {{ order.length }}</div>
      <div
        v-for="value in order"
        :key="value"
        class="fp-tablist-row"
        :class="{ on: value === activeValue }"
        @click="selectTab(value)"
      >
        <component :is="iconFor(ROUTES[value]?.icon ?? '')" :size="15" />
        <span
          class="nm"
          :class="{ it: value === tabs.preview?.value && !tabs.tabs.some(t => t.value === value) }"
        >{{ ROUTES[value]?.page }}</span>
        <button
          v-if="canClose(value)"
          class="x"
          aria-label="关闭"
          @click.stop="closeTab(value)"
        >
          <X :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fp-tabstrip {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 8px;
  gap: 6px;
  border-bottom: 1px solid var(--divider);
  background: var(--surface-card);
  box-sizing: border-box;
}

.fp-tabs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  height: 100%;
  padding: 6px 0;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.fp-tabs::-webkit-scrollbar { display: none; }

.fp-tab {
  flex: 1 1 0;
  min-width: 42px;
  max-width: 196px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 6px 0 11px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--text-muted);
  background: transparent;
  transition:
    background var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.fp-tab:hover {
  background: rgba(28, 28, 28, 0.05);
  color: var(--text-secondary);
}
.fp-tab.on,
.fp-tab.on:hover {
  min-width: 124px;
  background: var(--surface-white);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(28, 28, 28, 0.10);
}

.fp-tab-ic {
  flex: 0 0 auto;
  display: inline-flex;
  opacity: 0.55;
}
.fp-tab:hover .fp-tab-ic,
.fp-tab.on .fp-tab-ic { opacity: 1; }

.fp-tab-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  line-height: 20px;
  font-weight: var(--fw-regular);
  overflow: hidden;
  text-overflow: ellipsis;
}
.fp-tab.on .fp-tab-label { font-weight: var(--fw-semibold); }
.fp-tab.preview .fp-tab-label { font-style: italic; }

.fp-tab-trail {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 1px;
}

.fp-tab-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: var(--text-disabled);
  flex: 0 0 auto;
  opacity: 0;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast), opacity var(--dur-fast);
}
.fp-tab:hover .fp-tab-btn,
.fp-tab.on .fp-tab-btn { opacity: 1; }
.fp-tab-btn:hover {
  background: rgba(28, 28, 28, 0.08);
  color: var(--text-primary);
}

.fp-tab-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: 6px;
  margin-left: 2px;
  border-left: 1px solid var(--divider);
}

.fp-tab-new {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background var(--dur-fast), color var(--dur-fast);
}
.fp-tab-new:hover {
  background: rgba(28, 28, 28, 0.05);
  color: var(--text-primary);
}

.fp-tab-overflow {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 9px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: background var(--dur-fast), color var(--dur-fast);
}
.fp-tab-overflow:hover {
  background: rgba(28, 28, 28, 0.05);
  color: var(--text-primary);
}

/* overflow dropdown */
.fp-tablist-pop {
  position: absolute;
  top: 43px;
  right: 6px;
  z-index: 60;
  width: 288px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 6px;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(28, 28, 28, 0.12);
}
.fp-tablist-hd {
  padding: 6px 10px 4px;
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--text-disabled);
}
.fp-tablist-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 9px;
  border-radius: 8px;
  cursor: pointer;
}
.fp-tablist-row:hover { background: var(--bg-hover); }
.fp-tablist-row.on { background: var(--accent-slate); }
.fp-tablist-row .nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-primary);
}
.fp-tablist-row .nm.it { font-style: italic; color: var(--text-secondary); }
.fp-tablist-row .x {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-disabled);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}
.fp-tablist-row .x:hover {
  background: var(--ink-100);
  color: var(--text-primary);
}
</style>
