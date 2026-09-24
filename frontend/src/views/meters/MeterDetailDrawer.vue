<script setup lang="ts">
// 详情抽屉(METER-V5-SPEC §4,FPDrawer/PAGE-BEHAVIOR-SPEC §2,点行打开,四页签):
// 【表档案】档案行内编辑集中:楼栋/租户 FPTenantPicker/归属/表名称/倍率/表类型 + 删除表(409 守卫);
// 【历史读数】原 ReadingDrawer 内容:逐月行式增删改、补历史月(仅编辑态);
// 【合同绑定】状态分桶+候选合同选定绑定(PUT /bind)+date_missing 唯一候选一键确认+解绑;待核先挂租户。
// 【档案变更】在册状态各段(加一行/改月/撤回)、归属各段、每一次写的记录与「撤销这次导入」。
// 编辑均收编辑态(EDIT-MODE-SPEC v2)。资产列(名称/编码/倍率/表类型)行内改=乐观更新失败回滚;
// 归属/位置/合同绑定按月写(METER-TIMELINE-SPEC §3.3):站在查看月 V 写一行,不顺手改别的月。
import { ref, computed, watch, onDeactivated } from 'vue'
import {
  metersApi, DEVICE_TYPE_LABEL,
  type MeterDTO, type MeterAssetReq, type MeterAssignPatch, type MeterReadingDTO, type MeterDeviceType,
  type MeterTimelineDTO, type MeterOwnership,
} from '@/api/meters'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'
import { readingFlags } from '@/utils/meterLogic'
import { METER_KIND_LABEL } from '@/utils/meterExcel'
import { zoneLabel } from '@/utils/zoneLabel'
import { ownershipLabel } from '@/utils/meterSplit'
import {
  BIND_STATUS_NOTE, BIND_BUCKET_LABEL, bindQueueBucket, bindReason, bookLine,
  type WorkbenchRow,
} from '@/composables/useMeterWorkbench'
import { useAuthStore } from '@/stores/auth'
import { useViewport } from '@/composables/useViewport'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Segmented from '@/components/ds/Segmented.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import MeterAssignDialog from './MeterAssignDialog.vue'
import MeterTimelinePane from './MeterTimelinePane.vue'
import MeterDeleteDialog from './MeterDeleteDialog.vue'
import { STATUS_LABEL, EARLIEST, rangeText, lockedText, type AssignChoice } from './meterTimeline'

const props = defineProps<{
  row: WorkbenchRow | null
  editMode: boolean
  defaultYm: string              // 查看月 V:档案站在这个月看、按月改从这个月起;也是新增读数的默认月份
  tenants: TenantDTO[]
  buildings: BuildingDTO[]
  bindAvailable: boolean         // GET /binding 是否可用(后端未就绪降级)
  areaOpts: string[]             // §A.3 位置字段候选(库内既有值 ∪ 基准表,由 MeterView 汇总)
  floorOpts: string[]
  sideOpts: string[]
}>()
const emit = defineEmits<{ close: []; reload: [] }>()

// RBAC v2:一个编辑模式,两把权限(RBAC-SPEC §6 点名本文件)——
// 档案页与合同绑定(倍率/位置/归属/绑定/删表)= meter-master:edit;历史读数增删改 = meter-reading:edit。
// 无权那半边照常显示全部数据,只是不出编辑控件。
const auth = useAuthStore()
const editProfile = computed(() => props.editMode && auth.can('meter-master:edit'))
const editReading = computed(() => props.editMode && auth.can('meter-reading:edit'))

const m = computed(() => props.row?.m ?? null)

const fq = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const numOrNull = (s: string | number): number | null => {
  // v-model 在 type="number" 输入上会自动转 number(Vue3 内建行为)——传数字时 s.trim 直接
  // TypeError,保存在弹提示前静默死亡(2026-08-04 报障"按了没反应",实测控制台复现)
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const fs = (v: number | null) => (v == null ? '' : String(v))
const failMsg = (e: unknown) => (e as { message?: string })?.message ?? '保存失败，请重试'
const FACTOR_TITLE = '倍率,回车/失焦保存;历史读数仍按录入时快照计用量,改倍率只影响之后新录'

// ── 页签 ──
const tab = ref('profile')
// 手机档(≤600)四个页签用两字名:四字名排不进 390 宽的标题行,第四个会被裁掉点不到
const { tier } = useViewport()
const TABS = computed(() => {
  const s = tier.value === 's'
  return [
    { value: 'profile', label: s ? '档案' : '表档案' },
    { value: 'history', label: s ? '读数' : '历史读数' },
    { value: 'bind', label: s ? '绑定' : '合同绑定' },
    { value: 'timeline', label: s ? '变更' : '档案变更' },
  ]
})

const tenantById = computed(() => new Map(props.tenants.map(t => [t.id, t])))
const buildingById = computed(() => new Map(props.buildings.map(b => [b.id, b])))
const tenantOpts = computed(() =>
  props.tenants.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))

const drawerSub = computed(() => {
  const mm = m.value
  if (!mm) return ''
  const parts = [`${zoneLabel(mm.zone)}${METER_KIND_LABEL[mm.kind]}`]
  if (props.row?.tenantLabel) parts.push(props.row.tenantLabel)
  else if (mm.ownership !== 'tenant') parts.push(ownershipLabel(mm.ownership, mm.kind))
  parts.push(`共 ${history.value?.length ?? mm.readingCount} 条读数`)
  return parts.join(' · ')
})

// ── 【表档案】行内编辑(乐观更新失败回滚,v4 RosterPanel 口径) ──
const OWN_KEYS = ['tenant', 'share', 'ops', 'infra', 'park', 'register'] as const
const OWN_OPTS = computed(() =>
  OWN_KEYS.map(value => ({ value, label: ownershipLabel(value, m.value?.kind) })))
// 资产列(不分月)走 PUT /{id}:只收这几格,归属/位置/状态/合同钉各走按月写的端点
const assetReqOf = (mm: MeterDTO): MeterAssetReq => ({
  kind: mm.kind, zone: mm.zone, name: mm.name, meterType: mm.meterType, deviceType: mm.deviceType,
  code: mm.code, factor: mm.factor,
})
// 标识名/编码行内提交:乐观更新失败回滚。name 是唯一键 (kind,zone,name),后端 409 的中文消息原样弹出,不吞。
function commitAsset(mm: MeterDTO, key: 'name' | 'code', raw: string) {
  if (!editProfile.value) return
  const t = raw.trim()
  if (key === 'name' && t === '') { alert('标识名不能为空'); return }
  const v = key === 'name' ? t : (t || null)      // 编码留空=清除
  const rec = mm as unknown as Record<'name' | 'code', string | null>
  if (v === (rec[key] ?? null)) return
  const prev = rec[key]
  rec[key] = v
  metersApi.update(mm.id, assetReqOf(mm)).catch((e) => { rec[key] = prev; alert(failMsg(e)) })
}
const SPOT_TITLE = '位置原文:下次导入按它认表(表编码/标识名认不到时)。'
  + '改它时,没有标「人工设定」的楼层/方位/房号会跟着按新的原文重新解析;标了的不动'
