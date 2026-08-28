<script setup lang="ts">
/**
 * 换期重取时贴在容器顶边的一条 2px 进度线（加载态设计稿 §08）。
 *
 * 它是「正在重取」的**唯一**信号 —— 因为旧内容留在原地不动（§06 第一档），
 * 不给信号的话用户根本不知道发生了什么，那些屏现在就是这么静默的。
 *
 * 为什么是顶边一条线而不是转圈：
 *   · 不占版面高度 → 不位移（LAYOUT-STABILITY §1）
 *   · 它长在容器上，指向明确 —— 是「这块在重取」，不是「整页在忙」
 *
 * ⚠ 宿主容器要有 `position: relative`，否则这条线会跑到最近的定位祖先上去。
 *   本组件不替宿主设 —— 那得包一层 div，而本仓的定高链经不起多一个盒子。
 */
defineProps<{
  /** 亮不亮。**传 useDeferredFlag 的结果，不要直接传 loading** —— 否则快响应时闪一下。 */
  on: boolean
}>()
</script>

<template>
  <span v-if="on" class="fp-lb" role="progressbar" aria-label="正在加载"><i /></span>
</template>

<style scoped>
.fp-lb {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 2px;
  overflow: hidden;
  pointer-events: none;
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
}
.fp-lb i {
  position: absolute;
  inset: 0;
  display: block;
  background: var(--hue-blue);
  transform: translateX(-100%);
  animation: fp-lb-sweep 900ms var(--ease-both) infinite;
}
@keyframes fp-lb-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* 减少动效:与 .page-spin 同一条理由 —— 停下会被读成「卡死了」。
   这里保留动画但去掉横向位移，改成整条呼吸,既不闪也不静止。 */
@media (prefers-reduced-motion: reduce) {
  .fp-lb i {
    animation: fp-lb-pulse 1.6s ease-in-out infinite;
    transform: none;
  }
  @keyframes fp-lb-pulse {
    0%, 100% { opacity: 0.30; }
    50%      { opacity: 0.85; }
  }
}
</style>
