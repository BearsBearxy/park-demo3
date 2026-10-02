<script setup lang="ts">
// 计费参数(S21-PARAM-CENTER-SPEC §5,2026-10-03 版,画布 10-A~10-G)— 数据中心·出账链组。tenant_price_cfg + alloc_cfg 两表参数的同一读写口。
// 版式 = 左目录卡 + 右当前区卡,整页一屏、表在卡里滚(原来一页滚到底约 21,000px)。按「对谁设」分六区:
//   全园与期级(每月核对 / 长期常数两组可收)· 公摊池(一池一行)· 楼栋损耗(一栋一行)· 户级例外(按户分组)· 光伏分栋判据 · 固定规则(只读),
//   目录顶「本月改动 N」= 影响本月的改动表。当前区随目录切换,记在地址栏 ?section=;深链落点见 paramSections.landingOf。
// 每行 = 后端 GET /api/params 已解析的人话(作用范围 / 值 / 生效区间 / 来自),本页只分区渲染;说明 / 算式列撤掉,挂到参数名的悬停说明。
// 编辑态(EDIT-MODE-SPEC:浏览态零写入口;onDeactivated 复位):点值格 → 贴格 400 宽改值卡(ParamEditPopover)→ PUT /api/params
// → 成功只 patch 该行(WRITE-KEEP-CONTEXT 铁律二);「待重算 / 其他月份受影响」走标题行「待处理」入口与问题面板(LAYOUT-STABILITY §6)。
// 首载加载门(主数据也在门里,首进屏零位移)+ ++seq 竞态守卫;所有表行末一列 .fp-fill 吃余宽;公摊池在窄宽下固定「池 → 分摊基数」(LIST-PAGE §9.1)。
import { ref, computed, onMounted, onDeactivated, watch, nextTick, reactive } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { paramsApi, type ParamChangeDTO, type ParamPutReq, type ParamRowDTO, type ParamStatusDTO, type ParamZone } from '@/api/params'
import { allocApi, type AllocRuleDTO } from '@/api/alloc'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { useChainDeepPeriod } from '@/composables/useDeepPeriod'
import { numW, textW, useWideTable, type HeightDims, type WideCol } from '@/composables/useWideTable'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import { ask } from '@/utils/ask'
import { receipt } from '@/utils/receipt'
import { metersApi, type MeterDTO } from '@/api/meters'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import {
  baseRefLabel, rangeBadge, sourceLabel, staleSources, staleWho, tenantExceptionDelReqs, tenantExceptionReqs,
  type ParamRow,
} from '@/utils/paramCenterLogic'
import { LOSS_BASE_FORM_B_TEMPLATE, PARAM_DEFS, paramDef, writePlan, type ParamMode } from '@/utils/paramRegistry'
import { useAuthStore, approxDirty } from '@/stores/auth'
import { useZonesStore } from '@/stores/zones'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { chainStepsOf, noticeYmOf } from '@/nav/billingChain'
import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import Badge from '@/components/ds/Badge.vue'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import ParamEditPopover, { type RefOption } from './ParamEditPopover.vue'
import ParamHistoryDrawer from './ParamHistoryDrawer.vue'
import ParamChangesDrawer from './ParamChangesDrawer.vue'
import {
  bare, cellText, changeStats, hit, itemKey, landingOf, LOSS_KEYS, objRows, own, POOL_KEYS, poolName, secOf, stripPhase, tenantGroups,
  type ObjRow, type Sec,
} from './paramSections'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'

const auth = useAuthStore()
// RBAC:月度录入(照抄供电局账单)、长期计费口径、重算(跑一次出账)—— 三扇门
const canRun = computed(() => auth.can('billing-run:edit'))
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
const idOf = (scope: string) => Number(scope.slice(scope.indexOf(':') + 1))

// ── 编辑模式(EDIT-MODE-SPEC v3):切页签保留编辑态,只关浮层 ──
// 三档权限在点「编辑模式」时一次要齐:缺任何一档当场弹主管授权窗(ELEVATION-SPEC),取消 = 什么都没发生,留在浏览态。
// 于是进得了编辑态就一定齐,各区写入口在编辑态直接可用。
// 弹卡标题的人话名。前端没有 kind→人话名的映射表,由各屏自己拼 —— 新开一张映射表会与后端 ReviewKind.label() 形成第二份。
const reviewLabel = computed(() => `计费参数 · ${ym.value}`)
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken, reviewNote, reviewTip, reviewKeys } =
  useEditMode(['param-monthly:edit', 'param-policy:edit', 'billing-run:edit'], {
    scope: () => S.paramCenter(year.value, month.value),
    // 审核键(§7.1):计费参数每月一把。ym 为空 = 还在选期门,没有月可审。
    reviewKey: () => (ym.value ? `params:${ym.value}` : null),
    // 改动数(EDIT-MODE §6.1):参数逐行即时写库,没有整页草稿;开着的改值卡 / 新增例外抽屉各算 1 处
    // (里面填了什么看不见,宁可多问)。refs 在下面声明,闭包到关页签时才求值
    dirty: approxDirty(() => (editRow.value ? 1 : 0) + (exOpen.value ? 1 : 0)),
  })
onDeactivated(() => {
  closeEdit(); exOpen.value = false
  histRow.value = null; alertOpen.value = false   // 浮层 Teleport 到 body,KeepAlive 停用不随实例移出
})
// 编辑态**就地**转假(被接管 / 30 分钟提权到期)也要关写 UI —— 它们的 v-if 只判自己的 ref,
// 不判编辑态:改值卡、新增例外的抽屉留在屏上,里面的保存照样 PUT(同 MeterView:162)。
watch(editMode, v => {
  if (v) return
  closeEdit()
  exOpen.value = false
})

// ── 账期:出账链组级(stores/billingPeriod,2026-08-28 设计稿 §3.1);期由出账月矩阵一处选定,五屏共读一份 ──
const period = useBillingPeriodStore()
const year = computed(() => period.year ?? 0)
const month = computed(() => period.month ?? 0)
const ym = computed(() => period.ym ?? '')
const chainSteps = computed(() => chainStepsOf(period.cellOf(ym.value)))
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM(或旧 ?ym=)直落该月;本屏逐行即时写库、无草稿,不传 dirty。
// 必须在下面的 onMounted / watch 之前调用:期先落定,首载才只拉一次。
useChainDeepPeriod()
// 期区值域按后端 p\d+|dorm 的形状判断,不枚举具体代码 —— p4 出现时不用改这里
const isZoneCode = (s: string) => /^p\d+$/.test(s) || s === 'dorm'
const zone = ref<ParamZone>('all')
const zones = useZonesStore()
const ZONE_OPTS = computed(() => [{ value: 'all', label: '全园' }, ...zones.list.map(z => ({ value: z.code, label: z.name }))])
const zoneName = (code: string | null | undefined) => (code ? zones.list.find(z => z.code === code)?.name ?? '' : '')

// ── 数据(首载加载门;++seq 竞态守卫:快速切期区只接受最新一次) ──
const rows = ref<ParamRowDTO[] | null>(null)
const status = ref<ParamStatusDTO | null>(null)
const changes = ref<ParamChangeDTO[]>([])
const loadErr = ref('')
/** 换期重取时的退让(加载态设计稿 §06 第一档):旧数据留在原地不闪,但退一步并停止接受交互 */
const reloading = ref(false)   // ⚠ 不叫 busy:本屏下面已有一个 busy(批量重算用)
/** 熬过 200ms 才亮 —— 本地后端常几十毫秒回来,闪一下比不显示更晃眼 */
const veil = useDeferredFlag(reloading)

// 主数据(池所在期 / 楼栋所在期 / 户所在期 / 选择器候选):失败降级为空,不阻断页面;首载等它们一起到,免得「期」列后补把列宽顶一下
const buildings = ref<BuildingDTO[]>([])
const meters = ref<MeterDTO[]>([])
const tenants = ref<TenantDTO[]>([])
const rules = ref<AllocRuleDTO[]>([])
let masters: Promise<unknown> | null = null
const loadMasters = () => (masters ??= Promise.all([
  zones.ensure(),
  buildingApi.list().then(d => { buildings.value = d }).catch(() => {}),
  tenantApi.list().then(d => { tenants.value = d }).catch(() => {}),
  allocApi.rules().then(d => { rules.value = d }).catch(() => {}),
]))

let seq = 0
async function load() {
  const my = ++seq
  reloading.value = true
  try {
    // 表的楼栋 / 租户按月分段(METER-TIMELINE-SPEC §2):站在本页账期取
    const [rs, st, ch, ms] = await Promise.all([
      paramsApi.list(ym.value, zone.value),
      paramsApi.status(ym.value).catch(() => null),
      paramsApi.changes(ym.value).catch(() => [] as ParamChangeDTO[]),
      metersApi.list('elec', undefined, ym.value || undefined).catch(() => [] as MeterDTO[]),
      loadMasters(),
    ])
    if (my !== seq) return
    // 错误只在成功分支清:开头先清的话,重试那一下失败态先闪掉、旧行露出来,回包再失败又换回来
    rows.value = rs; status.value = st; changes.value = ch; meters.value = ms; loadErr.value = ''
    applyPending()
  } catch (e) {
    if (my !== seq) return
    rows.value = rows.value ?? []
    // 标题旁状态签与「待处理」也读 status:不清的话失败件说「不显示上一次读到的」,同屏签和计数却还是上一次(换月失败时是别的月)
    status.value = null
    loadErr.value = errMsg(e, '参数加载失败')
  } finally {
    // ⚠ 只有最新那一趟有资格熄灯:被顶掉的旧请求先返回时若把它清了,新请求还在路上,退让却已经撤掉
    if (my === seq) reloading.value = false
  }
}
// 写完 / 重算完补一次「本月改动」(目录计数与「● 本月改」跟着变);失败不吭声,下次加载再对
function refreshChanges() {
  const my = seq
  paramsApi.changes(ym.value).then(d => { if (my === seq) changes.value = d }).catch(() => {})
}

