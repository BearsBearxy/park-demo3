<script setup lang="ts">
// 0.26.0 重点「导入进度」的配图:导入弹窗里换上的进度卡缩样,四行 —— 标题「正在导入 N 条」、真进度条、「第 k 段 / 已写入 a / N 条」、逐段写入那一步。
// 记号照 components/import/ImportProgressCard.vue 的 .ipc-h / .ipc-bar / .ipc-sub / .ipc-steps 抄,字压到 12 / 11。
// 数是示意(2026-10-04 用户拍板产品卖给别的园区,配图每个客户都看得到,不再用我园那次导入的规模)。
</script>

<template>
  <div class="h">正在导入 <b>120</b> 条</div>
  <div class="bar"><i /></div>
  <div class="sub"><span>第 5 段</span><span>已写入 <b>70</b> / 120 条</span></div>
  <div class="st"><span class="spin" />逐段写入<em>4 / 8 段</em></div>
</template>

<style scoped>
.h { font-size: var(--fs-label); line-height: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); margin-bottom: 6px; white-space: nowrap; }
.h b, .sub b { font-family: var(--font-mono); font-weight: var(--fw-semibold); color: var(--text-primary); }
.bar { position: relative; height: 6px; border-radius: 3px; background: var(--border-subtle); overflow: hidden; margin-bottom: 4px; }
.bar > i { position: absolute; top: 0; bottom: 0; left: 0; width: 58%; border-radius: inherit; background: var(--hue-blue); }
.sub { display: flex; justify-content: space-between; gap: 8px; font-family: var(--font-mono); font-size: var(--fs-micro); line-height: 16px; color: var(--text-muted); margin-bottom: 6px; white-space: nowrap; }
.st { display: flex; align-items: center; gap: 6px; font-size: var(--fs-label); line-height: 20px; color: var(--text-primary); white-space: nowrap; }
.st em { margin-left: auto; font-style: normal; font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-muted); }
.spin { flex: none; width: 12px; height: 12px; margin: 0 1px; box-sizing: border-box; border-radius: var(--radius-full);
  border: 2px solid var(--hue-blue); border-right-color: transparent; }
</style>
