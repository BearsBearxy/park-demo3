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
import Segmented from '@/components/ds/Segmented.vue'
import { iconFor } from '@/components/ds/icon'
import PvChips from './PvChips.vue'
import PvDayChart from './PvDayChart.vue'
import PvYieldBand from './PvYieldBand.vue'
import PvAnchorBars from './PvAnchorBars.vue'
import PvLedgerScatter from './PvLedgerScatter.vue'
import PvConsumption from './PvConsumption.vue'
import PvRevenueBars from './PvRevenueBars.vue'
import PvAlphaBars from './PvAlphaBars.vue'
import PvResidualHeat from './PvResidualHeat.vue'
import PvQualityGrid from './PvQualityGrid.vue'
import PvAcfBars from './PvAcfBars.vue'
import PvNullHist from './PvNullHist.vue'
import PvLabTable from './PvLabTable.vue'
import PvDriftChart from './PvDriftChart.vue'
import PvControlChart from './PvControlChart.vue'
import PvBetaChart from './PvBetaChart.vue'
import PvDetailTable from './PvDetailTable.vue'
import { usePeriod } from '@/analysis/usePeriod'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { fnum } from '@/components/ana/anaFmt'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import {
  buildSnapshot, buildDetail, buildLab, DEFAULT_CRITERIA,
  type AnaSnapshot, type BoardRow, type Criteria, type SnapshotInput,
} from './pvMeterAna.logic'
import {
  chipGroups, dayFact, isUnreadable, kpiTiles, critFoot, yieldBand, anchorBars, ledgerScatter, consumption, revenueBars,
  alphaBars, polishStability, residualGrid, qualityCalendar, acfBars, nullHist, labTableRows,
  driftChart, controlChart, betaSlots, detailRows, phaseName,
} from './pvAnaV4.logic'

// 不给外壳传 compare(不出对比开关):v4 屏上没有任何同比显示,开关可点却什么都不变是假控件。
// 上一年的抄表只有 A2「比去年」那一列要。
const GRID_PRICE = 0.4

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
const loading = ref(true)
const failed = ref(false)
// 换年在途(C5-02):旧内容留在原地退让,不卸载。过 200ms 门槛才亮、退场立刻 —— 本地后端几十毫秒
// 就回来的那种请求全程静默,闪一下比不显示更晃眼
const staleShown = useDeferredFlag(loading)
// 上一年那趟单独记(C5-12):它只补 A2 最右一列,主数据仍是当前的 —— 不给任何内容挂 .fp-stale,
// 只点亮工具条上那条 2px 线
const prevLoading = ref(false)
const busy = useDeferredFlag(computed(() => loading.value || prevLoading.value))
/** 已经画在屏上的那一年。year 立刻变(下拉是控件回显),这个等 readings 一起换 ——
 *  不分开的话换年会先拿新年刻度配旧年读数画一遍空的再填满,等于把入场重播了一次(C5-02 ①) */
const loadedYear = ref(year.value)
let seq = 0

// 默认停在**账面量** —— 板数录进来之前只有这一档是全真数。第三档「高级分析」要点才进得去。
const section = ref<'abs' | 'ledger' | 'lab'>('ledger')

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

/** 上一年的抄表只有「绝对水平」档 A2 最右那列「比去年」要。别处不打这个接口。 */
const needPrev = () => section.value === 'abs'

