<script setup lang="ts">
// FinReportTable — 利润表 / 资产负债表的表(画布 09 ReportIS / ReportBS / ReportStates)。
// 行由父级预先展平传入;取值、计算(公式、子类求和)归父级,本组件只管摆、收起、录入框。
//
//   · 单表(利润表):项目 / 行次 / 各金额列 / 填充列(.fp-fill)。
//   · 成对(资产负债表,传 right):资产 / 行次 / 期末余额 / 负债和所有者权益 / 行次 / 期末余额 / 填充列,
//     按行成对排,短的一边补空格。两边各自收起,行序按可见行重新配对。
//   · 分组行(row.group):带折叠箭头,子行用 row.parent 指回它;'fold' 默认收起('其中' 明细),'open' 默认展开。
//   · 关键列(column.strong):浅蓝底 + 加粗 + 表头下划线(利润表本月金额、资产负债表期末余额)。
//   · 贴底行(foot,每边一行):不透明底;名称上挂口径悬停(footTip,D10:页底说明行删掉后口径挂这里);
//     footMark 给就地标(「● 多 x」,只给点不给字 = '')。
//   · 0 与空一律写「–」(D8)。
import { rowToggle } from '@/utils/rowToggle'
import { ref } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { finSigned } from '@/utils/finFmt'

// 一条展平后的行。type: normal 叶子(可录入)/ subtotal 小计(公式,只读)。
// parentAuto: 该 normal 父行有自定义子类 → 自动汇总,不可直接录入。
export interface FinTableRow {
  key: string | number   // 行次(常驻)或自定义行 rowKey
  no?: string | number   // 行次列显示(自定义行留空)
  label: string
  level: number          // 0..3 缩进
  type: 'normal' | 'label' | 'subtotal'
  custom?: boolean        // 自定义子类 → 编辑时可删
  strong?: boolean        // 小计强调
  parentAuto?: boolean    // 有子类 → 求和只读
  childCount?: number     // >0 时显示「N 个子类 · 自动合计」
  canAddChild?: boolean   // 编辑时可 +
  /** 分组行:'fold' 默认收起,'open' 默认展开 */
  group?: 'fold' | 'open'
  /** 所属分组行的 key(收起时跟着藏) */
  parent?: string | number
  /** 名称后面的灰字:「其中 6 项」「10 项 · 合计」 */
  tag?: string
}
export interface FinTableColumn { key: string; label: string; strong?: boolean }

const props = defineProps<{
  rows: FinTableRow[]
  /** 成对表的右半边;不传 = 单表 */
  right?: FinTableRow[]
  /** 每一边名称列的表头;默认「项　目」 */
  heads?: string[]
  columns: FinTableColumn[]
  valueOf: (rowKey: string | number, field: string) => number
  editable: boolean
  // 编辑中的原始输入值(空串或 number),供 <input> 显示;normal 叶子行才用
  liveOf?: (rowKey: string | number, field: string) => number | string
  /** 这一格改过且有值 → 浅蓝底无框(清空的格和没动的一样是白底描边框,稿 ReportStates) */
  changedOf?: (rowKey: string | number, field: string) => boolean
  // 批量删除多选(P2-G3):编辑态每一边名称前一根复选列。仅普通叶子行可选。
  selectable?: boolean
  selected?: Set<string | number>
  /** 贴底行,下标 0 = 左边、1 = 右边 */
  foot?: FinTableRow[]
  /** 贴底行名称上的口径悬停 */
  footTip?: string
  /** 贴底行就地标:key → 文案('' = 只给红点) */
  footMark?: Record<string, string>
}>()

const emit = defineEmits<{
  input: [rowKey: string | number, field: string, value: string]
  addChild: [row: FinTableRow]
  removeChild: [row: FinTableRow]
  toggleSelect: [row: FinTableRow]
}>()

// 可勾选 = 普通叶子行(常驻固定 or 自定义);subtotal/parentAuto 不可选
const canSelect = (r: FinTableRow) => r.type === 'normal' && !r.parentAuto