// ── 当前区 + 深链(画布 10-B 板下半五条)。其它屏跳来的:?p=2024-02(或旧 ?ym=)&zone=p1&section=…&rule=23(或 section=loss&building=13&key=…)&edit=1 ——
//    期归 useChainDeepPeriod;分析层来的 adopt=YYYY-12 只认领不覆盖;edit=1 只进编辑态,不自动弹卡 ──
const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const sec = ref<Sec>('park')
const parkOpen = reactive({ monthly: true, constant: true })
let pending: (() => void) | null = null
function applyHandoff(): boolean {
  const q = route.query
  // 不用 ZONE_OPTS 校验:这里在 setup 期同步跑,比 zones.ensure() 更早,按后端值域做形状校验
  if (typeof q.zone === 'string' && (q.zone === 'all' || isZoneCode(q.zone))) zone.value = q.zone
  const L = landingOf(q as Record<string, unknown>)
  sec.value = L.sec
  if (L.group) {
    const g = L.group
    parkOpen[g] = true
    pending = () => scrollToId(`pm-grp-${g}`)
  }
  if (L.rule != null) {
    const rule = L.rule, key = L.key ?? ''
    pending = () => jumpTo(`rule:${rule}`, key)
  }
  if (L.building != null) {
    const b = L.building, key = L.key ?? ''
    pending = () => jumpTo(`building:${b}`, key)
  }
  // 分析层「去改常数」带 adopt=YYYY-12:只在没有期时认领(billingPeriod.adoptYm 的旧语义),已选期不动
  period.adoptYm(typeof q.adopt === 'string' ? q.adopt : null)
  // ⚠ 必须**先认领期再进编辑态**:顺序反了占的是 `billing-chain:0-00` 的假锁(锁与所编的期错位,不报错、没人会发现)。
  //   period.picked 也要判:没有期时主区是选期矩阵。深链也走 toggle:缺权限时弹授权窗。
  if (q.edit === '1' && period.picked && canEnter.value) toggleEdit()
  return period.picked
}
function applyPending() {
  const f = pending
  pending = null
  if (f) nextTick(f)
}
applyHandoff()   // setup 期同步消费 zone/section/rule/edit/adopt(在 watch 注册之前,免得触发第二次拉取)
onMounted(() => { if (period.picked) load() })
watch([ym, zone], () => { if (period.picked) load() })

/** 切区:地址栏只记 section(期在会话 store 里,不进地址栏;edit / rule 是一次性的交接,不留) */
function setSec(s: Sec) {
  if (sec.value === s) return
  sec.value = s
  closeEdit()
  void router.replace({ path: '/params', query: { section: s } })
}

// ── 六区数据 ──
const all = computed(() => rows.value ?? [])
const parkRows = computed(() => all.value.filter(r => secOf(r.key, r.scope) === 'park'))
const parkGroups = computed(() => [
  { key: 'monthly' as const, title: '每月核对', sub: '电价照抄供电局账单', rows: parkRows.value.filter(r => r.group === 'monthly') },
  { key: 'constant' as const, title: '长期常数', sub: '改一次，管到下次改', rows: parkRows.value.filter(r => r.group !== 'monthly') },
].filter(g => g.rows.length))
const pvRows = computed(() => all.value.filter(r => secOf(r.key, r.scope) === 'pv'))
const pools = computed(() => objRows(all.value, 'rule:'))
const losses = computed(() => objRows(all.value, 'building:'))
const groups = computed(() => tenantGroups(all.value))
const meterById = computed(() => new Map(meters.value.map(m => [m.id, m])))
// 不计入楼栋合计的表:表 → 表所在栋(表主数据按本月取)
// ponytail: 表不在主数据里(或没挂栋)的那几条不显示;要看得到它们,在本区末尾加一行「其它表」
const exclByBid = computed(() => {
  const m = new Map<number, ParamRow[]>()
  for (const r of all.value) {
    if (!r.scope.startsWith('meter:') || r.key !== 'loss_exclude' || r.rowId == null) continue
    const bid = meterById.value.get(idOf(r.scope))?.buildingId
    if (bid == null) continue
    m.set(bid, [...(m.get(bid) ?? []), r])
  }
  return m
})
const ruleZone = computed(() => new Map(rules.value.map(r => [r.id, r.zone as string])))
const bldZone = computed(() => new Map(buildings.value.map(b => [b.id, b.zone])))
const tenantZone = computed(() => new Map(tenants.value.map(t => [t.id, t.phase == null ? null : `p${t.phase}`])))
const stats = computed(() => changeStats(changes.value))
const changed = (r: ParamRow) => stats.value.items.has(itemKey(r.scope, r.key))
const exclOf = (o: ObjRow) => exclByBid.value.get(o.id) ?? []
const poolChanged = (o: ObjRow) => stats.value.scopes.has(o.scope)
const lossChanged = (o: ObjRow) => stats.value.scopes.has(o.scope) || exclOf(o).some(r => stats.value.scopes.has(r.scope))

// 区内搜索 / 筛选(公摊池、楼栋损耗、户级例外)
type F = 'all' | 'set' | 'chg'
const poolQ = ref(''); const poolF = ref<F>('all')
const lossQ = ref(''); const lossF = ref<F>('all')
const tenQ = ref(''); const tenF = ref<F>('all')
// 公摊池 / 楼栋损耗按期区排(期区选择器的顺序,一期在前;画布 10-B / 10-E),同期内照后端序(对象 id),没标期区的排最后。
// 后端按对象 id 出行,池 id 小的是二期,不排的话全园视图二期在前
const zoneRank = (code: string | null | undefined) => { const i = zones.list.findIndex(z => z.code === code); return i < 0 ? zones.list.length : i }
const byZone = (list: ObjRow[], zoneOf: Map<number, string | null>) => list.sort((a, b) => zoneRank(zoneOf.get(a.id)) - zoneRank(zoneOf.get(b.id)))
const poolShown = computed(() => byZone(pools.value.filter(o => (!poolQ.value.trim() || o.label.includes(poolQ.value.trim()))
  && (poolF.value === 'all' || (poolF.value === 'set' ? POOL_KEYS.some(k => own(o.cells[k])) : poolChanged(o)))), ruleZone.value))
const lossShown = computed(() => byZone(losses.value.filter(o => (!lossQ.value.trim() || o.label.includes(lossQ.value.trim()))
  && (lossF.value === 'all' || (lossF.value === 'set' ? LOSS_KEYS.some(k => own(o.cells[k])) || exclOf(o).length > 0 : lossChanged(o)))), bldZone.value))
const tenChanged = (g: { scope: string }) => stats.value.scopes.has(g.scope)
/** 加载时默认展开的户(本月改过 / 本月有专属值),组序排最前(画布 10-F);同组内照后端序。只随整份数据换,写一行不重排,免得组在手底下跳 */
const tenLead = ref(new Set<string>())
const tenShown = computed(() => groups.value.filter(g => (!tenQ.value.trim() || g.name.includes(tenQ.value.trim()))
  && (tenF.value === 'all' || tenChanged(g))).sort((a, b) => +tenLead.value.has(b.scope) - +tenLead.value.has(a.scope)))
const fOpts = (list: readonly ObjRow[], set: (o: ObjRow) => boolean, chg: (o: ObjRow) => boolean) => [
  { value: 'all', label: `全部 ${list.length}` },
  { value: 'set', label: `有设置 ${list.filter(set).length}` },
  { value: 'chg', label: `本月改过 ${list.filter(chg).length}` },
]
const poolFOpts = computed(() => fOpts(pools.value, o => POOL_KEYS.some(k => own(o.cells[k])), poolChanged))
const lossFOpts = computed(() => fOpts(losses.value, o => LOSS_KEYS.some(k => own(o.cells[k])) || exclOf(o).length > 0, lossChanged))
const tenFOpts = computed(() => [
  { value: 'all', label: `全部 ${groups.value.length} 户` },
  { value: 'chg', label: `本月改过 ${groups.value.filter(tenChanged).length}` },
])
// 户级例外组默认收起;本月改过的、本月有专属值的户展开(画布 10-F)。点组头收放,搜户名 / 跳转时展开。
// 只在整份数据换了(加载 / 换期区)时重置 —— 写一行是原地 patch,不该把用户手动收放的组冲掉
const tenOpen = ref(new Set<string>())
watch(rows, () => {
  tenLead.value = new Set(groups.value.filter(g => tenChanged(g) || g.rows.some(r => r.mode === 'month')).map(g => g.scope))
  tenOpen.value = new Set(tenLead.value)
})
function toggleTen(scope: string) {
  const s = new Set(tenOpen.value)
  if (s.has(scope)) s.delete(scope); else s.add(scope)
  tenOpen.value = s
}
const tenIsOpen = (scope: string) => tenOpen.value.has(scope) || !!tenQ.value.trim()

// 目录
const NAV: { sec: Sec; name: string }[] = [
  { sec: 'park', name: '全园与期级' }, { sec: 'pool', name: '公摊池' }, { sec: 'loss', name: '楼栋损耗' }, { sec: 'tenant', name: '户级例外' },
]
const NAV2: { sec: Sec; name: string }[] = [{ sec: 'pv', name: '光伏分栋判据' }, { sec: 'fixed', name: '固定规则' }]
const navCount = computed<Record<string, string>>(() => ({
  park: String(parkRows.value.length), pool: `${pools.value.length} 池`, loss: `${losses.value.length} 栋`,
  tenant: `${groups.value.length} 户`, pv: String(pvRows.value.length), fixed: `${FIXED_RULES.length} 条`,
}))
const navChg = (s: Sec) => (s === 'changes' || s === 'fixed' ? 0 : stats.value.bySec[s])
const SEC_DESC: Partial<Record<Sec, string>> = {
  park: '电价、管理费、水价、面积基数，和一期 / 二期的核算口径',
  pv: '年锚点与五条判据线',
  fixed: '写在引擎里的算法约定，不是参数；改它要改代码',
}
const SEC_NAME: Record<Sec, string> = {
  changes: '本月改动', park: '全园与期级', pool: '公摊池', loss: '楼栋损耗', tenant: '户级例外', pv: '光伏分栋判据', fixed: '固定规则',
}

// ── 格子 ──
const RANGE_TONE = { month: 'orange', from: 'blue', inherit: 'neutral' } as const
// 月核对项本月无专属值(不是 month 行、from 版本也不是本月起的)→「未核对」
const unchecked = (r: ParamRow) => r.group === 'monthly' && r.monthlyCheck && r.mode === 'from' && !r.hasMonthRow && r.acctMonth !== ym.value
const objectScope = (s: string) => s.startsWith('building:') || s.startsWith('rule:') || s.startsWith('meter:')
const missing = (r: ParamRow) => !hit(r) && r.monthlyCheck && !objectScope(r.scope)   // 全园/期级月核对项本月无值
const chainTitle = (r: ParamRow) => (r.sourceChain.length ? `命中链：${r.sourceChain.join(' → ')}` : '各级作用域均未设置')
// 参数名的悬停说明 = 原来的「说明 / 算式」列 + 提示
const tipOf = (r: ParamRow) => (r.formula ? { text: r.formula, sub: r.hint ?? undefined } : r.hint)
const unitOf = (r: ParamRow) => (r.unit && (r.valueText ?? '').endsWith(' ' + r.unit) ? r.unit : '')
const rowDomId = (r: ParamRow) => `pm-row-${itemKey(r.scope, r.key)}`
const isTxt = (r: ParamRow) => ['enum', 'ref_meter', 'ref_building', 'bool'].includes(paramDef(r.key)?.valueKind ?? '')
// 全园与期级值格:枚举的括号说明(「分时制（尖峰平谷四段 + 管理费）」)挪到悬停说明,格里只留「分时制」—— 不然一格把整列撑到 260 宽,1366 下生效区间被挤出卡
const valText = (r: ParamRow) => (isTxt(r) ? bare(r).split('（')[0] : bare(r))
const valTip = (r: ParamRow) => (valText(r) !== bare(r) ? bare(r) : null)
const poolLabel = (o: ObjRow) => poolName(o.label)
const covered = (r: ParamRow) => (r.sourceChain[1] ? r.sourceChain[1].replace(':', ' ') : '（无默认值）')

