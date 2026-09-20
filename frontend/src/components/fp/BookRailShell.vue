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

    <!-- ≤960 左轨收成顶部横向 chips(RESPONSIVE-LAYOUT-SPEC §5.6):选择语义与轨内点击同源
         —— 都发同一个 select 事件,宿主只有一条处理路径。≥961 display:none,桌面零变化。
         一处不照抄 LedgerView:本壳的 BookRail 固定 :can-manage="false",轨上根本没有新增/删除钮,
         所以这里也不画那颗虚线管理 chip —— 那屏有是因为那屏的轨上真有。 -->
    <div class="brs-chips">
      <button v-for="b in books" :key="b.id" class="brs-chip" :class="{ on: b.id === activeId }"
              :aria-pressed="b.id === activeId" @click="$emit('select', b.id)">{{ b.name }}</button>
    </div>

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

/* 顶部 chips:桌面档不存在(display:none),窄档媒体块内再显 —— 宽档规则在前(CSS 顺序铁律) */
.brs-chips { display: none; }

/* ── M/S 档(≤960):左轨收成顶部横向 chips(RESPONSIVE-LAYOUT-SPEC §5.6)。
      S 档「同 M」,不另开 600 块 —— 本壳的 books 恒为两项(三屏都是常量 MODES),
      横滚区放得下,没有「选中项滚出视口」这回事,也就不需要 sheet。 */
@media (max-width: 960px) {
  .brs { flex-direction: column; gap: 12px; }
  .brs-rail { display: none; }
  .brs-chips { flex: 0 0 auto; display: flex; gap: 8px; overflow-x: auto; padding: 2px; }
  .brs-chip {
    flex: 0 0 auto; display: inline-flex; align-items: center;
    height: 36px; padding: 0 14px; border-radius: var(--radius-full);
    border: 1px solid var(--border-control); background: var(--surface-white);
    color: var(--text-secondary); font-family: var(--font-sans);
    font-size: var(--fs-label); font-weight: var(--fw-medium);
    cursor: pointer; white-space: nowrap;
  }
  /* 选中态只换色不改尺寸(布局稳定铁律,同 BookRail .br-item.on 语义) */
  .brs-chip.on { border-color: var(--hue-blue); background: var(--accent-blue); color: var(--text-primary); }
}
</style>
