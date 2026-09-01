<script setup lang="ts">
// 光伏分栋分析(pv-meter-analysis)— PV-ANALYSIS-SPEC §06。
//
// **一个仪器,两档缩放。** 期间切「按月 / 按年」,屏跟着换刻度:
//   按月段 → x = 当月 1…31 日,一个点 = 当日。数据是逐日进来的,异常要在几天内看见。
//   按年段 → x = 12 个月,一个点 = 当月。回看用。
// **模型永远吃全年,只有「画哪一段」跟着期间变** —— 模型要历史,屏要新鲜。
//
// **信息结构:结论 → 定位 → 佐证。** 这是监控屏不是陈列屏 —— 用户的作业是
// 「录了数据几天内看出断崖或波动」,所以首屏必须先回答「有没有、是哪栋」,
// 再给定位用的看板;校准图与消纳图是佐证,收进分段里,不与看板并排等权。
//   ① 结论条:出范围的栋数(大数字)+ 可点的栋名 + 那几句事实。0 栋时整条转静音。
//   ② 看板:出范围的栋**置顶 + 底色 + 左侧色条**;其余折叠成一行;未投产缩成一句话。
//      突出**不靠加行高** —— 所有行共用同一段纵轴是这仪器的立身之本,
//      行高不齐会悄悄毁掉横向可比性。
//   ③ 三段 Segmented:异常定位(默认)/ 效率校准 / 消纳收益。九张卡不再一根直筒往下滚。
//
// 铁律:一份数据、一次计算、一个 snapshot id,页脚显示那个 id。
//
// ⚠ 文案规范(§05):**屏只说明可视化在做什么,不输出解释性结论。**
//   能写:图种 / 坐标轴含义与单位 / 范围是拿哪一段估的 / 数据来源与条数 / 判据线画在哪。
//   不能写:诊断结论、成因归因、建议动作、严重度判词、反事实金额,以及 p / q 这类统计量。
//
// ⚠ 看板用**内联 SVG**,不用 ECharts:多行小图要共用同一段纵轴,自己算刻度比配 N 套 grid
//   更好保证;而且 bundle 里没注册 heatmap/custom,jsdom 又测不出漏注册,手写还能直接数节点。
//   viewBox 宽取**实测像素宽**(useWidth),不用 preserveAspectRatio="none" ——
//   非等比拉伸会把出范围的圆点抻成横条,而那些点正是这张图唯一要人看见的东西。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Segmented from '@/components/ds/Segmented.vue'
import { useWidth } from '@/components/ana/useWidth'
import { usePeriod } from '@/analysis/usePeriod'
import { useCompare, type CompareMode } from '@/analysis/useCompare'
import { fnum } from '@/components/ana/anaFmt'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import {
  buildSnapshot, buildDetail, DEFAULT_CRITERIA,
  type AnaSnapshot, type BoardRow, type Criteria, type SnapshotInput,
} from './pvMeterAna.logic'

const CMP: CompareMode[] = ['yoy']
const GRID_PRICE = 0.391   // 上网标杆价(脱硫煤)

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

/** 判据线来自计费参数 —— 屏上写的必须是**当前生效的那个数**,取不到就回落默认,不显空 */
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

// 取的永远是**整年**:看板只画选中那段,但正常范围要拿段外的数据来估
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

const segLabel = computed(() => (gran.value === 'year' ? `${year.value} 年` : `${year.value} 年 ${month.value} 月`))
const unit = computed(() => (gran.value === 'month' ? '天' : '个月'))
const wan = (v: number) => fnum(v / 10000, 1)

// ── 分段:一次只看一件事 ───────────────────────────────────────────────
// 默认停在「异常定位」—— 这屏的作业是监控,校准与消纳是佐证,不与看板并排等权
const SECTIONS = [
  { value: 'find', label: '异常定位' },
  { value: 'calib', label: '效率校准' },
  { value: 'ledger', label: '消纳收益' },
]
const section = ref('find')

// ── 看板 ─────────────────────────────────────────────────────────────
// 日抄与月抄**分开两组**:N=12 与 N=244 的可信度差一个量级,并排放会让人以为一样准
const dailyRows = computed<BoardRow[]>(() => (snap.value?.board ?? []).filter(b => b.cadence === 'daily'))
const monthlyRows = computed<BoardRow[]>(() => (snap.value?.board ?? []).filter(b => b.cadence === 'monthly'))

/** 这一段出范围的刻度数。**这是原始事实,不是发现** —— 见下面 hitIds */
const outN = (b: BoardRow) => (b.bornBySeg ? b.out.reduce((n: number, v) => n + (v ? 1 : 0), 0) : 0)

// 一个屏**一个门槛**:什么算「发现」由 buildFacts 那条判据线说了算,不是「出过一次带」。
// ±2σ 天然双侧漏出 ~4.6%,31 天期望 1.4 天 —— 拿「出过带」提级,健康的栋会几乎全部标黄,
// 一堆等权的黄行和一堆等权的灰行一样没用。图上照实标点,提级只认判据线。
// ledger / yield 是**整年**口径的事实,不提这一段的看板行,但事实句照列。
const SEG_KINDS = new Set(['run', 'scatter', 'thin'])
const hitIds = computed(() => new Set(
  (snap.value?.facts ?? []).filter(f => SEG_KINDS.has(f.kind)).map(f => f.stationId)))

