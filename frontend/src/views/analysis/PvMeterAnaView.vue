<script setup lang="ts">
// 光伏分栋分析(pv-meter-analysis)— PV-ANALYSIS-SPEC §06 全段(v3)。
//
// **一个仪器,两档缩放。** 期间切「按月 / 按年」,屏跟着换刻度:
//   按月段 → x = 当月 1…31 日,一个点 = 当日。数据是逐日进来的,几天内就要看得见。
//   按年段 → x = 12 个月,一个点 = 当月。回看用。
// **模型永远吃全年,只有「画哪一段」跟着期间变** —— 模型要历史,屏要新鲜。
//
// **四层各换掉一个可测量的物理属性**(§06.0),不靠标题文字:
//   L0 B0 指标卡  --surface-sunken 实底 + 3px 左竖条,全屏唯一的 26px 数字
//   L1 主卡      白底 1px 边 + 卡头;左队列(纯文字数字)+ 右单栋大图;判据脚在同一张卡里
//   L2 两档段控   白底 + 卡头 + **坐标轴**;强调色 #9D5D17 到这里为止不再出现
//   L3 单栋抽屉   720px 覆盖层,全屏唯一的表格
// 四条排他规则:26px 只在 B0 / #9D5D17 只在 L0-L1 / 坐标轴只在 L2 与抽屉 / height=440 零次。
//
// **v2.1 的 13 行 20px 缩略条已删**(§00 v3-1):共用纵轴 + 钳位正好吃掉最该被看见的那一行,
// 20px × 560px 塞 31 个点也读不出日刻度,而用户的作业就是「哪几天」。
// 判据线替用户决定了「是哪栋」—— 那是文字和数字的活;图的职责是看清那一栋。
//
// 铁律:一份数据、一次计算、一个 snapshot id,页脚显示那个 id。只有换**年**才重新取数。
//
// ⚠ 文案(§05):**屏只说明可视化在做什么,不输出解释性结论。**
//   能写:图种 / 坐标轴含义与单位 / 范围是拿哪一段估的 / 数据来源与条数 / 判据线画在哪。
//   不能写:诊断结论、成因归因、建议动作、严重度判词、反事实金额,以及 p / q 这类统计量。
//   「正常范围」是 §05 给 ±2σ 指定的替换名,不是严重度判词 —— 不要再改回「置信带」。
//
// ⚠ ECharts 是裁剪打包的(echartsBundle.ts):heatmap / visualMap / custom / graph 全没注册,
//   用了得到空白图 + 一句控制台警告,而 **jsdom 测不出来**。本屏只用 bar/line/scatter。
//   option 是纯 JSON,拿不到 CSS 变量 → 颜色一律走 pvAnaColors.ts 的字面值。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import PvDots from './PvDots.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Segmented from '@/components/ds/Segmented.vue'
import PvQueue from './PvQueue.vue'
import PvDayChart from './PvDayChart.vue'
import PvSlope from './PvSlope.vue'
import { PV_COLORS as C } from './pvAnaColors'
import { usePeriod } from '@/analysis/usePeriod'
import { useCompare, type CompareMode } from '@/analysis/useCompare'
import { fnum } from '@/components/ana/anaFmt'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import PvQualityGrid from './PvQualityGrid.vue'
import PvLabTable from './PvLabTable.vue'
import {
  buildSnapshot, buildDetail, buildLab, DEFAULT_CRITERIA,
  type AnaSnapshot, type BoardRow, type Criteria, type SnapshotInput,
} from './pvMeterAna.logic'

// 模块级常量:传给 AnaShell 的与屏内读的必须是同一份(§06)。本屏不支持环比。
const CMP: CompareMode[] = ['yoy']
const GRID_PRICE = 0.4

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const cmp = useCompare(CMP)
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
let seq = 0

const CRIT_KEYS = [
  'pv_yield_anchor_h', 'pv_crit_cover_month', 'pv_crit_ledger',
  'pv_crit_yield_ratio', 'pv_band_sigma', 'pv_band_run',
] as const

/** 判据线来自计费参数 —— 屏上写的必须是**当前生效的那个数**,取不到就回落默认,线屏照常出 */
async function loadCrit(y: number) {
  try {
    const rows = await paramsApi.list(`${y}-12`, 'all', { key: CRIT_KEYS.join(',') })
    const at = new Map(rows.filter(r => r.scope === '').map(r => [r.key, r.value]))
    const n = (k: string, d: number) => {
      const v = at.get(k)
      return typeof v === 'number' && isFinite(v) ? v : d
    }
    crit.value = {
      anchorHours: n('pv_yield_anchor_h', DEFAULT_CRITERIA.anchorHours),
      coverMonth: n('pv_crit_cover_month', DEFAULT_CRITERIA.coverMonth),
      ledger: n('pv_crit_ledger', DEFAULT_CRITERIA.ledger),
      yieldRatio: n('pv_crit_yield_ratio', DEFAULT_CRITERIA.yieldRatio),
      bandSigma: n('pv_band_sigma', DEFAULT_CRITERIA.bandSigma),
      bandRun: n('pv_band_run', DEFAULT_CRITERIA.bandRun),
      minOnlineDays: DEFAULT_CRITERIA.minOnlineDays,
    }
  } catch { /* 用默认值,屏照常出 */ }
}

