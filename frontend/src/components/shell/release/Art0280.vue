<script setup lang="ts">
// 0.28.0 重点「管理员能按模块授权查看」的配图:角色权限屏模块矩阵的缩样 —— 表头「模块 / 查看 / 编辑」+ 三行。
// 行照 views/system/SystemRolesView.vue 的 .sr-mx-r(三列网格、行间 divider)与 .sr-mx-h(表头 11px 灰字)抄;
// 复选框是原生 checkbox 配 accent-color: var(--hue-blue),这里画成同色实心方块 + 白勾。字压到 12 / 11。
// 三行讲三件事:主数据勾了编辑就带着查看;台账与附表只看不改;工资只有查看一格、这个角色没勾。
// 编辑格的字是后端 Perm.META 的原名(主数据 / 事后录入),模块名照前端 MODULES。
import { iconFor } from '@/components/ds/icon'
</script>

<template>
  <div class="r h"><span>模块</span><span>查看</span><span>编辑</span></div>
  <div class="r">
    <span class="nm">主数据</span>
    <span><i class="cb on"><component :is="iconFor('check')" :size="10" /></i></span>
    <span class="ed"><i class="cb on"><component :is="iconFor('check')" :size="10" /></i>主数据</span>
  </div>
  <div class="r">
    <span class="nm">台账与附表</span>
    <span><i class="cb on"><component :is="iconFor('check')" :size="10" /></i></span>
    <span class="ed"><i class="cb" />事后录入</span>
  </div>
  <div class="r">
    <span class="nm">工资</span>
    <span><i class="cb" /></span>
    <span class="ed none">—</span>
  </div>
</template>

<style scoped>
.r { display: grid; grid-template-columns: 64px 30px minmax(0, 1fr); gap: 6px; align-items: center; padding: 5px 2px;
  border-bottom: 1px solid var(--divider); font-size: var(--fs-label); line-height: 16px; color: var(--text-primary); white-space: nowrap; }
.r:last-child { border-bottom: none; }
.h { padding-top: 0; font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--text-muted); }
.ed { display: inline-flex; align-items: center; gap: 4px; }
.none { color: var(--text-disabled); }
.cb { flex: none; display: inline-grid; place-items: center; width: 12px; height: 12px; box-sizing: border-box;
  border: 1px solid var(--border-control); border-radius: 3px; background: var(--surface-white); color: var(--control-solid-text); vertical-align: middle; }
.cb.on { border-color: var(--hue-blue); background: var(--hue-blue); }
</style>