// ponytail: alias — `valueOf` 是 Object.prototype 成员,模板里裸调会被渲染代理拦截解析失败,故本地重命名。
const cellVal = (k: string | number, f: string) => props.valueOf(k, f)
const show = (v: number) => (v ? finSigned(v) : '–')

// ── 收起 ── 只记用户点过的;没点过的按 row.group 的默认
const flips = ref(new Map<string | number, boolean>())
const isOpen = (r: FinTableRow) => flips.value.get(r.key) ?? r.group !== 'fold'
function toggle(r: FinTableRow) {
  flips.value = new Map(flips.value).set(r.key, !isOpen(r))
}
function visible(list: FinTableRow[]): FinTableRow[] {
  const byKey = new Map(list.map(r => [r.key, r]))
  return list.filter(r => {
    for (let p = r.parent; p != null; p = byKey.get(p)?.parent) {
      const g = byKey.get(p)
      if (g && !isOpen(g)) return false
    }
    return true
  })
}
/** 成对:左右各自可见行按下标配对,短的一边补 null */
function pairs(): (FinTableRow | null)[][] {
  const l = visible(props.rows)
  const r = props.right ? visible(props.right) : null
  const n = Math.max(l.length, r?.length ?? 0)
  return Array.from({ length: n }, (_, i) => (r ? [l[i] ?? null, r[i] ?? null] : [l[i] ?? null]))
}

function trClass(r: FinTableRow | null) {
  if (!r) return ''
  // 顶层分组行(利润表「其中」父项、资产负债表段头)浅灰底;二层的「其中」(存货)不铺底,稿如此
  return [r.group && r.level === 0 ? 'grp' : r.type === 'subtotal' && !r.group ? 'sub' : '', { sel: props.selected?.has(r.key) }]
}
// normal 父行(有子类)与 subtotal 都是只读计算格
const isCalc = (r: FinTableRow) => r.type === 'subtotal' || !!r.parentAuto
function inputVal(r: FinTableRow, field: string): string {
  const lv = props.liveOf ? props.liveOf(r.key, field) : cellVal(r.key, field)
  return lv === 0 || lv == null ? '' : String(lv)
}
const sides = () => (props.right ? 2 : 1)
const headOf = (i: number) => props.heads?.[i] ?? '项　目'
</script>

