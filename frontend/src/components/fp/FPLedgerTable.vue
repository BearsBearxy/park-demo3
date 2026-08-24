<script setup lang="ts">
// Ported 1:1 from screen-ledger.jsx (table structure 620-664, sticky offsets 413-416/525-530,
// body cell 532-558, footer 646-661). Pure presentation; all CSS in this file's scoped block.
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import type { ColumnModel, LeafColumn, ColumnKey } from '@/utils/ledgerColumns'
import type { LedgerRowDTO } from '@/types/ledger'
import { ledgerRowKey } from '@/types/ledger'

const props = defineProps<{
  columns: ColumnModel
  rows: LedgerRowDTO[]
  edit: boolean
  selected?: Set<number>   // 传入即启用编辑态选择列(勾选 ledgerRowKey,批量删除用)
}>()

// V105:行身份从 tenantId 换 ledgerRowKey(id ?? -tenantId)——未绑定行 tenantId 为 null,
// 选择/编辑/点名全部走 rowKey;tenant-click 直接给整行(父层按绑定态分流:明细抽屉 vs 问题面板)
const emit = defineEmits<{
  'cell-edit': [payload: { rowKey: number; key: ColumnKey; value: string }]
  'tenant-click': [row: LedgerRowDTO]
  'toggle-select': [rowKey: number]
  'toggle-select-all': []
}>()

const selectable = computed(() => props.edit && !!props.selected)
const allChecked = computed(() =>
  props.rows.length > 0 && props.rows.every(r => props.selected?.has(ledgerRowKey(r))))

const ChevronRight = iconFor('chevron-right')

const leaves = computed(() => props.columns.groups.flatMap(g => g.cols))
const allCols = computed(() => [...props.columns.fixedLeft, ...leaves.value, ...props.columns.fixedRight])

// sticky offsets (jsx 413-416): left accumulates L→R, right accumulates R→L over fixedRight reversed.
// 选择列启用时占最左 32px,fixedLeft 整体右移。
const SEL_W = 32
// spec §W4 数字列宽度策略:中部费用列(无 kind,非固定)去锁死,minWidth 保底随内容撑
// (.lg-table 已 width:max-content + .lg-wrap overflow:auto,表内横滚现成);
// 固定数字列(kind num/sum/bal)的 sticky offset 由列宽累加(leftOff/rightOff),随内容变宽会破 sticky,
// 降级为放宽 104→128 仍锁死(保留 ellipsis + title 兜底);offset 与 widthStyle 同用 effW 保持同步。
const FIXED_NUM_W = 128
function effW(c: LeafColumn): number {
  return c.kind === 'num' || c.kind === 'sum' || c.kind === 'bal' ? Math.max(c.w, FIXED_NUM_W) : c.w
}
const leftOff = computed<Record<string, number>>(() => {
  const m: Record<string, number> = {}; let lo = selectable.value ? SEL_W : 0
  props.columns.fixedLeft.forEach(c => { m[c.key] = lo; lo += effW(c) })
  return m
})
const rightOff = computed<Record<string, number>>(() => {
  const m: Record<string, number> = {}; let ro = 0
  ;[...props.columns.fixedRight].reverse().forEach(c => { m[c.key] = ro; ro += effW(c) })
  return m
})
const isFixed = (c: LeafColumn) => c.key in leftOff.value || c.key in rightOff.value

// jsx 525-530: sticky left/right + edge boxShadow on inner-most fixed col.
function fixStyle(c: LeafColumn): Record<string, string> {
  const fl = props.columns.fixedLeft
  const fr = props.columns.fixedRight
  if (c.key in leftOff.value) {
    return {
      position: 'sticky',
      left: leftOff.value[c.key] + 'px',
      ...(c.key === fl[fl.length - 1].key ? { boxShadow: '1px 0 0 var(--border-subtle)' } : {}),
    }
  }
  if (c.key in rightOff.value) {
    return {
      position: 'sticky',
      right: rightOff.value[c.key] + 'px',
      ...(c.key === fr[0].key ? { boxShadow: '-1px 0 0 var(--border-subtle)' } : {}),
    }
  }
  return {}
}

