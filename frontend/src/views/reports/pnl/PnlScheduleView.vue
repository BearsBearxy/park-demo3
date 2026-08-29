<script setup lang="ts">
// 损益附表 1–5 — 一个参数化 View 服务 5 条路由(P2-D spec D4,charging 7/8 先例)。
// 路由 meta.value → PNL_SCHEDULES config(App.vue KeepAlive key=value:epoch,5 条路由 value 不同不串台)。
// 动线:⓪ SchedYearGate(年份门,P1 惯例) → 年度矩阵(SchedHeader + PnlTable)。
// 编辑态:单元格金额 draft(rowKey|monthIdx,null↔数值)/逐行备注/新增行(居中弹窗 §7,kind 自动识)/多选批量删行(J7,§7 确认,沿单删 draft 语义),
// 保存 = PUT 整年 clear+insert(rows 重建 rowKey r<n> + sortOrder);退出有改动走 SaveConfirmDialog。
// §6:overview 加载门;切年不清 data(旧表保留到新数据落位,模板按 data.year===year 把关) + seq 竞态守卫。
// 导入:registry pnl_s1..s5(sheetMatch 挑表 + 年自动识,识别年 ≠ 当前年时自动切年)。
// 派生对照(P2-G):进年明细懒加载 loadDeriveData(缓存 per year,失败静默不阻塞 G6);
// 每行 compareRow+derived 传 PnlTable;填入只填空格进 draft,保存走现有 PUT(G3)。
// 派生生成(P2-G2):进年两侧就绪(loadYear+loadDerive)后 tryGenerate 补缺失映射行并 PUT 落库;
// 每年会话内只试一次(generatedYears,成败都记);导入路径不触发(H6:下次进年补回)。
import { ref, computed, onMounted } from 'vue'
import { S } from '@/utils/lockScopes'
import { useRoute } from 'vue-router'
import { pnlApi } from '@/api/pnl'
import { PNL_SCHEDULES, detectKind, rowYearTotal } from '@/reports/pnlSchedules'
import { loadDeriveData, deriveRow, compareRow, fillRow, generateMissingRows, isMappedRow, type DeriveData, type CompareResult } from '@/reports/pnlDerive'
import { parserProps, runImport } from '@/utils/importRegistry'
import type { PnlOverviewDTO, PnlYearDTO, PnlRowDTO, PnlKind } from '@/types/pnl'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import { REPORT_STEPS, periodQuery, parsePeriodQuery, periodLabel } from '@/nav/reportPeriod'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import PnlTable from './PnlTable.vue'

// ── 路由 → config(一 View 五值) ──────────────────────────
const route = useRoute()
const meta = route.meta as { value?: string; icon?: string }
const config = PNL_SCHEDULES.find(c => c.route === meta.value) ?? PNL_SCHEDULES[0]
const icon = meta.icon ?? 'trending-up'
const sub = `园区全局年度矩阵 · ${config.groupCol} × 科目细分 × 12 月 · 单位:元`

// ── 状态机 ───────────────────────────────────────────────
const year = ref<number | null>(null)     // null → ⓪ 年份选择层
const overview = ref<PnlOverviewDTO | null>(null)  // §6 加载信号
const data = ref<PnlYearDTO | null>(null)
const edit = ref(false)
const saving = ref(false)

// ⓪ overview.years → YearCard;最新年 = 最大数据年(无数据年则最大年,确定性不耦合时钟)
const sortedYears = computed(() => [...(overview.value?.years ?? [])].sort((a, b) => a.year - b.year))
const yearCards = computed<YearCard[]>(() =>
  sortedYears.value.map(y => ({
    year: y.year,
    hasData: y.hasData,
    metric: y.rowCount + ' 行',
    label: '已录入科目细分行',
  })),
)
const currentYear = computed(() => {
  const ys = sortedYears.value
  const withData = ys.filter(y => y.hasData)
  return (withData.length ? withData[withData.length - 1] : ys[ys.length - 1])?.year ?? 0
})

// 期间条(设计稿 §3.2c)。本屏是**园区全局整年一张表**,没有月与公司维度 ——
// 但从三大报表跳过来时那两样在 query 里,得原样带回去,否则跳回利润表就丢了月份。
const carry = parsePeriodQuery(route.query as Record<string, unknown>)
const stripLabel = computed(() => periodLabel(year.value ?? 0, null, null))
const stripQuery = computed(() =>
  periodQuery(year.value ?? 0, carry?.month ?? null, carry?.companyId ?? null))