// 闪一下 / 高亮:深链、本月改动点行、目录搜索、走面积基数的池点链接 —— 同一条 jumpTo
const flash = ref('')
const hlRow = ref('')
function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}
function jumpTo(scope: string, key: string) {
  let s = scope, k = key
  if (s.startsWith('meter:')) {
    const bid = meterById.value.get(idOf(s))?.buildingId
    if (bid == null) { setSec('loss'); return }
    s = `building:${bid}`; k = 'loss_exclude'
  }
  const target = secOf(k, s)
  setSec(target)
  if (target === 'pool') { poolQ.value = ''; poolF.value = 'all'; if (!(POOL_KEYS as readonly string[]).includes(k)) k = '' }
  if (target === 'loss') { lossQ.value = ''; lossF.value = 'all'; if (!(LOSS_KEYS as readonly string[]).includes(k) && k !== 'loss_exclude') k = '' }
  if (target === 'tenant') {
    tenQ.value = ''; tenF.value = 'all'
    tenOpen.value = new Set([...tenOpen.value, s])
    if (!all.value.some(r => r.scope === s && r.key === k && r.rowId != null)) k = ''
  }
  if (target === 'park') {
    const r = parkRows.value.find(x => x.scope === s && x.key === k)
    if (r) parkOpen[r.group === 'monthly' ? 'monthly' : 'constant'] = true
  }
  flash.value = ''
  nextTick(() => {
    flash.value = itemKey(s, k)
    nextTick(() => scrollToId(document.getElementById(`pm-row-${itemKey(s, k)}`) ? `pm-row-${itemKey(s, k)}` : `pm-row-${s}`))
  })
}
const flashOn = (scope: string, key: string) => flash.value === itemKey(scope, key)
const isHl = (r: ParamRow) => hlRow.value === itemKey(r.scope, r.key)
// 走面积基数的池:分摊基数格是那条面积基数参数的值,点它跳到「全园与期级」那一行(命中作用域的那条)并高亮
function gotoBaseRow(r: ParamRow) {
  const label = baseRefLabel(r)
  const key = label ? PARAM_DEFS.find(d => d.label === label)?.key : undefined
  const hitLabel = r.sourceChain[0]?.slice(0, r.sourceChain[0].indexOf(':'))
  const target = key ? all.value.find(x => x.key === key && (x.scopeLabel === hitLabel || hitLabel == null)) : undefined
  if (!target) return
  hlRow.value = itemKey(target.scope, target.key)
  jumpTo(target.scope, target.key)
}
function onJump(c: ParamChangeDTO) { jumpTo(c.scope ?? '', c.key ?? '') }

// 目录搜索「搜参数 / 池 / 栋 / 户」:回车跳到第一处匹配(全园与期级参数名 → 池名 → 楼栋名 → 户名 → 户级例外参数名 → 光伏判据名);
// 池 / 栋 / 户把词带进那一区的搜索框,同区其余匹配一起留在表里
const navQ = ref('')
const navMiss = ref(false)
function navSearch() {
  const q = navQ.value.trim()
  if (!q) return
  navMiss.value = false
  const p = parkRows.value.find(r => r.label.includes(q))
  if (p) return jumpTo(p.scope, p.key)
  const o = pools.value.find(x => x.label.includes(q))
  if (o) { jumpTo(o.scope, ''); poolQ.value = q; return }
  const b = losses.value.find(x => x.label.includes(q))
  if (b) { jumpTo(b.scope, ''); lossQ.value = q; return }
  const g = groups.value.find(x => x.name.includes(q))
  if (g) { jumpTo(g.scope, ''); tenQ.value = q; return }
  const t = groups.value.flatMap(x => x.rows).find(r => r.label.includes(q))
  if (t) return jumpTo(t.scope, t.key)
  const v = pvRows.value.find(r => r.label.includes(q))
  if (v) return jumpTo(v.scope, v.key)
  navMiss.value = true
}

// 页面状态(LAYOUT-STABILITY §2 第 4 级):标题旁的签只报**中性事实** —— 电价 n/6 + 池核算生成没生成 / 生成于何时(一致时,浏览态)。
// 「改了 N 项 / 另有 X 月受影响」归问题面板(§6),这里不说;编辑态不画「改动都已重算」(画布 10-B)
const hhmm = (iso: string) => iso.slice(5, 16).replace('T', ' ')
const stateTags = computed<{ tone: 'warn' | 'muted'; text: string }[]>(() => {
  const s = status.value
  if (!s) return [{ tone: 'muted', text: '状态没读到' }]
  const lack = s.priceTotal - s.priceOk
  return [
    { tone: lack > 0 ? 'warn' : 'muted', text: `本月电价 ${s.priceOk}/${s.priceTotal}${lack > 0 ? ` · 缺 ${lack} 项` : ''}` },
    ...(!s.poolSnapshotAt ? [{ tone: 'warn' as const, text: '本月池核算未生成' }]
      : !s.stale && !editMode.value ? [{ tone: 'muted' as const, text: `改动都已重算 · 生成于 ${hhmm(s.poolSnapshotAt)}` }] : []),
  ]
})

// ── 写:改值卡组装 ParamPutReq → PUT → 只 patch 该行(铁律二) ──
const editRow = ref<ParamRowDTO | null>(null)
const editAnchor = ref<HTMLElement | null>(null)
const exclBid = ref<number | null>(null)   // 「不计入的表」格里的「+」:改值卡换成选表
const histRow = ref<ParamRowDTO | null>(null)
function openEdit(r: ParamRowDTO | undefined, ev: Event) {
  if (!editMode.value || !r || !r.editable) return
  editRow.value = r
  exclBid.value = null
  editAnchor.value = ev.currentTarget as HTMLElement
}
function closeEdit() { editRow.value = null; exclBid.value = null }
const editing = (r: ParamRowDTO | undefined) => !!r && !exclBid.value && editRow.value?.scope === r.scope && editRow.value?.key === r.key
function patchRow(nr: ParamRowDTO, deleted: boolean) {
  const list = rows.value ?? (rows.value = [])
  const i = list.findIndex(r => r.scope === nr.scope && r.key === nr.key)
  // 户级例外 / 表级不计入行删掉后回包是「继承上级 / 无设置」的行(rowId 空),它不再是一条例外 → 从列表拿掉;其余行原位替换 / 新增追加
  const drop = deleted && nr.rowId == null && (nr.scope.startsWith('tenant:') || nr.scope.startsWith('meter:'))
  if (i >= 0) { if (drop) list.splice(i, 1); else list[i] = nr }
  else if (!drop) list.push(nr)
}
function bumpPending() {
  const s = status.value
  if (!s) return
  s.pendingChanges++
  if (s.poolSnapshotAt || s.billBatchAt) {
    s.stale = true
    // 本地先把「参数」记进过期来源,面板里那条「改了 N 项参数」才出得来(下次拉 status 以后端为准)
    if (s.staleSources && !s.staleSources.includes('param')) s.staleSources.push('param')
  }
}
async function put(req: ParamPutReq): Promise<boolean> {
  // 写口自守:全屏参数写全走这一个漏斗。editMode 会就地转假(接管/提权到期),调用方各有各的 v-if —— 漏一个就是浏览态写库。
  if (!editMode.value) return false
  const my = seq
  try {
    const nr = await paramsApi.put(req, ym.value)
    if (my !== seq) return true          // 回包前换了月:写已成功,但别把旧月的行 patch 进新月列表
    patchRow(nr, req.value == null)
    bumpPending()
    refreshChanges()
    return true
  } catch (e) { receipt.fail(errMsg(e, '保存失败')); return false }   // 不带重试:卡还开着,再点「保存」就是重试
}
// 成组写(户级例外写计划:主键 + 配套键),中途失败即停(已写的留着;失败回执已出)
async function putAll(reqs: ParamPutReq[]): Promise<boolean> {
  for (const r of reqs) if (!(await put(r))) return false
  return true
}
async function onSave(req: ParamPutReq) {
  if (await put(req)) closeEdit()
}
// 户级例外 [删]:按写计划整组删该户的版本行(主键 + 配套键;后端拦已被生成月取用的行)
async function delTenantRow(r: ParamRow) {
  const mates = writePlan(r.key).slice(1).map(w => paramDef(w.key)?.label).filter(Boolean)
  const extra = mates.length ? `连同配套的「${mates.join('」「')}」一起删除，` : ''
  if (!(await ask({
    title: `删除「${r.scopeLabel} · ${r.label}」例外（${r.rangeText}）？`,
    body: `${extra}删除后该户回退默认值。`,
    action: '删除例外',
    danger: true,
  }))) return
  void putAll(tenantExceptionDelReqs(r))   // 等回答时被接管:put 漏斗第一行自守
}

// 改值卡引用型值的候选:并入他栋 → 同期区楼栋;总表 / 供电侧对账总表 → 该栋 / 该期电表;户级园区表 → 该户挂的表
// 期区读楼栋真实字段,不按 phase 猜 —— 三期楼栋在手工标注前 zone=null,只跟别的未标注楼栋同桶
const meterOpt = (m: MeterDTO): RefOption => ({ value: String(m.id), label: m.subName ? `${m.name} · ${m.subName}` : m.name })
const refOptions = computed<RefOption[]>(() => {
  const r = editRow.value
  const d = r ? paramDef(r.key) : undefined
  if (!r || !d) return []
  if (d.valueKind === 'ref_building') {
    const self = r.scope.startsWith('building:') ? buildings.value.find(b => b.id === idOf(r.scope)) : undefined
    return buildings.value.filter(b => !self || b.zone === self.zone).map(b => ({ value: String(b.id), label: b.name }))
  }
  if (d.valueKind === 'ref_meter') {
    const ms = r.scope.startsWith('building:') ? meters.value.filter(m => m.buildingId === idOf(r.scope))
      : r.scope.startsWith('tenant:') ? meters.value.filter(m => m.tenantId === idOf(r.scope))
      : isZoneCode(r.scope) ? meters.value.filter(m => m.zone === r.scope)
      : meters.value
    return ms.map(meterOpt)
  }
  return []
})
// 「不计入楼栋合计的表 +」:选这栋还没被设成不计入的表 → 写那块表的 loss_exclude=1
const exclPick = computed<RefOption[] | undefined>(() => {
  const bid = exclBid.value
  if (bid == null) return undefined
  const done = new Set((exclByBid.value.get(bid) ?? []).map(r => idOf(r.scope)))
  return meters.value.filter(m => m.buildingId === bid && !done.has(m.id)).map(meterOpt)
})
function openExcl(o: ObjRow, ev: Event) {
  if (!editMode.value) return
  editRow.value = {
    key: 'loss_exclude', label: '不计入楼栋合计的电表', unit: '', group: 'rule', scope: o.scope, scopeLabel: o.label,
    value: null, valueText: '', mode: null, acctMonth: '', rangeText: '', sourceChain: [], formula: null, hint: null,
    editable: true, monthlyCheck: false, hasMonthRow: false, rowId: null, note: null,
  }
  exclBid.value = o.id
  editAnchor.value = ev.currentTarget as HTMLElement
}