const bornDaily = computed(() => dailyRows.value.filter(b => b.bornBySeg))
/** 判据线命中的置顶,按出范围的刻度数从多到少 */
const hitRows = computed(() => bornDaily.value.filter(b => hitIds.value.has(b.id)).sort((a, b) => outN(b) - outN(a)))
const okRows = computed(() => bornDaily.value.filter(b => !hitIds.value.has(b.id)))
const unbornNames = computed(() => dailyRows.value.filter(b => !b.bornBySeg).map(b => b.name))
const okOpen = ref(false)
const monthOpen = ref(false)
// 换段就收回折叠 —— 上一段展开过不代表这一段也想看全部
watch([() => snap.value?.id], () => { okOpen.value = false; monthOpen.value = false })

// viewBox 宽 = 实测像素宽,圆点才是圆的(见顶部注释)
const { el: boardEl, width: boardW } = useWidth(560)
const BOX = computed(() => ({ w: Math.max(160, Math.round(boardW.value)), h: 40, pad: 4 }))

/** 共用同一段纵轴 —— 各自缩放就没法横着扫;未投产的行不参与,免得把轴撑开 */
const bdRange = computed(() => {
  const vs: number[] = []
  for (const b of snap.value?.board ?? []) {
    if (!b.bornBySeg) continue
    for (const v of b.ratio) if (v != null) vs.push(v)
    if (b.lo != null) vs.push(b.lo)
    if (b.hi != null) vs.push(b.hi)
  }
  if (!vs.length) return { lo: 0, hi: 2 }
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const pad = Math.max(0.05, (hi - lo) * 0.1)
  return { lo: lo - pad, hi: hi + pad }
})
function bd(b: BoardRow) {
  const s = snap.value
  const { w, h, pad } = BOX.value
  const { lo, hi } = bdRange.value
  const n = s?.ticks.length ?? 1
  const X = (i: number) => pad + (i / Math.max(1, n - 1)) * (w - pad * 2)
  const Y = (v: number) => h - pad - ((v - lo) / Math.max(1e-9, hi - lo)) * (h - pad * 2)
  const pts = b.ratio.map((v, i) => (v == null ? null : { x: X(i), y: Y(v), out: b.out[i] ?? 0, i }))
  const seen = pts.filter((p): p is NonNullable<typeof p> => p != null)
  // 缺抄的刻度**断开**,不连线:插值会被当成观测
  const segs: string[] = []
  let cur: string[] = []
  for (const p of pts) {
    if (p == null) { if (cur.length > 1) segs.push(cur.join(' ')); cur = []; continue }
    cur.push(`${cur.length ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  }
  if (cur.length > 1) segs.push(cur.join(' '))
  return {
    lines: segs,
    band: b.lo != null && b.hi != null
      ? { y: Y(b.hi), h: Math.max(1, Y(b.lo) - Y(b.hi)) }
      : null,
    center: b.center != null ? Y(b.center) : null,
    dots: seen.filter(p => p.out !== 0),
    n: seen.length,
  }
}
/** 刻度轴只标首 / 中 / 末 —— 31 个日期全铺出来就成了一条灰噪声 */
const axisMarks = computed(() => {
  const ls = snap.value?.tickLabels ?? []
  if (ls.length < 2) return ls
  return [ls[0], ls[Math.floor((ls.length - 1) / 2)], ls[ls.length - 1]]
})

// ── L2 绝对水平 ───────────────────────────────────────────────────────
// ECharts option 是纯 JSON,**不能引用 CSS 变量**,颜色只能写字面值
const anchorPerTick = computed(() => {
  const s = snap.value
  if (!s) return 0
  return +(s.crit.anchorHours / (s.gran === 'month' ? 365 : 12)).toFixed(2)
})
const a1Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 16, top: 20, bottom: 26 },
    xAxis: { type: 'category', data: s.tickLabels },
    yAxis: { type: 'value', name: '小时', nameTextStyle: { fontSize: 10 } },
    series: [{
      type: 'line', symbol: 'circle', symbolSize: 5, connectNulls: false,
      lineStyle: { width: 2.2, color: '#1F5FBF' }, itemStyle: { color: '#1F5FBF' },
      data: s.ledger.yield.map(v => (v == null ? null : +v.toFixed(2))),
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: '#8A8A85', type: 'dashed', width: 1.4 },
        label: { formatter: `锚点摊到每${s.gran === 'month' ? '天' : '月'} ${anchorPerTick.value}`, fontSize: 10, position: 'insideEndTop' },
        data: [{ yAxis: anchorPerTick.value }],
      },
    }],
  }
})

const t1Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const pts = s.stations
    .filter(x => x.metered && x.theoKwp != null && x.capKwp != null)
    .map(x => ({ name: x.name, value: [+x.theoKwp!.toFixed(1), +x.capKwp!.toFixed(1)] }))
  const hi = +(Math.max(10, ...pts.flatMap(p => p.value)) * 1.1).toFixed(0)
  const ray = (k: number) => [[0, 0], [hi, +(hi * k).toFixed(1)]]
  const dash = { color: '#C7C7C2', width: 1, type: 'dashed' as const }
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { data?: { name?: string; value?: number[] } }) =>
        p.data?.name ? `${p.data.name}<br/>理论 ${p.data.value![0]} kWp<br/>台账 ${p.data.value![1]} kWp` : '',
    },
    grid: { left: 56, right: 16, top: 16, bottom: 34 },
    xAxis: { type: 'value', name: '理论装机 kWp', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 10 }, min: 0, max: hi },
    yAxis: { type: 'value', name: '台账 kWp', nameTextStyle: { fontSize: 10 }, min: 0, max: hi },
    series: [
      { type: 'line', symbol: 'none', silent: true, lineStyle: { color: '#1F5FBF', width: 1.4 }, data: ray(1) },
      { type: 'line', symbol: 'none', silent: true, lineStyle: dash, data: ray(1 + s.crit.ledger) },
      { type: 'line', symbol: 'none', silent: true, lineStyle: dash, data: ray(1 - s.crit.ledger) },
      { type: 'scatter', symbolSize: 11, itemStyle: { color: '#2C6A4A' }, data: pts },
    ],
  }
})

// ── L3 账面量(跟着期间走) ─────────────────────────────────────────────
const r1Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const k = s.gran === 'month' ? 1000 : 10000     // 日粒度用千度,月粒度用万度
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['自消纳', '上网', '损耗', '损耗率'] },
    grid: { left: 52, right: 46, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: s.tickLabels },
    yAxis: [
      { type: 'value', name: s.gran === 'month' ? '千度' : '万度', nameTextStyle: { fontSize: 10 } },
      // 副轴范围**固定** 0–3%,不随数据自适应:两个 y 轴的刻度能造出任意的视觉相关性
      { type: 'value', name: '%', min: 0, max: 3, nameTextStyle: { fontSize: 10 } },
    ],
    series: [
      { name: '自消纳', type: 'bar', stack: 'x', barMaxWidth: 22, itemStyle: { color: '#1F5FBF' }, data: s.ledger.self.map(v => +(v / k).toFixed(2)) },
      { name: '上网', type: 'bar', stack: 'x', itemStyle: { color: '#9DC3E6' }, data: s.ledger.grid.map(v => +(v / k).toFixed(2)) },
      { name: '损耗', type: 'bar', stack: 'x', itemStyle: { color: '#D8D8D4' }, data: s.ledger.loss.map(v => +(v / k).toFixed(2)) },
      {
        name: '损耗率', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 4,
        lineStyle: { width: 1.6, color: '#8A5800' }, itemStyle: { color: '#8A5800' },
        data: s.ledger.lossPct.map(v => +(v * 100).toFixed(2)),
      },
    ],
  }
})

const r2Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const rs = s.stations.filter(x => x.metered)
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['消纳收益', '上网收益'] },
    grid: { left: 52, right: 16, top: 30, bottom: 48 },
    xAxis: { type: 'category', data: rs.map(x => x.name), axisLabel: { interval: 0, rotate: 30, fontSize: 10 } },
    yAxis: { type: 'value', name: '万元', nameTextStyle: { fontSize: 10 } },
    series: [
      { name: '消纳收益', type: 'bar', barMaxWidth: 14, itemStyle: { color: '#1F5FBF' }, data: rs.map(x => +(x.revSelf / 10000).toFixed(2)) },
      { name: '上网收益', type: 'bar', barMaxWidth: 14, itemStyle: { color: '#9DC3E6' }, data: rs.map(x => +(x.revGrid / 10000).toFixed(2)) },
    ],
  }
})

const r3Rows = computed(() =>
  (snap.value?.stations ?? [])
    .filter(x => x.metered && x.yieldHours != null)
    .slice().sort((a, b) => (a.yieldHours ?? 0) - (b.yieldHours ?? 0)))

const r3Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const rs = r3Rows.value
  const color = (p: { dataIndex: number }) =>
    rs[p.dataIndex].phase === 1 ? '#1F5FBF' : rs[p.dataIndex].phase === 2 ? '#4E8FD0' : '#9DC3E6'
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 88, right: 40, top: 12, bottom: 32 },
    xAxis: { type: 'value', name: '小时', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 10 } },
    yAxis: { type: 'category', data: rs.map(x => x.name), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar', barMaxWidth: 14, itemStyle: { color },
      data: rs.map(x => +x.yieldHours!.toFixed(0)),
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: '#8A8A85', type: 'dashed', width: 1.4 },
        label: { formatter: `锚点 ${s.crit.anchorHours}`, fontSize: 10 },
        data: [{ xAxis: s.crit.anchorHours }],
      },
    }],
  }
})

const r4Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const k = s.gran === 'month' ? 1000 : 10000
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 16, top: 16, bottom: 26 },
    xAxis: { type: 'category', data: s.tickLabels },
    yAxis: { type: 'value', name: s.gran === 'month' ? '千度' : '万度', nameTextStyle: { fontSize: 10 } },
    series: [{
      type: 'line', symbol: 'circle', symbolSize: 4, areaStyle: { color: '#DCE9F2' },
      lineStyle: { width: 2.2, color: '#1F5FBF' }, itemStyle: { color: '#1F5FBF' },
      data: s.ledger.self.map((v, i) => +((v + s.ledger.grid[i] + s.ledger.loss[i]) / k).toFixed(2)),
    }],
  }
})

// ── L4 M3 小倍数(逐月斜率,与期间无关 —— 它本来就是逐月的) ─────────────
const M3 = { w: 132, h: 46, pad: 4 }
const m3Range = computed(() => {
  const vs: number[] = []
  for (const [, arr] of snap.value?.slopes ?? []) for (const r of arr) if (isFinite(r.beta)) vs.push(r.beta)
  if (!vs.length) return { lo: -0.1, hi: 2.1 }
  return { lo: Math.min(0, ...vs) - 0.1, hi: Math.max(2, ...vs) + 0.1 }
})
function m3Path(id: number) {
  const s = snap.value
  const { lo, hi } = m3Range.value
  const Y = (v: number) => M3.h - M3.pad - ((v - lo) / Math.max(1e-9, hi - lo)) * (M3.h - M3.pad * 2)
  if (!s) return { line: '', band: '', ref: Y(1), n: 0 }
  const rows = s.slopes.get(id) ?? []
  const cols = [...new Set(rows.map(r => r.key))].sort()
  const X = (c: number) => M3.pad + (c / Math.max(1, cols.length - 1)) * (M3.w - M3.pad * 2)
  const pts: { x: number; y: number; lo: number; hi: number }[] = []
  cols.forEach((m, c) => {
    const r = rows.find(x => x.key === m)
    if (!r || !isFinite(r.beta)) return
    const se = isFinite(r.se) ? Math.min(r.se, hi - lo) : hi - lo
    pts.push({ x: X(c), y: Y(r.beta), lo: Y(r.beta - se), hi: Y(r.beta + se) })
  })
  if (!pts.length) return { line: '', band: '', ref: Y(1), n: 0 }
  return {
    line: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    band: [
      ...pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.hi.toFixed(1)}`),
      ...[...pts].reverse().map(p => `L${p.x.toFixed(1)},${p.lo.toFixed(1)}`),
      'Z',
    ].join(' '),
    ref: Y(1),
    n: pts.length,
  }
}