// 取的永远是**整年**:看板只画选中那段,但正常范围要拿段外的数据来估(§03.7)
async function load(y: number) {
  const my = ++seq
  loading.value = true
  failed.value = false
  try {
    const [sts, rds] = await Promise.all([
      stations.value.length ? Promise.resolve(stations.value) : pvMeterApi.stations(),
      pvMeterApi.readingsYear(y),
    ])
    if (my !== seq) return
    stations.value = sts
    readings.value = rds
    prevReadings.value = undefined
    if (cmp.mode.value === 'yoy') await loadPrev(y, my)
  } catch {
    if (my === seq) failed.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}
async function loadPrev(y: number, my: number) {
  try {
    const prev = await pvMeterApi.readingsYear(y - 1)
    if (my === seq) prevReadings.value = prev
  } catch {
    if (my === seq) prevReadings.value = undefined
  }
}
onMounted(() => { void loadCrit(year.value); void load(year.value) })
// 只有换**年**才重新取数;切月 / 切粒度都在同一份整年数据上重算,不打接口
watch(year, (y) => { void loadCrit(y); void load(y) })
watch(cmp.mode, (m) => { if (m === 'yoy' && prevReadings.value === undefined) void loadPrev(year.value, seq) })

// ── 唯一的一次计算 ────────────────────────────────────────────────────
const snapInput = computed<SnapshotInput | null>(() => {
  if (!readings.value.length) return null
  return {
    year: year.value,
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

const unit = computed(() => (gran.value === 'month' ? '天' : '个月'))
const segLabel = computed(() => (gran.value === 'year' ? `${year.value} 年` : `${year.value} 年 ${month.value} 月`))
const wan = (v: number) => fnum(v / 10000, 1)
const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`

// ── B0 巡检指标卡(§06.2)────────────────────────────────────────────
// 五格并排,**平行扫读,不串成句子**。主数统计**段所在的栋数**,不数点。
const board = computed<BoardRow[]>(() => snap.value?.board ?? [])
const bornRows = computed(() => board.value.filter(b => b.bornBySeg))

/** 「读不出」的三种,与 PvQueue 内的同一口径:月频 / 一个刻度都没抄 / 范围估不出来 */
function unreadable(r: BoardRow): boolean {
  return r.cadence === 'monthly' || r.seenN === 0 || r.center == null
}
const hitRows = computed(() => bornRows.value.filter(r => !unreadable(r) && r.runs.length > 0))
const thinRows = computed(() => bornRows.value.filter(r => unreadable(r)))
const unbornNames = computed(() => board.value.filter(b => !b.bornBySeg).map(b => b.name))

/** 覆盖率的分母是**已过去**,不是整段(§03.8)——写成整段的话月中打开 13 栋全掉进「读不出」 */
const cover = computed(() => {
  let seen = 0, elapsed = 0
  for (const r of bornRows.value) { seen += r.seenN; elapsed += r.elapsedN }
  return { seen, elapsed, pct: elapsed > 0 ? seen / elapsed : null }
})
const panelDone = computed(() => {
  const ms = (snap.value?.stations ?? []).filter(s => s.metered)
  return { k: ms.filter(s => s.theoKwp != null).length, n: ms.length }
})
const noMeterN = computed(() => (snap.value?.quality.noMeter.length ?? 0))

// ── B1 队列 + 单栋大图(§06.3)───────────────────────────────────────
// 排序键就印在队列行右边那两列,顺序可复算、可反对。抽屉的「上一栋/下一栋」走同一把尺子
//（跨组走,不在组边界上停 —— 三个组用的是同一个排序键)。
const cmpRow = (a: BoardRow, b: BoardRow) =>
  b.outN - a.outN || Math.abs(b.maxDev) - Math.abs(a.maxDev) || a.id - b.id
const queueOrder = computed(() => [...bornRows.value].sort(cmpRow))

const selId = ref<number | null>(null)
/** 默认停在队列第一行 —— 命中的栋排在最前,首屏不用点就有东西看 */
watch([queueOrder, () => snap.value?.id], () => {
  if (selId.value != null && bornRows.value.some(r => r.id === selId.value)) return
  selId.value = queueOrder.value[0]?.id ?? null
}, { immediate: true })
const selRow = computed(() => bornRows.value.find(r => r.id === selId.value) ?? null)
const selStation = computed(() => snap.value?.stations.find(s => s.id === selId.value) ?? null)

/** 大图图头那句三段式事实。命中的栋用 buildFacts 那句;没命中的用同样三段式的计数句。 */
const selFact = computed(() => {
  const r = selRow.value
  if (!r) return ''
  const f = (snap.value?.facts ?? []).find(
    x => x.stationId === r.id && (x.kind === 'run' || x.kind === 'scatter' || x.kind === 'thin'))
  if (f) return f.text
  return `已抄 ${r.seenN} / 已过去 ${r.elapsedN} ${unit.value} · 出正常范围 ${r.outN} ${unit.value}`
})

function pickStation(id: number) { selId.value = id }
function pickByName(name: string) {
  const r = bornRows.value.find(x => x.name === name)
  if (r) { selId.value = r.id; openDrawer() }
}

// ── B2 判据脚(§06.4)────────────────────────────────────────────────
// 线画在越线的画面**同一张卡**里,用户才会读成「这是我画的线」。
const critLines = computed(() => {
  const c = snap.value?.crit ?? crit.value
  return [
    { key: 'sigma', text: `正常范围半宽 ${c.bandSigma} 倍波动`, off: false },
    { key: 'run', text: `连续 ${c.bandRun} 个刻度算一段`, off: gran.value === 'year' },
    { key: 'cover', text: `抄表覆盖 ≥${pct0(c.coverMonth)}`, off: false },
    { key: 'ledger', text: `台账差 ±${pct0(c.ledger)}`, off: false },
    { key: 'anchor', text: `年锚点 ${c.anchorHours} 小时`, off: false },
    { key: 'yield', text: `年等效小时 ≥ 锚点 ${pct0(c.yieldRatio)}`, off: false },
  ]
})
function gotoParams() {
  tabs.openFresh('params', { pin: true })
  void router.push({ path: '/params', query: { ym: `${year.value}-12`, section: 'constant' } })
}
function goMeter(): void {
  tabs.openFresh('pv-income', { pin: true })
  void router.push('/pv-income')
}

// ── L2 三档段控(§06.5)──────────────────────────────────────────────
// 默认停在**账面量** —— 板数录进来之前只有这一档是全真数。第三档「高级分析」要点才进得去。
const section = ref<'abs' | 'ledger' | 'lab'>('ledger')

/** 每刻度每栋的等效小时。分母优先理论装机,没录退回台账 —— 口径写在图脚里。 */
const yieldSeries = computed(() => {
  const s = snap.value
  if (!s || s.gran !== 'month') return []
  const denom = new Map(s.stations.map(x =>
    [x.id, x.theoKwp ?? (x.capKwp != null && x.capKwp > 0 ? x.capKwp : null)]))
  const idx = new Map(s.ticks.map((t, i) => [t, i]))
  const out: { name: string; data: (number | null)[] }[] = []
  for (const st of s.stations) {
    if (!st.metered || !denom.get(st.id)) continue
    const arr: (number | null)[] = s.ticks.map(() => null)
    out.push({ name: st.name, data: arr })
  }
  const byName = new Map(out.map(o => [o.name, o.data]))
  for (const r of readings.value) {
    const i = idx.get(r.readDate)
    const st = s.stations.find(x => x.id === r.stationId)
    if (i == null || !st) continue
    const d = denom.get(r.stationId)
    const arr = byName.get(st.name)
    if (!d || !arr) continue
    arr[i] = +(r.genTotal / d).toFixed(3)
  }
  return out
})

/**
 * B3 等效小时轨迹(月档)—— **分位带 + 平滑中位线 + 选中那栋**,不再画 13 条线。
 *
 * 原来是 13 条同色细灰 + 1 条粗线。同色已经是对的(13 栋无一栋有自己的颜色),
 * 但**条数本身就是问题**:Javed 2010 实测叠加折线的可用上限压在 8 条,
 * 13 条在学理上必然失败 —— 实屏上就是一团灰毛球,粗线也被埋在里面。
 * 这条我在调研里写过,自己又踩了一次。
 *
 * 换成分布的形状:淡带 = 各栋的四分位距(p25~p75),粗线 = 全园中位。
 * 想看某一栋就点队列 —— 选中那栋单独画一条,与毛球里挑不出的那条是两回事。
 * 图元从 14 条降到 1 带 + 2 线。
 */
const b3Quant = computed(() => {
  const s = snap.value
  if (!s) return { p25: [], p50: [], p75: [] }
  const n = s.ticks.length
  const p25: (number | null)[] = [], p50: (number | null)[] = [], p75: (number | null)[] = []
  for (let i = 0; i < n; i++) {
    const col = yieldSeries.value
      .map(o => o.data[i]).filter((v): v is number => v != null).sort((a, b) => a - b)
    // 当刻度在网不足 3 栋 → 分位数没有意义,整列留空(与 §07 中位数门槛同口径)
    if (col.length < 3) { p25.push(null); p50.push(null); p75.push(null); continue }
    const q = (f: number) => col[Math.min(col.length - 1, Math.floor(f * (col.length - 1)))]
    p25.push(+q(0.25).toFixed(3)); p50.push(+q(0.5).toFixed(3)); p75.push(+q(0.75).toFixed(3))
  }
  return { p25, p50, p75 }
})

const b3Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const { p25, p50, p75 } = b3Quant.value
  const selName = selRow.value?.name
  const sel = selName ? yieldSeries.value.find(o => o.name === selName) : undefined
  const L = { symbol: 'none' as const, smooth: 0.3, connectNulls: false }
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 16, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: s.tickLabels, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '等效小时', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
    series: [
      // 带用两条堆叠线画:下沿透明,上沿只留填充 —— 不描边,免得读成两条数据线
      { name: 'p25', type: 'line', ...L, stack: 'q', silent: true,
        lineStyle: { opacity: 0 }, data: p25 },
      { name: '各栋四分位距', type: 'line', ...L, stack: 'q', silent: true,
        lineStyle: { opacity: 0 }, areaStyle: { color: C.INK100 },
        data: p75.map((v, i) => (v == null || p25[i] == null ? null : +(v - p25[i]!).toFixed(3))) },
      { name: '全园中位', type: 'line', ...L, lineStyle: { width: 2.2, color: C.INK500 }, data: p50 },
      // 选中那栋走焦点色:同为 2.2px 的两条灰(中位 INK500 / 选中 INK900)在屏上分不出谁是谁。
      // 蓝的是「你点的那一栋」,墨的是群体 —— 队列里的选择由此串成贯穿全屏的一条线索(§06.7)。
      ...(sel ? [{
        name: sel.name, type: 'line' as const, ...L,
        lineStyle: { width: 2.2, color: C.FOCUS }, data: sel.data,
      }] : []),
    ],
  }
})

// B4 等效小时 去年→今年(年档,替 B3)。在网不足 90 天的栋两端置 null,由图注计数。
const b4Points = computed(() => {
  const s = snap.value
  if (!s) return []
  const gen = new Map<number, number>()
  const days = new Map<number, Set<string>>()
  for (const r of prevReadings.value ?? []) {
    gen.set(r.stationId, (gen.get(r.stationId) ?? 0) + r.genTotal)
    const set = days.get(r.stationId) ?? new Set<string>()
    set.add(r.readDate); days.set(r.stationId, set)
  }
  return s.stations.filter(x => x.metered).map(x => {
    const d = x.theoKwp ?? (x.capKwp != null && x.capKwp > 0 ? x.capKwp : null)
    const pd = days.get(x.id)?.size ?? 0
    return {
      name: x.name,
      prev: d != null && pd >= 90 ? +((gen.get(x.id) ?? 0) / d).toFixed(1) : null,
      cur: x.days >= 90 && x.yieldHours != null ? +x.yieldHours.toFixed(1) : null,
    }
  })
})
const hasB34 = computed(() =>
  gran.value === 'month' ? yieldSeries.value.length > 0
    : b4Points.value.some(p => p.prev != null && p.cur != null))

// B5 各站年等效小时 vs 锚点 × 判据线 —— **点图,不是零起点条形**(理由见 PvDots.vue 顶注)。
const b5Target = computed(() => +((snap.value?.crit ?? crit.value).anchorHours
  * (snap.value?.crit ?? crit.value).yieldRatio).toFixed(1))
const b5Rows = computed(() => (snap.value?.stations ?? [])
  .filter(x => x.metered && x.yieldHours != null && x.days >= 90)
  .map(x => ({ name: x.name, value: +x.yieldHours!.toFixed(0) })))
const b5Skip = computed(() =>
  (snap.value?.stations ?? []).filter(x => x.metered).length - b5Rows.value.length)

// B6 台账装机 vs 板数×标称。**正方画布**:非等比上 y=x 不是 45°、±3% 带一侧宽一侧窄,读法失效。
// 画布靠 .pma-sq 的 max-width 钉死 —— grid 上下 14/34、左右 46/14,绘图区正好 202×202。
const b6Pts = computed(() => (snap.value?.stations ?? [])
  .filter(x => x.metered && x.theoKwp != null && x.capKwp != null)
  .map(x => ({ name: x.name, value: [+x.theoKwp!.toFixed(1), +x.capKwp!.toFixed(1)] })))
const b6Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const pts = b6Pts.value
  const hi = +(Math.max(10, ...pts.flatMap(p => p.value)) * 1.1).toFixed(0)
  const ray = (k: number) => [[0, 0], [hi, +(hi * k).toFixed(1)]]
  const dash = { color: C.INK300, width: 1, type: 'dashed' as const }
  const ax = { type: 'value', min: 0, max: hi, nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } }
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { data?: { name?: string; value?: number[] } }) =>
        p.data?.name ? `${p.data.name}<br/>板数×标称 ${p.data.value![0]} kWp<br/>台账 ${p.data.value![1]} kWp` : '',
    },
    grid: { left: 46, right: 14, top: 14, bottom: 34 },
    xAxis: { ...ax, name: '板数×标称 kWp', nameLocation: 'middle', nameGap: 20 },
    yAxis: { ...ax, name: '台账 kWp' },
    series: [
      { type: 'line', symbol: 'none', silent: true, lineStyle: { color: C.INK700, width: 1.4 }, data: ray(1) },
      { type: 'line', symbol: 'none', silent: true, lineStyle: dash, data: ray(1 + s.crit.ledger) },
      { type: 'line', symbol: 'none', silent: true, lineStyle: dash, data: ray(1 - s.crit.ledger) },
      // 点是数据,y=x 与 ±3% 带是参照 —— 后者留在墨阶里当尺子(§06.7)。
      // **13 点不能全上焦点蓝**:那样蓝在这张图里就不编码「选中」了,而且与 B5
      // (同样一栋一点)的规则打架。群体墨阶 + 选中那栋焦点色,两张图同一条规则。
      { type: 'scatter', symbolSize: 11, itemStyle: { color: C.INK300 },
        data: pts.filter(x => x.name !== selRow.value?.name) },
      { type: 'scatter', symbolSize: 13, itemStyle: { color: C.FOCUS },
        data: pts.filter(x => x.name === selRow.value?.name) },
    ],
  }
})
/** 段内某块无真数则整块不渲染,换一句 11px 事实 + 入口;全部无真数才整档隐藏(§06.5) */
const absAny = computed(() => hasB34.value || b5Rows.value.length > 0 || b6Pts.value.length > 0)

// B7 消纳结构与损耗率。副轴**固定 0–6%**,按物理上可能的区间取,不按当前数据的区间取(§00 v3)。
const LOSS_MAX = 6
const b7Over = computed(() => {
  const s = snap.value
  if (!s) return [] as { i: number; v: number }[]
  return s.ledger.lossPct
    .map((v, i) => ({ i, v: +(v * 100).toFixed(2) }))
    .filter(x => x.v > LOSS_MAX)
})
const b7Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const k = s.gran === 'month' ? 1000 : 10000
  const rate = s.ledger.lossPct.map(v => {
    const p = +(v * 100).toFixed(2)
    return p > LOSS_MAX ? null : p          // 超出的刻度**折线断开**,不让它贴顶走成平线
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['自消纳', '上网', '损耗', '损耗率'], textStyle: { fontSize: 11 } },
    grid: { left: 52, right: 46, top: 26, bottom: 26 },
    xAxis: { type: 'category', data: s.tickLabels, axisLabel: { fontSize: 11 } },
    yAxis: [
      { type: 'value', name: s.gran === 'month' ? '千度' : '万度', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
      { type: 'value', name: '%', min: 0, max: LOSS_MAX, nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
    ],
    series: [
      { name: '自消纳', type: 'bar', stack: 'x', barMaxWidth: 22, itemStyle: { color: C.FILL_SLATE }, data: s.ledger.self.map(v => +(v / k).toFixed(2)) },
      { name: '上网', type: 'bar', stack: 'x', itemStyle: { color: C.FILL_CYAN }, data: s.ledger.grid.map(v => +(v / k).toFixed(2)) },
      // 损耗走中性灰而不是第三档蓝:自消纳与上网是两种**有用的输出**(两支蓝),
      // 损耗是**废掉的**,不同种;slate/cyan/sky 三档明度会被读成「有序的三档」(§06.7)
      { name: '损耗', type: 'bar', stack: 'x', itemStyle: { color: C.INK300 }, data: s.ledger.loss.map(v => +(v / k).toFixed(2)) },
      {
        name: '损耗率', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 4, connectNulls: false,
        lineStyle: { width: 1.6, color: C.INK700 }, itemStyle: { color: C.INK700 }, data: rate,
        // 溢出的刻度在轴外补一个三角 + 数值,不静默裁掉(§06.5)
        markPoint: b7Over.value.length ? {
          silent: true, symbol: 'triangle', symbolSize: 9, itemStyle: { color: C.INK700 },
          label: { fontSize: 11, position: 'top', formatter: (p: { value?: number }) => `${p.value ?? ''}%` },
          data: b7Over.value.map(o => ({ name: '溢出', value: o.v, xAxis: s.tickLabels[o.i], yAxis: LOSS_MAX })),
        } : undefined,
      },
    ],
  }
})
const hasB7 = computed(() => {
  const s = snap.value
  return !!s && s.ledger.self.some((v, i) => v + s.ledger.grid[i] + s.ledger.loss[i] > 0)
})

// B8 各栋消纳收益与上网收益。**横向**分组柱 —— 13 个中文栋名不斜排(§06.5)。
// 两根柱与 B7 的自消纳/上网**同色**:同一件事在两张图里必须是同一个色(§06.7)。
const b8Rows = computed(() => (snap.value?.stations ?? [])
  .filter(x => x.metered && (x.revSelf > 0 || x.revGrid > 0))
  .slice().sort((a, b) => (a.revSelf + a.revGrid) - (b.revSelf + b.revGrid)))
const b8Opt = computed<object>(() => {
  const rs = b8Rows.value
  if (!rs.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['消纳收益', '上网收益'], textStyle: { fontSize: 11 } },
    grid: { left: 96, right: 24, top: 26, bottom: 30 },
    xAxis: { type: 'value', name: '万元', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'category', data: rs.map(x => x.name), axisLabel: { fontSize: 11 } },
    series: [
      { name: '消纳收益', type: 'bar', barMaxWidth: 9, itemStyle: { color: C.FILL_SLATE }, data: rs.map(x => +(x.revSelf / 10000).toFixed(2)) },
      { name: '上网收益', type: 'bar', barMaxWidth: 9, itemStyle: { color: C.FILL_CYAN }, data: rs.map(x => +(x.revGrid / 10000).toFixed(2)) },
    ],
  }
})
const ledgerAny = computed(() => hasB7.value || b8Rows.value.length > 0)

/** 抛光矩阵里一栋都没有 → 工作台七块全空,整档不出现(不用先跑 buildLab 才知道)。 */
const labReady = computed(() => (snap.value?.polish.resid.size ?? 0) > 0)

const SECTIONS = computed(() => [
  ...(absAny.value ? [{ value: 'abs', label: '绝对水平' }] : []),
  ...(ledgerAny.value ? [{ value: 'ledger', label: '账面量' }] : []),
  ...(labReady.value ? [{ value: 'lab', label: '高级分析' }] : []),
])
// 整档隐藏时把档位挪到还在的那一档 —— 停在一个不存在的档等于整片空白
watch(SECTIONS, (opts) => {
  if (opts.length && !opts.some(o => o.value === section.value)) {
    section.value = opts[0].value as 'abs' | 'ledger' | 'lab'
  }
}, { immediate: true })

// ── L2 第三档「高级分析」= 2026-08 被砍掉的分析工作台(§06.5)────────────
// 当年砍它的理由(a62c60c)是「算法自检不是业务屏内容」。那条**对运维用户成立**:
// ACF 图告诉物业「残差有 0.5 的自相关」,他既改不了算法也没法据此派人上楼。
// 但反对的理由当年也是对的:不暴露这一层,所有数字不可审计。承诺过的「方法与口径页」
// 下一刀(6e93317)也删了 —— 于是这些量在屏上无处可查。
// 所以它回来了,**但不回首屏**:开在段控第三档,运维看不见,想复算的人点一下就有。
//
// ⚠ §05 禁止屏上出现 p / q / σ / 置信区间。那条对 L0 / L1 / 绝对水平 / 账面量 继续成立,
//   **这一档是唯一的例外** —— 它存在的理由就是给专业的人看这些量。
// ⚠ 强调色 #9D5D17 按 §06.0 只在 L0-L1,这一档一次都不用。
//   这里唯一的颜色是**焦点蓝**(选中那一栋):L1 的点估计、L3 里那一栋的残差。
//   其余(ACF 柱、零分布、区间线段、零线)全走墨阶 —— 没有维度可编码的图不上色(§06.7)。

/**
 * 工作台的全部七块。**只在这一档被选中时才算** —— 它比首屏那次重得多
 * (13 次 buildDetail + 第二次抛光 + 两轮块自助),九成的人根本不点开这一档。
 *
 * ponytail: focusId 进了 computed,换选中(L4 零分布跟着走)会整份重算。13 栋量级下是
 * 百毫秒级,可接受;真要更快得让 logic 把 L4 拆成单独入口,那是 logic 的接口,不在本文件。
 */
const lab = computed(() => {
  if (section.value !== 'lab' || !snap.value || !snapInput.value) return null
  return buildLab(snap.value, snapInput.value, selId.value ?? undefined)
})

/** 工作台里点栋名/表行 → 换选中。**未投产 / 不在模型里的栋挡掉**:选中它会让 L1 大图空掉。 */
function pickLab(id: number) {
  if (bornRows.value.some(r => r.id === id)) selId.value = id
}

// L2 ACF:一次只画一栋。跟着屏上选中走,选中那栋不在矩阵里就退回 L4 的焦点栋。
const labAcf = computed(() => {
  const l = lab.value
  if (!l?.acf.length) return null
  const a = l.acf.find(x => x.id === selId.value)
    ?? l.acf.find(x => x.id === l.nullDist?.id)
    ?? l.acf[0]
  // days 只在检验表那份里,图脚要把 n 和 N_eff 并排印出来才看得见「√N 错多少」
  return { ...a, days: l.tests.find(t => t.id === a.id)?.days ?? 0 }
})

// L1 α 排序:点 = 点估计,横线 = 块自助 95% 区间。
// **误差棒不用 custom** —— echartsBundle 没注册 custom,画出来是空白图且 jsdom 测不出来。
// 一条 line 系列 + null 断点就够:每栋两点一段,段间插 null 断开。13 个系列没必要。
const labAlphaOpt = computed<object>(() => {
  const rs = lab.value?.alphaRows ?? []
  if (!rs.length) return {}
  const selName = selRow.value?.name
  const bars: ((string | number)[] | null)[] = []
  for (const r of rs) {
    bars.push([+r.ciLo.toFixed(1), r.name], [+r.ciHi.toFixed(1), r.name], null)
  }
  return {
    tooltip: { trigger: 'item' },
    grid: { left: 96, right: 24, top: 10, bottom: 34 },
    xAxis: {
      type: 'value', name: 'α%（相对全园中位）', nameLocation: 'middle', nameGap: 22,
      nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 },
    },
    yAxis: { type: 'category', inverse: true, data: rs.map(r => r.name), axisLabel: { fontSize: 11 } },
    series: [
      {
        type: 'line', silent: true, symbol: 'none', connectNulls: false,
        lineStyle: { color: C.INK300, width: 3 }, data: bars,
      },
      {
        // 点估计:群体墨阶,选中那栋上焦点蓝。区间线段与零线保持墨阶 —— 它们是尺子不是类别。
        type: 'scatter', symbolSize: 7,
        data: rs.map(r => ({
          value: [+r.alphaPct.toFixed(1), r.name],
          itemStyle: { color: r.name === selName ? C.FOCUS : C.INK300 },
        })),
        markLine: {
          silent: true, symbol: 'none', label: { fontSize: 11, formatter: '0' },
          lineStyle: { color: C.INK500, type: 'dashed', width: 1 }, data: [{ xAxis: 0 }],
        },
      },
    ],
  }
})

// L2 残差自相关。这张图是「为什么不用 √N 而用块自助」的**证据**:ρ₁ 非零 = 独立假设不成立。
// **故意留墨**:一次只画一栋、一条序列的柱,既没有类别也没有焦点可编码(选中那栋就是这一栋
// 本身,再上焦点色是自我指涉)。没有维度还上色就是装饰 —— 不是漏改(§06.7)。
const labAcfOpt = computed<object>(() => {
  const a = labAcf.value
  if (!a?.rho.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 46, right: 16, top: 10, bottom: 32 },
    xAxis: {
      type: 'category', data: a.rho.map((_, k) => String(k)),
      name: '滞后（天）', nameLocation: 'middle', nameGap: 20,
      nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 },
    },
    yAxis: { type: 'value', name: 'ρ', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
    series: [{ type: 'bar', barMaxWidth: 9, itemStyle: { color: C.INK700 }, data: a.rho.map(v => +v.toFixed(3)) }],
  }
})

// L3 残差 vs 年积日。**13 栋的点汇在一起** —— 问的是「模型里还剩没剩年周期」,不是某一栋。
// 所以群体留墨、只有选中那栋上焦点蓝:全涂蓝等于蓝不再表示「选中」,那是装饰(§06.7)。
const labDoyPts = computed(() =>
  (lab.value?.doy ?? []).flatMap(d => d.pts.map(p => [p.doy, +p.v.toFixed(4)])))
// 焦点那栋的点单独一层画在上面 —— 与墨层重叠是故意的:计数(图脚的「N 个点」)仍取全量
// 当段的点单独一层 —— 横轴是年积日,一个月只是轴上的一小段,
// 跟着月档「只画一个月」等于把这张图变成 30 个点的散点,而它要看的是**有没有年周期**。
// 所以整年照画,当段的点加重:跟得上期间,又不撒谎。
const labDoySeg = computed(() =>
  (lab.value?.doy ?? []).flatMap(d => d.pts.filter(p => p.inSeg).map(p => [p.doy, +p.v.toFixed(4)])))
const labDoyFocus = computed(() => {
  const n = selRow.value?.name
  const d = n ? (lab.value?.doy ?? []).find(x => x.name === n) : undefined
  return d ? d.pts.map(p => [p.doy, +p.v.toFixed(4)]) : []
})
const labAmp = computed(() =>
  [...(lab.value?.doy ?? [])].sort((a, b) => b.amp - a.amp)[0] ?? null)
const labDoyOpt = computed<object>(() => {
  const pts = labDoyPts.value
  if (!pts.length) return {}
  return {
    grid: { left: 56, right: 16, top: 10, bottom: 32 },
    xAxis: {
      type: 'value', min: 1, max: 366, name: '年积日', nameLocation: 'middle', nameGap: 20,
      nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 },
    },
    yAxis: { type: 'value', scale: true, name: '残差（对数）', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
    series: [
      {
        type: 'scatter', symbolSize: 2, itemStyle: { color: C.INK300 }, data: pts,
        markLine: {
          silent: true, symbol: 'none', label: { fontSize: 11, formatter: '0' },
          lineStyle: { color: C.INK500, type: 'dashed', width: 1 }, data: [{ yAxis: 0 }],
        },
      },
      { type: 'scatter', symbolSize: 3, itemStyle: { color: C.INK700 }, data: labDoySeg.value },
      { type: 'scatter', symbolSize: 2, itemStyle: { color: C.FOCUS }, data: labDoyFocus.value },
    ],
  }
})

// L4 块自助零分布 + 观测竖线。让尾概率看得见,比印一个数字可信。
// **故意留墨**:一栋、一条重采样分布,柱之间没有类别可分,观测竖线靠位置(落在尾部)说话
// 不靠颜色。没有维度可编码的图上色就是装饰 —— 不是漏改(§06.7)。
// ⚠ 这里画的是 buildLab 里 nullDist 的量:**最后 30 天窗口均值**。L7 表里那列 p 是
//    变点检验的 p,两个量不同源(实测同一栋能差两个数量级)。
//    对策是**把这张图自己的尾概率印在竖线上**(labNullTail),不是写一句「不要互相读」——
//    读者手里有了数才不会去对那个对不上的。别再把这个数拿掉。
const LAB_BINS = 40

/**
 * 这张图自己的那个数 —— **必须印在图上**。
 *
 * 原来图脚写的是「两个量不同源,不要互相读」。那是让用户替设计的失误买单:
 * 图上有一条竖线、表里有一列 p,读者一定会去对,而它们差两个数量级。
 * 把尾概率就地印出来,读者手里有了数,就不会去表里找那个对不上的。
 * 单侧:观测在中位右边就取右尾,左边取左尾 —— 与「离零假设有多远」同向。
 */
const labNullTail = computed(() => {
  const nd = lab.value?.nullDist
  if (!nd?.dist.length) return null
  const n = nd.dist.length
  const right = nd.dist.filter(v => v >= nd.obs).length
  const left = nd.dist.filter(v => v <= nd.obs).length
  return Math.min(right, left) / n
})

const labNullOpt = computed<object>(() => {
  const nd = lab.value?.nullDist
  if (!nd?.dist.length) return {}
  const lo = Math.min(...nd.dist, nd.obs)
  const hi = Math.max(...nd.dist, nd.obs)
  const w = (hi - lo) / LAB_BINS || 1
  const cnt = new Array<number>(LAB_BINS).fill(0)
  for (const v of nd.dist) cnt[Math.min(LAB_BINS - 1, Math.floor((v - lo) / w))]++
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 46, right: 16, top: 10, bottom: 32 },
    xAxis: {
      type: 'value', min: +lo.toFixed(4), max: +hi.toFixed(4),
      name: '窗口均值（对数）', nameLocation: 'middle', nameGap: 20,
      nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 },
    },
    yAxis: { type: 'value', name: '重采样次数', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar', barMaxWidth: 12, itemStyle: { color: C.INK300 },
      data: cnt.map((c, i) => [+(lo + (i + 0.5) * w).toFixed(4), c]),
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: C.INK900, width: 1.6 },
        label: {
          fontSize: 11,
          formatter: `观测 ${nd.obs.toFixed(4)}　尾概率 ${(labNullTail.value ?? 0).toFixed(3)}`,
        },
        data: [{ xAxis: +nd.obs.toFixed(4) }],
      },
    }],
  }
})

// L6 质量矩阵。logic 与 PvQualityGrid 都是**四态**:正常 / 缺抄 / 整日剔除 / 未投产。
// 未投产画成空白无填充 —— 它既不是漏抄也不是正常(§03.8 未到 ≠ 漏抄,3ceefe0 在真数据上栽过)。
// 缺抄可行动(暖黄)、未投产不可行动(留白),两者不能都是浅灰(§06.7)。
const QCELL = { ok: 'ok', missing: 'miss', dropped: 'dropped', pre: 'pre' } as const
const labQuality = computed(() => {
  const q = lab.value?.quality
  if (!q?.dates.length) return null
  return {
    dates: q.dates,
    rows: q.rows.map(r => ({
      id: r.id, name: r.name,
      cells: r.states.map(s => QCELL[s]),
    })),
    // 未装表 / 未录容量的栋压根没进抛光:那一整行的空**不是**「全年没抄表」,得写出来
    outside: q.rows.filter(r => !r.inMatrix).map(r => r.name),
    preN: q.rows.reduce((a, r) => a + r.states.filter(s => s === 'pre').length, 0),
  }
})

// ── L3 单栋抽屉(§06.6)──────────────────────────────────────────────
// 关抽屉时期间档位、页面滚动位置、组的展开态、段控档位一律不变 —— 这里只动 drawerOpen。
const drawerOpen = ref(false)
const detail = computed(() =>
  (snap.value && selId.value != null ? buildDetail(snap.value, selId.value) : null))

// URL 加 #st={id} **不换路由**(§06.6):replace 不进历史栈,路径不变,KeepAlive 不重挂,
// 所以关抽屉时期间档位 / 滚动位置 / 组展开态 / 段控档位全都原样留着。
function openDrawer() {
  if (selId.value == null) return
  drawerOpen.value = true
  void router.replace({ hash: `#st=${selId.value}` })
}
function closeDrawer() {
  drawerOpen.value = false
  void router.replace({ hash: '' })
}
function stepStation(d: 1 | -1) {
  const q = queueOrder.value
  const i = q.findIndex(r => r.id === selId.value)
  const nx = q[(i + d + q.length) % q.length]
  if (nx) { selId.value = nx.id; openDrawer() }
}
onMounted(() => {
  const m = /#st=(\d+)/.exec(location.hash)
  if (m) { selId.value = Number(m[1]); drawerOpen.value = true }
})

/** 当前期间段在整年图上的底色高亮。**高亮只画到数据截止日,不画到期末**(§06.6) */
const segBand = computed(() => {
  const s = snap.value
  if (!s || s.gran !== 'month' || !s.ticks.length) return null
  const from = s.ticks[0]
  const last = s.ticks[s.ticks.length - 1]
  const to = s.dataThrough && s.dataThrough < last ? s.dataThrough : last
  return to >= from ? { from: from.slice(5), to: to.slice(5) } : null
})
const bandArea = computed(() => (segBand.value ? {
  silent: true, itemStyle: { color: C.INK050 },
  data: [[{ xAxis: segBand.value.from }, { xAxis: segBand.value.to }]],
} : undefined))

// B9 这一年的偏离与水平变化:残差散点 + 样条 + 95% 估计范围(渐变透明,不描硬边)+ 变点竖线
const b9Opt = computed<object>(() => {
  const d = detail.value
  if (!d || !d.spline.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: d.spline.map(x => x.date.slice(5)), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '相对自身水平（对数）', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 }, scale: true },
    series: [
      { type: 'line', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, data: d.spline.map(x => +x.lo.toFixed(4)) },
      {
        type: 'line', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 },
        // 渐变透明不描硬边 —— 硬边会被读成「界限」,而它只是估计范围的边缘(§06.6)
        // 带是参照物不是数据类别 → 墨阶。FILL_SKY 的岗位是 L6「正常」态,别在这里占用它
        areaStyle: { color: C.INK100 },
        data: d.spline.map(x => +(x.hi - x.lo).toFixed(4)),
      },
      { type: 'scatter', symbolSize: 3, itemStyle: { color: C.INK300 }, data: d.resid.map(v => +v.toFixed(4)) },
      {
        type: 'line', symbol: 'none', lineStyle: { width: 2, color: C.INK900 },
        data: d.spline.map(x => +x.fit.toFixed(4)),
        markArea: bandArea.value,
        markLine: d.cpDate ? {
          silent: true, symbol: 'none',
          lineStyle: { color: C.INK700, width: 1.4, type: 'dashed' },
          label: { formatter: d.cpDate.slice(5), fontSize: 11 },
          data: [{ xAxis: d.cpDate.slice(5) }],
        } : undefined,
      },
    ],
  }
})

