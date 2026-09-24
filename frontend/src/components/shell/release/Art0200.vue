<script setup lang="ts">
// 0.20.0 重点「园区抄表的档案变更」的配图:抽屉「档案变更」页签里「在册状态」一节的缩样。
// 字、色、几何照 MeterTimelinePane 抄(区间 mono / 停用 caution-text、已拆 text-muted / 查看月那一段 row-selected),
// 区间写法照 meterTimeline.rangeText(「A ~ B」「M 起」),字号压到 12 / 11。月份落在库里有读数的 2023-08 ~ 2024-02 前后。
import { History } from 'lucide-vue-next'
</script>

<template>
  <div class="hd">在册状态</div>
  <ul class="ls">
    <li><span class="rg">2023-08 ~ 2024-02</span><span class="st">在用</span></li>
    <li class="cur"><span class="rg">2024-03 ~ 2024-08</span><span class="st retired">停用</span></li>
    <li><span class="rg">2024-09 起</span><span class="st removed">已拆</span></li>
  </ul>
  <div class="ft"><History :size="11" />改哪一段，只动那几个月</div>
</template>

<style scoped>
.hd { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ls { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.ls li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--divider); }
.ls li:last-child { border-bottom: none; }
.ls li.cur { background: var(--row-selected); }
.rg { flex: 1; min-width: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-micro); color: var(--text-primary); white-space: nowrap; }
.st { flex: 0 0 auto; font-size: var(--fs-label); color: var(--text-primary); }
.st.retired { color: var(--caution-text); }
.st.removed { color: var(--text-muted); }
.ft { display: flex; align-items: center; gap: 5px; margin-top: 2px; font-size: var(--fs-micro); color: var(--text-muted); }
</style>