// §F6/§G5 人工设定标志:某列与「位置原文」解析结果不一致即置该位,由后端派生,前端不上报。
// V78 起是位掩码逐列判定(bit0 楼层/bit1 方位/bit2 房号)——只改房号不会连楼层一起冻住。
const LOC_BIT = { floorLabel: 1, side: 2, roomNo: 4 } as const
const locPinned = (mm: MeterDTO, key: keyof typeof LOC_BIT) => ((mm.locManual ?? 0) & LOC_BIT[key]) !== 0
const LOC_MANUAL_TITLE = '这一项已与「位置原文」不一致,视为人工设定:下次导入不会按原文重解析它'
  + '(其余两项不受影响,各自独立判定);若原文变了(表挪了地方),导入结果里会落一条提醒请你核对。'
  + '改回与原文一致即恢复自动跟随'
// §G5 存疑标(V75):shadow 会把这块表踢出楼栋分表Σ 与池分母,原先只能由「补齐识别信息」自动清 ——
// 配不上那一条的表(识别信息本就齐全、只是被误判重复)永远解不掉。这里是显式人工入口。
const SUSPECT_LABEL: Record<string, string> = { shadow: '存疑·疑似重复建档', incomplete: '档案不全' }
const SUSPECT_TITLE: Record<string, string> = {
  shadow: '疑似同一块物理表的第二份档案:本表用量不计入楼栋分表Σ、不进池分母。'
    + '确认它是独立的一块表 → 点「认领为独立表」解除,用量立即重新计入',
  incomplete: '档案不全(区域/位置/企业名称/编码四项全空):用量照常计入Σ,只是提醒补档案。'
    + '补齐任一项保存即自动清标,也可在此直接解除',
}
function clearSuspect(mm: MeterDTO) {
  if (!editProfile.value) return
  if (!confirm(`确认「${mm.name}」是独立的一块表?解除后它的用量会立即重新计入楼栋分表Σ 与池分母。`)) return
  const prev = mm.suspect
  mm.suspect = null
  metersApi.update(mm.id, { ...assetReqOf(mm), suspect: '' })
    .then(() => emit('reload'))    // 进/出Σ 改变对账口径,重载刷新
    .catch((e) => { mm.suspect = prev; alert(failMsg(e)) })
}
function commitFactor(mm: MeterDTO, raw: string) {
  if (!editProfile.value) return
  const v = raw.trim() === '' ? 1 : Number(raw)   // 留空=1(档案 factor NOT NULL DEFAULT 1)
  if (!Number.isFinite(v) || v <= 0) { alert('倍率需为正数'); return }
  if (v === mm.factor) return
  const prev = mm.factor
  mm.factor = v
  metersApi.update(mm.id, assetReqOf(mm)).catch((e) => { mm.factor = prev; alert(failMsg(e)) })
}
function commitDeviceType(mm: MeterDTO, raw: string) {
  if (!editProfile.value) return
  const v = (raw === '' ? null : raw) as MeterDeviceType | null
  if (v === mm.deviceType) return
  const prev = mm.deviceType
  mm.deviceType = v
  metersApi.update(mm.id, assetReqOf(mm)).catch((e) => { mm.deviceType = prev; alert(failMsg(e)) })
}

// ── 归属 / 位置 / 合同绑定:按月写(METER-TIMELINE-SPEC §3.3) ──
// 站在查看月 V 写。要说清影响哪几个月、有没有不能改的月份,所以先拉这块表的分段(timeline)。
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const tl = ref<MeterTimelineDTO | null>(null)
const tlErr = ref('')          // 独立错误槽,只在成功分支清
let tlSeq = 0
async function loadTimeline() {
  const mm = m.value, ym = props.defaultYm
  if (!mm || !YM_RE.test(ym)) return
  const n = ++tlSeq
  try {
    const d = await metersApi.timeline(mm.id, ym)
    if (n === tlSeq) { tl.value = d; tlErr.value = '' }
  } catch (e) {
    if (n === tlSeq) tlErr.value = (e as { message?: string })?.message ?? '档案分段加载失败，请重试'
  }
}
// 分段没加载成功(或重拉失败、手上是旧的)就不给按月写:区间和不能改的月份都是从它算的
const canAssign = computed(() => editProfile.value && !!tl.value && !tlErr.value)

interface Ask {
  title: string
  lines: string[]
  siblings: boolean            // 同房间的表一起改(换租户 / 改归属)
  migrate: boolean             // 给「一并更正上线时复制的后续段」
  tenantTo: string | null      // 换到哪一户:写明整月算给谁
  run: (c: AssignChoice) => Promise<unknown>
}
const ask = ref<Ask | null>(null)
const formKey = ref(0)         // 取消 / 失败后把行内输入复位成档案值
watch(canAssign, v => { if (!v) ask.value = null })
watch([() => m.value?.id, () => props.defaultYm], () => {
  tl.value = null
  ask.value = null
  loadTimeline()
}, { immediate: true })
onDeactivated(() => { ask.value = null; delOpen.value = false; cancelForm() })

// 当前这一段正好从 V 起(或 V 早于第一段)、没有要一起改的同房间表、没有上线复制的后续段、没有不能改的月份、
// 也不是换租户 → 直接写这一行;否则弹「从哪个月起改」(MeterAssignDialog)。
function request(a: Ask) {
  if (!canAssign.value || !tl.value) return
  const i = tl.value.impact
  const single = !i.correct || i.correct.from === i.from.from
  const direct = single && !i.from.locked.length && !a.tenantTo
    && !(a.siblings && tl.value.siblings.length) && !(a.migrate && i.migrateCopies > 0)
  if (!direct) { ask.value = a; return }
  a.run({ mode: 'from', siblingIds: [], alsoMigrate: false })
    .then(afterWrite)
    .catch((e) => { formKey.value++; alert(failMsg(e)) })
}
function afterWrite() {
  ask.value = null
  loadTimeline()
  emit('reload')
}
function onAskClose() { ask.value = null; formKey.value++ }

const assignRun = (mm: MeterDTO, patch: MeterAssignPatch) => (c: AssignChoice) => {
  if (!canAssign.value) return Promise.resolve()
  return metersApi.assign({
    ym: props.defaultYm, mode: c.mode, meterIds: [mm.id, ...c.siblingIds], patch, alsoMigrateCopies: c.alsoMigrate,
  })
}
const shown = (v: string | null | undefined) => (v == null || v === '' ? '空' : v)
const ASSIGN_LABEL = {
  area: '区域', floorLabel: '楼层', side: '方位', roomNo: '房号', spot: '位置原文',
  tenantName: '企业名称原文', subName: '表名称',
} as const
type AssignKey = keyof typeof ASSIGN_LABEL
function editAssign(mm: MeterDTO, key: AssignKey, raw: string) {
  if (!canAssign.value) return
  const v = raw.trim() || null      // 留空=清除
  if (v === (mm[key] ?? null)) return
  request({
    title: '改归属', lines: [`${ASSIGN_LABEL[key]}:${shown(mm[key])} → ${shown(v)}`],
    siblings: false, migrate: true, tenantTo: null, run: assignRun(mm, { [key]: v }),
  })
}
const tenantLabelOf = (id: number | null) =>
  (id == null ? '未挂' : tenantById.value.get(id)?.companyName ?? `#${id}`)
