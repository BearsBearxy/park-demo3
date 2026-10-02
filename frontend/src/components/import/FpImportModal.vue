<script lang="ts">
// sheetMatch 选表:正则命中的第一个 sheet 名,未命中/未给回退第一个。抽出小函数便测。
export function pickSheet(names: string[], re?: RegExp): string {
  return (re ? names.find(n => re.test(n)) : undefined) ?? names[0]
}
</script>

<script setup lang="ts">
// 通用「导入 Excel」右滑抽屉(共享引擎)— 1:1 移植 import-excel.jsx FPImportModal。
// 两入口:① 上传 .xlsx/.csv(csv 用 FileReader+内置解析;xlsx 走 utils/sheet.ts 适配层)
//        ② 从 Excel 粘贴(textarea,TSV/CSV)。两者都先解析成二维数组,再交各屏 parseRow 映射。
// .xls 旧格式(BIFF)读不了:适配层底层是 exceljs,只认 xlsx/csv —— 给「另存为」指引,不静默失败。
// 解析结果进预览表(前 6 行)+ 条数 + 错误/成功提示,确认后 onImport(剥 __preview)。
import { ref, computed, watch, reactive, onBeforeUnmount } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import { cell, parsePaste, parseCSV } from '@/utils/importParse'
import { matchByHeader, type ColumnMapEntry } from '@/utils/importHeaderMatch'
import { splitSections, type PhaseLayouts, type Section } from '@/utils/importSections'
import { splitSalarySections } from '@/utils/importSalarySections'
import ImportSummary from './ImportSummary.vue'
import ImportProgressCard from './ImportProgressCard.vue'
import ImportResultCard from './ImportResultCard.vue'
import { addResult, failKind, failReason, importBusy, n0, type ImportDescribe, type ImportOutcome, type ImportRunProgress, type RunState } from './importRun'
import type { ImportResultDTO } from '@/types/import'
import FPNote from '@/components/fp/FPNote.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'

export interface ImportRec { __preview?: unknown[]; [k: string]: unknown }
// 段(期×月 / 工资月 / 纯标签段)与平铺行两种上抛形态
export type SectionPick = { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }
export type ImportPayload = ImportRec[] | SectionPick[]

const props = withDefaults(defineProps<{
  title: string
  sub?: string
  templateCols: string[]
  // 给了 columnMap 即走「按表头名字匹配」(扛多行表头/前置分类列/合计备注列/顺序无关);否则走位置 parseRow
  parseRow?: (cells: string[], i: number) => ImportRec | null
  columnMap?: ColumnMapEntry[]
  nameLabels?: string[]
  skipHeader?: boolean
  // 给了 phaseLayouts 即走「智能整表导入」(多期×多月):解析后 splitSections → ImportSummary → emit importSections
  phaseLayouts?: PhaseLayouts
  // 给了 sectionTitleRe(且有 columnMap、无 phaseLayouts)即走「工资多月分段」:按标题切月 → ImportSummary(隐期) → emit importSections
  sectionTitleRe?: RegExp
  // 给了 customParse 即走自定义解析(优先级次于 parseWorkbook,与其余通路互斥):
  //   返回 records → 复用现有预览表 + 「导入 N 条」按钮,emit import
  //   返回 sections → 复用 ImportSummary 纯标签段模式(每段 label+N条+勾选),emit importSections({label,records}[])
  //   可选 warning:非阻断提示(如预算导入的发生额与系统推算差异),与结果并排显示
  customParse?: (matrix: string[][]) => { records?: ImportRec[]; sections?: { label: string; records: ImportRec[]; checked?: boolean }[]; error?: string; warning?: string } | Promise<{ records?: ImportRec[]; sections?: { label: string; records: ImportRec[]; checked?: boolean }[]; error?: string; warning?: string }>
  // 文件上传按 sheet 名挑表(命中即取,未命中回退第一个);粘贴路径不受影响
  sheetMatch?: RegExp
  // 给了 parseWorkbook 即走多 sheet 解析(优先级最高,先于 customParse):
  //   文件路径解析全部 sheet 传入;粘贴路径包装 [{name:'', matrix}]。返回值语义同 customParse。
  //   第二实参 = 下方补录条的当前值(仅 fallbackPicker 存在时有意义,其余导入器的解析器少收一个参数即可)
  // 可返回 Promise:台账通路解析中会 await ctx.resolveUnmatched 弹「列匹配面板」(BOOK-WORKBENCH-SPEC §4)
  parseWorkbook?: (sheets: { name: string; matrix: string[][] }[], fallback?: { ym: string; zone: string; kind: string }) => { records?: ImportRec[]; sections?: { label: string; records: ImportRec[]; checked?: boolean }[]; error?: string; warning?: string; notice?: string } | Promise<{ records?: ImportRec[]; sections?: { label: string; records: ImportRec[]; checked?: boolean }[]; error?: string; warning?: string; notice?: string }>
  // 给了 fallbackPicker 才渲染「补录条」(账期/分区/类别),且只在解析结果带 notice(= 真用上了补录值)时露出;
  // 不传 = 一行 UI 都不多,其余 20 个导入器零影响。目前仅园区抄表用(账期无法从数据推断,只能问人)。
  fallbackPicker?: { ym: string; zone: string; kind: string; zones: { value: string; label: string }[]; kinds: { value: string; label: string }[] }
  defaultYear?: number
  defaultMonth?: number
  defaultPhase?: number
  // ── 点导入之后(UI-OVERLAY-SPEC §8;协议全文见 ./importRun.ts 头注释)──
  // 给了 runner:点导入后弹窗不关,内容区换进度卡,跑完原地出结果卡 / 失败卡;不给 = 照旧 emit,各屏自己关窗出结果
  runner?: (payload: ImportPayload, fileName: string, p: ImportRunProgress) => Promise<ImportOutcome | null>
  segmented?: boolean   // 逐段(附表10):每段一次请求,画真进度;断了可从断的那段接着导
  confirm?: (payload: ImportPayload, fileName: string) => Promise<boolean>
  describe?: (payload: ImportPayload, fileName: string) => ImportDescribe
  go?: string           // 结果卡多一颗按钮(导入中心「去查看」),点了 emit go
  doneNote?: string     // 结果卡右上「用时 m:ss · 」后那句;缺省按 runner 回报的 refreshed 写「本页已刷新 / 本页没刷新上」
}>(), { skipHeader: true })

