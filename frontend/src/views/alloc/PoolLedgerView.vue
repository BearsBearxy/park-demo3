<script setup lang="ts">
// 公共电核算(POOL-ENGINE-SPEC §6,S3-B1 刀2)— 承接 /alloc 路由。FPLedgerTable 手法
// (MeterLedgerGrid 同款:双级表头/sticky 首列/34px 行/mono 空值'–'/tfoot 钉底/分组分隔带§7.6);
// 行数≤70 不虚拟滚动。rows=全部池(config)左连当月快照;无快照月 generated=false 数值列'–'。
// 编辑态(EDIT-MODE-SPEC v2):池配置抽屉(FPDrawer,迁自旧 AllocView 规则弹窗)→ 改完提示重新生成。
// S21(S21-PARAM-CENTER-SPEC §2.4/§5.6):池的分母 T/加度只有 alloc_cfg rule:{id} 一条版本链,写入口收敛到「计费参数」页 ——
// 编辑态「分母/加度」两列与抽屉「③怎么摊」改为**只读镜像**(当月生效值 + 仅本月/长期徽标 + 点击跳参数页);
// 仅新建池保留「初始分母」;快照过期(参数晚于池快照 → 去重算)进告警抽屉。
// V69(用户 2026-07-30 拍板):池=楼栋+楼层+侧向+费项四级定位,池名自动生成不手写;组成电表与受益人
// 一律勾选(候选来自 /pool-candidates,标签用位置不用内部标识);
// /member-diff=本月在租租户与池受益人的差集。
// LAYOUT-STABILITY-SPEC §6(2026-08-25 用户拍板):快照过期 / 本次生成告警 / 池成员变动三条流内橙条
// 撤出页面 —— 工具条常驻 chip(FPAlertChip,两态都渲染)+ 右侧抽屉(FPAlertPanel)。判定逻辑未动,只换呈现。
// 刀3(用户 2026-07-30 报障):①分带只按楼栋(四级分带带头比数据行还多),楼层+方位与费项名各自成列;
// ②摊出/差额两列已撤(用户 2026-08-02 拍板:A座天面等池的户级收取有协议户/一楼不收等例外,
// 屏上按面积正向试算不成立,摆着是误导);引擎仍算 allocated/gap 落库,供生成告警与未来 bill 对账,
// 只是不再上屏。实收/盈亏两列恒'–',待 bill_notice 落地回填(POOL-ENGINE-SPEC §6.1)。
// BOOK-REBUILD-SPEC §H4(2026-07-31):①分带改**原册块**(一期 7 块,块名逐字;按楼栋分带会把
// A 座两个块并成一带、三行招商中心抽成自成一带);②池名称列优先显原册 A 列自然键 book_key;
// ③「楼层·方位」列归一为一格 floor_label(side 不再拼);④带尾出块合计行(口径同原册 SUM 区间)。
// §H3:用了 2023 冻结参数的池(V83 的 alloc_cfg frozen_2023 默认行),「分摊标准」格加 ❄ 并在 title 里
// 披露来源单元格与真实年月 —— 只披露不重算(重算会改动已出的实收,需用户单独拍板)。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import {
  allocApi,
  type AllocCandidatesDTO, type AllocFeeKey, type AllocInForce, type AllocLinkType, type AllocMemberDiffDTO,
  type AllocMethod, type AllocMethodEditable, type AllocPoolLineDTO, type AllocPoolRowDTO,
  type AllocPoolsDTO, type AllocRuleDTO, type AllocStdKind, type AllocZone,
} from '@/api/alloc'
import { paramsApi, type ParamRowDTO, type ParamStatusDTO } from '@/api/params'
import { metersApi, type MeterDTO } from '@/api/meters'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { ALLOC_FEE_KEYS, ALLOC_FEE_LABEL } from '@/utils/allocLogic'
import { baseRefLabel, rangeBadge, staleText } from '@/utils/paramCenterLogic'
import { PARAM_DEFS } from '@/utils/paramRegistry'
import { buildYearOptions } from '@/utils/yearGate'
import { latestPeriodOf } from '@/utils/defaultPeriod'
import { useTabsStore } from '@/stores/tabs'
import {
  FROZEN_CFG_KEY, POOL_LOC_HINT, POOL_LOC_UNSET, POOL_ZONE_LABEL, bandFooter, buildPoolExportAoa,
  costPerLine, groupPoolsByBookBlock, lineArea, lineFloor, lineLabel, lineUseName, netSummary,
  poolArea, poolAutoName, poolFeeLabel, poolFloor, poolFooter, poolLocKind, poolNote, poolSemantics,
  poolSpan, poolSubtitle, stdDisplay,
} from '@/utils/poolLedgerLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPAlertChip from '@/components/fp/FPAlertChip.vue'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPToast from '@/components/fp/FPToast.vue'
import { useEditMode } from '@/composables/useEditMode'

const auth = useAuthStore()
// RBAC:本屏两扇门不同权 —— 生成快照是「跑一次出账」,池配置是「改计费口径」。
// 2026-08-22 起铁律改为「进得了编辑模式 ⇒ 本页权限一定齐」(EDIT-MODE-SPEC v3):编辑态里不再有
// 点不动的控件,也不再有「点了转成授权请求」的包装。这个只用来画**浏览态**的文案与可点态
// (param-policy:edit 仍由下面 useEditMode 的权限组把门,只是屏上不再单独取用)。
const canGen = computed(() => auth.can('billing-run:edit'))

// ── 编辑模式(EDIT-MODE-SPEC v3):切页签保留编辑态,只关浮层 ──
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated } =
  useEditMode(['billing-run:edit', 'param-policy:edit'])
onDeactivated(() => { poolDlg.value = false })

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmt2 = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 账期(整体数据驱动)+ zone Segmented(一期/二期/宿舍,无全部;一级页签不参与重置) ──
// today 只喂 buildYearOptions 的「∪ 当前年」窗口;年月初值由 onMounted 的 latestPeriodOf(/months 全集取 max)一起定(§4)
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
// S21:池参数只读镜像(分母/加度/2023 冻结价披露)= 计费参数页同一读口,只拉 rule: 三个键(全期别一份,随月不随 zone)
const paramRows = ref<ParamRowDTO[]>([])
const status = ref<ParamStatusDTO | null>(null)
const rules = ref<AllocRuleDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const meters = ref<MeterDTO[]>([])
const tenants = ref<TenantDTO[]>([])           // §E6:direct 池的全库租户选择器候选
const diffs = ref<AllocMemberDiffDTO[]>([])
// P1-6:三条 Promise 里唯独主数据 pools 过去没兜底 —— /alloc/pools 一挂,pools 恒为 null,
// 整页就停在转圈骨架上(没有一个字、没有重试入口,只能刷浏览器);换月失败更险:上个月的行
// 留在屏上,而行内月度参数写的是**新**月份。故失败=清空本月三份数据 + 记 loadErr,
// 让「加载失败」与「本月无数据」在屏上分得开(前者红条+重试,后者仍走 generated=false 的灰条)。
// 兜底放 loadMonth 内部,五个调用点(onMounted/watch/onGenerate/submitPool/delPool)
// 就都不必各自 catch。
const loadErr = ref('')
let seq = 0
async function loadMonth() {
  const my = ++seq
  loadErr.value = ''                 // 先清:重试点下去立刻回落转圈骨架,不然按钮像没反应
  try {
    const [ps, pr, df, st] = await Promise.all([
      allocApi.pools(ym.value),
      paramsApi.list(ym.value, 'all', { scope: 'rule:', key: 'coefficient,extra_qty,frozen_2023' })
        .catch(() => [] as ParamRowDTO[]),
      allocApi.memberDiff(ym.value).catch(() => [] as AllocMemberDiffDTO[]),
      paramsApi.status(ym.value).catch(() => null),
    ])
    if (my !== seq) return
    pools.value = ps; paramRows.value = pr; diffs.value = df; status.value = st
  } catch (e) {
    if (my !== seq) return           // 更晚的一次请求已在路上,别用旧的失败盖掉它的结果
    pools.value = null; paramRows.value = []; diffs.value = []
    loadErr.value = errMsg(e, '服务异常')
  }
}
// 页签切回:参数页那边可能刚重算过 —— 池快照时间变了就整月重拉(数字与 stale 条一起变新),没变只刷状态
// (回包前若已换月(seq 变了)就丢弃,别让旧月 status 盖住新月的 stale 条)
async function refreshStatus() {
  const my = seq, before = status.value?.poolSnapshotAt
  const st = await paramsApi.status(ym.value).catch(() => null)
  if (my !== seq || !st) return
  if (st.poolSnapshotAt !== before) loadMonth()
  else status.value = st
}
const staleMsg = computed(() => staleText(status.value, 'pool'))
// §E2 隐患①:rules 载入失败过去被 .catch(()=>{}) 全静默 —— openPoolDlg 从 ruleById 取
// feeKey/coefficient/extraQty,拿不到就静默回落默认值,保存即把这三项冲掉。改为记失败标记,
// 抽屉据此禁用保存并给重试(不改调用方的 catch:那只是别让加载失败炸掉整页)。
const rulesFailed = ref(false)
async function loadRules() {
  try { rules.value = await allocApi.rules(); rulesFailed.value = false }
  catch (e) { rulesFailed.value = true; throw e }
}
// 主数据清单(页签切回回拉:租户改名/楼栋单元/抄表建档后不显旧清单)
function loadMasters() {
  buildingApi.list().then(bs => { buildings.value = bs }).catch(() => {})
  metersApi.list('elec').then(ms => { meters.value = ms }).catch(() => {})
  tenantApi.list().then(ts => { tenants.value = ts }).catch(() => {})
}
onReactivated(() => { loadMasters(); refreshStatus() })

