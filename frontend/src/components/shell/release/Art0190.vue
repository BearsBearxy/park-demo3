<script setup lang="ts">
// 0.19.0 重点「楼栋损耗能填备注」的配图:表里两行的缩样,右边那格是备注输入框。
// 字、色、几何照 LossLedgerView 抄(位置列 sans / 数字列 mono tabular-nums / 备注格 .ll-in),
// 字号压到 12 / 11。数取 2024-02 一期真实形状(D座 13,771.20 / −42.40),不写「示例」。
import { Pencil } from 'lucide-vue-next'
</script>

<template>
  <div class="hd"><span class="h1">位置</span><span class="h2">总表用电量</span><span class="h3">备注</span></div>
  <div class="rw">
    <span class="nm">一期 D座</span>
    <span class="nv">13,771.20</span>
    <span class="in">表在门卫室，2 月已校</span>
  </div>
  <div class="rw">
    <span class="nm">一期 E座</span>
    <span class="nv">12,801.60</span>
    <span class="in ph">点一下就能写</span>
  </div>
  <div class="ft"><Pencil :size="11" />进编辑模式后，只有备注这一格能改</div>
</template>

<style scoped>
.hd { display: flex; align-items: center; gap: 8px; padding-bottom: 5px; border-bottom: 1px solid var(--divider); }
.h1, .h2, .h3 { font-size: var(--fs-micro); color: var(--text-muted); }
.h1 { flex: 0 0 62px; }
.h2 { flex: 0 0 66px; text-align: right; }
.h3 { flex: 1; min-width: 0; }
.rw { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--divider); }
.nm { flex: 0 0 62px; font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; }
.nv { flex: 0 0 66px; text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--text-secondary); }
.in {
  flex: 1; min-width: 0; font-size: 11.5px; color: var(--text-primary);
  padding: 2px 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  background: var(--surface-white); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.in.ph { color: var(--text-disabled); border-style: dashed; }
.ft { display: flex; align-items: center; gap: 5px; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-muted); }
</style>
