<script setup lang="ts">
// 计费参数(S21-PARAM-CENTER-SPEC §5)— 数据中心·出账链组,取代价目管理。tenant_price_cfg + alloc_cfg 两表参数的**同一读写口**:
// 站在账期看的全部生效参数分四区(① 本月参数 ② 长期常数 ③ 核算口径 ④ 户级例外)+ ⑤ 固定规则只读区;
// 每行=人话(作用范围/值/生效区间/来自 = 命中链尾)由后端 GET /api/params 解析,本页只分组渲染(utils/paramCenterLogic)。
// 编辑态(EDIT-MODE-SPEC v2:浏览态零写入口;onDeactivated 复位)每行 [修改] → ParamEditPopover(值 | 生效方式 | 备注)→ PUT /api/params
// → 成功只 patch 该行(WRITE-KEEP-CONTEXT 铁律二)→ [重算本月](池 → 损耗 → 催缴单)闭环(spec §5.5)。
// 状态条只报中性事实(电价 n/6 · 快照生成时间);「快照过期 / 其他月份受影响」走工具条上的常驻告警 chip + 右侧抽屉
// (LAYOUT-STABILITY-SPEC §6),抽屉里给「重算本月」与跨月「一键重算这 N 个月」两条清除路径。
// ①② 无命中的对象级行(栋/池/表,未设置)默认折叠(一期 2024-02 有 480+ 行,只 60 来行有值),按区展开;全园/期级月核对项常显并标「缺」;
// ③ 口径行无命中=默认语义,始终全列;④ 只列该户自己的版本行(rowId 非空,继承上级的不算例外)。
// 首载加载门 + ++seq 竞态守卫;LIST-PAGE-SPEC 行高 --mx-row-h 56px;表格 table-layout:auto —— 用户可见文字一律不截断
// (参数 / 作用范围 / 来自 三列两行内换行且给 min-width、单位另起小灰字;值 / 区间 nowrap 按内容撑开;说明列三行 line-clamp + 完整 title;宽了横向滚动)。
import { ref, computed, onMounted, onDeactivated, watch, nextTick } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { paramsApi, type ParamPutReq, type ParamRowDTO, type ParamStatusDTO, type ParamZone } from '@/api/params'
import { allocApi, type AllocRuleDTO } from '@/api/alloc'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { useChainDeepPeriod } from '@/composables/useDeepPeriod'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import { metersApi, type MeterDTO } from '@/api/meters'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import {
  baseRefLabel, groupRows, rangeBadge, sourceLabel, tenantExceptionDelReqs, tenantExceptionReqs,
  type ParamRow, type RuleGroup,
} from '@/utils/paramCenterLogic'
import { LOSS_BASE_FORM_B_TEMPLATE, PARAM_DEFS, paramDef, writePlan, type ParamMode } from '@/utils/paramRegistry'
import { useAuthStore } from '@/stores/auth'
import { useZonesStore } from '@/stores/zones'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { chainStepsOf } from '@/nav/billingChain'
import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import Badge from '@/components/ds/Badge.vue'
import FPAlertChip from '@/components/fp/FPAlertChip.vue'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import ParamEditPopover, { type RefOption } from './ParamEditPopover.vue'
import ParamHistoryDrawer from './ParamHistoryDrawer.vue'
import ParamChangesDrawer from './ParamChangesDrawer.vue'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import FPToast from '@/components/fp/FPToast.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'

const auth = useAuthStore()
// RBAC:① 区是月度录入(每月照抄供电局账单),②③④ 区是长期计费口径,重算是跑一次出账 —— 三扇门
const canRun = computed(() => auth.can('billing-run:edit'))
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
const idOf = (scope: string) => Number(scope.slice(scope.indexOf(':') + 1))

// ── 编辑模式(EDIT-MODE-SPEC v3):切页签保留编辑态,只关浮层 ──
// ① 区月度录入(照抄供电局账单)、②③④ 区长期计费口径、重算 —— 三档权限在点「编辑模式」时一次要齐:
// 缺任何一档当场弹主管授权窗(ELEVATION-SPEC),取消 = 什么都没发生,留在浏览态。
// 于是**进得了编辑态就一定齐**,四个区的写入口在编辑态直接可用,不再有「点了转成授权请求」的包装。
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken } =
  useEditMode(['param-monthly:edit', 'param-policy:edit', 'billing-run:edit'], {
    scope: () => S.paramCenter(year.value, month.value),
    // 审核键(§7.1):计费参数每月一把。ym 为空 = 还在选期门,没有月可审。
    reviewKey: () => (ym.value ? `params:${ym.value}` : null),
  })
onDeactivated(() => {
  editRow.value = null; exOpen.value = false; addExcl.value = null
  histRow.value = null; changesOpen.value = false; alertOpen.value = false   // 抽屉 Teleport 到 body,KeepAlive 停用不随实例移出
})
// 编辑态**就地**转假(被接管 / 30 分钟提权到期)也要关写 UI —— 它们的 v-if 只判自己的 ref,
// 不判编辑态:改参数的浮层、新增例外的抽屉留在屏上,里面的保存照样 PUT(同 MeterView:162)。
watch(editMode, v => {
  if (v) return
  editRow.value = null
  exOpen.value = false
  addExcl.value = null
})

// ── 账期:出账链组级(stores/billingPeriod,2026-08-28 设计稿 §3.1) ──
// 顶栏那对年月 Select 已撤 —— 期由出账月矩阵一处选定,五屏共读一份,不可能再各落各的
// (它们抢的本来就是同一把 billing-chain 月锁)。「默认账期」那一整套
// (xxxApi.years() + /months + latestPeriodOf 的 snap)随之退场:期一定是用户在矩阵上点出来的,
// 没有「系统替你猜一个月」这回事 —— 那正是 §7-1 禁的「顺手落进某个期」。
const period = useBillingPeriodStore()
const year = computed(() => period.year ?? 0)
const month = computed(() => period.month ?? 0)
const ym = computed(() => period.ym ?? '')
// 链路条:本月各道工序走到哪(与矩阵格子同一份数据)
const chainSteps = computed(() => chainStepsOf(period.cellOf(ym.value)))
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM(或旧 ?ym=)直落该月,pick + loadChain;本屏逐行即时写库、无草稿,不传 dirty;?zone / ?section / ?rule / ?edit 仍由下面的 applyHandoff 消费。
// 必须在下面的 onMounted / watch / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于状态刷新改期。
useChainDeepPeriod()
// 期区值域按后端 p\d+|dorm 的形状判断,不枚举具体代码 —— p4 出现时不用改这里。
// applyHandoff 的深链校验与 refOptions 的 ref_meter 候选过滤共用同一条,
// 避免两处各写一份、drift 出两种拼法。(本分支增量,随出账链期结构一起保留)
const isZoneCode = (s: string) => /^p\d+$/.test(s) || s === 'dorm'
const zone = ref<ParamZone>('all')
const zones = useZonesStore()
onMounted(() => zones.ensure())
const ZONE_OPTS = computed(() => [{ value: 'all', label: '全园' }, ...zones.list.map(z => ({ value: z.code, label: z.name }))])

// ── 数据(首载加载门;++seq 竞态守卫:快速切年月/期区只接受最新一次) ──
const rows = ref<ParamRowDTO[] | null>(null)
const status = ref<ParamStatusDTO | null>(null)
const loadErr = ref('')
const flash = ref('')            // 重算 / 复制上月电价 的一次性摘要
const batchErr = ref('')         // 跨月批量重算的失败断点(error toast,不自动关)
/**
 * 换期重取时的退让（加载态设计稿 §06 第一档）。旧数据留在原地不闪，
 * 但必须退一步并**停止接受交互** —— 它还是上一期的。顶边那条线是唯一的「在忙」信号。
 */