// 取的永远是**整年**:看板只画选中那段,但范围要拿段外的数据来估(§03.7)
async function load(y: number) {
  const my = ++seq
  loading.value = true
  failed.value = false
  try {
    const [sts, rds, cr] = await Promise.all([
      stations.value.length ? Promise.resolve(stations.value) : pvMeterApi.stations(),
      pvMeterApi.readingsYear(y),
      loadCrit(y),
    ])
    if (my !== seq) return
    stations.value = sts
    readings.value = rds
    crit.value = cr
    loadedYear.value = y
    prevReadings.value = undefined
    if (needPrev()) await loadPrev(y, my)
  } catch {
    if (my === seq) failed.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}
async function loadPrev(y: number, my: number) {
  prevLoading.value = true
  try {
    const prev = await pvMeterApi.readingsYear(y - 1)
    if (my === seq) prevReadings.value = prev
  } catch {
    if (my === seq) prevReadings.value = undefined
  } finally {
    // ponytail: 不按 seq 守卫 —— 两趟叠在一起时早灭一条 2px 线没人看得出,卡在真值上却是一条永不熄的线
    prevLoading.value = false
  }
}
onMounted(() => { void load(year.value) })
// 只有换**年**才重新取数;切月 / 切粒度都在同一份整年数据上重算,不打接口
watch(year, (y) => { void load(y) })
watch(section, () => {
  if (needPrev() && prevReadings.value === undefined && !loading.value) void loadPrev(year.value, seq)
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
    gridPrice: GRID_PRICE,
    crit: crit.value,
  }
})
const snap = computed<AnaSnapshot | null>(() => (snapInput.value ? buildSnapshot(snapInput.value) : null))

// ── B0 KPI 行(§3.1)──────────────────────────────────────────────────
// ponytail: 两条迷你线(§1 #11)不画。实测 13 栋 × 4321 条、逐月 12 次 buildSnapshot 合计 ≈ 400ms,
// 远超 80ms 线;要画得先让 logic 给出不重跑整份快照的逐月计数。
const kpis = computed(() => (snap.value ? kpiTiles(snap.value) : []))

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
/** 默认停在芯片第一枚 —— 有连续出范围段的栋排在最前,首屏不用点就有东西看 */
watch([chipOrder, () => snap.value?.id], () => {
  if (selId.value != null && bornRows.value.some(r => r.id === selId.value)) return
  selId.value = chipOrder.value[0] ?? null
  // #st= 深链 / 换期后,抽屉开着的那栋不在本段已投产里:抽屉标题会换成另一栋、地址栏还是原 id —— 关掉
  if (drawerOpen.value && snap.value) closeDrawer()
}, { immediate: true })
const selRow = computed(() => bornRows.value.find(r => r.id === selId.value) ?? null)
const selStation = computed(() => snap.value?.stations.find(s => s.id === selId.value) ?? null)

const chips = computed(() => (snap.value ? chipGroups(snap.value, selId.value) : { shown: [], folded: [], unit: '天' }))
const fact = computed(() => (snap.value && selRow.value ? dayFact(selRow.value, snap.value) : ''))

/** 芯片 / A2 行 / α 条 → 换选中。**不开抽屉**(抽屉会盖住刚换的图,§6.6)。未投产挡掉。 */
function pickStation(id: number) {
  if (bornRows.value.some(r => r.id === id)) selId.value = id
}

// ── B2 判据脚(§3.3)──────────────────────────────────────────────────
const foot = computed(() => (snap.value ? critFoot(snap.value, selId.value) : null))

// 「去改」落计费参数的常数区。adopt=YYYY-12 只在会话还没有出账月时认领(常数存 12 月的约定,PvAnalysis §01);
// 已选期的会话不动 —— 它不是选月,不能用 p= / ym=(那两个是显式深链,会覆盖组级期;2026-09-03 P0a 复查 P0A-2)。
function gotoParams() {
  tabs.openDeep('params')
  void router.push({ path: '/params', query: { adopt: `${year.value}-12`, section: 'constant' } })
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
  { value: 'abs', label: '绝对水平' },
  { value: 'ledger', label: '账面量' },
  ...(labReady.value ? [{ value: 'lab', label: '高级分析' }] : []),
])
// 整档隐藏时把档位挪到还在的那一档 —— 停在一个不存在的档等于整片空白
watch(SECTIONS, (opts) => {
  if (!opts.some(o => o.value === section.value)) section.value = 'ledger'
}, { immediate: true })

// ── 绝对水平 / 账面量 ────────────────────────────────────────────────
const yb = computed(() => (snap.value && snapInput.value ? yieldBand(snap.value, snapInput.value.rows, selId.value) : null))
const anchor = computed(() => (snap.value && snapInput.value
  ? anchorBars(snap.value, snapInput.value.rows, snapInput.value.prevRows) : null))