const buildingLabelOf = (id: number | null) =>
  (id == null ? '未关联' : buildingById.value.get(id)?.name ?? `#${id}`)
// 挂 / 换租户:选定即归属「租户」。从一户换到另一户时,企业名称原文一并写成新户的名字 ——
// 否则新的那一段还挂着老户的名字,导入比对、操作日志都按它说话。待核挂户(原先没有户)不动原文。
function editTenant(mm: MeterDTO, id: number | null, toName?: string | null) {
  if (!canAssign.value) return
  if (id === mm.tenantId) return
  const name = id == null ? null : (toName ?? tenantById.value.get(id)?.companyName ?? null)
  const patch: MeterAssignPatch = { tenantId: id }
  const lines = [`租户:${tenantLabelOf(mm.tenantId)} → ${id == null ? '未挂' : name ?? `#${id}`}`]
  if (id != null && mm.ownership !== 'tenant') {
    patch.ownership = 'tenant'
    lines.push(`归属:${ownershipLabel(mm.ownership, mm.kind)} → ${ownershipLabel('tenant', mm.kind)}`)
  }
  if (name != null && mm.tenantId != null && name !== mm.tenantName) {
    patch.tenantName = name
    lines.push(`企业名称原文:${shown(mm.tenantName)} → ${name}`)
  }
  request({
    title: '改租户', lines, siblings: true, migrate: true,
    tenantTo: id == null ? null : name ?? `#${id}`, run: assignRun(mm, patch),
  })
}
function editBuilding(mm: MeterDTO, raw: string) {
  if (!canAssign.value) return
  const id = raw === '' ? null : Number(raw)
  if (id === mm.buildingId) return
  request({
    title: '改归属', lines: [`楼栋:${buildingLabelOf(mm.buildingId)} → ${buildingLabelOf(id)}`],
    siblings: false, migrate: true, tenantTo: null, run: assignRun(mm, { buildingId: id }),
  })
}
function editOwnership(mm: MeterDTO, raw: string) {
  if (!canAssign.value) return
  if (raw === mm.ownership) return
  request({
    title: '改归属', lines: [`归属:${ownershipLabel(mm.ownership, mm.kind)} → ${ownershipLabel(raw, mm.kind)}`],
    siblings: true, migrate: true, tenantTo: null, run: assignRun(mm, { ownership: raw as MeterOwnership }),
  })
}

// 「人工设定」:查看月那一段哪几组被人改过(导入不按册子覆盖);「改回按册子」清的正是这一段
const LOC_NAME = { floorLabel: '楼层', side: '方位', roomNo: '房号' } as const
const manualOn = computed(() => {
  const mm = m.value
  if (!mm) return [] as string[]
  const loc = (Object.keys(LOC_NAME) as (keyof typeof LOC_NAME)[]).filter(k => locPinned(mm, k)).map(k => LOC_NAME[k])
  return [mm.tenantManual ? '租户' : '', mm.ownerManual ? '归属/楼栋' : '', ...loc].filter(Boolean)
})
const manualSpan = computed(() => tl.value?.impact.correct ?? null)
async function clearManual(mm: MeterDTO) {
  if (!canAssign.value) return
  const sp = manualSpan.value
  if (!sp || sp.locked.length) return
  if (!confirm(`把 ${rangeText(sp.from, sp.until)} 这一段的人工设定清掉?\n`
    + '清掉后下次导入按册子写这一段;楼层、方位、房号回到按位置原文解析的值,租户和归属现在的值不变。')) return
  try { await metersApi.clearManual(mm.id, props.defaultYm); afterWrite() }
  catch (e) { alert(failMsg(e)) }
}
const statusLine = computed(() => {
  const mm = m.value
  if (!mm) return ''
  if (!mm.status) return `${props.defaultYm} 不在册`
  return `${STATUS_LABEL[mm.status]} · ${rangeText(mm.statusFrom ?? EARLIEST, mm.statusUntil)}`
})
// 删除表:先查它被什么挡着(读数 / 公摊池 / 催缴单),在确认框里说清、只挂草稿单时给勾选连单一起删(MeterDeleteDialog)
const delOpen = ref(false)
watch([editProfile, () => m.value?.id], () => { delOpen.value = false })
function delMeter() {
  if (!editProfile.value) return
  delOpen.value = true
}
// 删在抽屉里调、删完在这里收尾:确认框删到一半被强制关掉(编辑态转假、换表、KeepAlive 停用)时已卸载,
// 它的 emit 会被 Vue 丢掉;抽屉不卸载,列表照样刷新
function delRun(drop: boolean) {
  const id = m.value!.id
  return metersApi.remove(id, drop).then(() => {
    delOpen.value = false
    emit('reload')
    if (m.value?.id === id) emit('close')   // 途中换了表:别把正在看的那块关掉
  })
}

// ── 【历史读数】装载(换表即重拉;竞态守卫=闭包表 id 对当前 meter) ──
const history = ref<MeterReadingDTO[] | null>(null)
const historyErr = ref('')
// ⚠换表重置的 watch 在 editId/adding 声明之后注册(见下)——原先放这里 immediate 触发时
// cancelForm 引用尚在 TDZ 的 editId,setup 期 ReferenceError(2026-08-04 控制台实测)

const drawerRows = computed(() =>
  (history.value ?? []).slice().sort((a, b) => a.ym.localeCompare(b.ym)))

// 尖峰平谷走 title 提示(抽屉列宽预算内直排放不下 8 段)
function touTitle(r: MeterReadingDTO, side: 'prev' | 'curr'): string | undefined {
  if (m.value?.kind !== 'elec') return undefined
  const v = side === 'prev'
    ? [r.prevSharp, r.prevPeak, r.prevFlat, r.prevValley]
    : [r.currSharp, r.currPeak, r.currFlat, r.currValley]
  if (v.every(x => x == null)) return undefined
  const lab = ['尖', '峰', '平', '谷']
  return v.map((x, i) => `${lab[i]} ${x ?? '—'}`).join(' / ')
}

// 行式增删改(补历史月)
const editId = ref<number | null>(null)
const adding = ref(false)
const touOpen = ref(false)
const form = ref({
  ym: '', prevTotal: '', currTotal: '', note: '',
  prevSharp: '', prevPeak: '', prevFlat: '', prevValley: '',
  currSharp: '', currPeak: '', currFlat: '', currValley: '',
})
function startAdd() {
  editId.value = null; adding.value = true; touOpen.value = false
  form.value = {
    ym: props.defaultYm, prevTotal: '', currTotal: '', note: '',
    prevSharp: '', prevPeak: '', prevFlat: '', prevValley: '',
    currSharp: '', currPeak: '', currFlat: '', currValley: '',
  }
}
function startEdit(r: MeterReadingDTO) {
  adding.value = false; editId.value = r.id
  form.value = {
    ym: r.ym, prevTotal: fs(r.prevTotal), currTotal: fs(r.currTotal), note: r.note ?? '',
    prevSharp: fs(r.prevSharp), prevPeak: fs(r.prevPeak), prevFlat: fs(r.prevFlat), prevValley: fs(r.prevValley),
    currSharp: fs(r.currSharp), currPeak: fs(r.currPeak), currFlat: fs(r.currFlat), currValley: fs(r.currValley),
  }
  touOpen.value = m.value?.kind === 'elec'
    && [r.prevSharp, r.prevPeak, r.prevFlat, r.prevValley, r.currSharp, r.currPeak, r.currFlat, r.currValley].some(x => x != null)
}
function cancelForm() { editId.value = null; adding.value = false; touOpen.value = false }
watch(() => props.editMode, v => { if (!v) cancelForm() })
// P1-5:原先这里无 catch —— 一次失败 history 就永远停在 null,「加载中…」不散、
// 「新增读数」(:disabled="!history")永久禁用,只能关抽屉重开碰运气。改为记失败态 + 重试。
async function loadHistory() {
  history.value = null
  historyErr.value = ''
  const mm = m.value
  if (!mm) return
  try {
    const data = await metersApi.meterReadings(mm.id)
    if (m.value?.id === mm.id) history.value = data       // 竞态守卫=闭包表 id 对当前 meter
  } catch (e) {
    if (m.value?.id === mm.id) historyErr.value = (e as { message?: string })?.message ?? '历史读数加载失败，请重试'
  }
}
watch(() => m.value?.id, () => {
  cancelForm()
  tab.value = 'profile'
  loadHistory()
}, { immediate: true })

// 用量预览:(本月−上月)×倍率快照(编辑=原快照;新增=当前表倍率,保存时后端快照)
const previewUsage = computed(() => {
  const p = numOrNull(form.value.prevTotal), c = numOrNull(form.value.currTotal)
  if (p == null || c == null) return '—'
  const f = editId.value != null
    ? (history.value?.find(r => r.id === editId.value)?.factorSnap ?? 1)
    : (m.value?.factor ?? 1)
  return fq((c - p) * f)
})

async function reloadAfterWrite(mm: MeterDTO) {
  const data = await metersApi.meterReadings(mm.id)
  if (m.value?.id === mm.id) history.value = data
  emit('reload')
}
async function saveForm() {
  if (!editReading.value) return
  const mm = m.value
  if (!mm) return
  if (!/^\d{4}-\d{2}$/.test(form.value.ym)) { alert('请选择月份'); return }
  const req = {
    meterId: mm.id, ym: form.value.ym,
    prevTotal: numOrNull(form.value.prevTotal), currTotal: numOrNull(form.value.currTotal),
    prevSharp: numOrNull(form.value.prevSharp), prevPeak: numOrNull(form.value.prevPeak),
    prevFlat: numOrNull(form.value.prevFlat), prevValley: numOrNull(form.value.prevValley),
    currSharp: numOrNull(form.value.currSharp), currPeak: numOrNull(form.value.currPeak),
    currFlat: numOrNull(form.value.currFlat), currValley: numOrNull(form.value.currValley),
    note: form.value.note.trim() || null,
  }
  const hasCurr = [req.currTotal, req.currSharp, req.currPeak, req.currFlat, req.currValley].some(x => x != null)
  // 新录一条有本月止的读数,后端可能让这块表从这个月起在册(SPEC §3.4)—— 要先问,得先有在册分段。
  // 分段没加载出来(失败 / 还在路上)就先拉一次;还是没有就不存,不然确认框被悄悄跳过
  if (editId.value == null && hasCurr && (!tl.value || tlErr.value)) {
    await loadTimeline()
    if (m.value?.id !== mm.id) return          // 拉的途中换了表
    if (!tl.value || tlErr.value) {
      alert(`这块表的在册状态没加载出来${tlErr.value ? `(${tlErr.value})` : ''},判断不了这条读数会不会让它从 ${req.ym} 起在册。请稍后重试。`)
      return
    }
  }
  const st = tl.value?.status
  const heals = editId.value == null && hasCurr && !!st && (!st.length || req.ym < st[0].fromYm)
  if (heals && !confirm(`这块表将从 ${req.ym} 起在册。确认保存这条读数?`)) return
  try {
    // 新录快照当时表倍率;编辑改量不改快照(后端语义,同 PV 口径)
    if (editId.value != null) await metersApi.updateReading(editId.value, req)
    else await metersApi.createReading(req)
    cancelForm()
    if (heals) loadTimeline()
    await reloadAfterWrite(mm)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')   // 同表同月 409 中文文案直达
  }
}
async function delReading(r: MeterReadingDTO) {
  if (!editReading.value) return
  const mm = m.value
  if (!mm) return
  if (!confirm(`确认删除 ${r.ym} 的读数?`)) return
  try { await metersApi.deleteReading(r.id); await reloadAfterWrite(mm) }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }
}

