<script setup lang="ts">
// TbTable — 科目余额表专用宽表(spec §4:FinReportTable 不适配展开箭头/8 列,自带 scoped 样式,
// 视觉 1:1 遵 FinReportTable.vue 的 .fin-table 系列基底)。
// 结构:sticky 两行表头(期初/本期/本年/期末 × 借/贷) + 科目代码列 + 名称列(缩进+展开箭头) + 8 金额列
//      + tfoot 合计尾行(tbTotals,客端算不落库)。行序 = 父级 visibleRows 输出,原样渲染。
import { iconFor } from '@/components/ds/icon'
import { finSigned } from '@/utils/finFmt'
import { TB_FIELDS, type TbAccount, type TbFieldKey } from '@/reports/trialBalance'

const props = defineProps<{
  rows: TbAccount[]                          // visibleRows 输出(已按 sortOrder 排序)
  expanded: Set<string>                      // 已展开父节点(箭头方向)
  parents: Set<string>                       // 有子级的 rowKey(才显展开箭头)
  totals: Record<TbFieldKey, number>         // 合计尾行(tbTotals)
  valueOf: (rowKey: string, field: TbFieldKey) => number
  editable: boolean
  // 编辑中的原始输入值(空串或 number),供 <input> 显示
  liveOf?: (rowKey: string, field: TbFieldKey) => number | string
}>()

const emit = defineEmits<{
  toggle: [rowKey: string]
  input: [rowKey: string, field: TbFieldKey, value: string]
  remove: [rowKey: string]                   // 编辑态删科目(父级级联收集子树)
}>()

// 分组表头(期初余额/本期发生额/本年累计发生额/期末余额,各 colspan=2)
const GROUPS = [...new Set(TB_FIELDS.map(f => f.group))]

// ponytail: alias — valueOf 是 Object.prototype 成员,模板裸调会被渲染代理拦截,本地重命名(同 FinReportTable)
const cellVal = (k: string, f: TbFieldKey) => props.valueOf(k, f)
function inputVal(r: TbAccount, field: TbFieldKey): string {
  const lv = props.liveOf ? props.liveOf(r.rowKey, field) : cellVal(r.rowKey, field)
  return lv === 0 || lv == null ? '' : String(lv)
}
</script>

