<script setup lang="ts">
// IncomeStatementTable — 薄封装 FinReportTable + 利润表两列(本月/本年累计)。
// 行展平、取值、计算(computeRow)归父级 View;本组件只固定列口径并透传 props/emits。
import FinReportTable, { type FinTableRow, type FinTableColumn } from '@/components/fin/FinReportTable.vue'

defineProps<{
  rows: FinTableRow[]
  valueOf: (rowKey: string | number, field: string) => number
  editable: boolean
  liveOf?: (rowKey: string | number, field: string) => number | string
}>()

const emit = defineEmits<{
  input: [rowKey: string | number, field: string, value: string]
  addChild: [row: FinTableRow]
  removeChild: [row: FinTableRow]
}>()

// 利润表列口径(spec R3):本月金额 cur + 本年累计金额 ytd。
const IS_COLUMNS: FinTableColumn[] = [
  { key: 'cur', label: '本月金额' },
  { key: 'ytd', label: '本年累计金额' },
]
</script>

<template>
  <FinReportTable
    :rows="rows"
    :columns="IS_COLUMNS"
    :value-of="valueOf"
    :editable="editable"
    :live-of="liveOf"
    @input="(k, f, v) => emit('input', k, f, v)"
    @add-child="r => emit('addChild', r)"
    @remove-child="r => emit('removeChild', r)"
  />
</template>
