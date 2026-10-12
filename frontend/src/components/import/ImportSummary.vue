<!-- Copyright (c) 2026 Junyang. All rights reserved. -->
<script setup lang="ts">
// 导入弹窗 · 核对页的分段表(md-v2-secs):一句「认出 N 段 M 行」+ 每段一行 [勾][文件里的标题][月份][期区][行数]。
// 三种段:按年月 + 期区(附表10)/ 按年月(工资)/ 只有标题(labelOnly:光伏、抄表多表、合同、三大报表、预算……少月份、期区两列)。
// 识别到的预填,缺的用缺省值(导入中心点期区胶囊传进来的、屏上的当前月);还缺期区的那段标橙、不勾,选了就勾上。
// 导不了的段(reason:表头认不出 / 没数据 / 须先建合同……)标橙、不勾、勾不上,原因写在标题下面。
// 按钮不在这里:弹窗底栏那一颗读 picks / count(defineExpose),「导入 3 段 · 255 行」只此一处。
import { reactive, computed } from 'vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import type { Section } from '@/utils/importSections'
import type { ImportRec } from '@/utils/importHeaderMatch'

export type LabelSection = { label: string; records: ImportRec[]; checked?: boolean; reason?: string }

const props = withDefaults(defineProps<{
  sections?: Section[]
  defaultYear?: number
  defaultMonth?: number
  defaultPhase?: number
  hidePhase?: boolean   // 工资分段:没有期区
  labelOnly?: boolean
  labelSections?: LabelSection[]
  unit?: string
}>(), { hidePhase: false, labelOnly: false, unit: '行' })

const PHASE_OPTS = [
  { value: '1', label: '一期' },
  { value: '2', label: '二期' },
  { value: '3', label: '三期' },
  { value: '4', label: '宿舍' },
]

interface Row { title: string; ym: string; phase: string; records: ImportRec[]; reason?: string; checked: boolean }

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymOk = (ym: string) => /^\d{4}-\d{2}$/.test(ym)
const valid = (r: Row) => props.labelOnly || (ymOk(r.ym) && (props.hidePhase || r.phase !== ''))
const canPick = (r: Row) => r.records.length > 0 && !r.reason && valid(r)

const rows = reactive<Row[]>(props.labelOnly
  ? (props.labelSections ?? []).map(s => ({ title: s.label, ym: '', phase: '', records: s.records, reason: s.reason, checked: false }))
  : (props.sections ?? []).map(s => {
      const y = s.year ?? props.defaultYear, m = s.month ?? props.defaultMonth
      return {
        title: s.title ?? '', ym: y && m ? `${y}-${pad2(m)}` : '', phase: String(s.phase ?? props.defaultPhase ?? ''),
        records: s.records, reason: s.reason, checked: false,
      }
    }))
// 能导的默认勾上;合同计费行「同名几份合同选其一」那几段 checked:false 进来就不勾
rows.forEach((r, i) => { r.checked = canPick(r) && (!props.labelOnly || props.labelSections![i].checked !== false) })

/** 缺月份 / 期区的段:补上就勾(「选一下」就够了,不用再点一次勾) */
function setYm(r: Row, v: string | null) { const was = valid(r); r.ym = v ?? ''; if (!was && canPick(r)) r.checked = true }
function setPhase(r: Row, v: string) { const was = valid(r); r.phase = v; if (!was && canPick(r)) r.checked = true }
function toggle(r: Row) { r.checked = canPick(r) && !r.checked }

/** 标题下那行橙字:导不了的原因 / 缺什么。
 *  附表10 的标题认得出才成段(要有年月 + 已知期区),所以缺月份 / 期区的几乎都是没有标题的那一块;
 *  图上「标题里的「宿舍楼」认不出…」那种,解析器给不出是哪个词认不出,不硬写 */
function note(r: Row): string {
  if (r.reason) return r.reason
  if (props.labelOnly || !r.records.length) return ''
  const head = r.title ? '标题里认不出' : '没有标题，看不出'
  if (!ymOk(r.ym)) return `${head}是哪个月，选一下`
  if (!props.hidePhase && !r.phase) return `${head}是哪个期区，选一下`
  return ''
}

const picked = computed(() => rows.filter(r => r.checked && canPick(r)))
const total = computed(() => rows.reduce((a, r) => a + r.records.length, 0))
const needPhase = computed(() => props.labelOnly || props.hidePhase ? 0 : rows.filter(r => !r.reason && r.records.length && !r.phase).length)
const needYm = computed(() => props.labelOnly ? 0 : rows.filter(r => !r.reason && r.records.length && !ymOk(r.ym)).length)
const blocked = computed(() => rows.filter(r => r.reason).length)