function widthStyle(c: LeafColumn): Record<string, string> {
  const w = effW(c) + 'px'
  if (!c.kind) return { minWidth: w }   // 费用数字列:仅保底,列随内容撑
  return { width: w, minWidth: w, maxWidth: w }
}
function cellStyle(c: LeafColumn): Record<string, string> {
  return { ...widthStyle(c), ...fixStyle(c) }
}
// spec LIST-PAGE §8:列宽/sticky offset 只随列模型与 selectable(→leftOff)变,与行无关。
// 逐格调 cellStyle() 每次都返回新对象,27 列×130 行 = patcher 认为样式全变→全表重刷;
// 改按列算一次、引用稳定后 diff 直接跳过。编辑态切换会让整张表重算一次,那是必须的。
const cellStyles = computed<Record<string, Record<string, string>>>(() =>
  Object.fromEntries(allCols.value.map(c => [c.key, cellStyle(c)])))
const fixedKeys = computed(() => new Set(allCols.value.filter(isFixed).map(c => c.key)))
// 选择列格样式(编辑态每行一个)同理提成常量,避免逐行新建对象
const SEL_TD_STYLE = { position: 'sticky', left: '0px' } as const

// number format (jsx lgFmt): 0/empty → "", else 2dp grouped.
function lgFmt(v: number | null | undefined): string {
  if (v == null || v === 0) return ''
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const view = computed(() => props.rows)
// tfoot 合计:原来每列一次 reduce = 列数×行数 次遍历(27×130 ≈ 3.5k),编辑态每敲一键重来一遍。
// 改成扫一遍全表产出全部列;每列的累加顺序仍是行序,浮点结果与逐列 reduce 全等。
const sums = computed<Record<string, number>>(() => {
  const cs = allCols.value
  const m: Record<string, number> = {}
  cs.forEach(c => { m[c.key] = 0 })
  view.value.forEach(r => cs.forEach(c => { m[c.key] += Number((r as any)[c.key]) || 0 }))
  return m
})
const sumEnd = computed(() => sums.value.balanceEnd)

function onInput(rowKey: number, key: ColumnKey, e: Event) {
  emit('cell-edit', { rowKey, key, value: (e.target as HTMLInputElement).value })
}
</script>

<template>
  <div class="lg-wrap">
    <table class="lg-table">
      <thead>
        <tr>
          <th v-if="selectable" rowspan="2" class="lg-grp-th lg-fix-th lg-fix lg-selc" :style="{ left: '0px' }">
            <input type="checkbox" class="lg-cb" :checked="allChecked" title="全选/清空" @change="emit('toggle-select-all')" />
          </th>
          <th v-for="c in columns.fixedLeft" :key="c.key" rowspan="2"
              class="lg-grp-th lg-fix-th lg-fix" :style="cellStyles[c.key]">{{ c.label }}</th>
          <th v-for="g in columns.groups" :key="g.name" :colspan="g.cols.length"
              class="lg-grp-th">{{ g.name }}</th>
          <th v-for="c in columns.fixedRight" :key="c.key" rowspan="2"
              class="lg-grp-th lg-fix-th lg-fix" :style="cellStyles[c.key]">{{ c.label }}</th>
        </tr>
        <tr>
          <th v-for="c in leaves" :key="c.key" class="lg-leaf-th" :style="cellStyles[c.key]">{{ c.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in view" :key="ledgerRowKey(row)">
          <td v-if="selectable" class="lg-fix lg-selc" :style="SEL_TD_STYLE">
            <input type="checkbox" class="lg-cb" :checked="selected!.has(ledgerRowKey(row))"
                   @change="emit('toggle-select', ledgerRowKey(row))" />
          </td>
          <td v-for="c in allCols" :key="c.key"
              :class="fixedKeys.has(c.key) ? 'lg-fix' : undefined" :style="cellStyles[c.key]">
            <!-- 租户名 (text):两态统一为可点击文本,点开行明细抽屉(账面名/绑定都在抽屉里改——
                 与园区抄表同一动线:表格不做行内改名,用户 2026-08-23 拍板)。
                 名字独立 span:深链 flashFocusRow 按 .lg-tname-txt 精确匹配,徽章文本不得混进名字 -->
            <span v-if="c.kind === 'text'" class="lg-tname" :title="row.tenantName + ' · 点击查看明细/绑定'"
                  @click="emit('tenant-click', row)">
              <span class="lg-tname-txt">{{ row.tenantName }}</span>
              <span v-if="row.tenantId == null" class="lg-unbound">未绑定</span>
              <component :is="ChevronRight" :size="13" class="ch" />
            </span>
            <!-- 应收合计 (sum, 派生只读) -->
            <span v-else-if="c.kind === 'sum'" class="lg-sumc" :title="lgFmt(row.totalReceivable)">{{ lgFmt(row.totalReceivable) }}</span>
            <!-- 本月结余 (bal, 派生只读, 正橙负红) -->
            <span v-else-if="c.kind === 'bal'"
                  class="lg-sumc" :class="{ neg: row.balanceEnd < 0, pos: row.balanceEnd > 0 }" :title="lgFmt(row.balanceEnd)">{{ lgFmt(row.balanceEnd) }}</span>
            <!-- 备注 (note) -->
            <template v-else-if="c.kind === 'note'">
              <input v-if="edit" class="lg-ni l" type="text" :value="row.note ?? ''" placeholder="—"
                     @input="onInput(ledgerRowKey(row), 'note', $event)" />
              <span v-else class="lg-note" :title="row.note ?? ''">{{ row.note || '' }}</span>
            </template>
            <!-- balancePrev (num, 只读) -->
            <span v-else-if="c.key === 'balancePrev'" class="lg-nv" :class="{ empty: !row.balancePrev }" :title="lgFmt(row.balancePrev)">{{ row.balancePrev ? lgFmt(row.balancePrev) : '–' }}</span>
            <!-- totalCollected + 21 费用列 (number, 编辑态可输入) -->
            <template v-else>
              <input v-if="edit" class="lg-ni" type="number"
                     :value="(row as any)[c.key] === 0 ? '' : (row as any)[c.key]"
                     @input="onInput(ledgerRowKey(row), c.key, $event)" />
              <span v-else class="lg-nv" :class="{ empty: !(row as any)[c.key] }" :title="lgFmt((row as any)[c.key])">{{ (row as any)[c.key] ? lgFmt((row as any)[c.key]) : '–' }}</span>
            </template>
          </td>
        </tr>
        <tr class="lg-filler" aria-hidden="true"><td :colspan="allCols.length + (selectable ? 1 : 0)"></td></tr>
      </tbody>
      <tfoot>
        <tr>
          <th v-if="selectable" class="lg-fix lg-selc" :style="{ position: 'sticky', left: '0px' }"></th>
          <th v-for="(c, i) in columns.fixedLeft" :key="c.key" class="lg-fix" :style="cellStyles[c.key]">
            <span v-if="i === 0" class="lg-foot-lbl">合　计</span>
            <span v-else class="lg-foot-v">{{ lgFmt(sums[c.key]) }}</span>
          </th>
          <th v-for="c in leaves" :key="c.key" :style="cellStyles[c.key]">
            <span class="lg-foot-v">{{ lgFmt(sums[c.key]) }}</span>
          </th>
          <th v-for="c in columns.fixedRight" :key="c.key" class="lg-fix" :style="cellStyles[c.key]">
            <span v-if="c.kind === 'note'"></span>
            <span v-else class="lg-foot-v"
                  :style="c.key === 'totalReceivable' ? { color: 'var(--brand-deep)' }
                        : c.key === 'balanceEnd' ? { color: sumEnd < 0 ? 'var(--hue-red)' : 'var(--hue-orange)' }
                        : undefined">{{ lgFmt(sums[c.key]) }}</span>
          </th>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* ── 宽表(两级分组表头 + 左右固定列 + 合计页脚)── 1:1 from screen-ledger.jsx LgStyles 180-215 */
.lg-wrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.lg-table { border-collapse:separate; border-spacing:0; width:max-content; min-width:100%; height:100%; font-family:var(--font-sans); }
.lg-table tbody tr.lg-filler td { height:0; padding:0; line-height:0; font-size:0; border:none; background:var(--surface-white); }
.lg-filler { height:100%; }
.lg-table th, .lg-table td { border-bottom:1px solid var(--divider); box-sizing:border-box; padding:0; }
.lg-table thead th { position:sticky; background:var(--surface-card); color:var(--text-muted); font-size:11.5px; font-weight:var(--fw-semibold); text-align:center; padding:0 8px; z-index:4; }
.lg-grp-th { top:0; height:34px; }
.lg-leaf-th { top:34px; height:38px; line-height:1.25; white-space:normal; }
.lg-fix-th { top:0; z-index:6; vertical-align:middle; }
/* 固定表头单元格须盖过横向滚动的分组/子列表头(否则 .lg-fix 的低 z-index 会让其被遮住) */
.lg-table thead th.lg-fix-th { z-index:8; }
.lg-table tbody td { height:34px; background:var(--surface-white); vertical-align:middle; }
.lg-table tbody tr:hover td { background:var(--surface-card); }
.lg-fix { position:sticky; z-index:3; background:var(--surface-white); }
.lg-table tbody tr:hover .lg-fix { background:var(--surface-card); }
.lg-tname { display:inline-flex; align-items:center; gap:5px; padding:0 10px; font-size:12.5px; font-weight:var(--fw-semibold); color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; max-width:100%; }
/* 编辑态批量删除选择列(sticky 最左 32px) */
.lg-selc { width:32px; min-width:32px; max-width:32px; text-align:center; padding:0 !important; }
.lg-cb { width:14px; height:14px; accent-color:var(--hue-blue); cursor:pointer; vertical-align:middle; }
.lg-tname:hover { color:var(--hue-blue); }
/* 未绑定标签:琥珀小胶囊(语义=警示,非禁用) */
.lg-unbound {
  flex:0 0 auto; font-size:11px; font-weight:var(--fw-medium); line-height:1;
  padding:2px 6px; border-radius:var(--radius-full);
  color:var(--status-warning); background:transparent;
  border:1px solid var(--status-warning);
}
.lg-tname-txt { overflow:hidden; text-overflow:ellipsis; }
.lg-tname .ch { opacity:0; flex:0 0 auto; color:var(--text-disabled); transition:opacity var(--dur-fast); }
.lg-table tbody tr:hover .lg-tname .ch { opacity:1; }
/* .lg-nv/.lg-sumc 保留 ellipsis(spec §W4 降级取舍):费用列已随内容撑宽,永不触发;
   四根锁死的固定数字列(sticky offset 依赖列宽)靠它防溢出串格,title 兜底完整值 */
.lg-nv { display:block; text-align:right; font-size:12px; padding:0 8px; color:var(--text-secondary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lg-nv.empty { color:var(--text-disabled); }
.lg-note { display:block; text-align:left; font-size:12px; padding:0 10px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lg-sumc { display:block; text-align:right; font-weight:var(--fw-semibold); color:var(--hue-blue); font-size:12px; padding:0 8px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lg-sumc.neg { color:var(--hue-red); }
.lg-sumc.pos { color:var(--hue-orange); }
.lg-ni { width:100%; box-sizing:border-box; border:1px solid transparent; background:transparent; text-align:right; font-size:12px; padding:3px 6px; outline:none; color:var(--text-primary); font-family:var(--font-mono); border-radius:var(--radius-sm); }
.lg-ni.l { text-align:left; }
.lg-ni:focus { background:var(--accent-blue); border-color:var(--hue-blue); }
.lg-ni::-webkit-outer-spin-button, .lg-ni::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }

/* 合计页脚(纯色,无渐变) */
.lg-table tfoot th { position:sticky; bottom:0; z-index:5; height:40px; font-weight:var(--fw-semibold); background:var(--surface-white); border-top:2px solid var(--border-strong); font-family:var(--font-mono); color:var(--text-primary); }
.lg-table tfoot th.lg-fix { z-index:7; }
.lg-foot-lbl { display:block; padding:0 10px; text-align:left; font-family:var(--font-sans); font-size:12.5px; color:var(--text-primary); }
.lg-foot-v { display:block; text-align:right; padding:0 8px; font-size:12px; font-variant-numeric:tabular-nums; color:var(--brand-deep); }
</style>
