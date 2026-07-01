<script setup lang="ts">
// 通用「导入 Excel」右滑抽屉(共享引擎)— 1:1 移植 import-excel.jsx FPImportModal。
// 两入口:① 上传 .xlsx/.xls/.csv(csv 用 FileReader+内置解析;xlsx 懒加载 SheetJS)
//        ② 从 Excel 粘贴(textarea,TSV/CSV)。两者都先解析成二维数组,再交各屏 parseRow 映射。
// 解析结果进预览表(前 6 行)+ 条数 + 错误/成功提示,确认后 onImport(剥 __preview)。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import { cell, parsePaste, parseCSV } from '@/utils/importParse'
import { matchByHeader, type ColumnMapEntry } from '@/utils/importHeaderMatch'
import { splitSections, type PhaseLayouts, type Section } from '@/utils/importSections'
import { splitSalarySections } from '@/utils/importSalarySections'
import ImportSummary from './ImportSummary.vue'

export interface ImportRec { __preview?: unknown[]; [k: string]: unknown }

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
  // 给了 customParse 即走自定义解析(优先级最高,与上述各通路互斥):
  //   返回 records → 复用现有预览表 + 「导入 N 条」按钮,emit import
  //   返回 sections → 复用 ImportSummary 纯标签段模式(每段 label+N条+勾选),emit importSections({label,records}[])
  customParse?: (matrix: string[][]) => { records?: ImportRec[]; sections?: { label: string; records: ImportRec[] }[]; error?: string }
  defaultYear?: number
  defaultMonth?: number
  defaultPhase?: number
}>(), { skipHeader: true })

