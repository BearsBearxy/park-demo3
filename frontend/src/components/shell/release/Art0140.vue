<script setup lang="ts">
// 0.14.0 重点「首页」的配图:首页缩样 —— 页签条上首页那格是当前页签,下面是搜索框、收藏、最近打开。
// 字取 HomeView(占位字、分区名一字不差),颜色取 TabStrip(条 = surface-sunken,当前页签 = surface-white)。
import { Plus, Search, Star } from 'lucide-vue-next'
import { iconFor } from '@/components/ds/icon'
</script>

<template>
  <div class="tabs">
    <span class="tab on"><component :is="iconFor('home')" :size="12" /></span>
    <span class="tab">本月出账</span>
    <span class="plus"><Plus :size="12" /></span>
  </div>
  <div class="search"><Search :size="12" /><span>搜索页面 / 分组…</span></div>
  <div class="r"><span>收藏</span><span class="s"><Star :size="12" class="star" />本月出账</span></div>
  <div class="r"><span>最近打开</span><span class="s">计费参数</span></div>
</template>

<style scoped>
.tabs {
  display: flex; align-items: flex-end; gap: 2px; height: 28px; padding: 0 3px; overflow: hidden;
  background: var(--surface-sunken); border-radius: 6px 6px 0 0;
}
.tab {
  height: 22px; padding: 0 6px; display: inline-flex; align-items: center;
  font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; border-radius: 6px 6px 0 0;
}
.tab.on { background: var(--surface-white); color: var(--text-primary); font-weight: var(--fw-medium); }
.plus { height: 22px; width: 18px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); }
.search {
  display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
  font-size: var(--fs-micro); color: var(--text-muted);
}
.r { display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 24px; font-size: var(--fs-label); }
.s { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-micro); color: var(--text-muted); }
.star { color: var(--hue-blue); fill: var(--hue-blue); flex: 0 0 auto; }   /* 同顶栏已收藏的 ☆(.fp-star-on) */
</style>
