<!-- Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ -->
<script lang="ts">
// sheetMatch 选表:正则命中的第一个 sheet 名,未命中/未给回退第一个。抽出小函数便测。
export function pickSheet(names: string[], re?: RegExp): string {
  return (re ? names.find(n => re.test(n)) : undefined) ?? names[0]
}
</script>

<script setup lang="ts">
// 导入弹窗(共享引擎,全站 17 处导入入口共用)— 2026-10-10 改稿 md-v2-*:720 × 700 固定,三步 选数据 → 核对 → 导入。
// ① 选数据:拖放区(拖进来描蓝边)+「选文件」「粘贴表格」;粘进来就认(paste 事件,超 200ms 才出转圈);
//    认不出 → 拖放区换成认不出卡;下面「文件要长这样」小样表 + 规矩(registry 的 sample / rules,经 parserProps 带来)。
// ② 核对,四种:平铺(导不了的行排最前、写原因,全部行表内滚动)/ 多段(ImportSummary)/
//    台账(precheck:月份对不上二选一、本月已有几家会被盖掉)/ 园区抄表补问(解析结果 ask:缺月份 / 区 / 表类就问)。
// ③ 导入:进度卡 → 结果卡 / 失败卡(ImportProgressCard / ImportResultCard)。
// 主按钮只在底栏一处,写数;换步旧内容瞬间没、新内容淡入 120ms(不滑动);关窗瞬间,不淡出。
// .xls 旧格式(BIFF)读不了:适配层底层是 exceljs,只认 xlsx/csv —— 给「另存为」指引,不静默失败。
import { ref, computed, watch, reactive, nextTick, onBeforeUnmount } from 'vue'
import { AlertCircle, Clipboard } from 'lucide-vue-next'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import { cell, parsePaste, parseCSV } from '@/utils/importParse'
import { matchByHeader, type BadRow, type ColumnMapEntry } from '@/utils/importHeaderMatch'
import { splitSections, type PhaseLayouts, type Section } from '@/utils/importSections'
import { splitSalarySections } from '@/utils/importSalarySections'
import ImportSummary, { type LabelSection } from './ImportSummary.vue'
import ImportProgressCard from './ImportProgressCard.vue'
import ImportResultCard from './ImportResultCard.vue'
import { addResult, failKind, failReason, importBusy, n0, type ImportDescribe, type ImportOutcome, type ImportRunProgress, type RunState } from './importRun'
import type { ImportResultDTO } from '@/types/import'

export interface ImportRec { __preview?: unknown[]; [k: string]: unknown }
// 段(期×月 / 工资月 / 纯标签段)与平铺行两种上抛形态
export type SectionPick = { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }
export type ImportPayload = ImportRec[] | SectionPick[]
/** 解析器的统一返回(customParse / parseWorkbook) */
type Parsed = {
  records?: ImportRec[]; sections?: LabelSection[]; error?: string; warning?: string; notice?: string
  bad?: BadRow[]; ask?: string[]
}
type Precheck = { fileYm?: string; existing?: number; ym?: string; company?: string }

const props = withDefaults(defineProps<{
  title: string
  sub?: string
  templateCols: string[]
  // 给了 columnMap 即走「按表头名字匹配」(扛多行表头/前置分类列/合计备注列/顺序无关);否则走位置 parseRow
  parseRow?: (cells: string[], i: number) => ImportRec | null
  columnMap?: ColumnMapEntry[]
  nameLabels?: string[]
  skipHeader?: boolean
  // 给了 phaseLayouts 即走「智能整表导入」(多期×多月):解析后 splitSections → 核对页分段表(月份 + 期区)
  phaseLayouts?: PhaseLayouts
  // 给了 sectionTitleRe(且有 columnMap、无 phaseLayouts)即走「工资多月分段」:按标题切月 → 分段表(只有月份)
  sectionTitleRe?: RegExp
  // 自定义解析(次于 parseWorkbook):返回 records → 平铺核对;sections → 分段表(只有标题);bad → 核对页列出导不了的行
  customParse?: (matrix: string[][]) => Parsed | Promise<Parsed>
  // 文件上传按 sheet 名挑表(命中即取,未命中回退第一个);粘贴路径不受影响
  sheetMatch?: RegExp
  // 多 sheet 解析(优先级最高):文件路径传全部 sheet,粘贴包装 [{name:'', matrix}];第二实参 = 补问框的当前值
  parseWorkbook?: (sheets: { name: string; matrix: string[][] }[], fallback?: { ym: string; zone: string; kind: string }) => Parsed | Promise<Parsed>
  // 园区抄表:标题缺月份 / 区 / 表类时核对页的补问框(三项预填),解析结果的 ask 说缺哪几项;改任一项按新值重认
  fallbackPicker?: { ym: string; zone: string; kind: string; zones: { value: string; label: string }[]; kinds: { value: string; label: string }[] }
  defaultYear?: number
  defaultMonth?: number
  defaultPhase?: number
  // ── 弹窗要的字(parserProps 从 registry 带来)──
  rules?: string[]
  sample?: { head: string[]; rows: string[][] }
  unit?: string
  // 台账:进核对页问一次(文件标题的月份、要导到的那个月已有几家);ym = 改成导到文件里的那个月时按它再问
  precheck?: (parsed: { records?: ImportRec[] }, ym?: string) => Promise<Precheck>
  // 台账「导到 … 改」:给了才出「改」(导入中心回到选公司 / 月份的小窗)
  retarget?: () => void
  // ── 点导入之后(UI-OVERLAY-SPEC §8;协议全文见 ./importRun.ts 头注释)──
  runner?: (payload: ImportPayload, fileName: string, p: ImportRunProgress) => Promise<ImportOutcome | null>
  segmented?: boolean   // 逐段(附表10):每段一次请求,画真进度;断了可从断的那段接着导
  describe?: (payload: ImportPayload, fileName: string) => ImportDescribe
  go?: string           // 结果卡底栏多一颗按钮(导入中心「去 X 看」),点了 emit go
  doneNote?: string     // 结果卡右上「用时 m:ss · 」后那句;缺省只在刷新没成时写「本页没刷新上」
}>(), { skipHeader: true, unit: '行' })

const emit = defineEmits<{
  close: []
  go: []
  // 第二实参 fileName 供导入中心记录 import_log(粘贴导入为 '（粘贴）')
  import: [recs: ImportRec[], fileName: string]
  importSections: [picks: SectionPick[], fileName: string]
}>()

