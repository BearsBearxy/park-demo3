<script setup lang="ts">
// 智能整表导入 · 汇总确认屏 — 每段一行:[年][月][期][识别 N 户][✓导入]。
// 识别到的预填;缺的留空标红;年(2000-2100)/月(1-12)/期 合法且勾选才可导。「全部导入」emit confirm。
// CSS 全本组件 scoped,不复用别组件 class。
import { reactive, computed } from 'vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'
import type { Section } from '@/utils/importSections'
import type { ImportRec } from '@/utils/importHeaderMatch'

const props = withDefaults(defineProps<{
  sections?: Section[]
  defaultYear?: number
  defaultMonth?: number
  defaultPhase?: number
  hidePhase?: boolean   // 工资分段:无期 → 隐期列与期选择,仅校验 年/月/N人
  // 纯标签段模式:无年/月/期,每段只显示 label + N条 + 勾选(光伏/充电桩/电费自定义解析用)
  labelOnly?: boolean
  labelSections?: { label: string; records: ImportRec[] }[]
}>(), { hidePhase: false, labelOnly: false })

const emit = defineEmits<{
  confirm: [picks: { year: number; month: number; phase: number; records: ImportRec[] }[]]
  labelConfirm: [picks: { label: string; records: ImportRec[] }[]]
}>()

const PHASE_OPTS = [
  { value: 1, label: '一期' },
  { value: 2, label: '二期' },
  { value: 3, label: '三期' },
  { value: 4, label: '宿舍' },
]

interface Row {
  year: number | null
  month: number | null
  phase: number | null
  records: ImportRec[]
  checked: boolean
}

// 识别到的预填;缺的用当前槽默认填(契约:0 标题段供汇总屏用当前槽默认填)
const rows = reactive<Row[]>(
  (props.sections ?? []).map(s => ({
    year: s.year ?? props.defaultYear ?? null,
    month: s.month ?? props.defaultMonth ?? null,
    phase: s.phase ?? props.defaultPhase ?? null,
    records: s.records,
    checked: s.records.length > 0,
  })),
)

// 纯标签段:每段 label + records + 勾选(默认非空即勾)
const labelRows = reactive(
  (props.labelSections ?? []).map(s => ({ label: s.label, records: s.records, checked: s.records.length > 0 })),
)
const anyLabelPick = computed(() => labelRows.some(r => r.checked && r.records.length > 0))

function toggleLabel(r: { records: ImportRec[]; checked: boolean }) {
  if (!r.records.length) { r.checked = false; return }
  r.checked = !r.checked
}

function confirmLabel() {
  const picks = labelRows.filter(r => r.checked && r.records.length > 0).map(r => ({ label: r.label, records: r.records }))
  if (picks.length) emit('labelConfirm', picks)
}

function validYear(y: number | null): boolean { return y != null && y >= 2000 && y <= 2100 }
function validMonth(m: number | null): boolean { return m != null && m >= 1 && m <= 12 }
function validPhase(p: number | null): boolean { return p != null && p >= 1 && p <= 4 }
function rowValid(r: Row): boolean {
  // 隐期模式不校验期(工资无期);否则期须合法
  const phaseOk = props.hidePhase || validPhase(r.phase)
  return validYear(r.year) && validMonth(r.month) && phaseOk && r.records.length > 0
}

const anyPick = computed(() => rows.some(r => r.checked && rowValid(r)))

function toggle(r: Row) {
  if (!rowValid(r)) { r.checked = false; return }
  r.checked = !r.checked
}

function confirm() {
  const picks = rows
    .filter(r => r.checked && rowValid(r))
    .map(r => ({ year: r.year!, month: r.month!, phase: r.phase!, records: r.records }))
  if (picks.length) emit('confirm', picks)
}
</script>