const reloading = ref(false)   // ⚠ 不叫 busy:本屏下面已有一个 busy(批量重算用)
/** 熬过 200ms 才亮 —— 本地后端常几十毫秒回来，闪一下比不显示更晃眼 */
const veil = useDeferredFlag(reloading)

let seq = 0
async function load() {
  const my = ++seq
  reloading.value = true
  loadErr.value = ''
  try {
    const [rs, st] = await Promise.all([
      paramsApi.list(ym.value, zone.value),
      paramsApi.status(ym.value).catch(() => null),
    ])
    if (my !== seq) return
    rows.value = rs; status.value = st; flash.value = ''
    scrollToSection()
  } catch (e) {
    if (my !== seq) return
    rows.value = rows.value ?? []
    loadErr.value = errMsg(e, '参数加载失败')
  } finally {
    // ⚠ 只有最新那一趟有资格熄灯:被顶掉的旧请求先返回时若把它清了,
    //   新请求还在路上,退让却已经撤掉 —— 用户会以为数据到了。
    if (my === seq) reloading.value = false
  }
}
// 主数据(名字表 / 选择器候选;失败降级为不出对应控件,不阻断页面)
const buildings = ref<BuildingDTO[]>([])
const meters = ref<MeterDTO[]>([])
const tenants = ref<TenantDTO[]>([])
const rules = ref<AllocRuleDTO[]>([])
function loadMasters() {
  buildingApi.list().then(d => { buildings.value = d }).catch(() => {})
  metersApi.list('elec').then(d => { meters.value = d }).catch(() => {})
  tenantApi.list().then(d => { tenants.value = d }).catch(() => {})
  allocApi.rules().then(d => { rules.value = d }).catch(() => {})
}
// 其它屏跳来的深链:?p=2024-02(或旧 ?ym=)&zone=p1&section=rule&rule=23 —— 期归 useChainDeepPeriod,这里消费其余四个键;分析层来的 adopt=YYYY-12 只认领不覆盖
// edit=1 直接进编辑态(三屏 stale 条的 [去重算]:重算是写操作只在编辑态出,别让用户到了这儿再找「编辑模式」——同 PoolLedgerView generate=1)
const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const hlScope = ref('')
let pendingSection = ''
function applyHandoff(): boolean {
  const q = route.query
  // 不用 ZONE_OPTS 校验:这里在 setup 期同步跑,比 onMounted 里的 zones.ensure() 更早 ——
  // 深链落地时 zones store 十有八九还是空的,拿 ZONE_OPTS.some(...) 校验会把合法的
  // ?zone=p2 当非法丢弃(白白落回 'all')。改按后端值域(isZoneCode)+页面自己的 'all' 做形状校验,
  // 不依赖 store 是否已拉到。
  if (typeof q.zone === 'string' && (q.zone === 'all' || isZoneCode(q.zone))) zone.value = q.zone
  if (typeof q.section === 'string') pendingSection = q.section
  if (typeof q.rule === 'string' && /^\d+$/.test(q.rule)) hlScope.value = `rule:${q.rule}`
  // 分析层「去改常数」带 adopt=YYYY-12:只在没有期时认领(billingPeriod.adoptYm 的旧语义),已选期不动。
  // 显式深链(p= / ym=)由 useChainDeepPeriod 在 setup 更早处处理,两者互不覆盖:有 p 时期已落定,adopt 自然无事可做。
  period.adoptYm(typeof q.adopt === 'string' ? q.adopt : null)
  // ⚠ 必须**先认领期再进编辑态**。顺序反了的话 toggleEdit() 占的是 `param-center:0-00`
  //   (year/month 此刻还是 `period.year ?? 0`)。期现在由 useChainDeepPeriod 在 setup 更早处落定(§4.2),
  //   本函数只负责 edit=1;顺序约束不变:锁与所编的期错位的表现是「锁没生效」,不报错、没人会发现。
  //   （2026-08-29 给 useEditMode.enter() 补上"占锁回来再复核一次期"之后,这条当场暴露。）
  //   period.picked 也要判:没有期时主区是选期矩阵,进了编辑态也没有任何写入口。
  // 深链也走 toggle:缺权限时弹授权窗(裸写 editMode 会被守卫静默弹回浏览态,用户不知道为什么)
  if (q.edit === '1' && period.picked && canEnter.value) toggleEdit()
  return period.picked
}
function scrollToSection() {
  if (!pendingSection) return
  const id = `sec-${pendingSection}`
  pendingSection = ''
  nextTick(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
}
applyHandoff()   // setup 期同步消费 zone/section/rule/edit/adopt(在 watch 注册之前,免得触发第二次拉取;期本身由上面的 useChainDeepPeriod 落定)
onMounted(() => {
  loadMasters()
  if (period.picked) load()
})
watch([ym, zone], () => { if (period.picked) load() })

// ── 四区分组 + 未设置折叠(①②:无命中的**对象级**行(栋/池/表)默认藏起来,按区展开;全园/期级月核对项无值常显 + 「缺」——
//    折叠是为压掉几百条栋级/池级空行,不该连状态条「缺 6 项」的电价一起藏;③ 无命中=默认语义,始终全列) ──
const grouped = computed(() => groupRows(rows.value ?? []))
const hasHit = (r: ParamRow) => r.mode != null
const objectScope = (s: string) => s.startsWith('building:') || s.startsWith('rule:') || s.startsWith('meter:')
const missing = (r: ParamRow) => !hasHit(r) && r.monthlyCheck && !objectScope(r.scope)   // 全园/期级月核对项本月无值
const foldable = (r: ParamRow) => !hasHit(r) && !missing(r)
const showEmpty = ref({ monthly: false, constant: false })
function split(list: ParamRow[], key: 'monthly' | 'constant') {
  const hidden = list.filter(foldable).length
  return { rows: showEmpty.value[key] ? list : list.filter(r => !foldable(r)), hidden }
}
const monthly = computed(() => split(grouped.value.monthly, 'monthly'))
const constant = computed(() => split(grouped.value.constant, 'constant'))
// ④ 只列该户自己命中的版本行:户级版本起点晚于 ym 时后端出的是继承上级的行(rowId 空),它不是例外、也没有可删的行
const tenantRows = computed(() => grouped.value.tenant.filter(r => r.rowId != null))

// ③ 口径:期级组在前、栋级组次之;表级「剔出合计」行按表所在栋归到该栋组下(表主数据未到时暂列「其它表」);池级披露行(2023 冻结价)殿后
interface BuildingRuleGroup extends RuleGroup { bid: number; excludes: ParamRow[] }
const meterById = computed(() => new Map(meters.value.map(m => [m.id, m])))
const ruleGroups = computed(() => {
  const zones: RuleGroup[] = [], bld: BuildingRuleGroup[] = [], others: RuleGroup[] = []
  const meterRows: ParamRow[] = []
  for (const g of grouped.value.rule) {
    const s = g.rows[0].scope
    if (s.startsWith('meter:')) meterRows.push(...g.rows)
    else if (s.startsWith('building:')) bld.push({ ...g, bid: idOf(s), excludes: [] })
    else if (s.startsWith('rule:')) others.push(g)
    else zones.push(g)
  }
  const orphan: RuleGroup = { scopeLabel: '其它表', rows: [] }
  for (const r of meterRows) {
    const bid = meterById.value.get(idOf(r.scope))?.buildingId
    const g = bid == null ? undefined : bld.find(x => x.bid === bid)
    if (g) g.excludes.push(r); else orphan.rows.push(r)
  }
  if (orphan.rows.length) others.push(orphan)
  return { zones, buildings: bld, others }
})
// 一期公摊分摊度数 G(只读披露,spec §3.3):成员 = fee_key 园区公摊池,÷ 均摊栋数(park_share_div)
const gLine = computed(() => {
  if (zone.value !== 'p1') return ''      // 白名单:园区公摊分母是一期独有机制
  const names = rules.value.filter(r => r.zone === 'p1' && r.feeKey === 'park_loss_pool').map(r => r.name)
  const div = (rows.value ?? []).find(r => r.key === 'park_share_div' && (r.scope === 'p1' || r.scope === ''))
  const d = div?.value == null ? '均摊栋数' : `${div.value} 栋`
  return `一期公摊分摊度数 = ${names.length ? names.join('、') : '园区公共电池'} 本月净量合计 ÷ ${d}（四舍五入到 2 位）`
})

// ── 行呈现:值 / 生效区间徽标 / 来自 / ① 月核对项「值 + 沿用徽标 + 未核对」 ──
const RANGE_TONE = { month: 'orange', from: 'blue', inherit: 'neutral' } as const
// 月核对项本月无专属值(不是 month 行、from 版本也不是本月起的)→ 值照常显 + 灰徽标「沿用 X 起设置 / 沿用长期设置」+ 未核对
const unchecked = (r: ParamRow) => r.group === 'monthly' && r.monthlyCheck && r.mode === 'from' && !r.hasMonthRow && r.acctMonth !== ym.value
const carriedBadge = (r: ParamRow) => (r.acctMonth ? `沿用 ${r.acctMonth} 起设置` : '沿用长期设置')
const rowKey = (r: ParamRow) => `${r.scope}|${r.key}`
const chainTitle = (r: ParamRow) => r.sourceChain.length ? `命中链：${r.sourceChain.join(' → ')}` : '各级作用域均未设置'
// 走面积基数的池:「来自」列显「取自「园区分摊面积基数」」,点它跳到 ② 区那一行(命中作用域的那条)并短暂高亮
const hlRow = ref('')
function gotoBaseRow(r: ParamRow) {
  const label = baseRefLabel(r)
  const key = label ? PARAM_DEFS.find(d => d.label === label)?.key : undefined
  const hitLabel = r.sourceChain[0]?.slice(0, r.sourceChain[0].indexOf(':'))
  const target = key ? (rows.value ?? []).find(x => x.key === key && (x.scopeLabel === hitLabel || hitLabel == null)) : undefined
  if (!target) return
  hlRow.value = rowKey(target)
  nextTick(() => document.getElementById(`pm-row-${hlRow.value}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
}
const isHl = (r: ParamRow) => (!!hlScope.value && r.scope === hlScope.value) || hlRow.value === rowKey(r)
const stale = computed(() => !!status.value?.stale)
const otherMonths = computed(() => status.value?.otherMonthsAffected ?? [])   // from 版本波及、快照更早的其它已生成月
// 'YYYY-MM-DDTHH:mm:ss' → 'MM-DD HH:mm'(同 paramCenterLogic 里那份格式,不值得为一行导出)
const hhmm = (iso: string) => iso.slice(5, 16).replace('T', ' ')
// 状态条只留**中性事实**(LAYOUT-STABILITY-SPEC §6):电价 n/6 + 快照生成时间(一致时)。
// 「参数已改 N 项 / 旧快照 / 另有 X 月受影响」这些橙字全部搬进 chip + 抽屉,不再顶动下面四张卡。
const statusText = computed(() => {
  const s = status.value
  if (!s) return '状态未知（状态接口不可用）'
  const missing = s.priceTotal - s.priceOk
  const parts = [`本月电价 ${s.priceOk}/${s.priceTotal}${missing > 0 ? `（缺 ${missing} 项）` : ' ✓'}`]
  if (!s.poolSnapshotAt) parts.push('本月尚未生成池核算')
  else if (!s.stale) parts.push(`快照与参数一致 ✓ 生成于 ${hhmm(s.poolSnapshotAt)}`)
  return parts.join(' · ')
})

// ── 写:弹窗组装 ParamPutReq → PUT → 只 patch 该行(铁律二)+ 状态条计数 ──
const editRow = ref<ParamRowDTO | null>(null)
const histRow = ref<ParamRowDTO | null>(null)
const changesOpen = ref(false)
function patchRow(nr: ParamRowDTO, deleted: boolean) {
  const list = rows.value ?? (rows.value = [])
  const i = list.findIndex(r => r.scope === nr.scope && r.key === nr.key)
  // 户级例外 / 表级剔出行删掉后回包是「继承上级 / 无设置」的行(rowId 空),它不再是一条例外 → 从列表拿掉;其余行原位替换 / 新增追加
  const drop = deleted && nr.rowId == null && (nr.scope.startsWith('tenant:') || nr.scope.startsWith('meter:'))
  if (i >= 0) { if (drop) list.splice(i, 1); else list[i] = nr }
  else if (!drop) list.push(nr)
}
function bumpPending() {
  const s = status.value
  if (!s) return
  s.pendingChanges++
  if (s.poolSnapshotAt || s.billBatchAt) s.stale = true
}
async function put(req: ParamPutReq): Promise<boolean> {
  // 写口自守:全屏参数写全走这一个漏斗,守这一处 = 六个调用方一次到位(照 BillNoticesView 口径)。
  // editMode 会就地转假(接管/提权到期),而调用方的按钮各有各的 v-if —— 漏一个就是浏览态写库。
  if (!editMode.value) return false
  const my = seq
  try {
    const nr = await paramsApi.put(req, ym.value)
    if (my !== seq) return true          // 回包前换了月:写已成功,但别把旧月的行 patch 进新月列表
    patchRow(nr, req.value == null)
    bumpPending()
    return true
  } catch (e) { alert(errMsg(e, '保存失败')); return false }
}
// 成组写(④ 写计划:主键 + 配套键),中途失败即停(已写的留着;alert 已出)
async function putAll(reqs: ParamPutReq[]): Promise<boolean> {
  for (const r of reqs) if (!(await put(r))) return false
  return true
}
async function onSave(req: ParamPutReq) {
  if (await put(req)) editRow.value = null
}
// ④ [删]:按写计划整组删该户的版本行(主键 + 配套键;后端拦已被生成月取用的行)
function delTenantRow(r: ParamRow) {
  const mates = writePlan(r.key).slice(1).map(w => paramDef(w.key)?.label).filter(Boolean)
  const extra = mates.length ? `连同配套的「${mates.join('」「')}」一起删除，` : ''
  if (!confirm(`确认删除「${r.scopeLabel} · ${r.label}」例外（${r.rangeText}）？${extra}删除后该户回退默认值。`)) return
  putAll(tenantExceptionDelReqs(r))
}

// 弹窗引用型值的候选:并入他栋 → 同期区楼栋;总表 / 供电侧对账总表 → 该栋 / 该期电表;户级园区表 → 该户挂的表
// 期区读楼栋真实字段,不按 phase 猜——phase 只有 1/2/3,猜法会把三期(以及宿舍)楼栋都错落进 p1 桶。
// 三期楼栋在手工标注前 zone=null:候选按 null 分桶,只会跟别的未标注楼栋算同桶,不再混入一期楼栋。
const zoneOfBuilding = (b: BuildingDTO) => b.zone
const meterOpt = (m: MeterDTO): RefOption => ({ value: String(m.id), label: m.subName ? `${m.name} · ${m.subName}` : m.name })
const refOptions = computed<RefOption[]>(() => {
  const r = editRow.value
  const d = r ? paramDef(r.key) : undefined
  if (!r || !d) return []
  if (d.valueKind === 'ref_building') {
    const self = r.scope.startsWith('building:') ? buildings.value.find(b => b.id === idOf(r.scope)) : undefined
    return buildings.value.filter(b => !self || zoneOfBuilding(b) === zoneOfBuilding(self)).map(b => ({ value: String(b.id), label: b.name }))
  }
  if (d.valueKind === 'ref_meter') {
    // scope 是裸期区码(如 loss_supply_meter/供电局对账总表)时按该期区过滤候选表;
    // 之前枚举 p1/p2/dorm 漏了 p3,编辑三期这个引用型参数会退到 meters.value(全园所有表都能选)
    const ms = r.scope.startsWith('building:') ? meters.value.filter(m => m.buildingId === idOf(r.scope))
      : r.scope.startsWith('tenant:') ? meters.value.filter(m => m.tenantId === idOf(r.scope))
      : isZoneCode(r.scope) ? meters.value.filter(m => m.zone === r.scope)
      : meters.value
    return ms.map(meterOpt)
  }
  return []
})

// ③「不计入楼栋合计的电表 [+ 添加]」:选该栋的表 → 写 loss_exclude=1(自本月起长期)
const addExcl = ref<{ bid: number; meterId: string } | null>(null)
const exclCandidates = (g: BuildingRuleGroup): RefOption[] => {
  const done = new Set(g.excludes.map(r => idOf(r.scope)))
  return meters.value.filter(m => m.buildingId === g.bid && !done.has(m.id)).map(meterOpt)
}
async function submitExcl() {
  const a = addExcl.value
  if (!a || !a.meterId) return
  if (await put({ key: 'loss_exclude', scope: `meter:${a.meterId}`, acctMonth: ym.value, mode: 'from', value: 1 })) addExcl.value = null
}

// ④ [+ 新增例外]:租户(FPTenantPicker)+ 键(注册表 tenantEditable)+ 值 + 生效方式 + 备注;
// 写序列按注册表写计划成组展开(水价配管网费=0 / 一口价配双 mgmt=0 / 管理费双键同值 —— 与系数簿同一份 writePlan);
// 「损耗费计费基数（按栋）」多选一个楼栋(该户挂表所在栋 = 损耗组成员栋)拼 loss_base_form_b{栋id}
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
  exOpen.value = true
}
async function submitEx() {
  const t = ex.value, d = exDef.value
  const v = t.val.trim() === '' ? NaN : Number(t.val)
  if (!t.tenantId) { alert('请选择租户'); return }
  if (!d || !Number.isFinite(v)) { alert('请输入值'); return }
  if (exByBuilding.value && !t.bid) { alert('请选择楼栋'); return }
  const reqs = tenantExceptionReqs({ tenantId: t.tenantId, key: d.key, bid: t.bid ? Number(t.bid) : null, value: v, mode: t.mode, note: t.note.trim() || null }, ym.value)
  if (await putAll(reqs)) exOpen.value = false
}
// 深链协议同 gotoParams:KeepAlive 缓存实例只在 setup 消费 query,不换 epoch 就读不到 ——
// 缺了这半边,催缴单屏若已在页签里缓存着,点过去只是切页签,系数簿窗口不会开。
function gotoCoefBook() {
  tabs.openFresh('bill-notices', { pin: true })
  router.push({ path: '/bill-notices', query: { ym: ym.value, coef: '1' } })
}

// ── 闭环:重算本月(池 → 损耗 → 催缴单)/ 复制上月电价 ──
const busy = ref(false)
async function onRecalc() {
  if (!canRecalc.value) return
  // 从未生成过催缴单的月(spec §10.6):「重算」其实是首次生成,用户须知道会新添一批催缴单
  const first = status.value && !status.value.billBatchAt
    ? `。注意：${ym.value} 尚无催缴单，本次将首次生成该月催缴单批次。` : '（已确认、已导出的户照旧跳过）。'
  if (!confirm(`确认重算 ${ym.value}？将按当前参数重新生成 池核算 / 楼栋损耗 / 催缴单${first}`)) return
  busy.value = true
  flash.value = ''
  try {
    const r = await paramsApi.recalc(ym.value)
    const warn = r.warnings.length ? ` · 警告 ${r.warnings.length} 条（见控制台）` : ''
    if (r.warnings.length) console.warn('[params] recalc warnings', r.warnings)
    flash.value = `重算完成：池 ${r.pools} · 损耗单元 ${r.lossUnits} · 催缴单 ${r.notices}（跳过已确认 / 已导出 ${r.skippedConfirmed}）${warn}`
    status.value = await paramsApi.status(ym.value)
    // 生成改的正是矩阵格子上的点(池/损耗亮起、stale 清掉)—— 换出账月时要立刻看得见
    void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
  } catch (e) { alert(errMsg(e, '重算失败')) } finally { busy.value = false }
}
// 跨月一键重算(§6-3:告警必须给得出一条点得到的清除路径,不许只写「请切到该月重算」让用户手工切几十次)。
// 纯前端编排:按月串行调已有 recalc,没有新后端口。任一月失败即停,已成功的月保留并在 toast 里报出断点。
const batchDone = ref(0)
const batchTotal = ref(0)
async function onRecalcOthers() {
  if (!canRecalc.value) return
  const list = otherMonths.value.slice()
  if (!list.length || busy.value) return
  if (!confirm(`确认重算这 ${list.length} 个月（${list.join('、')}）？将逐月按当前参数重新生成 池核算 / 楼栋损耗 / 催缴单（已确认、已导出的户照旧跳过）。`)) return
  busy.value = true; batchTotal.value = list.length; batchDone.value = 0
  let failed = ''
  try {
    for (const m of list) {
      try { await paramsApi.recalc(m) } catch (e) { failed = `${m}（${errMsg(e, '重算失败')}）`; break }
      batchDone.value++
    }
  } finally {
    busy.value = false; batchTotal.value = 0
    await load()        // 刷新本月列表 + status —— 清干净的告警随之从 chip 上消失
    // 跨月重算改的是好几个月的格子,矩阵整张重取
    void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
  }
  // load() 成功时会清 flash,所以摘要放它后面。失败走单独的 error toast(§4.1:不自动关,让用户读完失败月份)
  if (failed) batchErr.value = `重算中断于 ${failed}${batchDone.value ? `；已完成 ${batchDone.value} 个月` : ''}`
  else flash.value = `已重算 ${batchDone.value} 个月：${list.join('、')}`
}
async function onCopy() {
  if (!editMode.value) return
  if (!confirm(`确认复制上月电价 → ${ym.value}？仅复制电价 6 个月变键的上月版本,目标月已有版本的键跳过不覆盖。`)) return
  busy.value = true
  try {
    const r = await paramsApi.copyPrev(ym.value)
    await load()
    flash.value = `复制完成：新增 ${r.copied} 行，跳过已存在 ${r.skipped} 行。`
  } catch (e) { alert(errMsg(e, '复制失败')) } finally { busy.value = false }
}

// ── 屏级告警:常驻 chip + 右侧抽屉(LAYOUT-STABILITY-SPEC §6,2026-08-25 用户拍板) ──
// 原来这些橙字全挤在状态条里(「参数已改 N 项…另有 2023-08、2023-10 也受影响,请切到该月重算」):
// 顶动下面四张卡,而且只报不给路 —— 跨月那条得用户手工切几十次月才清得掉,于是变成永久噪音。
// 判定逻辑不动(后端 status.stale / otherMonthsAffected),这里只搬呈现形态 + 给出清除动作。
const alertOpen = ref(false)
const alertCount = computed(() => (stale.value ? 1 : 0) + otherMonths.value.length)
// 重算是写操作(EDIT-MODE-SPEC v2:浏览态零写入口)→ 浏览态抽屉里只说去哪开,不放按钮
const canRecalc = computed(() => canRun.value && editMode.value)
function gotoMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  // 用户在告警抽屉里点名要去那个月 —— 显式动作,直接换组级期(五屏一起跟过去)
  period.pick(y, mo)                    // watch([ym, zone]) → load()
  alertOpen.value = false
}
const alertGroups = computed<AlertGroup[]>(() => {
  const s = status.value
  if (!s) return []
  const gs: AlertGroup[] = []
  if (s.stale) gs.push({
    key: 'stale',
    title: '本月快照过期',
    desc: '计费参数改过，但池核算 / 楼栋损耗 / 催缴单还是改参之前生成的 —— 屏上那些金额不会自己跟着变，'
      + '重算一次才对得上（已确认、已导出的户照旧跳过）。',
    items: [
      { text: `自上次重算起改了 ${s.pendingChanges} 项参数`, hint: s.lastChangeAt ? `最近改动 ${hhmm(s.lastChangeAt)}` : undefined },
      ...(canRecalc.value ? [] : [{ text: '重算是写操作，先点右上「编辑模式」' }]),
    ],
    action: canRecalc.value ? { label: '重算本月', icon: 'refresh-cw', busy: busy.value, run: onRecalc } : undefined,
  })
  if (otherMonths.value.length) gs.push({
    key: 'others',
    title: '其他月份受影响',
    desc: '这些月的快照也早于最近一次参数改动。「自某月起长期」的参数改一次会波及其后所有月份，'
      + '不重算的话那几个月的池核算 / 催缴单还是老金额。',
    items: otherMonths.value.map((m, i) => ({
      text: m,
      // 批量跑起来后每行报进度(共享件的 busy 只会把按钮文案换成「处理中…」,进度只能落在这儿)
      hint: batchTotal.value
        ? (i < batchDone.value ? '已重算' : i === batchDone.value ? '重算中…' : '等待中')
        : '切到该月',
      onClick: batchTotal.value ? undefined : () => gotoMonth(m),
    })),
    action: canRecalc.value
      ? { label: `一键重算这 ${otherMonths.value.length} 个月`, icon: 'refresh-cw', busy: busy.value, run: onRecalcOthers }
      : undefined,
  })
  return gs
})

// ⑤ 固定规则(spec §3.5,只读折叠;改它要改代码)—— 人话句子,不出现 Σ / ROUND
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

  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5.4 迁移查看态(参数速查),摘 base.css 的
       800px 屏级地板。三张 colgroup 表列永不增删,窄了在 .pm-tablewrap(overflow-x:auto)内横滚;
       参数批量编辑不优化(§11.1),单条修改走 Popover/Drawer,S 档由组件内部全屏化 -->
  <div v-else-if="!rows" class="page-loading fp-fluid"><span class="page-spin" /></div>

  <div v-else class="pm-page fp-fluid">
    <FPLoadBar :on="veil" />
    <!-- 链路条:期写在这里,五道工序横跳不换期 -->
    <FPStepStrip :steps="chainSteps" current="params" :period="ym" @back="period.clear()" />

    <!-- 标题行:年月 + 期区 | 变更记录 + 编辑模式 -->
    <div class="pm-head">
      <div class="pm-head-l">
        <h2 class="pm-title"><span class="ic"><component :is="iconFor('sliders-horizontal')" :size="18" /></span>计费参数</h2>
        <Segmented :options="ZONE_OPTS" :model-value="zone" size="sm" @update:model-value="zone = $event as ParamZone" />
        <!-- 屏级告警入口(§6):位置固定在主控区尾,有无告警都渲染(无 → quiet 态),不挪版 -->
        <FPAlertChip :count="alertCount" @open="alertOpen = true" />
      </div>
      <div class="pm-actions">
        <Button variant="outline" size="sm" @click="changesOpen = true">
          <template #leading><component :is="iconFor('history')" :size="14" /></template>
          变更记录
        </Button>
        <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          @toggle="toggleEdit()" />
      </div>
    </div>

    <!-- 状态条(spec §5.1 / §5.5):只报中性事实 —— 电价 n/6 · 快照生成时间;
         过期 / 其他月份受影响那些橙字归工具条上的告警 chip 管(LAYOUT-STABILITY-SPEC §6) -->
    <FPLoadError v-if="loadErr" @retry="load">
      <span>{{ loadErr }}</span>
    </FPLoadError>
    <div class="pm-bar status">
      <component :is="iconFor('info')" :size="14" />
      <span class="pm-status-text">{{ statusText }}</span>
      <!-- 重算=池/损耗/催缴单三表先删后插,是写操作:只在编辑态出(EDIT-MODE v2);三屏 [去重算] 深链带 edit=1 直接进编辑态 -->
      <Button v-if="canRun && editMode" variant="outline" size="sm" :disabled="busy" @click="onRecalc">
        <template #leading><component :is="iconFor('refresh-cw')" :size="14" /></template>
        重算本月
      </Button>
    </div>

    <!-- ① 本月参数 -->
    <Card id="sec-monthly" surface="white" :padding="0" class="pm-card">
      <div class="pm-cardhead">
        <div class="pm-cardtitles">
          <span class="pm-cardtitle">① 本月参数（每月核对）</span>
          <span class="pm-cardsub">
            <b>月度录入</b>：照抄供电局账单的电价与调整量。电价决定每一户的账单，改动需主管授权。
            本月无专属值的月核对项显示沿用值并标「未核对」
          </span>
        </div>
        <div class="pm-cardops">
          <button v-if="monthly.hidden" class="pm-link" @click="showEmpty.monthly = !showEmpty.monthly">
            {{ showEmpty.monthly ? '收起未设置项' : `显示未设置项（${monthly.hidden}）` }}
          </button>
          <Button v-if="editMode" variant="outline" size="sm" :disabled="busy" @click="onCopy">
            <template #leading><component :is="iconFor('copy')" :size="14" /></template>
            复制上月电价
          </Button>
        </div>
      </div>
      <div class="pm-tablewrap" :class="{ 'fp-stale': veil }" :aria-busy="veil">
        <table class="pm-table">
          <colgroup>
            <col style="width:200px" /><col style="width:170px" /><col style="width:150px" /><col style="width:130px" /><col style="width:100px" /><col />
            <col style="width:78px" /><col style="width:44px" />
          </colgroup>
          <thead>
            <tr><th class="lbl">参数</th><th class="scope">作用范围</th><th>本月值</th><th>生效区间</th><th class="src">来自</th><th class="formula">说明 / 算式</th><th></th><th></th></tr>
          </thead>
          <tbody>
            <tr v-if="!monthly.rows.length"><td :colspan="8" class="pm-none">本月无已设置的参数{{ monthly.hidden ? '（点右上「显示未设置项」查看可设的项）' : '' }}</td></tr>
            <tr v-for="r in monthly.rows" :id="`pm-row-${rowKey(r)}`" :key="rowKey(r)" :class="{ hl: isHl(r) }">
              <td class="lbl" :title="r.hint ?? undefined"><span class="pm-lbl">{{ r.label }}</span><span v-if="r.unit" class="pm-unit">{{ r.unit }}</span></td>
              <td class="mut scope"><span class="pm-lbl">{{ r.scopeLabel }}</span></td>
              <td class="val">
                <template v-if="unchecked(r)">
                  <span class="pm-v">{{ r.valueText }}</span>
                  <span class="pm-vbadges">
                    <Badge tone="neutral" variant="subtle" :dot="false" class="pm-carried">{{ carriedBadge(r) }}</Badge>
                    <Badge tone="orange" variant="subtle" :dot="false">未核对</Badge>
                  </span>
                </template>
                <template v-else-if="!hasHit(r)">
                  <span class="dim">—</span>
                  <Badge v-if="missing(r)" tone="orange" variant="subtle" :dot="false">缺</Badge>
                </template>
                <template v-else>{{ r.valueText }}</template>
              </td>
              <td class="rng"><Badge v-if="rangeBadge(r).text" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ rangeBadge(r).text }}</Badge></td>
              <td class="mut src" :title="chainTitle(r)">
                <button v-if="baseRefLabel(r)" class="pm-link" @click="gotoBaseRow(r)">{{ sourceLabel(r) }}</button>
                <template v-else>{{ sourceLabel(r) }}</template>
              </td>
              <td class="mut formula" :title="r.formula ?? undefined"><span class="pm-clamp">{{ r.formula ?? '' }}</span></td>
              <td class="ops"><Button v-if="editMode && r.editable" variant="outline" size="sm" @click="editRow = r">修改</Button></td>
              <td class="ops"><button class="pm-ib" title="历史" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- ② 长期常数 -->
    <Card id="sec-constant" surface="white" :padding="0" class="pm-card">
      <div class="pm-cardhead">
        <div class="pm-cardtitles">
          <span class="pm-cardtitle">② 长期常数（改一次，管到下次改）</span>
          <span class="pm-cardsub">自某月起长期生效，直到更晚版本；含分摊基数 / 分摊标准附加金额 / 公摊池指定单价</span>
        </div>
        <div class="pm-cardops">
          <button v-if="constant.hidden" class="pm-link" @click="showEmpty.constant = !showEmpty.constant">
            {{ showEmpty.constant ? '收起未设置项' : `显示未设置项（${constant.hidden}）` }}
          </button>
        </div>
      </div>
      <div class="pm-tablewrap" :class="{ 'fp-stale': veil }" :aria-busy="veil">
        <table class="pm-table">
          <colgroup>
            <col style="width:200px" /><col style="width:170px" /><col style="width:150px" /><col style="width:130px" /><col style="width:100px" /><col />
            <col style="width:78px" /><col style="width:44px" />
          </colgroup>
          <thead>
            <tr><th class="lbl">参数</th><th class="scope">作用范围</th><th>生效值</th><th>生效区间</th><th class="src">来自</th><th class="formula">说明 / 算式</th><th></th><th></th></tr>
          </thead>
          <tbody>
            <tr v-if="!constant.rows.length"><td :colspan="8" class="pm-none">无已设置的长期常数</td></tr>
            <tr v-for="r in constant.rows" :id="`pm-row-${rowKey(r)}`" :key="rowKey(r)" :class="{ hl: isHl(r) }">
              <td class="lbl" :title="r.hint ?? undefined"><span class="pm-lbl">{{ r.label }}</span><span v-if="r.unit" class="pm-unit">{{ r.unit }}</span></td>
              <td class="mut scope"><span class="pm-lbl">{{ r.scopeLabel }}</span></td>
              <td class="val"><span v-if="!hasHit(r) && !r.valueText" class="dim">—</span><template v-else>{{ r.valueText }}</template></td>
              <td class="rng"><Badge v-if="rangeBadge(r).text" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ rangeBadge(r).text }}</Badge></td>
              <td class="mut src" :title="chainTitle(r)">
                <button v-if="baseRefLabel(r)" class="pm-link" @click="gotoBaseRow(r)">{{ sourceLabel(r) }}</button>
                <template v-else>{{ sourceLabel(r) }}</template>
              </td>
              <td class="mut formula" :title="r.formula ?? undefined"><span class="pm-clamp">{{ r.formula ?? '' }}</span></td>
              <td class="ops"><Button v-if="editMode && r.editable" variant="outline" size="sm" @click="editRow = r">修改</Button></td>
              <td class="ops"><button class="pm-ib" title="历史" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- ③ 核算口径(按期 / 栋;人话句子) -->
    <Card id="sec-rule" surface="white" :padding="0" class="pm-card">
      <div class="pm-cardhead">
        <div class="pm-cardtitles">
          <span class="pm-cardtitle">③ 核算口径（按栋）</span>
          <span class="pm-cardsub">损耗核算方式、总表取数、损耗核算归组、不计入合计的电表、供电局对账；无专属设置的按默认显示</span>
        </div>
      </div>
      <div class="pm-rules">
        <div v-if="gLine" class="pm-rgroup">
          <div class="pm-rhead">一期园区公共电（只读）</div>
          <div class="pm-rrow"><span class="pm-rtxt">{{ gLine }}</span><span class="pm-rnote">成员去「公共电核算」改</span></div>
        </div>
        <div v-for="g in ruleGroups.zones" :key="'z' + g.scopeLabel" class="pm-rgroup">
          <div class="pm-rhead">{{ g.scopeLabel }}</div>
          <div v-for="r in g.rows" :key="rowKey(r)" class="pm-rrow">
            <span class="pm-rtxt" :title="r.formula ?? undefined">{{ r.label }}：{{ r.valueText }}</span>
            <Badge v-if="hasHit(r)" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ rangeBadge(r).text }}</Badge>
            <span v-if="hasHit(r) && r.rowId == null" class="pm-rnote" :title="chainTitle(r)">{{ sourceLabel(r) }}</span>
            <span v-else-if="!hasHit(r)" class="pm-rnote">默认（未单独设置）</span>
            <span class="pm-rops">
              <Button v-if="editMode && r.editable" variant="outline" size="sm" @click="editRow = r">修改</Button>
              <button class="pm-ib" title="历史" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button>
            </span>
          </div>
        </div>
        <div v-for="g in ruleGroups.buildings" :key="'b' + g.bid" class="pm-rgroup">
          <div class="pm-rhead">{{ g.scopeLabel }}</div>
          <div v-for="r in g.rows" :key="rowKey(r)" class="pm-rrow">
            <span class="pm-rtxt" :title="r.formula ?? undefined">{{ r.label }}：{{ r.valueText }}</span>
            <Badge v-if="hasHit(r)" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ rangeBadge(r).text }}</Badge>
            <span v-if="hasHit(r) && r.rowId == null" class="pm-rnote" :title="chainTitle(r)">{{ sourceLabel(r) }}</span>
            <span v-else-if="!hasHit(r)" class="pm-rnote">默认（未单独设置）</span>
            <span class="pm-rops">
              <Button v-if="editMode && r.editable" variant="outline" size="sm" @click="editRow = r">修改</Button>
              <button class="pm-ib" title="历史" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button>
            </span>
          </div>
          <div class="pm-rrow excl">
            <span class="pm-rtxt">不计入楼栋合计的电表：</span>
            <span v-if="!g.excludes.length" class="pm-rnote">（无）</span>
            <span v-for="r in g.excludes" :key="rowKey(r)" class="pm-chip" :class="{ off: !r.value }" :title="`${r.valueText} · ${r.rangeText}`">
              {{ r.scopeLabel.replace(/（表）$/, '') }}<template v-if="!r.value">（本月计入）</template>
              <button v-if="editMode" class="pm-chipx" title="修改" @click="editRow = r"><component :is="iconFor('pencil')" :size="11" /></button>
              <button v-else class="pm-chipx" title="历史" @click="histRow = r"><component :is="iconFor('history')" :size="11" /></button>
            </span>
            <template v-if="editMode">
              <template v-if="addExcl?.bid === g.bid">
                <div style="width:240px"><Select :options="exclCandidates(g)" :model-value="addExcl.meterId" size="sm" placeholder="选择该栋的表" @update:model-value="addExcl.meterId = $event" /></div>
                <Button variant="filled" size="sm" :disabled="!addExcl.meterId" @click="submitExcl">设为不计入</Button>
                <Button variant="outline" size="sm" @click="addExcl = null">取消</Button>
              </template>
              <Button v-else variant="outline" size="sm" @click="addExcl = { bid: g.bid, meterId: '' }">
                <template #leading><component :is="iconFor('plus')" :size="14" /></template>添加
              </Button>
            </template>
          </div>
        </div>
        <div v-for="g in ruleGroups.others" :key="'o' + g.scopeLabel" class="pm-rgroup">
          <div class="pm-rhead">{{ g.scopeLabel }}</div>
          <div v-for="r in g.rows" :key="rowKey(r)" class="pm-rrow">
            <span class="pm-rtxt" :title="r.formula ?? undefined">{{ r.label }}：{{ r.valueText }}</span>
            <Badge v-if="rangeBadge(r).text" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ rangeBadge(r).text }}</Badge>
            <span class="pm-rops">
              <Button v-if="editMode && r.editable" variant="outline" size="sm" @click="editRow = r">修改</Button>
              <button class="pm-ib" title="历史" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button>
            </span>
          </div>
        </div>
        <div v-if="!ruleGroups.zones.length && !ruleGroups.buildings.length && !ruleGroups.others.length && !gLine" class="pm-none">本期区无核算口径项</div>
      </div>
    </Card>

    <!-- ④ 户级例外 -->
    <Card id="sec-tenant" surface="white" :padding="0" class="pm-card">
      <div class="pm-cardhead">
        <div class="pm-cardtitles">
          <span class="pm-cardtitle">④ 户级例外</span>
          <span class="pm-cardsub">单户覆盖期 / 全园默认值；批量改到催缴单 → 系数簿</span>
        </div>
        <div v-if="editMode" class="pm-cardops">
          <Button variant="outline" size="sm" @click="openEx">
            <template #leading><component :is="iconFor('plus')" :size="14" /></template>
            新增例外
          </Button>
          <Button variant="outline" size="sm" @click="gotoCoefBook">
            <template #leading><component :is="iconFor('arrow-up-right')" :size="14" /></template>
            批量修改 → 系数簿
          </Button>
        </div>
      </div>
      <div class="pm-tablewrap" :class="{ 'fp-stale': veil }" :aria-busy="veil">
        <table class="pm-table">
          <colgroup>
            <col style="width:200px" /><col style="width:200px" /><col style="width:170px" /><col style="width:130px" /><col />
            <col style="width:112px" /><col style="width:44px" />
          </colgroup>
          <thead>
            <tr><th class="lbl">租户</th><th class="lbl">参数</th><th>值</th><th>生效区间</th><th class="src">覆盖了</th><th></th><th></th></tr>
          </thead>
          <tbody>
            <tr v-if="!tenantRows.length"><td :colspan="7" class="pm-none">暂无户级例外，全部租户按期 / 全园默认值计价。</td></tr>
            <tr v-for="r in tenantRows" :key="rowKey(r)">
              <td class="lbl"><span class="pm-lbl">{{ r.scopeLabel.replace(/（户）$/, '') }}</span></td>
              <td class="mut lbl2" :title="r.hint ?? undefined"><span class="pm-lbl">{{ r.label }}</span><span v-if="r.unit" class="pm-unit">{{ r.unit }}</span></td>
              <td class="val">{{ r.valueText }}</td>
              <td class="rng"><Badge v-if="rangeBadge(r).text" :tone="RANGE_TONE[rangeBadge(r).tone]" :dot="false">{{ rangeBadge(r).text }}</Badge></td>
              <td class="mut src" :title="chainTitle(r)">{{ r.sourceChain[1] ? r.sourceChain[1].replace(':', ' ') : '（无默认值）' }}</td>
              <td class="ops">
                <Button v-if="editMode" variant="outline" size="sm" @click="editRow = r">修改</Button>
                <button v-if="editMode" class="pm-ib danger" title="删除例外" @click="delTenantRow(r)"><component :is="iconFor('trash-2')" :size="14" /></button>
              </td>
              <td class="ops"><button class="pm-ib" title="历史" @click="histRow = r"><component :is="iconFor('history')" :size="14" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- ⑤ 固定规则(只读折叠) -->
    <Card id="sec-fixed" surface="white" :padding="0" class="pm-card">
      <details class="pm-fixed">
        <summary class="pm-cardhead pm-sum">
          <div class="pm-cardtitles">
            <span class="pm-cardtitle">⑤ 固定规则（只读）</span>
            <span class="pm-cardsub">写在引擎里的算法约定，不是参数；改它要改代码</span>
          </div>
        </summary>
        <ul class="pm-fixedlist"><li v-for="(t, i) in FIXED_RULES" :key="i">{{ t }}</li></ul>
      </details>
    </Card>

    <FPElevateDialog
      :page="`计费参数 · ${ym}`" :action="'修改计费口径 / 月度录入'" :perms="asking" what="修改计费口径" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`计费参数 ${ym}`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />

    <!-- 重算/复制上月电价的摘要。原来是 .pm-actions 里 flex:1 1 100% 的一个 span ——
         它一出现就换行,把整条工具栏撑高一行,下面全部内容跟着往下跳(LAYOUT-STABILITY-SPEC §4)。 -->
    <FPToast v-model="flash" placement="page" :duration="6000" />
    <FPToast v-model="batchErr" tone="error" placement="page" :duration="0" />

    <FPAlertPanel :open="alertOpen" :groups="alertGroups" @close="alertOpen = false" />
    <ParamEditPopover :open="!!editRow" :row="editRow" :ym="ym" :ref-options="refOptions" @close="editRow = null" @save="onSave" />
    <ParamHistoryDrawer :open="!!histRow" :row="histRow" @close="histRow = null" />
    <ParamChangesDrawer :open="changesOpen" :ym="ym" @close="changesOpen = false" />

    <!-- ④ 新增例外 -->
    <FPDrawer :open="exOpen" title="新增户级例外" :subtitle="`账期 ${ym}；只影响该户，覆盖期 / 全园默认值`" icon="plus" :width="520" @close="exOpen = false">
      <div class="pm-exform">
        <label class="pm-exfield"><span class="k">租户</span><FPTenantPicker v-model="ex.tenantId" :tenants="tenantOpts" placeholder="搜索并选择租户" /></label>
        <label class="pm-exfield"><span class="k">参数</span><Select :options="exKeyOpts" :model-value="ex.key" size="sm" @update:model-value="setExKey($event)" /></label>
        <label v-if="exByBuilding" class="pm-exfield">
          <span class="k">楼栋（该户所在损耗组的任一成员栋）</span>
          <Select :options="exBuildingOpts" :model-value="ex.bid" size="sm" placeholder="请选择楼栋" @update:model-value="ex.bid = $event" />
        </label>
        <label class="pm-exfield">
          <span class="k">值<span v-if="exDef?.unit" class="pm-unit">{{ exDef.unit }}</span></span>
          <Select v-if="exPickable" :options="exValOpts" :model-value="ex.val" size="sm" placeholder="请选择" @update:model-value="ex.val = $event" />
          <input v-else :value="ex.val" class="pm-exin" type="number" step="any" placeholder="请输入数字"
                 @input="ex.val = ($event.target as HTMLInputElement).value" />
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
.pm-page { position: relative; display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; max-width: 1500px; margin: 0 auto; width: 100%; }

.pm-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pm-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pm-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pm-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.pm-actions { display: flex; align-items: center; gap: 8px; }

/* 状态条:中性事实 / 加载失败红(过期橙条已废,§6 改走告警 chip + 抽屉) */
.pm-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); flex-wrap: wrap; }
.pm-status-text { flex: 1 1 auto; min-width: 200px; }

/* 区卡(LIST-PAGE-SPEC 列表卡形态) */
.pm-card { border: 1px solid var(--border-subtle); overflow: hidden; }
.pm-cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px 12px; border-bottom: 1px solid var(--divider); }
.pm-cardtitles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pm-cardtitle { font-size: 14.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.pm-cardsub { font-size: var(--fs-label); color: var(--text-muted); }
.pm-cardops { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.pm-link { border: none; background: none; padding: 0 2px; font: inherit; font-size: var(--fs-label); color: var(--hue-blue); cursor: pointer; text-decoration: underline; }
.pm-tablewrap { overflow-x: auto; }

/* 表格:等高行(--mx-row-h 56px)+ table-layout:auto —— 列宽是下限,内容更宽就撑开(横向滚动),任何文字不截断;
   参数列 label 两行内换行、单位另起一行小灰字;值/区间/来自 nowrap;说明列两行 line-clamp(完整算式在 title) */
.pm-table { width: 100%; border-collapse: collapse; table-layout: auto; font-family: var(--font-sans); }
.pm-table th { background: var(--surface-white); padding: 8px 14px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
/* 换行列(参数 / 作用范围 / 来自 / 说明)必须给 min-width:auto 布局下 nowrap 列先按内容占位,换行列会被压到最窄再 clamp 成截断 */
.pm-table th.lbl, .pm-table td.lbl { min-width: 150px; }
.pm-table th.scope, .pm-table td.scope { min-width: 160px; white-space: normal; line-height: 1.35; }
.pm-table td.scope .pm-lbl { -webkit-line-clamp: 3; }   /* 池名最长 22 字:160px 两行放完;三行仍在 56px 内 */
.pm-table th.src, .pm-table td.src { min-width: 96px; white-space: normal; line-height: 1.35; }
.pm-table th.formula, .pm-table td.formula { min-width: 220px; }
.pm-table tbody tr { height: var(--mx-row-h, 56px); border-bottom: 1px solid var(--divider); }
.pm-table tbody tr:last-child { border-bottom: none; }
.pm-table tbody tr.hl td { background: rgb(255, 250, 225); }
.pm-table td { padding: 0 14px; vertical-align: middle; font-size: 12.5px; color: var(--text-primary); white-space: nowrap; }
.pm-table td.lbl { font-weight: var(--fw-medium); white-space: normal; line-height: 1.3; }
.pm-table td.lbl2 { white-space: normal; line-height: 1.3; min-width: 150px; }
.pm-lbl { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.pm-table td.mut { color: var(--text-muted); }
.pm-table td.formula { font-size: 11.5px; white-space: normal; line-height: 1.4; }
/* 说明列最多 3 行(11.5px × 1.4 × 3 ≈ 48px,仍在 56px 行高内);列宽 260 下 44 字算式两行放完,更长的 title 里看全 */
.pm-clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.pm-table td.val { font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; }
.pm-table td.val .dim { font-weight: var(--fw-regular); color: var(--text-disabled); margin-right: 6px; }
/* 沿用值:值一行(nowrap)+ 徽标行(沿用 X 起设置 / 未核对)—— 徽标另起一行免得把值列撑得过宽 */
.pm-table td.val .pm-v { white-space: nowrap; }
.pm-table td.val .pm-vbadges { display: flex; gap: 6px; margin-top: 3px; white-space: nowrap; }
.pm-table td.val .pm-carried { font-weight: var(--fw-regular); }
.pm-table td.ops { padding: 0 6px; text-align: right; }
.pm-table td.ops > * { vertical-align: middle; }
.pm-table td.src .pm-link { padding: 0; }
.pm-none { text-align: center; padding: 28px 16px; color: var(--text-disabled); font-size: var(--fs-label); white-space: normal; }
.pm-unit { display: block; margin-top: 2px; font-size: var(--fs-micro); color: var(--text-disabled); font-weight: var(--fw-regular); line-height: 1.2; }
.pm-exfield .pm-unit { display: inline; margin: 0 0 0 6px; }
.pm-ib { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; }
.pm-ib:hover { background: var(--bg-hover); color: var(--text-primary); }
.pm-ib.danger:hover { background: rgb(255, 238, 237); color: var(--hue-red); }

/* ③ 口径:按栋分组的人话句子行 */
.pm-rules { display: flex; flex-direction: column; }
.pm-rgroup { border-bottom: 1px solid var(--divider); padding: 6px 0 8px; }
.pm-rgroup:last-child { border-bottom: none; }
.pm-rhead { padding: 6px 18px 4px; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-secondary); }
.pm-rrow { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 18px 0 30px; font-size: 12.5px; color: var(--text-primary); flex-wrap: wrap; }
.pm-rrow.excl { padding-top: 4px; padding-bottom: 4px; }
.pm-rtxt { flex: 0 1 auto; min-width: 0; white-space: normal; line-height: 1.4; }
.pm-rnote { font-size: var(--fs-micro); color: var(--text-disabled); }
.pm-rops { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.pm-chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 9px; border-radius: var(--radius-full); background: rgb(232, 240, 254); color: var(--hue-blue); font-size: var(--fs-micro); }
.pm-chip.off { background: var(--bg-sunken); color: var(--text-muted); }
.pm-chipx { width: 18px; height: 18px; border: none; background: transparent; border-radius: 50%; cursor: pointer; color: inherit; display: inline-grid; place-items: center; opacity: .7; }
.pm-chipx:hover { opacity: 1; background: rgba(0, 0, 0, .06); }

/* ⑤ 固定规则 */
.pm-fixed summary { list-style: none; cursor: pointer; }
.pm-fixed summary::-webkit-details-marker { display: none; }
.pm-fixed[open] .pm-sum { border-bottom: 1px solid var(--divider); }
.pm-fixed:not([open]) .pm-sum { border-bottom: none; }
.pm-fixedlist { margin: 0; padding: 12px 18px 14px 34px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.7; }

/* ④ 新增例外表单 */
.pm-exform { display: flex; flex-direction: column; gap: 14px; }
.pm-exfield { display: flex; flex-direction: column; gap: 6px; }
.pm-exfield .k { font-size: var(--fs-label); color: var(--text-secondary); font-weight: var(--fw-medium); }
.pm-exin { height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); outline: none; }
.pm-exin.txt { font-family: var(--font-sans); }
.pm-exin:focus { border-color: var(--hue-blue); }
.pm-exin::-webkit-outer-spin-button, .pm-exin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pm-exhint { margin: 0; font-size: var(--fs-micro); color: var(--text-muted); line-height: 16px; min-height: 16px; }

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.4 P3 查看态):只用 960,宽档规则在前 ──
   卡头收纳:标题句 + 右侧操作组窄档挤不进一行,允许折两行(§2 修订;组成按档静态确定,
   .pm-cardops 随编辑态进出已在 noInteractionLayoutShift 白名单)。表本身列不动,pm-tablewrap 横滚 */
@media (max-width: 960px) { /* M↓ */
  .pm-cardhead { flex-wrap: wrap; }
}
</style>
