<script setup lang="ts">
// 公共电核算(POOL-ENGINE-SPEC §6,S3-B1 刀2)— 承接 /alloc 路由。FPLedgerTable 手法
// (MeterLedgerGrid 同款:双级表头/sticky 首列/34px 行/mono 空值'–'/tfoot 钉底/分组分隔带§7.6);
// 行数≤70 不虚拟滚动。rows=全部池(config)左连当月快照;无快照月 generated=false 数值列'–'。
// 编辑态(EDIT-MODE-SPEC v2):池配置抽屉(FPDrawer,迁自旧 AllocView 规则弹窗)+月度参数行内编辑
// (coefficient/extra_qty → PUT /cfg scope=rule:{id} 月行,commitAdj 模式)→ 改完提示重新生成。
// V69(用户 2026-07-30 拍板):池=楼栋+楼层+侧向+费项四级定位,池名自动生成不手写;组成电表与受益人
// 一律勾选(候选来自 /pool-candidates,标签用位置不用内部标识);
// 顶部 /member-diff 提醒条=本月在租租户与池受益人的差集。
// 刀3(用户 2026-07-30 报障):①分带只按楼栋(四级分带带头比数据行还多),楼层+方位与费项名各自成列;
// ②「已分摊/盈亏」正名为「摊出/差额」——引擎按受益人正向试算的摊出额,不是账册 AE(从账单侧拉回的实收)
// 与 AF(实收−应分摊);实收/盈亏另立两列恒'–',待 bill_notice 落地回填(POOL-ENGINE-SPEC §6.1)。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import {
  allocApi,
  type AllocCandidatesDTO, type AllocFeeKey, type AllocInForce, type AllocLinkType, type AllocMemberDiffDTO,
  type AllocMethod, type AllocPoolRowDTO,
  type AllocPoolsDTO, type AllocCfgDTO, type AllocRuleDTO, type AllocStdKind, type AllocZone,
} from '@/api/alloc'
import { metersApi, type MeterDTO } from '@/api/meters'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { ALLOC_FEE_KEYS, ALLOC_FEE_LABEL } from '@/utils/allocLogic'
import { buildYearOptions } from '@/utils/yearGate'
import {
  POOL_ZONE_LABEL, buildPoolExportAoa, gapClass, groupPoolsByBuilding, poolAutoName,
  poolFeeLabel, poolFloorSide, poolFooter, poolSemantics, stdDisplay,
} from '@/utils/poolLedgerLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话;KeepAlive 切页签回来也回浏览态 ──
const editMode = ref(false)
onDeactivated(() => { editMode.value = false; poolDlg.value = false })

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmt2 = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 账期(年数据驱动)+ zone Segmented(一期/二期/宿舍,无全部;一级页签不参与重置) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)
const zone = ref<string>('p1')
const ZONE_OPTS = [
  { value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }, { value: 'dorm', label: '宿舍' },
]

// ── 数据(竞态守卫:快速切年月只接受最新一次请求) ──
const pools = ref<AllocPoolsDTO | null>(null)
const cfgs = ref<AllocCfgDTO[]>([])
const rules = ref<AllocRuleDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const meters = ref<MeterDTO[]>([])
const diffs = ref<AllocMemberDiffDTO[]>([])
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [ps, cs, df] = await Promise.all([
    allocApi.pools(ym.value),
    allocApi.cfg(ym.value).catch(() => [] as AllocCfgDTO[]),
    allocApi.memberDiff(ym.value).catch(() => [] as AllocMemberDiffDTO[]),
  ])
  if (my !== seq) return
  pools.value = ps; cfgs.value = cs; diffs.value = df
}
async function loadRules() { rules.value = await allocApi.rules() }
onMounted(async () => {
  loadRules().catch(() => {})
  buildingApi.list().then(bs => { buildings.value = bs }).catch(() => {})
  metersApi.list('elec').then(ms => { meters.value = ms }).catch(() => {})
  try {
    dataYears.value = await allocApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // watch 触发 loadMonth
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month], loadMonth)

const ruleById = computed(() => new Map(rules.value.map(r => [r.id, r])))
const buildingOpts = computed(() => [{ value: '', label: '(园区级,不挂楼栋)' },
  ...buildings.value.map(b => ({ value: String(b.id), label: b.name }))])

// ── 分带表体(刀3):只按楼栋分带(园区级在前),楼层·方位成列;tfoot 合计(ref 行不计) ──
const bands = computed(() => groupPoolsByBuilding(pools.value?.rows ?? [], zone.value))
const foot = computed(() => poolFooter(bands.value))
const generated = computed(() => pools.value?.generated ?? false)

// ── 受益人变动提醒条:只提示本 zone 的池;点池名进配置面板定位 ──
const zoneRuleIds = computed(() =>
  new Set((pools.value?.rows ?? []).filter(r => r.zone === zone.value).map(r => r.ruleId)))
const zoneDiffs = computed(() => diffs.value.filter(d => zoneRuleIds.value.has(d.ruleId)))
const diffOpen = ref(false)
const rowById = computed(() => new Map((pools.value?.rows ?? []).map(r => [r.ruleId, r])))
function gotoDiff(ruleId: number) {
  const r = rowById.value.get(ruleId)
  if (!r || !canEdit.value) return
  editMode.value = true
  openPoolDlg(r)
}

// 列模型:p2 分时 5 列(总/尖/峰/平/谷),p1/dorm 只显总列
interface SegDef { lab: string; k: 'qtyTotal' | 'qtySharp' | 'qtyPeak' | 'qtyFlat' | 'qtyValley' }
const ALL_SEGS: SegDef[] = [
  { lab: '总', k: 'qtyTotal' }, { lab: '尖', k: 'qtySharp' }, { lab: '峰', k: 'qtyPeak' },
  { lab: '平', k: 'qtyFlat' }, { lab: '谷', k: 'qtyValley' },
]
const segDefs = computed(() => (zone.value === 'p2' ? ALL_SEGS : ALL_SEGS.slice(0, 1)))
// 楼层·方位+池名称+表构成(3) + 用量段 + 应分摊/语义/标准(3) + 编辑态月参(2) + 摊出/差额/实收/盈亏/备注(5)
const colCount = computed(() => 3 + segDefs.value.length + 3 + (editMode.value ? 2 : 0) + 5)

// sticky 左两列(FPLedgerTable 手法:offset=列宽累加)
const FLOOR_W = 96
const NAME_W = 150
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
const fixFloor = { ...w(FLOOR_W), left: '0px' }
const fixName = { ...w(NAME_W), left: FLOOR_W + 'px', borderRight: '1px solid var(--border-subtle)' }
const fixBand = { left: '0px', borderRight: '1px solid var(--border-subtle)' }

// ── 生成本月/重新生成(编辑态;POST generate 后刷新) ──
const cfgDirty = ref(false)   // 池配置/月度参数改动后提示「配置已变,请重新生成」
const generating = ref(false)
async function onGenerate() {
  if (generating.value) return
  if (generated.value && !confirm(`重新生成 ${ym.value}:按月先删后插覆盖池/损耗快照。读数或配置已变时数字将按当前数据重算。确认?`)) return
  generating.value = true
  try {
    await allocApi.generate(ym.value)
    cfgDirty.value = false
    await loadMonth()
  } catch (e) { alert(errMsg(e, '生成失败')) } finally { generating.value = false }
}

// ── 导出当月(纯函数 buildPoolExportAoa) ──
async function onExport() {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const aoa = buildPoolExportAoa(bands.value, ym.value, POOL_ZONE_LABEL[zone.value])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '公共电核算')
  XLSX.writeFile(wb, `公共电核算-${ym.value}-${POOL_ZONE_LABEL[zone.value]}.xlsx`)
}

