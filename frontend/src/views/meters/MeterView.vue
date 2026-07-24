<script setup lang="ts">
// 园区抄表(METER-SPEC §3 + §6 v2 + §7 v3 分组版式)— 全园区租户/公共水电表花名册 + 月度读数。
// 顶部 Segmented 两段:月度抄表(默认)/表档案;两段共用 kind Segmented(电/水)+分区 tabs(全部/一期/二期/宿舍)。
// 两段均 Excel 式分组区块(groupMeterBlocks 纯函数,spec 锁定):期区→区块(area);
//   区块头=infra 总表行,随后 share/ops 公共表、tenant 户内表(方位楼层房号自然序);
//   月度段区块尾=「X总用电量」汇总行(tenant+share 用量合计,总/尖/峰/平/谷各列都汇),
//   期区首行=汇总条(Σ区块);区块可折叠(折叠保留 infra 头行+汇总行)。分页弃用,卡片内滚动。
// 表名称列显 subName(电表①);标识名(name)是内部键不再示人,搜索仍可搜。
// 月度段电表直排 上月/本月 总尖峰平谷(sticky 租户列+横向滚动,仅 1 根 sticky 列 left:0,
//   不涉列宽累加 offset 陷阱),水表仅 总 两列;点行开抽屉=该表逐月历史行式增删改;
//   状态徽标由 meterLogic.readingFlags 派生(漏抄黄/倒走红/时段不符红)。
// 表档案段:期数|楼栋|方位|租户(FPTenantPicker 行内改;「待核」仅 ownership=tenant 显)|归属徽标+筛选 chips|
//   表名称(subName)|编码|倍率|读数条数;搜索匹配 租户名(含库内全名)+企业名称原文+方位+标识名。
// 编辑模式遵 EDIT-MODE-SPEC v2:浏览态完全只读;viewer 永远浏览态。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { metersApi, type MeterDTO, type MeterKind, type MeterZone, type MeterReq, type MeterReadingDTO } from '@/api/meters'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'
import { readingFlags } from '@/utils/meterLogic'
import { groupMeterBlocks, blockLoss } from '@/utils/meterGroup'
import { buildMeterTemplate, exportMeterMonth, METER_ZONE_LABEL, METER_KIND_LABEL } from '@/utils/meterExcel'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'

const auth = useAuthStore()

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话;KeepAlive 切页签回来也回浏览态(安全默认) ──
const editMode = ref(false)
onDeactivated(() => { editMode.value = false; meterDlg.value = false; importing.value = false })

const pad2 = (n: number) => String(n).padStart(2, '0')
const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const fq = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })

// ── 两段 Segmented(月度抄表默认;seg/kind/zone 组件 ref 即会话记忆,KeepAlive 自然保持) ──
const seg = ref('month')          // 'month' | 'roster'
const SEG_OPTS = [{ value: 'month', label: '月度抄表' }, { value: 'roster', label: '表档案' }]
const kind = ref('elec')          // MeterKind;宽松 string 避免模板 emit 断言
const KIND_OPTS = [{ value: 'elec', label: '电表' }, { value: 'water', label: '水表' }]
const ZONE_TABS = [
  { k: 'all', label: '全部' },
  { k: 'p1', label: '一期' },
  { k: 'p2', label: '二期' },
  { k: 'dorm', label: '宿舍' },
]
const zone = ref('all')

// ── 归属(§6.1/§6.4):徽标 + 档案段筛选 chips ──
const OWN_LABEL: Record<string, string> = { tenant: '租户', share: '园区公摊', ops: '园区经营', infra: '配电总表' }
const OWN_OPTS = Object.entries(OWN_LABEL).map(([value, label]) => ({ value, label }))
const own = ref('all')            // 档案段归属筛选

// ── 期间(年数据驱动,同 PvMeterView 口径:有数据年∪当前年,初始=最新有数据年) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  [...new Set([...dataYears.value, today.getFullYear()])]
    .sort((a, b) => a - b)
    .map(y => ({ value: String(y), label: `${y}年` })),
)
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)

// ── 数据 ──
const meters = ref<MeterDTO[] | null>(null)
const readings = ref<MeterReadingDTO[] | null>(null)

// 主数据(§6.2/§6.3):租户库=tenants api 全量(匹配/展示/picker 候选)、楼栋=楼栋管理 8 栋。
// 同时喂给 importCtx(数据层 ImportCtx 约定:tenantNames/buildings),解析器据此做拆分匹配与楼栋映射。
const tenants = ref<TenantDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const tenantById = computed(() => new Map(tenants.value.map(t => [t.id, t])))
const buildingById = computed(() => new Map(buildings.value.map(b => [b.id, b])))
const tenantOpts = computed(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))

async function loadMeters() { meters.value = await metersApi.list() }
// 竞态守卫同 BillsView loadRows:切期保留旧数据到新数据落位,不闪 gate
let rSeq = 0
async function loadReadings() {
  const my = ++rSeq
  const data = await metersApi.readings(ym.value)
  if (my === rSeq) readings.value = data
}
onMounted(async () => {
  loadMeters()
  // 主数据清单拉取失败不阻断:租户/楼栋列显 '—',picker 候选空
  tenantApi.list().then(v => { tenants.value = v; importCtx.tenantNames = v.map(t => t.companyName) }).catch(() => {})
  buildingApi.list().then(v => { buildings.value = v; importCtx.buildings = v }).catch(() => {})
  // 先拉数据年份定位初始年:最新有数据年;改年经 watch 触发 loadReadings,未改则本函数兜底首载
  try {
    dataYears.value = await metersApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }
  } catch { /* years 拉取失败不阻断:保持当前年,选项由 ∪ 当前年兜底 */ }
  loadReadings()
})
watch([year, month], loadReadings)

// ── 展示派生(§6.4):租户显示名(库内全名>原文)、楼栋名、期数(楼栋期>分区兜底) ──
function displayTenant(m: MeterDTO): string | null {
  if (m.tenantId != null) return tenantById.value.get(m.tenantId)?.companyName ?? m.tenantName
  return m.tenantName
}
const bName = (m: MeterDTO) => (m.buildingId != null ? buildingById.value.get(m.buildingId)?.name ?? '—' : '—')
const pName = (m: MeterDTO) =>
  (m.buildingId != null && buildingById.value.get(m.buildingId)?.phaseName) || METER_ZONE_LABEL[m.zone]

// ── 过滤链:kind → zone → (档案段)归属 chips → 搜索 ──
const kindMeters = computed(() => (meters.value ?? []).filter(m => m.kind === kind.value))
const tabCounts = computed(() => {
  const c: Record<string, number> = { all: kindMeters.value.length, p1: 0, p2: 0, dorm: 0 }
  for (const m of kindMeters.value) c[m.zone] = (c[m.zone] ?? 0) + 1
  return c
})
const zoneMeters = computed(() =>
  kindMeters.value.filter(m => zone.value === 'all' || m.zone === zone.value))

const ownCounts = computed(() => {
  const c: Record<string, number> = { all: zoneMeters.value.length, tenant: 0, share: 0, ops: 0, infra: 0 }
  for (const m of zoneMeters.value) c[m.ownership] = (c[m.ownership] ?? 0) + 1
  return c
})

