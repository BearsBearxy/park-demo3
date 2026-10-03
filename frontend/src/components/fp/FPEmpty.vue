<script setup lang="ts">
/**
 * 空状态 · 加载失败（十件 ⑦，画布 06-B ⑦ / 03-B / 05-B / 06-D 右格）。
 *
 * 内容区没东西可显示时，**换掉内容区本身**：图标方块 + 一句 + 副句 + 至多一个按钮，居中。
 * 不是表格上方的流内条（LAYOUT-STABILITY §3）。调用处让它和表格互斥（v-if / v-else）。
 *
 *   <FPEmpty tone="empty" sub="按 8 月读数和 9 月租金生成" action="生成本月" @action="gen">2023-09 的催缴单还没生成</FPEmpty>
 *
 * - tone=error 带 role=alert；加载失败请直接用 FPLoadError（按钮恒为「重试」）。
 * - size=sm 是 06-D 右格那一档（图卡里用，AnaEmpty 走它）。
 * - #action 插槽覆盖默认按钮（AnaEmpty 放跳转链接）。
 * - flex 只长不缩：放在定高 flex 列里能撑满内容区，挤的时候也不把自己的字压出盒子。
 */
import { AlertCircle } from 'lucide-vue-next'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

withDefaults(defineProps<{
  tone?: 'empty' | 'error'
  /** 副句：为什么 / 屏上现在是什么样 */
  sub?: string
  /** 按钮文案；不传不出按钮 */
  action?: string
  size?: 'md' | 'sm'
}>(), { tone: 'empty', size: 'md' })

defineEmits<{ action: [] }>()
</script>

<template>
  <div class="fp-empty" :class="[tone, size]" :role="tone === 'error' ? 'alert' : undefined">
    <span class="ic" aria-hidden="true">
      <component :is="tone === 'error' ? AlertCircle : iconFor('circle-dashed')" :size="size === 'sm' ? 16 : 20" />
    </span>
    <div class="t"><slot /></div>
    <p v-if="sub" class="sub">{{ sub }}</p>
    <div v-if="$slots.action || action" class="act">
      <slot name="action">
        <Button :variant="tone === 'error' ? 'outline' : 'filled'" :size="size" @click="$emit('action')">
          <template v-if="tone === 'error'" #leading><component :is="iconFor('refresh-cw')" :size="size === 'sm' ? 14 : 16" /></template>
          {{ action }}
        </Button>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.fp-empty {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 200px;
  padding: 24px 16px;
  text-align: center;
}
.fp-empty.sm { min-height: 150px; padding: 16px; }

.ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: 12px;
  border-radius: var(--radius-md);
  background: var(--info-soft);
  color: var(--info-text-on-tint);
}
.error .ic { background: var(--danger-soft); color: var(--delta-down-text); }
.sm .ic { width: 36px; height: 36px; margin-bottom: 8px; }

/* 字一律折行、不截断（不许省略号）；max-width 只管读起来不太长 */
.t, .sub { max-width: 640px; overflow-wrap: anywhere; }
.t {
  font-size: var(--fs-h3);
  font-weight: var(--fw-semibold);
  line-height: 24px;
  color: var(--text-primary);
}
.sm .t { font-size: var(--fs-body); line-height: 20px; }
.sub {
  margin: 6px 0 0;
  font-size: var(--fs-body);
  line-height: 20px;
  color: var(--text-muted);
}
.sm .sub { margin-top: 4px; font-size: var(--fs-label); line-height: 18px; }

.act { margin-top: 16px; }
.sm .act { margin-top: 10px; }
</style>