// 户级例外 [+ 新增例外]:租户(FPTenantPicker)+ 键(注册表 tenantEditable)+ 值 + 生效方式 + 备注;
// 写序列按注册表写计划成组展开(与系数簿同一份 writePlan);「损耗费计费基数（按栋）」多选一个楼栋拼 loss_base_form_b{栋id}
const exOpen = ref(false)
const ex = ref({ tenantId: null as number | null, key: '', val: '', bid: '' as string, mode: 'from' as ParamMode, note: '' })
const exKeyOpts = PARAM_DEFS.filter(d => d.tenantEditable).map(d => ({ value: d.key, label: d.unit ? `${d.label}（${d.unit}）` : d.label }))
const exDef = computed(() => paramDef(ex.value.key))
const exValOpts = computed<RefOption[]>(() => {
  const d = exDef.value
  if (!d) return []
  if (d.valueKind === 'enum') return Object.entries(d.enumOptions ?? {}).map(([v, l]) => ({ value: v, label: l }))
  if (d.valueKind === 'ref_meter') return meters.value.filter(m => m.tenantId === ex.value.tenantId).map(meterOpt)
  return []
})
const exPickable = computed(() => exDef.value?.valueKind === 'enum' || exDef.value?.valueKind === 'ref_meter')
const exByBuilding = computed(() => ex.value.key === LOSS_BASE_FORM_B_TEMPLATE)
const exBuildingOpts = computed<RefOption[]>(() => {
  const mine = new Set(meters.value.filter(m => m.tenantId === ex.value.tenantId).map(m => m.buildingId))
  const bs = mine.size ? buildings.value.filter(b => mine.has(b.id)) : buildings.value   // 该户无挂表(或表未载入)时退到全部楼栋
  return bs.map(b => ({ value: String(b.id), label: b.name }))
})
const tenantOpts = computed(() => tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))
// 只能按月生效的键(照抄金额)不出「自 X 起长期」(后端 400 的镜像);默认生效方式按键取
const exModeOpts = computed(() => [
  { value: 'month', label: `仅 ${ym.value}` },
  ...(exDef.value?.monthOnly ? [] : [{ value: 'from', label: `自 ${ym.value} 起长期` }]),
])
function setExKey(key: string) {
  ex.value.key = key; ex.value.val = ''; ex.value.bid = ''
  ex.value.mode = paramDef(key)?.defaultMode ?? 'from'
}
// 配套写提示:「水管网维护费 = 0」/「电力管理费（商业）同值」
const exMates = computed(() => writePlan(ex.value.key).slice(1)
  .map(w => `${paramDef(w.key)?.label ?? w.key}${w.fixed != null ? ` = ${w.fixed}` : '同值'}`).join('、'))
function openEx() {
  ex.value = { tenantId: null, key: '', val: '', bid: '', mode: 'from', note: '' }
  setExKey(exKeyOpts[0]?.value ?? '')
  exTried.value = false
  exOpen.value = true
}
// 字段报错(LAYOUT-STABILITY §4.2):贴在字段下面、常驻占位,不弹窗、不走回执;点过一次「保存」才报,改好即消
const exTried = ref(false)
const exNum = computed(() => (ex.value.val.trim() === '' ? NaN : Number(ex.value.val)))
const exErr = computed(() => {
  const on = exTried.value, t = ex.value
  return {
    tenant: on && !t.tenantId ? '请选择租户' : '',
    val: on && !(exDef.value && Number.isFinite(exNum.value)) ? '请输入值' : '',
    bid: on && exByBuilding.value && !t.bid ? '请选择楼栋' : '',
  }
})
async function submitEx() {
  exTried.value = true
  const t = ex.value, d = exDef.value, v = exNum.value
  if (!t.tenantId || !d || !Number.isFinite(v) || exErr.value.bid) return   // 错已贴在字段下面
  const reqs = tenantExceptionReqs({ tenantId: t.tenantId, key: d.key, bid: t.bid ? Number(t.bid) : null, value: v, mode: t.mode, note: t.note.trim() || null }, ym.value)
  if (await putAll(reqs)) exOpen.value = false
}
// 深链协议同 gotoParams:KeepAlive 缓存实例只在 setup 消费 query,不换 epoch 就读不到
function gotoCoefBook() {
  tabs.openFresh('bill-notices', { pin: true })
  // 催缴单屏的 p 是催缴单月(收费月)= 本月 +1;它落期时折回本月,系数簿照旧开本月(billingChain「催缴单的月份」)
  router.push({ path: '/bill-notices', query: { p: noticeYmOf(ym.value), coef: '1' } })
}

// ── 闭环:重算本月(池 → 损耗 → 催缴单)/ 复制上月电价 ──
const busy = ref(false)
async function onRecalc() {
  // 写口自守:浏览态 / 参数没读到 一律打不出去(组头按钮的 busy 只是视觉)
  if (!canRecalc.value || loadErr.value) return
  // 从未生成过催缴单的月(spec §10.6):「重算」其实是首次生成;本月水电出在下个月的催缴单上(billingChain「催缴单的月份」)
  const at = ym.value
  const nym = noticeYmOf(at)
  const first = status.value && !status.value.billBatchAt
    ? `。注意：${nym} 尚无催缴单，本次将首次生成 ${nym} 的催缴单批次。` : '（已确认、已导出的户照旧跳过）。'
  if (!(await ask({
    title: `重算 ${at}？`,
    body: `将按当前参数重新生成 池核算 / 楼栋损耗 / ${nym} 的催缴单（${at} 水电 + ${nym} 租金）${first}`,
    action: '重算本月',
  }))) return
  // 等回答的这段时间里可能被接管、换了月 —— 再守一遍
  if (!canRecalc.value || loadErr.value || ym.value !== at) return
  busy.value = true
  try {
    const r = await paramsApi.recalc(ym.value)
    const done = `重算完成：池 ${r.pools} · 损耗单元 ${r.lossUnits} · 催缴单 ${r.notices}（跳过已确认 / 已导出 ${r.skippedConfirmed}）`
    // 警告说的是钱会摊丢 / 多摊少摊(AllocService.generate),用户必须读到 → 警告回执不自收,第一条原文照抄
    const ws = r.warnings
    if (!ws.length) receipt.ok(done)
    else if (ws.length === 1) receipt.warn(`${done}。警告：${ws[0]}`)
    else receipt.warn(`${done}。警告 ${ws.length} 条，第一条：${ws[0]}。其余 ${ws.length - 1} 条要到公共电核算重新生成本月才看得到。`)
    status.value = await paramsApi.status(ym.value)
    refreshChanges()
    // 生成改的正是矩阵格子上的点(池/损耗亮起、stale 清掉)—— 换出账月时要立刻看得见
    void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
  } catch (e) {
    receipt.fail(errMsg(e, '重算失败'), { label: '重试', run: () => void onRecalc() })
  } finally { busy.value = false }
}
// 跨月一键重算(§6-3:告警必须给得出一条点得到的清除路径)。纯前端编排:按月串行调已有 recalc,任一月失败即停
const batchDone = ref(0)
const batchTotal = ref(0)
async function onRecalcOthers() {
  if (!canRecalc.value) return
  const list = otherMonths.value.slice()
  if (!list.length || busy.value) return
  if (!(await ask({
    title: `重算这 ${list.length} 个月？`,
    body: `${list.join('、')} 将逐月按当前参数重新生成 池核算 / 楼栋损耗 / 催缴单（已确认、已导出的户照旧跳过）。`,
    action: `重算 ${list.length} 个月`,
  }))) return
  if (!canRecalc.value || busy.value) return   // 等回答时可能被接管 / 别处已经点了
  busy.value = true; batchTotal.value = list.length; batchDone.value = 0
  let failed = ''
  try {
    for (const m of list) {
      try { await paramsApi.recalc(m) } catch (e) { failed = `${m}（${errMsg(e, '重算失败')}）`; break }
      batchDone.value++
    }
  } finally {
    busy.value = false; batchTotal.value = 0
    await load()        // 刷新本月列表 + status —— 清干净的告警随之从入口上消失
    void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
  }
  if (failed) receipt.fail(`重算中断于 ${failed}${batchDone.value ? `；已完成 ${batchDone.value} 个月` : ''}`)
  else receipt.ok(`已重算 ${batchDone.value} 个月：${list.join('、')}`)
}
async function onCopy() {
  if (!editMode.value) return
  const at = ym.value
  if (!(await ask({
    title: `复制上月电价到 ${at}？`,
    body: '仅复制电价 6 个月变键的上月版本，目标月已有版本的键跳过、不覆盖。',
    action: '复制上月电价',
  }))) return
  if (!editMode.value || ym.value !== at) return   // 等回答时可能被接管、换了月 —— 不拿这次「确认」去写别的月
  busy.value = true
  try {
    const r = await paramsApi.copyPrev(at)
    await load()
    receipt.ok(`复制完成：新增 ${r.copied} 行，跳过已存在 ${r.skipped} 行。`)
  } catch (e) {
    receipt.fail(errMsg(e, '复制失败'), { label: '重试', run: () => void onCopy() })
  } finally { busy.value = false }
}