// 工资分段(无期)模式:sectionTitleRe + columnMap 且无 phaseLayouts
const salaryMode = computed(() => !!props.sectionTitleRe && !!props.columnMap && !props.phaseLayouts)

// ── ① 选数据 ──────────────────────────────────────────────
const mode = ref<'file' | 'paste'>('file')
const paste = ref('')
const over = ref(false)
const fileName = ref('')
const sheetPick = ref<{ i: number; name: string } | null>(null)   // 「第一张表「9月」」
const pastedRows = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const pasteRef = ref<HTMLTextAreaElement | null>(null)
const recognizing = ref(false)   // 认了 200ms 还没完才出转圈(同进度卡的 200ms 门)
const parsing = ref(false)

// ── ② 核对 ────────────────────────────────────────────────
const records = ref<ImportRec[] | null>(null)
const sections = ref<Section[] | null>(null)           // 附表10 / 工资:按年月(期区)分段
const labelSections = ref<LabelSection[] | null>(null)  // 其余分段:只有标题
const bad = ref<BadRow[]>([])
const err = ref('')
const warn = ref('')
const ask = ref<string[]>([])
const parseSeq = ref(0)   // 每认一次 +1:分段表按它重建(补问框改值重认后勾选 / 月份从新结果来)
const summaryRef = ref<{ picks: SectionPick[]; count: number } | null>(null)

// 补问框状态 + 已解析的 sheets(改选项即用新值重解析,不用重新选文件)
const fb = ref({ ym: props.fallbackPicker?.ym ?? '', zone: props.fallbackPicker?.zone ?? '', kind: props.fallbackPicker?.kind ?? '' })
const lastSheets = ref<{ name: string; matrix: string[][] }[] | null>(null)
async function runWorkbook(sheets: { name: string; matrix: string[][] }[]) {
  lastSheets.value = sheets
  applyResult(await props.parseWorkbook!(sheets, fb.value))
}
watch(fb, () => { if (lastSheets.value) void runWorkbook(lastSheets.value) }, { deep: true })

const phase = ref<'pick' | 'check' | 'run' | 'done' | 'fail'>('pick')

// 解析结果落地:有能导的(或有导不了的行要列出来)→ 进核对页;一样都没认出 → 留在第一步出认不出卡
function applyResult(res: Parsed & { phased?: Section[] }) {
  records.value = null; sections.value = null; labelSections.value = null; bad.value = []
  warn.value = res.warning ?? ''
  ask.value = res.ask ?? []
  parseSeq.value++
  const fail = (m: string) => { err.value = m; phase.value = 'pick' }
  if (res.error) return fail(res.error)
  if (res.phased) {
    if (!res.phased.some(s => s.records.length)) return fail(salaryMode.value
      ? '已读取数据,但没识别到任何员工行。请确认含表头与姓名列。' : '已读取数据,但没识别到任何租户行。请确认含表头与租户名列。')
    sections.value = res.phased
  } else if (res.sections) {
    if (!res.sections.some(s => s.records.length) && !res.bad?.length) return fail('已读取数据,但没识别到任何有效记录。')
    labelSections.value = res.sections
    bad.value = res.bad ?? []
  } else if (res.records) {
    if (!res.records.length && !res.bad?.length) return fail('已读取数据,但没识别到任何有效记录。')
    records.value = res.records
    bad.value = res.bad ?? []
  } else return fail('没识别到任何有效记录。')
  err.value = ''
  phase.value = 'check'
  void startPrecheck()
}

// 二维单元格数组 → 解析结果
async function mapMatrix(matrix: string[][]) {
  if (!matrix || !matrix.length) return applyResult({ error: '没有读到任何数据行。' })
  // 多 sheet 解析(优先级最高):粘贴路径包装为单 sheet;文件路径在 handleFile 已直走 parseWorkbook
  if (props.parseWorkbook) return runWorkbook([{ name: '', matrix }])
  if (props.customParse) return applyResult(await props.customParse(matrix))
  // 智能整表:拆段 + 识别年月期 + 版面 → 分段表
  if (props.phaseLayouts) {
    const secs = splitSections(matrix, props.phaseLayouts, props.nameLabels ?? ['租户名称', '租户'])
    // §4 禁静默丢列:段级未匹配表头(剔除派生/合计类)显式亮警告——附表10 通路先警告不阻断,处置走模板编辑器
    const un = [...new Set(secs.flatMap(x => (x.unmatched ?? []).map(u => u.header)))]
      .filter(h => !/应收合计|本月结余|^序号|合计|^小计|^总计/.test(h))
    return applyResult({ phased: secs, warning: un.length ? `未匹配列本次已忽略:${un.join('、')} —— 打开「账册模板」为其添加别名或自定义列后重导` : undefined })
  }
  // 工资多月分段:按标题切月 → 每段 matchByHeader
  if (salaryMode.value) return applyResult({ phased: splitSalarySections(matrix, props.columnMap!, props.nameLabels ?? ['姓名']) as Section[] })
  // columnMap:按表头名字匹配(自动定位表头行 / 忽略前置分类列与合计备注列 / 顺序无关)
  if (props.columnMap) {
    const { records: recs, error } = matchByHeader(matrix, props.columnMap, props.nameLabels ?? ['租户', '租户名称'])
    if (error) return applyResult({ error })
    if (!recs.length) return applyResult({ error: '表头下面没认出租户行。' })
    return applyResult({ records: recs })
  }
  // 位置映射(parseRow)
  const body = props.skipHeader && matrix.length > 1 ? matrix.slice(1) : matrix
  const out: ImportRec[] = []
  body.forEach((cells, i) => {
    try { const rec = props.parseRow?.(cells.map(cell), i); if (rec) out.push(rec) } catch { /* 跳过坏行 */ }
  })
  if (!out.length) return applyResult({ error: '已读取数据,但没有一行能匹配模板列。请检查列顺序是否与下方样子一致。' })
  applyResult({ records: out })
}

/** 认的那一下:超 200ms 才出转圈 */
async function recognize(fn: () => Promise<void> | void) {
  parsing.value = true
  const t = setTimeout(() => { recognizing.value = true }, 200)
  try { await fn() } catch (e) {
    console.warn('[import] 读文件失败:', e)
    applyResult({ error: '这个文件打不开：可能坏了，或者是改了后缀名的旧版 .xls。用 Excel 打开后另存为 .xlsx，再选一次。' })
  } finally {
    clearTimeout(t); parsing.value = false; recognizing.value = false
  }
}

