<script setup lang="ts">
// 表格卡工具条(画布 03-A 卡内右上「分时用量 · 列 · 2 列隐藏」、04-A「分时列 · 列」、05-A 放「批量确认」;
// 实现规范 §1.9)。卡内右对齐一条:默认插槽 + 可选分时开关 + 「列 · N 列隐藏」勾选菜单。
// mode 取 touMode():'none' 不出开关(04-C 宿舍:一块分时表都没有,连开关也不给)。columns 空 = 不出列菜单。
// 开关和列显隐都受控(v-model:tou / v-model:hidden);开关记忆由调用方 saveTouPref,这里不碰存储。
import { computed } from 'vue'
import { Check, Columns3 } from 'lucide-vue-next'
import Button from '@/components/ds/Button.vue'
import Popover from '@/components/ds/Popover.vue'
import PopoverItem from '@/components/ds/PopoverItem.vue'
import type { TouMode } from '@/utils/touColumns'

export interface ToolColumn { key: string; label: string }

const props = withDefaults(defineProps<{
  mode?: TouMode
  switchLabel?: string
  tou?: boolean
  columns?: ToolColumn[]
  hidden?: string[]
}>(), { mode: 'none', switchLabel: '分时用量', tou: false, columns: () => [], hidden: () => [] })

const emit = defineEmits<{ 'update:tou': [on: boolean]; 'update:hidden': [keys: string[]] }>()

const nHidden = computed(() => props.columns.filter(c => props.hidden.includes(c.key)).length)

function toggleCol(key: string) {
  emit('update:hidden', props.hidden.includes(key) ? props.hidden.filter(k => k !== key) : [...props.hidden, key])
}
</script>

<template>
  <div class="fp-tt">
    <slot />
    <button v-if="mode !== 'none'" type="button" role="switch" class="fp-tt-sw" :aria-checked="tou"
            @click="emit('update:tou', !tou)">
      <span class="trk" :class="{ on: tou }"><i /></span>{{ switchLabel }}
    </button>
    <Popover v-if="columns.length" align="end" :width="168">
      <template #trigger>
        <Button class="fp-tt-cols" variant="borderless" size="sm" aria-haspopup="menu">
          <template #leading><Columns3 :size="14" /></template>
          列<template v-if="nHidden"> · {{ nHidden }} 列隐藏</template>
        </Button>
      </template>
      <div role="menu">
        <PopoverItem v-for="c in columns" :key="c.key" class="fp-tt-col" role="menuitemcheckbox"
                     :aria-checked="!hidden.includes(c.key)" @click="toggleCol(c.key)">
          <template #icon><Check :size="14" :class="{ off: hidden.includes(c.key) }" /></template>
          {{ c.label }}
        </PopoverItem>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.fp-tt {
  display: flex; align-items: center; justify-content: flex-end; gap: 16px;
  min-height: 44px; padding: 0 12px;
}
.fp-tt-sw {
  display: inline-flex; align-items: center; gap: 8px;
  height: 28px; padding: 0; border: none; background: none; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-secondary); white-space: nowrap;
}
.fp-tt-sw .trk {
  position: relative; flex: none; width: 28px; height: 16px;
  border-radius: var(--radius-full); background: var(--ink-300);
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-tt-sw .trk i {
  position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  border-radius: var(--radius-full); background: var(--surface-raised); box-shadow: var(--shadow-pill);
  transition: transform var(--dur-fast) var(--ease-standard);
}
.fp-tt-sw .trk.on { background: var(--control-solid); }
.fp-tt-sw .trk.on i { transform: translateX(12px); background: var(--control-solid-text); }
.fp-tt .fp-tt-cols.ds-btn { --ds-btn-fg: var(--text-secondary); }   /* 压过 Button 自己的 [data-variant] 配色 */
.fp-tt-col .off { visibility: hidden; }
</style>
