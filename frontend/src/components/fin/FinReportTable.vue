<script setup lang="ts">
// FinReportTable — 报表表基座。1:1 移植 fin-common.jsx .fin-table/.fin-rowlabel/.fin-nv/.fin-ni 样式
// + screen-income-statement.jsx L3 表结构(项目/行次/各金额列)。
// 行由父级预先展平传入(常驻行 + 自定义子类递归后的线性列表);单元格值/编辑态由父级经 valueOf 决定,
// 计算与递归归父级(Task 5)。列数由 columns 决定,利润表传 [{key:'cur'},{key:'ytd'}]。
import { iconFor } from '@/components/ds/icon'
import { finSigned } from '@/utils/finFmt'

// 一条展平后的行。type: normal 叶子(可录入)/label 信息行(无值)/subtotal 小计(公式,只读)。
// parentAuto: 该 normal 父行有自定义子类 → 自动汇总,不可直接录入。
export interface FinTableRow {
  key: string | number   // 行次(常驻)或自定义行 id
  no?: string | number   // 行次列显示(自定义行留空)
  label: string
  level: number          // 0..3 缩进
  type: 'normal' | 'label' | 'subtotal'
  custom?: boolean        // 自定义子类 → 编辑时可删
  strong?: boolean        // subtotal 强调底色(.sub.strong)
  parentAuto?: boolean    // 有子类 → 求和只读
  childCount?: number     // >0 时显示「N 子类」chip
  canAddChild?: boolean   // 编辑时可 +
}
export interface FinTableColumn { key: string; label: string }

const props = defineProps<{
  rows: FinTableRow[]
  columns: FinTableColumn[]
  valueOf: (rowKey: string | number, field: string) => number
  editable: boolean
  // 编辑中的原始输入值(空串或 number),供 <input> 显示;normal 叶子行才用
  liveOf?: (rowKey: string | number, field: string) => number | string
  // 批量删除多选(P2-G3):编辑态行首复选列。仅普通叶子行(固定+自定义)可选;公式/小计/父项/信息行不渲复选框。
  selectable?: boolean
  selected?: Set<string | number>
}>()

const emit = defineEmits<{
  input: [rowKey: string | number, field: string, value: string]
  addChild: [row: FinTableRow]
  removeChild: [row: FinTableRow]
  toggleSelect: [row: FinTableRow]
}>()

// 可勾选 = 普通叶子行(常驻固定 or 自定义);subtotal/label/parentAuto 均不可选
const canSelect = (r: FinTableRow) => r.type === 'normal' && !r.parentAuto

// ponytail: alias — `valueOf` 是 Object.prototype 成员,模板里裸调会被渲染代理拦截解析失败,故本地重命名。
const cellVal = (k: string | number, f: string) => props.valueOf(k, f)

function trClass(r: FinTableRow) {
  if (r.type === 'label') return 'lbl'
  if (r.type === 'subtotal') return 'sub' + (r.strong ? ' strong' : '')
  return ''
}
// normal 父行(有子类)与 subtotal 都是只读计算格
function isCalc(r: FinTableRow) {
  return r.type === 'subtotal' || !!r.parentAuto
}
function inputVal(r: FinTableRow, field: string): string {
  const lv = props.liveOf ? props.liveOf(r.key, field) : cellVal(r.key, field)
  return lv === 0 || lv == null ? '' : String(lv)
}
</script>

