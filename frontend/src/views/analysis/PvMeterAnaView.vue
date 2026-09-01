<script setup lang="ts">
// 光伏分栋分析(pv-meter-analysis)— PV-ANALYSIS-SPEC §06。14 块,五层:
//   L1 相对偏离(栋跟栋比) · L2 绝对水平(跟标称比) · L3 账面量 · L4 逐栋曲线 · L5 单栋抽屉
//
// 铁律:**一份数据、一次计算、一个 snapshot id**。整屏只跑一次 buildSnapshot,
// 各层渲染同一个对象的不同面,页脚显示那个 id —— 数字对不上时先看是不是同一次计算。
//
// ⚠ 文案规范(§05):**屏只说明可视化在做什么,不输出解释性结论。**
//   能写:图种 / 坐标轴含义与单位 / 色阶与留白的含义 / 数据来源与条数 / 判据线画在哪。
//   不能写:诊断结论、成因归因、建议动作、严重度判词(正常/异常/需关注)、反事实金额。
//   边界:数据里直接读得出来的是事实,可以写;要过一个模型才得出的是结论,不写。
//
// ⚠ 热力矩阵**不用 ECharts**:echartsBundle 没注册 HeatmapChart 与 VisualMapComponent,
//   用了会得到空白图 + 一句控制台警告,而 jsdom 里测不出来。156 格用 CSS Grid 手写更划算。
// ⚠ M3 小倍数用内联 SVG 而不是 13 个 ECharts grid:共用 y 轴是小倍数的命门,
//   自己算刻度比配 13 套 grid 更好保证,也不用往 bundle 里加图表类型。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import { usePeriod } from '@/analysis/usePeriod'
import { useCompare, type CompareMode } from '@/analysis/useCompare'
import { fnum } from '@/components/ana/anaFmt'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import {
  buildSnapshot, buildDetail, DEFAULT_CRITERIA,
  type AnaSnapshot, type Criteria, type SnapshotInput, type StationRow,
} from './pvMeterAna.logic'

// 支持集是**模块级常量**:传给 AnaShell 的与本屏自己读的必须同一份引用(§06 约束)
const CMP: CompareMode[] = ['yoy']
const GRID_PRICE = 0.391   // 上网标杆价(脱硫煤)

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const cmp = useCompare(CMP)
// periodMode='year' 只许读 year(AnaShell.spec.ts:35 守着)
const year = computed(() => period.sel.value.year)

const stations = ref<PvStationDTO[]>([])
const readings = ref<PvReadingDTO[]>([])
const prevReadings = ref<PvReadingDTO[] | undefined>(undefined)
const crit = ref<Criteria>({ ...DEFAULT_CRITERIA })
const loading = ref(true)
const failed = ref(false)
let seq = 0

const CRIT_KEYS = [
  'pv_yield_anchor_h', 'pv_crit_resid', 'pv_crit_disp_ratio',
  'pv_crit_cover_month', 'pv_crit_ledger', 'pv_crit_yield_ratio',
] as const

/**
 * 判据线来自计费参数(§04.1)—— 屏上写的必须是**当前生效的那个数**,
 * 所以取失败要回落到一份确定的默认值,不能显空,也不能让整屏挂掉。
 * 六个键都是长期常数,站在哪个账期看都一样,ym 取当年 12 月即可。
 */
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
      resid: n('pv_crit_resid', DEFAULT_CRITERIA.resid),
      dispRatio: n('pv_crit_disp_ratio', DEFAULT_CRITERIA.dispRatio),
      coverMonth: n('pv_crit_cover_month', DEFAULT_CRITERIA.coverMonth),
      ledger: n('pv_crit_ledger', DEFAULT_CRITERIA.ledger),
      yieldRatio: n('pv_crit_yield_ratio', DEFAULT_CRITERIA.yieldRatio),
      minOnlineDays: DEFAULT_CRITERIA.minOnlineDays,
    }
  } catch { /* 用默认值,屏照常出 */ }
}

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
    if (my === seq) prevReadings.value = undefined   // 取失败 ≠ 上一年没有
  }
}
onMounted(() => { void loadCrit(year.value); void load(year.value) })
watch(year, (y) => { void loadCrit(y); void load(y) })
watch(cmp.mode, (m) => { if (m === 'yoy' && prevReadings.value === undefined) void loadPrev(year.value, seq) })

