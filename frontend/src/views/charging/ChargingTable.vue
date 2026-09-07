<script setup lang="ts">
// 附表7/8 逐月充电台账表 — 1:1 from screen-charging.jsx 表体段(336-425)。
// 卡片内单滚动;类别筛选 Segmented;全部时按 cat 分组(组头小计),否则平铺。
// 列:记账月·充电电量·手续费及服务费·充电成本·利润〔派生,正常色,负值转红〕·备注·[编辑态]删除。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Segmented from '@/components/ds/Segmented.vue'
import Button from '@/components/ds/Button.vue'
import SchedNoteCell from '@/components/sched/SchedNoteCell.vue'
import { rowLocked, ROW_LOCK_TIP } from '@/components/sched/reviewLock'
import type { ChargingCatDTO, ChargingRecordDTO, ChargingTotal } from '@/types/charging'

const props = defineProps<{
  year: number
  icon: string
  cats: ChargingCatDTO[]
  rows: ChargingRecordDTO[]
  total: ChargingTotal
  cat: string            // 'all' | cat id
  edit: boolean
  selectedIds?: Set<number>
  /** 这一年里已审核 / 待审核的月份号(D18,来自 stores/review 的 lockedMonths)。
   *  不传 = 这一屏不受审核约束。行级判据在 sched/reviewLock.ts,四张表共用一份。 */
  lockedMonths?: Set<number>
}>()
const emit = defineEmits<{
  'update:cat': [value: string]
  'add': []
  'delete': [row: ChargingRecordDTO]
  'note': [row: ChargingRecordDTO, text: string]
  // 批量删除选择(seed/manual/import 同等可选)
  'toggleSelect': [row: ChargingRecordDTO]
  'selectAll': [checked: boolean]
}>()

// cat.tint 是名(slate/blue/cyan)→ CSS var,对齐 jsx CH_TINT(19)
const TINT: Record<string, string> = {
  slate: 'var(--fill-slate)', blue: 'var(--fill-blue)', cyan: 'var(--fill-cyan)',
}
const tintOf = (t: string | null) => TINT[t ?? ''] ?? 'var(--fill-slate)'

