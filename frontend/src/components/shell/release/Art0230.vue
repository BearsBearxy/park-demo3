<script setup lang="ts">
// 0.23.0 重点「续签能选递增」的配图:续签框「这一期记成」二选一(选中递增)+ 续签链上前一段的「已递增」。
// 字照 ContractNewDialog 的 LINK_OPTS 一字不差;选项框色照 .ct-link / .ct-link.on 抄,链 chip 照 FPContractChain 的
// .cc-chip / .cc-seq / .cc-esc 抄,徽标直接用 FPContractStatus(renewed + label「已递增」,与抽屉里同一条路径)。
// 字号压到 12 / 11,高度压在「本次更新」卡片文字栏以内。合同号只取「编号#段」的形状,不用我园真号(2026-10-04 用户拍板产品卖给别的园区)。
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
</script>

<template>
  <div class="lab">这一期记成</div>
  <div class="opt"><span class="dot" />续签（换新约）</div>
  <div class="opt on"><span class="dot" />递增（同一份合同到年限涨价）</div>
  <div class="chain">
    <span class="seq">1</span><span class="no">HT-0001#1</span><FPContractStatus status="renewed" label="已递增" />
  </div>
</template>

<style scoped>
.lab { font-size: var(--fs-micro); line-height: 16px; color: var(--text-secondary); margin-bottom: 4px; }
.opt { display: flex; align-items: center; gap: 4px; padding: 3px 5px; margin-bottom: 4px; white-space: nowrap;
  border: 1px solid var(--border-control); border-radius: var(--radius-md); font-size: var(--fs-micro); line-height: 16px; color: var(--text-primary); }
.opt.on { border-color: var(--hue-blue); background: var(--accent-blue); }
.dot { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--border-control-strong); background: var(--surface-white); }
.opt.on .dot { border: 3px solid var(--hue-blue); }
.chain { display: flex; align-items: center; gap: 6px; padding: 3px 6px; margin-top: 2px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-white); }
.seq { flex: 0 0 auto; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center;
  background: var(--border-strong); color: var(--text-on-solid); font-size: var(--fs-micro); font-weight: var(--fw-semibold); }
.no { flex: 1; min-width: 0; font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; }
</style>
