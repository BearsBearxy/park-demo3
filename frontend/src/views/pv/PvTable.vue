<script setup lang="ts">
// 附表6 逐月发电台账表 — 1:1 from screen-schedule6.jsx 表体段(358-429)。
// 卡片内单滚动;期筛选 Segmented;全部时按 phase 分组(组头小计),否则平铺。
// 列:记账月·发生月·发电总量·电费总额·自消纳电量/金额·上网电量/收益·备注·[编辑态]删除。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Segmented from '@/components/ds/Segmented.vue'
import Button from '@/components/ds/Button.vue'
import SchedNoteCell from '@/components/sched/SchedNoteCell.vue'
import { rowLocked, ROW_LOCK_TIP } from '@/components/sched/reviewLock'
import { phaseTint } from '@/components/sched/tints'
import type { PvPhaseDTO, PvRecordDTO, PvTotal } from '@/types/pv'

const props = defineProps<{
  year: number
  phases: PvPhaseDTO[]
  rows: PvRecordDTO[]
  total: PvTotal
  phase: string          // 'all' | phase id
  edit: boolean
  selectedIds?: Set<number>
  /** 这一年里已审核 / 待审核的月份号(D18,来自 stores/review 的 lockedMonths)。
   *  不传 = 这一屏不受审核约束。行级判据在 sched/reviewLock.ts,四张表共用一份。 */
  lockedMonths?: Set<number>
}>()
const emit = defineEmits<{
  'update:phase': [value: string]
  'add': []
  'delete': [row: PvRecordDTO]
  'note': [row: PvRecordDTO, text: string]
  // 批量删除选择(seed/manual/import 同等可选)
  'toggleSelect': [row: PvRecordDTO]
  'selectAll': [checked: boolean]
}>()

