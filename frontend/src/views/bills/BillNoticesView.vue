<script setup lang="ts">
// 催缴单屏 v2(S4-BILL-NOTICE-SPEC §7 S4-4 v2 拍板):一个租户一条(该户全部单据合并,
// 对齐 Excel 每租户一张 worksheet);一期/二期/三期分 tab(期归属=在租合同楼栋 phase→premise 前缀→兜底一期);
// 屏上不显收款主体/单据类/状态(引擎照旧拆单落库,只是 UI 聚合);签发/作废本轮撤下(api 端点保留)。
// 明细抽屉两 tab:场地租金(S5 刀4:fee_group='rent' 落库行,厂房/办公室/宿舍逐间块+面积拆解+折算式备注)在前、
// 水电费(全单明细合并,沿用 premise 分带小计+取价审计链悬浮)在后;
// 改造三:维护费块公摊按纸单合并成一行(五项,多池加总,构成进费项名悬浮),金额一分不改。
// 列表照 PoolLedgerView 手法(sticky 表头/34px 行/tfoot 钉底/zone Segmented)+LIST-PAGE-SPEC 列宽铁律;
// 账外户(offbook)整行降淡。写操作 admin(viewer 隐藏),GET 全员。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useTabsStore } from '@/stores/tabs'
import {
  billNoticesApi, type BillNoteOverrideDTO, type BillNoticeDTO, type BillNoticeDetailDTO, type BillNoticeLineDTO,
} from '@/api/billNotices'
import { paramsApi, type ParamStatusDTO } from '@/api/params'
import { staleText } from '@/utils/paramCenterLogic'
import { contractApi } from '@/api/contract'
import { PROPERTY_TYPE_LABEL, type ContractDTO, type PropertyType } from '@/types/contract'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { metersApi } from '@/api/meters'
import { buildYearOptions } from '@/utils/yearGate'
import {
  aggregateByTenant, auditTitle, billFeeLabel, billFeeTitle, billQtyCell, crossBuildingMark, dormPriceCells,
  groupByBuilding, groupDormExcelStyle, groupExcelStyle, groupRentByPremise, lineNoteKey, mergeMaintRows,
  mergeNoteKey, noteDisplay, noteKeyId, rentAreaText,
  rentByTenant, rentFeeName, resolvePhase, segLabel, tenantBuildings, tenantKpis,
  type CrossMark, type NoteKey, type QtyCell, type ShareMergeRow, type TenantBuildings, type TenantNoticeRow,
} from '@/utils/billNoticeLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPStat from '@/components/fp/FPStat.vue'
import CoefBookWindow from './CoefBookWindow.vue'
// ── S20 交付链:收款公司/收款簿/两个导出窗口 + 抽屉方格 + 状态流 ──
import CompanyBookWindow from './CompanyBookWindow.vue'
import PayBookWindow from './PayBookWindow.vue'
import ExportNoticeWindow from './ExportNoticeWindow.vue'
import ExportReconWindow from './ExportReconWindow.vue'
import PaySlotGrid from '@/components/fp/PaySlotGrid.vue'
import { billDeliveryApi, companyBookApi, type CompanyFullDTO } from '@/api/billDelivery'
import { billsApi } from '@/api/bills'
import {
  buildSlotCells, slotAmounts, tenantStatus,
  type ExportNoticeReq, type ExportReconReq, type SlotCell, type TenantStatus,
} from '@/utils/payBookLogic'
import {
  exportNoticeZip, exportReconWorkbook, exportTenantNotice,
  type CompanyAccount, type Company as ExcelCompany, type NoticeExportItem, type ReconRow,
} from '@/utils/billNoticeExcel'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmt2 = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
const r2 = (v: number) => Math.round(v * 100) / 100

// ── 账期(年数据驱动;bill-notices 无 years 端点,复用抄表年份——单随读数走,alloc 屏同手法) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)

