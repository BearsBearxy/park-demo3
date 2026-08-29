<script setup lang="ts">
/**
 * 通用选期矩阵门（2026-08-29「两本账」设计稿 §③）。
 *
 * 三个运营账屏（分栋抄表 / 分桩明细 / 电费成本总览）共用这一件。
 * 年份行由 `useMonthGate` 组好传进来，本组件只管渲染 + 把事件转出去。
 *
 * 与 `ChainMonthGate` 的分工：那个是出账链**五屏共一个期**的特例，
 * 格子里还要画五道工序的进度点；这个是通用的「一屏一个期」。
 * 两边的矩阵、手工年、连续补满规则都收在 `useMonthGate` / `utils/matrixYears` 里，不重复。
 */
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import { iconFor } from '@/components/ds/icon'
import type { GateRow } from '@/composables/useMonthGate'

defineProps<{
  title: string
  icon: string
  sub?: string
  rows: GateRow[]
  /** 这一格的锁作用域，用来显示「谁在编辑」。不传 = 不标。 */
  scopeOf?: (year: number, month: number) => string | null
  /** 首载未完成 —— 显转圈，不闪一张空矩阵。 */
  loading?: boolean
  /** 首载失败的人话。给了就整屏说加载失败 + 重试，不给半张矩阵。 */
  error?: string | null
}>()

const emit = defineEmits<{
  pick: [year: number, month: number]
  'add-earlier': []
  'add-later': []
  'remove-year': [year: number]
  retry: []
}>()
</script>

<template>
  <div class="fmg">
    <div class="fmg-head">
      <div>
        <h2 class="fmg-title">
          <span class="ic"><component :is="iconFor(icon)" :size="18" /></span>{{ title }}
        </h2>
        <p class="fmg-sub">{{ sub ?? '选择月份进入 · 空月可直接进入录入 / 导入' }}</p>
      </div>
    </div>

    <FPLoadError v-if="error" @retry="emit('retry')">
      <span>{{ error }} —— 矩阵没显示出来，不是这些月都没数据。</span>
    </FPLoadError>

    <div v-else-if="loading" class="page-loading"><span class="page-spin" /></div>

    <BookMonthMatrix
      v-else
      :scope-of="scopeOf"
      :book="{}"
      :years="rows"
      @pick="(y, m) => emit('pick', y, m)"
      @add-earlier="emit('add-earlier')"
      @add-later="emit('add-later')"
      @remove-year="(y) => emit('remove-year', y)"
    />
  </div>
</template>

<style scoped>
.fmg {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  font-family: var(--font-sans);
  color: var(--text-primary);
}
.fmg-head { flex: 0 0 auto; }
.fmg-title {
  margin: 0;
  font: var(--type-h2);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.fmg-title .ic {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--accent-blue);
  color: var(--hue-blue);
  display: grid;
  place-items: center;
  flex: none;
}
.fmg-sub { margin: 4px 0 0; font-size: var(--fs-label); color: var(--text-muted); }
</style>