// ── 月度参数行内编辑(编辑态两列):rule:{id} 月行 coefficient/extra_qty,commitAdj 模式 ──
const cfgRaw = (scope: string, key: string) =>
  cfgs.value.find(c => c.scope === scope && c.cfgKey === key && c.acctMonth === ym.value)
function commitRuleCfg(ruleId: number, key: 'coefficient' | 'extra_qty', raw: string) {
  const t = raw.trim()
  const v = t === '' ? null : Number(t)
  if (v != null && !isFinite(v)) { alert('请输入数字'); return }
  allocApi.saveCfg({ scope: `rule:${ruleId}`, cfgKey: key, acctMonth: ym.value, value: v })
    .then(() => { cfgDirty.value = true; loadMonth() })
    .catch(e => alert(errMsg(e, '保存失败，请重试')))
}

// ── 池配置抽屉(V69 勾选式):四级定位→池名自动生成;组成电表/受益人按定位候选勾选 ──
const poolDlg = ref(false)
const poolErr = ref('')
const saving = ref(false)
interface PoolForm {
  id: number | null; zone: AllocZone
  buildingId: number | null; floorLabel: string; side: string; feeName: string
  method: AllocMethod; feeKey: AllocFeeKey; coefficient: string; extraQty: string; note: string
  roundScale: number; stdKind: '' | AllocStdKind; baseKey: string
  meters: { meterId: number; sign: number; label: string }[]
  links: { ruleId: string; type: AllocLinkType }[]
  members: { tenantId: number; tenantName: string; unitNo: string | null; weight: number | null; inForce: AllocInForce }[]
  monthOnly: boolean                  // 受益人只改本月(写 acct_month 月行,不动历史与默认行)
  oldName: string                     // 存量池名(定位三项全空时后端保留原名,此处照实展示)
}
const form = ref<PoolForm>(emptyForm())
function emptyForm(): PoolForm {
  return { id: null, zone: zone.value as AllocZone, buildingId: null, floorLabel: '', side: '', feeName: '',
    method: 'floor', feeKey: 'share_elec_floor', coefficient: '', extraQty: '', note: '',
    roundScale: 2, stdKind: '', baseKey: '', meters: [], links: [], members: [], monthOnly: false,
    oldName: '' }
}
// 分摊方式(草图四档);ref/loss 只在该池本来就是时才露出,免把存量纯标准行误改
const METHOD_TEXT: Record<AllocMethod, string> = {
  area: '按面积', floor: '按层份', direct: '户对户', none: '园区自担',
  loss: '并入损耗', ref: '纯标准行',
}
const METHOD_HINT: Record<AllocMethod, string> = {
  area: '按受益户租赁面积摊(基数=Σ㎡)', floor: '按层份摊(基数=层数,可小数)',
  direct: '整笔给唯一受益户', none: '不摊给租户,全额挂园区亏',
  loss: '并入损耗链', ref: '只出分摊标准供别池折入,不出应分摊',
}
const methodRadios = computed(() => {
  const base: AllocMethod[] = ['area', 'floor', 'direct', 'none']
  return (base.includes(form.value.method) ? base : [...base, form.value.method])
    .map(k => ({ value: k, label: METHOD_TEXT[k], hint: METHOD_HINT[k] }))
})
const FEE_OPTS = ([...ALLOC_FEE_KEYS, 'park_loss_pool'] as AllocFeeKey[])
  .map(k => ({ value: k, label: ALLOC_FEE_LABEL[k] }))
// 楼层/侧向/费项候选:静态常用值 ∪ 库里已有值(不建配置表)
// ponytail: 楼层清单写死够用,真要按楼栋取实际楼层再接 /units
const FLOOR_BASE = ['负一层', '一楼', '二楼', '三楼', '四楼', '五楼', '六楼', '七楼', '八楼', '九楼', '十楼', '天面']
const SIDE_BASE = ['东侧', '西侧', '南侧', '北侧', '中间']
const FEENAME_BASE = ['消防', '走廊灯', '楼层照明', '货梯', '电梯', '路灯', '公共电', '水泵', '空调', '绿化水']
const uniq = (base: string[], from: (string | null)[]) =>
  [...new Set([...base, ...from.filter((s): s is string => !!s && s.trim() !== '')])]
const floorOpts = computed(() => [{ value: '', label: '(整栋,不分层)' },
  ...uniq(FLOOR_BASE, (pools.value?.rows ?? []).map(r => r.floorLabel)).map(f => ({ value: f, label: f }))])
const sideOpts = computed(() => [{ value: '', label: '(整层,不分侧)' },
  ...uniq(SIDE_BASE, (pools.value?.rows ?? []).map(r => r.side)).map(s => ({ value: s, label: s }))])
const feeNameOpts = computed(() => uniq(FEENAME_BASE, (pools.value?.rows ?? []).map(r => r.feeName)))
const buildingNameOf = (id: number | null) =>
  id == null ? null : (buildings.value.find(b => b.id === id)?.name ?? null)
// 池名只读展示(后端保存时按同规则覆盖 name)
const formAutoName = computed(() => poolAutoName(
  zone.value, buildingNameOf(form.value.buildingId), form.value.floorLabel, form.value.side, form.value.feeName))
// 存量池(定位三项全空)后端保留原名不改 —— 与 AllocService.poolName 的唯一例外对齐
const keepsOldName = computed(() => form.value.id != null && form.value.oldName !== ''
  && !form.value.floorLabel.trim() && !form.value.side.trim() && !form.value.feeName.trim())