// ── 进入屏:overview(§6 取数前不渲染);深链 ?y= 直落该年(分析层 budget/pnl-analysis 与报表中心都带年) ──
onMounted(async () => {
  overview.value = await pnlApi.overview(config.schedule)
  const y = carry?.year ?? Number(route.query.y)
  if (Number.isInteger(y) && y >= 2000 && y <= 2100) await pickYear(y)
})
async function reloadOverview() {
  overview.value = await pnlApi.overview(config.schedule)
}

// 竞态守卫:快速切年只接受最新一次请求的结果(防乱序落表)
let yearSeq = 0
async function loadYear(y: number) {
  const seq = ++yearSeq
  const d = await pnlApi.year(config.schedule, y)
  if (seq !== yearSeq) return
  data.value = d
}

// ── 派生对照(P2-G):按年懒加载缓存,切年重拉,失败静默不阻塞(G6) ──
const deriveCache = new Map<number, DeriveData>()
const deriveData = ref<DeriveData | null>(null)
async function loadDerive(y: number) {
  deriveData.value = deriveCache.get(y) ?? null   // 同步切换,不串年
  if (deriveCache.has(y)) return
  try {
    const d = await loadDeriveData(y)
    deriveCache.set(y, d)
    if (year.value === y) deriveData.value = d    // 迟到结果不覆盖已切走的年
  } catch { /* 失败静默:该年不显派生(G6) */ }
}

// ── 派生生成(P2-G2):缺失映射行自动生成落库(H1) ──────────
const generatedYears = new Set<number>()   // 每年会话内只试一次,成败都记(防循环)
async function tryGenerate(y: number) {
  if (year.value !== y || edit.value || generatedYears.has(y)) return   // 竞态/编辑态守卫
  const d = data.value
  const dv = deriveData.value
  if (!d || d.year !== y || !dv) return   // 两侧就绪才生成(派生失败 dv=null 不消耗尝试)
  generatedYears.add(y)
  const gen = generateMissingRows(config.schedule, d.rows, dv)
  if (!gen) return
  try {
    await pnlApi.save(config.schedule, y, { rows: gen.rows })   // 走现有整年 PUT(H5 零后端)
    if (year.value !== y || edit.value) return   // PUT 期间切年/进编辑 → 不覆写当前视图
    await loadYear(y)         // 重拉:生成行获正式 rowKey,overlay 徽标照常渲染(初始已证√)
    await reloadOverview()    // 年份门行数立即同步(H1)
  } catch { /* PUT/重拉失败静默:表照常显示(H1) */ }
}

// 命中行 rowKey → 对照结果+派生序列(displayRows 已套 draft,编辑中实时重比)
const rowDerive = computed<Record<string, CompareResult & { derived: (number | null)[] }>>(() => {
  const d = deriveData.value
  if (!d) return {}
  const out: Record<string, CompareResult & { derived: (number | null)[] }> = {}
  for (const r of displayRows.value) {
    const derived = deriveRow(config.schedule, r.label, d)
    if (derived) out[r.rowKey] = { ...compareRow(r.m, derived), derived }
  }
  return out
})

// 映射行 rowKey 集(P2-G3 J1):静态判定,编辑态月格只读+不可删(值仅来自数据层)
const mappedKeys = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const r of displayRows.value)
    if (isMappedRow(config.schedule, r.groupLabel, r.label)) s.add(r.rowKey)
  return s
})

// 填入(G3):fillRow 只填空格,变化格写 draft(不整行覆写,dirty 只计实际填入格)
function onFill(rowKey: string) {
  const rd = rowDerive.value[rowKey]
  const row = displayRows.value.find(r => r.rowKey === rowKey)
  if (!rd || !row) return
  const filled = fillRow(row.m, rd.derived)
  const m = { ...draftM.value }
  for (let i = 0; i < 12; i++) if (filled[i] !== row.m[i]) m[`${rowKey}|${i}`] = filled[i]
  draftM.value = m
}
function fillAllDerived() {
  for (const key of Object.keys(rowDerive.value)) onFill(key)
}

