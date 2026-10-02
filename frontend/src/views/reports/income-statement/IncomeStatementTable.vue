<script setup lang="ts">
// IncomeStatementTable — 薄封装 FinReportTable + 利润表两列(本月/本年累计)。
// 行展平、取值、计算(computeRow)归父级 View;本组件只固定列口径并透传 props/emits。
import FinReportTable, { type FinTableRow, type FinTableColumn } from '@/components/fin/FinReportTable.vue'

const props = defineProps<{
  rows: FinTableRow[]
  foot?: FinTableRow[]
  footTip?: string
  valueOf: (rowKey: string | number, field: string) => number
  editable: boolean
  liveOf?: (rowKey: string | number, field: string) => number | string
  changedOf?: (rowKey: string | number, field: string) => boolean
  selectable?: boolean
  selected?: Set<string | number>
}>()

const emit = defineEmits<{
  input: [rowKey: string | number, field: string, value: string]
  addChild: [row: FinTableRow]
  removeChild: [row: FinTableRow]
  toggleSelect: [row: FinTableRow]
}>()

// ponytail: :value-of 走 props.valueOf —— 模板里裸写 valueOf 会被渲染代理当成 Object.prototype.valueOf(见 FinReportTable 的 cellVal 注释)
// 利润表列口径(spec R3):本月金额 cur(关键列:浅蓝底 + 加粗 + 表头下划线,画布 09) + 本年累计金额 ytd。
const IS_COLUMNS: FinTableColumn[] = [
  { key: 'cur', label: '本月金额', strong: true },
  { key: 'ytd', label: '本年累计金额' },
]
</script>

<template>
  <FinReportTable
    :rows="rows"
    :foot="foot"
    :foot-tip="footTip"
    :columns="IS_COLUMNS"
    :value-of="props.valueOf"
    :editable="editable"
    :live-of="liveOf"
    :changed-of="changedOf"
    :selectable="selectable"
    :selected="selected"
    @input="(k, f, v) => emit('input', k, f, v)"
    @add-child="r => emit('addChild', r)"
    @remove-child="r => emit('removeChild', r)"
    @toggle-select="r => emit('toggleSelect', r)"
  />
</template>
