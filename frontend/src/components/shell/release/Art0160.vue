<script setup lang="ts">
// 0.16.0 重点「宽表的手机形态」的配图:月度台账在手机上的两张行卡缩样。
// 字、色、几何照 FPWideCards 的 88 档抄(第一行名字 + 状态胶囊 / 第二行金额 mono / 第三行次级句),
// 字号压到 12 / 11。数是真数据的形状,不写「示例」。
import { CircleCheck } from 'lucide-vue-next'
</script>

<template>
  <div class="cd">
    <div class="r1"><span class="nm">鑫诚精密科技</span><span class="pl ok"><i class="d"></i>已结清</span></div>
    <div class="vl">¥148,620</div>
    <div class="sb">已收 ¥148,620 · 收缴 100%</div>
  </div>
  <div class="cd">
    <div class="r1"><span class="nm">嘉华新材料</span><span class="pl wa"><i class="d"></i>欠 ¥36,340</span></div>
    <div class="vl">¥96,340</div>
    <div class="sb">已收 ¥60,000 · 收缴 62%</div>
  </div>
  <div class="ft"><CircleCheck :size="11" />点一张卡看整行</div>
</template>

<style scoped>
.cd {
  display: flex; flex-direction: column; gap: 2px;
  padding: 7px 0; border-bottom: 1px solid var(--divider);
}
.r1 { display: flex; align-items: baseline; gap: 6px; }
.nm { flex: 1; min-width: 0; font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-micro); white-space: nowrap; }
.pl .d { width: 5px; height: 5px; border-radius: 50%; flex: 0 0 auto; }
.pl.ok { color: var(--ok-text); } .pl.ok .d { background: var(--hue-green); }
.pl.wa { color: var(--amber-text); } .pl.wa .d { background: var(--hue-orange); }
.vl { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.sb { font-size: var(--fs-micro); color: var(--text-muted-tint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ft { display: flex; align-items: center; gap: 5px; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-muted); }
</style>
