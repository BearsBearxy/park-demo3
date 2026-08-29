<script setup lang="ts">
// 附表12 逐月工资宽表 — 1:1 from screen-schedule12.jsx 表体段(385-505)。
// 两级分组表头(月工资大类8 / 补贴2 / 招商提成 / 考勤4 / 应发 / 代缴代扣3 / 实发 / 签收 / 备注),
// 序号+姓名 sticky 左列,组色带,全部派生列(后端下发,不重算),签收态,tfoot 合计,种子/手动/导入角标(均可删)。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedNoteCell from '@/components/sched/SchedNoteCell.vue'
import type { SalaryRecordDTO, SalaryTotal } from '@/types/salary'

const props = defineProps<{
  year: number
  month: number
  rows: SalaryRecordDTO[]
  total: SalaryTotal
  edit: boolean
  selectedIds?: Set<number>
}>()
const emit = defineEmits<{
  'add': []
  'delete': [row: SalaryRecordDTO]
  'note': [row: SalaryRecordDTO, text: string]
  // 批量删除选择(seed/manual/import 同等可选)
  'toggleSelect': [row: SalaryRecordDTO]
  'selectAll': [checked: boolean]
}>()

// 数字格式(1:1 from jsx wNum):空值显「—」
const num = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 全选状态(全部行可选)
const allSelected = computed(() =>
  props.rows.length > 0 &&
  props.rows.every(r => props.selectedIds?.has(r.id)),
)
</script>