// B10 逐日偏离与两道范围线。控制限来自变点之前的历史,与本段无关 → 月中照常有限。
const b10Opt = computed<object>(() => {
  const d = detail.value
  if (!d) return {}
  const cats = d.dates.map(x => x.slice(5))
  const lim = (k: number) => +(d.center + k * d.sigma).toFixed(4)
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    // markLine / markArea 不参与轴范围计算,**必须手动设 min/max**,否则超范围的会被静默裁掉
    xAxis: { type: 'category', data: cats, min: 0, max: cats.length - 1, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '相对自身水平（对数）', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 }, scale: true },
    series: [{
      type: 'scatter', symbolSize: 3, itemStyle: { color: C.INK500 },
      data: d.resid.map(v => +v.toFixed(4)),
      markArea: d.limitFrom && d.limitTo ? {
        silent: true, itemStyle: { color: C.INK050 },
        data: [[{ xAxis: d.limitFrom.slice(5) }, { xAxis: d.limitTo.slice(5) }]],
      } : bandArea.value,
      markLine: {
        silent: true, symbol: 'none', label: { fontSize: 11 },
        data: [
          { yAxis: +d.center.toFixed(4), lineStyle: { color: C.INK700, width: 1.4 } },
          { yAxis: lim(2), lineStyle: { color: C.INK500, type: 'dashed', width: 1 } },
          { yAxis: lim(-2), lineStyle: { color: C.INK500, type: 'dashed', width: 1 } },
          { yAxis: lim(3), lineStyle: { color: C.INK300, type: 'dotted', width: 1 } },
          { yAxis: lim(-3), lineStyle: { color: C.INK300, type: 'dotted', width: 1 } },
        ],
      },
    }],
  }
})