const readAs = (file: File, how: 'text' | 'buf') => new Promise<string | ArrayBuffer>((ok, no) => {
  const fr = new FileReader()
  fr.onload = () => ok(fr.result as string | ArrayBuffer)
  fr.onerror = () => no(fr.error)
  if (how === 'text') fr.readAsText(file, 'utf-8'); else fr.readAsArrayBuffer(file)
})

function handleFile(file: File | undefined) {
  if (!file) return
  fileName.value = file.name
  sheetPick.value = null
  pastedRows.value = 0
  err.value = ''
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (ext === 'csv') return recognize(async () => mapMatrix(parseCSV(String(await readAs(file, 'text')))))
  if (ext === 'xlsx') return recognize(async () => {
    // 适配层懒加载(exceljs 自身也在其内部懒加载),并把日期格归一成 'yyyy-mm-dd'、数字出原始数字串
    const { readAoaWorkbook } = await import('@/utils/sheet')
    const sheets = await readAoaWorkbook(await readAs(file, 'buf') as ArrayBuffer)
    if (sheets.length === 1) sheetPick.value = { i: 0, name: sheets[0].name }
    // parseWorkbook:全部 sheet 一并传入(多 sheet 分段);否则 sheetMatch 按名挑单表(未命中回退第一个)
    if (props.parseWorkbook) return runWorkbook(sheets)
    const pick = pickSheet(sheets.map(s => s.name), props.sheetMatch)
    sheetPick.value = { i: Math.max(0, sheets.findIndex(s => s.name === pick)), name: pick }
    return mapMatrix(sheets.find(s => s.name === pick)?.matrix ?? [])
  })
  applyResult({ error: ext === 'xls' ? '.xls 是旧格式,请用 Excel 打开后「另存为」.xlsx 再上传。' : '仅支持 .xlsx / .csv 文件。' })
}

// 粘进来就认:paste 事件里取剪贴板的字,字照原样出现在框里(0ms),不用再点按钮
async function onPaste(e: ClipboardEvent) {
  const clip = e.clipboardData?.getData('text') ?? ''
  if (clip) { e.preventDefault(); paste.value = clip } else await nextTick()   // 拿不到剪贴板(测试环境)就等框里填好再读
  const text = clip || paste.value
  if (!text.trim()) return
  paste.value = text
  fileName.value = ''   // 先选过文件再改粘贴:别让粘贴的数据挂着那个文件名进导入记录
  sheetPick.value = null
  pastedRows.value = text.split(/\r?\n/).filter(l => l.trim()).length
  await recognize(() => mapMatrix(parsePaste(text)))
}

function onDrop(e: DragEvent) {
  e.preventDefault(); over.value = false
  handleFile(e.dataTransfer?.files[0])
}
function chooseFile() { err.value = ''; mode.value = 'file'; inputRef.value?.click() }
async function toPaste() { err.value = ''; paste.value = ''; mode.value = 'paste'; await nextTick(); pasteRef.value?.focus() }
function toFile() { err.value = ''; mode.value = 'file' }
/** 「换一个」:回到第一步重选 */
function again() {
  phase.value = 'pick'
  records.value = null; sections.value = null; labelSections.value = null; bad.value = []
  err.value = ''; warn.value = ''; ask.value = []; paste.value = ''; fileName.value = ''; sheetPick.value = null
  lastSheets.value = null; pre.value = null; preBase.value = {}; pickYm.value = null; preSeq++   // 在途的预检作废
}

const errTitle = computed(() => /\.xls|仅支持|打不开|没有读到/.test(err.value) ? '读不了这个文件'
  : /下面没/.test(err.value) ? '没认出能导的数据'
  : /表头|列/.test(err.value) ? '表头认不出' : '没认出能导的数据')
const errLine = computed(() => (fileName.value && /^没(找到|认出)/.test(err.value) ? `${fileName.value} 里${err.value}` : err.value))
// 认不出卡定高,原因最多两行;真被截了才挂悬停全文
const errDEl = ref<HTMLElement | null>(null)
const errCut = ref(false)
watch(errLine, () => nextTick(() => { const e = errDEl.value; errCut.value = !!e && e.scrollHeight > e.clientHeight + 1 }), { flush: 'post' })
const CN = '一二三四五六七八九十'
const srcMeta = computed(() => {
  const segs = (sections.value ?? labelSections.value)?.length
  if (segs) return `${segs} 段`
  const s = sheetPick.value
  return s ? `第${s.i < 10 ? CN[s.i] : s.i + 1}张表「${s.name}」` : ''
})

// ── 小样表 / 平铺核对表:数字列靠右、等宽 ──
const isNum = (v: unknown) => /^-?[\d,]+(\.\d+)?%?$/.test(String(v ?? '').trim())
const numCols = (rows: string[][], n: number) => Array.from({ length: n }, (_, j) => {
  const vs = rows.map(r => String(r[j] ?? '').trim()).filter(Boolean)
  return vs.length > 0 && vs.every(isNum)
})
const sampleHead = computed(() => props.sample?.head ?? props.templateCols)
const sampleRows = computed(() => props.sample?.rows ?? [])
const sampleNum = computed(() => numCols(sampleRows.value, sampleHead.value.length))

const flatRows = computed(() => [
  ...bad.value.map(b => ({ cells: props.templateCols.map((_, j) => String(b.cells[j] ?? '')), why: b.reason })),
  ...(records.value ?? []).map(r => ({ cells: props.templateCols.map((_, j) => cell(r.__preview ? r.__preview[j] : '')), why: '' })),
])
const flatNum = computed(() => numCols(flatRows.value.map(r => r.cells), props.templateCols.length))
const okN = computed(() => records.value?.length ?? 0)

// ── 园区抄表补问框 ──
const ASK_Q: Record<string, string> = { ym: '哪个月', zone: '哪个区', kind: '电表还是水表' }
const askLine = computed(() => `${!fileName.value && ask.value.length === 3 ? '粘的这块没有标题，' : '标题里'}看不出是${ask.value.map(k => ASK_Q[k] ?? k).join('、')}。选一下：`)

