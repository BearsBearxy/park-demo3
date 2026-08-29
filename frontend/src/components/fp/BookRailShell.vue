<script setup lang="ts">
// 一屏两本账的外壳(2026-08-29 设计稿 §②):左栏常驻 + 主区。
// 光伏/充电桩/电费三屏此前各抄一份同字节的 aside+CSS(pvw/chw/e11w 三个家族)——
// 收敛到这一件,改一处三屏同变(第 5 步「共享件」;与月度台账 .lgw 家族同形)。
import BookRail, { type RailItem } from './BookRail.vue'

defineProps<{
  /** 左栏顶上的小标题(模块名:光伏发电 / 充电桩 / 电费) */
  title: string
  books: readonly RailItem[]
  activeId: number | string | null
}>()

defineEmits<{
  (e: 'select', id: number | string): void
}>()
</script>

<template>
  <div class="brs">
    <!-- 左栏:两本账一键切换(BOOK-WORKBENCH-SPEC §7-2 实体切换在左栏)。
         改前这是一道整屏拦住的功能门,而且不记得你上次选了哪本 —— 每次进来重答一遍。 -->
    <aside class="brs-rail">
      <div class="brs-rail-t">{{ title }}</div>
      <BookRail :books="books" :active-id="activeId" :can-manage="false"
                @select="$emit('select', $event)" />
    </aside>

    <div class="brs-main">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.brs { display: flex; gap: 16px; width: 100%; height: 100%; min-height: 0; box-sizing: border-box;
       font-family: var(--font-sans); color: var(--text-primary); }
.brs-rail {
  flex: 0 0 176px; min-height: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 14px 12px; box-sizing: border-box;
  background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
}
.brs-rail-t { font-size: 12px; font-weight: var(--fw-medium); color: var(--text-muted); padding: 0 4px; }
.brs-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
</style>
