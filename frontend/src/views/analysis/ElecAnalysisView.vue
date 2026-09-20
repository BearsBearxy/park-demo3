<script setup lang="ts">
// 电费成本分析(elec-analysis)— ENERGY-ANALYSIS-SPEC §1:
// 结论条 4 年累计(园区电费收益/光伏投资收益/基本用电费收益/售电协议损益,人话一句,点击深链成本总览)
// + 图1 收益四指标月度趋势线 + 图2 总表电费结构堆叠柱(功率因数奖励/光伏上网收益作负向抵减段)
// + 图3 购售价差双轴(公告价 vs 执行价双线 + 月损益柱)。
// 数据源:/metrics-year 年度指标序列 + elec_cost_entry 逐月费项 + price_cfg 月度电价;
// 含 simulated 行时页头常驻说明条(灰标口径)。年份选择照分析层 'year' 屏惯例(AnaShell periodMode='year')。
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import { iconFor } from '@/components/ds/icon'
import { fnum, hues, sgn, STATUS } from '@/components/ana/anaFmt'
import { finWan } from '@/utils/finFmt'
import { usePeriod } from '@/analysis/usePeriod'
import {
  elecCostApi,
  type ElecCostEntryDTO, type ElecMeterDTO, type ElecMetricsMonthDTO, type ElecPriceCfgDTO,
} from '@/api/elecCost'
import '@/components/ana/ana.css'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import { isSViewport } from '@/components/ana/anaChartHeight'

// S 档(≤600)几何判据。本屏三张图全是 AnaEChart —— 它自己的降档、顶替它的 AnaSkelChart、
// 以及 ana.css 里那一整块 S 档规则(order / hint 成对 / 触点 44)都认同一个 matchMedia('≤600'),
// 这里跟着认它:换成容器宽 <420 的话,视口 488–600 那一段会出现「图按视口降档、并档按容器宽」
// 的分叉(PvMeterAnaView.vue:92 记的就是这个坑,只是它那屏的图是自绘的,判据方向相反)。
// 与 AnaEChart 同法:挂载时判一次,不跟随 resize(手机不改窗宽,旋屏走整页重挂载)。
const isS = isSViewport()

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const year = computed(() => period.sel.value.year)

// ── 取数(年切重取;seq 守卫防快切乱序落表,同 ElecView loadYear) ──
const loading = ref(true)
const failed = ref(false)
// 换年在途(C5-02):旧内容留在原地退让,不卸载;过 200ms 门才亮、到数立刻灭
const staleShown = useDeferredFlag(loading)
/** 已画在屏上的那一年:year 立刻变(控件回显),这个等数据一起换 —— 页头 / 卡头 / 结论句跟它走,
 *  换年在途不出现「新年标题配旧年图」(C5-02 ①)。null = 还没有任何数据。 */
const loadedYear = ref<number | null>(null)
const meters = ref<ElecMeterDTO[]>([])
const metricMonths = ref<ElecMetricsMonthDTO[]>([])
const entryMonths = ref<ElecCostEntryDTO[][]>([])   // 下标 = 月-1
const priceMonths = ref<ElecPriceCfgDTO[][]>([])

let seq = 0
async function load(y: number) {
  if (!y) return
  const s = ++seq
  loading.value = true
  failed.value = false
  try {
    // ponytail: entries/price-cfg 无年端点,12 月并发拉(单月条目量小);后端若加 year 端点再收敛
    const ms = Array.from({ length: 12 }, (_, i) => i + 1)
    const [mt, my, es, ps] = await Promise.all([
      elecCostApi.meters(),
      elecCostApi.metricsYear(y),
      Promise.all(ms.map((m) => elecCostApi.entries(y, m))),
      Promise.all(ms.map((m) => elecCostApi.priceCfg(`${y}-${String(m).padStart(2, '0')}`))),
    ])
    if (s !== seq) return
    meters.value = mt
    metricMonths.value = my
    entryMonths.value = es
    priceMonths.value = ps
    loadedYear.value = y
  } catch {
    if (s === seq) failed.value = true
  } finally {
    if (s === seq) loading.value = false
  }
}
watch(year, (y) => { void load(y) }, { immediate: true })

