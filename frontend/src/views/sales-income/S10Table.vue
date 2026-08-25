<script setup lang="ts">
// 附表10 销售收入宽表 — 1:1 from screen-schedule10.jsx 表体(376-428)。一行一租户。
// 两级表头(组/叶子)由账册现行版模板供给(toS10Layout(book.definition) → props.groups,
// BOOK-WORKBENCH-SPEC §3 现行版全局生效;自定义列 c_ 与标准列同权渲染/编辑);
// 左『租户』sticky + 右『合计』sticky;tfoot 列合计 + 总计;
// 合计口径:浏览态信后端派生(r.total / columnTotals / grandTotal 已含 extra_fees 口袋),
// 编辑态本地即时算,行/总计按 sumIds(模板全列含隐藏,含 c_ 列),列合计只算可见叶子。
// 撑高 filler 行把合计顶到卡底。CSS 全在本组件 <style scoped>，不复用别组件 scoped class。
import { ref, computed, watch, nextTick } from 'vue'
import { iconFor } from '@/components/ds/icon'
import type { Group } from './layout'
import type { S10RecordDTO, S10ColId } from '@/types/s10'

const props = defineProps<{
  groups: Group[]        // 模板驱动版面(可见列;来自 toS10Layout)
  phaseName: string
  year: number
  month: number
  rows: S10RecordDTO[]
  edit: boolean
  sumIds?: string[]                       // 编辑态行/总合计口径(含隐藏列);缺省=可见叶子
  columnTotals?: Record<string, number>   // 浏览态后端列合计;缺省时本地算(兜底)
  grandTotal?: number                     // 浏览态后端总计
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
  // 批量删除选择(种子行不可选)
  toggleSelect: [row: S10RecordDTO]
  selectAll: [checked: boolean]
  focusDone: []
  bindRow: [row: S10RecordDTO]
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

// 展平叶子（顺序 = 列序;组结构直接用 props.groups）
const leaves = computed(() => props.groups.flatMap(g => g.leaves))
const grpLabel = (label?: string) => (label ?? '').replace('MON', props.month + '月')

const fmt = (v: number) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const s10Num = (x: string) => { const v = parseFloat(String(x).replace(/[, ¥%]/g, '')); return isNaN(v) ? 0 : v }

// 行合计 / 列合计 / 总计:
// · 浏览态且后端给了 columnTotals → 直接信后端派生(r.total/columnTotals/grandTotal 含口袋全量,
//   包括归档列等前端版面看不见的值),前端零自算(§2 派生口径唯一事实源)。
// · 编辑态(或无后端派生兜底)→ 一次 N×列 遍历同时产出三者(随单元格写回即时重算);
//   行/总计按 sumIds(模板全列含隐藏,含 c_ 平铺列),列合计只累可见叶子。
// 为什么不写成三个模板内函数:模板里逐格调用会跑 N次行合计 + 25次列合计(各N行) + 总计再一遍 N×25
// ≈ 75×N 次乘加,且每次编辑输入都整表重跑;合成一个 computed 后压到 1×N,并有缓存不随无关重渲染重算。
const totals = computed(() => {
  if (!props.edit && props.columnTotals) {
    const byRow = new Map<number, number>()
    for (const r of props.rows) byRow.set(r.id, Number(r.total) || 0)
    // 后端 columnTotals 只算 25 物理列:可见自定义列(c_)缺键会显 0.00,本地Σ兜底(审查#7)
    const byCol: Record<string, number> = { ...props.columnTotals }
    for (const l of leaves.value) {
      const id = l.colId as string
      if (byCol[id] == null) {
        let sum = 0
        for (const r of props.rows) sum += Number((r as unknown as Record<string, unknown>)[id]) || 0
        byCol[id] = sum
      }
    }
    return { byRow, byCol, grand: props.grandTotal ?? 0 }
  }
  const cols = leaves.value
  const ids = props.sumIds ?? cols.map(l => l.colId as string)
  const visible = new Set<string>(cols.map(l => l.colId as string))
  const byRow = new Map<number, number>()   // 键 = r.id（模板 v-for 也用它,唯一）
  const byCol: Record<string, number> = {}
  for (const l of cols) byCol[l.colId] = 0
  let grand = 0
  for (const r of props.rows) {
    const bag = r as unknown as Record<string, unknown>
    let sum = 0
    for (const id of ids) {
      const v = Number(bag[id]) || 0
      sum += v
      if (visible.has(id)) byCol[id] += v
    }
    byRow.set(r.id, sum)
    grand += sum
  }
  return { byRow, byCol, grand }
})

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
      <div class="s10-empty-s">该月尚未录入。进入编辑模式后可导入 Excel,或手动新增租户。</div>
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
              <!-- 名字两态统一为可点击文本:账面名/绑定都在行抽屉里改(与园区抄表同一动线,
                   用户 2026-08-23 拍板「不在表格上直接修改」) -->
              <span class="s10-tname act" :title="r.tenantName + ' · 点击查看/绑定租户'"
                    @click="emit('bindRow', r)">{{ r.tenantName }}</span>
              <!-- 未绑定:紧凑圆点(文字胶囊会挤长租户名,与台账 .lg-unbound-dot 对齐,2026-08-24 拍板);
                   语义进 title,点击仍触发 bindRow -->
              <span v-if="r.tenantId == null" class="s10-unbound-dot" title="未绑定租户档案 · 点击处理"
                    @click="emit('bindRow', r)"></span>
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

          <td class="s10-c-total">{{ fmt(totals.byRow.get(r.id) ?? 0) }}</td>
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
          <th v-for="l in leaves" :key="l.colId" class="s10-c-num">{{ fmt(totals.byCol[l.colId]) }}</th>
          <th class="s10-foot-note"></th>
          <th class="s10-foot-total">{{ fmt(totals.grand) }}</th>
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
/* 未绑定:紧凑圆点(琥珀描边,warning 语义);完整提示走 title(对齐台账 .lg-unbound-dot) */
.s10-unbound-dot {
  flex:0 0 auto; width:8px; height:8px; border-radius:50%;
  border:2px solid var(--status-warning); background:transparent; box-sizing:border-box;
  cursor:pointer;
}
.s10-tname.act { cursor: pointer; }
.s10-tname.act:hover { color: var(--hue-blue); }
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
tr.row-flash td { animation: s10-row-flash var(--dur-highlight) var(--ease-standard); }
@keyframes s10-row-flash { from { background: var(--accent-blue); } to { background: var(--surface-white); } }
</style>