// B11 跟全园一起涨落的程度:逐月 β + ±1SE 淡带。
// **样本不足的月不画**(v3):满格灰带读起来像「不确定性巨大」,而不是「样本不够」。
const b11 = computed(() => {
  const rows = (snap.value?.slopes.get(selId.value ?? -1) ?? [])
    .filter(r => isFinite(r.beta) && isFinite(r.se) && r.n >= 3)
    .slice().sort((a, b) => a.key.localeCompare(b.key))
  const all = snap.value?.slopes.get(selId.value ?? -1) ?? []
  return { rows, skipped: all.length - rows.length }
})
const b11Opt = computed<object>(() => {
  const rs = b11.value.rows
  if (!rs.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 16, top: 12, bottom: 26 },
    xAxis: { type: 'category', data: rs.map(r => r.key.slice(5) + '月'), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 }, scale: true },
    series: [
      { type: 'line', stack: 'se', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, data: rs.map(r => +(r.beta - r.se).toFixed(3)) },
      {
        type: 'line', stack: 'se', symbol: 'none', silent: true, lineStyle: { opacity: 0 },
        // 带是参照物不是数据类别 → 墨阶。FILL_SKY 的岗位是 L6「正常」态,别在这里占用它
        areaStyle: { color: C.INK100 }, data: rs.map(r => +(2 * r.se).toFixed(3)),
      },
      {
        type: 'line', symbol: 'circle', symbolSize: 4,
        lineStyle: { width: 1.6, color: C.INK900 }, itemStyle: { color: C.INK900 },
        data: rs.map(r => +r.beta.toFixed(3)),
        markLine: {
          silent: true, symbol: 'none', label: { fontSize: 11, formatter: '1' },
          lineStyle: { color: C.INK300, type: 'dashed', width: 1 },
          data: [{ yAxis: 1 }],
        },
      },
    ],
  }
})

