<script setup lang="ts">
// 楼栋损耗(POOL-ENGINE-SPEC §6,S3-B1 刀2)— 新路由 /alloc-loss,紧随公共电核算。
// FPLedgerTable 手法(sticky 首列/34px 行/mono 空值'–'/tfoot 钉底);行数≤20 不虚拟滚动。
// units=本月算出来的楼栋损耗;对账区=读时派生(见 buildLossReconRows),单元行后接续渲染。
// S21(S21-PARAM-CENTER-SPEC §5.6):本屏**唯一的写入口是「备注」这一列**(2026-09-23 用户要求)——
// 除备注外每一格都是引擎算出来的派生值,一格都不能在这里改:损耗调整度数/损耗率加点两格是只读镜像
// (带「仅本月/长期」徽标、点击跳「计费参数」页 /params 改),改完回参数页「重算本月」才会变。
// G 格悬浮给分解式「(a + b + …) ÷ 6 = G」;手工率覆盖时收取率并排显公式率。
// 编辑态(EDIT-MODE-SPEC v3)只为备注这一个格开:占的是出账链那把 billing-chain 月锁(与计费参数 /
// 公共电核算 / 催缴单同一把,CONCURRENCY-SPEC §3.2),审核键 alloc-loss:{ym}(与公共电核算屏同一把)。
// 屏级告警(LAYOUT-STABILITY-SPEC §6,2026-08-25):「改过参数还没重算」原为头部流内橙条(顶动表格且清不掉),
// 改为工具条上的常驻 chip + 贴着它的问题面板「待重算」组(2026-10-01);判定逻辑不变,仍是 staleText(status,'pool')。
// 组头动作照公共电核算:编辑态「重算本月」(allocApi.generate,池与损耗同批),浏览态「进入编辑模式」。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { allocApi, type AllocLossDTO, type AllocLossUnitDTO } from '@/api/alloc'
import { paramsApi, type ParamRowDTO, type ParamStatusDTO } from '@/api/params'
import { buildLossReconRows, lossFooter } from '@/utils/poolLedgerLogic'
import { zoneLabel } from '@/utils/zoneLabel'
import { rangeBadge, staleText, staleWho } from '@/utils/paramCenterLogic'
import { S } from '@/utils/lockScopes'
import { onReactivated } from '@/composables/onReactivated'
import { useChainDeepPeriod } from '@/composables/useDeepPeriod'
import { useEditMode } from '@/composables/useEditMode'
import { minTableH, textW, useWideTable, type HeightDims, type WideCol } from '@/composables/useWideTable'
import { useTabsStore } from '@/stores/tabs'
import { useZonesStore } from '@/stores/zones'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { chainStepsOf } from '@/nav/billingChain'
import { iconFor } from '@/components/ds/icon'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import { ask } from '@/utils/ask'
import { receipt } from '@/utils/receipt'
import Button from '@/components/ds/Button.vue'
import Segmented from '@/components/ds/Segmented.vue'

const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fpct = (r: number | null | undefined) => (r == null ? '–' : (r * 100).toFixed(2) + '%')

// ── 账期:出账链组级(stores/billingPeriod,2026-08-28 设计稿 §3.1) ──
// 顶栏那对年月 Select 已撤 —— 期由出账月矩阵一处选定,五屏共读。本屏只在选过期后渲染表格。
const period = useBillingPeriodStore()
const year = computed(() => period.year ?? 0)
const month = computed(() => period.month ?? 0)
const ym = computed(() => period.ym ?? '')
// 链路条:本月各道工序走到哪(格子与条上同一份数据)
const chainSteps = computed(() => chainStepsOf(period.cellOf(ym.value)))
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM(或旧 ?ym=)直落该月,pick + loadChain;本屏只读、无草稿,不传 dirty。
// 必须在下面的 onMounted / watch / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于状态刷新改期。
useChainDeepPeriod()
const zone = ref<string>('p1')
const zones = useZonesStore()
onMounted(() => zones.ensure())
// 宿舍无损耗单元(后端 AllocService.lossGroups() 第一道过滤就排 dorm,行号随改动漂移故不写死)。
// 期区清单接口化之后必须在这里主动排掉,否则会多出一个恒空的宿舍 tab,
// 把一个刻意的设计读成一个 bug。
const ZONE_OPTS = computed(() => zones.list.filter(z => z.code !== 'dorm')
  .map(z => ({ value: z.code, label: z.name })))