// ── 状态迁移(切年不清 data:旧表保留到新数据落位,防闪) ────
async function pickYear(y: number) {
  year.value = y
  resetEdit()
  const derive = loadDerive(y)   // 不 await:派生失败/慢不阻塞进表
  await loadYear(y)
  void derive.then(() => tryGenerate(y))   // 两侧就绪才检查;缓存命中 promise 已解同样触发
}
function goGate() {
  // 有未保存改动先走保存确认,不静默丢
  if (edit.value && dirty.value > 0) { saveConfirm.value = true; return }
  year.value = null
  resetEdit()
}

// ── 编辑草稿(金额 rowKey|monthIdx / 备注 rowKey / 增删行) ──
const draftM = ref<Record<string, number | null>>({})
const draftNote = ref<Record<string, string>>({})
const added = ref<PnlRowDTO[]>([])
const removed = ref<Set<string>>(new Set())
let addSeq = 0
const dirty = computed(() =>
  Object.keys(draftM.value).length + Object.keys(draftNote.value).length +
  added.value.length + removed.value.size,
)

// 表格显示行:读态 = 服务端行;编辑态 = 服务端行 ∪ 新增行,剔除删行,套 draft。
const displayRows = computed<PnlRowDTO[]>(() => {
  const base = data.value?.rows ?? []
  if (!edit.value) return base
  return base.concat(added.value)
    .filter(r => !removed.value.has(r.rowKey))
    .map(r => ({
      ...r,
      note: r.rowKey in draftNote.value ? (draftNote.value[r.rowKey] || null) : r.note,
      m: r.m.map((v, i) => {
        const k = `${r.rowKey}|${i}`
        return k in draftM.value ? draftM.value[k] : v
      }),
    }))
})

function onInput(rowKey: string, monthIdx: number, v: number | null) {
  draftM.value = { ...draftM.value, [`${rowKey}|${monthIdx}`]: v }
}
function onNote(rowKey: string, text: string) {
  draftNote.value = { ...draftNote.value, [rowKey]: text }
}
function onRemove(rowKey: string) {
  const ai = added.value.findIndex(r => r.rowKey === rowKey)
  if (ai >= 0) {
    added.value.splice(ai, 1)
    // 清掉该新增行的草稿,避免幽灵 dirty
    const m = { ...draftM.value }
    for (const k of Object.keys(m)) if (k.startsWith(rowKey + '|')) delete m[k]
    draftM.value = m
    if (rowKey in draftNote.value) {
      const n = { ...draftNote.value }; delete n[rowKey]; draftNote.value = n
    }
  } else {
    const s = new Set(removed.value); s.add(rowKey); removed.value = s
  }
  // 已删行同步剔出选集(防幽灵计数)
  if (selected.value.has(rowKey)) {
    const s = new Set(selected.value); s.delete(rowKey); selected.value = s
  }
}
function resetEdit() {
  edit.value = false
  draftM.value = {}; draftNote.value = {}
  added.value = []; removed.value = new Set()
  selected.value = new Set(); delConfirm.value = false
  saveConfirm.value = false
}

// ── 批量删除(P2-G3 J7):行首复选多选 → §7 确认 → 循环既有单删(draft 移除,随保存落库) ──
const selected = ref<Set<string>>(new Set())
const delConfirm = ref(false)
function onToggleSelect(rowKey: string) {
  const s = new Set(selected.value)
  if (s.has(rowKey)) s.delete(rowKey); else s.add(rowKey)
  selected.value = s
}
function removeSelected() {
  delConfirm.value = false
  for (const key of [...selected.value]) onRemove(key)
}

