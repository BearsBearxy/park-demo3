<script lang="ts">
// 未匹配列处置面板(BOOK-WORKBENCH-SPEC §4)—— 29 万「宿舍区租金」丢列事故的根治:
// 导入遇到模板认不出的表头,必须逐列拍板去向,禁止静默丢。纯受控组件,不发请求;
// 决策落库(存别名/升版建列/记 notices)由调用方在 apply 后执行。
export interface UnmatchedHeader { header: string; sample?: string }
export interface ColDecision {
  header: string
  action: 'map' | 'create' | 'ignore'
  targetColId?: string   // action=map:挂到的既有列 id
  newLabel?: string      // action=create:新自定义列显示名
}
</script>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'

const props = defineProps<{
  open: boolean
  unmatched: UnmatchedHeader[]
  existingCols: { id: string; label: string }[]
}>()

const emit = defineEmits<{
  (e: 'apply', decisions: ColDecision[]): void
  (e: 'close'): void
}>()

interface RowState { action: ColDecision['action']; targetColId: string; newLabel: string }
const rows = ref<RowState[]>([])

// 每次打开按当前未匹配列重置(新建列显示名预填原表头)
watch(() => [props.open, props.unmatched] as const, () => {
  if (!props.open) return
  rows.value = props.unmatched.map(u => ({ action: 'map', targetColId: '', newLabel: u.header }))
}, { immediate: true })

const colOptions = computed(() => props.existingCols.map(c => ({ value: c.id, label: c.label })))

const ACTIONS = [
  { value: 'map', label: '映射到现有列' },
  { value: 'create', label: '新建自定义列' },
  { value: 'ignore', label: '本次忽略' },
]

function setAction(i: number, v: string) {
  rows.value[i].action = v as ColDecision['action']
}

function resolved(r: RowState): boolean {
  if (r.action === 'ignore') return true
  if (r.action === 'map') return !!r.targetColId
  return !!r.newLabel.trim()
}
const allResolved = computed(() => rows.value.length > 0 && rows.value.every(resolved))

function apply() {
  if (!allResolved.value) return
  emit('apply', rows.value.map((r, i) => {
    const header = props.unmatched[i].header
    if (r.action === 'map') return { header, action: 'map' as const, targetColId: r.targetColId }
    if (r.action === 'create') return { header, action: 'create' as const, newLabel: r.newLabel.trim() }
    return { header, action: 'ignore' as const }
  }))
}
</script>

<template>
  <FPDrawer :open="open" tier="confirm" title="导入列映射确认" subtitle="以下表头在当前模板里没有匹配,请逐列指定去向"
            icon="table-2" :width="640" @close="emit('close')">
    <div class="cmp-body">
      <div v-for="(u, i) in unmatched" :key="u.header + i" class="cmp-row">
        <div class="cmp-head">
          <span class="cmp-name">{{ u.header }}</span>
          <span class="cmp-sample">
            <template v-if="u.sample">示例:{{ u.sample }}</template>
          </span>
        </div>
        <div v-if="rows[i]" class="cmp-ctl">
          <Segmented :model-value="rows[i].action" :options="ACTIONS" size="sm"
                     @update:model-value="setAction(i, $event)" />
          <!-- 处置区定宽定高:切换三选一不得让行内其他内容移位(LAYOUT-STABILITY) -->
          <div class="cmp-slot">
            <Select v-if="rows[i].action === 'map'" v-model="rows[i].targetColId"
                    :options="colOptions" size="sm" placeholder="选择目标列" />
            <Input v-else-if="rows[i].action === 'create'" v-model="rows[i].newLabel"
                   size="sm" placeholder="新列显示名" />
            <span v-else class="cmp-ignored">该列数据不导入,将记入导入结果</span>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <Button variant="outline" size="sm" @click="emit('close')">取消</Button>
      <Button variant="filled" size="sm" :disabled="!allResolved" @click="apply">应用并继续导入</Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.cmp-body { display: flex; flex-direction: column; gap: 12px; }
.cmp-row {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--surface-subtle);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cmp-head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.cmp-name {
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 示例位常驻:无 sample 也占一行高,行卡高度不随数据有无变化 */
.cmp-sample {
  flex: 1;
  min-height: 18px;
  font-size: var(--fs-label);
  line-height: 18px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmp-ctl { display: flex; align-items: center; gap: 12px; }
/* 三态共用同一格:Select(sm 32px)/Input(sm 32px)/忽略占位 同高,切换零位移 */
.cmp-slot { flex: 1; min-width: 0; height: 32px; display: flex; align-items: center; }
.cmp-slot > * { width: 100%; }
.cmp-ignored {
  font-size: var(--fs-label);
  color: var(--text-muted);
  line-height: 32px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