// ── 编辑模式(EDIT-MODE-SPEC v3):本屏只为「备注」这一列开 ──
// 放在 useChainDeepPeriod() 之后:期先落定,scope 闭包求值时 year/month 已是用户选中的那个月
// (反序会占到 `billing-chain:0-00`);而 !period.picked 时整条工具条根本不渲染(下面是选期矩阵),
// 所以也点不到编辑按钮。
/** 弹卡标题用审核键那张表的人话名,不是屏名 —— 人拿着屏名在待审清单里一个都搜不到。 */
const reviewLabel = computed(() => `楼栋损耗 · ${ym.value}`)
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken, reviewNote, reviewTip, reviewKeys } =
  useEditMode(['billing-run:edit'], {
    // 楼栋损耗与公共电核算是 AllocService.generate(ym) 同一批算出来的,共占出账链那把月锁
    // (CONCURRENCY-SPEC §3.2)——不新开 `alloc-loss:*` 锁。
    scope: () => S.poolLedger(year.value, month.value),
    // 审核键:与公共电核算屏压的第二把同一个(那屏压 alloc + alloc-loss 两把)。
    // 本屏只写 alloc_loss_note(楼栋损耗这个月的一部分),不碰 alloc_pool_result,所以只认这一把
    // —— 与后端 saveLossNote 只守 ReviewKind.ALLOC_LOSS 一致。
    reviewKey: () => (ym.value ? `alloc-loss:${ym.value}` : null),
    // 改动数(EDIT-MODE §6.1):备注逐格 @change 即时写库,没有草稿 —— 恒 0,关页签不问(不传会按 1 算)
    dirty: () => 0,
  })
// 告警面板是 FPAlertPanel(Teleport to body):子树随 KeepAlive 停用消失,它不消失,会盖在下一个屏上。
onDeactivated(() => { alertOpen.value = false })
// ⚠ 本屏没有「编辑态才存在的弹窗 / 行内编辑行」要在 watch(editMode) 里收:唯一的写控件是备注那格的
//   <input>,它的 v-if 直接判 editN(内含 editMode),编辑态一转假 input 就从 DOM 里消失。
//   真正拦下写请求的仍是 commitNote 第一行那句自守 —— 收控件只是 UI 补丁。

// ── 数据(竞态守卫):损耗快照 + 本 zone 栋级参数(只读徽标用,只拉三个键几十行)+ 参数状态(stale 条) ──
const loss = ref<AllocLossDTO | null>(null)
const params = ref<ParamRowDTO[]>([])
const status = ref<ParamStatusDTO | null>(null)
/** 本月损耗数据没读到。独立错误槽 —— 不拿 loss===null 兼任,那是「读到了,本月还没算过」。 */
const loadErr = ref<string | null>(null)
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
let seq = 0
async function loadMonth() {
  const my = ++seq
  let err: string | null = null
  const [ls, ps, st] = await Promise.all([
    allocApi.loss(ym.value).catch(e => { err = errMsg(e, '读取失败'); return null }),
    paramsApi.list(ym.value, zone.value, { scope: 'building:', key: 'loss_adj_qty,loss_adj_rate,loss_rate_manual' })
      .catch(() => [] as ParamRowDTO[]),
    paramsApi.status(ym.value).catch(() => null),
  ])
  if (my !== seq) return
  // 失败时把表清空,不拿上一个月的数字顶替(同 PoolLedgerView / ElecCostView);
  // 错误**只在成功分支清** —— 在开头先清会让失败态一闪而过,用户只看到表空了不知道为什么。
  loss.value = ls; params.value = ps; status.value = st
  loadErr.value = err
}
// 默认账期那一整套(years + /loss-months + latestPeriodOf 的 snap)随年月下拉一起退场:
// 现在期一定是用户在矩阵上点出来的,没有「系统替你猜一个月」这回事。
onMounted(() => { if (period.picked) loadMonth() })
watch([ym, zone], () => { if (period.picked) loadMonth() })
// 页签切回:参数页那边可能刚重算过 —— 池快照时间变了就整月重拉(数字与 stale 条一起变新),没变只刷状态
// (回包前若已换月(seq 变了)就丢弃,别让旧月 status 盖住新月的 stale 条)
onReactivated(async () => {
  if (!period.picked) return   // 还没选期(主区是选期矩阵):ym 是 '',后端按格式校验直接 400
  const my = seq, before = status.value?.poolSnapshotAt
  const st = await paramsApi.status(ym.value).catch(() => null)
  if (my !== seq || !st) return
  if (st.poolSnapshotAt !== before) loadMonth()
  else status.value = st
})

const generated = computed(() => loss.value?.generated ?? false)
const units = computed(() => (loss.value?.units ?? []).filter(u => u.zone === zone.value))
// ⚠ filter 不是 find:后端一个期区发 1~2 条(第二条=把独立供电的栋并回来的「全部楼栋」),
//   取 find 就只画得出前两行,而第二条正是「屏上没一个字说 A座 不在对账里」那个洞的补法。
const reconRows = computed(() =>
  buildLossReconRows((loss.value?.recon ?? []).filter(r => r.zone === zone.value)))
