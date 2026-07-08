<script setup lang="ts">
// 附表10 销售收入宽表 — 1:1 from screen-schedule10.jsx 表体(376-428)。一行一租户。
// 双版面两级表头（组/叶子，按当前 phase 的 layout 渲染）;左『租户』sticky + 右『合计』sticky;
// tfoot 列合计 + 总计;编辑态单元格 input 即时重算（行合计/列合计/总计纯前端从 props.rows 算）;
// 撑高 filler 行把合计顶到卡底。CSS 全在本组件 <style scoped>，不复用别组件 scoped class。
import { ref, computed, watch, nextTick } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { LAYOUTS, leavesOf, type LayoutId } from './layout'
import type { S10RecordDTO, S10ColId } from '@/types/s10'

const props = defineProps<{
  layout: LayoutId
  phaseName: string
  year: number
  month: number
  rows: S10RecordDTO[]
  edit: boolean
  selectedIds?: Set<number>
  focusTenant?: string   // 核对跳转深链:定位并高亮该租户行(一次性,完成后 emit focusDone 由父层清空)
}>()
const emit = defineEmits<{
  add: []
  edit: []
  delete: [row: S10RecordDTO]
  // 单元格金额改动（即时写回父级 row，触发重算）
  cell: [row: S10RecordDTO, colId: S10ColId, value: number]
  note: [row: S10RecordDTO, value: string]
  name: [row: S10RecordDTO, value: string]
  // 批量删除选择(种子行不可选)
  toggleSelect: [row: S10RecordDTO]
  selectAll: [checked: boolean]
  focusDone: []
}>()

// ── 深链定位:渲染后滚动到 focusTenant 行 + .row-flash 高亮渐隐 ──
const wrapEl = ref<HTMLElement | null>(null)
watch(() => props.focusTenant, flashFocusRow, { immediate: true })
async function flashFocusRow() {
  const name = props.focusTenant?.trim()
  if (!name) return
  await nextTick()
  for (const tr of wrapEl.value?.querySelectorAll<HTMLTableRowElement>('tbody tr.s10-row') ?? []) {
    if ((tr.querySelector('.s10-tname')?.textContent ?? '').trim() !== name) continue
    tr.scrollIntoView({ block: 'center' })
    tr.classList.add('row-flash')
    tr.addEventListener('animationend', () => tr.classList.remove('row-flash'), { once: true })
    break
  }
  emit('focusDone')  // 找不到该租户行也视为完成:静默停在本层(spec 取静默)
}

// 可选(非种子)行 → 全选状态
const selectableRows = computed(() => props.rows.filter(r => r.source !== 'seed'))
const allSelected = computed(() =>
  selectableRows.value.length > 0 &&
  selectableRows.value.every(r => props.selectedIds?.has(r.id)),
)

// 组（带 MON→月份替换）+ 展平叶子（顺序 = 列序）
const groups = computed(() => LAYOUTS[props.layout])
const leaves = computed(() => leavesOf(props.layout))
const grpLabel = (label?: string) => (label ?? '').replace('MON', props.month + '月')

const fmt = (v: number) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const s10Num = (x: string) => { const v = parseFloat(String(x).replace(/[, ¥%]/g, '')); return isNaN(v) ? 0 : v }

// 行合计 = 该行 25 列之和（编辑态随单元格写回即时重算）
const rowTotal = (r: S10RecordDTO) => leaves.value.reduce((a, l) => a + (Number(r[l.colId]) || 0), 0)
// 列合计 = 该列所有行之和
const colTotal = (colId: S10ColId) => props.rows.reduce((a, r) => a + (Number(r[colId]) || 0), 0)
// 总计 = 全表之和
const grand = computed(() => props.rows.reduce((a, r) => a + rowTotal(r), 0))

function onCellInput(r: S10RecordDTO, colId: S10ColId, raw: string) {
  emit('cell', r, colId, s10Num(raw))
}
</script>