const formDiff = computed(() => diffs.value.find(d => d.ruleId === form.value.id))
// 缺起止日期的受益人:判不了在租 → 不进 member-diff 的 removed,单列一条提醒催补日期
const formNoDate = computed(() => form.value.members.filter(m => m.inForce === 'unknown'))
// 园区级池不勾人=后端按该期全园在租名册自动摊(与 AllocService.autoMembers 同口径)
const formAutoMembers = computed(() => form.value.buildingId == null && form.value.members.length === 0
  && (form.value.method === 'area' || form.value.method === 'floor'))
const ROUND_OPTS = [{ value: '2', label: 'ROUND 2 位' }, { value: '3', label: 'ROUND 3 位' }]
const STD_OPTS = [
  { value: '', label: '按 zone 默认' },
  { value: 'amount_over_base', label: '金额/基数(p2 默认)' },
  { value: 'qty_price_over_base', label: '(量+加度)/基数×价(p1/宿舍默认)' },
  { value: 'qty_over_base', label: '量/基数(广告字档)' },
]
const LINK_TYPE_OPTS = [
  { value: 'fold_price', label: '折入标准(fold_price)' },
  { value: 'fold_qty', label: '折入度数(fold_qty)' },
]
const linkRuleOpts = computed(() =>
  rules.value.filter(r => r.id !== form.value.id).map(r => ({ value: String(r.id), label: r.name })))

function openPoolDlg(r?: AllocPoolRowDTO) {
  poolErr.value = ''
  if (r) {
    const rule = ruleById.value.get(r.ruleId)
    form.value = {
      id: r.ruleId, zone: r.zone, buildingId: r.buildingId,
      floorLabel: r.floorLabel ?? '', side: r.side ?? '', feeName: r.feeName ?? '',
      method: r.method, feeKey: rule?.feeKey ?? 'share_elec_floor',
      coefficient: rule?.coefficient != null ? String(rule.coefficient) : '',
      extraQty: rule?.extraQty ? String(rule.extraQty) : '', note: r.note ?? '',
      roundScale: r.roundScale, stdKind: r.stdKind ?? '', baseKey: r.baseKey ?? '',
      meters: r.meters.map(m => ({ meterId: m.meterId, sign: m.sign, label: m.label ?? m.name })),
      links: r.links.map(l => ({ ruleId: String(l.ruleId), type: l.type })),
      members: r.members.map(m => ({ tenantId: m.tenantId, tenantName: m.tenantName ?? `#${m.tenantId}`,
        unitNo: m.unitNo, weight: m.weight, inForce: m.inForce })),
      monthOnly: r.members.some(m => m.src === 'month'),
      oldName: r.name,
    }
  } else form.value = emptyForm()
  otherOpen.value = false; otherQ.value = ''
  poolDlg.value = true
  loadCands()
}

// ── 组成候选(/pool-candidates,按定位过滤):定位一改就重取;新增池预勾(infra 除外) ──
const cands = ref<AllocCandidatesDTO>({ meters: [], tenants: [] })
const candLoading = ref(false)
let candSeq = 0
async function loadCands() {
  const my = ++candSeq
  candLoading.value = true
  try {
    const c = await allocApi.poolCandidates(ym.value, form.value.buildingId,
      form.value.floorLabel || null, form.value.side || null)
    if (my !== candSeq) return
    cands.value = c
    if (form.value.id == null) {          // 新增池:非 infra 表 + 该定位在租租户预勾
      form.value.meters = c.meters.filter(m => m.ownership !== 'infra')
        .map(m => ({ meterId: m.meterId, sign: 1, label: m.label }))
      form.value.members = c.tenants.filter(t => t.preChecked !== false)
        .map(t => ({ tenantId: t.tenantId, tenantName: t.tenantName ?? `#${t.tenantId}`,
          unitNo: t.unitNo, weight: null, inForce: t.inForce ?? 'yes' }))
    }
  } catch { if (my === candSeq) cands.value = { meters: [], tenants: [] } } finally {
    if (my === candSeq) candLoading.value = false
  }
}
watch([() => form.value.buildingId, () => form.value.floorLabel, () => form.value.side],
  () => { if (poolDlg.value) loadCands() })

// 电表勾选行=候选 ∪ 已绑但不在本定位的表(货梯/招商子表这类,标「其他位置」)
interface MeterRow { meterId: number; label: string; meterType: string | null; ownership: string; other: boolean }
const meterRows = computed<MeterRow[]>(() => {
  const rows: MeterRow[] = cands.value.meters.map(m => ({
    meterId: m.meterId, label: m.label, meterType: m.meterType, ownership: m.ownership, other: false }))
  const has = new Set(rows.map(r => r.meterId))
  for (const s of form.value.meters) if (!has.has(s.meterId))
    rows.push({ meterId: s.meterId, label: s.label, meterType: null, ownership: '', other: true })
  return rows
})
const signOf = (id: number) => form.value.meters.find(m => m.meterId === id)?.sign ?? null
function toggleBind(id: number, label: string) {
  const i = form.value.meters.findIndex(m => m.meterId === id)
  if (i >= 0) form.value.meters.splice(i, 1)
  else form.value.meters.push({ meterId: id, sign: 1, label })
}
function toggleSign(id: number) {
  const m = form.value.meters.find(x => x.meterId === id)
  if (m) m.sign = m.sign < 0 ? 1 : -1
}
// 「从其他位置添加表」:全库搜索(货梯/招商子表/广告字分表这类跨位置口子)
const otherOpen = ref(false)
const otherQ = ref('')
const meterLabelOf = (m: MeterDTO) =>
  (m.spot?.trim() || m.name) + (m.subName ? `·${m.subName}` : '')
const otherList = computed(() => {
  const kw = otherQ.value.trim()
  const inRows = new Set(meterRows.value.map(r => r.meterId))
  return meters.value.filter(m => !inRows.has(m.id)
    && (kw === '' || m.name.includes(kw) || (m.subName ?? '').includes(kw)
      || (m.spot ?? '').includes(kw) || (m.area ?? '').includes(kw))).slice(0, 40)
})

// 受益人勾选行=候选(在租) ∪ 已存受益人(退租的灰显标注,缺日期的橙标「判不了」)
interface TenantRow { tenantId: number; name: string; unitNo: string | null; inForce: AllocInForce; other: boolean }
const tenantRows = computed<TenantRow[]>(() => {
  const rows: TenantRow[] = cands.value.tenants.map(t => ({
    tenantId: t.tenantId, name: t.tenantName ?? `#${t.tenantId}`, unitNo: t.unitNo,
    inForce: t.inForce ?? 'yes', other: false }))
  const has = new Set(rows.map(r => r.tenantId))
  for (const m of form.value.members) if (!has.has(m.tenantId))
    rows.push({ tenantId: m.tenantId, name: m.tenantName, unitNo: m.unitNo, inForce: m.inForce, other: true })
  return rows
})
const memberOf = (id: number) => form.value.members.find(m => m.tenantId === id)
function toggleMember(t: TenantRow) {
  const i = form.value.members.findIndex(m => m.tenantId === t.tenantId)
  if (i >= 0) form.value.members.splice(i, 1)
  else form.value.members.push({ tenantId: t.tenantId, tenantName: t.name, unitNo: t.unitNo,
    weight: null, inForce: t.inForce })
}
function addLink() { form.value.links.push({ ruleId: '', type: 'fold_price' }) }