const foot = computed(() => lossFooter(units.value))
const staleMsg = computed(() => staleText(status.value, 'pool'))

// ── 备注(本屏唯一的写口) ──
// `&& !loadErr`:没读到本月现状时表里逐格是'–'的假底,放行编辑 = 对着空行写备注,
// 而那一行的 headBuildingId 根本没落进这个月(照 PvMeterView 三轮复查后的形状)。
const editN = computed(() => editMode.value && !loadErr.value)
function commitNote(u: AllocLossUnitDTO, raw: string) {
  if (!editN.value) return          // ← 第一行,在一切早退分支之前。按钮的 :disabled 只是视觉
  const prev = loss.value
  if (!prev) return
  const my = seq
  const note = raw.trim()           // 空串=删掉备注(后端 deleteNote,幂等)
  if (note === (u.note ?? '')) return   // 没变就不发请求
  loss.value = { ...prev, units: prev.units.map(x =>
    x.headBuildingId === u.headBuildingId ? { ...x, note: note || null } : x) }   // 乐观更新
  allocApi.saveLossNote({ ym: ym.value, headBuildingId: u.headBuildingId, note })
    .catch(e => {
      // 回包前已换月/换期(seq 变了)就不回滚 —— 那份 prev 是上一个月的表
      if (my !== seq) return
      loss.value = prev
      receipt.fail(errMsg(e, '备注保存失败'), { label: '重试', run: () => commitNote(u, note) })
    })
}

// 列模型(LAYOUT-STABILITY-SPEC §1/§3:切筛选/换期不许变列数):铝缆、公摊分摊度数两列常驻两期,
// 不适用的期区显'–'(与 .ll-nv 已有的 null 处理一致)——不再按 isP2 / zone==='p1' 摘列。
// 基础 9 列(位置/总表/分表/损耗量/原率/调整度/调整损/收租率/备注)+ 铝缆(常驻)+ 公摊度数(常驻)
const colCount = 11
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
// 固定列与表格高度(LIST-PAGE-SPEC §9;07-C 楼栋损耗行):只有「位置」一根(名称列,rank 0),不再锁 360。
// 按最长的名字估宽,不量 DOM:单元行名 + 核算方式签(「仅按公摊分摊度数」108 /「不核算」53)、对账行名、合计;
// 封顶表格可见宽的 1/5,超了省略、悬停看全称。换期区 / 换月(units 换了)按新数据重算。
// 封顶的下限 = 3 个字 + 核算方式签:签不缩,手机档 1/5 只有 71,不设下限名字会被签挤成 0 宽、悬停也碰不到。
// 本表没有分组表头(grpH 0):不够 8 行先让合计不贴底,再不够给表格区 min-height、整页往下滚。
const LOSS_H: HeightDims = { grpH: 0, leafH: 38, rowH: 34, footH: 40 }
const VAR_W: Partial<Record<AllocLossUnitDTO['variant'], number>> = { share_only: 108, none: 53 }
const lblW = (s: string) => textW([s], 12.5, 20)
const lblCols = computed<WideCol[]>(() => [{
  key: 'lbl', side: 'L', rank: 0, name: true,
  w: Math.max(lblW('合　计'), ...reconRows.value.map(r => lblW(r.label)),
    ...units.value.map(u => lblW(u.label) + (VAR_W[u.variant] ?? 0))),
  minW: Math.max(0, ...units.value.map(u => lblW('三个字') + (VAR_W[u.variant] ?? 0))),
}])
const wrapEl = ref<HTMLElement | null>(null)
const { fix, nameW, hStage, sbH } = useWideTable(wrapEl, lblCols, LOSS_H, units)
const fixLbl = computed(() => ({ ...w(nameW.value), ...fix.value.style.lbl }))
const wrapSt = computed(() => (hStage.value === 3 ? { minHeight: minTableH(LOSS_H) + sbH.value + 'px' } : undefined))

