<script setup lang="ts">
// 园区抄表 v5.1 壳(METER-V5-SPEC §1+§7):账期驱动的台账同款电子表格工作台,无段切换。
// 标题行(账期年月+抄表进度条+常驻/编辑态按钮)+6 张可点击统计卡(点=状态筛选互斥切换)+
// 筛选条(电水/分区/楼栋/归属/状态/搜索/重置)+MeterLedgerGrid+MeterDetailDrawer。
// 数据装载/竞态守卫(rSeq/bSeq)/绑定降级/导入链(registry 'meter')延续 v4 口径。
// 草稿式编辑(§7.2):draft 归属本层;「完成」dirty>0 弹 SaveConfirmDialog,保存=逐变更表
// POST(无读数)/PUT(有),行级失败收集 alert 并保留 dirty;放弃=丢 draft 回浏览态。
// 编辑态不跨会话(onDeactivated 复位含 draft,EDIT-MODE-SPEC v2)。
import { ref, computed, reactive, onMounted, onDeactivated, watch } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import { tenantMatchNames } from '@/utils/tenantAlias'
import {
  metersApi, type MeterDTO, type MeterReadingDTO, type MeterBindingRowDTO,
  type MeterDeleteDTO, type MeterKind, type MeterZone,
} from '@/api/meters'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'
import {
  buildRows, filterRows, cardCounts, autoLinkEstimate, isPendingMeter,
  draftDirtyIds, draftReq,
  type StatusFilter, type MeterDraft, type CurrField,
} from '@/composables/useMeterWorkbench'
import { buildMeterTemplate, exportMeterMonth } from '@/utils/meterExcel'
import { OWNERSHIP_LABEL, ownershipLabel } from '@/utils/meterSplit'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
import { buildYearOptions } from '@/utils/yearGate'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import MeterLedgerGrid from './MeterLedgerGrid.vue'
import MeterDetailDrawer from './MeterDetailDrawer.vue'
import './meter-shared.css'

const auth = useAuthStore()

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话;KeepAlive 切页签回来也回浏览态(draft 一并丢弃) ──
const editMode = ref(false)
const importing = ref(false)
const openId = ref<number | null>(null)
onDeactivated(() => {
  editMode.value = false; importing.value = false; openId.value = null
  saveConfirm.value = false; draft.clear(); delPreview.value = null
})

const pad2 = (n: number) => String(n).padStart(2, '0')

// ── 期间(年数据驱动,同 v4 口径:有数据年∪当前年,初始=最新有数据年) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })),
)
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)
const prevYm = computed(() =>
  month.value === 1 ? `${year.value - 1}-12` : `${year.value}-${pad2(month.value - 1)}`)

// ── 数据 ──
const meters = ref<MeterDTO[] | null>(null)
const readings = ref<MeterReadingDTO[] | null>(null)
const prevReadings = ref<MeterReadingDTO[]>([])
const tenants = ref<TenantDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const tenantNameById = computed(() => new Map(tenants.value.map(t => [t.id, t.companyName])))
const buildingNameById = computed(() => new Map(buildings.value.map(b => [b.id, b.name])))

// 加载失败态(P1-5):两路都要打回可见失败 + 重试入口,不能只剩转圈或旧数据顶着
const metersErr = ref('')
const readErr = ref('')
async function loadMeters() {
  // 首载失败若不记,整页永久停在骨架屏(meters 恒 null),连个重试入口都没有
  try { meters.value = await metersApi.list(); metersErr.value = '' }
  catch { metersErr.value = '表档案加载失败，请重试' }
}
// 竞态守卫同 v4:切期保留旧数据到新数据落位,不闪 gate;上月读数供「上月行至」基准
let rSeq = 0
async function loadReadings() {
  const my = ++rSeq
  try {
    const [cur, prev] = await Promise.all([
      metersApi.readings(ym.value),
      metersApi.readings(prevYm.value).catch(() => [] as MeterReadingDTO[]),   // 上月缺失是正常业务态,不算失败
    ])
    if (my !== rSeq) return
    readings.value = cur; prevReadings.value = prev
    readErr.value = ''
  } catch {
    if (my !== rSeq) return
    // 关键:打回「无数据」,绝不留旧月数据冒充新月 —— 年月已经切了,旧数组还挂着,
    // 用户在那些行上录一格,保存走的是旧行 id 的 PUT,直接覆盖上个账期的读数
    readings.value = []
    readErr.value = '本月读数加载失败，请重试'
  }
}
// 失败态锁录入:此刻「本月」列空着不是「没抄」而是「没读到」,在上面录=覆盖旧月或凭空补条
const editable = computed(() => editMode.value && !readErr.value)
function retryLoad() {
  if (metersErr.value) loadMeters()
  if (readErr.value) loadReadings()
}
// 绑定数据(S2 §3):失败降级(null+bindFail),不阻断整页
const bindRows = ref<MeterBindingRowDTO[] | null>(null)
const bindFail = ref(false)
let bSeq = 0
async function loadBinding() {
  const my = ++bSeq
  try {
    const d = await metersApi.binding(ym.value)
    if (my === bSeq) { bindRows.value = d.rows; bindFail.value = false }
  } catch {
    if (my === bSeq) { bindRows.value = null; bindFail.value = true }
  }
}
// ── 草稿式编辑(§7.2):draft 归属本层,表格只读取+emit cell-edit ──
const draft = reactive(new Map<number, MeterDraft>())
const saveConfirm = ref(false)
const saving = ref(false)
const dirtyIds = computed(() => draftDirtyIds(rowsAll.value, draft))
const rowById = computed(() => new Map(rowsAll.value.map(x => [x.m.id, x])))
// 退出编辑(保存成功/无改动/放弃)统一丢草稿:等值残留也不带回浏览态
watch(editMode, v => { if (!v) { draft.clear(); saveConfirm.value = false } })

