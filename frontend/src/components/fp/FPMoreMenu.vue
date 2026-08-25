<script setup lang="ts">
// 工具条溢出菜单「⋯」(EDIT-MODE-SPEC §5 工具条规范):编辑态里只读动作(导出/打印类)
// 不消失只降级 —— v2 时代「导出被关在浏览态分支」的坑不重蹈,又不让低频动作占主行宽度。
// 浮层规矩(UI-OVERLAY-SPEC):点外关走 document capture(带 open 守卫),Esc 自关并 stopPropagation
// (内层浮层赢,宿主弹窗听 bubble);无 <Transition>(repo 禁令)。
import { ref, onBeforeUnmount, watch } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { iconFor } from '@/components/ds/icon'

export interface MoreItem { key: string; label: string; icon?: string; disabled?: boolean }

const props = defineProps<{ items: MoreItem[] }>()
const emit = defineEmits<{ (e: 'select', key: string): void }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onDocDown(e: MouseEvent) {
  if (!open.value) return   // open 守卫:关着时不拦别人的点击
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  e.stopPropagation()   // 只关自己,不冒泡关掉宿主弹窗
  open.value = false
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey, true)
  } else {
    document.removeEventListener('mousedown', onDocDown, true)
    document.removeEventListener('keydown', onKey, true)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey, true)
})

function pick(it: MoreItem) {
  if (it.disabled) return
  open.value = false
  emit('select', it.key)
}
</script>

<template>
  <div ref="root" class="fp-more">
    <button class="fp-more-btn" :class="{ on: open }" type="button" title="更多操作"
            @click="open = !open">
      <MoreHorizontal :size="16" />
    </button>
    <div v-if="open" class="fp-more-pop" role="menu">
      <button v-for="it in props.items" :key="it.key" class="fp-more-item" role="menuitem"
              :disabled="it.disabled" @click="pick(it)">
        <component :is="iconFor(it.icon ?? 'circle')" v-if="it.icon" :size="14" />
        {{ it.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.fp-more { position: relative; flex: none; }
.fp-more-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-white); cursor: pointer; color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.fp-more-btn:hover, .fp-more-btn.on { color: var(--text-primary); border-color: var(--border-strong); }
.fp-more-pop {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: var(--z-popover);
  min-width: 148px; padding: 4px;
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); box-shadow: var(--shadow-pop);
  display: flex; flex-direction: column; gap: 1px;
}
.fp-more-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  border: none; border-radius: var(--radius-sm);
  background: transparent; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-secondary);
  text-align: left; white-space: nowrap;
}
.fp-more-item:hover:not(:disabled) { background: var(--surface-sunken); color: var(--text-primary); }
.fp-more-item:disabled { color: var(--text-disabled); cursor: default; }
</style>
