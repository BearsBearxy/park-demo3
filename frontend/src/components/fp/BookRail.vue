<script setup lang="ts">
// 账册工作台左轨(BOOK-WORKBENCH-SPEC §5/§7-2):本屏账册一键切换 + 公司/账册管理入口。
// canManage = company:manage(第15权限点):新增与删除入口并排在底部管理区——
// 删除不放行内(用户拍板 2026-08-24:hover 删除钮夹在选册点击目标中间,易误触且与新增分家);
// 点「删除账册」只发 delete 事件,选哪一册在宿主的两步弹窗里定。
import { Plus, Trash2 } from 'lucide-vue-next'
import type { Book } from '@/types/book'

defineProps<{
  books: Book[]
  activeId: number | null
  canManage: boolean
}>()

defineEmits<{
  (e: 'select', id: number): void
  (e: 'create'): void
  (e: 'delete'): void
}>()
</script>

<template>
  <div class="book-rail">
    <div class="br-list">
      <div
        v-for="b in books"
        :key="b.id"
        class="br-item"
        :class="{ on: b.id === activeId }"
        role="button"
        tabindex="0"
        @click="$emit('select', b.id)"
        @keydown.enter="$emit('select', b.id)"
      >
        <span class="br-name">{{ b.name }}</span>
        <span class="br-ver">v{{ b.ver }}</span>
      </div>
    </div>
    <!-- 底部管理区(company:manage 门):新增与删除并排,与选册行为分离 -->
    <div v-if="canManage" class="br-manage">
      <button class="br-create" @click="$emit('create')">
        <Plus :size="14" />
        新增账册
      </button>
      <button class="br-delete" @click="$emit('delete')">
        <Trash2 :size="13" />
        删除账册
      </button>
    </div>
  </div>
</template>

<style scoped>
.book-rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.br-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.br-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 10px var(--space-3);
  /* 布局稳定铁律:高亮条常驻 2px,active 只换色不改尺寸 */
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  text-align: left;
  transition: background var(--dur-fast), border-color var(--dur-fast);
}

.br-item:hover {
  background: var(--surface-sunken);
}

.br-item.on {
  border-left-color: var(--hue-blue);
  background: var(--accent-blue);
}

.br-name {
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.br-item.on .br-name {
  color: var(--text-primary);
}

.br-ver {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  color: var(--text-disabled);
  background: var(--surface-sunken);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}

.br-item.on .br-ver {
  color: var(--hue-blue);
  background: var(--surface-white);
}

.br-manage {
  flex: none;
  display: flex;
  gap: 6px;
  margin-top: var(--space-2);
}

.br-manage .br-create { flex: 1; margin-top: 0; }

.br-delete {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 9px var(--space-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}

.br-delete:hover { color: var(--hue-red); border-color: var(--hue-red); }

.br-create {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: var(--space-2);
  padding: 9px var(--space-3);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}

.br-create:hover {
  color: var(--hue-blue);
  border-color: var(--hue-blue);
}
</style>