<template>
  <div class="fin-wrap">
    <!-- has-ck:编辑态多出的 34px 复选列,只用来给 S 档首列 sticky 让出那 34px(见下方 ≤600 块) -->
    <table class="fin-table" :class="{ 'has-ck': selectable, pair: !!right }">
      <colgroup>
        <template v-for="s in sides()" :key="s">
          <col v-if="selectable" style="width:34px" />
          <col style="width:auto" />
          <col style="width:48px" />
          <col v-for="c in columns" :key="c.key" style="width:150px" />
        </template>
      </colgroup>
      <thead>
        <tr>
          <template v-for="(_, si) in sides()" :key="si">
            <th v-if="selectable" class="fin-ckcell"></th>
            <th class="fin-c1 fin-hl" :class="{ 'fin-side2': si > 0 }">{{ headOf(si) }}</th>
            <th class="fin-noh">行次</th>
            <th v-for="c in columns" :key="c.key" class="fin-amt" :class="{ k: c.strong }">{{ c.label }}</th>
          </template>
          <th class="fp-fill" aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(pr, i) in pairs()" :key="i" :class="pr.length === 1 ? trClass(pr[0]) : ''">
          <template v-for="(r, si) in pr" :key="si">
            <template v-if="r">
              <td v-if="selectable" class="fin-ckcell" :class="trClass(r)">
                <input v-if="canSelect(r)" class="fin-ck" type="checkbox" :checked="selected?.has(r.key)" @change="emit('toggleSelect', r)" />
              </td>
              <td class="fin-c1" :class="[trClass(r), { 'fin-side2': si > 0, 'fp-rowtg': r.group }]" @click="r.group && rowToggle($event, () => toggle(r))">
                <span class="fin-rowlabel" :class="{ strong: r.group || r.type === 'subtotal' }" :style="{ paddingLeft: 12 + r.level * 12 + 'px' }" v-tip="r.label">
                  <button v-if="r.group" type="button" class="fin-caret" :aria-label="isOpen(r) ? '收起' : '展开'"
                          @click="toggle(r)"><component :is="iconFor(isOpen(r) ? 'chevron-down' : 'chevron-right')" :size="14" /></button>
                  <span v-else class="fin-caret-ph" />
                  <span class="fin-lt">{{ r.label }}</span>
                  <span v-if="r.tag" class="fin-tagt">{{ r.tag }}</span>
                  <span v-if="r.parentAuto && r.childCount" class="chip">{{ r.childCount }} 个子类 · 自动合计</span>
                  <button v-if="editable && r.custom" class="custom-x" v-tip="'删除子类'" @click="emit('removeChild', r)"><component :is="iconFor('x')" :size="13" /></button>
                  <button v-if="editable && r.canAddChild" class="addchild" v-tip="'添加子类'" @click="emit('addChild', r)"><component :is="iconFor('plus')" :size="13" /></button>
                </span>
              </td>
              <td :class="trClass(r)"><span class="fin-no">{{ r.custom ? '' : r.no ?? r.key }}</span></td>
              <td v-for="c in columns" :key="c.key" :class="[trClass(r), { k: c.strong && !(editable && !isCalc(r)) }]">
                <span v-if="isCalc(r)" class="fin-nv calc" :class="{ neg: cellVal(r.key, c.key) < 0, empty: !cellVal(r.key, c.key) }">{{ show(cellVal(r.key, c.key)) }}</span>
                <input v-else-if="editable" class="fin-ni" :class="{ chg: changedOf?.(r.key, c.key) }" type="number"
                       :value="inputVal(r, c.key)" @input="emit('input', r.key, c.key, ($event.target as HTMLInputElement).value)" />
                <span v-else class="fin-nv" :class="{ empty: !cellVal(r.key, c.key), neg: cellVal(r.key, c.key) < 0, b: c.strong || r.group }">{{ show(cellVal(r.key, c.key)) }}</span>
              </td>
            </template>
            <template v-else>
              <td v-if="selectable"></td><td class="fin-c1" :class="{ 'fin-side2': si > 0 }"></td><td></td><td v-for="c in columns" :key="c.key" :class="{ k: c.strong && !editable }"></td>
            </template>
          </template>
          <!-- 单表(利润表):分组灰底 / 选中底 / 小计上边线铺到整行(稿 ReportIS、LIST-PAGE §4);
               成对表(资产负债表)两边各是一行,填充格不跟哪一边(稿 ReportBS 段头灰底停在右半边金额列) -->
          <td class="fp-fill" aria-hidden="true" :class="pr.length === 1 ? trClass(pr[0]) : ''"></td>
        </tr>
      </tbody>
      <tfoot v-if="foot?.length">
        <tr>
          <template v-for="(r, si) in foot" :key="r.key">
            <td v-if="selectable"></td>
            <td class="fin-c1" :class="{ 'fin-side2': si > 0 }"><span class="fin-rowlabel strong fin-foot-l" v-tip="footTip">{{ r.label }}</span></td>
            <td><span class="fin-no">{{ r.no ?? r.key }}</span></td>
            <td v-for="(c, ci) in columns" :key="c.key" :class="{ k: c.strong }">
              <span class="fin-nv calc fin-foot-v" :class="{ neg: cellVal(r.key, c.key) < 0 }">
                <span v-if="ci === 0 && footMark && String(r.key) in footMark" class="fin-mark"><i class="fin-dot" />{{ footMark[String(r.key)] }}</span>{{ show(cellVal(r.key, c.key)) }}
              </span>
            </td>
          </template>
          <td class="fp-fill" aria-hidden="true"></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* 外框归 FinCard(卡头「N 项 / 单位：元」与表同一张卡),这里只是滚动区 */
