<script setup lang="ts">
// TbTable — 科目余额表专用宽表(画布 09 ReportTB / ReportTB-1366 / ReportTB-dark / ReportStates)。
// 结构:两层表头(科目代码、科目名称 / 期初余额·本期发生额·本年累计发生额·期末余额 各分借贷)
//      + 名称列(按实际深度缩进 + 折叠箭头 + 「N 个下级」)+ 8 金额列 + 合计贴底(tbTotals,客端算不落库)。
// 期末余额那一对是关键列:浅蓝底、表头下划线;两格里**有数的那一格**加粗(「–」那一侧不加粗,期初/本期/本年都不加粗)。
// 固定列(LIST-PAGE §9.1,useWideTable 按表格可见宽度算):代码 + 名称(rank 0,永不退)→ 期末借方 → 期末贷方;
// 超 40% 从期末贷方先退(原地变普通列,滚到最右才露出来)。期末那一对一拆开,两层表头就并成一层,
// 每列写全名(期初借方 … 期末借方)—— 分组表头横跨一根粘住、一根滚走的两列是画不出来的(画布 ReportTB-1366)。
// 名称封顶 1/5 可见宽,超了省略号 + 悬停看全称;数字不截断。行序 = 父级 visibleRows 输出,原样渲染。
import { rowToggle } from '@/utils/rowToggle'
import { computed, ref, watch, onBeforeUnmount, type CSSProperties } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { finSigned } from '@/utils/finFmt'
import { TB_FIELDS, type TbAccount, type TbFieldKey } from '@/reports/trialBalance'
import { useWideTable, numW, textW, type WideCol, type HeightDims } from '@/composables/useWideTable'

const props = defineProps<{
  rows: TbAccount[]                          // visibleRows 输出(已按 sortOrder 排序)
  expanded: Set<string>                      // 已展开父节点(箭头方向)
  /** 有子级的 rowKey → 直接下级数(才显展开箭头与「N 个下级」) */
  kids: Map<string, number>
  totals: Record<TbFieldKey, number>         // 合计尾行(tbTotals)
  valueOf: (rowKey: string, field: TbFieldKey) => number
  editable: boolean
  /** 有没有编辑权(LIST-PAGE §4):编辑态才出现的勾选框 / 删除钮 / 录入框按它预留宽,浏览态就留着 ——
   *  按 editable 留的话,同一 dataKey 下列宽只增不减,进编辑那一下整排金额列右移、固定列判定还可能翻转 */
  reserve?: boolean
  // 编辑中的原始输入值(空串或 number),供 <input> 显示
  liveOf?: (rowKey: string, field: TbFieldKey) => number | string
  /** 改过且有值的格:浅蓝底无框 */
  changedOf?: (rowKey: string, field: TbFieldKey) => boolean
  selected?: Set<string>                     // 编辑态批量删除选中集(合计尾行无复选)
  /** 换月 / 换公司时变:按新数据重算一次列宽 */
  dataKey: string
  /** 合计行名称上的口径悬停(D10) */
  footTip?: string
  /** 合计行就地标:期末借贷不平时多的那一格写「多 x」 */
  footMark?: Partial<Record<TbFieldKey, string>>
}>()

const emit = defineEmits<{
  toggle: [rowKey: string]
  input: [rowKey: string, field: TbFieldKey, value: string]
  remove: [rowKey: string]                   // 编辑态删科目(父级级联收集子树)
  select: [rowKey: string]                   // 编辑态复选切换(批量删除)
}>()

// 分组表头(期初余额/本期发生额/本年累计发生额/期末余额,各 colspan=2)
const GROUPS = [...new Set(TB_FIELDS.map(f => f.group))]
const isEnd = (k: TbFieldKey) => k === 'endDr' || k === 'endCr'