// ── 工具(1:1 from jsx s6kwh/s6yuan/s6kwan/s6mLabel) ──
const kwh = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const yuan = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const kwan = (n: number) => (n / 10000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function mLabel(s: string): string {
  const [y, m] = s.split('-')
  return y + '年' + parseInt(m, 10) + '月'
}

const phaseById = computed(() => Object.fromEntries(props.phases.map(p => [p.id, p])))

// 期别 Segmented:全部 + 各期 short
const segOptions = computed(() => [
  { value: 'all', label: '全部' },
  ...props.phases.map(p => ({ value: p.id, label: p.short })),
])

// 当前期视图行(平铺顺序 = 后端给的 rows 顺序,已按 acctMonth)
const period = computed(() =>
  props.rows.filter(r => props.phase === 'all' || r.phase === props.phase),
)

// 全选状态(当前期视图行可选,seed/manual/import 同等)
const allSelected = computed(() =>
  period.value.length > 0 &&
  period.value.every(r => props.selectedIds?.has(r.id)),
)

const grouped = computed(() => props.phase === 'all')

// 分组:仅含有数据的期,组内按记账月。组头小计来自组内行(jsx 386-389)。
const groups = computed(() =>
  props.phases
    .filter(p => (props.phase === 'all' || p.id === props.phase) && props.rows.some(r => r.phase === p.id))
    .map(p => {
      const rows = props.rows.filter(r => r.phase === p.id)
      return {
        p,
        tint: phaseTint(props.phases.findIndex(pp => pp.id === p.id)),
        rows,
        cnt: rows.length,
        gen: rows.reduce((a, r) => a + r.gen, 0),
        selfKwh: rows.reduce((a, r) => a + r.selfKwh, 0),
        selfAmt: rows.reduce((a, r) => a + r.selfAmt, 0),
        gridKwh: rows.reduce((a, r) => a + r.gridKwh, 0),
        gridAmt: rows.reduce((a, r) => a + r.gridAmt, 0),
      }
    }),
)

// 当前期合计(全部时 = total;某期时取该期分组小计聚合)
const k = computed(() => {
  if (props.phase === 'all') return props.total
  const rs = period.value
  return {
    gen: rs.reduce((a, r) => a + r.gen, 0),
    fee: rs.reduce((a, r) => a + r.fee, 0),
    selfKwh: rs.reduce((a, r) => a + r.selfKwh, 0),
    selfAmt: rs.reduce((a, r) => a + r.selfAmt, 0),
    gridKwh: rs.reduce((a, r) => a + r.gridKwh, 0),
    gridAmt: rs.reduce((a, r) => a + r.gridAmt, 0),
  }
})
</script>

<template>
  <div class="s6-wrap">
    <!-- 期筛选 + 本年条数 -->
    <div class="s6-toolbar">
      <div class="s6-toolbar-l">
        <Segmented :options="segOptions" :model-value="phase" size="sm" @change="emit('update:phase', $event)" />
      </div>
      <div class="s6-toolbar-r">
        <span class="s6-count">本年 <b>{{ period.length }}</b> 条记账</span>
      </div>
    </div>

    <div class="s6-tablewrap">
      <!-- 空年 / 空期引导态(jsx 346-357) -->
      <div v-if="period.length === 0" class="s6-empty">
        <div class="s6-empty-ic"><component :is="iconFor('sun')" :size="24" /></div>
        <div class="s6-empty-t">{{ year }} 年<template v-if="phase !== 'all'">（{{ phaseById[phase]?.short }}）</template>暂无记账记录</div>
        <div class="s6-empty-s">进入编辑模式可手动新增各期光伏的自消纳与余电上网电量、金额;记录自动归入对应年份。</div>
        <Button v-if="edit" variant="filled" @click="emit('add')">
          <template #leading><component :is="iconFor('plus')" :size="16" /></template>
          新增记账
        </Button>
      </div>

      <table v-else class="s6-table">
        <thead>
          <tr>
            <th class="l">
              <span class="s6-acct-head">
                <input
                  v-if="edit"
                  type="checkbox"
                  class="s6-cb"
                  :checked="allSelected"
                  :disabled="period.length === 0"
                  title="全选"
                  @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
                />
                <span class="s6-th-name">记账月份</span>
              </span>
            </th>
            <th class="l"><span class="s6-th-name">发生月份</span></th>
            <th><span class="s6-th"><span class="s6-th-name">发电总量</span><span class="s6-th-unit">kWh</span></span></th>
            <th><span class="s6-th"><span class="s6-th-name">电费总额</span><span class="s6-th-unit">元</span></span></th>
            <th><span class="s6-th"><span class="s6-th-name">自消纳电量</span><span class="s6-th-unit">kWh</span></span></th>
            <th><span class="s6-th"><span class="s6-th-name">自消纳金额</span><span class="s6-th-unit">元</span></span></th>
            <th><span class="s6-th"><span class="s6-th-name">上网电量</span><span class="s6-th-unit">kWh</span></span></th>
            <th><span class="s6-th"><span class="s6-th-name">上网收益</span><span class="s6-th-unit">元</span></span></th>
            <th class="l" style="min-width:150px"><span class="s6-th-name">备注</span></th>
            <th v-if="edit" class="s6-h-act"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in groups" :key="g.p.id">
            <!-- 期别分组头(仅全部模式,jsx 377-393) -->
            <tr v-if="grouped" class="s6-grp-row">
              <td class="l" :colspan="4">
                <span class="s6-grp-inner">
                  <span class="s6-dot" :style="{ background: g.tint }"></span>
                  <span class="s6-grp-name">{{ g.p.name }}</span>
                  <span class="s6-grp-meta">本年 <b>{{ g.cnt }}</b> 月 · 发电 <b>{{ kwan(g.gen) }}万</b> kWh</span>
                </span>
              </td>
              <td class="s6-c-num s6-grp-tot">{{ kwh(g.selfKwh) }}</td>
              <td class="s6-c-num s6-grp-tot">{{ yuan(g.selfAmt) }}</td>
              <td class="s6-c-num s6-grp-tot">{{ kwh(g.gridKwh) }}</td>
              <td class="s6-c-num s6-grp-tot">{{ yuan(g.gridAmt) }}</td>
              <td class="l"></td>
              <td v-if="edit"></td>
            </tr>
            <!-- 明细行(jsx 394-409) -->
            <tr v-for="r in g.rows" :key="r.id" class="s6-row">
              <td class="l s6-c-acct">
                <span class="s6-acct-cell">
                  <input
                    v-if="edit"
                    type="checkbox"
                    class="s6-cb"
                    :checked="selectedIds?.has(r.id) ?? false"
                    title="选中以批量删除"
                    :disabled="rowLocked(lockedMonths, r.acctMonth)"
                    @change="emit('toggleSelect', r)"
                  />
                  <span>{{ mLabel(r.acctMonth) }}</span>
                  <span v-if="r.source === 'manual'" class="s6-userbadge">手动</span>
                  <span v-else-if="r.source === 'import'" class="s6-importbadge">导入</span>
                </span>
              </td>
              <td class="l s6-c-occur">{{ mLabel(r.occurMonth) }}</td>
              <td class="s6-c-num s6-c-kwh">{{ kwh(r.gen) }}</td>
              <td class="s6-c-num s6-c-yuan">{{ yuan(r.fee) }}</td>
              <td class="s6-c-num s6-c-kwh">{{ kwh(r.selfKwh) }}</td>
              <td class="s6-c-num s6-c-yuan">{{ yuan(r.selfAmt) }}</td>
              <td class="s6-c-num s6-c-kwh">{{ kwh(r.gridKwh) }}</td>
              <td class="s6-c-num s6-c-yuan">{{ yuan(r.gridAmt) }}</td>
              <td class="l" style="max-width:220px">
                <SchedNoteCell :note="r.note" :edit="edit && !rowLocked(lockedMonths, r.acctMonth)" @save="emit('note', r, $event)" />
              </td>
              <td v-if="edit">
                <span class="s6-acts">
                  <span v-if="rowLocked(lockedMonths, r.acctMonth)" class="s6-actlock" :title="ROW_LOCK_TIP"><component :is="iconFor('lock')" :size="14" /></span>
                  <button v-else class="s6-actbtn del" title="删除" @click="emit('delete', r)">
                    <component :is="iconFor('trash-2')" :size="15" />
                  </button>
                </span>
              </td>
            </tr>
          </template>
          <tr class="s6-filler" aria-hidden="true"><td :colspan="99"></td></tr>
        </tbody>
        <tfoot>
          <tr>
            <th class="s6-foot-lbl" :colspan="2">{{ year }} 年合计<template v-if="phase !== 'all'">（{{ phaseById[phase]?.short }}）</template></th>
            <th class="s6-c-num">{{ kwh(k.gen) }}</th>
            <th class="s6-c-num">{{ yuan(k.fee) }}</th>
            <th class="s6-c-num">{{ kwh(k.selfKwh) }}</th>
            <th class="s6-c-num">{{ yuan(k.selfAmt) }}</th>
            <th class="s6-c-num">{{ kwh(k.gridKwh) }}</th>
            <th class="s6-c-num">{{ yuan(k.gridAmt) }}</th>
            <th class="l"></th>
            <th v-if="edit"></th>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from screen-schedule6.jsx S6Styles(.s6-toolbar / .s6-table 段) */
.s6-wrap { flex:1 1 auto; display:flex; flex-direction:column; gap:14px; min-height:0; }

.s6-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.s6-toolbar-l { display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-width:0; }
.s6-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.s6-count { font-size:12px; color:var(--text-muted); }
.s6-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }

/* 表:卡片内单滚动,thead/tfoot 粘性 */
.s6-tablewrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.s6-table { border-collapse:separate; border-spacing:0; width:100%; min-width:900px; height:100%; font-family:var(--font-sans); font-size:13px; color:var(--text-primary); }
.s6-table tbody tr.s6-filler td { height:0; padding:0; line-height:0; font-size:0; border:none; background:var(--surface-white); }
.s6-filler { height:100%; }
.s6-table th, .s6-table td { padding:0 14px; box-sizing:border-box; white-space:nowrap; text-align:right; }
.s6-table .l { text-align:left; }

.s6-table thead th { position:sticky; top:0; z-index:3; height:44px; background:var(--surface-white); border-bottom:1px solid var(--border-subtle); vertical-align:middle; }
.s6-th { display:flex; flex-direction:column; gap:1px; align-items:flex-end; }
.s6-th-name { font-size:12px; font-weight:var(--fw-semibold); color:var(--text-secondary); }
.s6-th-unit { font-size: var(--fs-micro); color:var(--text-muted); }
.s6-h-act { width:54px; }

.s6-table tbody td { height:38px; border-bottom:1px solid var(--divider); }
.s6-c-acct { font-weight:var(--fw-medium); }
.s6-c-occur { color:var(--text-muted); font-size:12.5px; }
.s6-c-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.s6-c-kwh { color:var(--text-muted); font-size:12px; }
.s6-c-yuan { color:var(--text-primary); font-size:12.5px; }