const emit = defineEmits<{
  close: []
  go: []
  // 第二实参 fileName 供导入中心记录 import_log(粘贴导入为 '（粘贴）')
  import: [recs: ImportRec[], fileName: string]
  // 期×月段(S10/工资)用 year/month/phase;自定义纯标签段用 label。放宽为可选并集。
  importSections: [picks: { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }[], fileName: string]
}>()

// 工资分段(无期)模式开关:sectionTitleRe + columnMap 且无 phaseLayouts
const salaryMode = computed(() => !!props.sectionTitleRe && !!props.columnMap && !props.phaseLayouts)
// 自定义纯标签段模式:customParse 返回了 sections(非 records)
const labelMode = computed(() => labelSections.value != null)
// 汇总确认屏模式(多段):智能整表 / 工资分段 / 自定义标签段 → 用 ImportSummary 替代模板列/预览/底部导入按钮
const summaryMode = computed(() => !!props.phaseLayouts || salaryMode.value || labelMode.value)

// 智能整表模式状态
const sections = ref<Section[] | null>(null)
// 自定义纯标签段状态(customParse → sections)
const labelSections = ref<{ label: string; records: ImportRec[]; checked?: boolean }[] | null>(null)

const mode = ref<'file' | 'paste'>('file')
const paste = ref('')
const over = ref(false)
const records = ref<ImportRec[] | null>(null)
const err = ref('')
const warn = ref('')   // 非阻断提示(customParse/parseWorkbook 的 warning)
const notice = ref('')   // 补录条提示(parseWorkbook 的 notice:本次用上了下方选的账期)
const fileName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 补录条状态 + 已解析的 sheets(改选项即用新值重解析,不用重新选文件)
const fb = ref({ ym: props.fallbackPicker?.ym ?? '', zone: props.fallbackPicker?.zone ?? '', kind: props.fallbackPicker?.kind ?? '' })
const lastSheets = ref<{ name: string; matrix: string[][] }[] | null>(null)
async function runWorkbook(sheets: { name: string; matrix: string[][] }[]) {
  lastSheets.value = sheets
  applyResult(await props.parseWorkbook!(sheets, fb.value))
}
watch(fb, () => { if (lastSheets.value) runWorkbook(lastSheets.value) }, { deep: true })

// customParse / parseWorkbook 共用的结果落地:records → 既有预览;sections → labelMode 汇总屏
function applyResult(res: { records?: ImportRec[]; sections?: { label: string; records: ImportRec[]; checked?: boolean }[]; error?: string; warning?: string; notice?: string }) {
  const { records: recs, sections: secs, error } = res
  records.value = null; sections.value = null; labelSections.value = null
  warn.value = res.warning ?? ''
  notice.value = res.notice ?? ''
  if (error) { err.value = error; return }
  if (secs) {
    if (!secs.some(s => s.records.length > 0)) { err.value = '已读取数据,但没识别到任何有效记录。'; return }
    err.value = ''; labelSections.value = secs; return
  }
  if (recs) {
    if (!recs.length) { err.value = '已读取数据,但没识别到任何有效记录。'; return }
    err.value = ''; records.value = recs; return
  }
  err.value = '没识别到任何有效记录。'
}

