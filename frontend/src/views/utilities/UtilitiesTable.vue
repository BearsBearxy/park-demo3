<script setup lang="ts">
// 附表13/14 逐月水电台账表 — 1:1 from screen-utilities.jsx 表体(363-434)。flat 逐月,无分组。
// 两行表头:大类(电费/水费)跨3列 + 子列(用电量·基准单价·电费金额 / 用水量·基准单价·水费金额)。
// 列:记账月·所属月·用电量·基准电价·电费金额〔派生〕·用水量·基准水价·水费金额〔派生〕·水电费合计〔派生〕·备注·[编辑态]删除。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import SchedNoteCell from '@/components/sched/SchedNoteCell.vue'
import { rowLocked, ROW_LOCK_TIP } from '@/components/sched/reviewLock'
import Button from '@/components/ds/Button.vue'
import type { OfficeRecordDTO, OfficeTotal } from '@/types/utilities'

const props = defineProps<{
  year: number
  icon: string
  name: string          // 「办公水电」/「三期水电」
  note: string          // 空年引导态文案
  rows: OfficeRecordDTO[]
  total: OfficeTotal
  edit: boolean
  selectedIds?: Set<number>
  /** 这一年里已审核 / 待审核的月份号(D18,来自 stores/review 的 lockedMonths)。
   *  不传 = 这一屏不受审核约束。行级判据在 sched/reviewLock.ts,四张表共用一份。 */
  lockedMonths?: Set<number>
}>()
const emit = defineEmits<{
  add: []
  delete: [row: OfficeRecordDTO]
  note: [row: OfficeRecordDTO, text: string]
  // 批量删除选择(seed/manual/import 同等可选)
  toggleSelect: [row: OfficeRecordDTO]
  selectAll: [checked: boolean]
}>()

// 全选状态(全部行可选)
const allSelected = computed(() =>
  props.rows.length > 0 &&
  props.rows.every(r => props.selectedIds?.has(r.id)),
)