// ── L5 单栋抽屉 ───────────────────────────────────────────────────────
const selId = ref<number | null>(null)
const sel = computed(() => snap.value?.stations.find(s => s.id === selId.value) ?? null)
const detail = computed(() => (snap.value && selId.value != null ? buildDetail(snap.value, selId.value) : null))
function pick(id: number) { selId.value = selId.value === id ? null : id }
watch(snap, () => { if (!sel.value) selId.value = null })
onMounted(() => {
  const m = /^#s(\d+)$/.exec(location.hash)
  if (m) selId.value = Number(m[1])
})

const s2Opt = computed<object>(() => {
  const d = detail.value
  if (!d || !d.spline.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 56, right: 16, top: 16, bottom: 26 },
    xAxis: { type: 'category', data: d.spline.map(x => x.date.slice(5)) },
    yAxis: { type: 'value', name: '相对自身水平（对数）', nameTextStyle: { fontSize: 10 }, scale: true },
    series: [
      { type: 'line', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, data: d.spline.map(x => +x.lo.toFixed(4)) },
      {
        type: 'line', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 },
        areaStyle: { color: '#DCE9F2' }, data: d.spline.map(x => +(x.hi - x.lo).toFixed(4)),
      },
      { type: 'scatter', symbolSize: 3, itemStyle: { color: '#C7C7C2' }, data: d.resid.map(v => +v.toFixed(4)) },
      { type: 'line', symbol: 'none', lineStyle: { width: 2, color: '#1F5FBF' }, data: d.spline.map(x => +x.fit.toFixed(4)) },
    ],
  }
})