// 二维单元格数组 → 业务记录
async function mapMatrix(matrix: string[][]) {
  if (!matrix || !matrix.length) { err.value = '没有读到任何数据行。'; warn.value = ''; records.value = null; sections.value = null; labelSections.value = null; return }
  // 多 sheet 解析模式(优先级最高):粘贴路径包装为单 sheet;文件路径在 handleFile 已直走 parseWorkbook
  if (props.parseWorkbook) { await runWorkbook([{ name: '', matrix }]); return }
  // 自定义解析模式:各屏自带解析器
  if (props.customParse) { applyResult(await props.customParse(matrix)); return }
  // 智能整表模式:拆段 + 识别年月期 + 版面 → 汇总确认屏
  if (props.phaseLayouts) {
    const secs = splitSections(matrix, props.phaseLayouts, props.nameLabels ?? ['租户名称', '租户'])
    const hasData = secs.some(s => s.records.length > 0)
    if (!hasData) { err.value = '已读取数据,但没识别到任何租户行。请确认含表头与租户名列。'; sections.value = null; return }
    // §4 禁静默丢列:段级未匹配表头(剔除派生/合计类)显式亮警告——附表10 通路先警告不阻断,处置走模板编辑器
    const un = [...new Set(secs.flatMap(x => (x.unmatched ?? []).map(u => u.header)))]
      .filter(h => !/应收合计|本月结余|^序号|合计|^小计|^总计/.test(h))
    warn.value = un.length ? `未匹配列本次已忽略:${un.join('、')} —— 打开「账册模板」为其添加别名或自定义列后重导` : ''
    err.value = ''; sections.value = secs; records.value = null; return
  }
  // 工资多月分段模式:按标题切月 → 每段 matchByHeader → 汇总确认屏(隐期),复用 sections 状态
  if (salaryMode.value) {
    const secs = splitSalarySections(matrix, props.columnMap!, props.nameLabels ?? ['姓名'])
    const hasData = secs.some(s => s.records.length > 0)
    if (!hasData) { err.value = '已读取数据,但没识别到任何员工行。请确认含表头与姓名列。'; sections.value = null; return }
    err.value = ''; sections.value = secs as unknown as Section[]; records.value = null; return
  }
  // columnMap 模式:按表头名字匹配(自动定位表头行 / 忽略前置分类列与合计备注列 / 顺序无关)
  if (props.columnMap) {
    const { records: recs, error } = matchByHeader(matrix, props.columnMap, props.nameLabels ?? ['租户', '租户名称'])
    if (error) { err.value = error; records.value = null; return }
    if (!recs.length) { err.value = '已读取数据,但没识别到租户行。请确认含「租户」列且粘到了对应期的版面。'; records.value = null; return }
    err.value = ''; records.value = recs; return
  }
  // 位置映射模式(parseRow):台账等用
  const body = props.skipHeader && matrix.length > 1 ? matrix.slice(1) : matrix
  const out: ImportRec[] = []
  body.forEach((cells, i) => {
    try { const rec = props.parseRow?.(cells.map(cell), i); if (rec) out.push(rec) } catch { /* 跳过坏行 */ }
  })
  if (!out.length) { err.value = '已读取数据,但没有一行能匹配模板列。请检查列顺序是否与下方模板一致。'; records.value = null; return }
  err.value = ''; records.value = out
}

function handleFile(file: File | undefined) {
  if (!file) return
  fileName.value = file.name
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (ext === 'csv') {
    const fr = new FileReader()
    fr.onload = () => mapMatrix(parseCSV(String(fr.result || '')))
    fr.readAsText(file, 'utf-8')
    return
  }
  if (ext === 'xlsx') {
    const fr = new FileReader()
    fr.onload = async () => {
      try {
        // 适配层懒加载(exceljs 自身也在其内部懒加载),并把日期格归一成 'yyyy-mm-dd'(办公水电月份列
        // 需要)、数字出原始数字串(下游 cleanNum/String 容错,台账/附表10/工资分段不受影响)。
        const { readAoaWorkbook } = await import('@/utils/sheet')
        const sheets = await readAoaWorkbook(fr.result as ArrayBuffer)
        // parseWorkbook:全部 sheet 一并传入(多 sheet 分段);否则 sheetMatch 按名挑单表(未命中回退第一个)
        if (props.parseWorkbook) { await runWorkbook(sheets); return }   // 不 await 会让解析异常逃出 try(审查#24)
        const pick = pickSheet(sheets.map(s => s.name), props.sheetMatch)
        mapMatrix(sheets.find(s => s.name === pick)?.matrix ?? [])
      } catch (e) { err.value = '文件解析失败:' + (e as Error).message }
    }
    fr.readAsArrayBuffer(file)
    return
  }
  if (ext === 'xls') {
    err.value = '.xls 是旧格式,请用 Excel 打开后「另存为」.xlsx 再上传。'
    return
  }
  err.value = '仅支持 .xlsx / .csv 文件。'
}

