<script setup lang="ts">
// 损益附表年度矩阵表 — 版式 1:1 参照原型 screen-schedule2.jsx 表体 + SalaryTable sticky 双左列范式。
// 列:分组(sticky,同值向下省略显示) | 科目细分(sticky) | 1月..12月 | 本年合计(sticky 尾,rowYearTotal 客端派生) | 编辑态:备注 + 删行。
// kind 分带(spec D2,仅渲染):subtotal 底 accent-slate、pnl 底 accent-blue 加粗、total 加粗上边框。
// 月值 null=未录(显 –,区分真 0);编辑态单元格 input(空↔null),值由父 draft 合并后下发,本组件无状态。
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedNoteCell from '@/components/sched/SchedNoteCell.vue'
import { rowYearTotal } from '@/reports/pnlSchedules'
import { finSigned } from '@/utils/finFmt'
import type { PnlRowDTO, PnlKind } from '@/types/pnl'

const props = defineProps<{
  year: number
  rows: PnlRowDTO[]
  groupCol: string
  edit: boolean
}>()
const emit = defineEmits<{
  input: [rowKey: string, monthIdx: number, v: number | null]
  note: [rowKey: string, text: string]
  remove: [rowKey: string]
  add: []
}>()

const KIND_CLASS: Record<PnlKind, string> = {
  detail: 'pt-detail', subtotal: 'pt-subtotal', pnl: 'pt-pnl', total: 'pt-total',
}

// 分组同值向下省略显示(合并单元格观感)
const showGroup = (i: number) =>
  i === 0 || props.rows[i].groupLabel !== props.rows[i - 1].groupLabel

// 单元格提交:空 → null(未录);扛千分位;非数字视同清空。
function onCell(rowKey: string, monthIdx: number, e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/[,\s]/g, '')
  if (raw === '') { emit('input', rowKey, monthIdx, null); return }
  const v = Number(raw)
  emit('input', rowKey, monthIdx, Number.isNaN(v) ? null : v)
}
</script>

<template>
  <div class="pt-wrap">
    <!-- 空年引导态 -->
    <div v-if="rows.length === 0" class="pt-empty">
      <div class="pt-empty-ic"><component :is="iconFor('trending-up')" :size="24" /></div>
      <div class="pt-empty-t">{{ year }}年 暂无数据</div>
      <div class="pt-empty-s">进入编辑模式可逐行新增科目细分;后续也可从母册导入本年明细。</div>
      <Button v-if="edit" variant="filled" @click="emit('add')">
        <template #leading><component :is="iconFor('plus')" :size="16" /></template>
        新增行
      </Button>
    </div>

    <table v-else class="pt-table" :class="{ 'pt-editmode': edit }">
      <thead>
        <tr>
          <th class="pt-c-grp l">{{ groupCol }}</th>
          <th class="pt-c-sub l">科目细分</th>
          <th v-for="m in 12" :key="m" class="pt-h-num">{{ m }}月</th>
          <th class="pt-c-ann pt-h-ann">本年合计</th>
          <th v-if="edit" class="pt-c-note l">备注</th>
          <th v-if="edit" class="pt-c-del"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="r.rowKey" :class="KIND_CLASS[r.kind]">
          <td class="pt-c-grp l" :title="r.groupLabel">{{ showGroup(i) ? r.groupLabel : '' }}</td>
          <td class="pt-c-sub l">{{ r.label }}</td>
          <td v-for="(v, mi) in r.m" :key="mi" class="pt-c-num">
            <input
              v-if="edit"
              class="pt-in"
              inputmode="decimal"
              :value="v ?? ''"
              placeholder="–"
              @change="onCell(r.rowKey, mi, $event)"
            />
            <span v-else-if="v === null" class="pt-null">–</span>
            <span v-else :class="{ 'pt-neg': v < 0 }">{{ finSigned(v) }}</span>
          </td>
          <td class="pt-c-num pt-c-ann">
            <span v-if="rowYearTotal(r.m) === null" class="pt-null">–</span>
            <span v-else :class="{ 'pt-neg': rowYearTotal(r.m)! < 0 }">{{ finSigned(rowYearTotal(r.m)) }}</span>
          </td>
          <td v-if="edit" class="pt-c-note l">
            <SchedNoteCell :note="r.note" :edit="true" @save="emit('note', r.rowKey, $event)" />
          </td>
          <td v-if="edit" class="pt-c-del">
            <button class="pt-delbtn" title="删除该行" @click="emit('remove', r.rowKey)">
              <component :is="iconFor('trash-2')" :size="15" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* 版式基准:screen-schedule2.jsx S2Styles(.s2-table 段) + SalaryTable sticky 双左列 */
