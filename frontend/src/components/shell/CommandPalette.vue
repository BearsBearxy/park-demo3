<script setup lang="ts">
// CommandPalette — Ctrl-K quick-jump. Ported from shell.jsx CommandPalette.
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import { Search, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-vue-next'
import { filterPages, buildAllPages } from './paletteFilter'

const props = defineProps<{
  open: boolean
  mode: 'jump' | 'new'
}>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const tabs = useTabsStore()
const auth = useAuthStore()

const query = ref('')
const idx = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

// 不可见层的屏不进面板;跟着 navLayers 走(换账号后重算,不能只 build 一次)
const allPages = computed(() => buildAllPages(auth.navLayers, auth.can('system:view')))

const groups = computed(() =>
  filterPages(query.value, allPages.value, tabs.recent)
)
const flat = computed(() => groups.value.flatMap(g => g.items))
const safeIdx = computed(() => Math.min(idx.value, Math.max(0, flat.value.length - 1)))

// reset + autofocus on open
watch(() => props.open, open => {
  if (open) {
    query.value = ''
    idx.value = 0
    setTimeout(() => inputRef.value?.focus(), 30)
  }
})

function choose(value: string) {
  tabs.open(value, { pin: props.mode === 'new' })
  router.push('/' + value)
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); idx.value = Math.min(idx.value + 1, flat.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); idx.value = Math.max(idx.value - 1, 0) }
  else if (e.key === 'Enter') { e.preventDefault(); const p = flat.value[safeIdx.value]; if (p) choose(p.value) }
  else if (e.key === 'Escape') { e.preventDefault(); emit('close') }
}

function onQueryInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  idx.value = 0
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fp-pal-backdrop" @mousedown="emit('close')">
      <div class="fp-pal" @mousedown.stop>
        <!-- search input row -->
        <div class="fp-pal-search">
          <Search :size="18" />
          <input
            ref="inputRef"
            :value="query"
            @input="onQueryInput"
            @keydown="onKey"
            placeholder="跳转到页面 — 输入页面名或所属模块…"
          />
          <kbd class="fp-kbd fp-kbd-esc">Esc</kbd>
        </div>

        <!-- results body -->
        <div class="fp-pal-body">
          <div v-if="flat.length === 0" class="fp-pal-empty">
            没有匹配 "{{ query.trim() }}" 的页面
          </div>
          <template v-for="group in groups" :key="group.title">
            <div v-if="group.items.length > 0" style="margin-bottom: 6px">
              <div class="fp-pal-grouphdr">{{ group.title }}</div>
              <div
                v-for="(page, gi) in group.items"
                :key="page.value"
                class="fp-pal-row"
                :class="{ on: flat.indexOf(page) === safeIdx }"
                @mouseenter="idx = flat.indexOf(page)"
                @click="choose(page.value)"
              >
                <span class="fp-pal-ic">
                  <component :is="iconFor(page.icon)" :size="16" />
                </span>
                <span class="fp-pal-name">{{ page.label }}</span>
                <span class="fp-pal-layer">
                  <component :is="iconFor(page.layerIcon)" :size="13" />
                  {{ page.layerLabel }}
                </span>
                <CornerDownLeft v-if="flat.indexOf(page) === safeIdx" :size="14" />
              </div>
            </div>
          </template>
        </div>

        <!-- footer hints -->
        <div class="fp-pal-foot">
          <span class="sp"><ArrowUp :size="12" /><ArrowDown :size="12" />切换</span>
          <span class="sp"><CornerDownLeft :size="12" />打开</span>
          <span class="fp-pal-foot-hint">跨层跳转 · 无需先切层</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fp-pal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(28, 28, 28, 0.32);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 11vh;
}

.fp-pal {
  width: min(620px, 92vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--surface-white);
  border-radius: 16px;
  border: 1px solid var(--border-subtle);
  box-shadow: 0 24px 64px rgba(28, 28, 28, 0.28);
  overflow: hidden;
}

.fp-pal-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider);
  flex: 0 0 auto;
}

.fp-pal-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 15px;
  color: var(--text-primary);
}

.fp-kbd-esc {
  color: var(--text-muted);
  background: var(--surface-card);
  display: inline-flex;
  align-items: center;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 2px 7px;
  white-space: nowrap;
}

.fp-pal-body {
  overflow-y: auto;
  padding: 8px;
  flex: 1;
}

.fp-pal-empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--text-disabled);
  font-size: 14px;
}

.fp-pal-grouphdr {
  padding: 6px 10px 4px;
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--text-disabled);
  letter-spacing: 0.02em;
}

.fp-pal-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 10px;
  border-radius: 9px;
  cursor: pointer;
  background: transparent;
}
.fp-pal-row.on {
  background: var(--accent-slate);
}

.fp-pal-ic {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  background: var(--surface-card);
  color: var(--text-secondary);
}
.fp-pal-row.on .fp-pal-ic {
  background: var(--surface-white);
}

.fp-pal-name {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: var(--fw-medium);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-pal-layer {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  flex: 0 0 auto;
}

.fp-pal-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 16px;
  border-top: 1px solid var(--divider);
  background: var(--surface-card);
  font-size: 12px;
  color: var(--text-muted);
  flex: 0 0 auto;
}
.fp-pal-foot .sp {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.fp-pal-foot-hint {
  margin-left: auto;
  color: var(--text-disabled);
}
</style>
