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
import { ref, computed, nextTick, onMounted, onDeactivated, watch } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import { useRoute, useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useChainDeepPeriod } from '@/composables/useDeepPeriod'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import FPTableTools from '@/components/fp/FPTableTools.vue'
import { ask } from '@/utils/ask'
import { receipt } from '@/utils/receipt'
import { touMode, touColsOn, saveTouPref } from '@/utils/touColumns'
import { minTableH, textW, useWideTable, type HeightDims, type WideCol } from '@/composables/useWideTable'
import {
  allocApi,
  type AllocCandidatesDTO, type AllocFeeKey, type AllocInForce, type AllocLinkType, type AllocMemberDiffDTO,
  type AllocMeterDiffDTO, type AllocMethod, type AllocMethodEditable, type AllocPoolLineDTO, type AllocPoolMeterDTO,
  type AllocPoolRowDTO, type AllocPoolsDTO, type AllocRuleDTO, type AllocStdKind, type AllocZone,
} from '@/api/alloc'
import { paramsApi, type ParamRowDTO, type ParamStatusDTO } from '@/api/params'
import { metersApi, type MeterDTO } from '@/api/meters'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { ALLOC_FEE_KEYS, ALLOC_FEE_LABEL } from '@/utils/allocLogic'
import { baseRefLabel, rangeBadge, staleText, staleWho } from '@/utils/paramCenterLogic'
import { PARAM_DEFS } from '@/utils/paramRegistry'
import { useTabsStore } from '@/stores/tabs'
import { useZonesStore } from '@/stores/zones'
import {
  FROZEN_CFG_KEY, POOL_LOC_HINT, POOL_LOC_UNSET, bandFooter, buildPoolExportAoa,
  costPerLine, fmtFixed2, groupPoolsByBookBlock, hasTouQty, lineArea, lineFloor, lineLabel, lineShortLabel, lineUseName,
  meterDiffGroup, netSummary, poolArea, poolAutoName, poolFeeLabel, poolFloor, poolFooter, poolLocKind, poolMethodLabel,
  poolNote, stdDisplay,
} from '@/utils/poolLedgerLogic'
import { zoneLabel } from '@/utils/zoneLabel'
import { floorLabels } from '@/utils/floorLabels'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { chainStepsOf } from '@/nav/billingChain'
import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import FPToast from '@/components/fp/FPToast.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'

const auth = useAuthStore()
// RBAC:本屏两扇门不同权 —— 生成快照是「跑一次出账」,池配置是「改计费口径」。
// 2026-08-22 起铁律改为「进得了编辑模式 ⇒ 本页权限一定齐」(EDIT-MODE-SPEC v3):编辑态里不再有
// 点不动的控件,也不再有「点了转成授权请求」的包装。这个只用来画**浏览态**的文案与可点态
// (param-policy:edit 仍由下面 useEditMode 的权限组把门,只是屏上不再单独取用)。
const canGen = computed(() => auth.can('billing-run:edit'))

// ── 编辑模式(EDIT-MODE-SPEC v3):切页签保留编辑态,只关浮层 ──
// 两把键一起交:按钮自己写成「交审(2 项)」;两把态不同时各动各的那几把
// (组件里 inState 分开算),不折成一个态再统一发 —— 折了会把已交审的那把再交一次吃 409。
/** 弹卡标题的人话名。前端没有 kind→人话名映射表,各屏自己拼(新开一份 = 后端 ReviewKind 的第二份)。 */
const reviewLabel = computed(() => `公共电核算 · ${ym.value}`)
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken, reviewNote, reviewTip, reviewKeys } =
  useEditMode(['billing-run:edit', 'param-policy:edit'], {
    scope: () => S.poolLedger(year.value, month.value),
    // 审核键(§7.1):本屏压**两把** —— 池结果与损耗结果是 AllocService.generate(ym)
    // 同一次算出来的,只认一把等于放行另一半。任一把锁着就锁(store.blockOf 的语义)。
    reviewKey: () => (ym.value ? [`alloc:${ym.value}`, `alloc-loss:${ym.value}`] : null),
    // 改动数(EDIT-MODE §6.1):表格逐行即时写库,cfgDirty 是「待重算」不是草稿;唯一的草稿是开着的池配置抽屉,
    // 开着按 1 处算 —— 关页签 / 退出登录 / 关浏览器前问一句,关着不拦
    dirty: () => (poolDlg.value ? 1 : 0),
  })
// alertOpen 必须一起收:告警面板是 FPSideDrawer(Teleport to body),子树随 KeepAlive
// 停用消失时它留在 body 上飘着,盖在下一个屏上(同 MeterView 的 openId)。
// flashId 一起清:KeepAlive 停用时动画只发 cancel 不发 end,类留着的话回来那一行没被点也再闪一次
onDeactivated(() => { poolDlg.value = false; alertOpen.value = false; flashId.value = null })
// 编辑态就地转假(接管/提权到期)也要关池配置弹窗 —— 它的 v-if 不判编辑态,
// 留着的话浏览态下「保存」照样 PUT 池配置(同 MeterView:162)。
watch(editMode, v => { if (!v) poolDlg.value = false })

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

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
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM(或旧 ?ym=)直落该月,pick + loadChain;本屏逐行即时写库、无草稿(cfgDirty 是「需重算」不是草稿),不传 dirty。
// 必须在下面的 onMounted / watch / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于状态刷新改期。
useChainDeepPeriod()
const zone = ref<string>('p1')
const zones = useZonesStore()
onMounted(() => zones.ensure())
const ZONE_OPTS = computed(() => zones.list.map(z => ({ value: z.code, label: z.name })))

// ── 数据(竞态守卫:快速切年月只接受最新一次请求) ──
const pools = ref<AllocPoolsDTO | null>(null)
// S21:池参数只读镜像(分母/加度/2023 冻结价披露/取整位)= 计费参数页同一读口,只拉 rule: 四个键(全期别一份,随月不随 zone)
const paramRows = ref<ParamRowDTO[]>([])
const status = ref<ParamStatusDTO | null>(null)
const rules = ref<AllocRuleDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const meters = ref<MeterDTO[]>([])
const tenants = ref<TenantDTO[]>([])           // §E6:direct 池的全库租户选择器候选
const diffs = ref<AllocMemberDiffDTO[]>([])
const meterDiffs = ref<AllocMeterDiffDTO[]>([])
// P1-6:三条 Promise 里唯独主数据 pools 过去没兜底 —— /alloc/pools 一挂,pools 恒为 null,
// 整页就停在转圈骨架上(没有一个字、没有重试入口,只能刷浏览器);换月失败更险:上个月的行
// 留在屏上,而行内月度参数写的是**新**月份。故失败=清空本月三份数据 + 记 loadErr,
// 让「加载失败」与「本月无数据」在屏上分得开(前者红条+重试,后者仍走 generated=false 的灰条)。
// 兜底放 loadMonth 内部,五个调用点(onMounted/watch/onGenerate/submitPool/delPool)
// 就都不必各自 catch。
const loadErr = ref('')
/**
 * 换期重取时的退让（加载态设计稿 §06 第一档）。旧数据留在原地不闪，
 * 但必须退一步并**停止接受交互** —— 它还是上一期的。顶边那条线是唯一的「在忙」信号。
 */
const reloading = ref(false)
/** 熬过 200ms 才亮 —— 本地后端常几十毫秒回来，闪一下比不显示更晃眼 */
const veil = useDeferredFlag(reloading)