const MLABELS = Array.from({ length: 12 }, (_, i) => i + 1 + '月')
const hasEntries = computed(() => entryMonths.value.some((rows) => rows.length > 0))
// simulated 说明条:任一费项行 source='simulated' → 页头常驻(spec §1)
const hasSim = computed(() => entryMonths.value.some((rows) => rows.some((r) => r.source === 'simulated')))

// ── 指标月序列(元;缺源月 null,诚实断点不补 0) ──
function metricSeries(key: string): (number | null)[] {
  return Array.from({ length: 12 }, (_, i) =>
    metricMonths.value.find((x) => x.month === i + 1)?.metrics.find((m) => m.key === key)?.value ?? null)
}
// 指标中文名以后端 label 为单一事实源(找不到回退给定文案)
function metricLabel(key: string, fb: string): string {
  for (const mm of metricMonths.value) {
    const hit = mm.metrics.find((m) => m.key === key)
    if (hit) return hit.label
  }
  return fb
}
const sumOf = (a: (number | null)[]): number | null =>
  a.reduce<number | null>((s, v) => (v == null ? s : (s ?? 0) + v), null)

// ── 结论条:4 指标年累计,人话一句(cv2-concl 同款;点击深链成本总览) ──
const CONCL = [
  { key: 'parkElecProfit', fb: '园区电费收益' },
  { key: 'pvInvestIncome', fb: '光伏投资收益' },
  { key: 'basicElecProfit', fb: '基本用电费收益' },
  { key: 'sellAgreementPnl', fb: '签订售电协议损益' },
]
const conclusion = computed(() =>
  CONCL.map(({ key, fb }) => {
    const s = metricSeries(key)
    const total = sumOf(s)
    const n = s.filter((v) => v != null).length
    const label = metricLabel(key, fb)
    return {
      key,
      text: total == null
        ? `${loadedYear.value} 年${label}暂无可算月份`
        : `${loadedYear.value} 年${label}累计 ${finWan(total)}(${n} 个月)`,
      tone: (total == null ? 'neutral' : total >= 0 ? 'good' : 'risk') as 'neutral' | 'good' | 'risk',
    }
  }))

// ── 深链电费成本第二本账(cost):ElecView 认 ?mode=(P0b),子屏 ElecCostView 认 ?p=YYYY-MM 落月(只有年 → 停在它的月门) ──
// 改前发的是 view=cost —— 键名对不上,永远落在报送台账(假下钻)。openFresh 页签语义不变(spec §4.1)。
function goCost(month?: number): void {
  tabs.openDeep('elec-cost')
  void router.push(periodLink('elec-cost', { p: periodOf(loadedYear.value ?? year.value, month ?? null), extra: { mode: 'cost' } }))
}
interface EcClick { componentType?: string; dataIndex?: number }
function onChartClick(p: unknown): void {
  const e = p as EcClick
  if (e.componentType === 'series' && e.dataIndex != null) goCost(e.dataIndex + 1)
}

// ── 图1:收益四指标月度趋势(万元;缺月断点) ──
// 色按名字存、画时按当前外观取(暗色深蓝换灰蓝)
const TREND = [
  { key: 'parkElecProfit', hue: 'deep' },
  { key: 'pvInvestIncome', hue: 'teal' },
  { key: 'basicElecProfit', hue: 'blue' },
  { key: 'sellAgreementPnl', hue: 'amber' },
] as const
const trendHasData = computed(() => TREND.some(({ key }) => metricSeries(key).some((v) => v != null)))
const trendOption = computed<object>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
  legend: { top: 0 },
  grid: { left: 56, right: 16, top: 32, bottom: 26 },
  // S 档隔一标(1/3/5/7/9/11 月):12 个月标在 390 宽的绘图区里靠 hideOverlap 挑,挑出来的那几个
  // 是贪心的结果(可能是 1/4/7/10),读起来没有节奏。interval:1 钉成固定的单月序。>600 取 'auto' = 引擎默认,桌面零差异。
  xAxis: { type: 'category', data: MLABELS, boundaryGap: false, axisLabel: { interval: isS ? 1 : 'auto' } },
  yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
  series: TREND.map(({ key, hue }) => ({
    name: metricLabel(key, key), type: 'line', symbol: 'circle', symbolSize: 4,
    itemStyle: { color: hues()[hue] }, lineStyle: { width: 2, color: hues()[hue] },
    data: metricSeries(key).map((v) => (v == null ? null : +(v / 1e4).toFixed(2))),
  })),
}))