<template>
  <div class="fin-wrap">
    <table class="fin-table">
      <colgroup>
        <col v-if="selectable" style="width:34px" />
        <col style="width:auto" />
        <col style="width:48px" />
        <col v-for="c in columns" :key="c.key" style="width:168px" />
      </colgroup>
      <thead>
        <tr>
          <th v-if="selectable"></th>
          <th style="text-align:left;padding-left:12px">项　目</th>
          <th>行次</th>
          <th v-for="c in columns" :key="c.key">{{ c.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key" :class="trClass(r)">
          <td v-if="selectable" class="fin-ckcell">
            <input v-if="canSelect(r)" class="fin-ck" type="checkbox" :checked="selected?.has(r.key)" @change="emit('toggleSelect', r)" />
          </td>
          <td>
            <span class="fin-rowlabel" :class="['lv' + r.level, { label: r.type === 'label', subtotal: r.type === 'subtotal' }]" :title="r.label">
              {{ r.label }}
              <span v-if="r.parentAuto && r.childCount" class="chip">{{ r.childCount }} 子类</span>
              <button v-if="editable && r.custom" class="custom-x" title="删除子类" @click="emit('removeChild', r)"><component :is="iconFor('x')" :size="13" /></button>
              <button v-if="editable && r.canAddChild" class="addchild" title="添加子类" @click="emit('addChild', r)"><component :is="iconFor('plus')" :size="13" /></button>
            </span>
          </td>
          <td><span class="fin-no">{{ r.type === 'label' || r.custom ? '' : r.no ?? r.key }}</span></td>
          <td v-for="c in columns" :key="c.key">
            <template v-if="r.type === 'label'"></template>
            <span v-else-if="isCalc(r)" class="fin-nv calc" :class="{ neg: cellVal(r.key, c.key) < 0 }">{{ finSigned(cellVal(r.key, c.key)) || '–' }}</span>
            <input v-else-if="editable" class="fin-ni" type="number" :value="inputVal(r, c.key)" @input="emit('input', r.key, c.key, ($event.target as HTMLInputElement).value)" />
            <span v-else class="fin-nv" :class="{ empty: !cellVal(r.key, c.key), neg: cellVal(r.key, c.key) < 0 }">{{ cellVal(r.key, c.key) ? finSigned(cellVal(r.key, c.key)) : '–' }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.fin-wrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.fin-table { border-collapse:separate; border-spacing:0; width:100%; font-family:var(--font-sans); }
.fin-table th, .fin-table td { border-bottom:1px solid var(--divider); box-sizing:border-box; padding:0; text-align:left; }
.fin-table thead th { position:sticky; top:0; z-index:3; background:var(--surface-card); color:var(--text-muted); font-size:11.5px; font-weight:var(--fw-semibold); text-align:center; padding:9px 8px; vertical-align:middle; }
.fin-table tbody td { height:33px; background:var(--surface-white); vertical-align:middle; }
.fin-table tbody tr:hover td { background:var(--surface-card); }
.fin-table tbody tr.lbl td { background:var(--surface-sunken); }
.fin-table tbody tr.lbl:hover td { background:var(--surface-sunken); }
.fin-table tbody tr.sub td { background:var(--accent-slate); }
.fin-table tbody tr.sub:hover td { background:var(--accent-slate); }
.fin-table tbody tr.sub.strong td { background:var(--accent-blue); }
.fin-rowlabel { display:flex; align-items:center; gap:6px; padding:0 12px; font-size:12.5px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fin-rowlabel.lv0 { font-weight:var(--fw-semibold); }
.fin-rowlabel.lv1 { padding-left:26px; color:var(--text-secondary); }
.fin-rowlabel.lv2 { padding-left:42px; color:var(--text-muted); font-size:12px; }
.fin-rowlabel.lv3 { padding-left:58px; color:var(--text-muted); font-size:12px; }
.fin-rowlabel.label { color:var(--text-muted); font-size:11.5px; font-weight:var(--fw-medium); }
.fin-rowlabel.subtotal { font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-rowlabel .custom-x { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-disabled); cursor:pointer; display:none; place-items:center; }
.fin-table tbody tr:hover .fin-rowlabel .custom-x { display:grid; }
.fin-rowlabel .custom-x:hover { background:rgb(255,238,237); color:var(--hue-red); }
.fin-rowlabel .addchild { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-disabled); cursor:pointer; display:none; place-items:center; margin-left:auto; }
.fin-table tbody tr:hover .fin-rowlabel .addchild { display:grid; }
.fin-rowlabel .addchild:hover { background:var(--accent-blue); color:var(--hue-blue); }
.fin-rowlabel .chip { flex:0 0 auto; font-size:10px; font-weight:var(--fw-medium); color:var(--hue-blue); background:var(--accent-blue); border-radius:var(--radius-full); padding:1px 7px; }
.fin-no { display:block; text-align:center; font-size:11px; color:var(--text-muted); font-family:var(--font-mono); }
.fin-ckcell { text-align:center; }
.fin-ck { display:block; margin:0 auto; width:14px; height:14px; accent-color:var(--hue-blue); cursor:pointer; }
.fin-nv { display:block; text-align:right; font-size:12px; padding:0 12px; color:var(--text-secondary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.fin-nv.empty { color:var(--text-disabled); }
.fin-nv.calc { font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-nv.neg { color:var(--hue-red); }
.fin-ni { width:100%; box-sizing:border-box; border:1px solid transparent; background:transparent; text-align:right; font-size:12px; padding:3px 8px; outline:none; color:var(--text-primary); font-family:var(--font-mono); border-radius:var(--radius-sm); }
.fin-ni:focus { background:var(--accent-blue); border-color:var(--hue-blue); }
.fin-ni::-webkit-outer-spin-button, .fin-ni::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
</style>