const s3Opt = computed<object>(() => {
  const d = detail.value
  if (!d) return {}
  const cats = d.dates.map(x => x.slice(5))
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 56, right: 16, top: 16, bottom: 26 },
    // markLine / markArea 不参与轴范围计算,**必须手动设 min/max**,否则超范围的会被静默裁掉
    xAxis: { type: 'category', data: cats, min: 0, max: cats.length - 1 },
    yAxis: { type: 'value', name: '相对自身水平（对数）', nameTextStyle: { fontSize: 10 }, scale: true },
    series: [{
      type: 'line', symbol: 'none', lineStyle: { width: 1.2, color: '#1F5FBF' },
      data: d.resid.map(v => +v.toFixed(4)),
      markArea: d.cpLo && d.cpHi ? {
        silent: true, itemStyle: { color: 'rgba(31,95,191,0.10)' },
        data: [[{ xAxis: d.cpLo.slice(5) }, { xAxis: d.cpHi.slice(5) }]],
      } : undefined,
      markLine: d.cpDate ? {
        silent: true, symbol: 'none',
        lineStyle: { color: '#A32720', width: 1.6 },
        label: { formatter: d.cpDate.slice(5), fontSize: 10 },
        data: [{ xAxis: d.cpDate.slice(5) }],
      } : undefined,
    }],
  }
})

const m4Opt = computed<object>(() => {
  const d = detail.value
  if (!d) return {}
  const cats = d.dates.map(x => x.slice(5))
  const lim = (k: number) => +(d.center + k * d.sigma).toFixed(4)
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 56, right: 16, top: 16, bottom: 26 },
    xAxis: { type: 'category', data: cats, min: 0, max: cats.length - 1 },
    yAxis: { type: 'value', name: '相对自身水平（对数）', nameTextStyle: { fontSize: 10 }, scale: true },
    series: [{
      type: 'scatter', symbolSize: 3, itemStyle: { color: '#3E4E4D' },
      data: d.resid.map(v => +v.toFixed(4)),
      markArea: d.limitFrom && d.limitTo ? {
        silent: true, itemStyle: { color: 'rgba(138,138,133,0.10)' },
        data: [[{ xAxis: d.limitFrom.slice(5) }, { xAxis: d.limitTo.slice(5) }]],
      } : undefined,
      markLine: {
        silent: true, symbol: 'none', label: { fontSize: 10 },
        data: [
          { yAxis: +d.center.toFixed(4), lineStyle: { color: '#1F5FBF', width: 1.4 } },
          { yAxis: lim(2), lineStyle: { color: '#8A5800', type: 'dashed', width: 1 } },
          { yAxis: lim(-2), lineStyle: { color: '#8A5800', type: 'dashed', width: 1 } },
          { yAxis: lim(3), lineStyle: { color: '#A32720', type: 'dashed', width: 1 } },
          { yAxis: lim(-3), lineStyle: { color: '#A32720', type: 'dashed', width: 1 } },
        ],
      },
    }],
  }
})

