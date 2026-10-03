<script setup lang="ts">
// 数据中心首页 = 录入工作台(DATA-HOME-REDESIGN spec §2)。只回答一件事:现在该干什么。
// 2026-09-03 改名「本月出账」,出账链 5 步(SIDEBAR-UX-REDESIGN §5.1)。
//
// 2026-08-18 重设计。改版前这屏把同一批信息说了三遍:4 个 KPI 卡里 3 个是下方栏目的重复,
// 而「本期待办」本身是「完整度」的子集(后端直接遍历同一个 sources 生成 tasks)。
// 用户原话「无从下手、信息量过多、没有主次」—— 那是信息架构问题不是排版问题,所以是删不是排。
//
// 现在三级主次:① 顶部一行总览 → ② 出账链流水线 → ③ 当前步大卡 + 全页唯一主 CTA。
// 出账链有先后依赖(抄表没抄完算不了公摊,公摊没生成出不了催缴单)所以画成流水线;
// 附表互相独立、能并行做,所以画成紧凑清单。结构与真实工作的形状同构。
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import Popover from '@/components/ds/Popover.vue'
import { receipt } from '@/utils/receipt'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { dataHomeApi } from '@/api/dataHome'
import { reconApi } from '@/api/recon'
import type { DataHomeOverviewDTO } from '@/types/dataHome'
import type { ReconMonthMeta } from '@/types/recon'
import { iconFor } from '@/components/ds/icon'
import Card from '@/components/ds/Card.vue'
import Button from '@/components/ds/Button.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
// 直接引入不走 defineAsyncComponent:这颗弹卡只有百来行,懒加载省不下什么,
// 却换来一层「点了之后还要再等一拍才渲染」的时序(单测里表现为 querySelector 拿到 null)。
import FPReviewDialog from '@/components/fp/FPReviewDialog.vue'
import { useBillingPeriodStore, YM } from '@/stores/billingPeriod'
import { usePresenceStore } from '@/stores/presence'
import { useReviewStore } from '@/stores/review'
import type { ReviewRow } from '@/types/review'
import { NAV_SCOPE_PREFIX, scopeTarget } from '@/utils/lockScopes'
import { periodLink, periodOf } from '@/nav/deepLink'
import { CHAIN, pipsOf, chainLabel, noticeYmOf } from '@/nav/billingChain'
import { buildYearRows, inYearWindow } from '@/utils/matrixYears'
import { rowsOf, closeChecks } from './monthClose.logic'
import type { CloseRow, CloseChip } from './monthClose.logic'


const router = useRouter()
const tabsStore = useTabsStore()
const auth = useAuthStore()
const period = useBillingPeriodStore()
const presence = usePresenceStore()
const review = useReviewStore()
const CHAIN_VALUES = new Set(CHAIN.map(c => c.value))

/** **本标签页**正握着的出账链 / 抄表锁里的期。只用来判「要不要问」;问的时候写哪一页、几处改动由页签条给(titleOf / dirtyOf)。 */
function myChainLockPeriods(): string[] {
  const me = presence.users.find(u => u.sid === presence.sid)
  return (me?.editScopes ?? [])
    .filter(sc => sc.startsWith('billing-chain:') || sc.startsWith('meters:'))
    .map(sc => sc.slice(sc.indexOf(':') + 1))
}

// 主管的「谁在编辑」(P2 T6):数据源是 presence + auth,跟 ov 有没有到无关 —— 标题行在两个
// v-if="!ov"/v-else 分支之外,骨架态就在。2026-10-03 横条收尾:原先单独一行 32px 的主管条撤掉,
// 「待批授权 N」与顶栏铃铛重复(点开的就是铃铛面板)整颗删;「谁在编辑」收成标题行一颗胶囊,点开列人。
const editorsOpen = ref(false)
const isSupervisor = computed(() => auth.can('lock:takeover') || auth.can('system:view'))

// 「谁在编辑」—— 一人一枚 chip,取 editScopes[0](裁定 4:32px 定高装不下 N 人 × M 把锁,
// 要回答的是「谁卡在哪」而不是「都握了哪些锁」)。按 user 去重(不是 sid)—— presence 的单位是
// 座位不是人,同一个人开两个标签页会出两个 sid、两枚一模一样的 chip(fix-brief FC)。
// 屏名读座位自带的 label(AppShell 按 route.path 实时写的「此刻真的在哪一屏」),为空才回落
// chainLabel(v);跳转目标另读 scopeTarget(锁串的第二维:公司/期区/tab)—— 两者是两个不同的源,
// 文案与目的地各走各的(fix-brief FB)。
const editors = computed(() => {
  const seatsByUser = new Map<string, (typeof presence.others)[number]>()
  for (const u of presence.others)
    if (u.mode === 'edit' && u.editScopes.length && !seatsByUser.has(u.user)) seatsByUser.set(u.user, u)
  return [...seatsByUser.values()].map(u => {
    const target = scopeTarget(u.editScopes[0])
    return { sid: u.sid, target,
             note: [u.displayName, u.label ?? (target ? chainLabel(target.v) : null), target?.p]
               .filter(Boolean).join(' · ') }
  })
})

// chip 点跳:目标带上 scopeTarget 给的第二维(co/tab),不止带期(fix-brief FA)——
// 锁串本身带着「台账的公司 / 附10 的期区 / 三大报表的公司 / 附13-14 是哪一张」,不带过去就会
// 落到目标屏的默认子视图,而那里恰恰没有人在编辑。⚠ co 照实传字符串,别转 number:
// 转一道只会给非数字期区制造 NaN。
async function goEditor(t: ReturnType<typeof scopeTarget>) {
  if (!t || !(await confirmRebuild(t.v))) return
  // 页面里的链接 = 新页签紧挨本页右边(TAB-BAR-SPEC §2),本月出账不被换掉
  tabsStore.openDeep(t.v)
  router.push(t.p ? periodLink(t.v, { p: t.p, co: t.co, extra: t.tab ? { tab: t.tab } : undefined }) : '/' + t.v)
}

const ov = ref<DataHomeOverviewDTO | null>(null)
// 用户手动选的月;null = 跟随后端锚定月。**刻意不持久化** —— 下次打开仍按锚重算,
// 否则看过一眼历史月之后天天落在那儿(spec §2.2)。
const pickedYm = ref<string | null>(null)