async function submitPool() {
  const f = form.value
  if (f.id == null && !f.feeName.trim()) { poolErr.value = '请填写费项(池名末段,如 走廊灯/消防/货梯)'; return }
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  saving.value = true
  try {
    const req = {
      zone: f.zone, name: formAutoName.value, buildingId: f.buildingId,
      floorLabel: f.floorLabel.trim() || null, side: f.side.trim() || null,
      feeName: f.feeName.trim() || null,
      method: f.method, coefficient: num(f.coefficient), extraQty: num(f.extraQty),
      feeKey: f.feeKey, note: f.note.trim() || null,
      meterIds: f.meters.map(m => m.meterId),
      meters: f.meters.map(m => ({ meterId: m.meterId, sign: m.sign })),
      members: f.members.map(m => ({ tenantId: m.tenantId, weight: m.weight })),
      memberMonth: f.monthOnly ? ym.value : null,
      roundScale: f.roundScale, stdKind: f.stdKind === '' ? null : f.stdKind,
      baseKey: f.baseKey.trim() || null,
      links: f.links.filter(l => l.ruleId !== '').map(l => ({ ruleId: +l.ruleId, type: l.type })),
    }
    if (f.id == null) await allocApi.createRule(req)
    else await allocApi.updateRule(f.id, req)
    poolDlg.value = false
    loadRules().catch(() => {})
    // 「保存并重新生成」:本月已有快照就顺手重算,否则留提示条
    if (generated.value) {
      try { await allocApi.generate(ym.value); cfgDirty.value = false } catch { cfgDirty.value = true }
    } else cfgDirty.value = true
    await loadMonth()
  } catch (e) { poolErr.value = errMsg(e, '保存失败') } finally { saving.value = false }
}
async function delPool() {
  const f = form.value
  if (f.id == null) return
  if (!confirm(`确认删除池「${formAutoName.value}」?已有核算结果的池不可删除(历史月已快照)。`)) return
  try {
    await allocApi.deleteRule(f.id)
    poolDlg.value = false
    cfgDirty.value = true
    loadRules().catch(() => {})
    await loadMonth()
  } catch (e) { poolErr.value = errMsg(e, '删除失败') }
}
</script>

