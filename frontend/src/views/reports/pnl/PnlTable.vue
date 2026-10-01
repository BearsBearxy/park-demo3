<script setup lang="ts">
// 损益附表年度矩阵表 — 版式 1:1 参照原型 screen-schedule2.jsx 表体 + SalaryTable sticky 双左列范式。
// 列:编辑态行首复选(批量删除 P2-G3 J7,映射行不渲) | 分组(同值向下省略显示) | 科目细分 | 1月..12月 | 本年合计(rowYearTotal 客端派生) | 编辑态:备注 | 填入。
// 哪几根固定由 useWideTable 按表格可见宽度算(LIST-PAGE §9.1,画布 07-C):科目细分(勾选列随它)→ 本年合计 → 分组 → 填入,备注不固定。
// kind 分带(spec D2,仅渲染):subtotal 底 accent-slate、pnl 底 accent-blue 加粗、total 加粗上边框。
// 月值 null=未录(显 –,区分真 0);编辑态单元格 input(空↔null),值由父 draft 合并后下发,本组件无状态。
// 派生对照(P2-G G2/G3):行首徽标 已证√蓝/差异N月橙(hover 逐月差额)/编辑态灰「可填入」,无映射不显;
// diff 月单元格橙底;编辑态行尾「填入」emit fill(rowKey),读态只显对照不显填入。
import { computed, ref, watch, type CSSProperties } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedNoteCell from '@/components/sched/SchedNoteCell.vue'
import FPWideCards, { type WideCard } from '@/components/fp/FPWideCards.vue'
import PnlRowDrawer from './PnlRowDrawer.vue'
import { useViewport } from '@/composables/useViewport'
import { useWideTable, numW, textW, minTableH, type HeightDims, type WideCol } from '@/composables/useWideTable'
import { rowYearTotal } from '@/reports/pnlSchedules'
import { finSigned } from '@/utils/finFmt'
import type { PnlRowDTO, PnlKind } from '@/types/pnl'
import type { CompareResult } from '@/reports/pnlDerive'

const props = defineProps<{
  year: number
  rows: PnlRowDTO[]
  groupCol: string
  edit: boolean
  derive?: Record<string /*rowKey*/, CompareResult & { derived: (number | null)[] }>
  mappedKeys?: Set<string>   // 派生映射行(P2-G3 J1):编辑态月格只读+不可选删;「填入」/备注照旧
  selected?: Set<string>     // 批量删除选集(P2-G3 J7):编辑态行首复选,父组件持有
}>()
const emit = defineEmits<{
  input: [rowKey: string, monthIdx: number, v: number | null]
  note: [rowKey: string, text: string]
  toggleSelect: [rowKey: string]
  add: []
  fill: [rowKey: string]
}>()

const KIND_CLASS: Record<PnlKind, string> = {
  detail: 'pt-detail', subtotal: 'pt-subtotal', pnl: 'pt-pnl', total: 'pt-total',
}

// 分组同值向下省略显示(合并单元格观感)
const showGroup = (i: number) =>
  i === 0 || props.rows[i].groupLabel !== props.rows[i - 1].groupLabel

// ── 派生对照(命中行才有条目;empty 仅编辑态示意) ──
const badges = computed<Record<string, { cls: string; text: string; title?: string }>>(() => {
  const out: Record<string, { cls: string; text: string; title?: string }> = {}
  for (const r of props.rows) {
    const d = props.derive?.[r.rowKey]
    if (!d) continue
    if (d.state === 'ok') out[r.rowKey] = { cls: 'ok', text: '已证√', title: '录入与数据层派生值一致(重叠月全等)' }
    else if (d.state === 'diff') out[r.rowKey] = {
      cls: 'diff',
      text: `差异${d.diffMonths.length}月`,
      title: d.diffMonths.map(m => `${m}月 录入 ${finSigned(r.m[m - 1])} ⇄ 派生 ${finSigned(d.derived[m - 1])}`).join('\n'),
    }
    else if (props.edit) out[r.rowKey] = { cls: 'empty', text: '可填入', title: '录入与派生无重叠月,可用「填入」写入空格' }
  }
  return out
})
const isDiffCell = (rowKey: string, mi: number) => {
  const d = props.derive?.[rowKey]
  return !!d && d.state === 'diff' && d.diffMonths.includes(mi + 1)
}
// 行有空格且派生有值 → 可填入(fillRow 只填空,已录/真 0 不覆盖)
const fillable = (r: PnlRowDTO) => {
  const d = props.derive?.[r.rowKey]
  return !!d && r.m.some((v, i) => v === null && d.derived[i] !== null)
}
const showFill = computed(() => props.edit && Object.keys(props.derive ?? {}).length > 0)