// 晚到的旧回包不许覆盖新选的月(2026-09-03 对抗复查 F2)
let loadSeq = 0
// 换月在途:旧内容留在原地(§06 第一档),所以必须有信号 —— FPLoadBar 的头注原话
// 「不给信号的话用户根本不知道发生了什么,那些屏现在就是这么静默的」,本屏此前正是其中之一。
// 走 useDeferredFlag(200ms 才亮):本地后端常在几十毫秒内返回,直接绑 inflight 会闪一下。
const ovInflight = ref(false)
const veil = useDeferredFlag(ovInflight)
async function load() {
  const seq = ++loadSeq
  ovInflight.value = true
  try {
    const res = await dataHomeApi.getOverview(pickedYm.value ?? undefined)
    if (seq !== loadSeq) return   // 被更新的一趟顶掉:不落数据,也不由我来灭灯
    ov.value = res
  } finally {
    if (seq === loadSeq) ovInflight.value = false
  }
}
onMounted(() => { void load(); void period.loadChain() })
watch(pickedYm, load)

// 行点击 = 「去做事」显式导航 → 全新状态(openFresh;侧栏语义翻案是 P3 的事,这里不动)。
// 出账链五屏共读 billingPeriod store:先 pick 首页当前月再 push,目标屏的选期矩阵就被前置满足
// (SIDEBAR-UX-REDESIGN §4.1 / D2)。pick 覆盖会话里已选的期 —— 首页写着的月就是用户刚点的意图;
// 本人握着任一链锁时先确认:openFresh 重建目标屏会清掉未保存草稿(不分同月异月)。
// 链屏与收入核对带 ?p(目标屏的 parsePeriod / parsePeriodQuery 都认);附表行也带(P0b,形状见 scheduleLink)。
// 前置条「去重算」的 go 也是 params,同样走这条 pick 分支 —— 它指向的正是首页显示月的参数屏,不 pick 反而落回矩阵(评审裁定 2026-09-03)。
// 本人锁的判断读 presence.users(3 秒一拍,PING_MS):刚进首页那一拍之前看不到自己别处的锁,确认框是尽力而为不是保证。
const MONTH_ROWS = new Set(['ledger', 'sales-income', 'salary'])
const YEAR_ROWS = new Set(['pv-income', 'car-charging', 'ebike-charging', 'elec-cost'])
/** 附表行的深链形状(SIDEBAR-UX-REDESIGN §5.1):月表带 p=YYYY-MM;年表屏 p 只取年 + mode=summary(盖过本机记住的运营账);
 *  附13 / 附14 两行同指 utilities,按行的 tag 分 tab。台账行本期不带 co(公司 chips 是 P2 的事,目标屏落首册)。 */
// co(P2 T3):台账公司 / 附10 期区 chip 点击带 co,与分析层 openDeep 的 periodLink(v,{p,co}) 同口径
// (CockpitView.vue onPhaseClick)。只有 MONTH_ROWS 分支会收到非空 co —— 合并行(utilities/charging)
// 的 chip 走各自的 tab/go,不带 co(monthClose.logic.ts chipsFor 里那两组 chip 本就没有 co 字段)。
function scheduleLink(v: string, tag: string, p: { year: number; month: number }, co?: number | 'all') {
  // 园区电费模型与附表11 同一个 go,靠 tag 分:它是那一屏的 ?mode=cost 子视图,
  // 不带 mode 会落在附表11 的报送台账上 —— 点「园区电费模型」却打开另一张表。
  if (v === 'elec-cost' && tag === '模型')
    return periodLink(v, { p: periodOf(p.year, p.month), extra: { mode: 'cost' } })
  if (MONTH_ROWS.has(v)) return periodLink(v, { p: periodOf(p.year, p.month), co })
  if (YEAR_ROWS.has(v)) return periodLink(v, { p: periodOf(p.year, null), extra: { mode: 'summary' } })
  if (v === 'utilities') return periodLink(v, { p: periodOf(p.year, null), extra: { tab: tag === '附14' ? 'phase3' : 'office' } })
  return null
}
// 首页行仍是「全新」(spec §4.1:显式任务导航),所以点之前必须问 —— openFresh 会重建目标屏,
// 编辑中的草稿不分同月异月都会丢(2026-09-03 对抗复查 F3)。
// P3 收窄(spec §4.1 把这件事派给本期):判据从「本人握着出账链/抄表锁」换成
// **本标签页在不在目标屏那把锁底下持锁** —— ① 改前读的是服务端回声的 editScopes,
// 进编辑态 3 秒内(下一拍 ping 之前)点回来不弹确认,草稿照丢;② 改前只盖出账链五屏,
// 附10 / 台账 / 附表屏的草稿(sched:s10:* 之类)一律不问,而清单上 15 行大半是它们。
// 两个真源取或:`holdsEditUnder` 读本地 editCallbacks(即时,补上进编辑态 3 秒内还没回声的空窗),
// `myChainLockPeriods` 读服务端回声(只对出账链行有意义)。
/** openFresh 会重建目标屏、丢掉未保存草稿 —— 本标签页在那把锁底下持锁时先问一句。
 *  go()(清单行)与主管条 chip 两处共用:两者都走 openFresh,风险一模一样。
 *  问法是离开确认(画布 02-A,EDIT-MODE-SPEC §6.1):「重新打开「月度台账」？」「这页有 3 处改动还没保存。」,
 *  **0 处改动不弹**。出账链行问链上五屏:pick 换的是五屏共读的期,握锁的未必是点的那一屏(一把 billing-chain 锁三屏)。 */
function confirmRebuild(v: string): Promise<boolean> {
  const heldHere = presence.holdsEditUnder(NAV_SCOPE_PREFIX[v])
  const chainHeld = CHAIN_VALUES.has(v) && myChainLockPeriods().length > 0
  if (!heldHere && !chainHeld) return Promise.resolve(true)
  return tabsStore.leaveOk(CHAIN_VALUES.has(v) ? [...CHAIN_VALUES] : [v], '重新打开')
}
async function go(v: string, tag = '', co?: number | 'all') {
  // 用户刚在下拉里选的月优先于服务端回包(回包在途时也按他选的走);没选过才用锚定月
  const ym = shownYm.value
  const p = ym ? { year: +ym.slice(0, 4), month: +ym.slice(5, 7) } : null
  if (!(await confirmRebuild(v))) return
  if (p && CHAIN_VALUES.has(v)) {
    period.pick(p.year, p.month)
    // 门被前置跳过 → ChainMonthGate 不再挂载,而它是 loadChain 的唯一调用方;不补这一句,
    // 目标屏的链路条读到的是空格子,五道工序全显「未做」(2026-09-03 对抗复查 F1)。
    // loadChain 幂等:已载入直接返回,在途去重。失败不阻断跳转(矩阵那边同样只标「加载失败」)。
    void period.loadChain().catch(() => {})
  }
  tabsStore.openDeep(v)   // 页面里的链接 = 新页签紧挨本页右边(TAB-BAR-SPEC §2),本月出账不被换掉
  // 链屏与收入核对带 ?p(SIDEBAR-UX-REDESIGN §4.1「显式选月 + periodLink」):目标屏 useDeepPeriod 认得,
  // 链屏还会与上面预 pick 的期比对(相同 → 不动);附表行按 scheduleLink 的形状带参(P0b)。
  if (p && (CHAIN_VALUES.has(v) || v === 'reconciliation')) {
    // 催缴单屏的 p 是催缴单月:这个月的水电出在下个月的单上(billingChain「催缴单的月份」)
    const pp = periodOf(p.year, p.month)
    router.push(periodLink(v, { p: v === 'bill-notices' ? noticeYmOf(pp) : pp }))
    return
  }
  const link = p ? scheduleLink(v, tag, p, co) : null
  router.push(link ?? '/' + v)
}

