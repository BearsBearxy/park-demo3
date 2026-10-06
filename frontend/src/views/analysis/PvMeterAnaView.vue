<script setup lang="ts">
// 光伏分栋分析(pv-meter-analysis)— PV-ANALYSIS-SCREEN-V4 §2(版式)+ PV-ANALYSIS-SPEC(口径)。
//
// **一个仪器,两档缩放。** 期间切「按月 / 按年」,屏跟着换刻度:
//   按月段 → x = 当月 1…31 日,一个点 = 当日。按年段 → x = 12 个月,一个点 = 当月。
// **模型永远吃全年,只有「画哪一段」跟着期间变** —— 模型要历史,屏要新鲜。
//
// 自上而下四块(V4 §2):KPI 行(AnaShell #kpis)→ 主卡(芯片 + 大图 + 判据脚)→ 段控 → 档内卡片;
// 单栋抽屉另起。数据整形全在 pvAnaV4.logic.ts,叶子组件只做像素几何;这里只接线。
//
// 铁律:一份数据、一次计算。只有换**年**才重新取数。
//
// ⚠ 文案(§05):屏只说明可视化在做什么,不输出解释性结论;任何档都不写统计名词。
import { computed, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import Segmented from '@/components/ds/Segmented.vue'
import { iconFor } from '@/components/ds/icon'
import PvChips from './PvChips.vue'
import PvDayChart from './PvDayChart.vue'
import PvPerKwBars from './PvPerKwBars.vue'
import PvYieldBand from './PvYieldBand.vue'
import PvAnchorBars from './PvAnchorBars.vue'
import PvLedgerScatter from './PvLedgerScatter.vue'
import PvConsumption from './PvConsumption.vue'
import PvRevenueBars from './PvRevenueBars.vue'
import PvAlphaBars from './PvAlphaBars.vue'
import PvResidualHeat from './PvResidualHeat.vue'
import PvQualityGrid from './PvQualityGrid.vue'
import PvLabTable from './PvLabTable.vue'
import PvDriftChart from './PvDriftChart.vue'
import PvControlChart from './PvControlChart.vue'
import PvBetaChart from './PvBetaChart.vue'
import PvDetailTable from './PvDetailTable.vue'
import { usePeriod } from '@/analysis/usePeriod'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { useViewport } from '@/composables/useViewport'
import { useWidth } from '@/components/ana/useWidth'
import { fnum } from '@/components/ana/anaFmt'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import { elecCostApi } from '@/api/elecCost'
import { fetchAvailableMonths } from '@/analysis/anaData'
import { PV, PVH, monthLabel, yearLabel, pvMeterAsof, pvRunCount } from '@/components/ana/anaSentence'
import {
  buildSnapshot, buildDetail, buildLab, DEFAULT_CRITERIA,
  type AnaSnapshot, type BoardRow, type Criteria, type SnapshotInput,
} from './pvMeterAna.logic'
import {
  chipGroups, dayFact, isUnreadable, critFoot, yieldBand, anchorBars, ledgerScatter, consumption, revenueBars,
  alphaBars, polishStability, residualGrid, qualityCalendar, labTableRows,
  driftChart, controlChart, betaSlots, detailRows, phaseName,
  pvKpis, perKwCard, defaultPick, judgedN, shortRefOf, coverOf,
} from './pvAnaV4.logic'

// 不给外壳传 compare(不出对比开关):比较(比上月 / 比去年同期)直接写在 KPI 副行和新卡的列里,
// 不靠外壳的开关切 —— 开关可点却什么都不变是假控件。

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
// periodMode='full':外壳给「按月 / 按年」+ 年选 + 月选,屏只读 sel
const gran = computed<'month' | 'year'>(() => (period.sel.value.gran === 'year' ? 'year' : 'month'))
const year = computed(() => period.sel.value.year)
const month = computed(() => period.sel.value.month)

const stations = ref<PvStationDTO[]>([])
const readings = ref<PvReadingDTO[]>([])
const prevReadings = ref<PvReadingDTO[] | undefined>(undefined)
const crit = ref<Criteria>({ ...DEFAULT_CRITERIA })
/** 上网单价 'YYYY-MM' → ¥/kWh(这一年和上一年 24 个月);没读到的月 = null */
const prices = ref<Record<string, number | null>>({})
const loading = ref(true)
/** 没读到的那一年(null = 没失败)。只在成功分支清:点「重试」在途时失败卡留在原地,不先闪回旧年内容;
 *  记年不记布尔:失败卡留着时换了年,卡上的字仍说失败的那一年 */
const failed = ref<number | null>(null)
// 换年在途(C5-02):旧内容留在原地退让,不卸载。过 200ms 门槛才亮、退场立刻 —— 本地后端几十毫秒
// 就回来的那种请求全程静默,闪一下比不显示更晃眼
const staleShown = useDeferredFlag(loading)
/** 已经画在屏上的那一年。year 立刻变(下拉是控件回显),这个等 readings 一起换 ——
 *  不分开的话换年会先拿新年刻度配旧年读数画一遍空的再填满,等于把入场重播了一次(C5-02 ①) */
const loadedYear = ref(year.value)
let seq = 0

// 默认停在**去向和收益**(值 'ledger')—— 板数录进来之前只有这一档是全真数。第三档「核对明细」要点才进得去。
const section = ref<'abs' | 'ledger' | 'lab'>('ledger')

// 大图那一块的高:图头 24 + PvDayChart 画布(桌面 236 / 窄档 200)。
// 骨架占位、无可画栋时的占位块、真图三者必须同高 —— 写死 260 的时候窄档真版式只有 224,差 36px。
// 这里用视口档而不是容器宽:大图住在整幅内容宽里,两者等价(601–960 平板档容器仍 ≥420,走桌面值)。
// ⚠ 判据必须与图**同源**:图换几何看的是容器宽(useWidth 量的 clientWidth < 420),不是视口档。
// 用 tier === 's' 的话视口 488–600 这一段会分叉 —— 容器宽 = 视口 − .anx-body padding 24×2
// − .av2-card padding 10×2 = 视口 − 68,所以容器 ≥420 ⟺ 视口 ≥488。那一段里骨架取窄档、
// 真图取桌面,B7 差 42、B8 差 39,比不改还偏(2026-09-20 对抗复查实测)。
// 这里量 .pma-main 的卡内宽,与大图自己的 useWidth 量的是同一个盒子。
const { el: mainEl, width: mainW } = useWidth(999)
const narrow = computed(() => mainW.value < 420)
const mainBlockH = computed(() => (narrow.value ? '224px' : '260px'))

// ⚠ 本文件有**两条**窄档判据,别混用:
//   narrow —— 容器宽 < 420。只给「跟着自绘图几何走」的东西用(上面的 mainBlockH:大图自己量的
//     就是这个盒子)。
//   isS    —— 视口 ≤600。给「由 @media (max-width:600px) 决定的东西」用:判据脚的两列网格、
//     ana.css 那整块 S 档规则(段控高、两列 KPI、order)、整屏 sheet(FPDrawer 自己的媒体查询)。
// 混用的代价是实打实的:容器宽 = 视口 − .anx-body padding 48 − .av2-card padding 20 = 视口 − 68,
// 所以容器 ≥420 ⟺ 视口 ≥488。骨架按 narrow 选高、而真版式由 @media 600 决定的话,
// 视口 488–600 那一段首进会硬跳(判据脚那块差 68px)。
const { tier } = useViewport()
const isS = computed(() => tier.value === 's')

const CRIT_KEYS = [
  'pv_yield_anchor_h', 'pv_crit_cover_month', 'pv_crit_ledger',
  'pv_crit_yield_ratio', 'pv_band_sigma', 'pv_band_run',
] as const

/** 判据线来自计费参数 —— 屏上写的必须是**当前生效的那个数**,取不到就回落默认,线屏照常出。
 *  返回值由 load() 和读数同一句提交(C5-02 ①):自己写 crit.value 的话,参数接口比整年抄表先回来
 *  就会出现「旧年的图配新年的判据」—— 带上下沿、出范围天数、芯片颜色全按新阈值重算 */
async function loadCrit(y: number): Promise<Criteria> {
  try {
    const rows = await paramsApi.list(`${y}-12`, 'all', { key: CRIT_KEYS.join(',') })
    const at = new Map(rows.filter(r => r.scope === '').map(r => [r.key, r.value]))
    const n = (k: string, d: number) => {
      const v = at.get(k)
      return typeof v === 'number' && isFinite(v) ? v : d
    }
    return {
      anchorHours: n('pv_yield_anchor_h', DEFAULT_CRITERIA.anchorHours),
      coverMonth: n('pv_crit_cover_month', DEFAULT_CRITERIA.coverMonth),
      ledger: n('pv_crit_ledger', DEFAULT_CRITERIA.ledger),
      yieldRatio: n('pv_crit_yield_ratio', DEFAULT_CRITERIA.yieldRatio),
      bandSigma: n('pv_band_sigma', DEFAULT_CRITERIA.bandSigma),
      bandRun: n('pv_band_run', DEFAULT_CRITERIA.bandRun),
      minOnlineDays: DEFAULT_CRITERIA.minOnlineDays,
    }
  } catch { return { ...DEFAULT_CRITERIA } /* 用默认值,屏照常出 */ }
}

/** 上网单价(计费参数 pv_grid_price)按月取:后端 priceCfg 已按「当月有值用当月,否则用默认」解析好,
 *  同园区能耗屏逐月取的做法 —— 某月单独调过价,两屏同一个月的上网收益对得上。
 *  取这一年和上一年(比去年同期、1 月比上一年 12 月要用)。某个月没读到 = null:那几个月的上网收益不算,参照里写明,
 *  不拿一个常数顶上(顶上的数和系统里的价不一样,屏上还会说成「系统里的」)。
 *  ponytail: 一年 24 趟请求;后端有整年月价表的接口时换成一趟 */
async function loadPrices(y: number): Promise<Record<string, number | null>> {
  const yms = [y - 1, y].flatMap(yr => Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`))
  const vs = await Promise.all(yms.map(ym => elecCostApi.priceCfg(ym)
    .then(cs => { const v = cs.find(c => c.cfgKey === 'pv_grid_price')?.value; return typeof v === 'number' && v > 0 ? v : null })
    .catch(() => null)))
  return Object.fromEntries(yms.map((ym, i) => [ym, vs[i]]))
}
/** 给 logic 的取价函数:按读数所在的月取 */
const priceOf = computed(() => { const p = prices.value; return (ym: string) => p[ym] ?? null })

// 取的永远是**整年**:看板只画选中那段,但范围要拿段外的数据来估(§03.7)。
// 上一年整年同一趟取(2026-10-06 改稿):屏顶比去年同月、1 月比上月、新卡比去年那列都要它。
// 上一年取不到不算这一年失败 —— 那几格写「—」,不说「还没有」(prevReadings 为 undefined)
async function load(y: number) {
  const my = ++seq
  loading.value = true
  try {
    const [sts, rds, prev, cr, gp] = await Promise.all([
      stations.value.length ? Promise.resolve(stations.value) : pvMeterApi.stations(),
      pvMeterApi.readingsYear(y),
      pvMeterApi.readingsYear(y - 1).catch(() => undefined),
      loadCrit(y),
      loadPrices(y),
    ])
    if (my !== seq) return
    stations.value = sts
    readings.value = rds
    prevReadings.value = prev
    crit.value = cr
    prices.value = gp
    loadedYear.value = y
    failed.value = null
  } catch {
    if (my === seq) failed.value = y
  } finally {
    if (my === seq) loading.value = false
  }
}
onMounted(() => { void load(year.value) })
// 只有换**年**才重新取数;切月 / 切粒度都在同一份整年数据上重算,不打接口
watch(year, (y) => { void load(y) })

// 工具条「数据截至」:分栋抄表写成年内范围(这一年第一条到最后一条读数的月),光伏月账到哪个月(S-34)。
// 月账月份走外壳同一份缓存(onMounted:让外壳先取 —— 子组件的 onMounted 先跑,同一份缓存)
const recYm = ref<string | null>(null)
onMounted(() => { void fetchAvailableMonths().then((d) => { recYm.value = d.sources.pv?.[d.sources.pv.length - 1] ?? null }).catch(() => {}) })
const asofText = computed(() => {
  if (!readings.value.length) return undefined
  let a = '9999', b = '0000'
  for (const r of readings.value) { if (r.readDate < a) a = r.readDate; if (r.readDate > b) b = r.readDate }
  return pvMeterAsof(loadedYear.value, +a.slice(5, 7), +b.slice(5, 7), recYm.value)
})

// ── 唯一的一次计算 ────────────────────────────────────────────────────
const snapInput = computed<SnapshotInput | null>(() => {
  if (!readings.value.length) return null
  return {
    year: loadedYear.value,
    gran: gran.value,
    month: month.value || undefined,
    stations: stations.value.map(s => ({
      id: s.id, name: s.name, phase: s.phase, metered: s.metered === 1,
      capKwp: s.capacityKwp, panelCount: s.panelCount, panelWatt: s.panelWatt,
    })),
    rows: readings.value.map(r => ({
      stationId: r.stationId, date: r.readDate, gen: r.genTotal,
      selfUse: r.selfUse, gridFeed: r.gridFeed, revenue: r.revenue, priceSnap: r.priceSnap,
    })),
    prevRows: prevReadings.value?.map(r => ({
      stationId: r.stationId, date: r.readDate, gen: r.genTotal,
      selfUse: r.selfUse, gridFeed: r.gridFeed, revenue: r.revenue, priceSnap: r.priceSnap,
    })),
    gridPrice: priceOf.value(`${loadedYear.value}-12`) ?? 0,   // 只进 core 的 revGrid / yoy,本屏不显示;收益按月价算在 pvAnaV4.logic
    crit: crit.value,
  }
})
const snap = computed<AnaSnapshot | null>(() => (snapInput.value ? buildSnapshot(snapInput.value) : null))

// ── B0 KPI 行(2026-10-06 改稿:发了多少、每千瓦多少、哪栋偏离、自己用了多少、挣了多少)──────────
// 副行两行 = 比上期 + 比去年同期(按年只有比去年),没数写「—」。首进摆 5 张占位瓦
const KPI_HOLD = 5
const kpis = computed(() => (snap.value && snapInput.value
  ? pvKpis(snap.value, snapInput.value.rows, snapInput.value.prevRows, priceOf.value) : []))

// ── B1 芯片 + 单栋大图(§3.2)──────────────────────────────────────────
const board = computed<BoardRow[]>(() => snap.value?.board ?? [])
const bornRows = computed(() => board.value.filter(b => b.bornBySeg))

/** 芯片顺序,**不含选中态**:抽屉「上一栋 / 下一栋」按它走 —— 带着选中算的话,
 *  选中的栋会在常显与收起之间来回挪,边走边变序 */
const chipOrder = computed(() => {
  if (!snap.value) return [] as number[]
  const g = chipGroups(snap.value, null)
  return [...g.shown, ...g.folded].filter(c => c.clickable).map(c => c.id)
})

const selId = ref<number | null>(null)
const drawerOpen = ref(false)
/** 默认停在本段偏离天数最多、且判得了的那栋(有连着偏离的优先)—— 首屏不用点就有东西看;
 *  不停在芯片第一枚:那常是历史不够、画不出范围的楼(2026-10-06 改稿) */
watch([chipOrder, () => snap.value?.id], () => {
  if (selId.value != null && bornRows.value.some(r => r.id === selId.value)) return
  selId.value = snap.value ? defaultPick(snap.value) : null
  // #st= 深链 / 换期后,抽屉开着的那栋不在本段已投产里:抽屉标题会换成另一栋、地址栏还是原 id —— 关掉
  if (drawerOpen.value && snap.value) closeDrawer()
}, { immediate: true })
const selRow = computed(() => bornRows.value.find(r => r.id === selId.value) ?? null)
const selStation = computed(() => snap.value?.stations.find(s => s.id === selId.value) ?? null)

const chips = computed(() => (snap.value ? chipGroups(snap.value, selId.value) : { shown: [], folded: [], unit: '天' }))
const fact = computed(() => (snap.value && selRow.value ? dayFact(selRow.value, snap.value) : ''))
/** 天 / 个月:主卡卡名、卡头、计数句跟着期间换 */
const unit = computed(() => (gran.value === 'month' ? '天' : '个月'))
const devHint = computed(() => (snap.value ? PVH.dev(judgedN(snap.value), unit.value) : ''))
/** 计数句:本段有几栋连着偏离平时(0 栋不出,位置留着 —— 主卡恒高) */
const runRead = computed(() => {
  const s = snap.value
  if (!s) return null
  const n = [...chips.value.shown, ...chips.value.folded].filter(c => c.kind === 'hit').length
  return pvRunCount(s.gran === 'month' && s.ym ? monthLabel(+s.ym.slice(5, 7)) : yearLabel(s.year), n, s.crit.bandRun, unit.value)
})
/** 历史不够的楼:哪天才有第一条读数、还差多少(没有这种楼不出,位置留着) */
const shortRef = computed(() => (snap.value ? shortRefOf(snap.value) : null))

// ── 新卡:各栋每千瓦日均发电(第一排右边 s4)──────────────────────────────
const perKw = computed(() => (snap.value && snapInput.value
  ? perKwCard(snap.value, snapInput.value.rows, snapInput.value.prevRows, priceOf.value) : null))

/** 芯片 / A2 行 / α 条 → 换选中。**不开抽屉**(抽屉会盖住刚换的图,§6.6)。未投产挡掉。 */
function pickStation(id: number) {
  if (bornRows.value.some(r => r.id === id)) selId.value = id
}

// ── B2 判据脚(§3.3)──────────────────────────────────────────────────
const foot = computed(() => (snap.value ? critFoot(snap.value, selId.value) : null))

// 「去改」落计费参数「光伏分栋判据」区(section=pv,S21 §5.7)。adopt=YYYY-12 只在会话还没有出账月时认领(常数存 12 月的约定,PvAnalysis §01);
// 已选期的会话不动 —— 它不是选月,不能用 p= / ym=(那两个是显式深链,会覆盖组级期;2026-09-03 P0a 复查 P0A-2)。
function gotoParams() {
  tabs.openDeep('params')
  void router.push({ path: '/params', query: { adopt: `${year.value}-12`, section: 'pv' } })
}
/** 板数与单块标称功率在分栋运营账里录(光伏发电屏的 meter 那本;不带 mode 会落到本机记住的那本,默认汇总本) */
function goMeter(): void {
  tabs.openDeep('pv-income')
  void router.push({ path: '/pv-income', query: { mode: 'meter' } })
}

// ── 段控(§3.4)──────────────────────────────────────────────────────
/** 抛光矩阵里一栋都没有 → 高级分析整档不出现(不用先跑 buildLab 才知道)。 */
const labReady = computed(() => (snap.value?.polish.resid.size ?? 0) > 0)
const SECTIONS = computed(() => [
  { value: 'abs', label: PV.tab.abs },
  { value: 'ledger', label: PV.tab.ledger },
  ...(labReady.value ? [{ value: 'lab', label: PV.tab.lab }] : []),
])
// 整档隐藏时把档位挪到还在的那一档 —— 停在一个不存在的档等于整片空白
watch(SECTIONS, (opts) => {
  if (!opts.some(o => o.value === section.value)) section.value = 'ledger'
}, { immediate: true })

/** 核对明细窄档默认不出逐栋核对表,点「更多分析」才出(2026-10-06 改稿:隔天像不像 / 碰巧更偏两张卡并进了核对表,
 *  「更多分析」里只剩它)。桌面 isS 恒 false → 全出。
 *  ponytail: 不随换档 / 换栋复位 —— 点开过的人是要看的,收回去等于替他做决定。 */
const labMore = ref(false)
const labShowAll = computed(() => !isS.value || labMore.value)

// ── 绝对水平 / 账面量 ────────────────────────────────────────────────
const yb = computed(() => (snap.value && snapInput.value ? yieldBand(snap.value, snapInput.value.rows, selId.value) : null))
const anchor = computed(() => (snap.value && snapInput.value
  ? anchorBars(snap.value, snapInput.value.rows, snapInput.value.prevRows) : null))
const ledgerSc = computed(() => (snap.value ? ledgerScatter(snap.value) : null))
const cons = computed(() => (snap.value && snapInput.value ? consumption(snap.value, snapInput.value.rows, snapInput.value.prevRows) : null))
const rev = computed(() => (snap.value && snapInput.value ? revenueBars(snap.value, snapInput.value.rows, priceOf.value) : null))

// ── 高级分析(§2.4)──────────────────────────────────────────────────
/**
 * **只在这一档被选中时才算** —— 它比首屏那次重得多(13 次 buildDetail + 第二次抛光 + 逐栋打乱重算),
 * 九成的人根本不点开这一档。2026-10-06 起不跟选中栋走(零分布那张卡下线),换选中不重算。
 */
const lab = computed(() => {
  if (section.value !== 'lab' || !snap.value || !snapInput.value) return null
  return buildLab(snap.value, snapInput.value)
})
const labView = computed(() => {
  const l = lab.value, s = snap.value
  if (!l || !s) return null
  return {
    alpha: alphaBars(l, s),
    stability: polishStability(l, s),
    heat: residualGrid(l, s),
    cal: qualityCalendar(l, s),
    rows: labTableRows(l, s),
    // 整年的卡放在按月的屏上,卡头写覆盖「2025年全年」;按年和工具条同一个期,不写(S-17)
    cover: s.gran === 'month' ? coverOf(s) : null,
    /** 「碰巧更偏」打乱的是哪个月 */
    winMonth: l.window.label ? Number(l.window.label.slice(5, 7)) : null,
  }
})

// ── 单栋抽屉(§2.5)──────────────────────────────────────────────────
// 关抽屉时期间档位、页面滚动位置、段控档位、选中栋一律不变 —— 这里只动 drawerOpen。
const detail = computed(() =>
  (snap.value && selId.value != null ? buildDetail(snap.value, selId.value) : null))
const drawer = computed(() => {
  const s = snap.value, d = detail.value, id = selId.value
  if (!s || !d || id == null || !snapInput.value) return null
  const drift = driftChart(d, s)
  return {
    drift,
    control: controlChart(d, s),
    beta: betaSlots(s, id),
    rows: detailRows(s, snapInput.value.rows, id),
  }
})
const drawerSub = computed(() => {
  const st = selStation.value
  if (!st) return ''
  return [
    `整年在网 ${st.days} 天`,
    `年发电 ${fnum(st.genYear / 10000, 1)}万kWh`,
    // 整数写整数,否则一位小数:9.3 不写成 9(和异常提醒中心「台账装机 9.3 kWp」、新卡的分母同一个数)
    ...(st.capKwp != null ? [`装机 ${fnum(st.capKwp, Number.isInteger(+st.capKwp.toFixed(1)) ? 0 : 1)} kWp`] : []),
    phaseName(st.phase),
  ].join(' · ')
})

// URL 加 #st={id} **不换路由**(§06.6):replace 不进历史栈,路径不变,KeepAlive 不重挂,
// 所以关抽屉时期间档位 / 滚动位置 / 段控档位全都原样留着。
function openDrawer() {
  if (selId.value == null) return
  drawerOpen.value = true
  void router.replace({ hash: `#st=${selId.value}` })
}
function closeDrawer() {
  drawerOpen.value = false
  void router.replace({ hash: '' })
}
/** 「上一栋 / 下一栋」按芯片顺序走(§6.6) */
function stepStation(d: 1 | -1) {
  const q = chipOrder.value
  const i = q.indexOf(selId.value ?? -1)
  const nx = q[(i + d + q.length) % q.length]
  if (nx != null) { selId.value = nx; openDrawer() }
}

// ── 手机:抽屉变整屏 sheet,四块改段控一次看一块(手机稿 PvDrawer §1)────────────────
// 竖排 240 + 210 + 180 + 表 在 390 上要滑两屏半,而「下一栋」在最底下 —— 逐栋翻看正是这个
// 抽屉存在的理由。改成顶部四档段控(一次一块)+ 脚部常驻上一栋 / 下一栋。
//
// 判**视口档**不判容器宽:这块 sheet 是 FPDrawer 自己的 `@media (max-width:600px)` 撑成整屏的,
// 它按哪条线整屏,这里就得按哪条线换排布。拿容器宽判(< 420)的话 488–600 那一段会分叉 ——
// CSS 已经整屏、JS 还按桌面竖排。自绘图那批走容器宽是另一回事:同一张图也出现在桌面窄栏里。
// jsdom 无 matchMedia → tier 恒 'xl' → 走桌面分支,既有用例与桌面版式零变化。
const sheet = isS
// 档名照四张卡的卡名取短(§05「任何档都不写统计名词」):每天的偏离和水平变化 / 每天的偏离和两道范围 /
// 跟全园一起涨落的程度 / 每天的读数 —— 页签和卡名一个说法,走句型库 PV.drawerTab
const DRAWER_TABS = [
  { v: 'drift', l: PV.drawerTab.drift },
  { v: 'ctrl', l: PV.drawerTab.ctrl },
  { v: 'beta', l: PV.drawerTab.beta },
  { v: 'rows', l: PV.drawerTab.rows },
] as const
const tab = ref<(typeof DRAWER_TABS)[number]['v']>('drift')
/** 脚部「下一栋 · X」写的是按芯片顺序的下一枚 —— 与 stepStation(1) 同一把序 */
const nextName = computed(() => {
  const q = chipOrder.value
  const id = q[(q.indexOf(selId.value ?? -1) + 1) % q.length]
  return snap.value?.stations.find(s => s.id === id)?.name ?? ''
})
// #st= 深链(C5-05 ④):挂载时只记下要开哪栋,**不立刻开** —— 数据还没到时抽屉标题是空的、
// 正文显「这栋可用的逐日偏离不足 8 天」,那句在加载期不成立。加载期只出页面骨架(C6-01),
// 等 snap 第一次非空、且这栋确实在本段已投产里,抽屉才 rise 上来。
// 记的是**深链点名的那一栋**,不是 selId —— selId 会被上面那条 watch 在本段没有这栋时
// 改写成芯片第一枚,拿它去判会把「99 不存在」读成「第一枚存在」,给用户开错栋的抽屉。
const pendingId = ref<number | null>(null)
onMounted(() => {
  const m = /#st=(\d+)/.exec(location.hash)
  if (m) { selId.value = Number(m[1]); pendingId.value = Number(m[1]) }
})
watch(snap, (s) => {
  if (pendingId.value == null || !s) return
  const id = pendingId.value
  pendingId.value = null
  if (bornRows.value.some(r => r.id === id)) openDrawer()
  else void router.replace({ hash: '' })   // 本段没有这栋:清掉地址栏,主图停在芯片第一枚
})
// KeepAlive 切走时抽屉 Teleport 在 body 上,不跟着根节点移走 —— 遮罩会盖到别的页签上。
// 只关状态,不调 closeDrawer:此刻当前路由已经是别的屏,replace hash 会写到它身上
onDeactivated(() => { drawerOpen.value = false })
</script>

<template>
  <AnaShell period-mode="full" :busy="staleShown" :asof-text="asofText" :kpi-hold="!snap && loading ? KPI_HOLD : 0">
    <!-- 瓦片门只看 snap:换年时旧瓦留在原位(整排先消失再出现是 C5-02 要修的那个形状);
         首进(!snap)由 .anx-kpis 的 min-height 94 兜空行 -->
    <template #kpis>
      <template v-if="snap">
        <AnaKpiTile v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value" :note="k.note" :drows="k.rows" />
      </template>
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。块高全照真版式与代码里钉死的数(2026-10-06 改稿起第一排两张同排) ——
         主卡 s8:卡头 + 芯片行 34(PvChips.vue)+ 大图区 272(上距 12 + 图头 24 + 画布 236)+ 计数句 / 历史不够两行(留空行)
         + .pma-div + 判据脚两行 16 + 2 + 16;新卡 s4:卡头 + 画布 298(上 18 + 13 栋 × 20 + 下 20,按库里现有 13 栋留)
         + 图例 8 + 16 + 读数句两行 + 参照两行;段控 32;.pma-sec 1200。
         KPI 行由外壳的占位瓦兜(5 张)。数据到了原地硬切,不做淡入。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <div v-if="!snap && loading" class="pma-skel">
      <!-- 卡头、段控行、档内两张卡照抄真版式(手机上卡头与段控说明都会折好几行,灰条顶不住);随数据变的字换成同长的隐形占位 -->
      <div class="av2-grid pma-row1">
        <div ref="mainEl" class="av2-card pma-main av2-s8">
          <div class="av2-card-h">
            <span class="t">{{ PV.card.dev(unit) }}</span>
            <span class="hint ana-hole">{{ PVH.dev(11, unit) }}</span>
            <button type="button" class="pma-lk ana-hole" disabled>{{ isS ? '看整年 →' : '看 00栋 的整年 →' }}</button>
          </div>
          <div class="pma-skel-chips"><div class="fp-shim" style="height: 26px; width: 260px"></div></div>
          <!-- 与 .pma-nochart 同一笔账:图头 24 + PvDayChart 画布(桌面 236 / 窄档 200)。
               两档各写一份字面高(anaSkeletonParity 读的是本文件源码里字面的 style="…height: NNNpx",
               绑成变量它就看不见这一块);判 narrow(容器宽),和大图自己换几何同一个判据 -->
          <div v-if="narrow" class="fp-shim" style="height: 224px; margin-top: 12px"></div>
          <div v-else class="fp-shim" style="height: 260px; margin-top: 12px"></div>
          <p class="ana-read hold"></p>
          <p class="ana-ref pma-short hold"></p>
          <div class="pma-div"></div>
          <!-- 判据脚:桌面两行 16 + 行距 2 = 34;窄档两列网格 + 行距 2 + 范围窗口句两行 32 = 102(算法见 <style> 里 S 档那段的空间账)。
               两档各写一份字面高 —— anaSkeletonParity 读的是本文件源码里的 style="…height: NNNpx",绑成变量它就扫不到这一块。 -->
          <div v-if="isS" class="fp-shim" style="height: 102px"></div>
          <div v-else class="fp-shim" style="height: 34px; width: 70%"></div>
        </div>
        <div class="av2-card av2-s4 pma-pk">
          <div class="av2-card-h">
            <span class="t">{{ PV.card.perKw }}</span>
            <span class="hint ana-hole">{{ gran === 'month' ? PVH.perKwM(13, '11月') : PVH.perKwY(13, year - 1) }}</span>
          </div>
          <div class="fp-shim" style="height: 298px"></div>
          <div class="fp-shim" style="height: 16px; margin-top: 8px; width: 60%"></div>
          <p class="ana-read pma-pk-read hold"></p>
          <p class="ana-ref pma-pk-ref hold"></p>
          <p class="ana-ref pma-pk-ref hold"></p>
        </div>
      </div>
      <div class="pma-seg">
        <div class="fp-shim" style="border-radius: 999px"><Segmented class="ana-hole" :model-value="section" :size="isS ? 'lg' : 'md'" :options="[{ value: 'abs', label: PV.tab.abs }, { value: 'ledger', label: PV.tab.ledger }, { value: 'lab', label: PV.tab.lab }]" /></div>
        <span class="pma-seghint ana-hole">{{ PV.segHint }}</span>
      </div>
      <div class="pma-sec">
        <div class="av2-grid">
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">{{ PV.card.cons }}</span>
              <span class="hint ana-hole">{{ PVH.cons(13) }}</span>
            </div>
            <!-- B7 = PvConsumption 画布 + 图例 + 读数句 + 参照(2026-10-06 改稿:长图注换成句子;按月两句参照、按年一句)。
                 浏览器实测卡头以下那一块(2026-10-06,开发库 13 栋,12 月 / 2025 年):1440 按月 372 / 按年 350;
                 390(卡内宽 258)按月 362 / 按年 360 —— 窄档画布 230,图例与句子折行。
                 高度必须是字面量 —— anaSkeletonParity 读的是本文件源码里的 style="…height: NNNpx",
                 绑成变量那道门禁就看不见这一块,所以四档各写一份节点。 -->
            <!-- 判 narrow(容器宽)不判 isS:顶替的是 PvConsumption,它自己量的就是容器宽 -->
            <div v-if="narrow && gran === 'year'" class="fp-shim" style="height: 360px"></div>
            <div v-else-if="narrow" class="fp-shim" style="height: 362px"></div>
            <div v-else-if="gran === 'year'" class="fp-shim" style="height: 350px"></div>
            <div v-else class="fp-shim" style="height: 372px"></div>
          </div>
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">{{ PV.card.rev }}</span>
              <span class="hint ana-hole">{{ PVH.rev(13) }}</span>
            </div>
            <!-- B8 = PvRevenueBars 画布 + 图例 + 读数句 + 参照。画布 = 上 6 + 栋数 × ROW + 下 26(PvRevenueBars.vue,ROW 桌面 27 / 窄档 30);
                 参照按月两句(上网单价、自用单价),按年多一句「哪几栋不是整年」。浏览器实测(同上,13 栋):
                 1440 按月 483 / 按年 505;390 按月 542 / 按年 564。高度同样得是字面量,四档各写一份节点。 -->
            <!-- 同上:顶替 PvRevenueBars,判容器宽 -->
            <div v-if="narrow && gran === 'year'" class="fp-shim" style="height: 564px"></div>
            <div v-else-if="narrow" class="fp-shim" style="height: 542px"></div>
            <div v-else-if="gran === 'year'" class="fp-shim" style="height: 505px"></div>
            <div v-else class="fp-shim" style="height: 483px"></div>
          </div>
        </div>
      </div>
    </div>
    <!-- skel:end -->
    <!-- 加载失败(画布 06-D 右格):换掉内容区,带重试;重试走同一个 load(首进 / 换年共用) -->
    <FPLoadError v-else-if="failed" sub="屏上不显示别的年份的数字" @retry="load(year)">{{ failed }} 年的分栋抄表数据没读到</FPLoadError>
    <AnaEmpty
      v-else-if="!snap"
      :label="year + ' 年暂无分栋抄表记录'"
      hint="这屏画的是分栋抄表数据，没有记录就没有可画的东西"
      to="/pv-income"
      to-text="去录入分栋抄表"
    />

    <!-- 换年在途:旧内容留在原地退让(C5-02)。data-stale-host 让类摘掉之后退场也是 200ms,
         否则数据回来那一帧是硬切;pointer-events:none 是安全项 —— 旧行还挂着时在上面录一格,
         保存走的是旧行 id。进度线不放这里面(会被 opacity .42 + blur 一起糊掉),挂在外壳工具条上。 -->
    <div v-else class="pma-body" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <!-- ══ 第一排(2026-10-06 改稿):主卡(芯片 + 单栋大图 + 判据脚)s8 + 新卡「各栋每千瓦日均发电」s4 ══
           两张同排、换栋 / 换期间同高:主卡计数句、历史不够那句没有时留空行(hold);新卡读数句钉两行、参照两行 -->
      <div class="av2-grid pma-row1">
        <div ref="mainEl" class="av2-card pma-main av2-s8">
          <div class="av2-card-h">
            <span class="t">{{ PV.card.dev(unit) }}</span>
            <span class="hint">{{ devHint }}</span>
            <!-- ≤600 不带楼名:楼名长短会让卡头多折一行(换栋卡头变高、下面整片跟着跳);楼名在大图图头上已经有 -->
            <button v-if="selRow" class="pma-lk" @click="openDrawer">{{ isS ? '看整年 →' : `看 ${selRow.name} 的整年 →` }}</button>
          </div>

          <PvChips :groups="chips" @pick="pickStation" />
          <PvDayChart
            v-if="selRow"
            :row="selRow" :ticks="snap.ticks" :tick-labels="snap.tickLabels" :gran="snap.gran"
            :elapsed-n="snap.elapsedN" :fact="fact" :unreadable="isUnreadable(selRow, snap)"
          />
          <div v-else class="pma-nochart" :style="{ height: mainBlockH }"><FPEmpty size="sm">{{ PV.noChart }}</FPEmpty></div>

          <p class="ana-read" :class="{ hold: !runRead }">{{ runRead?.text }}</p>
          <p class="ana-ref pma-short" :class="{ hold: !shortRef }">{{ shortRef?.text }}</p>
          <div class="pma-div"></div>
          <!-- 判据脚固定两行,每行钉高、不折行:第一行三条判据 + 去改,第二行平时范围拿哪段估(放不下省略,全文进悬停说明)+ 末尾那句。
               折行数随选中栋 / 档位变的话主卡就跟着变高(V4 §2.1 卡高恒定)。
               ≤600 换排法:第一行成两列网格、第二行允许折行并显全文 —— 高照样两档各自钉死,见 <style> S 档块 -->
          <div v-if="foot" class="pma-b2">
            <div class="pma-b2-r">
              <span v-for="c in foot.items" :key="c.key">{{ c.text }}</span>
              <button class="pma-lk" @click="gotoParams">去改</button>
            </div>
            <div class="pma-b2-r">
              <span v-tip="foot.baseNote" class="base">{{ foot.baseNote }}</span>
              <span class="tail">{{ foot.tail }}</span>
            </div>
          </div>
        </div>

        <div v-if="perKw" class="av2-card av2-s4 pma-pk">
          <div class="av2-card-h">
            <span class="t">{{ PV.card.perKw }}</span>
            <span class="hint">{{ perKw.hint }}</span>
          </div>
          <PvPerKwBars :data="perKw" :sel-id="selId" @pick="pickStation" />
          <p class="ana-read pma-pk-read">{{ perKw.read?.text }}</p>
          <p v-for="k in 2" :key="k" v-tip="perKw.refs[k - 1]?.text" class="ana-ref pma-pk-ref" :class="{ hold: !perKw.refs[k - 1] }">{{ perKw.refs[k - 1]?.text }}</p>
        </div>
      </div>

      <!-- ══ 段控:切档不换卡,容器高度按较高的一档钉死 ══ -->
      <div class="pma-seg">
        <Segmented v-model="section" :options="SECTIONS" :size="isS ? 'lg' : 'md'" />
        <span class="pma-seghint">{{ PV.segHint }}</span>
      </div>

      <!-- 三档的卡片内部由接手档内卡片的人改(2026-10-06 改稿 B / C);这里只管段控、档名、按年 / 按月显隐 -->
      <div class="pma-sec">
        <div class="av2-grid">
          <!-- ── 按装机比(值 abs)── -->
          <template v-if="section === 'abs'">
            <!-- 图下读数句位留空(这几张不出读数句,行位和别的卡一样留着),接着是参照 -->
            <div v-if="yb" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">{{ PV.card.trail }}</span>
                <span class="hint">{{ yb.hint }}</span>
              </div>
              <PvYieldBand :data="yb" />
              <p class="ana-read hold"></p>
              <p v-for="r in yb.refs" :key="r.text" class="ana-ref">{{ r.text }}</p>
            </div>
            <!-- 按年不出这张(用户 10-06「按推荐」):合格线画进新卡「各栋每千瓦日均发电」,比去年并进新卡「比 N−1 年」那列。
                 按月这张是整年(卡头写「2025年全年」),旁边新卡是选中月,两张不重复 -->
            <div v-if="anchor && gran === 'month'" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">{{ PV.card.anchor }}</span>
                <span class="hint">{{ anchor.hint }}</span>
                <span v-if="anchor.badge" class="pma-badge">{{ anchor.badge }}</span>
              </div>
              <PvAnchorBars :data="anchor" :sel-id="selId" @pick="pickStation" />
              <p class="ana-read hold"></p>
              <p v-for="r in anchor.refs" :key="r.text" class="ana-ref">{{ r.text }}</p>
            </div>
            <div v-if="ledgerSc" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">{{ PV.card.ledger }}</span>
                <span class="hint">{{ ledgerSc.hint }}</span>
              </div>
              <PvLedgerScatter :data="ledgerSc" @record="goMeter" />
            </div>
          </template>

          <!-- ── 核对明细(值 lab,2026-10-06 改稿):各组件自带卡壳。
               按月:常年水平 s6 + 抄表齐不齐 s6 同排,核对表 s12;
               按年:常年水平 s6 + 每月和常年水平的差 s6,抄表齐不齐独占 s12,核对表 s12(差那张只在按年出) ── -->
          <template v-else-if="section === 'lab'">
            <template v-if="labView">
              <PvAlphaBars class="av2-s6" :data="labView.alpha" :stability="labView.stability" :sel-id="selId" :cover="labView.cover" @pick="pickStation" />
              <PvResidualHeat v-if="gran === 'year'" class="av2-s6" :data="labView.heat" :sel-id="selId" :year="snap.year" />
              <PvQualityGrid
                :class="gran === 'year' ? 'av2-s12' : 'av2-s6'" :data="labView.cal"
                :min-stations="snap.quality.minStations" :too-few-stations="snap.quality.tooFewStations"
              />
              <PvLabTable v-if="labShowAll" class="av2-s12" :rows="labView.rows" :cover="labView.cover" :win-month="labView.winMonth" />
              <!-- 窄档核对表点开才出。按钮排在最后 —— 展开只往下长,已画出来的一格不动 -->
              <button v-if="!labShowAll" type="button" class="av2-s12 pma-more" @click="labMore = true">更多分析</button>
            </template>
            <FPEmpty v-else class="av2-s12" size="sm">这一档的量还没算出来。</FPEmpty>
          </template>

          <!-- ── 去向和收益(值 ledger,默认档) ── -->
          <template v-else>
            <!-- 读数句比不了时行位留着(hold),切月不顶动下面那张 -->
            <div v-if="cons" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">{{ PV.card.cons }}</span>
                <span class="hint">{{ cons.hint }}</span>
              </div>
              <PvConsumption :data="cons" />
              <p class="ana-read" :class="{ hold: !cons.read }">{{ cons.read?.text }}</p>
              <p v-for="r in cons.refs" :key="r.text" class="ana-ref">{{ r.text }}</p>
            </div>
            <div v-if="rev" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">{{ PV.card.rev }}<template v-if="rev.through">（截至 {{ rev.through }} 累计）</template></span>
                <span class="hint">{{ rev.hint }}</span>
                <span v-if="rev.through" class="pma-badge">不可与整{{ gran === 'month' ? '月' : '年' }}直接比</span>
              </div>
              <PvRevenueBars :data="rev" :sel-id="selId" />
              <p class="ana-read" :class="{ hold: !rev.read }">{{ rev.read?.text }}</p>
              <p v-for="r in rev.refs" :key="r.text" class="ana-ref">{{ r.text }}</p>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ── 单栋抽屉(§2.5)。B9–B11 固定按年,当段底色只画到数据截止日 ── -->
    <FPDrawer
      :open="drawerOpen"
      :title="selStation?.name ?? ''"
      :subtitle="drawerSub"
      :width="720"
      :fixedHeight="true"
      @close="closeDrawer"
    >
      <template #badge>
        <span class="pma-step">
          <button class="pma-ib" aria-label="上一栋" @click="stepStation(-1)"><component :is="iconFor('chevron-left')" :size="14" /></button>
          <button class="pma-ib" aria-label="下一栋" @click="stepStation(1)"><component :is="iconFor('chevron-right')" :size="14" /></button>
        </span>
      </template>

      <FPEmpty v-if="!drawer" size="sm">{{ PV.drawerThin }}</FPEmpty>
      <div v-else class="pma-drawer">
        <!-- 手机:四块改段控一次看一块(手机稿 §1);桌面 sheet=false,四块照旧竖排全见,这一行不出。
             切档只换渲染不重算:四块的数是 drawer 这一个 computed 一次算完的,换档不碰它。 -->
        <div v-if="sheet" class="anx-seg pma-tabs" role="group" aria-label="看这栋的哪一块">
          <button v-for="t in DRAWER_TABS" :key="t.v" :class="{ on: tab === t.v }" @click="tab = t.v">{{ t.l }}</button>
        </div>
        <template v-if="!sheet || tab === 'drift'">
          <PvDriftChart v-if="drawer.drift" :data="drawer.drift" />
          <div v-else class="av2-card"><FPEmpty size="sm">{{ PV.driftThin }}</FPEmpty></div>
        </template>
        <PvControlChart v-if="(!sheet || tab === 'ctrl') && drawer.control" :data="drawer.control" :seg-month="drawer.drift?.seg?.month ?? null" />
        <PvBetaChart v-if="!sheet || tab === 'beta'" :slots="drawer.beta" :year="snap?.year ?? year" />
        <PvDetailTable v-if="!sheet || tab === 'rows'" :rows="drawer.rows" :gran="snap?.gran ?? gran" :name="selStation?.name ?? ''" />
        <p v-if="sheet && tab !== 'rows'" class="pma-tabhint">另 3 块在上面那排里 —— 一次看一块</p>
      </div>

      <!-- 手机:脚部常驻两枚 44(手机稿 §1)。逐栋翻看是这个抽屉的用处,按钮不能跟着内容滑走。
           桌面不给这个插槽 —— FPDrawer 按 $slots.footer 出脚条,不给就一条都不出,桌面零差异。 -->
      <template v-if="sheet" #footer>
        <button class="pma-nav prev" @click="stepStation(-1)">上一栋</button>
        <button class="pma-nav next" @click="stepStation(1)">下一栋 · {{ nextName }}</button>
      </template>
    </FPDrawer>
  </AnaShell>
</template>

<style scoped>
/* 主卡 → 段控 → 档内卡片,间距 12(V4 §2.1)。
   骨架与真版式共用这一个盒子模型,块高各自照它顶替的那块钉死 —— 硬切回来零位移 */
.pma-body, .pma-skel { display: flex; flex-direction: column; gap: 12px; }
/* 芯片行照 PvChips.vue:117 的 .pvc 钉高,骨架条在行内居中 */
.pma-skel-chips { height: 34px; padding: 4px 0; box-sizing: border-box; display: flex; align-items: center; }
.pma-div { border-top: 1px solid var(--divider); margin: 8px 0 6px; }
/* 新卡读数句钉两行:超限句在 s4 里折两行,最高最低句一行 —— 不钉的话换期间第一排就变高,段控跟着跳 */
.pma-pk-read { min-height: 2lh; }
/* 新卡参照每条钉一行,放不下省略(全文在 v-tip 上):1366 下「—：12月才并网的楼没有11月；…」折两行,第一排顶高 20 */
.pma-pk-ref { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 1101–1280:外壳这档把 s8 铺满、s4 只占半行 —— 新卡单独一行时右半边空着,这里让它也铺满(≤1100 本来就满) */
@media (max-width: 1280px) { .pma-row1 > .av2-s4 { grid-column: span 12; } }

/* B2 判据脚:只读回显,mono 11px。固定两行、每行钉高 16 不折行 —— 主卡高度不随选中栋 / 档位变。
   ponytail: 第一行按字估宽约 800(年档含划掉那条),1366 下卡内 951 放得下;卡内窄于约 820 时行尾「去改」会被裁
   —— 这个缺口 2026-09-20 由本文件最下面那个 S 档块补上(≤600 改两列网格,五条全文都在),桌面这一档原样不动 */
.pma-b2 {
  display: flex; flex-direction: column; gap: 2px;
  font-family: var(--font-mono); font-size: 11px; line-height: 16px; color: var(--text-muted);
}
.pma-b2-r { display: flex; align-items: baseline; gap: 14px; height: 16px; overflow: hidden; white-space: nowrap; }
.pma-b2-r > * { flex: 0 0 auto; }
.pma-b2-r .base { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 没有可画的栋时占住大图那块的高(图头 24 + 画布 H + 上边距 12),主卡不塌。
   H 跟着 PvDayChart 的档位走:桌面 236 → 260,窄档 200 → 224。
   ⚠ 写死 260 的时候窄档真版式只有 224,差 36px,而 pvMeterAnaScreen.spec 那条
   「占位块与大图同高」只读 CSS 文本 —— 写死多少它都绿,掩着。
   这里用视口判据而不是容器判据:大图住在 .av2-s12(整幅内容宽),两者在这一处等价
   (601–960 平板档容器仍 ≥420,走桌面 236,与 max-width:600 的分界一致)。 */
.pma-nochart { margin-top: 12px; box-sizing: border-box; display: flex; flex-direction: column; }   /* 高度由 mainBlockH 内联下发,与骨架同源;FPEmpty 在里面撑满 */

.pma-seg { display: flex; align-items: center; gap: 12px; min-height: 32px; }
.pma-seghint { font-size: 11px; line-height: 1.5; color: var(--text-muted); min-width: 0; }

/* 切档不换卡:容器高度按「绝对水平 / 账面量」较高者钉死(V4 §2.3 = 1200)。
   高级分析那一档更高,**不把 min-height 抬到它** —— 那是用户自己点出来的变高。 */
.pma-sec { min-height: 1200px; }

.pma-badge {
  margin-left: auto; flex: 0 0 auto; font-size: 11px; line-height: 18px; height: 18px; padding: 0 8px;
  border-radius: 999px; background: var(--surface-sunken); color: var(--text-muted); white-space: nowrap;
}

.pma-drawer { display: flex; flex-direction: column; gap: 8px; }
.pma-step { margin-left: auto; display: inline-flex; gap: 6px; }
.pma-ib {
  width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--border-subtle);
  background: var(--surface-white); color: var(--text-secondary); display: grid; place-items: center; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.pma-ib:active { background: var(--ink-100); transition-duration: 0ms; }

/* ── 抽屉的手机件:只在 sheet(≤600)那一档渲染,桌面这三个选择器一个元素都选不到 ──
   段控走全局 .anx-seg,高不自己写 —— ana.css 的 S 档块已经把它的按钮钉到 38(3+38+3 = 44 触点)。
   .anx-seg 是 inline-flex,放进 .pma-drawer 这个 flex 列会被 stretch 拉成整行宽(轨道底色铺一横条),
   align-self 收回内容宽,与 ds/Segmented 里那条 width:fit-content 同一个坑。 */
.pma-tabs { align-self: flex-start; }
/* 「另 3 块」压到脚条上方:一块看完还剩空白时,这句在空白的底,不贴着图注 */
.pma-tabhint { margin: auto 0 0; font-size: var(--fs-micro); color: var(--text-muted); }
.pma-nav {
  flex: 1; min-width: 0; height: 44px; padding: 0 12px; border-radius: var(--radius-full);
  border: 1px solid transparent; background: var(--surface-sunken); color: var(--text-secondary);
  font-family: var(--font-sans); font-size: var(--fs-body); cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pma-nav.prev { flex: 0 0 100px; }
.pma-nav.next { border-color: var(--border-subtle); background: var(--surface-white); color: var(--text-primary); }
.pma-nav:active { background: var(--ink-100); }

.pma-lk {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--text-link); font-size: 11px; white-space: nowrap;
}
.av2-card-h .pma-lk { margin-left: auto; }

@media (max-width: 1100px) {
  .pma-sec { min-height: 0; }
}

/* ══ S 档(≤600):手机排布。桌面进不来这一块,1440 与现状零差异。 ══════════════════
   **判据脚**(:593 那条 ponytail 注释写的缺口,这一轮补上):五条判据 + 「去改」挤在一行
   nowrap 里约 620px,390 上卡内只有 320(390 − .anx-body 24×2 − .av2-card 10×2 − 边框 2)
   —— 行尾「去改」直接被裁。改两列网格,五条各占一格、第六格放「去改」:
     列宽 (320 − 列距 10) / 2 = 155。11px mono 下六格的单行宽,浏览器实测(2026-09-20,320 卡内宽):
     范围 225 · 连续 144(年档「个月」156) · 抄表覆盖 120 · 台账差 70 · 年等效 103 · 去改 22。
     只有第一格超 155 → 占两行,行高 32 + 16 + 16 + 行距 2×2 = **68**(实测 r1 自然高 68.00)。
     年档那格 156 压线,超不超都落在第一行里,跟 225 那格同行 —— 68 两档都成立。
   ⚠ 两处非写不可,否则这套排法整个失效(实测踩过):
     ① `minmax(0, 1fr)` —— 裸 `1fr` 的下限是 min-content,而 .pma-b2-r 基档是 nowrap,
        min-content = 整句宽,列被撑成 225 / 156、总宽 391 > 320,又被 overflow 裁回去;
     ② `white-space: normal` —— 不解开 nowrap 谁都不折,五条照旧各自超出。
   第二行的范围窗口句同样改允许折行:含「放宽 N 档」时 320 宽下两行 = 32(不含时只有 16)。
   它原来全文只挂在 :title 上,而 title 在触屏上读不到 —— 折行把全文显出来,就是那个可见等价物。
   判据脚总高 68 + 2 + 32 = **102**(实测 102.00;桌面 16 + 2 + 16 = 34 不动),骨架那两个字面高同源。
   ⚠ 两块仍钉死高 + overflow:hidden:判据文案由计费参数下发,改得比这更长会被裁;第二行没「放宽」
     那句时也照样占 32(空 16)。代价认了 —— 不钉的话换栋 / 换粒度就顶动下面的段控与整片档内卡片。
   align-content:start 是必须的:容器定高 + 隐式 auto 行,默认 stretch 会把三行摊成 21.3 一行。 */
@media (max-width: 600px) {
  .pma-b2-r:first-child {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start;
    column-gap: 10px; row-gap: 2px; height: 68px; white-space: normal;
  }
  /* 「去改」是 <button>,UA 给的 line-height:normal 在 11px 下是 16.83 —— 不钉的话第三行 16.83,
     整块 68.83,骨架那个字面 68 就差 0.83。桌面那档不管它(那里整行 overflow:hidden 高 16) */
  .pma-b2-r:first-child .pma-lk { line-height: 16px; }
  .pma-b2-r:last-child { display: block; white-space: normal; height: 32px; }
  /* display:block 之后 .base 与 .tail 是相邻 inline,flex 的 gap 不再生效 */
  .pma-b2-r:last-child .tail { margin-left: 14px; }

  /* 主卡「历史不够」那句 ≤ 28 字,390 上卡内 290 放不下一行:两行都留着(没有这句、或一行放得下时也占两行),首进骨架与换栋不跳 */
  .pma-short { min-height: 2lh; }

  /* 段控:说明另起一行 —— 一行里段控 214 + 说明 27 字,390 上把说明挤成四五行 */
  .pma-seg { flex-direction: column; align-items: flex-start; gap: 6px; }

  /* 高级分析折叠的那两块的入口。只在窄档渲染,整幅宽、44 触点 */
  .pma-more {
    height: 44px; border: 1px solid var(--border-subtle); border-radius: 8px;
    background: var(--surface-white); color: var(--text-link);
    font-family: var(--font-sans); font-size: var(--fs-label); cursor: pointer;
  }
  .pma-more:active { background: var(--ink-100); }
}

/* 抽屉那两处要压过桌面值的:单开一块,与上面那块各管各的(同屏两人并行改,分开写少一处撞车)。
   .pma-drawer 撑满体区 —— 一块看完还剩空白时,「另 3 块」那句的 margin-top:auto 才有东西可推。
   标题栏那两枚 26 → 44 触点(手机稿 §2「标题栏」行)。 */
@media (max-width: 600px) {
  .pma-drawer { flex: 1; }
  .pma-ib { width: 44px; height: 44px; border-radius: 12px; }
}
</style>