<template>
  <div class="s12-tablewrap">
    <!-- 空月引导态(jsx 386-397) -->
    <div v-if="rows.length === 0" class="s12-empty">
      <div class="s12-empty-ic"><component :is="iconFor('wallet')" :size="24" /></div>
      <div class="s12-empty-t">{{ year }}年{{ month }}月 暂无工资记录</div>
      <div class="s12-empty-s">进入编辑模式可手动新增;记录自动归入对应月份。</div>
      <Button v-if="edit" variant="filled" @click="emit('add')">
        <template #leading><component :is="iconFor('plus')" :size="16" /></template>
        新增工资
      </Button>
    </div>

    <table v-else class="s12-table">
      <thead>
        <!-- 第一级:分组带(jsx 401-415) -->
        <tr class="g">
          <th class="s12-sticky1" rowspan="2">
            <span class="s12-idx-head">
              <input
                v-if="edit"
                type="checkbox"
                class="s12-cb"
                :checked="allSelected"
                :disabled="rows.length === 0"
                title="全选"
                @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
              />
              <span style="font-size:11px">序号</span>
            </span>
          </th>
          <th class="s12-sticky2 l" rowspan="2"><span style="font-size:11px">姓名</span></th>
          <th class="l" rowspan="2"><span style="font-size:11px">职种/职务</span></th>
          <th class="s12-grp-wage" colspan="8">月工资大类</th>
          <th class="s12-grp-sub" colspan="2">补贴</th>
          <th rowspan="2"><span style="font-size:11px">招商提成</span></th>
          <th class="s12-grp-att" colspan="4">考勤</th>
          <th rowspan="2"><span style="font-size:11px">应发工资</span></th>
          <th class="s12-grp-ded" colspan="3">代缴代扣</th>
          <th rowspan="2"><span style="font-size:11px">实发金额</span></th>
          <th class="c" rowspan="2"><span style="font-size:11px">签收</span></th>
          <th class="l" rowspan="2" style="min-width:150px"><span style="font-size:11px">备注</span></th>
          <th v-if="edit" rowspan="2"></th>
        </tr>
        <!-- 第二级:子列(jsx 416-434) -->
        <tr class="s">
          <th class="s12-cap">基本</th>
          <th>岗位</th>
          <th>绩效奖金</th>
          <th>全勤奖</th>
          <th>技能津贴</th>
          <th>学历津贴</th>
          <th>其它津贴</th>
          <th>合计工资</th>
          <th class="s12-cap">午餐补助</th>
          <th>高温及其他</th>
          <th class="s12-cap">应出勤</th>
          <th>请假</th>
          <th>实出勤</th>
          <th class="c">全勤考核</th>
          <th class="s12-cap">社保</th>
          <th>上月个税</th>
          <th>其他</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="r.id" class="s12-row">
          <td class="s12-sticky1 c s12-c-idx">
            <span class="s12-idx-cell">
              <input
                v-if="edit"
                type="checkbox"
                class="s12-cb"
                :checked="selectedIds?.has(r.id) ?? false"
                title="选中以批量删除"
                @change="emit('toggleSelect', r)"
              />
              <span>{{ i + 1 }}</span>
            </span>
          </td>
          <td class="s12-sticky2 l s12-c-name">
            {{ r.name }}<span v-if="r.source === 'manual'" class="s12-userbadge">手动</span>
          </td>
          <td class="l s12-c-role">{{ r.role || '—' }}</td>
          <!-- 月工资大类 -->
          <td class="s12-c-num s12-cap" :class="{ 's12-c-muted': !r.base }">{{ r.base ? num(r.base) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.post }">{{ r.post ? num(r.post) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.perf }">{{ r.perf ? num(r.perf) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.attend }">{{ r.attend ? num(r.attend) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.skill }">{{ r.skill ? num(r.skill) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.edu }">{{ r.edu ? num(r.edu) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.other }">{{ r.other ? num(r.other) : '—' }}</td>
          <td class="s12-c-num s12-c-strong">{{ num(r.wageTotal) }}</td>
          <!-- 补贴 -->
          <td class="s12-c-num s12-cap" :class="{ 's12-c-muted': !r.lunch }">{{ r.lunch ? num(r.lunch) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.heat }">{{ r.heat ? num(r.heat) : '—' }}</td>
          <!-- 招商提成 -->
          <td class="s12-c-num" :class="r.commission ? 's12-c-blue' : 's12-c-muted'">{{ r.commission ? num(r.commission) : '—' }}</td>
          <!-- 考勤 -->
          <td class="s12-c-num s12-cap s12-c-muted">{{ r.shouldDays }}</td>
          <td class="s12-c-num" :class="r.leaveDays ? 's12-c-red' : 's12-c-muted'">{{ r.leaveDays || '0' }}</td>
          <td class="s12-c-num s12-c-muted">{{ r.actualDays }}</td>
          <td class="c">
            <span class="s12-fa" :class="r.fullAttend ? 'yes' : 'no'" :title="r.fullAttend ? '全勤' : '非全勤'">
              <component :is="iconFor(r.fullAttend ? 'check' : 'minus')" :size="14" />
            </span>
          </td>
          <!-- 应发 -->
          <td class="s12-c-num s12-c-strong">{{ num(r.gross) }}</td>
          <!-- 代缴代扣 -->
          <td class="s12-c-num s12-cap" :class="{ 's12-c-muted': !r.social }">{{ r.social ? num(r.social) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.tax }">{{ r.tax ? num(r.tax) : '—' }}</td>
          <td class="s12-c-num" :class="{ 's12-c-muted': !r.otherDeduct }">{{ r.otherDeduct ? num(r.otherDeduct) : '—' }}</td>
          <!-- 实发 -->
          <td class="s12-c-num s12-c-net">{{ num(r.net) }}</td>
          <!-- 签收 -->
          <td class="c">
            <span class="s12-sign" :class="r.sign ? 'yes' : 'no'">
              <component :is="iconFor(r.sign ? 'check-circle-2' : 'circle')" :size="13" />{{ r.sign ? '已签' : '待签' }}
            </span>
          </td>
          <!-- 备注 -->
          <td class="l s12-c-note" :title="r.note ?? ''">
            <SchedNoteCell :note="r.note" :edit="edit" @save="emit('note', r, $event)" />
          </td>
          <!-- 编辑态删除(seed/manual/import 同等可删) -->
          <td v-if="edit">
            <span class="s12-acts">
              <button class="s12-actbtn del" title="删除" @click="emit('delete', r)">
                <component :is="iconFor('trash-2')" :size="15" />
              </button>
            </span>
          </td>
        </tr>
        <tr class="s12-filler" aria-hidden="true"><td :colspan="99"></td></tr>
      </tbody>
      <tfoot>
        <tr>
          <th class="s12-sticky1"></th>
          <th class="s12-sticky2 l s12-foot-lbl">合计 · {{ rows.length }} 人</th>
          <th></th>
          <th class="s12-c-num s12-cap">{{ num(total.base) }}</th>
          <th class="s12-c-num">{{ num(total.post) }}</th>
          <th class="s12-c-num">{{ num(total.perf) }}</th>
          <th class="s12-c-num">{{ num(total.attend) }}</th>
          <th class="s12-c-num">{{ num(total.skill) }}</th>
          <th class="s12-c-num">{{ num(total.edu) }}</th>
          <th class="s12-c-num">{{ num(total.other) }}</th>
          <th class="s12-c-num">{{ num(total.wageTotal) }}</th>
          <th class="s12-c-num s12-cap">{{ num(total.lunch) }}</th>
          <th class="s12-c-num">{{ num(total.heat) }}</th>
          <th class="s12-c-num">{{ num(total.commission) }}</th>
          <th class="s12-cap"></th>
          <th></th>
          <th></th>
          <th class="c"></th>
          <th class="s12-c-num">{{ num(total.gross) }}</th>
          <th class="s12-c-num s12-cap">{{ num(total.social) }}</th>
          <th class="s12-c-num">{{ num(total.tax) }}</th>
          <th class="s12-c-num">{{ num(total.otherDeduct) }}</th>
          <th class="s12-c-num">{{ num(total.net) }}</th>
          <th></th>
          <th class="l"></th>
          <th v-if="edit"></th>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* 1:1 from screen-schedule12.jsx WStyles(.w12-table 段,42-101) */
.s12-tablewrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.s12-table { border-collapse:separate; border-spacing:0; width:max-content; min-width:100%; height:100%; font-family:var(--font-sans); font-size:12.5px; color:var(--text-primary); }
.s12-table tbody tr.s12-filler td { height:0; padding:0; line-height:0; font-size:0; border:none; background:var(--surface-white); }
.s12-filler { height:100%; }
.s12-table th, .s12-table td { padding:0 11px; box-sizing:border-box; white-space:nowrap; text-align:right; height:37px; }
.s12-table .l { text-align:left; }
.s12-table .c { text-align:center; }

.s12-table thead th { position:sticky; background:var(--surface-white); border-bottom:1px solid var(--border-subtle); vertical-align:middle; }
.s12-table thead tr.g th { top:0; z-index:6; height:28px; font-size:10.5px; font-weight:var(--fw-semibold); color:var(--text-muted); border-bottom:1px solid var(--divider); text-align:center; }
.s12-table thead tr.s th { top:28px; z-index:5; height:38px; font-size:11px; font-weight:var(--fw-semibold); color:var(--text-secondary); }
.s12-grp-wage { background:var(--accent-slate) !important; }
.s12-grp-sub { background:var(--accent-sky) !important; color:var(--hue-blue) !important; }
.s12-grp-att { background:var(--accent-cyan) !important; color:var(--hue-cyan) !important; }
.s12-grp-ded { background:rgb(252,235,233) !important; color:var(--hue-red) !important; }
.s12-cap { box-shadow:none; }   /* 对齐事实源 w12-cap(组首列抑制 box-shadow,本表无 shadow 源,等价 no-op) */

/* 粘性左列:序号 + 姓名 */
.s12-sticky1 { position:sticky; left:0; z-index:4; min-width:48px; }
.s12-sticky2 { position:sticky; left:48px; z-index:4; min-width:96px; box-shadow:1px 0 0 var(--border-subtle); }
.s12-table thead tr.g th.s12-sticky1, .s12-table thead tr.g th.s12-sticky2 { z-index:8; background:var(--surface-white); }

.s12-table tbody td { border-bottom:1px solid var(--divider); }
.s12-c-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.s12-c-idx { color:var(--text-muted); font-family:var(--font-mono); }
.s12-idx-head, .s12-idx-cell { display:inline-flex; align-items:center; gap:6px; }
.s12-cb { width:14px; height:14px; flex:0 0 auto; cursor:pointer; accent-color:var(--ink-900); }
.s12-cb:disabled { cursor:not-allowed; opacity:.4; }
.s12-c-name { font-weight:var(--fw-medium); color:var(--text-primary); }
.s12-c-role { color:var(--text-muted); font-size:12px; }
.s12-c-muted { color:var(--text-muted); }
.s12-c-strong { font-weight:var(--fw-semibold); color:var(--text-primary); }
.s12-c-blue { color:var(--hue-blue); font-weight:var(--fw-semibold); }
.s12-c-red { color:var(--hue-red); }
.s12-c-net { font-weight:var(--fw-semibold); color:var(--text-primary); }
.s12-c-note { color:var(--text-muted); font-size:11.5px; max-width:160px; overflow:hidden; text-overflow:ellipsis; text-align:left; }

.s12-row td { background:var(--surface-white); }
.s12-row:hover td { background:var(--surface-card); }
.s12-row:hover .s12-sticky1, .s12-row:hover .s12-sticky2 { background:var(--surface-card); }
.s12-userbadge { display:inline-flex; align-items:center; height:16px; padding:0 5px; margin-left:6px; border-radius:var(--radius-full); background:var(--accent-sky); color:var(--hue-blue); font-size:9.5px; font-weight:var(--fw-semibold); }
.s12-sign { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; }
.s12-sign.yes { color:var(--hue-blue); }
.s12-sign.no { color:var(--text-disabled); }
.s12-fa { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; }
.s12-fa.yes { color:var(--hue-blue); }
.s12-fa.no { color:var(--text-disabled); }
.s12-acts { display:inline-flex; justify-content:flex-end; opacity:0; }
.s12-row:hover .s12-acts { opacity:1; }
.s12-actbtn { width:24px; height:24px; border:none; background:transparent; border-radius:6px; color:var(--text-disabled); cursor:pointer; display:grid; place-items:center; }
.s12-actbtn:disabled { opacity:.35; cursor:default; }
.s12-actbtn.del:hover { background:rgba(255,59,48,.1); color:var(--hue-red); }

.s12-table tfoot th { position:sticky; bottom:0; z-index:5; background:var(--surface-white); border-top:2px solid var(--border-strong); font-weight:var(--fw-semibold); height:44px; }
.s12-table tfoot .s12-sticky1, .s12-table tfoot .s12-sticky2 { z-index:6; background:var(--surface-white); }
.s12-table tfoot .s12-c-num { color:var(--brand-deep); font-weight:var(--fw-semibold); }
.s12-foot-lbl { text-align:left; font-size:13px; color:var(--text-primary); }

.s12-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; height:100%; min-height:240px; padding:40px; text-align:center; }
.s12-empty-ic { width:52px; height:52px; border-radius:16px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); }
.s12-empty-t { font-size:15px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.s12-empty-s { font-size:13px; color:var(--text-muted); max-width:400px; line-height:1.5; }

/* 触屏(RESPONSIVE-LAYOUT-SPEC §6.1):hover 显形的行内删除钮常显(半透明弱化,不可达=功能丢失) */
@media (hover: none) {
  .s12-acts { opacity:.55; }
}

/* ── S 档(≤600,§5.3 查看优先):左 sticky 收敛只留姓名一根+表头——序号列**原位退成普通列**
   (列序/列宽不动,只摘横向钉扎),姓名 offset 从 48 归 0,序号随横滚滚入其下;
   双级表头 top:0/28 与表脚纵向 sticky 不动。本表 sticky 全写在 CSS 类上(非内联 style),
   媒体块直接盖得住,不必像 FPLedgerTable(offset 内联)那样进 JS 走 useViewport。 */
@media (max-width: 600px) {
  .s12-sticky1 { left:auto; }
  .s12-sticky2 { left:0; }
}
</style>