// chip 自带的子入口:公司 / 期区 chip 带 co(同 go() 走一遍确认判据);办公/三期 chip 换算成
// 旧 tag 形状喂 scheduleLink(office/phase3 分支只认 tag==='附14');汽车/电动车 chip 直接是各自的 go。
function goChip(r: CloseRow, c: CloseChip) {
  if (c.go) { go(c.go); return }
  if (c.tab) { go(r.go!, c.tab === 'phase3' ? '附14' : '附13'); return }
  if (r.go) go(r.go, r.tag, c.co)
}

function dotOf(state: CloseRow['state']): string {
  return state === 'done' ? '✓' : state === 'stale' ? '↻' : state === 'na' ? '—' : '○'
}

const curYm = computed(() =>
  ov.value?.period ? `${ov.value.period.year}-${String(ov.value.period.month).padStart(2, '0')}` : '')

/**
 * 屏上此刻**认**的月:手选优先,没选过才用回包的锚定月。
 * 与 curYm 的差别只在「点了但回包还没到」那一段 —— 而年份条的描边、收入核对取数、
 * go() 带的期都该按**用户刚点的**那个月走,不该等一趟往返。
 */
const shownYm = computed(() => pickedYm.value ?? curYm.value)

// 年份条(P2 T4):年份行来自 ov.months —— 后端明发的「链 ∪ 附表」全集(DataHomeService.allMonths)。
// 照 period.dataYears 走会丢掉只有附表的年,而「切到 2025-06 补台账」正是这屏最常用的一步。
const yearRows = computed(() => {
  // 脏 ym 不进年份条(F2,两道闸):格式闸照 stores/billingPeriod.ts 的 fetchAll
  // (`if (!YM.test(m)) continue`,注释「脏数据不进矩阵」);年份闸用 buildYearRows 自己导出的
  // inYearWindow —— 同一个窗口两处共用,别写第二个魔数。
  // ⚠ 两道都要:buildYearRows 内部的钳位只保证不撑爆堆内存(复查实测过 OOM),
  //   但一条 '0001-01' 仍会把年份条从 4 行拉成 31 行,得在这里先滤掉。
  const curYear = new Date().getFullYear()
  const ms = (ov.value?.months ?? [])
    .filter(m => YM.test(m) && inYearWindow(+m.slice(0, 4), curYear))
  const have = new Set(ms)
  const years = [...new Set(ms.map(m => +m.slice(0, 4)))]
  return buildYearRows(years, curYear, []).map(r => ({
    year: r.year,
    months: Array.from({ length: 12 }, (_, i) => {
      const ym = `${r.year}-${String(i + 1).padStart(2, '0')}`
      const c = period.cellOf(ym)
      return {
        month: i + 1,
        hasData: have.has(ym),
        // 链数据没到时**整个字段不给** —— 四个灭点会被读成「这个月一道工序没走」(裁定 3)
        // locked 与 pips/stale 同进同出:链数据没到时整个字段不给(裁定 3),
        // 否则 closed 恒 false 会被读成「这个月还没审完」。
        ...(period.loaded ? { pips: pipsOf(c), stale: c.stale, locked: c.closed } : {}),
        // 描边跟 shownYm 不跟 curYm:点下去立刻挪过去,不等回包 —— 否则这一下点击**零反馈**
        cur: ym === shownYm.value,
      }
    }),
  }))
})

const curStep = computed(() => {
  const c = ov.value?.chain
  return c && c.currentIndex >= 0 ? c.steps[c.currentIndex] : null
})

// 前置问题(合同缺计费行 / 参数待重算)进标题行的「待处理」入口(LAYOUT-STABILITY-SPEC §6),
// 不再是年份条下面出没的满宽条 —— 那条一出现就把两栏往下推(2026-10-03 横条收尾)。
// 一条 blocker = 面板里一组;组头动作就是原来条上的按钮,深链照旧走 go()。
// 只读账号不给动作:去补档 / 去重算都是写操作,文案照出(他该知道有缺口)。
const BLOCKER_TITLE: Record<string, string> = { 'contract-gap': '合同缺计费行', 'param-stale': '待重算' }
const alertOpen = ref(false)
const alertGroups = computed<AlertGroup[]>(() => (ov.value?.blockers ?? []).map(b => ({
  key: b.kind, title: BLOCKER_TITLE[b.kind] ?? b.cta, desc: b.text, items: [],
  action: auth.isReadonly ? undefined : { label: b.cta, run: () => { alertOpen.value = false; void go(b.go) } },
})))

// 收入核对元数据(P2 T3,2026-09-06 改由 shownYm 驱动)。
// 首载仍然**串行**:pickedYm 是 null,年只能从 overview 回包的 ov.period 派生;并发就只能传
// undefined,后端会取「两本账有数据的最大年」,与首页锚定月的年大概率不是同一年 —— 形状对、数字张冠李戴。
// 但**显式点月时年是已知的**(就写在用户点的那个格子上),再串一趟就是白等一次往返。
// watch(shownYm) 一处兼顾两种:首载时 shownYm 随 curYm 在回包后变(仍串行),点月时它立刻变(与 overview 并发)。
// ⚠ 回包落地后 curYm 会等于 pickedYm,shownYm 不再变化 → 不会重复发第二趟。
// 取数失败 `.catch(() => null)` 不阻断整屏 —— 收入核对那一行照 reconRow 的 hasData 闸判 na,显「—」。
const recon = ref<ReconMonthMeta | null>(null)
let reconSeq = 0
async function loadRecon(ym: string) {
  const seq = ++reconSeq
  // 换月后先清零(评审修补 T3 fix-brief #2):reconSeq 只守「晚到的旧回包不覆盖新选的月」,不守
  // 「新月已上屏、新回包还没到」这段空窗 —— 不清的话这一行会在整年 12 个月重跑核对的窗口里,
  // 挂着上一个月的 ✓/○,与已经换好月的其余行(链五步/附表)对不上。
  recon.value = null
  if (!ym) return
  const year = +ym.slice(0, 4)
  const month = +ym.slice(5, 7)
  const res = await reconApi.overview(year).catch(() => null)
  if (seq !== reconSeq) return   // 晚到的旧回包不许覆盖新选的月(同 loadSeq 口径)
  recon.value = res?.months.find(m => m.month === month) ?? null
}
watch(shownYm, loadRecon)