// ── 读数句:三张图各一句默认态常驻文字(不用悬停也读得到最新一期)。
// 数全取自上面已经在算的那几条序列,不新增指标。月下标 0..11。
const lastWhere = (ok: (i: number) => boolean): number => {
  for (let i = 11; i >= 0; i--) if (ok(i)) return i
  return -1
}
const countWhere = (ok: (i: number) => boolean): number => {
  let n = 0
  for (let i = 0; i < 12; i++) if (ok(i)) n++
  return n
}

// 图1 读数:最新有数月的园区电费收益(= trendOption.series[0] 那条线)+ 与上月的差
const trendRead = computed(() => {
  const s = metricSeries(TREND[0].key)
  const i = lastWhere((k) => s[k] != null)
  if (i < 0) return null
  const prev = i > 0 ? s[i - 1] : null
  return {
    mon: i + 1,
    label: metricLabel(TREND[0].key, '园区电费收益'),
    val: fnum(s[i]! / 1e4, 1),
    // 上月缺源(或最新月就是 1 月)→ 整个「比上月」从句不出现,不编一个 0
    delta: prev == null ? '' : sgn((s[i]! - prev) / 1e4, 1, ' 万'),
    n: countWhere((k) => s[k] != null),
  }
})

// ── 图2:总表电费结构堆叠柱(拆分口径:拆分行在场以 Σ拆分为准,否则取合计行 — ELEC-COST §3) ──
const kindOf = computed(() => new Map(meters.value.map((m) => [m.id, m.kind])))
const mk = (r: ElecCostEntryDTO) => kindOf.value.get(r.meterId)
// ponytail: 总表期别按名称含「二期」判(种子名);其余 master 归一期(三期物理接一期,ELEC-COST §0)
const isP2 = (r: ElecCostEntryDTO): boolean => r.meterName.includes('二期')