function onCellEdit(p: { meterId: number; field: CurrField; value: string }) {
  draft.set(p.meterId, { ...draft.get(p.meterId), [p.field]: p.value })
}
// 编辑模式按钮:进=开编辑;编辑中点「完成」dirty>0 弹确认,无改动直接退出
function onEditBtn() {
  if (!editMode.value) { editMode.value = true; return }
  if (dirtyIds.value.length > 0) { saveConfirm.value = true; return }
  editMode.value = false
}
// 保存修改:逐变更表 POST(无读数)/PUT(有);行级失败收集 alert 并保留该行 dirty
async function onSaveChanges() {
  saveConfirm.value = false
  if (saving.value) return
  saving.value = true
  const fails: string[] = []
  for (const id of dirtyIds.value.slice()) {
    const x = rowById.value.get(id)
    if (!x) { draft.delete(id); continue }   // 表已被删(抽屉侧):丢弃该草稿
    try {
      const req = draftReq(x, draft.get(id), ym.value)
      if (x.r) await metersApi.updateReading(x.r.id, req)
      else await metersApi.createReading(req)
      draft.delete(id)
    } catch (e) {
      fails.push(`${x.tenantLabel ?? x.m.tenantName ?? x.m.name}:${(e as { message?: string })?.message ?? '保存失败'}`)
    }
  }
  saving.value = false
  reloadAll()
  if (fails.length > 0) alert(`${fails.length} 块表保存失败(改动已保留,可重试):\n${fails.join('\n')}`)
  else editMode.value = false
}
// 放弃修改:丢 draft 回浏览态
function onDiscardChanges() {
  saveConfirm.value = false
  draft.clear()
  editMode.value = false
}

// 主数据清单拉取失败不阻断:租户/楼栋列显 '—',picker 候选空
function loadMasters() {
  tenantApi.list().then(v => { tenants.value = v; importCtx.tenantNames = v.flatMap(t => tenantMatchNames(t)) }).catch(() => {})
  buildingApi.list().then(v => { buildings.value = v; importCtx.buildings = v }).catch(() => {})
}
// 页签切回:租户改名/楼栋变更后清单回拉,合同增删改后绑定候选回拉(浏览状态保留)
onReactivated(() => { loadMasters(); loadBinding() })

onMounted(async () => {
  loadMeters()
  loadMasters()
  // 先拉数据年份定位初始年:最新有数据年;改年经 watch 触发装载,未改则本函数兜底首载
  try {
    dataYears.value = await metersApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }
  } catch { /* years 拉取失败不阻断:选项由 ∪ 当前年兜底 */ }
  loadReadings()
  loadBinding()
})
// 换账期:上月基准/读数全变,草稿随之作废(ponytail: 静默丢弃,需保留请先「完成」保存)
// 换账期同时关掉批删弹窗:里面复述的是旧账期的数字,留着就是张过期确认单
watch([year, month], () => { draft.clear(); delPreview.value = null; loadReadings(); loadBinding() })

// 写后统一重载(读数/档案/绑定/数据年份)
function reloadAll() {
  loadMeters()
  loadReadings()
  loadBinding()
  metersApi.years().then(ys => { dataYears.value = ys }).catch(() => { /* 年份刷新失败不阻断 */ })
}

// ── 筛选状态(§1 筛选条)+统计卡(点卡=状态筛选互斥切换) ──
const kind = ref('elec')
// 分区=一级页签(用户拍板 2026-07-28:一期/二期/宿舍分开,不混排——对齐原始账册分册习惯),无「全部」混排项
const zone = ref('p1')
const building = ref('all')
const own = ref('all')
const status = ref<StatusFilter>('all')
const q = ref('')
const KIND_OPTS = [{ value: 'elec', label: '电表' }, { value: 'water', label: '水表' }]
const ZONE_OPTS = [
  { value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }, { value: 'dorm', label: '宿舍' },
]
const OWN_OPTS = computed(() => [
  { value: 'all', label: '全部归属' },
  ...Object.keys(OWNERSHIP_LABEL).map(value => ({ value, label: ownershipLabel(value, kind.value) })),
])
const STATUS_OPTS = [
  { value: 'all', label: '全部状态' }, { value: 'read', label: '已抄' }, { value: 'missing', label: '未抄' },
  { value: 'negative', label: '倒走' }, { value: 'touMismatch', label: '时段不符' },
  { value: 'pending', label: '待核' }, { value: 'unbound', label: '待绑定' }, { value: 'placeholder', label: '占位槽' },
  { value: 'retired', label: '已停用' },   // V68:默认隐藏,选此项调出
]
// 状态 Select 与统计卡互斥共用一个 status:卡的粗粒度键(anomaly/attention/ready/tenant)在 Select 显「全部」
const statusSel = computed(() => (STATUS_OPTS.some(o => o.value === status.value) ? status.value : 'all'))
function resetFilters() {
  // 分区是一级页签不参与重置
  building.value = 'all'; own.value = 'all'; status.value = 'all'; q.value = ''; suspectOnly.value = false
}
function cardClick(k: StatusFilter) {
  status.value = status.value === k ? 'all' : k
}