<template>
  <div class="s10-wrap" ref="wrapEl">
    <!-- 空态（jsx 364-375） -->
    <div v-if="props.rows.length === 0" class="s10-empty">
      <div class="s10-empty-ic"><component :is="iconFor('receipt')" :size="24" /></div>
      <div class="s10-empty-t">{{ year }} 年 {{ month }} 月 · {{ phaseName }} 暂无收款记录</div>
      <div class="s10-empty-s">该月尚未录入。可手动新增租户后逐项填写;导入 Excel 即将上线。</div>
      <div v-if="edit"><button class="s10-emptybtn" @click="emit('add')">
        <component :is="iconFor('plus')" :size="16" />新增租户
      </button></div>
      <button v-else class="s10-emptybtn" @click="emit('edit')">
        <component :is="iconFor('pencil')" :size="16" />编辑模式
      </button>
    </div>

    <table v-else class="s10-table">
      <thead>
        <!-- 第一行:租户 + 组（leaf 组跨两行）+ 备注 + 合计 -->
        <tr>
          <th class="s10-h-name" rowspan="2">
            <span class="s10-name-inner">
              <input
                v-if="edit"
                type="checkbox"
                class="s10-cb"
                :checked="allSelected"
                :disabled="selectableRows.length === 0"
                title="全选可删行"
                @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
              />
              <span>租户</span>
            </span>
          </th>
          <template v-for="(g, gi) in groups" :key="gi">
            <th
              v-if="g.label === undefined"
              class="s10-h-leaf"
              rowspan="2"
            >{{ g.leaves[0].label }}</th>
            <th
              v-else
              :class="['s10-h-grp', { elec: g.elec, water: g.water }]"
              :colspan="g.leaves.length"
            >{{ grpLabel(g.label) }}</th>
          </template>
          <th class="s10-h-note" rowspan="2">备注</th>
          <th class="s10-h-total" rowspan="2">合计</th>
        </tr>
        <!-- 第二行:多叶子组的子列 -->
        <tr>
          <template v-for="(g, gi) in groups" :key="gi">
            <template v-if="g.label !== undefined">
              <th v-for="l in g.leaves" :key="l.colId" class="s10-h-sub">{{ l.label }}</th>
            </template>
          </template>
        </tr>
      </thead>

      <tbody>
        <tr v-for="r in props.rows" :key="r.id" class="s10-row">
          <td class="s10-c-name">
            <span class="s10-name-inner">
              <input
                v-if="edit"
                type="checkbox"
                class="s10-cb"
                :checked="selectedIds?.has(r.id) ?? false"
                :disabled="r.source === 'seed'"
                title="选中以批量删除"
                @change="emit('toggleSelect', r)"
              />
              <input
                v-if="edit && r.source !== 'seed'"
                class="s10-input name"
                :value="r.tenantName"
                @input="emit('name', r, ($event.target as HTMLInputElement).value)"
              />
              <span v-else class="s10-tname">{{ r.tenantName }}</span>
              <span v-if="r.source !== 'seed'" class="s10-userbadge">手动</span>
              <button
                v-if="edit && r.source !== 'seed'"
                class="s10-del"
                title="删除该租户"
                @click="emit('delete', r)"
              ><component :is="iconFor('trash-2')" :size="14" /></button>
            </span>
          </td>

          <td
            v-for="l in leaves"
            :key="l.colId"
            :class="['s10-c-num', { zero: !Number(r[l.colId]) }]"
          >
            <input
              v-if="edit"
              class="s10-input"
              inputmode="decimal"
              :value="Number(r[l.colId]) ? String(r[l.colId]) : ''"
              placeholder="0"
              @input="onCellInput(r, l.colId, ($event.target as HTMLInputElement).value)"
            />
            <template v-else>{{ Number(r[l.colId]) ? fmt(Number(r[l.colId])) : '—' }}</template>
          </td>

          <td class="s10-c-note">
            <input
              v-if="edit"
              class="s10-input note"
              :value="r.note ?? ''"
              placeholder="备注"
              @input="emit('note', r, ($event.target as HTMLInputElement).value)"
            />
            <template v-else>
              <span v-if="r.note">{{ r.note }}</span>
              <span v-else style="color:var(--text-disabled)">—</span>
            </template>
          </td>

          <td class="s10-c-total">{{ fmt(rowTotal(r)) }}</td>
        </tr>

        <!-- 撑高行:把合计顶到卡底 -->
        <tr class="s10-fill" aria-hidden="true">
          <td class="s10-c-name"></td>
          <td :colspan="leaves.length + 1"></td>
          <td class="s10-c-total"></td>
        </tr>
      </tbody>

      <tfoot>
        <tr>
          <th class="s10-foot-name">合计 · {{ props.rows.length }} 户</th>
          <th v-for="l in leaves" :key="l.colId" class="s10-c-num">{{ fmt(colTotal(l.colId)) }}</th>
          <th class="s10-foot-note"></th>
          <th class="s10-foot-total">{{ fmt(grand) }}</th>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* 1:1 from screen-schedule10.jsx S10Styles(.s10-wrap / .s10-table 段) —— 全部本组件自有,不复用别处 scoped */