function feeAmt(rows: ElecCostEntryDTO[], pick: (r: ElecCostEntryDTO) => boolean): number | null {
  const hit = rows.filter(pick)
  if (!hit.length) return null
  const byMeter = new Map<number, ElecCostEntryDTO[]>()
  for (const r of hit) {
    const a = byMeter.get(r.meterId) ?? []
    a.push(r)
    byMeter.set(r.meterId, a)
  }
  let sum = 0
  for (const rs of byMeter.values()) {
    const splits = rs.filter((r) => r.subKey !== '')
    for (const r of splits.length ? splits : rs) sum += r.amount
  }
  return sum
}
const neg = (v: number | null): number | null => (v == null ? null : -v)
// 运营净额 = ops 电表费用 − 分摊额度(指标 6 同口径)
function opsNet(rows: ElecCostEntryDTO[]): number | null {
  const u = feeAmt(rows, (r) => mk(r) === 'ops' && r.feeKey === 'usage')
  const a = feeAmt(rows, (r) => mk(r) === 'ops' && r.feeKey === 'allocated')
  return u == null && a == null ? null : (u ?? 0) - (a ?? 0)
}
interface Seg { name: string; color: string; of: (rows: ElecCostEntryDTO[]) => number | null }
const SEGS = (h: ReturnType<typeof hues>): Seg[] => [   // 画时按当前外观取色
  { name: '一期·分时', color: h.deep, of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && !isP2(r) && r.feeKey === 'tou_industrial') },
  { name: '一期·基本', color: h.blue, of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && !isP2(r) && r.feeKey === 'basic_industrial') },
  { name: '一期·商业', color: h.mid, of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && !isP2(r) && r.feeKey === 'commercial') },
  { name: '二期·分时', color: h.teal, of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && isP2(r) && r.feeKey === 'tou_industrial') },
  { name: '二期·基本', color: '#B7E2D2', of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && isP2(r) && r.feeKey === 'basic_industrial') },
  { name: '宿舍', color: h.amber, of: (rows) => feeAmt(rows, (r) => mk(r) === 'dorm' && r.feeKey === 'usage') },
  { name: '运营净额', color: h.coral, of: opsNet },
  // 抵减段(负向):录入为正金额,展示取负 — 奖励与上网收益冲减当月总表电费
  { name: '功率因数奖励(抵减)', color: '#94A3B8', of: (rows) => neg(feeAmt(rows, (r) => r.feeKey === 'pf_reward')) },
  { name: '光伏上网收益(抵减)', color: '#CBD5E1', of: (rows) => neg(feeAmt(rows, (r) => r.feeKey === 'pv_grid_income')) },
]
/** 真正画在屏上的那几段(金额仍是元,下标 = 月-1)。
 *
 *  桌面 = SEGS 原样九段。S 档并档:九段堆在 390 宽的柱子上,最小的一段只剩 2px 级,
 *  九行图例还会把绘图区挤没。并法按**已有的分组**,不按占比乱并:
 *    · 全年正向合计排名取前 3,单列;
 *    · 其余里**有过正值**的并成「其余 N 项」,**有过负值**的并成「抵减 M 项」。
 *  正负分两段并、不混加 —— 混加会把零轴下方那两段(功率因数奖励 / 光伏上网收益)吃进柱高里,
 *  屏上读到的柱顶就不再是 structRead 印的那个分母。九项逐项要看的,走结论条深链成本总览那个月。
 *
 *  图与读数句共用这一份:句里点名的段,一定是图例上找得到的那一段。 */
interface Col { name: string; color: string; vals: (number | null)[] }
const structCols = computed<Col[]>(() => {
  const cols: Col[] = SEGS(hues()).map((s) => ({
    name: s.name, color: s.color, vals: entryMonths.value.map((rows) => s.of(rows)),
  }))
  if (!isS) return cols
  const posSum = (vs: (number | null)[]): number => vs.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0)
  const rank = [...cols].sort((a, b) => posSum(b.vals) - posSum(a.vals))
  const rest = rank.slice(3)
  if (rest.length < 2) return cols   // 并不出两段以上就别并,「其余 1 项」比原名还难读
  const fold = (src: Col[], pick: (v: number) => number): (number | null)[] =>
    entryMonths.value.map((_, i) => {
      const vs = src.map((c) => c.vals[i]).filter((v): v is number => v != null)
      return vs.length ? vs.reduce((a, v) => a + pick(v), 0) : null
    })
  const ups = rest.filter((c) => c.vals.some((v) => (v ?? 0) > 0))
  const downs = rest.filter((c) => c.vals.some((v) => (v ?? 0) < 0))
  const h = hues()
  return [
    ...rank.slice(0, 3),
    ...(ups.length ? [{ name: `其余 ${ups.length} 项`, color: h.mid, vals: fold(ups, (v) => Math.max(0, v)) }] : []),
    // 颜色取抵减段自己的(SEGS 末段「光伏上网收益(抵减)」),不再复制一份十六进制 ——
    // 颜色字面量有门禁(colorLiterals.spec,只减不增),而且两处同色写两遍以后必然走散。
    ...(downs.length ? [{ name: `抵减 ${downs.length} 项`, color: downs[0].color, vals: fold(downs, (v) => Math.min(0, v)) }] : []),
  ]
})
const structOption = computed<object>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
  legend: { top: 0, itemWidth: 12, itemHeight: 8 },
  grid: { left: 56, right: 16, top: 56, bottom: 26 },
  xAxis: { type: 'category', data: MLABELS, axisLabel: { interval: isS ? 1 : 'auto' } },
  yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
  series: structCols.value.map((s) => ({
    name: s.name, type: 'bar', stack: 'st', barMaxWidth: 30, itemStyle: { color: s.color },
    data: s.vals.map((v) => (v == null ? null : +(v / 1e4).toFixed(2))),
  })),
}))

