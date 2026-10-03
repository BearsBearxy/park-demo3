<script setup lang="ts">
// 0.25.0 重点「铃铛通知」的配图:顶栏铃铛带红数字 + 面板里「等你处理」一行授权请求 + 「有结果了」一行带小蓝点。
// 记号照 NotifyBell 的 .nb-num(16 高、红底、2px 底色描边)抄,行照 NotifyPanel 的 .np-gh / .np-row / .np-ic / .np-dot 抄;
// 字压到 12 / 11。行内文字照面板真实拼法:「{请求人}请你授权{权限}」「{表} {期} 审核通过」。
import { iconFor } from '@/components/ds/icon'
</script>

<template>
  <div class="top"><span class="bell"><component :is="iconFor('bell')" :size="16" /><span class="num">4</span></span></div>
  <div class="gh">等你处理<span class="n">4</span></div>
  <div class="row"><span class="ic warn"><component :is="iconFor('user')" :size="12" /></span><span class="t">张会计请你授权改读数</span></div>
  <div class="row"><span class="dot" /><span class="ic ok"><component :is="iconFor('check')" :size="12" /></span><span class="t">公共电核算 2026-08 审核通过</span></div>
</template>

<style scoped>
.top { display: flex; justify-content: flex-end; margin-bottom: 4px; }
.bell { position: relative; display: grid; place-items: center; width: 24px; height: 24px; color: var(--text-secondary); }
.num { position: absolute; top: -4px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
  border-radius: var(--radius-full); background: var(--hue-red); color: var(--control-solid-text);
  font-family: var(--font-mono); font-size: var(--fs-micro); line-height: 16px; text-align: center;
  box-shadow: 0 0 0 2px var(--surface-white); }
.gh { font-size: var(--fs-micro); line-height: 16px; font-weight: var(--fw-semibold); color: var(--text-secondary); margin-bottom: 2px; }
.n { margin-left: 4px; font-weight: var(--fw-regular); color: var(--text-muted); }
.row { position: relative; display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 8px; margin-bottom: 2px;
  border-radius: var(--radius-sm); background: var(--surface-white); white-space: nowrap; }
.ic { flex: none; display: grid; place-items: center; width: 18px; height: 18px; border-radius: var(--radius-sm); }
.ic.warn { background: var(--warn-soft); color: var(--hue-orange); }
.ic.ok { background: var(--ok-soft); color: var(--ok-text); }
.dot { position: absolute; left: 1px; top: 50%; margin-top: -3px; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--hue-blue); }
.t { font-size: var(--fs-label); line-height: 16px; color: var(--text-primary); }
</style>