// ── 行合流与各口径行集 ──
const rowsAll = computed(() =>
  buildRows(meters.value ?? [], readings.value ?? [], prevReadings.value, bindRows.value, tenantNameById.value, ym.value))
// 统计卡/进度条口径:跟随 电水+分区(§1),不受楼栋/归属/状态/搜索影响
const kindZoneRows = computed(() =>
  filterRows(rowsAll.value, { kind: kind.value, zone: zone.value, building: 'all', own: 'all', status: 'all', q: '' }))
const cards = computed(() => cardCounts(kindZoneRows.value))
const progressPct = computed(() =>
  cards.value.tenant > 0 ? Math.round((cards.value.read / cards.value.tenant) * 100) : 0)
// 「只看存疑」(V75 §E3/§F1):独立开关,叠在筛选链之后 —— 存疑是档案质量维度,与抄表状态互不排斥。
// 两级都收:shadow(疑似重复,已被踢出Σ)与 incomplete(档案不全,仍在Σ内),都要人去补档案
const suspectOnly = ref(false)
const suspectCount = computed(() => kindZoneRows.value.filter(x => !!x.m.suspect).length)
const shadowCount = computed(() => kindZoneRows.value.filter(x => x.m.suspect === 'shadow').length)
// 表格行集:全筛选链(tfoot 已抄/未抄/Σ用量 即按此行集算)
const gridRows = computed(() => {
  const rs = filterRows(rowsAll.value, { kind: kind.value, zone: zone.value, building: building.value, own: own.value, status: status.value, q: q.value })
  return suspectOnly.value ? rs.filter(x => !!x.m.suspect) : rs
})

// ── 位置字段候选(§A.3/§A.4 共用:抽屉行内编辑 + 新增表弹窗) ──
// 楼层/方位给基准表打底,再并上库内既有值(存量文件里出现过"中间""夹层"这类基准表外的写法);
// 区域纯数据驱动(各期区块名各不相同,没有通用基准)。
const FLOOR_BASE = ['负一层', '一楼', '二楼', '三楼', '四楼', '五楼', '六楼', '七楼', '八楼', '九楼', '十楼', '天面']
const SIDE_BASE = ['东侧', '西侧', '南侧', '北侧']
const uniqVals = (base: string[], vals: (string | null | undefined)[]) => {
  const out = [...base]
  for (const v of vals) { const t = v?.trim(); if (t && !out.includes(t)) out.push(t) }
  return out
}
const areaOpts = computed(() => uniqVals([], (meters.value ?? []).map(m => m.area)))
const floorOpts = computed(() => uniqVals(FLOOR_BASE, (meters.value ?? []).map(m => m.floorLabel)))
const sideOpts = computed(() => uniqVals(SIDE_BASE, (meters.value ?? []).map(m => m.side)))
// 新增弹窗的位置三态(§F5+§F6 叠加修正 2026-07-31):后端 applyLoc 分 null/空串/有值三态,
// 弹窗必须把前两态分开给,否则「新建时没填」会被 locDeviates 判成人工设定、导入从此不再按位置原文重解析。
//   AUTO('') → 提交 null = 不指定,按位置原文自动解析(新建默认)
//   NONE('-') → 提交 ''  = 显式跨层/不分侧,不许被位置原文解析回来
const LOC_AUTO = ''      // 表单内部值:自动
const LOC_NONE = '-'     // 表单内部值:显式无
const dlgFloorOpts = computed(() =>
  [{ value: LOC_AUTO, label: '(按位置原文自动)' }, { value: LOC_NONE, label: '—(跨层/不适用)' },
    ...floorOpts.value.map(f => ({ value: f, label: f }))])
const dlgSideOpts = computed(() =>
  [{ value: LOC_AUTO, label: '(按位置原文自动)' }, { value: LOC_NONE, label: '—(不分侧)' },
    ...sideOpts.value.map(s => ({ value: s, label: s }))])
// 表单值 → 提交值:自动=null / 显式无=空串 / 有值=原值
const locOut = (v: string) => (v === LOC_AUTO ? null : v === LOC_NONE ? '' : v.trim())

// 楼栋 Select:数据驱动清单(当前 电水+分区 下出现过的楼栋)
const buildingOpts = computed(() => {
  const seen = new Map<number, string>()
  for (const x of kindZoneRows.value) {
    const id = x.m.buildingId
    if (id != null && !seen.has(id)) seen.set(id, buildingNameById.value.get(id) ?? `#${id}`)
  }
  return [{ value: 'all', label: '全部楼栋' }, ...[...seen].map(([id, name]) => ({ value: String(id), label: name }))]
})
watch(buildingOpts, opts => { if (!opts.some(o => o.value === building.value)) building.value = 'all' })