// 图2 读数:最新有费项月的**正向段**合计 + 最大的一段占比。
//
// ⚠ 分母按**符号**切,不按下标切。原先写的是 SEGS().slice(0, 7)「末两段是抵减」,两个毛病:
//   ① 第 7 段「运营净额」自己就是带号的(opsNet = 电表费用 − 分摊额度),它为负时会把分母吃掉 ——
//      一期·分时 100万、运营净额 −60万,分母算成 40万,占比印出 250%;
//   ② 以后往 SEGS 中间插一段,抵减段的下标一变,这句话当场错号。
// 取 Σ max(0, v) 之后,分母恒等于堆叠柱正向一侧的柱高,就是用户从图上读到的那个顶点。
// 屏上因此写「正向电费」不写「电费合计」—— 净额比它低,同卡 hint 也明写那两段画在零轴下方。
const structRead = computed(() => {
  // 段取自 structCols —— 与图例同一份。S 档并档之后还去读原始九段的话,这句会点名一个
  // 图例上根本没有的段名(「宿舍占 12%」,而图上只有 Top3 与「其余 N 项」)。
  const cols = structCols.value
  const valsOf = (i: number) => cols.map((c) => c.vals[i] ?? null)
  const has = (i: number) => valsOf(i).some((v) => v != null)
  const i = lastWhere(has)
  if (i < 0) return null
  const vs = valsOf(i)
  const total = vs.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0)
  if (total <= 0) return null
  let top = cols[0].name, topV = -Infinity
  vs.forEach((v, k) => { if ((v ?? 0) > topV) { topV = v ?? 0; top = cols[k].name } })
  return {
    mon: i + 1,
    total: fnum(total / 1e4, 1),
    top,
    pct: Math.min(100, Math.round((Math.max(0, topV) / total) * 100)),
    n: countWhere(has),
  }
})

// ── 图3:购售价差双轴(公告价 vs 执行价 双线 元/kWh + 售电月损益柱 万元) ──
function priceOf(mi: number, key: string): number | null {
  return priceMonths.value[mi]?.find((c) => c.cfgKey === key)?.value ?? null
}
const posted = computed(() => Array.from({ length: 12 }, (_, i) => priceOf(i, 'grid_posted_price')))
const execP = computed(() => Array.from({ length: 12 }, (_, i) => priceOf(i, 'third_party_price')))
const sellPnl = computed(() => metricSeries('sellAgreementPnl'))
const spreadHasData = computed(() =>
  posted.value.some((v) => v != null) || execP.value.some((v) => v != null) || sellPnl.value.some((v) => v != null))
const spreadOption = computed<object>(() => ({
  tooltip: {
    trigger: 'axis',
    formatter: (ps: { seriesName: string; value: number | null; axisValue: string; marker: string }[]) =>
      ps[0].axisValue + ps.map((p) =>
        `<br/>${p.marker}${p.seriesName} ${p.value == null ? '—' : p.seriesName.includes('价') ? p.value.toFixed(3) + ' 元/kWh' : (p.value < 0 ? '−' : '') + '¥' + fnum(Math.abs(p.value), 1) + '万'}`).join(''),
  },
  legend: { top: 0 },
  grid: { left: 52, right: 52, top: 32, bottom: 26 },
  xAxis: { type: 'category', data: MLABELS, axisLabel: { interval: isS ? 1 : 'auto' } },
  yAxis: [
    { type: 'value', axisLabel: { formatter: '{value} 万' } },
    { type: 'value', scale: true, axisLabel: { formatter: '{value} 元' }, splitLine: { show: false } },
  ],
  series: [
    {
      name: '售电协议月损益', type: 'bar', yAxisIndex: 0, barMaxWidth: 26,
      data: sellPnl.value.map((v) => (v == null ? null
        : { value: +(v / 1e4).toFixed(2), itemStyle: { color: v < 0 ? hues().red : hues().pale, borderRadius: [3, 3, 0, 0] } })),
    },
    {
      name: '公告价', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 4,
      itemStyle: { color: hues().deep }, lineStyle: { width: 2, color: hues().deep },
      data: posted.value.map((v) => (v == null ? null : +v.toFixed(4))),
    },
    {
      name: '执行价', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 4,
      itemStyle: { color: hues().amber }, lineStyle: { width: 2, type: 'dashed', color: hues().amber },
      data: execP.value.map((v) => (v == null ? null : +v.toFixed(4))),
    },
  ],
}))