// ── 只读镜像:格里的数是快照(生成时用的值),徽标是**当前生效**参数的生效方式(仅本月 / 长期);两者不一致时 stale 条会亮 ──
// LIST-PAGE-SPEC §8:模板里每格 4 次调用,徽标对象按 (栋,键) 在 computed 里建一次 Map,模板只 get(不在渲染里线性 find + new 对象)
interface ParamBadge { text: string; tone: 'month' | 'from' | 'inherit'; title: string }
const badges = computed(() => {
  const m = new Map<string, ParamBadge>()
  for (const r of params.value) {
    if (r.mode == null) continue
    const b = rangeBadge(r)
    m.set(`${r.scope}|${r.key}`, { text: b.tone === 'month' ? '仅本月' : '长期', tone: b.tone, title: `${r.rangeText} · 点击去计费参数页改` })
  }
  return m
})
const badgeOf = (buildingId: number, key: string) => badges.value.get(`building:${buildingId}|${key}`) ?? null
// G 悬浮分解式(spec §4.1):「(45.28 + 59.57 + 138.33 + 893.01 + 1195.53) ÷ 6 = 388.62」,分项=池名+本次算出来的该池用电量
// (算式里不加千分位:「1,195.53 + …」的逗号会和加号打架)
const plain = (v: number | null | undefined) => (v == null ? '–' : String(v))
const gTitle = (u: AllocLossUnitDTO) => {
  const parts = u.gParts ?? []
  if (!parts.length || u.gDiv == null) return '公摊分摊度数 = 一期各个园区公共用电池本月的用电量加起来 ÷ 均摊栋数（四舍五入到 2 位），各栋同值；本月还没算过'
  return `公摊分摊度数 = 一期各个园区公共用电池本月的用电量加起来 ÷ 均摊栋数（四舍五入到 2 位），各栋同值\n`
    + `（${parts.map(p => plain(p.qty)).join(' + ')}）÷ ${plain(u.gDiv)} = ${plain(u.gQty)}\n`
    + parts.map(p => `${p.name}：${plain(p.qty)}`).join('\n')
}
// 收取损耗率:手工指定时并排显公式率(spec §4.2 快照同时保存两者)
const rateTitle = (u: AllocLossUnitDTO) => u.manualRate != null
  ? `损耗率（手工指定）${fpct(u.manualRate)}（公式算出 ${fpct(u.formulaRate)}）—— 手工指定的率在计费参数页按月填`
  : undefined

// ── 跳参数页(深链协议:KeepAlive 缓存实例只在 setup 消费 query,必须 openFresh) ──
const router = useRouter()
const tabs = useTabsStore()
const alertOpen = ref(false)
// edit=1:[去重算] 落地直接进编辑态(重算按钮只在编辑态出)
function gotoParams(section: 'monthly' | 'constant' | 'rule', edit = false) {
  alertOpen.value = false   // 抽屉里点走的:本屏被 KeepAlive 缓存,不关的话切回来抽屉还盖着
  tabs.openFresh('params', { pin: true })
  router.push({ path: '/params', query: { ym: ym.value, zone: zone.value, section, ...(edit ? { edit: '1' } : {}) } })
}

// ── 重算本月(问题面板「待重算」组头,只在编辑态出) / 生成本月(空状态按钮,本月还没算、编辑态出):
//    与公共电核算「生成本月 / 重新生成」同一个 allocApi.generate ——
//    楼栋损耗与池核算是同一批算出来的,共占同一把月锁。备注落独立表,重算不丢。
const generating = ref(false)
async function onRecalc() {
  // 写口自守,在一切早退分支之前:浏览态 / 没读到本月现状(蒙着眼覆盖)/ 在途 一律打不出去。组头按钮的 busy 只是视觉
  if (!editMode.value || generating.value || loadErr.value) return
  const at = ym.value
  // 没生成过就没有可盖掉的数字,不问(与公共电核算 onGenerate 同口径)
  if (generated.value && !(await ask({
    title: `重算 ${at}？`,
    body: '这个月的公共电核算和楼栋损耗会整个按现在的参数和读数重算一遍，原来的数字会被盖掉；备注不受影响。',
    action: '重算本月',
  }))) return
  // 等回答的这段时间里可能被接管、换了月 —— 再守一遍,不拿这次「确认」去盖别的月
  if (!editMode.value || generating.value || loadErr.value || ym.value !== at) return
  generating.value = true
  try {
    await allocApi.generate(at)
    await loadMonth()
    // 生成改的正是矩阵格子上的点(池/损耗亮起、stale 清掉)—— 换出账月时要立刻看得见
    void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
  } catch (e) {
    receipt.fail(errMsg(e, '重算失败'), { label: '重试', run: () => void onRecalc() })
  } finally { generating.value = false }
}

// ── 屏级告警(§6):本屏只有「待重算」这一组(LAYOUT-STABILITY §4:stale 归「待重算」,与公共电核算同名);
//    chip 两态常驻,详情与动作都在问题面板里 ──
// 重算是写操作(EDIT-MODE:写入口只在编辑态):编辑态组头「重算本月」;浏览态「进入编辑模式」,拿到锁后组头换成「重算本月」
// (不自动帮点:拿锁可能要先过提权弹窗)。进不了编辑模式(或本月没读到)的人退回去计费参数页那条路。
const alertGroups = computed<AlertGroup[]>(() => {
  if (!staleMsg.value) return []
  const action = editMode.value
    ? { label: '重算本月', icon: 'refresh-cw', busy: generating.value || !!loadErr.value,
        busyLabel: loadErr.value ? '本月数据没加载出来，不能重算' : '重算中…',
        run: () => { alertOpen.value = false; void onRecalc() } }
    : canEnter.value && !loadErr.value
      ? { label: '进入编辑模式', icon: 'pencil', run: () => { alertOpen.value = false; toggleEdit() } }
      : { label: '去计费参数页重算', icon: 'refresh-cw', run: () => gotoParams('monthly', true) }
  return [{
    key: 'stale',
    title: '待重算',
    // 主语分参数 / 抄表两个来源(METER-TIMELINE-SPEC §5)
    desc: `${staleWho(status.value)}在本月算出损耗之后又改过 —— 屏上的损耗量、损耗率还是改之前算的。`
        + '不重算的话,按这些率出的催缴单会一直沿用旧数字。',
    // 明细点了去问题的源头:改过的参数在计费参数页(重算已在组头,这里不再带 edit=1)
    items: [{ text: staleMsg.value, hint: `${year.value}年${month.value}月`, onClick: () => gotoParams('monthly') }],
    action,
  }]
})
</script>