// 深链带账期落到同一个月(generate=1 直接进编辑模式) —— 否则用户到了这儿还要自己重选年月、再找到「编辑模式」
// 才看得见生成按钮(2026-08-14 用户报障)。
const route = useRoute()
function applyHandoff(): boolean {
  const q = route.query
  const m = typeof q.ym === 'string' ? /^(\d{4})-(\d{2})$/.exec(q.ym) : null
  // 同 ParamCenterView:深链也要过权限闸 —— 走 toggle 而不是裸写 editMode
  // (裸写在权限不齐时会被守卫下一个 tick 静默弹回浏览态;toggle 会弹授权窗)
  if (q.generate === '1' && canEnter.value) toggleEdit()
  if (!m) return false
  year.value = +m[1]; month.value = +m[2]
  return true
}

onMounted(async () => {
  loadRules().catch(() => {})
  loadMasters()
  if (applyHandoff()) { loadMonth(); return }   // 带账期来的:不再被「跳到最新年」覆盖
  try {
    // years 供年下拉、months 定默认账期,互不依赖 → 并发,一个往返拿齐
    const [ys, months] = await Promise.all([allocApi.years(), allocApi.poolMonths()])
    dataYears.value = ys
    // §4:year 与 month 一起 snap 到最后一个**有池快照**的账期(原来只 snap year、month 留系统当月,
    // 拼出的账期没快照,一进来就是「本月未生成」的灰条)。
    // ⚠ 判据必须走 /alloc/pool-months(直查快照表),**不能拿 /alloc/pools 的 rows 判有无** ——
    //   那是 alloc_rule 全表左连当月快照,任何月都非空,判出来恒为 true、默认月恒落 12 月。
    const p = latestPeriodOf(months)
    if (p && (p.year !== year.value || p.month !== month.value)) {
      year.value = p.year; month.value = p.month; return   // watch 触发 loadMonth
    }
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
// 换账期:上次生成的告警不再适用;cfgDirty 同理 —— 它记的是「**这个月**改过参数还没重算」,
// 换到别的月还亮着就是误报(在 8 月改了参数,切到 9/10 月那条橙条一路跟着,而那些月根本没动过),
// 用户分不清哪个月真的需要重算。2026-08-15 用户点名。
watch([year, month], () => { genWarnings.value = []; cfgDirty.value = false; loadMonth() })

const ruleById = computed(() => new Map(rules.value.map(r => [r.id, r])))
const buildingOpts = computed(() => [{ value: '', label: '(园区级,不挂楼栋)' },
  ...buildings.value.map(b => ({ value: String(b.id), label: b.name }))])

// ── 分带表体(§H4.2b):按原册块分带(一期 7 块;二期/宿舍无块回落楼栋),楼层成列;
// 带尾出块合计(口径同原册 SUM 区间),tfoot 出全期合计(均剔 ref 行) ──
const bands = computed(() => groupPoolsByBookBlock(pools.value?.rows ?? [], zone.value))
const foot = computed(() => poolFooter(bands.value))
const generated = computed(() => pools.value?.generated ?? false)

// ── 受益人变动(告警抽屉「池成员变动」组):只提示本 zone 的池;点条目进配置面板定位 ──
const zoneRuleIds = computed(() =>
  new Set((pools.value?.rows ?? []).filter(r => r.zone === zone.value).map(r => r.ruleId)))
const zoneDiffs = computed(() => diffs.value.filter(d => zoneRuleIds.value.has(d.ruleId)))
const rowById = computed(() => new Map((pools.value?.rows ?? []).map(r => [r.ruleId, r])))
function gotoDiff(ruleId: number) {
  const r = rowById.value.get(ruleId)
  if (!r) return
  editMode.value = true
  // 没有 param-policy 也让他进来看:池配置弹窗内部自会按权限决定能不能改/给授权入口
  openPoolDlg(r)
}

// 列模型:p2 分时 5 列(总/尖/峰/平/谷),p1/dorm 只显总列
interface SegDef { lab: string; k: 'qtyTotal' | 'qtySharp' | 'qtyPeak' | 'qtyFlat' | 'qtyValley' }
const ALL_SEGS: SegDef[] = [
  { lab: '总', k: 'qtyTotal' }, { lab: '尖', k: 'qtySharp' }, { lab: '峰', k: 'qtyPeak' },
  { lab: '平', k: 'qtyFlat' }, { lab: '谷', k: 'qtyValley' },
]
const segDefs = computed(() => (zone.value === 'p2' ? ALL_SEGS : ALL_SEGS.slice(0, 1)))
// V73 列模型:楼层+池名称(2) + 逐表列 电表/倍率/上月/本月(4) + 用量段
// + 应分摊/语义/标准(3) + 编辑态月参(2) + 实收/盈亏/备注(3)
const colCount = computed(() => 7 + segDefs.value.length + 3 + (editMode.value ? 2 : 0) + 3)

// sticky 左两列(FPLedgerTable 手法:offset=列宽累加)
// sticky 左三列:区域(原册 B) + 楼层(原册 C) + 池名称(原册 D)。offset 由列宽累加,改宽必须同步改 left。
const AREA_W = 76
const FLOOR_W = 96
const NAME_W = 150
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
const fixArea = { ...w(AREA_W), left: '0px' }
const fixFloor = { ...w(FLOOR_W), left: AREA_W + 'px' }
const fixName = { ...w(NAME_W), left: AREA_W + FLOOR_W + 'px', borderRight: '1px solid var(--border-subtle)' }
const fixBand = { left: '0px', borderRight: '1px solid var(--border-subtle)' }

// ── 生成本月/重新生成(编辑态;POST generate 后刷新) ──
const cfgDirty = ref(false)   // 池配置/月度参数改动后提示「配置已变,请重新生成」
const generating = ref(false)
// 生成告警(AllocGenerateResultDTO.warnings):引擎的「静默吞钱防线」——无受益人未摊到户 N 元/
// 摊出超应分摊/缺起止日期户未入名册/缺参。全期别一份,不随 zone 页签过滤;换账期清空。
const genWarnings = ref<string[]>([])
async function onGenerate() {
  if (generating.value) return
  if (generated.value && !confirm(`重新生成 ${ym.value}:按月先删后插覆盖池/损耗快照。读数或配置已变时数字将按当前数据重算。确认?`)) return
  generating.value = true
  try {
    const res = await allocApi.generate(ym.value)
    cfgDirty.value = false
    genWarnings.value = res.warnings ?? []
    await loadMonth()
  } catch (e) { alert(errMsg(e, '生成失败')) } finally { generating.value = false }
}

// ── 导出当月(纯函数 buildPoolExportAoa) ──
async function onExport() {
  const { writeAoaWorkbook } = await import('@/utils/sheet')
  const aoa = buildPoolExportAoa(bands.value, ym.value, POOL_ZONE_LABEL[zone.value])
  await writeAoaWorkbook(`公共电核算-${ym.value}-${POOL_ZONE_LABEL[zone.value]}.xlsx`,
    [{ name: '公共电核算', aoa }])
}

// ── §H3 二期 2023 冻结参数披露:V83 落在 alloc_cfg 的 rule:{id} 初始版本行(不随月份变=冻结)。
//    note 原文进「分摊标准」列 title,格上加 ❄ 让它不用悬停也看得见。──
const frozenNote = computed(() => {
  const m = new Map<number, string>()
  for (const r of paramRows.value)
    if (r.key === FROZEN_CFG_KEY && r.note) m.set(Number(r.scope.slice(5)), r.note)
  return m
})
const stdCell = (r: AllocPoolRowDTO) => stdDisplay(r, frozenNote.value.get(r.ruleId))

// ── 刀I §I3 逐行身份(ROW-IDENTITY-SPEC):楼层/池名称两列逐行取自**本行电表** ──
// 原册 B(区域)/C(楼层)/D(企业名称)永远逐行写、从不纵向合并;纵向合并的只有 AA/AC/AE/AF/AG
// —— 屏上的 rowspan 也就只保留给 分摊语义/分摊标准/系数(月)/加度(月)/实收/盈亏/备注。
// 行值缺(净额池不出逐表行 / 无绑定表 / 后端老快照)才回落池级值。
const rowArea = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => lineArea(ln, poolArea(r))
const rowFloor = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => lineFloor(ln, poolFloor(r))
const rowName = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => lineUseName(ln, poolFeeLabel(r))

// ── 池参数只读镜像(S21 §2.4):编辑态「分摊基数 / 加减度数」两列 + 抽屉③一行,值=站在本月的生效值(不是月行也不是默认列),
//    徽标=生效方式(仅本月 / 长期);写入口只在计费参数页(点击带 ym+池高亮跳过去) ──
// text=格里的紧凑数;full=抽屉里的值文案(走面积基数的池后端给「148,918.01 ㎡」+ 命中链末项「取自「园区分摊面积基数」」,格里显数+「面积基数」徽标)
// LIST-PAGE-SPEC §8:模板每格调 6 次、抽屉与表同组件(抽屉里每敲一键整表重渲染)—— 格对象按 (池,键) 在 computed 里建一次 Map,模板只 get
interface ParamCell { text: string; full: string; badge: string; tone: 'month' | 'from' | 'inherit'; title: string; range: string; baseRef: string | null }
const EMPTY_CELL: ParamCell = { text: '–', full: '未设置', badge: '', tone: 'inherit', title: '未设置 —— 点击去计费参数页填', range: '未设置', baseRef: null }
const paramCells = computed(() => {
  const m = new Map<string, ParamCell>()
  for (const r of paramRows.value) {
    if (r.mode == null || (r.key !== 'coefficient' && r.key !== 'extra_qty')) continue
    const b = rangeBadge(r)
    const baseRef = baseRefLabel(r)
    m.set(`${r.scope}|${r.key}`, { text: fmt(r.value), full: r.valueText, tone: b.tone, range: r.rangeText, baseRef,
      badge: baseRef ? '面积基数' : b.tone === 'month' ? '仅本月' : '长期',
      title: `${r.valueText}（${r.rangeText}）${baseRef ? `· 取自「${baseRef}」` : ''}· 点击去计费参数页改` })
  }
  return m
})
const paramCell = (ruleId: number, key: 'coefficient' | 'extra_qty'): ParamCell => paramCells.value.get(`rule:${ruleId}|${key}`) ?? EMPTY_CELL
// 抽屉③只读句:「分摊基数 5.7（2023-12 起长期）· 加减度数 +170（仅本月）」;走面积基数的池写「分摊基数 148,918.01 ㎡（取自「园区分摊面积基数」）」
function roParamLine(ruleId: number): string {
  const c = paramCell(ruleId, 'coefficient'), e = paramCell(ruleId, 'extra_qty')
  const coef = c.tone === 'inherit' ? '分摊基数 未设置' : c.baseRef ? `分摊基数 ${c.full}（取自「${c.baseRef}」）` : `分摊基数 ${c.full}（${c.range}）`
  const extra = e.tone === 'inherit' ? '加减度数 未设置' : `加减度数 ${e.full}（${e.range}）`
  return `${coef} · ${extra}`
}
const router = useRouter()
const tabs = useTabsStore()
// 深链协议:KeepAlive 缓存实例只在 setup 消费 query,必须 openFresh;section 按键归区(加减度数=① 本月参数,分摊基数=② 长期常数);
// edit=1:[去重算] 落地直接进编辑态(重算按钮只在编辑态出)
function gotoParams(ruleId?: number, key: 'coefficient' | 'extra_qty' | null = null, edit = false) {
  tabs.openFresh('params', { pin: true })
  const section = key === 'extra_qty' ? 'monthly' : 'constant'
  router.push({ path: '/params', query: { ym: ym.value, zone: zone.value, section,
    ...(ruleId != null ? { rule: String(ruleId) } : {}), ...(edit ? { edit: '1' } : {}) } })
}

// ── 屏级告警:常驻 chip + 右侧抽屉(LAYOUT-STABILITY-SPEC §6,2026-08-25 用户拍板)──
// 原来这三条(stale / 生成告警 / 受益人变动)各占一条橙色流内提示条,本屏一度并存 5 条:
// 顶动表格、清除条件苛刻 → 变成永久噪音。判定逻辑一个字没改,只换呈现:三组收进抽屉,
// 工具条上留一个位置固定的 chip(有告警=实底计数,无告警=quiet 静默态仍渲染)。
const alertOpen = ref(false)
const nameList = (ts: { tenantName: string | null }[]) =>
  ts.slice(0, 3).map(t => t.tenantName || '未命名').join('、') + (ts.length > 3 ? ` 等 ${ts.length} 户` : '')
const alertGroups = computed<AlertGroup[]>(() => {
  const gs: AlertGroup[] = []
  if (staleMsg.value) gs.push({
    key: 'stale', title: '快照过期',
    desc: '计费参数(电价/系数/加减度数)在本月快照生成之后又改过 —— 屏上数字仍是改参前算的。'
      + '不重算,公共电核算 / 楼栋损耗 / 催缴单三处都停在旧口径,出账就按旧数走。',
    items: [{ text: staleMsg.value }],
    action: { label: '去计费参数页重算', icon: 'refresh-cw',
      run: () => { alertOpen.value = false; gotoParams(undefined, null, true) } },
  })
  if (genWarnings.value.length) gs.push({
    key: 'gen', title: '本次生成告警',
    desc: '引擎生成时报的静默吞钱防线:池没有受益人(应分摊的钱没摊到任何一户)、缺读数、缺参数。'
      + '不管它,这笔钱就在账上消失、谁也不会被收。全期别一份,不随一期/二期页签过滤;'
      + '逐条核对源头后重新生成即清空(换账期也会清)。',
    items: genWarnings.value.map(text => ({ text })),
  })
  if (zoneDiffs.value.length) gs.push({
    key: 'diff', title: '池成员变动',
    desc: '本月在租的租户与池里勾选的受益人对不上:新在租的还没勾进池(他那份公摊没人分担),'
      + '已退租的还挂在池里(会摊到走掉的户头上)。首次配置为全新带出,配置后只提示增减。'
      + '点一条打开池配置勾选修正,改完重新生成。',
    items: zoneDiffs.value.map(d => ({
      text: `${rowById.value.get(d.ruleId)?.autoName || d.poolName}　`
        + [d.added.length ? `+${d.added.length} 新在租` : '', d.removed.length ? `−${d.removed.length} 已退租` : '']
          .filter(Boolean).join(' / '),
      hint: [d.added.length ? `新:${nameList(d.added)}` : '', d.removed.length ? `退:${nameList(d.removed)}` : '']
        .filter(Boolean).join('　'),
      onClick: () => { alertOpen.value = false; gotoDiff(d.ruleId) },
    })),
  })
  return gs
})
const alertCount = computed(() => alertGroups.value.reduce((s, g) => s + g.items.length, 0))

// ── 池配置抽屉(V69 勾选式):四级定位→池名自动生成;组成电表/受益人按定位候选勾选 ──
const poolDlg = ref(false)
const poolErr = ref('')
const saving = ref(false)
// 保存/删除成功的轻提示(3s 自淡出);抽屉关了才看得见,故挂在页面提示条区
const okMsg = ref('')
// 自动消失与关闭按钮由 FPToast 内部管（LAYOUT-STABILITY-SPEC §2 优先级 2：浮层，不进文档流）
function flashOk(msg: string) { okMsg.value = msg }
interface PoolForm {
  id: number | null; zone: AllocZone
  buildingId: number | null; floorLabel: string; side: string; feeName: string
  method: AllocMethod; feeKey: AllocFeeKey; note: string
  coefficient: string                 // 仅新建池:初始分母(落成 rule:{新id}.coefficient 初始版本行);既有池的分母在计费参数页改
  roundScale: number; stdKind: '' | AllocStdKind; baseKey: string
  meters: { meterId: number; sign: number; label: string }[]
  links: { ruleId: string; type: AllocLinkType }[]
  members: { tenantId: number; tenantName: string; unitNo: string | null; weight: number | null; inForce: AllocInForce }[]
  monthOnly: boolean                  // 受益人自本月起(写 acct_month 版本组,不动此前月份与默认长期名单)
  oldName: string                     // 存量池名(定位三项全空时后端保留原名,此处照实展示)
}
const form = ref<PoolForm>(emptyForm())
function emptyForm(): PoolForm {
  return { id: null, zone: zone.value as AllocZone, buildingId: null, floorLabel: '', side: '', feeName: '',
    method: 'floor', feeKey: 'share_elec_floor', coefficient: '', note: '',
    roundScale: 2, stdKind: '', baseKey: '', meters: [], links: [], members: [], monthOnly: false,
    oldName: '' }
}
// 分摊方式(草图四档);ref/loss 只在该池本来就是时才露出,免把存量纯标准行误改。
// manual 不在可选值域(AllocMethodEditable 已排掉):它没有 TEXT/HINT,以前会渲染出一个无字空单选。
const METHOD_TEXT: Record<AllocMethodEditable, string> = {
  area: '按面积', floor: '按层份', direct: '户对户', none: '园区自担',
  loss: '并入损耗', ref: '纯标准行', carrier: '冲减载体',
}
const METHOD_HINT: Record<AllocMethodEditable, string> = {
  area: '按受益户租赁面积摊（分摊基数 = 受益面积合计 ㎡）', floor: '按层份摊（分摊基数 = 层数，可小数）',
  direct: '整笔给唯一受益户', none: '不摊给租户,全额挂园区亏',
  loss: '并入损耗链', ref: '只出分摊标准供别池折入,不出应分摊',
  carrier: '表已在别池以「−」冲减,本行只陈列用量,不出应分摊、不入金额合计',
}
const isManualPool = computed(() => form.value.method === 'manual')
const methodRadios = computed(() => {
  const cur = form.value.method
  if (cur === 'manual') return []          // 人工指定池不给单选,改由旁边一行说明顶上
  const base: AllocMethodEditable[] = ['area', 'floor', 'direct', 'none']
  return (base.includes(cur) ? base : [...base, cur])
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
const ROUND_OPTS = [{ value: '2', label: '四舍五入到 2 位' }, { value: '3', label: '四舍五入到 3 位' }]
const STD_OPTS = [
  { value: '', label: '按期别默认' },
  { value: 'amount_over_base', label: '金额 ÷ 分摊基数（二期默认）' },
  { value: 'qty_price_over_base', label: '(用量 + 加减度数) ÷ 分摊基数 × 单价（一期 / 宿舍默认）' },
  { value: 'qty_over_base', label: '用量 ÷ 分摊基数（广告字档）' },
]
// 面积基数来源候选 = 注册表里的面积基数键(value 仍是键,页面显 label;空 = 用本池分摊基数);提交体不变
const BASE_KEY_OPTS = [{ value: '', label: '用本池分摊基数' },
  ...PARAM_DEFS.filter(d => d.key.endsWith('area_base')).map(d => ({ value: d.key, label: d.label }))]
const LINK_TYPE_OPTS = [
  { value: 'fold_price', label: '折入标准(fold_price)' },
  { value: 'fold_qty', label: '折入度数(fold_qty)' },
]
const linkRuleOpts = computed(() =>
  rules.value.filter(r => r.id !== form.value.id).map(r => ({ value: String(r.id), label: r.name })))

// 受益人楼层(§D.1 后端读时现算,不落库):has()=后端算过,值 null=未定层(会与其他未定层户合摊 1 份);
// 新勾选的户不在表内 —— 楼层要保存后由后端解析才知道
const floorByTenant = ref(new Map<number, string | null>())
// §D.5 取消勾选时暂存份额,勾回时取回 —— 旧实现恒写 null,rule 49/77 的 0.5 份会被静默冲掉
const weightStash = new Map<number, number | null>()
// §G4 抽屉打开时定位三格是否高亮(该池被判为「待补定位」)
const locTodo = ref(false)

function openPoolDlg(r?: AllocPoolRowDTO) {
  poolErr.value = ''
  weightStash.clear()
  // §H4:挂栋却没录楼层的池,打开时高亮定位三格
  locTodo.value = !!r && poolLocKind(r) === 'todo'
  floorByTenant.value = new Map(r ? r.members.map(m => [m.tenantId, m.floorLabel] as [number, string | null]) : [])
  if (r) {
    const rule = ruleById.value.get(r.ruleId)
    form.value = {
      id: r.ruleId, zone: r.zone, buildingId: r.buildingId,
      floorLabel: r.floorLabel ?? '', side: r.side ?? '', feeName: r.feeName ?? '',
      method: r.method, feeKey: rule?.feeKey ?? 'share_elec_floor',
      coefficient: '', note: r.note ?? '',      // 既有池不再从抽屉写分母(参数页版本链是唯一入口)
      roundScale: r.roundScale, stdKind: r.stdKind ?? '', baseKey: r.baseKey ?? '',
      meters: r.meters.map(m => ({ meterId: m.meterId, sign: m.sign, label: m.label ?? m.name })),
      links: r.links.map(l => ({ ruleId: String(l.ruleId), type: l.type })),
      members: r.members.map(m => ({ tenantId: m.tenantId, tenantName: m.tenantName ?? `#${m.tenantId}`,
        unitNo: m.unitNo, weight: m.weight, inForce: m.inForce })),
      monthOnly: r.members.some(m => m.src === 'month'),
      oldName: r.name,
    }
  } else form.value = emptyForm()
  // 名单快照按池重置(与 cands 同理:不清就还挂着上一个池的受益人),再把本池已存受益人全部记进去
  seenMembers.value = new Map()
  for (const m of form.value.members) rememberMember(m)
  otherOpen.value = false; otherQ.value = ''
  // 候选先清空再取:抽屉是同一份 state,不清就还挂着**上一个池**的候选表/受益人,
  // 新候选回来前那半秒里勾中的是别的池的表,保存即写进当前池
  cands.value = { meters: [], tenants: [], tenantNote: null }
  poolDlg.value = true
  loadCands()
}

// ── 组成候选(/pool-candidates,按定位过滤):定位一改就重取;新增池预勾(infra 除外) ──
const cands = ref<AllocCandidatesDTO>({ meters: [], tenants: [], tenantNote: null })
const candLoading = ref(false)
let candSeq = 0
// prefill=是否按候选重新预勾(新增池默认预勾;改分摊方式时只换候选口径,不能冲掉已勾的表和户)
async function loadCands(prefill = form.value.id == null) {
  const my = ++candSeq
  candLoading.value = true
  try {
    // §E6:带上 method —— direct 时后端回空 tenants + tenantNote(不推该定位在租名单)
    const c = await allocApi.poolCandidates(ym.value, form.value.buildingId,
      form.value.floorLabel || null, form.value.side || null, form.value.method)
    if (my !== candSeq) return
    cands.value = c
    if (prefill) {                        // 新增池:非 infra 表 + 该定位在租租户预勾
      form.value.meters = c.meters.filter(m => m.ownership !== 'infra')
        .map(m => ({ meterId: m.meterId, sign: 1, label: m.label }))
      // §D.4:direct=户对户只摊一户,不按定位预勾一堆在租租户(用户报障「一堆新在租」即此)
      form.value.members = form.value.method === 'direct' ? []
        : c.tenants.filter(t => t.preChecked !== false)
          .map(t => ({ tenantId: t.tenantId, tenantName: t.tenantName ?? `#${t.tenantId}`,
            unitNo: t.unitNo, weight: null, inForce: t.inForce ?? 'yes' }))
    }
  } catch { if (my === candSeq) cands.value = { meters: [], tenants: [], tenantNote: null } } finally {
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
// 与后端 AllocService.meterLabel 同规则(V73):区域·位置·用途·表号。
// 用途取 tenantName(=账册「企业名称」列原文,公摊表存的是「东侧货梯」这类用途),空则回退标识名。
// 旧实现只取「位置·表号」,B座天面 4 块表全叫「天面·电表①」,用户挑不出谁是谁。
const meterLabelOf = (m: Pick<MeterDTO, 'name' | 'area' | 'spot' | 'tenantName' | 'subName'>) =>
  [m.area, m.spot, m.tenantName?.trim() || m.name, m.subName]
    .map(x => x?.trim()).filter((x): x is string => !!x)
    .filter((x, i, a) => a.indexOf(x) === i).join('·')
const otherList = computed(() => {
  const kw = otherQ.value.trim()
  const inRows = new Set(meterRows.value.map(r => r.meterId))
  return meters.value.filter(m => !inRows.has(m.id)
    && (kw === '' || m.name.includes(kw) || (m.subName ?? '').includes(kw)
      || (m.spot ?? '').includes(kw) || (m.area ?? '').includes(kw)
      || (m.tenantName ?? '').includes(kw) || (m.code ?? '').includes(kw))).slice(0, 40)
})

// 受益人勾选行=候选(在租) ∪ 本次会话出现过的受益人(退租的灰显标注,缺日期的橙标「判不了」)
interface TenantRow { tenantId: number; name: string; unitNo: string | null; inForce: AllocInForce; other: boolean }
// ⭐行集必须「只增不减」(2026-08-14 用户报障:「分摊给谁只要一点移除,租户选项直接消失,
// 根本没办法重新找到入口」)。原实现取 候选 ∪ **当前** form.members —— 那些「已是受益人但不在
// 本定位候选里」的户(退租户、跨定位手工加的户)一取消勾选就同时退出两个来源,行当场消失且勾不回来,
// 唯一补救是取消整个抽屉重开,这一路的其它改动一并作废。现在把它们记进 seenMembers:
// 取消只改 form.members(勾选态),行照留在名单里,随时能勾回来(份额也由 weightStash 原样取回)。
const seenMembers = ref(new Map<number, Omit<TenantRow, 'other'>>())
function rememberMember(m: { tenantId: number; tenantName: string; unitNo: string | null; inForce: AllocInForce }) {
  seenMembers.value.set(m.tenantId,
    { tenantId: m.tenantId, name: m.tenantName, unitNo: m.unitNo, inForce: m.inForce })
}
const tenantRows = computed<TenantRow[]>(() => {
  const rows: TenantRow[] = cands.value.tenants.map(t => ({
    tenantId: t.tenantId, name: t.tenantName ?? `#${t.tenantId}`, unitNo: t.unitNo,
    inForce: t.inForce ?? 'yes', other: false }))
  const has = new Set(rows.map(r => r.tenantId))
  for (const m of seenMembers.value.values()) if (!has.has(m.tenantId)) rows.push({ ...m, other: true })
  return rows
})
const memberOf = (id: number) => form.value.members.find(m => m.tenantId === id)
function toggleMember(t: TenantRow) {
  const i = form.value.members.findIndex(m => m.tenantId === t.tenantId)
  if (i >= 0) {                                  // §D.5 取消:份额先入暂存,勾回时原样取回
    weightStash.set(t.tenantId, form.value.members[i].weight)
    form.value.members.splice(i, 1)
    return
  }
  // §D.4 direct=户对户单选:勾新的即替换旧的(整笔只能归一户)
  if (form.value.method === 'direct') form.value.members = []
  form.value.members.push({ tenantId: t.tenantId, tenantName: t.name, unitNo: t.unitNo,
    weight: weightStash.get(t.tenantId) ?? null, inForce: t.inForce })
  rememberMember({ tenantId: t.tenantId, tenantName: t.name, unitNo: t.unitNo, inForce: t.inForce })
}
// §E6 direct=户对户:后端不推该定位在租名单(推了也没意义),那一户从全库租户里直接挑
const tenantOpts = computed(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))
const directTenantId = computed(() => form.value.members[0]?.tenantId ?? null)
function pickDirect(id: number | null) {
  if (id == null) { form.value.members = []; return }
  const cand = cands.value.tenants.find(t => t.tenantId === id)      // 同定位候选里有就沿用其单元/在租态
  form.value.members = [{
    tenantId: id, tenantName: tenantOpts.value.find(t => t.id === id)?.name ?? `#${id}`,
    unitNo: cand?.unitNo ?? null, weight: null, inForce: cand?.inForce ?? 'yes',
  }]
  rememberMember(form.value.members[0])
}
// §D.5 份额:空=按楼层自动分(该户所在层各摊 1 份,层内多户按面积拆);填值=显式份额覆盖(账册 49/77 的 0.5)
function commitWeight(id: number, raw: string) {
  const m = memberOf(id)
  if (!m) return
  const t = raw.trim()
  if (t === '') { m.weight = null; weightStash.delete(id); return }
  const v = Number(t)
  if (!isFinite(v)) { alert('份额请输入数字(1=整份,0.5=半份;留空=按楼层自动分)'); return }
  m.weight = v
  weightStash.set(id, v)
}
// 改成户对户时只留第一个受益人(§D.4 整笔归一户,免存出一个 13 户的 direct 池);
// 只在用户点分摊方式时触发,不在打开抽屉时静默改动既有名单
function setMethod(m: AllocMethodEditable) {
  form.value.method = m
  if (m === 'direct') form.value.members = form.value.members.slice(0, 1)
  // §E6:候选口径随 method 变(direct 不推在租名单)。不用 watch:打开抽屉时 method 也在变,
  // 会与 openPoolDlg 里那次 loadCands 抢 candSeq 把新增池的预勾吃掉。这里只走用户点击这一条路。
  loadCands(false)
}
// ④ 段抬头:direct=户对户单选(§D.4)/园区级未勾人=自动全园/其余=勾选计数
const memberSummary = computed(() => form.value.method === 'direct'
  ? `整笔归 ${form.value.members[0]?.tenantName ?? '(未指定)'}`
  : formAutoMembers.value ? '自动=全园在租' : `已选 ${form.value.members.length} 户`)
const memberHint = computed(() => form.value.method === 'direct'
  ? (cands.value.tenantNote ?? '户对户池只摊给一户,不按定位推在租名单 —— 选中一户即替换原有的')
  : formAutoMembers.value ? '园区级池不勾人=按该期全园在租租户自动摊(勾了就以勾选为准)'
    : '候选=该定位本月在租租户(按合同预勾;侧向勾错请手动取消)')
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
      // 新建池:初始分母经后端落成 rule:{新id}.coefficient 初始版本行;既有池入参被后端忽略(分母/加度只在参数页改)
      method: f.method, coefficient: f.id == null ? num(f.coefficient) : null,
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
    // §E2 隐患②:过去存完悄无声息,「存了但没变化」与「压根没存」分不清
    flashOk(`池「${formAutoName.value}」已保存`)
    loadRules().catch(() => {})
    // 「保存并重新生成」:本月已有快照就顺手重算,否则留提示条。
    // 失败必须说话:成环 409 与缺电价 400 都从这条路来,过去被空 catch 吞掉只剩一条泛泛黄条。
    if (generated.value) {
      try {
        const res = await allocApi.generate(ym.value)
        cfgDirty.value = false
        genWarnings.value = res.warnings ?? []
      } catch (e) { cfgDirty.value = true; alert(errMsg(e, '重新生成失败')) }
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
    flashOk(`池「${f.oldName || formAutoName.value}」已删除`)
    cfgDirty.value = true
    loadRules().catch(() => {})
    await loadMonth()
  } catch (e) { poolErr.value = errMsg(e, '删除失败') }
}
</script>

<template>
  <!-- 加载失败不走骨架:骨架下面没有任何文字与出口。失败时照常出页壳,账期选择器要留着
       —— 否则用户被锁在失败的那个月上,连切回上个月都做不到 -->
  <div v-if="!pools && !loadErr" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="pl-page">
    <!-- 标题行:h2+账期;右=导出(常驻)+生成/新增池(编辑态)+编辑模式 -->
    <div class="pl-head">
      <div class="pl-head-l">
        <h2 class="pl-title"><span class="ic"><component :is="iconFor('share-2')" :size="18" /></span>公共电核算</h2>
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Segmented :options="ZONE_OPTS" v-model="zone" size="sm" />
      </div>
      <div class="pl-actions">
        <!-- §6 屏级告警入口:位置固定,有没有告警都渲染(quiet 态) —— 工具条不因告警增减挪一像素 -->
        <FPAlertChip :count="alertCount" @open="alertOpen = true" />
        <Button variant="outline" size="sm" :disabled="bands.length === 0" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出当月
        </Button>
        <!-- 加载失败时禁生成:generate 是按月先删后插,读不到本月现状就按下去等于蒙着眼覆盖快照 -->
        <Button v-if="editMode && canGen" variant="outline" size="sm" :disabled="generating || !!loadErr"
                :title="loadErr ? '本月数据没加载出来 —— 先重试,否则生成会覆盖看不见的快照' : undefined"
                @click="onGenerate">
          <template #leading><component :is="iconFor(generated ? 'refresh-cw' : 'play')" :size="14" /></template>
          {{ generated ? '重新生成' : '生成本月' }}
        </Button>
        <Button v-if="editMode" variant="outline" size="sm" @click="openPoolDlg()">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增池
        </Button>
        <Button v-if="canEnter" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="toggleEdit()">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 加载失败条(与下面「本月未生成」的灰条分属两态:那条是「读到了,本月没快照」,
         这条是「压根没读到」)。失败时 pools 已清空 —— 屏上不留上个月的行,
         行内月度参数(系数/加度)随行一起消失,生成按钮也已禁用,写不进当前月份 -->
    <div v-if="loadErr" class="pl-bar err">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <span>{{ year }}年{{ month }}月池数据加载失败:{{ loadErr }}
        —— 屏上已清空(不显示上个月的数字),重试成功前不能生成或改月度参数。</span>
      <Button variant="outline" size="sm" @click="loadMonth()">重试</Button>
    </div>
    <!-- 提示条:本月未生成 / 配置已变请重新生成(加载失败时不出「未生成」——没读到就不知道生没生) -->
    <div v-if="!generated && !loadErr" class="pl-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月未生成 —— 池配置照常展示,数值列为'–'。
        <template v-if="editMode && canGen">点「生成本月」按当月读数与价目落快照。</template>
        <template v-else-if="canGen">进入右上角「编辑模式」可生成。</template>
      </span>
    </div>
    <!-- WRITE-KEEP-CONTEXT-SPEC 铁律三:这条是**写出来的**提示条 —— 改一格系数它就冒出来,
         下面 flex:1 的表格容器当场矮一截、内容整体上移、底部行被切掉,用户刚改的那行可能滑出视口。
         故编辑态常驻占位:始终渲染、始终占高,只切 visibility,写前写后表格高度分毫不变。
         浏览态没有写入口,不占位(白占一条空条难看);已经脏了则照常显示。 -->
    <!-- LAYOUT-STABILITY-SPEC §4:原来这里有条「本页有 N 项需要更高权限」的流内提示条,
         点一次「编辑模式」再取消整页就被它撑得下移 —— 2026-08-22 用户要求删掉。
         信息由下面的授权弹窗给到了,不需要第二遍;且现在进得了编辑模式就一定权限齐,本就无话可说 -->
    <FPElevateDialog :perms="asking" what="修改公摊池配置" @close="cancelAsk" @elevated="onElevated" />

    <div v-if="editMode || cfgDirty" class="pl-bar warn" :class="{ ghost: !cfgDirty }">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <span>配置已变,请重新生成 —— 屏上数字仍是旧快照,点「重新生成」后生效。</span>
    </div>
    <!-- §6:stale / 生成告警 / 受益人变动三条流内提示条已撤 —— 收进工具条 chip + 右侧抽屉(见页尾 FPAlertPanel) -->
    <div class="pl-tablearea">
    <!-- 台账式宽表:分带(Excel 式分隔带)+tfoot 合计(ref 行不计) -->
    <div class="pl-wrap">
      <table class="pl-table">
        <thead>
          <tr>
            <th rowspan="2" class="pl-grp-th pl-fix-th pl-fix" :style="fixArea"
                title="原册 B 列:楼栋/车间(不带期数)。招商中心那几行原册写的就是「招商中心」,不是「A座」">区域</th>
            <th rowspan="2" class="pl-grp-th pl-fix-th pl-fix" :style="fixFloor"
                title="原册 C 列那一格(楼层+方位写在一起,如「四楼西侧」);
橙色「(未录)」=挂了楼栋却没录楼层,点开池名在抽屉里补;按层份池楼层空=整栋、园区级池不挂楼栋,均留空">楼层</th>
            <th rowspan="2" class="pl-grp-th pl-fix-th pl-fix" :style="fixName"
                title="原册 A 列自然键(如「A4西侧走廊灯」);无自然键的显费项名。悬停行内池名可看系统全名">池名称</th>
            <th rowspan="2" class="pl-grp-th" :style="w(230)"
                title="一表一行(原册结构):区域·位置·用途·表号;「−」=以 sign=-1 从本池冲减">电表</th>
            <th rowspan="2" class="pl-grp-th" :style="w(62)" title="当月读数的倍率快照,非档案现值">倍率</th>
            <th rowspan="2" class="pl-grp-th" :style="w(96)">上月行至</th>
            <th rowspan="2" class="pl-grp-th" :style="w(96)">本月行至</th>
            <th :colspan="segDefs.length" class="pl-grp-th">用量(kWh)</th>
            <th rowspan="2" class="pl-grp-th" :style="w(104)"
                title="逐表金额(p1/宿舍逐表ROUND口径);二期为池级一次ROUND,逐表金额不存在→按池合并显池级合计">应分摊(元)</th>
            <th rowspan="2" class="pl-grp-th" :style="w(112)">分摊语义</th>
            <th rowspan="2" class="pl-grp-th" :style="w(110)">分摊标准</th>
            <th v-if="editMode" rowspan="2" class="pl-grp-th" :style="w(156)" title="分摊基数（层数或面积）站在本月的生效值 + 生效方式；走面积基数的池显「面积基数」并注明取自哪一条。只读 —— 点格子去计费参数页改">分摊基数（当月）</th>
            <th v-if="editMode" rowspan="2" class="pl-grp-th" :style="w(156)" title="公摊池加减度数（+170 / −670 …，进分摊标准分子不进应分摊）站在本月的生效值 + 生效方式。只读 —— 点格子去计费参数页改">加减度数（当月）</th>
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
            <!-- 原册块分带(一期=原册 7 个合计行块名逐字;二期/宿舍无块回落楼栋名;带头跨左两列 sticky) -->
            <tr class="pl-band">
              <td class="pl-fix" :style="fixBand" colspan="3">
                <span class="pl-band-lbl">{{ b.label }}</span>
              </td>
              <td :colspan="colCount - 3"></td>
            </tr>
            <!-- V73 逐表行:一个池占 max(1,lines) 行。§E1:楼层/池名称两列**每行都渲染**
                 (原册这两列是逐行写满的,合并只用在语义/标准/实收/盈亏/备注上);
                 续行淡显 + 池**首行**虚线上边框(§F10:虚线是池与池之间的分隔,池内续行不画线)。 -->
            <template v-for="r in b.rows" :key="r.ruleId">
            <tr v-for="(ln, li) in (r.lines.length ? r.lines : [null])"
                :key="ln ? ln.meterId : 'p' + r.ruleId" :class="{ 'pl-ptop': li === 0 }">
              <!-- §I3:楼层=**本行电表**的楼层,回落池级(=原册 C 列一格,含方位如「四楼西侧」);
                   挂栋没录的显橙色「(未录)」 -->
              <!-- 原册 B 列:区域=本行电表的 area(招商中心行就写「招商中心」),回落池的楼栋名并剥期数前缀 -->
              <td class="pl-fix" :style="fixArea">
                <span class="pl-txt">{{ rowArea(r, ln) }}</span>
              </td>
              <td class="pl-fix" :style="fixFloor">
                <span class="pl-txt" :title="rowFloor(r, ln) === POOL_LOC_UNSET ? POOL_LOC_HINT.todo ?? undefined : undefined"
                      :class="{ 'pl-loc-todo': rowFloor(r, ln) === POOL_LOC_UNSET }">{{ rowFloor(r, ln) }}</span>
              </td>
              <!-- §I3:池名称=**本行电表**的用途(原册 D 列);池级自然键(A 列)退到首行副标题 -->
              <td class="pl-fix" :style="fixName">
                <span class="pl-pname" :class="{ click: editMode }"
                      :title="r.warn ?? r.autoName ?? r.name"
                      @click="editMode && openPoolDlg(r)">
                  <span class="nm">{{ rowName(r, ln) }}</span>
                  <span v-if="r.warn" class="pl-warn" :title="r.warn">!</span>
                  <span v-if="r.links.length" class="pl-linkchip"
                        :title="r.links.map(l => `折入${l.type === 'fold_price' ? '标准' : '度数'} ← ${l.name}`).join('\n')">
                    +{{ r.links.length }}链
                  </span>
                </span>
                <!-- 副标题只在首行:原册 A 列自然键(回溯锚点,与本行用途同字时不重复)+ Σ 池合计
                     (Σ 逐行复制会被误读成每行都有这么多) -->
                <span v-if="li === 0 && poolSubtitle(r, rowName(r, ln))" class="pl-sub-sum">
                  {{ poolSubtitle(r, rowName(r, ln)) }}</span>
              </td>
              <!-- 逐表列;§I2:净额池不出逐表行(那些表在原册分摊明细上没有行),构成明细进本格 hover -->
              <td class="pl-mname">
                <span v-if="ln" :title="[ln.meterType, ln.code && ('编码 ' + ln.code)].filter(Boolean).join(' · ') || undefined">
                  {{ lineLabel(ln) }}
                </span>
                <span v-else-if="netSummary(r)" class="pl-txt dim" :title="netSummary(r)!.title">
                  {{ netSummary(r)!.text }}
                </span>
                <span v-else class="pl-txt dim">无绑定表</span>
              </td>
              <td><span class="pl-nv" :class="{ empty: !ln?.factorSnap }">{{ fmt(ln?.factorSnap ?? null) }}</span></td>
              <td><span class="pl-nv" :class="{ empty: ln?.prevTotal == null }">{{ fmt(ln?.prevTotal ?? null) }}</span></td>
              <td><span class="pl-nv" :class="{ empty: ln?.currTotal == null }">{{ fmt(ln?.currTotal ?? null) }}</span></td>
              <td v-for="s in segDefs" :key="s.k">
                <span class="pl-nv" :class="{ empty: (ln ? ln[s.k] : r[s.k]) == null }">{{ fmt(ln ? ln[s.k] : r[s.k]) }}</span>
              </td>
              <!-- 应分摊:逐表金额齐全→逐表显;否则(二期池级ROUND/净额池/手输量池)按池合并 -->
              <td v-if="costPerLine(r)">
                <span class="pl-sumc" :class="{ empty: ln?.costAmount == null }">{{ fmt2(ln?.costAmount ?? null) }}</span>
              </td>
              <td v-else-if="li === 0" :rowspan="poolSpan(r)">
                <span class="pl-sumc" :class="{ empty: r.costAmount == null }">{{ fmt2(r.costAmount) }}</span>
              </td>
              <td v-if="li === 0" :rowspan="poolSpan(r)"><span class="pl-txt">{{ poolSemantics(r) }}</span></td>
              <td v-if="li === 0" :rowspan="poolSpan(r)">
                <span class="pl-nv" :class="{ empty: r.stdValue == null, fold: stdCell(r).title }"
                      :title="stdCell(r).title ?? undefined">{{ stdCell(r).text
                  }}<sup v-if="frozenNote.has(r.ruleId)" class="pl-frz">❄</sup></span>
              </td>
              <!-- S21:分摊基数/加减度数只读镜像(当月生效值 + 徽标),点格子带 ym+池高亮跳计费参数页 -->
              <template v-if="editMode && li === 0">
                <td v-for="k in (['coefficient', 'extra_qty'] as const)" :key="k" :rowspan="poolSpan(r)">
                  <span class="pl-nv pl-pv" :class="{ empty: paramCell(r.ruleId, k).tone === 'inherit' }"
                        :title="paramCell(r.ruleId, k).title" role="button" tabindex="0"
                        @click="gotoParams(r.ruleId, k)" @keydown.enter.prevent="gotoParams(r.ruleId, k)">
                    <span class="v">{{ paramCell(r.ruleId, k).text }}</span>
                    <span v-if="paramCell(r.ruleId, k).badge" class="pl-badge" :class="paramCell(r.ruleId, k).tone">{{ paramCell(r.ruleId, k).badge }}</span>
                  </span>
                </td>
              </template>
              <!-- 实收/盈亏:账册 AE/AF 口径(从账单侧拉回),bill_notice 未落地故恒'–' -->
              <td v-if="li === 0" :rowspan="poolSpan(r)">
                <span class="pl-nv empty" title="待账单模块落地后从账单侧回填">–</span>
              </td>
              <td v-if="li === 0" :rowspan="poolSpan(r)">
                <span class="pl-nv empty" title="待账单模块落地后从账单侧回填">–</span>
              </td>
              <td v-if="li === 0" :rowspan="poolSpan(r)">
                <span class="pl-txt dim" :title="poolNote(r)">{{ poolNote(r) }}</span>
              </td>
            </tr>
            </template>
            <!-- 带尾合计(原册每块一行合计行,标签就是块名);列位与 tfoot 全期合计对齐 -->
            <tr class="pl-bfoot">
              <td class="pl-fix" :style="fixArea"><span class="pl-foot-lbl">小　计</span></td>
              <td class="pl-fix" :style="fixFloor"></td>
              <td class="pl-fix" :style="fixName"><span class="pl-txt dim">{{ b.label }}</span></td>
              <td colspan="4"></td>
              <td><span class="pl-foot-v">{{ fmt(bandFooter(b.rows).qty) }}</span></td>
              <td v-if="segDefs.length > 1" :colspan="segDefs.length - 1"></td>
              <td><span class="pl-foot-v">{{ fmt2(bandFooter(b.rows).cost) }}</span></td>
              <!-- 尾部空档 = colCount − 本行已占。已占 = 区域·楼层·池名称 3 + 电表·倍率·上月·本月 4
                   + 用量段 segDefs.length + 应分摊 1 = segDefs.length + 8(原来减 7,漏数了应分摊
                   那一列,表格右侧多挂出一条空列)。展开即 5 + 编辑态月参 2 列 -->
              <td :colspan="colCount - segDefs.length - 8"></td>
            </tr>
          </template>
          <!-- 空表两因必须分开说:加载失败(出口在上方红条)vs 该期别真没池 ——
               否则一次 500 会被读成「这个期别的池被谁删光了」 -->
          <tr v-if="bands.length === 0">
            <td class="pl-noro" :colspan="colCount">
              <template v-if="loadErr">数据未加载 —— 请点上方「重试」</template>
              <template v-else>{{ POOL_ZONE_LABEL[zone] }}暂无池配置{{ editMode ? ',点右上「新增池」开始录入' : '' }}</template>
            </td>
          </tr>
        </tbody>
        <!-- tfoot 合计:Σ度数(总列)/Σ应分摊,ref 纯标准行不计(锚 L126/W126) -->
        <tfoot>
          <tr>
            <th class="pl-fix" :style="fixArea"><span class="pl-foot-lbl">合　计</span></th>
            <th class="pl-fix" :style="fixFloor"></th>
            <th class="pl-fix" :style="fixName"></th>
            <th colspan="4"></th>
            <th><span class="pl-foot-v">{{ fmt(foot.qty) }}</span></th>
            <th v-if="segDefs.length > 1" :colspan="segDefs.length - 1"></th>
            <th><span class="pl-foot-v">{{ fmt2(foot.cost) }}</span></th>
            <!-- 列数算式同带尾小计:已占 3 + 4 + segDefs.length + 1 = segDefs.length + 8 -->
            <th :colspan="colCount - segDefs.length - 8">
              <span class="pl-foot-note">纯标准行(ref)不入合计;冲减载体(carrier)只计度数不计金额</span>
            </th>
          </tr>
        </tfoot>
      </table>
      </div>
      <!-- 保存/删除成功提示(3s 自消)。贴表格区**底**边(card 模式,靠 .pl-tablearea 的 relative 定位) -->
      <FPToast v-model="okMsg" :duration="3000" />
    </div><!-- /pl-tablearea:成功 toast 的定位上下文 -->

    <!-- 池配置抽屉(编辑态;迁自旧屏规则弹窗+S3-B1 增量字段) -->
    <FPDrawer :open="poolDlg" :title="form.id == null ? '新增池' : '编辑池 · ' + formAutoName"
              subtitle="池=楼栋+楼层+侧向+费项四级定位(池名自动生成);组成电表与受益人一律勾选;改完保存即重算"
              icon="share-2" :width="820" @close="poolDlg = false">
      <div class="pl-form">
        <!-- ① 定位四选 → 池名自动生成(只读) -->
        <div class="pl-sec">
          <div class="pl-sectitle">
            ① 池在哪(定位)· 层级留空即上一级:楼层空=整栋,楼栋空=园区级
            <span v-if="locTodo" class="pl-chip warn">这个池缺楼层方位 —— 请补下面三格</span>
          </div>
          <div class="pl-formrow" :class="{ 'pl-loc-hi': locTodo }">
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
                <span class="meta">{{ m.meterType ?? '' }}</span>
              </label>
              <div v-if="otherList.length === 0" class="pl-bindempty">无匹配</div>
            </div>
          </div>
        </div>

        <!-- ③ 分摊方式 + 基数 -->
        <div class="pl-sec">
          <div class="pl-sectitle">③ 怎么摊</div>
          <div class="pl-radios">
            <span v-if="isManualPool" class="pl-manual">人工指定(无电表)——分摊方式不在此改</span>
            <label v-for="o in methodRadios" :key="o.value" class="pl-radio" :title="o.hint">
              <input type="radio" :value="o.value" :checked="form.method === o.value"
                     @change="setMethod(o.value)" />
              <span>{{ o.label }}</span>
            </label>
          </div>
          <!-- S21 §2.4:抽屉管「怎么算」(结构),参数页管「算式里的数随时间怎么变」——
               既有池的分摊基数/加减度数只有 rule:{id} 一条版本链,这里只读一行;仅新建池要个初始分摊基数才能算 -->
          <div class="pl-formrow">
            <Input v-if="form.id == null" v-model="form.coefficient" label="初始分摊基数（层数或受益面积 ㎡）"
                   placeholder="按面积 / 按层且不走面积基数时必填；建成后在计费参数页按版本改" size="sm" />
            <Select v-model="form.baseKey" label="面积基数来源" :options="BASE_KEY_OPTS" size="sm" />
          </div>
          <div v-if="form.id != null" class="pl-roparam">
            <span>{{ roParamLine(form.id) }}</span>
            <button type="button" class="pl-more" @click="gotoParams(form.id!)">
              <component :is="iconFor('arrow-right')" :size="13" />去计费参数页改
            </button>
          </div>
          <div class="pl-formrow">
            <Select v-model="form.feeKey" label="出口费项(入账用)" :options="FEE_OPTS" size="sm" />
            <Select v-model="form.stdKind" label="分摊标准算式(按册复刻)" :options="STD_OPTS" size="sm" />
            <Select :model-value="String(form.roundScale)" label="分摊标准四舍五入位数" :options="ROUND_OPTS" size="sm"
                    @update:model-value="form.roundScale = +$event" />
          </div>
          <Input v-model="form.note" label="备注" placeholder="如:电梯用电加170度" size="sm" />
        </div>

        <!-- ④ 分摊给谁(受益人勾选;退租户灰显) -->
        <div class="pl-sec">
          <div class="pl-sectitle">
            ④ 分摊给谁 · {{ memberSummary }}
            <span class="dim">{{ memberHint }}</span>
          </div>
          <div v-if="formDiff" class="pl-innerwarn">
            <component :is="iconFor('alert-triangle')" :size="13" />
            <span>该定位本月租户有变动:
              <template v-if="formDiff.added.length">新在租 {{ formDiff.added.map(t => t.tenantName).join('、') }};</template>
              <template v-if="formDiff.removed.length">已退租 {{ formDiff.removed.map(t => t.tenantName).join('、') }}</template>
            </span>
          </div>
          <!-- LAYOUT-STABILITY §4.2:勾选缺日期租户才冒出来,位置必须常驻,否则把下面的名单顶走 -->
          <div class="pl-innerwarn pl-nodatewarn" :class="{ blank: !formNoDate.length }">
            <template v-if="formNoDate.length">
              <component :is="iconFor('alert-triangle')" :size="13" />
              <span>{{ formNoDate.map(m => m.tenantName).join('、') }} 合同缺日期,判不了在租 —— 补齐合同起止日期后才能判定</span>
            </template>
          </div>
          <!-- §E6 户对户:候选名单为空(后端 tenantNote 已说明),受益户从全库租户里挑 -->
          <div v-if="form.method === 'direct'" class="pl-directpick">
            <span class="lbl">受益户</span>
            <div style="flex:1;min-width:0">
              <FPTenantPicker :tenants="tenantOpts" :model-value="directTenantId"
                              placeholder="搜索并选中唯一受益户(全库)" @update:model-value="pickDirect" />
            </div>
          </div>
          <!-- §D.5 列头:份额两种模式(空=按楼层自动分/填值=显式覆盖);楼层来自后端读时解析 -->
          <div v-if="form.method === 'floor'" class="pl-bindhdr">
            <span class="nm">受益人 · 楼层(自动解析)</span>
            <span class="wt" title="留空=按楼层自动分:该户所在的每一层各摊 1 份(层内多户按面积拆),未定层户合摊 1 份;
填数=显式份额覆盖该户(1=整份,0.5=半份)——账册已核对的池请勿改动">份额</span>
          </div>
          <div class="pl-bindlist tall">
            <label v-for="t in tenantRows" :key="t.tenantId" class="pl-bindrow" :class="{ gone: t.inForce === 'no' }">
              <!-- direct 池单选(整笔归一户);其余多选 -->
              <input :type="form.method === 'direct' ? 'radio' : 'checkbox'" name="pl-member"
                     :checked="memberOf(t.tenantId) != null" @change="toggleMember(t)" />
              <span class="nm">{{ t.name }}</span>
              <span v-if="t.unitNo" class="pl-chip">{{ t.unitNo }}</span>
              <span v-if="floorByTenant.get(t.tenantId)" class="pl-chip floor"
                    title="该户在本池楼栋解析出的楼层(合同单元→户内电表两级回退),按层摊时每层各占 1 份">
                {{ floorByTenant.get(t.tenantId) }}
              </span>
              <span v-else-if="floorByTenant.has(t.tenantId)" class="pl-chip nofloor"
                    title="定不出楼层:该户在本栋既无合同单元、也无户内电表楼层 —— 与其他未定层户合摊 1 份,请补合同单元或该户户内表楼层">
                未定层
              </span>
              <span v-if="t.inForce === 'no'" class="pl-chip gone">已退租</span>
              <span v-else-if="t.inForce === 'unknown'" class="pl-chip nodate"
                    title="补齐合同起止日期后才能判定在租">合同缺起止日期</span>
              <span v-else-if="t.other" class="pl-chip">非本定位</span>
              <span class="meta"></span>
              <input v-if="form.method === 'floor'" class="pl-wi" type="number" step="any"
                     :disabled="memberOf(t.tenantId) == null" :value="memberOf(t.tenantId)?.weight ?? ''"
                     placeholder="自动"
                     title="留空=按楼层自动分(所在层各 1 份,层内按面积拆);填数=显式份额覆盖(1/0.5)"
                     @click.stop
                     @change="commitWeight(t.tenantId, ($event.target as HTMLInputElement).value)" />
            </label>
            <div v-if="tenantRows.length === 0" class="pl-bindempty">
              {{ form.method === 'direct' ? '尚未指定受益户 —— 户对户池不推候选名单,请用上方选择器挑那一户'
                : '该定位本月无在租租户' }}
            </div>
          </div>
          <label class="pl-chkline" title="勾上=写自本月起的受益人版本组(此前月份与默认长期名单不动,本月及以后沿用这份直到下一版本)">
            <input type="checkbox" v-model="form.monthOnly" />
            自本月（{{ ym }}）起（版本组）改受益人名单,不动此前月份与默认长期名单
          </label>
        </div>

        <!-- 池间折入链(fold_price=标准叠加/fold_qty=净度数计入) -->
        <div class="pl-sec">
          <div class="pl-bindhead">
            <span class="pl-sectitle" style="flex:1">⑤ 折入链(links,本池 ← 源池)· {{ form.links.length }} 条</span>
            <Button variant="outline" size="sm" @click="addLink">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
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
      </div>
      <template #footer>
        <Button v-if="form.id != null" variant="outline" size="sm" @click="delPool">
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          删除池
        </Button>
        <!-- §E2:报错必须跟着「保存」按钮走 —— 原来挂在滚动表体末尾,用户在顶上改完费项点保存,
             400 的红字落在视口外,看起来就是「保存无反应」 -->
        <!-- §F11:两条各自成行 —— 原来是三元式,池参数加载失败时把后端 400 的原因整条盖掉 -->
        <div class="pl-dlg-err">
          <div v-if="rulesFailed">池参数(出口费项)未加载成功 —— 此时保存会把它冲成默认值,请先重试</div>
          <div v-if="poolErr">{{ poolErr }}</div>
        </div>
        <Button v-if="rulesFailed" variant="outline" size="sm" @click="loadRules().catch(() => {})">重试</Button>
        <Button variant="gray" size="sm" @click="poolDlg = false">取消</Button>
        <Button variant="filled" size="sm" :disabled="saving || rulesFailed" @click="submitPool">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          {{ saving ? '保存中…' : '保存并重新生成' }}
        </Button>
      </template>
    </FPDrawer>

    <!-- §6 屏级告警抽屉:快照过期 / 本次生成告警 / 池成员变动 -->
    <FPAlertPanel :open="alertOpen" :groups="alertGroups" @close="alertOpen = false" />
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
.pl-bar.err { border-style: solid; border-color: var(--hue-red); background: rgb(255, 238, 237); color: var(--hue-red); }
/* 铁律三占位态:仍占高、仍参与 flex 计算,只是看不见 —— 提示条出现时表格一格都不动 */
.pl-bar.ghost { visibility: hidden; }
/* V73 逐表行:表行左对齐可换行;§F10 虚线画在池**首行**上边框=池间分隔,池内续行不画(否则分组信号正好相反) */
.pl-mname { text-align: left; font-size: 12px; color: var(--text-primary); white-space: normal; line-height: 1.35; }
.pl-ptop > td { border-top: 1px dashed var(--border-subtle); }
/* 分带头下面第一个池不再叠线(band 自带 2px 实线上下边框,再来一道虚线是三条线) */
.pl-band + tr.pl-ptop > td { border-top: none; }
/* Σ 副标题:§E1 去 rowspan 后这格只剩单行高,数字大了会折行把首行撑高 → 一行到底 + 省略号 */
.pl-sub-sum { display: block; margin-top: 2px; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-linkchip { margin-left: 4px; font-size: 11px; border-radius: var(--radius-full); padding: 0 6px; background: var(--surface-subtle); color: var(--text-secondary); cursor: help; }
/* 表格区:成功 toast 的定位上下文(告警条已改 chip+抽屉,不再有浮层条) */
.pl-tablearea { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 14px; }

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
/* §H3 冻结参数标记:title 悬停才看得见,格上留个 ❄ 让「这不是当月价」不用悬停也能扫到 */
.pl-frz { color: var(--hue-blue); font-size: 9px; margin-left: 2px; vertical-align: super; }
.pl-sumc { display: block; text-align: right; font-weight: var(--fw-semibold); color: var(--hue-blue); font-size: 12px; padding: 0 8px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-sumc.empty { color: var(--text-disabled); font-weight: var(--fw-regular); }
.pl-txt { display: block; text-align: left; font-size: 12px; padding: 0 10px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-txt.dim { color: var(--text-muted); }
/* §H4 挂栋却没录楼层的池:「(未录)」橙标(园区级池留空,不催补) */
.pl-loc-todo { color: rgb(180, 83, 9); font-weight: var(--fw-medium); cursor: help; }
/* §I3 起「续行淡显(.pl-dup)」随之作废:楼层/池名称两列已改为逐行取本行电表的真值
   (原册 B/C/D 逐行写),第 2 行起不再是首行的复制品,淡显反而会误导成「这行没数据」。 */

/* 表构成 popover(hover 出列名单:sign±与折入链) */
.pl-mcell { position: relative; }
.pl-mcnt { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); cursor: help; }
.pl-pop { display: none; position: absolute; top: calc(100% - 4px); left: 50%; transform: translateX(-50%); z-index: 20; min-width: 180px; max-width: 300px; padding: 8px 10px; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(28, 28, 28, .16); text-align: left; }
.pl-mcell:hover .pl-pop { display: block; }
.pl-pop-row { font-size: 12px; color: var(--text-secondary); padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-pop-row .sgn { display: inline-block; width: 14px; color: rgb(21, 128, 61); font-family: var(--font-mono); }
.pl-pop-row .sgn.neg { color: var(--hue-red); }
.pl-pop-row.link { color: var(--hue-blue); }

/* 原册块分隔带(mlg-bsum 对标:加高+深底+上下 2px 粗边) */
.pl-table tbody tr.pl-band td { height: 40px; background: var(--surface-sunken); border-top: 2px solid var(--border-strong); border-bottom: 2px solid var(--border-strong); }
.pl-band-lbl { display: block; padding: 0 10px; text-align: left; font-size: 13px; font-weight: var(--fw-semibold); letter-spacing: .02em; color: var(--text-primary); white-space: nowrap; }
/* 带尾块合计(原册每块一行合计行):比分带头轻一档,只画上边框,不与 tfoot 抢视觉 */
.pl-table tbody tr.pl-bfoot td { height: 34px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); font-family: var(--font-mono); }


/* S21 池参数只读镜像格:值 + 生效方式徽标,可点(跳计费参数页) */
/* 定宽 116 + 两侧 8 内边距 = 列宽 132(表是 max-content 布局,不定宽会被长句撑开整列;数最长「1,734.73」+ 徽标「仅本月」刚好放下) */
/* 值 + 徽标撑满格(列宽 156 按「12,487.04 + 面积基数」最长组合给足,不截字) */
.pl-pv { cursor: pointer; display: flex; align-items: center; justify-content: flex-end; gap: 4px; width: auto; }
.pl-pv:hover { color: var(--hue-blue); }
.pl-pv .v { flex: 0 0 auto; }
.pl-badge { flex: 0 0 auto; font-family: var(--font-sans); font-size: 10px; line-height: 14px; border-radius: var(--radius-full); padding: 0 5px; background: var(--bg-sunken); color: var(--text-muted); }
.pl-badge.month { background: rgb(255, 247, 235); color: rgb(180, 83, 9); }
.pl-badge.from { background: rgb(232, 240, 254); color: var(--hue-blue); }
/* 抽屉③只读一行:当月分母/加度 + 去参数页改 */
.pl-roparam { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-sunken); font-size: 12px; color: var(--text-secondary); }

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
/* 抽屉页脚里的报错位:flex:1 顶开左右两组按钮(删除池靠左、取消/保存靠右) */
.pl-dlg-err { flex: 1 1 auto; min-width: 0; font-size: 11.5px; line-height: 1.35; color: var(--hue-red); }
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
.pl-manual { font-size: 12.5px; color: var(--text-muted); padding: 5px 0; }
.pl-chip { flex: 0 0 auto; font-size: 11px; border-radius: var(--radius-full); padding: 0 7px; background: var(--surface-sunken); color: var(--text-muted); }
.pl-chip.infra { background: rgb(255, 250, 235); color: rgb(138, 97, 0); }
.pl-chip.warn { background: rgb(255, 247, 235); color: rgb(180, 83, 9); }
/* §G4 待补定位的池:抽屉里把楼栋/楼层/侧向三格圈出来(期区不算定位格) */
.pl-loc-hi > :nth-child(n+2) { outline: 1px solid rgb(245, 158, 11); outline-offset: 2px; border-radius: var(--radius-sm); }
.pl-chip.gone { background: rgb(255, 238, 237); color: var(--hue-red); }
.pl-chip.nodate { background: rgb(255, 247, 235); color: rgb(180, 83, 9); cursor: help; }
/* 受益人楼层:蓝=解析到层;未定层=红底醒目(它们会被合摊成 1 份,是漏摊的源头) */
.pl-chip.floor { background: var(--accent-blue); color: var(--hue-blue); cursor: help; }
.pl-chip.nofloor { background: rgb(255, 238, 237); color: var(--hue-red); font-weight: var(--fw-medium); cursor: help; }
/* 受益人列头 + 行内份额输入(与月度参数 pl-ni 同款透明格) */
.pl-bindhdr { display: flex; align-items: center; gap: 8px; padding: 0 4px 4px; border-bottom: 1px dashed var(--border-subtle); font-size: var(--fs-micro); color: var(--text-muted); }
.pl-bindhdr .nm { flex: 1; }
.pl-bindhdr .wt { flex: 0 0 64px; text-align: right; cursor: help; text-decoration: underline dotted; }
.pl-wi { flex: 0 0 64px; box-sizing: border-box; border: 1px solid var(--border-subtle); background: var(--surface-white); text-align: right; font-size: 12px; padding: 2px 6px; outline: none; color: var(--text-primary); font-family: var(--font-mono); border-radius: var(--radius-sm); }
.pl-wi:focus { border-color: var(--hue-blue); }
.pl-wi:disabled { border-color: transparent; background: transparent; }
.pl-wi::-webkit-outer-spin-button, .pl-wi::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pl-wi::placeholder { color: var(--text-disabled); }
.pl-innerwarn { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: var(--radius-sm); background: rgb(255, 250, 235); color: rgb(138, 97, 0); font-size: 11.5px; }
/* 常驻一行:18px 文字行 + 上下 7px padding = 32px(border-box);无内容时只留位置不显黄底 */
.pl-nodatewarn { min-height: 32px; line-height: 18px; font-size: var(--fs-micro); }
.pl-nodatewarn.blank { background: transparent; }
.pl-more { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; border: none; background: transparent; color: var(--hue-blue); font-size: 12px; cursor: pointer; padding: 0; }
.pl-otherbox { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--border-subtle); padding-top: 8px; }
.pl-directpick { display: flex; align-items: center; gap: 8px; }
.pl-directpick .lbl { flex: 0 0 auto; font-size: 12px; color: var(--text-secondary); }
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