// 切走再切回 KeepAlive 命中缓存实例、onMounted 不再跑(P3 §4.1 Step 6b,门禁在
// views/__tests__/readScreenRefresh.spec.ts)。P2 T4 起这屏**必须**补:年份条读的是活的
// billingPeriod.cells(抄表/公摊/损耗/催缴单写完都 reloadChain),而两栏板子读的是只取一次的 ov ——
// 不重取就会出现「年份条上这个月的第一颗工序点已亮,正下方那一行还显○ 未做」,
// 更坏的是新月 hasData 仍为 false,BookMonthMatrix 的 v-if="m.hasData && m.pips" 把点整块吞掉,
// 刚抄完读数的月被画成虚线「空」卡。
onReactivated(() => {
  void load()
  void loadRecon(shownYm.value)
  // 审核态也重取:切走的这段时间里审核员可能审了几张,回来还挂着旧态就会让人去点一个
  // 已经不存在的动作(P2 T4 那条「年份条与两栏板子不同源」同一类毛病)。
  review.invalidate(shownYm.value || null)
  void review.ensure(shownYm.value || null)
})

// ── 审核态(R2) ────────────────────────────────────────────
// 走**清单道**(GET /api/review?period=):这一屏要的是全部键(含派生 entered)与通过前置缺项,
// 闸道那条只发已落库的行,喂不出「未交审」这一档(会显示成「这个月没有这张表」)。
// 换月即取;取不到时 rowsOf 收到 null,全行显「—」而不是猜成「未交审」。
watch(shownYm, (ym) => { void review.ensure(ym || null) }, { immediate: true })
const reviewRows = computed<ReviewRow[] | null>(() =>
  review.isLoaded(shownYm.value || null) ? review.rowsOf(shownYm.value || null) : null)

// 两栏清单(P2 T3):行状态 / chips / 计数全在 monthClose.logic 算完,这里只取数与派生。
const rows = computed(() => (ov.value ? rowsOf({ overview: ov.value, recon: recon.value, review: reviewRows.value }) : []))
const checks = computed(() => closeChecks(rows.value))

// ── 审核动作(§7.5:行动作按权限) ─────────────────────────
const REVIEW_TEXT: Record<string, string> = {
  entered: '未交审', submitted: '待审核', approved: '已审核', returned: '已退回', na: '—',
}
const reviewText = (s: string) => REVIEW_TEXT[s] ?? '—'

/** 审核态列的悬停说明:谁在什么时候做的 / 退回理由。查不到就不给(v-tip 收到 undefined 不出气泡)。 */
function reviewTip(key: string | undefined, status: string): string | undefined {
  const r = key ? reviewRows.value?.find(x => x.key === key) : null
  if (!r) return undefined
  const day = (s: string | null) => (s ? s.slice(5, 10) : '')
  if (status === 'approved') return `${r.reviewedBy ?? ''} 通过 · ${day(r.reviewedAt)}`
  if (status === 'submitted') return `${r.submittedBy ?? ''} 交审 · ${day(r.submittedAt)}`
  if (status === 'returned') return r.reason ? `退回理由：${r.reason}` : `${r.reviewedBy ?? ''} 退回`
  return undefined
}

/**
 * 「有没有这张表的录入权」—— 这里只决定**按钮画不画**,是粗判。
 *
 * 真正的 kind→perm 表在后端 `ReviewKind.perms()`,前端不重列一份(§7.1 明写它不是
 * RBAC §5.2 那张表的复用,重列必漂移)。点下去由后端 403 兜底并把原话弹出来。
 * 代价写明:没有某张表 edit 权的人会看见一颗按不动的「交审」——比"少一张表的按钮
 * 且没人知道为什么"好。
 */
const canSubmitAny = computed(() =>
  ['entry:edit', 'billing-run:edit', 'param-policy:edit', 'param-monthly:edit', 'meter-reading:edit']
    .some(p => auth.can(p)))
const canApprove = computed(() => auth.can('review:approve'))

/**
 * 这一行涉及的全部审核键。
 *
 * ⚠ 多键行(台账每公司一把 / 附10 每期区一把 / 附13-14 两个 scope / 附7-8 两个 kind)
 *   一共占 19 把键里的 8 把 —— 只给单键行配动作的话,这 8 把在全站一个入口都没有。
 *   spec §7.5 只写了「chips 带审核态色」,没说动作挂哪儿(D-R2-9 补的裁定):
 *   **行动作作用于该行全部适用的键**,与人的说法一致(「台账这一行我审了」),
 *   而键的粒度在库里与日志里照样是每公司一条。
 */
function keysOf(r: CloseRow): string[] {
  if (r.reviewKey) return [r.reviewKey]
  return (r.chips ?? []).map(c => c.reviewKey).filter((k): k is string => !!k)
}

const rowOf = (key: string) => reviewRows.value?.find(x => x.key === key) ?? null

/** 这一行此刻各个动作要作用到哪几把键。空数组 = 该动作不画。 */
function actionsOf(r: CloseRow) {
  const keys = r.review === 'na' ? [] : keysOf(r)
  const st = (k: string) => rowOf(k)?.status ?? null
  return {
    // 交审前置:该键已做(§7.2)。多键行按 chip 各自的 done 判 —— 只录了 A 公司就只交 A 公司。
    submit: canSubmitAny.value
      ? keys.filter(k => {
          const s = st(k)
          if (s !== 'entered' && s !== 'returned') return false
          const chip = (r.chips ?? []).find(c => c.reviewKey === k)
          return chip ? chip.done : r.state === 'done'
        })
      : [],
    approve: canApprove.value ? keys.filter(k => st(k) === 'submitted') : [],
    back: canApprove.value ? keys.filter(k => st(k) === 'submitted') : [],
    undo: canApprove.value ? keys.filter(k => st(k) === 'approved') : [],
    /** 有交审资格但还没录完的键 —— 按钮要画出来但按不动(直接不画会让人以为界面坏了)。 */
    submitPending: canSubmitAny.value
      ? keys.filter(k => (st(k) === 'entered' || st(k) === 'returned'))
      : [],
  }
}