// ── 工具(1:1 from jsx chKwh/chYuan/chKwan/chMLabel) ──
const kwh = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const yuan = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const kwan = (n: number) => (n / 10000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function mLabel(s: string): string {
  const [y, m] = s.split('-')
  return y + '年' + parseInt(m, 10) + '月'
}

const catById = computed(() => Object.fromEntries(props.cats.map(c => [c.catId, c])))

// 类别 Segmented:全部 + 各类别 short
const segOptions = computed(() => [
  { value: 'all', label: '全部' },
  ...props.cats.map(c => ({ value: c.catId, label: c.short })),
])

// 当前类别视图行(平铺顺序 = 后端给的 rows 顺序,已按 acctMonth)
const period = computed(() =>
  props.rows.filter(r => props.cat === 'all' || r.cat === props.cat),
)

// 全选状态(当前类别视图行可选,seed/manual/import 同等)
const allSelected = computed(() =>
  period.value.length > 0 &&
  period.value.every(r => props.selectedIds?.has(r.id)),
)

const grouped = computed(() => props.cat === 'all')

// 分组:仅含有数据的类别,组内沿用后端顺序。组头小计来自组内行(jsx 372-389)。
const groups = computed(() =>
  props.cats
    .filter(c => (props.cat === 'all' || c.catId === props.cat) && props.rows.some(r => r.cat === c.catId))
    .map(c => {
      const rows = props.rows.filter(r => r.cat === c.catId)
      return {
        c,
        rows,
        cnt: rows.length,
        kwh: rows.reduce((a, r) => a + r.kwh, 0),
        fee: rows.reduce((a, r) => a + r.fee, 0),
        cost: rows.reduce((a, r) => a + r.cost, 0),
        profit: rows.reduce((a, r) => a + r.profit, 0),
      }
    }),
)

// 当前类别合计(全部时 = total;某类别时取该类别行聚合)
const k = computed(() => {
  if (props.cat === 'all') return props.total
  const rs = period.value
  return {
    kwh: rs.reduce((a, r) => a + r.kwh, 0),
    fee: rs.reduce((a, r) => a + r.fee, 0),
    cost: rs.reduce((a, r) => a + r.cost, 0),
    profit: rs.reduce((a, r) => a + r.profit, 0),
  }
})
</script>

<template>
  <div class="ch-wrap">
    <!-- 类别筛选 + 本年条数 -->
    <div class="ch-toolbar">
      <div class="ch-toolbar-l">
        <Segmented :options="segOptions" :model-value="cat" size="sm" @change="emit('update:cat', $event)" />
      </div>
      <div class="ch-toolbar-r">
        <span class="ch-count">本年 <b>{{ period.length }}</b> 条记账</span>
      </div>
    </div>

    <div class="ch-tablewrap">
      <!-- 空年 / 空类别引导态(jsx 346-357) -->
      <div v-if="period.length === 0" class="ch-empty">
        <div class="ch-empty-ic"><component :is="iconFor(icon)" :size="24" /></div>
        <div class="ch-empty-t">{{ year }} 年<template v-if="cat !== 'all'">（{{ catById[cat]?.short }}）</template>暂无记账记录</div>
        <div class="ch-empty-s">进入编辑模式可手动新增各充电桩类别的电量、手续费及服务费与成本;记录自动归入对应年份。</div>
        <Button v-if="edit" variant="filled" @click="emit('add')">
          <template #leading><component :is="iconFor('plus')" :size="16" /></template>
          新增记账
        </Button>
      </div>

      <table v-else class="ch-table">
        <thead>
          <tr>
            <th class="l">
              <span class="ch-acct-head">
                <input
                  v-if="edit"
                  type="checkbox"
                  class="ch-cb"
                  :checked="allSelected"
                  :disabled="period.length === 0"
                  title="全选"
                  @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
                />
                <span class="ch-th-name">记账月份</span>
              </span>
            </th>
            <th><span class="ch-th"><span class="ch-th-name">充电电量</span><span class="ch-th-unit">千瓦时</span></span></th>
            <th><span class="ch-th"><span class="ch-th-name">手续费及服务费</span><span class="ch-th-unit">元</span></span></th>
            <th><span class="ch-th"><span class="ch-th-name">充电成本</span><span class="ch-th-unit">元</span></span></th>
            <th><span class="ch-th"><span class="ch-th-name">利润</span><span class="ch-th-unit">元</span></span></th>
            <th class="l" style="min-width:150px"><span class="ch-th-name">备注</span></th>
            <th v-if="edit" class="ch-h-act"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in groups" :key="g.c.catId">
            <!-- 类别分组头(仅全部模式,jsx 376-391) -->
            <tr v-if="grouped" class="ch-grp-row">
              <td class="l" :colspan="2">
                <span class="ch-grp-inner">
                  <span class="ch-dot" :style="{ background: tintOf(g.c.tint) }"></span>
                  <span class="ch-grp-name">{{ g.c.name }}</span>
                  <span class="ch-grp-meta">本年 <b>{{ g.cnt }}</b> 月 · 电量 <b>{{ kwan(g.kwh) }}万</b> kWh</span>
                </span>
              </td>
              <td class="ch-c-num ch-grp-tot">{{ yuan(g.fee) }}</td>
              <td class="ch-c-num ch-grp-tot">{{ yuan(g.cost) }}</td>
              <td class="ch-c-num ch-grp-tot" :style="{ color: g.profit < 0 ? 'var(--hue-red)' : 'var(--hue-blue)' }">{{ yuan(g.profit) }}</td>
              <td class="l"></td>
              <td v-if="edit"></td>
            </tr>
            <!-- 明细行(jsx 392-408) -->
            <tr v-for="r in g.rows" :key="r.id" class="ch-row">
              <td class="l ch-c-acct">
                <span class="ch-acct-cell">
                  <input
                    v-if="edit"
                    type="checkbox"
                    class="ch-cb"
                    :checked="selectedIds?.has(r.id) ?? false"
                    title="选中以批量删除"
                    :disabled="rowLocked(lockedMonths, r.acctMonth)"
                    @change="emit('toggleSelect', r)"
                  />
                  <span>{{ mLabel(r.acctMonth) }}</span>
                  <span v-if="r.source === 'manual'" class="ch-userbadge">手动</span>
                  <span v-else-if="r.source === 'import'" class="ch-importbadge">导入</span>
                </span>
              </td>
              <td class="ch-c-num ch-c-kwh">{{ kwh(r.kwh) }}</td>
              <td class="ch-c-num ch-c-yuan">{{ yuan(r.fee) }}</td>
              <td class="ch-c-num ch-c-yuan">{{ yuan(r.cost) }}</td>
              <td class="ch-c-num ch-c-profit" :class="{ neg: r.profit < 0 }">{{ yuan(r.profit) }}</td>
              <td class="l" style="max-width:220px">
                <SchedNoteCell :note="r.note" :edit="edit && !rowLocked(lockedMonths, r.acctMonth)" @save="emit('note', r, $event)" />
              </td>
              <td v-if="edit">
                <span class="ch-acts">
                  <span v-if="rowLocked(lockedMonths, r.acctMonth)" class="ch-actlock" :title="ROW_LOCK_TIP"><component :is="iconFor('lock')" :size="14" /></span>
                  <button v-else class="ch-actbtn del" title="删除" @click="emit('delete', r)">
                    <component :is="iconFor('trash-2')" :size="15" />
                  </button>
                </span>
              </td>
            </tr>
          </template>
          <tr class="ch-filler" aria-hidden="true"><td :colspan="99"></td></tr>
        </tbody>
        <tfoot>
          <tr>
            <th class="ch-foot-lbl">{{ year }} 年合计<template v-if="cat !== 'all'">（{{ catById[cat]?.short }}）</template></th>
            <th class="ch-c-num">{{ kwh(k.kwh) }}</th>
            <th class="ch-c-num">{{ yuan(k.fee) }}</th>
            <th class="ch-c-num">{{ yuan(k.cost) }}</th>
            <th class="ch-c-num ch-foot-profit" :style="k.profit < 0 ? { color: 'var(--hue-red)' } : undefined">{{ yuan(k.profit) }}</th>
            <th class="l"></th>
            <th v-if="edit"></th>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from screen-charging.jsx ChStyles(.ch-toolbar / .ch-table 段) */
.ch-wrap { flex:1 1 auto; display:flex; flex-direction:column; gap:14px; min-height:0; }

.ch-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.ch-toolbar-l { display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-width:0; }
.ch-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.ch-count { font-size:12px; color:var(--text-muted); }
.ch-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }

/* 表:卡片内单滚动,thead/tfoot 粘性 */
.ch-tablewrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.ch-table { border-collapse:separate; border-spacing:0; width:100%; min-width:880px; height:100%; font-family:var(--font-sans); font-size:13px; color:var(--text-primary); }
.ch-table tbody tr.ch-filler td { height:0; padding:0; line-height:0; font-size:0; border:none; background:var(--surface-white); }
.ch-filler { height:100%; }
.ch-table th, .ch-table td { padding:0 14px; box-sizing:border-box; white-space:nowrap; text-align:right; }
.ch-table .l { text-align:left; }

.ch-table thead th { position:sticky; top:0; z-index:3; height:44px; background:var(--surface-white); border-bottom:1px solid var(--border-subtle); vertical-align:middle; }
.ch-th { display:flex; flex-direction:column; gap:1px; align-items:flex-end; }
.ch-th-name { font-size:12px; font-weight:var(--fw-semibold); color:var(--text-secondary); }
.ch-th-unit { font-size: var(--fs-micro); color:var(--text-muted); }
.ch-h-act { width:54px; }

.ch-table tbody td { height:38px; border-bottom:1px solid var(--divider); }
.ch-c-acct { font-weight:var(--fw-medium); }
.ch-c-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.ch-c-kwh { color:var(--text-secondary); font-size:12.5px; }
.ch-c-yuan { color:var(--text-primary); font-size:12.5px; }
.ch-c-profit { font-weight:var(--fw-semibold); font-size:12.5px; color:var(--hue-blue); }
.ch-c-profit.neg { color:var(--hue-red); }