// ── 【合同绑定】(§4:分桶原因/候选选绑/一键确认/解绑/待核挂租户) ──
const bind = computed(() => props.row?.bind ?? null)
const qb = computed(() => (bind.value ? bindQueueBucket(bind.value) : null))
const uniqDateMissing = computed(() =>
  qb.value === 'date_missing' && (bind.value?.candidates?.length ?? 0) === 1
    ? bind.value!.candidates![0] : null)
// 人工绑定钉在某一段上:同改归属,站在 V 选「从 V 起」或「更正 V 所在那一段」
function askBind(contractId: number | null, no: string | null) {
  const mm = m.value
  if (!mm || !canAssign.value) return
  request({
    title: '改合同绑定', lines: [`合同:${bind.value?.contractNo ?? '未绑定'} → ${no ?? '解绑,回自动归属'}`],
    siblings: false, migrate: false, tenantTo: null,
    run: c => (canAssign.value ? metersApi.bind(mm.id, contractId, props.defaultYm, c.mode) : Promise.resolve()),
  })
}
// 钉的合同不是这一段租户的(换户后没重钉)那一种也由 bindReason 说,抄表屏悬停同一句
const reasonText = computed(() => (bind.value && qb.value ? bindReason(qb.value, bind.value) : ''))
</script>