/** 通过前置缺项(后端算好的 blockedBy)。多键行取并集 —— 任一把缺上游,「通过」就按不下去。 */
function blockedBy(keys: string[]): string[] {
  return [...new Set(keys.flatMap(k => rowOf(k)?.blockedBy ?? []))]
}

const acting = ref<string | null>(null)          // 在途的那把键,防连点
const dialog = ref<{ keys: string[]; label: string; action: 'return' | 'withdraw' } | null>(null)

/**
 * 动作的报错分流。403 冠「你没有这张表的权限」→ 去找有权限的人;其余(409 / 423 …)后端已经写好了准话,原样报。
 *   409 不冠前缀:后端的 409 除了「先通过 X 的审核」还有「当前是「待审核」,不能交审」,
 *   统一冠「上游还没审完」会和原话相反。
 * 走失败回执(画布 02-C)。不带「重试」:多键行逐把写、中途失败时前几把已经写进去了,
 * 拿点击那一刻的键再跑一遍,头一把就吃 409「当前是待审核,不能交审」;batch 失败后已重取清单,
 * 行上那颗按钮按新状态重算过,再点它就是重试。
 */
async function runAction(key: string, fn: () => Promise<unknown>) {
  if (acting.value) return
  acting.value = key
  try {
    await fn()
  } catch (e) {
    const err = e as { code?: number; message?: string }
    const msg = err?.message ?? '操作失败'
    receipt.fail(err?.code === 403 ? `你没有这张表的权限：${msg}` : msg)
  } finally {
    acting.value = null
  }
}

/**
 * 多键行的动作。逐把写、碰到第一个失败就停,做完**只刷新一次** —— 这两条都搬进了
 * store 的 batch()(2026-09-08);改前是每把键各刷一次,屏上逐个变绿并反复闪。
 *
 * 顺带把年份条也刷一遍:月格上那枚 ✓ 读的是 billingPeriod 的 closedMonths,
 * 而审核动作从不碰那条链 —— 不补这一句,审完当月最后一把键月格也不会打勾。
 * 放在这里不放 store:整年那排月格只有本屏在画,store 不必认识 billingPeriod。
 */
async function runEach(keys: string[], fn: (keys: string[]) => Promise<unknown>) {
  if (!keys.length) return
  await runAction(keys.join('|'), async () => {
    try { await fn(keys) }
    finally {
      void period.reloadChain().catch(() => { /* noop */ })
    }
  })
}

const onSubmit = (keys: string[]) => runEach(keys, ks => review.submitAll(ks))
const onApprove = (keys: string[]) => runEach(keys, ks => review.approveAll(ks))
function openDialog(keys: string[], label: string, action: 'return' | 'withdraw') {
  dialog.value = { keys, label, action }
}
async function onDialogConfirm(reason: string) {
  const d = dialog.value
  if (!d) return
  await runEach(d.keys, ks =>
    d.action === 'return' ? review.returnAll(ks, reason) : review.withdrawAll(ks, reason))
  dialog.value = null
}
// ── 审核员的筛选胶囊(§7.5:审核员落地位) ─────────────────
// 2026-10-03 横条收尾:原先单独一行 32px 的审核条并进标题行 ——「待审核 N」是筛选胶囊,「本月已审 a/b」是计数。
const isReviewer = computed(() => auth.can('review:approve'))
/** 「只看待审」筛选。审核员一个月要过 19 把键,不给筛选就得自己在 15 行里数。 */
const onlyPending = ref(false)

/** 有审核键的行(导入中心 / 收入核对不算)。屏上那个「本月已审 n/总」的分母就是它。 */
const reviewable = computed(() => rows.value.filter(r => r.review !== 'na'))
/**
 * 计数从**渲染出来的 rows** 算,不抄 review 回包的条数(§12:计数与审核键集合必须与屏内同源,
 * 假绿栽过三次)。两个数不同源:回包是 19 把键,屏上是 15 行,台账/附10 一行压多把。
 * 多键行按「最不进展」折过一次,所以这里数的是「整行都审完了」的行数 —— 与屏上写的字一致。
 */
const reviewCounts = computed(() => ({
  pending: reviewable.value.filter(r => r.review === 'submitted').length,
  approved: reviewable.value.filter(r => r.review === 'approved').length,
  total: reviewable.value.length,
}))

const shown = (col: CloseRow['col']) => rows.value.filter(r =>
  r.col === col && (!onlyPending.value || r.review === 'submitted'))
const billingRows = computed(() => shown('billing'))
const bookingRows = computed(() => shown('booking'))
</script>