.s10-wrap { flex:1 1 auto; min-height:300px; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.s10-table { border-collapse:separate; border-spacing:0; width:max-content; min-width:100%; height:100%; font-family:var(--font-sans); font-size:12.5px; color:var(--text-primary); }
.s10-table th, .s10-table td { box-sizing:border-box; white-space:nowrap; }

/* 表头 — 两行:组 / 叶子。白底 + 发丝线 */
.s10-table thead th { position:sticky; background:var(--surface-white); font-weight:var(--fw-semibold); color:var(--text-secondary); text-align:right; vertical-align:middle; }
.s10-table thead tr:first-child th { top:0; z-index:3; height:34px; }
.s10-table thead tr:nth-child(2) th { top:34px; z-index:3; height:34px; }
/* 分组表头:浅灰底 + 居中标题 */
.s10-table thead th.s10-h-grp { text-align:center; background:var(--bg-panel); font-size:11.5px; font-weight:var(--fw-medium); color:var(--text-secondary); border-bottom:1px solid var(--divider); }
.s10-table thead th.s10-h-grp.elec { color:var(--hue-blue); }
.s10-table thead th.s10-h-grp.water { color:var(--hue-cyan); }
.s10-table thead th.s10-h-leaf, .s10-table thead th.s10-h-sub, .s10-table thead th.s10-h-note, .s10-table thead th.s10-h-total { text-align:center; }
.s10-h-sub { font-size:11px; color:var(--text-muted); padding:0 12px; border-bottom:1px solid var(--border-subtle); min-width:104px; }
.s10-h-leaf { padding:0 12px; border-bottom:1px solid var(--border-subtle); font-size:11.5px; color:var(--text-primary); min-width:104px; text-align:center; }
.s10-h-name { left:0; z-index:6 !important; top:0 !important; text-align:left; padding:0 14px; min-width:188px; border-bottom:1px solid var(--border-subtle); box-shadow:1px 0 0 var(--border-subtle); }
.s10-h-note { padding:0 12px; text-align:left; font-size:11.5px; min-width:140px; border-bottom:1px solid var(--border-subtle); }
.s10-h-total { right:0; z-index:6 !important; top:0 !important; text-align:right; padding:0 14px; min-width:128px; border-bottom:1px solid var(--border-subtle); box-shadow:-1px 0 0 var(--border-subtle); color:var(--text-primary); }

/* 单元格 */
.s10-table tbody td { height:38px; padding:0 12px; border-bottom:1px solid var(--divider); text-align:right; }
.s10-c-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.s10-c-num.zero { color:var(--text-disabled); }
.s10-c-name { position:sticky; left:0; z-index:2; text-align:left; padding:0 14px; background:var(--surface-white); box-shadow:1px 0 0 var(--border-subtle); }
.s10-c-note { text-align:left; color:var(--text-muted); }
.s10-c-total { position:sticky; right:0; z-index:2; background:var(--surface-white); font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-weight:var(--fw-semibold); color:var(--text-primary); box-shadow:-1px 0 0 var(--border-subtle); }

.s10-row td { background:var(--surface-white); }
.s10-row:hover td { background:var(--surface-card); }
.s10-row:hover .s10-c-name, .s10-row:hover .s10-c-total { background:var(--surface-card); }

.s10-name-inner { display:flex; align-items:center; gap:8px; }
.s10-cb { width:15px; height:15px; flex:0 0 auto; cursor:pointer; accent-color:var(--ink-900); }
.s10-cb:disabled { cursor:not-allowed; opacity:.4; }
.s10-tname { font-weight:var(--fw-medium); color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; }
.s10-userbadge { display:inline-flex; align-items:center; height:17px; padding:0 6px; border-radius:var(--radius-full); background:var(--accent-sky); color:var(--hue-blue); font-size:10px; font-weight:var(--fw-semibold); flex:0 0 auto; }
.s10-del { width:24px; height:24px; border:none; background:transparent; border-radius:6px; color:var(--text-disabled); cursor:pointer; display:grid; place-items:center; flex:0 0 auto; margin-left:auto; opacity:0; }
.s10-row:hover .s10-del { opacity:1; }
.s10-del:hover { background:rgba(255,59,48,.1); color:var(--hue-red); }

/* 编辑输入 */
.s10-input { width:100%; box-sizing:border-box; height:28px; border:1px solid var(--border-subtle); border-radius:6px; padding:0 8px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12.5px; text-align:right; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast); }
.s10-input:focus { border-color:var(--hue-blue); }
.s10-input.note { font-family:var(--font-sans); text-align:left; }
.s10-input.name { font-family:var(--font-sans); height:30px; font-weight:var(--fw-medium); }

/* 撑高行 */
.s10-table tbody tr.s10-fill td { height:auto; padding:0; border-bottom:none; background:var(--surface-white); }
.s10-fill { height:100%; }

/* 合计行 */
.s10-table tfoot th { position:sticky; bottom:0; z-index:3; height:42px; padding:0 12px; background:var(--surface-white); border-top:2px solid var(--border-strong); font-weight:var(--fw-semibold); text-align:right; font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--brand-deep); }
.s10-table tfoot .s10-foot-name { left:0; z-index:5; text-align:left; font-family:var(--font-sans); padding:0 14px; box-shadow:1px 0 0 var(--border-strong); color:var(--text-primary); }
.s10-table tfoot .s10-foot-total { right:0; z-index:5; box-shadow:-1px 0 0 var(--border-strong); }
.s10-table tfoot .s10-foot-note { background:var(--surface-white); }

/* 空态 */
.s10-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:280px; padding:40px; text-align:center; }
.s10-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.s10-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.s10-empty-s { font-size:13px; color:var(--text-muted); max-width:420px; line-height:1.5; }
.s10-emptybtn { display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 18px; border:none; border-radius:var(--radius-full); background:var(--ink-900); color:#fff; cursor:pointer; font-family:var(--font-sans); font-size:13.5px; font-weight:var(--fw-medium); }
.s10-emptybtn:hover { background:rgb(58,58,58); }

/* 深链定位行:2s 高亮渐隐(结束后还原表格自身背景) */
tr.row-flash td { animation: s10-row-flash 2s var(--ease-standard); }
@keyframes s10-row-flash { from { background: var(--accent-blue); } to { background: var(--surface-white); } }
</style>
