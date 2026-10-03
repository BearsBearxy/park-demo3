<script setup lang="ts">
// 三大报表标题行(画布 09 ReportIS / ReportStates 逐格):左「表名 + 状态签」,右端按钮集随状态变。
//
//   浏览          导出 Excel · 交审 N 月 · 编辑模式
//   本月未录入    「● 本月未录入」签;导出 Excel · 编辑模式
//   加载失败      只剩一颗同宽禁用的「编辑模式」,悬停「本期没读到，不能编辑」
//   编辑中        「编辑中 · N 处改动」签;导入 · [屏自己的,如「新增科目」] · ··· (导出降级进去) · 取消 · 保存
//   全部汇总      「N 家合计 · 只读」签;只剩导出 Excel
//   已审核        导出 Excel · 灰药丸「已审核 · …」(FPEditModeButton 自己换)
//   不平 / 不等   红签(bad),与上面任一态并存
//
// 四张 KPI 卡撤掉(D6);副标题「公司 · 年月」撤掉 —— 期间条上已经写着期与公司。
// 手机档原来那条「编辑模式 · 小屏可录入,建议在桌面端操作」横条并进编辑签:S 档签上挂这句悬停说明。
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import FPMoreMenu from '@/components/fp/FPMoreMenu.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import type { LockHolder } from '@/api/locks'
import { useViewport } from '@/composables/useViewport'

defineProps<{
  title: string
  edit: boolean
  dirty: number
  saving: boolean
  isAll: boolean
  companyCount: number
  loadErr: boolean
  entered: boolean
  canEdit: boolean
  heldByOther?: LockHolder | null
  reviewNote?: string | null
  reviewTip?: string | null
  reviewKey: string | null
  reviewLabel: string
  monthText: string
  /** 红签(资产 ≠ 负债 + 权益 · 差 x / 期末借贷不平 · 差 x);null = 平 */
  bad?: string | null
}>()
const emit = defineEmits<{ export: []; import: []; cancel: []; save: []; enter: [] }>()

const { tier } = useViewport()
const MORE = [{ key: 'export', label: '导出 Excel', icon: 'download' }]
</script>

<template>
  <div class="fh">
    <div class="fh-l">
      <h2 class="fh-title">{{ title }}</h2>
      <FPStateTag v-if="edit" tone="edit" v-tip="tier === 's' ? '小屏可录入,建议在桌面端操作' : null">编辑中 · {{ dirty }} 处改动</FPStateTag>
      <FPStateTag v-else-if="isAll" tone="muted">{{ companyCount }} 家合计 · 只读</FPStateTag>
      <FPStateTag v-else-if="!loadErr && !entered" tone="warn" class="fh-todo">本月未录入</FPStateTag>
      <FPStateTag v-if="bad && !loadErr" tone="warn" class="fh-bad">{{ bad }}</FPStateTag>
    </div>
    <div class="fh-r">
      <template v-if="edit">
        <Button variant="outline" size="sm" :disabled="saving" @click="emit('import')">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入
        </Button>
        <slot name="edit" />
        <FPMoreMenu :items="MORE" @select="emit('export')" />
      </template>
      <Button v-else-if="!loadErr" variant="outline" size="sm" @click="emit('export')">
        <template #leading><component :is="iconFor('download')" :size="14" /></template>
        导出 Excel
      </Button>
      <!-- 交审:一张表 × 一家公司 × 一个月 = 一把键;「全部汇总」拼不出键整簇不画;没录 / 没读到不交。
           编辑态动作按钮一颗不画,只留「已退回」那颗 chip(判据在组件里,这里只把编辑态告诉它) -->
      <FPReviewActions v-if="edit || (!loadErr && entered)" :edit="edit" :keys="reviewKey ? [reviewKey] : null"
                       :label="reviewLabel" :month-text="monthText" :can-edit="canEdit" />
      <template v-if="edit">
        <Button variant="gray" size="sm" :disabled="saving" @click="emit('cancel')">取消</Button>
        <!-- 编辑中重读本期失败(子类增删后那一读):草稿留着,读到之前不让存 —— 载荷要拿本期的值打底 -->
        <span class="fh-eb" v-tip="loadErr ? '本期没读到，重试读到之后才能保存' : null">
          <Button variant="filled" size="sm" :disabled="saving || loadErr" @click="emit('save')">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            保存
          </Button>
        </span>
      </template>
      <!-- 悬停说明挂外层 span:FPEditModeButton 的根随状态在 span / Button / 空之间换,指令挂不稳(照 PvMeterView .pm-ebtn) -->
      <span v-else-if="!isAll" class="fh-eb" v-tip="loadErr ? '本期没读到，不能编辑' : null">
        <FPEditModeButton :edit="false" :held-by-other="heldByOther" :can-enter="canEdit" :disabled="loadErr"
                          :review-note="reviewNote" :review-tip="reviewTip" @toggle="emit('enter')" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.fh { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.fh-l { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
.fh-title { margin: 0; font: var(--type-h2); font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.fh-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fh-eb { display: inline-flex; }
/* 本月未录入:橙点;红签:资产≠负债+权益 / 借贷不平(FPStateTag 没有红档,在这里换色,点跟字走 currentColor) */
.fp-state.fh-todo { background: var(--warn-soft); color: var(--orange-text); }
.fp-state.fh-bad { background: var(--danger-soft); color: var(--delta-down-text); }
</style>
