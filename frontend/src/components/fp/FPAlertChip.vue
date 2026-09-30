<script setup lang="ts">
// 入口胶囊(十件 ②,LAYOUT-STABILITY-SPEC §6,画布 06-B ② / 01-A 卡2 / 01-B):28 高,和按钮同高;
// 位置固定、三态 —— 有(警示色+计数+▾)/ 无(quiet「无待处理」,仍渲染,不留空洞不挪版)/
// 筛选生效(active:实底 + ×,点 × emit clear 回到全部)。
// 问题面板(FPAlertPanel)拿它当 ds/Popover 的触发器;单独用时点它 emit open。
// ⭐count 口径全站钉死 = **待处理条目数**(Σ 各组 items.length,无 items 的组按 1 计),
//   不是组数——同一枚 chip 在不同屏上数字含义必须一致(否则用户学不会这个数字)。
import { iconFor } from '@/components/ds/icon'

// 透传属性(aria-expanded / aria-haspopup,FPAlertPanel 给的)落在「开面板」那颗按钮上,不落在筛选态的外壳上
defineOptions({ inheritAttrs: false })
// 筛选生效:一颗实底胶囊里并排两颗按钮(开面板 / 清除筛选)。× 不能嵌在 <button> 里 ——
// button 的子元素对读屏是展示性的,「清除筛选」的名字和角色会被吞掉,嵌套可聚焦元素也不合规。
// × 的 .stop 不让它顺带开关外面的弹层。(说明写在这里不写成模板注释:根上多一个注释节点,组件就成了多根,ref 拿到的 $el 是注释)

const props = withDefaults(defineProps<{
  count: number
  label?: string        // 有待处理时的名词,默认「待处理」
  quietLabel?: string   // 无待处理时的文案,默认「无待处理」
  /** 筛选生效(画布 01-B「缺起止日期 133 ×」):实底 + ×,label 传生效的那一项 */
  active?: boolean
}>(), { label: '待处理', quietLabel: '无待处理', active: false })

const emit = defineEmits<{ (e: 'open'): void; (e: 'clear'): void }>()
</script>

<template>
  <span v-if="props.active" class="fac on">
    <button class="fac-b" type="button" v-bind="$attrs" @click="emit('open')">
      <span>{{ props.label }} <b class="n">{{ props.count }}</b></span>
    </button>
    <button class="x" type="button" aria-label="清除筛选" @click.stop="emit('clear')">
      <component :is="iconFor('x')" :size="12" />
    </button>
  </span>
  <button v-else class="fac" :class="{ quiet: props.count === 0 }" type="button" v-bind="$attrs"
          @click="emit('open')">
    <component :is="iconFor(props.count ? 'alert-triangle' : 'check-circle-2')" :size="13" />
    <span v-if="props.count">{{ props.label }} <b class="n">{{ props.count }}</b></span>
    <span v-else>{{ props.quietLabel }}</span>
    <component v-if="props.count" :is="iconFor('chevron-down')" :size="12" class="dd" />
  </button>
</template>

<style scoped>
.fac {
  flex: none;
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px 0 11px;
  border: 1px solid var(--status-warning); border-radius: var(--radius-full);
  background: var(--warn-soft);
  cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); font-weight: var(--fw-medium);
  color: var(--status-warning); white-space: nowrap;
  transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
}
.fac:hover { background: rgb(250, 236, 218); }
:root[data-theme="dark"] .fac:hover { background: color-mix(in srgb, var(--warn-soft), var(--ink-900) 8%); }
/* 静默态:同尺寸同位置,只换色——切换有无告警时工具条不挪一像素 */
.fac.quiet {
  border-color: var(--border-subtle); background: transparent; color: var(--text-disabled);
}
.fac.quiet:hover { border-color: var(--border-strong); color: var(--text-muted); }
.fac .n { font-weight: var(--fw-semibold); }
.fac .dd { opacity: .7; }
/* 筛选生效:实底 + ×。字引 --control-solid-text:--hue-orange 实底上写白字,暗色下(浅橙底)只剩约 2:1
   (DARK-MODE-SPEC「落在 --hue-* 实底上的白字一律改引 --control-solid-text」) */
.fac.on { background: var(--status-warning); color: var(--control-solid-text); cursor: default; }
.fac.on:hover { background: var(--status-warning); }
.fac-b, .fac .x {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 0; border: none; background: none;
  font: inherit; color: inherit; cursor: pointer;
}
.fac .x {
  justify-content: center;
  width: 16px; height: 16px; margin-right: -4px; border-radius: var(--radius-full);
}
.fac .x:hover { background: color-mix(in srgb, var(--control-solid-text) 22%, transparent); }
</style>