// ── 固定列与表格高度(LIST-PAGE §9,画布 07-C 损益附表行)──────────────
// 左右固定列合计 ≤ 表格可见宽 40%,超了按 填入 → 分组 → 本年合计 的顺序退;科目细分与编辑态勾选列 rank 0 永不退。
// 列宽不量 DOM:科目细分按最长的「名字 + 徽标」估(封顶 1/5,超了名字省略、悬停看全称);本年合计按整列最长的数。
const DIMS: HeightDims = { grpH: 0, leafH: 38, rowH: 38, footH: 0 }   // 单行表头、无贴底合计:只有 0 / 3 两级
const wrap = ref<HTMLElement | null>(null)
const badgeW = (rowKey: string) => {
  const b = badges.value[rowKey]
  return b ? textW([b.text], 11, 14) + 8 : 0   // 徽标 11px、内边距 7×2、左距 8
}
const subW = computed(() => {
  const out: Record<string, number> = {}
  for (const r of props.rows) out[r.rowKey] = textW([r.label], 13, 26) + badgeW(r.rowKey)
  return out
})
const subMax = computed(() => Math.max(textW(['科目细分'], 13, 26), ...Object.values(subW.value)))
// 封顶的下限 = 3 个字 + 这一行的徽标:徽标不缩,手机档编辑态 1/5 只有 71,一个「差异12月」就 71,
// 不设下限科目名被挤成 0 宽、徽标还压到 1 月那一格上
const subMin = computed(() => Math.max(0, ...props.rows.map(r => textW(['三个字'], 13, 26) + badgeW(r.rowKey))))
const cols = computed(() => {
  const totals = props.rows.map(r => { const t = rowYearTotal(r.m); return t === null ? '–' : finSigned(t) })
  const c: WideCol[] = []
  if (props.edit) c.push({ key: 'sel', side: 'L', w: 36, rank: 0 })
  c.push(
    { key: 'grp', side: 'L', w: 118, rank: 2 },
    { key: 'sub', side: 'L', w: subMax.value, rank: 0, name: true, minW: subMin.value },
    { key: 'ann', side: 'R', w: Math.max(textW(['本年合计'], 12, 26), numW(totals, 12.5, 26)), rank: 1 },
  )
  if (showFill.value) c.push({ key: 'fill', side: 'R', w: 56, rank: 3 })
  return c
})
const { fix, nameW, hStage, sbH } = useWideTable(wrap, cols, DIMS, () => props.year)
const fc = (k: string) => ({ 'pt-fix': k in fix.value.style })
// ponytail: StickyStyle 是 interface,模板 :style 要的 CSSProperties 带 `--*` 索引签名,这里转一次;W1 改成 type 别名后可删
const st = computed(() => fix.value.style as Record<string, CSSProperties>)
// 封顶了才给名字框定宽(省略号靠它);没封顶按内容自然撑开,估宽偏小也不会误截
const subBox = computed(() => nameW.value < subMax.value ? { width: nameW.value - 26 + 'px' } : undefined)
const wrapStyle = computed(() => hStage.value === 3 ? { minHeight: minTableH(DIMS) + 2 + sbH.value + 'px' } : undefined)   // +2 上下边框

// ── S 档(≤600)卡片化(响应式稿 WideCardVariants 板 §3,紧凑 64 档)────────────
// 稿的诊断:本表的病是**标签太宽**,两根标签列吃掉三分之一屏,剩下放不下一个月;
// 收敛 sticky 救不了(sticky 那根本身最宽),所以 S 档换成一行科目一张卡,12 个月进抽屉。
// 不删列、不改列宽:宽档那张横滚表原样留着,只是多了一条 v-else-if 分支。
//
// ⚠ 行结构是**平铺**的:分组是一根列(groupLabel,桌面靠同值省略造出合并观感),不是分组行;
// 每一行都自带 12 个月值 —— kind=subtotal/pnl/total 那几行存的是母册原值(见 .pnl-foot 那句),
// 点开照样有 12 个月。所以这里没有「点开没数」的行,全部行都出卡、都可点,
// 分组名按稿落进末行小字,不另画小节头。
//
// 编辑态不卡片化:卡上不能放 input(FPWideCards 硬条件②「整卡一个点击目标」),
// 小屏录入照旧走横滚表 —— .pnl-s-hint 那句「小屏可录入,建议在桌面端操作」说的就是这个形态。
const { tier } = useViewport()
const cardMode = computed(() => tier.value === 's' && !props.edit)
const openRow = ref<PnlRowDTO | null>(null)
watch(() => props.edit, () => { openRow.value = null })   // 进/出编辑态切回表格,别留个会自己弹回来的抽屉

