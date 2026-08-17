<script setup lang="ts">
// 计费参数「修改」小弹窗(S21-PARAM-CENTER-SPEC §5.3):值 | 生效方式(仅本月 / 自本月起长期 / 改错原地更正) | 备注 → 保存。
// 值控件按注册表 valueKind:数值类 input / enum→Select(字典) / bool→Segmented(状态句) / ref_meter·ref_building→Select(候选由父页给)。
// 默认生效方式 = 注册表 defaultMode;「改错」仅当当前值来自本作用域的明确版本行(row.rowId)时可选。
// 删除:本月有专属 month 行 → 「删除本月专属值(恢复长期值)」;否则命中行在本作用域 → 「删除此版本」(后端拦已被生成月取用的行)。
// 本组件只组装 ParamPutReq 交父页写库(父页做铁律二 patch),不碰网络。
import { computed, ref, watch } from 'vue'
import type { ParamPutReq, ParamRowDTO } from '@/api/params'
import { paramDef, type ParamMode } from '@/utils/paramRegistry'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

export interface RefOption { value: string; label: string }

const props = defineProps<{
  open: boolean
  row: ParamRowDTO | null
  ym: string
  refOptions?: RefOption[]        // ref_meter / ref_building 的候选(父页按栋/期过滤好)
}>()
const emit = defineEmits<{ close: []; save: [req: ParamPutReq] }>()

const def = computed(() => (props.row ? paramDef(props.row.key) : undefined))
const kind = computed(() => def.value?.valueKind ?? 'number')

// 布尔键状态句(与后端 valueText 同口径:0/1 各一句)
const BOOL_TEXT: Record<string, [string, string]> = {
  loss_recon: ['不参与', '参与'],
  loss_exclude: ['计入', '不计入'],
  loss_denom_cable: ['仅总表', '总表 + 铝缆'],
}
const boolOpts = computed(() => {
  const t = BOOL_TEXT[props.row?.key ?? ''] ?? ['否', '是']
  return [{ value: '0', label: t[0] }, { value: '1', label: t[1] }]
})
const enumOpts = computed(() =>
  Object.entries(def.value?.enumOptions ?? {}).map(([v, l]) => ({ value: v, label: l })))

type Way = 'month' | 'from' | 'correction'
const val = ref('')
const way = ref<Way>('month')
const note = ref('')
watch(() => [props.open, props.row] as const, ([o]) => {
  if (!o || !props.row) return
  val.value = props.row.value == null ? '' : String(props.row.value)
  way.value = def.value?.defaultMode ?? 'from'
  note.value = ''
}, { immediate: true })

const canCorrect = computed(() => props.row?.rowId != null)
// 只能按月生效的键(电价 6 键 / 照抄金额,注册表 monthOnly = 后端 400「只能按月生效」的镜像)不出「自 X 起长期」
const wayOpts = computed(() => [
  { value: 'month', label: `仅 ${props.ym}` },
  ...(def.value?.monthOnly ? [] : [{ value: 'from', label: `自 ${props.ym} 起长期` }]),
  ...(canCorrect.value ? [{ value: 'correction', label: '改错：原地更正当前版本' }] : []),
])
const wayHint = computed(() => way.value === 'month'
  ? '只影响本月;其它月份照旧'
  : way.value === 'from'
    ? '本月及以后账期沿用,直到更晚版本;更早月份不受影响'
    : `不新建版本,直接改写当前生效行（${props.row?.rangeText || '当前版本'}）的值,该版本覆盖的所有月份一起变`)

const numeric = computed(() => !['enum', 'bool', 'ref_meter', 'ref_building', 'ref_rule'].includes(kind.value))
const parsed = computed<number | null>(() => {
  const t = val.value.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
})
const canSave = computed(() => parsed.value != null)

function submit() {
  if (!props.row || parsed.value == null) return
  const r = props.row
  const correction = way.value === 'correction'
  emit('save', {
    key: r.key, scope: r.scope, acctMonth: props.ym,
    mode: correction ? r.mode : (way.value as ParamMode),
    value: parsed.value, note: note.value.trim() || null, correction,
  })
}

