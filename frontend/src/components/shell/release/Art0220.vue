<script setup lang="ts">
// 0.22.0 重点「公共电核算的池能按月改」的配图:池抽屉三段的抬头 + 抽屉级「只改本月起」勾选框的缩样。
// 字、色照 PoolLedgerView 抄(.pl-sectitle / .pl-chip.ok / .pl-chkline),三段压成一张分隔线列表(照 Art0200 的 .ls),
// 字号压到 12 / 11,高度压在「本次更新」卡片文字栏以内(桌面宽实测文字栏 125px)。
// 数是示意:2026-10-04 用户拍板产品卖给别的园区,配图每个客户都看得到,不再取我园某个池的真实形状和月份。
import { Check } from 'lucide-vue-next'
</script>

<template>
  <ul class="ls">
    <li><span class="t">算哪些电表</span><span class="chip ok">已选 2 块</span></li>
    <li><span class="t">从别的池折进来的标准 · 0 条</span></li>
    <li><span class="t">摊给谁</span><span class="chip ok">已选 3 户</span></li>
  </ul>
  <div class="chk"><span class="box"><Check :size="10" :stroke-width="3" /></span>只改本月起（<span class="ym">2026-01</span>）</div>
</template>

<style scoped>
.ls { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.ls li { display: flex; align-items: center; gap: 6px; padding: 4px 8px; line-height: 16px; border-bottom: 1px solid var(--divider); }
.ls li:last-child { border-bottom: none; }
.t { flex: 1; min-width: 0; font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip { flex: 0 0 auto; font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 0 7px; white-space: nowrap; }
.chip.ok { background: var(--ok-soft); color: var(--ok-text); }
.chk { display: flex; align-items: center; gap: 6px; line-height: 16px; font-size: var(--fs-label); color: var(--text-secondary); white-space: nowrap; }
.box {
  flex: 0 0 auto; width: 13px; height: 13px; border-radius: 3px; display: grid; place-items: center;
  background: var(--hue-blue); color: var(--text-on-solid);
}
.ym { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-micro); }
</style>