// ── 新增行(居中弹窗 §7:分组 datalist 自填 + 科目细分,kind=detectKind 自动) ──
const addDlg = ref(false)
const addGroup = ref('')
const addLabel = ref('')
const addErr = ref('')
const groupOptions = computed(() =>
  [...new Set(displayRows.value.map(r => r.groupLabel).filter(Boolean))],
)
const KIND_TEXT: Record<PnlKind, string> = { detail: '明细', subtotal: '小计', pnl: '损益', total: '合计' }
const addKind = computed(() => detectKind(addLabel.value.trim()))
function openAdd() {
  addGroup.value = displayRows.value[displayRows.value.length - 1]?.groupLabel ?? ''
  addLabel.value = ''; addErr.value = ''
  addDlg.value = true
}
function submitAdd() {
  const label = addLabel.value.trim()
  if (!label) { addErr.value = '请输入科目细分名称'; return }
  added.value = [...added.value, {
    rowKey: `n${++addSeq}`,
    groupLabel: addGroup.value.trim(),
    label,
    kind: addKind.value,
    note: null,
    m: Array(12).fill(null),
    sortOrder: 0,   // 保存时按最终行序重建
  }]
  addDlg.value = false
}

// ── 保存(PUT 整年 clear+insert;rowKey 重建 r<n> + sortOrder) / 退出确认 ──
const saveConfirm = ref(false)
// ── 被接管时的「复制我的改动」:改值/改备注/新增行/删除行 四类各一段 ──
// 草稿是覆盖层(draftM/draftNote/added/removed),被踢后 resetEdit 整层清掉 —— 不复制就丢。
function draftAsTsv(): string {
  const TAB = '\t', NL = '\n'
  const rows = data.value?.rows ?? []
  const labelOf = (k: string) => {
    const r = rows.find(x => x.rowKey === k) ?? added.value.find(x => x.rowKey === k)
    return r ? `${r.groupLabel}·${r.label}` : k
  }
  const out: string[] = [['类别', '行', '月', '值'].join(TAB)]
  for (const [k, v] of Object.entries(draftM.value)) {
    const [rowKey, mi] = k.split('|')
    out.push(['改值', labelOf(rowKey), `${Number(mi) + 1}月`, v == null ? '' : String(v)].join(TAB))
  }
  for (const [k, v] of Object.entries(draftNote.value))
    out.push(['改备注', labelOf(k), '', v].join(TAB))
  for (const r of added.value)
    out.push(['新增行', `${r.groupLabel}·${r.label}`, '全年', r.m.map(x => x ?? '').join('、')].join(TAB))
  for (const k of removed.value)
    out.push(['删除行', labelOf(k), '', ''].join(TAB))
  return out.join(NL)
}