.fin-wrap { flex:1 1 auto; min-height:0; overflow:auto; background:var(--surface-white); }
.fin-table { border-collapse:separate; border-spacing:0; width:100%; font-family:var(--font-sans); }
.fin-table th, .fin-table td { border-bottom:1px solid var(--divider); box-sizing:border-box; padding:0; text-align:left; }
.fin-table thead th { position:sticky; top:0; z-index:3; background:var(--surface-card); color:var(--text-muted); font-size:11.5px; font-weight:var(--fw-semibold); text-align:right; padding:9px 12px; vertical-align:middle; white-space:nowrap; }
.fin-table thead th.fin-hl { text-align:left; }
.fin-table thead th.fin-noh { text-align:right; }
.fin-table thead th.fin-ckcell { text-align:center; }
/* 关键列表头下划线(稿:本月金额 / 期末余额) */
.fin-table thead th.k { box-shadow:inset 0 -2px 0 var(--hue-blue); color:var(--text-secondary); }
.fin-table tbody td { height:40px; background:var(--surface-white); vertical-align:middle; }
.fin-table tbody tr:hover td { background:var(--surface-card); }
/* 关键列浅蓝底:钱列底(暗色跟着 --accent-blue 令牌走) */
.fin-table td.k { background:color-mix(in srgb, var(--accent-blue) 55%, var(--surface-white)); }
.fin-table tbody tr:hover td.k { background:color-mix(in srgb, var(--accent-blue) 80%, var(--surface-white)); }
/* 分组行(其中 / 段合计):浅灰底 + 加粗;关键列那格是灰底上的浅蓝 */
.fin-table tbody td.grp { background:var(--surface-card); }
.fin-table tbody td.grp.k { background:color-mix(in srgb, var(--accent-blue) 55%, var(--surface-card)); }
/* 小计行(营业利润、负债合计…):上边线 + 加粗 */
.fin-table tbody td.sub { border-top:1px solid var(--border-subtle); }
/* 勾选中的行 */
.fin-table tbody td.sel { background:var(--row-selected); }
/* 成对表:右半边名称列左边一根分隔线 */
.fin-table .fin-side2 { border-left:1px solid var(--divider); }
/* 列宽(LIST-PAGE-SPEC §4):名称列按最长的行名定宽,余宽落进行末空列 .fp-fill;定宽列靠表头格 min-width 撑住 */
.fin-table thead th.fin-ckcell { min-width:34px; }
.fin-table thead th.fin-noh { min-width:48px; }
.fin-table thead th.fin-amt { min-width:150px; }
.fin-rowlabel { display:flex; align-items:center; gap:6px; padding-right:12px; font-size:13px; color:var(--text-primary); white-space:nowrap; }
.fin-rowlabel.strong { font-weight:var(--fw-semibold); }
.fin-lt { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.fin-tagt { flex:none; font-size:11.5px; font-weight:var(--fw-regular); color:var(--text-muted); }
.fin-caret, .fin-caret-ph { width:18px; height:18px; flex:0 0 auto; }
.fin-caret { border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-muted); cursor:pointer; display:grid; place-items:center; padding:0; }
.fin-caret:hover { background:var(--bg-hover); color:var(--text-primary); }
/* +/× 平时 visibility:hidden 而不是 display:none:名称列按内容定宽,display 切换会让悬停那一行把列撑宽、整表右移 */
.fin-rowlabel .custom-x { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-disabled); cursor:pointer; display:grid; visibility:hidden; place-items:center; }
.fin-table tbody tr:hover .fin-rowlabel .custom-x { visibility:visible; }
.fin-rowlabel .custom-x:hover { background:var(--danger-soft); color:var(--hue-red); }
.fin-rowlabel .addchild { width:20px; height:20px; flex:0 0 auto; border:none; background:transparent; border-radius:var(--radius-sm); color:var(--text-disabled); cursor:pointer; display:grid; visibility:hidden; place-items:center; margin-left:auto; }
.fin-table tbody tr:hover .fin-rowlabel .addchild { visibility:visible; }
.fin-rowlabel .addchild:hover { background:var(--accent-blue); color:var(--hue-blue); }
.fin-rowlabel .chip { flex:0 0 auto; font-size:11px; font-weight:var(--fw-medium); color:var(--hue-blue); background:var(--accent-blue); border-radius:var(--radius-full); padding:1px 7px; }
.fin-no { display:block; text-align:right; padding:0 12px; font-size:11px; color:var(--text-muted); font-family:var(--font-mono); }
.fin-ckcell { text-align:center; }
.fin-ck { display:block; margin:0 auto; width:14px; height:14px; accent-color:var(--hue-blue); cursor:pointer; }
.fin-nv { display:block; text-align:right; font-size:13px; padding:0 12px; color:var(--text-secondary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.fin-nv.b { font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-nv.empty { color:var(--text-disabled); font-weight:var(--fw-regular); }
.fin-nv.calc { font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-nv.calc.empty { color:var(--text-disabled); font-weight:var(--fw-regular); }
.fin-nv.neg { color:var(--hue-red); }
/* 编辑态录入框:白底描边;改过(有值)浅蓝底无框;清空的和没动的一样 */
.fin-ni { display:block; width:calc(100% - 16px); height:28px; margin:0 8px; box-sizing:border-box; border:1px solid var(--border-control); background:var(--surface-white); text-align:right; font-size:13px; padding:0 8px; outline:none; color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; border-radius:var(--radius-sm); }
.fin-ni.chg { background:var(--accent-blue); border-color:transparent; }
.fin-ni:focus { background:var(--surface-white); border-color:var(--hue-blue); }
.fin-ni::-webkit-outer-spin-button, .fin-ni::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }

/* 贴底行:不透明底(滚到下面的行不透出来),上边线;负数红 */
.fin-table tfoot td { position:sticky; bottom:0; z-index:2; height:46px; background:var(--surface-card); border-top:1px solid var(--border-strong); border-bottom:none; vertical-align:middle; }
.fin-table tfoot td.k { background:color-mix(in srgb, var(--accent-blue) 55%, var(--surface-card)); }
.fin-foot-l { padding-left:12px; font-size:13.5px; cursor:help; }
.fin-foot-v { font-size:15px; }
.fin-mark { display:inline-flex; align-items:center; gap:4px; margin-right:8px; font-size:11.5px; font-weight:var(--fw-medium); color:var(--delta-down-text); }
.fin-dot { width:6px; height:6px; border-radius:50%; background:var(--hue-red); }

/* 触屏无 hover(RESPONSIVE-LAYOUT-SPEC §6.1):行 hover 显形的 +/× 按钮常显,半透明弱化 */
@media (hover: none) {
  .fin-rowlabel .custom-x, .fin-rowlabel .addchild { visibility:visible; opacity:.6; }
}

/* ── S 档(≤600,RESPONSIVE-LAYOUT-SPEC §5.3):查看优先,sticky 只留一根首列 + 表头 ──
   首列 = 「项目」列(.fin-c1)。编辑态前面多一根 34px 复选列,此时「项目」列的 left 正好是那根的宽度 34 ——
   .has-ck 给的就是这一个偏移,数值与上面 <col style="width:34px"> 同源(finStickyS.spec 钉住两者相等)。
   成对表只粘左半边的名称列(.fin-side2 不粘)。
   z-index 沿全仓表内 sticky 阶梯:thead 4 / 双轴(顶+左)表头格 8 / 体内 sticky 列 3。 */
@media (max-width: 600px) {
  .fin-table thead th { z-index:4; }
  .fin-table thead th.fin-c1:not(.fin-side2) { left:0; z-index:8; }
  .fin-table tbody td.fin-c1:not(.fin-side2) { position:sticky; left:0; z-index:3; }
  .fin-table.has-ck thead th.fin-c1:not(.fin-side2) { left:34px; }
  .fin-table.has-ck tbody td.fin-c1:not(.fin-side2) { left:34px; }
}
</style>