<template>
  <!-- ⚠ 根节点 .dh **不再吊在 ov 上** —— 它此前是整页 v-if,数据到达前是一整块白屏,
       而这是登录后第一眼看到的屏(加载态设计稿 §03)。
       骨架能画准是因为两栏的行数都是常量(monthClose.logic §5.2):出账列恒 7 行(链五步 + 收入核对 +
       本月锁账),记账列恒 12 行(后端 13 源,附13+附14/附7+附8 各并一行,加三大报表三行)。
       静态文案(本月出账 / 出账链 / 附表录入)直接照常渲染 —— 它们不依赖数据,
       糊成微光条反而是把已知的东西藏起来。
       fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5 迁移摘掉 base.css 的 800px 屏级地板——
       出账链/附表本就是 flex-wrap 胶囊行,横幅/大卡 S 档允许换行即可,无定宽结构。 -->
  <div class="dh fp-fluid">
    <!-- 换期重取的唯一信号(加载态设计稿 §08)。宿主 .dh 已设 position: relative。 -->
    <FPLoadBar :on="veil" />
    <!-- 标题行在骨架 / 真版式两个分支**之外**,只写一份(T3 漏 .dh-cols、T4 漏 .dh-ystrip 都是分两份写漏的)。
         右侧胶囊的外层 v-if 只许是权限判(有没有这个角色),数据 v-if 一律禁 —— 零待审显「暂无待审」、
         零在编辑显「无人在编辑」,胶囊照样在位(P2 裁定 1/2)。 -->
    <div class="dh-head">
      <div class="dh-period">
        <span class="dh-title">本月出账</span>
        <div v-if="!ov" class="dh-mnow"><span class="fp-shim" style="display:block;width:72px;height:14px;border-radius:4px"></span></div>
        <!-- 在途时三处一起压暗(.fp-stale:opacity+blur+pointer-events:none,不改高度):
             月名、计数、两栏板子都还是**上一个月**的数,而年份条的描边已经挪到新月上了 ——
             不压暗就是同屏两处对同一件事说反话。年份条本身不压:它是你正在点的那个控件。
             data-stale-host 常挂(动效稿 C5-02 ⑧):类摘掉后仍有 transition-property,退场才是 200 —— 不挂就是硬切。 -->
        <div v-else-if="ov.period" class="dh-mnow" data-stale-host :class="{ 'fp-stale': veil }" :aria-busy="veil">{{ ov.period.label }}</div>
        <!-- 待处理入口:合同缺计费行 / 参数待重算(原年份条下的满宽前置条)。排在左组最后,出现时不挪别的东西 -->
        <FPAlertPanel v-if="ov?.period" v-model:open="alertOpen" :count="alertGroups.length" :groups="alertGroups" />
      </div>
      <div class="dh-hright">
        <span v-if="!ov" class="fp-shim" style="display:block;width:150px;height:12px"></span>
        <span v-else-if="ov.period" class="dh-counts" data-stale-host :class="{ 'fp-stale': veil }" :aria-busy="veil">
          出账 {{ checks.byCol.billing.done }}/{{ checks.byCol.billing.total }} ·
          附表 {{ checks.byCol.booking.done }}/{{ checks.byCol.booking.total }}
        </span>
        <template v-if="isReviewer">
          <button class="dh-pill dh-rvpill" :data-on="onlyPending"
                  v-tip="onlyPending ? '再点一下看全部行' : '只看待审核的行'"
                  @click="onlyPending = !onlyPending">
            {{ reviewCounts.pending ? `待审核 ${reviewCounts.pending}` : '暂无待审' }}
          </button>
          <span class="dh-rvcount">本月已审 {{ reviewCounts.approved }}/{{ reviewCounts.total }}</span>
        </template>
        <Popover v-if="isSupervisor" v-model="editorsOpen" align="end" :width="280">
          <template #trigger>
            <!-- editors 只数别人(presence.others 不含自己):胶囊与下拉同一口径写「别人」,自己在编辑时不说「无人」 -->
            <button class="dh-pill dh-edpill">{{ editors.length ? `别人在编辑 ${editors.length}` : '没有别人在编辑' }}</button>
          </template>
          <p v-if="!editors.length" class="dh-edempty">现在没有别人在编辑</p>
          <button v-for="e in editors" :key="e.sid" class="dh-edrow"
                  @click="editorsOpen = false; goEditor(e.target)">{{ e.note }}</button>
        </Popover>
      </div>
    </div>
    <FPReviewDialog v-if="dialog" :target="dialog.label" :action="dialog.action"
                    :busy="!!acting"
                    @close="dialog = null" @confirm="onDialogConfirm" />

    <template v-if="!ov">
      <!-- 年份条骨架(P2 T4):年份数在数据到达前不可知,骨架给一年(78px≈62px 卡+行距);
           真版式若是多年,这一块会长高 —— 同轴同序的增高,不是版式塌(T3 修的是轴向从单列跳成两栏)。 -->
      <div class="dh-ystrip"><span class="fp-shim" style="display:block;height:78px;border-radius:8px"></span></div>
      <!-- 骨架也要两栏(评审修补 T3 fix-brief #1):真版式(:247)的两个 section 包在 .dh-cols 里,
           骨架不包的话数据落位那一瞬轴向会从单列竖排跳成两栏并排,整屏塌一次。 -->
      <div class="dh-cols">
        <section class="dh-sec">
          <h3 class="dh-h3">出账链</h3>
          <ul class="dh-rows">
            <li v-for="i in 7" :key="i" class="dh-row dh-row-billing" style="cursor:default">
              <span class="fp-shim" style="width:12px;height:12px;border-radius:50%;flex:0 0 auto"></span>
              <span class="fp-shim" style="display:block;width:64px;height:12px"></span>
            </li>
          </ul>
          <Card surface="white" class="dh-cur">
            <div class="dh-curmain">
              <span class="fp-shim" style="display:block;width:128px;height:16px"></span>
              <span class="fp-shim" style="display:block;width:196px;height:12px"></span>
            </div>
            <span class="fp-shim" style="display:block;width:104px;height:34px;border-radius:8px"></span>
          </Card>
        </section>
        <section class="dh-sec">
          <h3 class="dh-h3">附表录入</h3>
          <ul class="dh-rows">
            <li v-for="i in 12" :key="i" class="dh-row dh-row-booking" style="cursor:default">
              <span class="fp-shim" style="width:10px;height:10px;border-radius:50%;flex:0 0 auto"></span>
              <span class="fp-shim" style="display:block;width:76px;height:11px"></span>
            </li>
          </ul>
        </section>
      </div>
    </template>

    <template v-else>
    <!-- 年份条(P2 T4):取代月份下拉。manage-years=false —— 首页这条是导航不是账册管理,
         「添加次年」在总览屏不产生任何数据,接了线也没有语义(裁定 5)。 -->
    <div v-if="ov.period" class="dh-ystrip">
      <!-- scroll-row:S 档一行 12 格 + 横滚(2026-09-21 用户拍板,理由见 BookMonthMatrix 的 prop 注释)。
           4 列 × 3 行时 4 年要 976px,而手机内容带只有 ~848px —— 下面的出账链与附表两列整块出屏。 -->
      <BookMonthMatrix :book="{}" :years="yearRows" :manage-years="false" scroll-row
                       @pick="(y, m) => { pickedYm = `${y}-${String(m).padStart(2, '0')}` }" />
    </div>

    <!-- 全新库:一条数据都没有,只给一句引导,不摆空架子 -->
    <FPEmpty v-if="!ov.period" action="从园区抄表开始 →" @action="go('meters')">还没开始出账</FPEmpty>

    <template v-else>
      <!-- 两栏清单(P2 T3,monthClose.logic §5.2):出账列 7 行 / 记账列 8 行,行是常驻的 ——
           状态用 :data-state 属性驱动样式,na(源缺)的行照样渲染,状态位显「—」,不 v-if 掉整行。 -->
      <div class="dh-cols" data-stale-host :class="{ 'fp-stale': veil }" :aria-busy="veil">
        <!-- ① 出账列:链五步 + 收入核对 + 本月锁账,有先后依赖,一眼看出卡在哪一步 -->
        <section class="dh-sec">
          <h3 class="dh-h3">出账链</h3>
          <ul class="dh-rows">
            <li v-for="r in billingRows" :key="r.key" class="dh-row dh-row-billing"
                :class="{ 'dh-row-clickable': r.go }" :data-state="r.state" @click="r.go && go(r.go, r.tag)">
              <span class="dh-rdot">{{ dotOf(r.state) }}</span>
              <span class="dh-rlabel">{{ r.label }}</span>
              <span v-if="r.tag" class="dh-rtag">{{ r.tag }}</span>
              <span v-if="r.detail" class="dh-rdetail">{{ r.detail }}</span>
              <!-- 出账列的行从不带 chips(rowsOf 只给记账行发 chips)——评审修补 T3 fix-brief #4 删掉
                   这条恒不可达的死分支,别留着骗人。 -->
              <span v-if="r.locked" class="dh-rlock" v-tip="r.locked"><component :is="iconFor('lock')" :size="12" /></span>
              <span class="dh-rreview" :data-review="r.review" v-tip="reviewTip(r.reviewKey, r.review)">{{ reviewText(r.review) }}</span>
              <span class="dh-racts" @click.stop>
                <template v-for="a in [actionsOf(r)]" :key="r.key">
                  <!-- 交审:有资格但还没录完时**画出来但按不动** —— 直接不画会让人以为界面坏了。
                       多键行只交已录完的那几把(只录了 A 公司就只交 A 公司)。 -->
                  <button v-if="a.submitPending.length" class="dh-abtn"
                          :disabled="!a.submit.length || !!acting"
                          v-tip="a.submit.length ? `交给审核员（${a.submit.length} 项）` : '还没录完,做完才能交审'"
                          @click="onSubmit(a.submit)">交审</button>
                  <button v-if="a.approve.length" class="dh-abtn ok"
                          :disabled="blockedBy(a.approve).length > 0 || !!acting"
                          v-tip="blockedBy(a.approve).length ? `先通过 ${blockedBy(a.approve).join(' / ')} 的审核` : '通过'"
                          @click="onApprove(a.approve)">通过</button>
                  <button v-if="a.back.length" class="dh-abtn" :disabled="!!acting"
                          @click="openDialog(a.back, `${shownYm} ${r.label}`, 'return')">退回</button>
                  <button v-if="a.undo.length" class="dh-abtn" :disabled="!!acting"
                          @click="openDialog(a.undo, `${shownYm} ${r.label}`, 'withdraw')">撤销</button>
                </template>
              </span>
            </li>
          </ul>

          <!-- ② 当前步大卡:全页唯一主 CTA。未随两栏改版变化,仍读 ov.chain 原始态 -->
          <Card surface="white" class="dh-cur">
            <template v-if="curStep">
              <div class="dh-curmain">
                <span class="dh-curlabel">{{ curStep.label }}</span>
                <span v-if="curStep.detail" class="dh-curdetail">{{ curStep.detail }}</span>
              </div>
              <Button data-primary-cta variant="filled" @click="go(curStep.go)">
                {{ auth.isReadonly ? '查看' : '去处理' }} →
              </Button>
            </template>
            <template v-else>
              <div class="dh-curmain"><span class="dh-curlabel">本月出账已完成</span></div>
              <Button data-primary-cta variant="outline" @click="go('reconciliation')">去对账核对 →</Button>
            </template>
          </Card>
        </section>

        <!-- ③ 记账列:后端 9 源折成 8 行(附13+14/附7+8 各并一行),互相独立、可并行 -->
        <section class="dh-sec">
          <h3 class="dh-h3">附表录入 <span class="dh-h3n">{{ checks.byCol.booking.done }}/{{ checks.byCol.booking.total }}</span></h3>
          <ul class="dh-rows">
            <li v-for="r in bookingRows" :key="r.key" class="dh-row dh-row-booking"
                :class="{ 'dh-row-clickable': r.go }" :data-state="r.state" @click="r.go && go(r.go, r.tag)">
              <span class="dh-rdot">{{ dotOf(r.state) }}</span>
              <span class="dh-rlabel">{{ r.label }}</span>
              <span v-if="r.tag" class="dh-rtag">{{ r.tag }}</span>
              <span v-if="r.chips" class="dh-rchips">
                <!-- chip 同时带「做没做」(data-done,P2)与「审到哪一步」(data-review,R2):
                     两件事各自一维,合成一个属性就分不出「已录未交审」和「已交审待审核」。 -->
                <span v-for="c in r.chips" :key="c.label" class="dh-chip"
                      :data-done="c.done" :data-review="c.review ?? 'na'"
                      v-tip="reviewTip(c.reviewKey, c.review ?? 'na')"
                      @click.stop="goChip(r, c)">{{ c.label }}</span>
              </span>
              <!-- 记账行从不设 locked(只有本月锁账才有,那是出账列的行)——评审修补 T3 fix-brief #4
                   删掉这条恒不可达的死分支。 -->
              <span class="dh-rreview" :data-review="r.review" v-tip="reviewTip(r.reviewKey, r.review)">{{ reviewText(r.review) }}</span>
              <span class="dh-racts" @click.stop>
                <template v-for="a in [actionsOf(r)]" :key="r.key">
                  <!-- 交审:有资格但还没录完时**画出来但按不动** —— 直接不画会让人以为界面坏了。
                       多键行只交已录完的那几把(只录了 A 公司就只交 A 公司)。 -->
                  <button v-if="a.submitPending.length" class="dh-abtn"
                          :disabled="!a.submit.length || !!acting"
                          v-tip="a.submit.length ? `交给审核员（${a.submit.length} 项）` : '还没录完,做完才能交审'"
                          @click="onSubmit(a.submit)">交审</button>
                  <button v-if="a.approve.length" class="dh-abtn ok"
                          :disabled="blockedBy(a.approve).length > 0 || !!acting"
                          v-tip="blockedBy(a.approve).length ? `先通过 ${blockedBy(a.approve).join(' / ')} 的审核` : '通过'"
                          @click="onApprove(a.approve)">通过</button>
                  <button v-if="a.back.length" class="dh-abtn" :disabled="!!acting"
                          @click="openDialog(a.back, `${shownYm} ${r.label}`, 'return')">退回</button>
                  <button v-if="a.undo.length" class="dh-abtn" :disabled="!!acting"
                          @click="openDialog(a.undo, `${shownYm} ${r.label}`, 'withdraw')">撤销</button>
                </template>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
    </template>
  </div>
</template>

<style scoped>
/* position: relative 是 FPLoadBar 的宿主要求 —— 那条 2px 进度线是 absolute,
   没有定位祖先会跑到外壳上去(组件头注写明它不替宿主设,包一层 div 会碰本仓的定高链)。 */
.dh { position: relative; display: flex; flex-direction: column; gap: 20px; padding: 24px; }

/* min-height 28 = 待处理胶囊高:数据到了胶囊才出现,标题行不能因此长高把下面推下去 */
.dh-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 28px; }
.dh-period { display: flex; align-items: center; gap: 12px; }
.dh-hright { display: flex; align-items: center; gap: 10px; }
/* 标题行胶囊(审核员的「待审核」筛选、主管的「在编辑」):28 高,与待处理胶囊同高 */
.dh-pill {
  flex: 0 0 auto; height: 28px; box-sizing: border-box; font-size: var(--fs-label); color: var(--text-primary);
  background: var(--surface-card); border: 1px solid var(--border-control);
  border-radius: var(--radius-full); padding: 0 12px; cursor: pointer; white-space: nowrap;
}
.dh-pill[data-on="true"] { border-color: var(--hue-orange); color: var(--hue-orange); background: var(--warn-soft); }
.dh-rvcount { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); white-space: nowrap; }
.dh-edempty { margin: 4px 8px; font-size: var(--fs-label); color: var(--text-muted); }
.dh-edrow {
  display: block; width: 100%; text-align: left; padding: 8px; border: none; border-radius: var(--radius-sm);
  background: transparent; font-size: var(--fs-label); color: var(--text-primary); cursor: pointer;
}
.dh-edrow:hover { background: var(--surface-sunken); }
.dh-title { font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.dh-mnow { font-size: var(--fs-label); color: var(--text-secondary); }
.dh-counts { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); }
.dh-ystrip { margin-bottom: 4px; }


