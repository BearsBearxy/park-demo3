<script setup lang="ts">
// 催缴单屏 v2(S4-BILL-NOTICE-SPEC §7 S4-4 v2 拍板):一个租户一条(该户全部单据合并,
// 对齐 Excel 每租户一张 worksheet);一期/二期/三期分 tab(期归属=在租合同楼栋 phase→premise 前缀→兜底一期);
// 屏上不显收款主体/单据类/状态(引擎照旧拆单落库,只是 UI 聚合);签发/作废本轮撤下(api 端点保留)。
// 明细抽屉两 tab:场地租金(S5 刀4:fee_group='rent' 落库行,厂房/办公室/宿舍逐间块+面积拆解+折算式备注)在前、
// 水电费(全单明细合并,沿用 premise 分带小计+取价审计链悬浮)在后;
// 改造三:维护费块公摊按纸单合并成一行(五项,多池加总,构成进费项名悬浮),金额一分不改。
// 列表照 PoolLedgerView 手法(sticky 表头/40px 行(M↓ 34)/tfoot 钉底/zone Segmented)+LIST-PAGE-SPEC 列宽铁律;
// 账外户(offbook)整行降淡。写操作 admin(viewer 隐藏),GET 全员。
import { computed, h, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import { useRoute, useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import { useTabsStore } from '@/stores/tabs'
import {
  billNoticesApi, type BillNoteOverrideDTO, type BillNoticeDTO, type BillNoticeDetailDTO, type BillNoticeLineDTO,
} from '@/api/billNotices'
import { paramsApi, type ParamStatusDTO } from '@/api/params'
import { staleText, staleTitle, staleWho } from '@/utils/paramCenterLogic'
import { contractApi } from '@/api/contract'
import { PROPERTY_TYPE_LABEL, type ContractDTO, type PropertyType } from '@/types/contract'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import {
  aggregateByTenant, auditTitle, billFeeLabel, billFeeTitle, billQtyCell, crossBuildingMark, dormPriceCells,
  groupByBuilding, groupDormExcelStyle, groupExcelStyle, groupRentByPremise, lineNoteKey, mergeMaintRows,
  mergeNoteKey, noteDisplay, noteKeyId, rentAreaText,
  rentByTenant, rentFeeName, resolvePhase, segLabel, tenantBuildings, tenantKpis,
  buildNoticeAlertGroups, warnSummaryLines, warnGroupsOf, warnHead, inTab, tenantTabCounts, NOTICE_TABS,
  type NoticeTab,
  type CrossMark, type NoteKey, type NoticeAlert, type QtyCell, type ShareMergeRow,
  type TenantBuildings, type TenantNoticeRow,
} from '@/utils/billNoticeLogic'
import { useAuthStore, approxDirty } from '@/stores/auth'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'
import { useChainDeepPeriod } from '@/composables/useDeepPeriod'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { chainStepsOf, noticeYmOf } from '@/nav/billingChain'
import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPElevChip from '@/components/fp/FPElevChip.vue'
import FPStat from '@/components/fp/FPStat.vue'
import FPMoreMenu from '@/components/fp/FPMoreMenu.vue'
import { useViewport } from '@/composables/useViewport'
import { textW } from '@/composables/useWideTable'
import { useTopBarAction } from '@/composables/useTopBarAction'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPMark from '@/components/fp/FPMark.vue'
import FPTableTools from '@/components/fp/FPTableTools.vue'
import Popover from '@/components/ds/Popover.vue'
import { ask } from '@/utils/ask'
import { receipt } from '@/utils/receipt'
import CoefBookWindow from './CoefBookWindow.vue'
// ── S20 交付链:收款公司/收款簿/两个导出窗口 + 抽屉方格 + 状态流 ──
import CompanyBookWindow from './CompanyBookWindow.vue'
import PayBookWindow from './PayBookWindow.vue'
import ExportNoticeWindow from './ExportNoticeWindow.vue'
import { lackText } from '@/composables/useViewGate'
import ExportReconWindow from './ExportReconWindow.vue'
import PaySlotGrid from '@/components/fp/PaySlotGrid.vue'
import FPToast from '@/components/fp/FPToast.vue'
import { billDeliveryApi, companyBookApi, type CompanyFullDTO } from '@/api/billDelivery'
import { billsApi } from '@/api/bills'
import {
  GAP_TIP, buildSlotCells, gapWord, slotAmounts, tenantStatus,
  type ExportNoticeReq, type ExportReconReq, type SlotCell, type TenantStatus,
} from '@/utils/payBookLogic'
import {
  exportNoticeZip, exportReconWorkbook, exportTenantNotice,
  type CompanyAccount, type Company as ExcelCompany, type NoticeExportItem, type ReconRow,
} from '@/utils/billNoticeExcel'

const auth = useAuthStore()
// RBAC:本屏两类写权分开 —— 派生(生成/备注)归 billing-run,对外闸门(确认/收款槽)归 billing-issue
const mayRun = computed(() => auth.can('billing-run:edit'))
const mayIssue = computed(() => auth.can('billing-issue:edit'))
// EDIT-MODE-SPEC v2 §1:浏览态完全只读——重新生成(覆盖整月)、确认(不可逆单向流转)、批量、
// 抽屉里的备注改写与收款公司指定,全部收进编辑态;导出/筛选/切期/展开是只读操作,不受管。
// canRun / canIssue = 有对应权限 且 在编辑态,凡写入口与写函数守卫一律走它(漏一个就是裸写入口)。
// 编辑模式 + 提权入口(EDIT-MODE-SPEC v3 / ELEVATION-SPEC):无权限的账号也看得到按钮,
// 点了弹主管授权窗;切页签不再回浏览态(只关浮层)。
// 审核键(§7.1)。与现有 draft→confirmed→exported(主管业务确认,V94)是两条轴,都保留 ——
// 动作簇画的是审核那条,别拿单据状态去推它。
// 本屏的上游前置是 alloc + alloc-loss(后端 UPSTREAM),所以「通过」最容易吃 409;
// 前端不预判(铁律 7),按钮照画,准话由组件里那份 409/403 分流弹出来。
/** 弹卡标题的人话名。前端没有 kind→人话名映射表,各屏自己拼(新开一份 = 后端 ReviewKind 的第二份)。 */
const reviewLabel = computed(() => `催缴单 · ${noticeYm.value}`)
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken, reviewNote, reviewTip, reviewKeys } =
  useEditMode(['billing-run:edit', 'billing-issue:edit'], {
    scope: () => S.billNotices(year.value, month.value),
    // 审核键(§7.1)。与现有 draft→confirmed→exported(主管业务确认,V94)是两条轴,都保留。
    // 催缴单键按催缴单月(收费月)记;月锁仍是链月(抄表月)那一把,与另外四屏同占
    reviewKey: () => (noticeYm.value ? `bill-notices:${noticeYm.value}` : null),
    // 惰性求值,引用下面才声明的 noteEditKey 没有 TDZ(同 useChainDeepPeriod 那一处)
    dirty: approxDirty(() => (noteEditKey.value != null ? 1 : 0)),
  })
const canRun = computed(() => mayRun.value && editMode.value)
const canIssue = computed(() => mayIssue.value && editMode.value)
// 编辑态不跨会话(spec §1):切走页签回来即回浏览态
// 徽标浮层在抽屉里,抽屉 Teleport 到 body;flashTid 一起清:KeepAlive 停用时动画只发 cancel,类留着的话切回来那一户会无端再闪
onDeactivated(() => { asking.value = null; openWarn.value = ''; flashTid.value = null })

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmt2 = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
const r2 = (v: number) => Math.round(v * 100) / 100

// ── 账期:出账链组级(stores/billingPeriod,2026-08-28 设计稿 §3.1) ──
// 顶栏那对年月 Select 已撤 —— 期由出账月矩阵一处选定,五屏共读一份,不可能再各落各的
// (它们抢的本来就是同一把 billing-chain 月锁)。「默认账期」那一整套
// (xxxApi.years() + /months + latestPeriodOf 的 snap)随之退场:期一定是用户在矩阵上点出来的,
// 没有「系统替你猜一个月」这回事 —— 那正是 §7-1 禁的「顺手落进某个期」。
const period = useBillingPeriodStore()
const year = computed(() => period.year ?? 0)
const month = computed(() => period.month ?? 0)
const ym = computed(() => period.ym ?? '')
// 本屏的月 = 催缴单月(收费月)= 链月 +1(billingChain「催缴单的月份」):9 月的单 = 8 月水电 + 9 月租金。
// 单、审核键、确认 / 导出 / 备注、在租合同都按 noticeYm;ym 仍是链月 = 单上水电的月份,
// 月锁、参数状态、系数簿、去重算都按它。
const noticeYm = computed(() => (period.ym ? noticeYmOf(period.ym) : ''))
const noticeYear = computed(() => +noticeYm.value.slice(0, 4))
const noticeMonth = computed(() => +noticeYm.value.slice(5, 7))
// 链路条:本月各道工序走到哪(与矩阵格子同一份数据)
const chainSteps = computed(() => chainStepsOf(period.cellOf(ym.value)))
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM(或旧 ?ym=)直落该月,pick + loadChain。
// 本屏唯一的草稿是行内备注编辑(noteEditKey 非空 = 有一处没提交);切回时有草稿 → 不切期,只在 deepNote 里说。
// dirty 是惰性求值:首跑不查(全新实例没有草稿),所以引用下面才声明的 noteEditKey 没有 TDZ 问题。
// 必须在下面的 onReactivated / onMounted / watch(ym) 之前调用:切回时先改期,状态刷新才读到新月。
const { note: deepNote } = useChainDeepPeriod(() => (noteEditKey.value != null ? 1 : 0), true)

// ── 数据:催缴单 + 当月在租合同(期归属/月租金参考用,取月中 15 日)同拉;竞态守卫 ──
const rows = ref<BillNoticeDTO[] | null>(null)
const contracts = ref<ContractDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
// 水电月(ym)15 日在租的合同。收费月(noticeYm)已不在租的户 —— 8 月底退租,9 月的单上只剩 8 月水电 ——
// 靠它归期、归楼栋,否则整户掉进「未归楼栋」;系数簿按水电月取参数,名册也用它(与改口径前同一份)。
const utilContracts = ref<ContractDTO[]>([])
const status = ref<ParamStatusDTO | null>(null)   // S21:计费参数状态(参数晚于本月批次 → stale 条)
let seq = 0
/**
 * 换期重取。**不清空 rows** —— 旧表留到新数据落位（加载态设计稿 §06 第一档）。
 * 但留着不等于可以装作无事发生：`veil` 一亮，旧内容退让并**停止接受交互**，
 * 顶边那条进度线是「正在重取」的唯一信号。
 */
const busy = ref(false)
/** 催缴单列表没读到。只在成功分支清;有它时写入口全关(生成 / 编辑模式) */
const loadErr = ref('')
/** 熬过 200ms 才亮 —— 本地后端常几十毫秒回来，闪一下比不显示更晃眼 */
const veil = useDeferredFlag(busy)

async function loadMonth() {
  const my = ++seq
  busy.value = true
  try {
    const [ns, cs, us, st] = await Promise.all([
      billNoticesApi.list(noticeYm.value),
      contractApi.list(`${noticeYm.value}-15`).catch(() => [] as ContractDTO[]),
      contractApi.list(`${ym.value}-15`).catch(() => [] as ContractDTO[]),
      paramsApi.status(ym.value).catch(() => null),
    ])
    if (my !== seq) return
    rows.value = ns
    contracts.value = cs
    utilContracts.value = us
    status.value = st
    loadErr.value = ''
  } catch (e) {
    if (my !== seq) return
    rows.value = []          // 不留上个月的单在屏上冒充这个月
    loadErr.value = errMsg(e, '服务异常')
  } finally {
    // ⚠ 只有最新那一趟才有资格熄灯:被顶掉的旧请求先返回时若把 busy 清了,
    //   新请求还在路上,退让却已经撤掉 —— 用户会以为数据到了。
    if (my === seq) busy.value = false
  }
}
// v-else 分支里 rows 恒非空(失败分支也落成 []),模板里的类型收窄跨不过 v-else,统一走 list
const list = computed(() => rows.value ?? [])
/** 本月没有单(不是没读到):内容区空状态(画布 05-B;标题旁不贴标签,图上没有) */
const noRows = computed(() => !loadErr.value && list.value.length === 0)
const staleMsg = computed(() => staleText(status.value, 'bill'))
// 深链协议:KeepAlive 缓存实例只在 setup 消费 query,必须 openFresh
const router = useRouter()
const tabs = useTabsStore()
// edit=1:[去重算] 落地直接进编辑态(参数页的重算按钮只在编辑态出)
function gotoParams() {
  tabs.openFresh('params', { pin: true })
  router.push({ path: '/params', query: { ym: ym.value, edit: '1' } })
}

// ── 屏级告警:常驻 chip + 右侧抽屉(LAYOUT-STABILITY-SPEC §6,2026-08-25) ──
// 原来这条「本屏为旧快照」是页头的橙色流内条,顶动下面整张表且只要没重算就永远挂着;
// 现在收进抽屉,工具条上只留一枚位置固定的 chip(无告警时 quiet 态仍渲染)。判定逻辑不动(staleText)。
const alertOpen = ref(false)
// 时间格式同 staleText 的 MM-DD HH:mm('YYYY-MM-DDTHH:mm:ss' → 'MM-DD HH:mm')
const lastChangeText = computed(() => (status.value?.lastChangeAt ?? '').slice(5, 16).replace('T', ' '))
// 组名 / 主语跟来源走(参数 / 抄表,METER-TIMELINE-SPEC §5),三屏同一组函数
const alertGroups = computed<AlertGroup[]>(() => staleMsg.value ? [{
  key: 'stale',
  title: staleTitle(status.value),
  desc: `${staleWho(status.value)}在 ${noticeMonth.value} 月催缴单生成之后又改过(单上是 ${month.value} 月的水电)—— 单上的金额还是改之前算的。`
    + '去计费参数页「重算本月」重出一遍(池核算 → 楼栋损耗 → 催缴单一起走),已确认 / 已导出的户会自动跳过、金额照旧。',
  items: lastChangeText.value ? [{ text: `最近一次改动 ${lastChangeText.value}` }] : [],
  action: {
    label: '去计费参数页重算',
    icon: 'refresh-cw',
    run: () => { alertOpen.value = false; gotoParams() },
  },
}] : [])

// 告警组:stale 一组(屏级) + buildNoticeAlertGroups 按 code 分出来的若干组(当前期别全部户)。
// 分组是纯函数(billNoticeLogic),.vue 里不再转一层 —— 那样单测就盯不住分组逻辑了。
// drawer:false 的类别不进这里(§6-3 只报不给动作的不许进来),它的落点是列表警告格与明细徽标。
const noticeAlertGroups = computed<AlertGroup[]>(() =>
  buildNoticeAlertGroups(phaseRows.value).map(g => ({
    key: g.key, title: g.title, desc: g.desc, tone: g.tone,
    items: g.items.map(it => ({ text: it.text, hint: it.hint, onClick: () => focusRow(it.tenantId) })),
    action: { label: g.actionLabel, icon: 'arrow-right', run: () => { alertOpen.value = false; router.push(`/${g.route}`) } },
  })))
const allAlertGroups = computed<AlertGroup[]>(() => [...alertGroups.value, ...noticeAlertGroups.value])
// FPAlertChip 的口径全站钉死 = Σ 各组 items.length,**无 items 的组按 1 计**。
// 那个 `|| 1` 不能省:stale 组在 lastChangeText 为空时 items 就是空数组,而 FPAlertPanel 对空 items
// 的组照样渲染组头与 desc —— 不兜底就会出现「抽屉里有东西、chip 显示无待处理」。
const alertCount = computed(() => allAlertGroups.value.reduce((n, g) => n + (g.items.length || 1), 0))

// 警告格的悬停说明:一类一行(块头 + 条目,判据与单测在 billNoticeLogic.ts)+ 收款缺口;时效句只跟告警走(缺口是实时的)
const warnTip = (alerts: NoticeAlert[], gap: boolean) => ({
  text: [warnSummaryLines(alerts), gap ? `缺收款公司:${GAP_TIP}` : ''].filter(Boolean).join('\n'),
  sub: alerts.length ? WARN_WHEN : undefined,
})
// 警告格写「首类 +N」,收款缺口算一类:有告警时进 +N,没告警时它自己就是那一格(● 缺收款公司)
const warnCell = (r: DisplayRow) => {
  const w = warnHead(r.alerts)
  return w ? { title: w.title, more: w.more + (r.gap ? 1 : 0) } : null
}

// 跳行并闪:行可能被页签 / 搜索筛掉、或在收起的组里 —— 先让它露出来再找
const wrapEl = ref<HTMLElement | null>(null)
const flashTid = ref<number | null>(null)
async function focusRow(tid: number) {
  alertOpen.value = false
  const r = phaseRows.value.find(x => x.tenantId === tid)
  if (!r) return
  if (!filtered.value.includes(r)) { tab.value = 'all'; q.value = ''; warnOnly.value = false }
  const k = r.bld.main?.id ?? 'none'
  if (collapsed.value.has(k)) collapsed.value = new Set([...collapsed.value].filter(x => x !== k))
  flashTid.value = null
  await nextTick()
  wrapEl.value?.querySelector(`tr[data-tid="${tid}"]`)?.scrollIntoView?.({ block: 'center' })
  flashTid.value = tid
}
function unflash(e: AnimationEvent) {
  // 只认本行 td 自己的那段动画(格子里别的动画结束也会冒泡上来)
  if ((e.target as HTMLElement).parentElement === e.currentTarget) flashTid.value = null
}
// 页签切回:参数页那边可能刚重算过 —— 批次时间变了就整月重拉(单与 stale 条一起变新),没变只刷状态
// (回包前若已换月(seq 变了)就丢弃,别让旧月 status 盖住新月的 stale 条)
onReactivated(async () => {
  if (!period.picked) return   // 还没选期(主区是选期矩阵):ym 是 '',后端按格式校验直接 400
  const my = seq, before = status.value?.billBatchAt
  const st = await paramsApi.status(ym.value).catch(() => null)
  if (my !== seq || !st) return
  if (st.billBatchAt !== before) loadMonth()
  else status.value = st
})
onMounted(() => {
  buildingApi.list().then(bs => { buildings.value = bs }).catch(() => { /* 楼栋失败按 premise 回退归期 */ })
  loadCompanies(); loadPayMap()   // S20:收款公司与映射(状态列橙点与抽屉方格用)
  if (period.picked) loadMonth()
})
watch(ym, () => { if (period.picked) loadMonth() })

// ── 一户一条聚合 + 期归属 + 月租金(参考) ──
const bById = computed(() => new Map(buildings.value.map(b => [b.id, b])))
const byTenant = (cs: ContractDTO[]) => {
  const m = new Map<number, ContractDTO[]>()
  for (const c of cs) {
    const a = m.get(c.tenantId)
    if (a) a.push(c); else m.set(c.tenantId, [c])
  }
  return m
}
// 归期 / 归楼栋用的合同:收费月在租的优先;收费月一份都没有的户退回水电月的(见 utilContracts)
const placeContracts = computed(() => {
  const has = new Set(contracts.value.map(c => c.tenantId))
  return [...contracts.value, ...utilContracts.value.filter(c => !has.has(c.tenantId))]
})
const placeByTenant = computed(() => byTenant(placeContracts.value))
const rentMap = computed(() => rentByTenant(contracts.value))
interface DisplayRow extends TenantNoticeRow {
  rent: number | null; phase: 1 | 2 | 3
  st: TenantStatus; gap: boolean  // 户级状态 / 收款缺口(statusOf / gapOf 同一判据)
  bld: TenantBuildings          // 改造二:主楼栋(归组用)+全部楼栋
  mark: CrossMark | null        // 跨楼栋轻标记(单栋户 null)
}
const tenantRows = computed<DisplayRow[]>(() => aggregateByTenant(rows.value ?? []).map(t => {
  const cs = placeByTenant.value.get(t.tenantId) ?? []
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
    st: statusOf(t.tenantId),
    gap: gapOf(t.tenantId),
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

// ── 筛选:状态页签(桌面)/ 仅看有警告(窄档筛选面板)/ 租户搜索 ──
const tab = ref<NoticeTab>('all')
const tabCounts = computed(() => tenantTabCounts(phaseRows.value))
const TAB_LABEL: Record<NoticeTab, string> = {
  all: '全部', todo: '待核对', confirmed: '已确认', exported: '已导出', warned: '有警告',
}
// 「字 + 灰色计数」(规范 §1.9);计数随当前期。
// ⚠ 走 icon 位不走 label:Segmented 的类型写着 label 收 VNode,模板却是 {{ it.label }} 插值,
//   传 VNode 会 JSON.stringify 一个环形对象直接渲染崩(实测)。icon 位是 <component :is>,收 VNode。
const tabOpts = computed(() => NOTICE_TABS.map(t => ({
  value: t, label: '',
  icon: h('span', [TAB_LABEL[t], ' ', h('span', { class: 'bn-tabn' }, String(tabCounts.value[t]))]),
})))
const warnOnly = ref(false)
const q = ref('')

// ── 窄档形态(RESPONSIVE-LAYOUT-SPEC §5.7 屏顶 KPI 卡行 / §5.10 屏标题行+筛选行)──────
// 档位判定走 useViewport 而不是媒体查询:这一轮收的是**渲染哪一支**(屏名不进 DOM、七个入口
// 收成一颗「⋯」),@media 只能藏,藏了那一行照样占着 DOM 与高度。
// jsdom 无 matchMedia → tier 恒 'xl',宽档分支与既有桌面测试一个字不动(§9 零差异)。
//
// **两个判据各管一件事,不是同一件事的两种写法**(上一轮两套混用,读的人分不清哪处管哪档):
//   narrow(M↓,≤960)=「这块东西在平板上就已经放不下了」。§5.10「M 档」小节的原话是
//                     「走同一套,只有一处不同」,所以屏名 / 期段控 / 筛选行 / 五个只读入口 /
//                     批量确认这些**收进哪里**的判断,M 与 S 同判,一律走 narrow。
//   isS  (S 档,≤600)=「只有手机外壳才有的那一支」。今天只剩一件事归它:主动作能不能交给
//                     手机顶栏 —— 见下面 useTopBarAction 上方那段「M 档看不见手机顶栏」。
const { tier } = useViewport()
const isS = computed(() => tier.value === 's')
// §5.10 判据四「外壳已经说过的,流内不再说一遍」:顶栏 52px 已经写着「催缴单」,
// 所以屏名在 S 与 M 两档都不画(§5.10「M 档」那段明文:屏名在 M 档同样不画)。
const narrow = computed(() => tier.value === 's' || tier.value === 'm')

// ── §5.10 动作 →「顶栏右:1 个主动作」(S 档) ───────────────────────────────────
// 主动作 = 编辑模式(判据与另外六个入口的去处见 moreItems 上方那段)。
// 不必判档:顶栏只在 S 档挂载,别档登记是空转;卸载 / KeepAlive 停用的清场由 composable 管。
// 三种「点不动」的时刻不登记 —— 顶栏画一颗按不动的按钮是白占一个位(顶栏总共四个位):
//   canEnter 假(只读账号 / 园区股东):桌面上这颗按钮本来就不画;
//   reviewNote 非空(已审核 / 待审核):桌面上按钮位换成禁用药丸,而审核簇(FPReviewActions)
//   就在标题行上写着同一件事 —— 判据四,外壳/行上已经说过的不再说第二遍。
useTopBarAction(() => {
  if (!canEnter.value || reviewNote.value) return null
  // ⚠ label 是这颗按钮的**无障碍名**,必须是动作名,不能写状态句。
  //   曾写成「张三 编辑中」—— 念出来是个状态,而点下去是去抢锁,名实不符;
  //   而且同一个顶栏动作位上,抄表屏写的是动作名,两屏各一套约定(2026-09-21 对抗复查抓到)。
  //   锁被别人占着这件事**不丢**:点下去 toggleEdit() 会走 FPLockDialogs 把占用人与空闲分钟说清楚,
  //   与抄表屏同口径。代价是 S 档「不用点就知道锁在谁手上」这条没了 —— 顶栏这个位只有
  //   {label, icon, onClick} 三件,表达不了「画出来但按不动」。真要它得给 TopBarAction 补 disabled。
  return {
    label: editMode.value ? '完成' : '编辑模式',
    icon: iconFor(editMode.value ? 'check' : 'pencil'),
    onClick: () => toggleEdit(),
  }
})
// §5.10 筛选一行:本屏筛选控件 3 件(期段控 + 仅看有警告 + 搜租户名)> 2 ⇒ 收。
// 留外面的是输入即用的搜索,收进面板的是反正都要点开的选择器。
const filterOpen = ref(false)
// 拖宽 / 拖窄窗口时不留够不着的面板,也不留看不见的筛选(页签只在桌面、「仅看有警告」只在窄档)
watch(narrow, v => {
  if (v) tab.value = 'all'
  else { filterOpen.value = false; warnOnly.value = false }
})
// 钮上常写当前期:期决定整张表看的是哪一期,藏进面板等于不知道自己在哪(§5.10「状态藏了等于没有」)。
// 计数只数**非默认**的那几件 —— 期恒有一个选中值,算进去会恒为 1,那个数就不带信息了。
const filterCount = computed(() => (warnOnly.value ? 1 : 0))
const phaseLabel = computed(() => PHASE_OPTS.find(o => o.value === phase.value)?.label ?? '')
const filtered = computed(() => phaseRows.value.filter(r =>
  inTab(r, tab.value)
  && (!warnOnly.value || r.alerts.length > 0)
  && (q.value.trim() === '' || (r.tenantName ?? '').includes(q.value.trim()))))
// 改造二:期 tab 内按主楼栋分组(入参=筛选后的行 → 搜索/仅看警告/换期自动重算,空组不出现)
const groups = computed(() => groupByBuilding(filtered.value, r => r.bld.main))
// 分组行兼小计(画布 05-A):点组头收起。默认全展开,收起不记忆(规范 §2-25)
const collapsed = ref(new Set<number | 'none'>())
const gKey = (g: { id: number | null }) => g.id ?? 'none'
function toggleGroup(g: { id: number | null }) {
  flashTid.value = null   // 收起时那一行被摘掉,动画的 end / cancel 都不会来;不清的话再展开会无端再闪一次
  const k = gKey(g), s = new Set(collapsed.value)
  if (!s.delete(k)) s.add(k)
  collapsed.value = s
}
const groupRent = (g: { rows: DisplayRow[] }) => r2(g.rows.reduce((s, r) => s + (r.rent ?? 0), 0))
const footTotal = computed(() => filtered.value.reduce((s, r) => s + (r.totalAmount ?? 0), 0))
const footRent = computed(() => filtered.value.reduce((s, r) => s + (r.rent ?? 0), 0))

// ── 系数簿窗口(S14):批量改系数;人人可打开只读查看(窗口内编辑模式自查 param-policy:edit) ──
// ?coef=1(计费参数页的「系数簿」按钮)——本屏此前从不读 route,那个按钮从 b6ff7e6 起
// 一直只是跳过来、窗口不开。账期由 useChainDeepPeriod 认(?p= 与旧 ?ym=,§4.2),落进五屏共读的组级期;本行只读 coef。
const coefOpen = ref(useRoute().query.coef === '1')

// ── S20 交付链:三个新窗口 + 户级状态/收款缺口(状态单据级存储、户级展示) ──
const companyOpen = ref(false)
const payBookOpen = ref(false)
const expNoticeOpen = ref(false)
// 通知单上印收款账号,账号明文只给「主数据」查看权(RBAC v3,服务端对别人打码)。没有就不让导 ——
// 导出来是 ****1234,而这张单是要发给租户的。批量导出与单户导出同判。
const noAcct = computed(() => !auth.can('master:view'))
const noAcctTip = computed(() => (noAcct.value ? `印收款账号${lackText(['master:view'])}` : ''))
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
// ⚠ 抽屉里用 statusOf(tid) 而不是 dlgRow.st:dlgRow 是打开那一刻的快照,确认完它不会跟着变
const statusOf = (tid: number): TenantStatus => tenantStatus(noticesByTenant.value.get(tid) ?? [])
// 收款缺口:该户任一单 pay_company_id 为空(提示不阻断,确认后橙点保留)
const gapOf = (tid: number) => (noticesByTenant.value.get(tid) ?? []).some(n => n.payCompanyId == null)
const ST_LABEL: Record<TenantStatus, string> = {
  draft: '待核对', partial: '部分确认', confirmed: '已确认', exported: '已导出',
}

const bulk = computed(() => canIssue.value && bulkMode.value)
function exitBulk() { bulkMode.value = false; selected.value = new Set() }

// 主表「位置」列(列宽铁律,2026-10-02):放得下时按本月全部位置串定宽,余宽落进行末空列;
// 放不下时(定宽列 + 位置最长串 > 表格区宽)回到原排法 —— 位置吸收剩余、省略号 + 悬停看全文,空列 0 宽,
// 窄档照旧由 M↓ 的 min-width:980 兜底横滚。按 tenantRows(整月全部户)算:换页签、搜索列不挪位。
const BN_FIXED = 220 + 130 * 3 + 210   // 与下方 colgroup 同源:租户 + 合计/月租/状态 + 警告(勾选列另算 36)
const locWant = computed(() => textW(['位置', ...tenantRows.value.map(r => r.premiseText || '–')], 14, 16))
const wrapW = ref(0)
let wrapRo: ResizeObserver | null = null
watch(wrapEl, el => {
  wrapRo?.disconnect(); wrapRo = null
  if (!el || typeof ResizeObserver === 'undefined') return
  wrapRo = new ResizeObserver(() => { wrapW.value = el.clientWidth })
  wrapRo.observe(el)
})
onBeforeUnmount(() => wrapRo?.disconnect())
const locTight = computed(() => wrapW.value > 0 && wrapW.value - BN_FIXED - (bulk.value ? 36 : 0) < locWant.value)
// 换期/换月自动退出:选中集是 tenantId,切走后残留项不可见但仍在集里,再点「确认选中」会误伤
// 退出编辑态同理:选择态是编辑态的产物,留着回浏览态会有"看不见的选中"
watch([phase, year, month], exitBulk)
// 兄弟们(startNoteEdit/restoreNote)都判了 canRun,备注编辑行本身也得随编辑态收起 ——
// 否则已展开的那一行在编辑态就地转假(接管/提权到期)后继续留在抽屉里可写。
watch(editMode, v => { if (!v) { exitBulk(); noteEditKey.value = null } })
// 已确认 / 已导出的户勾选框禁用并淡显,「全选待核对」只选能确认的
const canPick = (r: DisplayRow) => inTab(r, 'todo')
const picked = computed(() => filtered.value.filter(r => selected.value.has(r.tenantId)))
const selCount = computed(() => picked.value.length)
const selGaps = computed(() => picked.value.filter(r => r.gap).length)
const pickable = computed(() => filtered.value.filter(canPick))
const allChecked = computed(() => pickable.value.length > 0 && pickable.value.every(r => selected.value.has(r.tenantId)))
function toggleAll() {
  const on = !allChecked.value
  for (const r of pickable.value) { if (on) selected.value.add(r.tenantId); else selected.value.delete(r.tenantId) }
  selected.value = new Set(selected.value)
}
function toggleOne(r: DisplayRow) {
  if (!canPick(r)) return
  if (selected.value.has(r.tenantId)) selected.value.delete(r.tenantId); else selected.value.add(r.tenantId)
  selected.value = new Set(selected.value)
}

// 确认:未设收款公司只提示不阻断(§2.2);单向流转,已确认/已导出户重新生成自动跳过
async function confirmTenants(tids: number[]) {
  if (!canIssue.value || confirming.value || !tids.length) return
  const gaps = tids.filter(gapOf)
  const body: string[] = []
  // §5.11「不可逆动作不要只靠菜单里一行字」:窄档的「批量确认」现在是「⋯」里的一行字,
  // 点进去勾几户再点一下就单向流转了。多户那一路补一句写明代价的二次确认。
  // **单户不加**(行内那颗「确认」钮):那一户就在手指底下、名字在同一行上,
  // 106 行一行一个弹窗是把确认变成肌肉记忆 —— 加了等于没加。
  if (tids.length > 1) body.push('确认后重新生成会跳过这几户;要反悔得在明细里逐户取消确认。')
  if (gaps.length) {
    const names = gaps.slice(0, 5)
      .map(t => filtered.value.find(r => r.tenantId === t)?.tenantName ?? '#' + t).join('、')
    body.push(`${gapWord(gaps.length)}(${names}${gaps.length > 5 ? ' 等' : ''}):导出的通知单上这部分不印收款账户;`
      + '设好归属后要重新生成本月催缴单才会拆单。')
  }
  if (body.length && !await ask({
    title: `确认 ${tids.length} 户的催缴单？`, body: body.join(''), action: `确认 ${tids.length} 户`,
  })) return
  if (!canIssue.value || confirming.value) return   // 弹窗开着时编辑态可能被接管
  confirming.value = true
  try {
    const res = await billDeliveryApi.confirm(noticeYm.value, tids)
    receipt.ok(`已确认 ${res.confirmed} 单${res.skipped ? `,跳过 ${res.skipped} 单(已确认/已作废)` : ''}`)
    exitBulk()
    await loadMonth()
  } catch (e) { receipt.fail(errMsg(e, '确认失败')) } finally { confirming.value = false }
}

// 取消确认(2026-09-23):confirmed → draft。只做单户 —— 这是「点错了」的补救,
// 不是一个批量工序;做成批量等于给「全部退回重来」开一个入口。
// 理由必填(后端 @NotBlank 也拦一道):撤的是别人可能已经照着往下走的一个判断。
async function unconfirmTenant(tid: number) {
  if (!canIssue.value || confirming.value) return   // 写函数自守(入口已判,接管 / 提权到期时直呼也打不出去)
  const name = filtered.value.find(r => r.tenantId === tid)?.tenantName ?? '#' + tid
  const reason = prompt(`取消确认「${name}」?退回待核对,重新生成不再跳过这户。
写一句理由(会留痕):`)
  if (reason == null) return                       // 取消对话框
  if (!reason.trim()) { receipt.fail('理由必填'); return }
  confirming.value = true
  try {
    const res = await billDeliveryApi.unconfirm(noticeYm.value, [tid], reason.trim())
    receipt.ok(`已退回 ${res.reverted} 单${res.skipped ? `,跳过 ${res.skipped} 单(已导出/已作废)` : ''}`)
    await loadMonth()
  } catch (e) { receipt.fail(errMsg(e, '取消确认失败')) } finally { confirming.value = false }
}

// 作废并重出(METER-TIMELINE-SPEC §5):已导出户的单导出后发现错了(比如档案现归别户),
// 取消确认退不回来,作废是唯一出口。作废后重新生成本月,这户按当前档案与读数重出。
// 只做单户(同取消确认:纠一户的错,不是批量工序);理由必填,后端逐张落审计。
async function voidTenant(tid: number) {
  if (!canIssue.value || confirming.value) return
  const live = (noticesByTenant.value.get(tid) ?? []).filter(n => n.status !== 'void')
  if (!live.length) return
  const name = filtered.value.find(r => r.tenantId === tid)?.tenantName ?? '#' + tid
  const reason = prompt(`作废「${name}」${noticeYm.value} 的 ${live.length} 张催缴单?
作废后重新生成本月,这户按当前的档案与读数重出;已导出的文件不会跟着变。
写一句理由(会留痕):`)
  if (reason == null) return
  if (!reason.trim()) { receipt.fail('理由必填'); return }
  confirming.value = true
  let done = 0
  try {
    for (const n of live) { await billNoticesApi.void(n.id, reason.trim()); done++ }
    receipt.ok(`已作废 ${done} 张单;重新生成本月后这户重出`)
  } catch (e) {
    receipt.fail(`${done ? `已作废 ${done} 张,其余没作废:` : ''}${errMsg(e, '作废失败')}`)
  } finally {
    confirming.value = false
    await loadMonth()                                    // 部分成功也要把已作废的状态拉回来
  }
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
    // 标记失败不影响已下载的文件,但**必须说出来**:最常见的失败是无 billing-issue 权限(403),
    // 静默吞掉的话用户拿到了文件、单据状态却还是「未导出」,下次还会被当成没导过。
    const marked = await billDeliveryApi.markExported(req.ym, req.tenantIds).then(() => true).catch(() => false)
    // 判据是 gapOf(单没落到收款公司),不是「公司没录账户」—— 后者在 ExportNoticeWindow 里由
    // noAcctCos 另算。两件事共用「无收款账户」这个词会串台(2026-09-23)。
    const noPayCo = req.tenantIds.filter(gapOf).length
    exportResult.value = `已导出 ${res.files} 个租户文件 / ${res.sheets} 张通知单`
      + (noPayCo ? ` · 其中 ${gapWord(noPayCo)}` : '')
      + (marked ? '' : ' · 未能标记为「已导出」(需签发权限),单据状态不变')
    receipt.ok(exportResult.value)
    expNoticeOpen.value = false
    await loadMonth()
  } catch (e) { receipt.fail(errMsg(e, '导出失败')) } finally { exportBusy.value = false }
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
    if (!res.sheets) { receipt.warn('这户本月没有可导出的费用行'); return }
    const marked = await billDeliveryApi.markExported(dlgYm.value, [r.tenantId]).then(() => true).catch(() => false)
    receipt.ok(`已导出 ${r.tenantName ?? '#' + r.tenantId}${res.sheets > 1 ? ` · ${res.sheets} 家收款公司分 sheet` : ''}`
      + (marked ? '' : ' · 未能标记为「已导出」(需签发权限)'))
    await loadMonth()
  } catch (e) { receipt.fail(errMsg(e, '导出失败')) } finally { cardBusy.value = false }
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
    receipt.ok(`对账表已导出(${req.sheets.length} 个 sheet)`)
    expReconOpen.value = false
  } catch (e) { receipt.fail(errMsg(e, '导出失败')) } finally { exportBusy.value = false }
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
// 原来方格下面还有一行说明(payHint)。2026-09-23 照稿撤掉:它是**条件出现的一行**,
// 换户时有无不定,下面的费项表会跟着上下弹 —— 稿上「换户时费项表不移动」钉的就是这条。
// 两句话都没丢,搬进了收款条本身:待指定几项写在条上;「设好了但本月的单还没跟上」
// 走 PaySlotGrid 的 stale(判据仍是 gapOf,一个字没改)。

async function onSlotSave(p: { colIds: string[]; companyId: number }) {
  if (!canIssue.value || slotSaving.value || !dlgRow.value) return
  const tid = dlgRow.value.tenantId
  slotSaving.value = true
  try {
    for (const colId of p.colIds) await billsApi.setPaymap({ tenantId: tid, feeKey: colId as never, companyId: p.companyId })
    await loadPayMap()   // 不 await 的话 PUT 成功了卡片可能还印着「未设置」——本身就是一条「设了还显示」
    receipt.ok(`已指定 ${p.colIds.length} 项收款公司;重新生成本月催缴单后按新归属拆单`)
  } catch (e) { receipt.fail(errMsg(e, '保存失败')) } finally { slotSaving.value = false }
}

// ── 重新生成(admin;已有单先 ask 再 POST generate,轻提示显摘要,完成刷新) ──
const generating = ref(false)
async function onGenerate() {
  if (!canRun.value || generating.value || loadErr.value) return
  if (rows.value?.length && !await ask({
    title: `重新生成 ${noticeYm.value} 的催缴单？`,
    body: `按 ${month.value} 月读数和 ${noticeMonth.value} 月租金重算:先删后插,覆盖本月的草稿和已作废的单;已确认、已导出的户跳过不动。`,
    action: '重新生成', danger: true,
  })) return
  if (!canRun.value || generating.value) return
  generating.value = true
  try {
    const res = await billNoticesApi.generate(noticeYm.value)
    receipt.ok(`已生成 ${res.generated} 单 / ${res.lines} 行,${res.warned} 单带警告(含已签发跳过户)`)
    await loadMonth()
    // 生成改的正是矩阵格子上的点(池/损耗亮起、stale 清掉)—— 换出账月时要立刻看得见
    void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
  } catch (e) { receipt.fail(errMsg(e, '生成失败')) } finally { generating.value = false }
}

// ── 明细抽屉(两 tab:场地租金在前/水电费在后;竞态守卫同列表手法) ──
const dlgOpen = ref(false)
const dlgTab = ref<string>('rent')
// 落库的 warn 是生成那一刻的快照,明细徽标浮层与列表警告格的悬停用同一句说清时效,免得它假装实时
// (「有费项未设置收款公司」已在 2026-09-23 从 warn 里摘掉 —— 那条是唯一随时会变的判据)。
//
// ⚠ 这一句给**八类**无差别追加,所以它只许说时效,不许指路、不许承诺能清掉
//   (对抗复查 2026-09-23 查出的两处):
//   · 原文写「在合同或表档案里改完后」—— 而「包干行没挂上池」的落点是公共电核算、
//     「上个月缺价」的落点是计费参数,两类在真屏上都出现过,那句话是在把人指去错的屏。
//     该去哪屏由每一类自己的 WARN_COPY.actionLabel 说,这里不替它们说。
//   · 原文写「改完后……才更新」—— 而「本期合计为负」自己的 why 明写「清除路径不存在」,
//     同一屏上两句话互相否定。现在只陈述「这是快照,重新生成才会变」,不承诺改得掉。
const WARN_WHEN = '生成本月催缴单那一刻查出的，不是实时的；重新生成本月后才会变'

// 告警徽标(照稿:徽标长在抽屉副标题行上,不占正文的一行)。点开的那一类贴着徽标浮出(画布 01-C),
// 正文一行不动。记开着的是哪一类的 code;换户清空。
const openWarn = ref('')
const dlgWarnGroups = computed(() => warnGroupsOf(dlgRow.value?.alerts ?? []))
// ⚠ 浮层不能照 Popover 默认的 absolute 摆:徽标所在的副标题行是 FPDrawer 里 height:20px + overflow:hidden
//   的一行,absolute 的面板会被它裁得只剩一条缝。改 fixed,再按实际落点校正一次 ——
//   抽屉带 transform,fixed 的参照是抽屉而不是视口,先放在 (0,0) 量出偏差再挪到徽标正下方。
// ponytail: 只在打开那一刻量,开着时改窗口大小不重摆。
const warnPop = ref<Record<string, string>>({ position: 'fixed' })
// ⚠ 徽标元素不能在点击那一刻记下来:openWarn 一变,副标题行那个具名槽整段重渲染、徽标换了新节点,
//   记下的是摘掉的旧节点,旧节点底下没有面板 —— 校正一次都没做成,浮层一直停在 (0,0)(对抗复查 asserts-8 的断言抓到)。
//   改成每次渲染按类别记当前的徽标节点,量的时候现取
const badgeEls = new Map<string, HTMLElement>()
async function onWarnOpen(code: string, on: boolean) {
  if (!on) { if (openWarn.value === code) openWarn.value = ''; return }
  openWarn.value = code
  warnPop.value = { position: 'fixed', top: '0px', left: '0px' }
  await nextTick()
  const badge = badgeEls.get(code)
  const panel = badge?.closest('.bn-wpop')?.querySelector<HTMLElement>('.ds-popover-panel')
  if (!badge || !panel) return
  const p = panel.getBoundingClientRect(), b = badge.getBoundingClientRect()
  warnPop.value = { position: 'fixed', top: `${b.bottom + 6 - p.top}px`, left: `${b.left - p.left}px` }
}

// 逐户导航(照稿:一个月要按「下一户」走一百多次,核对是个循环不是一次次单独查询)。
// 走的是**当前筛选后的这一期**,不是只走待核对的 —— 已确认的也要能翻回去看。
const dlgIdx = computed(() =>
  dlgRow.value ? filtered.value.findIndex(r => r.tenantId === dlgRow.value!.tenantId) : -1)
function stepTenant(d: 1 | -1) {
  const i = dlgIdx.value + d
  if (i < 0 || i >= filtered.value.length) return
  openDetail(filtered.value[i])
}

const DLG_TABS = [{ value: 'rent', label: '场地租金' }, { value: 'util', label: '水电费' }]
const dlgLoading = ref(false)
const dlgRow = ref<DisplayRow | null>(null)
const details = ref<BillNoticeDetailDTO[]>([])
let dlgSeq = 0

async function openDetail(r: DisplayRow) {
  dlgOpen.value = true
  dlgTab.value = 'rent'
  openWarn.value = ''     // 换户收起徽标浮层:浮层说的是上一户的事
  dlgRow.value = r
  dlgYm.value = noticeYm.value   // 快照:抽屉开着换月不改备注归属月(备注按催缴单月记)
  dlgLoading.value = true
  details.value = []
  noteMap.value = new Map()
  noteEditKey.value = null
  const my = ++dlgSeq
  try {
    const [ds, ns] = await Promise.all([
      Promise.all(r.noticeIds.map(id => billNoticesApi.detail(id))),
      // 备注覆盖失败不阻断明细(如后端未升级到 V92):按无覆盖显示引擎备注
      billNoticesApi.notes(noticeYm.value, r.tenantId).catch(() => [] as BillNoteOverrideDTO[]),
    ])
    if (my !== dlgSeq) return
    details.value = ds
    noteMap.value = new Map(ns.map(o => [noteKeyId(o), o.note]))
  } catch (e) {
    if (my !== dlgSeq) return
    receipt.fail(errMsg(e, '明细加载失败')); dlgOpen.value = false
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
  `手写备注(引擎原文:${engine || '无'})${canRun.value ? ';点击恢复引擎备注' : ''}`
function startNoteEdit(k: NoteKey, current: string) {
  if (!canRun.value) return
  noteEditKey.value = noteKeyId(k)
  noteDraft.value = current
}
async function saveNoteEdit(k: NoteKey) {
  // 本文件唯一漏判的写函数 —— 兄弟的 startNoteEdit(:490)/restoreNote(:511) 都判了 canRun。
  if (!canRun.value) return
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
  } catch (e) { receipt.fail(errMsg(e, '备注保存失败')) } finally { noteSaving.value = false }
}
async function restoreNote(k: NoteKey, engine: string | null) {
  if (!canRun.value || noteSaving.value || !dlgRow.value) return
  if (!await ask({
    title: '恢复引擎备注？',
    body: engine ? `手写的备注会清掉,改回「${engine}」。` : '手写的备注会清掉;这一行引擎没有备注。',
    action: '恢复引擎备注',
  })) return
  if (!canRun.value || noteSaving.value || !dlgRow.value) return
  noteSaving.value = true
  try {
    await billNoticesApi.deleteNote({ ym: dlgYm.value, tenantId: dlgRow.value.tenantId, ...k })
    noteMap.value.delete(noteKeyId(k))
    noteEditKey.value = null
  } catch (e) { receipt.fail(errMsg(e, '恢复失败')) } finally { noteSaving.value = false }
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
// 表行与当月档案比不上(METER-TIMELINE-SPEC §5,后端 detail 实时比):标「档案现归 X」,橙点照收款缺口那颗。
// name 空串 = 档案这个月是空置;非空但没认出户时 name 是册上企业名称原文,照样写出来
function archText(l: BillNoticeLineDTO | null | undefined): string | null {
  const n = l?.archiveTenantName
  if (n == null) return null
  return n === '' ? `档案 ${month.value} 月为空置` : `档案现归 ${n}`   // 比的是水电那个月的档案
}
// 宿舍子表「房号」列(列宽铁律,2026-10-02):按本单全部房号定宽,余宽落进行末空列,不再是唯一弹性列。
// 一格 = 房号(电表带分时段后缀)+ 档案标记(圆点 6 + 间距 4 + 12px 字,与房号隔 4);兜底行写的是费项名。
function roomColW(sub: { rooms: { room: string; main: BillNoticeLineDTO }[]; extras: BillNoticeLineDTO[] }, seg: boolean): number {
  const rooms = sub.rooms.map(r => {
    const a = archText(r.main)
    return textW([r.room + (seg && r.main.seg ? '·' + segLabel(r.main.seg) : '')], 12, 16) + (a ? textW([a], 12, 0) + 14 : 0)
  })
  return Math.max(textW(['房号'], 11, 16), ...rooms, ...sub.extras.map(l => textW([billFeeLabel(l.feeKey)], 12, 16)))
}
const dormElecRoomW = computed(() => roomColW(dorm.value.elec, true))
// 水电费明细「备注」列(列宽铁律,2026-10-02):按本单全部备注定宽,余宽落进行末空列 —— 取价审计那根 30 跟着贴在备注后面,
// 不再被推到抽屉右沿。一格 = 档案标记(圆点 6 + 4 + 12px 字,再隔 4)+ 备注字(12px)+ 手写圆点 7 + 4 + 编辑钮 20 + 4;
// 正在改的那一行是输入框(给 240)+ 两颗 20 的钮。编辑钮与编辑行按「有没有权限」(mayRun)预留,不看眼下在不在编辑态、
// 有没有哪行正在改 —— 点铅笔 / 进出编辑态时备注列和后面的取价审计列不挪位(LIST-PAGE §7)。
const utilNoteW = computed(() => {
  const ws = [textW(['备注'], 11, 16)]
  for (const r0 of utilRows.value) {
    if (r0.t !== 'line' && r0.t !== 'merge') continue
    const c = noteCell(r0.nk, r0.t === 'line' ? r0.l.note : r0.m.note)
    const arch = r0.t === 'line' ? archText(r0.l) : null
    ws.push(textW([c.text], 12, 16) + (arch ? textW([arch], 12, 0) + 14 : 0) + (c.overridden ? 11 : 0) + (mayRun.value ? 24 : 0))
  }
  if (mayRun.value) ws.push(16 + 240 + 2 * 24)
  return Math.max(...ws)
})
const dormWaterRoomW = computed(() => roomColW(dorm.value.water, false))
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

// 照 01-C 只写「2023-09（8 月水电）」:这一行有告警徽标时单行、超出截断,合同数 / 明细行数原来拼在这里,被徽标挤成省略号
const drawerSub = computed(() => (dlgRow.value ? `${noticeYm.value}（${month.value} 月水电）` : ''))

// ── §5.10 动作:S 档「顶栏 1 个主动作 +「⋯」」,M 档「屏内 2 个主动作 +「⋯」」 ──────
// 主控行上今天有 7 个入口:收款公司 / 收款簿 / 系数簿 / 导出通知单 / 导出对账表 /
// 生成本月·重新生成(编辑态才出) / 编辑模式。
//
// **主动作判据 =「不点它就干不成事的那个」**(§5.10 那一行的原话)。本屏答案是**编辑模式**:
// 生成、确认、批量确认、抽屉里的备注改写全部守在 canRun / canIssue 后面,而那两个都 && editMode
// (:93-94)—— 不先点编辑模式,一件写操作都做不成。「生成本月」看着像起点动作,但它自己
// v-if="canRun",是编辑模式的下游而不是入口;三个簿与两个导出是只读旁路,不点也能看表。
// 审核簇(FPReviewActions)不进菜单:它是**状态**不是动作(§5.10「状态藏了等于没有」),
// 且组件自己写明不做成「更多」菜单;它本来就是 28 高的一簇胶囊,不占一整行。
//
// ⚠ **M 档(601–960)看不见手机顶栏** —— AppShell.vue:162 是 `v-if="tier !== 's'"`(走桌面
// TabStrip + Toolbar),:168 的 `v-else` 才挂 MobileTopBar。所以 §5.10「M 档主动作留 2 个」
// 那一行虽然写着「走同一套」,实现上**不能走顶栏**:在 M 档登记顶栏动作是空转,
// 那两个主动作只能留在屏内流里。本屏 M 档留在行上的两个 =
//   ① 编辑模式(常在,理由同上:不点它一件写操作都做不成)
//   ② 重新生成(编辑态且本月有单才出 —— 沿用桌面那颗一模一样的条件;空月的「生成本月」在内容区空状态里,画布 05-B,
//      不新开一处「由交互态决定显隐的流内块」,零位移铁律不欠新账;浏览态 M 档就只有 ① 一个,
//      「留 2 个」是上限不是配额)
// 其余五个只读入口 + 批量确认在 M 与 S 同判(narrow)进「⋯」;生成只在 S 档进菜单。
//
// ⚠ §5.11(溢出菜单还没规则):菜单里唯一「一行字点下去就不可逆」的是「重新生成」——
// 先删后插覆盖整月。它的二次确认在 onGenerate 里已经有一句写明覆盖范围的 ask(danger)。
// 「批量确认」是不可逆的**入口**(draft→confirmed 单向流转),但点它只是进选择态,
// 真正落刀的那一步在 confirmTenants —— 二次确认补在那里(见该函数)。
const moreItems = computed(() => [
  { key: 'company', label: '收款公司', icon: 'building-2' },
  { key: 'paybook', label: '收款簿', icon: 'credit-card' },
  { key: 'coef', label: '系数簿', icon: 'sliders-horizontal' },
  { key: 'expNotice', label: '导出通知单', icon: 'download', disabled: !rows.value?.length || exportBusy.value || noAcct.value, tip: noAcctTip.value },
  { key: 'expRecon', label: '导出对账表', icon: 'table', disabled: !rows.value?.length || exportBusy.value },
  // 批量确认原本长在筛选行上,它是动作不是筛选 —— S 档跟着动作一起进菜单。
  ...(canIssue.value && filtered.value.length ? [{ key: 'bulk', label: '批量确认', icon: 'list-todo' }] : []),
  // 生成只在 S 档进菜单:M 档它是留在行上的第二个主动作(见上),两处都出就是画两遍。
  ...(isS.value && canRun.value
    ? [{
        key: 'generate',
        label: rows.value?.length ? '重新生成' : '生成本月',
        icon: rows.value?.length ? 'refresh-cw' : 'play',
        disabled: generating.value,
      }]
    : []),
])
// 桌面:收款公司 / 收款簿 / 系数簿 并成「簿册 ▾」,两个导出并成「导出 ▾」(画布 05-A 打开态没有图标)
const BOOK_ITEMS = [
  { key: 'company', label: '收款公司' }, { key: 'paybook', label: '收款簿' }, { key: 'coef', label: '系数簿' },
]
const exportItems = computed(() => [
  { key: 'expNotice', label: '导出通知单', disabled: exportBusy.value || noAcct.value, tip: noAcctTip.value },
  { key: 'expRecon', label: '导出对账表', disabled: exportBusy.value },
])
function onMore(key: string) {
  if (key === 'company') companyOpen.value = true
  else if (key === 'paybook') payBookOpen.value = true
  else if (key === 'coef') coefOpen.value = true
  else if (key === 'expNotice') expNoticeOpen.value = true
  else if (key === 'expRecon') expReconOpen.value = true
  else if (key === 'bulk') bulkMode.value = true
  else if (key === 'generate') void onGenerate()
}
</script>

<template>
  <!-- ⓪ 没有期 → 出账月矩阵(五屏共用一张)。选过一次之后本会话不再出现,直落表格 -->
  <ChainMonthGate v-if="!period.picked" title="催缴单" icon="file-check-2" notice />

  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5.4 迁移(KPI 降列/主表 .bn-wrap 内横滚+首列锚),
       摘掉 base.css 的 800px 屏级地板。v-if 各分支谁渲染谁就是 .fp-content 的首子,都要挂——
       只挂 v-else 的话,首载转圈那一屏仍被地板撑到 800px,手机上圈会跑到屏外去居中。 -->
  <div v-else-if="!rows && !loadErr" class="page-loading fp-fluid"><span class="page-spin" /></div>

  <div v-else class="bn-page fp-fluid">
    <FPLoadBar :on="veil" />
    <!-- 链路条:期写在这里,五道工序横跳不换期 -->
    <FPStepStrip :steps="chainSteps" current="bill-notices" :period="`${noticeYm}(${month} 月水电)`" @back="period.clear()" />

    <!-- 标题行(画布 05-A「八个按钮收成四个」):左 = 屏名 + 期段控(本月没有单也不贴标签,画布 05-B);
         右 = 待处理 · 簿册 ▾ · 导出 ▾ ·(编辑态)重新生成 · 审核簇 · 编辑模式。生成本月进空状态,批量确认进表格卡 -->
    <div class="bn-head">
      <div class="bn-head-l">
        <!-- §5.10 屏名:M↓ 不上屏(判据四 —— 顶栏 52px 已经写着「催缴单」)。L/XL 原样。 -->
        <h2 v-if="!narrow" class="bn-title"><span class="ic"><component :is="iconFor('file-check-2')" :size="18" /></span>催缴单</h2>
        <!-- §5.10 筛选:期段控是「反正都要点开的选择器」,M↓ 收进筛选面板 -->
        <Segmented v-if="!narrow" :options="PHASE_OPTS" v-model="phase" size="sm" />
        <!-- 窄档(§5.10)问题入口仍在左组:三屏的 S/M 分支这次不动(规范 §2-21) -->
        <FPAlertPanel v-if="narrow" v-model:open="alertOpen" :count="alertCount" :groups="allAlertGroups" />
      </div>
      <div class="bn-actions">
        <!-- 问题入口挪到右组最前(画布 05-A);胶囊在右,面板往左展开 -->
        <FPAlertPanel v-if="!narrow" v-model:open="alertOpen" :count="alertCount" :groups="allAlertGroups" align="end" />
        <!-- 三个簿并成「簿册 ▾」、两个导出并成「导出 ▾」。M↓ 照旧全收进「⋯」(见 moreItems) -->
        <template v-if="!narrow">
          <FPMoreMenu label="簿册" icon="book-open" :items="BOOK_ITEMS" @select="onMore" />
          <FPMoreMenu v-if="list.length" label="导出" icon="download" :items="exportItems" @select="onMore" />
        </template>
        <!-- 重新生成 = 先删后插覆盖整月 ⇒ danger,编辑态才出,留在「完成」左边(规范 §2-15)。
             空月的「生成本月」在内容区的空状态里(画布 05-B)。
             §5.10 M 档:它是留在屏内流里的**第二个主动作**(M 档看不见手机顶栏,见 moreItems 上方),
             所以判据是 !isS 而不是 !narrow;S 档它进「⋯」。 -->
        <Button v-if="!isS && canRun && list.length" variant="danger" size="sm"
                :disabled="generating" @click="onGenerate">
          <template #leading><component :is="iconFor('refresh-cw')" :size="14" /></template>
          {{ generating ? '生成中…' : '重新生成' }}
        </Button>
        <!-- 审核动作簇(§01):长在编辑按钮**左边**,同一条 flex 行 —— 编辑按钮位一个像素不动。
             四态八格由组件自己判(全站唯一那一份),屏这一层只负责喂键与人话名。
             §5.10:它是审核**态**不是动作,S 档照样留在行上,不进「⋯」。 -->
        <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
        <!-- 编辑模式 = 本屏主动作。S 档它搬进手机顶栏(useTopBarAction,顶栏钉在屏名与 🔍 之间),
             行上就不能再画一颗 —— 同一个动作画两遍。M 档没有手机顶栏,照旧留在行上。
             单没读到时进不去(进去也只能对着一张空表写)。 -->
        <FPEditModeButton v-if="!isS" :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          :review-note="reviewNote" :review-tip="reviewTip" :disabled="!editMode && !!loadErr"
                          @toggle="toggleEdit()" />
        <!-- 主动作右侧那颗「⋯」,M 与 S 同判。判据与条目见 moreItems(:script 尾) -->
        <FPMoreMenu v-if="narrow" :items="moreItems" @select="onMore" />
      </div>
    </div>

    <!-- 窄档 KPI 轨(RESPONSIVE §5.7,随当前期 tab 联动)。桌面已并进状态页签(画布 05-A),
         窄档这次不动(规范 §2-21) -->
    <div v-if="narrow" class="bn-kpis" :class="{ 'fp-stale': veil }">
      <FPStat label="户数" :value="String(kpis.count)" tint="blue" />
      <FPStat label="本期总额(元)" :value="fmt2(kpis.total)" tint="sky" sub="S5 起含租金板块" />
      <FPStat label="月租金合计(参考,元)" :value="fmt2(kpis.rent)" sub="整月口径,未含免租期/按天折" />
      <FPStat label="警告户数" :value="String(kpis.warned)" :sub="kpis.warned ? '悬停「警告」那一格看是哪几类' : undefined" />
    </div>

    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />

    <!-- 第二行:桌面 = 状态页签 + 搜租户名(画布 05-A);窄档 = 搜索 + 筛选钮(§5.10,不动)。
         本月没有单、单没读到时不出(画布 05-B;没有行可筛);窄档批量态让位给卡里的选择条(原来就是整条换掉) -->
    <div v-if="narrow ? !bulk : list.length > 0" class="bn-toolbar">
      <Segmented v-if="!narrow" class="bn-tabs" :options="tabOpts" v-model="tab" size="sm" />
      <span style="flex:1"></span>
      <input v-model="q" class="bn-search" type="text" placeholder="搜租户名" />
      <button v-if="narrow" class="bn-fbtn" type="button" @click="filterOpen = true">
        <component :is="iconFor('filter')" :size="14" />
        {{ phaseLabel }}
        <span v-if="filterCount" class="bn-fcnt">{{ filterCount }}</span>
      </button>
    </div>

    <!-- §5.10 筛选面板:收进来的两件一件不少(期段控 + 仅看有警告)。
         壳借 FPDrawer —— S 档全屏化由它自己的 ≤600 分支给(§4.4),不在本屏另画一套浮层。
         关着时 v-if 不渲染,XL 档 DOM 零新增(§9)。 -->
    <FPDrawer :open="filterOpen" title="筛选" icon="filter" :width="420" @close="filterOpen = false">
      <div class="bn-fpanel">
        <div class="bn-ffld">
          <span class="bn-flbl">期</span>
          <Segmented :options="PHASE_OPTS" v-model="phase" size="sm" />
        </div>
        <label class="bn-chk">
          <input type="checkbox" v-model="warnOnly" />
          仅看有警告
        </label>
      </div>
    </FPDrawer>

    <!-- 表格卡(画布 05-A / 05-B / 05-C):加载失败 / 本月没有单 / 表格 三者互斥,占住同一块内容区。
         fp-stale 带 pointer-events:none —— 旧数据不许被点、被录(安全项,见 base.css) -->
    <div class="bn-card" :class="{ 'fp-stale': veil }">
      <FPLoadError v-if="loadErr" :sub="`${loadErr} · 屏上不显示上个月的数字`" @retry="loadMonth()">
        {{ noticeYear }} 年 {{ noticeMonth }} 月的催缴单没读到
      </FPLoadError>
      <!-- 05-B:生成一次出全园三期的单(后端 generate 只收月份),所以副句不写「一期」 -->
      <FPEmpty v-else-if="noRows" :sub="`按 ${month} 月读数和 ${noticeMonth} 月租金生成，一期到三期全部租户一次生成。`">
        {{ noticeYm }} 的催缴单还没生成
        <template v-if="canRun" #action>
          <Button variant="filled" :disabled="generating" @click="onGenerate">
            <template #leading><component :is="iconFor('play')" :size="16" /></template>
            {{ generating ? '生成中…' : '生成本月' }}
          </Button>
        </template>
      </FPEmpty>
      <template v-else>
        <!-- 卡内工具条(规范 §1.9)。批量态整条换成选择条(画布 05-C「表格自己的工具条换成选择条，页面不动」);
             批量确认只在编辑态出(规范 §2-22)。浏览态这条留空也占着位:进出编辑态表格不挪。
             M↓ 批量确认进「⋯」,不画空条(屏顶算术见样式尾) -->
        <div v-if="bulk" class="bn-selbar">
          <b class="bn-selc">{{ selCount ? `已选 ${selCount} 户` : '勾选要确认的租户' }}</b>
          <span v-if="selGaps" class="bn-selnote">其中 {{ selGaps }} 户缺收款公司，不影响确认</span>
          <span style="flex:1"></span>
          <button class="bn-selb" type="button" @click="toggleAll">{{ allChecked ? '取消全选' : '全选待核对' }}</button>
          <Button variant="filled" size="sm" :disabled="confirming || !selCount"
                  @click="confirmTenants(picked.map(r => r.tenantId))">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            {{ confirming ? '确认中…' : `确认 ${selCount} 户` }}
          </Button>
          <button class="bn-selb" type="button" @click="exitBulk">
            <component :is="iconFor('x')" :size="14" /> 退出
          </button>
        </div>
        <FPTableTools v-else-if="!narrow" class="bn-tools">
          <Button v-if="canIssue && filtered.length" variant="outline" size="sm" @click="bulkMode = true">
            <template #leading><component :is="iconFor('list-todo')" :size="14" /></template>
            批量确认
          </Button>
        </FPTableTools>

        <div ref="wrapEl" class="bn-wrap" :aria-busy="veil">
          <!-- .bulk 挂到表上:S 档首列 sticky 的 left 偏移随勾选列进出而不同(0 / 36px),CSS 要认得出模式 -->
          <table class="bn-table" :class="{ bulk, 'bn-tight': locTight }">
            <!-- table-layout:fixed ⇒ col 必须与列数逐一对齐,缺一个后面全体串位。 -->
            <colgroup>
              <col v-if="bulk" style="width:36px" />
              <col style="width:220px" />
              <col :style="locTight ? undefined : { width: locWant + 'px' }" /><!-- 位置:按内容定宽;放不下时吸收剩余(locTight) -->
              <col style="width:130px" />
              <col style="width:130px" />
              <col style="width:130px" /><!-- 状态:签 + 编辑态悬停出的「确认」 -->
              <col style="width:210px" /><!-- 警告:「首类 +N」+ 行尾 ›。最长类名「表绑的合同上个月用不上」11 字 -->
              <col :style="locTight ? { width: '0px' } : undefined" /><!-- 行末空列 .fp-fill:余宽落这里 -->
            </colgroup>
            <thead>
              <tr>
                <th v-if="bulk" class="ct bn-ckc"></th>
                <!-- bn-c1:S 档横滚时的定位锚列(§5.3 只钉一根;楼栋组头是 colspan 宽格,钉住会盖滚进来的列,不钉) -->
                <th class="l bn-c1">租户</th>
                <th class="l" v-tip="'该户全部单据场地去重合并,明细内按场地分段小计'">位置</th>
                <th class="bn-mc" v-tip="'该户全部单据本期合计之和(租金+水电,含宿舍单);账外户降淡不入应收'">本期合计（元）</th>
                <th v-tip="'该户当月在租合同月租之和;参考口径:整月,未含免租期/按天折'">月租金参考（元）</th>
                <th class="l" v-tip="'待核对 → 已确认 → 已导出;已确认 / 已导出的户重新生成自动跳过'">状态</th>
                <!-- 格里的类名逐字抄 WARN_COPY 的 title:写成别的说法,用户按列头的词去屏上找就对不上号
                     (对抗复查 2026-09-23)。 -->
                <th class="l" v-tip="'生成本月催缴单时查出的(表没挂上合同 / 房号两边对不上 / 上个月缺价…)和收款缺口;写第一类 +其余几类,悬停那一格看全部'">警告</th>
                <th class="fp-fill" aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              <!-- 楼栋分组:分组行兼小计(画布 05-A,楼栋 · 户数 + 两列小计,点它收起);跨栋户只在主楼栋组出现一次 -->
              <template v-for="g in groups" :key="gKey(g)">
                <!-- 收起入口是行里那颗 <button aria-expanded>(和公共电核算 / 园区抄表同一写法,键盘 Enter / Space 都行);整行点也收 -->
                <tr class="bn-band" @click="toggleGroup(g)">
                  <td class="l" :colspan="bulk ? 3 : 2">
                    <button type="button" class="bn-gbtn" :aria-expanded="!collapsed.has(gKey(g))">
                      <component :is="iconFor(collapsed.has(gKey(g)) ? 'chevron-right' : 'chevron-down')" :size="14" class="cv" />
                      <span class="t">{{ g.name }}</span><span class="n">{{ g.count }} 户<template v-if="bulk"> · 可确认 {{ g.rows.filter(canPick).length }}</template></span>
                    </button>
                  </td>
                  <td class="bn-mc"><span class="bn-sumc">{{ fmt2(g.total) }}</span></td>
                  <td><span class="bn-nv">{{ fmt2(groupRent(g)) }}</span></td>
                  <td :colspan="2"></td>
                  <td class="fp-fill" aria-hidden="true"></td>
                </tr>
                <!-- 批量模式下整行点击=切勾选(已进入选择语境,再弹抽屉会打架);常态点击=开明细 -->
                <template v-if="!collapsed.has(gKey(g))">
                  <tr v-for="r in g.rows" :key="r.tenantId" :data-tid="r.tenantId"
                      :class="{ offbook: r.offbook, sel: bulk && selected.has(r.tenantId), off: bulk && !canPick(r), flash: flashTid === r.tenantId }"
                      @click="bulk ? toggleOne(r) : openDetail(r)" @animationend="unflash" @animationcancel="unflash">
                    <td v-if="bulk" class="ct bn-ckc" @click.stop>
                      <input type="checkbox" :checked="selected.has(r.tenantId)" :disabled="!canPick(r)" @change="toggleOne(r)" />
                    </td>
                    <td class="l bn-c1">
                      <span class="bn-tname" v-tip="r.tenantName">{{ r.tenantName ?? '#' + r.tenantId
                        }}<em v-if="r.mark" class="bn-xb" v-tip="r.mark.tip">{{ r.mark.badge }}</em></span>
                    </td>
                    <td class="l"><span class="bn-txt dim" v-tip="r.premiseText">{{ r.premiseText || '–' }}</span></td>
                    <td class="bn-mc"><span class="bn-sumc" :class="{ neg: r.totalAmount < 0 }">{{ fmt2(r.totalAmount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r.rent == null }">{{ fmt2(r.rent) }}</span></td>
                    <!-- 状态签 + 编辑态悬停出的行内「确认」(规范 §2-22:写入口只在编辑态) -->
                    <td class="l bn-stc">
                      <span class="bn-st" :class="r.st">{{ ST_LABEL[r.st] }}</span>
                      <button v-if="canIssue && !bulk && r.st === 'draft'" class="bn-cfm" type="button"
                              :disabled="confirming" v-tip="'核对无误,确认该户'" @click.stop="confirmTenants([r.tenantId])">确认</button>
                    </td>
                    <!-- 警告:「首类 +N」(datagrid 格内写法);只缺收款公司时就地标记 ● 缺收款公司 -->
                    <td class="l">
                      <span class="bn-wc">
                        <span class="bn-wcell" v-tip="r.alerts.length || r.gap ? warnTip(r.alerts, r.gap) : null">
                          <template v-if="warnCell(r)">
                            <span class="bn-wtag">{{ warnCell(r)!.title }}</span> <span v-if="warnCell(r)!.more" class="bn-wmore">+{{ warnCell(r)!.more }}</span>
                          </template>
                          <FPMark v-else-if="r.gap" tone="warn">缺收款公司</FPMark>
                        </span>
                        <component :is="iconFor('chevron-right')" :size="14" class="bn-go" />
                      </span>
                    </td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                </template>
              </template>
              <tr v-if="filtered.length === 0">
                <td class="bn-noro" :colspan="bulk ? 8 : 7">本期无匹配租户 —— 换期、页签或搜索词试试</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th v-if="bulk" class="bn-ckc"></th>
                <th class="l bn-c1"><span class="bn-foot-lbl">合计</span></th>
                <th></th>
                <th class="bn-mc"><span class="bn-foot-v">{{ fmt2(footTotal) }}</span></th>
                <th><span class="bn-foot-v">{{ fmt2(footRent) }}</span></th>
                <th></th>
                <th></th>
                <th class="fp-fill" aria-hidden="true"></th>
              </tr>
            </tfoot>
          </table>
        </div>
      </template>
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
      <!-- 状态进抽屉(照稿):今天只有列表那一列有,开着抽屉核对的人看不到核过没核过 -->
      <template v-if="dlgRow" #badge>
        <span class="bn-st" :class="statusOf(dlgRow.tenantId)">{{ ST_LABEL[statusOf(dlgRow.tenantId)] }}</span>
        <!-- 遮罩盖住了顶栏:临时授权的胶囊挂一枚在弹窗头(画布 08 ElevStates) -->
        <FPElevChip variant="dialog" />
      </template>

      <!-- 告警长在副标题行上,一类一个徽标,写明类名与条数。那一行本来就在 ⇒ 有告警没告警,抽屉高度一样。
           点徽标:明细 + 落点链 + 时效贴着徽标浮出(画布 01-C,原来是正文顶上 80px 的橙色块),正文一行不动。
           浮层是点出来的,不是悬停出来的(2026-09-12 拆掉的是 ⓘ 悬停浮层)。定位见 onWarnOpen。 -->
      <template v-if="dlgRow && dlgWarnGroups.length" #submeta>
        <Popover v-for="g in dlgWarnGroups" :key="g.code" class="bn-wpop" :open="openWarn === g.code" :width="320"
                 :style="warnPop" @open-change="onWarnOpen(g.code, $event)">
          <template #trigger>
            <button type="button" class="bn-abadge" :class="{ on: openWarn === g.code }"
                    :aria-expanded="openWarn === g.code" aria-haspopup="dialog"
                    :ref="el => { if (el) badgeEls.set(g.code, el as HTMLElement) }">
              <component :is="iconFor('alert-triangle')" :size="12" />
              {{ g.title }}<b>{{ g.items.length }}</b>
              <component :is="iconFor('chevron-down')" :size="11" />
            </button>
          </template>
          <div class="bn-apanel">
            <div class="bn-arow">
              <span class="val">{{ g.items.join('、') }}</span>
              <!-- 落点与屏级问题面板走同一条(router.push(`/${g.route}`)),不另造一条 -->
              <a v-if="g.route" class="go" href="#"
                 @click.prevent="dlgOpen = false; router.push(`/${g.route}`)">{{ g.actionLabel }}</a>
            </div>
            <em class="when">{{ WARN_WHEN }}</em>
          </div>
        </Popover>
      </template>
      <div v-if="dlgLoading || !dlgRow" class="bn-empty">加载中…</div>
      <template v-else>
        <!-- 正文永远只有三块,每块高度与这户的情况无关:头部三格 / 收款条 / 段控+费项表。
             照稿「换户时费项表不移动」—— 一个月要按「下一户」走一百多次,正文一弹就要重新找表。
             告警不在这里,它在抽屉头的副标题行上(#submeta)。 -->
        <div class="bn-hgrid c3">
          <div class="bn-hfld"><label>位置</label><span :class="{ dim: !dlgRow.premiseText }">{{ dlgRow.premiseText || '—' }}</span></div>
          <!-- 上期欠费降格成小字(用户 2026-09-23 拍板):催缴闭环的接口点,S4 恒 0,
               收款流水接进来之前它占着四分之一的头部宽度说不出任何事。
               ⚠ 这里**不印那个 0**(对抗复查 2026-09-23):库里 739 张单的 prev_due 全是 0,
                 它不是量出来的,印在屏上就是「这户上期不欠钱」的断言;而唯一说清「功能没接通」的
                 那句话原本只躲在 title 里,鼠标之外摸不到。收款流水接进来那天再换回数字。 -->
          <div class="bn-hfld"><label>本期合计</label><span class="mono">{{ fmt2(dlgRow.totalAmount) }} 元</span>
            <em class="bn-hsub" v-tip="'催缴闭环的接口点:收款流水还没接进来,这里暂时算不出上期欠费'">上期欠费 · 收款流水未接入</em></div>
          <div class="bn-hfld"><label>月租金(参考)</label><span class="mono" :class="{ dim: dlgRow.rent == null }">{{ dlgRow.rent == null ? '–' : fmt2(dlgRow.rent) + ' 元' }}</span>
            <em class="bn-hsub">整月口径,未含免租期/按天折</em></div>
        </div>

        <!-- S20 收款方分段:默认收起成一条,展开是一行一槽的行表。恒出(空态也出条) -->
        <PaySlotGrid :cells="slotCells" :companies="companies" :can-edit="canIssue"
                     :saving="slotSaving" :stale="gapOf(dlgRow.tenantId)" @save="onSlotSave" />

        <Segmented :options="DLG_TABS" v-model="dlgTab" size="sm" />

        <!-- 场地租金 tab(S5 刀4):fee_group='rent' 落库行,一场地一块(厂房/办公室/宿舍逐间);
             面积列显「建筑+公摊」拆解,备注列显按天折算式/免租期扣减 -->
        <template v-if="dlgTab === 'rent'">
          <FPEmpty v-if="rentG.groups.length === 0" size="sm" sub="重新生成后按合同条款派生。">本月无租金行</FPEmpty>
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
                  <th v-tip="'行带建筑+公摊两格时显拆解(如 1528+458);按间计费显间数'">面积/间数</th>
                  <th>金额(元)</th>
                  <th class="l" v-tip="'非整月按天折算式(如 1130÷31×26);免租期扣减'">备注</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="g in rentG.groups" :key="g.label">
                  <tr class="bn-band">
                    <td :colspan="6" class="l"><span class="bn-band-lbl">{{ rentBandLabel(g) }}</span></td>
                  </tr>
                  <tr v-for="(l, i) in g.lines" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" v-tip="l.feeKey">{{ rentFeeName(l.feeKey, g.type) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }">{{ fmt(l.priceSnap) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: l.qty == null }">{{ rentAreaText(l.qty, l.baseSnap) ?? '–' }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: l.amount < 0 }">{{ fmt2(l.amount) }}</span></td>
                    <!-- 备注:人工覆盖>引擎;hover 出铅笔(admin),小圆点=有覆盖(悬浮引擎原文,点击恢复) -->
                    <td class="l">
                      <div class="bn-notec">
                        <template v-if="noteEditKey === noteKeyId(lineNoteKey(l))">
                          <input v-model="noteDraft" class="bn-nin" :disabled="noteSaving" placeholder="备注(清空保存=恢复引擎备注)"
                            @keydown.enter.prevent="saveNoteEdit(lineNoteKey(l))" @keydown.esc.stop="noteEditKey = null" />
                          <button class="bn-nop ok" v-tip="'保存'" :disabled="noteSaving" @click="saveNoteEdit(lineNoteKey(l))"><component :is="iconFor('check')" :size="14" /></button>
                          <button class="bn-nop" v-tip="'取消'" :disabled="noteSaving" @click="noteEditKey = null"><component :is="iconFor('x')" :size="14" /></button>
                        </template>
                        <template v-else>
                          <span class="bn-txt dim" v-tip="noteCell(lineNoteKey(l), l.note).text || undefined">{{ noteCell(lineNoteKey(l), l.note).text }}</span>
                          <span v-if="noteCell(lineNoteKey(l), l.note).overridden" class="bn-ndot" :class="{ act: canRun }" v-tip="noteDotTitle(l.note)" @click="restoreNote(lineNoteKey(l), l.note)"></span>
                          <button v-if="canRun" class="bn-npen" v-tip="'编辑备注'" @click="startNoteEdit(lineNoteKey(l), noteCell(lineNoteKey(l), l.note).text)"><component :is="iconFor('pencil')" :size="12" /></button>
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
          <FPEmpty v-if="utilRows.length === 0 && dormLines.length === 0" size="sm">本单无水电行</FPEmpty>
          <div v-else class="bn-dwrap">
            <table class="bn-dtable">
              <colgroup>
                <col style="width:38px" />
                <col style="width:128px" /><!-- 费项:98px 会截「楼层公共、消防照明」(用户截图实证)——上一刀只数了逐表行的 6 字,漏了合并标签。
                     实际出现的标签清单(dev 库 bill_notice_line 非 rent 组 fee_key 全枚举 + MERGE_LABEL):
                       逐表行 电费(2)/水费(2)/装机容量费(5)/电力管理费(5)/水管网维护费(6)
                       合并行 电梯用电(4)/线路损耗(4)/路灯公摊(4)/绿化水公摊(5)/楼层公共、消防照明(9,「、」也是全角)
                     最长者=「楼层公共、消防照明」9 全角字。计算依据:font-size 12px、CJK 进距 1em ⇒ 9×12=108px,
                     加 td padding 0 8px 共 16px = 124px,取 128px 留 4px 字体余量。
                     (2026-10-02 起备注按内容定宽、余宽归行末空列,下面这笔账只留作当时的依据)备注当时因此少 30px,1920 视口下仍不截:抽屉 min(1720px,96vw)=1720 − body padding 44 − 竖滚动条≈15
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
                <col :style="{ width: utilNoteW + 'px' }" /><!-- 备注:按内容定宽 -->
                <col style="width:30px" />
                <col /><!-- 行末空列 .fp-fill:余宽落这里 -->
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th class="l">费项</th>
                  <th class="l">表</th>
                  <th class="l" v-tip="'分时段:尖/峰/平/谷'">段</th>
                  <th>上月行至</th>
                  <th>本月行至</th>
                  <th>倍率</th>
                  <th v-tip="`乘数列:按面积摊的行显面积(㎡)、线路损耗显金额基数(元),其余显用量;
悬浮单元格看原度数。逐行 用量×单价=金额 可心算`">用量</th>
                  <th v-tip="`按能验算的最少位数显示(0.0271 不会被压成 0.03);悬浮看落库原值。
消防/楼层照明/电梯的按面积摊行落库价是电价(元/度),等效元/㎡ 率没落库——此处显 金额÷面积,悬浮该格看说明`">单价</th>
                  <th>金额(元)</th>
                  <th class="l">备注</th>
                  <th v-tip="'取价审计链:price_key/作用域/价目月/判定分支'"></th>
                  <th class="fp-fill" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(r0, i) in utilRows" :key="i">
                  <tr v-if="r0.t === 'band'" class="bn-band">
                    <td :colspan="12" class="l"><span class="bn-band-lbl">{{ r0.label }}</span></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                  <tr v-else-if="r0.t === 'line'">
                    <td><span class="bn-nv dim">{{ r0.no }}</span></td>
                    <td class="l"><span class="bn-txt" :class="{ help: r0.l.feeKey.startsWith('share_') }" v-tip="billFeeTitle(r0.l)">{{ billFeeLabel(r0.l.feeKey) }}</span></td>
                    <td class="l"><span class="bn-txt" :class="{ dim: !r0.l.meterLabel }">{{ r0.l.meterLabel ?? '–' }}</span></td>
                    <td class="l"><span class="bn-txt">{{ segLabel(r0.l.seg) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.prevRead == null }">{{ fmt(r0.l.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.currRead == null }">{{ fmt(r0.l.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.factorSnap == null }">{{ fmt(r0.l.factorSnap) }}</span></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: r0.q.qty == null }" v-tip="r0.q.title ?? undefined">
                        {{ r0.q.unit === '元' ? fmt2(r0.q.qty) : fmt(r0.q.qty) }}<em v-if="r0.q.unit" class="bn-u">{{ r0.q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.priceSnap == null }" v-tip="r0.l.priceSnap != null ? String(r0.l.priceSnap) : undefined">{{ r0.q.price }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r0.l.amount < 0 }">{{ fmt2(r0.l.amount) }}</span></td>
                    <!-- 备注:人工覆盖>引擎;hover 出铅笔(admin),小圆点=有覆盖(悬浮引擎原文,点击恢复) -->
                    <td class="l">
                      <div class="bn-notec">
                        <template v-if="noteEditKey === noteKeyId(r0.nk)">
                          <input v-model="noteDraft" class="bn-nin" :disabled="noteSaving" placeholder="备注(清空保存=恢复引擎备注)"
                            @keydown.enter.prevent="saveNoteEdit(r0.nk)" @keydown.esc.stop="noteEditKey = null" />
                          <button class="bn-nop ok" v-tip="'保存'" :disabled="noteSaving" @click="saveNoteEdit(r0.nk)"><component :is="iconFor('check')" :size="14" /></button>
                          <button class="bn-nop" v-tip="'取消'" :disabled="noteSaving" @click="noteEditKey = null"><component :is="iconFor('x')" :size="14" /></button>
                        </template>
                        <template v-else>
                          <FPMark v-if="archText(r0.l)" tone="warn" class="bn-arch">{{ archText(r0.l) }}</FPMark>
                          <span class="bn-txt dim" v-tip="noteCell(r0.nk, r0.l.note).text || undefined">{{ noteCell(r0.nk, r0.l.note).text }}</span>
                          <span v-if="noteCell(r0.nk, r0.l.note).overridden" class="bn-ndot" :class="{ act: canRun }" v-tip="noteDotTitle(r0.l.note)" @click="restoreNote(r0.nk, r0.l.note)"></span>
                          <button v-if="canRun" class="bn-npen" v-tip="'编辑备注'" @click="startNoteEdit(r0.nk, noteCell(r0.nk, r0.l.note).text)"><component :is="iconFor('pencil')" :size="12" /></button>
                        </template>
                      </div>
                    </td>
                    <td class="ct">
                      <span v-if="auditTitle(r0.l)" class="bn-info" v-tip="auditTitle(r0.l)!">
                        <component :is="iconFor('info')" :size="13" />
                      </span>
                    </td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                  <!-- 合并行(纸单口径:一项一行,多池/多表加总);表/段留 –,构成逐条在悬浮里(表格也挂,
                       用户找「哪几块表相加」时手会落在表列上) -->
                  <tr v-else-if="r0.t === 'merge'">
                    <td><span class="bn-nv dim">{{ r0.no }}</span></td>
                    <td class="l"><span class="bn-txt help" v-tip="r0.m.title">{{ r0.m.label }}</span></td>
                    <td class="l"><span class="bn-txt dim help" v-tip="r0.m.title">–</span></td>
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
                          <button class="bn-nop ok" v-tip="'保存'" :disabled="noteSaving" @click="saveNoteEdit(r0.nk)"><component :is="iconFor('check')" :size="14" /></button>
                          <button class="bn-nop" v-tip="'取消'" :disabled="noteSaving" @click="noteEditKey = null"><component :is="iconFor('x')" :size="14" /></button>
                        </template>
                        <template v-else>
                          <span class="bn-txt dim" v-tip="noteCell(r0.nk, r0.m.note).text || undefined">{{ noteCell(r0.nk, r0.m.note).text }}</span>
                          <span v-if="noteCell(r0.nk, r0.m.note).overridden" class="bn-ndot" :class="{ act: canRun }" v-tip="noteDotTitle(r0.m.note)" @click="restoreNote(r0.nk, r0.m.note)"></span>
                          <button v-if="canRun" class="bn-npen" v-tip="'编辑备注'" @click="startNoteEdit(r0.nk, noteCell(r0.nk, r0.m.note).text)"><component :is="iconFor('pencil')" :size="12" /></button>
                        </template>
                      </div>
                    </td>
                    <td></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                  <tr v-else :class="r0.t === 'part' ? 'bn-part' : 'bn-sub'">
                    <td :colspan="9" class="l">
                      <span :class="r0.t === 'part' ? 'bn-part-lbl' : 'bn-txt dim'">{{ r0.label }}</span>
                    </td>
                    <td><span class="bn-sumc">{{ fmt2(r0.amount) }}</span></td>
                    <td :colspan="2"></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                </template>
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
                  <col :style="{ width: dormElecRoomW + 'px' }" /><!-- 房号:按内容定宽 -->
                  <col style="width:76px" />
                  <col style="width:90px" />
                  <col style="width:90px" />
                  <col style="width:92px" /><!-- 用量:extras 行带单位后缀「5,214.64 ㎡」,76px 会截 -->
                  <col style="width:102px" /><!-- 基准电价:补位到能验平,实测最长 10 字符「0.63586875」(宿舍楼四座338室/保障房2·3号楼),90px 会截 -->
                  <col style="width:74px" />
                  <col style="width:94px" />
                  <col style="width:84px" />
                  <col /><!-- 行末空列 .fp-fill:余宽落这里 -->
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="l">房号</th>
                    <th v-tip="'路灯/绿化水分摊行的面积基数快照'">租赁面积</th>
                    <th>上月行至</th>
                    <th>本月行至</th>
                    <th>用量</th>
                    <th v-tip="'按能验算的最少位数显示;悬浮看落库原值'">基准电价</th>
                    <th v-tip="'电力管理费单价'">管理费</th>
                    <th v-tip="`金额=用量×基准电价 + 用量×管理费,两段各自四舍五入到分后相加(引擎逐行落库口径,
不是用量×两价之和——合并会差 1 分)`">金额(元)</th>
                    <th v-tip="'面积×公摊单价,悬浮该格看算式'">路灯分摊</th>
                    <th class="fp-fill" aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="({ r: r1, c }, i) in dormElecRows" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><div class="bn-notec">
                      <span class="bn-txt" v-tip="r1.room">{{ r1.room }}{{ r1.main.seg ? '·' + segLabel(r1.main.seg) : '' }}</span>
                      <FPMark v-if="archText(r1.main)" tone="warn" class="bn-arch">{{ archText(r1.main) }}</FPMark>
                    </div></td>
                    <td><span class="bn-nv" :class="{ empty: r1.area == null }">{{ fmt(r1.area) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }" v-tip="r1.main.priceSnap != null ? `落库原值 ${r1.main.priceSnap};电费段 ${fmt2(r1.main.amount)} 元` : undefined">{{ c.price }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.mgmt == null }" v-tip="r1.mgmt ? `落库原值 ${r1.mgmt.priceSnap};管理费段 ${fmt2(r1.mgmt.amount)} 元` : undefined">{{ c.mgmt }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }" v-tip="shareTitle(r1.share)">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                  <!-- 配不上间的公摊/损耗行平铺兜底(现状:路灯一行整段/损耗行);乘数与单价照铺,同样逐行可验 -->
                  <tr v-for="({ l, q }, i) in dormElecExtras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :class="{ help: l.feeKey.startsWith('share_') }" v-tip="billFeeTitle(l)">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="3"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: q.qty == null }" v-tip="q.title ?? undefined">
                        {{ q.unit === '元' ? fmt2(q.qty) : fmt(q.qty) }}<em v-if="q.unit" class="bn-u">{{ q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }" v-tip="l.priceSnap != null ? String(l.priceSnap) : undefined">{{ q.price }}</span></td>
                    <td></td>
                    <td><span class="bn-sumc">{{ fmt2(l.amount) }}</span></td>
                    <td></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="9" class="l"><span class="bn-txt dim">宿舍电费小计</span></td>
                    <td><span class="bn-sumc">{{ fmt2(dorm.elec.total) }}</span></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="bn-dwrap">
              <table class="bn-dtable">
                <colgroup>
                  <col style="width:38px" />
                  <col :style="{ width: dormWaterRoomW + 'px' }" /><!-- 房号:按内容定宽 -->
                  <col style="width:90px" />
                  <col style="width:90px" />
                  <col style="width:92px" /><!-- 用量:extras 行带单位后缀「5,214.64 ㎡」,76px 会截 -->
                  <col style="width:90px" />
                  <col style="width:94px" />
                  <col style="width:94px" />
                  <col /><!-- 行末空列 .fp-fill:余宽落这里 -->
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="l">房号</th>
                    <th>上月行至</th>
                    <th>本月行至</th>
                    <th>用量</th>
                    <th v-tip="'按能验算的最少位数显示;悬浮看落库原值'">单价</th>
                    <th v-tip="'金额=用量×单价(四舍五入到分)'">金额(元)</th>
                    <th v-tip="'面积×公摊单价,悬浮该格看算式'">绿化水公摊</th>
                    <th class="fp-fill" aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="({ r: r1, c }, i) in dormWaterRows" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><div class="bn-notec">
                      <span class="bn-txt" v-tip="r1.room">{{ r1.room }}</span>
                      <FPMark v-if="archText(r1.main)" tone="warn" class="bn-arch">{{ archText(r1.main) }}</FPMark>
                    </div></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }" v-tip="r1.main.priceSnap != null ? String(r1.main.priceSnap) : undefined">{{ c.price }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }" v-tip="shareTitle(r1.share)">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                  <tr v-for="({ l, q }, i) in dormWaterExtras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :class="{ help: l.feeKey.startsWith('share_') }" v-tip="billFeeTitle(l)">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="2"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: q.qty == null }" v-tip="q.title ?? undefined">
                        {{ q.unit === '元' ? fmt2(q.qty) : fmt(q.qty) }}<em v-if="q.unit" class="bn-u">{{ q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }" v-tip="l.priceSnap != null ? String(l.priceSnap) : undefined">{{ q.price }}</span></td>
                    <td><span class="bn-sumc">{{ fmt2(l.amount) }}</span></td>
                    <td></td>
                    <td class="fp-fill" aria-hidden="true"></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="7" class="l"><span class="bn-txt dim">宿舍水费小计</span></td>
                    <td><span class="bn-sumc">{{ fmt2(dorm.water.total) }}</span></td>
                    <td class="fp-fill" aria-hidden="true"></td>
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
        <!-- 主动作:确认该户。照稿从列表行上搬进来 —— 判断在抽屉里做出,钮就该在抽屉里。
             ⚠ 确认完**原地留着**(用户 2026-09-23 拍板):单向流转不可逆,自动跳下一户
             会让人来不及看清刚才那一下。下一户由右边的导航自己点。 -->
        <Button v-if="dlgRow && canIssue && statusOf(dlgRow.tenantId) === 'draft'"
                variant="primary" size="sm" :disabled="confirming"
                v-tip="'核对无误,确认该户:确认后重新生成会跳过这户;点错了可以取消确认(要写理由)'"
                @click="confirmTenants([dlgRow.tenantId])">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          {{ confirming ? '确认中…' : '核对无误,确认该户' }}
        </Button>
        <template v-else-if="dlgRow && statusOf(dlgRow.tenantId) === 'confirmed'">
          <span class="bn-ftnote ok">
            <component :is="iconFor('check')" :size="14" />已确认 · 重新生成会跳过这户
          </span>
          <!-- 取消确认(2026-09-23):原来这一档只有一句「不能改回草稿」,点错一户就只剩
               作废或整月重生成两条路,两条都不是「反悔」。理由必填,落审计日志。 -->
          <Button v-if="canIssue" variant="outline" size="sm" :disabled="confirming"
                  v-tip="'取消确认:退回待核对,要写一句理由并留痕。已导出的单退不回来'"
                  @click="unconfirmTenant(dlgRow.tenantId)">
            <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
            取消确认
          </Button>
        </template>
        <template v-else-if="dlgRow && statusOf(dlgRow.tenantId) === 'exported'">
          <span class="bn-ftnote">已导出 · 重新生成会跳过这户</span>
          <!-- 作废并重出(METER-TIMELINE-SPEC §5):已导出的单退不回待核对,错了只能作废后重新生成。理由必填、留痕 -->
          <Button v-if="canIssue" variant="outline" size="sm" :disabled="confirming"
                  @click="voidTenant(dlgRow.tenantId)">
            <template #leading><component :is="iconFor('x-circle')" :size="14" /></template>
            作废
          </Button>
        </template>

        <!-- 单户导出:与「导出通知单」窗口同一套版式(上表租金/下表水电),账户取该公司默认账户 -->
        <Button variant="outline" size="sm" :disabled="dlgLoading || cardBusy || !dlgRow || noAcct"
                v-tip="noAcctTip || '导出本户 Excel:一个文件,上表场地租金、下表水电费;跨收款公司按 sheet 分。账户取各公司的默认收款账户'"
                @click="onExportTenant">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          {{ cardBusy ? '导出中…' : '导出本户 Excel' }}
        </Button>

        <span class="bn-ftsp"></span>

        <!-- 逐户导航:和「确认」挨在一起,核完一户手不用跑回列表 -->
        <span v-if="dlgIdx >= 0" class="bn-nav">
          <button type="button" :disabled="dlgIdx <= 0" @click="stepTenant(-1)" aria-label="上一户">
            <component :is="iconFor('chevron-left')" :size="13" />上一户
          </button>
          <span class="pos"><b>{{ dlgIdx + 1 }}</b> / {{ filtered.length }}</span>
          <button type="button" :disabled="dlgIdx >= filtered.length - 1" @click="stepTenant(1)" aria-label="下一户">
            下一户<component :is="iconFor('chevron-right')" :size="13" />
          </button>
        </span>

        <Button variant="outline" size="sm" @click="dlgOpen = false">关闭</Button>
      </template>
    </FPDrawer>

    <!-- 系数簿窗口(S14):合同/楼栋/年清单与本页同源,生效月默认=当前账期 -->
    <CoefBookWindow :open="coefOpen" :ym="ym" :phase="phase" :contracts="utilContracts"
                    :buildings="buildings" :years="period.dataYears" @close="coefOpen = false" />

    <!-- S20 交付链四窗口:收款公司 / 收款簿 / 导出通知单 / 导出对账表 -->
    <CompanyBookWindow :open="companyOpen" @close="companyOpen = false" @saved="loadCompanies" />
    <PayBookWindow :open="payBookOpen" :ym="noticeYm" :phase="phase" :notices="list"
                   :contracts="placeContracts" :buildings="buildings"
                   @close="payBookOpen = false" @saved="loadPayMap(); loadMonth()" />
    <ExportNoticeWindow :open="expNoticeOpen" :ym="noticeYm" :phase="phase" :notices="list"
                        :contracts="placeContracts" :buildings="buildings"
                        :busy="exportBusy"
                        @close="expNoticeOpen = false" @export="onExportNotice" />
    <ExportReconWindow :open="expReconOpen" :ym="noticeYm" :notices="list" :busy="exportBusy"
                       @close="expReconOpen = false" @export="onExportRecon" />
    <FPElevateDialog
      :page="`催缴单 · ${noticeYm}`" :action="'生成本月催缴单 / 确认签发'" :perms="asking" what="签发催缴单" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`催缴单 ${noticeYm}`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
  </div>
</template>

<style scoped>
.bn-page { position: relative; display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(pl-head 家族) */
.bn-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.bn-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.bn-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* KPI 条(只在 M↓ 渲染;桌面并进了状态页签,画布 05-A) */
.bn-kpis { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; }

/* 第二行:状态页签 + 搜租户名。页签计数是灰字(规范 §1.9「字 + 灰色计数」) */
.bn-toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-tabs :deep(.bn-tabn) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-muted); }
.bn-chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.bn-chk input { accent-color: var(--hue-blue); }
.bn-search { width: 230px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-control); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.bn-search:focus { outline: none; border-color: var(--hue-blue); }

/* ── §5.10 窄档筛选钮 + 筛选面板(只在 M↓ 进 DOM,故不写在媒体块里)────────────────
   44 高是 §6.2 的主操作触达下限,不是 .bn-bulkb 那档 28 —— 这颗是筛选行上唯一的选择器入口。 */
.bn-fbtn { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 14px; box-sizing: border-box; border: 1px solid var(--border-control); border-radius: var(--radius-full); background: var(--surface-white); font-family: var(--font-sans); font-size: 13px; color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
.bn-fbtn:active { background: var(--surface-card); }
/* 已选计数:只数非默认的那几件(期不计,它恒有值) */
.bn-fcnt { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-full); background: var(--hue-blue); color: var(--control-solid-text); font-size: 11px; font-weight: var(--fw-semibold); }
.bn-fpanel { display: flex; flex-direction: column; gap: 18px; }
.bn-ffld { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.bn-flbl { font-size: var(--fs-label); color: var(--text-muted); }

/* ── 表格卡(画布 05-A):卡内工具条 / 选择条 + 表;加载失败与空状态也占在卡里 ── */
.bn-card { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); overflow: hidden; }
.bn-tools { flex: 0 0 auto; }
/* 批量态选择条(画布 05-C):和卡内工具条同高 44 ⇒ 进出批量表格不挪 */
.bn-selbar { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; box-sizing: border-box; background: var(--info-soft); border-bottom: 1px solid var(--border-subtle); }
.bn-selc { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-selnote { font-size: var(--fs-label); color: var(--text-muted); }
.bn-selb { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border: none; border-radius: var(--radius-sm); background: transparent; font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-primary); cursor: pointer; }
.bn-selb:hover { background: var(--surface-card); }

/* ── 列表宽表(pl-table/FPLedgerTable 手法:sticky 表头/tfoot 钉底)。03-C 同一套:40 行高、正文 14、表头 12、
   字左数右、两位小数、不加字距;钱那一列(本期合计)加粗 + 整列浅底 + 表头下蓝线,字不用蓝(规范 §2-29) ── */
.bn-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; }
/* 钱那一列的两种底(03-A / 04-A / 05-A 同形,三屏同一组式子,moneyCol.spec 钉三份一致):
   数据格与合计格 = 浅蓝 60% 叠白 ≈ 画布 (241,247,254);分组行那一格再叠 60% 卡片灰 ≈ (246,248,252) */
.bn-table { --money-cell: color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white)); --money-cell-grp: color-mix(in srgb, var(--money-cell) 40%, var(--surface-card)); border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); font-size: var(--fs-body); }
.bn-table th, .bn-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.bn-table thead th { position: sticky; top: 0; height: 40px; background: var(--surface-card); color: var(--text-muted); font-size: var(--fs-label); font-weight: var(--fw-regular); text-align: right; z-index: 4; white-space: nowrap; }
.bn-table thead th.l, .bn-table td.l { text-align: left; }
.bn-table td.ct { text-align: center; }
.bn-table tbody td { height: 40px; background: var(--surface-white); vertical-align: middle; text-align: right; cursor: pointer; }
.bn-table tbody tr:hover td { background: var(--surface-card); }
.bn-table td.bn-mc { background: var(--money-cell); }
.bn-table thead th.bn-mc { box-shadow: inset 0 -2px 0 var(--hue-blue); color: var(--text-secondary); }
.bn-table .bn-tname, .bn-table .bn-txt, .bn-table .bn-nv, .bn-table .bn-sumc { font-size: var(--fs-body); }
.bn-table .bn-tname { font-weight: var(--fw-regular); }
/* 批量态:能不能勾写在行上 —— 已确认 / 已导出的名字、位置、数字压成次要灰(规则在单元格家族之后);状态签和钱格底色照旧(画布 05-C) */
.bn-table tbody tr.off td { cursor: default; }
/* 问题面板点一条:跳到这一行并闪一下(06-C;同台账深链 row-flash 观感) */
.bn-table tbody tr.flash > td { animation: bn-row-flash var(--dur-highlight) var(--ease-standard); }
@keyframes bn-row-flash { from { background: var(--accent-blue); } }
/* 批量模式选中行(整行点击即切勾选,需要一眼能扫出选了哪些) */
.bn-table tbody tr.sel td, .bn-table tbody tr.sel:hover td { background: rgb(238, 244, 255); }
/* 暗色:表格选中行 --row-selected(DARK-MODE-SPEC §5);浅色那格照旧 */
:root[data-theme="dark"] .bn-table tbody tr.sel td, :root[data-theme="dark"] .bn-table tbody tr.sel:hover td { background: var(--row-selected); }
/* 账外户视觉降淡(出单不入应收) */
.bn-table tbody tr.offbook { opacity: .55; }
.bn-table tbody tr:last-child td { cursor: default; }
/* 楼栋分组行兼小计(画布 05-A,和另两屏同形):卡片灰底、没有粗上边;组名 14 加粗 + 户数 12 灰;
   钱格混灰底,两列小计次要色、常规字重(比数据行的钱轻一档);组小计对齐「本期合计」「月租金参考」两列,点它收起 */
.bn-table tr.bn-band td, .bn-table tbody tr.bn-band:hover td { height: 40px; background: var(--surface-card); }
.bn-table tr.bn-band td.bn-mc, .bn-table tbody tr.bn-band:hover td.bn-mc { background: var(--money-cell-grp); }
.bn-gbtn { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 0; border: none; background: transparent; cursor: pointer; font-family: var(--font-sans); color: var(--text-primary); }
.bn-gbtn .cv { flex: none; color: var(--text-muted); }
.bn-gbtn .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: var(--fs-body); font-weight: var(--fw-semibold); }
.bn-gbtn .n { flex: none; font-size: var(--fs-label); color: var(--text-muted); }
/* 跨楼栋轻标记(悬浮列全部楼栋) */
.bn-xb { margin-left: 6px; padding: 1px 5px; border-radius: var(--radius-full); background: var(--surface-sunken); font-style: normal; font-size: 10.5px; color: var(--text-muted); cursor: help; }
.bn-xb:hover { color: var(--hue-blue); }
.bn-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); cursor: default !important; }
.bn-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 44px; font-weight: var(--fw-semibold); background: var(--surface-card); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); text-align: right; }
.bn-table tfoot th.l { text-align: left; }
.bn-foot-lbl { display: block; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
/* 合计数字加粗、不用品牌蓝(datagrid 合计行,2026-09-30 改) */
.bn-foot-v { display: block; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.bn-table .bn-foot-lbl, .bn-table .bn-foot-v { font-size: var(--fs-body); }
/* 合计行(05-A):44 高、卡片灰底,钱那一格同数据格、合计数 16;月租金合计照 14 */
.bn-table tfoot th.bn-mc { background: var(--money-cell); }
.bn-table tfoot th.bn-mc .bn-foot-v { font-size: 16px; }

/* 单元格家族(pl 同款) */
.bn-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt.dim { color: var(--text-muted); }
/* 公摊费项名可悬浮看来源(同 .bn-info 手法:cursor:help + hover 变蓝) */
.bn-txt.help { cursor: help; }
.bn-txt.help:hover { color: var(--hue-blue); }
.bn-nv { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-nv.empty, .bn-nv.dim { color: var(--text-disabled); }
.bn-u { font-style: normal; font-size: var(--fs-micro); color: var(--text-muted); margin-left: 2px; }   /* 刀D 乘数单位后缀 */
.bn-sumc { display: block; text-align: right; font-weight: var(--fw-semibold); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bn-sumc.neg { color: var(--hue-red); }
/* 这两条压在单元格家族上面,写在它们之后(同特指度时 jsdom 按先后算,放后面两边一致):
   分组行两列小计次要色、常规字重(05-A);批量态不可勾的行字压成次要灰(05-C) */
.bn-table tr.bn-band .bn-sumc, .bn-table tr.bn-band .bn-nv { font-weight: var(--fw-regular); color: var(--text-secondary); }
.bn-table tbody tr.off .bn-tname, .bn-table tbody tr.off .bn-txt, .bn-table tbody tr.off .bn-sumc, .bn-table tbody tr.off .bn-nv { color: var(--text-muted); }

/* S20 交付链:勾选列/状态签/行内确认按钮 */
.bn-ckc { width: 34px; }
.bn-ckc input { width: 15px; height: 15px; accent-color: var(--hue-blue); vertical-align: -2px; }
.bn-stc { white-space: nowrap; }
/* 状态签四色照画布 05-A:待核对灰 / 部分确认黄 / 已确认绿 / 已导出蓝 */
.bn-st { display: inline-block; padding: 1px 7px; border-radius: var(--radius-xs); font-size: var(--fs-label); line-height: 20px; font-weight: var(--fw-medium); }
.bn-st.draft { background: var(--surface-sunken); color: var(--text-muted); }
.bn-st.confirmed { background: var(--ok-soft); color: var(--ok-text); }
.bn-st.exported { background: var(--info-soft); color: var(--info-text-on-tint); }
.bn-st.partial { background: rgb(255, 242, 207); color: rgb(125, 92, 0); }
:root[data-theme="dark"] .bn-st.partial { background: var(--caution-soft); color: var(--caution-text); }
.bn-cfm { visibility: hidden; margin-left: 8px; height: 22px; padding: 0 10px; border: none; border-radius: var(--radius-full); background: var(--control-solid); font-family: var(--font-sans); font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--control-solid-text); cursor: pointer; }
.bn-cfm:hover { background: var(--control-solid-hover); }
tbody tr:hover .bn-cfm { visibility: visible; }
/* 警告格:首类签 + 灰色 +N;行尾 › 是「点整行开明细」的提示 */
.bn-wc { display: flex; align-items: center; gap: 6px; min-width: 0; }
.bn-wcell { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 6px; }
.bn-wtag { flex: 0 1 auto; min-width: 0; padding: 1px 7px; border-radius: var(--radius-xs); background: var(--warn-soft); color: var(--orange-text); font-size: var(--fs-label); line-height: 20px; white-space: nowrap; }
.bn-wmore { flex: none; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); }
.bn-go { flex: none; color: var(--text-disabled); }

/* ── 抽屉:户头 + 两 tab 明细行表(md-htable 家族) ── */
.bn-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.bn-hgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 18px; margin-bottom: 12px; }
/* 三格档(抽屉):上期欠费降格成小字之后,位置那一格宽出来能多显十来个字 */
.bn-hgrid.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.bn-hfld { min-width: 0; }
.bn-hfld label { display: block; margin-bottom: 4px; font-size: var(--fs-label); color: var(--text-muted); }
/* 时效说明:另起一行、弱化 —— 混在同色同字号的条目里会被读成「又一条查出来的毛病」 */
.bn-warn-when { display: block; margin-top: 6px; font-size: var(--fs-label); font-style: normal; opacity: .72; }
/* 方格下的实时说明行:抽屉 body 是 flex gap,负 margin 把它收到方格底下而不是另起一段 */
/* ── 抽屉头:告警徽标(照稿 2026-09-23) ──────────────────────────────────
   长在 FPDrawer 的 #submeta 槽里,和副标题同一行。那一行本来就在 ⇒
   有告警没告警抽屉一样高,不会一换户就上下弹。 */
.bn-abadge {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box;
  height: 24px; padding: 0 8px 0 7px; border: 1px solid var(--status-warning); border-radius: var(--radius-full);
  background: var(--warn-soft); color: var(--status-warning);
  font-family: var(--font-sans); font-size: var(--fs-label); font-weight: var(--fw-medium);
  cursor: pointer; white-space: nowrap;
}
.bn-abadge:hover { background: var(--caution-soft); }
.bn-abadge.on { background: var(--hue-orange); color: var(--text-on-solid); }
.bn-abadge b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

/* 点开那一类(画布 01-C 浮层):明细 + 落点链一行,底下一句时效。条目折行不截断 */
.bn-apanel { display: flex; flex-direction: column; }
.bn-arow { display: flex; align-items: baseline; gap: 12px; padding: 7px 10px; border-radius: var(--radius-sm);
           background: var(--surface-sunken); font-size: var(--fs-body); line-height: 20px; }
.bn-arow .val { flex: 1 1 auto; min-width: 0; color: var(--text-primary); overflow-wrap: anywhere; }
.bn-arow .go { flex: 0 0 auto; font-size: var(--fs-label); color: var(--text-link); text-decoration: none; }
.bn-arow .go:hover { text-decoration: underline; }
.bn-apanel .when { display: block; margin-top: 6px; padding: 8px 10px 2px; border-top: 1px solid var(--divider);
                   font-style: normal; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); }

/* 头部三格的副行小字(上期欠费 / 月租金口径) */
.bn-hsub { display: block; margin-top: 3px; font-style: normal; font-size: var(--fs-micro);
           color: var(--text-muted); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

/* ── 抽屉底部动作条 ───────────────────────────────────────────────────── */
.bn-ftsp { flex: 1 1 auto; }
.bn-ftnote { display: inline-flex; align-items: center; gap: 6px; height: 30px;
             font-size: var(--fs-label); color: var(--text-muted); }
.bn-ftnote.ok { color: var(--ok-text); }
/* 逐户导航:和「确认」挨在一起,核完一户手不用跑回列表 */
.bn-nav { display: inline-flex; align-items: center; gap: 4px; }
.bn-nav button {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 9px;
  border: 1px solid var(--border-control); border-radius: var(--radius-sm);
  background: var(--surface-white); font-family: var(--font-sans); font-size: var(--fs-label);
  color: var(--text-secondary); cursor: pointer;
}
.bn-nav button:hover:not(:disabled) { border-color: var(--border-control-strong); color: var(--text-primary); }
.bn-nav button:disabled { color: var(--text-disabled); cursor: default; }
.bn-nav .pos { padding: 0 8px; font-family: var(--font-mono); font-variant-numeric: tabular-nums;
               font-size: var(--fs-label); color: var(--text-muted); }
.bn-nav .pos b { color: var(--text-primary); font-weight: var(--fw-semibold); }
.bn-hfld span { font-size: var(--fs-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.bn-hfld .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.bn-hfld .dim, .bn-hfld .mono.dim { color: var(--text-disabled); }

/* flex:0 0 auto——fp-dwr-body 是定高 flex 列,不禁 shrink 各表会被等比压扁出内部滚动条(2026-08-05 报障);
   整卡只留 body 一条滚动,overflow:auto 仅兜横向 */
.bn-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: auto; flex: 0 0 auto; }
.bn-hgrid, .bn-dsec, .bn-grand { flex-shrink: 0; }
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
/* 档案现归 X(METER-TIMELINE-SPEC §5):这块表本月档案挂的不是本单这户。就地标记(FPMark),字写明现归谁 */
.bn-arch { flex: 0 0 auto; }
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

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.4 colgroup 定宽表:列一根不动,窄了在 .bn-wrap 内横滚)──
   宽档规则在前窄档在后(§1)。根挂 fp-fluid 摘地板后,窄档兜底从「整屏 800px」换成
   「KPI/工具行流式收纳 + 只有表自己保底横滚」。

   § S 档 390 屏顶算术(§5.7 + §5.10 收完之后,表能露几行)——数字来源逐条:
     FPStepStrip  54   .fss--s 定高(§5.9,组件里已实现,本轮没动)
     gap          14   .bn-page gap
     .bn-head     30   屏名与期段控不进 DOM,左只剩 FPAlertChip(.fac 30 高),
                       右只剩 审核簇 28 + ⋯ 30 ⇒ 行高 30
                       (编辑模式这一轮搬进手机顶栏,行上不再有它;行高不变 —— 原来也是 ⋯ 那 30 在定)
     gap          14
     .bn-kpis     92   横滑一行(原 196 = 2×92 + 12)
     gap          14
     .bn-toolbar  44   搜索 44 + 筛选钮 44 一行(原 74:复选 + 批量确认 + 230 搜索折两行)
     ────────────────
     屏顶合计    262   (原 556;体检文档记的 572 是 §5.9 定高落地之前量的)
     表可用 = 首屏 655 − 262 = 393
     表头 34(.bn-table thead th)+ tfoot 40(.bn-table tfoot th)= 74
     (393 − 74) ÷ 34(行高)= 9.38 → **9 行**(原 (99−74)÷34 = 0.7 → 0 行)
   ⚠ 9 行是上限:真数据里每个楼栋有一条 .bn-band 分组头,也按 34 占一行。

   § M 档 768×1024 竖屏屏顶算术(平板落 M,§3.5):
     内容带 = 1024 − .fp-stage padding 8×2 − .fp-main-card 边框 2 − TabStrip 44
              − Toolbar 48 − .fp-content padding 16×2 = 882
     FPStepStrip  54   .fss--m 是 flex-wrap:nowrap 的横滑全条(§5.9),一行药丸,按与 .fss--s
                       同构的一行高计 —— M 档组件里没有定高声明,这 54 是推算不是断言
     gap          14
     .bn-head     30   屏名/期段控不进 DOM;左 FPAlertChip 30,右 审核簇 28 + 编辑模式 28 + ⋯ 30
                       (编辑态多一颗生成 28;601 那一端右组可能仍折 2 行 ⇒ 屏顶 +38、表少 1 行)
     gap          14
     .bn-kpis     92   与 S 同一条横滑轨(原 2 列 = 196)
     gap          14
     .bn-toolbar  44   搜索 230 + 筛选钮 —— 两件同处一行
     ────────────────
     屏顶合计    262
     表可用 = 882 − 262 = 620;(620 − 74) ÷ 34 = 16.05 → **16 行**
   § XL:不在 §5.10 收编范围,标题行/筛选行/KPI 四列一个像素不动(§9)。 */
@media (max-width: 960px) { /* M↓ */
  /* §5.7 屏顶 KPI 卡行:**按卡片数分档,不按视口分**。本屏 4 张 ⇒ 3–4 张那一档 =
     横滑胶囊行(≥5 张才「先砍再排」)。几何照抄 mx-list.css 的 .mx-kpirail:
     定宽 140 不换行、隐滚动条但留触屏拖动。M 与 S 同一条,S 档沿层叠继承,不在 600 块重写。

     ⚠ 上一轮这里写的是 `repeat(2, minmax(0, 1fr))`(两列),判据是「四列 636px 在 M 档
     多数区间必溢出」—— 那条判据本身没错,错在它算的是**降列**这一种收法。降列换来的是
     竖向占位:两列 = 92×2 + 12 = 196px,横滑一行只要 92px,而 §5.7 的验收标准是
     「收完之后主内容能不能进首屏」,不是「卡片挤不挤」。
     另一条同样重要:§3.5-pre 要求 M 档**行组成静态确定**,不许靠 flex-wrap 在一行两行之间跳
     —— `flex-wrap: nowrap` 的轨在 601 与 960 上都是恰好一行 92px,两列 grid 在 M 档
     恰好是那种会跳的写法(4 张时永远 2 行,5 张时 3 行)。 */
  .bn-kpis { display: flex; flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .bn-kpis::-webkit-scrollbar { display: none; }
  .bn-kpis > * { flex: 0 0 140px; }
  /* 140 宽扣掉卡内 padding 只剩 112:「月租金合计(参考,元)」这类标签在 FPStat 里是
     white-space:nowrap 且**没有** overflow —— 不截会直接压到右边那张卡上。只补省略号,不改 FPStat。 */
  .bn-kpis :deep(.fs-l) { overflow: hidden; text-overflow: ellipsis; }
  /* §5.10:M↓ 筛选行收成「搜索 + 一颗筛选钮」。两件同处一行,高度必须同档 ——
     筛选钮定 44(§6.2 主操作触达下限),搜索框跟上。判据是触屏不是视口:平板也是触屏,
     所以这一条从 600 提到 960(同 mx-list.css:44 那条分页器触达的理由)。
     字号不在这一档动 —— 16px 是 §6.5 的 iOS 聚焦不缩放门槛,只写在 S 块。 */
  .bn-search { height: 44px; }
  /* 主表保底:table-layout:fixed + width:100% 下,容器窄于定宽列合计(820,批量态+36=856)时
     「位置」列(放不下时它回到吸收剩余,见 locTight)会被压到 0px。给表 980px 兜底,位置列至少 124–160px,
     只挂在放不下(.bn-tight)时:放得下时位置按内容定宽,保底宽多出来的会全落进行末空列,横滚看到的是空白(2026-10-02)。
     多出的宽度由 .bn-wrap(overflow:auto)横滚消化。限 M↓:961–1100 视口的 L 档
     今天就不横滚,无条件写会造出 §8 点名的那种 L 档回归。
     (2026-10-01 画布 05-A 删「行数」列、警告列写类名 210 宽,定宽合计 770 → 820,兜底 920 → 980) */
  .bn-table.bn-tight { min-width: 980px; }
  /* 03-C 的 40 行高只到桌面:三屏的 S/M 分支这次不动(规范 §2-21),下面屏顶算术的 34 是它 */
  .bn-table thead th, .bn-table tbody td, .bn-table tr.bn-band td, .bn-table tbody tr.bn-band:hover td { height: 34px; }
  .bn-table tfoot th { height: 40px; }
  .bn-table tfoot th.bn-mc .bn-foot-v { font-size: var(--fs-body); }
}
@media (max-width: 600px) { /* S */
  /* §5.7 的横滑胶囊轨写在上面的 960 块里(M 与 S 同一条,4 张卡两档都走横滑),
     这里沿层叠继承,一个字不重写。92 = FPStat 上下 padding 12×2 + 标签 18 + gap 4
     + 数字 26 + gap 4 + sub 16。 */

  /* 搜索框弹性收窄(照 mx-list 搜索框手法),390 视口不撑破工具行;
     高度在上面的 960 块已定 44,这里只补 §6.5 的 iOS 门槛:<16px 聚焦会把整页放大,表当场出屏。 */
  .bn-search { flex: 1 1 160px; width: auto; min-width: 0; font-size: var(--fs-input-m); }
  /* 横滚定位锚:首列(租户;批量态连同 36px 勾选列)sticky left,表头/tfoot 同步钉住。
     z 值照 PoolLedgerView .pl-fix 阶梯(体 3 / 头 8 / 脚 7)——表内 sticky 的平级冲突,
     不属于七级阶梯的覆盖层令牌档。§5.3:390 视口只钉一根,多钉会占满屏。 */
  .bn-table th.bn-c1, .bn-table td.bn-c1,
  .bn-table th.bn-ckc, .bn-table td.bn-ckc { position: sticky; left: 0; z-index: 3; }
  .bn-table thead th.bn-c1, .bn-table thead th.bn-ckc { z-index: 8; }
  .bn-table tfoot th.bn-c1, .bn-table tfoot th.bn-ckc { z-index: 7; }
  /* 批量态勾选列钉最左,租户列按勾选列 col 宽(36px)顺移 */
  .bn-table.bulk th.bn-c1, .bn-table.bulk td.bn-c1 { left: 36px; }
}
@media (hover: none) { /* 触屏(§6.1):hover 显形控件常显,不可达=功能丢失 */
  .bn-cfm { visibility: visible; }
  .bn-npen { visibility: visible; }
}
</style>