// 工具 1:1 from jsx utMLabel/utNum
function mLabel(s: string): string {
  const [y, m] = s.split('-')
  return y + '年' + parseInt(m, 10) + '月'
}
const num = (n: number, d = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

// 避免在父级解构 props(模板里直接用 props.total 保留响应性)
</script>

<template>
  <div class="ut-tablewrap">
    <!-- 空年引导态(jsx 364-375) -->
    <div v-if="props.rows.length === 0" class="ut-empty">
      <div class="ut-empty-ic"><component :is="iconFor(icon)" :size="24" /></div>
      <div class="ut-empty-t">{{ year }} 年暂无{{ name }}记录</div>
      <div class="ut-empty-s">{{ note }} 进入编辑模式可手动新增;记录自动归入对应年份。</div>
      <Button v-if="edit" variant="filled" @click="emit('add')">
        <template #leading><component :is="iconFor('plus')" :size="16" /></template>
        新增记账
      </Button>
    </div>

    <table v-else class="ut-table">
      <thead>
        <tr class="g">
          <th class="l" rowspan="2">
            <span class="ut-th l">
              <span class="ut-acct-head">
                <input
                  v-if="edit"
                  type="checkbox"
                  class="ut-cb"
                  :checked="allSelected"
                  :disabled="props.rows.length === 0"
                  title="全选"
                  @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
                />
                <span class="ut-th-name">记账月</span>
              </span>
            </span>
          </th>
          <th class="l" rowspan="2"><span class="ut-th l"><span class="ut-th-name">所属月</span></span></th>
          <th class="ut-grp-elec ut-cap" colspan="3">电费</th>
          <th class="ut-grp-water ut-cap" colspan="3">水费</th>
          <th rowspan="2" class="ut-cap"><span class="ut-th"><span class="ut-th-name">水电费合计</span><span class="ut-th-unit">元</span></span></th>
          <th class="l ut-h-note" rowspan="2"><span class="ut-th l"><span class="ut-th-name">备注</span></span></th>
          <th v-if="edit" class="ut-h-act" rowspan="2"></th>
        </tr>
        <tr class="s">
          <th class="ut-cap"><span class="ut-th"><span class="ut-th-name">用电量</span><span class="ut-th-unit">千瓦</span></span></th>
          <th><span class="ut-th"><span class="ut-th-name">基准单价</span><span class="ut-th-unit">元/千瓦</span></span></th>
          <th><span class="ut-th"><span class="ut-th-name">电费金额</span><span class="ut-th-unit">元</span></span></th>
          <th class="ut-cap"><span class="ut-th"><span class="ut-th-name">用水量</span><span class="ut-th-unit">吨</span></span></th>
          <th><span class="ut-th"><span class="ut-th-name">基准单价</span><span class="ut-th-unit">元/吨</span></span></th>
          <th><span class="ut-th"><span class="ut-th-name">水费金额</span><span class="ut-th-unit">元</span></span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in props.rows" :key="r.id" class="ut-row">
          <td class="l ut-c-acct">
            <span class="ut-acct-cell">
              <input
                v-if="edit"
                type="checkbox"
                class="ut-cb"
                :checked="selectedIds?.has(r.id) ?? false"
                title="选中以批量删除"
                :disabled="rowLocked(lockedMonths, r.acctMonth)"
                    @change="emit('toggleSelect', r)"
              />
              <span>{{ mLabel(r.acctMonth) }}</span>
              <span v-if="r.source === 'manual'" class="ut-userbadge">手动</span>
            </span>
          </td>
          <td class="l ut-c-belong">{{ mLabel(r.belongMonth) }}</td>
          <td class="ut-c-num ut-c-qty ut-cap-cell">{{ num(r.elecQty, 0) }}</td>
          <td class="ut-c-num ut-c-price">{{ num(r.elecPrice, 4) }}</td>
          <td class="ut-c-num ut-c-amt">{{ num(r.elecAmt) }}</td>
          <td class="ut-c-num ut-c-qty ut-cap-cell">{{ num(r.waterQty, 0) }}</td>
          <td class="ut-c-num ut-c-price">{{ num(r.waterPrice, 4) }}</td>
          <td class="ut-c-num ut-c-amt">{{ num(r.waterAmt) }}</td>
          <td class="ut-c-num ut-c-total ut-cap-cell">{{ num(r.total) }}</td>
          <td class="ut-c-note" style="max-width:220px">
            <SchedNoteCell :note="r.note" :edit="edit && !rowLocked(lockedMonths, r.acctMonth)" @save="emit('note', r, $event)" />
          </td>
          <td v-if="edit">
            <span class="ut-acts">
              <span v-if="rowLocked(lockedMonths, r.acctMonth)" class="ut-actlock" :title="ROW_LOCK_TIP"><component :is="iconFor('lock')" :size="14" /></span>
                  <button v-else class="ut-actbtn del" title="删除" @click="emit('delete', r)">
                <component :is="iconFor('trash-2')" :size="15" />
              </button>
            </span>
          </td>
        </tr>
        <tr class="ut-filler" aria-hidden="true"><td :colspan="99"></td></tr>
      </tbody>
      <tfoot>
        <tr>
          <th class="ut-foot-lbl" colspan="2">{{ year }} 年合计</th>
          <th class="ut-c-num ut-cap-cell">{{ num(props.total.elecQty, 0) }}</th>
          <th></th>
          <th class="ut-c-num">{{ num(props.total.elecAmt) }}</th>
          <th class="ut-c-num ut-cap-cell">{{ num(props.total.waterQty, 0) }}</th>
          <th></th>
          <th class="ut-c-num">{{ num(props.total.waterAmt) }}</th>
          <th class="ut-c-num ut-cap-cell">{{ num(props.total.total) }}</th>
          <th class="l"></th>
          <th v-if="edit"></th>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* 1:1 from screen-utilities.jsx UtStyles(.ut-table 段,44-93) */
.ut-tablewrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.ut-table { border-collapse:separate; border-spacing:0; width:100%; min-width:900px; height:100%; font-family:var(--font-sans); font-size:13px; color:var(--text-primary); }
.ut-table tbody tr.ut-filler td { height:0; padding:0; line-height:0; font-size:0; border:none; background:var(--surface-white); }
.ut-filler { height:100%; }
.ut-table th, .ut-table td { padding:0 14px; box-sizing:border-box; white-space:nowrap; text-align:right; }
.ut-table .l { text-align:left; }

/* 两行表头:大类跨列 + 子列 */
.ut-table thead th { position:sticky; background:var(--surface-white); border-bottom:1px solid var(--border-subtle); vertical-align:middle; }
.ut-table thead tr.g th { top:0; z-index:4; height:30px; font-size:11px; font-weight:var(--fw-semibold); color:var(--text-muted); border-bottom:1px solid var(--divider); }
.ut-table thead tr.s th { top:30px; z-index:3; height:38px; }
.ut-th { display:flex; flex-direction:column; gap:1px; align-items:flex-end; }
.ut-th.l { align-items:flex-start; }
.ut-th-name { font-size:12px; font-weight:var(--fw-semibold); color:var(--text-secondary); }
.ut-th-unit { font-size: var(--fs-micro); color:var(--text-muted); }
.ut-grp-elec { background:var(--accent-blue) !important; color:var(--hue-blue) !important; }
.ut-grp-water { background:var(--accent-cyan) !important; color:var(--hue-cyan) !important; }
.ut-cap { box-shadow:none; }
.ut-h-note { min-width:150px; }
.ut-h-act { width:48px; }

.ut-table tbody td { height:38px; border-bottom:1px solid var(--divider); }
.ut-c-acct { font-weight:var(--fw-medium); }
.ut-c-belong { color:var(--text-muted); font-size:12.5px; }
.ut-c-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12.5px; }
.ut-c-qty { color:var(--text-secondary); }
.ut-c-price { color:var(--text-muted); font-size:12px; }
.ut-c-amt { color:var(--text-primary); }
.ut-c-total { font-weight:var(--fw-semibold); color:var(--text-primary); }
.ut-c-note { color:var(--text-muted); font-size:12px; max-width:220px; overflow:hidden; text-overflow:ellipsis; text-align:left; }
.ut-cap-cell { box-shadow:none; }