.s6-row td { background:var(--surface-white); }
.s6-row:hover td { background:var(--surface-card); }
.s6-acct-head, .s6-acct-cell { display:inline-flex; align-items:center; gap:7px; }
.s6-cb { width:15px; height:15px; flex:0 0 auto; cursor:pointer; accent-color:var(--ink-900); }
.s6-cb:disabled { cursor:not-allowed; opacity:.4; }
.s6-userbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; margin-left:7px; border-radius:var(--radius-full); background:var(--accent-sky); color:var(--hue-blue); font-size:10px; font-weight:var(--fw-semibold); }
.s6-importbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; margin-left:7px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-muted); font-size:10px; font-weight:var(--fw-semibold); }
.s6-acts { display:inline-flex; justify-content:flex-end; opacity:0; }
.s6-row:hover .s6-acts { opacity:1; }
.s6-actbtn { width:26px; height:26px; border:none; background:transparent; border-radius:6px; color:var(--text-disabled); cursor:pointer; display:grid; place-items:center; }
.s6-actbtn:disabled { opacity:.35; cursor:default; }
.s6-actbtn.del:hover { background:rgba(220,38,38,.1); color:var(--hue-red); }

/* 期别分组头 */
.s6-grp-row td { background:var(--surface-sunken); border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); height:42px; }
.s6-grp-inner { display:flex; align-items:center; gap:9px; }
.s6-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
.s6-grp-name { font-weight:var(--fw-semibold); font-size:13.5px; color:var(--text-primary); }
.s6-grp-meta { font-size:11.5px; color:var(--text-muted); }
.s6-grp-meta b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }
.s6-grp-tot { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-weight:var(--fw-semibold); color:var(--text-secondary); font-size:12.5px; }

/* 粘性表尾 · 本年合计(品牌蓝加粗) */
.s6-table tfoot th { position:sticky; bottom:0; z-index:3; height:44px; background:var(--surface-white); border-top:2px solid var(--border-strong); font-weight:var(--fw-semibold); }
.s6-table tfoot .s6-c-num { color:var(--brand-deep); font-size:12.5px; font-weight:var(--fw-semibold); }
.s6-foot-lbl { text-align:left; font-size:13px; color:var(--text-primary); }

/* 空 / 未来年份引导态 */
.s6-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:240px; padding:40px; text-align:center; }
.s6-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.s6-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.s6-empty-s { font-size:13px; color:var(--text-muted); max-width:380px; line-height:1.5; }

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.4 定宽表):列/min-width 一根不动,
   窄了在 .s6-tablewrap(overflow:auto,现成)内横滚;查看态迁移只动工具行与触屏可达性 ── */
@media (max-width: 600px) { /* S */
  /* 工具行收纳(§3.3 修订:允许两行):期筛选 Segmented 与计数各自成行;
     Segmented 比 390 视口还宽时段内横滚兜底,不挤出第三行、不撑破页宽 */
  .s6-toolbar-l { overflow-x:auto; }
}
@media (hover: none) { /* 触屏(§6.1):hover 显形的行内删除钮常显,不可达=功能丢失 */
  .s6-acts { opacity:1; }
  /* 触达热区 ≥36(§6.2):视觉 26px 不变,伪元素向外扩 5px;只在触屏生效,桌面 hover 语义零变化 */
  .s6-actbtn { position:relative; }
  .s6-actbtn::after { content:''; position:absolute; inset:-5px; }
}

/* 审核闸(D18):已审核 / 待审核的月,行上的删除位换成同尺寸锁标 —— 换的是内容不是版面。 */
.s6-actlock { display:inline-flex; align-items:center; justify-content:center;
                  width:26px; height:26px; color:var(--text-muted); cursor:not-allowed; }
</style>