const q = ref('')
// 搜索(§6.4):租户名(含库内全名)+企业名称原文+方位;表标识保留——「力灏」「1-3楼」都能搜到 1-3楼（力灏）
const rosterRows = computed(() => {
  const kw = q.value.trim()
  const hit = (s: string | null | undefined) => !!s && s.includes(kw)
  return zoneMeters.value
    .filter(m => own.value === 'all' || m.ownership === own.value)
    .filter(m => !kw || m.name.includes(kw) || hit(m.tenantName) || hit(m.spot)
      || (m.tenantId != null && hit(tenantById.value.get(m.tenantId)?.companyName)))
})

// 月度段:一行一表;无读数的表也出现(读数列空=漏抄黄,flags 用统一空读数对象派生)
const NO_READING = { currTotal: null, usageTotal: null, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null }
const readingByMeter = computed(() => new Map((readings.value ?? []).map(r => [r.meterId, r])))
const rd = (m: MeterDTO) => readingByMeter.value.get(m.id) ?? null
const flagsOf = (m: MeterDTO) => readingFlags(rd(m) ?? NO_READING)

// ── §7 分组区块(分页弃用,区块折叠代偿,卡片内滚动;groupMeterBlocks 纯函数 spec 锁定) ──
const monthGroups = computed(() => groupMeterBlocks(zoneMeters.value, m => rd(m)))
const rosterGroups = computed(() => groupMeterBlocks(rosterRows.value))
const activeCount = computed(() => (seg.value === 'month' ? zoneMeters.value.length : rosterRows.value.length))
const mCols = computed(() => (kind.value === 'elec' ? 15 : 7))          // 月度段总列数(colspan 用)
const rCols = computed(() => (editMode.value ? 10 : 9))                 // 档案段总列数
// 折叠:默认全展开;折叠只收起 body(share/ops/tenant),infra 头行+汇总行保留(Excel 组折叠保小计)
const folded = ref(new Set<string>())
function toggleFold(key: string) {
  const s = new Set(folded.value)
  if (!s.delete(key)) s.add(key)
  folded.value = s
}
const blockRows = (b: { key: string; head: MeterDTO[]; body: MeterDTO[] }) =>
  folded.value.has(b.key) ? b.head : [...b.head, ...b.body]
// 汇总行/汇总条标签:X总用电量 / X总用水量 / 一期合计
const sumLabel = (name: string) => `${name}总用${kind.value === 'elec' ? '电' : '水'}量`
// 区块损耗行(PB-ALLOCATION-SPEC §3 就地兑现 METER-SPEC:96):总表(infra)vs 分表Σ,读时派生只读一行;
// 无总表读数不出行;负超阈黄标不阻断(blockLoss 纯函数 spec 锁定)
const lossOf = (b: { head: MeterDTO[]; sums: { usageTotal: number | null } }) =>
  blockLoss(b.head.map(m => rd(m)?.usageTotal ?? null), b.sums.usageTotal)
const fpct = (r: number | null) => (r == null ? '—' : (r * 100).toFixed(2) + '%')
const tableWrapEl = ref<HTMLElement | null>(null)
watch([seg, kind, zone, q, own], () => { tableWrapEl.value?.scrollTo?.(0, 0) })

// 档案段 FPTenantPicker 行浮层翻转:临近滚动容器底缘向上翻(免裁切;原分页时代按页内序号估算,滚动后失效)
const flipId = ref<number | null>(null)
function tenCellDown(m: MeterDTO, e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const wrapBottom = tableWrapEl.value?.getBoundingClientRect().bottom ?? window.innerHeight
  flipId.value = wrapBottom - el.getBoundingClientRect().bottom < 340 ? m.id : null
}

// ── 抽屉:该表逐月历史(metersApi.meterReadings),行式增删改 ──
const openMeter = ref<MeterDTO | null>(null)
const history = ref<MeterReadingDTO[] | null>(null)
async function openDrawer(m: MeterDTO) {
  openMeter.value = m
  history.value = null
  const data = await metersApi.meterReadings(m.id)
  if (openMeter.value?.id === m.id) history.value = data
}
const drawerRows = computed(() =>
  (history.value ?? []).slice().sort((a, b) => a.ym.localeCompare(b.ym)))
const drawerSub = computed(() => {
  const m = openMeter.value
  if (!m) return ''
  const parts = [`${METER_ZONE_LABEL[m.zone]}${METER_KIND_LABEL[m.kind]}`]
  const t = displayTenant(m)
  if (t) parts.push(t)
  else if (m.ownership !== 'tenant') parts.push(OWN_LABEL[m.ownership] ?? m.ownership)
  parts.push(`共 ${history.value?.length ?? 0} 条读数`)
  return parts.join(' · ')
})
// 抽屉显示行:尖峰平谷走 title 提示(抽屉列宽预算内直排放不下 8 段;主表已直排)
function touTitle(r: MeterReadingDTO, side: 'prev' | 'curr'): string | undefined {
  if (openMeter.value?.kind !== 'elec') return undefined
  const v = side === 'prev'
    ? [r.prevSharp, r.prevPeak, r.prevFlat, r.prevValley]
    : [r.currSharp, r.currPeak, r.currFlat, r.currValley]
  if (v.every(x => x == null)) return undefined
  const lab = ['尖', '峰', '平', '谷']
  return v.map((x, i) => `${lab[i]} ${x ?? '—'}`).join(' / ')
}

const editId = ref<number | null>(null)      // 非空=行编辑中
const adding = ref(false)                    // 新增行展开
const touOpen = ref(false)                   // 电表尖峰平谷折叠子行
const form = ref({
  ym: '', prevTotal: '', currTotal: '', note: '',
  prevSharp: '', prevPeak: '', prevFlat: '', prevValley: '',
  currSharp: '', currPeak: '', currFlat: '', currValley: '',
})
const fs = (v: number | null) => (v == null ? '' : String(v))

function startAdd() {
  editId.value = null; adding.value = true; touOpen.value = false
  form.value = {
    ym: ym.value, prevTotal: '', currTotal: '', note: '',
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
  // 已有分时段值 → 自动展开子行
  touOpen.value = openMeter.value?.kind === 'elec'
    && [r.prevSharp, r.prevPeak, r.prevFlat, r.prevValley, r.currSharp, r.currPeak, r.currFlat, r.currValley].some(x => x != null)
}
function cancelForm() { editId.value = null; adding.value = false; touOpen.value = false }
watch(openMeter, cancelForm)                       // 换表/关抽屉收起编辑行
watch(editMode, v => { if (!v) cancelForm() })     // 退出编辑模式收起编辑行(浏览态零写入口)

// 用量预览:(本月−上月)×倍率快照(编辑=原快照;新增=当前表倍率,保存时后端快照)
const previewUsage = computed(() => {
  const p = numOrNull(form.value.prevTotal), c = numOrNull(form.value.currTotal)
  if (p == null || c == null) return '—'
  const f = editId.value != null
    ? (history.value?.find(r => r.id === editId.value)?.factorSnap ?? 1)
    : (openMeter.value?.factor ?? 1)
  return fq((c - p) * f)
})

// 写后重载:抽屉历史+当月主表+档案(readingCount)+数据年份(新月份可能扩年)
async function reloadAfterWrite(m: MeterDTO) {
  const data = await metersApi.meterReadings(m.id)
  if (openMeter.value?.id === m.id) history.value = data
  loadReadings()
  loadMeters()
  metersApi.years().then(ys => { dataYears.value = ys }).catch(() => { /* 年份刷新失败不阻断 */ })
}

async function saveForm() {
  const m = openMeter.value
  if (!m) return
  if (!/^\d{4}-\d{2}$/.test(form.value.ym)) { alert('请选择月份'); return }
  const req = {
    meterId: m.id, ym: form.value.ym,
    prevTotal: numOrNull(form.value.prevTotal), currTotal: numOrNull(form.value.currTotal),
    prevSharp: numOrNull(form.value.prevSharp), prevPeak: numOrNull(form.value.prevPeak),
    prevFlat: numOrNull(form.value.prevFlat), prevValley: numOrNull(form.value.prevValley),
    currSharp: numOrNull(form.value.currSharp), currPeak: numOrNull(form.value.currPeak),
    currFlat: numOrNull(form.value.currFlat), currValley: numOrNull(form.value.currValley),
    note: form.value.note.trim() || null,
  }
  try {
    // 新录快照当时表倍率;编辑改量不改快照(后端语义,同 PV 口径)
    if (editId.value != null) await metersApi.updateReading(editId.value, req)
    else await metersApi.createReading(req)
    cancelForm()
    await reloadAfterWrite(m)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')   // 同表同月 409 中文文案直达
  }
}

async function delReading(r: MeterReadingDTO) {
  const m = openMeter.value
  if (!m) return
  if (!confirm(`确认删除 ${r.ym} 的读数?`)) return
  try { await metersApi.deleteReading(r.id); await reloadAfterWrite(m) }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }
}