.dh-sec { display: flex; flex-direction: column; gap: 12px; }
.dh-h3 { font-size: var(--fs-body); font-weight: var(--fw-medium); color: var(--text-primary); margin: 0; }
.dh-h3n { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); margin-left: 8px; }

.dh-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }

.dh-rows {
  display: flex; flex-direction: column; list-style: none; margin: 0; padding: 0;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); overflow: hidden;
}
.dh-row {
  display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 6px 12px;
  background: var(--surface-white); border-bottom: 1px solid var(--border-subtle);
  font-size: var(--fs-label); transition: background var(--dur-fast) var(--ease-standard);
}
.dh-row:last-child { border-bottom: none; }
.dh-row-clickable { cursor: pointer; }
.dh-row-clickable:hover { background: var(--surface-card); }
.dh-row-clickable:active { background: var(--ink-100); transition-duration: 0ms; }
.dh-row[data-state="done"] { color: var(--text-secondary); }
.dh-row[data-state="done"] .dh-rdot { color: var(--hue-blue); }
.dh-row[data-state="stale"] .dh-rdot { color: var(--hue-orange); }
.dh-row[data-state="na"] { color: var(--text-disabled); }
.dh-rdot { font-size: 12px; flex: 0 0 auto; }
.dh-rlabel { color: var(--text-primary); }
.dh-row[data-state="na"] .dh-rlabel { color: var(--text-disabled); }
.dh-rtag { font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-secondary); }
.dh-rdetail { font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-secondary); }
.dh-rchips { display: flex; flex-wrap: wrap; gap: 4px; }
.dh-chip {
  font-size: var(--fs-micro); padding: 2px 8px; border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary);
  cursor: pointer; transition: background var(--dur-fast) var(--ease-standard);
}
/* 按 chip 时外层行也压一下,接受(C2-08) */
.dh-chip:active { background: var(--ink-100); transition-duration: 0ms; }
.dh-chip[data-done="false"] { color: var(--text-disabled); }
.dh-rlock { color: var(--hue-orange); flex: 0 0 auto; }
.dh-rreview {
  margin-left: auto; flex: 0 0 auto;
  font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-disabled);
}
/* 四态各一色。na 保持灰 —— 「不知道」不该看着像一个状态。 */
.dh-rreview[data-review="submitted"] { color: var(--hue-orange); }
.dh-rreview[data-review="approved"]  { color: var(--hue-green); }
.dh-rreview[data-review="returned"]  { color: var(--hue-red); }