// ── 屏级告警:标题行「待处理」入口 + 贴着它的问题面板(LAYOUT-STABILITY-SPEC §6) ──
const alertOpen = ref(false)
const otherMonths = computed(() => status.value?.otherMonthsAffected ?? [])   // from 版本波及、快照更早的其它已生成月
const canRecalc = computed(() => canRun.value && editMode.value)   // 重算是写操作(浏览态零写入口)
// 组头动作:编辑态给动作本身;浏览态给「进入编辑模式」(拿锁可能要先过提权弹窗,不自动帮点);进不了编辑模式的人整组不出(§6-3)
function groupAction(label: string, run: () => void): AlertGroup['action'] {
  if (editMode.value) return { label, icon: 'refresh-cw', busy: busy.value || !!loadErr.value,
    busyLabel: loadErr.value ? '参数没读到，不能重算' : undefined, run }
  if (canEnter.value && !loadErr.value) return { label: '进入编辑模式', icon: 'pencil', run: () => { alertOpen.value = false; toggleEdit() } }
  return undefined
}
function gotoMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  period.pick(y, mo)                    // watch([ym, zone]) → load()
  alertOpen.value = false
}
const alertGroups = computed<AlertGroup[]>(() => {
  const s = status.value
  if (!s) return []
  const gs: AlertGroup[] = []
  // 过期来源分参数 / 抄表(METER-TIMELINE-SPEC §5):pendingChanges 只数参数,抄表只说改过、不数条数
  const srcs = staleSources(s)
  const hint = s.lastChangeAt ? `最近改动 ${hhmm(s.lastChangeAt)}` : undefined
  // 「改了 N 项参数」点开本月改动 —— 改了哪几项、谁改的都在那里(问题所在处)
  const showChanges = () => { alertOpen.value = false; setSec('changes') }
  const srcItems = [
    ...(srcs.includes('param') ? [{ text: `自上次重算起改了 ${s.pendingChanges} 项参数`, onClick: showChanges }] : []),
    ...(srcs.includes('meter') ? [{ text: '自上次重算起抄表数据（读数或表档案）有改动' }] : []),
  ].map((it, i) => (i === 0 ? { ...it, hint } : it))
  const recalc = groupAction('重算本月', () => void onRecalc())
  if (s.stale && recalc) gs.push({
    key: 'stale',
    title: '待重算',
    desc: `${staleWho(s)}改过，但池核算 / 楼栋损耗 / 催缴单还是改之前生成的 —— 屏上那些金额不会自己跟着变，`
      + '重算一次才对得上（已确认、已导出的户照旧跳过）。',
    items: srcItems,
    action: recalc,
  })
  const batch = groupAction(`一键重算这 ${otherMonths.value.length} 个月`, () => void onRecalcOthers())
  if (otherMonths.value.length && batch) gs.push({
    key: 'others',
    title: '其他月份受影响',
    desc: '这些月的快照也早于最近一次参数或抄表改动。「自某月起长期」的参数、从某月起改的表档案，改一次都会波及其后的月份，'
      + '不重算的话那几个月的池核算 / 催缴单还是老金额。',
    items: otherMonths.value.map((m, i) => ({
      text: m,
      hint: batchTotal.value
        ? (i < batchDone.value ? '已重算' : i === batchDone.value ? '重算中…' : '等待中')
        : '切到该月',
      onClick: batchTotal.value ? undefined : () => gotoMonth(m),
    })),
    action: batch,
  })
  return gs
})
const alertCount = computed(() => alertGroups.value.reduce((n, g) => n + (g.items.length || 1), 0))

// ── 公摊池窄宽固定列(LIST-PAGE §9.1,画布 10-B 板下注):池(名称列,≤ 可见宽 1/5,悬停看全称)→ 分摊基数;
//    合计超可见宽 40% 先退分摊基数。按整列文字估宽,不量 DOM;高度不分档(本页表在卡里滚,不贴底合计)
const wrapEl = ref<HTMLElement | null>(null)
const NO_H: HeightDims = { grpH: 0, leafH: 40, rowH: 40, footH: 0 }
const MARK_W = 64   // 「● 本月改」
const poolCols = computed<WideCol[]>(() => [
  { key: 'pool', side: 'L', rank: 0, name: true, minW: textW(['三个字'], 14, 24) + MARK_W,
    w: Math.max(textW(['池'], 12, 24), ...pools.value.map(o => { const n = poolLabel(o); return textW([`${n.loc} ${n.name}`], 14, 30) + (poolChanged(o) ? MARK_W : 0) })) },
  { key: 'coef', side: 'L', rank: 1,
    w: Math.max(textW(['分摊基数'], 12, 24), numW(pools.value.map(o => cellText(o.cells.coefficient)), 14, 24)) },
])
const { fix } = useWideTable(wrapEl, poolCols, NO_H, computed(() => ({ r: rows.value, z: zone.value })))
const colW = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
const poolSt = computed(() => (sec.value === 'pool' ? { ...colW(fix.value.w.pool), ...fix.value.style.pool } : undefined))
const coefSt = computed(() => (sec.value === 'pool' ? { ...colW(fix.value.w.coef), ...fix.value.style.coef } : undefined))

// 固定规则(只读;改它要改代码)—— 人话句子,不出现 Σ / ROUND
const FIXED_RULES = [
  '一期公摊分摊度数 = 园区公共电池当月净量合计 ÷ 均摊栋数（四舍五入到 2 位），各栋同值；分栋差异走「损耗调整度数」。',
  '收取损耗率按「损耗核算方式」三选一：按损耗量核算 = −(分表合计 − 总表 − 公摊分摊度数 − 调整度数) ÷ 分母 + 加点；仅按公摊分摊度数 = 公摊分摊度数 ÷ 分母 + 加点；不核算只列示用量。填了「损耗率（手工指定）」则直接用它。',
  '净额池先算净量再四舍五入一次；一期逐表四舍五入后再合计；二期按池一次四舍五入。',
  '分摊标准三式：金额 ÷ 分摊基数 / 用量 × 单价 ÷ 分摊基数 / 用量 ÷ 分摊基数，四舍五入位数按池设置；「分摊标准附加金额」加在算式值之后。',
  '尖段按「尖段按尖价计收比例」混价；电梯池首层不摊；固定月额户替换项：公共电费固定月额 = 楼层公共 + 电梯 + 路灯，公共水费固定月额 = 绿化水。',
  '损耗费计费基数按形态圈定费项；装机容量费按合同天数折算；建筑面积 = 租赁面积 × 0.8；率取 4 位、金额取 2 位。',
]
</script>