const emit = defineEmits<{
  close: []
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
const labelSections = ref<{ label: string; records: ImportRec[] }[] | null>(null)

const mode = ref<'file' | 'paste'>('file')
const paste = ref('')
const over = ref(false)
const records = ref<ImportRec[] | null>(null)
const err = ref('')
const fileName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 二维单元格数组 → 业务记录
function mapMatrix(matrix: string[][]) {
  if (!matrix || !matrix.length) { err.value = '没有读到任何数据行。'; records.value = null; sections.value = null; labelSections.value = null; return }
  // 自定义解析模式(优先级最高,与其它通路互斥):各屏自带解析器
  if (props.customParse) {
    const { records: recs, sections: secs, error } = props.customParse(matrix)
    records.value = null; sections.value = null; labelSections.value = null
    if (error) { err.value = error; return }
    if (secs) {
      if (!secs.some(s => s.records.length > 0)) { err.value = '已读取数据,但没识别到任何有效记录。'; return }
      err.value = ''; labelSections.value = secs; return
    }
    if (recs) {
      if (!recs.length) { err.value = '已读取数据,但没识别到任何有效记录。'; return }
      err.value = ''; records.value = recs; return
    }
    err.value = '没识别到任何有效记录。'; return
  }
  // 智能整表模式:拆段 + 识别年月期 + 版面 → 汇总确认屏
  if (props.phaseLayouts) {
    const secs = splitSections(matrix, props.phaseLayouts, props.nameLabels ?? ['租户名称', '租户'])
    const hasData = secs.some(s => s.records.length > 0)
    if (!hasData) { err.value = '已读取数据,但没识别到任何租户行。请确认含表头与租户名列。'; sections.value = null; return }
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
  if (ext === 'xlsx' || ext === 'xls') {
    const fr = new FileReader()
    fr.onload = async () => {
      try {
        const XLSX = await import('xlsx')   // 懒加载 ~200KB,仅上传 xlsx 才拉
        // cellDates+raw:false+dateNF → 日期单元格出 'yyyy-mm-dd' 字符串(办公水电月份列需要),
        // 数字也变字符串但下游 cleanNum/String 容错(台账/附表10/工资分段不受影响)。
        const wb = XLSX.read(new Uint8Array(fr.result as ArrayBuffer), { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const matrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd' })
        mapMatrix(matrix as string[][])
      } catch (e) { err.value = '文件解析失败:' + (e as Error).message }
    }
    fr.readAsArrayBuffer(file)
    return
  }
  err.value = '仅支持 .xlsx / .xls / .csv 文件。'
}

function doPaste() {
  if (!paste.value.trim()) { err.value = '请先粘贴数据。'; return }
  mapMatrix(parsePaste(paste.value))
}

function onDrop(e: DragEvent) {
  e.preventDefault(); over.value = false
  handleFile(e.dataTransfer?.files[0])
}

function confirm() {
  if (!records.value) return
  emit('import', records.value.map(r => { const { __preview, ...rest } = r; void __preview; return rest }), fileName.value || '（粘贴）')
}

// 智能整表/工资分段确认:剥 __preview 后逐段上抛(工资模式 phase 缺省)
function onSectionsConfirm(picks: { year: number; month: number; phase?: number; records: ImportRec[] }[]) {
  emit('importSections', picks.map(p => ({
    ...p,
    records: p.records.map(r => { const { __preview, ...rest } = r; void __preview; return rest }),
  })), fileName.value || '（粘贴）')
}

// 自定义纯标签段确认:剥 __preview 后按 label 上抛
function onLabelConfirm(picks: { label: string; records: ImportRec[] }[]) {
  emit('importSections', picks.map(p => ({
    label: p.label,
    records: p.records.map(r => { const { __preview, ...rest } = r; void __preview; return rest }),
  })), fileName.value || '（粘贴）')
}
</script>

<template>
  <div class="fpimp-scrim" @mousedown="emit('close')">
    <div class="fpimp" @mousedown.stop>
      <div class="fpimp-h">
        <div>
          <h3>{{ title }}</h3>
          <p>{{ sub || '从 Excel 文件或粘贴导入,系统按模板列校验后入库' }}</p>
        </div>
        <button class="fpimp-x" @click="emit('close')"><component :is="iconFor('x')" :size="18" /></button>
      </div>

      <div class="fpimp-b">
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
          <span class="fpimp-drop-d">{{ columnMap ? '支持 .xlsx/.xls/.csv · 自动识别表头行,前置分类列与合计·备注列自动忽略' : '支持 .xlsx / .xls / .csv · 读取第一个工作表,首行视为表头' }}</span>
          <input ref="inputRef" type="file" accept=".xlsx,.xls,.csv" style="display:none"
                 @change="handleFile(($event.target as HTMLInputElement).files?.[0])" />
        </div>
        <div v-else>
          <textarea class="fpimp-ta" v-model="paste"
                    :placeholder="columnMap ? '在 Excel 中选中(含表头的整块,可带车间分类列/合计·备注列)→ 复制 → 粘贴到这里。系统按表头名字自动识别列,多余列忽略。' : '在 Excel 中选中含数据的单元格 → 复制 → 粘贴到这里(每行一条,列以制表符分隔)。\n首行如为表头会自动跳过。'" />
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

        <div v-if="err" class="fpimp-msg err"><component :is="iconFor('alert-triangle')" :size="15" />{{ err }}</div>

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
          <div class="fpimp-msg ok">
            <component :is="iconFor('check-circle-2')" :size="15" />
            已识别 <b>{{ records.length }}</b> 条有效记录,确认后写入。
          </div>
          <div class="fpimp-preview">
            <div class="fpimp-preview-h">
              <span>预览</span>
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

      <div class="fpimp-f">
        <Button variant="gray" full-width @click="emit('close')">{{ summaryMode ? '关闭' : '取消' }}</Button>
        <Button v-if="!summaryMode" variant="filled" :disabled="!records" @click="confirm">
          <template #leading><component :is="iconFor('download')" :size="16" /></template>
          导入 {{ records ? records.length + ' 条' : '' }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from import-excel.jsx FPImportStyles */
/* 居中弹窗(取代原型右抽屉;参考 CommandPalette 居中卡)。见 DESIGN-FIDELITY §7。 */
.fpimp-scrim { position:fixed; inset:0; z-index:320; background:rgba(28,28,28,.32); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; }
.fpimp { width:min(560px,96vw); max-height:88vh; border-radius:16px; border:1px solid var(--border-subtle); background:var(--surface-white); box-shadow:0 24px 64px rgba(28,28,28,.28); display:flex; flex-direction:column; overflow:hidden; animation:fpimpin .2s var(--ease-standard); }
@keyframes fpimpin { from { transform:translateY(8px) scale(.985); opacity:.4; } to { transform:none; opacity:1; } }
.fpimp-h { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:20px 22px 16px; border-bottom:1px solid var(--divider); }
.fpimp-h h3 { margin:0; font-size:17px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fpimp-h p { margin:3px 0 0; font-size:12.5px; color:var(--text-muted); }
.fpimp-x { width:30px; height:30px; border:none; background:transparent; border-radius:8px; color:var(--text-muted); cursor:pointer; display:grid; place-items:center; flex:0 0 auto; }
.fpimp-x:hover { background:var(--bg-hover); color:var(--text-primary); }
.fpimp-b { flex:1; overflow-y:auto; padding:18px 22px; display:flex; flex-direction:column; gap:16px; }

.fpimp-tabs { display:flex; gap:6px; }
.fpimp-tab { flex:1; height:36px; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:8px; cursor:pointer; font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); display:flex; align-items:center; justify-content:center; gap:7px; transition:all var(--dur-fast); }
.fpimp-tab:hover { background:var(--surface-card); }
.fpimp-tab.on { border-color:var(--ink-900); background:var(--ink-900); color:#fff; }

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

.fpimp-msg { display:flex; align-items:center; gap:8px; font-size:12.5px; padding:10px 12px; border-radius:8px; }
.fpimp-msg.ok { background:var(--accent-sky); color:var(--hue-blue); }
.fpimp-msg.ok b { margin:0 3px; font-family:var(--font-mono); }
.fpimp-msg.err { background:rgb(252,235,233); color:var(--hue-red); }

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
</style>