// B12 逐刻度明细。**未到的行不出现**;漏抄的行出现但值为空 + 标记(§06.6)
const b12 = computed(() => {
  const r = selRow.value, s = snap.value
  if (!r || !s) return []
  return s.ticks.map((t, i) => ({ t, label: s.tickLabels[i], st: r.state[i], v: r.ratio[i], o: r.out[i] }))
    .filter(x => x.st !== 'future')
    .reverse()
})
function outText(o: number | null | undefined): string {
  return o === -1 ? '在范围下方' : o === 1 ? '在范围上方' : o === 0 ? '在范围内' : '—'
}
</script>

<template>
  <AnaShell period-mode="full" :compare="CMP">
    <div v-if="loading" class="pma-hold"><span class="page-spin" /></div>
    <AnaEmpty v-else-if="failed" label="分栋抄表数据没加载成功" hint="刷新重试；仍不行就到分栋抄表屏看数据在不在" />
    <AnaEmpty
      v-else-if="!snap"
      :label="year + ' 年暂无分栋抄表记录'"
      hint="这屏画的是分栋抄表数据，没有记录就没有可画的东西"
      to="/pv-income"
      to-text="去录入分栋抄表"
    />

    <div v-else class="av2-grid">
      <!-- ══ L0 · B0 巡检指标卡(§06.2)—— 五格并排,平行扫读,不串成句子 ══ -->
      <div class="av2-s12 av2-lead pma-b0" :class="{ quiet: !hitRows.length }">
        <div class="k">
          <div class="big">{{ hitRows.length }}</div>
          <div class="lab">栋有出范围段</div>
        </div>
        <div class="k">
          <div class="mid">{{ thinRows.length }}</div>
          <div class="lab">读不出</div>
        </div>
        <div class="k">
          <div class="mid">{{ noMeterN }}</div>
          <div class="lab">未装表</div>
        </div>
        <div class="k">
          <div class="mid">{{ panelDone.k }}/{{ panelDone.n }}</div>
          <div class="lab">已录板数</div>
        </div>
        <!-- 这两行不能删:没有它,「0 栋触线」与「数据没更新」在屏上长得一模一样 -->
        <div class="fresh">
          <div>数据到 {{ snap.dataThrough ?? '—' }} · 本段已过去 {{ snap.elapsedN }}/{{ snap.ticks.length }} {{ unit }}</div>
          <div>
            已抄 {{ cover.seen }}/{{ cover.elapsed }} · 覆盖
            {{ cover.pct == null ? '—' : (cover.pct * 100).toFixed(0) + '%' }}（按已过去算）· 算于 <code>{{ snap.id }}</code>
          </div>
        </div>
      </div>

      <!-- ══ L1 · B1 队列 + 单栋大图 / B2 判据脚(§06.3 + §06.4)══════ -->
      <div class="av2-card av2-s12 av2-core pma-main">
        <div class="av2-card-h">
          <span class="t">{{ segLabel }}逐{{ gran === 'month' ? '日' : '月' }}比值</span>
          <span class="hint">线 = 这栋当刻度发电 ÷ 全园同刻度中位；各栋规模不同，比值本身有高有低，不横着比</span>
          <button v-if="selRow" class="pma-lk" @click="openDrawer">
            看 {{ selRow.name }} 的整年趋势 →
          </button>
        </div>

        <div class="pma-md">
          <PvQueue :rows="board" :sel-id="selId" :unborn="unbornNames" :unit="unit" @pick="pickStation" />
          <PvDayChart
            v-if="selRow"
            :row="selRow" :tick-labels="snap.tickLabels" :fact="selFact" :crit="snap.crit"
          />
          <div v-else class="pma-note">这一段没有已投产的楼栋，画不出逐刻度比值。</div>
        </div>

        <div class="pma-div"></div>

        <!-- B2 判据脚:六个参数只读回显,线画在越线的画面同一张卡里(§06.4) -->
        <div class="pma-b2">
          <span v-for="c in critLines" :key="c.key" :class="{ off: c.off }">
            {{ c.text }}<template v-if="c.off">（年档不出此判据）</template>
          </span>
          <button class="pma-lk" @click="gotoParams">去改</button>
        </div>
      </div>

      <!-- ══ L2 · 两档段控(§06.5)—— 切档不换卡,容器高度按最高段钉死 ══ -->
      <template v-if="SECTIONS.length">
        <div class="av2-s12 pma-seg">
          <Segmented v-model="section" :options="SECTIONS" />
          <!-- §05:只说这一档在做什么、给谁看,不下判断 -->
          <span v-if="labReady" class="pma-seghint">
            「高级分析」= 算法自检与口径核对，给要复算这屏数字的人；含 p / q / σ 等统计量，其余各档不出现。
          </span>
        </div>

        <div class="av2-s12 pma-sec">
          <div class="av2-grid">
            <!-- ── 绝对水平 ── -->
            <template v-if="section === 'abs'">
              <div class="av2-card av2-s8">
                <div class="av2-card-h">
                  <span class="t">{{ gran === 'month' ? '等效小时轨迹' : `等效小时 ${year - 1}→${year}` }}</span>
                  <span class="hint">
                    {{ gran === 'month'
                      ? '淡带 = 各栋四分位距；粗线 = 全园中位；深线 = 选中那栋'
                      : '两点线段 = 去年与今年的年等效小时；两端直接标数值' }}
                  </span>
                </div>
                <AnaEChart v-if="gran === 'month' && hasB34" :option="b3Opt" :height="250" />
                <PvSlope v-else-if="gran === 'year' && hasB34" :points="b4Points" :sel-name="selRow?.name" @pick="pickByName" />
                <div v-else class="pma-note">
                  没有装机分母，算不出等效小时。
                  <button class="pma-lk" @click="goMeter">去分栋抄表录板数与单块标称功率 →</button>
                </div>
                <div v-if="hasB34" class="pma-fn">
                  纵轴 = 发电 ÷ 装机，单位小时；分母优先取板数 × 单块标称功率，没录的栋退回台账装机。
                  <template v-if="gran === 'month'">
                    画的是分布不是每一栋：淡带取各栋当刻度的 p25~p75，在网不足 3 栋的刻度留空。
                    要看某一栋就点左边的队列。
                  </template>
                  13 栋同色，没有任何一栋有自己的颜色。
                </div>
              </div>

              <div class="av2-card av2-s4">
                <div class="av2-card-h">
                  <span class="t">各站年等效小时</span>
                  <span class="hint">竖虚线 = {{ b5Target }} h · 点按值降序</span>
                </div>
                <div v-if="b5Rows.length" class="pma-scroll">
                  <PvDots :rows="b5Rows" :target="b5Target" unit=" h" :sel-name="selRow?.name" @pick="pickByName" />
                </div>
                <div v-else class="pma-note">
                  在网满 90 天且有装机分母的栋为 0，画不出点。
                  <button class="pma-lk" @click="goMeter">去分栋抄表 →</button>
                </div>
                <div v-if="b5Rows.length" class="pma-fn">
                  点 = 该站全年等效小时；细杆 = 它离锚点多远；竖虚线 = 年锚点
                  {{ snap.crit.anchorHours }} × {{ pct0(snap.crit.yieldRatio) }}。
                  横轴贴着实际值域、不从 0 起 —— 点用位置编码，不需要零基线；
                  这些值天然聚在一条窄带里，从 0 起会把它们画成一样长。
                  <template v-if="b5Skip > 0">{{ b5Skip }} 栋在网不足 90 天，不画，也不做年化。</template>
                </div>
              </div>

              <div class="av2-card av2-s4">
                <div class="av2-card-h">
                  <span class="t">台账装机 vs 板数×标称</span>
                  <span class="hint">实线 = 两者相等，虚线 = ±{{ pct0(snap.crit.ledger) }}</span>
                </div>
                <div v-if="b6Pts.length" class="pma-sq">
                  <AnaEChart :option="b6Opt" :height="250" />
                </div>
                <div v-else class="pma-note">
                  {{ snap.quality.noPanel.length }} 栋未录板数或单块标称功率，这一块画不出点。
                  <button class="pma-lk" @click="goMeter">去分栋抄表录两列 →</button>
                </div>
                <div v-if="b6Pts.length" class="pma-fn">
                  横轴 = 板数 × 单块标称功率 ÷ 1000，纵轴 = 台账装机，两轴同量程、画布正方，
                  所以实线是 45°。点离实线越远，两者差得越多。
                  <template v-if="snap.quality.noPanel.length">
                    {{ snap.quality.noPanel.length }} 栋未录，不画点：{{ snap.quality.noPanel.join('、') }}
                  </template>
                </div>
              </div>
            </template>

            <!-- ── 高级分析(工作台七块)。全屏唯一允许出现 p / q / σ / 置信区间的地方 ── -->
            <template v-else-if="section === 'lab'">
              <template v-if="lab">
                <!-- L1 α 排序 -->
                <div class="av2-card av2-s6 pma-lab" data-lab="L1">
                  <div class="av2-card-h">
                    <span class="t">先天水平 α 排序</span>
                    <span class="pma-per">整年</span>
                    <span class="hint">
                      点 = α 点估计，横线 = 块自助 95% 区间 · 横轴 α%（相对全园中位），纵轴各栋按 α 升序 ·
                      拿全年逐日残差算 · 来源：中位数抛光的 α，区间由残差块自助 B=399 重采样
                    </span>
                  </div>
                  <AnaEChart v-if="lab.alphaRows.length" :option="labAlphaOpt" :height="250" />
                  <div v-else class="pma-note">抛光矩阵里没有可排的栋，这一块不画。</div>
                  <div v-if="lab.alphaRows.length" class="pma-fn">
                    α 是相对全园中位的长期水平差，不区分成因：台账装机少写 10%，α 就恒偏 10%。
                    <template v-if="lab.alphaExcluded.length">
                      台账差超过 ±{{ pct0(snap.crit.ledger) }} 的 {{ lab.alphaExcluded.length }} 栋不进这张图：{{ lab.alphaExcluded.join('、') }}。
                    </template>
                    <template v-if="snap.quality.noPanel.length">
                      另有 {{ snap.quality.noPanel.length }} 栋未录板数，两列凑不齐，α 没经过台账校验。
                    </template>
                  </div>
                </div>

                <!-- L2 残差自相关 ACF -->
                <div class="av2-card av2-s6 pma-lab" data-lab="L2">
                  <div class="av2-card-h">
                    <span class="t">残差自相关 ACF<template v-if="labAcf"> · {{ labAcf.name }}</template></span>
                    <span class="pma-per">整年 · 滞后 0–{{ labAcf ? labAcf.rho.length - 1 : 0 }}</span>
                    <span class="hint">
                      柱 = 各滞后的自相关系数 · 横轴滞后 0–30 天，纵轴 ρ 无量纲（−1~1） ·
                      拿这一栋的全年逐日残差算 · 来源：抛光残差
                    </span>
                  </div>
                  <AnaEChart v-if="labAcf" :option="labAcfOpt" :height="200" />
                  <div v-else class="pma-note">没有够长的残差序列，算不出自相关。</div>
                  <div v-if="labAcf" class="pma-fn">
                    跟着队列选中那栋走。滞后 1 的 ρ 不为零，逐日残差就不是独立的 ——
                    这栋有效日 n = {{ labAcf.days }}，折算后 N_eff = {{ Math.round(labAcf.nEff) }}，
                    下面那张表的 z 用的是 N_eff，zₙ 那一列是同一条数据按 n 算的。
                  </div>
                </div>

                <!-- L3 残差 vs 年积日 -->
                <div class="av2-card av2-s6 pma-lab" data-lab="L3">
                  <div class="av2-card-h">
                    <span class="t">残差 vs 年积日</span>
                    <span class="pma-per">整年<template v-if="gran === 'month'">（{{ segLabel }}加重）</template></span>
                    <span class="hint">
                      散点，各栋的点汇在一起同色 · 横轴年积日 1–366 天，纵轴残差（对数，无量纲） ·
                      拿全年逐日残差算 · 来源：抛光残差
                    </span>
                  </div>
                  <AnaEChart v-if="labDoyPts.length" :option="labDoyOpt" :height="250" />
                  <div v-else class="pma-note">没有可画的残差点，这一块不画。</div>
                  <div v-if="labAmp" class="pma-fn">
                    {{ labDoyPts.length }} 个点。这张图看的是残差里还剩不剩年周期形状；
                    振幅粗测 = 四个季度的残差均值极差，最大的一栋是 {{ labAmp.name }}，{{ labAmp.amp.toFixed(3) }}（对数）。
                  </div>
                </div>

                <!-- L4 块自助零分布 + 观测值 -->
                <div class="av2-card av2-s6 pma-lab" data-lab="L4">
                  <div class="av2-card-h">
                    <span class="t">块自助零分布<template v-if="lab.nullDist"> · {{ lab.nullDist.name }}</template></span>
                    <span class="pma-per win">窗口 {{ lab.window.label }}<template v-if="lab.window.fellBack">（当段样本不足，退回）</template></span>
                    <span class="hint">
                      直方图 + 观测值竖线 · 横轴窗口均值（对数，无量纲），纵轴落入该桶的重采样次数 ·
                      观测值取最后 30 天窗口，零分布重采样全年残差 · 来源：块自助 B=999、块长 14 天
                    </span>
                  </div>
                  <AnaEChart v-if="lab.nullDist" :option="labNullOpt" :height="200" />
                  <div v-else class="pma-note">选中的栋没有可用窗口，画不出零分布。</div>
                  <div v-if="lab.nullDist" class="pma-fn">
                    跟着队列选中那栋走。这张图算的是**最后 30 天窗口均值**这一个量：
                    竖线是它的观测值，尾概率就标在竖线上（{{ (labNullTail ?? 0).toFixed(3) }}）。
                    重采样搬的是整块 14 天，不是单日 —— 块内的自相关被原样保留。
                    下面表里的 p 列算的是另一个量（变点检验），各有各的数。
                  </div>
                </div>

                <!-- L5 抛光收敛诊断 -->
                <div class="av2-card av2-s12 pma-lab" data-lab="L5">
                  <div class="av2-card-h">
                    <span class="t">抛光收敛诊断</span>
                    <span class="pma-per">整年</span>
                    <span class="hint">
                      文字读数，没有图 · 迭代次数单位为次，名次差单位为位，其余为栋名 ·
                      拿整份快照的抛光过程算 · 来源：两次中位数抛光（行优先 / 列优先），同一份有效日集合
                    </span>
                  </div>
                  <div class="pma-read">
                    <span>迭代次数 <b>{{ lab.convergence.iterations }}</b></span>
                    <span>收敛 <b>{{ lab.convergence.converged ? '是' : '否' }}</b></span>
                    <span>进矩阵 <b>{{ lab.convergence.names.length }}</b> 栋</span>
                    <span>名次差 &gt;1 位的栋 <b>{{ lab.convergence.flipped.length }}</b></span>
                    <span>σ 口径 <b>{{ lab.tests[0]?.sigmaHow ?? '—' }}</b></span>
                    <span>快照 <b>{{ lab.snapshotId }}</b></span>
                  </div>
                  <div class="pma-fn">
                    行优先与列优先各抛光一次，比同一栋的 α 名次。
                    <template v-if="lab.convergence.flipped.length">
                      换扫描顺序后名次挪动超过 1 位的栋：{{ lab.convergence.flipped.join('、') }}。
                    </template>
                    <template v-else>换扫描顺序后没有栋的名次挪动超过 1 位。</template>
                  </div>
                </div>

                <!-- L6 数据质量矩阵。手写 CSS Grid —— echartsBundle 没注册 heatmap / visualMap -->
                <div class="av2-card av2-s12 pma-lab" data-lab="L6">
                  <div class="av2-card-h">
                    <span class="t">数据质量矩阵</span>
                    <span class="pma-per win">{{ gran === 'month' ? segLabel : '整年' }}</span>
                    <span class="hint">
                      网格热力，一格 = 一栋一天，四态三色 + 未投产留空白 · 横轴首末抄表日之间的整段日历，纵轴各栋 ·
                      拿 {{ labQuality?.dates.length ?? 0 }} 天 × {{ labQuality?.rows.length ?? 0 }} 栋算 ·
                      来源：抄表记录与抛光矩阵的差集
                    </span>
                  </div>
                  <PvQualityGrid
                    v-if="labQuality"
                    :rows="labQuality.rows" :dates="labQuality.dates" @pick="pickLab"
                  />
                  <div v-else class="pma-note">这一年没有抄表日历，画不出矩阵。</div>
                  <div v-if="labQuality" class="pma-fn">
                    投产前的格子留空白，共 {{ labQuality.preN }} 格 —— 未到不是漏抄。
                    <template v-if="labQuality.outside.length">
                      {{ labQuality.outside.length }} 栋未装表或未录容量，压根没进抛光矩阵：整行的空是「不在模型里」，
                      不是「全年没抄表」——{{ labQuality.outside.join('、') }}。
                    </template>
                  </div>
                </div>

                <!-- L7 完整检验表 -->
                <div class="av2-card av2-s12 pma-lab" data-lab="L7">
                  <div class="av2-card-h">
                    <span class="t">完整检验表</span>
                    <span class="pma-per">α · N_eff · 变点 = 整年</span><span class="pma-per win">z = 窗口 {{ lab.window.label }}</span>
                    <span class="hint">
                      表格，{{ lab.tests.length }} 行不分页 · 每列的单位与口径印在列头下的小字里 ·
                      z 与零分布取最后 30 天窗口，α / N_eff / 变点取全年 · 来源：变点检验 + BH-FDR，逐栋
                    </span>
                  </div>
                  <PvLabTable v-if="lab.tests.length" :rows="lab.tests" @pick="pickLab" />
                  <div v-else class="pma-note">没有栋进入检验，这张表不画。</div>
                </div>
              </template>
              <div v-else class="av2-s12 pma-note">这一档的量还没算出来。</div>
            </template>

            <!-- ── 账面量 ── -->
            <template v-else>
              <div v-if="hasB7" class="av2-card av2-s12">
                <div class="av2-card-h">
                  <span class="t">消纳结构与损耗率</span>
                  <span class="hint">三段堆叠柱 = 自消纳 / 上网 / 损耗；折线 = 损耗率，副轴固定 0–{{ LOSS_MAX }}%</span>
                </div>
                <AnaEChart :option="b7Opt" :height="200" />
                <div class="pma-fn">
                  左轴 = {{ gran === 'month' ? '千度' : '万度' }}，右轴 = 损耗率百分比。
                  副轴按物理上可能的区间固定，不随数据自适应。
                  <template v-if="b7Over.length">
                    {{ b7Over.length }} 个刻度超出 {{ LOSS_MAX }}%，折线在那里断开，轴外三角标出数值。
                  </template>
                </div>
              </div>

              <div v-if="b8Rows.length" class="av2-card av2-s12">
                <div class="av2-card-h">
                  <span class="t">各栋消纳收益与上网收益（截至 {{ snap.dataThrough ?? '—' }} 累计）</span>
                  <span class="hint">横向分组柱，不是堆叠；这是累计量，不可与整月直接比</span>
                </div>
                <AnaEChart :option="b8Opt" :height="300" />
                <div class="pma-fn">
                  深 = 消纳收益（按录入时的单价快照），浅 = 上网收益（{{ GRID_PRICE }} 元/度）。
                  横轴 = 万元，柱长是累计绝对额，不是效率。
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>

      <div class="av2-s12 pma-foot">
        <span>本页数据快照 <code>{{ snap.id }}</code></span>
        <span>整年有效日 {{ snap.quality.okDays }} / {{ snap.quality.totalDays }} {{ '天' }}</span>
        <span v-if="cmp.mode.value === 'yoy'">同比：{{ snap.yoy.yearNote }}</span>
        <span>未列出 ≠ 没问题：这屏看不见遮挡、朝向、倾角造成的先天差异。</span>
        <button class="pma-lk" @click="goMeter">去分栋抄表 →</button>
      </div>
    </div>

    <!-- ── L3 单栋抽屉(§06.6)。三张图固定按年,底色高亮只画到数据截止日 ── -->
    <FPDrawer
      :open="drawerOpen"
      :title="selStation?.name ?? ''"
      :subtitle="selStation ? `整年在网 ${selStation.days} 天 · 年发电 ${wan(selStation.genYear)} 万度` : ''"
      icon="activity"
      :width="720"
      :fixedHeight="true"
      @close="closeDrawer"
    >
      <!-- 「上一栋 / 下一栋」按当前排序走队列(§06.6)。三个组用的是同一把排序尺子,
           所以这里走排好序的扁平表,不在组边界上停 -->
      <div class="pma-nav">
        <button class="pma-lk" @click="stepStation(-1)">← 上一栋</button>
        <span>按队列排序（出范围刻度数 → 最大偏离）</span>
        <button class="pma-lk" @click="stepStation(1)">下一栋 →</button>
      </div>

      <div v-if="!detail" class="pma-note">这栋在网不足 8 天，画不出逐日曲线。</div>
      <div v-else class="pma-drawer">
        <div class="pma-fn">
          下面三张固定按**整年逐日**，与上面选的期间无关；灰底 = 当前期间段，只画到数据截止日。
        </div>

        <div v-if="detail.spline.length">
          <div class="av2-card-h">
            <span class="t">这一年的偏离与水平变化</span>
            <span class="hint">淡点 = 逐日相对自身水平；实线 = 样条拟合；淡区 = 趋势的估计范围（数据稀的时段自然张开）</span>
          </div>
          <AnaEChart :option="b9Opt" :height="300" />
          <div class="pma-fn">
            纵轴 = 相对自身水平（对数）。虚竖线 = 这天前后水平变了
            <template v-if="detail.cpDate">：{{ detail.cpDate }}</template>
            <template v-else>：本年扫不出</template>
            <template v-if="detail.cpLo && detail.cpHi">，位置区间 {{ detail.cpLo }} ~ {{ detail.cpHi }}（是一段区间，不是精确到某天）</template>
          </div>
        </div>
        <div v-else class="pma-note">这栋可用的逐日残差不够拟合样条，这一块不画。</div>

        <div class="av2-card-h">
          <span class="t">逐日偏离与两道范围线</span>
          <span class="hint">中心线 + 2 倍波动（虚线）与 3 倍波动（点线）；灰底 = 这两道线的估计窗口</span>
        </div>
        <AnaEChart :option="b10Opt" :height="250" />
        <div class="pma-fn">
          估计窗口 {{ detail.limitFrom ?? '—' }} ~ {{ detail.limitTo ?? '—' }} ·
          中心线 {{ detail.center.toFixed(3) }} · 一倍波动 {{ detail.sigma.toFixed(3) }}。
          这两道线来自变点之前的历史，与本段无关，所以月中照常有线。
        </div>

        <div class="av2-card-h">
          <span class="t">跟全园一起涨落的程度</span>
          <span class="hint">逐月一个点，淡带 = ±1 个标准误；虚线 = 与全园同步（1）</span>
        </div>
        <AnaEChart v-if="b11.rows.length" :option="b11Opt" :height="170" />
        <div v-else class="pma-note">这栋没有样本够的月，这一块不画。</div>
        <div v-if="b11.skipped > 0" class="pma-fn">{{ b11.skipped }} 个月样本不足，不画点。</div>

        <div class="av2-card-h">
          <span class="t">逐刻度明细</span>
          <span class="hint">未到的刻度不出现；漏抄的刻度出现但值为空</span>
        </div>
        <div class="pma-tw">
          <table class="pma-tb">
            <thead>
              <tr><th>刻度</th><th class="n">比值</th><th class="n">偏离</th><th>位置</th><th>记录</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in b12" :key="i" :class="{ miss: r.st === 'missing' }">
                <td>{{ r.label }}</td>
                <td class="n">{{ r.v == null ? '' : r.v.toFixed(3) }}</td>
                <td class="n">
                  {{ r.v != null && selRow?.center ? ((r.v / selRow.center - 1) * 100).toFixed(1) + '%' : '' }}
                </td>
                <td>{{ r.st === 'missing' ? '' : outText(r.o) }}</td>
                <td>{{ r.st === 'missing' ? '漏抄' : '已抄' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </FPDrawer>
  </AnaShell>
</template>

<style scoped>
.pma-hold { display: flex; align-items: center; justify-content: center; min-height: 240px; }

/* ── L0 · B0 指标卡:--surface-sunken 实底 + 3px 左竖条,无边框无卡头。
      0 命中时主数转灰,**高度恒 76px 不塌**,右侧新鲜度照常(§08 v3-9) ── */
.pma-b0 {
  height: 76px; box-sizing: border-box;
  display: grid; grid-template-columns: auto auto auto auto minmax(0, 1fr);
  align-items: center; gap: 0 30px;
  background: var(--surface-sunken);
  border-left: 3px solid var(--hue-orange);
  border-radius: 8px; padding: 0 16px;
}
.pma-b0.quiet { border-left-color: var(--ink-300); }
.pma-b0 .k { display: flex; flex-direction: column; gap: 3px; }
.pma-b0 .lab { font-size: var(--fs-micro); color: var(--text-muted); }
/* 全屏唯一的 26px(§06.0 排他规则) */
.pma-b0 .big {
  font-size: 26px; line-height: 1; font-weight: var(--fw-semibold);
  font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--hue-orange);
}
.pma-b0.quiet .big { color: var(--text-muted); }
.pma-b0 .mid {
  font-size: 17px; line-height: 1; font-weight: var(--fw-semibold);
  font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary);
}
.pma-b0 .fresh {
  text-align: right; font-size: 11px; line-height: 1.55;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-muted);
}
.pma-b0 .fresh code { font-family: var(--font-mono); }

