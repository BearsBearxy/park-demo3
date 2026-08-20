<script setup lang="ts">
// 附表11 逐月电费台账表 — 1:1 from screen-schedule11.jsx 表体段(391-549)。
// 卡片内单滚动;右上 type Segmented 切 energy/basic(两类型列集不同,见 jsx 416-444)。
// 按 phase 分组(组头小计 + tfoot 本年合计);energy 时段有色点(峰红/平蓝/谷青)。
// 派生 amount/tax/total 后端下发,前端只回显;manual 角标、seed 锁。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Segmented from '@/components/ds/Segmented.vue'
import Button from '@/components/ds/Button.vue'
import SchedNoteCell from '@/components/sched/SchedNoteCell.vue'
import { phaseTint } from '@/components/sched/tints'
import type { ElecPhaseDTO, ElecRecordDTO, ElecTotal } from '@/types/elec'

const props = defineProps<{
  year: number
  type: 'energy' | 'basic'
  phases: ElecPhaseDTO[]
  rows: ElecRecordDTO[]
  total: ElecTotal
  edit: boolean
  selectedIds?: Set<number>
}>()
const emit = defineEmits<{
  'switch-type': [value: string]
  'add': []
  'edit': []
  'delete': [row: ElecRecordDTO]
  'note': [row: ElecRecordDTO, text: string]
  // 批量删除选择(seed/manual/import 同等可选)
  'toggleSelect': [row: ElecRecordDTO]
  'selectAll': [checked: boolean]
}>()

// 全选状态(本类全部行可选,seed/manual/import 同等)
const allSelected = computed(() =>
  props.rows.length > 0 && props.rows.every(r => props.selectedIds?.has(r.id)),
)

