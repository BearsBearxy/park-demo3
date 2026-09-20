<script setup lang="ts">
// 0.16.0 重点「手机上的分析首页」的配图:落地页缩样 —— 搜索条 + 两枚数瓦。
// 字与颜色照 AnaHomeView 的 .ah-search / .ah-tile 抄,字号压到 12 / 11。
// 数是真数据的形状(收缴率 81.3% 与驾驶舱第 4 瓦同源),不写「示例」。
import { Search, Target, CalendarClock } from 'lucide-vue-next'
</script>

<template>
  <div class="sr"><Search :size="12" />搜一个数</div>
  <div class="gd">
    <div class="tl">
      <span class="lb"><Target :size="10" />收缴率</span>
      <span class="vl">81.3%</span>
      <span class="sb">距目标 96%</span>
    </div>
    <div class="tl">
      <span class="lb"><CalendarClock :size="10" />未来12月到期</span>
      <span class="vl">64 份</span>
      <span class="sb">涉及 ¥31.7万/月</span>
    </div>
  </div>
</template>

<style scoped>
.sr {
  display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px;
  border: 1px solid var(--border-control); border-radius: var(--radius-full);
  background: var(--surface-card); color: var(--text-muted); font-size: var(--fs-micro);
}
.gd { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.tl {
  display: flex; flex-direction: column; gap: 2px; padding: 8px;
  border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--surface-white);
}
.lb { display: flex; align-items: center; gap: 4px; font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vl { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.sb { font-size: var(--fs-micro); color: var(--text-muted-tint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