function doPaste() {
  if (!paste.value.trim()) { err.value = '请先粘贴数据。'; return }
  fileName.value = ''   // 先选过文件再改粘贴:别让粘贴的数据挂着那个文件名进档案变更记录
  mapMatrix(parsePaste(paste.value))
}

function onDrop(e: DragEvent) {
  e.preventDefault(); over.value = false
  handleFile(e.dataTransfer?.files[0])
}

const strip = (rs: ImportRec[]) => rs.map(r => { const { __preview, ...rest } = r; void __preview; return rest })

function doImport() {
  if (!records.value) return
  const recs = strip(records.value), fn = fileName.value || '（粘贴）'
  if (props.runner) void start(recs, fn)
  else emit('import', recs, fn)
}

// 智能整表/工资分段确认:剥 __preview 后逐段上抛(工资模式 phase 缺省)
function onSectionsConfirm(picks: { year: number; month: number; phase?: number; records: ImportRec[] }[]) {
  const ps = picks.map(p => ({ ...p, records: strip(p.records) })), fn = fileName.value || '（粘贴）'
  if (props.runner) void start(ps, fn)
  else emit('importSections', ps, fn)
}

// 自定义纯标签段确认:剥 __preview 后按 label 上抛
function onLabelConfirm(picks: { label: string; records: ImportRec[] }[]) {
  const ps = picks.map(p => ({ label: p.label, records: strip(p.records) })), fn = fileName.value || '（粘贴）'
  if (props.runner) void start(ps, fn)
  else emit('importSections', ps, fn)
}

// ── 点导入之后(D13/D14):弹窗不关,pick → run → done | fail;fail 可「接着导」回 run 或「返回修改」回 pick ──
const ZH_PHASE: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期', 4: '宿舍' }
const segLabel = (p: SectionPick) => p.label ?? [
  p.year != null && p.month != null ? `${p.year} 年 ${p.month} 月` : '',
  p.phase != null ? ZH_PHASE[p.phase] ?? '' : '',
].filter(Boolean).join(' · ')

const phase = ref<'pick' | 'run' | 'done' | 'fail'>('pick')
const busy = computed(() => phase.value === 'run')
const showCard = ref(false)   // 200ms 内跑完不出进度卡,直接出结果(一闪而过的卡比不出更吵)
const run = reactive<RunState>({ seg: false, count: 0, unit: '条', meta: '', steps: [], stage: 0, elapsed: 0, segs: [], done: 0, fail: null, kept: '', wrote: 0 })
const outcome = ref<ImportOutcome | null>(null)
// 刷了什么跟最后一步的名字走(「刷新本页」→ 本页已刷新;科目余额表的「刷新本期」→ 本期已刷新)
const doneNoteText = computed(() => {
  const r = outcome.value?.refreshed
  const what = run.steps[run.steps.length - 1]?.label.replace(/^刷新/, '') || '本页'
  return props.doneNote ?? (r == null ? '' : r ? `${what}已刷新` : `${what}没刷新上`)
})
let job: { payload: ImportPayload; fileName: string; segRes: ImportResultDTO[] } | null = null
let gate: ReturnType<typeof setTimeout> | undefined
let tick: ReturnType<typeof setInterval> | undefined
const stopTimers = () => { clearTimeout(gate); clearInterval(tick) }

let starting = false
async function start(payload: ImportPayload, fn: string) {
  // 防连点:200ms 门内内容区还在,按钮还点得到;confirm 在等(台账覆盖预检先发请求)时 phase 还是 pick,另用 starting 挡
  if (phase.value !== 'pick' || starting) return
  starting = true
  try {
    if (props.confirm && !(await props.confirm(payload, fn))) return
  } finally { starting = false }
  const picks = payload as SectionPick[]
  const isSec = Array.isArray(picks[0]?.records)
  const seg = !!props.segmented && isSec
  const d = props.describe?.(payload, fn) ?? {}
  const unit = d.unit ?? '条'
  const count = d.count ?? (isSec ? picks.reduce((a, p) => a + p.records.length, 0) : payload.length)
  Object.assign(run, {
    seg, count, unit, done: 0, elapsed: 0, kept: '', wrote: 0, fail: null,
    segs: seg ? picks.map(p => ({ label: segLabel(p), n: p.records.length, ok: 0 })) : [],
    meta: d.meta ?? [fn, seg ? `${picks.length} 段` : ''].filter(Boolean).join(' · '),
    steps: (d.steps ?? (seg
      ? ['读取文件', '逐段写入', '记下这次导入', '刷新本页']
      : ['读取文件', `写入 ${n0(count)} ${unit}`, '记下这次导入', '刷新本页'])).map(label => ({ label, note: '' })),
  })
  if (seg) run.steps[0].note = `${picks.length} 段`
  job = { payload, fileName: fn, segRes: [] }
  await runFrom(0)
}