/* ── L1 主卡:268px 队列 + 单栋大图 ──
   首屏硬预算 463px(§06.1)全靠这张卡的垂直余量,所以卡壳逐项压过:
   padding 10→8、卡头下沿 8→4、分隔线上下 8/6→5/4。压的是留白,一个内容都没删。 */
.pma-main { padding-top: 8px; padding-bottom: 8px; }
.pma-main .av2-card-h { margin-bottom: 4px; }
.pma-md { display: grid; grid-template-columns: 268px minmax(0, 1fr); gap: 12px; align-items: start; }
.pma-div { border-top: 1px solid var(--divider); margin: 5px 0 4px; }

/* B2 判据脚:单行只读回显,mono 11px */
.pma-b2 {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 14px;
  font-family: var(--font-mono); font-size: 11px; line-height: 1.45; color: var(--text-muted);
}
.pma-b2 .off { text-decoration: line-through; color: var(--ink-300); }

.pma-seg { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }
.pma-seghint { font-size: 11px; line-height: 1.5; color: var(--text-muted); }
/* 期间徽标:工作台里同时有两个期间(整年 / 观测窗口),每块必须自己说清吃的是哪个 ——
   spec 对抽屉三张图早有「本块固定按年」这条要求,工作台当初漏了。
   用户看 8 月时,原来 L4/L7 的观测算的是 12 月(数据截止 12-31 的最后 30 天),屏上一个字没说。 */
