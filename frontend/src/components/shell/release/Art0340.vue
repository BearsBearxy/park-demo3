<script setup lang="ts">
// 0.34.0 重点「导入中心」的配图:导入中心页头 + 两行清单的缩样。
// 页头照 views/import-center/ImportCenterView.vue:月份框(DatePicker month 的「2026 / 09」)+ 入口胶囊(components/fp/FPAlertChip.vue 的 .fac:
// 橙描边、--warn-soft 底、alert-triangle 13 → 这里 11)。清单行照 .ix-row / .ix-chip / .ix-dot:名字一行、状态一行
// (真屏状态在右边一列,178 宽放不下,照真屏 ≤600 那档折到名字下面);缺的胶囊 .ix-chip.miss、缺的圆点 data-k="miss" 都是橙。
// 讲两件事:分公司的表哪家这个月没有(台账「水电」橙);按月的表这个月有没有(工资「没有」橙)。名字照 importRegistry 的 name(跟侧栏)。
// 公司名用内置的三家管理公司简称(租赁 / 综合 / 水电,同导入中心改稿),不是哪个客户的真名。字压到 12 / 11。
import { iconFor } from '@/components/ds/icon'
</script>

<template>
  <div class="hd">
    <span class="pd">2026 / 09</span>
    <span class="fac"><component :is="iconFor('alert-triangle')" :size="11" />还差 5 样</span>
  </div>
  <div class="row">
    <span class="nm">月度台账</span>
    <span class="st"><i class="chip">租赁</i><i class="chip">综合</i><i class="chip miss">水电</i></span>
  </div>
  <div class="row">
    <span class="nm">附表12 工资明细</span>
    <span class="st"><i class="dot miss">没有</i></span>
  </div>
</template>

<style scoped>
.hd { display: flex; align-items: center; gap: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--divider); white-space: nowrap; }
.pd { display: inline-flex; align-items: center; height: 22px; padding: 0 7px; box-sizing: border-box; border: 1px solid var(--border-control);
  border-radius: var(--radius-sm); background: var(--surface-white); font-size: var(--fs-micro); color: var(--text-primary); }
.fac { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 8px; box-sizing: border-box;
  border: 1px solid var(--status-warning); border-radius: var(--radius-full); background: var(--warn-soft);
  font-size: var(--fs-micro); font-weight: var(--fw-medium); color: var(--status-warning); }
.row { display: flex; flex-direction: column; gap: 3px; padding: 6px 2px; border-bottom: 1px solid var(--divider); }
.row:last-child { border-bottom: none; }
.nm { font-size: var(--fs-label); line-height: 16px; font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; }
.st { display: flex; align-items: center; gap: 3px; }
.chip { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; box-sizing: border-box; border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full); background: var(--surface-card); font-style: normal; font-size: var(--fs-micro); color: var(--text-secondary); }
.chip.miss { border-color: var(--status-warning); background: var(--warn-soft); color: var(--warn-text); }
.dot { display: inline-flex; align-items: center; gap: 5px; font-style: normal; font-size: var(--fs-micro); line-height: 18px; color: var(--text-secondary); }
.dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--hue-blue); }
.dot.miss { color: var(--warn-text); }
.dot.miss::before { background: var(--status-warning); }
</style>