// ── 唯一的一次计算 ────────────────────────────────────────────────────
const snapInput = computed<SnapshotInput | null>(() => {
  if (!readings.value.length) return null
  return {
    year: year.value,
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

const monLabel = (ym: string) => `${Number(ym.slice(5, 7))}月`
const pct0 = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%`
const wan = (v: number) => fnum(v / 10000, 1)

// ── L1 三张同网格 ─────────────────────────────────────────────────────
const gridStations = computed<StationRow[]>(() => (snap.value?.stations ?? []).filter(s => s.metered))

/** 色阶按 ±P95 截断:一个 +500% 的格子会把其余 155 格全压成同一个白 */
function p95(vals: number[], floor: number): number {
  if (!vals.length) return floor
  const a = [...vals].sort((x, y) => x - y)
  return Math.max(floor, a[Math.min(a.length - 1, Math.floor(a.length * 0.95))])
}
const devScale = computed(() => {
  const all: number[] = []
  for (const [, arr] of snap.value?.grid.deviation ?? []) for (const v of arr) if (v != null) all.push(Math.abs(v))
  return p95(all, 0.05)
})
const dispScale = computed(() => {
  const all: number[] = []
  for (const [, arr] of snap.value?.grid.dispersion ?? []) for (const v of arr) if (v != null) all.push(v)
  return p95(all, 0.02)
})

type Cell = { cls: string; bg: string; tip: string }
const NA: Cell = { cls: 'c-na', bg: '', tip: '该月尚无抄表记录（未投产）' }

/** 发散配色零居中:红 = 低于基准,蓝 = 高于,白 = 贴基准。越过截断点的格描边 */
function devCell(v: number | null | undefined, born: boolean): Cell {
  if (!born) return NA
  if (v == null) return { cls: 'c-nd', bg: '', tip: '该月抄表天数太少，算不出中位数' }
  const k = Math.min(1, Math.abs(v) / devScale.value)
  const hue = v < 0 ? 'var(--hue-red)' : 'var(--hue-blue)'
  return {
    cls: Math.abs(v) > devScale.value ? 'c-over' : '',
    bg: `color-mix(in srgb, ${hue} ${Math.round(k * 82)}%, transparent)`,
    tip: `残差中位数 ${pct0(v)}`,
  }
}
/** 顺序配色单向深浅 —— 波动没有方向 */
function dispCell(v: number | null | undefined, born: boolean): Cell {
  if (!born) return NA
  if (v == null) return { cls: 'c-nd', bg: '', tip: '该月抄表不足 4 天，算不出稳健波动' }
  const k = Math.min(1, v / dispScale.value)
  return {
    cls: v > dispScale.value ? 'c-over' : '',
    bg: `color-mix(in srgb, var(--hue-orange) ${Math.round(k * 82)}%, transparent)`,
    tip: `日间波动 ${(v * 100).toFixed(0)}%`,
  }
}
/** 留白(未投产)与斜纹(有该月但一天没抄)必须是两种视觉 */
function covCell(v: number | null | undefined, born: boolean): Cell {
  if (!born) return NA
  if (v == null) return { cls: 'c-nd', bg: '', tip: '该月一天都没抄' }
  return {
    cls: '',
    bg: `color-mix(in srgb, var(--hue-green) ${Math.round(v * 82)}%, transparent)`,
    tip: `该月抄了 ${(v * 100).toFixed(0)}% 的天数`,
  }
}
const bornAt = (id: number, c: number) => c >= (snap.value?.grid.born.get(id) ?? 0)

/**
 * 「基准可能被拽偏」横幅。残差符号**按期分裂**(同期一批全正、另一期一批全负)是
 * 多数派把中位数基准拽偏的指纹 —— 中位数的崩溃点是 50%,同期栋数过半偏低时基准跟着下移,
 * 剩下正常的那批反而显示成高。这条不能只写在图注里让人自己想明白。
 */
const skewedMonths = computed(() => {
  const s = snap.value
  if (!s) return [] as string[]
  const out: string[] = []
  s.months.forEach((m, c) => {
    const byPhase = new Map<number, number[]>()
    for (const st of gridStations.value) {
      const v = s.grid.deviation.get(st.id)?.[c]
      if (v == null) continue
      const a = byPhase.get(st.phase) ?? []
      a.push(v); byPhase.set(st.phase, a)
    }
    const signs = [...byPhase.values()]
      .filter(a => a.length >= 2)
      .map(a => (a.every(v => v > 0.05) ? 1 : a.every(v => v < -0.05) ? -1 : 0))
      .filter(v => v !== 0)
    if (signs.length >= 2 && new Set(signs).size > 1) out.push(m)
  })
  return out
})

// ── L2 绝对水平 ───────────────────────────────────────────────────────
// ECharts option 是纯 JSON,**不能引用 CSS 变量**,颜色只能写字面值(§06 约束④)
const a1Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const anchorMonthly = +(s.crit.anchorHours / 12).toFixed(1)
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 16, top: 20, bottom: 26 },
    xAxis: { type: 'category', data: s.months.map(monLabel) },
    yAxis: { type: 'value', name: '小时', nameTextStyle: { fontSize: 10 } },
    series: [{
      name: '全园月等效小时', type: 'line', symbol: 'circle', symbolSize: 5, connectNulls: false,
      lineStyle: { width: 2.2, color: '#1F5FBF' }, itemStyle: { color: '#1F5FBF' },
      data: s.ledger.yieldByMonth.map(v => (v == null ? null : +v.toFixed(1))),
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: '#8A8A85', type: 'dashed', width: 1.4 },
        label: { formatter: `锚点按月均摊 ${anchorMonthly}`, fontSize: 10, position: 'insideEndTop' },
        data: [{ yAxis: anchorMonthly }],
      },
    }],
  }
})

/** T1:x = 理论装机,y = 台账装机,实线 = 两者相等,虚线 = ±判据线 */
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

// ── L3 账面量 ─────────────────────────────────────────────────────────
const r1Opt = computed<object>(() => {
  const s = snap.value
  if (!s) return {}
  const m = s.ledger.monthly
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['自消纳', '上网', '损耗', '损耗率'] },
    grid: { left: 52, right: 46, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: m.labels.map(monLabel) },
    yAxis: [
      { type: 'value', name: '万度', nameTextStyle: { fontSize: 10 } },
      // 副轴范围**固定** 0–3%,不随数据自适应:两个 y 轴的刻度能造出任意的视觉相关性
      { type: 'value', name: '%', min: 0, max: 3, nameTextStyle: { fontSize: 10 } },
    ],
    series: [
      { name: '自消纳', type: 'bar', stack: 'x', barMaxWidth: 22, itemStyle: { color: '#1F5FBF' }, data: m.self.map(v => +(v / 10000).toFixed(2)) },
      { name: '上网', type: 'bar', stack: 'x', itemStyle: { color: '#9DC3E6' }, data: m.grid.map(v => +(v / 10000).toFixed(2)) },
      { name: '损耗', type: 'bar', stack: 'x', itemStyle: { color: '#D8D8D4' }, data: m.loss.map(v => +(v / 10000).toFixed(2)) },
      {
        name: '损耗率', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 1.6, color: '#8A5800' }, itemStyle: { color: '#8A5800' },
        data: m.lossPct.map(v => +(v * 100).toFixed(2)),
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
  const m = s.ledger.monthly
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 16, top: 16, bottom: 26 },
    xAxis: { type: 'category', data: m.labels.map(monLabel) },
    yAxis: { type: 'value', name: '万度', nameTextStyle: { fontSize: 10 } },
    series: [{
      type: 'line', symbol: 'circle', symbolSize: 5, areaStyle: { color: '#DCE9F2' },
      lineStyle: { width: 2.2, color: '#1F5FBF' }, itemStyle: { color: '#1F5FBF' },
      data: m.labels.map((_, i) => +((m.self[i] + m.grid[i] + m.loss[i]) / 10000).toFixed(2)),
    }],
  }
})

// ── L4 M3 小倍数(内联 SVG,共用 y 轴) ──────────────────────────────────
const M3 = { w: 132, h: 46, pad: 4 }
const m3Range = computed(() => {
  const s = snap.value
  const vs: number[] = []
  if (s) for (const [, arr] of s.slopes) for (const r of arr) if (isFinite(r.beta)) vs.push(r.beta)
  if (!vs.length) return { lo: -0.1, hi: 2.1 }
  return { lo: Math.min(0, ...vs) - 0.1, hi: Math.max(2, ...vs) + 0.1 }
})
/** 共用轴是小倍数的命门:各自缩放就没法比。所有格都用 m3Range 映射 */
function m3Path(id: number) {
  const s = snap.value
  const { lo, hi } = m3Range.value
  const Y = (v: number) => M3.h - M3.pad - ((v - lo) / Math.max(1e-9, hi - lo)) * (M3.h - M3.pad * 2)
  if (!s) return { line: '', band: '', ref: Y(1), n: 0 }
  const rows = s.slopes.get(id) ?? []
  const cols = s.months
  const X = (c: number) => M3.pad + (c / Math.max(1, cols.length - 1)) * (M3.w - M3.pad * 2)
  const pts: { x: number; y: number; lo: number; hi: number }[] = []
  cols.forEach((m, c) => {
    const r = rows.find(x => x.key === m)
    if (!r || !isFinite(r.beta)) return
    // 样本少的月标准误很大 —— 带子要宽到肉眼可见,把「读不出东西」也画出来
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
    yAxis: { type: 'value', name: '残差（对数）', nameTextStyle: { fontSize: 10 }, scale: true },
    series: [
      // 置信带用两层堆叠面积画:下沿透明、上沿填色 —— ECharts 没有原生 band
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
    yAxis: { type: 'value', name: '残差（对数）', nameTextStyle: { fontSize: 10 }, scale: true },
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
    yAxis: { type: 'value', name: '残差（对数）', nameTextStyle: { fontSize: 10 }, scale: true },
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
  <AnaShell period-mode="year" :compare="CMP">
    <div v-if="loading" class="pma-hold"><span class="page-spin" /></div>
    <AnaEmpty v-else-if="failed" label="分栋抄表数据没加载成功" hint="刷新重试；仍不行就到分栋抄表屏看数据在不在" />
    <!-- 护栏:整年无抄表 → 空态深链,不画假图 -->
    <AnaEmpty
      v-else-if="!snap"
      :label="year + ' 年暂无分栋抄表记录'"
      hint="这屏画的是分栋抄表数据，没有记录就没有可画的东西"
      to="/pv-income"
      to-text="去录入分栋抄表"
    />

    <div v-else class="av2-grid">
      <!-- 状态横幅:只陈述事实(§05) -->
      <div class="av2-s12 pma-banner">
        抄表 {{ readings.length }} 条 ·
        {{ snap.stations.filter(s => s.metered).length }} 栋已装表 ·
        {{ snap.stations.filter(s => s.metered && s.theoKwp != null).length }} 栋已录板数与单块标称功率
        <template v-if="snap.quality.droppedThin">
          · {{ snap.quality.droppedThin }} 天在网栋数不足 3，该日不出基准
        </template>
      </div>

      <!-- ── L1 相对偏离:同一张网格,三层叠看 ─────────────────────── -->
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">L1 · 相对偏离 —— 栋跟栋比</span>
          <span class="hint">
            三张共用同一套行标签与网格几何：{{ gridStations.length }} 栋 × {{ snap.months.length }} 月。
            留白 = 该月尚无抄表记录；斜纹 = 有该月但算不出值。点格看该栋的曲线
          </span>
        </div>
        <div v-if="skewedMonths.length" class="pma-note-line">
          {{ skewedMonths.map(monLabel).join('、') }}：同期各栋的偏离方向整批相反。
          基准取的是当日各栋的中位数，同期过半偏低时基准会跟着下移，剩下的栋因此显示为高。
        </div>
        <div class="pma-hm3">
          <div class="hm-col hm-names">
            <div class="hm-hd" />
            <div v-for="s in gridStations" :key="s.id" class="hm-nm" :title="s.name">{{ s.name }}</div>
            <div class="hm-ax" />
          </div>
          <div v-for="p in (['M1','M2','D2'] as const)" :key="p" class="hm-col">
            <div class="hm-hd">
              <b>{{ p }}</b>
              {{ p === 'M1' ? '月度偏离' : p === 'M2' ? '月度离散度' : '数据覆盖' }}
              <span class="mut">{{ p === 'M1' ? '红=低于基准 蓝=高于' : p === 'M2' ? '深=日间波动大' : '深=抄得全' }}</span>
            </div>
            <div
              v-for="s in gridStations" :key="s.id" class="hm-row"
              :style="{ gridTemplateColumns: `repeat(${snap.months.length}, minmax(0, 1fr))` }"
            >
              <i
                v-for="(m, c) in snap.months" :key="m"
                class="hm-c"
                :class="(p === 'M1' ? devCell(snap.grid.deviation.get(s.id)?.[c], bornAt(s.id, c))
                       : p === 'M2' ? dispCell(snap.grid.dispersion.get(s.id)?.[c], bornAt(s.id, c))
                       : covCell(snap.grid.coverage.get(s.id)?.[c], bornAt(s.id, c))).cls"
                :style="{ background: (p === 'M1' ? devCell(snap.grid.deviation.get(s.id)?.[c], bornAt(s.id, c))
                        : p === 'M2' ? dispCell(snap.grid.dispersion.get(s.id)?.[c], bornAt(s.id, c))
                        : covCell(snap.grid.coverage.get(s.id)?.[c], bornAt(s.id, c))).bg || undefined }"
                :title="`${s.name} ${monLabel(m)} · ${(p === 'M1' ? devCell(snap.grid.deviation.get(s.id)?.[c], bornAt(s.id, c))
                        : p === 'M2' ? dispCell(snap.grid.dispersion.get(s.id)?.[c], bornAt(s.id, c))
                        : covCell(snap.grid.coverage.get(s.id)?.[c], bornAt(s.id, c))).tip}`"
                @click="pick(s.id)"
              />
            </div>
            <div class="hm-ax"><span v-for="m in snap.months" :key="m">{{ Number(m.slice(5, 7)) }}</span></div>
          </div>
        </div>
      </div>

      <!-- F1:在网格下面 —— 先看图,再看索引 -->
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">F1 · 判据命中清单</span>
          <span class="hint">每行三段：哪个数 · 多少 · 跟什么比。按楼栋固定顺序，不按严重度排。点行看该栋的曲线</span>
        </div>
        <ul v-if="snap.hits.length" class="pma-hits">
          <li v-for="(h, i) in snap.hits" :key="i" :class="{ dim: !h.readable }" @click="pick(h.stationId)">
            <span class="st">{{ h.station }}</span>
            <span class="cr">{{ h.what }}</span>
            <span class="vl">{{ h.value }}</span>
            <span class="ln">{{ h.line }}</span>
          </li>
        </ul>
        <div v-else class="pma-note-line">五条判据都没有命中的行。</div>
        <div class="pma-foot-note">
          未列出 ≠ 没问题：这屏看不见遮挡、朝向、倾角造成的先天差异。
          当前判据线 —— 月偏离 ±{{ (snap.crit.resid * 100).toFixed(0) }}%
          · 月波动 {{ snap.crit.dispRatio }}× 园区同月中位
          · 月抄表覆盖 ≥{{ (snap.crit.coverMonth * 100).toFixed(0) }}%
          · 台账差 ±{{ (snap.crit.ledger * 100).toFixed(0) }}%
          · 年等效小时 ≥ 锚点 {{ snap.crit.anchorHours }} × {{ (snap.crit.yieldRatio * 100).toFixed(0) }}%。
          六个数都在计费参数里，改了这张清单跟着变。
        </div>
      </div>

      <!-- ── L2 绝对水平 ──────────────────────────────────────────── -->
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">A1 · 绝对效率轨迹</span>
          <span class="hint">纵轴 = 全园月等效小时（发电 ÷ 装机，分母优先取板数 × 单块标称功率）；虚线 = 年锚点按月均摊</span>
        </div>
        <AnaEChart :option="a1Opt" :height="250" />
        <div class="pma-foot-note">
          全年 {{ snap.parkYieldHours == null ? '—' : snap.parkYieldHours.toFixed(0) }} 小时 ·
          锚点 {{ snap.crit.anchorHours }} 小时 ·
          比值 {{ snap.parkYieldRatio == null ? '—' : (snap.parkYieldRatio * 100).toFixed(0) + '%' }}。
          月度基准要两年自有数据才画得出来，本年只画形状。
        </div>
      </div>

      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">T1 · 台账 vs 理论装机</span>
          <span class="hint">
            横轴 = 板数 × 单块标称功率 ÷ 1000；纵轴 = 台账装机。
            实线 = 两者相等，虚线 = ±{{ (snap.crit.ledger * 100).toFixed(0) }}%
          </span>
        </div>
        <AnaEChart :option="t1Opt" :height="250" />
        <div class="pma-foot-note">
          {{ snap.quality.noPanel.length }} 栋未录板数或单块标称功率，不画点{{ snap.quality.noPanel.length ? '：' + snap.quality.noPanel.join('、') : '' }}
        </div>
      </div>

      <!-- ── L3 账面量 ────────────────────────────────────────────── -->
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">R1 · 消纳结构</span>
          <span class="hint">堆叠柱 = 自消纳 / 上网 / 损耗（万度）；折线 = 损耗率，副轴固定 0–3%</span>
        </div>
        <AnaEChart :option="r1Opt" :height="250" />
      </div>

      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">R2 · 各站消纳收益</span>
          <span class="hint">
            并排柱，不是堆叠。深 = 消纳收益（按录入时的单价快照），浅 = 上网收益（{{ GRID_PRICE }} 元/度）。
            柱高是绝对额，不是效率
          </span>
        </div>
        <AnaEChart :option="r2Opt" :height="250" />
      </div>

      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">R3 · 各站发电效率</span>
          <span class="hint">
            横向条形，横轴 = 年等效小时（发电 ÷ 装机）；按期分色；虚线 = 年锚点。
            分母优先取板数 × 单块标称功率，没录的栋退回台账装机
          </span>
        </div>
        <AnaEChart :option="r3Opt" :height="300" />
      </div>

      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">R4 · 发电量月度趋势</span>
          <span class="hint">纵轴 = 全园当月发电量（万度）。这是绝对量的季节形状；跟基准比看 A1</span>
        </div>
        <AnaEChart :option="r4Opt" :height="300" />
      </div>

      <!-- ── L4 逐栋曲线 ──────────────────────────────────────────── -->
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">M3 · 响应斜率小倍数</span>
          <span class="hint">
            每栋一格：横轴 = 月，纵轴 = 该月对全园当日因子的回归斜率；虚线 = 斜率等于 1；
            淡带 = ±1 个标准误。所有格共用同一段纵轴（{{ m3Range.lo.toFixed(1) }} ~ {{ m3Range.hi.toFixed(1) }}）
          </span>
        </div>
        <div class="pma-mult">
          <div v-for="s in gridStations" :key="s.id" class="pma-mini" @click="pick(s.id)">
            <div class="nm">{{ s.name }}</div>
            <svg :viewBox="`0 0 ${M3.w} ${M3.h}`" preserveAspectRatio="none">
              <line x1="0" :y1="m3Path(s.id).ref" :x2="M3.w" :y2="m3Path(s.id).ref" class="ref" />
              <path v-if="m3Path(s.id).band" :d="m3Path(s.id).band" class="band" />
              <path v-if="m3Path(s.id).line" :d="m3Path(s.id).line" class="ln" />
            </svg>
            <div v-if="!m3Path(s.id).n" class="none">无可拟合的月</div>
          </div>
        </div>
      </div>

      <div class="av2-s12 pma-foot">
        <span>本页数据快照 <code>{{ snap.id }}</code></span>
        <span>有效日 {{ snap.quality.okDays }} / {{ snap.quality.totalDays }} 天</span>
        <span v-if="cmp.mode.value === 'yoy'">同比：{{ snap.yoy.yearNote }}</span>
        <button class="pma-lk" @click="goMeter">去分栋抄表 →</button>
      </div>
    </div>

    <!-- ── L5 单栋抽屉:点网格的格、F1 的行、或 M3 的迷你图打开 ─────── -->
    <FPDrawer
      :open="!!sel"
      :title="sel?.name ?? ''"
      :subtitle="sel ? `在网 ${sel.days} 天 · 年发电 ${wan(sel.genYear)} 万度` : ''"
      icon="activity"
      :width="820"
      :fixedHeight="true"
      @close="selId = null"
    >
      <div v-if="!detail" class="pma-note-line">这栋在网不足 8 天，画不出逐日曲线。</div>
      <div v-else class="pma-drawer">
        <div class="av2-card-h">
          <span class="t">S2 · 样条趋势</span>
          <span class="hint">淡点 = 逐日残差；实线 = 限制性立方样条拟合；淡带 = 95% 置信带（数据稀的时段自动张开）</span>
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
          <span class="t">M4 · 残差控制图</span>
          <span class="hint">中心线 + ±2 / ±3 倍稳健波动的控制限；灰底 = 控制限的估计窗口（取变点之前那段）</span>
        </div>
        <AnaEChart :option="m4Opt" :height="250" />
        <div class="pma-foot-note">
          估计窗口 {{ detail.limitFrom }} ~ {{ detail.limitTo }} ·
          中心线 {{ detail.center.toFixed(3) }} · 一倍波动 {{ detail.sigma.toFixed(3) }}（对数域）
        </div>
      </div>
    </FPDrawer>
  </AnaShell>
</template>

<style scoped>
.pma-hold { display: flex; align-items: center; justify-content: center; min-height: 240px; }

.pma-banner {
  font-size: var(--fs-label); color: var(--text-muted);
  background: var(--surface-subtle); border: 1px solid var(--border-subtle);
  border-radius: 6px; padding: 7px 12px;
}

/* ── L1 三张同网格 ── */
.pma-hm3 { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 4px; }
.hm-col { min-width: 0; flex: 1 1 0; }
.hm-names { flex: 0 0 88px; }
.hm-hd {
  font-size: var(--fs-micro); color: var(--text-muted);
  height: 18px; line-height: 18px; white-space: nowrap; overflow: hidden;
}
.hm-hd b { color: var(--text-primary); }
.hm-nm {
  height: 15px; line-height: 15px; font-size: var(--fs-micro); color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hm-row { display: grid; gap: 1px; height: 15px; }
.hm-c { display: block; height: 14px; border-radius: 1px; cursor: pointer; background: var(--surface-subtle); }
/* 留白(未投产)与斜纹(有该月但算不出)必须是两种视觉 */
.hm-c.c-na { background: transparent !important; cursor: default; }
.hm-c.c-nd { background: repeating-linear-gradient(45deg, var(--border-subtle) 0 2px, transparent 2px 4px) !important; }
/* 越过色阶截断点(±P95)的格描边 —— 不让一个极端值把其余全压成同一个白 */
.hm-c.c-over { outline: 1px solid var(--text-primary); outline-offset: -1px; }
.hm-ax {
  display: flex; justify-content: space-between; height: 12px;
  font-size: 9px; color: var(--text-muted); margin-top: 2px;
}

.pma-note-line {
  font-size: var(--fs-label); color: var(--text-secondary);
  background: var(--surface-subtle); border-left: 3px solid var(--hue-orange);
  padding: 6px 10px; margin-bottom: 8px; border-radius: 0 4px 4px 0;
}

/* ── F1 命中清单(列表,不是表格) ── */
.pma-hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.pma-hits li {
  display: grid; grid-template-columns: 92px 108px minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px; align-items: baseline;
  font-size: var(--fs-label); background: var(--surface-subtle);
  padding: 5px 10px; border-radius: 4px; cursor: pointer;
}
.pma-hits .st { font-weight: var(--fw-semibold); color: var(--text-primary); }
.pma-hits .cr { color: var(--text-secondary); }
.pma-hits .vl { color: var(--hue-red); font-family: var(--font-mono); }
.pma-hits .ln { color: var(--text-muted); font-family: var(--font-mono); }
.pma-hits li.dim .vl { color: var(--text-muted); }
.pma-hits span { min-width: 0; overflow-wrap: anywhere; }

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