// 图3 读数:最新两价都有数的月,执行价 + 它比公告价高/低多少(差值即卡名「购售价差」)
const spreadRead = computed(() => {
  const p = posted.value, e = execP.value
  const both = (i: number) => p[i] != null && e[i] != null
  const i = lastWhere(both)
  if (i < 0) return null
  const d = e[i]! - p[i]!
  return {
    mon: i + 1,
    exec: e[i]!.toFixed(3),
    diff: Math.abs(d) < 5e-4 ? '持平' : (d < 0 ? '低 ' : '高 ') + Math.abs(d).toFixed(3),
    n: countWhere(both),
  }
})
</script>

<template>
  <!-- §五:年敏感屏(指标为年度月序),只年控件 -->
  <AnaShell period-mode="year" :busy="staleShown">
    <!-- 首进:版式已知就不转圈(C6-01)。块高逐块照真版式钉死 ——
         页头 44;结论条 .ea-concl 一行 20(与真版式同一批类,padding / margin-bottom 由 CSS 给);
         卡头 20 + ana.css .av2-card-h margin-bottom 8 = 28(行盒 20 = base.css body line-height var(--lh-snug) = tokens.css 20px);
         图块 = AnaSkelChart,高与各 AnaEChart 的 :height 同表降档(300 / 300 / 300,anaChartHeight.ts);
         每张图下的读数句 20(.ana-read 上距 8)+ 参照小字 20(.ana-ref 上距 2),三张卡各一对。
         .ea-simbar 随 hasSim 出没,骨架不占它的位。数据到了原地硬切,不做淡入。
         只认首进(还没有任何一年画过):换年时旧内容留在原地退让(C5-02),不退回骨架、不卸载图。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <div v-if="loading && loadedYear == null" class="ak-page ak-skel">
      <!-- 页头、结论条、卡头照抄真版式(手机上会折行,灰条顶不住);随数据变的字换成同长的隐形占位。
           模拟数据说明条跟 hasSim 走,库里现有电费数据全是模拟填充,骨架按「有」留位 ——
           换成真实电费单后首进会上收这一条的高(约 41px),届时把这条删掉。 -->
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('zap')" :size="20" /></span>
          <div>
            <h2 class="ak-title">电费成本分析</h2>
            <p class="ak-sub">收益四指标趋势 · 总表电费结构 · 购售价差 · <span class="ana-hole">0000</span>年</p>
          </div>
        </div>
      </div>
      <div class="ea-simbar">
        <component :is="iconFor('flask-conical')" :size="13" />
        <span>本页含模拟数据(灰标口径),真实电费单导入后自动替换</span>
      </div>
      <div class="av2-card ea-concl">
        <!-- 真版式是 button:按钮的行高不继承,用 span 会差出行盒;visibility:hidden 的按钮不进 tab 序 -->
        <button v-for="t in ['0000 年园区电费收益累计 ¥000.0 万(00 个月)', '0000 年光伏投资收益累计 ¥000.0 万(00 个月)', '0000 年基本用电费收益累计 ¥000.0 万(00 个月)', '0000 年售电协议损益累计 ¥00.0 万(00 个月)']"
          :key="t" type="button" class="ea-cs ana-hole"><span class="dot"></span>{{ t }}<span class="ea-ar" aria-hidden="true">›</span></button>
      </div>
      <div class="av2-grid">
        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">收益四指标月度趋势 · <span class="ana-hole">0000</span>年</span>
            <span class="hint">万元 · 缺源月断点不补 0<span class="hint-desk"> · 点击深链成本总览对应月</span><span class="hint-touch"> · 点图看成本总览</span></span>
          </div>
          <AnaSkelChart :height="300" />
          <p class="ana-read"><span class="ana-hole">00月园区电费收益 000.0 万,比上月 +00.0 万</span></p>
          <p class="ana-ref"><span class="ana-hole">园区电费收益 00 个月有数 · 同成本总览 · 万元</span></p>
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">总表电费结构</span>
            <span class="hint">万元 · 奖励/上网收益为负向抵减段</span>
          </div>
          <AnaSkelChart :height="300" />
          <p class="ana-read"><span class="ana-hole">00月正向电费 000.0 万,二期·基本占 00%</span></p>
          <p class="ana-ref"><span class="ana-hole">00 个月有费项 · 合计与分母均不含抵减 · 万元</span></p>
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">购售价差</span>
            <span class="hint">线=双价(元/kWh,右轴) · 柱=月损益(万,左轴)</span>
          </div>
          <AnaSkelChart :height="300" />
          <p class="ana-read"><span class="ana-hole">00月执行价 0.000 元,比公告价低 0.000</span></p>
          <p class="ana-ref"><span class="ana-hole">00 个月有双价 · 同成本总览 · 元/kWh</span></p>
        </div>
      </div>
    </div>
    <!-- skel:end -->
    <AnaEmpty v-else-if="failed" label="数据加载失败" hint="请刷新重试" />
    <!-- data-stale-host 常挂:类摘掉后仍有 transition-property,退场才是 200 而不是硬切 -->
    <div v-else class="ak-page" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('zap')" :size="20" /></span>
          <div>
            <h2 class="ak-title">电费成本分析</h2>
            <p class="ak-sub">收益四指标趋势 · 总表电费结构 · 购售价差 · {{ loadedYear }}年</p>
          </div>
        </div>
      </div>

      <!-- simulated 常驻说明条(spec §1:灰标口径) -->
      <div v-if="hasSim" class="ea-simbar">
        <component :is="iconFor('flask-conical')" :size="13" />
        <span>本页含模拟数据(灰标口径),真实电费单导入后自动替换</span>
      </div>

      <!-- 护栏:该年费项数据全空 → 空态引导成本总览,不画假图 -->
      <AnaEmpty
        v-if="!hasEntries"
        :label="loadedYear + ' 年电费成本模型无费项数据'"
        hint="本屏依赖电费成本总览的总表/宿舍/运营费项月度值;先录入或用模拟填充"
        to="/elec-cost"
        to-text="去电费成本总览"
      />

      <template v-else>
        <!-- 结论条:4 指标年累计,人话一句(cv2-concl 同款;点击深链成本总览) -->
        <div class="av2-card ea-concl">
          <!-- 行尾那枚 › 只在 S 档出:这四句本来就是 button(点进成本总览),桌面上悬停有手型说明了
               这件事,手机上没有悬停,于是把已有的可点性写出来。不是新功能,也不改 @click。 -->
          <button v-for="c in conclusion" :key="c.key" class="ea-cs" @click="goCost()">
            <span class="dot" :style="{ background: STATUS[c.tone].color }"></span>{{ c.text }}<span class="ea-ar" aria-hidden="true">›</span>
          </button>
        </div>

        <div class="av2-grid">
          <!-- 图1 s12:收益四指标月度趋势;本屏无 s8 屏,av2-core 人工点名——结论条总结的正是这四指标,首图即主叙事 -->
          <div class="av2-card av2-s12 av2-core">
            <div class="av2-card-h">
              <span class="t">收益四指标月度趋势 · {{ loadedYear }}年</span>
              <span class="hint">万元 · 缺源月断点不补 0<span class="hint-desk"> · 点击深链成本总览对应月</span><span class="hint-touch"> · 点图看成本总览</span></span>
            </div>
            <AnaEChart v-if="trendHasData" :option="trendOption" :height="300" @chart-click="onChartClick" />
            <AnaEmpty v-else :label="loadedYear + ' 年四指标全月不可算'" hint="各指标缺失数据源见成本总览派生指标表" to="/elec-cost" to-text="去电费成本总览" />
            <!-- hold:图的门是「四条线里任一有数」,句的门只是第一条线 —— 图在句没了的情况真会出现,
                 而骨架那两行是无条件画的,不占位就会反向塌两行(照 :501-502 CockpitView 的现成写法)。 -->
            <p class="ana-read hold"><template v-if="trendRead">{{ trendRead.mon }}月{{ trendRead.label }} {{ trendRead.val }} 万<span v-if="trendRead.delta">,比上月 {{ trendRead.delta }}</span></template></p>
            <p class="ana-ref hold"><template v-if="trendRead">园区电费收益 {{ trendRead.n }} 个月有数 · 同成本总览 · 万元</template></p>
          </div>

          <!-- 图2 s6:总表电费结构堆叠柱 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">总表电费结构</span>
              <span class="hint">万元 · 奖励/上网收益为负向抵减段</span>
            </div>
            <AnaEChart :option="structOption" :height="300" @chart-click="onChartClick" />
            <p class="ana-read hold"><template v-if="structRead">{{ structRead.mon }}月正向电费 {{ structRead.total }} 万,{{ structRead.top }}占 {{ structRead.pct }}%</template></p>
            <p class="ana-ref hold"><template v-if="structRead">{{ structRead.n }} 个月有费项 · 合计与分母均不含抵减 · 万元</template></p>
          </div>

          <!-- 图3 s6:购售价差双轴 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">购售价差</span>
              <span class="hint">线=双价(元/kWh,右轴) · 柱=月损益(万,左轴)</span>
            </div>
            <AnaEChart v-if="spreadHasData" :option="spreadOption" :height="300" @chart-click="onChartClick" />
            <AnaEmpty v-else label="双价参数未录" hint="公告价/执行价按月录于成本总览电价参数(或模拟填充)" to="/elec-cost" to-text="去电费成本总览" />
            <p class="ana-read hold"><template v-if="spreadRead">{{ spreadRead.mon }}月执行价 {{ spreadRead.exec }} 元,比公告价{{ spreadRead.diff }}</template></p>
            <p class="ana-ref hold"><template v-if="spreadRead">{{ spreadRead.n }} 个月有双价 · 同成本总览 · 元/kWh</template></p>
          </div>
        </div>

      </template>
    </div>
  </AnaShell>