let seq = 0
async function loadMonth() {
  const my = ++seq
  reloading.value = true
  // 错误只在成功那一支清(房内定型写法):重试点下去,失败件留在原地、顶边那条线亮(veil)——
  // 不先清成整页转圈再跳回来;失败件现在换掉的是整块表格区,先清会把整页换成转圈
  try {
    const [ps, pr, df, md, st] = await Promise.all([
      allocApi.pools(ym.value),
      // 四个只读镜像键(分母/加度/2023 冻结价/取整位)本就只在 rule: 作用域出现,scope 前缀过滤是防御性的
      // 从没筛掉过东西,不加也一样(2026-08-29 撤:曾为 Finding 3 的 zoneCalcKind 加过 zone_calc_kind
      // 键并去掉这个过滤,该用法已随「换期不许变列数」改回列常量一起删,见 poolLedgerLogic.ts)。
      // round_scale(V131 D5):抽屉「高级」里既有池的取整位只读一行,值同样站在本月取
      paramsApi.list(ym.value, 'all', { key: 'coefficient,extra_qty,frozen_2023,round_scale' })
        .catch(() => [] as ParamRowDTO[]),
      allocApi.memberDiff(ym.value).catch(() => [] as AllocMemberDiffDTO[]),
      allocApi.meterDiff(ym.value).catch(() => [] as AllocMeterDiffDTO[]),
      paramsApi.status(ym.value).catch(() => null),
    ])
    if (my !== seq) return
    pools.value = ps; paramRows.value = pr; diffs.value = df; meterDiffs.value = md; status.value = st
    loadErr.value = ''
  } catch (e) {
    if (my !== seq) return           // 更晚的一次请求已在路上,别用旧的失败盖掉它的结果
    pools.value = null; paramRows.value = []; diffs.value = []; meterDiffs.value = []
    loadErr.value = errMsg(e, '服务异常')
  } finally {
    // ⚠ 只有最新那一趟有资格熄灯:被顶掉的旧请求先返回时若把它清了,
    //   新请求还在路上,退让却已经撤掉 —— 用户会以为数据到了。
    if (my === seq) reloading.value = false
  }
}
// 页签切回:参数页那边可能刚重算过 —— 池快照时间变了就整月重拉(数字与 stale 条一起变新),没变只刷状态
// (回包前若已换月(seq 变了)就丢弃,别让旧月 status 盖住新月的 stale 条)
async function refreshStatus() {
  if (!period.picked) return   // 还没选期(主区是选期矩阵):ym 是 '',后端按格式校验直接 400
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
// F2:loadRules() 是 fire-and-forget(:onMounted 里 .catch(()=>{}))——「还在飞」的窗口里
// rulesFailed 还是 false,openPoolDlg 从 ruleById 取 feeKey 拿不到值,静默落回默认键。
// rulesLoading 补上这段窗口;rulesNotReady 合并两种「不能存」的原因(载入中/载入失败)。
const rulesLoading = ref(true)
const rulesNotReady = computed(() => rulesLoading.value || rulesFailed.value)
async function loadRules() {
  try { rules.value = await allocApi.rules(); rulesFailed.value = false }
  catch (e) { rulesFailed.value = true; throw e }
  finally { rulesLoading.value = false }
}
// 主数据清单(页签切回回拉:租户改名/楼栋单元/抄表建档后不显旧清单)
function loadMasters() {
  buildingApi.list().then(bs => { buildings.value = bs }).catch(() => {})
  loadMeters()
  tenantApi.list().then(ts => { tenants.value = ts }).catch(() => {})
}
// 表档案按月分段(METER-TIMELINE-SPEC §2):站在本页账期取(标签、在册状态都是这个月的),切月重拉;旧月回包晚到就丢
let meterSeq = 0
const metersYm = ref('')   // 手上这份 meters 是站在哪个月取的;切月重拉失败时旧月那份不拿来说本月的在册状态
function loadMeters() {
  const my = ++meterSeq, at = ym.value
  metersApi.list('elec', undefined, at || undefined)
    .then(ms => { if (my === meterSeq) { meters.value = ms; metersYm.value = at } }).catch(() => {})
}
onReactivated(() => { loadMasters(); refreshStatus() })

// 深链落到同一个月后 generate=1 直接进编辑模式 —— 否则用户到了这儿还要自己找到「编辑模式」才看得见生成按钮(2026-08-14 用户报障)。
// 期本身由 useChainDeepPeriod 在 setup 期落定(认 p= 与旧 ym=,SIDEBAR-UX-REDESIGN §4.2);这里只剩 generate。
const route = useRoute()
function applyHandoff() {
  // ⚠ 顺序仍是先有期再进编辑:toggleEdit 占的锁按 period.year/month 算,期未落定时占的是 billing-chain:0-00,
  //   enter() 的占锁后复核发现期变了,还锁不进,深链彻底进不去编辑态(2026-08-29 修复)。period.picked 也要判:
  //   没有期时主区是选期矩阵,进了编辑态也没有任何写入口。走 toggle 不裸写 editMode:缺权限时弹授权窗。
  if (route.query.generate === '1' && period.picked && canEnter.value) toggleEdit()
}

onMounted(() => {
  loadRules().catch(() => {})
  loadMasters()
  applyHandoff()
  if (period.picked) loadMonth()
})
// 换账期:上次生成的告警不再适用;cfgDirty 同理 —— 它记的是「**这个月**改过参数还没重算」,
// 换到别的月还亮着就是误报(在 8 月改了参数,切到 9/10 月那条橙条一路跟着,而那些月根本没动过),
// 用户分不清哪个月真的需要重算。2026-08-15 用户点名。
watch(ym, () => { genWarnings.value = []; cfgDirty.value = false; loadMeters(); if (period.picked) loadMonth() })

const ruleById = computed(() => new Map(rules.value.map(r => [r.id, r])))
const buildingOpts = computed(() => [{ value: '', label: '(园区级,不挂楼栋)' },
  ...buildings.value.map(b => ({ value: String(b.id), label: b.name }))])

// ── 分带表体(§H4.2b):按原册块分带(一期 7 块;二期/宿舍无块回落楼栋),楼层成列;
// 带尾出块合计(口径同原册 SUM 区间),tfoot 出全期合计(均剔没出应分摊的 ref 行,G1) ──
const bands = computed(() => groupPoolsByBookBlock(pools.value?.rows ?? [], zone.value))
const foot = computed(() => poolFooter(bands.value))
const generated = computed(() => pools.value?.generated ?? false)

// ── 受益人变动(告警抽屉「池成员变动」组):只提示本 zone 的池;点条目进配置面板定位 ──
const zoneRuleIds = computed(() =>
  new Set((pools.value?.rows ?? []).filter(r => r.zone === zone.value).map(r => r.ruleId)))
const zoneDiffs = computed(() => diffs.value.filter(d => zoneRuleIds.value.has(d.ruleId)))
const rowById = computed(() => new Map((pools.value?.rows ?? []).map(r => [r.ruleId, r])))
/**
 * 从「待处理」抽屉点一条 → **只定位，不进编辑态**（用户拍板 2026-08-26）。
 *
 * ⚠ 这里以前是 `editMode.value = true` + 直接开编辑池弹窗 —— 权限门和编辑锁**两道全绕**。
 *   原注释写「没有 param-policy 也让他进来看，弹窗内部自会按权限决定能不能改」，
 *   那是 EDIT-MODE-SPEC **v4 已经推翻的旧思路**：v4 的铁律是
 *   「进得了编辑模式 ⇒ 本页权限一定齐」「编辑态里不再存在点不动的控件」。
 *   实际表现也印证了：用户点进去能打开编辑池、改完保存才被告知「无操作权限」。
 *
 * 现在只把那个池**高亮定位**出来。要改就自己点右上的「编辑模式」——
 * 权限与锁在那一道门上一次说清。
 */
/** 从问题面板跳过来时闪一下的那个池(画布 06-C「点一条，跳到表里那一行并闪一下」)。仅视觉定位,不改数据、不进编辑态。 */
const flashId = ref<number | null>(null)

function gotoDiff(ruleId: number) {
  const r = rowById.value.get(ruleId)
  if (!r) return
  // 那一组收着就先展开 —— 不然跳过去什么也看不见
  const b = bands.value.find(x => x.rows.includes(r))
  if (b && collapsed.value.has(b.label)) toggleBand(b.label)
  // 同一个池连点两次也要再闪:先摘掉类,下一帧再挂(类不摘,动画不重播)
  flashId.value = null
  void nextTick(() => {
    flashId.value = ruleId
    document.querySelector(`[data-rule-id="${ruleId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

// ── 列模型(画布 03-A「少 5 列、一行一个读数、钱那一列当主角」):表头一行 12 列 ——
//   位置 用途 | 电表 倍率 上月行至 本月行至 | 用量 应分摊(元) 分摊方式 分摊标准 | 分摊基数 加减度数
// 区域 + 楼层并成「位置」(区域灰字);「分摊语义」改「分摊方式」只写方式(基数已有「分摊基数」列);
// 备注进用途格的悬停说明(导出照旧带备注,实现规范 §2 第 14 条)。
// 尖峰平谷按比例出列(touColumns,和园区抄表同一套):一块分时读数都没有 → 不出列也不出开关;少数 → 默认收起,
// 那一行点 › 看;过半 → 默认出列;开关记住上次选择。实收 / 盈亏恒 '–'(待账单模块回填),默认隐藏、收进「列」菜单。
// 换期 / 切编辑态列数不变(LAYOUT-STABILITY §1):列数只随用户自己点的开关和列菜单变。
type SegK = 'qtySharp' | 'qtyPeak' | 'qtyFlat' | 'qtyValley'
const SEGS: { lab: string; k: SegK }[] = [
  { lab: '尖', k: 'qtySharp' }, { lab: '峰', k: 'qtyPeak' }, { lab: '平', k: 'qtyFlat' }, { lab: '谷', k: 'qtyValley' },
]
type SegSrc = Pick<AllocPoolLineDTO, SegK>
/** 一个池在表里占的行:逐表一行;净额池 / 本月没生成 / 无绑定表回落池本身一行(null) */
const linesOf = (r: AllocPoolRowDTO): (AllocPoolLineDTO | null)[] => (r.lines.length ? r.lines : [null])
const touSrcs = computed<SegSrc[]>(() => bands.value.flatMap(b => b.rows.flatMap(r => linesOf(r).map(ln => ln ?? r))))
const touM = computed(() => touMode(touSrcs.value.filter(hasTouQty).length, touSrcs.value.length))
const touOn = ref(false)
watch(touM, m => { touOn.value = touColsOn(m, 'pool') }, { immediate: true })
function setTou(on: boolean) { touOn.value = on; saveTouPref('pool', on) }
const segCols = computed(() => (touOn.value ? SEGS : []))
const EXTRA_COLS = [{ key: 'paid', label: '实收' }, { key: 'pl', label: '盈亏' }]
const hiddenCols = ref<string[]>(['paid', 'pl'])
const showPaid = computed(() => !hiddenCols.value.includes('paid'))
const showPl = computed(() => !hiddenCols.value.includes('pl'))
/** 应分摊之后的尾巴:分摊方式 / 分摊标准 / 分摊基数 / 加减度数 + 列菜单里放出来的实收 / 盈亏 */
const tailN = computed(() => 4 + (showPaid.value ? 1 : 0) + (showPl.value ? 1 : 0))
/** 位置 用途 电表 倍率 上月 本月 用量 应分摊 = 8,+ 尖峰平谷(开着时)+ 尾巴 */
const colCount = computed(() => 8 + segCols.value.length + tailN.value)

// row 模式(分时列收着):有分时读数的那一行带 ›,点开在下面出段行 —— 有值的段各一行,全空的段并成一行;
// 空的尖段不出(04-A A座总电只有峰 / 平 / 谷、04-C「平段 · 谷段」;和园区抄表 touSegLines 同一写法)
const segOpen = ref(new Set<string>())
const segKey = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => `${r.ruleId}:${ln ? ln.meterId : 'p'}`
const segTg = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => !touOn.value && hasTouQty(ln ?? r)
function toggleSeg(k: string) {
  const s = new Set(segOpen.value)
  if (!s.delete(k)) s.add(k)
  segOpen.value = s
}
function segsOf(r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null): { lab: string; v: number | null }[] {
  if (!segTg(r, ln) || !segOpen.value.has(segKey(r, ln))) return []
  const x: SegSrc = ln ?? r
  const has = SEGS.filter(s => x[s.k] != null).map(s => ({ lab: `${s.lab}段`, v: x[s.k] }))
  const nil = SEGS.filter(s => x[s.k] == null && s.k !== 'qtySharp').map(s => `${s.lab}段`)
  return nil.length ? [...has, { lab: nil.join(' · '), v: null }] : has
}
// 池级格(分摊方式 / 标准 / 基数 / 加减度数 / 实收 / 盈亏,逐表金额算不出来时还有应分摊)纵向合并:跨本池全部逐表行 + 点开的段行
const spanOf = (r: AllocPoolRowDTO) => linesOf(r).reduce((n, ln) => n + 1 + segsOf(r, ln).length, 0)

// ── 分组行兼小计(datagrid「分组行兼小计」,画布 03-A):一组一行写「N 个池」+ 用量 / 应分摊小计,点它收起;
//    原来单独一行的带尾小计取消。默认全展开,收起不记忆(实现规范 §2 第 25 条)。
const collapsed = ref(new Set<string>())
function toggleBand(label: string) {
  flashId.value = null   // 收起时那一行被摘掉,动画的 end / cancel 都不会来;不清的话再展开它会无端再闪一次
  const s = new Set(collapsed.value)
  if (!s.delete(label)) s.add(label)
  collapsed.value = s
}
const bandSums = computed(() => new Map(bands.value.map(b => [b.label, bandFooter(b.rows)])))

// ── 固定列与表格高度(LIST-PAGE-SPEC §9;07-C 公共电核算行):用途(rank 0,名称列)→ 位置。
// 左两根合计超过表格可见宽的 40% 先退位置;用途封顶 1/5,超了省略、悬停看全称。按全部名字估宽,不量 DOM。
// 表头一行 40、行 40、合计 50(03-A 合计行约 50 高):不够 8 行先让合计不贴底,再不够给表格区 min-height、整页往下滚。
const POOL_H: HeightDims = { grpH: 0, leafH: 40, rowH: 40, footH: 50 }
const cellW = (s: string) => textW([s], 14, 20)
const locText = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) =>
  [rowArea(r, ln), rowFloor(r, ln)].filter(Boolean).join(' ')
// 用途格里不缩的东西:› 20、告警角标 21、「+N链」签 44
const useExtra = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) =>
  (hasTouQty(ln ?? r) ? 20 : 0) + (r.warn ? 21 : 0) + (r.links.length ? 44 : 0)
const wideCols = computed<WideCol[]>(() => {
  const cells = bands.value.flatMap(b => b.rows.flatMap(r => linesOf(r).map(ln => [r, ln] as const)))
  return [
    { key: 'loc', side: 'L', rank: 1,
      w: Math.max(cellW('位置'), cellW('合计'), ...cells.map(([r, ln]) => cellW(locText(r, ln)))) },
    { key: 'use', side: 'L', rank: 0, name: true, minW: cellW('三个字') + 20,
      w: Math.max(cellW('用途'), ...cells.map(([r, ln]) => cellW(rowName(r, ln)) + useExtra(r, ln))) },
  ]
})
const wrapEl = ref<HTMLElement | null>(null)
// 数据身份:换月 / 重新加载(pools 换了对象)、切期区按新数据重算列宽;同一份数据里列宽只增不减(07-C「列不会莫名挪位」)
const wideKey = computed(() => ({ p: pools.value, z: zone.value }))
const { fix, hStage } = useWideTable(wrapEl, wideCols, POOL_H, wideKey)
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
const locFixed = computed(() => !!fix.value.style.loc)
const locSt = computed(() => ({ ...w(fix.value.w.loc), ...fix.value.style.loc }))
const useSt = computed(() => ({ ...w(fix.value.w.use), ...fix.value.style.use }))
// 分组标签格:两根都固定时跨两列一起贴左;位置退了就只占用途那一格贴左 —— 贴住的宽不许超过仍固定的列,
// 不然横滚时它会盖住滚到它底下的小计数字
const grpLblSt = computed(() => (locFixed.value
  ? { ...w(fix.value.w.loc + fix.value.w.use), position: 'sticky' as const, left: '0px', boxShadow: fix.value.style.use?.boxShadow }
  : useSt.value))
// 3 级:min-height 挂在表格区 .pl-tablearea 上(卡 = 工具条 44 + 卡边框 2 + .pl-wrap 上边线 1 + 列名与 8 行),
// 整页往下滚。不能挂在 .pl-wrap 上 —— 卡片是 min-height:0 + overflow:hidden,卡不跟着长,超出的行和横向滚动条被裁掉
const areaSt = computed(() => (hStage.value === 3 ? { minHeight: 44 + 2 + 1 + minTableH(POOL_H) + 'px' } : undefined))

// ── 生成本月/重新生成(编辑态;POST generate 后刷新) ──
const cfgDirty = ref(false)   // 池配置/月度参数改动后提示「配置已变,请重新生成」
const generating = ref(false)
// 生成告警(AllocGenerateResultDTO.warnings):引擎的「静默吞钱防线」——无受益人未摊到户 N 元/
// 摊出超应分摊/缺起止日期户未入名册/缺参。全期别一份,不随 zone 页签过滤;换账期清空。
const genWarnings = ref<string[]>([])
async function onGenerate() {
  // 三条守卫都放在这一处,不放在调用方(工具条按钮的 :disabled 只是照抄这些判断做视觉禁用,
  // 真正拦下写请求的就是这里)。两条来源不同、互不覆盖,合并时一条都不能少:
  //  · !editMode —— 写口自守(PERIOD-CONTEXT-HANDOFF 契约 §2.2,照 BillNoticesView 口径):
  //    生成是「先删后插」的整月覆盖,浏览态一定打不出去
  //  · loadErr  —— 之前只有工具条按钮挡了它,告警抽屉那颗「重新生成」直接调本函数,
  //    没读到本月现状也能按下去,蒙着眼覆盖快照(2026-08-29 复审 Finding 1)
  if (!editMode.value) return
  if (generating.value || loadErr.value) return
  const at = ym.value
  if (generated.value && !(await ask({
    title: `重新生成 ${at}？`,
    body: '这个月的核算结果会整个换成按现在的读数和配置重算一遍，原来的数字会被盖掉。',
    action: '重新生成',
  }))) return
  // 等回答的这段时间里可能被接管、换了月、别处已经点了生成 —— 再守一遍,不拿这次「确认」去盖别的月
  if (!editMode.value || generating.value || loadErr.value || ym.value !== at) return
  generating.value = true
  try {
    const res = await allocApi.generate(at)
    cfgDirty.value = false
    genWarnings.value = res.warnings ?? []
    await loadMonth()
    // 生成改的正是矩阵格子上的点(池/损耗亮起、stale 清掉)—— 换出账月时要立刻看得见
    void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
  } catch (e) { receipt.fail(errMsg(e, '生成失败')) } finally { generating.value = false }
}

// ── 导出当月(纯函数 buildPoolExportAoa):成功出结果回执「已导出 文件名」,失败带「重试」(画布 01-A 卡5 / 02-C) ──
async function onExport() {
  const file = `公共电核算-${ym.value}-${zoneLabel(zone.value)}.xlsx`
  try {
    const { writeAoaWorkbook } = await import('@/utils/sheet')
    await writeAoaWorkbook(file, [{ name: '公共电核算', aoa: buildPoolExportAoa(bands.value, ym.value, zoneLabel(zone.value)) }])
    receipt.ok(`已导出 ${file}`)
  } catch (e) { receipt.fail(errMsg(e, '导出失败'), { label: '重试', run: () => void onExport() }) }
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
// 分摊标准带单位(03-A「0.07 元/㎡」):分子是钱(广告字档 qty_over_base 是度),分母随分摊方式 —— 按面积 ㎡、按层份 层;
// 户对户没有标准,留空(正常状态不显示)
const baseUnit = (r: Pick<AllocPoolRowDTO, 'method'>) => (r.method === 'area' ? '㎡' : r.method === 'floor' ? '层' : '')
function stdText(r: AllocPoolRowDTO): string {
  if (r.method === 'direct') return ''
  const t = stdCell(r).text
  const per = baseUnit(r)
  return r.stdValue == null || !per ? t : `${t} ${r.stdKind === 'qty_over_base' ? '度' : '元'}/${per}`
}

// ── 刀I §I3 逐行身份(ROW-IDENTITY-SPEC):楼层/池名称两列逐行取自**本行电表** ──
// 原册 B(区域)/C(楼层)/D(企业名称)永远逐行写、从不纵向合并;纵向合并的只有 AA/AC/AE/AF/AG
// —— 屏上的 rowspan 也就只保留给 分摊语义/分摊标准/系数(月)/加度(月)/实收/盈亏/备注。
// 行值缺(净额池不出逐表行 / 无绑定表 / 后端老快照)才回落池级值。
const rowArea = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => lineArea(ln, poolArea(r))
const rowFloor = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => lineFloor(ln, poolFloor(r))
const rowName = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => lineUseName(ln, poolFeeLabel(r))
// 这一格显示的是本行电表的用途,所以池名只能从悬停里拿 —— 原来写 `r.warn ?? r.autoName ?? r.name`,
// 池一旦有告警,池名就整个看不见了(2024-02 实测 rule 42 就是这样)。改成池名恒在,告警追加在后面。
// 用途格的悬停说明:全称(格里超 1/5 会省略)+ 池名 + 备注(备注列已删,挪进这里;实现规范 §2 第 14 条)。告警有自己的角标
const useTip = (r: AllocPoolRowDTO, ln: AllocPoolLineDTO | null) => ({
  text: rowName(r, ln),
  sub: [`池：${r.autoName || r.name}`, poolNote(r, '') && `备注：${poolNote(r, '')}`].filter(Boolean).join(' · '),
})
const linkTip = (r: AllocPoolRowDTO) =>
  r.links.map(l => `折入${l.type === 'fold_price' ? '标准' : '度数'} ← ${l.name}`).join('；')
// 电表格的悬停说明:全称 + 类型 + 编码(格里只写表号,03-A「电表列只写表」)
const meterTip = (ln: AllocPoolLineDTO) => ({
  text: lineLabel(ln), sub: [ln.meterType, ln.code && `编码 ${ln.code}`].filter(Boolean).join(' · ') || undefined,
})
const isNewMeter = (ln: AllocPoolLineDTO) => /新表$/.test((ln.subName ?? '').trim())
// 无绑定表的池:一块表都没绑(原册联塑精铟那种)。看的是池配置不是当月快照 —— 没生成的月 lines 也是空的
const noMeter = (r: AllocPoolRowDTO) => r.meters.length === 0

// ── 池参数只读镜像(S21 §2.4):编辑态「分摊基数 / 加减度数」两列 + 抽屉③一行,值=站在本月的生效值(不是月行也不是默认列),
//    徽标=生效方式(仅本月 / 长期);写入口只在计费参数页(点击带 ym+池高亮跳过去) ──
// text=格里的紧凑数;full=抽屉里的值文案(走面积基数的池后端给「148,918.01 ㎡」+ 命中链末项「取自「园区分摊面积基数」」,格里显数+「面积基数」徽标)
// LIST-PAGE-SPEC §8:模板每格调 6 次、抽屉与表同组件(抽屉里每敲一键整表重渲染)—— 格对象按 (池,键) 在 computed 里建一次 Map,模板只 get
interface ParamCell {
  text: string; full: string; tone: 'month' | 'from' | 'inherit'; range: string; baseRef: string | null
  value: number | null
  /** 格子的悬停说明:值 + 生效方式(仅本月 / 长期)+ 面积基数来源;副句说点它去哪(画布 03-A「↗ 去计费参数」) */
  tip: { text: string; sub: string }
}
const EMPTY_CELL: ParamCell = { text: '–', full: '未设置', tone: 'inherit', range: '未设置', baseRef: null, value: null,
  tip: { text: '未设置', sub: '↗ 点一下去计费参数页填' } }
const paramCells = computed(() => {
  const m = new Map<string, ParamCell>()
  for (const r of paramRows.value) {
    if (r.mode == null || (r.key !== 'coefficient' && r.key !== 'extra_qty' && r.key !== 'round_scale')) continue
    const b = rangeBadge(r)
    const baseRef = baseRefLabel(r)
    m.set(`${r.scope}|${r.key}`, { text: fmt(r.value), full: r.valueText, tone: b.tone, range: r.rangeText, baseRef, value: r.value,
      tip: { text: `${r.valueText}（${r.rangeText}）${baseRef ? ` · 取自「${baseRef}」` : ''}`, sub: '↗ 点一下去计费参数页改' } })
  }
  return m
})
type PoolParamKey = 'coefficient' | 'extra_qty' | 'round_scale'
const paramCell = (ruleId: number, key: PoolParamKey): ParamCell => paramCells.value.get(`rule:${ruleId}|${key}`) ?? EMPTY_CELL
// 格里的字(03-A):分摊基数带单位(按面积 ㎡ / 按层份 层),加减度数带正负号(+170)
function paramText(r: AllocPoolRowDTO, k: 'coefficient' | 'extra_qty'): string {
  const c = paramCell(r.ruleId, k)
  if (c.tone === 'inherit' || c.value == null) return c.text
  if (k === 'extra_qty') return c.value > 0 ? `+${c.text}` : c.text
  const u = baseUnit(r)
  return u ? `${c.text} ${u}` : c.text
}

// 抽屉③只读句:「分摊基数 5.7（2023-12 起长期）· 加减度数 +170（仅本月）」;走面积基数的池写「分摊基数 148,918.01 ㎡（取自「园区分摊面积基数」）」
function roParamLine(ruleId: number): string {
  const c = paramCell(ruleId, 'coefficient'), e = paramCell(ruleId, 'extra_qty')
  const coef = c.tone === 'inherit' ? '分摊基数 未设置' : c.baseRef ? `分摊基数 ${c.full}（取自「${c.baseRef}」）` : `分摊基数 ${c.full}（${c.range}）`
  const extra = e.tone === 'inherit' ? '加减度数 未设置' : `加减度数 ${e.full}（${e.range}）`
  return `${coef} · ${extra}`
}
// V131 D5:取整位挪成池参数(按月生效),既有池在抽屉「高级」里只读一句;没有行 = 引擎按 2 位(AllocService.roundScaleOf)
function roRoundLine(ruleId: number): string {
  const c = paramCell(ruleId, 'round_scale')
  return c.tone === 'inherit' ? '分摊标准小数位 未设置（按 2 位）' : `分摊标准小数位 ${c.full}（${c.range}）`
}
const router = useRouter()
const tabs = useTabsStore()
// 深链协议:KeepAlive 缓存实例只在 setup 消费 query,必须 openFresh;section 按键归区(加减度数=① 本月参数,分摊基数/取整位=② 长期常数);
// edit=1:[去重算] 落地直接进编辑态(重算按钮只在编辑态出)
function gotoParams(ruleId?: number, key: PoolParamKey | null = null, edit = false) {
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
  // 待重算(画布 06-C 第一组):参数 / 抄表晚于本月结果(stale)和池配置改过没重新生成(cfgDirty)说的是同一件事 ——
  // 屏上的数是改之前算的 —— 并成一组,组头一颗「重算本月」。
  // 重算是写操作(EDIT-MODE:写入口只在编辑态;实现规范 §2 第 22 条同理):编辑态组头是「重算本月」,直接复用工具条的
  // onGenerate(守卫都在它里面:浏览态 / 加载失败 / 生成中一律打不出去);浏览态给「进入编辑模式」,拿到锁后组头换成「重算本月」
  // (不自动帮点:拿锁可能要先过提权弹窗)。连编辑模式都进不了的人:stale 还能去计费参数页,cfgDirty 他一点办法都没有 ——
  // 只报不给动作的不进面板(§6-3,2026-08-29 复审 Finding 2)。
  const items = [
    ...(staleMsg.value ? [{ text: staleMsg.value }] : []),
    ...(cfgDirty.value ? [{ text: `${ym.value} 池配置改过，还没重新生成` }] : []),
  ]
  // 编辑态 = 生成本身(onGenerate,守卫都在它里面);浏览态 = 进入编辑模式;进不了编辑模式 = 没有(调用方再决定兜底)
  const genAction = (label: string) => (editMode.value
    ? { label, icon: 'refresh-cw', busy: generating.value || !!loadErr.value,
        busyLabel: loadErr.value ? '本月数据没加载出来，不能重算' : '重算中…',
        run: () => { alertOpen.value = false; void onGenerate() } }
    : canEnter.value
      ? { label: '进入编辑模式', icon: 'pencil', run: () => { alertOpen.value = false; toggleEdit() } }
      : undefined)
  const recalc = genAction('重算本月') ?? (staleMsg.value
    ? { label: '去计费参数页重算', icon: 'refresh-cw',
        run: () => { alertOpen.value = false; gotoParams(undefined, null, true) } }
    : undefined)
  if (items.length && recalc) gs.push({
    key: 'recalc', title: '待重算',
    desc: `${[staleMsg.value ? staleWho(status.value) : '', cfgDirty.value ? '池配置' : ''].filter(Boolean).join('和')}`
      + '改过，屏上的数还是改之前算的 —— 不重算，出账就按旧的走。',
    items, action: recalc,
  })
  // 本次生成告警:清零的动作是改完源头后重新生成(§6-2「只报不给动作的不许进面板」),判法同「待重算」;
  // 进不了编辑模式的人拿它没办法 —— 不进面板
  const regen = genAction('重新生成')
  if (genWarnings.value.length && regen) gs.push({
    key: 'gen', title: '本次生成告警',
    desc: '引擎生成时报的静默吞钱防线:池没有受益人(应分摊的钱没摊到任何一户)、缺读数、缺参数。'
      + '不管它,这笔钱就在账上消失、谁也不会被收。全期别一份,不随一期/二期页签过滤;'
      + '逐条核对源头后重新生成即清空(换账期也会清)。',
    items: genWarnings.value.map(text => ({ text })),
    action: regen,
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
  const mg = meterDiffGroup(meterDiffs.value, zone.value)
  if (mg) gs.push(mg)
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
  // 自本月起(memberMonth=ym):受益人、绑定表、折入链三处都按月写版本组,不动此前月份与长期那一份(V131 D4/D7)
  monthOnly: boolean
  oldName: string                     // 存量池名(定位三项全空时后端保留原名,此处照实展示)
}
const form = ref<PoolForm>(emptyForm())
function emptyForm(): PoolForm {
  return { id: null, zone: zone.value, buildingId: null, floorLabel: '', side: '', feeName: '',
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
  loss: '并入损耗链', ref: '只出分摊标准供别池折入,不摊给租户;标准折进别的池时应分摊照算',
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
const SIDE_BASE = ['东侧', '西侧', '南侧', '北侧', '中间']
const FEENAME_BASE = ['消防', '走廊灯', '楼层照明', '货梯', '电梯', '路灯', '公共电', '水泵', '空调', '绿化水']
const uniq = (base: string[], from: (string | null)[]) =>
  [...new Set([...base, ...from.filter((s): s is string => !!s && s.trim() !== '')])]
// 楼层候选跟着**当前选中的楼栋**走 —— 换楼栋要重算(十二层的楼选完再换回三层的,
// 不重算会留着十二个选项)
const floorOpts = computed(() => {
  const fc = buildings.value.find(b => b.id === form.value.buildingId)?.floorCount ?? 0
  return [{ value: '', label: '(整栋,不分层)' },
    ...floorLabels(fc, (pools.value?.rows ?? []).map(r => r.floorLabel)).map(f => ({ value: f, label: f }))]
})
const sideOpts = computed(() => uniq(SIDE_BASE, (pools.value?.rows ?? []).map(r => r.side)))
const feeNameOpts = computed(() => uniq(FEENAME_BASE, (pools.value?.rows ?? []).map(r => r.feeName)))
const buildingNameOf = (id: number | null) =>
  id == null ? null : (buildings.value.find(b => b.id === id)?.name ?? null)
// 池名只读展示(后端保存时按同规则覆盖 name)
const formAutoName = computed(() => poolAutoName(
  zone.value, buildingNameOf(form.value.buildingId), form.value.floorLabel, form.value.side, form.value.feeName))
// 存量池(定位三项全空)后端保留原名不改 —— 与 AllocService.poolName 的唯一例外对齐
const keepsOldName = computed(() => form.value.id != null && form.value.oldName !== ''
  && !form.value.floorLabel.trim() && !form.value.side.trim() && !form.value.feeName.trim())

// ── 顶部常驻名字条(变更 1,2026-08-30 用户拍板):今天自动名藏在①段底部,改楼层/侧向会
// 改名却看不见;移到抽屉顶部实时跟随。origLoc = 打开抽屉那一刻的四个定位字段快照,逐字段
// (不是整串比较)判断"这一格从打开到现在改过没有",用来高亮名字里对应变化的那一段。
const origLoc = ref({ buildingId: null as number | null, floorLabel: '', side: '', feeName: '' })
const proposedName = computed(() => (keepsOldName.value ? form.value.oldName : formAutoName.value))
// 撞名前端预判(镜像 AllocService.apply 的查重:按 finalName 全库查重,不分 zone,排除自身 id)——
// 用已经拉到手的 pools.rows 抢先算一遍拦在保存前;算漏了后端仍是最后一道闸,不是安全问题只是体验差一点。
const nameConflictRow = computed(() => {
  const proposed = proposedName.value
  if (!proposed) return null
  return (pools.value?.rows ?? []).find(r => r.ruleId !== form.value.id && r.name === proposed) ?? null
})
const nameConflictHint = computed(() => nameConflictRow.value
  ? `池名「${proposedName.value}」已被另一个池占用 —— 请补上侧向或改费项名,让两个池分得开` : '')
const nameChanged = computed(() => form.value.id != null && !keepsOldName.value && proposedName.value !== form.value.oldName)
const locFieldChanged = computed(() => ({
  building: form.value.id != null && form.value.buildingId !== origLoc.value.buildingId,
  floor: form.value.id != null && form.value.floorLabel !== origLoc.value.floorLabel,
  side: form.value.id != null && form.value.side !== origLoc.value.side,
  fee: form.value.id != null && form.value.feeName !== origLoc.value.feeName,
}))
const changedFieldLabels = computed(() => {
  const c = locFieldChanged.value
  return [c.building && '楼栋', c.floor && '楼层', c.side && '侧向', c.fee && '费项'].filter((s): s is string => !!s)
})
// 名字分段高亮:哪一段的来源字段变了就标哪一段,不是整条变色
interface NameSeg { text: string; hi: boolean }
const nameSegs = computed<NameSeg[]>(() => {
  const proposed = proposedName.value
  if (!nameChanged.value) return [{ text: proposed, hi: false }]
  const floor = form.value.floorLabel.trim(), side = form.value.side.trim(), fee = form.value.feeName.trim()
  const loc = floor + side
  const segs: NameSeg[] = [{ text: proposed.split('·')[0] ?? proposed, hi: locFieldChanged.value.building }]
  if (loc) segs.push({ text: loc, hi: locFieldChanged.value.floor || locFieldChanged.value.side })
  if (fee) segs.push({ text: fee, hi: locFieldChanged.value.fee })
  return segs
})

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
// 「高级」disclosure(变更 6):算式/舍入位数/折入链默认收起,全库只有 4 条折入链,不该占一整段
const advOpen = ref(false)

function openPoolDlg(r?: AllocPoolRowDTO) {
  poolErr.value = ''
  weightStash.clear()
  // §H4:挂栋却没录楼层的池,打开时高亮定位三格
  locTodo.value = !!r && poolLocKind(r) === 'todo'
  floorByTenant.value = new Map(r ? r.members.map(m => [m.tenantId, m.floorLabel] as [number, string | null]) : [])
  boundSt.value = new Map(r ? r.meters.map(m => [m.meterId, m] as [number, AllocPoolMeterDTO]) : [])
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
      // D7:三处里任一处站在本月的有效组来自按月版本,就默认勾上
      monthOnly: [...r.members, ...r.meters, ...r.links].some(x => x.src === 'month'),
      oldName: r.name,
    }
  } else form.value = emptyForm()
  // 顶部名字条(变更 1)的基准快照:抽屉打开这一刻的四个定位字段,后续逐字段比对判断改没改
  origLoc.value = { buildingId: form.value.buildingId, floorLabel: form.value.floorLabel,
    side: form.value.side, feeName: form.value.feeName }
  // 名单快照按池重置(与 cands 同理:不清就还挂着上一个池的受益人),再把本池已存受益人全部记进去
  seenMembers.value = new Map()
  for (const m of form.value.members) rememberMember(m)
  meterQ.value = ''; advOpen.value = false
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
// off = 站在本月这块表不计的原因(METER-TIMELINE-SPEC §5:已拆 / 停用 / 不在册的表池引擎自该月起不算,行灰显)
interface MeterRow { meterId: number; label: string; meterType: string | null; ownership: string; other: boolean; off: string | null }
// 打开抽屉那一刻池里已有的表及其本月状态段(GET /pools 下发);候选只含在用的表,全库搜到的表看 meters(同样站在本月取)
const boundSt = ref(new Map<number, AllocPoolMeterDTO>())
const meterById = computed(() => new Map(meters.value.map(m => [m.id, m])))
function offText(id: number): string | null {
  const st = boundSt.value.get(id) ?? (metersYm.value === ym.value ? meterById.value.get(id) : undefined)
  if (!st || st.status === undefined || st.status === 'active') return null   // undefined = 旧后端没给,不猜
  if (st.status === 'removed') return `自 ${st.statusFrom} 起已拆，不计`
  if (st.status === 'retired') return `自 ${st.statusFrom} 起停用，不计`
  return `${ym.value} 不在册，不计`
}
const meterRows = computed<MeterRow[]>(() => {
  const rows: MeterRow[] = cands.value.meters.map(m => ({
    meterId: m.meterId, label: m.label, meterType: m.meterType, ownership: m.ownership, other: false, off: null }))
  const has = new Set(rows.map(r => r.meterId))
  for (const s of form.value.meters) if (!has.has(s.meterId))
    rows.push({ meterId: s.meterId, label: s.label, meterType: null, ownership: '', other: true, off: offText(s.meterId) })
  return rows
})
const signOf = (id: number) => form.value.meters.find(m => m.meterId === id)?.sign ?? null
// SPEC §5:移出打开抽屉时就在池里的表 → 先查它哪些月有读数,确认框点名这些月。V131 起绑定按月分版本:
// 勾了「只改本月起」只点名本月及以后的月(之前的月份不动);没勾改的是长期那一份,照旧全列。
// 本次刚勾上的表直接取消,不问。取消确认 → 把勾选框拨回去
// (@change 时浏览器已经把框取消了,而 form 没变,Vue 不会替我们重画)。
async function toggleBind(id: number, label: string, e?: Event) {
  const f = form.value
  const i = f.meters.findIndex(m => m.meterId === id)
  if (i < 0) { f.meters.push({ meterId: id, sign: 1, label }); return }
  if (boundSt.value.has(id) && !(await confirmUnbind(id, label))) {
    if (e?.target instanceof HTMLInputElement) e.target.checked = true
    return
  }
  if (form.value !== f) return                         // 等读数期间抽屉换了池 / 关了:这次点击作废
  const j = f.meters.findIndex(m => m.meterId === id)
  if (j >= 0) f.meters.splice(j, 1)
}
async function confirmUnbind(id: number, label: string): Promise<boolean> {
  const from = form.value.monthOnly ? ym.value : ''
  let months: string[]
  try {
    months = (await metersApi.meterReadings(id))
      .filter(r => r.usageTotal != null && r.usageTotal !== 0 && r.ym >= from).map(r => r.ym).sort()
  } catch (err) {
    return ask({
      title: `移出「${label}」？`,
      body: `这块表哪些月有读数没查到（${errMsg(err, '读数没加载出来')}）。`
        + (from ? `移出后，${from} 起重新生成时本池不再算它。` : '移出后，重新生成哪个月本池都不再算它。'),
      action: '移出',
    })
  }
  if (!months.length) return true
  return ask({
    title: `移出「${label}」？`,
    body: `这 ${months.length} 个月有读数（用量非零）：${months.join('、')}。移出后，这些月重新生成时本池不再算它的用量。`,
    action: '移出',
  })
}
function toggleSign(id: number) {
  const m = form.value.meters.find(x => x.meterId === id)
  if (m) m.sign = m.sign < 0 ? 1 : -1
}
// V116(变更 3):搜索框上移到列表之上,一个框同时管本定位候选与全库 —— 不再是折叠的
// 「从其他位置添加表」链接(货梯/招商子表/广告字分表这类跨位置口子照样搜得到,是选择器的默认预期)。
const meterQ = ref('')
// 与后端 AllocService.meterLabel 同规则(V73):区域·位置·用途·表号。
// 用途取 tenantName(=账册「企业名称」列原文,公摊表存的是「东侧货梯」这类用途),空则回退标识名。
// 旧实现只取「位置·表号」,B座天面 4 块表全叫「天面·电表①」,用户挑不出谁是谁。
const meterLabelOf = (m: Pick<MeterDTO, 'name' | 'area' | 'spot' | 'tenantName' | 'subName'>) =>
  [m.area, m.spot, m.tenantName?.trim() || m.name, m.subName]
    .map(x => x?.trim()).filter((x): x is string => !!x)
    .filter((x, i, a) => a.indexOf(x) === i).join('·')
// 无搜索词:只显本定位候选(meterRows)。有搜索词:候选按标签过滤 + 并入全库匹配
// (货梯/招商子表这类不在本定位候选里的表),两段拼一份列表,同一个搜索框、同一份勾选状态。
const meterSearchRows = computed<MeterRow[]>(() => {
  const kw = meterQ.value.trim()
  const base = meterRows.value.filter(r => !kw || r.label.includes(kw))
  if (!kw) return base
  const has = new Set(meterRows.value.map(r => r.meterId))
  const extra = meters.value.filter(m => !has.has(m.id)
      && (m.name.includes(kw) || (m.subName ?? '').includes(kw) || (m.spot ?? '').includes(kw)
        || (m.area ?? '').includes(kw) || (m.tenantName ?? '').includes(kw) || (m.code ?? '').includes(kw)))
    .slice(0, 40)
    .map((m): MeterRow => ({ meterId: m.id, label: meterLabelOf(m), meterType: m.meterType, ownership: '', other: true, off: offText(m.id) }))
  return [...base, ...extra]
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
  // 字段错误不走回执(实现规范 §1.1):落到抽屉底部保存钮旁的报错位
  if (!isFinite(v)) { poolErr.value = '份额请输入数字(1=整份,0.5=半份;留空=按楼层自动分)'; return }
  m.weight = v
  weightStash.set(id, v)
}
// 改成户对户时只留第一个受益人(§D.4 整笔归一户,免存出一个 13 户的 direct 池);
// 改成园区自担时清空受益人(变更 5:选择驱动显示,这里没有受益人可选,留着旧名单会在
// UI 说"不摊给任何人"的同时把它悄悄存回去)。只在用户点分摊方式时触发,不在打开抽屉时
// 静默改动既有名单。
function setMethod(m: AllocMethodEditable) {
  form.value.method = m
  if (m === 'direct') form.value.members = form.value.members.slice(0, 1)
  if (m === 'none') form.value.members = []
  // §E6:候选口径随 method 变(direct 不推在租名单)。不用 watch:打开抽屉时 method 也在变,
  // 会与 openPoolDlg 里那次 loadCands 抢 candSeq 把新增池的预勾吃掉。这里只走用户点击这一条路。
  loadCands(false)
}
// 摊给谁 段抬头:none=不适用(变更 5)/direct=户对户单选(§D.4)/园区级未勾人=自动全园/其余=勾选计数
const memberSummary = computed(() => form.value.method === 'none' ? '不适用'
  : form.value.method === 'direct'
  ? `整笔归 ${form.value.members[0]?.tenantName ?? '(未指定)'}`
  : formAutoMembers.value ? '自动=全园在租' : `已选 ${form.value.members.length} 户`)
const memberChipTone = computed(() => (form.value.method === 'none' ? '' : form.value.method === 'direct' ? 'warn' : 'ok'))
const memberHint = computed(() => form.value.method === 'direct'
  ? (cands.value.tenantNote ?? '户对户池只摊给一户,不按定位推在租名单 —— 选中一户即替换原有的')
  : formAutoMembers.value ? '园区级池不勾人=按该期全园在租租户自动摊(勾了就以勾选为准)'
    : '候选=该定位本月在租租户(按合同预勾;侧向勾错请手动取消)')
function addLink() { form.value.links.push({ ruleId: '', type: 'fold_price' }) }

async function submitPool() {
  if (!editMode.value) return
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
      } catch (e) { cfgDirty.value = true; receipt.fail(errMsg(e, '重新生成失败')) }
    } else cfgDirty.value = true
    await loadMonth()
  } catch (e) { poolErr.value = errMsg(e, '保存失败') } finally { saving.value = false }
}
async function delPool() {
  if (!editMode.value) return
  const f = form.value
  if (f.id == null) return
  if (!(await ask({ title: `删除池「${formAutoName.value}」？`, body: '已经出过账的池删不掉。', action: '删除池', danger: true }))) return
  // 等回答期间被接管(抽屉已被 watch(editMode) 关掉)或抽屉换了池:这次删除作废
  if (!editMode.value || !poolDlg.value || form.value !== f) return
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
  <!-- ⓪ 没有期 → 出账月矩阵(五屏共用一张)。选过一次之后本会话不再出现,直落表格 -->
  <ChainMonthGate v-if="!period.picked" title="公共电核算" icon="share-2" />

  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5.3 迁移查看态(S 档 sticky 收敛留首列),
       摘 base.css 的 800px 屏级地板;各 v-if 根分支同挂(矩阵门在 ChainMonthGate 根上挂) -->
  <div v-else-if="!pools && !loadErr" class="page-loading fp-fluid"><span class="page-spin" /></div>

  <div v-else class="pl-page fp-fluid">
    <FPLoadBar :on="veil" />
    <!-- 链路条:期写在这里,五道工序横跳不换期 -->
    <FPStepStrip :steps="chainSteps" current="alloc" :period="ym" @back="period.clear()" />

    <!-- 标题行(画布 03-A / 03-B):左 = 标题 + 页面状态 + 期区;右 = 待处理入口 + 导出当月(浏览态)/ 新增池 + 生成(编辑态)
         + 审核动作簇 + 编辑模式 -->
    <div class="pl-head">
      <div class="pl-head-l">
        <h2 class="pl-title"><span class="ic"><component :is="iconFor('share-2')" :size="18" /></span>公共电核算</h2>
        <!-- 页面状态(LAYOUT-STABILITY §4,03-B):读到了、本月没结果。加载失败时不贴 —— 没读到就不知道生没生 -->
        <FPStateTag v-if="!generated && !loadErr" tone="warn">本月未生成</FPStateTag>
        <Segmented :options="ZONE_OPTS" v-model="zone" size="sm" />
      </div>
      <div class="pl-actions">
        <!-- §6 屏级告警入口:位置固定,有没有告警都渲染(quiet 态) —— 工具条不因告警增减挪一像素 -->
        <FPAlertPanel v-model:open="alertOpen" :count="alertCount" :groups="alertGroups" align="end" />
        <!-- 导出当月只在浏览态(实现规范 §2 第 15 条);没读到就没东西可导(03-B 加载失败那一行只剩编辑模式) -->
        <Button v-if="!editMode && !loadErr" variant="outline" size="sm" :disabled="bands.length === 0" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出当月
        </Button>
        <!-- 编辑态(03-B):新增池 → 生成本月 / 重新生成 → 完成。加载失败时写入口全禁:没读到本月现状,生成是蒙着眼覆盖快照 -->
        <Button v-if="editMode" variant="outline" size="sm" :disabled="!!loadErr" @click="openPoolDlg()">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增池
        </Button>
        <Button v-if="editMode && canGen" variant="outline" size="sm" :disabled="generating || !!loadErr"
                v-tip="loadErr ? '本月数据没加载出来 —— 先重试，否则生成会把你现在看不见的数字直接盖掉' : undefined"
                @click="onGenerate">
          <template #leading><component :is="iconFor(generated ? 'refresh-cw' : 'play')" :size="14" /></template>
          {{ generated ? '重新生成' : '生成本月' }}
        </Button>
        <!-- 审核动作簇(§01):长在编辑按钮**左边**,同一条 flex 行 —— 编辑按钮位一个像素不动。
             四态八格由组件自己判(全站唯一那一份),屏这一层只负责喂键与人话名。 -->
        <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
        <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          :review-note="reviewNote" :review-tip="reviewTip" :disabled="!editMode && !!loadErr"
                          @toggle="toggleEdit()" />
      </div>
    </div>

    <FPElevateDialog
      :page="`公共电核算 · ${ym}`" :action="'生成本月公摊 / 改计费口径'" :perms="asking" what="修改公摊池配置" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`公共电核算 ${ym}`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />

    <!-- 加载失败(LAYOUT-STABILITY §3,画布 03-B):换掉表格区本身,一律带重试,不是表格上方的流内条。
         失败时 pools 已清空 —— 屏上不留上个月的行,生成 / 新增池已禁用,写不进当前月份 -->
    <FPLoadError v-if="loadErr" @retry="loadMonth()">{{ year }} 年 {{ month }} 月的池数据没读到</FPLoadError>
    <!-- fp-stale 带 pointer-events:none —— 旧数据不许被点、被录(安全项,见 base.css) -->
    <div v-else class="pl-tablearea" :class="{ 'fp-stale': veil }" :style="areaSt" :aria-busy="veil">
      <div class="pl-card">
        <!-- 卡内右上一条(03-A):分时用量开关(按比例出列,没有分时读数就不出)+ 列菜单(实收 / 盈亏默认隐藏) -->
        <FPTableTools :mode="touM" switch-label="分时用量" :tou="touOn" :columns="EXTRA_COLS"
                      v-model:hidden="hiddenCols" @update:tou="setTou" />
        <div ref="wrapEl" class="pl-wrap">
          <table class="pl-table" :class="{ 'hs-foot': hStage >= 2 }">
            <thead>
              <tr>
                <th class="pl-l" :class="{ 'pl-fix': locFixed }" :style="locSt">位置</th>
                <th class="pl-l pl-fix" :style="useSt">用途</th>
                <th class="pl-l sep" v-tip="'一表一行，只写表号，全称在悬停里；「−」= 从本池冲减'">电表</th>
                <th v-tip="'当月读数当时用的倍率，不是电表档案里现在的倍率'">倍率</th>
                <th>上月行至</th>
                <th>本月行至</th>
                <!-- 单位不写进列头:同一张表里电池与水池混排,写死 kWh 会把吨标成度 -->
                <th class="sep">用量</th>
                <th v-for="s in segCols" :key="s.k">{{ s.lab }}</th>
                <th class="pl-money-th"
                    v-tip="'一期与宿舍：每块表各自四舍五入后的金额。二期：整个池只四舍五入一次，单表金额算不出来，按池合并显示'">应分摊（元）</th>
                <th class="pl-l">分摊方式</th>
                <th>分摊标准</th>
                <th class="sep" v-tip="'分摊基数（层数或面积）站在本月的生效值；点格子去计费参数页改'">分摊基数</th>
                <th v-tip="'加减度数（进分摊标准的分子，不进应分摊）站在本月的生效值；点格子去计费参数页改'">加减度数</th>
                <th v-if="showPaid" v-tip="'租户实际缴回的公摊额 —— 待账单模块落地后从账单侧回填'">实收</th>
                <th v-if="showPl" v-tip="'实收 − 应分摊 —— 待账单模块落地后从账单侧回填'">盈亏</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="b in bands" :key="b.label">
                <!-- 分组行兼小计(03-A):组名 + N 个池 + 用量 / 应分摊小计(口径同原册块合计,见 bandFooter),点它收起 -->
                <tr class="pl-grp" @click="toggleBand(b.label)">
                  <td v-if="!locFixed" :style="locSt"></td>
                  <td :colspan="locFixed ? 2 : 1" class="pl-fix pl-glbl" :style="grpLblSt">
                    <button type="button" class="pl-gbtn" :aria-expanded="!collapsed.has(b.label)">
                      <component :is="iconFor(collapsed.has(b.label) ? 'chevron-right' : 'chevron-down')" :size="14" class="cv" />
                      <span class="t" v-tip="b.label">{{ b.label }}</span>
                      <span class="n">{{ b.rows.length }} 个池</span>
                    </button>
                  </td>
                  <td colspan="4"></td>
                  <td><span class="pl-nv" :class="{ empty: bandSums.get(b.label)?.qty == null }">{{ fmtFixed2(bandSums.get(b.label)?.qty) }}</span></td>
                  <td v-for="s in segCols" :key="s.k"></td>
                  <td class="pl-money"><span class="pl-sumc" :class="{ empty: bandSums.get(b.label)?.cost == null }">{{ fmtFixed2(bandSums.get(b.label)?.cost) }}</span></td>
                  <td :colspan="tailN"></td>
                </tr>
                <template v-if="!collapsed.has(b.label)">
                  <template v-for="r in b.rows" :key="r.ruleId">
                    <!-- V73 逐表行:一个池占 max(1,lines) 行(+ 点开的段行);池级格纵向合并 -->
                    <template v-for="(ln, li) in linesOf(r)" :key="ln ? ln.meterId : 'p'">
                      <tr class="pl-row" :data-rule-id="li === 0 ? r.ruleId : undefined"
                          :class="{ 'pl-flash': flashId === r.ruleId }" @animationend="flashId = null" @animationcancel="flashId = null">
                        <!-- 位置 = 区域(灰)+ 楼层,逐行取本行电表(原册 B/C 列逐行写);挂栋没录楼层的橙色「(未录)」 -->
                        <td :class="{ 'pl-fix': locFixed }" :style="locSt">
                          <span class="pl-txt"><span class="pl-area">{{ rowArea(r, ln) }}</span> <span v-if="rowFloor(r, ln) === POOL_LOC_UNSET" class="pl-loc-todo" v-tip="POOL_LOC_HINT.todo">{{ POOL_LOC_UNSET }}</span><template v-else>{{ rowFloor(r, ln) }}</template></span>
                        </td>
                        <!-- 用途 = 本行电表的用途(原册 D 列);池名和备注在悬停里。编辑态点它开池配置 -->
                        <td class="pl-fix" :style="useSt">
                          <span class="pl-pname" :class="{ click: editMode }" @click="editMode && openPoolDlg(r)">
                            <button v-if="segTg(r, ln)" type="button" class="pl-segtg" :aria-expanded="segsOf(r, ln).length > 0"
                                    v-tip="'看分时段用量'" @click.stop="toggleSeg(segKey(r, ln))">
                              <component :is="iconFor(segsOf(r, ln).length ? 'chevron-down' : 'chevron-right')" :size="14" />
                            </button>
                            <span class="nm" v-tip="useTip(r, ln)">{{ rowName(r, ln) }}</span>
                            <span v-if="r.warn" class="pl-warn" v-tip="r.warn">!</span>
                            <span v-if="r.links.length" class="pl-linkchip" v-tip="linkTip(r)">+{{ r.links.length }}链</span>
                          </span>
                        </td>
                        <!-- 电表列只写表(03-A):「电表①」,「新表」拆成小签,全称进悬停;净额池写「冲减 N 表」,构成进悬停 -->
                        <td class="sep">
                          <span v-if="ln" class="pl-meter">
                            <span class="pl-mtx" v-tip="meterTip(ln)">{{ lineShortLabel(ln) }}</span>
                            <span v-if="isNewMeter(ln)" class="pl-tag">新表</span>
                          </span>
                          <span v-else-if="netSummary(r)" class="pl-txt dim" v-tip="netSummary(r)!.title">{{ netSummary(r)!.text }}</span>
                          <span v-else class="pl-txt dim">{{ noMeter(r) ? '无绑定表' : '–' }}</span>
                        </td>
                        <td><span class="pl-nv" :class="{ empty: !ln?.factorSnap }">{{ fmt(ln?.factorSnap ?? null) }}</span></td>
                        <td><span class="pl-nv" :class="{ empty: ln?.prevTotal == null }">{{ fmtFixed2(ln?.prevTotal) }}</span></td>
                        <td><span class="pl-nv" :class="{ empty: ln?.currTotal == null }">{{ fmtFixed2(ln?.currTotal) }}</span></td>
                        <td class="sep"><span class="pl-nv" :class="{ empty: (ln ?? r).qtyTotal == null }">{{ fmtFixed2((ln ?? r).qtyTotal) }}</span></td>
                        <td v-for="s in segCols" :key="s.k">
                          <span class="pl-nv" :class="{ empty: (ln ?? r)[s.k] == null }">{{ fmtFixed2((ln ?? r)[s.k]) }}</span>
                        </td>
                        <!-- 应分摊:逐表金额齐全 → 逐表显;否则(二期池级一次四舍五入 / 净额池 / 手输量池)按池合并 -->
                        <td v-if="costPerLine(r)" class="pl-money">
                          <span class="pl-sumc" :class="{ empty: ln?.costAmount == null }">{{ fmtFixed2(ln?.costAmount) }}</span>
                        </td>
                        <td v-else-if="li === 0" class="pl-money" :rowspan="spanOf(r)">
                          <span class="pl-sumc" :class="{ empty: r.costAmount == null }">{{ fmtFixed2(r.costAmount) }}</span>
                        </td>
                        <template v-if="li === 0">
                          <!-- 无绑定表的池整行写「–」(03-A 联塑精铟行):方式 / 标准 / 基数 / 加减度数都不出 -->
                          <td :rowspan="spanOf(r)">
                            <span v-if="noMeter(r)" class="pl-txt empty">–</span>
                            <span v-else class="pl-tag">{{ poolMethodLabel(r) }}</span>
                          </td>
                          <td :rowspan="spanOf(r)">
                            <span v-if="noMeter(r)" class="pl-nv empty">–</span>
                            <span v-else class="pl-nv" :class="{ empty: r.stdValue == null, fold: stdCell(r).title }"
                                  v-tip="stdCell(r).title ?? undefined">{{ stdText(r)
                              }}<sup v-if="frozenNote.has(r.ruleId)" class="pl-frz">❄</sup></span>
                          </td>
                          <!-- S21:分摊基数 / 加减度数只读镜像(当月生效值),悬停出 ↗,点格子带 ym + 池高亮跳计费参数页 -->
                          <td v-for="k in (['coefficient', 'extra_qty'] as const)" :key="k" :rowspan="spanOf(r)"
                              :class="{ sep: k === 'coefficient' }">
                            <span v-if="noMeter(r)" class="pl-nv empty">–</span>
                            <span v-else class="pl-nv pl-pv" :class="{ empty: paramCell(r.ruleId, k).tone === 'inherit' }"
                                  v-tip="paramCell(r.ruleId, k).tip" role="button" tabindex="0"
                                  @click="gotoParams(r.ruleId, k)" @keydown.enter.prevent="gotoParams(r.ruleId, k)">
                              {{ paramText(r, k) }}<span class="go" aria-hidden="true">↗</span>
                            </span>
                          </td>
                          <!-- 实收 / 盈亏:账册 AE/AF 口径(从账单侧拉回),bill_notice 未落地故恒 '–' -->
                          <td v-if="showPaid" :rowspan="spanOf(r)"><span class="pl-nv empty">–</span></td>
                          <td v-if="showPl" :rowspan="spanOf(r)"><span class="pl-nv empty">–</span></td>
                        </template>
                      </tr>
                      <!-- 段行(row 模式点 › 出):池级格已被上面的 rowspan 盖住,这里只出前面几格 -->
                      <tr v-for="sg in segsOf(r, ln)" :key="sg.lab" class="pl-seg">
                        <td :class="{ 'pl-fix': locFixed }" :style="locSt"></td>
                        <td class="pl-fix" :style="useSt"><span class="pl-txt dim pl-seglbl">{{ sg.lab }}</span></td>
                        <td colspan="4" class="sep"></td>
                        <td class="sep"><span class="pl-nv" :class="{ empty: sg.v == null }">{{ fmtFixed2(sg.v) }}</span></td>
                        <td v-if="costPerLine(r)" class="pl-money"></td>
                      </tr>
                    </template>
                  </template>
                </template>
              </template>
              <tr v-if="bands.length === 0">
                <td class="pl-noro" :colspan="colCount">{{ zoneLabel(zone) }}暂无池配置{{ editMode ? '，点右上「新增池」开始录入' : '' }}</td>
              </tr>
            </tbody>
            <!-- 合计:Σ用量 / Σ应分摊,没出应分摊的纯标准行不计(口径见 bandFooter) -->
            <tfoot>
              <tr>
                <th class="pl-l" :class="{ 'pl-fix': locFixed }" :style="locSt"><span class="pl-foot-lbl">合计</span></th>
                <th class="pl-fix" :style="useSt"></th>
                <th colspan="4"></th>
                <th><span class="pl-foot-v">{{ fmtFixed2(foot.qty) }}</span></th>
                <th v-for="s in segCols" :key="s.k"></th>
                <th class="pl-money"><span class="pl-foot-v">{{ fmtFixed2(foot.cost) }}</span></th>
                <th :colspan="tailN"></th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <!-- 保存/删除成功提示(卡内回执,默认 4 秒自收)。贴表格区**底**边(card 模式,靠 .pl-tablearea 的 relative 定位) -->
      <FPToast v-model="okMsg" />
    </div><!-- /pl-tablearea:成功 toast 的定位上下文 -->

    <!-- 池配置抽屉(编辑态;迁自旧屏规则弹窗+S3-B1 增量字段) -->
    <FPDrawer :open="poolDlg" :title="form.id == null ? '新增池' : '编辑池 · ' + formAutoName"
              subtitle="池=楼栋+楼层+侧向+费项四级定位(池名自动生成);组成电表与受益人一律勾选;改完保存即重算"
              icon="share-2" :width="820" @close="poolDlg = false">
      <!-- 顶部常驻名字条(变更 1):编辑定位任一格,这里实时跟着变,变化的那一段高亮;
           撞名/存量名保留当场说清楚,不等保存被后端拒 -->
      <div class="pl-namebar">
        <div class="pl-namebar-lbl">这个池叫</div>
        <div class="pl-namebar-row">
          <div class="pl-namebar-name">
            <template v-for="(seg, i) in nameSegs" :key="i"><span v-if="i > 0">·</span><span :class="{ hi: seg.hi }">{{ seg.text }}</span></template>
          </div>
          <span v-if="nameConflictRow" class="pl-chip bad">撞名</span>
          <span v-else-if="keepsOldName" class="pl-chip">存量名保留</span>
          <span v-else-if="nameChanged" class="pl-chip warn">名字会变</span>
        </div>
        <div class="pl-namehint" :class="{ bad: !!nameConflictRow, warn: !nameConflictRow && (nameChanged || keepsOldName) }">
          <template v-if="nameConflictRow">{{ nameConflictHint }}</template>
          <template v-else-if="keepsOldName">存量名保留 —— 填了楼层/侧向/费项才改名</template>
          <template v-else-if="nameChanged">{{ changedFieldLabels.join('/') }}改了,保存后池名会变成以上名称</template>
        </div>
      </div>
      <div class="pl-form">
        <!-- 这个池在哪:定位四选 → 池名自动生成,结果实时体现在上方名字条(变更 1/2) -->
        <div class="pl-sec">
          <div class="pl-sectitle">
            这个池在哪
            <span style="flex:1"></span>
            <span v-if="locTodo" class="pl-chip warn">缺楼层方位 —— 请补下面三格</span>
            <span v-else class="pl-chip">改这里会改名</span>
          </div>
          <div class="pl-formrow" :class="{ 'pl-loc-hi': locTodo }">
            <Select v-model="form.zone" label="期区" :options="ZONE_OPTS" size="sm" />
            <Select :model-value="form.buildingId == null ? '' : String(form.buildingId)" label="楼栋(空=园区级)"
                    :options="buildingOpts" size="sm"
                    @update:model-value="form.buildingId = $event === '' ? null : +$event" />
            <Select v-model="form.floorLabel" label="楼层(空=整栋)" :options="floorOpts" size="sm" />
            <div>
              <label class="pl-lbl" for="pl-side">侧向(空=整层)</label>
              <!-- 侧向不参与 poolCandidates/楼层分桶的字符串匹配(那是 floor_label 的事),放开自由输入 -->
              <input id="pl-side" v-model="form.side" class="pl-txti" type="text" list="pl-sides"
                     placeholder="(整层,不分侧)" />
              <datalist id="pl-sides"><option v-for="s in sideOpts" :key="s" :value="s" /></datalist>
            </div>
          </div>
          <div>
            <label class="pl-lbl" for="pl-feename">费项(池名末段)</label>
            <!-- 原生 datalist:既能挑现有费项也能直接输新的,不另建配置表 -->
            <input id="pl-feename" v-model="form.feeName" class="pl-txti" type="text" list="pl-feenames"
                   placeholder="如 走廊灯/消防/货梯" />
            <datalist id="pl-feenames">
              <option v-for="f in feeNameOpts" :key="f" :value="f" />
            </datalist>
          </div>
        </div>

        <!-- 算哪些电表:搜索框上移到列表之上,一个框同时管本定位候选与全库(变更 3) -->
        <div class="pl-sec">
          <div class="pl-sectitle">
            算哪些电表
            <span style="flex:1"></span>
            <span v-if="candLoading" class="dim">载入候选…</span>
            <span v-else class="pl-chip ok">已选 {{ form.meters.length }} 块</span>
          </div>
          <input v-model="meterQ" class="pl-bindq" type="text" placeholder="搜表名 / 位置 / 表号(本位置 + 全库)" />
          <div class="pl-bindlist">
            <label v-for="m in meterSearchRows" :key="m.meterId" class="pl-bindrow" :class="{ off: m.off }">
              <input type="checkbox" :checked="signOf(m.meterId) != null"
                     @change="toggleBind(m.meterId, m.label, $event)" />
              <span class="nm">{{ m.label }}</span>
              <span v-if="m.ownership === 'infra'" class="pl-chip infra">总表 · 一般不入池</span>
              <span v-if="m.off" class="pl-chip">{{ m.off }}</span>
              <span v-else-if="m.other" class="pl-chip">其他位置</span>
              <span class="meta">{{ m.meterType ?? '' }}</span>
              <button v-if="signOf(m.meterId) != null" type="button" class="pl-sign"
                      :class="{ neg: signOf(m.meterId)! < 0 }"
                      v-tip="'点一下切换:这块表的量是加进这个池,还是从池里扣掉(广告字分表 / 火炬园 / 招商子表这类要扣)'"
                      @click.prevent="toggleSign(m.meterId)">
                {{ signOf(m.meterId)! < 0 ? '从池里扣掉' : '加进池' }}
              </button>
            </label>
            <div v-if="meterSearchRows.length === 0" class="pl-bindempty">
              {{ meterQ.trim() ? '无匹配 —— 换个关键词' : '该定位下没有可入池的表 —— 换定位或搜全库' }}
            </div>
          </div>
        </div>

        <!-- 这笔钱怎么摊:分摊方式改分段控件,每档带一句解释(变更 4);算式/位数/折入链收进「高级」(变更 6) -->
        <div class="pl-sec">
          <div class="pl-sectitle">这笔钱怎么摊</div>
          <div v-if="isManualPool" class="pl-manual">人工指定(无电表)——分摊方式不在此改</div>
          <div v-else class="pl-methodseg">
            <label v-for="o in methodRadios" :key="o.value" class="pl-methodopt" :class="{ on: form.method === o.value }">
              <input type="radio" name="pl-method" :value="o.value" :checked="form.method === o.value"
                     @change="setMethod(o.value)" />
              <span class="t">{{ o.label }}</span>
              <span class="h">{{ o.hint }}</span>
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
          <Select v-model="form.feeKey" label="这笔钱进催缴单的哪一项" :options="FEE_OPTS" size="sm" />
          <Input v-model="form.note" label="备注" placeholder="如:电梯用电加170度" size="sm" />
          <button class="pl-more" @click="advOpen = !advOpen">
            <component :is="iconFor(advOpen ? 'chevron-down' : 'chevron-right')" :size="13" />
            高级:分摊标准算式 · 四舍五入位数 · 折入链
          </button>
          <div v-if="advOpen" class="pl-otherbox">
            <div class="pl-formrow">
              <Select v-model="form.stdKind" label="分摊标准算式(按册复刻)" :options="STD_OPTS" size="sm" />
              <!-- V131 D5:取整位挪成池参数按月生效;只有新建池在这里选初始值(后端落成初始版本行,同初始分摊基数) -->
              <Select v-if="form.id == null" :model-value="String(form.roundScale)" label="四舍五入位数" :options="ROUND_OPTS" size="sm"
                      @update:model-value="form.roundScale = +$event" />
            </div>
            <div v-if="form.id != null" class="pl-roparam">
              <span>{{ roRoundLine(form.id) }}</span>
              <button type="button" class="pl-more" @click="gotoParams(form.id!, 'round_scale')">
                <component :is="iconFor('arrow-right')" :size="13" />去计费参数页改
              </button>
            </div>
            <div class="pl-bindhead">
              <span class="pl-sectitle" style="flex:1">从别的池折进来的标准 · {{ form.links.length }} 条</span>
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
              <button class="pl-iconbtn danger" v-tip="'移除'" @click="form.links.splice(i, 1)">
                <component :is="iconFor('x')" :size="14" />
              </button>
            </div>
          </div>
        </div>

        <!-- 摊给谁:选择驱动显示(变更 5,States.dc.html)——按层份才出份额列;户对户变单选、
             去份额/去批量勾选(约束由控件形态表达,不是保存时的红字);园区自担整段收起说明,
             不给受益人可选(setMethod 切到 none 时已同步清空 form.members) -->
        <div class="pl-sec">
          <div class="pl-sectitle">
            摊给谁
            <span style="flex:1"></span>
            <span class="pl-chip" :class="memberChipTone">{{ memberSummary }}</span>
          </div>
          <template v-if="form.method === 'none'">
            <div class="pl-innerwarn">
              <component :is="iconFor('info')" :size="13" />
              <span>{{ METHOD_HINT.none }} —— 这里没有受益人可选</span>
            </div>
          </template>
          <template v-else>
            <span class="dim">{{ memberHint }}</span>
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
              <span class="nm">受益人 · 楼层(系统自动算出)</span>
              <span class="wt" v-tip="{ text: '留空=按楼层自动分:该户所在的每一层各摊 1 份(层内多户按面积拆),未定层户合摊 1 份',
                                        sub: '填数=显式份额覆盖该户(1=整份,0.5=半份)——账册已核对的池请勿改动' }">份额</span>
            </div>
            <div class="pl-bindlist tall">
              <label v-for="t in tenantRows" :key="t.tenantId" class="pl-bindrow" :class="{ gone: t.inForce === 'no' }">
                <!-- direct 池单选(整笔归一户);其余多选 -->
                <input :type="form.method === 'direct' ? 'radio' : 'checkbox'" name="pl-member"
                       :checked="memberOf(t.tenantId) != null" @change="toggleMember(t)" />
                <span class="nm">{{ t.name }}</span>
                <span v-if="t.unitNo" class="pl-chip">{{ t.unitNo }}</span>
                <span v-if="floorByTenant.get(t.tenantId)" class="pl-chip floor"
                      v-tip="'这个楼层先按合同里的单元算;合同没写单元就用这户户内电表的楼层。按层摊时,这户占的每一层各算一份'">
                  {{ floorByTenant.get(t.tenantId) }}
                </span>
                <span v-else-if="floorByTenant.has(t.tenantId)" class="pl-chip nofloor"
                      v-tip="'定不出楼层:该户在本栋既无合同单元、也无户内电表楼层 —— 与其他未定层户合摊 1 份,请补合同单元或该户户内表楼层'">
                  未定层
                </span>
                <span v-if="t.inForce === 'no'" class="pl-chip gone">已退租</span>
                <!-- 2026-09-23:这两档原来都写「已退租」。实测被这么标的户里,一类是下个月才起租、
                     一类是合同表里一行都没有 —— 都不是退租,照着摘人会把还没进场的户摘掉。 -->
                <span v-else-if="t.inForce === 'future'" class="pl-chip nodate"
                      v-tip="'合同起租日在本月之后,这个月还没进场'">还没进场</span>
                <span v-else-if="t.inForce === 'none'" class="pl-chip nodate"
                      v-tip="'这户名下一份非草稿合同都没有 —— 去合同管理补档案'">没有合同档案</span>
                <span v-else-if="t.inForce === 'unknown'" class="pl-chip nodate"
                      v-tip="'补齐合同起止日期后才能判定在租'">合同缺起止日期</span>
                <span v-else-if="t.other" class="pl-chip">非本定位</span>
                <span class="meta"></span>
                <input v-if="form.method === 'floor'" class="pl-wi" type="number" step="any"
                       :disabled="memberOf(t.tenantId) == null" :value="memberOf(t.tenantId)?.weight ?? ''"
                       placeholder="自动"
                       v-tip="'留空=按楼层自动分(所在层各 1 份,层内按面积拆);填数=显式份额覆盖(1/0.5)'"
                       @click.stop
                       @change="commitWeight(t.tenantId, ($event.target as HTMLInputElement).value)" />
              </label>
              <div v-if="tenantRows.length === 0" class="pl-bindempty">
                {{ form.method === 'direct' ? '尚未指定受益户 —— 户对户池不推候选名单,请用上方选择器挑那一户'
                  : '该定位本月无在租租户' }}
              </div>
            </div>
          </template>
        </div>
        <!-- V131 D7:「只改本月起」管三处(电表 / 折入的标准 / 受益人),从「摊给谁」里挪到抽屉级,
             园区自担等所有分摊方式都出 -->
        <label class="pl-chkline"
               v-tip="'勾上：这三处按这次保存的用，从本月起用到下一个按月改过的月份之前；之前的月份和长期那一份都不动。不勾：改的是长期那一份，还在用长期那一份的月份都跟着变。名称、分摊方式、费项这些不分月，勾不勾都是所有月份一起改。'">
          <input type="checkbox" v-model="form.monthOnly" />
          只改本月起（{{ ym }}）：电表、折入的标准、受益人都从这个月起用，之前的月份不动
        </label>
      </div>
      <template #footer>
        <Button v-if="form.id != null" variant="outline" size="sm" @click="delPool">
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          删除池
        </Button>
        <!-- §E2:报错必须跟着「保存」按钮走 —— 原来挂在滚动表体末尾,用户在顶上改完费项点保存,
             400 的红字落在视口外,看起来就是「保存无反应」 -->
        <!-- §F11:各自成行 —— 原来是三元式,池参数加载失败时把后端 400 的原因整条盖掉 -->
        <div class="pl-dlg-err">
          <div v-if="rulesLoading">池参数(出口费项)正在载入…请稍候再保存</div>
          <div v-else-if="rulesFailed">池参数(出口费项)未加载成功 —— 此时保存会把它冲成默认值,请先重试</div>
          <div v-if="nameConflictRow">{{ nameConflictHint }}</div>
          <div v-if="poolErr">{{ poolErr }}</div>
        </div>
        <Button v-if="rulesFailed" variant="outline" size="sm" @click="loadRules().catch(() => {})">重试</Button>
        <Button variant="gray" size="sm" @click="poolDlg = false">取消</Button>
        <Button variant="filled" size="sm" :disabled="saving || rulesNotReady || !!nameConflictRow" @click="submitPool">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          {{ saving ? '保存中…' : '保存并重算本月' }}
        </Button>
      </template>
    </FPDrawer>
  </div>
</template>

<style scoped>
.pl-page { position: relative; display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(mt-head 家族) */
.pl-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pl-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pl-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pl-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.pl-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* 用途格里的「+N链」签 */
.pl-linkchip { flex: none; font-size: 11px; border-radius: var(--radius-full); padding: 0 6px; background: var(--surface-subtle); color: var(--text-secondary); cursor: help; }
/* 表格区:成功 toast 的定位上下文(告警条已改 chip+抽屉,不再有浮层条) */
.pl-tablearea { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 14px; }

/* 表格卡(画布 03-A):卡内右上一条工具(分时用量 · 列),下面是表;表格区 .pl-wrap 自己横竖滚 */
.pl-card { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); overflow: hidden; }
.pl-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border-top: 1px solid var(--border-subtle); }
/* 03-C 字距与行:行高 40、正文 14、表头 12、字左数右、无字距 */
/* 钱那一列的两种底(03-A / 04-A / 05-A 同形,三屏同一组式子:公共电核算 / 园区抄表 / 催缴单各写一份、值逐字相同,
   moneyCol.spec 钉三份一致):数据格与合计格 = 浅蓝 60% 叠白;分组行那一格再叠 60% 卡片灰 */
.pl-table { --money-cell: color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white)); --money-cell-grp: color-mix(in srgb, var(--money-cell) 40%, var(--surface-card)); border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-family: var(--font-sans); letter-spacing: 0; }
.pl-table th, .pl-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0; white-space: nowrap; }
.pl-table thead th { position: sticky; top: 0; z-index: 4; height: 40px; padding: 0 10px; background: var(--surface-card); color: var(--text-muted); font-size: 12px; font-weight: var(--fw-medium); text-align: right; }
.pl-table th.pl-l { text-align: left; }
.pl-table thead th.pl-fix { z-index: 8; }
/* 钱那一列(03-A / 04-A / 05-A 同形):表头下一道蓝线、表头字次要色,格子整列浅蓝底、加粗;字不用蓝(03-C 把「钱是蓝色像链接」列为现状问题) */
.pl-table thead th.pl-money-th { border-bottom-width: 2px; border-bottom-color: var(--hue-blue); color: var(--text-secondary); }
.pl-table tbody td { height: 40px; background: var(--surface-white); vertical-align: middle; font-size: 14px; }
.pl-table td.pl-money { background: var(--money-cell); }
.pl-table tbody tr.pl-row:hover td:not(.pl-money), .pl-table tbody tr.pl-seg:hover td:not(.pl-money) { background: var(--surface-card); }
/* 列组之间的整高竖线(03-A 三条):电表、用量、分摊基数三列的左边;分组行和合计行不画 */
.pl-table .sep { border-left-width: 1px; border-left-style: solid; border-left-color: var(--border-subtle); }   /* 长写:jsdom 解析不了带 var() 的简写,测不到 */
/* 固定列:position/left 由 useWideTable 的内联样式给,这里只管叠放和不透明底 */
.pl-fix { z-index: 3; background: var(--surface-white); }
/* 从问题面板跳过来:整行闪一下 */
.pl-table tbody tr.pl-flash td { animation: pl-flash var(--dur-highlight) var(--ease-standard); }
@keyframes pl-flash { from { background: var(--warn-soft); } }
td.ct { text-align: center; }

/* 用途格:编辑态可点开抽屉;› 展开段行、告警角标、折入链签不缩,名字超了省略、悬停看全称 */
.pl-pname { display: flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 14px; color: var(--text-primary); white-space: nowrap; overflow: hidden; max-width: 100%; box-sizing: border-box; }
.pl-pname.click { cursor: pointer; }
.pl-pname.click:hover .nm { color: var(--hue-blue); }
.pl-pname .nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pl-warn { flex: 0 0 auto; width: 15px; height: 15px; border-radius: var(--radius-full); background: var(--danger-soft); color: var(--hue-red); font-size: 11px; font-weight: var(--fw-semibold); display: grid; place-items: center; cursor: help; }
.pl-segtg { flex: none; display: grid; place-items: center; width: 20px; height: 20px; margin-left: -4px; padding: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; }
.pl-segtg:hover { background: var(--bg-hover); color: var(--text-primary); }
.pl-seglbl { padding-left: 34px; }

/* 数右对齐(mono,两位小数,不截断);空值 '–' 淡显 */
.pl-nv { display: block; text-align: right; font-size: 14px; padding: 0 10px; color: var(--text-primary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-nv.empty { color: var(--text-disabled); }
.pl-nv.fold { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
/* §H3 冻结参数标记:格上留个 ❄ 让「这不是当月价」不用悬停也能扫到 */
.pl-frz { color: var(--hue-blue); font-size: 9px; margin-left: 2px; vertical-align: super; }
/* 钱:加粗,字色同正文 */
.pl-sumc { display: block; text-align: right; font-weight: var(--fw-semibold); color: var(--text-primary); font-size: 14px; padding: 0 10px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-sumc.empty { color: var(--text-disabled); font-weight: var(--fw-regular); }
.pl-txt { display: block; text-align: left; font-size: 14px; padding: 0 10px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-txt.dim, .pl-area { color: var(--text-muted); }
.pl-txt.empty { color: var(--text-disabled); }
/* §H4 挂栋却没录楼层的池:「(未录)」橙标(园区级池留空,不催补) */
.pl-loc-todo { color: var(--amber-text); font-weight: var(--fw-medium); cursor: help; }
/* 电表格:表号 + 「新表」小签;分摊方式签同款 */
.pl-meter { display: flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 14px; color: var(--text-primary); white-space: nowrap; }
.pl-tag { display: inline-block; flex: none; margin: 0 10px; padding: 0 6px; height: 20px; line-height: 20px; border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.pl-meter .pl-tag { margin: 0; }
/* §I3 起「续行淡显(.pl-dup)」随之作废:楼层/池名称两列已改为逐行取本行电表的真值
   (原册 B/C/D 逐行写),第 2 行起不再是首行的复制品,淡显反而会误导成「这行没数据」。 */

/* 表构成 popover(hover 出列名单:sign±与折入链) */
.pl-mcell { position: relative; }
.pl-mcnt { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); cursor: help; }
.pl-pop { display: none; position: absolute; top: calc(100% - 4px); left: 50%; transform: translateX(-50%); z-index: 20; min-width: 180px; max-width: 300px; padding: 8px 10px; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(28, 28, 28, .16); text-align: left; }
.pl-mcell:hover .pl-pop { display: block; }
.pl-pop-row { font-size: 12px; color: var(--text-secondary); padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-pop-row .sgn { display: inline-block; width: 14px; color: var(--ok-text); font-family: var(--font-mono); }
.pl-pop-row .sgn.neg { color: var(--hue-red); }
.pl-pop-row.link { color: var(--hue-blue); }

/* 分组行兼小计:浅灰底,钱那一格浅蓝混灰;整行可点收起 */
.pl-table tbody tr.pl-grp { cursor: pointer; }
.pl-table tbody tr.pl-grp td { background: var(--surface-card); }
.pl-table tbody tr.pl-grp td.pl-money { background: var(--money-cell-grp); }
/* 分组行的小计数(用量 / 应分摊):次要色、常规字重 —— 比数据行的钱轻一档(03-A) */
.pl-table tbody tr.pl-grp .pl-nv:not(.empty), .pl-table tbody tr.pl-grp .pl-sumc:not(.empty) { font-weight: var(--fw-regular); color: var(--text-secondary); }
.pl-gbtn { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 38px; padding: 0 10px; border: none; background: transparent; cursor: pointer; font-family: var(--font-sans); font-size: 14px; color: var(--text-primary); box-sizing: border-box; }
.pl-gbtn .cv { flex: none; color: var(--text-muted); }
.pl-gbtn .t { font-weight: var(--fw-semibold); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pl-gbtn .n { flex: none; font-size: 12px; color: var(--text-muted); }


/* S21 池参数只读镜像格:值,悬停出 ↗(画布 03-A「↗ 去计费参数」),可点(跳计费参数页);↗ 用 visibility 占住位置,悬停不挤字 */
.pl-pv { cursor: pointer; display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.pl-pv .go { visibility: hidden; font-family: var(--font-sans); font-size: 12px; color: var(--hue-blue); }
.pl-pv:hover .go, .pl-pv:focus-visible .go { visibility: visible; }
/* 抽屉③只读一行:当月分母/加度 + 去参数页改 */
.pl-roparam { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-sunken); font-size: 12px; color: var(--text-secondary); }

.pl-noro { text-align: center; padding: 40px 16px; color: var(--text-disabled); font-size: var(--fs-label); }

/* 合计(sticky bottom;不够 8 行时 .hs-foot 让它跟在最后一行后面)。行高 50、合计数 16(03-A),与 POOL_H.footH 同步 */
.pl-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 50px; font-weight: var(--fw-semibold); background: var(--surface-card); border-top: 2px solid var(--border-strong); color: var(--text-primary); }
.pl-table tfoot th.pl-fix { z-index: 7; }
.pl-table tfoot th.pl-money { background: var(--money-cell); }   /* 合计那一格同数据格(03-A / 04-A / 05-A 取样一致) */
.pl-table.hs-foot tfoot th { bottom: auto; }
.pl-foot-lbl { display: block; padding: 0 10px; text-align: left; font-family: var(--font-sans); font-size: 14px; color: var(--text-primary); }
.pl-foot-v { display: block; text-align: right; padding: 0 10px; font-family: var(--font-mono); font-size: 16px; font-variant-numeric: tabular-nums; color: var(--text-primary); }

/* 顶部常驻名字条(变更 1):sticky 贴着 .fp-dwr-body(抽屉体的滚动容器)顶部,卡片区滚动时留在原地。
   名字文本单行截断(不换行)—— chip 出现/消失只在这一行内挤占水平空间,不会改变整条的高度,
   不给下面的卡片带来位移(LAYOUT-STABILITY-SPEC §1)。 */
.pl-namebar { position: sticky; top: 0; z-index: 2; display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-white); }
.pl-namebar-lbl { font-size: var(--fs-micro); color: var(--text-muted); }
.pl-namebar-row { display: flex; align-items: center; gap: 8px; min-height: 20px; }
.pl-namebar-name { flex: 1; min-width: 0; font-size: var(--fs-h4); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-namebar-name .hi { background: var(--warn-soft); color: var(--amber-text); border-radius: var(--radius-xs); padding: 0 2px; }
/* 提示行常驻(§4.2):min-height 占住一行,内容用 <template v-if> 而不是给这个 div 本身加 v-if —— 撞名/改名提示出现或消失都不会顶动下面的卡片 */
.pl-namehint { min-height: 16px; line-height: 16px; font-size: var(--fs-micro); color: var(--text-muted); }
.pl-namehint.warn { color: var(--amber-text); }
.pl-namehint.bad { color: var(--hue-red); }

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
.pl-txti { width: 100%; box-sizing: border-box; height: 32px; padding: 0 12px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); font-size: 12.5px; background: var(--surface-white); }
.pl-txti:focus { outline: none; border-color: var(--border-control-strong); }
/* 分摊方式分段控件(变更 4):四选一是本抽屉最重要的决定,每档带一句解释,比单选圆点更醒目 */
.pl-methodseg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.pl-methodopt { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 48px; padding: 6px 6px; box-sizing: border-box; text-align: center; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-sunken); cursor: pointer; }
/* 视觉隐藏原生 radio(卡片本身就是可点目标),但保留 1px 尺寸以留在无障碍树/Tab 序列里 */
.pl-methodopt input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.pl-methodopt .t { font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-secondary); }
.pl-methodopt .h { font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.3; }
.pl-methodopt:hover { background: var(--bg-hover); }
.pl-methodopt.on { background: var(--surface-raised); border-color: var(--border-control-strong); box-shadow: var(--shadow-pill); }
.pl-methodopt.on .t { color: var(--text-primary); font-weight: var(--fw-semibold); }
.pl-manual { font-size: 12.5px; color: var(--text-muted); padding: 5px 0; }
.pl-chip { flex: 0 0 auto; font-size: 11px; border-radius: var(--radius-full); padding: 0 7px; background: var(--surface-sunken); color: var(--text-muted); }
.pl-chip.infra { background: var(--caution-soft); color: var(--caution-text); }
.pl-chip.warn { background: var(--warn-soft); color: var(--amber-text); }
.pl-chip.ok { background: var(--ok-soft); color: var(--ok-text); }
.pl-chip.bad { background: var(--danger-soft); color: var(--hue-red); }
/* §G4 待补定位的池:抽屉里把楼栋/楼层/侧向三格圈出来(期区不算定位格) */
.pl-loc-hi > :nth-child(n+2) { outline: 1px solid rgb(245, 158, 11); outline-offset: 2px; border-radius: var(--radius-sm); }
.pl-chip.gone { background: var(--danger-soft); color: var(--hue-red); }
.pl-chip.nodate { background: var(--warn-soft); color: var(--amber-text); cursor: help; }
/* 受益人楼层:蓝=解析到层;未定层=红底醒目(它们会被合摊成 1 份,是漏摊的源头) */
.pl-chip.floor { background: var(--accent-blue); color: var(--hue-blue); cursor: help; }
.pl-chip.nofloor { background: var(--danger-soft); color: var(--hue-red); font-weight: var(--fw-medium); cursor: help; }
/* 受益人列头 + 行内份额输入(与月度参数 pl-ni 同款透明格) */
.pl-bindhdr { display: flex; align-items: center; gap: 8px; padding: 0 4px 4px; border-bottom: 1px dashed var(--border-subtle); font-size: var(--fs-micro); color: var(--text-muted); }
.pl-bindhdr .nm { flex: 1; }
.pl-bindhdr .wt { flex: 0 0 64px; text-align: right; cursor: help; text-decoration: underline dotted; }
.pl-wi { flex: 0 0 64px; box-sizing: border-box; border: 1px solid var(--border-control); background: var(--surface-white); text-align: right; font-size: 12px; padding: 2px 6px; outline: none; color: var(--text-primary); font-family: var(--font-mono); border-radius: var(--radius-sm); }
.pl-wi:focus { border-color: var(--hue-blue); }
.pl-wi:disabled { border-color: transparent; background: transparent; }
.pl-wi::-webkit-outer-spin-button, .pl-wi::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pl-wi::placeholder { color: var(--text-disabled); }
.pl-innerwarn { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--caution-soft); color: var(--caution-text); font-size: 11.5px; }
/* 常驻一行:18px 文字行 + 上下 7px padding = 32px(border-box);无内容时只留位置不显黄底 */
.pl-nodatewarn { min-height: 32px; line-height: 18px; font-size: var(--fs-micro); }
.pl-nodatewarn.blank { background: transparent; }
.pl-more { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; border: none; background: transparent; color: var(--hue-blue); font-size: 12px; cursor: pointer; padding: 0; }
.pl-otherbox { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--border-subtle); padding-top: 8px; }
.pl-directpick { display: flex; align-items: center; gap: 8px; }
.pl-directpick .lbl { flex: 0 0 auto; font-size: 12px; color: var(--text-secondary); }
.pl-chkline { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.pl-bindhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pl-bindq { height: 28px; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-full); font-size: 12px; }
.pl-bindq:focus { outline: none; border-color: var(--hue-blue); }
.pl-bindlist { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; }
.pl-bindlist.tall { max-height: 240px; }
.pl-bindrow { display: flex; align-items: center; gap: 8px; padding: 5px 4px; font-size: 12.5px; cursor: pointer; border-radius: var(--radius-sm); }
.pl-bindrow:hover { background: var(--bg-hover); }
.pl-bindrow.gone .nm { color: var(--text-disabled); text-decoration: line-through; }
/* 本月已拆 / 停用 / 不在册的表:池引擎不算它,名字压成次要色(不划线 —— 它没从池里删,只是这个月不计) */
.pl-bindrow.off .nm { color: var(--text-muted); font-weight: var(--fw-regular); }
.pl-bindrow .nm { font-weight: var(--fw-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-bindrow .meta { flex: 1; color: var(--text-muted); font-size: var(--fs-micro); overflow: hidden; text-overflow: ellipsis; }
.pl-bindempty { text-align: center; color: var(--text-disabled); font-size: var(--fs-label); padding: 12px 0; }
/* 原来这颗钮只显 +1 / −1,不悬停不知道是加还是扣(2026-09-23 屏上文案复查)。改成写字之后
   不再是等宽数字,去掉 mono;宽度随字走,所以不设固定宽 */
.pl-sign { flex: 0 0 auto; border: 1px solid var(--border-subtle); background: var(--ok-soft); color: var(--ok-text); font-size: 11.5px; border-radius: var(--radius-full); padding: 1px 9px; cursor: pointer; white-space: nowrap; }
.pl-sign.neg { background: var(--danger-soft); color: var(--hue-red); }
.pl-linkrow { display: flex; align-items: center; gap: 8px; }
.pl-iconbtn { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; }
.pl-iconbtn:hover { background: var(--bg-hover); color: var(--text-primary); }
.pl-iconbtn.danger:hover { background: var(--danger-soft); color: var(--hue-red); }
</style>
