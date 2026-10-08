<script setup lang="ts">
// 0.33.0 重点「角色权限」的配图:角色屏权限树的缩样 —— 表头「菜单 / 查看 / 编辑 / 其他动作」+ 层一行 + 两屏。
// 行照 views/system/SystemRolesView.vue 的 .sr-tr(网格、行间 divider)、.sr-th(表头 11px 灰字)、.sr-tr-l(层那一行米白底、加粗)抄;
// 复选框是原生 checkbox 配 accent-color: var(--hue-blue),这里画成同色实心方块 + 白勾,半勾画白横(层那一行的「部分」)。字压到 12 / 11。
// 讲三件事:同一层里部分单项没授权(层那一行半勾);催缴单勾了编辑没勾签发(动作挂在那一屏下);楼栋损耗只看不改。
// 屏名、动作名照 fpNav 与 Perm.META(「催缴单 · 签发」取「 · 」后面那段)。
import { iconFor } from '@/components/ds/icon'
</script>

<template>
  <div class="r h"><span>菜单</span><span>查看</span><span>编辑</span><span>其他动作</span></div>
  <div class="r l">
    <span class="nm">数据中心</span>
    <span><i class="cb on"><component :is="iconFor('minus')" :size="10" /></i></span>
    <span><i class="cb on"><component :is="iconFor('minus')" :size="10" /></i></span>
    <span><i class="cb" /></span>
  </div>
  <div class="r">
    <span class="nm s">催缴单</span>
    <span><i class="cb on"><component :is="iconFor('check')" :size="10" /></i></span>
    <span><i class="cb on"><component :is="iconFor('check')" :size="10" /></i></span>
    <span class="ac"><i class="cb" />签发</span>
  </div>
  <div class="r">
    <span class="nm s">楼栋损耗</span>
    <span><i class="cb on"><component :is="iconFor('check')" :size="10" /></i></span>
    <span><i class="cb" /></span>
    <span class="none">—</span>
  </div>
</template>

<style scoped>
.r { display: grid; grid-template-columns: 58px 22px 22px minmax(0, 1fr); gap: 5px; align-items: center; padding: 5px 2px;
  border-bottom: 1px solid var(--divider); font-size: var(--fs-label); line-height: 16px; color: var(--text-primary); white-space: nowrap; }
.r:last-child { border-bottom: none; }
.h { padding-top: 0; font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--text-muted); }
.l { background: var(--surface-card); font-weight: var(--fw-semibold); }
.s { padding-left: 8px; }
.ac { display: inline-flex; align-items: center; gap: 4px; }
.none { color: var(--text-disabled); }
.cb { flex: none; display: inline-grid; place-items: center; width: 12px; height: 12px; box-sizing: border-box;
  border: 1px solid var(--border-control); border-radius: 3px; background: var(--surface-white); color: var(--control-solid-text); vertical-align: middle; }
.cb.on { border-color: var(--hue-blue); background: var(--hue-blue); }
</style>