// ── 台账:月份对不上二选一 + 会盖掉几家 ──
const pre = ref<Precheck | null>(null)
const preBase = ref<Precheck>({})   // 第一次预检:文件标题的月份 + 屏上 / 小窗里选的月
const pickYm = ref<string | null>(null)
let preSeq = 0
async function startPrecheck() {
  pre.value = null; pickYm.value = null; preBase.value = {}
  if (!props.precheck || !records.value) return
  const r = await askPre()
  if (r) preBase.value = r
}
async function askPre(ym?: string): Promise<Precheck | null> {
  const seq = ++preSeq
  const r = await props.precheck!({ records: records.value ?? [] }, ym).catch(() => ({} as Precheck))
  if (seq !== preSeq) return null
  pre.value = r
  return r
}
const ledger = computed(() => !!props.precheck && records.value != null)
const mismatch = computed(() => !!preBase.value.fileYm && !!preBase.value.ym && preBase.value.fileYm !== preBase.value.ym)
const curYm = computed(() => pickYm.value ?? preBase.value.ym ?? '')
/** 「9月」;和另一个月不同年时带年 */
const monthOf = (ym: string, other = '') => `${ym.slice(0, 4) !== other.slice(0, 4) && other ? ym.slice(0, 4) + '年' : ''}${Number(ym.slice(5, 7))}月`
const ymFull = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`
function choose(ym: string) {
  pickYm.value = ym
  void askPre(ym === preBase.value.ym ? undefined : ym)
}

// ── 底栏主按钮(只此一处)──
const secPick = computed(() => summaryRef.value?.picks ?? [])
const primary = computed(() => {
  if (records.value) {
    const n = okN.value
    if (ledger.value && (pre.value?.existing ?? 0) > 0) return `覆盖 ${n0(pre.value!.existing!)} 家并导入`
    return `导入 ${n0(n)} ${props.unit}`
  }
  return `导入 ${secPick.value.length} 段 · ${n0(summaryRef.value?.count ?? 0)} ${props.unit}`
})
const waitPre = computed(() => ledger.value && pre.value == null)
const needChoice = computed(() => ledger.value && mismatch.value && !pickYm.value)
const canGo = computed(() => records.value ? okN.value > 0 && !waitPre.value && !needChoice.value : secPick.value.length > 0)

const strip = (rs: ImportRec[]) => rs.map(r => { const { __preview, ...rest } = r; void __preview; return rest })
const fnOf = () => fileName.value || '（粘贴）'

function doImport() {
  if (!canGo.value) return
  if (records.value) {
    const recs = strip(records.value)
    if (props.runner) void start(recs, fnOf())
    else emit('import', recs, fnOf())
  } else if (sections.value) onSectionsConfirm(secPick.value as { year: number; month: number; phase?: number; records: ImportRec[] }[])
  else onLabelConfirm(secPick.value as { label: string; records: ImportRec[] }[])
}

// 年月(期)段确认:剥 __preview 后逐段上抛(工资 phase 缺省)
function onSectionsConfirm(picks: { year: number; month: number; phase?: number; records: ImportRec[] }[]) {
  const ps = picks.map(p => ({ ...p, records: strip(p.records) }))
  if (props.runner) void start(ps, fnOf())
  else emit('importSections', ps, fnOf())
}

// 纯标签段确认:剥 __preview 后按 label 上抛
function onLabelConfirm(picks: { label: string; records: ImportRec[] }[]) {
  const ps = picks.map(p => ({ label: p.label, records: strip(p.records) }))
  if (props.runner) void start(ps, fnOf())
  else emit('importSections', ps, fnOf())
}

// ── ③ 导入(D13/D14):check → run → done | fail;fail 可「接着导」回 run 或「返回修改」回 check ──
const ZH_PHASE: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期', 4: '宿舍' }
/** 段名:同一个月的几段只写期区(「一期」),跨月的带上年月 */
function segLabels(picks: SectionPick[]): string[] {
  const oneYm = new Set(picks.map(p => `${p.year}-${p.month}`)).size === 1
  return picks.map(p => p.label ?? [
    !oneYm || p.phase == null ? (p.year != null && p.month != null ? `${p.year}年${p.month}月` : '') : '',
    p.phase != null ? ZH_PHASE[p.phase] ?? '' : '',
  ].filter(Boolean).join(' '))
}

const busy = computed(() => phase.value === 'run')
const showCard = ref(false)   // 200ms 内跑完不出进度卡,直接出结果(一闪而过的卡比不出更吵)
const failing = ref(false)    // 失败了:进度条先变红 200ms,再换失败卡
const run = reactive<RunState>({ seg: false, count: 0, unit: '行', meta: '', steps: [], stage: 0, elapsed: 0, segs: [], done: 0, fail: null, kept: '', wrote: 0 })
const outcome = ref<ImportOutcome | null>(null)
const doneKind = ref<'flat' | 'secs' | 'ledger'>('flat')
const doneSegs = ref(0)
const okLine = ref('')
const sentBad = ref<BadRow[]>([])
// 右上「用时」后那句:导入中心给的那句;否则只在刷新没成时说(跟最后一步的名字走:「刷新本期」→「本期没刷新上」)
const doneNoteText = computed(() => {
  if (props.doneNote) return props.doneNote
  const what = run.steps[run.steps.length - 1]?.label.replace(/^刷新/, '') || '本页'
  return outcome.value?.refreshed === false ? `${what}没刷新上` : ''
})
let job: { payload: ImportPayload; fileName: string; segRes: ImportResultDTO[] } | null = null
let gate: ReturnType<typeof setTimeout> | undefined
let tick: ReturnType<typeof setInterval> | undefined
const stopTimers = () => { clearTimeout(gate); clearInterval(tick) }
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

async function start(payload: ImportPayload, fn: string) {
  // 防连点:200ms 门内核对页还在,按钮还点得到
  if (phase.value === 'run' || phase.value === 'done') return
  const picks = payload as SectionPick[]
  const isSec = Array.isArray(picks[0]?.records)
  const seg = !!props.segmented && isSec
  const d = props.describe?.(payload, fn) ?? {}
  const unit = d.unit ?? props.unit
  const count = d.count ?? (isSec ? picks.reduce((a, p) => a + p.records.length, 0) : payload.length)
  const labels = isSec ? segLabels(picks) : []
  Object.assign(run, {
    seg, count, unit, done: 0, elapsed: 0, kept: '', wrote: 0, fail: null,
    segs: seg ? picks.map((p, k) => ({ label: labels[k], n: p.records.length, ok: 0 })) : [],
    meta: d.meta ?? fn,
    steps: (d.steps ?? ['读取文件', `写入 ${n0(count)} ${unit}`, '记下这次导入', '刷新本页']).map(label => ({ label, note: '' })),
  })
  // 结果卡的长相跟着核对页走
  sentBad.value = [...bad.value]
  doneKind.value = isSec ? 'secs' : ledger.value && pre.value?.ym ? 'ledger' : 'flat'
  doneSegs.value = isSec ? picks.length : 0
  okLine.value = isSec ? `${labels.join('、')}都在库里了。`
    : doneKind.value === 'ledger' ? `${monthOf(curYm.value)}${pre.value?.company ?? ''}的台账已经在库里了。` : ''
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
    bad: from === 0 ? sentBad.value.length : 0,
    ...(pickYm.value && pickYm.value !== preBase.value.ym ? { ym: pickYm.value } : {}),
  }
  try {
    const res = await props.runner!(j.payload, j.fileName, p)
    if (!res) { phase.value = 'check'; return }   // 屏自己没跑(如已退出编辑)
    outcome.value = res
    phase.value = 'done'
  } catch (e) {
    const fail = { kind: failKind(e), reason: failReason(e) }
    // 进度卡在屏上:进度条先变红(200ms --ease-standard),再换失败卡;减少动态 / 卡还没出来就直接换
    if (showCard.value && !reduced()) {
      failing.value = true
      await new Promise(r => setTimeout(r, 200))
      failing.value = false
    }
    run.fail = fail
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
const backToCheck = () => { phase.value = 'check'; run.fail = null }

/** 三步条:当前黑底、已过蓝勾、未到灰。导入中 200ms 门内核对页还在,步骤条也还在第 2 步 */
const step = computed(() => phase.value === 'pick' ? 1 : phase.value === 'check' || (phase.value === 'run' && !showCard.value) ? 2 : 3)
const STEPS = ['选数据', '核对', '导入']

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
          <p v-if="sub">{{ sub }}</p>
        </div>
        <button class="fpimp-x" :class="{ busy }" aria-label="关闭" :aria-disabled="busy || undefined"
                v-tip="busy ? '导入完成前不能关闭' : null" @click="tryClose"><component :is="iconFor('x')" :size="18" /></button>
      </div>
      <ol class="fpimp-steps" aria-label="导入步骤">
        <template v-for="(s, i) in STEPS" :key="s">
          <li v-if="i" class="ln" aria-hidden="true" />
          <li class="fpimp-s" :class="i + 1 < step ? 'done' : i + 1 === step ? 'now' : 'todo'" :aria-current="i + 1 === step ? 'step' : undefined">
            <i><component v-if="i + 1 < step" :is="iconFor('check')" :size="12" /><template v-else>{{ i + 1 }}</template></i>{{ s }}
          </li>
        </template>
      </ol>

      <div class="fpimp-b">
        <!-- ① 选数据 -->
        <div v-show="phase === 'pick'" class="fpimp-step fpimp-pick" @dragover.prevent @drop="onDrop">
          <div v-if="err" class="fpimp-err" role="alert">
            <span class="ic"><AlertCircle :size="22" aria-hidden="true" /></span>
            <div class="t">{{ errTitle }}</div>
            <div ref="errDEl" v-tip="errCut ? errLine : null" class="d">{{ errLine }}</div>
            <div class="bs">
              <Button variant="outline" @click="chooseFile">重新选文件</Button>
              <Button variant="outline" @click="toPaste">粘贴表格</Button>
            </div>
          </div>
          <div v-else-if="mode === 'file'" :class="['fpimp-drop', { over }]"
               @dragover.prevent="over = true" @dragleave="over = false">
            <span class="ic"><component :is="iconFor('upload-cloud')" :size="22" /></span>
            <div class="t">{{ parsing && fileName ? fileName : '把 Excel 文件拖到这里' }}</div>
            <div class="bs">
              <Button variant="outline" @click="chooseFile">选文件</Button>
              <Button variant="outline" @click="toPaste">粘贴表格</Button>
            </div>
            <div class="d">.xlsx 或 .csv；旧版 .xls 先用 Excel 另存为 .xlsx</div>
          </div>
          <div v-else class="fpimp-paste">
            <textarea ref="pasteRef" v-model="paste" class="fpimp-ta" aria-label="粘贴表格"
                      placeholder="在 Excel 里选中整块（带表头那一行）→ 复制 → 在这里粘贴。&#10;粘进来就开始认，不用再点按钮。"
                      @paste="onPaste" />
            <div v-if="recognizing" class="fpimp-spin"><span class="page-spin" aria-hidden="true" />正在识别 {{ n0(pastedRows) }} 行…</div>
            <a class="fpimp-alt" role="button" tabindex="0" @click="toFile" @keydown.enter="toFile">改用文件</a>
          </div>
          <input ref="inputRef" type="file" accept=".xlsx,.csv" hidden
                 @change="handleFile(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />

          <div class="fpimp-sec">
            <div class="fpimp-st">文件要长这样</div>
            <div class="fpimp-tw sample">
              <table class="fpimp-tbl">
                <thead><tr><th v-for="(h, j) in sampleHead" :key="j" :class="{ r: sampleNum[j] }">{{ h }}</th></tr></thead>
                <tbody><tr v-for="(r, i) in sampleRows" :key="i">
                  <td v-for="(c, j) in r" :key="j" :class="{ r: sampleNum[j], mono: sampleNum[j] }">{{ c }}</td>
                </tr></tbody>
              </table>
            </div>
            <ul v-if="rules?.length" class="fpimp-rules"><li v-for="(r, i) in rules" :key="i">{{ r }}</li></ul>
          </div>
        </div>

        <!-- ② 核对(导入中 200ms 门内还在) -->
        <div v-show="phase === 'check' || (phase === 'run' && !showCard)" class="fpimp-step fpimp-check">
          <div v-if="ledger && pre?.ym" class="fpimp-target">
            导到 <b>{{ ymFull(curYm) }}<template v-if="pre.company"> · {{ pre.company }}</template></b>
            <a v-if="retarget" role="button" tabindex="0" @click="retarget" @keydown.enter="retarget">改</a>
          </div>
          <div class="fpimp-src">
            <component :is="fileName ? iconFor('file-text') : Clipboard" :size="14" />
            <span class="n">{{ fileName || `粘贴的 ${n0(pastedRows)} 行` }}</span>
            <span v-if="fileName && srcMeta" class="m"> · {{ srcMeta }}</span>
            <a role="button" tabindex="0" @click="again" @keydown.enter="again">换一个</a>
          </div>

          <div v-if="fallbackPicker && ask.length" class="fpimp-ask">
            <div class="q">{{ askLine }}</div>
            <div class="fs">
              <label>月份<DatePicker v-model="fb.ym" mode="month" size="sm" aria-label="月份" /></label>
              <label>区<Select size="sm" :options="fallbackPicker.zones" v-model="fb.zone" /></label>
              <label>电表还是水表<Select size="sm" :options="fallbackPicker.kinds" v-model="fb.kind" /></label>
            </div>
          </div>

          <template v-if="ledger && mismatch">
            <div class="fpimp-hint warn">
              <component :is="iconFor('alert-triangle')" :size="14" />
              <div class="tx">文件标题写的是 {{ ymFull(preBase.fileYm!) }}，和要导到的 {{ monthOf(preBase.ym!, preBase.fileYm) }}不一样。导到哪个月？
                <div class="fpimp-choice">
                  <button type="button" class="o" :class="{ on: pickYm === preBase.ym }" @click="choose(preBase.ym!)">导到 {{ monthOf(preBase.ym!, preBase.fileYm) }}（照现在选的）</button>
                  <button type="button" class="o" :class="{ on: pickYm === preBase.fileYm }" @click="choose(preBase.fileYm!)">改成导到 {{ monthOf(preBase.fileYm!, preBase.ym) }}</button>
                </div>
              </div>
            </div>
          </template>
          <div v-if="ledger && (pre?.existing ?? 0) > 0" class="fpimp-hint warn">
            <component :is="iconFor('alert-triangle')" :size="14" />
            <div class="tx">文件里有 {{ n0(pre!.existing!) }} 家在 {{ monthOf(curYm) }}{{ pre!.company ?? '' }}的台账里已经有了。导进去会用文件里的数盖掉这 {{ n0(pre!.existing!) }} 家；文件里没有的列不动。</div>
          </div>

          <!-- 平铺 -->
          <template v-if="records">
            <div class="fpimp-sum">认出 <b>{{ n0(okN + bad.length) }}</b> {{ unit }}<template v-if="bad.length">：<b>{{ n0(okN) }}</b> {{ unit }}能导，<span class="w"><b>{{ n0(bad.length) }}</b> {{ unit }}导不了</span></template></div>
            <div v-if="bad.length" class="fpimp-hint warn">
              <component :is="iconFor('alert-triangle')" :size="14" />
              <div v-if="okN" class="tx">这 {{ n0(bad.length) }} {{ unit }}先放着：可以先导能导的 {{ n0(okN) }} {{ unit }}，改好 Excel 再单独导这 {{ n0(bad.length) }} {{ unit }}。</div>
              <div v-else class="tx">这 {{ n0(bad.length) }} {{ unit }}都导不了：照下面写的原因改好 Excel，再选一次。</div>
            </div>
            <div v-if="warn" class="fpimp-hint warn"><component :is="iconFor('alert-triangle')" :size="14" /><div class="tx">{{ warn }}</div></div>
          </template>

          <!-- 多段 -->
          <template v-else-if="sections || labelSections">
            <ImportSummary
              ref="summaryRef"
              :key="parseSeq"
              :sections="sections ?? undefined"
              :label-sections="labelSections ?? undefined"
              :label-only="!sections"
              :default-year="defaultYear"
              :default-month="defaultMonth"
              :default-phase="defaultPhase"
              :hide-phase="salaryMode"
              :unit="unit"
            />
            <div v-if="warn" class="fpimp-hint warn"><component :is="iconFor('alert-triangle')" :size="14" /><div class="tx">{{ warn }}</div></div>
            <div v-if="segmented" class="fpimp-hint info">
              <component :is="iconFor('info')" :size="14" />
              <div class="tx">一段一段导：中途断了，不关这个窗口就能从断的那段接着导，前面导好的不用重导。</div>
            </div>
            <div v-if="bad.length" class="fpimp-hint warn">
              <component :is="iconFor('alert-triangle')" :size="14" />
              <div class="tx">另有 {{ n0(bad.length) }} {{ unit }}导不了，先放着：改好 Excel 再单独导这 {{ n0(bad.length) }} {{ unit }}。</div>
            </div>
          </template>

          <!-- 平铺的全部行 / 多段里解析时就导不了的行:导不了的排最前、淡琥珀底、末列写原因 -->
          <div v-if="records || bad.length" class="fpimp-tw fill">
            <table class="fpimp-tbl">
              <thead><tr>
                <th v-for="(c, j) in templateCols" :key="j" :class="{ r: flatNum[j] }">{{ c }}</th>
                <th v-if="bad.length">导不了的原因</th>
              </tr></thead>
              <tbody>
                <tr v-for="(r, i) in flatRows" :key="i" :class="{ bad: !!r.why }">
                  <td v-for="(c, j) in r.cells" :key="j" :class="{ r: flatNum[j], mono: flatNum[j] }">{{ c }}</td>
                  <td v-if="bad.length"><span v-if="r.why" class="fpimp-why">{{ r.why }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ③ 导入:进度 → 结果 / 失败 -->
        <div v-if="step === 3" class="fpimp-step">
          <ImportProgressCard v-if="phase === 'fail' || phase === 'run'" :run="run" :failing="failing" />
          <ImportResultCard v-else-if="phase === 'done' && outcome" :result="outcome" :unit="run.unit" :elapsed="run.elapsed"
                            :note="doneNoteText" :kind="doneKind" :bad="sentBad" :segs="doneSegs" :ok-line="okLine" />
        </div>
      </div>

      <div class="fpimp-f">
        <template v-if="phase === 'run'">
          <span class="sp" />
          <Button variant="gray" disabled>导入中…</Button>
        </template>
        <template v-else-if="phase === 'done'">
          <span class="sp" />
          <Button v-if="go" variant="outline" @click="emit('go')">{{ go }}</Button>
          <Button variant="filled" @click="emit('close')">完成</Button>
        </template>
        <template v-else-if="phase === 'fail'">
          <Button variant="gray" @click="emit('close')">关闭</Button>
          <span class="sp" />
          <Button v-if="canResume" variant="filled" @click="resume">从第 {{ run.done + 1 }} 段接着导</Button>
          <Button v-else variant="filled" @click="backToCheck">返回修改</Button>
        </template>
        <template v-else>
          <Button variant="gray" @click="emit('close')">取消</Button>
          <template v-if="phase === 'check'">
            <span class="sp" />
            <span v-if="needChoice" class="fpimp-fn">先选导到哪个月</span>
            <Button variant="filled" :disabled="!canGo" @click="doImport">{{ primary }}</Button>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 视觉照 md-v2-*.dc.html(画板 CSS 抄的产品组件);居中弹窗见 PAGE-BEHAVIOR-SPEC §2。
   -webkit- 前缀:iOS ≤17 无前缀不识别 backdrop-filter,真机上等于没有模糊 */
.fpimp-scrim { position:fixed; inset:0; z-index:var(--z-modal-2); background:color-mix(in srgb, var(--scrim) 94.12%, transparent); -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; opacity:0; animation:fp-fade-in var(--dur-base) var(--ease-out) forwards; }   /* 浅色 = rgba(28,28,28,.32):--scrim(.34)× 94.12% */
/* 720 × 700 固定:每一步一样高,换步不跳(用户 10-10 拍板);矮屏让一步,内容区内滚 */
.fpimp { width:min(720px, 100%); height:min(700px, 100%); box-sizing:border-box; border-radius:16px; border:1px solid var(--border-subtle); background:var(--surface-white); box-shadow:var(--shadow-dialog); display:flex; flex-direction:column; overflow:hidden; animation:fp-rise-in var(--dur-base) var(--ease-out) both; }
.fpimp-h { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:20px 22px 12px; }
.fpimp-h h3 { margin:0; font-size:var(--fs-h3); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fpimp-h p { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.fpimp-x { width:30px; height:30px; padding:0; border:none; background:transparent; border-radius:8px; color:var(--text-muted); cursor:pointer; display:grid; place-items:center; flex:0 0 auto; }
.fpimp-x:hover { background:var(--bg-hover); color:var(--text-primary); }
/* 导入中:× 灰、不响应,悬停描一圈边 + 悬停说明「导入完成前不能关闭」 */
.fpimp-x.busy { cursor:not-allowed; color:var(--text-disabled); }
.fpimp-x.busy:hover { background:transparent; color:var(--text-disabled); box-shadow:inset 0 0 0 1px var(--border-subtle); }

/* 三步条:当前黑底、已过蓝勾、未到灰。圈里的数字 line-height:1,否则继承行高会偏下 2px */
.fpimp-steps { list-style:none; margin:0; display:flex; align-items:center; gap:10px; padding:0 22px 14px; border-bottom:1px solid var(--divider); }
.fpimp-steps .ln { flex:0 0 32px; height:1px; background:var(--border-strong); }
.fpimp-s { display:inline-flex; align-items:center; gap:6px; font-size:var(--fs-label); color:var(--text-muted); }
.fpimp-s i { width:18px; height:18px; box-sizing:border-box; border-radius:50%; display:grid; place-items:center; font-style:normal; font-size:var(--fs-micro); line-height:1; font-family:var(--font-mono); border:1px solid var(--border-strong); color:var(--text-muted); }
.fpimp-s.now { color:var(--text-primary); font-weight:var(--fw-semibold); }
.fpimp-s.now i { background:var(--ink-900); border-color:var(--ink-900); color:var(--control-solid-text); }
.fpimp-s.done { color:var(--text-secondary); }
.fpimp-s.done i { border-color:var(--hue-blue); color:var(--hue-blue); }

.fpimp-b { flex:1 1 auto; min-height:0; overflow-y:auto; padding:16px 22px; display:flex; flex-direction:column; }
/* 换步:旧内容瞬间没(v-show)、新内容淡入 120ms,不滑动(动效板 ①);display 由 none 变回时动画重播 */
.fpimp-step { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:12px; opacity:0; animation:fp-fade-in var(--dur-fast) var(--ease-out) forwards; }
.fpimp-f { display:flex; align-items:center; gap:10px; padding:14px 22px; border-top:1px solid var(--divider); }
.fpimp-f .sp { flex:1; }
.fpimp-fn { font-size:var(--fs-label); color:var(--text-muted); }
.fpimp a { font-size:var(--fs-label); color:var(--text-link); cursor:pointer; }

/* ① 拖放区 / 认不出卡 / 粘贴框:三种一样高(214 = 认不出卡原因写满两行),换着出现时下面的小样不上下跳(LAYOUT-STABILITY-SPEC;
   稿上画成了 200 / 178 / 214,2026-10-11 用户走查指出)。字只许单行 / 原因最多两行,多了省略、悬停看全文 */
.fpimp-drop, .fpimp-err { flex:0 0 214px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; border-radius:var(--radius-lg); }
.fpimp-drop { gap:10px; padding:26px 20px 22px; border:1px dashed var(--border-strong); background:var(--surface-card); }
/* 拖进来描蓝边:瞬间,不过渡(动效板 ① 0ms) */
.fpimp-drop.over { border-color:var(--hue-blue); background:var(--accent-slate); }
.fpimp-err { gap:8px; padding:22px 24px; border:1px solid var(--border-subtle); background:var(--surface-white); }
.fpimp-drop .ic, .fpimp-err .ic { width:44px; height:44px; box-sizing:border-box; border-radius:var(--radius-md); background:var(--surface-white); border:1px solid var(--border-subtle); display:grid; place-items:center; color:var(--hue-blue); }
.fpimp-err .ic { color:var(--hue-red); }
.fpimp-drop .t, .fpimp-err .t { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fpimp-drop .bs, .fpimp-err .bs { display:flex; gap:10px; }
.fpimp-drop .d { font-size:var(--fs-micro); color:var(--text-muted); }
.fpimp-err .d { font-size:var(--fs-label); line-height:20px; color:var(--text-secondary); max-width:470px; margin-bottom:4px; overflow-wrap:anywhere; overflow:hidden; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.fpimp-paste { position:relative; flex:0 0 214px; box-sizing:border-box; border:1px solid var(--border-strong); border-radius:var(--radius-md); }
.fpimp-ta { display:block; width:100%; height:100%; box-sizing:border-box; resize:none; border:none; outline:none; background:transparent; padding:12px 14px 34px; font-family:var(--font-mono); font-size:var(--fs-label); line-height:20px; color:var(--text-primary); white-space:pre; tab-size:12; }
.fpimp-ta::placeholder { font-family:var(--font-sans); color:var(--text-muted); }
.fpimp-paste:focus-within { border-color:var(--status-info); }
.fpimp-alt { position:absolute; right:14px; bottom:10px; }
/* 认了 200ms 还没完:框上盖一层「正在识别 N 行…」(动效板 ②) */
.fpimp-spin { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:10px; border-radius:inherit; background:color-mix(in srgb, var(--surface-white) 88%, transparent); font-size:var(--fs-label); color:var(--text-secondary); opacity:0; animation:fp-fade-in var(--dur-fast) var(--ease-out) forwards; }
.fpimp-spin .page-spin { width:18px; height:18px; border-width:2px; box-sizing:border-box; }
/* 减少动态(动效板):转圈换成原地一闪一闪。全局 .page-spin 例外让它照转,这里选择器更具体、同为 !important 顶回来 */
@keyframes fpimp-blink { 50% { opacity:.35; } }
@media (prefers-reduced-motion: reduce) {
  .fpimp-spin .page-spin { animation:fpimp-blink 1.6s ease-in-out infinite !important; animation-duration:1.6s !important; animation-iteration-count:infinite !important; }
}

/* 「文件要长这样」小样表 + 规矩 */
.fpimp-sec { display:flex; flex-direction:column; gap:8px; }
.fpimp-st { font-size:var(--fs-micro); font-weight:var(--fw-semibold); color:var(--text-secondary); }
.fpimp-rules { margin:0; padding-left:18px; font-size:var(--fs-label); line-height:20px; color:var(--text-secondary); }

/* 表(.md-tw / .md-tbl):表头 32 高、行 34 高;平铺核对表最多占到剩下的高,全部行在表内滚 */
.fpimp-tw { border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:auto; flex:0 0 auto; }
.fpimp-tw.fill { flex:0 1 auto; min-height:0; }   /* 行少时贴着内容,行多时缩到剩下的高、表内滚 */
.fpimp-tbl { width:100%; border-collapse:separate; border-spacing:0; }
.fpimp-tbl th { position:sticky; top:0; z-index:1; height:32px; padding:0 10px; text-align:left; font-size:var(--fs-micro); font-weight:var(--fw-semibold); color:var(--text-muted); background:var(--surface-card); border-bottom:1px solid var(--divider); white-space:nowrap; }
.fpimp-tbl td { height:34px; padding:0 10px; font-size:var(--fs-label); color:var(--text-secondary); border-bottom:1px solid var(--divider); white-space:nowrap; }
.fpimp-tbl tr:last-child td { border-bottom:none; }
.fpimp-tbl .r { text-align:right; }
.fpimp-tbl .mono { font-family:var(--font-mono); }
.fpimp-tw.sample td { color:var(--text-muted); }
/* 导不了的行:排最前、淡琥珀底、末列写原因 */
.fpimp-tbl tr.bad td { background:var(--caution-soft); }
.fpimp-why { display:inline-flex; align-items:center; gap:6px; color:var(--caution-text); }
.fpimp-why::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--status-warning); }

/* ② 文件条 / 「导到」条 / 摘要句 / 提示条 / 二选一 / 补问框 */
.fpimp-src { display:flex; align-items:center; gap:6px; font-size:var(--fs-label); color:var(--text-secondary); }
.fpimp-src > svg { flex:0 0 auto; color:var(--text-muted); }
.fpimp-src .n { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary); font-weight:var(--fw-medium); }
.fpimp-src .m { flex:0 0 auto; color:var(--text-muted); white-space:nowrap; }
.fpimp-src a { flex:0 0 auto; margin-left:8px; }
.fpimp-target { display:flex; align-items:center; gap:8px; min-height:36px; padding:0 12px; border-radius:var(--radius-sm); background:var(--surface-card); font-size:var(--fs-label); color:var(--text-secondary); }
.fpimp-target b { color:var(--text-primary); font-weight:var(--fw-semibold); }
.fpimp-sum { font-size:var(--fs-body); color:var(--text-primary); }
.fpimp-sum b { font-family:var(--font-mono); font-weight:var(--fw-semibold); }
.fpimp-sum .w { color:var(--caution-text); }
.fpimp-hint { display:flex; align-items:flex-start; gap:8px; padding:8px 12px; border-radius:var(--radius-sm); font-size:var(--fs-label); line-height:18px; }
.fpimp-hint > svg { flex:0 0 auto; margin-top:2px; }
.fpimp-hint.info { background:var(--info-soft); color:var(--info-text-on-tint); }
.fpimp-hint.warn { background:var(--caution-soft); color:var(--caution-text); }
.fpimp-hint .tx { flex:1; min-width:0; }
.fpimp-choice { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
.fpimp-choice .o { display:inline-flex; align-items:center; height:28px; padding:0 12px; border:1px solid var(--status-warning); border-radius:var(--radius-full); background:var(--surface-white); color:var(--text-primary); font-family:var(--font-sans); font-size:var(--fs-label); cursor:pointer; }
.fpimp-choice .o.on { border-color:var(--caution-text); box-shadow:inset 0 0 0 1px var(--caution-text); font-weight:var(--fw-semibold); }
.fpimp-ask { display:flex; flex-direction:column; gap:10px; padding:12px 14px; border-radius:var(--radius-md); background:var(--info-soft); }
.fpimp-ask .q { font-size:var(--fs-label); color:var(--info-text-on-tint); }
.fpimp-ask .fs { display:flex; flex-wrap:wrap; gap:12px; }
.fpimp-ask label { display:flex; flex-direction:column; gap:4px; width:120px; font-size:var(--fs-micro); color:var(--text-secondary); }

/* S 档全屏接管(RESPONSIVE-LAYOUT-SPEC §4.4):居中弹卡是桌面隐喻,≤600 改全屏 sheet,
   体区照旧内滚;脚部贴底给 iOS 手势条让位。分支全在组件内部,调用方零改动。 */
@media (max-width: 600px) {
  .fpimp-scrim { padding: 0; }
  .fpimp { width: 100%; height: 100%; border: none; border-radius: 0; }
  .fpimp-f { padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
}
</style>