// 统计卡定义(6 张,§1):各卡独立计数,点卡设置对应状态筛选
const cardDefs = computed(() => {
  const c = cards.value
  return [
    { k: 'tenant' as StatusFilter, label: '租户表总数', val: String(c.tenant), sub: '含待核与占位槽' },
    { k: 'read' as StatusFilter, label: '已抄', val: String(c.read), sub: '本月已录总示数', cls: 'ok' },
    { k: 'missing' as StatusFilter, label: '未抄', val: String(c.missing), sub: '点卡筛出后一路回车录入', cls: c.missing > 0 ? 'amber' : '' },
    { k: 'anomaly' as StatusFilter, label: '异常', val: String(c.anomaly), sub: `倒走 ${c.negative} · 时段不符 ${c.touMismatch}`, cls: c.anomaly > 0 ? 'bad' : '' },
    { k: 'attention' as StatusFilter, label: '待核 / 待绑定', val: `${c.pending} · ${c.unbound}`, sub: '原文未挂租户 · 合同待人工选定', cls: c.pending + c.unbound > 0 ? 'coral' : '' },
    { k: 'ready' as StatusFilter, label: '派生就绪', val: String(c.ready), sub: '自动+对位+人工绑定', cls: 'ok' },
  ]
})

// ── 详情抽屉(点行打开;行集重载后引用自动更新;表被删/换期即自动关) ──
const openRow = computed(() => rowsAll.value.find(x => x.m.id === openId.value) ?? null)
watch(openRow, r => { if (openId.value != null && !r) openId.value = null })

// ── 「按名精确匹配一键挂」(待核卡激活时工具栏侧出现,编辑态) ──
const showAutoLink = computed(() =>
  editMode.value && (status.value === 'attention' || status.value === 'pending'))
const linking = ref(false)
const linkEstimate = computed(() =>
  autoLinkEstimate((meters.value ?? []).filter(isPendingMeter).map(m => m.tenantName), tenants.value.flatMap(t => tenantMatchNames(t))))
async function autoLink() {
  if (linking.value) return
  if (!confirm(`按企业名称原文与租户档案精确匹配,预计可挂 ${linkEstimate.value} 块待核表。继续?`)) return
  linking.value = true
  try {
    const r = await metersApi.autoLinkByName()
    alert(`已挂 ${r.linked} 块,跳过 ${r.skipped} 块。`)
    reloadAll()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '一键挂失败，请重试')
  } finally { linking.value = false }
}

// ── 批量删除本期(刀H §H5,编辑态;用户点名:自己测试导入的那批数据要能自己删掉) ──
// 不可逆,故「先预览后执行」:弹窗复述预览数字,并要人手打账期串才放行(§H5.4)。
// 口径=整月(不带 kind/zone):派生快照本就是全园区一次算出来的,只删半边月它整月都不再可信。
// 勾选项一变,预览必须重拉 —— 复述的数字与实删对不上,这个二次确认就成了摆设。
const delPreview = ref<MeterDeleteDTO | null>(null)
const delCascade = ref(true)
const delDropMeters = ref(true)
const delTyped = ref('')
const delBusy = ref(false)
const delOpt = computed(() => ({ cascade: delCascade.value, dropEmptyMeters: delDropMeters.value }))

// 竞态守卫同 rSeq:连点勾选项时慢的那次可能后到,弹窗复述的数字就不是即将执行的那一套口径了
let dSeq = 0
async function loadDelPreview() {
  const my = ++dSeq
  delBusy.value = true
  try {
    const p = await metersApi.deletePreview(ym.value, delOpt.value)
    if (my === dSeq) delPreview.value = p
  } catch (e) {
    if (my === dSeq) { delPreview.value = null; alert((e as { message?: string })?.message ?? '预览失败') }
  } finally {
    // 过期那次不许解锁:新预览还在飞,提前放行「确认删除」等于按旧数字执行
    if (my === dSeq) delBusy.value = false
  }
}
async function openDelDlg() {
  delTyped.value = ''
  delCascade.value = true; delDropMeters.value = true
  await loadDelPreview()
  if (delPreview.value && delPreview.value.readings === 0) {
    alert(`${ym.value} 没有抄表数据可删。`); delPreview.value = null
  }
}
watch([delCascade, delDropMeters], () => { if (delPreview.value) loadDelPreview() })

async function confirmDelete() {
  const p = delPreview.value
  if (!p || delBusy.value || delTyped.value.trim() !== p.ym) return
  delBusy.value = true
  try {
    const r = await metersApi.batchDelete(p.ym, delOpt.value)
    delPreview.value = null
    alert(`已删除 ${r.readings} 条读数、${r.meterDeleted.length} 份表档案、${r.derived} 条派生快照。`
      + (r.meterBlocked.length > 0 ? `\n${r.meterBlocked.length} 份表档案因已被池绑定跳过未删。` : ''))
    reloadAll()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '批量删除失败')
  } finally { delBusy.value = false }
}