.pma-per {
  font-family: var(--font-mono); font-size: 10px; line-height: 1.4;
  color: var(--text-muted); border: 1px solid var(--border-subtle);
  border-radius: 2px; padding: 0 4px; margin-left: 6px; white-space: nowrap;
}
.pma-per.win { color: var(--hue-blue); border-color: var(--hue-blue); }

/* 切档不换卡,容器高度按最高段钉死 —— 绝对水平 / 账面量 两段都是 250+8+250 的内容加卡壳(§06.5)。
   高级分析那一档七块加起来 1400px 上下,**不把 min-height 抬到它** —— 那会给另外两档垫出
   八百像素空白,比切档时的跳动更难看。这条钉的是两个同量级的档之间不跳;
   点进「高级分析」本来就是要更多内容,那次变高是用户自己按出来的。 */
.pma-sec { min-height: 636px; }

/* 高级分析七块的测试/定位钩子。视觉上不加任何东西 —— 卡壳走 av2-card。 */
.pma-lab { min-width: 0; }

/* L5 抛光收敛:文字读数,不是图。mono 对齐,数字提到主色。 */
.pma-read {
  display: flex; flex-wrap: wrap; gap: 6px 24px; align-items: baseline;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  font-size: 11px; line-height: 1.5; color: var(--text-muted);
}
.pma-read b { font-weight: var(--fw-semibold); color: var(--text-primary); }