// ── 表档案:行内改(乐观更新失败回滚,1:1 照 PvMeterView commitStationName) ──
const reqOf = (m: MeterDTO): MeterReq => ({
  kind: m.kind, zone: m.zone, name: m.name, area: m.area, spot: m.spot,
  tenantName: m.tenantName, meterType: m.meterType, subName: m.subName, code: m.code, factor: m.factor,
  tenantId: m.tenantId, buildingId: m.buildingId, ownership: m.ownership,
})
// 表名称列=subName(电表①);标识名(name)是内部键不在 UI 改(导入 upsert 键)
function commitSubName(m: MeterDTO, raw: string) {
  const v = raw.trim() || null
  if (v === m.subName) return
  const prev = m.subName
  m.subName = v
  metersApi.update(m.id, reqOf(m)).catch((e) => {
    m.subName = prev
    alert((e as { message?: string })?.message ?? '保存失败，请重试')
  })
}
function commitFactor(m: MeterDTO, raw: string) {
  const v = raw.trim() === '' ? 1 : Number(raw)   // 留空=1(档案 factor NOT NULL DEFAULT 1)
  if (!Number.isFinite(v) || v <= 0) { alert('倍率需为正数'); return }
  if (v === m.factor) return
  const prev = m.factor
  m.factor = v
  metersApi.update(m.id, reqOf(m))
    .then(() => alert('已保存。历史读数仍按录入时倍率快照计用量;改倍率只影响之后新录的读数。'))
    .catch((e) => {
      m.factor = prev
      alert((e as { message?: string })?.message ?? '保存失败，请重试')
    })
}
// 租户行内改(§6.4 FPTenantPicker):指定租户即归属转 tenant(§6.3 匹配成功→tenant)
function commitTenant(m: MeterDTO, id: number | null) {
  if (id === m.tenantId) return
  const prevId = m.tenantId, prevOwn = m.ownership
  m.tenantId = id
  if (id != null) m.ownership = 'tenant'
  metersApi.update(m.id, reqOf(m)).catch((e) => {
    m.tenantId = prevId; m.ownership = prevOwn
    alert((e as { message?: string })?.message ?? '保存失败，请重试')
  })
}
function commitBuilding(m: MeterDTO, raw: string) {
  const id = raw === '' ? null : Number(raw)
  if (id === m.buildingId) return
  const prev = m.buildingId
  m.buildingId = id
  metersApi.update(m.id, reqOf(m)).catch((e) => {
    m.buildingId = prev
    alert((e as { message?: string })?.message ?? '保存失败，请重试')
  })
}
function commitOwnership(m: MeterDTO, raw: string) {
  if (raw === m.ownership) return
  const prev = m.ownership
  m.ownership = raw as MeterDTO['ownership']
  metersApi.update(m.id, reqOf(m)).catch((e) => {
    m.ownership = prev
    alert((e as { message?: string })?.message ?? '保存失败，请重试')
  })
}
async function delMeter(m: MeterDTO) {
  if (!confirm(`确认删除「${m.name}」?有读数的表不可删除。`)) return
  try { await metersApi.remove(m.id); await loadMeters() }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }   // 有读数 409 → 中文守卫文案
}

// ── 新增表弹窗(§6.4:kind/zone/楼栋/方位/租户/归属/表名/编码/倍率) ──
const meterDlg = ref(false)
const mForm = ref({
  kind: 'elec', zone: 'p1', building: '', spot: '', tenantId: null as number | null,
  ownership: 'share', name: '', subName: '', code: '', factor: '',
})
const mErr = ref('')
const ZONE_OPTS = [{ value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }, { value: 'dorm', label: '宿舍' }]
const buildingOpts = computed(() => [
  { value: '', label: '—(未关联)' },
  ...buildings.value.map(b => ({ value: String(b.id), label: `${b.phaseName} · ${b.name}` })),
])
function openMeterDlg() {
  mForm.value = {
    kind: kind.value, zone: zone.value === 'all' ? 'p1' : zone.value,
    building: '', spot: '', tenantId: null, ownership: 'share', name: '', subName: '', code: '', factor: '',
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
      tenantId: mForm.value.tenantId,
      buildingId: mForm.value.building === '' ? null : Number(mForm.value.building),
      // 挂了租户即租户表(§6.3),否则按弹窗所选归属
      ownership: mForm.value.tenantId != null ? 'tenant' : mForm.value.ownership,
    })
    meterDlg.value = false
    await loadMeters()
  } catch (e) {
    mErr.value = (e as { message?: string })?.message ?? '新增失败'   // 同区同类重名 409 中文文案
  }
}