// ── 数据:催缴单 + 当月在租合同(期归属/月租金参考用,取月中 15 日)同拉;竞态守卫 ──
const rows = ref<BillNoticeDTO[] | null>(null)
const contracts = ref<ContractDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const status = ref<ParamStatusDTO | null>(null)   // S21:计费参数状态(参数晚于本月批次 → stale 条)
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [ns, cs, st] = await Promise.all([
    billNoticesApi.list(ym.value).catch(() => [] as BillNoticeDTO[]),
    contractApi.list(`${ym.value}-15`).catch(() => [] as ContractDTO[]),
    paramsApi.status(ym.value).catch(() => null),
  ])
  if (my !== seq) return
  rows.value = ns
  contracts.value = cs
  status.value = st
}
const staleMsg = computed(() => staleText(status.value, 'bill'))
// 深链协议:KeepAlive 缓存实例只在 setup 消费 query,必须 openFresh
const router = useRouter()
const tabs = useTabsStore()
function gotoParams() {
  tabs.openFresh('params', { pin: true })
  router.push({ path: '/params', query: { ym: ym.value } })
}
// 页签切回:参数页那边可能刚重算过 —— 批次时间变了就整月重拉(单与 stale 条一起变新),没变只刷状态
onReactivated(async () => {
  const before = status.value?.billBatchAt
  const st = await paramsApi.status(ym.value).catch(() => null)
  if (st && st.billBatchAt !== before) loadMonth()
  else if (st) status.value = st
})
onMounted(async () => {
  buildingApi.list().then(bs => { buildings.value = bs }).catch(() => { /* 楼栋失败按 premise 回退归期 */ })
  loadCompanies(); loadPayMap()   // S20:收款公司与映射(状态列橙点与抽屉方格用)
  try {
    dataYears.value = await metersApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // watch 触发 loadMonth
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month], loadMonth)

// ── 一户一条聚合 + 期归属 + 月租金(参考) ──
const bById = computed(() => new Map(buildings.value.map(b => [b.id, b])))
const contractsByTenant = computed(() => {
  const m = new Map<number, ContractDTO[]>()
  for (const c of contracts.value) {
    const a = m.get(c.tenantId)
    if (a) a.push(c); else m.set(c.tenantId, [c])
  }
  return m
})
const rentMap = computed(() => rentByTenant(contracts.value))
interface DisplayRow extends TenantNoticeRow {
  rent: number | null; phase: 1 | 2 | 3
  bld: TenantBuildings          // 改造二:主楼栋(归组用)+全部楼栋
  mark: CrossMark | null        // 跨楼栋轻标记(单栋户 null)
}
const tenantRows = computed<DisplayRow[]>(() => aggregateByTenant(rows.value ?? []).map(t => {
  const cs = contractsByTenant.value.get(t.tenantId) ?? []
  const bld = tenantBuildings(cs)
  return {
    ...t,
    rent: rentMap.value.get(t.tenantId) ?? null,
    phase: resolvePhase(
      cs.map(c => {
        const b = bById.value.get(c.buildingId)
        return { phase: b?.phase ?? 0, name: b?.name ?? '' }
      }),
      t.premiseText),
    bld,
    mark: crossBuildingMark(bld),
  }
}))

// ── 期 tab(PoolLedgerView 的 zone Segmented 手法;一级页签不参与重置) ──
const phase = ref<string>('1')
const PHASE_OPTS = [
  { value: '1', label: '一期' }, { value: '2', label: '二期' }, { value: '3', label: '三期' },
]
const phaseRows = computed(() => tenantRows.value.filter(r => r.phase === +phase.value))

// ── KPI 条(户数/水电总额/月租金合计(参考)/警告户数,随当前期 tab 联动) ──
const kpis = computed(() => tenantKpis(phaseRows.value))

// ── 筛选:仅看有警告/租户搜索 ──
const warnOnly = ref(false)
const q = ref('')
const filtered = computed(() => phaseRows.value.filter(r =>
  (!warnOnly.value || !!r.warn)
  && (q.value.trim() === '' || (r.tenantName ?? '').includes(q.value.trim()))))
// 改造二:期 tab 内按主楼栋分组(入参=筛选后的行 → 搜索/仅看警告/换期自动重算,空组不出现)
const groups = computed(() => groupByBuilding(filtered.value, r => r.bld.main))
const footLines = computed(() => filtered.value.reduce((s, r) => s + r.lineCount, 0))
const footTotal = computed(() => filtered.value.reduce((s, r) => s + (r.totalAmount ?? 0), 0))
const footRent = computed(() => filtered.value.reduce((s, r) => s + (r.rent ?? 0), 0))

// ── 系数簿窗口(S14):批量改系数;viewer 也可打开只读查看(窗口内编辑模式走 canEdit) ──
const coefOpen = ref(false)

// ── S20 交付链:三个新窗口 + 户级状态/收款缺口(状态单据级存储、户级展示) ──
const companyOpen = ref(false)
const payBookOpen = ref(false)
const expNoticeOpen = ref(false)
const expReconOpen = ref(false)
const exportBusy = ref(false)
const exportResult = ref('')
const companies = ref<CompanyFullDTO[]>([])
const payMap = ref(new Map<string, number>())   // `${tenantId}|${colId}` → companyId
const selected = ref(new Set<number>())         // 列表勾选的 tenantId
const confirming = ref(false)
// 批量模式:常态列表无勾选列(106 行 × 一个方框的永久视觉成本换一个偶尔用的操作,不划算),
// 点「批量确认」才滑出勾选列并把筛选行换成操作条;确认完/点退出即收起。
const bulkMode = ref(false)

function loadCompanies() {
  companyBookApi.list().then(cs => { companies.value = cs }).catch(() => { /* 公司失败=下拉空,不阻断列表 */ })
}
function loadPayMap() {
  billsApi.paymap().then(ps => {
    payMap.value = new Map(ps.map(p => [`${p.tenantId}|${p.feeKey}`, p.companyId]))
  }).catch(() => { /* 映射失败=全按未设置显示 */ })
}

// 户级状态 = 该户全部单据状态收敛(tenantStatus:全 confirmed→confirmed,混态→confirmed,全 exported→exported)
const noticesByTenant = computed(() => {
  const m = new Map<number, BillNoticeDTO[]>()
  for (const n of rows.value ?? []) {
    const l = m.get(n.tenantId); if (l) l.push(n); else m.set(n.tenantId, [n])
  }
  return m
})
const statusOf = (tid: number): TenantStatus => tenantStatus(noticesByTenant.value.get(tid) ?? [])
// 收款缺口:该户任一单 pay_company_id 为空(提示不阻断,确认后橙点保留)
const gapOf = (tid: number) => (noticesByTenant.value.get(tid) ?? []).some(n => n.payCompanyId == null)
const ST_LABEL: Record<TenantStatus, string> = {
  draft: '待核对', partial: '部分确认', confirmed: '已确认', exported: '已导出',
}

const bulk = computed(() => canEdit.value && bulkMode.value)
function exitBulk() { bulkMode.value = false; selected.value = new Set() }
// 换期/换月自动退出:选中集是 tenantId,切走后残留项不可见但仍在集里,再点「确认选中」会误伤
watch([phase, year, month], exitBulk)
const selCount = computed(() => filtered.value.filter(r => selected.value.has(r.tenantId)).length)
const allChecked = computed(() => filtered.value.length > 0 && filtered.value.every(r => selected.value.has(r.tenantId)))
function toggleAll() {
  const on = !allChecked.value
  for (const r of filtered.value) { if (on) selected.value.add(r.tenantId); else selected.value.delete(r.tenantId) }
  selected.value = new Set(selected.value)
}
function toggleOne(tid: number) {
  if (selected.value.has(tid)) selected.value.delete(tid); else selected.value.add(tid)
  selected.value = new Set(selected.value)
}

// 确认:未设收款公司只提示不阻断(§2.2);单向流转,已确认/已导出户重新生成自动跳过
async function confirmTenants(tids: number[]) {
  if (!canEdit.value || confirming.value || !tids.length) return
  const gaps = tids.filter(gapOf)
  if (gaps.length) {
    const names = gaps.slice(0, 5)
      .map(t => filtered.value.find(r => r.tenantId === t)?.tenantName ?? '#' + t).join('、')
    if (!confirm(`${gaps.length} 户有费用未指定收款公司(${names}${gaps.length > 5 ? ' 等' : ''})。\n`
      + '导出的通知单上这部分不显示收款账户信息,租户可能不知道往哪付款。\n仍然确认?')) return
  }
  confirming.value = true
  try {
    const res = await billDeliveryApi.confirm(ym.value, tids)
    flashOk(`已确认 ${res.confirmed} 单${res.skipped ? `,跳过 ${res.skipped} 单(已确认/已作废)` : ''}`)
    exitBulk()
    await loadMonth()
  } catch (e) { alert(errMsg(e, '确认失败')) } finally { confirming.value = false }
}

// 该户导出所需的一整包(明细 + 备注覆盖 + 场地);批量与单户共用,免两处拼装走样
async function buildExportItem(tid: number, exportYm: string): Promise<NoticeExportItem> {
  const row = (rows.value ?? []).filter(n => n.tenantId === tid)
  const ds = await Promise.all(row.map(n => billNoticesApi.detail(n.id)))
  const ns = await billNoticesApi.notes(exportYm, tid).catch(() => [] as BillNoteOverrideDTO[])
  return {
    tenantId: tid, tenantName: row[0]?.tenantName ?? null, details: ds,
    notes: new Map(ns.map(o => [noteKeyId(o), o.note])),
    premiseText: row.map(n => n.premiseText).find(Boolean) ?? null,
  }
}
// 账户解析器:批量走窗口里选的账户,单户(卡片按钮)没有选择界面 → 取该公司默认账户(is_default,其次首个)
function accountResolver(pick?: Record<number, number | null>): (cid: number | null) => CompanyAccount | null {
  const accById = new Map(companies.value.flatMap(c => (c.accounts ?? []).map(a => [a.id, a] as const)))
  const coById = new Map(companies.value.map(c => [c.id, c] as const))
  return cid => {
    if (cid == null) return null
    if (pick) return accById.get(pick[cid] ?? -1) ?? null
    const accs = coById.get(cid)?.accounts ?? []
    return accs.find(a => a.isDefault) ?? accs[0] ?? null
  }
}
const companyResolver = (): (id: number | null) => ExcelCompany | null => {
  const coById = new Map(companies.value.map(c => [c.id, c] as const))
  return id => (id == null ? null : coById.get(id) ?? null)
}

// 导出通知单编排(窗口只发请求,拉明细→出 zip→标记已导出 归宿主,§5.1)
async function onExportNotice(req: ExportNoticeReq) {
  if (exportBusy.value) return
  exportBusy.value = true
  exportResult.value = ''
  try {
    const items: NoticeExportItem[] = []
    for (const tid of req.tenantIds) items.push(await buildExportItem(tid, req.ym))
    const res = await exportNoticeZip(items, req.ym,
      accountResolver(req.accountByCompany), companyResolver())
    await billDeliveryApi.markExported(req.ym, req.tenantIds).catch(() => { /* 标记失败不影响已下载文件 */ })
    const noAcct = req.tenantIds.filter(gapOf).length
    exportResult.value = `已导出 ${res.files} 个租户文件 / ${res.sheets} 张通知单`
      + (noAcct ? ` · 其中 ${noAcct} 户无收款账户` : '')
    flashOk(exportResult.value)
    expNoticeOpen.value = false
    await loadMonth()
  } catch (e) { alert(errMsg(e, '导出失败')) } finally { exportBusy.value = false }
}

// 单户导出(催缴卡片按钮):同一套版式与账户口径,只是不打包;与批量一样回标已导出
const cardBusy = ref(false)
async function onExportTenant() {
  const r = dlgRow.value
  if (!r || cardBusy.value) return
  cardBusy.value = true
  try {
    const item = await buildExportItem(r.tenantId, dlgYm.value)
    const res = await exportTenantNotice(item, dlgYm.value, accountResolver(), companyResolver())
    if (!res.sheets) { alert('该户本月没有可导出的费用行'); return }
    await billDeliveryApi.markExported(dlgYm.value, [r.tenantId]).catch(() => { /* 标记失败不影响已下载文件 */ })
    flashOk(`已导出 ${r.tenantName ?? '#' + r.tenantId}${res.sheets > 1 ? ` · ${res.sheets} 家收款公司分 sheet` : ''}`)
    await loadMonth()
  } catch (e) { alert(errMsg(e, '导出失败')) } finally { cardBusy.value = false }
}

// 导出对账表:摊平当月全部明细行 → 每公司一 sheet + 总表(§5.2)
async function onExportRecon(req: ExportReconReq) {
  if (exportBusy.value) return
  exportBusy.value = true
  try {
    const recon: ReconRow[] = []
    for (const n of rows.value ?? []) {
      const d = await billNoticesApi.detail(n.id)
      for (const l of d.lines)
        recon.push({
          companyId: n.payCompanyId ?? null, tenantId: n.tenantId,
          tenantName: n.tenantName, feeKey: l.feeKey, amount: l.amount ?? 0,
        })
    }
    await exportReconWorkbook(recon, req.ym, req.sheets)
    flashOk(`对账表已导出(${req.sheets.length} 个 sheet)`)
    expReconOpen.value = false
  } catch (e) { alert(errMsg(e, '导出失败')) } finally { exportBusy.value = false }
}

// 抽屉方格(§2.1 收款方分段):该户有钱的槽才出格;保存=逐条 PUT paymap
const slotSaving = ref(false)
const slotCells = computed<SlotCell[]>(() => {
  const r = dlgRow.value
  if (!r || !details.value.length) return []
  return buildSlotCells(r.tenantId,
    { dorm: details.value.some(d => d.noticeKind === 'dorm'), amounts: slotAmounts(details.value) },
    payMap.value, companies.value)
})
async function onSlotSave(p: { colIds: string[]; companyId: number }) {
  if (!canEdit.value || slotSaving.value || !dlgRow.value) return
  const tid = dlgRow.value.tenantId
  slotSaving.value = true
  try {
    for (const colId of p.colIds) await billsApi.setPaymap({ tenantId: tid, feeKey: colId as never, companyId: p.companyId })
    loadPayMap()
    flashOk(`已指定 ${p.colIds.length} 项收款公司;下次重新生成按新归属拆单`)
  } catch (e) { alert(errMsg(e, '保存失败')) } finally { slotSaving.value = false }
}

// ── 重新生成(admin;confirm 后 POST generate,轻提示显摘要,完成刷新) ──
const generating = ref(false)
const okMsg = ref('')
let okTimer: ReturnType<typeof setTimeout> | undefined
function flashOk(msg: string) {
  okMsg.value = msg
  clearTimeout(okTimer)
  okTimer = setTimeout(() => { okMsg.value = '' }, 5000)
}
async function onGenerate() {
  if (generating.value) return
  if (!confirm(`重新生成 ${ym.value} 催缴单:先删后插覆盖本月草稿/作废单,按当前读数与价目重派;已签发单跳过不覆盖(须先作废)。确认?`)) return
  generating.value = true
  try {
    const res = await billNoticesApi.generate(ym.value)
    flashOk(`已生成 ${res.generated} 单 / ${res.lines} 行,${res.warned} 单带警告(含已签发跳过户)`)
    await loadMonth()
  } catch (e) { alert(errMsg(e, '生成失败')) } finally { generating.value = false }
}

// ── 明细抽屉(两 tab:场地租金在前/水电费在后;竞态守卫同列表手法) ──
const dlgOpen = ref(false)
const dlgTab = ref<string>('rent')
const DLG_TABS = [{ value: 'rent', label: '场地租金' }, { value: 'util', label: '水电费' }]
const dlgLoading = ref(false)
const dlgRow = ref<DisplayRow | null>(null)
const details = ref<BillNoticeDetailDTO[]>([])
let dlgSeq = 0

async function openDetail(r: DisplayRow) {
  dlgOpen.value = true
  dlgTab.value = 'rent'
  dlgRow.value = r
  dlgYm.value = ym.value   // 快照:抽屉开着换月不改备注归属月
  dlgLoading.value = true
  details.value = []
  noteMap.value = new Map()
  noteEditKey.value = null
  const my = ++dlgSeq
  try {
    const [ds, ns] = await Promise.all([
      Promise.all(r.noticeIds.map(id => billNoticesApi.detail(id))),
      // 备注覆盖失败不阻断明细(如后端未升级到 V92):按无覆盖显示引擎备注
      billNoticesApi.notes(ym.value, r.tenantId).catch(() => [] as BillNoteOverrideDTO[]),
    ])
    if (my !== dlgSeq) return
    details.value = ds
    noteMap.value = new Map(ns.map(o => [noteKeyId(o), o.note]))
  } catch (e) {
    if (my !== dlgSeq) return
    alert(errMsg(e, '明细加载失败')); dlgOpen.value = false
  } finally { if (my === dlgSeq) dlgLoading.value = false }
}

// ── 备注人工覆盖(V92,本刀):独立表挂业务键(重生成先删后插不丢);显示优先级=人工覆盖>引擎备注。
// 行键:普通行=feeKey+premise+meterId+seg,合并行=feeKey+premise+'merged'(billNoticeLogic 纯函数)。
// 编辑手法照抄 MeterDetailDrawer 行内编辑(铅笔→行内输入+√/×),入口 hover 显现,仅 admin。
// 宿舍子表(逐间宽行)本轮不接:另一套版式无独立备注列,待有诉求再开。
const dlgYm = ref('')
const noteMap = ref(new Map<string, string>())
const noteEditKey = ref<string | null>(null)
const noteDraft = ref('')
const noteSaving = ref(false)
const noteCell = (k: NoteKey, engine: string | null) => noteDisplay(noteMap.value, k, engine)
const noteDotTitle = (engine: string | null) =>
  `手写备注(引擎原文:${engine || '无'})${canEdit.value ? ';点击恢复引擎备注' : ''}`
function startNoteEdit(k: NoteKey, current: string) {
  if (!canEdit.value) return
  noteEditKey.value = noteKeyId(k)
  noteDraft.value = current
}
async function saveNoteEdit(k: NoteKey) {
  if (noteSaving.value || !dlgRow.value) return
  const base = { ym: dlgYm.value, tenantId: dlgRow.value.tenantId, ...k }
  const text = noteDraft.value.trim()
  noteSaving.value = true
  try {
    if (text) {
      await billNoticesApi.saveNote({ ...base, note: text })
      noteMap.value.set(noteKeyId(k), text)
    } else {   // 清空保存=清除覆盖,恢复引擎备注(后端 DELETE 幂等)
      await billNoticesApi.deleteNote(base)
      noteMap.value.delete(noteKeyId(k))
    }
    noteEditKey.value = null
  } catch (e) { alert(errMsg(e, '备注保存失败')) } finally { noteSaving.value = false }
}
async function restoreNote(k: NoteKey, engine: string | null) {
  if (!canEdit.value || noteSaving.value || !dlgRow.value) return
  if (!confirm(`恢复引擎备注${engine ? `「${engine}」` : '(该行引擎无备注)'}?手写内容将被清除。`)) return
  noteSaving.value = true
  try {
    await billNoticesApi.deleteNote({ ym: dlgYm.value, tenantId: dlgRow.value.tenantId, ...k })
    noteMap.value.delete(noteKeyId(k))
    noteEditKey.value = null
  } catch (e) { alert(errMsg(e, '恢复失败')) } finally { noteSaving.value = false }
}

// 水电 tab v3(可莱恩 worksheet 版式):非宿舍单→电/水两部逐场地「费块+维护费块」;
// dorm 单→宿舍逐间子表;末行合计=非宿舍+宿舍。行归块在 billNoticeLogic 纯函数,此处只拍平成渲染行。
// S5 起单内混租金行(fee_group='rent'),水电 tab 只吃非 rent 行。
const utilLines = computed(() => details.value.map(d => ({ ...d, lines: d.lines.filter(l => l.feeGroup !== 'rent') })))
const mainLines = computed(() => utilLines.value.filter(d => d.noticeKind !== 'dorm').flatMap(d => d.lines))
const dormLines = computed(() => utilLines.value.filter(d => d.noticeKind === 'dorm').flatMap(d => d.lines))
const xg = computed(() => groupExcelStyle(mainLines.value))
const dorm = computed(() => groupDormExcelStyle(dormLines.value))
const utilGrand = computed(() => r2(xg.value.total + dorm.value.total))
// 非宿舍表拍平:band(块头)/line(明细行,块内重编号)/merge(公摊合并行)/sub(块小计)/part(部合计)。
// 改造三:维护费块过 mergeMaintRows——公摊五项各一行(纸单口径),小计仍取 groupExcelStyle 的原始行累加。
type UtilRowVM =
  | { t: 'band'; label: string }
  | { t: 'line'; no: number; l: BillNoticeLineDTO; q: QtyCell; nk: NoteKey }   // q=刀D 可验算的乘数/单位/显示价;nk=备注覆盖行键
  | { t: 'merge'; no: number; m: ShareMergeRow<BillNoticeLineDTO>; nk: NoteKey }
  | { t: 'sub' | 'part'; label: string; amount: number }
const utilRows = computed<UtilRowVM[]>(() => {
  const out: UtilRowVM[] = []
  const block = (
    label: string, ls: BillNoticeLineDTO[], subLabel: string | null, subAmount: number, merge = false,
  ) => {
    if (!ls.length) return
    out.push({ t: 'band', label })
    const rows = merge ? mergeMaintRows(ls) : ls.map(l => ({ kind: 'line' as const, line: l }))
    rows.forEach((r, i) => out.push(r.kind === 'line'
      ? { t: 'line', no: i + 1, l: r.line, q: billQtyCell(r.line), nk: lineNoteKey(r.line) }
      : { t: 'merge', no: i + 1, m: r.row, nk: mergeNoteKey(r.row.feeKey, r.row.members[0]?.premise ?? null) }))
    if (subLabel) out.push({ t: 'sub', label: subLabel, amount: subAmount })
  }
  const g = xg.value
  for (const p of g.elec.groups) {
    block(`电费(${p.label})`, p.fee, '场地电费合计', p.feeTotal)
    block(`用电维护费(${p.label})`, p.maint, '场地维护费合计', p.maintTotal, true)
  }
  if (g.elec.groups.length) out.push({ t: 'part', label: '电费、用电维护费合计', amount: g.elec.total })
  for (const p of g.water.groups) {
    block(`水费(${p.label})`, p.fee, null, 0)
    block(`用水维护费(${p.label})`, p.maint, null, 0, true)
    out.push({ t: 'sub', label: `场地水费、维护费合计(${p.label})`, amount: p.subtotal })
  }
  if (g.water.groups.length) out.push({ t: 'part', label: '水费、用水维护费合计', amount: g.water.total })
  block('其他费项', g.other, '其他费项合计', g.otherTotal)
  return out
})

// 宿舍子表(S7 缺口③):两价各补到能验平自己那段的位数;配不上间的 extras 也铺出乘数/单价,同样逐行可验
const dormElecRows = computed(() => dorm.value.elec.rooms.map(r => ({ r, c: dormPriceCells(r.main, r.mgmt) })))
const dormWaterRows = computed(() => dorm.value.water.rooms.map(r => ({ r, c: dormPriceCells(r.main, null) })))
const dormElecExtras = computed(() => dorm.value.elec.extras.map(l => ({ l, q: billQtyCell(l) })))
const dormWaterExtras = computed(() => dorm.value.water.extras.map(l => ({ l, q: billQtyCell(l) })))
// 路灯/绿化水公摊格悬浮:面积×分摊单价=金额(与主表同一套判定,该格只有金额没法心算)
function shareTitle(l: BillNoticeLineDTO | null): string | undefined {
  if (!l) return undefined
  const q = billQtyCell(l)
  return q.qty == null ? undefined : `${q.qty} ${q.unit} × ${q.price} = ${fmt2(l.amount)}`
}

// 场地租金 tab(S5 刀4):渲染 fee_group='rent' 落库行,按 premise 分块(厂房/办公室/宿舍逐间)
const rentLines = computed(() => details.value.flatMap(d => d.lines).filter(l => l.feeGroup === 'rent'))
const rentG = computed(() => groupRentByPremise(rentLines.value))
const rentBandLabel = (g: { type: PropertyType | null; label: string }) =>
  g.type ? `${PROPERTY_TYPE_LABEL[g.type]}(${g.label})` : g.label

const drawerSub = computed(() => {
  const r = dlgRow.value
  if (!r) return ''
  const cn = (contractsByTenant.value.get(r.tenantId) ?? []).length
  return [ym.value, `在租合同 ${cn} 份`, `明细 ${r.lineCount} 行`].join(' · ')
})
</script>

<template>
  <div v-if="!rows" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="bn-page">
    <!-- 标题行:h2+账期+期页签;右=重新生成(admin) -->
    <div class="bn-head">
      <div class="bn-head-l">
        <h2 class="bn-title"><span class="ic"><component :is="iconFor('file-check-2')" :size="18" /></span>催缴单</h2>
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Segmented :options="PHASE_OPTS" v-model="phase" size="sm" />
      </div>
      <div class="bn-actions">
        <Button variant="outline" size="sm" @click="companyOpen = true">
          <template #leading><component :is="iconFor('building-2')" :size="14" /></template>
          收款公司
        </Button>
        <Button variant="outline" size="sm" @click="payBookOpen = true">
          <template #leading><component :is="iconFor('credit-card')" :size="14" /></template>
          收款簿
        </Button>
        <Button variant="outline" size="sm" @click="coefOpen = true">
          <template #leading><component :is="iconFor('sliders-horizontal')" :size="14" /></template>
          系数簿
        </Button>
        <Button variant="outline" size="sm" :disabled="!rows.length || exportBusy" @click="expNoticeOpen = true">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出通知单
        </Button>
        <Button variant="outline" size="sm" :disabled="!rows.length || exportBusy" @click="expReconOpen = true">
          <template #leading><component :is="iconFor('table')" :size="14" /></template>
          导出对账表
        </Button>
        <Button v-if="canEdit" variant="outline" size="sm" :disabled="generating" @click="onGenerate">
          <template #leading><component :is="iconFor(rows.length ? 'refresh-cw' : 'play')" :size="14" /></template>
          {{ generating ? '生成中…' : rows.length ? '重新生成' : '生成本月' }}
        </Button>
      </div>
    </div>

    <!-- KPI 条(随当前期 tab 联动) -->
    <div class="bn-kpis">
      <FPStat label="户数" :value="String(kpis.count)" tint="blue" />
      <FPStat label="本期总额(元)" :value="fmt2(kpis.total)" tint="sky" sub="S5 起含租金板块" />
      <FPStat label="月租金合计(参考,元)" :value="fmt2(kpis.rent)" sub="整月口径,未含免租期/按天折" />
      <FPStat label="警告户数" :value="String(kpis.warned)" :sub="kpis.warned ? '悬停行尾「!」看原文' : undefined" />
    </div>

    <!-- 生成摘要轻提示(5s 自消) -->
    <div v-if="okMsg" class="bn-bar ok">
      <component :is="iconFor('check')" :size="14" />
      <span>{{ okMsg }}</span>
    </div>
    <!-- S21 stale 条:计费参数改过而本月催缴单批次没重生成(判据 spec §6.3);[去重算] 送到参数页(池 → 损耗 → 催缴单一起重算) -->
    <div v-if="staleMsg" class="bn-bar warn">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <span>{{ staleMsg }} —— 单上金额仍是改参前派生的,去计费参数页「重算本月」后生效(已确认 / 已导出的户照旧跳过)。</span>
      <Button variant="outline" size="sm" @click="gotoParams">
        <template #leading><component :is="iconFor('refresh-cw')" :size="14" /></template>
        去重算
      </Button>
    </div>
    <div v-if="rows.length === 0" class="bn-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月暂无催缴单。
        <template v-if="canEdit">点右上「生成本月」按当月读数、价目与公摊快照派生。</template>
        <template v-else>请管理员生成。</template>
      </span>
    </div>

    <!-- 筛选行:仅看有警告 + 租户搜索;批量模式下整条换成操作条(未设收款公司的户会在确认时提示不阻断) -->
    <div class="bn-toolbar" :class="{ bulk }">
      <template v-if="bulk">
        <span class="bn-selc">{{ selCount ? `已选 ${selCount} 户` : '勾选要确认的租户' }}</span>
        <span style="flex:1"></span>
        <button class="bn-bulkb" type="button" @click="toggleAll">
          {{ allChecked ? '取消全选' : `全选 ${filtered.length} 户` }}
        </button>
        <Button variant="primary" size="sm" :disabled="confirming || !selCount"
                @click="confirmTenants(filtered.filter(r => selected.has(r.tenantId)).map(r => r.tenantId))">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          {{ confirming ? '确认中…' : `确认选中${selCount ? ` ${selCount} 户` : '' }` }}
        </Button>
        <button class="bn-bulkb" type="button" title="退出批量模式" @click="exitBulk">
          <component :is="iconFor('x')" :size="14" /> 退出
        </button>
      </template>
      <template v-else>
        <label class="bn-chk">
          <input type="checkbox" v-model="warnOnly" />
          仅看有警告
        </label>
        <span style="flex:1"></span>
        <Button v-if="canEdit && filtered.length" variant="outline" size="sm" @click="bulkMode = true">
          <template #leading><component :is="iconFor('list-todo')" :size="14" /></template>
          批量确认
        </Button>
        <input v-model="q" class="bn-search" type="text" placeholder="搜租户名" />
      </template>
    </div>

    <!-- 一行一户(pl-table 手法:sticky 表头/34px 行/tfoot 钉底合计) -->
    <div class="bn-wrap">
      <table class="bn-table">
        <!-- table-layout:fixed ⇒ col 必须与列数逐一对齐,缺一个后面全体串位。
             S20 加「勾选/状态」两列时漏补,导致月租金列拿到 52px(表头「月租金(参考)」被截成「月租金(参」)。 -->
        <colgroup>
          <col v-if="bulk" style="width:36px" />
          <col style="width:220px" />
          <col /><!-- 位置:唯一弹性列 -->
          <col style="width:88px" />
          <col style="width:130px" />
          <col style="width:130px" />
          <col style="width:150px" /><!-- 状态:「部分确认」徽标 + 收款缺口橙点 + hover 出的确认按钮 -->
          <col style="width:52px" />
        </colgroup>
        <thead>
          <tr>
            <th v-if="bulk" class="ct bn-ckc"><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
            <th class="l">租户</th>
            <th class="l" title="该户全部单据场地去重合并,明细内按场地分段小计">位置</th>
            <th>行数</th>
            <th title="该户全部单据本期合计之和(租金+水电,含宿舍单);账外户降淡不入应收">本期合计(元)</th>
            <th title="该户当月在租合同月租之和;参考口径:整月,未含免租期/按天折">月租金(参考)</th>
            <th class="l" title="待核对→已确认→已导出(单向);橙点=该户有费用未指定收款公司(提示不阻断);已确认/已导出户重新生成自动跳过">状态</th>
            <th title="门禁告警:缺价/表未归属合同/费项未设收款公司/合计为负…各单去重合并,悬停「!」看原文">警告</th>
          </tr>
        </thead>
        <tbody>
          <!-- 楼栋分组:组头(楼栋名 · 户数 · 组内本期合计)+ 组内租户行;跨栋户只在主楼栋组出现一次 -->
          <template v-for="g in groups" :key="g.id ?? 'none'">
            <tr class="bn-band">
              <td class="l" :colspan="bulk ? 4 : 3">
                <span class="bn-band-lbl">{{ g.name }}</span><span class="bn-band-sub">{{ g.count }} 户</span>
              </td>
              <td><span class="bn-sumc">{{ fmt2(g.total) }}</span></td>
              <td :colspan="3"></td>
            </tr>
            <!-- 批量模式下整行点击=切勾选(已进入选择语境,再弹抽屉会打架);常态点击=开明细 -->
            <tr v-for="r in g.rows" :key="r.tenantId"
                :class="{ offbook: r.offbook, sel: bulk && selected.has(r.tenantId) }"
                @click="bulk ? toggleOne(r.tenantId) : openDetail(r)">
              <td v-if="bulk" class="ct bn-ckc" @click.stop>
                <input type="checkbox" :checked="selected.has(r.tenantId)" @change="toggleOne(r.tenantId)" />
              </td>
              <td class="l">
                <span class="bn-tname" :title="r.tenantName ?? undefined">{{ r.tenantName ?? '#' + r.tenantId
                  }}<em v-if="r.mark" class="bn-xb" :title="r.mark.tip">{{ r.mark.badge }}</em></span>
              </td>
              <td class="l"><span class="bn-txt dim" :title="r.premiseText ?? undefined">{{ r.premiseText || '–' }}</span></td>
              <td><span class="bn-nv">{{ r.lineCount }}</span></td>
              <td><span class="bn-sumc" :class="{ neg: r.totalAmount < 0 }">{{ fmt2(r.totalAmount) }}</span></td>
              <td><span class="bn-nv" :class="{ empty: r.rent == null }">{{ fmt2(r.rent) }}</span></td>
              <!-- S20 状态列:徽标 + 橙点(收款缺口) + hover 出确认按钮 -->
              <td class="l bn-stc">
                <span class="bn-st" :class="statusOf(r.tenantId)">{{ ST_LABEL[statusOf(r.tenantId)] }}</span>
                <span v-if="gapOf(r.tenantId)" class="bn-gapdot" title="该户有费用未指定收款公司(提示,不阻断导出)"></span>
                <button v-if="canEdit && !bulk && statusOf(r.tenantId) === 'draft'" class="bn-cfm" type="button"
                        :disabled="confirming" title="核对无误,确认该户" @click.stop="confirmTenants([r.tenantId])">确认</button>
              </td>
              <td class="ct"><span v-if="r.warn" class="bn-warn" :title="r.warn">!</span></td>
            </tr>
          </template>
          <tr v-if="filtered.length === 0">
            <td class="bn-noro" :colspan="bulk ? 8 : 7">
              {{ rows.length === 0 ? '本月尚未生成催缴单' : '本期无匹配租户 —— 换期页签或筛选条件试试' }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th v-if="bulk" class="bn-ckc"></th>
            <th class="l"><span class="bn-foot-lbl">合　计 · {{ filtered.length }} 户</span></th>
            <th></th>
            <th><span class="bn-foot-v">{{ footLines }}</span></th>
            <th><span class="bn-foot-v">{{ fmt2(footTotal) }}</span></th>
            <th><span class="bn-foot-v">{{ fmt2(footRent) }}</span></th>
            <th></th>
            <th></th>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 明细抽屉:户头 + 场地租金/水电费两 tab;底部只留关闭(签发/作废撤下,端点保留) -->
    <FPDrawer
      :open="dlgOpen"
      :title="dlgRow ? (dlgRow.tenantName ?? '#' + dlgRow.tenantId) : '催缴单明细'"
      :subtitle="drawerSub"
      icon="file-check-2"
      :full="true"
      @close="dlgOpen = false"
    >
      <div v-if="dlgLoading || !dlgRow" class="bn-empty">加载中…</div>
      <template v-else>
        <!-- 户头(警告=各单去重合并) -->
        <div v-if="dlgRow.warn" class="bn-bar warn">
          <component :is="iconFor('alert-triangle')" :size="14" />
          <span class="bn-warn-multi">{{ dlgRow.warn }}</span>
        </div>
        <div class="bn-hgrid">
          <div class="bn-hfld"><label>位置</label><span :class="{ dim: !dlgRow.premiseText }">{{ dlgRow.premiseText || '—' }}</span></div>
          <div class="bn-hfld"><label>本期合计</label><span class="mono">{{ fmt2(dlgRow.totalAmount) }} 元</span></div>
          <div class="bn-hfld"><label>月租金(参考)</label><span class="mono" :class="{ dim: dlgRow.rent == null }">{{ dlgRow.rent == null ? '–' : fmt2(dlgRow.rent) + ' 元' }}</span></div>
          <div class="bn-hfld"><label>上期欠费</label><span class="mono dim" title="催缴闭环接口点,S4 恒 0,待收款流水接入">{{ fmt2(dlgRow.prevDue) }} 元</span></div>
        </div>

        <!-- S20 收款方分段:按收款槽出方格(同槽多费项共用一家公司),多选后指定公司 -->
        <PaySlotGrid v-if="slotCells.length" :cells="slotCells" :companies="companies"
                     :can-edit="canEdit" :saving="slotSaving" @save="onSlotSave" />

        <Segmented :options="DLG_TABS" v-model="dlgTab" size="sm" />

        <!-- 场地租金 tab(S5 刀4):fee_group='rent' 落库行,一场地一块(厂房/办公室/宿舍逐间);
             面积列显「建筑+公摊」拆解,备注列显按天折算式/免租期扣减 -->
        <template v-if="dlgTab === 'rent'">
          <div v-if="rentG.groups.length === 0" class="bn-empty">本月无租金行 —— 重新生成后按合同条款派生</div>
          <div v-else class="bn-dwrap">
            <table class="bn-dtable">
              <colgroup>
                <col style="width:38px" />
                <col style="width:200px" />
                <col style="width:92px" />
                <col style="width:120px" />
                <col style="width:110px" />
                <col /><!-- 备注:唯一弹性列 -->
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th class="l">费项</th>
                  <th>单价</th>
                  <th title="行带建筑+公摊两格时显拆解(如 1528+458);按间计费显间数">面积/间数</th>
                  <th>金额(元)</th>
                  <th class="l" title="非整月按天折算式(如 1130÷31×26);免租期扣减">备注</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="g in rentG.groups" :key="g.label">
                  <tr class="bn-band">
                    <td :colspan="6" class="l"><span class="bn-band-lbl">{{ rentBandLabel(g) }}</span></td>
                  </tr>
                  <tr v-for="(l, i) in g.lines" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="l.feeKey">{{ rentFeeName(l.feeKey, g.type) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }">{{ fmt(l.priceSnap) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: l.qty == null }">{{ rentAreaText(l.qty, l.baseSnap) ?? '–' }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: l.amount < 0 }">{{ fmt2(l.amount) }}</span></td>
                    <!-- 备注:人工覆盖>引擎;hover 出铅笔(admin),小圆点=有覆盖(悬浮引擎原文,点击恢复) -->
                    <td class="l">
                      <div class="bn-notec">
                        <template v-if="noteEditKey === noteKeyId(lineNoteKey(l))">
                          <input v-model="noteDraft" class="bn-nin" :disabled="noteSaving" placeholder="备注(清空保存=恢复引擎备注)"
                            @keydown.enter.prevent="saveNoteEdit(lineNoteKey(l))" @keydown.esc.stop="noteEditKey = null" />
                          <button class="bn-nop ok" title="保存" :disabled="noteSaving" @click="saveNoteEdit(lineNoteKey(l))"><component :is="iconFor('check')" :size="14" /></button>
                          <button class="bn-nop" title="取消" :disabled="noteSaving" @click="noteEditKey = null"><component :is="iconFor('x')" :size="14" /></button>
                        </template>
                        <template v-else>
                          <span class="bn-txt dim" :title="noteCell(lineNoteKey(l), l.note).text || undefined">{{ noteCell(lineNoteKey(l), l.note).text }}</span>
                          <span v-if="noteCell(lineNoteKey(l), l.note).overridden" class="bn-ndot" :class="{ act: canEdit }" :title="noteDotTitle(l.note)" @click="restoreNote(lineNoteKey(l), l.note)"></span>
                          <button v-if="canEdit" class="bn-npen" title="编辑备注" @click="startNoteEdit(lineNoteKey(l), noteCell(lineNoteKey(l), l.note).text)"><component :is="iconFor('pencil')" :size="12" /></button>
                        </template>
                      </div>
                    </td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="4" class="l"><span class="bn-txt dim">小计 · {{ g.label }}</span></td>
                    <td><span class="bn-sumc">{{ fmt2(g.subtotal) }}</span></td>
                    <td></td>
                  </tr>
                </template>
              </tbody>
              <tfoot>
                <tr>
                  <th :colspan="4" class="l"><span class="bn-foot-lbl">租金板块合计</span></th>
                  <th><span class="bn-foot-v">{{ fmt2(rentG.total) }}</span></th>
                  <th></th>
                </tr>
              </tfoot>
            </table>
          </div>
        </template>

        <!-- 水电费 tab v3(可莱恩 worksheet 版式):非宿舍 电/水两部逐场地费块+维护费块 → 宿舍逐间子表 → 末行合计 -->
        <template v-else>
          <div class="bn-dwrap">
            <table class="bn-dtable">
              <colgroup>
                <col style="width:38px" />
                <col style="width:128px" /><!-- 费项:98px 会截「楼层公共、消防照明」(用户截图实证)——上一刀只数了逐表行的 6 字,漏了合并标签。
                     实际出现的标签清单(dev 库 bill_notice_line 非 rent 组 fee_key 全枚举 + MERGE_LABEL):
                       逐表行 电费(2)/水费(2)/装机容量费(5)/电力管理费(5)/水管网维护费(6)
                       合并行 电梯用电(4)/线路损耗(4)/路灯公摊(4)/绿化水公摊(5)/楼层公共、消防照明(9,「、」也是全角)
                     最长者=「楼层公共、消防照明」9 全角字。计算依据:font-size 12px、CJK 进距 1em ⇒ 9×12=108px,
                     加 td padding 0 8px 共 16px = 124px,取 128px 留 4px 字体余量。
                     备注(唯一弹性列)因此少 30px,1920 视口下仍不截:抽屉 min(1720px,96vw)=1720 − body padding 44 − 竖滚动条≈15
                     = 1661,减 bn-dwrap 边框 2 ⇒ 表宽 1659;定宽列合计 856 ⇒ 备注 803px。
                     主表最长备注「管理费基数=Σ段 18920.0000(总示数 18921.0000)」35 字 ≤ 35×12+16=436px,余量充足。 -->
                <col style="width:120px" />
                <col style="width:38px" />
                <col style="width:84px" />
                <col style="width:84px" />
                <col style="width:52px" />
                <col style="width:96px" /><!-- 用量:刀D 后带单位后缀「3,200 ㎡」「1,867.89 元」,84px 会截 -->
                <col style="width:92px" /><!-- 单价:最少可验算位数,大额行要显到 8 位「0.63586875」 -->
                <col style="width:94px" />
                <col /><!-- 备注:唯一弹性列 -->
                <col style="width:30px" />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th class="l">费项</th>
                  <th class="l">表</th>
                  <th class="l" title="分时段:尖/峰/平/谷">段</th>
                  <th>上月行至</th>
                  <th>本月行至</th>
                  <th>倍率</th>
                  <th title="乘数列:按面积摊的行显面积(㎡)、线路损耗显金额基数(元),其余显用量;
悬浮单元格看原度数。逐行 用量×单价=金额 可心算">用量</th>
                  <th title="按能验算的最少位数显示(0.0271 不会被压成 0.03);悬浮看落库原值。
消防/楼层照明/电梯的按面积摊行落库价是电价(元/度),等效元/㎡ 率没落库——此处显 金额÷面积,悬浮该格看说明">单价</th>
                  <th>金额(元)</th>
                  <th class="l">备注</th>
                  <th title="取价审计链:price_key/作用域/价目月/判定分支"></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(r0, i) in utilRows" :key="i">
                  <tr v-if="r0.t === 'band'" class="bn-band">
                    <td :colspan="12" class="l"><span class="bn-band-lbl">{{ r0.label }}</span></td>
                  </tr>
                  <tr v-else-if="r0.t === 'line'">
                    <td><span class="bn-nv dim">{{ r0.no }}</span></td>
                    <td class="l"><span class="bn-txt" :class="{ help: r0.l.feeKey.startsWith('share_') }" :title="billFeeTitle(r0.l)">{{ billFeeLabel(r0.l.feeKey) }}</span></td>
                    <td class="l"><span class="bn-txt" :class="{ dim: !r0.l.meterLabel }">{{ r0.l.meterLabel ?? '–' }}</span></td>
                    <td class="l"><span class="bn-txt">{{ segLabel(r0.l.seg) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.prevRead == null }">{{ fmt(r0.l.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.currRead == null }">{{ fmt(r0.l.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.factorSnap == null }">{{ fmt(r0.l.factorSnap) }}</span></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: r0.q.qty == null }" :title="r0.q.title ?? undefined">
                        {{ r0.q.unit === '元' ? fmt2(r0.q.qty) : fmt(r0.q.qty) }}<em v-if="r0.q.unit" class="bn-u">{{ r0.q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.priceSnap == null }" :title="r0.l.priceSnap != null ? String(r0.l.priceSnap) : undefined">{{ r0.q.price }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r0.l.amount < 0 }">{{ fmt2(r0.l.amount) }}</span></td>
                    <!-- 备注:人工覆盖>引擎;hover 出铅笔(admin),小圆点=有覆盖(悬浮引擎原文,点击恢复) -->
                    <td class="l">
                      <div class="bn-notec">
                        <template v-if="noteEditKey === noteKeyId(r0.nk)">
                          <input v-model="noteDraft" class="bn-nin" :disabled="noteSaving" placeholder="备注(清空保存=恢复引擎备注)"
                            @keydown.enter.prevent="saveNoteEdit(r0.nk)" @keydown.esc.stop="noteEditKey = null" />
                          <button class="bn-nop ok" title="保存" :disabled="noteSaving" @click="saveNoteEdit(r0.nk)"><component :is="iconFor('check')" :size="14" /></button>
                          <button class="bn-nop" title="取消" :disabled="noteSaving" @click="noteEditKey = null"><component :is="iconFor('x')" :size="14" /></button>
                        </template>
                        <template v-else>
                          <span class="bn-txt dim" :title="noteCell(r0.nk, r0.l.note).text || undefined">{{ noteCell(r0.nk, r0.l.note).text }}</span>
                          <span v-if="noteCell(r0.nk, r0.l.note).overridden" class="bn-ndot" :class="{ act: canEdit }" :title="noteDotTitle(r0.l.note)" @click="restoreNote(r0.nk, r0.l.note)"></span>
                          <button v-if="canEdit" class="bn-npen" title="编辑备注" @click="startNoteEdit(r0.nk, noteCell(r0.nk, r0.l.note).text)"><component :is="iconFor('pencil')" :size="12" /></button>
                        </template>
                      </div>
                    </td>
                    <td class="ct">
                      <span v-if="auditTitle(r0.l)" class="bn-info" :title="auditTitle(r0.l)!">
                        <component :is="iconFor('info')" :size="13" />
                      </span>
                    </td>
                  </tr>
                  <!-- 合并行(纸单口径:一项一行,多池/多表加总);表/段留 –,构成逐条在悬浮里(表格也挂,
                       用户找「哪几块表相加」时手会落在表列上) -->
                  <tr v-else-if="r0.t === 'merge'">
                    <td><span class="bn-nv dim">{{ r0.no }}</span></td>
                    <td class="l"><span class="bn-txt help" :title="r0.m.title">{{ r0.m.label }}</span></td>
                    <td class="l"><span class="bn-txt dim help" :title="r0.m.title">–</span></td>
                    <td class="l"><span class="bn-txt dim">–</span></td>
                    <td :colspan="3"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: r0.m.qty == null }">
                        {{ r0.m.qty == null ? '–' : r0.m.unit === '元' ? fmt2(r0.m.qty) : fmt(r0.m.qty)
                        }}<em v-if="r0.m.qty != null && r0.m.unit" class="bn-u">{{ r0.m.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: r0.m.price == null }">{{ r0.m.price ?? '–' }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r0.m.amount < 0 }">{{ fmt2(r0.m.amount) }}</span></td>
                    <!-- 合并行备注:键=feeKey+premise+'merged'(多池/多表合一行无单一 meter_id) -->
                    <td class="l">
                      <div class="bn-notec">
                        <template v-if="noteEditKey === noteKeyId(r0.nk)">
                          <input v-model="noteDraft" class="bn-nin" :disabled="noteSaving" placeholder="备注(清空保存=恢复引擎备注)"
                            @keydown.enter.prevent="saveNoteEdit(r0.nk)" @keydown.esc.stop="noteEditKey = null" />
                          <button class="bn-nop ok" title="保存" :disabled="noteSaving" @click="saveNoteEdit(r0.nk)"><component :is="iconFor('check')" :size="14" /></button>
                          <button class="bn-nop" title="取消" :disabled="noteSaving" @click="noteEditKey = null"><component :is="iconFor('x')" :size="14" /></button>
                        </template>
                        <template v-else>
                          <span class="bn-txt dim" :title="noteCell(r0.nk, r0.m.note).text || undefined">{{ noteCell(r0.nk, r0.m.note).text }}</span>
                          <span v-if="noteCell(r0.nk, r0.m.note).overridden" class="bn-ndot" :class="{ act: canEdit }" :title="noteDotTitle(r0.m.note)" @click="restoreNote(r0.nk, r0.m.note)"></span>
                          <button v-if="canEdit" class="bn-npen" title="编辑备注" @click="startNoteEdit(r0.nk, noteCell(r0.nk, r0.m.note).text)"><component :is="iconFor('pencil')" :size="12" /></button>
                        </template>
                      </div>
                    </td>
                    <td></td>
                  </tr>
                  <tr v-else :class="r0.t === 'part' ? 'bn-part' : 'bn-sub'">
                    <td :colspan="9" class="l">
                      <span :class="r0.t === 'part' ? 'bn-part-lbl' : 'bn-txt dim'">{{ r0.label }}</span>
                    </td>
                    <td><span class="bn-sumc">{{ fmt2(r0.amount) }}</span></td>
                    <td :colspan="2"></td>
                  </tr>
                </template>
                <tr v-if="utilRows.length === 0 && dormLines.length === 0">
                  <td :colspan="12" class="bn-noro">本单无水电行</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 宿舍子表(该户有 dorm 单才出):电=逐间宽行(电表+管理费+路灯分摊),水=水表+绿化水公摊 -->
          <template v-if="dormLines.length">
            <div class="bn-dsec">宿舍水电费(逐间)</div>
            <div class="bn-dwrap">
              <table class="bn-dtable">
                <colgroup>
                  <col style="width:38px" />
                  <col /><!-- 房号:唯一弹性列 -->
                  <col style="width:76px" />
                  <col style="width:90px" />
                  <col style="width:90px" />
                  <col style="width:92px" /><!-- 用量:extras 行带单位后缀「5,214.64 ㎡」,76px 会截 -->
                  <col style="width:102px" /><!-- 基准电价:补位到能验平,实测最长 10 字符「0.63586875」(宿舍楼四座338室/保障房2·3号楼),90px 会截 -->
                  <col style="width:74px" />
                  <col style="width:94px" />
                  <col style="width:84px" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="l">房号</th>
                    <th title="路灯/绿化水分摊行的面积基数快照">租赁面积</th>
                    <th>上月行至</th>
                    <th>本月行至</th>
                    <th>用量</th>
                    <th title="按能验算的最少位数显示;悬浮看落库原值">基准电价</th>
                    <th title="电力管理费单价">管理费</th>
                    <th title="金额=用量×基准电价 + 用量×管理费,两段各自四舍五入到分后相加(引擎逐行落库口径,
不是用量×两价之和——合并会差 1 分)">金额(元)</th>
                    <th title="面积×公摊单价,悬浮该格看算式">路灯分摊</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="({ r: r1, c }, i) in dormElecRows" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="r1.room">{{ r1.room }}{{ r1.main.seg ? '·' + segLabel(r1.main.seg) : '' }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.area == null }">{{ fmt(r1.area) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }" :title="r1.main.priceSnap != null ? `落库原值 ${r1.main.priceSnap};电费段 ${fmt2(r1.main.amount)} 元` : undefined">{{ c.price }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.mgmt == null }" :title="r1.mgmt ? `落库原值 ${r1.mgmt.priceSnap};管理费段 ${fmt2(r1.mgmt.amount)} 元` : undefined">{{ c.mgmt }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }" :title="shareTitle(r1.share)">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                  </tr>
                  <!-- 配不上间的公摊/损耗行平铺兜底(现状:路灯一行整段/损耗行);乘数与单价照铺,同样逐行可验 -->
                  <tr v-for="({ l, q }, i) in dormElecExtras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :class="{ help: l.feeKey.startsWith('share_') }" :title="billFeeTitle(l)">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="3"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: q.qty == null }" :title="q.title ?? undefined">
                        {{ q.unit === '元' ? fmt2(q.qty) : fmt(q.qty) }}<em v-if="q.unit" class="bn-u">{{ q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }" :title="l.priceSnap != null ? String(l.priceSnap) : undefined">{{ q.price }}</span></td>
                    <td></td>
                    <td><span class="bn-sumc">{{ fmt2(l.amount) }}</span></td>
                    <td></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="9" class="l"><span class="bn-txt dim">宿舍电费小计</span></td>
                    <td><span class="bn-sumc">{{ fmt2(dorm.elec.total) }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="bn-dwrap">
              <table class="bn-dtable">
                <colgroup>
                  <col style="width:38px" />
                  <col /><!-- 房号:唯一弹性列 -->
                  <col style="width:90px" />
                  <col style="width:90px" />
                  <col style="width:92px" /><!-- 用量:extras 行带单位后缀「5,214.64 ㎡」,76px 会截 -->
                  <col style="width:90px" />
                  <col style="width:94px" />
                  <col style="width:94px" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="l">房号</th>
                    <th>上月行至</th>
                    <th>本月行至</th>
                    <th>用量</th>
                    <th title="按能验算的最少位数显示;悬浮看落库原值">单价</th>
                    <th title="金额=用量×单价(四舍五入到分)">金额(元)</th>
                    <th title="面积×公摊单价,悬浮该格看算式">绿化水公摊</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="({ r: r1, c }, i) in dormWaterRows" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="r1.room">{{ r1.room }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }" :title="r1.main.priceSnap != null ? String(r1.main.priceSnap) : undefined">{{ c.price }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }" :title="shareTitle(r1.share)">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                  </tr>
                  <tr v-for="({ l, q }, i) in dormWaterExtras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :class="{ help: l.feeKey.startsWith('share_') }" :title="billFeeTitle(l)">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="2"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: q.qty == null }" :title="q.title ?? undefined">
                        {{ q.unit === '元' ? fmt2(q.qty) : fmt(q.qty) }}<em v-if="q.unit" class="bn-u">{{ q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }" :title="l.priceSnap != null ? String(l.priceSnap) : undefined">{{ q.price }}</span></td>
                    <td><span class="bn-sumc">{{ fmt2(l.amount) }}</span></td>
                    <td></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="7" class="l"><span class="bn-txt dim">宿舍水费小计</span></td>
                    <td><span class="bn-sumc">{{ fmt2(dorm.water.total) }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="bn-grand">
              <span>宿舍水电费、水电维护费合计</span>
              <span class="bn-foot-v">{{ fmt2(dorm.total) }}</span>
            </div>
          </template>

          <div class="bn-grand strong">
            <span>水电费、维护费合计</span>
            <span class="bn-foot-v">{{ fmt2(utilGrand) }}</span>
          </div>
        </template>
      </template>

      <template #footer>
        <!-- 单户导出:与「导出通知单」窗口同一套版式(上表租金/下表水电),账户取该公司默认账户 -->
        <Button variant="outline" size="sm" :disabled="dlgLoading || cardBusy || !dlgRow"
                title="导出本户 Excel:一个文件,上表场地租金、下表水电费;跨收款公司按 sheet 分。账户取各公司的默认收款账户"
                @click="onExportTenant">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          {{ cardBusy ? '导出中…' : '导出本户 Excel' }}
        </Button>
        <Button variant="outline" size="sm" @click="dlgOpen = false">关闭</Button>
      </template>
    </FPDrawer>

    <!-- 系数簿窗口(S14):合同/楼栋/年清单与本页同源,生效月默认=当前账期 -->
    <CoefBookWindow :open="coefOpen" :ym="ym" :phase="phase" :contracts="contracts"
                    :buildings="buildings" :years="dataYears" @close="coefOpen = false" />

    <!-- S20 交付链四窗口:收款公司 / 收款簿 / 导出通知单 / 导出对账表 -->
    <CompanyBookWindow :open="companyOpen" @close="companyOpen = false" @saved="loadCompanies" />
    <PayBookWindow :open="payBookOpen" :ym="ym" :phase="phase" :notices="rows"
                   :contracts="contracts" :buildings="buildings"
                   @close="payBookOpen = false" @saved="loadPayMap(); loadMonth()" />
    <ExportNoticeWindow :open="expNoticeOpen" :ym="ym" :phase="phase" :notices="rows"
                        :contracts="contracts" :buildings="buildings"
                        :busy="exportBusy" :result="exportResult"
                        @close="expNoticeOpen = false" @export="onExportNotice" />
    <ExportReconWindow :open="expReconOpen" :ym="ym" :notices="rows" :busy="exportBusy"
                       @close="expReconOpen = false" @export="onExportRecon" />
  </div>
</template>

<style scoped>
.bn-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(pl-head 家族) */
.bn-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.bn-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.bn-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* KPI 条 */
.bn-kpis { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; }

/* 提示条(pl-bar 家族) */
.bn-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); flex-wrap: wrap; }
.bn-bar.warn { border-color: var(--hue-orange); background: rgb(255, 250, 235); color: rgb(138, 97, 0); }
.bn-bar.ok { border-style: solid; border-color: var(--hue-green); background: rgb(240, 251, 244); color: rgb(21, 108, 60); }
/* 各单 warn 换行合并后逐行显示 */
.bn-warn-multi { white-space: pre-line; }

/* 筛选行;批量模式下整条改蓝底操作条(视觉上宣告"你在选择态",退出即恢复) */
.bn-toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-toolbar.bulk { padding: 7px 12px; border-radius: var(--radius-md); background: rgb(238, 244, 255); border: 1px solid rgb(206, 223, 252); }
.bn-toolbar.bulk .bn-selc { color: var(--accent); }
.bn-bulkb { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.bn-bulkb:hover { border-color: var(--accent); color: var(--accent); }
.bn-chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.bn-chk input { accent-color: var(--hue-blue); }
.bn-search { width: 230px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.bn-search:focus { outline: none; border-color: var(--hue-blue); }

/* ── 列表宽表(pl-table/FPLedgerTable 手法:sticky 表头/34px 行/tfoot 钉底) ── */
.bn-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.bn-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.bn-table th, .bn-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.bn-table thead th { position: sticky; top: 0; height: 34px; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: right; z-index: 4; white-space: nowrap; }
.bn-table thead th.l, .bn-table td.l { text-align: left; }
.bn-table td.ct { text-align: center; }
.bn-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; text-align: right; cursor: pointer; }
.bn-table tbody tr:hover td { background: var(--surface-card); }
/* 批量模式选中行(整行点击即切勾选,需要一眼能扫出选了哪些) */
.bn-table tbody tr.sel td, .bn-table tbody tr.sel:hover td { background: rgb(238, 244, 255); }
/* 账外户视觉降淡(出单不入应收) */
.bn-table tbody tr.offbook { opacity: .55; }
.bn-table tbody tr:last-child td { cursor: default; }
/* 楼栋分组头(抽屉 bn-band 同款;34px 行高铁律照旧,组小计对齐「本期合计」列) */
.bn-table tr.bn-band td, .bn-table tbody tr.bn-band:hover td { height: 34px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); cursor: default; }
/* 跨楼栋轻标记(悬浮列全部楼栋) */
.bn-xb { margin-left: 6px; padding: 1px 5px; border-radius: var(--radius-full); background: var(--surface-sunken); font-style: normal; font-size: 10.5px; color: var(--text-muted); cursor: help; }
.bn-xb:hover { color: var(--hue-blue); }
.bn-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); cursor: default !important; }
.bn-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); text-align: right; }
.bn-table tfoot th.l { text-align: left; }
.bn-foot-lbl { display: block; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.bn-foot-v { display: block; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }

/* 单元格家族(pl 同款) */
.bn-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt.dim { color: var(--text-muted); }
/* 公摊费项名可悬浮看来源(同 .bn-info 手法:cursor:help + hover 变蓝) */
.bn-txt.help { cursor: help; }
.bn-txt.help:hover { color: var(--hue-blue); }
.bn-nv { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-nv.empty, .bn-nv.dim { color: var(--text-disabled); }
.bn-u { font-style: normal; font-size: 10px; color: var(--text-disabled); margin-left: 2px; }   /* 刀D 乘数单位后缀 */
.bn-sumc { display: block; text-align: right; font-weight: var(--fw-semibold); color: var(--hue-blue); font-size: 12px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bn-sumc.neg { color: var(--hue-red); }

/* 警告角标(悬停显原文) */
/* S20 交付链:勾选列/状态徽标/收款缺口橙点/行内确认按钮 */
.bn-ckc { width: 34px; }
.bn-ckc input { width: 15px; height: 15px; accent-color: var(--accent); vertical-align: -2px; }
.bn-selc { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-secondary); }
.bn-stc { white-space: nowrap; }
.bn-st { display: inline-block; padding: 1px 9px; border-radius: var(--radius-full); font-size: 11.5px; font-weight: var(--fw-semibold); }
.bn-st.draft { background: var(--surface-sunken); color: var(--text-tertiary); }
.bn-st.confirmed { background: rgb(230, 239, 255); color: var(--accent); }
.bn-st.exported { background: rgb(220, 242, 227); color: rgb(17, 99, 41); }
.bn-st.partial { background: rgb(255, 242, 207); color: rgb(125, 92, 0); }
.bn-gapdot { display: inline-block; width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--hue-orange, #e8912d); margin-left: 5px; vertical-align: 1px; cursor: help; }
.bn-cfm { visibility: hidden; margin-left: 8px; border: 1px solid var(--border); background: var(--surface-card); border-radius: var(--radius-sm); padding: 1px 8px; font-size: 11.5px; color: var(--text-secondary); cursor: pointer; }
.bn-cfm:hover { border-color: var(--accent); color: var(--accent); }
tbody tr:hover .bn-cfm { visibility: visible; }
.bn-warn { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: var(--radius-full); background: rgb(255, 238, 237); color: var(--hue-red); font-size: 11px; font-weight: var(--fw-semibold); cursor: help; }

/* ── 抽屉:户头 + 两 tab 明细行表(md-htable 家族) ── */
.bn-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.bn-hgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 18px; margin-bottom: 12px; }
.bn-hfld { min-width: 0; }
.bn-hfld label { display: block; margin-bottom: 4px; font-size: var(--fs-label); color: var(--text-muted); }
.bn-hfld span { font-size: var(--fs-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.bn-hfld .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.bn-hfld .dim, .bn-hfld .mono.dim { color: var(--text-disabled); }
.bn-bar.warn + .bn-hgrid { margin-top: 12px; }

/* flex:0 0 auto——fp-dwr-body 是定高 flex 列,不禁 shrink 各表会被等比压扁出内部滚动条(2026-08-05 报障);
   整卡只留 body 一条滚动,overflow:auto 仅兜横向 */
.bn-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: auto; flex: 0 0 auto; }
.bn-bar, .bn-hgrid, .bn-dsec, .bn-grand { flex-shrink: 0; }
.bn-dtable { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 12px; white-space: nowrap; }
.bn-dtable th, .bn-dtable td { box-sizing: border-box; padding: 0 8px; border-bottom: 1px solid var(--divider); overflow: hidden; text-overflow: ellipsis; }
.bn-dtable thead th { position: sticky; top: 0; z-index: 2; height: 30px; text-align: right; font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); }
.bn-dtable thead th.l, .bn-dtable td.l { text-align: left; }
.bn-dtable td.ct { text-align: center; }
.bn-dtable tbody td { height: 30px; text-align: right; background: var(--surface-white); vertical-align: middle; }
.bn-dtable tbody tr:last-child td { border-bottom: none; }
/* 分带(pl-band 轻量版;水电=premise 段,租金=合同带)与小计行 */
.bn-dtable tr.bn-band td { height: 30px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.bn-band-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-band-sub { margin-left: 8px; font-size: 11.5px; color: var(--text-muted); }
.bn-dtable tr.bn-sub td { background: var(--surface-card); }
/* 部合计行(电费、用电维护费合计/水费、用水维护费合计)比块小计重一档 */
.bn-dtable tr.bn-part td { background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.bn-part-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
/* 宿舍子表节标题 + 合计横条(宿舍段合计/末行全户合计) */
.bn-dsec { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); margin-bottom: -6px; }
.bn-grand { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); font-size: 12.5px; color: var(--text-primary); }
.bn-grand.strong { background: var(--surface-sunken); border-color: var(--border-strong); font-weight: var(--fw-semibold); }
.bn-grand .bn-foot-v { font-size: 12.5px; }
.bn-dtable tfoot th { position: sticky; bottom: 0; height: 34px; background: var(--surface-white); border-top: 2px solid var(--border-strong); text-align: right; font-family: var(--font-mono); }
.bn-dtable tfoot th.l { text-align: left; }
/* 审计链 info 图标 */
.bn-info { display: inline-grid; place-items: center; color: var(--text-disabled); cursor: help; }
.bn-info:hover { color: var(--hue-blue); }

/* ── 备注人工覆盖(V92):hover 出铅笔;小圆点=有覆盖(悬浮引擎原文,admin 点击恢复) ── */
.bn-notec { display: flex; align-items: center; gap: 4px; min-width: 0; }
.bn-notec .bn-txt { flex: 1 1 auto; min-width: 0; }
.bn-ndot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--hue-blue); cursor: help; }
.bn-ndot.act { cursor: pointer; }
/* 铅笔入口:hover 该行才显现(admin);占位不塌行 */
.bn-npen { flex: 0 0 auto; display: inline-grid; place-items: center; width: 20px; height: 20px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; padding: 0; visibility: hidden; }
.bn-dtable tbody tr:hover .bn-npen { visibility: visible; }
.bn-npen:hover { background: var(--surface-sunken); color: var(--hue-blue); }
/* 行内输入(静默融入单元格,同 .ec-in/.md-din 家族)+ 保存/取消小按钮 */
.bn-nin { flex: 1 1 auto; min-width: 0; box-sizing: border-box; height: 24px; padding: 0 6px; border: 1px solid var(--hue-blue); border-radius: var(--radius-sm); background: var(--surface-white); font-size: 12px; color: var(--text-primary); }
.bn-nin:focus { outline: none; }
.bn-nin::placeholder { color: var(--text-disabled); }
.bn-nop { flex: 0 0 auto; display: inline-grid; place-items: center; width: 20px; height: 20px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; padding: 0; }
.bn-nop:hover { background: var(--surface-sunken); color: var(--text-primary); }
.bn-nop.ok { color: var(--hue-green); }
.bn-nop:disabled { opacity: .5; cursor: default; }
</style>