function goMeter(): void {
  tabs.openFresh('pv-income', { pin: true })
  void router.push('/pv-income')
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
      <!-- ══ 结论条:首屏唯一必读的东西 ══════════════════════════════ -->
      <div class="av2-s12 pma-lede" :class="{ quiet: !hitRows.length }">
        <div class="n">{{ hitRows.length }}</div>
        <div class="txt">
          <div class="hd">栋在 {{ segLabel }} 出过自己的正常范围</div>
          <div class="sub">
            {{ bornDaily.length }} 栋在网 · 抄表 {{ readings.length }} 条（模型吃整年，画的是这一段）
            <template v-if="unbornNames.length"> · {{ unbornNames.length }} 栋未投产</template>
          </div>
        </div>
        <div v-if="hitRows.length" class="chips">
          <button v-for="b in hitRows" :key="b.id" class="chip" @click="pick(b.id)">
            {{ b.name }}<span class="c">{{ outN(b) }}</span>
          </button>
        </div>
      </div>

      <!-- 事实句紧跟结论条,不再单独占一张卡 -->
      <ul v-if="snap.facts.length" class="av2-s12 pma-facts">
        <li v-for="(f, i) in snap.facts" :key="i" :class="f.kind" @click="pick(f.stationId)">
          <span class="st">{{ f.station }}</span>
          <span class="tx">{{ f.text }}</span>
        </li>
      </ul>

      <div class="av2-s12 pma-seg">
        <Segmented v-model="section" :options="SECTIONS" size="sm" />
      </div>

      <!-- ══ 异常定位 ═══════════════════════════════════════════════ -->
      <template v-if="section === 'find'">
        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">逐{{ gran === 'month' ? '日' : '月' }}看板</span>
            <span class="hint">
              每栋一行：线 = 这栋当{{ gran === 'month' ? '日' : '月' }}发电 ÷ 全园同{{ gran === 'month' ? '日' : '月' }}中位
            </span>
          </div>

          <div ref="boardEl" class="pma-board">
            <template v-if="bornDaily.length">
              <!-- 出范围的置顶。突出靠底色 + 左侧色条,**不动行高** ——
                   所有行共用同一段纵轴,行高不齐就悄悄毁了横向可比性 -->
              <div v-for="b in hitRows" :key="b.id" class="pma-brow hit" @click="pick(b.id)">
                <div class="nm" :title="b.name">{{ b.name }}</div>
                <svg :viewBox="`0 0 ${BOX.w} ${BOX.h}`">
                  <rect v-if="bd(b).band" x="0" :y="bd(b).band!.y" :width="BOX.w" :height="bd(b).band!.h" class="band" />
                  <line v-if="bd(b).center != null" x1="0" :y1="bd(b).center!" :x2="BOX.w" :y2="bd(b).center!" class="ctr" />
                  <path v-for="(d, k) in bd(b).lines" :key="k" :d="d" class="ln" />
                  <circle v-for="(p, k) in bd(b).dots" :key="'o' + k" :cx="p.x" :cy="p.y" r="2.6"
                          :class="p.out < 0 ? 'lo' : 'hi'" />
                </svg>
                <div class="tail">{{ outN(b) }} {{ unit }}在外</div>
              </div>

              <!-- 其余的默认折起来:12 行正常曲线和 1 行异常曲线长得一样,
                   全铺出来等于把唯一的信号埋进 12 行噪声里 -->
              <template v-if="okRows.length">
                <button class="pma-fold" @click="okOpen = !okOpen">
                  <span class="ar" :class="{ open: okOpen }">▸</span>
                  其余 {{ okRows.length }} 栋没到判据线
                  <span class="mini">
                    <svg v-for="b in okRows.slice(0, 14)" :key="b.id" viewBox="0 0 40 14">
                      <path v-for="(d, k) in [bd(b).lines.join(' ')]" :key="k"
                            :d="d" class="ln" vector-effect="non-scaling-stroke"
                            :transform="`scale(${40 / BOX.w},${14 / BOX.h})`" />
                    </svg>
                  </span>
                </button>
                <div
                  v-for="b in (okOpen ? okRows : [])" :key="b.id"
                  class="pma-brow" @click="pick(b.id)"
                >
                  <div class="nm" :title="b.name">{{ b.name }}</div>
                  <svg :viewBox="`0 0 ${BOX.w} ${BOX.h}`">
                    <rect v-if="bd(b).band" x="0" :y="bd(b).band!.y" :width="BOX.w" :height="bd(b).band!.h" class="band" />
                    <line v-if="bd(b).center != null" x1="0" :y1="bd(b).center!" :x2="BOX.w" :y2="bd(b).center!" class="ctr" />
                    <path v-for="(d, k) in bd(b).lines" :key="k" :d="d" class="ln" />
                  </svg>
                  <div class="tail">{{ bd(b).n }}/{{ snap.ticks.length }}</div>
                </div>
              </template>

              <div class="pma-bax">
                <span v-for="(l, i) in axisMarks" :key="i">{{ l }}</span>
              </div>
            </template>
            <div v-else class="pma-note-line">这一段没有已投产、按日抄表的楼栋。</div>
          </div>

          <!-- 未投产的不占行:它没数据不是漏抄,是那时候还没建 -->
          <div v-if="unbornNames.length" class="pma-foot-note">
            {{ unbornNames.length }} 栋在这一段还没投产，不画：{{ unbornNames.join('、') }}
          </div>

          <!-- 月抄的栋另起一组:N=12 与 N=244 的可信度差一个量级,不与日抄栋并排 -->
          <template v-if="monthlyRows.length">
            <button class="pma-fold" @click="monthOpen = !monthOpen">
              <span class="ar" :class="{ open: monthOpen }">▸</span>
              {{ monthlyRows.length }} 栋按月抄表（口径不同，不与上面并排比）
            </button>
            <div v-if="monthOpen" class="pma-board">
              <div v-for="b in monthlyRows" :key="b.id" class="pma-brow" @click="pick(b.id)">
                <div class="nm" :title="b.name">{{ b.name }}</div>
                <svg :viewBox="`0 0 ${BOX.w} ${BOX.h}`">
                  <rect v-if="bd(b).band" x="0" :y="bd(b).band!.y" :width="BOX.w" :height="bd(b).band!.h" class="band" />
                  <path v-for="(d, k) in bd(b).lines" :key="k" :d="d" class="ln" />
                  <circle v-for="(p, k) in bd(b).dots" :key="'o' + k" :cx="p.x" :cy="p.y" r="2.6"
                          :class="p.out < 0 ? 'lo' : 'hi'" />
                </svg>
                <div class="tail">{{ bd(b).n }}/{{ snap.ticks.length }}</div>
              </div>
            </div>
          </template>

          <div class="pma-foot-note">
            淡带 = 这栋自己的正常范围（{{ snap.board[0]?.baseNote ?? '' }}，半宽
            {{ snap.crit.bandSigma }} 倍稳健波动）。所有行共用同一段纵轴，缺抄的{{ unit }}断开不连线。
            <template v-if="snap.facts.length === 0 && snap.quality.noPanel.length === snap.stations.filter(x => x.metered).length">
              台账这一项还对不了，见「效率校准」。
            </template>
          </div>
          <div class="pma-foot-note">
            未列出 ≠ 没问题：这屏看不见遮挡、朝向、倾角造成的先天差异。
            当前几条线 —— 正常范围半宽 {{ snap.crit.bandSigma }} 倍稳健波动
            · 连续 {{ snap.crit.bandRun }} {{ unit }}才算一段
            · 抄表覆盖 ≥{{ (snap.crit.coverMonth * 100).toFixed(0) }}%
            · 台账差 ±{{ (snap.crit.ledger * 100).toFixed(0) }}%
            · 年等效小时 ≥ 锚点 {{ snap.crit.anchorHours }} × {{ (snap.crit.yieldRatio * 100).toFixed(0) }}%。
            都在计费参数里，改了这张清单跟着变。
          </div>
        </div>
      </template>

      <!-- ══ 效率校准 ═══════════════════════════════════════════════ -->
      <template v-else-if="section === 'calib'">
        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">A1 · 绝对效率轨迹</span>
            <span class="hint">纵轴 = 全园每{{ gran === 'month' ? '日' : '月' }}等效小时</span>
          </div>
          <AnaEChart :option="a1Opt" :height="250" />
          <div class="pma-foot-note">
            等效小时 = 发电 ÷ 装机，分母优先取板数 × 单块标称功率；虚线 = 年锚点摊到每{{ gran === 'month' ? '天' : '月' }}。
            全年 {{ snap.parkYieldHours == null ? '—' : snap.parkYieldHours.toFixed(0) }} 小时 ·
            锚点 {{ snap.crit.anchorHours }} 小时 ·
            比值 {{ snap.parkYieldRatio == null ? '—' : (snap.parkYieldRatio * 100).toFixed(0) + '%' }}。
            月度基准要两年自有数据才画得出来，本年只画形状。
          </div>
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">T1 · 台账 vs 理论装机</span>
            <span class="hint">实线 = 两者相等，虚线 = ±{{ (snap.crit.ledger * 100).toFixed(0) }}%</span>
          </div>
          <AnaEChart :option="t1Opt" :height="250" />
          <div class="pma-foot-note">
            横轴 = 板数 × 单块标称功率 ÷ 1000；纵轴 = 台账装机。
            {{ snap.quality.noPanel.length }} 栋未录板数或单块标称功率，不画点{{ snap.quality.noPanel.length ? '：' + snap.quality.noPanel.join('、') : '' }}
          </div>
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">R3 · 各站发电效率</span>
            <span class="hint">横轴 = 全年等效小时；虚线 = 年锚点</span>
          </div>
          <AnaEChart :option="r3Opt" :height="300" />
          <div class="pma-foot-note">
            按期分色。分母优先取板数 × 单块标称功率，没录的栋退回台账装机
          </div>
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">M3 · 响应斜率小倍数</span>
            <span class="hint">每栋一格；虚线 = 斜率等于 1</span>
          </div>
          <div class="pma-mult">
            <div v-for="s in snap.stations.filter(x => x.metered)" :key="s.id" class="pma-mini" @click="pick(s.id)">
              <div class="nm">{{ s.name }}</div>
              <svg :viewBox="`0 0 ${M3.w} ${M3.h}`" preserveAspectRatio="none">
                <line x1="0" :y1="m3Path(s.id).ref" :x2="M3.w" :y2="m3Path(s.id).ref" class="ref" />
                <path v-if="m3Path(s.id).band" :d="m3Path(s.id).band" class="band" />
                <path v-if="m3Path(s.id).line" :d="m3Path(s.id).line" class="ln" />
              </svg>
              <div v-if="!m3Path(s.id).n" class="none">无可拟合的月</div>
            </div>
          </div>
          <div class="pma-foot-note">
            横轴 = 月，纵轴 = 该月对全园当日因子的回归斜率；淡带 = ±1 个标准误。
            所有格共用同一段纵轴（{{ m3Range.lo.toFixed(1) }} ~ {{ m3Range.hi.toFixed(1) }}）。
            这一块**始终按月**，与上面的期间无关
          </div>
        </div>
      </template>

      <!-- ══ 消纳收益 ═══════════════════════════════════════════════ -->
      <template v-else>
        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">R1 · 消纳结构</span>
            <span class="hint">堆叠柱 = 自消纳 / 上网 / 损耗</span>
          </div>
          <AnaEChart :option="r1Opt" :height="250" />
          <div class="pma-foot-note">折线 = 损耗率，副轴固定 0–3%（不随数据自适应）</div>
        </div>

        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">R2 · 各站消纳收益</span>
            <span class="hint">并排柱，不是堆叠</span>
          </div>
          <AnaEChart :option="r2Opt" :height="250" />
          <div class="pma-foot-note">
            深 = 消纳收益（按录入时的单价快照），浅 = 上网收益（{{ GRID_PRICE }} 元/度）。
            柱高是全年绝对额，不是效率
          </div>
        </div>

        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">R4 · 发电量趋势</span>
            <span class="hint">纵轴 = 全园每{{ gran === 'month' ? '日' : '月' }}发电量</span>
          </div>
          <AnaEChart :option="r4Opt" :height="250" />
          <div class="pma-foot-note">这是绝对量的形状；跟基准比看「效率校准」里的 A1</div>
        </div>
      </template>

      <div class="av2-s12 pma-foot">
        <span>本页数据快照 <code>{{ snap.id }}</code></span>
        <span>整年有效日 {{ snap.quality.okDays }} / {{ snap.quality.totalDays }} 天</span>
        <span v-if="cmp.mode.value === 'yoy'">同比：{{ snap.yoy.yearNote }}</span>
        <button class="pma-lk" @click="goMeter">去分栋抄表 →</button>
      </div>
    </div>

    <!-- ── L5 单栋抽屉 ─────────────────────────────────────────────── -->
    <FPDrawer
      :open="!!sel"
      :title="sel?.name ?? ''"
      :subtitle="sel ? `整年在网 ${sel.days} 天 · 年发电 ${wan(sel.genYear)} 万度` : ''"
      icon="activity"
      :width="820"
      :fixedHeight="true"
      @close="selId = null"
    >
      <div v-if="!detail" class="pma-note-line">这栋在网不足 8 天，画不出逐日曲线。</div>
      <div v-else class="pma-drawer">
        <div class="pma-foot-note">下面三张都是**整年逐日**，与上面选的期间无关。</div>
        <div class="av2-card-h">
          <span class="t">S2 · 样条趋势</span>
          <span class="hint">淡点 = 逐日相对自身水平；实线 = 限制性立方样条拟合；淡带 = 95% 置信带（数据稀的时段自动张开）</span>
        </div>
        <AnaEChart :option="s2Opt" :height="250" />

        <div class="av2-card-h">
          <span class="t">S3 · 变点与置信区间</span>
          <span class="hint">竖线 = 变点位置；阴影 = 变点位置的置信区间（是一段区间，不是精确到某天）</span>
        </div>
        <AnaEChart :option="s3Opt" :height="250" />
        <div class="pma-foot-note">
          {{ detail.cpDate ? '变点 ' + detail.cpDate : '未扫出变点' }}
          <template v-if="detail.cpLo && detail.cpHi"> · 区间 {{ detail.cpLo }} ~ {{ detail.cpHi }}</template>
        </div>

        <div class="av2-card-h">
          <span class="t">M4 · 控制图</span>
          <span class="hint">中心线 + ±2 / ±3 倍稳健波动的控制限；灰底 = 控制限的估计窗口（取变点之前那段）</span>
        </div>
        <AnaEChart :option="m4Opt" :height="250" />
        <div class="pma-foot-note">
          估计窗口 {{ detail.limitFrom }} ~ {{ detail.limitTo }} ·
          中心线 {{ detail.center.toFixed(3) }} · 一倍波动 {{ detail.sigma.toFixed(3) }}
        </div>
      </div>
    </FPDrawer>
  </AnaShell>
</template>

<style scoped>
.pma-hold { display: flex; align-items: center; justify-content: center; min-height: 240px; }

/* ── 结论条 ── */
.pma-lede {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0 14px; align-items: center;
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--hue-orange);
  border-radius: 8px; padding: 10px 14px;
}
.pma-lede.quiet { border-left-color: var(--border-subtle); }
.pma-lede .n {
  font-family: var(--font-mono); font-size: 30px; line-height: 1;
  font-weight: var(--fw-semibold); color: var(--hue-orange);
}
.pma-lede.quiet .n { color: var(--text-muted); }
.pma-lede .hd { font-size: var(--fs-body); color: var(--text-primary); }
.pma-lede .sub { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 2px; }
.pma-lede .chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.pma-lede .chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--fs-label); color: var(--text-primary);
  background: var(--surface-sunken); border: 1px solid var(--border-subtle);
  border-radius: 999px; padding: 3px 5px 3px 11px; cursor: pointer;
}
.pma-lede .chip:hover { border-color: var(--hue-orange); }
.pma-lede .chip .c {
  font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--surface-white);
  background: var(--hue-orange); border-radius: 999px; padding: 1px 6px;
}
@media (max-width: 720px) {
  .pma-lede { grid-template-columns: auto minmax(0, 1fr); }
  .pma-lede .chips { grid-column: 1 / -1; justify-content: flex-start; margin-top: 8px; }
}