.pt-wrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.pt-table { border-collapse:separate; border-spacing:0; width:max-content; min-width:100%; font-family:var(--font-sans); font-size:13px; color:var(--text-primary); }
.pt-table th, .pt-table td { height:38px; padding:0 13px; box-sizing:border-box; white-space:nowrap; text-align:right; }
.pt-table .l { text-align:left; }

/* 表头 */
.pt-table thead th { position:sticky; top:0; z-index:3; background:var(--surface-white); border-bottom:1px solid var(--border-subtle); font-size:12px; font-weight:var(--fw-semibold); color:var(--text-muted); }
.pt-h-num { min-width:104px; }
.pt-h-ann { background:var(--surface-card); color:var(--text-secondary); }
.pt-table thead th.pt-c-grp, .pt-table thead th.pt-c-sub,
.pt-table thead th.pt-c-ann, .pt-table thead th.pt-c-note, .pt-table thead th.pt-c-del { z-index:5; }

/* sticky 左双列:分组(定宽,同值省略) + 科目细分 */
.pt-c-grp { position:sticky; left:0; z-index:2; width:118px; min-width:118px; max-width:118px; overflow:hidden; text-overflow:ellipsis; font-weight:var(--fw-medium); }
.pt-c-sub { position:sticky; left:118px; z-index:2; min-width:216px; box-shadow:1px 0 0 var(--border-subtle); }

/* sticky 尾列:本年合计(编辑态让位备注+删行) */
.pt-c-ann { position:sticky; right:0; z-index:2; font-weight:var(--fw-semibold); box-shadow:-1px 0 0 var(--border-subtle); min-width:120px; }
.pt-editmode .pt-c-ann { right:190px; }   /* 编辑态让位 备注(150)+删行(40) */
.pt-c-note { position:sticky; right:40px; z-index:2; width:150px; min-width:150px; max-width:150px; box-shadow:-1px 0 0 var(--border-subtle); }
.pt-c-del { position:sticky; right:0; z-index:2; width:40px; min-width:40px; padding:0 6px; text-align:center; }

/* 数值 */
.pt-c-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12.5px; }
.pt-null { color:var(--text-disabled); }
.pt-neg { color:var(--hue-red); }

/* kind 分带(每行 td 统一铺底色,sticky 单元格随行) */
.pt-detail td { background:var(--surface-white); border-bottom:1px solid var(--divider); color:var(--text-secondary); }
.pt-detail td.pt-c-sub { color:var(--text-primary); }
.pt-detail:hover td { background:var(--surface-card); }
.pt-subtotal td { background:var(--accent-slate); border-bottom:1px solid var(--border-subtle); font-weight:var(--fw-semibold); }
.pt-pnl td { background:var(--accent-blue); border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); font-weight:var(--fw-semibold); }
.pt-total td { background:var(--surface-white); border-top:2px solid var(--border-strong); border-bottom:1px solid var(--border-subtle); font-weight:var(--fw-semibold); color:var(--brand-deep); }
.pt-total td.pt-c-sub, .pt-total td.pt-c-grp { color:var(--text-primary); }

/* 编辑态单元格 */
.pt-in { width:92px; height:28px; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:7px; padding:0 8px; text-align:right; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12px; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.pt-in:focus { border-color:var(--hue-blue); box-shadow:0 0 0 3px var(--accent-blue); }
.pt-in::placeholder { color:var(--text-disabled); }

.pt-delbtn { width:26px; height:26px; border:none; background:transparent; border-radius:6px; color:var(--text-disabled); cursor:pointer; display:inline-grid; place-items:center; }
.pt-delbtn:hover { background:rgba(255,59,48,.1); color:var(--hue-red); }

/* 空态 */
.pt-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:240px; padding:40px; text-align:center; }
.pt-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.pt-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.pt-empty-s { font-size:13px; color:var(--text-muted); max-width:400px; line-height:1.5; }
</style>