<template>
  <div class="fin-wrap">
    <table class="fin-table tb-table">
      <colgroup>
        <col style="width:96px" />
        <col style="width:auto" />
        <col v-for="f in TB_FIELDS" :key="f.key" style="width:128px" />
      </colgroup>
      <thead>
        <tr>
          <th class="h1" rowspan="2" style="text-align:left;padding-left:12px">科目代码</th>
          <th class="h1" rowspan="2" style="text-align:left;padding-left:12px">科目名称</th>
          <th class="h1" v-for="g in GROUPS" :key="g" colspan="2">{{ g }}</th>
        </tr>
        <tr>
          <th class="h2" v-for="f in TB_FIELDS" :key="f.key">{{ f.side }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.rowKey">
          <td><span class="tb-code">{{ r.code ?? '' }}</span></td>
          <td>
            <span class="tb-label" :class="{ lv0: r.level === 0 }" :style="{ paddingLeft: 12 + r.level * 14 + 'px' }">
              <button
                v-if="parents.has(r.rowKey)"
                class="tb-caret"
                :class="{ open: expanded.has(r.rowKey) }"
                :title="expanded.has(r.rowKey) ? '收起下级' : '展开下级'"
                @click="emit('toggle', r.rowKey)"
              ><component :is="iconFor('chevron-right')" :size="14" /></button>
              <span v-else class="tb-caret-ph" />
              <span class="tb-name">{{ r.label }}</span>
              <button v-if="editable" class="tb-x" title="删除科目(含下级)" @click="emit('remove', r.rowKey)"><component :is="iconFor('x')" :size="13" /></button>
            </span>
          </td>
          <td v-for="f in TB_FIELDS" :key="f.key">
            <input v-if="editable" class="fin-ni" type="number" :value="inputVal(r, f.key)" @input="emit('input', r.rowKey, f.key, ($event.target as HTMLInputElement).value)" />
            <span v-else class="fin-nv" :class="{ empty: !cellVal(r.rowKey, f.key), neg: cellVal(r.rowKey, f.key) < 0 }">{{ cellVal(r.rowKey, f.key) ? finSigned(cellVal(r.rowKey, f.key)) : '–' }}</span>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td></td>
          <td><span class="tb-label lv0" style="padding-left:12px">合　计</span></td>
          <td v-for="f in TB_FIELDS" :key="f.key">
            <span class="fin-nv calc" :class="{ neg: totals[f.key] < 0 }">{{ finSigned(totals[f.key]) || '–' }}</span>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* 基底 1:1 参考 components/fin/FinReportTable.vue 的 .fin-wrap/.fin-table/.fin-nv/.fin-ni 系列 */
.fin-wrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.fin-table { border-collapse:separate; border-spacing:0; width:100%; min-width:1240px; font-family:var(--font-sans); }
.fin-table th, .fin-table td { border-bottom:1px solid var(--divider); box-sizing:border-box; padding:0; text-align:left; }
.fin-table thead th { position:sticky; z-index:3; background:var(--surface-card); color:var(--text-muted); font-size:11.5px; font-weight:var(--fw-semibold); text-align:center; padding:0 8px; vertical-align:middle; }
/* sticky 两行表头:h1 顶行 30px,h2 借/贷行紧贴其下 */
.fin-table thead th.h1 { top:0; height:30px; }
.fin-table thead th.h2 { top:30px; height:26px; border-top:1px solid var(--divider); }
.fin-table tbody td { height:33px; background:var(--surface-white); vertical-align:middle; }
.fin-table tbody tr:hover td { background:var(--surface-card); }
/* 合计尾行 sticky 吸底,底色同 subtotal(.sub) */
.fin-table tfoot td { position:sticky; bottom:0; z-index:2; height:36px; background:var(--accent-slate); border-top:1px solid var(--border-subtle); border-bottom:none; vertical-align:middle; }
.tb-code { display:block; padding:0 12px; font-size:11.5px; color:var(--text-muted); font-family:var(--font-mono); white-space:nowrap; }
.tb-label { display:flex; align-items:center; gap:4px; font-size:12.5px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tb-label.lv0 { font-weight:var(--fw-semibold); color:var(--text-primary); }
.tb-name { overflow:hidden; text-overflow:ellipsis; }
.tb-caret { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-muted); cursor:pointer; display:grid; place-items:center; transition:transform var(--dur-fast) var(--ease-standard); }
.tb-caret:hover { background:var(--bg-hover); color:var(--text-primary); }
.tb-caret.open { transform:rotate(90deg); }
.tb-caret-ph { width:20px; flex:0 0 auto; }
.tb-x { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-disabled); cursor:pointer; display:none; place-items:center; margin-left:auto; }
.fin-table tbody tr:hover .tb-x { display:grid; }
.tb-x:hover { background:rgb(255,238,237); color:var(--hue-red); }
.fin-nv { display:block; text-align:right; font-size:12px; padding:0 12px; color:var(--text-secondary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.fin-nv.empty { color:var(--text-disabled); }
.fin-nv.calc { font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-nv.neg { color:var(--hue-red); }
.fin-ni { width:100%; box-sizing:border-box; border:1px solid transparent; background:transparent; text-align:right; font-size:12px; padding:3px 8px; outline:none; color:var(--text-primary); font-family:var(--font-mono); border-radius:var(--radius-sm); }
.fin-ni:focus { background:var(--accent-blue); border-color:var(--hue-blue); }
.fin-ni::-webkit-outer-spin-button, .fin-ni::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
</style>