const cardOf = (r: PnlRowDTO): WideCard => {
  const t = rowYearTotal(r.m)
  return {
    name: r.label,                                       // 科目细分
    amount: t === null ? '–' : finSigned(t),             // 本年合计(64 档贴第一行右端 mono 14)
    sub: r.groupLabel || undefined,                      // 分组名作小字
  }
}

// 单元格提交:空 → null(未录);扛千分位;非数字视同清空。
function onCell(rowKey: string, monthIdx: number, e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/[,\s]/g, '')
  if (raw === '') { emit('input', rowKey, monthIdx, null); return }
  const v = Number(raw)
  emit('input', rowKey, monthIdx, Number.isNaN(v) ? null : v)
}
</script>

<template>
  <div ref="wrap" class="pt-wrap" :style="wrapStyle">
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

    <!-- S 档读态:一行科目一张 64 紧凑卡,12 个月进抽屉(宽档 cardMode 恒 false,走下面原表) -->
    <FPWideCards
      v-else-if="cardMode"
      :rows="rows"
      :row-key="'rowKey'"
      :fields="cardOf"
      :density="64"
      @row-click="openRow = $event"
    />

    <table v-else class="pt-table">
      <thead>
        <tr>
          <th v-if="edit" class="pt-c-sel" :class="fc('sel')" :style="st.sel"></th>
          <th class="pt-c-grp l" :class="fc('grp')" :style="st.grp">{{ groupCol }}</th>
          <th class="pt-c-sub l" :class="fc('sub')" :style="st.sub">科目细分</th>
          <th v-for="m in 12" :key="m" class="pt-h-num">{{ m }}月</th>
          <th class="pt-c-ann pt-h-ann" :class="fc('ann')" :style="[st.ann, { minWidth: fix.w.ann + 'px' }]">本年合计</th>
          <th v-if="edit" class="pt-c-note l">备注</th>
          <th v-if="showFill" class="pt-c-fill" :class="fc('fill')" :style="st.fill">填入</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="r.rowKey" :class="KIND_CLASS[r.kind]">
          <td v-if="edit" class="pt-c-sel" :class="fc('sel')" :style="st.sel">
            <input
              v-if="!mappedKeys?.has(r.rowKey)"
              class="pt-ck"
              type="checkbox"
              title="选择该行(批量删除)"
              :checked="selected?.has(r.rowKey)"
              @change="emit('toggleSelect', r.rowKey)"
            />
          </td>
          <td class="pt-c-grp l" :class="fc('grp')" :style="st.grp" :title="r.groupLabel">{{ showGroup(i) ? r.groupLabel : '' }}</td>
          <td class="pt-c-sub l" :class="fc('sub')" :style="st.sub">
            <div class="pt-sub" :style="subBox">
              <span class="pt-sub-t" v-tip="subW[r.rowKey] > nameW ? r.label : null">{{ r.label }}</span>
              <span
                v-if="badges[r.rowKey]"
                class="pt-badge"
                :class="badges[r.rowKey].cls"
                :title="badges[r.rowKey].title"
              >{{ badges[r.rowKey].text }}</span>
            </div>
          </td>
          <td v-for="(v, mi) in r.m" :key="mi" class="pt-c-num" :class="{ 'pt-cell-diff': isDiffCell(r.rowKey, mi) }">
            <input
              v-if="edit && !mappedKeys?.has(r.rowKey)"
              class="pt-in"
              inputmode="decimal"
              :value="v ?? ''"
              placeholder="–"
              @change="onCell(r.rowKey, mi, $event)"
            />
            <span v-else-if="v === null" class="pt-null">–</span>
            <span v-else :class="{ 'pt-neg': v < 0 }">{{ finSigned(v) }}</span>
          </td>
          <td class="pt-c-num pt-c-ann" :class="fc('ann')" :style="st.ann">
            <span v-if="rowYearTotal(r.m) === null" class="pt-null">–</span>
            <span v-else :class="{ 'pt-neg': rowYearTotal(r.m)! < 0 }">{{ finSigned(rowYearTotal(r.m)) }}</span>
          </td>
          <td v-if="edit" class="pt-c-note l">
            <SchedNoteCell :note="r.note" :edit="true" @save="emit('note', r.rowKey, $event)" />
          </td>
          <td v-if="showFill" class="pt-c-fill" :class="fc('fill')" :style="st.fill">
            <button
              v-if="fillable(r)"
              class="pt-fillbtn"
              title="从数据层派生值填入空格(不覆盖已录)"
              @click="emit('fill', r.rowKey)"
            >填入</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 卡片的第二形态:12 个月 + 本年合计。v-if=cardMode → 宽档连挂都不挂 -->
    <PnlRowDrawer
      v-if="cardMode"
      :row="openRow"
      :group-col="groupCol"
      :year="year"
      @close="openRow = null"
    />
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
.pt-table thead th.pt-fix { z-index:5; }