<template>
  <!-- ⓪ 没有期 → 出账月矩阵(五屏共用一张)。选过一次之后本会话不再出现,直落表格 -->
  <ChainMonthGate v-if="!period.picked" title="计费参数" icon="sliders-horizontal" />

  <!-- fp-fluid:摘 base.css 的 800px 屏级地板;宽档整页一屏、表在右卡里滚,960 以下目录叠在卡上面、整页往下滚 -->
  <div v-else-if="!rows" class="page-loading fp-fluid"><span class="page-spin" /></div>

  <div v-else class="pm-page fp-fluid">
    <FPLoadBar :on="veil" />
    <!-- 链路条:期写在这里,五道工序横跳不换期;编辑态不给「换出账月」(画布 10-B) -->
    <FPStepStrip :steps="chainSteps" current="params" :period="ym" :hide-back="editMode" @back="period.clear()" />

    <!-- 标题行:计费参数 + 页面状态签 + 期区 | 待处理 + 交审 + 编辑模式 -->
    <div class="pm-head">
      <div class="pm-head-l">
        <h2 class="pm-title">计费参数</h2>
        <FPStateTag v-for="t in stateTags" :key="t.text" :tone="t.tone">{{ t.text }}</FPStateTag>
        <Segmented :options="ZONE_OPTS" :model-value="zone" size="sm" @update:model-value="zone = $event as ParamZone" />
      </div>
      <div class="pm-actions">
        <!-- 屏级告警入口(§6):有无告警都渲染(无 → quiet 态「无待处理」),不挪版 -->
        <FPAlertPanel v-model:open="alertOpen" :count="alertCount" :groups="alertGroups" align="end" />
        <!-- 审核动作簇(§01):长在编辑按钮左边,编辑态里一颗不画(组件自己判) -->
        <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
        <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          :review-note="reviewNote" :review-tip="reviewTip" :disabled="!editMode && !!loadErr"
                          @toggle="toggleEdit()" />
      </div>
    </div>

    <!-- 加载失败(LAYOUT-STABILITY §3):换掉目录与当前区,一律带重试 —— 不留上一次读到的行,写入口随之不在 -->
    <FPLoadError v-if="loadErr" :sub="`${loadErr} · 屏上不显示上一次读到的参数`" @retry="load">
      {{ year }} 年 {{ month }} 月的计费参数没读到
    </FPLoadError>
    <div v-else class="pm-body">
      <!-- 左目录卡 -->
      <nav class="pm-nav" aria-label="计费参数分区">
        <label class="pm-nq" :class="{ miss: navMiss }" v-tip="navMiss ? '没有匹配的参数、池、栋或户' : null">
          <component :is="iconFor('search')" :size="13" />
          <input v-model="navQ" type="text" placeholder="搜参数 / 池 / 栋 / 户" @keydown.enter="navSearch" @input="navMiss = false" />
        </label>
        <button type="button" class="pm-ni" :class="{ on: sec === 'changes' }" :aria-current="sec === 'changes' ? 'true' : undefined" @click="setSec('changes')">
          <component :is="iconFor('history')" :size="14" class="i" />本月改动<span class="sp" /><span class="chg big">{{ stats.items.size }}</span>
        </button>
        <div class="pm-sep" />
        <button v-for="n in NAV" :key="n.sec" type="button" class="pm-ni" :class="{ on: sec === n.sec }"
                :aria-current="sec === n.sec ? 'true' : undefined" @click="setSec(n.sec)">
          {{ n.name }}<span class="sp" /><span v-if="navChg(n.sec)" class="chg">改 {{ navChg(n.sec) }}</span><span class="c">{{ navCount[n.sec] }}</span>
        </button>
        <div class="pm-sep" />
        <button v-for="n in NAV2" :key="n.sec" type="button" class="pm-ni" :class="{ on: sec === n.sec }"
                :aria-current="sec === n.sec ? 'true' : undefined" @click="setSec(n.sec)">
          {{ n.name }}<span class="sp" /><span v-if="navChg(n.sec)" class="chg">改 {{ navChg(n.sec) }}</span><span class="c">{{ navCount[n.sec] }}</span>
        </button>
      </nav>

      <!-- 右当前区卡 -->
      <section class="pm-card" :data-sec="sec">
        <ParamChangesDrawer v-if="sec === 'changes'" :open="true" :ym="ym" @jump="onJump" />
        <template v-else>
          <div class="pm-ch">
            <b class="pm-ct">{{ SEC_NAME[sec] }}</b>
            <span v-if="SEC_DESC[sec]" class="s">{{ SEC_DESC[sec] }}</span>
            <template v-if="sec === 'pool'">
              <label class="pm-search"><component :is="iconFor('search')" :size="13" /><input v-model="poolQ" type="text" placeholder="搜池名 / 位置" /></label>
              <Segmented :options="poolFOpts" :model-value="poolF" size="sm" @update:model-value="poolF = $event as F" />
              <span class="sp" /><span class="s">「–」= 没单独设置</span>
            </template>
            <template v-else-if="sec === 'loss'">
              <label class="pm-search"><component :is="iconFor('search')" :size="13" /><input v-model="lossQ" type="text" placeholder="搜楼栋" /></label>
              <Segmented :options="lossFOpts" :model-value="lossF" size="sm" @update:model-value="lossF = $event as F" />
              <span class="sp" /><span class="s">「默认」= 没单独设，按期级口径</span>
            </template>
            <template v-else-if="sec === 'tenant'">
              <label class="pm-search"><component :is="iconFor('search')" :size="13" /><input v-model="tenQ" type="text" placeholder="搜户名" /></label>
              <Segmented :options="tenFOpts" :model-value="tenF" size="sm" @update:model-value="tenF = $event as F" />
              <span class="sp" />
              <div v-if="editMode" class="pm-cardops">
                <Button variant="outline" size="sm" @click="openEx">
                  <template #leading><component :is="iconFor('plus')" :size="14" /></template>新增例外
                </Button>
                <Button variant="outline" size="sm" @click="gotoCoefBook">
                  <template #leading><component :is="iconFor('arrow-up-right')" :size="14" /></template>批量修改 → 系数簿
                </Button>
              </div>
            </template>
          </div>

          <div ref="wrapEl" class="pm-tw" data-stale-host :class="{ 'fp-stale': veil }" :aria-busy="veil" @animationend="flash = ''">
            <!-- 全园与期级 -->
            <table v-if="sec === 'park'" class="pm-table">
              <thead><tr><th>参数</th><th>范围</th><th class="r key gs">本月值</th><th class="gs">生效区间</th><th>来自</th><th class="hi"></th><th class="fp-fill" aria-hidden="true"></th></tr></thead>
              <tbody>
                <template v-for="g in parkGroups" :key="g.key">
                  <tr :id="`pm-grp-${g.key}`" class="pm-grp">
                    <td class="nm"><span class="nmw">
                      <button type="button" class="xp" :class="{ open: parkOpen[g.key] }" :aria-expanded="parkOpen[g.key]" :aria-label="parkOpen[g.key] ? '收起' : '展开'"
                              @click="parkOpen[g.key] = !parkOpen[g.key]"><component :is="iconFor('chevron-right')" :size="13" /></button>
                      <span class="t">{{ g.title }}</span><span class="bc">{{ g.rows.length }} 项 · {{ g.sub }}</span>
                    </span></td>
                    <td></td><td class="key gs"></td><td class="gs"></td>
                    <!-- 「复制上月电价」左对齐在来自列起点(画布 10-G);跨到填充列,进编辑态不把来自列撑宽 -->
                    <td colspan="3"><Button v-if="editMode && g.key === 'monthly'" variant="outline" size="sm" :disabled="busy" @click="onCopy">
                      <template #leading><component :is="iconFor('refresh-cw')" :size="13" /></template>复制上月电价
                    </Button></td>
                  </tr>
                  <template v-if="parkOpen[g.key]">
                    <tr v-for="r in g.rows" :id="rowDomId(r)" :key="itemKey(r.scope, r.key)" :class="{ hl: isHl(r), 'pm-flash': flashOn(r.scope, r.key) }">
                      <td class="nm l1"><span class="nmw"><span class="t" v-tip="tipOf(r)">{{ r.label }}</span><span v-if="changed(r)" class="mk"><i class="dot" />本月改</span></span></td>
                      <td>{{ r.scopeLabel }}</td>
                      <td class="n r key gs" :class="{ txt: isTxt(r), ed: editMode && r.editable, on: editing(r) }" @click="openEdit(r, $event)">
                        <template v-if="hit(r)"><span v-tip="valTip(r)">{{ valText(r) }}</span><span v-if="unitOf(r)" class="u">{{ unitOf(r) }}</span></template>
                        <span v-else-if="editMode && r.editable" class="pm-set"><span class="dim">–</span><span class="b"><component :is="iconFor('plus')" :size="12" />设置</span></span>
                        <span v-else class="dim">–</span>
                      </td>
                      <td class="gs">
                        <span class="tags">
                          <Badge v-if="hit(r)" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ r.rangeText }}</Badge>
                          <Badge v-if="unchecked(r)" tone="orange" :dot="false">未核对</Badge>
                          <Badge v-if="missing(r)" tone="orange" :dot="false">缺</Badge>
                        </span>
                      </td>
                      <td class="mut" v-tip="chainTitle(r)">{{ sourceLabel(r) }}</td>
                      <td class="hi"><button type="button" class="pm-ib" v-tip="'历史'" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button></td>
                      <td class="fp-fill" aria-hidden="true"></td>
                    </tr>
                  </template>
                </template>
              </tbody>
            </table>

            <!-- 公摊池:一池一行 -->
            <template v-else-if="sec === 'pool'">
              <FPEmpty v-if="!poolShown.length" size="sm">{{ pools.length ? '没有符合条件的池' : '本期区没有公摊池' }}</FPEmpty>
              <table v-else class="pm-table">
                <thead><tr>
                  <th class="fix" :style="poolSt">池</th><th>期</th>
                  <th class="r gs">加减度数<span class="mo">按月</span></th><th class="r">手工用量<span class="mo">按月</span></th>
                  <th class="r key gs fix" :style="coefSt">分摊基数</th><th class="r">附加金额（元）</th><th class="r">指定单价（元/度）</th><th class="r">小数位</th>
                  <th class="hi"></th><th class="fp-fill" aria-hidden="true"></th>
                </tr></thead>
                <tbody>
                  <tr v-for="o in poolShown" :id="`pm-row-${o.scope}`" :key="o.scope" :class="{ 'pm-flash': flashOn(o.scope, '') }">
                    <td class="nm fix" :style="poolSt"><span class="nmw">
                      <span class="t" v-tip="`${poolLabel(o).loc} ${poolLabel(o).name}`"><span class="loc">{{ poolLabel(o).loc }}</span>{{ poolLabel(o).name }}</span>
                      <span v-if="poolChanged(o)" class="mk"><i class="dot" />本月改</span>
                    </span></td>
                    <td>{{ zoneName(ruleZone.get(o.id)) }}</td>
                    <td v-for="k in POOL_KEYS" :key="k" class="n r" :style="k === 'coefficient' ? coefSt : undefined"
                        :class="{ key: k === 'coefficient', fix: k === 'coefficient', gs: k === 'extra_qty' || k === 'coefficient' || k === 'std_add',
                                  ed: editMode && o.cells[k]?.editable, on: editing(o.cells[k]), 'pm-flash': flashOn(o.scope, k) }"
                        @click="openEdit(o.cells[k], $event)">
                      <template v-if="cellText(o.cells[k])">
                        <button v-if="baseRefLabel(o.cells[k])" type="button" class="pm-ln" v-tip="`取自「${baseRefLabel(o.cells[k])}」`"
                                @click.stop="gotoBaseRow(o.cells[k])">{{ cellText(o.cells[k]) }}</button>
                        <template v-else>{{ cellText(o.cells[k]) }}</template>
                      </template>
                      <span v-else-if="editMode && o.cells[k]?.editable" class="pm-set"><span class="dim">–</span><span class="b"><component :is="iconFor('plus')" :size="12" />设置</span></span>
                      <span v-else class="dim">–</span>
                    </td>
                    <td class="hi"><button type="button" class="pm-ib" v-tip="'历史'" @click="histRow = o.cells.coefficient ?? null"><component :is="iconFor('history')" :size="14" /></button></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                </tbody>
              </table>
            </template>

            <!-- 楼栋损耗:一栋一行 -->
            <template v-else-if="sec === 'loss'">
              <FPEmpty v-if="!lossShown.length" size="sm">{{ losses.length ? '没有符合条件的楼栋' : '本期区没有要设损耗的楼栋' }}</FPEmpty>
              <table v-else class="pm-table">
                <thead><tr>
                  <th>楼栋</th><th>期</th>
                  <th class="r key gs">调整度数<span class="mo">按月</span></th><th class="r">手工损耗率<span class="mo">按月</span></th><th class="r">损耗率加点</th>
                  <th class="gs">损耗核算方式</th><th>总表取数</th><th>损耗核算归组</th><th>供电局对账</th><th class="gs">不计入楼栋合计的表</th>
                  <th class="hi"></th><th class="fp-fill" aria-hidden="true"></th>
                </tr></thead>
                <tbody>
                  <tr v-for="o in lossShown" :id="`pm-row-${o.scope}`" :key="o.scope" :class="{ 'pm-flash': flashOn(o.scope, '') }">
                    <td class="nm"><span class="nmw"><span class="t">{{ stripPhase(o.label) }}</span><span v-if="lossChanged(o)" class="mk"><i class="dot" />本月改</span></span></td>
                    <td>{{ zoneName(bldZone.get(o.id)) }}</td>
                    <td v-for="k in LOSS_KEYS" :key="k" :class="{
                          n: k === 'loss_adj_qty' || k === 'loss_rate_manual' || k === 'loss_adj_rate',
                          r: k === 'loss_adj_qty' || k === 'loss_rate_manual' || k === 'loss_adj_rate',
                          key: k === 'loss_adj_qty', gs: k === 'loss_adj_qty' || k === 'loss_variant',
                          ed: editMode && o.cells[k]?.editable, on: editing(o.cells[k]), 'pm-flash': flashOn(o.scope, k) }"
                        @click="openEdit(o.cells[k], $event)">
                      <template v-if="k === 'loss_adj_qty' || k === 'loss_rate_manual' || k === 'loss_adj_rate'">
                        <template v-if="cellText(o.cells[k])">{{ cellText(o.cells[k]) }}</template>
                        <span v-else-if="editMode && o.cells[k]?.editable" class="pm-set"><span class="dim">–</span><span class="b"><component :is="iconFor('plus')" :size="12" />设置</span></span>
                        <span v-else class="dim">–</span>
                      </template>
                      <template v-else>
                        <template v-if="own(o.cells[k])">{{ cellText(o.cells[k]) }}</template>
                        <span v-else class="dft">默认</span>
                      </template>
                    </td>
                    <td class="gs" :class="{ 'pm-flash': flashOn(o.scope, 'loss_exclude') }">
                      <span class="chipw">
                        <button v-for="r in exclOf(o)" :key="r.scope" type="button" class="chipm" :class="{ off: !r.value, on: editing(r) }"
                                v-tip="`${r.valueText} · ${r.rangeText}`" @click="editMode ? openEdit(r, $event) : (histRow = r)">
                          {{ r.scopeLabel.replace(/（表）$/, '') }}<template v-if="!r.value">（本月计入）</template>
                        </button>
                        <button v-if="editMode" type="button" class="pm-add" :class="{ on: exclBid === o.id }" v-tip="'添加不计入的表'" @click="openExcl(o, $event)">
                          <component :is="iconFor('plus')" :size="12" />
                        </button>
                        <span v-if="!exclOf(o).length && !editMode" class="dim">–</span>
                      </span>
                    </td>
                    <td class="hi"><button type="button" class="pm-ib" v-tip="'历史'" @click="histRow = o.cells.loss_adj_qty ?? null"><component :is="iconFor('history')" :size="14" /></button></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                </tbody>
              </table>
            </template>

            <!-- 户级例外:按户分组 -->
            <template v-else-if="sec === 'tenant'">
              <FPEmpty v-if="!groups.length" size="sm" sub="全部租户按期 / 全园默认值计价">暂无户级例外</FPEmpty>
              <FPEmpty v-else-if="!tenShown.length" size="sm">没有符合条件的户</FPEmpty>
              <table v-else class="pm-table">
                <thead><tr><th>户 / 参数</th><th class="r key gs">值</th><th class="gs">生效区间</th><th>覆盖了</th><th class="hi"></th><th class="hi"></th><th class="fp-fill" aria-hidden="true"></th></tr></thead>
                <tbody>
                  <template v-for="g in tenShown" :key="g.scope">
                    <tr :id="`pm-row-${g.scope}`" class="pm-grp" :class="{ 'pm-flash': flashOn(g.scope, '') }">
                      <td class="nm"><span class="nmw">
                        <button type="button" class="xp" :class="{ open: tenIsOpen(g.scope) }" :aria-expanded="tenIsOpen(g.scope)" :aria-label="tenIsOpen(g.scope) ? '收起' : '展开'"
                                @click="toggleTen(g.scope)"><component :is="iconFor('chevron-right')" :size="13" /></button>
                        <span class="t">{{ g.name }}</span><span class="bc">{{ zoneName(tenantZone.get(g.id)) ? `${zoneName(tenantZone.get(g.id))} · ` : '' }}{{ g.rows.length }} 项</span>
                      </span></td>
                      <td class="key gs"></td><td class="gs"></td><td></td><td class="hi"></td><td class="hi"></td><td class="fp-fill" aria-hidden="true"></td>
                    </tr>
                    <template v-if="tenIsOpen(g.scope)">
                      <tr v-for="r in g.rows" :id="rowDomId(r)" :key="itemKey(r.scope, r.key)" :class="{ 'pm-flash': flashOn(r.scope, r.key) }">
                        <td class="nm l1"><span class="nmw"><span class="t" v-tip="tipOf(r)">{{ r.label }}<span v-if="r.unit" class="u">{{ r.unit }}</span></span><span v-if="changed(r)" class="mk"><i class="dot" />本月改</span></span></td>
                        <td class="n r key gs" :class="{ txt: isTxt(r), ed: editMode && r.editable, on: editing(r) }" @click="openEdit(r, $event)">{{ bare(r) }}</td>
                        <td class="gs"><Badge :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ r.rangeText }}</Badge></td>
                        <td class="mut" v-tip="chainTitle(r)">{{ covered(r) }}</td>
                        <td class="hi"><button v-if="editMode" type="button" class="pm-ib danger" v-tip="'删除例外'" @click="delTenantRow(r)"><component :is="iconFor('trash-2')" :size="14" /></button></td>
                        <td class="hi"><button type="button" class="pm-ib" v-tip="'历史'" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button></td>
                        <td class="fp-fill" aria-hidden="true"></td>
                      </tr>
                    </template>
                  </template>
                </tbody>
              </table>
            </template>

            <!-- 光伏分栋判据 -->
            <template v-else-if="sec === 'pv'">
              <FPEmpty v-if="!pvRows.length" size="sm">没有光伏分栋判据</FPEmpty>
              <table v-else class="pm-table">
                <thead><tr><th>参数</th><th class="r key gs">值</th><th class="gs">生效区间</th><th>来自</th><th class="hi"></th><th class="fp-fill" aria-hidden="true"></th></tr></thead>
                <tbody>
                  <tr v-for="r in pvRows" :id="rowDomId(r)" :key="itemKey(r.scope, r.key)" :class="{ hl: isHl(r), 'pm-flash': flashOn(r.scope, r.key) }">
                    <td class="nm"><span class="nmw"><span class="t" v-tip="tipOf(r)">{{ r.label }}</span><span v-if="changed(r)" class="mk"><i class="dot" />本月改</span></span></td>
                    <td class="n r key gs" :class="{ ed: editMode && r.editable, on: editing(r) }" @click="openEdit(r, $event)">
                      <template v-if="hit(r)">{{ bare(r) }}<span v-if="unitOf(r)" class="u">{{ unitOf(r) }}</span></template>
                      <span v-else-if="editMode && r.editable" class="pm-set"><span class="dim">–</span><span class="b"><component :is="iconFor('plus')" :size="12" />设置</span></span>
                      <span v-else class="dim">–</span>
                    </td>
                    <td class="gs"><Badge v-if="hit(r)" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ r.rangeText }}</Badge></td>
                    <td class="mut" v-tip="chainTitle(r)">{{ sourceLabel(r) }}</td>
                    <td class="hi"><button type="button" class="pm-ib" v-tip="'历史'" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                </tbody>
              </table>
            </template>

            <!-- 固定规则(只读) -->
            <ol v-else class="pm-fx"><li v-for="(t, i) in FIXED_RULES" :key="i">{{ t }}</li></ol>
          </div>
        </template>
      </section>
    </div>

    <FPElevateDialog
      :page="`计费参数 · ${ym}`" :action="'修改计费口径 / 月度录入'" :perms="asking" what="修改计费口径" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`计费参数 ${ym}`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />

    <ParamEditPopover :open="!!editRow" :row="editRow" :ym="ym" :ref-options="refOptions" :anchor="editAnchor" :meter-pick="exclPick"
                      @close="closeEdit" @save="onSave" />
    <ParamHistoryDrawer :open="!!histRow" :row="histRow" :ym="ym" @close="histRow = null" />

    <!-- 户级例外 · 新增 -->
    <FPDrawer :open="exOpen" title="新增户级例外" :subtitle="`账期 ${ym}；只影响该户，覆盖期 / 全园默认值`" icon="plus" :width="520" @close="exOpen = false">
      <div class="pm-exform">
        <label class="pm-exfield"><span class="k">租户</span><FPTenantPicker v-model="ex.tenantId" :tenants="tenantOpts" placeholder="搜索并选择租户" :invalid="!!exErr.tenant" />
          <span class="fp-field-err">{{ exErr.tenant }}</span></label>
        <label class="pm-exfield"><span class="k">参数</span><Select :options="exKeyOpts" :model-value="ex.key" size="sm" @update:model-value="setExKey($event)" /></label>
        <label v-if="exByBuilding" class="pm-exfield">
          <span class="k">楼栋（该户所在损耗组的任一成员栋）</span>
          <Select :options="exBuildingOpts" :model-value="ex.bid" size="sm" placeholder="请选择楼栋" :invalid="!!exErr.bid" @update:model-value="ex.bid = $event" />
          <span class="fp-field-err">{{ exErr.bid }}</span>
        </label>
        <label class="pm-exfield">
          <span class="k">值<span v-if="exDef?.unit" class="pm-unit">{{ exDef.unit }}</span></span>
          <Select v-if="exPickable" :options="exValOpts" :model-value="ex.val" size="sm" placeholder="请选择" :invalid="!!exErr.val" @update:model-value="ex.val = $event" />
          <input v-else :value="ex.val" class="pm-exin" :class="{ bad: !!exErr.val }" type="number" step="any" placeholder="请输入数字"
                 @input="ex.val = ($event.target as HTMLInputElement).value" />
          <span class="fp-field-err">{{ exErr.val }}</span>
          <!-- 提示位常驻:换参数键时有无 hint 都不许顶走下面的「生效方式」和页脚按钮(LAYOUT-STABILITY-SPEC §4.2) -->
          <span class="pm-exhint"><template v-if="exDef?.hint">{{ exDef.hint }}</template></span>
        </label>
        <label class="pm-exfield"><span class="k">生效方式</span><Segmented :options="exModeOpts" :model-value="ex.mode" size="sm" @update:model-value="ex.mode = $event as ParamMode" /></label>
        <label class="pm-exfield"><span class="k">备注</span><input v-model="ex.note" class="pm-exin txt" type="text" placeholder="来源 / 依据" /></label>
        <p v-if="exMates" class="pm-exhint">配套同写：{{ exMates }}。</p>
      </div>
      <template #footer>
        <Button variant="outline" size="sm" @click="exOpen = false">取消</Button>
        <Button variant="filled" size="sm" @click="submitEx">保存</Button>
      </template>
    </FPDrawer>
  </div>