const picks = computed(() => props.labelOnly
  ? picked.value.map(r => ({ label: r.title, records: r.records }))
  : picked.value.map(r => ({
      year: Number(r.ym.slice(0, 4)), month: Number(r.ym.slice(5, 7)),
      ...(props.hidePhase ? {} : { phase: Number(r.phase) }), records: r.records,
    })))
/** 勾上的段的行数(底栏「导入 3 段 · 255 行」) */
const count = computed(() => picked.value.reduce((a, r) => a + r.records.length, 0))
defineExpose({ picks, count })

const numHead = computed(() => (props.unit === '行' ? '行数' : props.unit))
</script>

<template>
  <div class="isum">
    <div class="isum-sum">
      认出 <b>{{ rows.length }}</b> 段 <b>{{ total.toLocaleString('en-US') }}</b> {{ unit }}<template v-if="needYm">，<span class="w"><b>{{ needYm }}</b> 段要选月份</span></template><template v-if="needPhase">，<span class="w"><b>{{ needPhase }}</b> 段要选期区</span></template><template v-if="blocked">，<span class="w"><b>{{ blocked }}</b> 段导不了</span></template>
    </div>
    <div class="isum-tw">
      <table class="isum-tbl">
        <thead><tr>
          <th class="c-pick" />
          <th>文件里的标题</th>
          <th v-if="!labelOnly" class="c-ym">月份</th>
          <th v-if="!labelOnly && !hidePhase" class="c-ph">期区</th>
          <th class="r">{{ numHead }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" class="isum-row" :class="{ off: !r.checked, bad: !!r.reason }">
            <td class="c-pick">
              <input type="checkbox" class="isum-cb" :aria-label="'导入这一段:' + (r.title || '没有标题')"
                     :checked="r.checked" :disabled="!canPick(r)" @change="toggle(r)" />
            </td>
            <td class="isum-t">
              <span :class="{ none: !r.title }">{{ r.title || '没有标题' }}</span>
              <div v-if="note(r)" class="isum-why">{{ note(r) }}</div>
            </td>
            <td v-if="!labelOnly" class="c-ym">
              <DatePicker :model-value="r.ym || null" mode="month" size="sm" placeholder="选月份" aria-label="月份"
                          :disabled="!!r.reason" @update:model-value="setYm(r, $event as string | null)" />
            </td>
            <td v-if="!labelOnly && !hidePhase" class="c-ph">
              <span class="isum-sel" :class="{ warn: !r.reason && r.records.length > 0 && !r.phase }">
                <Select size="sm" :options="PHASE_OPTS" placeholder="选期区" :disabled="!!r.reason"
                        :model-value="r.phase" @update:model-value="setPhase(r, $event)" />
              </span>
            </td>
            <td class="r mono">{{ r.records.length.toLocaleString('en-US') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* 照 md-v2-secs:表头 32 高、行 52 高;不能 overflow:hidden —— 期区下拉、月份面板要伸出表外 */
.isum { display:flex; flex-direction:column; gap:12px; }
.isum-sum { font-size:var(--fs-body); color:var(--text-primary); }
.isum-sum b { font-family:var(--font-mono); font-weight:var(--fw-semibold); }
.isum-sum .w { color:var(--caution-text); }
.isum-tw { border:1px solid var(--border-subtle); border-radius:var(--radius-md); }
.isum-tbl { width:100%; border-collapse:separate; border-spacing:0; }
.isum-tbl th { height:32px; padding:0 10px; text-align:left; font-size:var(--fs-micro); font-weight:var(--fw-semibold); color:var(--text-muted); background:var(--surface-card); border-bottom:1px solid var(--divider); white-space:nowrap; }
.isum-tbl th:first-child { border-top-left-radius:var(--radius-md); }
.isum-tbl th:last-child { border-top-right-radius:var(--radius-md); }
.isum-tbl td { height:52px; padding:0 10px; font-size:var(--fs-label); color:var(--text-secondary); border-bottom:1px solid var(--divider); }
.isum-tbl tr:last-child td { border-bottom:none; }
.isum-tbl .r { text-align:right; }
.isum-tbl .mono { font-family:var(--font-mono); }
.c-pick { width:16px; }
.c-ym { width:120px; }
.c-ph { width:104px; }
.isum-t .none { color:var(--text-muted); }
.isum-why { font-size:var(--fs-micro); color:var(--caution-text); margin-top:2px; }
.isum-cb { width:14px; height:14px; margin:0; cursor:pointer; accent-color:var(--ink-900); vertical-align:middle; }
.isum-cb:disabled { cursor:not-allowed; }
.isum-sel { display:block; }
/* 缺期区:描橙边(ds/Select 的边框走 --ds-sel-border 变量桥) */
.isum-sel.warn :deep(.ds-sel-trigger) { --ds-sel-border: var(--status-warning); }
</style>