<template>
  <div v-if="!pools" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="pl-page">
    <!-- 标题行:h2+账期;右=导出(常驻)+生成/新增池(编辑态)+编辑模式 -->
    <div class="pl-head">
      <div class="pl-head-l">
        <h2 class="pl-title"><span class="ic"><component :is="iconFor('share-2')" :size="18" /></span>公共电核算</h2>
        <div style="width:96px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:84px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Segmented :options="ZONE_OPTS" v-model="zone" size="sm" />
      </div>
      <div class="pl-actions">
        <Button variant="outline" size="sm" :disabled="bands.length === 0" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出当月
        </Button>
        <Button v-if="editMode" variant="outline" size="sm" :disabled="generating" @click="onGenerate">
          <template #leading><component :is="iconFor(generated ? 'refresh-cw' : 'play')" :size="14" /></template>
          {{ generated ? '重新生成' : '生成本月' }}
        </Button>
        <Button v-if="editMode" variant="outline" size="sm" @click="openPoolDlg()">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增池
        </Button>
        <Button v-if="canEdit" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="editMode = !editMode">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 提示条:本月未生成 / 配置已变请重新生成 -->
    <div v-if="!generated" class="pl-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月未生成 —— 池配置照常展示,数值列为'–'。
        <template v-if="editMode">点「生成本月」按当月读数与价目落快照。</template>
        <template v-else-if="canEdit">进入右上角「编辑模式」可生成。</template>
      </span>
    </div>
    <div v-if="cfgDirty" class="pl-bar warn">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <span>配置已变,请重新生成 —— 屏上数字仍是旧快照,点「重新生成」后生效。</span>
    </div>
    <!-- V69 受益人变动提醒条:该定位本月在租租户 vs 池受益人的差集 -->
    <div v-if="zoneDiffs.length" class="pl-bar warn">
      <component :is="iconFor('users')" :size="14" />
      <span>本月 {{ zoneDiffs.length }} 个池的在租租户有变动 —— 首次配置为全新带出,配置后只提示增减。</span>
      <button class="pl-barlink" @click="diffOpen = !diffOpen">{{ diffOpen ? '收起' : '展开' }}</button>
      <div v-if="diffOpen" class="pl-difflist">
        <div v-for="d in zoneDiffs" :key="d.ruleId" class="pl-diffrow">
          <span class="nm" :class="{ click: canEdit }" @click="gotoDiff(d.ruleId)">
            {{ rowById.get(d.ruleId)?.autoName || d.poolName }}
          </span>
          <span v-if="d.added.length" class="tag add" :title="d.added.map(t => t.tenantName).join('、')">
            +{{ d.added.length }} 新在租
          </span>
          <span v-if="d.removed.length" class="tag del" :title="d.removed.map(t => t.tenantName).join('、')">
            −{{ d.removed.length }} 已退租
          </span>
        </div>
      </div>
    </div>

    <!-- 台账式宽表:分带(Excel 式分隔带)+tfoot 合计(ref 行不计) -->
    <div class="pl-wrap">
      <table class="pl-table">
        <thead>
          <tr>
            <th rowspan="2" class="pl-grp-th pl-fix-th pl-fix" :style="fixFloor"
                title="池的楼层与方位(整栋池'–';园区级池不挂楼栋,空)">楼层·方位</th>
            <th rowspan="2" class="pl-grp-th pl-fix-th pl-fix" :style="fixName"
                title="费项名(楼栋/楼层已成列);悬停行内池名可看自动生成的全名">池名称</th>
            <th rowspan="2" class="pl-grp-th" :style="w(88)">表构成</th>
            <th :colspan="segDefs.length" class="pl-grp-th">用量(kWh)</th>
            <th rowspan="2" class="pl-grp-th" :style="w(104)">应分摊(元)</th>
            <th rowspan="2" class="pl-grp-th" :style="w(112)">分摊语义</th>
            <th rowspan="2" class="pl-grp-th" :style="w(110)">分摊标准</th>
            <th v-if="editMode" rowspan="2" class="pl-grp-th" :style="w(92)" title="rule:{id} 月行 coefficient(层数/面积基数月变);清空=回退池默认系数">系数(月)</th>
            <th v-if="editMode" rowspan="2" class="pl-grp-th" :style="w(92)" title="rule:{id} 月行 extra_qty(加度/扣度:+170/-670…,进标准分子不进应分摊)">加度(月)</th>
            <th rowspan="2" class="pl-grp-th" :style="w(90)"
                title="按受益人配置试算摊到户的合计,非实收">摊出</th>
            <th rowspan="2" class="pl-grp-th" :style="w(90)"
                title="摊出−应分摊;受益人名单或面积基数与账册不同批时会有差">差额</th>
            <th rowspan="2" class="pl-grp-th" :style="w(80)"
                title="租户实际缴回的公摊额 —— 待账单模块(bill_notice)落地后从账单侧回填,现全为'–'">实收</th>
            <th rowspan="2" class="pl-grp-th" :style="w(80)"
                title="账册 AF 盈/亏=实收−应分摊 —— 待账单模块(bill_notice)落地后从账单侧回填,现全为'–'">盈亏</th>
            <th rowspan="2" class="pl-grp-th" :style="w(180)">备注</th>
          </tr>
          <tr>
            <th v-for="s in segDefs" :key="s.k" class="pl-leaf-th" :style="w(92)">{{ s.lab }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="b in bands" :key="b.label">
            <!-- 楼栋分带(园区级/各楼栋;带头跨左两列 sticky) -->
            <tr class="pl-band">
              <td class="pl-fix" :style="fixBand" colspan="2">
                <span class="pl-band-lbl">{{ b.label }}</span>
              </td>
              <td :colspan="colCount - 2"></td>
            </tr>
            <tr v-for="r in b.rows" :key="r.ruleId">
              <td class="pl-fix" :style="fixFloor">
                <span class="pl-txt" :class="{ dim: poolFloorSide(r) === '–' }">{{ poolFloorSide(r) }}</span>
              </td>
              <td class="pl-fix" :style="fixName">
                <span class="pl-pname" :class="{ click: editMode }" :title="r.warn ?? r.autoName ?? r.name"
                      @click="editMode && openPoolDlg(r)">
                  <span class="nm">{{ poolFeeLabel(r) }}</span>
                  <span v-if="r.warn" class="pl-warn" :title="r.warn">!</span>
                </span>
              </td>
              <!-- 表构成:n块,hover popover 列名单(含 sign 与折入 links) -->
              <td class="ct pl-mcell">
                <span class="pl-mcnt">{{ r.meters.length }}块<template v-if="r.links.length">+{{ r.links.length }}链</template></span>
                <div v-if="r.meters.length || r.links.length" class="pl-pop">
                  <div v-for="m in r.meters" :key="m.meterId" class="pl-pop-row" :title="m.meterType ?? undefined">
                    <span class="sgn" :class="{ neg: m.sign < 0 }">{{ m.sign < 0 ? '−' : '+' }}</span>{{ m.label || m.name }}
                  </div>
                  <div v-for="l in r.links" :key="l.type + '-' + l.ruleId" class="pl-pop-row link">
                    折入{{ l.type === 'fold_price' ? '标准' : '度数' }} ← {{ l.name }}
                  </div>
                </div>
              </td>
              <td v-for="s in segDefs" :key="s.k">
                <span class="pl-nv" :class="{ empty: r[s.k] == null }">{{ fmt(r[s.k]) }}</span>
              </td>
              <td><span class="pl-sumc" :class="{ empty: r.costAmount == null }">{{ fmt2(r.costAmount) }}</span></td>
              <td><span class="pl-txt">{{ poolSemantics(r) }}</span></td>
              <td>
                <span class="pl-nv" :class="{ empty: r.stdValue == null, fold: stdDisplay(r).title }"
                      :title="stdDisplay(r).title ?? undefined">{{ stdDisplay(r).text }}</span>
              </td>
              <td v-if="editMode">
                <input class="pl-ni" type="number" step="any"
                       :value="cfgRaw(`rule:${r.ruleId}`, 'coefficient')?.value ?? ''"
                       :placeholder="ruleById.get(r.ruleId)?.coefficient != null ? String(ruleById.get(r.ruleId)!.coefficient) : '–'"
                       title="当月系数(层数/面积基数),回车/失焦保存;清空=回退默认"
                       @change="commitRuleCfg(r.ruleId, 'coefficient', ($event.target as HTMLInputElement).value)" />
              </td>
              <td v-if="editMode">
                <input class="pl-ni" type="number" step="any"
                       :value="cfgRaw(`rule:${r.ruleId}`, 'extra_qty')?.value ?? ''"
                       :placeholder="ruleById.get(r.ruleId)?.extraQty ? String(ruleById.get(r.ruleId)!.extraQty) : '–'"
                       title="当月加度/扣度,回车/失焦保存;清空=回退默认"
                       @change="commitRuleCfg(r.ruleId, 'extra_qty', ($event.target as HTMLInputElement).value)" />
              </td>
              <td>
                <span class="pl-nv" :class="{ empty: r.allocatedAmount == null }"
                      :title="r.autoMembers ? '受益人自动=该期全园在租租户(园区级池未勾选,跟着在租名册走)'
                        : r.members.length ? `受益人 ${r.members.length} 户` : '未勾选受益人'">
                  {{ fmt2(r.allocatedAmount) }}
                </span>
              </td>
              <td><span class="pl-gap" :class="gapClass(r.gapAmount)">{{ fmt2(r.gapAmount) }}</span></td>
              <!-- 实收/盈亏:账册 AE/AF 口径(从账单侧拉回),bill_notice 未落地故恒'–' -->
              <td><span class="pl-nv empty" title="待账单模块落地后从账单侧回填">–</span></td>
              <td><span class="pl-nv empty" title="待账单模块落地后从账单侧回填">–</span></td>
              <td><span class="pl-txt dim" :title="r.note ?? undefined">{{ r.note ?? '–' }}</span></td>
            </tr>
          </template>
          <tr v-if="bands.length === 0">
            <td class="pl-noro" :colspan="colCount">
              {{ POOL_ZONE_LABEL[zone] }}暂无池配置{{ editMode ? ',点右上「新增池」开始录入' : '' }}
            </td>
          </tr>
        </tbody>
        <!-- tfoot 合计:Σ度数(总列)/Σ应分摊,ref 纯标准行不计(锚 L126/W126) -->
        <tfoot>
          <tr>
            <th class="pl-fix" :style="fixFloor"><span class="pl-foot-lbl">合　计</span></th>
            <th class="pl-fix" :style="fixName"></th>
            <th></th>
            <th><span class="pl-foot-v">{{ fmt(foot.qty) }}</span></th>
            <th v-if="segDefs.length > 1" :colspan="segDefs.length - 1"></th>
            <th><span class="pl-foot-v">{{ fmt2(foot.cost) }}</span></th>
            <th :colspan="colCount - segDefs.length - 4"><span class="pl-foot-note">纯标准行(ref)不入合计</span></th>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 池配置抽屉(编辑态;迁自旧屏规则弹窗+S3-B1 增量字段) -->
    <FPDrawer :open="poolDlg" :title="form.id == null ? '新增池' : '编辑池 · ' + formAutoName"
              subtitle="池=楼栋+楼层+侧向+费项四级定位(池名自动生成);组成电表与受益人一律勾选;改完保存即重算"
              icon="share-2" :width="820" @close="poolDlg = false">
      <div class="pl-form">
        <!-- ① 定位四选 → 池名自动生成(只读) -->
        <div class="pl-sec">
          <div class="pl-sectitle">① 池在哪(定位)· 层级留空即上一级:楼层空=整栋,楼栋空=园区级</div>
          <div class="pl-formrow">
            <Select v-model="form.zone" label="期区" :options="ZONE_OPTS" size="sm" />
            <Select :model-value="form.buildingId == null ? '' : String(form.buildingId)" label="楼栋"
                    :options="buildingOpts" size="sm"
                    @update:model-value="form.buildingId = $event === '' ? null : +$event" />
            <Select v-model="form.floorLabel" label="楼层" :options="floorOpts" size="sm" />
            <Select v-model="form.side" label="侧向" :options="sideOpts" size="sm" />
          </div>
          <div class="pl-formrow">
            <div style="flex:0 0 220px">
              <label class="pl-lbl" for="pl-feename">费项(池名末段)</label>
              <!-- 原生 datalist:既能挑现有费项也能直接输新的,不另建配置表 -->
              <input id="pl-feename" v-model="form.feeName" class="pl-txti" type="text" list="pl-feenames"
                     placeholder="如 走廊灯/消防/货梯" />
              <datalist id="pl-feenames">
                <option v-for="f in feeNameOpts" :key="f" :value="f" />
              </datalist>
            </div>
            <div style="flex:1;min-width:0">
              <label class="pl-lbl">池名称(自动生成,不可手写)</label>
              <div class="pl-autoname">
                {{ keepsOldName ? form.oldName : formAutoName }}
                <span v-if="keepsOldName" class="pl-chip">存量名保留 —— 填了楼层/侧向/费项才改名</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ② 组成电表:候选按定位过滤,标签=位置·电表①(右侧灰字表类) -->
        <div class="pl-sec">
          <div class="pl-sectitle">
            ② 池里有哪些电表 · 已选 {{ form.meters.length }}
            <span v-if="candLoading" class="dim">载入候选…</span>
          </div>
          <div class="pl-bindlist">
            <label v-for="m in meterRows" :key="m.meterId" class="pl-bindrow">
              <input type="checkbox" :checked="signOf(m.meterId) != null"
                     @change="toggleBind(m.meterId, m.label)" />
              <span class="nm">{{ m.label }}</span>
              <span v-if="m.ownership === 'infra'" class="pl-chip infra">总表 · 一般不入池</span>
              <span v-if="m.other" class="pl-chip">其他位置</span>
              <span class="meta">{{ m.meterType ?? '' }}</span>
              <button v-if="signOf(m.meterId) != null" type="button" class="pl-sign"
                      :class="{ neg: signOf(m.meterId)! < 0 }"
                      title="+1=计入池 / −1=从池剔除(广告字分表/火炬园/招商子表)"
                      @click.prevent="toggleSign(m.meterId)">
                {{ signOf(m.meterId)! < 0 ? '−1' : '+1' }}
              </button>
            </label>
            <div v-if="meterRows.length === 0" class="pl-bindempty">该定位下没有可入池的表 —— 换定位或从其他位置添加</div>
          </div>
          <button class="pl-more" @click="otherOpen = !otherOpen">
            <component :is="iconFor(otherOpen ? 'chevron-down' : 'chevron-right')" :size="13" />
            从其他位置添加表(货梯/招商子表/广告字分表)
          </button>
          <div v-if="otherOpen" class="pl-otherbox">
            <input v-model="otherQ" class="pl-bindq" type="text" placeholder="搜表名/位置/区域(全库)" />
            <div class="pl-bindlist">
              <label v-for="m in otherList" :key="m.id" class="pl-bindrow">
                <input type="checkbox" :checked="signOf(m.id) != null"
                       @change="toggleBind(m.id, meterLabelOf(m))" />
                <span class="nm">{{ meterLabelOf(m) }}</span>
                <span class="meta">{{ [m.area, m.meterType].filter(Boolean).join(' · ') }}</span>
              </label>
              <div v-if="otherList.length === 0" class="pl-bindempty">无匹配</div>
            </div>
          </div>
        </div>

        <!-- ③ 分摊方式 + 基数 -->
        <div class="pl-sec">
          <div class="pl-sectitle">③ 怎么摊</div>
          <div class="pl-radios">
            <label v-for="o in methodRadios" :key="o.value" class="pl-radio" :title="o.hint">
              <input type="radio" :value="o.value" :checked="form.method === o.value"
                     @change="form.method = o.value" />
              <span>{{ o.label }}</span>
            </label>
          </div>
          <div class="pl-formrow">
            <Input v-model="form.coefficient" label="基数(层数/受益面积Σ㎡)" placeholder="月变走表内「系数(月)」列" size="sm" />
            <Input v-model="form.baseKey" label="基数键(价目簿,优先于基数)" placeholder="如 area_base;空=用基数" size="sm" />
            <Input v-model="form.extraQty" label="默认加度" placeholder="如 170" size="sm" />
          </div>
          <div class="pl-formrow">
            <Select v-model="form.feeKey" label="出口费项(入账用)" :options="FEE_OPTS" size="sm" />
            <Select v-model="form.stdKind" label="分摊标准算式(按册复刻)" :options="STD_OPTS" size="sm" />
            <Select :model-value="String(form.roundScale)" label="标准 ROUND 位数" :options="ROUND_OPTS" size="sm"
                    @update:model-value="form.roundScale = +$event" />
          </div>
          <Input v-model="form.note" label="备注" placeholder="如:电梯用电加170度" size="sm" />
        </div>

        <!-- ④ 分摊给谁(受益人勾选;退租户灰显) -->
        <div class="pl-sec">
          <div class="pl-sectitle">
            ④ 分摊给谁 · {{ formAutoMembers ? '自动=全园在租' : `已选 ${form.members.length} 户` }}
            <span class="dim">{{ formAutoMembers
              ? '园区级池不勾人=按该期全园在租租户自动摊(勾了就以勾选为准)'
              : '候选=该定位本月在租租户(按合同预勾;侧向勾错请手动取消)' }}</span>
          </div>
          <div v-if="formDiff" class="pl-innerwarn">
            <component :is="iconFor('alert-triangle')" :size="13" />
            <span>该定位本月租户有变动:
              <template v-if="formDiff.added.length">新在租 {{ formDiff.added.map(t => t.tenantName).join('、') }};</template>
              <template v-if="formDiff.removed.length">已退租 {{ formDiff.removed.map(t => t.tenantName).join('、') }}</template>
            </span>
          </div>
          <div v-if="formNoDate.length" class="pl-innerwarn">
            <component :is="iconFor('alert-triangle')" :size="13" />
            <span>{{ formNoDate.map(m => m.tenantName).join('、') }} 合同缺日期,判不了在租 —— 补齐合同起止日期后才能判定</span>
          </div>
          <div class="pl-bindlist tall">
            <label v-for="t in tenantRows" :key="t.tenantId" class="pl-bindrow" :class="{ gone: t.inForce === 'no' }">
              <input type="checkbox" :checked="memberOf(t.tenantId) != null" @change="toggleMember(t)" />
              <span class="nm">{{ t.name }}</span>
              <span v-if="t.unitNo" class="pl-chip">{{ t.unitNo }}</span>
              <span v-if="t.inForce === 'no'" class="pl-chip gone">已退租</span>
              <span v-else-if="t.inForce === 'unknown'" class="pl-chip nodate"
                    title="补齐合同起止日期后才能判定在租">合同缺起止日期</span>
              <span v-else-if="t.other" class="pl-chip">非本定位</span>
              <span class="meta"></span>
            </label>
            <div v-if="tenantRows.length === 0" class="pl-bindempty">该定位本月无在租租户</div>
          </div>
          <label class="pl-chkline" title="勾上=只写本月(acct_month 月行),历史月与默认长期名单不动">
            <input type="checkbox" v-model="form.monthOnly" />
            只改本月({{ ym }})的受益人名单,不动默认长期名单
          </label>
        </div>

        <!-- 池间折入链(fold_price=标准叠加/fold_qty=净度数计入) -->
        <div class="pl-sec">
          <div class="pl-bindhead">
            <span class="pl-sectitle" style="flex:1">⑤ 折入链(links,本池 ← 源池)· {{ form.links.length }} 条</span>
            <Button variant="outline" size="sm" @click="addLink">
              <template #leading><component :is="iconFor('plus')" :size="13" /></template>
              加一条
            </Button>
          </div>
          <div v-for="(l, i) in form.links" :key="i" class="pl-linkrow">
            <div style="flex:1;min-width:0">
              <Select v-model="l.ruleId" :options="linkRuleOpts" size="sm" placeholder="选择源池" />
            </div>
            <div style="width:190px">
              <Select v-model="l.type" :options="LINK_TYPE_OPTS" size="sm" />
            </div>
            <button class="pl-iconbtn danger" title="移除" @click="form.links.splice(i, 1)">
              <component :is="iconFor('x')" :size="14" />
            </button>
          </div>
        </div>
        <div class="pl-dlg-err">{{ poolErr }}</div>
      </div>
      <template #footer>
        <Button v-if="form.id != null" variant="outline" size="sm" style="margin-right:auto" @click="delPool">
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          删除池
        </Button>
        <Button variant="gray" size="sm" @click="poolDlg = false">取消</Button>
        <Button variant="filled" size="sm" :disabled="saving" @click="submitPool">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          {{ saving ? '保存中…' : '保存并重新生成' }}
        </Button>
      </template>
    </FPDrawer>
  </div>
</template>

<style scoped>
.pl-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(mt-head 家族) */
.pl-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pl-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pl-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pl-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.pl-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* 提示条 */
.pl-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); flex-wrap: wrap; }
.pl-bar.warn { border-color: var(--hue-orange); background: rgb(255, 250, 235); color: rgb(138, 97, 0); }
.pl-barlink { border: none; background: transparent; color: var(--hue-blue); font-size: var(--fs-label); cursor: pointer; text-decoration: underline; padding: 0; }
.pl-difflist { flex: 1 1 100%; display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; margin-top: 2px; }
.pl-diffrow { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.pl-diffrow .nm { color: var(--text-primary); font-weight: var(--fw-medium); }
.pl-diffrow .nm.click { cursor: pointer; text-decoration: underline dotted; }
.pl-diffrow .nm.click:hover { color: var(--hue-blue); }
.pl-diffrow .tag { font-size: 11px; border-radius: var(--radius-full); padding: 0 7px; cursor: help; }
.pl-diffrow .tag.add { background: rgb(222, 244, 229); color: rgb(21, 128, 61); }
.pl-diffrow .tag.del { background: rgb(255, 238, 237); color: var(--hue-red); }

/* ── 宽表(FPLedgerTable 1:1 手法自 MeterLedgerGrid) ── */
.pl-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.pl-table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-family: var(--font-sans); }
.pl-table th, .pl-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0; }
.pl-table thead th { position: sticky; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: center; padding: 0 8px; z-index: 4; }
.pl-grp-th { top: 0; height: 34px; }
.pl-leaf-th { top: 34px; height: 30px; }
.pl-fix-th { top: 0; z-index: 6; vertical-align: middle; }
.pl-table thead th.pl-fix-th { z-index: 8; }
.pl-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; }
.pl-table tbody tr:hover td { background: var(--surface-card); }
.pl-fix { position: sticky; z-index: 3; background: var(--surface-white); }
.pl-table tbody tr:hover .pl-fix { background: var(--surface-card); }
td.ct { text-align: center; }