<template>
  <!-- ⓪ 没有期 → 出账月矩阵(五屏共用)。选过一次之后本会话不再出现,直落表格 -->
  <ChainMonthGate v-if="!period.picked" title="楼栋损耗" icon="trending-down" />

  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5.3 迁移查看态,摘 base.css 的 800px 屏级地板。
       本表 sticky 本就只有首列(位置)一根,S 档无需收敛;宽表在 .ll-wrap 内横滚(§5.3 现状)。
       v-if 各分支谁渲染谁是 .fp-content 首子,逐一挂(矩阵门在 ChainMonthGate 根上挂)。 -->
  <!-- 失败时不能再转圈:loss 恒 null,转圈会一直转下去。失败态走下面的 FPLoadError -->
  <div v-else-if="!loss && !loadErr" class="page-loading fp-fluid"><span class="page-spin" /></div>

  <div v-else class="ll-page fp-fluid">
    <!-- 链路条:期写在这里,五道工序横跳不换期 -->
    <FPStepStrip :steps="chainSteps" current="alloc-loss" :period="ym" @back="period.clear()" />

    <!-- 标题行 -->
    <div class="ll-head">
      <div class="ll-head-l">
        <h2 class="ll-title"><span class="ic"><component :is="iconFor('trending-down')" :size="18" /></span>楼栋损耗</h2>
        <!-- 页面状态(LAYOUT-STABILITY §4):读到了、本月没算过。加载失败时不贴 —— 没读到就不知道算没算 -->
        <FPStateTag v-if="!generated && !loadErr" tone="warn">本月未生成</FPStateTag>
        <Segmented :options="ZONE_OPTS" v-model="zone" size="sm" />
      </div>
      <div class="ll-actions">
        <!-- §6:屏级告警入口,位置固定;无告警时 quiet 态仍占位 -->
        <FPAlertPanel v-model:open="alertOpen" :count="alertGroups.length" :groups="alertGroups" align="end" />
        <!-- 本屏除备注外零写入口:损耗怎么算(算法/归组/总表取数/不计入的表)、损耗调整度数/损耗率加点/
             手工指定率全在计费参数页 ③ 计算方式。
             ⚠ 按钮上的「计算方式」四个字**不能单独改** —— 它是参数页第 ③ 张卡的名字(ParamCenterView:701),
                两屏必须同名。要去行话就两屏一起改,不是只改这一头。 -->
        <Button variant="outline" size="sm" v-tip="'本月这个期区按什么方式算损耗,以及人工填进去的那几个数 —— 去计费参数页看 / 改'" @click="gotoParams('rule')">
          <template #leading><component :is="iconFor('sliders-horizontal')" :size="14" /></template>
          计算方式设置
        </Button>
        <!-- 审核动作簇(§01):长在编辑按钮**左边**,同一条 flex 行 —— 编辑按钮位一个像素不动 -->
        <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
        <!-- 失败态禁"进"不禁"出"::disabled 不分编辑态,不带 !editMode 会把「完成」也禁掉 → 退不出去、锁交不回来 -->
        <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          :review-note="reviewNote" :review-tip="reviewTip"
                          :disabled="!editMode && !!loadErr"
                          @toggle="toggleEdit()" />
      </div>
    </div>

    <!-- 加载失败(LAYOUT-STABILITY §3):换掉表格区本身,一律带重试。失败时 loss 已清空 —— 不留上个月的数字,备注写不进 -->
    <FPLoadError v-if="loadErr" :sub="`${loadErr} · 屏上不显示上个月的数字，重试成功前不能改备注`" @retry="loadMonth()">
      {{ year }} 年 {{ month }} 月的楼栋损耗没读到
    </FPLoadError>
    <!-- 空状态(十件 ⑦):本月还没算过 / 本期区没有要核算的楼栋。对账行只跟着单元行出(后端按单元分期区),没单元就没有表可看 -->
    <FPEmpty v-else-if="!units.length"
             :sub="generated ? undefined : editMode ? '公共电核算和楼栋损耗一起生成' : '在「公共电核算」点「生成本月」后，这里出数'"
             :action="!generated && editMode ? (generating ? '生成中…' : '生成本月') : undefined" @action="onRecalc">
      {{ generated ? `${zoneLabel(zone)}本月没有要核算损耗的楼栋` : `${year} 年 ${month} 月的楼栋损耗还没算` }}
    </FPEmpty>

    <!-- 台账式宽表:单元行 + 对账区两行(供电局总表 vs 各栋总表合计 / 各栋分表合计) + tfoot 合计 -->
    <div v-else class="ll-wrap" ref="wrapEl" :style="wrapSt">
      <table class="ll-table" :class="{ 'hs-foot': hStage >= 2 }">
        <thead>
          <tr>
            <th class="ll-th ll-fix-th ll-fix" :style="fixLbl">位置</th>
            <th class="ll-th" :style="w(108)">总表用电量</th>
            <th class="ll-th" :style="w(104)" v-tip="`仅列示,不计入总表 / 分表合计(仅二期有铝缆表,一期显'–')`">铝缆用电量</th>
            <th class="ll-th" :style="w(108)">分表用电量</th>
            <!-- 符号方向要在表头说清:负数是常态。2026-09-23 之前这一列给负数标红,
                 而引擎的定义就是「负=分表比总表少=正常有损耗」,等于把七行里正常的五行全标成了错 -->
            <th class="ll-th" :style="w(100)" v-tip="'损耗量 = 分表用电量 − 总表用电量。负数=分表比总表少，也就是正常有损耗；正数=分表反而比总表多'">损耗量</th>
            <th class="ll-th" :style="w(92)" v-tip="'原损耗率 = 损耗量 ÷ 总表用电量，所以正常有损耗时它是负的。右边「收取损耗率」多数楼栋是按这个数反过来算出要向租户收多少，符号相反是对的；标着「仅按公摊分摊度数」的楼栋不走这条算法，看那一行名字旁边的说明'">原损耗率</th>
            <th class="ll-th" :style="w(116)" v-tip="`一期:各个园区公共用电池本月的用电量加起来 ÷ 均摊栋数（四舍五入到 2 位），各栋同值；悬停格子看分解式。二期不适用,显'–'`">公摊分摊度数</th>
            <th class="ll-th" :style="w(116)" v-tip="'损耗调整度数（正数多收 / 负数少收），按楼栋按月；在计费参数页 ① 本月参数改'">损耗调整度数</th>
            <th class="ll-th" :style="w(104)" v-tip="'损耗率加点（如 0.3%），按楼栋长期；在计费参数页 ② 长期常数改'">损耗率加点</th>
            <th class="ll-th" :style="w(160)" v-tip="'按损耗核算方式算出的率；填了「损耗率（手工指定）」则以它为准并并排显示公式算出的率'">收取损耗率</th>
            <th class="ll-th" :style="w(170)">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in units" :key="u.headBuildingId">
            <td class="ll-fix" :style="fixLbl">
              <span class="ll-lbl">
                <span class="ll-lbl-t" v-tip="u.label">{{ u.label }}</span>
                <span v-if="u.variant === 'share_only'" class="ll-var" v-tip="'仅按公摊分摊度数核算：率 = 公摊分摊度数 ÷ 分摊基数 + 加点'">仅按公摊分摊度数</span>
                <span v-else-if="u.variant === 'none'" class="ll-var dim" v-tip="'不核算（组内无分表或设为只列示用量）'">不核算</span>
              </span>
            </td>
            <td><span class="ll-nv" :class="{ empty: u.cQty == null }">{{ fmt(u.cQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.cableQty == null }">{{ fmt(u.cableQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.dQty == null }">{{ fmt(u.dQty) }}</span></td>
            <!-- ⚠ 不给损耗量上颜色:负数是正常状态(见表头 title),标红等于替数据下「异常」这个判断,
                 而库里只记了值、没记原因 —— 屏上写测量不写定性 -->
            <td><span class="ll-nv" :class="{ empty: u.eQty == null }">{{ fmt(u.eQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.rawRate == null }">{{ fpct(u.rawRate) }}</span></td>
            <!-- G:只读派生值,悬浮给分解式(池名+净量逐项 ÷ 均摊栋数);分栋差异不再走 G调整,走「调整度数」。
                 二期 gQty 恒 null(该指标只在一期核算,见 gTitle),显'–'同其它空值 -->
            <td>
              <span class="ll-nv help" :class="{ empty: u.gQty == null }" v-tip="gTitle(u)">{{ fmt(u.gQty) }}</span>
            </td>
            <!-- 损耗调整度数 / 损耗率加点:格里是快照值,徽标是当前生效参数的生效方式;点击去参数页改 -->
            <td>
              <span class="ll-nv ll-pv" :class="{ empty: u.adjQty == null }" v-tip="'点击去计费参数页改（① 本月参数 · 损耗调整度数）'"
                    role="button" tabindex="0" @click="gotoParams('monthly')" @keydown.enter.prevent="gotoParams('monthly')">
                {{ fmt(u.adjQty) }}
                <span v-if="badgeOf(u.headBuildingId, 'loss_adj_qty')" class="ll-badge"
                      :class="badgeOf(u.headBuildingId, 'loss_adj_qty')!.tone" v-tip="badgeOf(u.headBuildingId, 'loss_adj_qty')!.title">
                  {{ badgeOf(u.headBuildingId, 'loss_adj_qty')!.text }}</span>
              </span>
            </td>
            <td>
              <span class="ll-nv ll-pv" :class="{ empty: u.adjRate == null }" v-tip="'点击去计费参数页改（② 长期常数 · 损耗率加点）'"
                    role="button" tabindex="0" @click="gotoParams('constant')" @keydown.enter.prevent="gotoParams('constant')">
                {{ fpct(u.adjRate) }}
                <span v-if="badgeOf(u.headBuildingId, 'loss_adj_rate')" class="ll-badge"
                      :class="badgeOf(u.headBuildingId, 'loss_adj_rate')!.tone" v-tip="badgeOf(u.headBuildingId, 'loss_adj_rate')!.title">
                  {{ badgeOf(u.headBuildingId, 'loss_adj_rate')!.text }}</span>
              </span>
            </td>
            <td>
              <span class="ll-rate" :class="{ empty: u.tenantRate == null }" v-tip="rateTitle(u)">
                <template v-if="u.manualRate != null"><span class="ll-manual">手工指定</span>{{ fpct(u.tenantRate) }}<span class="ll-formula">（公式 {{ fpct(u.formulaRate) }}）</span></template>
                <template v-else>{{ fpct(u.tenantRate) }}</template>
              </span>
            </td>
            <!-- 备注:本屏唯一可写的一格(浏览态 DOM 里不许有 input,EDIT-MODE-SPEC §1)。
                 列宽由表头 w(170) 定死,input 宽 100% + border-box,进出编辑态整张表不抽动 -->
            <td>
              <input v-if="editN" class="ll-in" type="text" maxlength="255"
                     :value="u.note ?? ''" placeholder="—" v-tip="'备注,回车/失焦保存;清空=删掉备注'"
                     @change="commitNote(u, ($event.target as HTMLInputElement).value)" />
              <span v-else class="ll-txt" v-tip="u.note">{{ u.note ?? '–' }}</span>
            </td>
          </tr>
          <!-- 对账区(读时派生,见 buildLossReconRows):供电侧读数落「总表用电量」列,被比的合计落「分表用电量」列。
               前两行只管那块供电局表带的几栋;后两行(有栋被单独剔掉时才出)是把它们加回来的全部楼栋 -->
          <tr v-for="(r, i) in reconRows" :key="'rc' + i" class="ll-recon" :class="{ 'll-recon-all': r.newGroup }">
            <td class="ll-fix" :style="fixLbl"><span class="ll-lbl"><span class="ll-lbl-t" v-tip="r.label">{{ r.label }}</span></span></td>
            <td><span class="ll-nv" :class="{ empty: r.supplyQty == null }" v-tip="r.supplyTitle">{{ fmt(r.supplyQty) }}</span></td>
            <td></td>
            <td><span class="ll-nv" :class="{ empty: r.sumQty == null }" v-tip="r.sumTitle">{{ fmt(r.sumQty) }}</span></td>
            <!-- 同单元行:不给损耗量上颜色 -->
            <td><span class="ll-nv" :class="{ empty: r.loss == null }">{{ fmt(r.loss) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.rate == null }">{{ fpct(r.rate) }}</span></td>
            <!-- 已占 6(位置/总表/铝缆占位/分表/损耗量/原损耗率),铝缆列常驻两期,不再按 isP2 加减 -->
            <td :colspan="colCount - 6"></td>
          </tr>
        </tbody>
        <!-- tfoot 合计:总表/铝缆/分表/损耗量 合计(率不合计) -->
        <tfoot>
          <tr>
            <th class="ll-fix" :style="fixLbl"><span class="ll-foot-lbl">合　计</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.cQty) }}</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.cableQty) }}</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.dQty) }}</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.eQty) }}</span></th>
            <!-- 已占 5(位置/总表/铝缆/分表/损耗量),铝缆列常驻两期,不再按 isP2 加减 -->
            <th :colspan="colCount - 5"></th>
          </tr>
        </tfoot>
      </table>
    </div>

    <FPElevateDialog :page="`楼栋损耗 · ${ym}`" action="修改损耗备注" :perms="asking"
                     what="修改损耗备注" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`楼栋损耗 ${ym}`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
  </div>