// ponytail: alias — valueOf 是 Object.prototype 成员,模板裸调会被渲染代理拦截,本地重命名(同 FinReportTable)
const cellVal = (k: string, f: TbFieldKey) => props.valueOf(k, f)
const show = (v: number) => (v ? finSigned(v) : '–')
function inputVal(r: TbAccount, field: TbFieldKey): string {
  const lv = props.liveOf ? props.liveOf(r.rowKey, field) : cellVal(r.rowKey, field)
  return lv === 0 || lv == null ? '' : String(lv)
}

// ── 固定列(LIST-PAGE §9.1)──────────────────────────────────
// 列宽不量 DOM:名称按「缩进 + 箭头 + 名字 + N 个下级 + 删除钮」估;期末两列按整列最长的数(含合计与就地标)。
const INDENT = 14
const kidText = (r: TbAccount) => (props.kids.get(r.rowKey) ? `${props.kids.get(r.rowKey)} 个下级` : '')
const tagW = (r: TbAccount) => (kidText(r) ? textW([kidText(r)], 11.5, 0) + 6 : 0)
const rsv = () => props.editable || !!props.reserve
const lead = (r: TbAccount) => 12 + r.level * INDENT + 20 + 4 + (rsv() ? 24 : 0)
const needW = computed(() => {
  const m: Record<string, number> = {}
  for (const r of props.rows) m[r.rowKey] = lead(r) + textW([r.label], 13, 0) + tagW(r) + 12
  return m
})
const cols = computed<WideCol[]>(() => {
  const endW = (k: TbFieldKey) => numW([
    ...props.rows.map(r => show(cellVal(r.rowKey, k))), show(props.totals[k]),
  ], 13, 24) + (props.footMark?.[k] ? textW([props.footMark[k]!], 11.5, 0) + 18 : 0)
  // 录入框 .fin-ni 最窄 96 + 左右各 8 = 112:期末两列是固定列,实际宽比估的宽就会和相邻固定列的 offset 叠住
  const inW = rsv() ? 112 : 0
  return [
    { key: 'code', side: 'L', w: Math.max(textW(['科目代码'], 11.5, 24), numW(props.rows.map(r => r.code ?? ''), 11.5, 24)) + (rsv() ? 22 : 0), rank: 0 },
    { key: 'name', side: 'L', name: true, rank: 0,
      w: Math.max(textW(['科目名称'], 11.5, 24), ...Object.values(needW.value)),
      minW: Math.max(0, ...props.rows.map(r => lead(r) + tagW(r) + 3 * 13 + 12)) },
    { key: 'endDr', side: 'R', w: Math.max(endW('endDr'), textW(['期末借方'], 11.5, 24), inW), rank: 1 },
    { key: 'endCr', side: 'R', w: Math.max(endW('endCr'), textW(['期末贷方'], 11.5, 24), inW), rank: 2 },
  ]
})
const DIMS: HeightDims = { grpH: 32, leafH: 32, rowH: 40, footH: 46 }
const wrap = ref<HTMLElement | null>(null)
const { fix, nameW } = useWideTable(wrap, cols, DIMS, () => props.dataKey)
// ponytail: StickyStyle 是 interface,模板 :style 要 CSSProperties,这里转一次(同 PnlTable)
const st = computed(() => fix.value.style as Record<string, CSSProperties>)
const fc = (k: string) => ({ 'tb-fix': k in fix.value.style })
/** 窄档 = 表放不下要横滚,且期末贷方已经退成普通列:表头并成一层,每列写全名。
 *  放得下时固定列本来就看不出来(没有横滚),两层表头照旧 —— 只看「贷方退没退」的话,
 *  名字一长 1920 上也会无谓地并成一层。表宽按各列估宽相加(中间 6 列按整列最长的数,下限 120)。 */
const tableW = computed(() => cols.value.reduce((s, c) => s + fix.value.w[c.key], 0)
  + TB_FIELDS.filter(f => !isEnd(f.key)).reduce((s, f) =>
    s + Math.max(120, numW([...props.rows.map(r => show(cellVal(r.rowKey, f.key))), show(props.totals[f.key])], 13, 24)), 0))
