<script setup lang="ts">
// 0.13.0 重点「月结审核」的配图:本月出账清单缩样 —— 铃铛待审角标、待审核 / 已审核 / 交审三种行。
// 从 0.13.0 的 WhatsNewDialog 原样取回(那时配图写死在弹窗里,0.14.0 换图时被覆盖),只把角标字号收进字阶。
import { Bell, Check } from 'lucide-vue-next'
</script>

<template>
  <div class="h"><span>本月出账 · 2026-08</span><span class="bell"><Bell :size="14" /><i>2</i></span></div>
  <div class="r"><span>利润表</span><span class="s"><i class="dot"></i>待审核</span></div>
  <div class="r"><span>月度台账 · 一期</span><span class="s ok"><Check :size="12" />已审核</span></div>
  <div class="r"><span>附表10 销售收入</span><span class="btn">交审</span></div>
</template>

<style scoped>
.h {
  display: flex; align-items: center; justify-content: space-between; padding-bottom: 4px;
  font-size: var(--fs-micro); color: var(--text-muted); border-bottom: 1px solid var(--divider);
}
.bell { position: relative; display: inline-flex; color: var(--text-secondary); }
.bell i {
  position: absolute; top: -6px; right: -8px; min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: var(--radius-full); background: var(--hue-red); color: var(--control-solid-text);
  font-family: var(--font-mono); font-size: var(--fs-micro); font-style: normal; font-weight: var(--fw-semibold);
  display: grid; place-items: center; box-shadow: 0 0 0 1.5px var(--surface-white);
}
.r { display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 24px; font-size: var(--fs-label); }
.s { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-micro); color: var(--text-muted); }
.s.ok { color: var(--status-success); }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--hue-orange); }
.btn {
  height: 24px; padding: 0 10px; border-radius: var(--radius-full); background: var(--control-solid); color: var(--control-solid-text);
  font-size: var(--fs-micro); display: inline-flex; align-items: center;
}
</style>
