<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Pagination from '@/components/ds/Pagination.vue'

const props = defineProps<{
  page: number
  pageCount: number
  total?: number
  // 紧凑模式(窄 sidebar):只显 上一页/下一页 + 页码跳转下拉,不显整排页码(宽度随页变→溢出窄卡)
  compact?: boolean
}>()

const emit = defineEmits<{ (e: 'page', n: number): void }>()

// JumpSelect state
const open = ref(false)
const wrapRef = ref<HTMLDivElement | null>(null)

function onDoc(e: MouseEvent) {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  // Esc 只关跳页浮层,不连坐宿主弹窗(UI-OVERLAY-SPEC §2)
  if (e.key === 'Escape') { e.stopPropagation(); open.value = false }
}

// capture 阶段:宿主容器带 @mousedown.stop 时冒泡监听收不到事件,点外面不关(UI-OVERLAY-SPEC §1)
onMounted(() => {
  document.addEventListener('mousedown', onDoc, true)
  document.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc, true)
  document.removeEventListener('keydown', onKey, true)
})

function pick(p: number) {
  emit('page', p)
  open.value = false
}
</script>

<template>
  <!-- ponytail: 1:1 port of fp-pager.jsx; JumpSelect inlined, opens upward -->
  <div class="fp-pager" :class="{ 'fp-pager-compact': compact }">
    <div class="fp-pager-left">
      <!-- 紧凑模式:上一页箭头(固定宽,不随页码变) -->
      <button v-if="compact" type="button" class="fp-nav" :disabled="page <= 1" aria-label="上一页" @click="emit('page', page - 1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <!-- JumpSelect: opens upward -->
      <div ref="wrapRef" class="fp-jump-wrap">
        <button
          type="button"
          class="fp-jump-trigger"
          :aria-expanded="open"
          aria-haspopup="listbox"
          @click="open = !open"
        >
          <span style="white-space:nowrap">第 {{ page }} / {{ pageCount }} 页</span>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            class="fp-jump-chevron" :class="{ 'fp-jump-chevron--open': open }"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>

        <div v-if="open" role="listbox" class="fp-jump-panel">
          <button
            v-for="p in pageCount"
            :key="p"
            type="button"
            role="option"
            :aria-selected="p === page"
            class="fp-jump-item"
            :class="{ 'fp-jump-item--on': p === page }"
            @click="pick(p)"
          >
            <span>第 {{ p }} 页</span>
            <svg
              v-if="p === page"
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
              style="flex:0 0 auto"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 紧凑模式:下一页箭头 -->
      <button v-if="compact" type="button" class="fp-nav" :disabled="page >= pageCount" aria-label="下一页" @click="emit('page', page + 1)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      <span v-if="total != null" class="fp-pager-total">共 {{ total }} 条</span>
    </div>

    <Pagination v-if="!compact" :page="page" :pageCount="pageCount" :showMeta="false" @page="(p: number) => emit('page', p)" />
  </div>
</template>

<style scoped>
.fp-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 2px;
}

.fp-pager-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 紧凑模式:居中,上一页/下一页箭头固定 32px,页码用跳转下拉;整体宽度稳定不随页变 */
.fp-pager-compact { justify-content: center; }
.fp-pager-compact .fp-pager-left { gap: 8px; }
.fp-nav {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex: 0 0 auto; box-sizing: border-box;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-white); color: var(--text-secondary); cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-nav:hover:not(:disabled) { background: var(--surface-card); }
.fp-nav:disabled { color: var(--text-disabled); cursor: default; opacity: .55; }

/* JumpSelect:宽随内容自适应,深页码(如「第 26 / 26 页」)不溢出按钮边框 */
.fp-jump-wrap {
  position: relative;
  width: auto;
  min-width: 116px;
}

.fp-jump-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 32px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 10px 0 12px;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.fp-jump-trigger:focus-visible {
  outline: 2px solid var(--hue-blue);
  outline-offset: 2px;
}
.fp-jump-trigger[aria-expanded="true"] {
  border-color: var(--border-strong);
}

.fp-jump-chevron {
  color: var(--text-muted);
  flex: 0 0 auto;
  transition: transform var(--dur-fast) var(--ease-standard);
}
.fp-jump-chevron--open {
  transform: rotate(180deg);
}

.fp-jump-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 60;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: 6px;
  max-height: 240px;
  overflow-y: auto;
  box-sizing: border-box;
}

.fp-jump-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  font-weight: var(--fw-regular);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-jump-item:hover {
  background: var(--bg-hover);
}
.fp-jump-item--on {
  font-weight: var(--fw-medium);
}

/* "共 N 条" */
.fp-pager-total {
  font: var(--type-body);
  color: var(--text-muted);
}
</style>