.ut-row td { background:var(--surface-white); }
.ut-row:hover td { background:var(--surface-card); }
.ut-acct-head, .ut-acct-cell { display:inline-flex; align-items:center; gap:7px; }
.ut-cb { width:15px; height:15px; flex:0 0 auto; cursor:pointer; accent-color:var(--ink-900); }
.ut-cb:disabled { cursor:not-allowed; opacity:.4; }
.ut-userbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; margin-left:7px; border-radius:var(--radius-full); background:var(--accent-sky); color:var(--hue-blue); font-size:10px; font-weight:var(--fw-semibold); }
.ut-acts { display:inline-flex; justify-content:flex-end; opacity:0; }
.ut-row:hover .ut-acts { opacity:1; }
.ut-actbtn { width:26px; height:26px; border:none; background:transparent; border-radius:6px; color:var(--text-disabled); cursor:pointer; display:grid; place-items:center; }
.ut-actbtn:disabled { opacity:.35; cursor:default; }
.ut-actbtn.del:hover { background:rgba(220,38,38,.1); color:var(--hue-red); }

/* 粘性表尾 · 本年合计(品牌蓝加粗) */
.ut-table tfoot th { position:sticky; bottom:0; z-index:3; height:44px; background:var(--surface-white); border-top:2px solid var(--border-strong); font-weight:var(--fw-semibold); }
.ut-table tfoot .ut-c-num { color:var(--brand-deep); font-weight:var(--fw-semibold); }
.ut-foot-lbl { text-align:left; font-size:13px; color:var(--text-primary); }

/* 空年引导态 */
.ut-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:240px; padding:40px; text-align:center; }
.ut-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.ut-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.ut-empty-s { font-size:13px; color:var(--text-muted); max-width:400px; line-height:1.5; }

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.4 定宽表):列/min-width 一根不动,
   窄了在 .ut-tablewrap(overflow:auto,现成)内横滚;查看态迁移只动触屏可达性 ── */
@media (hover: none) { /* 触屏(§6.1):hover 显形的行内删除钮常显,不可达=功能丢失 */
  .ut-acts { opacity:1; }
  /* 触达热区 ≥36(§6.2):视觉 26px 不变,伪元素向外扩 5px;只在触屏生效,桌面 hover 语义零变化 */
  .ut-actbtn { position:relative; }
  .ut-actbtn::after { content:''; position:absolute; inset:-5px; }
}

/* 审核闸(D18):已审核 / 待审核的月,行上的删除位换成同尺寸锁标 —— 换的是内容不是版面。 */
.ut-actlock { display:inline-flex; align-items:center; justify-content:center;
                  width:26px; height:26px; color:var(--text-muted); cursor:not-allowed; }
</style>