/* 动作位常驻定宽:有没有按钮都占同一格,行不会因为审核态变化而左右晃(LAYOUT-STABILITY)。 */
.dh-racts { flex: 0 0 auto; width: 96px; display: flex; justify-content: flex-end; gap: 4px; }
.dh-abtn {
  font-size: var(--fs-micro); line-height: 1; padding: 3px 7px;
  border: 1px solid var(--border-control); border-radius: var(--radius-full);
  background: var(--surface-white); color: var(--text-secondary); cursor: pointer; white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.dh-abtn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dh-abtn:active:not(:disabled) { background: var(--ink-100); transition-duration: 0ms; }
.dh-abtn.ok { border-color: var(--hue-green); color: var(--hue-green); }
.dh-abtn:disabled { opacity: .45; cursor: not-allowed; }

/* chip 的审核态:已审绿勾 / 待审橙 / 已退回红。未录(data-done=false)仍是灰,两维叠加。 */
.dh-chip[data-review="approved"]  { border-color: var(--hue-green); color: var(--hue-green); }
.dh-chip[data-review="submitted"] { border-color: var(--hue-orange); color: var(--hue-orange); }
.dh-chip[data-review="returned"]  { border-color: var(--hue-red); color: var(--hue-red); }

.dh-cur { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; }
.dh-curmain { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dh-curlabel { font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.dh-curdetail { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); }

/* 两栏(.dh-cols)窄档收成单栏 —— 两列各自的行本就定宽站满,挤在一起会把 chips/tag 顶挤没了。
   换行/折栏由视口宽度决定、同一视口内确定不变 —— 不违反同视口交互零位移(§7)。 */
@media (max-width: 900px) {
  .dh-cols { grid-template-columns: 1fr; }
}

/* ── S 档(≤600,RESPONSIVE-LAYOUT-SPEC §5;宽档规则在前)──
   .dh-rows 一行一条,天生不需要 flex-wrap。
   只有三个 space-between 行在 390 视口(内容区 ~310)会被撑破,放开换行:
   - head:标题+月份+待处理(~300px)+ 进度数字与胶囊装不进一行 → 右组落到第二行,右组自己也可折;
   - cur 大卡:骨架 shim 定宽 196px + 按钮 104px > 卡内宽 → 按钮落下一行(数据态同理);
   - empty 空态:文案 + CTA 同题。
   换行由视口宽度决定、同一视口内确定不变——不违反同视口交互零位移(§7)。 */
@media (max-width: 600px) {
  .dh-head, .dh-hright, .dh-cur { flex-wrap: wrap; }
}
</style>