</template>

<style scoped>
.ll-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

.ll-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ll-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ll-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ll-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
/* flex-wrap:M/S 档工具行收纳成两行(§2 修订,宽档单行不受影响——不溢出就不换行) */
.ll-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── 宽表(FPLedgerTable 手法) ── */
.ll-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.ll-table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-family: var(--font-sans); }
.ll-table th, .ll-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0; }
.ll-table thead th { position: sticky; top: 0; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: center; padding: 0 8px; z-index: 4; height: 38px; }
.ll-fix-th { z-index: 8; vertical-align: middle; }
.ll-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; }
.ll-table tbody tr:hover td { background: var(--surface-card); }
.ll-fix { position: sticky; z-index: 3; background: var(--surface-white); }
.ll-table tbody tr:hover .ll-fix { background: var(--surface-card); }

.ll-lbl { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
/* 名字超 1/5 省略(字进它自己的 span,flex 容器上的 text-overflow 管不到匿名文字);签不缩 */
.ll-lbl-t { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ll-var { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-regular); color: var(--hue-blue); background: var(--info-soft); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }
.ll-var.dim { color: var(--text-muted); background: var(--bg-sunken); }

.ll-nv { display: block; text-align: right; font-size: 12px; padding: 0 8px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ll-nv.empty { color: var(--text-disabled); }
.ll-nv.help { cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; }
/* 只读参数镜像格:可点(跳参数页),值 + 生效方式徽标 */
.ll-pv { cursor: pointer; display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.ll-pv:hover { color: var(--hue-blue); }
.ll-badge { flex: 0 0 auto; font-family: var(--font-sans); font-size: 10px; line-height: 14px; border-radius: var(--radius-full); padding: 0 5px; background: var(--bg-sunken); color: var(--text-muted); }
.ll-badge.month { background: var(--warn-soft); color: var(--amber-text); }
.ll-badge.from { background: var(--info-soft); color: var(--hue-blue); }
.ll-rate { display: block; text-align: right; font-size: 12px; padding: 0 8px; font-weight: var(--fw-semibold); color: var(--hue-blue); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ll-rate.empty { color: var(--text-disabled); font-weight: var(--fw-regular); }
/* 手工率覆盖:「手工」小标 + 手工率(主)+ 公式率(灰,并排备查) */
.ll-manual { font-family: var(--font-sans); font-size: 10px; font-weight: var(--fw-regular); border-radius: var(--radius-full); padding: 0 5px; margin-right: 4px; background: var(--warn-soft); color: var(--amber-text); vertical-align: 1px; }
.ll-formula { font-size: 10.5px; font-weight: var(--fw-regular); color: var(--text-muted); }
.ll-txt { display: block; text-align: left; font-size: 12px; padding: 0 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 备注行内输入(编辑态;静默融入单元格,hover/聚焦显边框 —— 同 ElecCostView .ec-in.txt / PvMeterView .pm-edit 家族)。
   width:100% + border-box:列宽由表头钉死,进出编辑态列宽不变(LAYOUT-STABILITY-SPEC §1/§3) */
.ll-in { width: 100%; min-width: 0; box-sizing: border-box; height: 26px; padding: 0 8px; text-align: left; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; font-family: var(--font-sans); font-size: 12px; color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.ll-in:hover { border-color: var(--border-control); background: var(--surface-white); }
.ll-in:focus { outline: none; border-color: var(--hue-blue); background: var(--surface-white); }
.ll-in::placeholder { color: var(--text-disabled); }

/* 对账区(分隔带样式对标 mlg-bsum) */
.ll-table tbody tr.ll-recon td { height: 40px; background: var(--surface-sunken); border-top: 2px solid var(--border-strong); border-bottom: 2px solid var(--border-strong); }
.ll-table tbody tr.ll-recon + tr.ll-recon td { border-top: none; }
/* 「全部楼栋」那一组与上面那组是两件事,给一条虚线分开 —— 四行同底同边框会糊成一块。
   ⚠ 选择器必须压过上一条的 `border-top: none`(它带两个 .ll-recon,权重更高) */
.ll-table tbody tr.ll-recon + tr.ll-recon.ll-recon-all td { border-top: 1px dashed var(--border-strong); }

.ll-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); }
.ll-table tfoot th.ll-fix { z-index: 7; }
/* 表格高度(LIST-PAGE-SPEC §9.2):不够 8 行时合计不贴底、跟在最后一行后面;再不够的 min-height 是 .ll-wrap 上的内联样式 */
.ll-table.hs-foot tfoot th { bottom: auto; }
.ll-foot-lbl { display: block; padding: 0 10px; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.ll-foot-v { display: block; text-align: right; padding: 0 8px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }
</style>