// from:逐段从第几段发(接着导 = 断的那段;前面的段不重发)
async function runFrom(from: number) {
  const j = job!
  phase.value = 'run'
  run.fail = null
  run.stage = 1
  showCard.value = from > 0   // 接着导:卡本来就在,不再等
  gate = setTimeout(() => { showCard.value = true }, 200)
  const t0 = Date.now() - run.elapsed * 1000
  tick = setInterval(() => { run.elapsed = (Date.now() - t0) / 1000 }, 250)
  const p: ImportRunProgress = {
    from,
    base: j.segRes.slice(0, from).reduce(addResult, { imported: 0, skipped: 0, errors: [] }),
    segDone: (k, res) => { j.segRes[k] = res; run.segs[k].ok = res.imported; run.done = k + 1; if (run.done === run.segs.length) p.recording() },
    stage: (i) => { const k = stepAt(i); if (k >= 0) run.stage = k },
    recording: () => { run.stage = run.steps.length - 2 },
    refreshing: () => { run.stage = run.steps.length - 1 },
    note: (i, text) => { const k = stepAt(i); if (run.steps[k]) run.steps[k].note = text },
    kept: (text) => { run.kept = text },
    wrote: (n) => { run.wrote = n },
  }
  try {
    const res = await props.runner!(j.payload, j.fileName, p)
    if (!res) { phase.value = 'pick'; return }   // 屏自己没跑(如已退出编辑)
    outcome.value = res
    phase.value = 'done'
  } catch (e) {
    run.fail = { kind: failKind(e), reason: failReason(e) }
    phase.value = 'fail'
  } finally {
    stopTimers()
    run.elapsed = (Date.now() - t0) / 1000
  }
}

// 步骤按下标或按名字前缀找(registry 不知道屏给的步骤表长什么样,按「核对公司」「写入」认)
function stepAt(i: number | string) { return typeof i === 'number' ? i : run.steps.findIndex(s => s.label.startsWith(i)) }

/** 逐段且断在网络 / 5xx:从断的那段接着导 */
const canResume = computed(() => run.seg && run.fail != null && run.fail.kind !== 'reject')
const resume = () => { void runFrom(run.done) }
const backToPick = () => { phase.value = 'pick'; run.fail = null }

// 导入中关不掉(D14):×、遮罩、Esc 都不响应;关浏览器标签走浏览器自己的确认(UI-OVERLAY §7 02-D);
// 屏那边编辑态转假 / 页签停用收写浮层时看 importBusy,在跑的这一个不收
function tryClose() { if (!busy.value) emit('close') }
function onUnload(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = '' }
// Ctrl+K 命令面板在遮罩下面(--z-palette < --z-modal-2)却能聚焦、回车跳页 —— 导入中在捕获阶段先截掉。
// 只截看得见的那一个:浏览器后退让本页签停用时,屏把在跑的导入窗留在停用的页里(importBusy),别处的 Ctrl+K 照常
const scrimEl = ref<HTMLElement | null>(null)
function onPaletteKey(e: KeyboardEvent) {
  if (scrimEl.value?.isConnected && (e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); e.stopImmediatePropagation() }
}
const unhook = () => { window.removeEventListener('beforeunload', onUnload); window.removeEventListener('keydown', onPaletteKey, true) }
// sync:importBusy 要在 phase 变的当下就记上 —— 屏的 watch(edit) 是父组件的,同一拍里比子组件的 pre 回调先跑
watch(busy, b => {
  importBusy.value += b ? 1 : -1
  if (!b) return unhook()
  window.addEventListener('beforeunload', onUnload)
  window.addEventListener('keydown', onPaletteKey, true)
}, { flush: 'sync' })
onBeforeUnmount(() => { stopTimers(); unhook(); if (busy.value) importBusy.value-- })
</script>

