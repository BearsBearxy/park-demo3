<script setup lang="ts">
// 期间回退横幅(§五策略2「回退必须显式」):所选期无该源数据回退口径期时告知,禁止静默回退。
// 仅 selected !== used 时由调用方渲染(本组件不做该判断)。
import { iconFor } from '@/components/ds/icon'

// selected/used 仍必填:默认文案渲染要用到,传插槽覆盖文案的调用方(如未闭月护栏的离群月提示)
// 手上也总是有这两个值(在报的期、实际用的期),一并传上——放开成可选,换来的是漏传的调用方
// 到运行时才现出「undefined」,而不是编译期直接报错,五个既有屏不该为一个新调用方兜底。
defineProps<{ selected: string; used: string; source?: string }>()
</script>

<template>
  <div class="ana-pbanner">
    <component :is="iconFor('alert-triangle')" :size="13" />
    <span><slot>所选 {{ selected }} 无{{ source ?? '' }}数据,当前显示 {{ used }}</slot></span>
  </div>
</template>

<style scoped>
.ana-pbanner { display: flex; align-items: center; gap: 6px; background: #faeeda; color: #854f0b; border-radius: 8px; padding: 7px 12px; font-size: var(--fs-micro); line-height: 1.4; }
.ana-pbanner svg { flex: 0 0 auto; }
</style>