// ── 导入(registry key 'meter',整册多 sheet → sections 勾选段)/模板/导出当月 ──
// ctx 由 onMounted 填 tenantNames/buildings:解析器据此做租户拆分匹配(§6.2)与区域→楼栋映射(§6.3)
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
const importCtx: ImportCtx = {}
async function onImport(payload: ImportRec[] | { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  try {
    importResult.value = await runImport('meter', payload as never, importCtx, fileName)
    await Promise.all([loadMeters(), loadReadings()])
    metersApi.years().then(ys => { dataYears.value = ys }).catch(() => { /* 年份刷新失败不阻断 */ })
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
</script>

<template>
  <!-- 首载 gate:表档案/当月读数未落位不闪空表 -->
  <div v-if="!meters || !readings" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="mt-page">
    <!-- 标题行:右侧=两段 Segmented -->
    <div class="mt-head">
      <div>
        <h2 class="mt-title"><span class="ic"><component :is="iconFor('gauge')" :size="18" /></span>园区抄表</h2>
        <p class="mt-sub">全园区租户/公共水电表 花名册与月度读数 · 用量 = (本月 − 上月) × 录入时倍率快照</p>
      </div>
      <Segmented :options="SEG_OPTS" :model-value="seg" @update:model-value="seg = $event" />
    </div>

    <!-- 工具栏:左=电/水 Segmented+分区 tabs;右=段内操作 -->
    <div class="mx-toolbar">
      <div class="mt-toolbar-left">
        <Segmented :options="KIND_OPTS" :model-value="kind" size="sm" @update:model-value="kind = $event" />
        <FPPhaseTabs v-model="zone" :tabs="ZONE_TABS" :counts="tabCounts" />
      </div>
      <div class="mx-toolbar-right">
        <template v-if="seg === 'month'">
          <div style="width:110px">
            <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
          </div>
          <div style="width:92px">
            <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
          </div>
          <Button variant="outline" size="sm" @click="onTemplate">
            <template #leading><component :is="iconFor('file-spreadsheet')" :size="14" /></template>
            下载模板
          </Button>
          <!-- 导入入口收编辑态(EDIT-MODE-SPEC);模板/导出=只读操作常驻 -->
          <Button v-if="editMode" variant="outline" size="sm" @click="importing = true">
            <template #leading><component :is="iconFor('upload')" :size="14" /></template>
            导入
          </Button>
          <Button variant="filled" size="sm" :disabled="exporting" @click="onExport">
            <template #leading><component :is="iconFor('download')" :size="14" /></template>
            导出当月
          </Button>
        </template>
        <template v-else>
          <div class="mx-search">
            <span class="mx-search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input v-model="q" placeholder="搜索租户/原文/方位/表名" />
          </div>
          <Button v-if="editMode" variant="outline" size="sm" @click="openMeterDlg">
            <template #leading><component :is="iconFor('plus')" :size="14" /></template>
            新增表
          </Button>
        </template>
        <Button v-if="!auth.isReadonly" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="editMode = !editMode">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 档案段归属筛选 chips(§6.4) -->
    <div v-if="seg === 'roster'" class="mt-chips">
      <button
        v-for="c in [{ k: 'all', label: '全部' }, ...OWN_OPTS.map(o => ({ k: o.value, label: o.label }))]"
        :key="c.k" class="mt-chip" :class="{ on: own === c.k }" @click="own = c.k"
      >{{ c.label }}<span class="n">{{ ownCounts[c.k] ?? 0 }}</span></button>
    </div>

    <!-- 月度段空态引导:该月整月无读数(表照常列出,读数列空标漏抄) -->
    <div v-if="seg === 'month' && readings.length === 0" class="mt-empty">
      <component :is="iconFor('info')" :size="14" />
      <span>
        {{ year }}年{{ month }}月暂无抄表数据 ——
        <template v-if="editMode">可<button class="mt-link" @click="importing = true">导入</button>整册抄表工作簿(自动建档),或点击任意表行进入抽屉手动录入。</template>
        <template v-else-if="!auth.isReadonly">进入右上角「编辑模式」后可录入或导入。</template>
        <template v-else>各表读数列为空。</template>
      </span>
    </div>

    <!-- 列表卡片(§7:分页弃用,卡片内滚动;区块折叠代偿)。
         月度段双向滚动(sticky 租户列+双行表头吸顶),档案段纵向滚动(picker 浮层临底缘上翻) -->
    <Card surface="white" :padding="0" class="mx-listcard">
      <div ref="tableWrapEl" :key="seg + '_' + kind" class="mx-tablewrap"
           :class="seg === 'month' ? 'mt-hs' : 'mt-vs'">
        <!-- 月度抄表(§7):期区汇总条 → 区块(infra 头行→公共→户内→汇总行);电表直排 上月/本月 总尖峰平谷 -->
        <table v-if="seg === 'month'" class="mt-table mt-wide">
          <thead>
            <template v-if="kind === 'elec'">
              <tr>
                <th rowspan="2" class="stick l">租户 / 方位</th>
                <th rowspan="2">表名称</th>
                <th rowspan="2" class="num">倍率</th>
                <th colspan="5" class="grp">上月行至</th>
                <th colspan="5" class="grp">本月行至</th>
                <th rowspan="2" class="num">本月用量</th>
                <th rowspan="2">状态</th>
              </tr>
              <tr>
                <th class="num sub">总</th><th class="num sub">尖</th><th class="num sub">峰</th><th class="num sub">平</th><th class="num sub">谷</th>
                <th class="num sub">总</th><th class="num sub">尖</th><th class="num sub">峰</th><th class="num sub">平</th><th class="num sub">谷</th>
              </tr>
            </template>
            <tr v-else>
              <th class="stick l">租户 / 方位</th>
              <th>表名称</th>
              <th class="num">倍率</th>
              <th class="num">上月行至</th>
              <th class="num">本月行至</th>
              <th class="num">本月用量</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody v-for="zg in monthGroups" :key="zg.zone">
            <!-- 期区汇总条:该期 租户+公摊 用量各列合计(Σ区块;配电总表/园区经营不计入) -->
            <tr class="mt-zrow">
              <td class="stick l">{{ METER_ZONE_LABEL[zg.zone] }}合计</td>
              <td colspan="2"></td>
              <template v-if="kind === 'elec'">
                <td colspan="5" class="cap" title="该期 租户+园区公摊 各表用量合计;配电总表(避免重复计)与园区经营不计入">租户+公摊 用量合计(总/尖/峰/平/谷)→</td>
                <td class="num">{{ fq(zg.sums.usageTotal) }}</td>
                <td class="num tou">{{ fq(zg.sums.usageSharp) }}</td>
                <td class="num tou">{{ fq(zg.sums.usagePeak) }}</td>
                <td class="num tou">{{ fq(zg.sums.usageFlat) }}</td>
                <td class="num tou">{{ fq(zg.sums.usageValley) }}</td>
                <td class="num usage">{{ fq(zg.sums.usageTotal) }}</td>
                <td></td>
              </template>
              <template v-else>
                <td colspan="2" class="cap" title="该期 租户+园区公摊 各表用量合计;配电总表(避免重复计)与园区经营不计入">租户+公摊 用量合计 →</td>
                <td class="num usage">{{ fq(zg.sums.usageTotal) }}</td>
                <td></td>
              </template>
            </tr>
            <template v-for="b in zg.blocks" :key="b.key">
              <!-- 区块标题行:点击折叠(折叠保留 infra 头行+汇总行,Excel 组折叠保小计口径) -->
              <tr class="mt-brow" @click="toggleFold(b.key)">
                <td class="stick l">
                  <svg class="car" :class="{ off: folded.has(b.key) }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                  <span class="bn">{{ b.name }}</span>
                  <span class="bc">{{ b.head.length + b.body.length }} 表</span>
                </td>
                <td :colspan="mCols - 1"></td>
              </tr>
              <tr v-for="m in blockRows(b)" :key="m.id" class="click" :class="{ infra: m.ownership === 'infra' }" @click="openDrawer(m)">
                <td class="stick ten2 l" :title="displayTenant(m) ?? m.tenantName ?? undefined">
                  <template v-if="m.ownership === 'tenant'">
                    <span class="nm">{{ displayTenant(m) ?? '—' }}</span>
                    <span v-if="m.spot" class="sp">{{ m.spot }}</span>
                  </template>
                  <template v-else>
                    <span v-if="m.tenantName" class="nm">{{ m.tenantName }}</span>
                    <span class="mt-own" :class="'own-' + m.ownership">{{ OWN_LABEL[m.ownership] ?? m.ownership }}</span>
                  </template>
                </td>
                <td>{{ m.subName ?? '—' }}</td>
                <!-- 倍率:有读数=当月快照,无读数=档案倍率 -->
                <td class="num">{{ rd(m)?.factorSnap ?? m.factor }}</td>
                <template v-if="kind === 'elec'">
                  <td class="num" :class="{ zero: rd(m)?.prevTotal == null }">{{ fq(rd(m)?.prevTotal) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.prevSharp == null }">{{ fq(rd(m)?.prevSharp) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.prevPeak == null }">{{ fq(rd(m)?.prevPeak) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.prevFlat == null }">{{ fq(rd(m)?.prevFlat) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.prevValley == null }">{{ fq(rd(m)?.prevValley) }}</td>
                  <td class="num" :class="{ zero: rd(m)?.currTotal == null }">{{ fq(rd(m)?.currTotal) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.currSharp == null }">{{ fq(rd(m)?.currSharp) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.currPeak == null }">{{ fq(rd(m)?.currPeak) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.currFlat == null }">{{ fq(rd(m)?.currFlat) }}</td>
                  <td class="num tou" :class="{ zero: rd(m)?.currValley == null }">{{ fq(rd(m)?.currValley) }}</td>
                </template>
                <template v-else>
                  <td class="num" :class="{ zero: rd(m)?.prevTotal == null }">{{ fq(rd(m)?.prevTotal) }}</td>
                  <td class="num" :class="{ zero: rd(m)?.currTotal == null }">{{ fq(rd(m)?.currTotal) }}</td>
                </template>
                <td class="num usage" :class="{ zero: rd(m)?.usageTotal == null, neg: (rd(m)?.usageTotal ?? 0) < 0 }">{{ fq(rd(m)?.usageTotal) }}</td>
                <td>
                  <span v-if="flagsOf(m).missing" class="mt-flag warn" title="本月总读数为空">漏抄</span>
                  <span v-if="flagsOf(m).negative" class="mt-flag bad" title="总用量为负,疑换表/抄错">倒走</span>
                  <span v-if="flagsOf(m).touMismatch" class="mt-flag bad" title="尖峰平谷用量之和与总用量不符">时段不符</span>
                </td>
              </tr>
              <!-- 区块尾汇总行:「X总用电量」= 区块内 租户+公摊 用量合计(总/尖/峰/平/谷各列都汇) -->
              <tr v-if="b.sums.count" class="mt-srow">
                <td class="stick l">{{ sumLabel(b.name) }}</td>
                <td colspan="2"></td>
                <template v-if="kind === 'elec'">
                  <td colspan="5" class="cap" title="区块内 租户+园区公摊 各表用量合计;配电总表(避免重复计)与园区经营不计入">租户+公摊 用量合计 →</td>
                  <td class="num">{{ fq(b.sums.usageTotal) }}</td>
                  <td class="num tou">{{ fq(b.sums.usageSharp) }}</td>
                  <td class="num tou">{{ fq(b.sums.usagePeak) }}</td>
                  <td class="num tou">{{ fq(b.sums.usageFlat) }}</td>
                  <td class="num tou">{{ fq(b.sums.usageValley) }}</td>
                  <td class="num usage">{{ fq(b.sums.usageTotal) }}</td>
                  <td></td>
                </template>
                <template v-else>
                  <td colspan="2" class="cap" title="区块内 租户+园区公摊 各表用量合计;配电总表(避免重复计)与园区经营不计入">租户+公摊 用量合计 →</td>
                  <td class="num usage">{{ fq(b.sums.usageTotal) }}</td>
                  <td></td>
                </template>
              </tr>
              <!-- 区块损耗行(只读,读时派生):损耗量=分表Σ−总表(负=有损耗)+原损耗率;负超阈黄标 -->
              <tr v-if="b.sums.count && lossOf(b)" class="mt-lrow" :class="{ warn: lossOf(b)!.warn }">
                <td class="stick l">{{ b.name }}损耗</td>
                <td colspan="2"></td>
                <td :colspan="kind === 'elec' ? 10 : 2" class="cap"
                    title="损耗量=分表Σ(租户+公摊)−配电总表;负=有损耗;原损耗率=损耗量/总表量;人工调整与收取率在「公摊分摊」屏">
                  总表 {{ fq(lossOf(b)!.headQty) }} · 损耗量/原损耗率 →
                </td>
                <td class="num usage" :class="{ neg: lossOf(b)!.lossQty < 0 }">{{ fq(lossOf(b)!.lossQty) }}</td>
                <td>
                  <span class="mt-lrate" :class="{ warn: lossOf(b)!.warn }">{{ fpct(lossOf(b)!.lossRate) }}</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>

        <!-- 表档案(§6.4+§7):同样按区块分组呈现(区块小标题=区域),列不变;行内改(编辑态),删除守卫 -->
        <table v-else class="mt-table">
          <colgroup>
            <col style="width:64px" />
            <col style="width:124px" />
            <col style="width:110px" />
            <col /><!-- 租户:唯一弹性列 -->
            <col style="width:108px" />
            <col style="width:104px" />
            <col style="width:90px" />
            <col style="width:80px" />
            <col style="width:84px" />
            <col v-if="editMode" style="width:56px" />
          </colgroup>
          <thead>
            <tr>
              <th>期数</th>
              <th>楼栋</th>
              <th>方位</th>
              <th>租户</th>
              <th>归属</th>
              <th>表名称</th>
              <th>编码</th>
              <th class="num">倍率</th>
              <th class="num">读数条数</th>
              <th v-if="editMode"></th>
            </tr>
          </thead>
          <tbody v-for="zg in rosterGroups" :key="zg.zone">
            <!-- 全部选中时:期区→区块 两级标题 -->
            <tr v-if="zone === 'all'" class="mt-zrow">
              <td :colspan="rCols" class="l">{{ METER_ZONE_LABEL[zg.zone] }}</td>
            </tr>
            <template v-for="b in zg.blocks" :key="b.key">
              <tr class="mt-brow" @click="toggleFold(b.key)">
                <td :colspan="rCols" class="l">
                  <svg class="car" :class="{ off: folded.has(b.key) }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                  <span class="bn">{{ b.name }}</span>
                  <span class="bc">{{ b.head.length + b.body.length }} 表</span>
                </td>
              </tr>
              <tr v-for="m in blockRows(b)" :key="m.id" :class="{ infra: m.ownership === 'infra' }">
                <td>{{ pName(m) }}</td>
                <td :title="bName(m)">
                  <select v-if="editMode" class="mt-edit l sel" :value="m.buildingId ?? ''" title="关联楼栋管理"
                          @change="commitBuilding(m, ($event.target as HTMLSelectElement).value)">
                    <option value="">—</option>
                    <option v-for="bd in buildings" :key="bd.id" :value="bd.id">{{ bd.name }}</option>
                  </select>
                  <template v-else>{{ bName(m) }}</template>
                </td>
                <td :title="m.spot ?? undefined">{{ m.spot ?? '—' }}</td>
                <!-- 租户:编辑态=FPTenantPicker 行内改(临滚动容器底缘行浮层向上翻,免裁切);
                     浏览态=库内全名;「待核」仅 ownership=tenant 显(§7:公摊/经营/总表的企业名称原文只是描述) -->
                <td class="mt-tencell" :class="{ vis: editMode, flip: flipId === m.id }"
                    @mousedown="editMode && tenCellDown(m, $event)">
                  <FPTenantPicker
                    v-if="editMode"
                    :tenants="tenantOpts"
                    :model-value="m.tenantId"
                    :placeholder="m.tenantName ?? '选择租户'"
                    @update:model-value="commitTenant(m, $event)"
                  />
                  <template v-else-if="m.tenantId != null">{{ displayTenant(m) }}</template>
                  <template v-else-if="m.tenantName">
                    <span class="orig" :title="m.tenantName">{{ m.tenantName }}</span>
                    <span v-if="m.ownership === 'tenant'" class="mt-flag warn" title="企业名称原文未匹配到租户档案,请人工指定">待核</span>
                  </template>
                  <template v-else>—</template>
                </td>
                <td>
                  <select v-if="editMode" class="mt-edit l sel" :value="m.ownership"
                          @change="commitOwnership(m, ($event.target as HTMLSelectElement).value)">
                    <option v-for="o in OWN_OPTS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                  <span v-else class="mt-own" :class="'own-' + m.ownership">{{ OWN_LABEL[m.ownership] ?? m.ownership }}</span>
                </td>
                <td class="name" :title="m.subName ?? undefined">
                  <input v-if="editMode" class="mt-edit l" type="text"
                         :value="m.subName ?? ''" title="表名称(如 电表①),回车/失焦保存;留空=清除"
                         @change="commitSubName(m, ($event.target as HTMLInputElement).value)" />
                  <span v-else class="nm">{{ m.subName ?? '—' }}</span>
                </td>
                <td class="mono" :title="m.code ?? undefined">{{ m.code ?? '—' }}</td>
                <td class="num">
                  <input v-if="editMode" class="mt-edit" type="number" min="0" step="0.01"
                         :value="m.factor" title="倍率,回车/失焦保存;只影响之后新录读数"
                         @change="commitFactor(m, ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ m.factor }}</span>
                </td>
                <td class="num" :class="{ zero: m.readingCount === 0 }">{{ m.readingCount }}</td>
                <td v-if="editMode" class="ops">
                  <button class="mt-iop danger" title="删除(有读数不可删)" @click="delMeter(m)">
                    <component :is="iconFor('trash-2')" :size="14" />
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="activeCount === 0" class="mt-norows">
        {{ kindMeters.length === 0
          ? '暂无表档案 —— 可在「月度抄表」段导入整册抄表工作簿自动建档,或在「表档案」段编辑模式下手工新增。'
          : seg === 'roster' && (q.trim() || own !== 'all') ? '没有匹配的表' : '该分区暂无表档案' }}
      </div>
    </Card>

    <!-- 抽屉:该表逐月历史;增删改仅编辑态(EDIT-MODE-SPEC v2),浏览态=纯查看 -->
    <FPDrawer
      :open="!!openMeter"
      :title="openMeter?.name ?? ''"
      :subtitle="drawerSub"
      icon="gauge"
      :width="760"
      :fixedHeight="true"
      @close="openMeter = null"
    >
      <div v-if="!history" class="mt-dempty">加载中…</div>
      <div v-else-if="drawerRows.length === 0 && !adding" class="mt-dempty">
        该表暂无读数{{ editMode ? ',点下方「新增读数」手动录入,或在列表页「导入」整册 Excel。' : auth.isReadonly ? '。' : ',进入编辑模式后可录入或导入。' }}
      </div>
      <div v-else class="mt-dwrap">
        <table class="mt-dtable">
          <!-- 列宽预算(抽屉内容宽~672):月份108+上月104+本月104+用量104+状态96=516,备注弹性;尖峰平谷走折叠子行/悬停提示 -->
          <colgroup>
            <col style="width:108px" />
            <col style="width:104px" />
            <col style="width:104px" />
            <col style="width:104px" />
            <col style="width:96px" />
            <col /><!-- 备注:唯一弹性列(截断走 title) -->
            <col v-if="editMode" style="width:70px" />
          </colgroup>
          <thead>
            <tr>
              <th class="l">月份</th>
              <th>上月行至</th>
              <th>本月行至</th>
              <th>用量</th>
              <th class="l">状态</th>
              <th class="l">备注</th>
              <th v-if="editMode"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in drawerRows" :key="r.id">
              <!-- 行编辑态:月份+总读数+备注;电表尖峰平谷折叠子行 -->
              <template v-if="editId === r.id">
                <tr class="editing">
                  <td class="l"><input v-model="form.ym" class="mt-din" type="month" /></td>
                  <td><input v-model="form.prevTotal" class="mt-din num" type="number" step="0.01" placeholder="—" /></td>
                  <td><input v-model="form.currTotal" class="mt-din num" type="number" step="0.01" placeholder="—" /></td>
                  <td class="ro" :title="`按原倍率快照 ${r.factorSnap} 计`">{{ previewUsage }}</td>
                  <td class="l">
                    <button v-if="openMeter?.kind === 'elec'" class="mt-toulink" :class="{ on: touOpen }" @click="touOpen = !touOpen">尖峰平谷</button>
                    <span v-else class="mt-dim">—</span>
                  </td>
                  <td class="l"><input v-model="form.note" class="mt-din" type="text" placeholder="备注" /></td>
                  <td class="ops">
                    <button class="mt-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                    <button class="mt-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                  </td>
                </tr>
                <tr v-if="touOpen && openMeter?.kind === 'elec'" class="tourow">
                  <td colspan="7" class="l">
                    <div class="mt-tougrid">
                      <span class="lab">上月</span>
                      <label>尖<input v-model="form.prevSharp" class="mt-din num" type="number" step="0.01" /></label>
                      <label>峰<input v-model="form.prevPeak" class="mt-din num" type="number" step="0.01" /></label>
                      <label>平<input v-model="form.prevFlat" class="mt-din num" type="number" step="0.01" /></label>
                      <label>谷<input v-model="form.prevValley" class="mt-din num" type="number" step="0.01" /></label>
                      <span class="lab">本月</span>
                      <label>尖<input v-model="form.currSharp" class="mt-din num" type="number" step="0.01" /></label>
                      <label>峰<input v-model="form.currPeak" class="mt-din num" type="number" step="0.01" /></label>
                      <label>平<input v-model="form.currFlat" class="mt-din num" type="number" step="0.01" /></label>
                      <label>谷<input v-model="form.currValley" class="mt-din num" type="number" step="0.01" /></label>
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
                <td v-if="editMode" class="ops">
                  <button class="mt-iop" title="编辑" @click="startEdit(r)"><component :is="iconFor('pencil')" :size="14" /></button>
                  <button class="mt-iop danger" title="删除" @click="delReading(r)"><component :is="iconFor('trash-2')" :size="14" /></button>
                </td>
              </tr>
            </template>
            <!-- 新增行:保存时后端快照当前表倍率 -->
            <template v-if="adding">
              <tr class="editing">
                <td class="l"><input v-model="form.ym" class="mt-din" type="month" /></td>
                <td><input v-model="form.prevTotal" class="mt-din num" type="number" step="0.01" placeholder="—" /></td>
                <td><input v-model="form.currTotal" class="mt-din num" type="number" step="0.01" placeholder="—" /></td>
                <td class="ro" :title="`按当前表倍率 ${openMeter?.factor ?? 1} 预览,保存时快照`">{{ previewUsage }}</td>
                <td class="l">
                  <button v-if="openMeter?.kind === 'elec'" class="mt-toulink" :class="{ on: touOpen }" @click="touOpen = !touOpen">尖峰平谷</button>
                  <span v-else class="mt-dim">—</span>
                </td>
                <td class="l"><input v-model="form.note" class="mt-din" type="text" placeholder="备注" /></td>
                <td class="ops">
                  <button class="mt-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                  <button class="mt-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                </td>
              </tr>
              <tr v-if="touOpen && openMeter?.kind === 'elec'" class="tourow">
                <td colspan="7" class="l">
                  <div class="mt-tougrid">
                    <span class="lab">上月</span>
                    <label>尖<input v-model="form.prevSharp" class="mt-din num" type="number" step="0.01" /></label>
                    <label>峰<input v-model="form.prevPeak" class="mt-din num" type="number" step="0.01" /></label>
                    <label>平<input v-model="form.prevFlat" class="mt-din num" type="number" step="0.01" /></label>
                    <label>谷<input v-model="form.prevValley" class="mt-din num" type="number" step="0.01" /></label>
                    <span class="lab">本月</span>
                    <label>尖<input v-model="form.currSharp" class="mt-din num" type="number" step="0.01" /></label>
                    <label>峰<input v-model="form.currPeak" class="mt-din num" type="number" step="0.01" /></label>
                    <label>平<input v-model="form.currFlat" class="mt-din num" type="number" step="0.01" /></label>
                    <label>谷<input v-model="form.currValley" class="mt-din num" type="number" step="0.01" /></label>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <template v-if="editMode" #footer>
        <Button variant="filled" size="sm" :disabled="adding" @click="startAdd">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增读数
        </Button>
      </template>
    </FPDrawer>

    <!-- 新增表轻量弹窗(§6.4;样式同 PvMeterView pm-dlg 家族) -->
    <div v-if="meterDlg" class="mt-mask" @mousedown="meterDlg = false">
      <div class="mt-dlg" @mousedown.stop>
        <div class="mt-dlg-h">
          <h3>新增表</h3>
          <p>手工建档一块水/电表;楼栋/租户/归属可留空或后补,导入整册抄表工作簿时会自动匹配/刷新。</p>
        </div>
        <div class="mt-dlg-b">
          <div class="mt-dlg-row">
            <Select v-model="mForm.kind" label="类别" :options="KIND_OPTS" size="sm" />
            <Select v-model="mForm.zone" label="分区" :options="ZONE_OPTS" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Select v-model="mForm.building" label="期数·楼栋(可空)" :options="buildingOpts" size="sm" />
            <Select v-model="mForm.ownership" label="归属" :options="OWN_OPTS" size="sm" :disabled="mForm.tenantId != null" />
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
            <Input v-model="mForm.spot" label="方位(可空)" placeholder="如:1-3楼 / 东侧" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.code" label="表编码(可空)" size="sm" />
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

    <!-- 导入(registry key 'meter':整册 parseWorkbook → sections 勾选段;flat/sections 两口都接) -->
    <FpImportModal
      v-if="importing"
      title="导入 园区抄表 · 水电表读数"
      sub="上传整册抄表工作簿(一期/二期/宿舍×电/水 sheet,标题行含年月),识别 sheet 逐段勾选;表自动建档并按企业名称匹配租户/楼栋/归属,同表同月重复导入自动覆盖;缺本月读数照收并标「漏抄」"
      v-bind="parserProps('meter', importCtx)"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImport"
    />
    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
  </div>
</template>

<style scoped>
.mt-page { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* ── 标题行(样式同 PvMeterView pm-head 家族) ── */
.mt-head { flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mt-title { margin: 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.mt-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.mt-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

.mt-toolbar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* ── 归属筛选 chips(§6.4,档案段) ── */
.mt-chips { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mt-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; color: var(--text-secondary); cursor: pointer; transition: border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.mt-chip:hover { border-color: var(--border-strong); color: var(--text-primary); }
.mt-chip.on { border-color: var(--hue-blue); color: var(--hue-blue); background: rgb(240, 246, 255); }
.mt-chip .n { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 11px; color: var(--text-muted); }
.mt-chip.on .n { color: var(--hue-blue); }

/* ── 空态引导条 ── */
.mt-empty { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.mt-link { border: none; background: none; padding: 0; margin: 0 2px; font: inherit; color: var(--hue-blue); cursor: pointer; }
.mt-link:hover { text-decoration: underline; }

/* ── 主表(卡片/分页交给全局 mx-listcard 链;此处只管行样式) ── */
.mt-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.mt-table th { padding: 0 16px 10px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.mt-table th.num { text-align: right; }
/* 等高铁律:行高 --mx-row-h,td 不吃上下 padding;内容 nowrap+ellipsis 不撑行 */
.mt-table tbody tr { height: var(--mx-row-h, 56px); border-bottom: 1px solid var(--divider); transition: background var(--dur-fast) var(--ease-standard); }
.mt-table tbody tr:hover { background: var(--bg-panel); }
.mt-table tbody tr.click { cursor: pointer; }
.mt-table td { padding: 0 16px; vertical-align: middle; font: var(--type-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-table td.num, .mt-table td.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.mt-table td.num { text-align: right; }
.mt-table td.usage { font-weight: var(--fw-semibold); }
.mt-table td.zero { color: var(--text-disabled); font-weight: var(--fw-regular); }
.mt-table td.neg { color: var(--hue-red); }
.mt-table td.name .nm { font-weight: var(--fw-medium); }
.mt-table td.ops { overflow: visible; }

/* ── 月度宽表(§7 电表直排):表宽随列撑(min 100% 兜底水表窄表),wrap 双向滚动;
      仅租户列 sticky left:0 —— 单列免列宽累加 offset(台账 FPLedgerTable 陷阱只在多固定列时命中)。
      sticky 需自带不透明底色,行 hover 时同步换色;border-collapse:separate 免 sticky 边框错位 ── */
.mx-tablewrap.mt-hs { overflow: auto; scrollbar-width: thin; }
.mx-tablewrap.mt-vs { overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }   /* 档案段:纵向滚动 */
.mt-table.mt-wide { width: max-content; min-width: 100%; table-layout: auto; border-collapse: separate; border-spacing: 0; }
.mt-wide th, .mt-wide td { padding-left: 12px; padding-right: 12px; }
.mt-wide th.l { text-align: left; }
.mt-wide th.grp { text-align: center; border-bottom: none; padding-bottom: 4px; }
.mt-wide th.sub { padding-bottom: 6px; min-width: 76px; }
/* 双行表头吸顶:首行定高 30px,子行 top 接力(单行水表表头走全局 top:0) */
.mt-wide thead th { box-sizing: border-box; }
.mt-wide thead tr:first-child th { height: 30px; }
.mt-wide thead th.sub { top: 30px; }
.mt-wide tbody tr { border-bottom: none; }
.mt-wide tbody td { border-bottom: 1px solid var(--divider); }
.mt-wide td.ten2 { min-width: 190px; max-width: 260px; }
.mt-wide td.ten2 .nm { font-weight: var(--fw-medium); }
.mt-wide td.ten2 .sp { margin-left: 8px; font-size: var(--fs-micro); color: var(--text-muted); }
.mt-wide td.ten2 .nm + .mt-own { margin-left: 8px; }
.mt-wide td.tou { color: var(--text-secondary); }
.mt-wide th.stick, .mt-wide td.stick { position: sticky; left: 0; background: var(--surface-white); }
.mt-wide th.stick { z-index: 5; }             /* 高于全局 thead th 吸顶 z-index:2 */
.mt-wide td.stick { z-index: 1; box-shadow: 1px 0 0 var(--divider); }
.mt-wide tbody tr:hover td.stick { background: var(--bg-panel); }

/* ── §7 分组区块行:期区汇总条 / 区块标题(可折叠) / 区块尾汇总行 / infra 头行 ── */
.mt-table tr.mt-zrow { height: 44px; }
.mt-table tr.mt-zrow td { background: var(--bg-sunken); font-weight: var(--fw-semibold); }
.mt-table tr.mt-brow { height: 40px; cursor: pointer; }
.mt-table tr.mt-brow td { background: var(--surface-card); }
.mt-table .car { vertical-align: -2px; margin-right: 6px; color: var(--text-muted); transition: transform var(--dur-fast) var(--ease-standard); }
.mt-table .car.off { transform: rotate(-90deg); }
.mt-table .bn { font-weight: var(--fw-semibold); color: var(--text-primary); }
.mt-table .bc { margin-left: 8px; font-size: var(--fs-micro); color: var(--text-muted); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.mt-table tr.mt-srow td { background: var(--surface-card); font-weight: var(--fw-medium); }
/* 区块损耗行(只读派生):汇总行同底色;负超阈整行黄底提示 */
.mt-table tr.mt-lrow td { background: var(--surface-card); color: var(--text-secondary); }
.mt-table tr.mt-lrow.warn td { background: rgb(255, 250, 235); }
.mt-wide tr.mt-lrow td.stick { background: var(--surface-card); }
.mt-wide tr.mt-lrow.warn td.stick { background: rgb(255, 250, 235); }
.mt-lrate { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-micro); }
.mt-lrate.warn { color: rgb(138, 97, 0); font-weight: var(--fw-semibold); }
.mt-table tr.infra td { background: var(--surface-card); }
.mt-table tr.infra .nm, .mt-table tr.infra td.name .nm { font-weight: var(--fw-semibold); }
.mt-table tbody tr.infra:hover td { background: var(--bg-panel); }
.mt-table td.cap { text-align: right; color: var(--text-muted); font-size: var(--fs-micro); }
/* sticky 列在带色行里同底色(默认白底会露馅) */
.mt-wide tr.mt-zrow td.stick { background: var(--bg-sunken); }
.mt-wide tr.mt-brow td.stick, .mt-wide tr.mt-srow td.stick, .mt-wide tr.infra td.stick { background: var(--surface-card); }
.mt-wide tbody tr.infra:hover td.stick { background: var(--bg-panel); }

/* 归属徽标(§6.4):租户蓝/公摊灰/经营绿/配电橙 */
.mt-own { display: inline-block; font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 1px 8px; }
.mt-own.own-tenant { color: var(--hue-blue); background: rgb(232, 240, 254); }
.mt-own.own-share { color: var(--text-secondary); background: var(--bg-sunken); }
.mt-own.own-ops { color: rgb(21, 128, 61); background: rgb(222, 244, 229); }
.mt-own.own-infra { color: rgb(154, 88, 10); background: rgb(252, 243, 232); }

/* 状态徽标:漏抄黄 / 倒走·时段不符红(只标不拦) */
.mt-flag { display: inline-block; margin-right: 4px; font-family: var(--font-sans); font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 1px 8px; cursor: help; }
.mt-flag.warn { color: rgb(138, 97, 0); background: rgb(255, 244, 214); }
.mt-flag.bad { color: var(--hue-red); background: rgb(255, 238, 237); }

/* 档案租户格:原文+待核;编辑态放行 overflow 给 picker 浮层,下半屏行浮层向上翻 */
.mt-tencell .orig { margin-right: 6px; color: var(--text-secondary); }
.mt-tencell.vis { overflow: visible; }
.mt-tencell :deep(.fp-tp-trigger) { height: 32px; font-size: 12.5px; }
.mt-tencell.flip :deep(.fp-tp-pop) { top: auto; bottom: calc(100% + 6px); }

/* 行内编辑输入(档案段表名/倍率):静默融入单元格,hover/聚焦显边框 */
.mt-edit { width: 100%; box-sizing: border-box; height: 32px; padding: 0 8px; text-align: right; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); appearance: textfield; -moz-appearance: textfield; }
.mt-edit::-webkit-outer-spin-button, .mt-edit::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.mt-edit:hover { border-color: var(--border-subtle); background: var(--surface-white); }
.mt-edit:focus { outline: none; border-color: var(--hue-blue); background: var(--surface-white); }
.mt-edit.l { text-align: left; font-family: var(--font-sans); }
.mt-edit.sel { appearance: auto; -moz-appearance: auto; cursor: pointer; }   /* 楼栋/归属行内 select:保留原生箭头(裁切无虞) */

/* 卡片内空态(过滤后 0 行) */
.mt-norows { text-align: center; padding: 40px; color: var(--text-disabled); font-size: var(--fs-label); }

/* ── 抽屉记录表(样式同 PvMeterView pm-dtable 家族) ── */
.mt-dempty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.mt-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.mt-dtable { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; white-space: nowrap; }
.mt-dtable th { padding: 8px 10px; text-align: right; font-family: var(--font-sans); font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); border-bottom: 1px solid var(--divider); }
.mt-dtable td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; }
.mt-dtable tbody tr:last-child td { border-bottom: none; }
.mt-dtable .l { text-align: left; }
.mt-dtable td.note, .mt-dtable td.flags { font-family: var(--font-sans); color: var(--text-muted); }
.mt-dtable td.neg { color: var(--hue-red); }
.mt-dtable td.ro { color: var(--text-secondary); }
.mt-dtable tr.editing td { background: var(--surface-card); }
.mt-dtable tr.tourow td { background: var(--surface-card); padding-top: 0; }
.mt-dtable td.ops { white-space: nowrap; }
.mt-dim { color: var(--text-disabled); }
.mt-din { width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); }
.mt-din.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.mt-din.num::-webkit-outer-spin-button, .mt-din.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.mt-din:focus { outline: none; border-color: var(--hue-blue); }
.mt-iop { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.mt-iop:hover { background: var(--bg-hover); color: var(--text-primary); }
.mt-iop.ok:hover { color: var(--hue-blue); }
.mt-iop.danger:hover { background: rgb(255, 238, 237); color: var(--hue-red); }

/* 尖峰平谷:编辑行内折叠开关 + 子行 8 输入 */
.mt-toulink { border: 1px solid var(--border-subtle); background: var(--surface-white); border-radius: var(--radius-full); padding: 2px 10px; font-family: var(--font-sans); font-size: 11px; color: var(--text-secondary); cursor: pointer; transition: border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.mt-toulink:hover { border-color: var(--border-strong); color: var(--text-primary); }
.mt-toulink.on { border-color: var(--hue-blue); color: var(--hue-blue); }
.mt-tougrid { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0 6px; }
.mt-tougrid .lab { font-family: var(--font-sans); font-size: 11px; color: var(--text-muted); flex: 0 0 auto; }
.mt-tougrid label { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-sans); font-size: 11px; color: var(--text-secondary); }
.mt-tougrid label .mt-din { width: 78px; height: 26px; font-size: 12px; }

/* ── 新增表弹窗(样式同 PvMeterView pm-dlg 家族) ── */
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
.mt-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }
</style>
