<script setup lang="ts">
// 三大报表期间条(画布 09 ReportIS / ReportBS / ReportTB / ReportStates):
//   「‹ 换期  2025-10 | [公司 ▾] | 利润表 — 资产负债表 — … — 收入核对」
// 步骤条仍是全站那一个 FPStepStrip(九张报表横跳不换期),由屏放进默认插槽;这里只在它前面摆
// 「换期 + 期 + 公司下拉」。FPStepStrip 没有给前缀留插槽、也不归本屏,所以它自己的返回钮用 hide-back 关掉、
// 它自己的期标与灰底条在 .fpb 范围内收掉(S 档它本来就不写期)。
// 编辑中:「‹ 换期」不出、公司名是纯文字 —— 换期 / 换公司都会丢草稿,稿上编辑态那一条就是这样。
import { iconFor } from '@/components/ds/icon'
import FinCompanyMenu from './FinCompanyMenu.vue'

defineProps<{
  /** 期标,如 2025-10 */
  period: string
  edit: boolean
  companies: { id: number | string; name: string }[]
  companyId: number | 'all' | null
  canAddDel: boolean
  canRename: boolean
}>()
const emit = defineEmits<{ back: []; pick: [id: number | 'all']; add: []; rename: []; remove: [] }>()
</script>

<template>
  <div class="fpb">
    <button v-if="!edit" type="button" class="fpb-back" @click="emit('back')">
      <component :is="iconFor('chevron-left')" :size="14" />换期
    </button>
    <span class="fpb-period">{{ period }}</span>
    <i class="fpb-sep" aria-hidden="true" />
    <FinCompanyMenu :companies="companies" :current="companyId" :can-add-del="canAddDel" :can-rename="canRename" :locked="edit"
                    @pick="emit('pick', $event)" @add="emit('add')" @rename="emit('rename')" @remove="emit('remove')" />
    <i class="fpb-sep" aria-hidden="true" />
    <slot />
  </div>
</template>

<style scoped>
.fpb { flex: 0 0 auto; display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; min-height: 32px; }
.fpb-back {
  flex: none; display: inline-flex; align-items: center; gap: 2px;
  padding: 4px 2px; border: none; background: transparent; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-muted);
  transition: color var(--dur-fast);
}
.fpb-back:hover { color: var(--hue-blue); }
.fpb-period { flex: none; font-family: var(--font-mono); font-size: 13px; font-weight: var(--fw-bold); color: var(--text-primary); }
.fpb-sep { flex: none; width: 1px; height: 16px; background: var(--border-subtle); }
/* 步骤条在这里只当「步骤」用:灰底条、内边距、它自己的期标都收掉(期标本条已写,见上);
   当前步改成灰底药丸(稿上白底页面里白药丸看不出来)。只在 .fpb 里生效,别的屏的步骤条不受影响。 */
.fpb :deep(.fss) { flex: 1 1 auto; min-width: 0; padding: 0; background: transparent; }
.fpb :deep(.fss-period) { display: none; }
.fpb :deep(.fss-step.on) { background: var(--surface-sunken); box-shadow: none; font-weight: var(--fw-semibold); }
</style>