// ── 工具(1:1 from jsx eNum/eMLabel)──
const num = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const wan = (n: number) => '¥' + (n / 10000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '万'
function mLabel(s: string): string {
  const [y, m] = s.split('-')
  return y + '年' + parseInt(m, 10) + '月'
}
// 时段色点(jsx E_PERIOD_TINT;period 是显示口径,不进 DTO)
const periodTint = (p: string | null): string =>
  p === '峰' ? 'var(--hue-red)' : p === '平' ? 'var(--hue-blue)' : p === '谷' ? 'var(--hue-cyan)' : 'var(--text-muted)'

const energy = computed(() => props.type === 'energy')

const typeOptions = [
  { value: 'energy', label: '电量电费' },
  { value: 'basic', label: '基本电费' },
]

// 分组:仅含数据的期,组内顺序 = 后端 rows 顺序(已按 acctMonth 升序)。
// 组头小计来自组内行(jsx 449-479);base = energy:qty / basic:demand。
const groups = computed(() =>
  props.phases
    .filter(p => props.rows.some(r => r.phase === p.id))
    .map(p => {
      const rows = props.rows.filter(r => r.phase === p.id)
      return {
        p,
        tint: phaseTint(props.phases.findIndex(pp => pp.id === p.id)),
        rows,
        cnt: rows.length,
        base: rows.reduce((a, r) => a + (energy.value ? (r.qty ?? 0) : (r.demand ?? 0)), 0),
        amount: rows.reduce((a, r) => a + r.amount, 0),
        tax: rows.reduce((a, r) => a + r.tax, 0),
        total: rows.reduce((a, r) => a + r.total, 0),
      }
    }),
)
</script>

<template>
  <div class="e11-wrap">
    <!-- type 切换 + 本年本类条数(jsx 391-398) -->
    <div class="e11-toolbar">
      <div class="e11-toolbar-l">
        <Segmented :options="typeOptions" :model-value="type" size="sm" @change="emit('switch-type', $event)" />
      </div>
      <div class="e11-toolbar-r">
        <span class="e11-count">本年本类 <b>{{ rows.length }}</b> 条</span>
      </div>
    </div>

    <div class="e11-tablewrap">
      <!-- 空年 / 空类引导态(jsx 401-412) -->
      <div v-if="rows.length === 0" class="e11-empty">
        <div class="e11-empty-ic"><component :is="iconFor(energy ? 'zap' : 'gauge')" :size="24" /></div>
        <div class="e11-empty-t">{{ year }} 年暂无{{ energy ? '电量电费' : '基本电费' }}记录</div>
        <div class="e11-empty-s">进入编辑模式可手动新增各期对外电费进项发票;记录自动归入对应年份与费用类型。</div>
        <Button v-if="edit" variant="filled" @click="emit('add')">
          <template #leading><component :is="iconFor('plus')" :size="16" /></template>
          新增记账
        </Button>
        <Button v-else variant="filled" @click="emit('edit')">
          <template #leading><component :is="iconFor('pencil')" :size="16" /></template>
          编辑表格
        </Button>
      </div>

      <!-- ── 电量电费(energy) ── -->
      <table v-else-if="energy" class="e11-table">
        <thead>
          <tr>
            <th class="l">
              <span class="e11-acct-head">
                <input
                  v-if="edit"
                  type="checkbox"
                  class="e11-cb"
                  :checked="allSelected"
                  :disabled="rows.length === 0"
                  title="全选"
                  @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
                />
                <span class="e11-th-name">记账月份</span>
              </span>
            </th>
            <th class="l"><span class="e11-th-name">开票日期</span></th>
            <th class="c"><span class="e11-th-name">时段</span></th>
            <th class="l"><span class="e11-th-name">用电类别</span></th>
            <th><span class="e11-th"><span class="e11-th-name">电量</span><span class="e11-th-unit">度</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">不含税单价</span><span class="e11-th-unit">元</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">不含税金额</span><span class="e11-th-unit">元</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">税率</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">税额</span><span class="e11-th-unit">元</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">价税合计</span><span class="e11-th-unit">元</span></span></th>
            <th class="l" style="min-width:150px"><span class="e11-th-name">备注</span></th>
            <th v-if="edit" class="e11-h-act"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in groups" :key="g.p.id">
            <!-- 期别分组头(jsx 449-480) -->
            <tr class="e11-grp-row">
              <td class="l" :colspan="4">
                <span class="e11-grp-inner">
                  <span class="e11-dot" :style="{ background: g.tint }"></span>
                  <span class="e11-grp-name">{{ g.p.name }}</span>
                  <span class="e11-grp-meta">本年 <b>{{ g.cnt }}</b> 条 · 价税合计 <b>{{ wan(g.total) }}</b></span>
                </span>
              </td>
              <td class="e11-c-num e11-grp-tot">{{ num(g.base, 0) }}</td>
              <td></td>
              <td class="e11-c-num e11-grp-tot">{{ num(g.amount) }}</td>
              <td></td>
              <td class="e11-c-num e11-grp-tot">{{ num(g.tax) }}</td>
              <td class="e11-c-num e11-grp-tot e11-c-total">{{ num(g.total) }}</td>
              <td class="l"></td>
              <td v-if="edit"></td>
            </tr>
            <!-- 明细行(jsx 481-498) -->
            <tr v-for="r in g.rows" :key="r.id" class="e11-row">
              <td class="l e11-c-acct">
                <span class="e11-acct-cell">
                  <input
                    v-if="edit"
                    type="checkbox"
                    class="e11-cb"
                    :checked="selectedIds?.has(r.id) ?? false"
                    title="选中以批量删除"
                    @change="emit('toggleSelect', r)"
                  />
                  <span>{{ mLabel(r.acctMonth) }}</span>
                  <span v-if="r.source === 'manual'" class="e11-userbadge">手动</span>
                  <span v-else-if="r.source === 'import'" class="e11-importbadge">导入</span>
                </span>
              </td>
              <td class="l e11-c-inv">{{ r.invDate }}</td>
              <td class="c"><span class="e11-pchip"><span class="e11-pdot" :style="{ background: periodTint(r.period) }"></span>{{ r.period }}</span></td>
              <td class="l"><span class="e11-cat">{{ r.cat }}</span></td>
              <td class="e11-c-num e11-c-qty">{{ num(r.qty ?? 0, 0) }}</td>
              <td class="e11-c-num e11-c-price">{{ num(r.price, 4) }}</td>
              <td class="e11-c-num e11-c-amt">{{ num(r.amount) }}</td>
              <td class="e11-c-num e11-c-tax">{{ (r.rate * 100).toFixed(0) }}%</td>
              <td class="e11-c-num e11-c-tax">{{ num(r.tax) }}</td>
              <td class="e11-c-num e11-c-total">{{ num(r.total) }}</td>
              <td class="l" style="max-width:220px">
                <SchedNoteCell :note="r.note" :edit="edit" @save="emit('note', r, $event)" />
              </td>
              <td v-if="edit">
                <span class="e11-acts">
                  <button class="e11-actbtn del" title="删除" @click="emit('delete', r)">
                    <component :is="iconFor('trash-2')" :size="15" />
                  </button>
                </span>
              </td>
            </tr>
          </template>
          <tr class="e11-filler" aria-hidden="true"><td :colspan="99"></td></tr>
        </tbody>
        <tfoot>
          <tr>
            <th class="e11-foot-lbl" :colspan="4">{{ year }} 年合计 · 电量电费</th>
            <th class="e11-c-num">{{ num(total.qty, 0) }}</th>
            <th></th>
            <th class="e11-c-num">{{ num(total.amount) }}</th>
            <th></th>
            <th class="e11-c-num">{{ num(total.tax) }}</th>
            <th class="e11-c-num">{{ num(total.total) }}</th>
            <th class="l"></th>
            <th v-if="edit"></th>
          </tr>
        </tfoot>
      </table>

      <!-- ── 基本电费(basic) ── -->
      <table v-else class="e11-table">
        <thead>
          <tr>
            <th class="l">
              <span class="e11-acct-head">
                <input
                  v-if="edit"
                  type="checkbox"
                  class="e11-cb"
                  :checked="allSelected"
                  :disabled="rows.length === 0"
                  title="全选"
                  @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
                />
                <span class="e11-th-name">记账月份</span>
              </span>
            </th>
            <th class="l"><span class="e11-th-name">开票日期</span></th>
            <th><span class="e11-th"><span class="e11-th-name">计费需量</span><span class="e11-th-unit">kVA</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">单价</span><span class="e11-th-unit">元/kVA·月</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">基本用电费</span><span class="e11-th-unit">元</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">税率</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">税额</span><span class="e11-th-unit">元</span></span></th>
            <th><span class="e11-th"><span class="e11-th-name">价税合计-基本用电</span><span class="e11-th-unit">元</span></span></th>
            <th class="l" style="min-width:150px"><span class="e11-th-name">备注</span></th>
            <th v-if="edit" class="e11-h-act"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in groups" :key="g.p.id">
            <tr class="e11-grp-row">
              <td class="l" :colspan="2">
                <span class="e11-grp-inner">
                  <span class="e11-dot" :style="{ background: g.tint }"></span>
                  <span class="e11-grp-name">{{ g.p.name }}</span>
                  <span class="e11-grp-meta">本年 <b>{{ g.cnt }}</b> 条 · 价税合计 <b>{{ wan(g.total) }}</b></span>
                </span>
              </td>
              <td class="e11-c-num e11-grp-tot">{{ num(g.base, 0) }}</td>
              <td></td>
              <td class="e11-c-num e11-grp-tot">{{ num(g.amount) }}</td>
              <td></td>
              <td class="e11-c-num e11-grp-tot">{{ num(g.tax) }}</td>
              <td class="e11-c-num e11-grp-tot e11-c-total">{{ num(g.total) }}</td>
              <td class="l"></td>
              <td v-if="edit"></td>
            </tr>
            <tr v-for="r in g.rows" :key="r.id" class="e11-row">
              <td class="l e11-c-acct">
                <span class="e11-acct-cell">
                  <input
                    v-if="edit"
                    type="checkbox"
                    class="e11-cb"
                    :checked="selectedIds?.has(r.id) ?? false"
                    title="选中以批量删除"
                    @change="emit('toggleSelect', r)"
                  />
                  <span>{{ mLabel(r.acctMonth) }}</span>
                  <span v-if="r.source === 'manual'" class="e11-userbadge">手动</span>
                  <span v-else-if="r.source === 'import'" class="e11-importbadge">导入</span>
                </span>
              </td>
              <td class="l e11-c-inv">{{ r.invDate }}</td>
              <td class="e11-c-num e11-c-qty">{{ num(r.demand ?? 0, 0) }}</td>
              <td class="e11-c-num e11-c-price">{{ num(r.price, 2) }}</td>
              <td class="e11-c-num e11-c-amt">{{ num(r.amount) }}</td>
              <td class="e11-c-num e11-c-tax">{{ (r.rate * 100).toFixed(0) }}%</td>
              <td class="e11-c-num e11-c-tax">{{ num(r.tax) }}</td>
              <td class="e11-c-num e11-c-total">{{ num(r.total) }}</td>
              <td class="l" style="max-width:220px">
                <SchedNoteCell :note="r.note" :edit="edit" @save="emit('note', r, $event)" />
              </td>
              <td v-if="edit">
                <span class="e11-acts">
                  <button class="e11-actbtn del" title="删除" @click="emit('delete', r)">
                    <component :is="iconFor('trash-2')" :size="15" />
                  </button>
                </span>
              </td>
            </tr>
          </template>
          <tr class="e11-filler" aria-hidden="true"><td :colspan="99"></td></tr>
        </tbody>
        <tfoot>
          <tr>
            <th class="e11-foot-lbl" :colspan="2">{{ year }} 年合计 · 基本电费</th>
            <th class="e11-c-num">{{ num(total.demand, 0) }}</th>
            <th></th>
            <th class="e11-c-num">{{ num(total.amount) }}</th>
            <th></th>
            <th class="e11-c-num">{{ num(total.tax) }}</th>
            <th class="e11-c-num">{{ num(total.total) }}</th>
            <th class="l"></th>
            <th v-if="edit"></th>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from screen-schedule11.jsx EStyles(.e11-toolbar / .e11-table 段) */
.e11-wrap { flex:1 1 auto; display:flex; flex-direction:column; gap:14px; min-height:0; }

.e11-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.e11-toolbar-l { display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-width:0; }
.e11-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.e11-count { font-size:12px; color:var(--text-muted); }
.e11-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }

.e11-tablewrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.e11-table { border-collapse:separate; border-spacing:0; width:100%; min-width:1040px; height:100%; font-family:var(--font-sans); font-size:13px; color:var(--text-primary); }
.e11-table tbody tr.e11-filler td { height:0; padding:0; line-height:0; font-size:0; border:none; background:var(--surface-white); }
.e11-filler { height:100%; }
.e11-table th, .e11-table td { padding:0 12px; box-sizing:border-box; white-space:nowrap; text-align:right; }
.e11-table .l { text-align:left; }
.e11-table .c { text-align:center; }

.e11-table thead th { position:sticky; top:0; z-index:3; height:44px; background:var(--surface-white); border-bottom:1px solid var(--border-subtle); vertical-align:middle; }
.e11-th { display:flex; flex-direction:column; gap:1px; align-items:flex-end; }
.e11-th-name { font-size:11.5px; font-weight:var(--fw-semibold); color:var(--text-secondary); }
.e11-th-unit { font-size: var(--fs-micro); color:var(--text-muted); }
.e11-h-act { width:46px; }

.e11-table tbody td { height:37px; border-bottom:1px solid var(--divider); }
.e11-c-acct { font-weight:var(--fw-medium); }
.e11-c-inv { color:var(--text-muted); font-size:12px; }
.e11-c-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12.5px; }
.e11-c-qty { color:var(--text-secondary); }
.e11-c-price { color:var(--text-muted); font-size:12px; }
.e11-c-amt { color:var(--text-primary); }
.e11-c-tax { color:var(--text-muted); font-size:12px; }
.e11-c-total { font-weight:var(--fw-semibold); color:var(--text-primary); }