.pma-seg { display: flex; }

/* ── 看板 ── */
.pma-board { display: flex; flex-direction: column; gap: 2px; }
.pma-brow {
  display: grid; grid-template-columns: 84px minmax(0, 1fr) 74px;
  gap: 8px; align-items: center; cursor: pointer; border-radius: 4px;
}
.pma-brow:hover { background: var(--surface-subtle); }
.pma-brow:hover .nm { color: var(--hue-blue); }
.pma-brow .nm {
  font-size: var(--fs-micro); color: var(--text-secondary); padding-left: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pma-brow svg { display: block; width: 100%; height: 40px; }
.pma-brow .tail {
  font-size: var(--fs-micro); color: var(--text-muted);
  font-family: var(--font-mono); text-align: right; padding-right: 4px;
}
/* 出范围的栋:置顶 + 底色 + 左侧色条。**不动行高** —— 共用纵轴是这仪器的立身之本 */
.pma-brow.hit { background: rgb(255, 248, 240); box-shadow: inset 3px 0 0 var(--hue-orange); }
.pma-brow.hit:hover { background: rgb(255, 243, 230); }
.pma-brow.hit .nm { color: var(--text-primary); font-weight: var(--fw-semibold); }
.pma-brow.hit .tail { color: var(--hue-orange); }
.pma-brow .band { fill: var(--hue-blue); opacity: 0.10; }
.pma-brow .ctr { stroke: var(--hue-blue); stroke-width: 0.6; stroke-dasharray: 3 3; opacity: 0.7; }
.pma-brow .ln { fill: none; stroke: var(--text-secondary); stroke-width: 1.2; }
.pma-brow circle.lo { fill: var(--hue-red); }
.pma-brow circle.hi { fill: var(--hue-orange); }

/* 折叠条:正常的栋收起来,留一排缩略给个「它们确实都平」的印象 */
.pma-fold {
  display: grid; grid-template-columns: 14px auto minmax(0, 1fr);
  gap: 8px; align-items: center; width: 100%;
  background: none; border: 0; border-top: 1px dashed var(--border-subtle);
  margin-top: 4px; padding: 7px 4px 4px; cursor: pointer; text-align: left;
  font-size: var(--fs-micro); color: var(--text-muted);
}
.pma-fold:hover { color: var(--text-secondary); }
.pma-fold .ar { transition: transform 0.15s; }
.pma-fold .ar.open { transform: rotate(90deg); }
/* 放不下就裁掉,不换行 —— 这排缩略是「它们确实都平」的余光印象,不是要逐个看清 */
.pma-fold .mini { display: flex; gap: 3px; justify-content: flex-end; overflow: hidden; }
.pma-fold .mini svg { flex: 0 0 auto; }
.pma-fold .mini svg { width: 40px; height: 14px; opacity: 0.5; }
.pma-fold .mini .ln { fill: none; stroke: var(--text-muted); stroke-width: 1; }

.pma-bax {
  display: grid; grid-template-columns: 84px minmax(0, 1fr) 74px;
  gap: 8px; font-size: 9px; color: var(--text-muted); margin-top: 4px;
}
.pma-bax span:nth-child(1) { grid-column: 2; justify-self: start; }
.pma-bax span:nth-child(2) { grid-column: 2; justify-self: center; }
.pma-bax span:nth-child(3) { grid-column: 2; justify-self: end; }
.pma-bax span { grid-row: 1; }

.pma-note-line {
  font-size: var(--fs-label); color: var(--text-secondary);
  background: var(--surface-subtle); border-left: 3px solid var(--hue-orange);
  padding: 6px 10px; margin-bottom: 8px; border-radius: 0 4px 4px 0;
}

/* ── 事实句(列表,不是表格) ── */
.pma-facts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.pma-facts li {
  display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; align-items: baseline;
  font-size: var(--fs-label); background: var(--surface-subtle);
  padding: 5px 10px; border-radius: 4px; cursor: pointer;
}
.pma-facts li:hover { background: var(--surface-sunken); }
.pma-facts .st { font-weight: var(--fw-semibold); color: var(--text-primary); }
.pma-facts .tx { color: var(--text-secondary); overflow-wrap: anywhere; }
.pma-facts li.run .tx { color: var(--hue-red); }
.pma-facts li.scatter .tx { color: var(--hue-orange); }
.pma-facts li.thin .tx { color: var(--text-muted); }

.pma-foot-note { font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.6; margin-top: 6px; }

/* ── M3 小倍数 ── */
.pma-mult { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.pma-mini { border: 1px solid var(--border-subtle); border-radius: 4px; padding: 4px 5px; cursor: pointer; }
.pma-mini .nm { font-size: var(--fs-micro); color: var(--text-secondary); margin-bottom: 2px; }
.pma-mini svg { display: block; width: 100%; height: 46px; }
.pma-mini .ref { stroke: var(--text-muted); stroke-width: 0.6; stroke-dasharray: 2 2; }
.pma-mini .band { fill: var(--hue-blue); opacity: 0.16; stroke: none; }
.pma-mini .ln { fill: none; stroke: var(--hue-blue); stroke-width: 1.3; }
.pma-mini .none { font-size: 9px; color: var(--text-muted); }

.pma-drawer { display: flex; flex-direction: column; gap: 4px; }

.pma-foot {
  display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center;
  font-size: var(--fs-micro); color: var(--text-muted); padding-top: 4px;
}
.pma-foot code { font-family: var(--font-mono); }
.pma-lk { background: none; border: 0; padding: 0; cursor: pointer; color: var(--hue-blue); font-size: var(--fs-micro); }
</style>