</template>

<style scoped>
/* 整页一屏:标题行以下是「左目录 + 右当前区」,表在右卡里滚(画布 10-A,ParamLongNow「改后 1 屏」) */
.pm-page { position: relative; display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%;
  /* 本月值 / 值 / 分摊基数 / 调整度数这类「看它」的列:照公共电核算钱列的底(PoolLedgerView --money-cell),不透明 —— 固定列压着别的格横滚 */
  --pm-key: color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white));
  --pm-key-grp: color-mix(in srgb, var(--pm-key) 40%, var(--surface-card)); }

.pm-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pm-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pm-title { margin: 0 6px 0 0; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pm-actions { display: flex; align-items: center; gap: 8px; }

.pm-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 248px minmax(0, 1fr); gap: 16px; align-items: start; }

/* 左目录卡(画布 .p10-nav):沉底灰卡,当前项浮起成白片 */
.pm-nav { display: flex; flex-direction: column; gap: 2px; max-height: 100%; overflow-y: auto; box-sizing: border-box; border-radius: 12px; background: var(--surface-card); padding: 8px; }
.pm-nq { display: flex; align-items: center; gap: 8px; height: 32px; margin: 0 0 6px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-control); border-radius: var(--radius-full); background: var(--surface-white); color: var(--text-muted); flex: 0 0 auto; }
.pm-nq:focus-within { border-color: var(--hue-blue); }
.pm-nq.miss { border-color: var(--status-danger); }
.pm-nq input { flex: 1 1 auto; min-width: 0; border: none; outline: none; background: transparent; font-family: var(--font-sans); font-size: 12px; color: var(--text-primary); }
.pm-ni { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 10px; flex: 0 0 auto; border: none; border-radius: 8px; background: transparent; font-family: var(--font-sans); font-size: 14px; color: var(--text-secondary); white-space: nowrap; text-align: left; cursor: pointer; }
.pm-ni:hover { background: var(--bg-hover); }
.pm-ni:focus-visible { outline: 2px solid var(--hue-blue); outline-offset: -2px; }
/* 当前项:字重靠合成粗体会撑宽 —— 用阴影与底色浮起,字重照抄画布(600),项本身是整行宽,不挤别的 */
.pm-ni.on { background: var(--surface-white); color: var(--text-primary); font-weight: var(--fw-semibold); box-shadow: var(--shadow-sm), 0 0 0 1px var(--border-subtle); }
.pm-ni .i { color: var(--text-muted); }
.pm-ni .sp { flex: 1; }
.pm-ni .c { font: 12px var(--font-mono); color: var(--text-muted); font-weight: var(--fw-regular); }
.pm-ni .chg { font: 600 11px/16px var(--font-mono); color: var(--info-text-on-tint); background: var(--info-soft); border-radius: var(--radius-full); padding: 0 7px; }
.pm-ni .chg.big { font-size: 12px; line-height: 18px; }
.pm-sep { height: 1px; background: var(--divider); margin: 6px 10px; flex: 0 0 auto; }