.e11-pchip { display:inline-flex; align-items:center; gap:5px; font-size:12px; color:var(--text-secondary); }
.e11-pdot { width:7px; height:7px; border-radius:50%; flex:0 0 auto; }
.e11-cat { display:inline-flex; align-items:center; height:19px; padding:0 8px; border-radius:var(--radius-full); background:var(--surface-card); color:var(--text-secondary); font-size:11px; }

.e11-row td { background:var(--surface-white); }
.e11-row:hover td { background:var(--surface-card); }
.e11-acct-head, .e11-acct-cell { display:inline-flex; align-items:center; gap:7px; }
.e11-cb { width:15px; height:15px; flex:0 0 auto; cursor:pointer; accent-color:var(--ink-900); }
.e11-cb:disabled { cursor:not-allowed; opacity:.4; }
.e11-userbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; margin-left:7px; border-radius:var(--radius-full); background:var(--accent-sky); color:var(--hue-blue); font-size:10px; font-weight:var(--fw-semibold); }
.e11-importbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; margin-left:7px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-muted); font-size:10px; font-weight:var(--fw-semibold); }
.e11-acts { display:inline-flex; justify-content:flex-end; opacity:0; }
.e11-row:hover .e11-acts { opacity:1; }
.e11-actbtn { width:26px; height:26px; border:none; background:transparent; border-radius:6px; color:var(--text-disabled); cursor:pointer; display:grid; place-items:center; }
.e11-actbtn:disabled { opacity:.35; cursor:default; }
.e11-actbtn.del:hover { background:rgba(220,38,38,.1); color:var(--hue-red); }

/* 期别分组头 */
.e11-grp-row td { background:var(--surface-sunken); border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); height:42px; }
.e11-grp-inner { display:flex; align-items:center; gap:9px; }
.e11-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
.e11-grp-name { font-weight:var(--fw-semibold); font-size:13.5px; color:var(--text-primary); }
.e11-grp-meta { font-size:11.5px; color:var(--text-muted); }
.e11-grp-meta b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }
.e11-grp-tot { color:var(--text-secondary); font-weight:var(--fw-semibold); }

/* 粘性表尾 · 本年合计(品牌蓝加粗) */
.e11-table tfoot th { position:sticky; bottom:0; z-index:3; height:44px; background:var(--surface-white); border-top:2px solid var(--border-strong); font-weight:var(--fw-semibold); }
.e11-table tfoot .e11-c-num { color:var(--brand-deep); font-weight:var(--fw-semibold); }
.e11-foot-lbl { text-align:left; font-size:13px; color:var(--text-primary); }

/* 空 / 未来年份引导态 */
.e11-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:240px; padding:40px; text-align:center; }
.e11-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.e11-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.e11-empty-s { font-size:13px; color:var(--text-muted); max-width:400px; line-height:1.5; }
</style>