/* 池名称格:编辑态可点开抽屉;warn 角标 */
.pl-pname { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.pl-pname.click { cursor: pointer; }
.pl-pname.click:hover .nm { color: var(--hue-blue); }
.pl-pname .nm { overflow: hidden; text-overflow: ellipsis; }
.pl-warn { flex: 0 0 auto; width: 15px; height: 15px; border-radius: var(--radius-full); background: rgb(255, 238, 237); color: var(--hue-red); font-size: 11px; font-weight: var(--fw-semibold); display: grid; place-items: center; cursor: help; }

/* mono 右对齐数值(空值'–' dim)/文本 */
.pl-nv { display: block; text-align: right; font-size: 12px; padding: 0 8px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-nv.empty { color: var(--text-disabled); }
.pl-nv.fold { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.pl-sumc { display: block; text-align: right; font-weight: var(--fw-semibold); color: var(--hue-blue); font-size: 12px; padding: 0 8px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-sumc.empty { color: var(--text-disabled); font-weight: var(--fw-regular); }
.pl-txt { display: block; text-align: left; font-size: 12px; padding: 0 10px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-txt.dim { color: var(--text-muted); }

/* 表构成 popover(hover 出列名单:sign±与折入链) */
.pl-mcell { position: relative; }
.pl-mcnt { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); cursor: help; }
.pl-pop { display: none; position: absolute; top: calc(100% - 4px); left: 50%; transform: translateX(-50%); z-index: 20; min-width: 180px; max-width: 300px; padding: 8px 10px; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(28, 28, 28, .16); text-align: left; }
.pl-mcell:hover .pl-pop { display: block; }
.pl-pop-row { font-size: 12px; color: var(--text-secondary); padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-pop-row .sgn { display: inline-block; width: 14px; color: rgb(21, 128, 61); font-family: var(--font-mono); }
.pl-pop-row .sgn.neg { color: var(--hue-red); }
.pl-pop-row.link { color: var(--hue-blue); }

/* 楼栋分隔带(mlg-bsum 对标:加高+深底+上下 2px 粗边) */
.pl-table tbody tr.pl-band td { height: 40px; background: var(--surface-sunken); border-top: 2px solid var(--border-strong); border-bottom: 2px solid var(--border-strong); }
.pl-band-lbl { display: block; padding: 0 10px; text-align: left; font-size: 13px; font-weight: var(--fw-semibold); letter-spacing: .02em; color: var(--text-primary); white-space: nowrap; }

/* 盈亏色阶:0=绿(摊平)/负=红(挂亏)/正=橙(超摊) */
.pl-gap { display: block; text-align: right; font-size: 12px; padding: 0 8px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-gap.empty { color: var(--text-disabled); }
.pl-gap.ok { color: rgb(21, 128, 61); }
.pl-gap.bad { color: var(--hue-red); font-weight: var(--fw-semibold); }
.pl-gap.warn { color: rgb(138, 97, 0); }

/* 行内月度参数 input(透明格) */
.pl-ni { width: 100%; box-sizing: border-box; border: 1px solid transparent; background: transparent; text-align: right; font-size: 12px; padding: 3px 6px; outline: none; color: var(--text-primary); font-family: var(--font-mono); border-radius: var(--radius-sm); }
.pl-ni:focus { background: var(--accent-blue); border-color: var(--hue-blue); }
.pl-ni::-webkit-outer-spin-button, .pl-ni::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pl-ni::placeholder { color: var(--text-disabled); }

.pl-noro { text-align: center; padding: 40px 16px; color: var(--text-disabled); font-size: var(--fs-label); }

/* 合计页脚(sticky bottom) */
.pl-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); }
.pl-table tfoot th.pl-fix { z-index: 7; }
.pl-foot-lbl { display: block; padding: 0 10px; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.pl-foot-v { display: block; text-align: right; padding: 0 8px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }
.pl-foot-note { display: block; text-align: right; padding: 0 10px; font-family: var(--font-sans); font-size: var(--fs-micro); font-weight: var(--fw-regular); color: var(--text-disabled); }

/* 抽屉表单 */
.pl-form { display: flex; flex-direction: column; gap: 12px; }
.pl-formrow { display: flex; gap: 10px; }
.pl-formrow > * { flex: 1; min-width: 0; }
.pl-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }
.pl-sec { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.pl-sectitle { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pl-sectitle .dim { font-weight: var(--fw-regular); color: var(--text-muted); font-size: var(--fs-micro); }
.pl-lbl { display: block; font: var(--type-label); color: var(--text-secondary); font-weight: var(--fw-medium); margin-bottom: 6px; }
.pl-txti { width: 100%; box-sizing: border-box; height: 32px; padding: 0 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: 12.5px; background: var(--surface-white); }
.pl-txti:focus { outline: none; border-color: var(--border-strong); }
.pl-autoname { height: 32px; display: flex; align-items: center; padding: 0 12px; box-sizing: border-box; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-sunken); font-size: 13px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-radios { display: flex; gap: 8px; flex-wrap: wrap; }
.pl-radio { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12.5px; cursor: pointer; }
.pl-radio:hover { background: var(--bg-hover); }
.pl-chip { flex: 0 0 auto; font-size: 11px; border-radius: var(--radius-full); padding: 0 7px; background: var(--surface-sunken); color: var(--text-muted); }
.pl-chip.infra { background: rgb(255, 250, 235); color: rgb(138, 97, 0); }
.pl-chip.gone { background: rgb(255, 238, 237); color: var(--hue-red); }
.pl-chip.nodate { background: rgb(255, 247, 235); color: rgb(180, 83, 9); cursor: help; }
.pl-innerwarn { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: var(--radius-sm); background: rgb(255, 250, 235); color: rgb(138, 97, 0); font-size: 11.5px; }
.pl-more { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; border: none; background: transparent; color: var(--hue-blue); font-size: 12px; cursor: pointer; padding: 0; }
.pl-otherbox { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--border-subtle); padding-top: 8px; }
.pl-chkline { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.pl-bindhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pl-bindq { height: 28px; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12px; }
.pl-bindq:focus { outline: none; border-color: var(--hue-blue); }
.pl-bindlist { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; }
.pl-bindlist.tall { max-height: 240px; }
.pl-bindrow { display: flex; align-items: center; gap: 8px; padding: 5px 4px; font-size: 12.5px; cursor: pointer; border-radius: var(--radius-sm); }
.pl-bindrow:hover { background: var(--bg-hover); }
.pl-bindrow.gone .nm { color: var(--text-disabled); text-decoration: line-through; }
.pl-bindrow .nm { font-weight: var(--fw-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-bindrow .meta { flex: 1; color: var(--text-muted); font-size: var(--fs-micro); overflow: hidden; text-overflow: ellipsis; }
.pl-bindempty { text-align: center; color: var(--text-disabled); font-size: var(--fs-label); padding: 12px 0; }
.pl-sign { flex: 0 0 auto; border: 1px solid var(--border-subtle); background: rgb(222, 244, 229); color: rgb(21, 128, 61); font-family: var(--font-mono); font-size: 11.5px; border-radius: var(--radius-full); padding: 1px 9px; cursor: pointer; }
.pl-sign.neg { background: rgb(255, 238, 237); color: var(--hue-red); }
.pl-linkrow { display: flex; align-items: center; gap: 8px; }
.pl-iconbtn { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; }
.pl-iconbtn:hover { background: var(--bg-hover); color: var(--text-primary); }
.pl-iconbtn.danger:hover { background: rgb(255, 238, 237); color: var(--hue-red); }
</style>