.ch-row td { background:var(--surface-white); }
.ch-row:hover td { background:var(--surface-card); }
.ch-acct-head, .ch-acct-cell { display:inline-flex; align-items:center; gap:7px; }
.ch-cb { width:15px; height:15px; flex:0 0 auto; cursor:pointer; accent-color:var(--ink-900); }
.ch-cb:disabled { cursor:not-allowed; opacity:.4; }
.ch-userbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; margin-left:7px; border-radius:var(--radius-full); background:var(--accent-sky); color:var(--hue-blue); font-size:10px; font-weight:var(--fw-semibold); }
.ch-importbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; margin-left:7px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-muted); font-size:10px; font-weight:var(--fw-semibold); }
.ch-acts { display:inline-flex; justify-content:flex-end; opacity:0; }
.ch-row:hover .ch-acts { opacity:1; }
.ch-actbtn { width:26px; height:26px; border:none; background:transparent; border-radius:6px; color:var(--text-disabled); cursor:pointer; display:grid; place-items:center; }
.ch-actbtn:disabled { opacity:.35; cursor:default; }
.ch-actbtn.del:hover { background:rgba(220,38,38,.1); color:var(--hue-red); }

/* 类别分组头 */
.ch-grp-row td { background:var(--surface-sunken); border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); height:42px; }
.ch-grp-inner { display:flex; align-items:center; gap:9px; }
.ch-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
.ch-grp-name { font-weight:var(--fw-semibold); font-size:13.5px; color:var(--text-primary); }
.ch-grp-meta { font-size:11.5px; color:var(--text-muted); }
.ch-grp-meta b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }
.ch-grp-tot { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-weight:var(--fw-semibold); color:var(--text-secondary); font-size:12.5px; }

/* 粘性表尾 · 本年合计(品牌蓝加粗) */
.ch-table tfoot th { position:sticky; bottom:0; z-index:3; height:44px; background:var(--surface-white); border-top:2px solid var(--border-strong); font-weight:var(--fw-semibold); }
.ch-table tfoot .ch-c-num { color:var(--brand-deep); font-size:12.5px; font-weight:var(--fw-semibold); }
.ch-foot-lbl { text-align:left; font-size:13px; color:var(--text-primary); }

/* 空 / 未来年份引导态 */
.ch-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:240px; padding:40px; text-align:center; }
.ch-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.ch-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.ch-empty-s { font-size:13px; color:var(--text-muted); max-width:380px; line-height:1.5; }

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.4 定宽表):列/min-width 一根不动,
   窄了在 .ch-tablewrap(overflow:auto,现成)内横滚;查看态迁移只动工具行与触屏可达性 ── */
@media (max-width: 600px) { /* S */
  /* 工具行收纳(§3.3 修订:允许两行):类别 Segmented 与计数各自成行;
     Segmented 比 390 视口还宽时段内横滚兜底,不挤出第三行、不撑破页宽 */
  .ch-toolbar-l { overflow-x:auto; }
}
@media (hover: none) { /* 触屏(§6.1):hover 显形的行内删除钮常显,不可达=功能丢失 */
  .ch-acts { opacity:1; }
  /* 触达热区 ≥36(§6.2):视觉 26px 不变,伪元素向外扩 5px;只在触屏生效,桌面 hover 语义零变化 */
  .ch-actbtn { position:relative; }
  .ch-actbtn::after { content:''; position:absolute; inset:-5px; }
}

/* 审核闸(D18):已审核 / 待审核的月,行上的删除位换成同尺寸锁标 —— 换的是内容不是版面。 */
.ch-actlock { display:inline-flex; align-items:center; justify-content:center;
                  width:26px; height:26px; color:var(--text-muted); cursor:not-allowed; }
</style>