// 可见宽:useWideTable 不往外给,这里照它的口径自己量一份(量到 0 = 未布局 / KeepAlive 摘下,保持上次)
const visW = ref(0)
const ro = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(() => { visW.value = wrap.value?.clientWidth || visW.value }) : null
watch(wrap, (el, old) => {
  if (old) ro?.unobserve(old)
  if (el) { ro?.observe(el); visW.value = el.clientWidth || visW.value }
})
onBeforeUnmount(() => ro?.disconnect())
const narrow = computed(() => !('endCr' in fix.value.style) && tableW.value > visW.value)
const wOf = (k: string): CSSProperties => ({ minWidth: fix.value.w[k] + 'px' })
// 名称封顶了才给名字框定宽(省略号靠它);没封顶按内容自然撑开
const nameCap = computed(() => nameW.value < (cols.value[1].w))
const nameBox = computed<CSSProperties | undefined>(() => nameCap.value ? { width: nameW.value - 12 + 'px' } : undefined)
const codeBox = computed<CSSProperties>(() => ({ width: fix.value.w.code - 12 + 'px' }))
</script>

<template>
  <div ref="wrap" class="fin-wrap">
    <table class="fin-table tb-table" :class="{ narrow }">
      <thead>
        <tr v-if="!narrow">
          <th class="h1 tb-c" :class="fc('code')" rowspan="2" :style="[st.code, wOf('code')]">科目代码</th>
          <th class="h1 tb-n" :class="fc('name')" rowspan="2" :style="st.name">科目名称</th>
          <th v-for="g in GROUPS" :key="g" class="h1 grp" colspan="2">{{ g }}</th>
          <th class="h1 fp-fill" rowspan="2" aria-hidden="true"></th>
        </tr>
        <tr v-if="!narrow">
          <th v-for="f in TB_FIELDS" :key="f.key" class="h2" :class="[fc(f.key), { k: isEnd(f.key) }]"
              :style="isEnd(f.key) ? [st[f.key], wOf(f.key)] : undefined">{{ f.side }}</th>
        </tr>
        <tr v-else>
          <th class="h1 tb-c" :class="fc('code')" :style="[st.code, wOf('code')]">科目代码</th>
          <th class="h1 tb-n" :class="fc('name')" :style="st.name">科目名称</th>
          <th v-for="f in TB_FIELDS" :key="f.key" class="h1" :class="[fc(f.key), { k: isEnd(f.key), gl: f.side === '借方' }]"
              :style="isEnd(f.key) ? [st[f.key], wOf(f.key)] : undefined">{{ f.label }}</th>
          <th class="h1 fp-fill" aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.rowKey" :class="{ sel: selected?.has(r.rowKey) }">
          <td class="tb-c" :class="fc('code')" :style="st.code">
            <span class="tb-codebox" :style="codeBox">
              <input v-if="editable" class="tb-ck" type="checkbox" v-tip="'选择科目(批量删除)'" :checked="selected?.has(r.rowKey)" @change="emit('select', r.rowKey)" />
              <span class="tb-code">{{ r.code ?? '' }}</span>
            </span>
          </td>
          <td class="tb-n" :class="[fc('name'), { 'fp-rowtg': kids.has(r.rowKey) }]" :style="st.name"
              @click="kids.has(r.rowKey) && rowToggle($event, () => emit('toggle', r.rowKey))">
            <span class="tb-label" :class="{ lv0: r.level === 0 }" :style="[{ paddingLeft: 12 + r.level * INDENT + 'px' }, nameBox ?? {}]">
              <button
                v-if="kids.has(r.rowKey)"
                class="tb-caret"
                v-tip="expanded.has(r.rowKey) ? '收起下级' : '展开下级'"
                @click="emit('toggle', r.rowKey)"
              ><component :is="iconFor(expanded.has(r.rowKey) ? 'chevron-down' : 'chevron-right')" :size="14" /></button>
              <span v-else class="tb-caret-ph" />
              <span class="tb-name" v-tip="nameCap && needW[r.rowKey] > nameW ? r.label : null">{{ r.label }}</span>
              <span v-if="kids.has(r.rowKey)" class="tb-kids">{{ kidText(r) }}</span>
              <button v-if="editable" class="tb-x" v-tip="'删除科目(含下级)'" @click="emit('remove', r.rowKey)"><component :is="iconFor('x')" :size="13" /></button>
            </span>
          </td>
          <td v-for="f in TB_FIELDS" :key="f.key" :class="[fc(f.key), { k: isEnd(f.key) && !editable, gl: f.side === '借方' }]" :style="st[f.key]">
            <input v-if="editable" class="fin-ni" :class="{ chg: changedOf?.(r.rowKey, f.key) }" type="number"
                   :value="inputVal(r, f.key)" @input="emit('input', r.rowKey, f.key, ($event.target as HTMLInputElement).value)" />
            <span v-else class="fin-nv" :class="{ empty: !cellVal(r.rowKey, f.key), neg: cellVal(r.rowKey, f.key) < 0, b: isEnd(f.key) && !!cellVal(r.rowKey, f.key) }">{{ show(cellVal(r.rowKey, f.key)) }}</span>
          </td>
          <td class="fp-fill" aria-hidden="true"></td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td class="tb-c" :class="fc('code')" :style="st.code"></td>
          <td class="tb-n" :class="fc('name')" :style="st.name"><span class="tb-label lv0 tb-foot-l" v-tip="footTip">合　计</span></td>
          <td v-for="f in TB_FIELDS" :key="f.key" :class="[fc(f.key), { k: isEnd(f.key), gl: f.side === '借方' }]" :style="st[f.key]">
            <span class="fin-nv calc" :class="{ neg: totals[f.key] < 0 }">
              <span v-if="footMark?.[f.key]" class="tb-mark"><i class="tb-dot" />{{ footMark[f.key] }}</span>{{ show(totals[f.key]) }}
            </span>
          </td>
          <td class="fp-fill" aria-hidden="true"></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* 外框归 FinCard,这里只是滚动区 */
