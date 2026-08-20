<script setup lang="ts">
// 期间回退横幅(§五策略2「回退必须显式」):所选期无该源数据回退口径期时告知,禁止静默回退。
// 仅 selected !== used 时由调用方渲染(本组件不做该判断)。
import { iconFor } from '@/components/ds/icon'

defineProps<{ selected: string; used: string; source?: string }>()
</script>

<template>
  <div class="ana-pbanner">
    <component :is="iconFor('alert-triangle')" :size="13" />
    <span>所选 {{ selected }} 无{{ source ?? '' }}数据,当前显示 {{ used }}</span>
  </div>
</template>

<style scoped>
.ana-pbanner { display: flex; align-items: center; gap: 6px; background: #faeeda; color: #854f0b; border-radius: 8px; padding: 7px 12px; font-size: var(--fs-micro); line-height: 1.4; }
.ana-pbanner svg { flex: 0 0 auto; }
</style>