<template>
  <FPDrawer
    :open="!!row"
    :title="m?.name ?? ''"
    :subtitle="drawerSub"
    icon="gauge"
    :width="780"
    :fixedHeight="true"
    @close="emit('close')"
  >
    <template #badge>
      <Segmented :options="TABS" :model-value="tab" size="sm" @update:model-value="tab = $event" />
    </template>

    <!-- ── 表档案 ── -->
    <div v-if="tab === 'profile' && m" :key="formKey" class="md-grid">
      <div v-if="editProfile && tlErr" class="md-fld span2 md-tlfail">
        <span>{{ tlErr }} 归属和位置暂时只能看。</span>
        <Button variant="outline" size="sm" @click="loadTimeline">重试</Button>
      </div>
      <div class="md-fld ro"><label>类别 / 分区</label><span>{{ METER_KIND_LABEL[m.kind] }} · {{ zoneLabel(m.zone) }}</span></div>
      <div class="md-fld ro"><label>读数条数</label><span class="mono">{{ history?.length ?? m.readingCount }}</span></div>

      <div class="md-fld">
        <label>标识名(内部键)</label>
        <input v-if="editProfile" class="mt-edit l md-in mono" type="text" :value="m.name"
               title="同分区同类唯一(kind,zone,name);与已有表重名保存会被后端拒绝并回滚"
               @change="commitAsset(m, 'name', ($event.target as HTMLInputElement).value)" />
        <span v-else class="mono">{{ m.name }}</span>
      </div>
      <div class="md-fld">
        <label>表编码</label>
        <input v-if="editProfile" class="mt-edit l md-in mono" type="text" :value="m.code ?? ''"
               title="导入的首选身份键:补上它可解掉「同位置多块表歧义」的导入报错。留空=清除"
               @change="commitAsset(m, 'code', ($event.target as HTMLInputElement).value)" />
        <span v-else class="mono">{{ m.code ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>区域(楼栋/车间)</label>
        <input v-if="canAssign" class="mt-edit l md-in" type="text" list="md-area-list" :value="m.area ?? ''"
               title="抄表屏区块带头,同时进导入位置索引;可从库内既有区域中选,也可直接输入。留空=清除"
               @change="editAssign(m, 'area', ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.area ?? '—' }}</span>
        <datalist v-if="canAssign" id="md-area-list"><option v-for="a in areaOpts" :key="a" :value="a" /></datalist>
      </div>
      <div class="md-fld">
        <label :title="locPinned(m, 'floorLabel') ? LOC_MANUAL_TITLE : undefined">
          楼层{{ locPinned(m, 'floorLabel') ? ' · 人工设定(导入不覆盖)' : '' }}
        </label>
        <Select v-if="canAssign" size="sm" :model-value="m.floorLabel ?? ''"
                :style="{ width: '100%' }"
                title="稳定位置主数据,决定抄表屏排序与公摊按层分份;留空=跨层或不适用"
                :options="[{ value: '', label: '—(跨层/不适用)' }, ...floorOpts.map(f => ({ value: f, label: f }))]"
                @update:model-value="editAssign(m, 'floorLabel', $event)" />
        <span v-else :class="{ dim: !m.floorLabel }">{{ m.floorLabel ?? '跨层/未录' }}</span>
      </div>
      <div class="md-fld">
        <label :title="locPinned(m, 'side') ? LOC_MANUAL_TITLE : undefined">
          方位{{ locPinned(m, 'side') ? ' · 人工设定(导入不覆盖)' : '' }}
        </label>
        <Select v-if="canAssign" size="sm" :model-value="m.side ?? ''"
                :style="{ width: '100%' }"
                title="同层东西侧分栏的依据;留空=整层不分侧"
                :options="[{ value: '', label: '—(不分侧)' }, ...sideOpts.map(s => ({ value: s, label: s }))]"
                @update:model-value="editAssign(m, 'side', $event)" />
        <span v-else :class="{ dim: !m.side }">{{ m.side ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label :title="locPinned(m, 'roomNo') ? LOC_MANUAL_TITLE : undefined">
          房号{{ locPinned(m, 'roomNo') ? ' · 人工设定(导入不覆盖)' : '' }}
        </label>
        <input v-if="canAssign" class="mt-edit l md-in" type="text" :value="m.roomNo ?? ''"
               title="单元/房号(如 101室);跨多间的表宁可留空。留空=清除"
               @change="editAssign(m, 'roomNo', ($event.target as HTMLInputElement).value)" />
        <span v-else :class="{ dim: !m.roomNo }">{{ m.roomNo ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>位置原文(导入匹配键)</label>
        <input v-if="canAssign" class="mt-edit l md-in" type="text" :value="m.spot ?? ''"
               :title="SPOT_TITLE"
               @change="editAssign(m, 'spot', ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.spot ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>企业名称原文{{ m.tenantManual ? ' · 人工设定' : '' }}</label>
        <input v-if="canAssign" class="mt-edit l md-in" type="text" :value="m.tenantName ?? ''"
               title="账册「企业名称」列原文;公摊/基础设施表这里存的是用途描述。留空=清除"
               @change="editAssign(m, 'tenantName', ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.tenantName ?? '—' }}<span v-if="row?.pending" class="md-warn">待核</span></span>
      </div>

      <div class="md-fld">
        <label>楼栋{{ m.ownerManual ? ' · 人工设定' : '' }}</label>
        <Select v-if="canAssign" size="sm" :model-value="m.buildingId != null ? String(m.buildingId) : ''"
                :style="{ width: '100%' }"
                :options="[{ value: '', label: '—(未关联)' }, ...buildings.map(bd => ({ value: String(bd.id), label: `${bd.phaseName} · ${bd.name}` }))]"
                @update:model-value="editBuilding(m, $event)" />
        <span v-else>{{ m.buildingId != null ? buildingById.get(m.buildingId)?.name ?? '—' : '—' }}</span>
      </div>
      <div class="md-fld pick">
        <label>租户(选定即归属「租户」){{ m.tenantManual ? ' · 人工设定' : '' }}</label>
        <FPTenantPicker
          v-if="canAssign"
          :tenants="tenantOpts" :model-value="m.tenantId"
          :placeholder="m.tenantName ?? '选择租户'"
          @update:model-value="editTenant(m, $event)"
        />
        <span v-else>{{ row?.tenantLabel ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>归属{{ m.ownerManual ? ' · 人工设定' : '' }}</label>
        <Select v-if="canAssign" size="sm" :model-value="m.ownership"
                :style="{ width: '100%' }"
                :options="OWN_OPTS"
                @update:model-value="editOwnership(m, $event)" />
        <span v-else class="mt-own" :class="'own-' + m.ownership">{{ ownershipLabel(m.ownership, m.kind) }}</span>
      </div>
      <div class="md-fld">
        <label>表名称</label>
        <input v-if="canAssign" class="mt-edit l md-in" type="text" :value="m.subName ?? ''"
               title="表名称(如 电表①),回车/失焦保存;留空=清除"
               @change="editAssign(m, 'subName', ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.subName ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>倍率</label>
        <input v-if="editProfile" class="mt-edit md-in" type="number" min="0" step="0.01" :value="m.factor"
               :title="FACTOR_TITLE"
               @change="commitFactor(m, ($event.target as HTMLInputElement).value)" />
        <span v-else class="mono">{{ m.factor }}</span>
      </div>
      <!-- 表类型=电表概念(单相/三相/需量…),水表不适用不显示(2026-08-04 报障) -->
      <div v-if="m.kind === 'elec'" class="md-fld">
        <label>表类型</label>
        <Select v-if="editProfile" size="sm" :model-value="m.deviceType ?? ''"
                :style="{ width: '100%' }"
                :options="[{ value: '', label: '未录' }, ...Object.entries(DEVICE_TYPE_LABEL).map(([k, lab]) => ({ value: k, label: lab as string }))]"
                @update:model-value="commitDeviceType(m, $event)" />
        <span v-else :class="{ dim: !m.deviceType }">{{ m.deviceType ? DEVICE_TYPE_LABEL[m.deviceType] : '未录' }}</span>
      </div>
      <!-- 在册状态按月分段(停用/已拆/在用):这里只说查看月所在那一段,加一行 / 改月 / 撤回在「档案变更」 -->
      <div class="md-fld span2">
        <label>在册状态</label>
        <span :class="{ dim: !m.status }">{{ statusLine }}</span>
        <button v-if="editProfile" type="button" class="md-link" @click="tab = 'timeline'">加一行或改月份</button>
      </div>
      <div v-if="manualOn.length" class="md-fld span2">
        <label>人工设定</label>
        <span>{{ manualOn.join('、') }} · 这一段导入时不按册子覆盖</span>
        <template v-if="canAssign">
          <Button variant="outline" size="sm" :disabled="!manualSpan || manualSpan.locked.length > 0" @click="clearManual(m)">
            改回按册子
          </Button>
          <span v-if="manualSpan?.locked.length" class="md-lk">这几个月不能改:{{ lockedText(manualSpan.locked) }}</span>
        </template>
      </div>
      <!-- §G5 存疑标:只在有标时出现;shadow 表不进分表Σ,给一个显式的人工解除入口 -->
      <div v-if="m.suspect" class="md-fld span2">
        <label>档案状态</label>
        <span class="md-susp" :class="m.suspect" :title="SUSPECT_TITLE[m.suspect ?? '']">{{ SUSPECT_LABEL[m.suspect ?? ''] }}</span>
        <Button v-if="editProfile" variant="outline" size="sm" @click="clearSuspect(m)">
          认领为独立表(解除存疑)
        </Button>
        <span v-else class="md-dim susp-hint">进入编辑模式后可解除。</span>
      </div>
    </div>

    <!-- ── 历史读数(原 ReadingDrawer 内容) ── -->
    <template v-else-if="tab === 'history'">
      <!-- 失败态:给出原因与重试入口(此时 history 恒 null,「新增读数」照旧禁用 —— 不知道有哪些月就录会撞 409) -->
      <div v-if="historyErr" class="md-empty fail">
        <div>{{ historyErr }}</div>
        <Button variant="outline" size="sm" @click="loadHistory">重试</Button>
      </div>
      <div v-else-if="!history" class="md-empty">加载中…</div>
      <div v-else-if="drawerRows.length === 0 && !adding" class="md-empty">
        该表暂无读数{{ editReading ? ',点下方「新增读数」补录历史月,或在表格里直接录当月。' : ',进入编辑模式后可补录。' }}
      </div>
      <div v-else class="md-hwrap">
        <table class="md-htable">
          <!-- 列宽预算(抽屉内容宽~692):月份128(原生月选 2024年08月+图标要够)+上月104+本月104+用量96+状态84=516,备注弹性 -->
          <colgroup>
            <col style="width:128px" />
            <col style="width:104px" />
            <col style="width:104px" />
            <col style="width:96px" />
            <col style="width:84px" />
            <col /><!-- 备注:唯一弹性列(截断走 title) -->
            <col v-if="editReading" style="width:70px" />
          </colgroup>
          <thead>
            <tr>
              <th class="l">月份</th>
              <th>上月行至</th>
              <th>本月行至</th>
              <th>用量</th>
              <th class="l">状态</th>
              <th class="l">备注</th>
              <th v-if="editReading"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in drawerRows" :key="r.id">
              <template v-if="editId === r.id">
                <tr class="editing">
                  <td class="l"><DatePicker v-model="form.ym" mode="month" variant="cell" aria-label="月份" /></td>
                  <td><input v-model="form.prevTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                  <td><input v-model="form.currTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                  <td class="ro" :title="`按原倍率快照 ${r.factorSnap} 计`">{{ previewUsage }}</td>
                  <td class="l">
                    <button v-if="m?.kind === 'elec'" class="md-toulink" :class="{ on: touOpen }" @click="touOpen = !touOpen">尖峰平谷</button>
                    <span v-else class="md-dim">—</span>
                  </td>
                  <td class="l"><input v-model="form.note" class="md-din" type="text" placeholder="备注" /></td>
                  <td class="ops">
                    <button class="mt-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                    <button class="mt-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                  </td>
                </tr>
                <tr v-if="touOpen && m?.kind === 'elec'" class="tourow">
                  <td colspan="7" class="l">
                    <div class="md-tougrid">
                      <span class="lab">上月</span>
                      <label>尖<input v-model="form.prevSharp" class="md-din num" type="number" step="0.01" /></label>
                      <label>峰<input v-model="form.prevPeak" class="md-din num" type="number" step="0.01" /></label>
                      <label>平<input v-model="form.prevFlat" class="md-din num" type="number" step="0.01" /></label>
                      <label>谷<input v-model="form.prevValley" class="md-din num" type="number" step="0.01" /></label>
                      <span class="lab">本月</span>
                      <label>尖<input v-model="form.currSharp" class="md-din num" type="number" step="0.01" /></label>
                      <label>峰<input v-model="form.currPeak" class="md-din num" type="number" step="0.01" /></label>
                      <label>平<input v-model="form.currFlat" class="md-din num" type="number" step="0.01" /></label>
                      <label>谷<input v-model="form.currValley" class="md-din num" type="number" step="0.01" /></label>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-else>
                <td class="l mono">{{ r.ym }}</td>
                <td :title="touTitle(r, 'prev')">{{ fq(r.prevTotal) }}</td>
                <td :title="touTitle(r, 'curr')">{{ fq(r.currTotal) }}</td>
                <td :class="{ neg: (r.usageTotal ?? 0) < 0 }" :title="`× 倍率快照 ${r.factorSnap}`">{{ fq(r.usageTotal) }}</td>
                <td class="l flags">
                  <span v-if="readingFlags(r).missing" class="mt-flag warn">漏抄</span>
                  <span v-if="readingFlags(r).negative" class="mt-flag bad">倒走</span>
                  <span v-if="readingFlags(r).touMismatch" class="mt-flag bad" title="尖峰平谷用量之和与总用量不符">时段不符</span>
                </td>
                <td class="l note" :title="r.note ?? undefined">{{ r.note || '—' }}</td>
                <td v-if="editReading" class="ops">
                  <button class="mt-iop" title="编辑" @click="startEdit(r)"><component :is="iconFor('pencil')" :size="14" /></button>
                  <button class="mt-iop danger" title="删除" @click="delReading(r)"><component :is="iconFor('trash-2')" :size="14" /></button>
                </td>
              </tr>
            </template>
            <template v-if="adding">
              <tr class="editing">
                <td class="l"><DatePicker v-model="form.ym" mode="month" variant="cell" aria-label="月份" /></td>
                <td><input v-model="form.prevTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                <td><input v-model="form.currTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                <td class="ro" :title="`按当前表倍率 ${m?.factor ?? 1} 预览,保存时快照`">{{ previewUsage }}</td>
                <td class="l">
                  <button v-if="m?.kind === 'elec'" class="md-toulink" :class="{ on: touOpen }" @click="touOpen = !touOpen">尖峰平谷</button>
                  <span v-else class="md-dim">—</span>
                </td>
                <td class="l"><input v-model="form.note" class="md-din" type="text" placeholder="备注" /></td>
                <td class="ops">
                  <button class="mt-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                  <button class="mt-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                </td>
              </tr>
              <tr v-if="touOpen && m?.kind === 'elec'" class="tourow">
                <td colspan="7" class="l">
                  <div class="md-tougrid">
                    <span class="lab">上月</span>
                    <label>尖<input v-model="form.prevSharp" class="md-din num" type="number" step="0.01" /></label>
                    <label>峰<input v-model="form.prevPeak" class="md-din num" type="number" step="0.01" /></label>
                    <label>平<input v-model="form.prevFlat" class="md-din num" type="number" step="0.01" /></label>
                    <label>谷<input v-model="form.prevValley" class="md-din num" type="number" step="0.01" /></label>
                    <span class="lab">本月</span>
                    <label>尖<input v-model="form.currSharp" class="md-din num" type="number" step="0.01" /></label>
                    <label>峰<input v-model="form.currPeak" class="md-din num" type="number" step="0.01" /></label>
                    <label>平<input v-model="form.currFlat" class="md-din num" type="number" step="0.01" /></label>
                    <label>谷<input v-model="form.currValley" class="md-din num" type="number" step="0.01" /></label>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ── 合同绑定 ── -->
    <template v-else-if="tab === 'bind' && m">
      <div v-if="m.ownership !== 'tenant'" class="md-empty">
        非租户表({{ ownershipLabel(m.ownership, m.kind) }})无合同绑定。
      </div>
      <div v-else-if="!bindAvailable" class="md-empty">
        绑定数据不可用 —— 需要后端 GET /api/meters/binding 端点(S2-BIND-SPEC §3)。
      </div>
      <div v-else-if="!bind" class="md-empty">该表不在本月绑定报表中。</div>
      <template v-else>
        <!-- 编辑态但档案分段没加载出来:改绑定 / 挂租户都按月写,点不了要说清为什么,并给重试 -->
        <div v-if="editProfile && tlErr" class="md-tlfail">
          <span>{{ tlErr }} 暂时不能改绑定、挂租户。</span>
          <Button variant="outline" size="sm" @click="loadTimeline">重试</Button>
        </div>
        <div class="md-bstat">
          <span class="lab">当前状态</span>
          <span class="val" :class="{ stale: bind.status === 'override_stale' }">
            {{ bind.contractNo ?? '未绑定' }}
          </span>
          <span class="tag" :class="{ bad: bind.status === 'override_stale' }">{{ BIND_STATUS_NOTE[bind.status] }}</span>
          <span v-if="qb" class="reason">{{ BIND_BUCKET_LABEL[qb] }} · {{ reasonText }}</span>
          <!-- 钉的那份没被直接用上:说清钉的是哪份、本月落在哪份。不静默替换(S2-BIND-SPEC §2)。
               人工 = 落到同一份合同的本月这一期;自动 = 没用它(不在租期 / 不是这一段租户的合同),按自动规则定的 -->
          <span v-else-if="bind.pinnedContractNo" class="reason ok">
            {{ bind.status === 'override'
              ? `人工绑定的是 ${bind.pinnedContractNo},本月不在它的租期内,已落到本月这一期 ✓`
              : `人工绑定的是 ${bind.pinnedContractNo},本月没有用它,按自动规则落到 ${bind.contractNo ?? '—'} ✓` }}
          </span>
          <span v-else class="reason ok">合同归属就绪,可参与派生 ✓</span>
          <span v-if="bind.locations?.length" class="locs">{{ bind.locations.join('；') }}</span>
        </div>

        <!-- 本月在租、合同场地房号对得上这块表的另一户(唯一才有):从本月起改归它 -->
        <div v-if="bind.suggestion" class="md-bsug">
          <span class="lab">
            本月在租、合同场地的房号对得上这块表的:{{ bind.suggestion.tenantName ?? `#${bind.suggestion.tenantId}` }} · {{ bind.suggestion.contractNo }}
          </span>
          <Button v-if="canAssign" variant="outline" size="sm"
                  @click="editTenant(m, bind.suggestion.tenantId, bind.suggestion.tenantName)">
            从本月起改归 {{ bind.suggestion.tenantName ?? '这一户' }}
          </Button>
        </div>

        <!-- 待核:先挂租户(编辑态) -->
        <div v-if="qb === 'pending'" class="md-bpend">
          <template v-if="canAssign">
            <span class="lab">挂租户后自动进入合同归属:</span>
            <div class="pick">
              <FPTenantPicker
                :tenants="tenantOpts" :model-value="null"
                :placeholder="m.tenantName ?? '选择租户'"
                @update:model-value="editTenant(m, $event)"
              />
            </div>
          </template>
          <span v-else-if="!editProfile" class="md-dim">进入编辑模式后可挂租户。</span>
          <span v-else-if="!tlErr" class="md-dim">正在加载档案分段…</span>
        </div>

        <!-- 候选合同(选定绑定=写 override) -->
        <div v-if="(bind.candidates?.length ?? 0) > 0" class="md-bcands">
          <span class="lab">候选合同({{ bind.candidates!.length }})</span>
          <Button
            v-if="canAssign && uniqDateMissing" variant="filled" size="sm"
            @click="askBind(uniqDateMissing.contractId, uniqDateMissing.contractNo)"
          >一键确认绑定 {{ uniqDateMissing.contractNo }}</Button>
          <button
            v-for="c in bind.candidates" :key="c.contractId"
            class="bc-item" :class="{ on: c.contractId === bind.contractId }"
            :disabled="!canAssign"
            @click="canAssign && askBind(c.contractId, c.contractNo)"
          >
            <span class="no">{{ c.contractNo }}</span>
            <span class="sub">{{ c.buildingName ?? '—' }} · {{ c.startDate ?? '?' }} ~ {{ c.endDate ?? '?' }}</span>
            <span v-if="c.locations?.length" class="sub locs">{{ c.locations.join('；') }}</span>
          </button>
        </div>
        <div v-else-if="qb && qb !== 'pending'" class="md-dim" style="font-size:var(--fs-label)">该户无候选合同。</div>

        <!-- 解绑(人工绑定/过期时) -->
        <div v-if="canAssign && (bind.status === 'override' || bind.status === 'override_stale')">
          <Button variant="outline" size="sm" @click="askBind(null, null)">解绑(回自动归属)</Button>
        </div>
        <div v-if="!editProfile && qb && qb !== 'pending'" class="md-dim" style="font-size:var(--fs-label)">进入编辑模式后可选定/解绑。</div>
      </template>
    </template>

    <!-- ── 档案变更 ── -->
    <template v-else-if="tab === 'timeline' && m">
      <!-- 本月册子(SPEC §10.4):这块表在查看月导入的册子里出现过没有、出自哪个文件 -->
      <p class="md-book">{{ bookLine(row!) }}</p>
      <div v-if="tlErr && !tl" class="md-empty fail">
        <div>{{ tlErr }}</div>
        <Button variant="outline" size="sm" @click="loadTimeline">重试</Button>
      </div>
      <div v-else-if="!tl" class="md-empty">加载中…</div>
      <template v-else>
        <div v-if="tlErr" class="md-tlfail">
          <span>{{ tlErr }} 下面是上次加载的样子,暂时不能改。</span>
          <Button variant="outline" size="sm" @click="loadTimeline">重试</Button>
        </div>
        <MeterTimelinePane
          :meter="m" :ym="defaultYm" :tl="tl" :edit="canAssign" :tenants="tenants" :buildings="buildings"
          @changed="afterWrite"
        />
      </template>
    </template>

    <MeterAssignDialog
      v-if="ask && tl && m && canAssign"
      :title="ask.title" :meter-name="m.name" :ym="defaultYm" :lines="ask.lines" :impact="tl.impact"
      :siblings="ask.siblings ? tl.siblings : []" :with-migrate="ask.migrate" :tenant-to="ask.tenantTo" :run="ask.run"
      @close="onAskClose" @done="afterWrite"
    />
    <MeterDeleteDialog
      v-if="delOpen && editProfile && m"
      :edit="editProfile" :meter-id="m.id" :meter-name="m.name" :run="delRun"
      @close="delOpen = false"
    />

    <template v-if="(tab === 'history' && editReading) || (tab === 'profile' && editProfile)" #footer>
      <Button v-if="tab === 'history'" variant="filled" size="sm" :disabled="adding || !history" @click="startAdd">
        <template #leading><component :is="iconFor('plus')" :size="14" /></template>
        新增读数
      </Button>
      <Button v-if="tab === 'profile' && m" variant="outline" size="sm" class="md-del" @click="delMeter">
        <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
        删除表
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
/* ── 表档案:两列字段网格 ── */
.md-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.md-fld { min-width: 0; }
.md-fld label { display: block; margin-bottom: 5px; font-size: var(--fs-label); color: var(--text-muted); }
.md-fld span { font-size: var(--fs-body); color: var(--text-primary); }
.md-fld .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.md-fld .dim { color: var(--text-disabled); }
.md-fld.ro span { color: var(--text-secondary); }
.md-warn { margin-left: 8px; font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 1px 7px; color: var(--coral-text); background: rgb(255, 235, 228); }
.md-in { height: 32px; border-color: var(--border-control); background: var(--surface-white); }
/* §G5 存疑标一行(整宽):徽标 + 解除按钮 */
.md-fld.span2 { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.md-fld.span2 label { margin-bottom: 0; }
.md-susp { font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 2px 9px; }
.md-susp.shadow { color: var(--coral-text); background: rgb(255, 235, 228); }
.md-susp.incomplete { color: rgb(146, 100, 0); background: rgb(255, 246, 219); }
:root[data-theme="dark"] .md-warn, :root[data-theme="dark"] .md-susp.shadow { background: var(--danger-bg); }
:root[data-theme="dark"] .md-susp.incomplete { color: var(--caution-text); background: var(--caution-soft); }
.md-fld.span2 .susp-hint { font-size: var(--fs-label); }
.md-fld.pick :deep(.fp-tp-trigger) { height: 32px; font-size: 12.5px; }
.md-del { color: var(--hue-red); }
.md-link { border: none; background: none; padding: 0; font: inherit; font-size: var(--fs-label); color: var(--hue-blue); cursor: pointer; }
.md-link:hover { text-decoration: underline; }
.md-lk { font-size: var(--fs-label) !important; color: var(--caution-text) !important; }
.md-tlfail { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--fs-label); color: var(--hue-red); }
.md-tlfail span { font-size: var(--fs-label); color: var(--hue-red); }
.md-book { margin: 0; font-size: var(--fs-label); color: var(--text-secondary); overflow-wrap: anywhere; }

/* ── 历史读数(mt-d* 家族迁自 v4 ReadingDrawer) ── */
.md-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
/* 加载失败:与「加载中…」同位,红字 + 重试按钮竖排 */
.md-empty.fail { display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--hue-red); }
.md-hwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.md-htable { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; white-space: nowrap; }
.md-htable th { padding: 8px 10px; text-align: right; font-family: var(--font-sans); font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); border-bottom: 1px solid var(--divider); }
.md-htable td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; }
.md-htable tbody tr:last-child td { border-bottom: none; }
.md-htable .l { text-align: left; }
.md-htable td.note, .md-htable td.flags { font-family: var(--font-sans); color: var(--text-muted); }
.md-htable td.neg { color: var(--hue-red); }
.md-htable td.ro { color: var(--text-secondary); }
.md-htable tr.editing td { background: var(--surface-card); }
.md-htable tr.tourow td { background: var(--surface-card); padding-top: 0; }
.md-htable td.ops { white-space: nowrap; padding-left: 6px; padding-right: 6px; }   /* 70px 列装下两个 26px 按钮,原 10px 边距会把取消钮裁成省略号 */
.md-dim { color: var(--text-disabled); }
.md-din { width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); }
.md-din.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.md-din.num::-webkit-outer-spin-button, .md-din.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.md-din:focus { outline: none; border-color: var(--hue-blue); }
.md-toulink { border: 1px solid var(--border-control); background: var(--surface-white); border-radius: var(--radius-full); padding: 2px 10px; font-family: var(--font-sans); font-size: 11px; color: var(--text-secondary); cursor: pointer; transition: border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.md-toulink:hover { border-color: var(--border-control-strong); color: var(--text-primary); }
.md-toulink.on { border-color: var(--hue-blue); color: var(--hue-blue); }
.md-tougrid { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0 6px; }
.md-tougrid .lab { font-family: var(--font-sans); font-size: 11px; color: var(--text-muted); flex: 0 0 auto; }
.md-tougrid label { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-sans); font-size: 11px; color: var(--text-secondary); }
.md-tougrid label .md-din { width: 78px; height: 26px; font-size: 12px; }

/* ── 合同绑定 ── */
.md-bstat { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); }
.md-bstat .lab { font-size: var(--fs-label); color: var(--text-muted); }
.md-bstat .val { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 13px; color: var(--text-primary); }
.md-bstat .val.stale { color: var(--hue-red); }
.md-bstat .tag { font-size: var(--fs-micro); color: var(--text-muted); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 8px; }
.md-bstat .tag.bad { color: var(--hue-red); background: var(--danger-soft); }
.md-bstat .reason { flex-basis: 100%; font-size: var(--fs-label); color: var(--text-secondary); }
.md-bstat .reason.ok { color: var(--ok-text); }
.md-bstat .locs { flex-basis: 100%; font-size: var(--fs-label); color: var(--text-secondary); }
.md-bsug { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px 14px; border-radius: var(--radius-md); background: var(--info-soft); }
.md-bsug .lab { font-size: var(--fs-label); color: var(--text-primary); overflow-wrap: anywhere; }
.md-bpend { display: flex; flex-direction: column; gap: 8px; }
.md-bpend .lab { font-size: var(--fs-label); color: var(--text-secondary); }
.md-bpend .pick { max-width: 360px; }
.md-bpend .pick :deep(.fp-tp-trigger) { height: 32px; font-size: 12.5px; }
.md-bcands { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.md-bcands .lab { font-size: var(--fs-label); color: var(--text-muted); }
.bc-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; border: 1px solid var(--border-subtle); background: var(--surface-white); border-radius: var(--radius-md); padding: 8px 12px; cursor: pointer; text-align: left; transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.bc-item:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-hover); }
.bc-item:disabled { cursor: default; }
.bc-item.on { border-color: var(--hue-blue); background: rgb(240, 246, 255); }
:root[data-theme="dark"] .bc-item.on { background: var(--row-selected); }
.bc-item .no { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-primary); }
.bc-item .sub { font-size: var(--fs-micro); color: var(--text-muted); }
.bc-item .sub.locs { color: var(--text-secondary); }
</style>