<template>
  <!-- 导入中(busy)遮罩、×、Esc 都不关;遮罩 z 在 --z-modal-2,盖住页签条,导完前切不了页签 -->
  <div ref="scrimEl" class="fpimp-scrim" @mousedown="tryClose">
    <div class="fpimp" @mousedown.stop>
      <div class="fpimp-h">
        <div>
          <h3>{{ title }}</h3>
          <p>{{ sub || '从 Excel 文件或粘贴导入,系统按模板列校验后入库' }}</p>
        </div>
        <button class="fpimp-x" :class="{ busy }" aria-label="关闭" :aria-disabled="busy || undefined"
                v-tip="busy ? '导入完成前不能关闭' : null" @click="tryClose"><component :is="iconFor('x')" :size="18" /></button>
      </div>

      <div class="fpimp-b">
        <!-- 点导入之后:内容区原地换卡(进度 → 结果 / 失败);选文件那一屏 v-show 留着,「返回修改」回去时勾选与年月不丢 -->
        <ImportProgressCard v-if="phase === 'fail' || (phase === 'run' && showCard)" :run="run" />
        <ImportResultCard v-else-if="phase === 'done' && outcome" :result="outcome" :unit="run.unit" :elapsed="run.elapsed" :note="doneNoteText" />
        <div v-show="phase === 'pick' || (phase === 'run' && !showCard)" class="fpimp-pick">
        <div class="fpimp-tabs">
          <button :class="['fpimp-tab', { on: mode === 'file' }]" @click="mode = 'file'; err = ''">
            <component :is="iconFor('file-spreadsheet')" :size="15" />上传文件
          </button>
          <button :class="['fpimp-tab', { on: mode === 'paste' }]" @click="mode = 'paste'; err = ''">
            <component :is="iconFor('clipboard-paste')" :size="15" />从 Excel 粘贴
          </button>
        </div>

        <div v-if="mode === 'file'"
             :class="['fpimp-drop', { over }]"
             @click="inputRef?.click()"
             @dragover.prevent="over = true"
             @dragleave="over = false"
             @drop="onDrop">
          <span class="fpimp-drop-ic"><component :is="iconFor('upload-cloud')" :size="24" /></span>
          <span class="fpimp-drop-t">{{ fileName || '拖拽 Excel 到此,或点击选择' }}</span>
          <span class="fpimp-drop-d">{{ columnMap || parseWorkbook ? '支持 .xlsx/.csv · 自动识别表头行,前置分类列与合计·备注列自动忽略' + (parseWorkbook ? ';工作簿多表自动逐表解析' : '') : '支持 .xlsx / .csv · 读取第一个工作表,首行视为表头' }}</span>
          <input ref="inputRef" type="file" accept=".xlsx,.csv" style="display:none"
                 @change="handleFile(($event.target as HTMLInputElement).files?.[0])" />
        </div>
        <div v-else>
          <textarea class="fpimp-ta" v-model="paste"
                    :placeholder="columnMap || parseWorkbook ? '在 Excel 中选中(含表头的整块,可带车间分类列/合计·备注列)→ 复制 → 粘贴到这里。系统按表头名字自动识别列,多余列忽略。' : '在 Excel 中选中含数据的单元格 → 复制 → 粘贴到这里(每行一条,列以制表符分隔)。\n首行如为表头会自动跳过。'" />
          <div style="display:flex; justify-content:flex-end; margin-top:8px">
            <Button variant="gray" size="sm" @click="doPaste">
              <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
              解析粘贴内容
            </Button>
          </div>
        </div>

        <div v-if="!summaryMode" class="fpimp-tpl">
          <div class="fpimp-tpl-t"><component :is="iconFor('table-2')" :size="14" />模板列顺序（共 {{ templateCols.length }} 列）</div>
          <div class="fpimp-cols">
            <span v-for="(c, i) in templateCols" :key="i" class="fpimp-col"><b>{{ i + 1 }}</b>{{ c }}</span>
          </div>
        </div>

        <!-- 补录条(仅 fallbackPicker 存在 且 本次解析真用上了补录值):改任一项即用新值重解析 -->
        <div v-if="fallbackPicker && notice" class="fpimp-fb">
          <FPNote tone="warn">{{ notice }}</FPNote>
          <div class="fpimp-fb-r">
            <label>账期<DatePicker v-model="fb.ym" mode="month" size="sm" aria-label="账期" /></label>
            <label>分区<Select size="sm" :options="fallbackPicker.zones" v-model="fb.zone" /></label>
            <label>类别<Select size="sm" :options="fallbackPicker.kinds" v-model="fb.kind" /></label>
          </div>
        </div>

        <!-- 错误/告警位常驻(LAYOUT-STABILITY-SPEC §4.2):槽恒占一条 FPNote 的高(32),出一条时不把下面的汇总/预览顶走 -->
        <div class="fpimp-msgs">
          <FPNote v-if="err" tone="danger">{{ err }}</FPNote>
          <FPNote v-if="warn" tone="warn">{{ warn }}</FPNote>
        </div>

        <!-- 智能整表/工资分段:汇总确认屏(替代模板列/预览区);工资模式隐期列与期选择 -->
        <ImportSummary
          v-if="summaryMode && sections"
          :sections="sections"
          :default-year="defaultYear ?? new Date().getFullYear()"
          :default-month="defaultMonth ?? 1"
          :default-phase="defaultPhase ?? 1"
          :hide-phase="salaryMode"
          @confirm="onSectionsConfirm"
        />

        <!-- 自定义纯标签段:汇总确认屏(只显示 段标签 + N条 + 勾选,无年/月/期) -->
        <ImportSummary
          v-if="labelMode && labelSections"
          :label-sections="labelSections"
          label-only
          @label-confirm="onLabelConfirm"
        />

        <template v-if="!summaryMode && records">
          <div class="fpimp-preview">
            <div class="fpimp-preview-h">
              <span>预览 · 已识别 <b>{{ records.length }}</b> 条有效记录</span>
              <span>前 <b>{{ Math.min(6, records.length) }}</b> / {{ records.length }} 条</span>
            </div>
            <div class="fpimp-pvtable-wrap">
              <table class="fpimp-pvtable">
                <thead><tr><th v-for="(c, i) in templateCols" :key="i">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, i) in records.slice(0, 6)" :key="i">
                    <td v-for="(_c, j) in templateCols" :key="j">{{ cell(r.__preview ? r.__preview[j] : '') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
        </div>
      </div>

      <div class="fpimp-f">
        <template v-if="phase === 'run'">
          <Button variant="gray" full-width disabled>取消</Button>
          <Button variant="gray" full-width disabled>导入中…</Button>
        </template>
        <template v-else-if="phase === 'done'">
          <Button v-if="go" variant="outline" full-width @click="emit('go')">{{ go }}</Button>
          <Button variant="filled" full-width @click="emit('close')">知道了</Button>
        </template>
        <template v-else-if="phase === 'fail'">
          <Button variant="gray" full-width @click="emit('close')">关闭</Button>
          <Button v-if="canResume" variant="filled" full-width @click="resume">
            <template #leading><component :is="iconFor('refresh-cw')" :size="14" /></template>
            从第 {{ run.done + 1 }} 段接着导
          </Button>
          <Button v-else variant="filled" full-width @click="backToPick">返回修改</Button>
        </template>
        <template v-else>
          <Button variant="gray" full-width @click="emit('close')">{{ summaryMode ? '关闭' : '取消' }}</Button>
          <Button v-if="!summaryMode" variant="filled" :disabled="!records" @click="doImport">
            <template #leading><component :is="iconFor('download')" :size="16" /></template>
            导入 {{ records ? records.length + ' 条' : '' }}
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from import-excel.jsx FPImportStyles */
/* 居中弹窗(取代原型右抽屉;参考 CommandPalette 居中卡)。见 PAGE-BEHAVIOR-SPEC §2。 */
/* -webkit- 前缀:iOS ≤17 无前缀不识别 backdrop-filter,真机上等于没有模糊 */
.fpimp-scrim { position:fixed; inset:0; z-index:var(--z-modal-2); background:color-mix(in srgb, var(--scrim) 94.12%, transparent); -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; opacity:0; animation:fp-fade-in var(--dur-base) var(--ease-out) forwards; }   /* 浅色 = rgba(28,28,28,.32):--scrim(.34)× 94.12% */
.fpimp { width:min(560px,96vw); max-height:88vh; border-radius:16px; border:1px solid var(--border-subtle); background:var(--surface-white); box-shadow:var(--shadow-dialog); display:flex; flex-direction:column; overflow:hidden; animation:fp-rise-in var(--dur-base) var(--ease-out) both; }
.fpimp-h { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:20px 22px 16px; border-bottom:1px solid var(--divider); }
.fpimp-h h3 { margin:0; font-size:17px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fpimp-h p { margin:3px 0 0; font-size:12.5px; color:var(--text-muted); }
.fpimp-x { width:30px; height:30px; border:none; background:transparent; border-radius:8px; color:var(--text-muted); cursor:pointer; display:grid; place-items:center; flex:0 0 auto; }
.fpimp-x:hover { background:var(--bg-hover); color:var(--text-primary); }
/* 导入中:× 不响应,悬停描一圈边 + 悬停说明「导入完成前不能关闭」(画布 ImportBusyClose) */
.fpimp-x.busy { cursor:not-allowed; color:var(--text-disabled); }
.fpimp-x.busy:hover { background:transparent; color:var(--text-disabled); box-shadow:inset 0 0 0 1px var(--border-subtle); }
.fpimp-b { flex:1; overflow-y:auto; padding:18px 22px; display:flex; flex-direction:column; gap:16px; }
.fpimp-pick { display:contents; }

.fpimp-tabs { display:flex; gap:6px; }
.fpimp-tab { flex:1; height:36px; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:8px; cursor:pointer; font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); display:flex; align-items:center; justify-content:center; gap:7px; transition:all var(--dur-fast); }
.fpimp-tab:hover { background:var(--surface-card); }
.fpimp-tab.on { border-color:var(--ink-900); background:var(--ink-900); color:var(--control-solid-text); }

.fpimp-drop { display:flex; flex-direction:column; align-items:center; gap:10px; padding:28px 20px; border:1.5px dashed var(--border-strong); border-radius:var(--radius-lg); background:var(--surface-card); cursor:pointer; text-align:center; transition:background var(--dur-fast), border-color var(--dur-fast); }
.fpimp-drop:hover, .fpimp-drop.over { background:var(--accent-slate); border-color:var(--hue-blue); }
.fpimp-drop-ic { width:48px; height:48px; border-radius:var(--radius-md); background:var(--surface-white); border:1px solid var(--border-subtle); display:grid; place-items:center; color:var(--hue-blue); }
.fpimp-drop-t { font-size:14px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fpimp-drop-d { font-size:12px; color:var(--text-muted); }

.fpimp-ta { width:100%; box-sizing:border-box; min-height:150px; border:1px solid var(--border-subtle); border-radius:8px; padding:10px 12px; font-family:var(--font-mono); font-size:12px; line-height:1.6; color:var(--text-primary); resize:vertical; outline:none; }
.fpimp-ta:focus { border-color:var(--border-strong); }
.fpimp-ta::placeholder { color:var(--text-disabled); font-family:var(--font-sans); }

.fpimp-tpl { background:var(--surface-card); border-radius:var(--radius-md); padding:12px 14px; }
.fpimp-tpl-t { font-size:11.5px; font-weight:var(--fw-semibold); color:var(--text-secondary); display:flex; align-items:center; gap:6px; margin-bottom:7px; }
.fpimp-cols { display:flex; flex-wrap:wrap; gap:5px; }
.fpimp-col { font-size:11px; font-family:var(--font-mono); color:var(--text-muted); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:2px 9px; white-space:nowrap; }
.fpimp-col b { color:var(--text-secondary); font-weight:var(--fw-semibold); margin-right:3px; }

/* 常驻消息槽:min-height = 一条 FPNote 的整高(FPNote 自身 min-height 32) */
.fpimp-msgs { display:flex; flex-direction:column; gap:8px; min-height:32px; }

/* 补录条:块内提示(十件 ④)+ 账期/分区/类别选择器 */
.fpimp-fb { display:flex; flex-direction:column; gap:9px; }
.fpimp-fb-r { display:flex; gap:10px; }
.fpimp-fb-r label { flex:1; display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:var(--text-secondary); }

.fpimp-preview { border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; }
.fpimp-preview-h { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--surface-card); border-bottom:1px solid var(--divider); font-size:12px; color:var(--text-muted); }
.fpimp-preview-h b { font-family:var(--font-mono); color:var(--text-primary); }
.fpimp-pvtable-wrap { overflow:auto; max-height:220px; }
.fpimp-pvtable { border-collapse:separate; border-spacing:0; width:100%; font-size:11.5px; }
.fpimp-pvtable th, .fpimp-pvtable td { padding:5px 10px; white-space:nowrap; text-align:left; border-bottom:1px solid var(--divider); }
.fpimp-pvtable th { position:sticky; top:0; background:var(--surface-white); font-weight:var(--fw-semibold); color:var(--text-muted); font-size:10.5px; z-index:1; }
.fpimp-pvtable td { color:var(--text-secondary); font-family:var(--font-mono); }

.fpimp-f { display:flex; gap:10px; padding:16px 22px; border-top:1px solid var(--divider); }
.fpimp-f > * { flex:1; }

/* S 档全屏接管(RESPONSIVE-LAYOUT-SPEC §4.4):居中弹卡是桌面隐喻,≤600 改全屏 sheet,
   体区照旧内滚;脚部贴底给 iOS 手势条让位。分支全在组件内部,8 处调用方零改动。 */
@media (max-width: 600px) {
  .fpimp-scrim { padding: 0; }
  .fpimp { width: 100%; height: 100%; max-height: none; border: none; border-radius: 0; }
  .fpimp-f { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
}
</style>