// 删除:优先删本月 month 行(恢复长期值);否则删命中的本作用域版本行
const delLabel = computed(() => {
  if (!props.row) return ''
  if (props.row.hasMonthRow) return `删除 ${props.ym} 专属值（恢复长期值）`
  if (props.row.rowId != null) return `删除此版本（${props.row.rangeText}）`
  return ''
})
function remove() {
  const r = props.row
  if (!r) return
  const monthRow = r.hasMonthRow
  const desc = monthRow ? `${props.ym} 的专属值` : `版本「${r.rangeText}」`
  if (!confirm(`确认删除「${r.scopeLabel} · ${r.label}」${desc}？删除后该月回退到上一层级 / 上一版本的值。`)) return
  emit('save', {
    key: r.key, scope: r.scope,
    acctMonth: monthRow ? props.ym : r.acctMonth, mode: monthRow ? 'month' : r.mode,
    value: null, note: note.value.trim() || null, correction: false,
  })
}
</script>

<template>
  <FPDrawer :open="open && !!row" :title="row ? `${row.scopeLabel} · ${row.label}` : ''" :subtitle="row?.formula ?? undefined"
            icon="sliders-horizontal" :width="500" @close="emit('close')">
    <div v-if="row" class="pe-form">
      <label class="pe-field">
        <span class="pe-k">值<span v-if="def?.unit" class="pe-unit">{{ def.unit }}</span></span>
        <!-- 不用 v-model:type=number 的 v-model 会把值强转成 number,val 须恒为字符串(空串=未填) -->
        <input v-if="numeric" :value="val" class="pe-in" type="number" step="any" placeholder="请输入数字"
               @input="val = ($event.target as HTMLInputElement).value" @keydown.enter="submit" />
        <Select v-else-if="kind === 'enum'" :options="enumOpts" :model-value="val" size="sm" placeholder="请选择" @update:model-value="val = $event" />
        <Segmented v-else-if="kind === 'bool'" :options="boolOpts" :model-value="val" size="sm" @update:model-value="val = $event" />
        <Select v-else :options="refOptions ?? []" :model-value="val" size="sm" placeholder="请选择" @update:model-value="val = $event" />
        <span v-if="row.valueText" class="pe-cur">当前：{{ row.valueText }}<template v-if="row.rangeText">（{{ row.rangeText }}）</template></span>
      </label>

      <div class="pe-field">
        <span class="pe-k">生效方式</span>
        <div class="pe-ways">
          <label v-for="o in wayOpts" :key="o.value" class="pe-way" :class="{ on: way === o.value }">
            <input type="radio" name="pe-way" :value="o.value" v-model="way" />{{ o.label }}
          </label>
        </div>
        <span class="pe-hint">{{ wayHint }}</span>
      </div>

      <label class="pe-field">
        <span class="pe-k">备注</span>
        <input v-model="note" class="pe-in txt" type="text" placeholder="来源锚点，如「2023-08 源册 一期园区损耗!D5 +8000」" @keydown.enter="submit" />
      </label>

      <p v-if="row.hint" class="pe-hint">{{ row.hint }}</p>
    </div>
    <template #footer>
      <Button v-if="delLabel" variant="danger" size="sm" style="margin-right:auto" @click="remove">{{ delLabel }}</Button>
      <Button variant="outline" size="sm" @click="emit('close')">取消</Button>
      <Button variant="filled" size="sm" :disabled="!canSave" @click="submit">保存</Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.pe-form { display: flex; flex-direction: column; gap: 16px; }
.pe-field { display: flex; flex-direction: column; gap: 6px; }
.pe-k { font-size: var(--fs-label); color: var(--text-secondary); font-weight: var(--fw-medium); }
.pe-unit { margin-left: 6px; font-size: var(--fs-micro); color: var(--text-disabled); font-weight: var(--fw-regular); }
.pe-in { height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); outline: none; }
.pe-in.txt { font-family: var(--font-sans); }
.pe-in:focus { border-color: var(--hue-blue); }
.pe-in::-webkit-outer-spin-button, .pe-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pe-cur { font-size: var(--fs-micro); color: var(--text-muted); }
.pe-ways { display: flex; flex-direction: column; gap: 4px; }
.pe-way { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: var(--fs-label); color: var(--text-primary); cursor: pointer; }
.pe-way.on { border-color: var(--hue-blue); background: var(--accent-blue, rgb(238, 244, 255)); }
.pe-way input { accent-color: var(--hue-blue); }
.pe-hint { margin: 0; font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.5; }
</style>