/* B5 的 13 条 bullet 一行 30px,超过卡高就在卡内滚,不撑破那一行的高度 */
.pma-scroll { max-height: 250px; overflow-y: auto; }
/* B6 必须正方:grid 左右 46/14、上下 14/34,250 高的画布里绘图区正好 202×202 */
.pma-sq { max-width: 262px; }

.pma-note {
  font-size: 11px; color: var(--text-secondary);
  background: var(--surface-sunken); border-radius: 4px;
  padding: 8px 10px; line-height: 1.6;
}
.pma-fn { font-size: 11px; color: var(--text-muted); line-height: 1.6; margin-top: 6px; }

.pma-nav {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 6px;
}
.pma-drawer { display: flex; flex-direction: column; gap: 4px; }
.pma-tw { max-height: 256px; overflow-y: auto; }
.pma-tb { width: 100%; border-collapse: collapse; font-size: var(--fs-micro); }
.pma-tb th {
  position: sticky; top: 0; background: var(--surface-white);
  text-align: left; font-weight: var(--fw-regular); color: var(--text-muted);
  height: 28px; border-bottom: 1px solid var(--divider);
}
.pma-tb td { height: 32px; color: var(--text-primary); border-bottom: 1px solid var(--divider); }
.pma-tb .n {
  text-align: right; padding-right: 14px;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
}
.pma-tb tr.miss td { color: var(--text-muted); }

.pma-foot {
  display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline;
  font-size: var(--fs-micro); color: var(--text-muted); padding-top: 4px;
}
.pma-foot code { font-family: var(--font-mono); }
.pma-lk {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--hue-blue); font-size: var(--fs-micro); white-space: nowrap;
}
.av2-card-h .pma-lk { margin-left: auto; }

/* ≤1100:队列从大图左侧改到上方(§06.7) */
@media (max-width: 1100px) {
  .pma-md { grid-template-columns: minmax(0, 1fr); }
  .pma-sec { min-height: 0; }
}
@media (max-width: 600px) {
  .pma-b0 {
    height: auto; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px; padding: 12px 14px;
  }
  .pma-b0 .fresh { grid-column: 1 / -1; text-align: left; }
}
</style>