<template>
  <!-- 纯标签段模式:只显示 段标签 + N条 + 勾选 -->
  <div v-if="labelOnly" class="isum">
    <div class="isum-head">
      <component :is="iconFor('layers')" :size="15" />
      <span>识别到 <b>{{ labelRows.length }}</b> 段，请勾选导入</span>
    </div>

    <div class="isum-table">
      <div class="isum-hr label-only">
        <span class="isum-col-pick"></span>
        <span class="isum-col-label">分段</span>
        <span class="isum-col-n">识别</span>
      </div>
      <div v-for="(r, i) in labelRows" :key="i" class="isum-row label-only" :class="{ off: !r.checked }">
        <span class="isum-col-pick">
          <input type="checkbox" class="isum-cb" :checked="r.checked" :disabled="!r.records.length" @change="toggleLabel(r)" />
        </span>
        <span class="isum-col-label">{{ r.label }}</span>
        <span class="isum-col-n"><b :class="{ empty: r.records.length === 0 }">{{ r.records.length }}</b> 条</span>
      </div>
    </div>

    <div class="isum-foot">
      <Button variant="filled" :disabled="!anyLabelPick" @click="confirmLabel">
        <template #leading><component :is="iconFor('download')" :size="16" /></template>
        全部导入
      </Button>
    </div>
  </div>

  <div v-else class="isum">
    <div class="isum-head">
      <component :is="iconFor('layers')" :size="15" />
      <span>识别到 <b>{{ (sections ?? []).length }}</b> 段，请核对{{ hidePhase ? '年/月' : '年/月/期' }}后勾选导入</span>
    </div>

    <div class="isum-table">
      <div class="isum-hr" :class="{ 'no-phase': hidePhase }">
        <span class="isum-col-pick"></span>
        <span class="isum-col-y">年</span>
        <span class="isum-col-m">月</span>
        <span v-if="!hidePhase" class="isum-col-p">期</span>
        <span class="isum-col-n">识别</span>
      </div>

      <div v-for="(r, i) in rows" :key="i" class="isum-row" :class="{ off: !r.checked, 'no-phase': hidePhase }">
        <span class="isum-col-pick">
          <input
            type="checkbox"
            class="isum-cb"
            :checked="r.checked"
            :disabled="!rowValid(r)"
            @change="toggle(r)"
          />
        </span>
        <span class="isum-col-y">
          <input
            type="number"
            class="isum-in"
            :class="{ bad: !validYear(r.year) }"
            v-model.number="r.year"
            placeholder="年"
          />
        </span>
        <span class="isum-col-m">
          <input
            type="number"
            class="isum-in"
            :class="{ bad: !validMonth(r.month) }"
            v-model.number="r.month"
            placeholder="月"
          />
        </span>
        <span v-if="!hidePhase" class="isum-col-p">
          <select class="isum-sel" :class="{ bad: !validPhase(r.phase) }" v-model.number="r.phase">
            <option v-for="o in PHASE_OPTS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </span>
        <span class="isum-col-n">
          <b :class="{ empty: r.records.length === 0 }">{{ r.records.length }}</b> 户
        </span>
      </div>
    </div>

    <div class="isum-foot">
      <Button variant="filled" :disabled="!anyPick" @click="confirm">
        <template #leading><component :is="iconFor('download')" :size="16" /></template>
        全部导入
      </Button>
    </div>
  </div>
</template>

<style scoped>
.isum { display:flex; flex-direction:column; gap:14px; }
.isum-head { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text-secondary); background:var(--surface-card); padding:10px 12px; border-radius:var(--radius-md); }
.isum-head b { font-family:var(--font-mono); color:var(--text-primary); margin:0 2px; }

.isum-table { border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; }
.isum-hr, .isum-row { display:grid; grid-template-columns:44px 1fr 72px 96px 88px; align-items:center; gap:8px; padding:8px 12px; }
.isum-hr.no-phase, .isum-row.no-phase { grid-template-columns:44px 1fr 72px 88px; }  /* 工资分段:无期列 */
.isum-hr.label-only, .isum-row.label-only { grid-template-columns:44px 1fr 88px; }  /* 纯标签段:只 段标签 + N条 */
.isum-col-label { font-size:12.5px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.isum-hr { background:var(--surface-card); border-bottom:1px solid var(--divider); font-size:11px; font-weight:var(--fw-semibold); color:var(--text-muted); }
.isum-row { border-bottom:1px solid var(--divider); }
.isum-row:last-child { border-bottom:none; }
.isum-row.off { opacity:.6; }

.isum-col-n { font-size:12px; color:var(--text-muted); text-align:right; }
.isum-col-n b { font-family:var(--font-mono); color:var(--text-primary); font-weight:var(--fw-semibold); }
.isum-col-n b.empty { color:var(--hue-red); }

.isum-cb { width:16px; height:16px; cursor:pointer; accent-color:var(--ink-900); }
.isum-cb:disabled { cursor:not-allowed; opacity:.5; }

.isum-in, .isum-sel { width:100%; box-sizing:border-box; height:30px; border:1px solid var(--border-subtle); border-radius:6px; padding:0 8px; font-family:var(--font-sans); font-size:12.5px; color:var(--text-primary); background:var(--surface-white); outline:none; }
.isum-in:focus, .isum-sel:focus { border-color:var(--hue-blue); }
.isum-in.bad, .isum-sel.bad { border-color:var(--hue-red); background:rgb(252,235,233); }

.isum-foot { display:flex; justify-content:flex-end; }
</style>