/* 固定列:sticky、left/right、内沿阴影都由 useWideTable 内联给(.pt-fix 标记仍固定的那几根),这里只管列宽。
   勾选 36 / 分组 118 / 填入 56 是定宽,offset 按它们累加;备注任何宽度都不固定 */
.pt-table td.pt-fix { z-index:2; }
.pt-c-sel { width:36px; min-width:36px; max-width:36px; padding:0 6px; text-align:center; }
.pt-c-grp { width:118px; min-width:118px; max-width:118px; overflow:hidden; text-overflow:ellipsis; font-weight:var(--fw-medium); }
.pt-sub { display:flex; align-items:center; }
.pt-sub-t { min-width:0; overflow:hidden; text-overflow:ellipsis; }   /* 名字可以省略,徽标不让 */
.pt-sub .pt-badge { flex:none; }
.pt-c-ann { font-weight:var(--fw-semibold); }
.pt-c-note { width:150px; min-width:150px; max-width:150px; }
.pt-c-fill { width:56px; min-width:56px; padding:0 6px; text-align:center; }

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
.pt-in { width:92px; height:28px; box-sizing:border-box; border:1px solid var(--border-control); border-radius:7px; padding:0 8px; text-align:right; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12px; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.pt-in:focus { border-color:var(--hue-blue); box-shadow:0 0 0 3px var(--accent-blue); }
.pt-in::placeholder { color:var(--text-disabled); }

.pt-ck { display:block; margin:0 auto; width:14px; height:14px; accent-color:var(--hue-blue); cursor:pointer; }   /* 同 FinReportTable .fin-ck */

/* 派生对照(P2-G):徽标三态 + diff 月橙底 + 填入按钮 */
.pt-badge { display:inline-flex; align-items:center; margin-left:8px; height:18px; padding:0 7px; border-radius:var(--radius-full); font-family:var(--font-sans); font-size:11px; font-weight:var(--fw-medium); white-space:nowrap; vertical-align:1px; }
.pt-badge.ok { background:var(--accent-blue); color:var(--hue-blue); }
.pt-badge.diff { background:var(--warn-bg); color:var(--hue-orange); cursor:help; }
.pt-badge.empty { background:var(--surface-sunken); color:var(--text-muted); }
.pt-table tbody td.pt-cell-diff { background:var(--warn-bg); }   /* 同 fin-tag.edit 先例,置于分带规则后覆盖 */
.pt-fillbtn { height:24px; padding:0 9px; border:1px solid var(--border-control); background:var(--surface-white); border-radius:var(--radius-full); font-family:var(--font-sans); font-size:11.5px; font-weight:var(--fw-medium); color:var(--hue-blue); cursor:pointer; transition:background var(--dur-fast) var(--ease-standard); }
.pt-fillbtn:hover { background:var(--accent-blue); }

/* 空态 */
.pt-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:240px; padding:40px; text-align:center; }
.pt-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.pt-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.pt-empty-s { font-size:13px; color:var(--text-muted); max-width:400px; line-height:1.5; }
</style>