/* 右当前区卡(画布 .p10-card) */
.pm-card { container-type: inline-size; align-self: stretch; min-height: 0; display: flex; flex-direction: column; border-radius: 12px; box-shadow: 0 0 0 1px var(--border-subtle); overflow: hidden; background: var(--surface-white); }
/* 窄了先缩搜索框(1366 侧栏展开卡宽约 683,楼栋损耗卡头刚好放下);卡再窄(< 680)才折行 —— 图例一个字都不截 */
.pm-ch { flex: 0 0 auto; display: flex; align-items: center; gap: 8px 10px; min-height: 52px; box-sizing: border-box; padding: 0 12px 0 16px; border-bottom: 1px solid var(--divider); }
@container (max-width: 679px) { .pm-ch { flex-wrap: wrap; padding-top: 8px; padding-bottom: 8px; } }
.pm-ct { font-size: 16px; font-weight: var(--fw-semibold); white-space: nowrap; color: var(--text-primary); }
.pm-ch .s { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 图例(「–」= 没单独设置)一个字都不省:窄了先缩搜索框 */
.pm-ch .sp + .s { flex: none; overflow: visible; }
.pm-ch .sp { flex: 1; }
.pm-search { display: inline-flex; align-items: center; gap: 6px; flex: 0 1 200px; min-width: 88px; height: 28px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-full); color: var(--text-muted); }
.pm-search:focus-within { border-color: var(--hue-blue); }
.pm-search input { flex: 1 1 auto; min-width: 0; border: none; outline: none; background: transparent; font-family: var(--font-sans); font-size: 12px; color: var(--text-primary); }
.pm-cardops { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.pm-tw { flex: 1 1 auto; min-height: 0; overflow: auto; }

/* 表(画布 .r9-t):表头 40 贴顶,行 40,14px;key 列浅蓝底 + 表头下蓝线;行末 .fp-fill 吃余宽;任何文字不截断(池名封顶时省略 + 悬停看全称) */
.pm-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; font-family: var(--font-sans); }
.pm-table th { position: sticky; top: 0; z-index: 2; height: 40px; padding: 0 12px; background: var(--surface-card); font-size: 12px; font-weight: var(--fw-medium); color: var(--text-muted); text-align: left; white-space: nowrap; border-bottom: 1px solid var(--divider); }
.pm-table td { height: 40px; padding: 0 12px; border-bottom: 1px solid var(--divider); white-space: nowrap; color: var(--text-primary); background: var(--surface-white); }
.pm-table .r { text-align: right; }
.pm-table td.n { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pm-table td.mut { color: var(--text-muted); }
.pm-table td.key, .pm-table th.key { background: var(--pm-key); }
.pm-table th.key { color: var(--text-secondary); background: var(--surface-card); box-shadow: inset 0 -2px 0 var(--hue-blue); }
.pm-table td.key { font-weight: var(--fw-semibold); }
.pm-table td.key.txt { font-family: var(--font-sans); font-weight: var(--fw-medium); }
/* 分组竖线:长写,jsdom 解析不了带 var() 的简写 */
.pm-table .gs { box-shadow: inset 1px 0 0 var(--divider); }
.pm-table th.key.gs { box-shadow: inset 1px 0 0 var(--divider), inset 0 -2px 0 var(--hue-blue); }
.pm-table td.nm { padding-right: 28px; }
.pm-table td.nm.l1 { padding-left: 40px; }
.pm-table .nmw { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pm-table .nmw .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pm-table .nmw .bc { flex: none; font-weight: var(--fw-regular); font-size: 12px; color: var(--text-muted); }
.pm-table .loc { margin-right: 6px; color: var(--text-muted); }
.pm-table .u { margin-left: 4px; font: 400 12px var(--font-sans); color: var(--text-muted); }
.pm-table .mo { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; margin-left: 6px; border-radius: 4px; background: var(--warn-soft); color: var(--orange-text); font-size: 10.5px; font-weight: var(--fw-medium); vertical-align: 1px; }
.pm-table .mk { display: inline-flex; align-items: center; gap: 4px; flex: none; margin-left: 2px; font-size: 12px; font-weight: var(--fw-medium); color: var(--info-text-on-tint); white-space: nowrap; }
.pm-table .mk .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pm-table .dim { color: var(--text-disabled); font-weight: var(--fw-regular); }
.pm-table td.dft, .pm-table .dft { color: var(--text-muted); }
.pm-table .tags { display: inline-flex; gap: 6px; }
.pm-table th.hi, .pm-table td.hi { width: 36px; padding: 0 6px; text-align: center; }
.pm-table tr.pm-grp td { background: var(--surface-card); font-weight: var(--fw-semibold); }
.pm-table tr.pm-grp td.key { background: var(--pm-key-grp); }
.pm-table tbody tr:not(.pm-grp):hover td:not(.key) { background: var(--surface-card); }
.pm-table tbody tr.hl td { background: rgb(255, 250, 225); }
:root[data-theme="dark"] .pm-table tbody tr.hl td { background: var(--caution-soft); }
/* 编辑态:能点的值格 = 光标 + 悬停描边;打开改值卡的那一格蓝框(画布 .p10-focus);
   空格平时同浏览态写「–」(卡头图例对得上),悬停 / 正在改换成「+ 设置」虚线 —— 两者叠在同一格位,宽高不随悬停变 */
.pm-table td.ed { cursor: pointer; }
.pm-table td.ed:hover { box-shadow: inset 0 0 0 1px var(--border-strong); }
.pm-table td.on { box-shadow: inset 0 0 0 2px var(--hue-blue); background: var(--info-soft); }
.pm-set { display: inline-grid; align-items: center; vertical-align: middle; }
.pm-set > * { grid-area: 1 / 1; }
.pm-set .b { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 6px; border: 1px dashed var(--border-strong); font: 12px var(--font-sans); color: var(--text-secondary); visibility: hidden; }
.pm-table td.ed:hover .pm-set .b, .pm-table td.on .pm-set .b { visibility: visible; }
.pm-table td.ed:hover .pm-set .dim, .pm-table td.on .pm-set .dim { visibility: hidden; }
/* 闪一下(深链 / 本月改动点行 / 目录搜索):蓝框 + 浅蓝底,褪回原样 */
.pm-table .pm-flash, .pm-table tr.pm-flash td { animation: pm-flash var(--dur-highlight) var(--ease-standard); }
@keyframes pm-flash { from { box-shadow: inset 0 0 0 2px var(--hue-blue); background: var(--info-soft); } }
/* 公摊池固定列:position/left 由 useWideTable 的内联样式给,这里只管叠放 */
.pm-table td.fix { z-index: 1; }
.pm-table th.fix { z-index: 3; }
.pm-table td.nm.fix { overflow: hidden; }
.pm-ln { padding: 0; border: none; background: none; font: inherit; color: var(--text-link); cursor: pointer; }
.pm-ln:hover { text-decoration: underline; }
.xp { width: 22px; height: 22px; margin-left: -4px; padding: 0; flex: none; border: 0; border-radius: 6px; background: transparent; color: var(--text-muted); display: inline-grid; place-items: center; cursor: pointer; }
.xp:hover { background: var(--bg-hover); color: var(--text-primary); }
.xp svg { transition: transform var(--dur-fast) var(--ease-standard); }
.xp.open svg { transform: rotate(90deg); }
.pm-ib { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; vertical-align: middle; }
.pm-ib:hover { background: var(--bg-hover); color: var(--text-primary); }
.pm-ib.danger { color: var(--hue-red); }
.pm-ib.danger:hover { background: var(--danger-soft); }
/* 不计入楼栋合计的表:格内签 + 编辑态「+」(画布 10-E) */
.chipw { display: flex; align-items: center; gap: 4px; }
.chipm { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border: none; border-radius: var(--radius-full); background: var(--ink-050); font-family: var(--font-sans); font-size: 12px; color: var(--text-secondary); white-space: nowrap; cursor: pointer; }
.chipm.off { color: var(--text-muted); }
.chipm.on { box-shadow: 0 0 0 2px var(--hue-blue); }
.pm-add { display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border-radius: 6px; border: 1px dashed var(--border-strong); background: transparent; color: var(--text-muted); cursor: pointer; flex: none; }
.pm-add:hover, .pm-add.on { border-color: var(--hue-blue); color: var(--hue-blue); }

/* 固定规则(画布 .p10-fx) */
.pm-fx { margin: 0; padding: 12px 20px 14px 34px; font-size: 13px; line-height: 21px; color: var(--text-secondary); }
.pm-fx li { margin-bottom: 4px; }

/* 户级例外 · 新增表单 */
.pm-unit { margin-left: 6px; font-size: var(--fs-micro); color: var(--text-disabled); font-weight: var(--fw-regular); }
.pm-exform { display: flex; flex-direction: column; gap: 14px; }
.pm-exfield { display: flex; flex-direction: column; gap: 6px; }
.pm-exfield .k { font-size: var(--fs-label); color: var(--text-secondary); font-weight: var(--fw-medium); }
.pm-exin { height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); outline: none; }
.pm-exin.txt { font-family: var(--font-sans); }
.pm-exin:focus { border-color: var(--hue-blue); }
.pm-exin.bad { border-color: var(--status-danger); }
.pm-exin::-webkit-outer-spin-button, .pm-exin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pm-exhint { margin: 0; font-size: var(--fs-micro); color: var(--text-muted); line-height: 16px; min-height: 16px; }

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.4 查看态):960 以下目录叠到当前区上面,整页往下滚;卡头折行 ── */
@media (max-width: 960px) { /* M↓ */
  .pm-page { height: auto; }
  .pm-body { grid-template-columns: minmax(0, 1fr); }
  .pm-nav { max-height: none; }
  .pm-tw { max-height: 70vh; }
}
</style>