function toggleEdit(forced = false) {
  // forced = 锁已没了(同 S10.finishEdit):脏检查确认框在失锁后只是一个无锁写入口
  if (forced) { resetEdit(); return }
  if (!edit.value) { edit.value = true; return }
  if (dirty.value > 0) { saveConfirm.value = true; return }
  resetEdit()   // 无改动退出也走 reset:清选集(J7)
}
async function save() {
  if (year.value == null) return
  saveConfirm.value = false
  saving.value = true
  try {
    const rows = displayRows.value.map((r, i) => ({ ...r, rowKey: `r${i + 1}`, sortOrder: i }))
    yearSeq++   // 使在途 GET 过期,PUT 返回值即最新
    data.value = await pnlApi.save(config.schedule, year.value, { rows })
    resetEdit()
    await reloadOverview()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}
function discard() {
  resetEdit()
}

// ── 导入(registry pnl_s{n}:整年 clear+insert;年优先取识别年,失败回退当前年槽) ──
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
async function onImport(recs: ImportRec[], fileName: string) {
  if (year.value == null) return
  importing.value = false
  try {
    const res = await runImport('pnl_' + config.schedule, recs, { year: year.value }, fileName)
    importResult.value = res
    // 实际落库年(run 回传 __usedYear)≠ 当前年 → 切到该年再刷新
    const used = (res as ImportResultDTO & { __usedYear?: number }).__usedYear
      ?? (recs[0]?.__yearDetected as number | null) ?? year.value
    resetEdit()
    if (used !== year.value) year.value = used
    void loadDerive(used)   // 导入可能切年,派生跟随(缓存命中则瞬时)
    await loadYear(used)
    await reloadOverview()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 导出 xlsx(适配层内部懒加载 exceljs,列序对齐屏表:分组|科目细分|12月|本年合计|备注) ──
async function onExport() {
  if (!data.value || year.value == null) return
  try {
    const { writeAoaWorkbook } = await import('@/utils/sheet')
    const header = [config.groupCol, '科目细分', ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), '本年合计', '备注']
    const body = displayRows.value.map(r => [
      r.groupLabel, r.label, ...r.m.map(v => v ?? ''), rowYearTotal(r.m) ?? '', r.note ?? '',
    ])
    await writeAoaWorkbook(`${config.title.replace(/\s*·\s*/, '-')}-${year.value}年.xlsx`,
      [{ name: `${year.value}年`, aoa: [header, ...body] }])
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}
</script>

<template>
  <!-- §6 加载门:overview 到达前显转圈,不闪空态 -->
  <template v-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      :scope-of="(y) => S.pnl(config.schedule, y)"
      v-if="year === null"
      :icon="icon"
      :title="config.title"
      :sub="sub + ' · 先选择年份,再进入对应年度的明细矩阵'"
      :years="yearCards"
      :current="currentYear"
      :store-key="config.storeKey"
      footer="每个年份是一份独立的年度矩阵;小计/损益/合计行存文件原值,编辑明细不自动重算。"
      @pick="pickYear"
    />

    <!-- 年度矩阵(切年不清 data:按 data.year===year 把关,不显旧年数据) -->
    <template v-else-if="data && data.year === year">
      <div class="pnl-page">
        <!-- 期间条(设计稿 §3.2c):九张报表横跳不换期。本屏是整年一张表,条上只写年份 -->
        <FPStepStrip :steps="REPORT_STEPS" :current="config.route" :period="stripLabel"
                     :query="stripQuery" back-label="换年" @back="goGate" />
        <SchedHeader
          :scope="S.pnl(config.schedule, year)"
          :icon="icon"
          :title="config.title"
          :sub="sub"
          :year="year"
          :edit="edit"
          perm="report:edit"
          @back="goGate"
          @toggle-edit="toggleEdit"
         :show-import="true" @import="importing = true" :import-disabled="saving" :dirty="dirty"
         :copy-text="draftAsTsv">
          <template #edit-actions>
            <Button v-if="selected.size" variant="danger" size="sm" :disabled="saving" @click="delConfirm = true">
              <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
              删除所选 ({{ selected.size }})
            </Button>
            <Button
              v-if="Object.keys(rowDerive).length"
              variant="outline" size="sm" :disabled="saving" @click="fillAllDerived"
            >
              <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
              全部填入派生值
            </Button>
            <Button variant="outline" size="sm" :disabled="saving" @click="openAdd">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增行
            </Button>
          </template>
          <template #static-actions>
            <Button variant="outline" size="sm" @click="onExport">
              <template #leading><component :is="iconFor('download')" :size="14" /></template>
              导出
            </Button>
          </template>
        </SchedHeader>

        <PnlTable
          :year="year"
          :rows="displayRows"
          :group-col="config.groupCol"
          :edit="edit"
          :derive="rowDerive"
          :mapped-keys="mappedKeys"
          :selected="selected"
          @input="onInput"
          @note="onNote"
          @toggle-select="onToggleSelect"
          @add="openAdd"
          @fill="onFill"
        />

        <p class="pnl-foot">
          <component :is="iconFor('info')" :size="13" />
          单位:元 · 「–」为未录(区分 0) · 本年合计为客户端派生不落库 · 小计/损益/合计行存文件原值,编辑明细不自动重算
        </p>
      </div>
    </template>

    <!-- 切年过渡兜底转圈(§6.2 v-else 紧邻状态链) -->
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>

  <!-- 弹窗一律放状态链之后(§6.2) -->
  <!-- 新增行(居中弹窗 §7,样式基准 SchedYearGate .sm-ydlg) -->
  <div v-if="addDlg" class="pnl-mask" @mousedown="addDlg = false">
    <div class="pnl-dlg" @mousedown.stop>
      <div class="pnl-dlg-h">
        <h3>新增行</h3>
        <p>新增一行科目细分;名称含「小计 / 损益 / 合计」将自动识别为对应汇总分带样式。</p>
      </div>
      <div class="pnl-dlg-b">
        <label class="pnl-lbl">{{ config.groupCol }}(分组)</label>
        <input
          class="pnl-in" v-model="addGroup" list="pnl-group-options"
          placeholder="选择或输入分组,可留空"
        />
        <datalist id="pnl-group-options">
          <option v-for="g in groupOptions" :key="g" :value="g" />
        </datalist>
        <label class="pnl-lbl">科目细分</label>
        <input
          class="pnl-in" :class="{ err: !!addErr }" v-model="addLabel"
          placeholder="如:一期租金收入" @keydown.enter="submitAdd"
        />
        <div class="pnl-kind">识别为:<b>{{ KIND_TEXT[addKind] }}</b></div>
        <div class="pnl-derr">{{ addErr }}</div>
      </div>
      <div class="pnl-dlg-f">
        <button class="pnl-btn gray" @click="addDlg = false">取消</button>
        <button class="pnl-btn filled" @click="submitAdd"><component :is="iconFor('check')" :size="14" />新增</button>
      </div>
    </div>
  </div>

  <!-- 批量删除确认(§7 居中,基准本屏 .pnl-mask/.pnl-dlg) -->
  <div v-if="delConfirm" class="pnl-mask" @mousedown="delConfirm = false">
    <div class="pnl-dlg" role="dialog" aria-modal="true" @mousedown.stop>
      <div class="pnl-dlg-h">
        <h3>删除所选行</h3>
        <p>已勾选的 {{ selected.size }} 行将从 {{ year }} 年矩阵中删除,点击「保存」后落库,「取消」编辑可放弃。注意:本表小计/损益/合计行也是存值行,若在所选中会一并删除,不会自动重算。</p>
      </div>
      <div class="pnl-dlg-f">
        <button class="pnl-btn gray" @click="delConfirm = false">取消</button>
        <button class="pnl-btn red" @click="removeSelected"><component :is="iconFor('trash-2')" :size="14" />删除 {{ selected.size }} 行</button>
      </div>
    </div>
  </div>

  <SaveConfirmDialog
    v-if="saveConfirm"
    :count="dirty"
    @save="save"
    @discard="discard"
    @close="saveConfirm = false"
  />

  <!-- 导入(解析配置出自 registry 单一事实源;年从标题自动识,识别年 ≠ 当前年将自动切年) -->
  <FpImportModal
    v-if="importing"
    :title="`导入 ${config.title} · ${year}年`"
    sub="从年度统计母册导入该附表(整年替换);上传含该 sheet 的工作簿或粘贴该表,年份从标题自动识别,识别不到按当前年导入"
    v-bind="parserProps('pnl_' + config.schedule)"
    @close="importing = false"
    @import="onImport"
  />

  <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
</template>

<style scoped>
.pnl-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }
.pnl-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* 新增行弹窗(基准 SchedYearGate .sm-ymask/.sm-ydlg) */
.pnl-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:140; display:grid; place-items:center; }
.pnl-dlg { width:min(408px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22); overflow:hidden; }
.pnl-dlg-h { padding:20px 22px 0; }
.pnl-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.pnl-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.pnl-dlg-b { padding:16px 22px 4px; display:flex; flex-direction:column; }
.pnl-lbl { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin:0 0 6px; }
.pnl-lbl + .pnl-in { margin-bottom:12px; }
.pnl-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:14px; color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.pnl-in:focus { border-color:var(--hue-blue); }
.pnl-in.err { border-color:var(--hue-red); }
.pnl-kind { font-size:12px; color:var(--text-muted); margin-top:2px; }
.pnl-kind b { color:var(--text-secondary); font-weight:var(--fw-semibold); margin-left:2px; }
.pnl-derr { font-size:11.5px; color:var(--hue-red); margin-top:6px; min-height:14px; }
.pnl-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:14px 22px 20px; }
.pnl-btn { height:34px; padding:0 16px; border-radius:var(--radius-full); border:none; cursor:pointer; font-family:var(--font-sans); font-size:13px; font-weight:var(--fw-medium); display:inline-flex; align-items:center; gap:6px; transition:background var(--dur-fast) var(--ease-standard); }
.pnl-btn.gray { background:var(--surface-sunken); color:var(--text-secondary); }
.pnl-btn.gray:hover { background:var(--ink-100); }
.pnl-btn.filled { background:var(--ink-900); color:#fff; }
.pnl-btn.filled:hover { background:rgb(58,58,58); }
.pnl-btn.red { background:var(--hue-red); color:#fff; }   /* 同 ds/Button danger */
.pnl-btn.red:hover { background:rgb(224,49,39); }
</style>