// ── 导入(registry 'meter')/模板/导出当月(v4 原样) ──
const importResult = ref<ImportResultDTO | null>(null)
const importCtx: ImportCtx = {}
async function onImport(payload: ImportRec[] | { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  try {
    importResult.value = await runImport('meter', payload as never, importCtx, fileName)
    reloadAll()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}
async function onTemplate() {
  try { await buildMeterTemplate(ym.value) }
  catch (e) { alert((e as { message?: string })?.message ?? '模板下载失败') }
}
const exporting = ref(false)
async function onExport() {
  if (exporting.value) return
  exporting.value = true
  try { await exportMeterMonth(ym.value, meters.value ?? [], readings.value ?? []) }
  catch (e) { alert((e as { message?: string })?.message ?? '导出失败') }
  finally { exporting.value = false }
}

// ── 新增表弹窗(编辑态,标题行入口;v4 原样迁移) ──
const meterDlg = ref(false)
// §A.4:补 区域/楼层/方位/房号(表编码本就有)——手工建的表不补这些就永久缺席导入位置索引
const mForm = ref({
  kind: 'elec', zone: 'p1', building: '', spot: '', tenantId: null as number | null,
  ownership: 'share', name: '', subName: '', code: '', factor: '',
  area: '', floorLabel: '', side: '', roomNo: '',
})
const mErr = ref('')
const DLG_ZONE_OPTS = [{ value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }, { value: 'dorm', label: '宿舍' }]
const DLG_OWN_OPTS = computed(() =>
  Object.keys(OWNERSHIP_LABEL).map(value => ({ value, label: ownershipLabel(value, mForm.value.kind) })))
const dlgBuildingOpts = computed(() => [
  { value: '', label: '—(未关联)' },
  ...buildings.value.map(b => ({ value: String(b.id), label: `${b.phaseName} · ${b.name}` })),
])
const tenantOpts = computed(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))
function openMeterDlg() {
  mForm.value = {
    kind: kind.value, zone: zone.value,
    building: '', spot: '', tenantId: null, ownership: 'share', name: '', subName: '', code: '', factor: '',
    area: '', floorLabel: '', side: '', roomNo: '',
  }
  mErr.value = ''
  meterDlg.value = true
}
const trimOrNull = (s: string) => s.trim() || null
async function submitMeter() {
  const name = mForm.value.name.trim()
  if (!name) { mErr.value = '请输入标识名'; return }
  const factor = mForm.value.factor.trim() === '' ? 1 : Number(mForm.value.factor)
  if (!Number.isFinite(factor) || factor <= 0) { mErr.value = '倍率需为正数(留空=1)'; return }
  try {
    await metersApi.create({
      kind: mForm.value.kind as MeterKind, zone: mForm.value.zone as MeterZone, name, factor,
      subName: trimOrNull(mForm.value.subName),
      spot: trimOrNull(mForm.value.spot), code: trimOrNull(mForm.value.code),
      area: trimOrNull(mForm.value.area),
      // §F5:三列发空串(与抽屉 reqOf 一致)。后端三态里 ''=显式清除(跨层/不适用),null 才是「按 spot 解析」;
      // 发 null 会让这里选的「—(跨层/不适用)」被 spot 解析盖掉,Select 上那句「可空=跨层」就成了假话。
      floorLabel: locOut(mForm.value.floorLabel), side: locOut(mForm.value.side),
      roomNo: mForm.value.roomNo.trim() || null,
      tenantId: mForm.value.tenantId,
      buildingId: mForm.value.building === '' ? null : Number(mForm.value.building),
      ownership: mForm.value.tenantId != null ? 'tenant' : mForm.value.ownership,
    })
    meterDlg.value = false
    reloadAll()
  } catch (e) {
    mErr.value = (e as { message?: string })?.message ?? '新增失败'
  }
}

const emptyText = computed(() => {
  // 分区是一级页签恒定生效,不计入"筛过"判定
  const filtered = building.value !== 'all' || own.value !== 'all'
    || status.value !== 'all' || q.value.trim() !== ''
  return filtered ? '当前筛选下没有匹配的表(点「重置」清筛选)'
    : '该分区暂无表档案 —— 可导入整册抄表工作簿自动建档,或编辑模式下「新增表」。'
})
</script>

<template>
  <!-- 首载 gate:表档案/当月读数未落位不闪空表(v-else 紧邻,LIST-PAGE 加载门) -->
  <!-- 表档案首载失败:整页无内容可显,骨架屏会一直转 —— 换成提示+重试,别让用户干等 -->
  <div v-if="!meters && metersErr" class="mt-gate-fail">
    <div class="mt-empty bad">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <span>{{ metersErr }}</span>
      <Button variant="outline" size="sm" @click="loadMeters">重试</Button>
    </div>
  </div>
  <div v-else-if="!meters || !readings" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="mt-page">
    <!-- 标题行:h2+账期+抄表进度条;右=模板/导出(常驻)+导入/新增表(编辑态)+编辑模式(最右) -->
    <div class="mt-head">
      <div class="mt-head-l">
        <h2 class="mt-title"><span class="ic"><component :is="iconFor('gauge')" :size="18" /></span>园区抄表</h2>
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <div class="mt5-prog" :title="`抄表进度(随电水/分区筛选):已抄 ${cards.read} / 租户表 ${cards.tenant}`">
          <div class="bar"><span :style="{ width: progressPct + '%' }" /></div>
          <span class="txt">{{ cards.read }}/{{ cards.tenant }} · {{ progressPct }}%</span>
        </div>
      </div>
      <div class="mt5-actions">
        <!-- 草稿式编辑(§7.2):编辑中显改动数 tag;「完成」经 onEditBtn 走确认流 -->
        <span v-if="editMode" class="mt5-tag">编辑中 · {{ dirtyIds.length }} 处改动</span>
        <Button variant="outline" size="sm" @click="onTemplate">
          <template #leading><component :is="iconFor('file-spreadsheet')" :size="14" /></template>
          下载模板
        </Button>
        <Button variant="outline" size="sm" :disabled="exporting" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出当月
        </Button>
        <!-- 导入/新增表收编辑态(EDIT-MODE-SPEC);模板/导出=只读操作常驻 -->
        <Button v-if="editMode" variant="outline" size="sm" @click="importing = true">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入
        </Button>
        <Button v-if="editMode" variant="outline" size="sm" @click="openMeterDlg">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增表
        </Button>
        <!-- §H5 批量删除本期(整月,不可逆):编辑态才出现;viewer 进不了编辑态,入口天然不可见 -->
        <Button
          v-if="editMode" variant="danger" size="sm" :disabled="delBusy"
          title="删除本账期全部读数,并级联删除该月派生快照与删完零读数的表档案(池成员表跳过);执行前会先给出预览数字并要求手打账期确认"
          @click="openDelDlg"
        >
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          批量删除本期
        </Button>
        <Button
          v-if="!auth.isReadonly" :variant="editMode ? 'filled' : 'outline'" size="sm"
          :disabled="saving || !!readErr"
          :title="readErr ? '本月读数未加载成功,先点失败条上的「重试」再录入' : undefined"
          @click="onEditBtn"
        >
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 统计卡行(6 张,随电水/分区;点=状态筛选互斥切换,选中高亮) -->
    <div class="mt5-cards">
      <button
        v-for="c in cardDefs" :key="c.k"
        class="mt5-card" :class="[c.cls, { on: status === c.k }]"
        :title="status === c.k ? '再点取消筛选' : '点击按此维度筛选表格'"
        @click="cardClick(c.k)"
      >
        <span class="lab">{{ c.label }}</span>
        <span class="val">{{ c.val }}</span>
        <span class="sub">{{ c.sub }}</span>
      </button>
    </div>

    <!-- 加载失败条:两条各自成行(同 PoolLedgerView §F11,别让一条盖掉另一条的原因) -->
    <div v-if="readErr || metersErr" class="mt-empty bad">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <div class="msg">
        <div v-if="readErr">{{ readErr }} —— 读数列一律置空(不拿上月数据顶替),编辑模式已锁,重试成功后再录入</div>
        <div v-if="metersErr">{{ metersErr }} —— 表档案停留在上次拉到的版本</div>
      </div>
      <Button variant="outline" size="sm" @click="retryLoad">重试</Button>
    </div>

    <!-- 月度空态引导(三分支:编辑态/可编辑/只读);读数没拉到不是「本月无数据」,让位给失败条 -->
    <div v-if="!readErr && readings.length === 0" class="mt-empty">
      <component :is="iconFor('info')" :size="14" />
      <span>
        {{ year }}年{{ month }}月暂无抄表数据 ——
        <template v-if="editMode">可<button class="mt-link" @click="importing = true">导入</button>整册抄表工作簿(自动建档),或行内直接录入本月示数。</template>
        <template v-else-if="!auth.isReadonly">进入右上角「编辑模式」后可录入或导入。</template>
        <template v-else>各表读数列为空。</template>
      </span>
    </div>

    <!-- 筛选条:电/水 → 分区 → 楼栋(数据驱动) → 归属 → 状态 → 搜索 → 一键挂/分时列/重置 -->
    <div class="mt5-filters">
      <Segmented :options="ZONE_OPTS" :model-value="zone" size="sm" @update:model-value="zone = $event; building = 'all'" />
      <Segmented :options="KIND_OPTS" :model-value="kind" size="sm" @update:model-value="kind = $event" />
      <div style="width:132px">
        <Select :options="buildingOpts" :model-value="building" size="sm" @update:model-value="building = $event" />
      </div>
      <div style="width:110px">
        <Select :options="OWN_OPTS" :model-value="own" size="sm" @update:model-value="own = $event" />
      </div>
      <div style="width:110px">
        <Select :options="STATUS_OPTS" :model-value="statusSel" size="sm" @update:model-value="status = $event as StatusFilter" />
      </div>
      <div class="mx-search">
        <span class="mx-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input v-model="q" placeholder="搜索租户/原文/房号/表号/编码" />
      </div>
      <!-- 只看存疑(V75 §E3/§F1):有存疑表才出现;按下=只列两级存疑档案(疑似重复 + 档案不全) -->
      <Button
        v-if="suspectCount > 0" :variant="suspectOnly ? 'filled' : 'outline'" size="sm"
        :title="`${suspectCount} 块表区域/位置/企业名称/编码全空;其中 ${shadowCount} 块另配到档案完整、同月示数与倍率全等的同栋同类表,疑似重复建档(红底,用量不计入楼栋分表Σ),其余只是档案不全(黄底,用量照常计入Σ)`"
        @click="suspectOnly = !suspectOnly"
      >
        <template #leading><component :is="iconFor('alert-triangle')" :size="14" /></template>
        只看存疑 · {{ suspectCount }}
      </Button>
      <span style="flex:1" />
      <!-- 「按名精确匹配一键挂」:待核卡激活时工具栏侧出现(编辑态,S2 §3) -->
      <Button v-if="showAutoLink" variant="outline" size="sm" :disabled="linking || cards.pending === 0" @click="autoLink">
        <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
        按名精确匹配一键挂
      </Button>
      <Button variant="outline" size="sm" @click="resetFilters">重置</Button>
    </div>

    <!-- 台账同款电子表格(§7 v5.1):分时列常驻,无分页,草稿式编辑 -->
    <MeterLedgerGrid
      :rows="gridRows" :edit-mode="editable" :kind="kind" :zone="zone" :draft="draft"
      :building-name-by-id="buildingNameById" :empty-text="emptyText"
      @open="openId = $event" @cell-edit="onCellEdit"
    />

    <!-- 退出编辑确认(§7.2):保存修改/放弃修改/×留在编辑态 -->
    <SaveConfirmDialog
      v-if="saveConfirm" :count="dirtyIds.length"
      @save="onSaveChanges" @discard="onDiscardChanges" @close="saveConfirm = false"
    />

    <!-- 详情抽屉:三页签(表档案/历史读数/合同绑定) -->
    <MeterDetailDrawer
      :row="openRow" :edit-mode="editMode" :default-ym="ym"
      :tenants="tenants" :buildings="buildings" :bind-available="bindRows !== null && !bindFail"
      :area-opts="areaOpts" :floor-opts="floorOpts" :side-opts="sideOpts"
      @close="openId = null" @reload="reloadAll"
    />

    <!-- 导入(registry key 'meter':整册 parseWorkbook → sections 勾选段;flat/sections 两口都接) -->
    <FpImportModal
      v-if="importing"
      title="导入 园区抄表 · 水电表读数"
      sub="上传整册抄表工作簿(一期/二期/宿舍×电/水 sheet,标题行含年月),识别 sheet 逐段勾选;表自动建档并按企业名称匹配租户/楼栋/归属,同表同月重复导入自动覆盖;缺本月读数照收并标「未抄」"
      v-bind="parserProps('meter', { ...importCtx, year, month })"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImport"
    />
    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />

    <!-- 新增表轻量弹窗(v4 原样) -->
    <div v-if="meterDlg" class="mt-mask" @mousedown="meterDlg = false">
      <div class="mt-dlg" @mousedown.stop>
        <div class="mt-dlg-h">
          <h3>新增表</h3>
          <p>手工建档一块水/电表;楼栋/租户/归属可留空或后补,导入整册抄表工作簿时会自动匹配/刷新。</p>
        </div>
        <div class="mt-dlg-b">
          <div class="mt-dlg-row">
            <Select v-model="mForm.kind" label="类别" :options="KIND_OPTS" size="sm" />
            <Select v-model="mForm.zone" label="分区" :options="DLG_ZONE_OPTS" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Select v-model="mForm.building" label="期数·楼栋(可空)" :options="dlgBuildingOpts" size="sm" />
            <Select v-model="mForm.ownership" label="归属" :options="DLG_OWN_OPTS" size="sm" :disabled="mForm.tenantId != null" />
          </div>
          <div class="mt-fld">
            <label>租户(可空;户内表关联,选定即归属「租户」)</label>
            <FPTenantPicker v-model="mForm.tenantId" :tenants="tenantOpts" placeholder="选择租户(可空)" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.name" label="标识名(内部键,同区同类唯一)" placeholder="如:一车间总电" size="sm" />
            <Input v-model="mForm.subName" label="表名称(可空)" placeholder="如:电表①" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.factor" label="倍率(留空=1)" placeholder="如:500" size="sm" type="number" />
            <Input v-model="mForm.area" label="区域(可空,区块名)" placeholder="如:A座 / 六车间" size="sm" />
          </div>
          <!-- §A.4 位置四件套:楼层/方位/房号是稳定主数据(排序+公摊按层分份),位置原文另兼导入匹配键 -->
          <div class="mt-dlg-row">
            <Select v-model="mForm.floorLabel" label="楼层" :options="dlgFloorOpts" size="sm" />
            <Select v-model="mForm.side" label="方位(可空)" :options="dlgSideOpts" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.roomNo" label="房号(可空)" placeholder="如:101室" size="sm" />
            <Input v-model="mForm.spot" label="位置原文(可空,导入匹配键)" placeholder="如:四楼西侧101室" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.code" label="表编码(可空,导入首选身份键)" size="sm" />
          </div>
          <div class="mt-dlg-err">{{ mErr }}</div>
        </div>
        <div class="mt-dlg-f">
          <Button variant="gray" size="sm" @click="meterDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitMeter">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            新增
          </Button>
        </div>
      </div>
    </div>

    <!-- §H5 批量删除本期:复述预览数字 + 级联勾选 + 手打账期才放行(不可逆,无撤销) -->
    <div v-if="delPreview" class="mt-mask" @mousedown="delPreview = null">
      <div class="mt-dlg" @mousedown.stop>
        <div class="mt-dlg-h">
          <h3>批量删除本期 · {{ delPreview.ym }}</h3>
          <p>不可逆操作,删除后无法撤销。请核对下列数字后输入账期确认。</p>
        </div>
        <div class="mt-dlg-b">
          <ul class="mt5-del-list">
            <li>将删除读数 <b>{{ delPreview.readings }}</b> 条,涉及 <b>{{ delPreview.meters }}</b> 块表</li>
            <li>其中 <b>{{ delPreview.metersEmptied }}</b> 块表删完后零读数</li>
            <li>该月已生成的派生快照 <b>{{ delPreview.derived }}</b> 条(池核算/逐表明细/损耗/分摊结果)</li>
            <li v-if="delPreview.meterDeleted.length > 0">
              连带删除表档案 <b>{{ delPreview.meterDeleted.length }}</b> 份:{{ delPreview.meterDeleted.join('、') }}
            </li>
            <li v-if="delPreview.meterBlocked.length > 0" class="warn">
              已被池绑定、跳过不删的表档案 <b>{{ delPreview.meterBlocked.length }}</b> 份:{{ delPreview.meterBlocked.join('、') }}
            </li>
            <li v-if="delPreview.manualKept.length > 0" class="keep">
              保留的手工分摊行 <b>{{ delPreview.manualKept.length }}</b> 条(不删):{{ delPreview.manualKept.join('、') }}
            </li>
          </ul>
          <label class="mt5-del-ck">
            <input v-model="delCascade" type="checkbox" >
            <span>同时删除该月派生快照(手工分摊行始终保留)</span>
          </label>
          <label class="mt5-del-ck">
            <input v-model="delDropMeters" type="checkbox" >
            <span>同时删除「删完零读数」的表档案(池成员表自动跳过)</span>
          </label>
          <Input v-model="delTyped" :label="`确认请输入账期 ${delPreview.ym}`" :placeholder="delPreview.ym" size="sm" />
        </div>
        <div class="mt-dlg-f">
          <Button variant="gray" size="sm" @click="delPreview = null">取消</Button>
          <Button
            variant="danger" size="sm"
            :disabled="delBusy || delTyped.trim() !== delPreview.ym"
            @click="confirmDelete"
          >
            <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
            确认删除
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mt-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(pm-head 家族):左=标题+账期+进度条;右=按钮组 */
.mt-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mt-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mt-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.mt-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.mt5-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 编辑中改动数 tag(lg-tag.edit 同款) */
.mt5-tag { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: var(--radius-full); background: rgb(252, 243, 232); color: var(--hue-orange); font-size: 12.5px; font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* 抄表进度条(已抄/租户表数,随 kind/zone) */
.mt5-prog { display: flex; align-items: center; gap: 8px; cursor: help; }
.mt5-prog .bar { width: 132px; height: 6px; border-radius: var(--radius-full); background: var(--bg-sunken); overflow: hidden; }
.mt5-prog .bar span { display: block; height: 100%; border-radius: var(--radius-full); background: rgb(52, 168, 83); transition: width var(--dur-fast) var(--ease-standard); }
.mt5-prog .txt { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; }

/* 统计卡行:6 张可点击卡,选中高亮 */
.mt5-cards { flex: 0 0 auto; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.mt5-card { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px 14px; min-width: 0; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); cursor: pointer; text-align: left; font: inherit; transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.mt5-card:hover { border-color: var(--border-strong); }
.mt5-card.on { border-color: var(--hue-blue); background: rgb(240, 246, 255); box-shadow: 0 0 0 1px var(--hue-blue) inset; }
.mt5-card .lab { font: var(--type-label); color: var(--text-muted); white-space: nowrap; }
.mt5-card .val { font-size: 21px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-tight); color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1.1; white-space: nowrap; }
.mt5-card .sub { font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mt5-card.ok .val { color: rgb(21, 128, 61); }
.mt5-card.amber .val { color: rgb(190, 110, 0); }
.mt5-card.bad .val { color: var(--hue-red); }
.mt5-card.coral .val { color: rgb(202, 66, 41); }

/* 筛选条:单行 */
.mt5-filters { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* 月度空态引导条 */
.mt-empty { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.mt-link { border: none; background: none; padding: 0; margin: 0 2px; font: inherit; color: var(--hue-blue); cursor: pointer; }
.mt-link:hover { text-decoration: underline; }

/* 加载失败条(借空态条骨架换红):提示 + 重试入口 */
.mt-empty.bad { border-style: solid; border-color: var(--hue-red); background: rgb(255, 238, 237); color: var(--hue-red); }
.mt-empty .msg { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
/* 首载失败占满 gate 的位置(与 .page-loading 同为整页态,顶部起排不居中) */
.mt-gate-fail { padding: 24px 0; max-width: 1600px; margin: 0 auto; width: 100%; box-sizing: border-box; }

/* 新增表弹窗(v4 mt-dlg 家族) */
.mt-mask { position: fixed; inset: 0; background: rgba(28, 28, 28, .34); z-index: 140; display: grid; place-items: center; }
.mt-dlg { width: min(460px, 90vw); background: var(--surface-white); border-radius: var(--radius-xl); box-shadow: 0 16px 48px rgba(28, 28, 28, .22); overflow: visible; }
.mt-dlg-h { padding: 20px 22px 0; }
.mt-dlg-h h3 { margin: 0; font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.mt-dlg-h p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.mt-dlg-b { padding: 16px 22px 4px; display: flex; flex-direction: column; gap: 12px; }
.mt-dlg-row { display: flex; gap: 12px; }
.mt-dlg-row > * { flex: 1; min-width: 0; }
.mt-fld label { display: block; margin-bottom: 5px; font-size: var(--fs-label); color: var(--text-secondary); }
.mt-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }

/* §H5 批量删除确认:预览数字复述 + 级联勾选 */
.mt5-del-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--text-secondary); }
.mt5-del-list b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.mt5-del-list .warn { color: var(--hue-orange); }
.mt5-del-list .keep { color: var(--text-muted); }
.mt5-del-ck { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.mt-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }
</style>