</template>

<style scoped>
/* simulated 说明条(仿 ana-pbanner,灰标口径用中性色) */
.ea-simbar { display: flex; align-items: center; gap: 6px; background: var(--surface-sunken); color: var(--text-secondary); border-radius: 8px; padding: 7px 12px; font-size: var(--fs-micro); line-height: 1.4; margin-bottom: 12px; }
.ea-simbar svg { flex: 0 0 auto; }
/* 结论条(仿驾驶舱 cv2-concl:分句圆点,整句可点深链) */
.ea-concl { display: flex; flex-wrap: wrap; align-items: center; column-gap: 20px; row-gap: 6px; margin-bottom: 12px; }
.ea-cs { display: inline-flex; align-items: center; gap: 7px; border: none; background: transparent; padding: 0; font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-primary); cursor: pointer; }
.ea-cs:hover { text-decoration: underline; }
.ea-cs .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
/* 行尾 ›:桌面不出(那里有悬停手型),>600 连盒子都不占 */
.ea-ar { display: none; }

/* S 档(≤600)阅读序与排布。.ak-page 是 flex column,order 对它的直接子项生效 ——
   ana.css 那块 order 只管 .av2-grid 的格子,结论条与模拟条是 .ak-page 的兄弟,得在这里排。
   模拟数据说明条一个字都不删(数据诚实),只是让位:它不是结论,不该占第一眼。
   DOM 序不动,所以 >600 完全没有 order 声明,桌面零差异。 */
@media (max-width: 600px) {
  .ak-head { order: -2; }
  /* 结论条提到模拟条前面,并从 wrap 成行改成一句一行(390 上四句本来也各占一行,钉死它) */
  .ea-concl { order: -1; flex-direction: column; align-items: stretch; }
  .ea-cs { width: 100%; text-align: left; }
  .ea-ar { display: inline-flex; margin-left: auto; padding-left: 8px; color: var(--text-link); }
}
</style>