.fin-wrap { flex:1 1 auto; min-height:0; overflow:auto; background:var(--surface-white); }
/* 列宽(LIST-PAGE-SPEC §4):各列按内容定宽,余宽落进行末空列 .fp-fill;
   固定列的宽由 useWideTable 给(min-width / 名字框定宽),offset 按它累加 */
.fin-table { border-collapse:separate; border-spacing:0; width:100%; font-family:var(--font-sans); }
.fin-table th, .fin-table td { border-bottom:1px solid var(--divider); box-sizing:border-box; padding:0; text-align:left; }
.fin-table thead th { position:sticky; z-index:3; background:var(--surface-card); color:var(--text-muted); font-size:11.5px; font-weight:var(--fw-semibold); text-align:right; padding:0 12px; vertical-align:middle; white-space:nowrap; }
.fin-table thead th.tb-c, .fin-table thead th.tb-n { text-align:left; }
.fin-table thead th.grp { text-align:center; border-left:1px solid var(--divider); }
.fin-table thead th.h2:nth-child(odd), .fin-table .gl { border-left:1px solid var(--divider); }
.fin-table thead th.h2 { min-width:120px; }
.fin-table.narrow thead th.h1 { min-width:110px; }
.fin-table.narrow thead th.tb-c, .fin-table.narrow thead th.tb-n, .fin-table thead th.fp-fill { min-width:0; }
/* sticky 两行表头:h1 顶行 32px,h2 借/贷行紧贴其下;窄档只有一行 */
.fin-table thead th.h1 { top:0; height:32px; }
.fin-table thead th.h2 { top:32px; height:32px; border-top:1px solid var(--divider); }
/* 关键列:期末借贷 —— 表头下划线、格子浅蓝底(暗色跟着 --accent-blue 令牌走) */
/* 下划线走 border 不走 box-shadow:固定列的内沿阴影是 useWideTable 内联的 box-shadow,会把它盖掉 */
.fin-table thead th.k { border-bottom:2px solid var(--hue-blue); color:var(--text-secondary); }
.fin-table td.k { background:color-mix(in srgb, var(--accent-blue) 55%, var(--surface-white)); }
.fin-table tbody td { height:40px; background:var(--surface-white); vertical-align:middle; }
.fin-table tbody tr:hover td { background:var(--surface-card); }
.fin-table tbody tr:hover td.k { background:color-mix(in srgb, var(--accent-blue) 80%, var(--surface-white)); }
.fin-table tbody tr.sel td { background:var(--row-selected); }
/* 固定列:sticky、left/right、内沿阴影由 useWideTable 内联给(.tb-fix 标记仍固定的那几根) */
.fin-table thead th.tb-fix { z-index:5; }
.fin-table tbody td.tb-fix { z-index:2; }
/* 合计贴底:不透明底 */
.fin-table tfoot td { position:sticky; bottom:0; z-index:3; height:46px; background:var(--surface-card); border-top:1px solid var(--border-strong); border-bottom:none; vertical-align:middle; }
.fin-table tfoot td.tb-fix { z-index:4; }
.fin-table tfoot td.k { background:color-mix(in srgb, var(--accent-blue) 55%, var(--surface-card)); }
.tb-codebox { display:flex; align-items:center; gap:8px; padding-left:12px; overflow:hidden; }
.tb-code { font-size:12px; color:var(--text-muted); font-family:var(--font-mono); white-space:nowrap; }
.tb-ck { flex:0 0 auto; margin:0; accent-color:var(--hue-blue); cursor:pointer; }
.tb-label { display:flex; align-items:center; gap:4px; padding-right:12px; box-sizing:border-box; font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; }
.tb-label.lv0 { font-weight:var(--fw-medium); }
.tb-foot-l { padding-left:12px; font-weight:var(--fw-semibold); cursor:help; }
.tb-name { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.tb-kids { flex:none; margin-left:2px; font-size:11.5px; font-weight:var(--fw-regular); color:var(--text-muted); }
.tb-caret { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-muted); cursor:pointer; display:grid; place-items:center; padding:0; }
.tb-caret:hover { background:var(--bg-hover); color:var(--text-primary); }
.tb-caret-ph { width:20px; flex:0 0 auto; }
/* 平时 visibility:hidden 而不是 display:none:名称列按内容定宽,display 切换会让悬停那一行把列撑宽 */
.tb-x { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-disabled); cursor:pointer; display:grid; visibility:hidden; place-items:center; margin-left:auto; }
.fin-table tbody tr:hover .tb-x { visibility:visible; }
.tb-x:hover { background:var(--danger-soft); color:var(--hue-red); }
.fin-nv { display:block; text-align:right; font-size:13px; padding:0 12px; color:var(--text-secondary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.fin-nv.b { font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-nv.empty { color:var(--text-disabled); }
.fin-nv.calc { font-weight:var(--fw-semibold); color:var(--text-primary); font-size:14px; }
.fin-nv.neg { color:var(--hue-red); }
.tb-mark { display:inline-flex; align-items:center; gap:4px; margin-right:8px; font-size:11.5px; font-weight:var(--fw-medium); color:var(--delta-down-text); }
.tb-dot { width:6px; height:6px; border-radius:50%; background:var(--hue-red); }
/* 编辑态录入框:白底描边;改过(有值)浅蓝底无框 */
.fin-ni { display:block; width:calc(100% - 16px); min-width:96px; height:28px; margin:0 8px; box-sizing:border-box; border:1px solid var(--border-control); background:var(--surface-white); text-align:right; font-size:13px; padding:0 8px; outline:none; color:var(--text-primary); font-family:var(--font-mono); border-radius:var(--radius-sm); }
.fin-ni.chg { background:var(--accent-blue); border-color:transparent; }
.fin-ni:focus { background:var(--surface-white); border-color:var(--hue-blue); }
.fin-ni::-webkit-outer-spin-button, .fin-ni::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }

/* 触屏无 hover(RESPONSIVE-LAYOUT-SPEC §6.1):行 hover 显形的删科目 × 常显,半透明弱化 */
@media (hover: none) {
  .tb-x { visibility:visible; opacity:.6; }
}
</style>