const ledgerSc = computed(() => (snap.value ? ledgerScatter(snap.value) : null))
const cons = computed(() => (snap.value ? consumption(snap.value) : null))
const rev = computed(() => (snap.value && snapInput.value ? revenueBars(snap.value, snapInput.value.rows, GRID_PRICE) : null))

// ── 高级分析(§2.4)──────────────────────────────────────────────────
/**
 * **只在这一档被选中时才算** —— 它比首屏那次重得多(13 次 buildDetail + 第二次抛光 + 两轮重采样),
 * 九成的人根本不点开这一档。
 * ponytail: selId 进了 computed,换选中(L2/L4 跟着走)会整份重算。13 栋量级下百毫秒级,可接受。
 */
const lab = computed(() => {
  if (section.value !== 'lab' || !snap.value || !snapInput.value) return null
  return buildLab(snap.value, snapInput.value, selId.value ?? undefined)
})
const labView = computed(() => {
  const l = lab.value, s = snap.value
  if (!l || !s) return null
  return {
    alpha: alphaBars(l, s),
    stability: polishStability(l, s),
    heat: residualGrid(l, s),
    cal: qualityCalendar(l, s),
    acf: acfBars(l, selId.value),
    nul: nullHist(l),
    period: `${l.window.label}${l.window.fellBack ? '（当段样本不足，退回）' : ''}`,
    rows: labTableRows(l, s),
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
    `年发电 ${fnum(st.genYear / 10000, 1)} 万度`,
    ...(st.capKwp != null ? [`装机 ${fnum(st.capKwp, 0)} kWp`] : []),
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
  <AnaShell period-mode="full" :busy="busy">
    <!-- 瓦片门只看 snap:换年时旧瓦留在原位(整排先消失再出现是 C5-02 要修的那个形状);
         首进(!snap)由 .anx-kpis 的 min-height 94 兜空行 -->
    <template #kpis>
      <template v-if="snap">
        <AnaKpiTile v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value" :note="k.note" :note-tone="k.noteTone" />
      </template>
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。块高全照 V4 §2.1 与代码里钉死的数 ——
         卡头 20 + 芯片行 34(PvChips.vue:117)+ 大图区 272(上距 12 + 图头 24 + 画布 236)
         + .pma-div + 判据脚两行 16 + 2 + 16;段控 32;.pma-sec 1200(档内首卡 B7 361)。
         KPI 行由 .anx-kpis 的 min-height 94 兜位,首进期瓦片不画。数据到了原地硬切,不做淡入。 -->
    <div v-if="!snap && loading" class="pma-skel">
      <div class="av2-card pma-main">
        <div class="av2-card-h"><div class="fp-shim" style="height: 20px; width: 180px"></div></div>
        <div class="pma-skel-chips"><div class="fp-shim" style="height: 26px; width: 260px"></div></div>
        <div class="fp-shim" style="height: 260px; margin-top: 12px"></div>
        <div class="pma-div"></div>
        <div class="fp-shim" style="height: 34px; width: 70%"></div>
      </div>
      <div class="pma-seg"><div class="fp-shim" style="height: 32px; width: 320px"></div></div>
      <div class="pma-sec"><div class="fp-shim" style="height: 361px"></div></div>
    </div>
    <AnaEmpty v-else-if="failed" label="分栋抄表数据没加载成功" hint="刷新重试；仍不行就到分栋抄表屏看数据在不在" />
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
      <!-- ══ B1 主卡:芯片 + 单栋大图 + B2 判据脚 ══ -->
      <div class="av2-card pma-main">
        <div class="av2-card-h">
          <span class="t">哪栋落在自己的范围外</span>
          <span class="hint">芯片 = 一栋，徽标 = 出范围{{ gran === 'month' ? '天' : '月' }}数 · 点芯片换图 · 线 = 这栋当{{ gran === 'month' ? '日' : '月' }}发电 ÷ 全园同{{ gran === 'month' ? '日' : '月' }}中位，带 = 这栋自己的范围</span>
          <button v-if="selRow" class="pma-lk" @click="openDrawer">看 {{ selRow.name }} 的整年 →</button>
        </div>

        <PvChips :groups="chips" @pick="pickStation" />
        <PvDayChart
          v-if="selRow"
          :row="selRow" :ticks="snap.ticks" :tick-labels="snap.tickLabels" :gran="snap.gran"
          :elapsed-n="snap.elapsedN" :fact="fact" :unreadable="isUnreadable(selRow, snap)"
        />
        <div v-else class="pma-note pma-nochart">这一段没有已投产的楼栋，画不出逐刻度比值。</div>

        <div class="pma-div"></div>
        <!-- 判据脚固定两行,每行钉高、不折行:第一行判据原文 + 去改,第二行范围窗口(放不下省略,全文进 title)+ 末尾那句。
             折行数随选中栋 / 档位变的话主卡就跟着变高(V4 §2.1 卡高恒定) -->
        <div v-if="foot" class="pma-b2">
          <div class="pma-b2-r">
            <span v-for="c in foot.items" :key="c.key">{{ c.text }}</span>
            <button class="pma-lk" @click="gotoParams">去改</button>
          </div>
          <div class="pma-b2-r">
            <span class="base" :title="foot.baseNote ?? undefined">{{ foot.baseNote }}</span>
            <span class="tail">{{ foot.tail }}</span>
          </div>
        </div>
      </div>

      <!-- ══ 段控:切档不换卡,容器高度按较高的一档钉死 ══ -->
      <div class="pma-seg">
        <Segmented v-model="section" :options="SECTIONS" />
        <span v-if="labReady" class="pma-seghint">「高级分析」= 算法自检与口径核对，给要复算这屏数字的人看。</span>
      </div>

      <div class="pma-sec">
        <div class="av2-grid">
          <!-- ── 绝对水平 ── -->
          <template v-if="section === 'abs'">
            <div v-if="yb" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">等效小时轨迹</span>
                <span class="hint">{{ gran === 'month' ? '每天' : '每月' }}每千瓦装机发了多少度，这栋和全园比</span>
              </div>
              <PvYieldBand :data="yb" />
            </div>
            <div v-if="anchor" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">年等效小时</span>
                <span class="hint">每千瓦装机一年发了多少度，比标杆多多少</span>
                <span class="pma-badge">整年口径 · 与 {{ snap.year - 1 }} 比</span>
              </div>
              <PvAnchorBars :data="anchor" :sel-id="selId" @pick="pickStation" />
            </div>
            <div v-if="ledgerSc" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">台账装机 vs 板数 × 标称</span>
                <span class="hint">台账上写的装机，和现场板子算出来的对不对得上</span>
              </div>
              <PvLedgerScatter :data="ledgerSc" @record="goMeter" />
            </div>
          </template>

          <!-- ── 高级分析:六个组件各自带卡壳;L2 / L4 叠在一个 s4 栏里与 L6 等高(§2.4) ── -->
          <template v-else-if="section === 'lab'">
            <template v-if="labView">
              <PvAlphaBars class="av2-s6" :data="labView.alpha" :stability="labView.stability" :sel-id="selId" @pick="pickStation" />
              <PvResidualHeat class="av2-s6" :data="labView.heat" :sel-id="selId" :year="snap.year" />
              <PvQualityGrid
                class="av2-s8" :data="labView.cal"
                :min-stations="snap.quality.minStations" :too-few-stations="snap.quality.tooFewStations"
              />
              <div class="av2-s4 pma-stack">
                <PvAcfBars v-if="labView.acf" :data="labView.acf" />
                <div v-else class="av2-card"><div class="pma-note">没有够长的逐日偏差序列，画不出这张图。</div></div>
                <PvNullHist v-if="labView.nul" :data="labView.nul" :period="labView.period" />
                <div v-else class="av2-card"><div class="pma-note">选中的栋没有可用的观测段，画不出这张图。</div></div>
              </div>
              <PvLabTable class="av2-s12" :rows="labView.rows" :year="snap.year" />
            </template>
            <div v-else class="av2-s12 pma-note">这一档的量还没算出来。</div>
          </template>

          <!-- ── 账面量 ── -->
          <template v-else>
            <div v-if="cons" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">消纳结构与损耗率</span>
                <span class="hint">{{ gran === 'month' ? '每天' : '每月' }}发的电，多少自己用了、多少卖上网、多少路上损掉了</span>
              </div>
              <PvConsumption :data="cons" />
            </div>
            <div v-if="rev" class="av2-card av2-s12">
              <div class="av2-card-h">
                <span class="t">各栋消纳收益与上网收益<template v-if="rev.through">（截至 {{ rev.through }} 累计）</template></span>
                <span class="hint">{{ gran === 'month' ? '这个月' : '这一年' }}每栋一共挣了多少钱，自己用的和卖上网的各占多少</span>
                <span v-if="rev.through" class="pma-badge">不可与整{{ gran === 'month' ? '月' : '年' }}直接比</span>
              </div>
              <PvRevenueBars :data="rev" :sel-id="selId" />
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

      <div v-if="!drawer" class="pma-note">这栋可用的逐日偏离不足 8 天，画不出逐日曲线。</div>
      <div v-else class="pma-drawer">
        <PvDriftChart v-if="drawer.drift" :data="drawer.drift" />
        <div v-else class="av2-card"><div class="pma-note">这栋可用的逐日偏离不够画出常态线，这一块不画。</div></div>
        <PvControlChart v-if="drawer.control" :data="drawer.control" :seg-month="drawer.drift?.seg?.month ?? null" />
        <PvBetaChart :slots="drawer.beta" :year="snap?.year ?? year" />
        <PvDetailTable :rows="drawer.rows" :gran="snap?.gran ?? gran" />
      </div>
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

/* B2 判据脚:只读回显,mono 11px。固定两行、每行钉高 16 不折行 —— 主卡高度不随选中栋 / 档位变。
   ponytail: 第一行按字估宽约 800(年档含划掉那条),1366 下卡内 951 放得下;卡内窄于约 820 时行尾「去改」会被裁,要顾窄屏就把第一行拆成两行 */
.pma-b2 {
  display: flex; flex-direction: column; gap: 2px;
  font-family: var(--font-mono); font-size: 11px; line-height: 16px; color: var(--text-muted);
}
.pma-b2-r { display: flex; align-items: baseline; gap: 14px; height: 16px; overflow: hidden; white-space: nowrap; }
.pma-b2-r > * { flex: 0 0 auto; }
.pma-b2-r .base { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 没有可画的栋时占住大图那块的高(图头 24 + 画布 236 + 上边距 12),主卡不塌 */
.pma-nochart { height: 260px; margin-top: 12px; box-sizing: border-box; }

.pma-seg { display: flex; align-items: center; gap: 12px; min-height: 32px; }
.pma-seghint { font-size: 11px; line-height: 1.5; color: var(--text-muted); min-width: 0; }

/* 切档不换卡:容器高度按「绝对水平 / 账面量」较高者钉死(V4 §2.3 = 1200)。
   高级分析那一档更高,**不把 min-height 抬到它** —— 那是用户自己点出来的变高。 */
.pma-sec { min-height: 1200px; }

/* L2 / L4 两张卡上下叠在一个 s4 栏里 */
.pma-stack { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.pma-badge {
  margin-left: auto; flex: 0 0 auto; font-size: 11px; line-height: 18px; height: 18px; padding: 0 8px;
  border-radius: 999px; background: var(--surface-sunken); color: var(--text-muted); white-space: nowrap;
}

.pma-note {
  font-size: 11px; color: var(--text-secondary);
  background: var(--surface-sunken); border-radius: 4px;
  padding: 8px 10px; line-height: 1.6;
}

.pma-drawer { display: flex; flex-direction: column; gap: 8px; }
.pma-step { margin-left: auto; display: inline-flex; gap: 6px; }
.pma-ib {
  width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--border-subtle);
  background: var(--surface-white); color: var(--text-secondary); display: grid; place-items: center; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.pma-ib:active { background: var(--ink-100); transition-duration: 0ms; }

.pma-lk {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--text-link); font-size: 11px; white-space: nowrap;
}
.av2-card-h .pma-lk { margin-left: auto; }

@media (max-width: 1100px) {
  .pma-sec { min-height: 0; }
}
</style>
