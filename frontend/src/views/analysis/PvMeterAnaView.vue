<script setup lang="ts">
// 光伏分栋分析(pv-meter-analysis)— PV-ANALYSIS-SPEC §06。
// 第一层:四张卡 + 楼栋明细表 + 一张近 13 个月图。主体是**表不是图** ——
// 非专业者多对象比较正确率:彩色圆点 84.3% ≫ 条形图 54.2%(§01)。
//
// 铁律(§06.4):**一份数据、一次计算、一个 snapshot id**。整屏只跑一次 buildSnapshot,
// 第一层渲染它的摘要面,工作台(Task 12)渲染同一个对象的完整面,页脚都显示同一个 id。
// 工作台永远不是另一次计算 —— 对不上时要能 30 秒定位到是哪一层渲染错了,而不是怀疑模型。
//
// 期间语义:AnaShell periodMode='year'(整年数据喂模型,统计要一年才站得住),
// 但门面数是**该年最后一个有抄表的月**(snapshot.ym)—— 财务问的是「这个月挣了多少」。
// 两者不冲突但必须写清楚,所以卡片标题带上月份,不写「本月」二字。
//
// ⚠ 第一层永不出现:p / q / 置信区间 / 显著 / 残差 / 归一化 / PR / α / β / kWh/kWp / 等效利用小时。
//   不确定性用**语言标签 + 数值区间**表达(§06「不确定性怎么说」)。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import { usePeriod } from '@/analysis/usePeriod'
import { useCompare, type CompareMode } from '@/analysis/useCompare'
import { iconFor } from '@/components/ds/icon'
import { fnum, fint } from '@/components/ana/anaFmt'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { weatherApi, type WeatherDayDTO } from '@/api/weather'
import {
  buildLab, buildSnapshot, cpPhrase, RISK_ANNUAL_GAP, WATCH_ANNUAL_GAP,
  type AnaSnapshot, type SnapshotInput, type StationResult,
} from './pvMeterAna.logic'

// 支持集是**模块级常量**:传给 AnaShell 的与本屏自己读的必须同一份引用(§06 约束)。
// 屏自己也要 useCompare(CMP) 读 mode —— 只把 CMP 传给 AnaShell 的话开关画得出来但点了没反应。
const CMP: CompareMode[] = ['yoy']

// 上网标杆价(脱硫煤)。自用价走 price_snap 逐行快照,不在这里定 —— §5.7:
// 少发的那度要从电网买回来,损失的是**自用电价**不是上网价,搞错了整屏的数就是错的。
const GRID_PRICE = 0.391
// 方法页要把门槛写出来 —— 从 logic 取,不在模板里写死第二份
const RISK_GAP = RISK_ANNUAL_GAP
const WATCH_GAP = WATCH_ANNUAL_GAP

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const cmp = useCompare(CMP)
// periodMode='year' 只许读 year。读 gran/month 会拿到与界面无关的值(AnaShell.spec.ts:35 守着)
const year = computed(() => period.sel.value.year)

const stations = ref<PvStationDTO[]>([])
const readings = ref<PvReadingDTO[]>([])
// 上一年:只在用户真的打开同比时才取。undefined = 没取过(同比位显「未取上一年数据」),
// [] = 取过但上一年真的没有 —— 两者措辞不同,不能混
const prevReadings = ref<PvReadingDTO[] | undefined>(undefined)
const weather = ref<WeatherDayDTO[]>([])
const loading = ref(true)
const failed = ref(false)
let seq = 0

async function load(y: number) {
  const my = ++seq
  loading.value = true
  failed.value = false
  try {
    const [sts, rds, wx] = await Promise.all([
      stations.value.length ? Promise.resolve(stations.value) : pvMeterApi.stations(),
      pvMeterApi.readingsYear(y),
      // 天气是可选的:没导过就是空数组,分析照跑但不做辐照校准(质量记录里说明)
      weatherApi.daily(y).catch(() => [] as WeatherDayDTO[]),
    ])
    if (my !== seq) return
    stations.value = sts
    readings.value = rds
    weather.value = wx
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
    if (my === seq) prevReadings.value = undefined   // 取失败 ≠ 上一年没有,不能显成「没得比」
  }
}
onMounted(() => { void load(year.value) })
watch(year, (y) => { void load(y) })
// 打开同比才去取上一年 —— 没人看的时候不多打一次接口
watch(cmp.mode, (m) => { if (m === 'yoy' && prevReadings.value === undefined) void loadPrev(year.value, seq) })

// ── 唯一的一次计算 ────────────────────────────────────────────────────
const labInput = computed<SnapshotInput | null>(() => {
  if (!readings.value.length) return null
  return {
    year: year.value,
    stations: stations.value.map(s => ({
      id: s.id, name: s.name, capKwp: s.capacityKwp, metered: s.metered === 1,
    })),
    rows: readings.value.map(r => ({
      stationId: r.stationId, date: r.readDate, gen: r.genTotal,
      selfUse: r.selfUse, gridFeed: r.gridFeed, revenue: r.revenue, priceSnap: r.priceSnap,
    })),
    weather: weather.value.map(w => ({
      date: w.date, ghiKwh: w.ghiKwh, rainMm: w.rainMm ?? 0, isRain: w.isRain,
      hours: w.hours, hourMask: w.hourMask,
    })),
    prevRows: prevReadings.value?.map(r => ({
      stationId: r.stationId, date: r.readDate, gen: r.genTotal,
      selfUse: r.selfUse, gridFeed: r.gridFeed, revenue: r.revenue, priceSnap: r.priceSnap,
    })),
    gridPrice: GRID_PRICE,
  }
})
const snap = computed<AnaSnapshot | null>(() => labInput.value ? buildSnapshot(labInput.value) : null)

const ymLabel = computed(() => {
  const ym = snap.value?.ym ?? ''
  return ym ? `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月` : '—'
})

// 自用加权均价:逐行 price_snap 的中位,用于「电价口径」说明(不另引一套价)
const selfPrice = computed(() => {
  const ps = readings.value.map(r => r.priceSnap).filter((v): v is number => v != null && v > 0)
  if (!ps.length) return null
  const s = [...ps].sort((a, b) => a - b)
  return s[s.length >> 1]
})

// ── 状态灯筛选(点卡片筛下方列表) ──
const filterStatus = ref<StationResult['status'] | null>(null)
const rows = computed(() => {
  const all = snap.value?.stations ?? []
  return filterStatus.value ? all.filter(r => r.status === filterStatus.value) : all
})
function toggleFilter(s: StationResult['status']) {
  filterStatus.value = filterStatus.value === s ? null : s
}

const DOT: Record<StationResult['status'], string> =
  { risk: 'var(--hue-red)', watch: 'var(--hue-orange)', ok: 'var(--hue-green)', mute: 'var(--text-muted)' }

const yuan = (v: number) => '¥' + fint(v)
const wan = (v: number) => fnum(v / 10000, 1)

// ── 三段写死的文案(§06.1)。「这个数怎么来的」一字不要改 ──
const openNote = ref<'how' | 'price' | null>(null)

// ── 近 13 个月:柱=发电量(万度) 实线=实际收益 虚线=应得收益 ──
// ECharts option 是纯 JSON,**不能引用 CSS 变量**,颜色只能写字面值(§06 约束④)
const chartOpt = computed<object>(() => {
  const m = snap.value?.monthly
  if (!m) return {}
  return {
    tooltip: { trigger: 'axis' },
    // 图例名不带单位:轴名已经写了「万度」「万元」,再带一遍三项在窄屏下会互相压
    legend: { top: 0, data: ['发电量', '实际收益', '应得收益'] },
    grid: { left: 52, right: 52, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: m.labels.map(l => Number(l.slice(5, 7)) + '月') },
    yAxis: [
      { type: 'value', name: '万度', nameTextStyle: { fontSize: 10 } },
      { type: 'value', name: '万元', nameTextStyle: { fontSize: 10 } },
    ],
    series: [
      {
        name: '发电量', type: 'bar', yAxisIndex: 0, barMaxWidth: 22,
        itemStyle: { color: '#B5D4F4', borderRadius: [3, 3, 0, 0] },
        data: m.kwh.map(v => +(v / 10000).toFixed(2)),
      },
      {
        name: '应得收益', type: 'line', yAxisIndex: 1, symbol: 'none',
        lineStyle: { width: 1.6, type: 'dashed', color: '#8A8A85' }, itemStyle: { color: '#8A8A85' },
        data: m.due.map(v => +(v / 10000).toFixed(2)),
      },
      {
        name: '实际收益', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 2.2, color: '#1F5FBF' }, itemStyle: { color: '#1F5FBF' },
        data: m.actual.map(v => +(v / 10000).toFixed(2)),
      },
    ],
  }
})

// ── 第二层 · 单栋详情(§06.2)────────────────────────────────────────────
// **同一个 URL 加锚点,不是另一套页面**。未选中站时整区**不渲染**(不是渲染空态)。
const selId = ref<number | null>(null)
const sel = computed(() => snap.value?.stations.find(r => r.id === selId.value) ?? null)
const selDetail = computed(() => sel.value?.detail ?? null)
// 技术细节默认收起:财务主管一进去看见残差和波动带,会认定「这屏不是给我用的」
const showTech = ref(false)

function pickStation(r: StationResult): void {
  // 不参与判定的站没有逐日明细 —— 点了不开,不弹一张空图
  if (!r.detail) return
  selId.value = selId.value === r.id ? null : r.id
  if (selId.value) location.hash = `#s${r.id}`
}
watch(snap, () => { if (sel.value == null) selId.value = null })
onMounted(() => {
  const m = /^#s(\d+)$/.exec(location.hash)
  if (m) selId.value = Number(m[1])
  // §06.4:工作台也可直达。刻意不给第一层放显眼入口,但知道路的人能直接来
  if (location.hash === '#lab') layer3.value = 'lab'
  if (location.hash === '#method') layer3.value = 'method'
})

const cpText = computed(() => (selDetail.value ? cpPhrase(selDetail.value) : ''))

// 主图:累计缺口曲线(纵轴=元)。折点=开始变差、斜率=元/天、终点=至今一共亏多少 ——
// 决策要的三样都在这一张里,不用解释坐标系
const cumOpt = computed<object>(() => {
  const d = selDetail.value
  if (!d) return {}
  const cpIdx = d.cpDate ? d.dates.indexOf(d.cpDate) : -1
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => '¥' + Math.round(v).toLocaleString('en-US') },
    grid: { left: 66, right: 20, top: 26, bottom: 30 },
    xAxis: { type: 'category', data: d.dates, axisLabel: { formatter: (v: string) => v.slice(5) } },
    yAxis: { type: 'value', name: '元', nameTextStyle: { fontSize: 10 } },
    series: [{
      type: 'line', symbol: 'none', data: d.gapCum.map(v => +v.toFixed(0)),
      lineStyle: { width: 2.2, color: '#BF3735' },
      areaStyle: { color: 'rgba(191,55,53,.10)' },
      markLine: cpIdx < 0 ? undefined : {
        silent: true, symbol: 'none',
        label: { formatter: cpText.value, fontSize: 11, color: '#BF3735' },
        lineStyle: { color: '#BF3735', type: 'dashed', width: 1 },
        data: [{ xAxis: cpIdx }],
      },
    }],
  }
})

// 发电量 vs 园区基准散点,变点前后分色 —— 标题写人话,不写「Yf–Yr 散点」
const scatterOpt = computed<object>(() => {
  const d = selDetail.value
  if (!d) return {}
  const cut = d.cpDate ? d.dates.indexOf(d.cpDate) : d.dates.length
  const pts = (from: number, to: number) =>
    d.dates.slice(from, to).map((_, k) => [+d.expected[from + k].toFixed(1), +d.gen[from + k].toFixed(1)])
  return {
    tooltip: { trigger: 'item', formatter: (p: { value: number[] }) => `应发 ${p.value[0]} / 实发 ${p.value[1]} 度` },
    legend: { top: 0, data: ['变差之前', '变差之后'] },
    grid: { left: 56, right: 16, top: 30, bottom: 34 },
    xAxis: { type: 'value', name: '同样天气下应发(度)', nameLocation: 'middle', nameGap: 22, nameTextStyle: { fontSize: 10 }, scale: true },
    yAxis: { type: 'value', name: '实发(度)', nameTextStyle: { fontSize: 10 }, scale: true },
    series: [
      { name: '变差之前', type: 'scatter', symbolSize: 5, itemStyle: { color: '#8CBBFF' }, data: pts(0, cut) },
      { name: '变差之后', type: 'scatter', symbolSize: 5, itemStyle: { color: '#BF3735' }, data: pts(cut, d.dates.length) },
    ],
  }
})

// 技术细节:残差时序 + 正常波动范围。y 轴写人话,「±2σ」在界面上叫「正常波动范围」
const residOpt = computed<object>(() => {
  const d = selDetail.value
  if (!d) return {}
  const pct = (v: number) => +((Math.exp(v) - 1) * 100).toFixed(2)
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => v + '%' },
    grid: { left: 56, right: 16, top: 26, bottom: 30 },
    xAxis: { type: 'category', data: d.dates, axisLabel: { formatter: (v: string) => v.slice(5) } },
    yAxis: { type: 'value', name: '每天比应发多/少 %', nameTextStyle: { fontSize: 10 } },
    series: [
      {
        name: '正常波动范围', type: 'line', symbol: 'none', stack: 'band', silent: true,
        lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(140,187,255,.16)' },
        data: d.dates.map(() => pct(-d.sigma)),
      },
      {
        name: '正常波动范围上沿', type: 'line', symbol: 'none', stack: 'band', silent: true,
        lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(140,187,255,.16)' },
        data: d.dates.map(() => pct(d.sigma) - pct(-d.sigma)),
      },
      {
        name: '每天比应发多/少', type: 'line', symbol: 'none',
        lineStyle: { width: 1.4, color: '#1F5FBF' }, data: d.resid.map(pct),
      },
    ],
  }
})

// 月度网格:该栋逐月发电与缺口(财务要能把数字抄进报告)
const selMonthly = computed(() => {
  const d = selDetail.value
  if (!d) return []
  const acc = new Map<string, { gen: number; gap: number }>()
  d.dates.forEach((date, i) => {
    const k = date.slice(0, 7)
    const a = acc.get(k) ?? { gen: 0, gap: 0 }
    a.gen += d.gen[i]
    a.gap += Math.max(0, d.expected[i] - d.gen[i])
    acc.set(k, a)
  })
  return [...acc.entries()].map(([ym, v]) => ({ ym, gen: v.gen, gap: v.gap }))
})

// ── 第三层 · 方法与口径页 / 分析工作台(§06.3、§06.4)────────────────────
// 工作台**刻意不在第一层露面**:财务主管一进去看见 z 值和 ACF 图,
// 会认定「这屏不是给我用的」,连第一层也不再打开。入口在方法页之后,或 #lab 直达。
const layer3 = ref<'none' | 'method' | 'lab'>('none')
const lab = computed(() => {
  if (layer3.value !== 'lab' || !snap.value || !labInput.value) return null
  return buildLab(snap.value, labInput.value)
})
const labStation = ref<number | null>(null)
const labAcf = computed(() =>
  lab.value?.acf.find(a => a.id === (labStation.value ?? lab.value?.acf[0]?.id)) ?? null)
const labDoy = computed(() =>
  lab.value?.doy.find(a => a.id === (labStation.value ?? lab.value?.doy[0]?.id)) ?? null)

const acfOpt = computed<object>(() => {
  const a = labAcf.value
  if (!a) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 46, right: 14, top: 24, bottom: 26 },
    xAxis: { type: 'category', data: a.rho.map((_, k) => k), name: 'lag(天)', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 10 } },
    yAxis: { type: 'value', min: -0.4, max: 1 },
    series: [{ type: 'bar', data: a.rho.map(v => +v.toFixed(3)), itemStyle: { color: '#4C98FD' } }],
  }
})

const doyOpt = computed<object>(() => {
  const d = labDoy.value
  if (!d) return {}
  return {
    tooltip: { trigger: 'item' },
    grid: { left: 52, right: 14, top: 24, bottom: 30 },
    xAxis: { type: 'value', min: 1, max: 366, name: '年积日', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 10 } },
    yAxis: { type: 'value', name: '残差(log)', nameTextStyle: { fontSize: 10 } },
    series: [{ type: 'scatter', symbolSize: 3, itemStyle: { color: '#8CBBFF' }, data: d.pts.map(p => [p.doy, +p.v.toFixed(4)]) }],
  }
})

const nullOpt = computed<object>(() => {
  const n = lab.value?.nullDist
  if (!n) return {}
  const lo = Math.min(...n.dist, n.obs), hi = Math.max(...n.dist, n.obs)
  const bins = 40, w = (hi - lo) / bins || 1
  const hist = new Array(bins).fill(0)
  for (const v of n.dist) hist[Math.min(bins - 1, Math.floor((v - lo) / w))]++
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 46, right: 14, top: 24, bottom: 26 },
    xAxis: { type: 'category', data: hist.map((_, k) => (lo + k * w).toFixed(3)) },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar', data: hist, itemStyle: { color: '#C7D2DE' },
      markLine: {
        silent: true, symbol: 'none',
        label: { formatter: '观测值', fontSize: 11, color: '#BF3735' },
        lineStyle: { color: '#BF3735', width: 2 },
        data: [{ xAxis: Math.min(bins - 1, Math.max(0, Math.floor((n.obs - lo) / w))) }],
      },
    }],
  }
})

const healthOpt = computed<object>(() => {
  const h = lab.value?.health ?? []
  if (!h.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 56, right: 14, top: 24, bottom: 26 },
    xAxis: { type: 'category', data: h.map(x => x.date), axisLabel: { formatter: (v: string) => v.slice(5) } },
    yAxis: { type: 'value', name: 'log H', nameTextStyle: { fontSize: 10 }, scale: true },
    series: [{ type: 'line', symbol: 'none', lineStyle: { width: 1.4, color: '#24785F' }, data: h.map(x => +x.logH.toFixed(4)) }],
  }
})

const alphaOpt = computed<object>(() => {
  const rows = lab.value?.alphaRows ?? []
  if (!rows.length) return {}
  return {
    tooltip: { trigger: 'item', formatter: (p: { name: string; value: number[] }) => `${p.name}: ${p.value[0].toFixed(1)}%` },
    grid: { left: 76, right: 30, top: 24, bottom: 30 },
    // 轴范围要**把区间也算进去**:markLine 不参与坐标轴自动范围,
    // 区间下沿一旦落到散点范围之外就被裁掉 —— 实测真数据上有阶跃的站区间宽约 10 个百分点,
    // 五栋的误差棒整根消失,只剩孤零零的点(而这张图的全部意义就是那根棒)
    xAxis: {
      type: 'value', name: '相对园区中位 %', nameLocation: 'middle', nameGap: 20,
      nameTextStyle: { fontSize: 10 },
      min: Math.floor(Math.min(...rows.map(r => r.ciLo), ...rows.map(r => r.alphaPct)) - 2),
      max: Math.ceil(Math.max(...rows.map(r => r.ciHi), ...rows.map(r => r.alphaPct)) + 2),
    },
    yAxis: { type: 'category', data: rows.map(r => r.name) },
    series: [
      // 误差棒用 markLine 的两点线段画。
      // **不能用两段堆叠柱**:ECharts 正负值分开堆,ciLo 为负时那根透明柱推不动可见柱 ——
      //   实测所有区间都从 0 往右伸,与左边的点断开,这张图就白做了。
      // **也没用 custom**:那要往 echartsBundle 里加 CustomChart(见那个文件开头的警告 ——
      //   漏注册单测测不出来,只有浏览器控制台会喊)。为一根误差棒加一个图表类型不划算,
      //   而 MarkLineComponent 本来就注册着,同样的线段零打包成本。
      {
        type: 'scatter', data: [], silent: true,
        markLine: {
          silent: true, symbol: ['none', 'none'],
          label: { show: false },
          lineStyle: { color: '#7FA9D8', width: 1.6 },
          data: rows.map((r, i) => [
            { coord: [+r.ciLo.toFixed(2), i] },
            { coord: [+r.ciHi.toFixed(2), i] },
          ]),
        },
      },
      { type: 'scatter', symbolSize: 9, itemStyle: { color: '#1F5FBF' }, data: rows.map((r, i) => [+r.alphaPct.toFixed(2), i]) },
    ],
  }
})

// 质量矩阵:站 × 日。**没有「补齐」这一档,因为本实现从不补齐**
const QUALITY_COLOR: Record<string, string> = { ok: '#B5D4F4', missing: '#E8B4B3', dropped: '#D8D8D4' }

function goMeter(): void {
  tabs.openFresh('pv-income', { pin: true })
  void router.push('/pv-income')
}
</script>

<template>
  <AnaShell period-mode="year" :compare="CMP">
    <template #kpis>
      <!-- v-if 必须在 template 的**内层**:挂在标签上条件为假会让 $slots.kpis 不存在,
           容器整条消失、下方内容整体上移(§06 约束②) -->
      <template v-if="!loading && snap">
        <AnaKpiTile
          :label="ymLabel + ' 光伏收益'"
          :value="yuan(snap.park.revenue)"
          :delta="cmp.mode.value === 'yoy' ? snap.yoy.monthPct : null"
          kind="同比"
          :note="cmp.mode.value === 'yoy' && snap.yoy.monthPct == null
            ? snap.yoy.monthNote
            : '自用 ' + fnum(snap.park.selfKwh / 10000, 1) + ' 万度 + 上网 ' + fnum(snap.park.gridKwh / 10000, 1) + ' 万度'"
          :note-tone="cmp.mode.value === 'yoy' && snap.yoy.monthPct == null ? 'warn' : undefined"
        />
        <AnaKpiTile
          :label="'● ' + ymLabel + ' 比应得少'"
          :value="yuan(snap.park.gap)"
          :note="'相当于少发 ' + fnum(snap.park.gapKwh / 10000, 1) + ' 万度'
            + (snap.park.gapPct != null ? ' · 占应得 ' + fnum(snap.park.gapPct, 1) + '%' : '')"
        />
        <!-- 四个计数塞不进 value 槽:实测 .v 只有 159px 而四段要 338px,
             text-overflow:ellipsis 会把后一半吃掉(桌面宽度下也一样)。
             要行动的两档放 value,其余进 note。 -->
        <AnaKpiTile
          label="楼栋状态"
          :value="snap.park.counts.risk + ' 异常 · ' + snap.park.counts.watch + ' 需关注'"
          :note="snap.park.counts.ok + ' 正常 · ' + snap.park.counts.mute + ' 不做判断 · 点灯可筛选'"
        />
        <!-- 投资回收要总投资额,那是电费系统那边的数,现在没有。
             §07 文化:缺就诚实说缺,**不画假图也不填假数**。 -->
        <AnaKpiTile
          label="投资回收"
          value="—"
          note="缺总投资额,暂不可算"
          note-tone="warn"
        />
      </template>
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <AnaEmpty v-else-if="failed" label="数据加载失败" hint="请刷新重试" />

    <!-- 护栏:整年无抄表 → 空态深链,不画假图(既有范式) -->
    <AnaEmpty
      v-else-if="!snap"
      :label="year + ' 年暂无分栋抄表记录'"
      hint="分栋抄表(pv_reading)未录入,无法做任何分析 — 进入附表6 屏后选「分栋抄表明细」录入或导入"
      to="/pv-income"
      to-text="去录入分栋抄表"
    />

    <div v-else class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('sun')" :size="20" /></span>
          <div>
            <h2 class="ak-title">光伏分栋分析</h2>
            <p class="ak-sub">
              {{ ymLabel }} 口径 · 模型用 {{ year }} 年 {{ snap.quality.okDays }} 个有效日 · 共 {{ snap.stations.length }} 栋
            </p>
          </div>
        </div>
      </div>

      <!-- 当日参与站不足 → **整屏降级**并明确告知。4 栋掉线就能污染基准,
           导致全园当天集体误报,不能悄悄照算(§07) -->
      <div v-if="snap.quality.tooFewStations" class="pma-warn">
        园区已装表并录了容量的楼栋只有 {{ snap.stations.length - snap.quality.noMeter.length - snap.quality.noCapacity.length }} 栋，
        不足以互相当基准。本期只给收益与同比，不做楼栋之间的比较。
      </div>
      <div v-if="snap.quality.droppedThin" class="pma-warn">
        有 {{ snap.quality.droppedThin }} 天当天有抄表记录的楼栋不足 {{ 8 }} 栋，同类比较不可靠，
        这些天已整日剔除，不参与任何判断。
      </div>
      <div v-if="!snap.quality.hasWeather" class="pma-warn mut">
        本期未导入天气与辐照数据。楼栋之间的比较照常，但两件事做不了：
        「全园是不是一起在变差」看不出来；低辐照日与气象数据不全的日子也**没有被筛掉**，原样进了模型。
      </div>
      <div v-else-if="snap.quality.unscreenedDays" class="pma-warn mut">
        天气数据覆盖 {{ Math.round(snap.quality.weatherCoverage * 100) }}%（{{ snap.quality.unscreenedDays }} 天没有对应的气象记录）。
        这些天的发电数据<b>照常参与分析</b>——没有气象记录不等于那天不好，只是没被筛过；
        但「全园是不是一起在变差」这一项只在有气象记录的日子上成立。
      </div>

      <!-- ① 这个数怎么来的 —— 整个设计的地基,一字不要改 -->
      <div class="pma-links">
        <button class="pma-lk" @click="openNote = openNote === 'how' ? null : 'how'">这个数怎么来的 ›</button>
        <button class="pma-lk" @click="openNote = openNote === 'price' ? null : 'price'">查看电价口径 ›</button>
      </div>

      <div v-if="openNote === 'how'" class="pma-note">
        <p>
          同一天，园区 {{ snap.stations.length }} 栋楼晒的是同一片太阳。我们用其余楼栋当天的表现，
          推算出「今天这个天气应该发多少」，再乘上这栋楼一贯的水平，得到它今天应发多少度。
          实际比应发少的部分，就是缺口。
        </p>
        <p><b>这个办法的好处</b>：不需要装气象仪，也不受阴天晴天影响——天不好，各栋一起少发，不会被算成缺口。</p>
        <p>
          <b>它看不出来的</b>：如果各栋楼<b>同时</b>变差（比如全都该洗了），会被当成「天气不好」。
          这一项我们用外部气象数据每季度校一次。
        </p>
      </div>
      <div v-if="openNote === 'price'" class="pma-note">
        <p v-if="selfPrice != null">
          自用电按录入时快照的消纳综合单价加权 <b>{{ selfPrice.toFixed(2) }} 元/度</b>；
          上网电按脱硫煤标杆价 <b>{{ GRID_PRICE }} 元/度</b>。
        </p>
        <p v-else>各站尚未配置消纳单价，收益一栏按 0 计 —— 请先到抄表屏补填单价。</p>
        <p class="mut">
          单价在录入/导入当时快照，之后调价不回溯历史记录 —— 历史收益稳定不漂移。
          分时电价与财务账套口径的对齐待电费系统提供分时数据后接入。
        </p>
      </div>

      <!-- ③ 四盏灯的定义 —— 写在灯旁边,不能只写在帮助里 -->
      <div class="pma-legend">
        <button class="pma-lamp" :class="{ on: filterStatus === 'ok' }" @click="toggleFilter('ok')">
          <span class="dot" :style="{ background: DOT.ok }" />正常
          <em>发电量与这栋楼一贯水平一致</em>
        </button>
        <button class="pma-lamp" :class="{ on: filterStatus === 'watch' }" @click="toggleFilter('watch')">
          <span class="dot" :style="{ background: DOT.watch }" />需关注
          <em>连续偏低，但幅度不大或时间不长，还不能确定</em>
        </button>
        <button class="pma-lamp" :class="{ on: filterStatus === 'risk' }" @click="toggleFilter('risk')">
          <span class="dot" :style="{ background: DOT.risk }" />异常
          <em>连续偏低且幅度大，基本可以确定不是天气原因</em>
        </button>
        <button class="pma-lamp" :class="{ on: filterStatus === 'mute' }" @click="toggleFilter('mute')">
          <span class="dot" :style="{ background: DOT.mute }" />数据不全
          <em>本期抄表缺失较多，不做判断</em>
        </button>
        <span class="pma-fp">这套判断平均一个月误报不到 1 次。</span>
      </div>

      <div class="av2-grid">
        <!-- 主体是表不是图 -->
        <div class="av2-card av2-s12 av2-core">
          <div class="av2-card-h">
            <span class="t">楼栋明细 · 按缺口金额降序</span>
            <span class="hint">
              {{ snap.stations.length - snap.quality.noMeter.length - snap.quality.noCapacity.length }} 站已装表并录了容量
              <template v-if="snap.quality.noCapacity.length"> · {{ snap.quality.noCapacity.length }} 站未录容量</template>
              <template v-if="snap.quality.noMeter.length"> · {{ snap.quality.noMeter.length }} 站未装表</template>
            </span>
          </div>
          <div class="pma-scroll">
            <table class="ak-tbl">
              <thead>
                <tr>
                  <th>楼栋</th><th>状态</th><th>{{ ymLabel }}收益</th><th>{{ ymLabel }}缺口</th>
                  <th>相对园区</th><th>情况</th><th>建议</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in rows" :key="r.id"
                  class="pma-row" :class="{ can: !!r.detail, on: r.id === selId }"
                  @click="pickStation(r)"
                >
                  <td style="text-align: left">{{ r.name }}</td>
                  <td style="text-align: left">
                    <span class="dot" :style="{ background: DOT[r.status] }" />{{ r.statusLabel }}
                  </td>
                  <td class="mono">{{ r.revenue > 0 ? yuan(r.revenue) : '—' }}</td>
                  <td class="mono" :style="{ color: r.gapMoney > 0 ? DOT[r.status] : undefined }">
                    {{ r.gapMoney > 0 ? yuan(r.gapMoney) : '—' }}
                  </td>
                  <td class="mono mut">{{ r.relPct == null ? '—' : (r.relPct >= 0 ? '高 ' : '低 ') + fnum(Math.abs(r.relPct), 0) + '%' }}</td>
                  <td style="text-align: left">{{ r.situation }}</td>
                  <td style="text-align: left" class="mut">{{ r.advice }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">近 {{ snap.monthly.labels.length }} 个月 · 发电量与收益</span>
            <span class="hint">柱=发电量 万度 ｜ 实线=实际收益 ｜ 虚线=应得收益</span>
          </div>
          <AnaEChart :option="chartOpt" :height="200" />
        </div>

        <!-- ── 第二层 · 单栋详情。未选中时整区**不渲染**,不是渲染空态 ── -->
        <template v-if="sel && selDetail">
          <div class="av2-card av2-s12" :id="'s' + sel.id">
            <div class="av2-card-h">
              <span class="t">{{ sel.name }} · 累计缺口</span>
              <span class="hint">
                纵轴=元 ｜ 折点=开始变差 ｜ 斜率=每天亏多少 ｜ 终点=至今一共亏多少
                <button class="pma-lk" style="margin-left:10px" @click="selId = null">收起 ✕</button>
              </span>
            </div>
            <div class="pma-cum">
              <span>至今累计 <b>{{ yuan(selDetail.gapCum[selDetail.gapCum.length - 1]) }}</b></span>
              <span v-if="selDetail.cpDate">{{ cpText }}</span>
              <span v-if="selDetail.cpDate">
                折点前约 {{ yuan(selDetail.slopeBefore) }}/天 → 折点后约
                <b>{{ yuan(selDetail.slopeAfter) }}/天</b>
              </span>
              <span v-if="selDetail.cpDate">再拖一个月约 {{ yuan(selDetail.slopeAfter * 30) }}</span>
            </div>
            <AnaEChart :option="cumOpt" :height="300" />
          </div>

          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">同样天气下，{{ sel.name }} 发了多少</span>
              <span class="hint">每个点是一天 ｜ 落在对角线下方 = 那天没发够</span>
            </div>
            <AnaEChart :option="scatterOpt" :height="250" />
          </div>

          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">{{ sel.name }} · 逐月</span>
              <span class="hint">财务可直接抄进报告</span>
            </div>
            <div class="pma-scroll">
              <table class="ak-tbl">
                <thead><tr><th>月份</th><th>发电量(度)</th><th>比应发少(度)</th></tr></thead>
                <tbody>
                  <tr v-for="m in selMonthly" :key="m.ym">
                    <td style="text-align:left">{{ m.ym }}</td>
                    <td class="mono">{{ fint(m.gen) }}</td>
                    <td class="mono" :class="{ mut: m.gap < 1 }">{{ m.gap < 1 ? '—' : fint(m.gap) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 技术细节默认收起:财务主管一进去看见波动带,会认定「这屏不是给我用的」,
               连第一层也不再打开(§06.4 同一条理由) -->
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">
                <button class="pma-lk" @click="showTech = !showTech">
                  {{ showTech ? '▾' : '▸' }} 显示技术细节
                </button>
              </span>
              <span class="hint">每天比应发多/少，以及这栋楼平时的正常波动范围</span>
            </div>
            <AnaEChart v-if="showTech" :option="residOpt" :height="250" />
          </div>
        </template>

        <!-- ── 第三层 · 方法与口径页(§06.3)。财务不看,但**它存在这件事本身就让人更信任这屏** ──
             审计和承包商要看;不暴露这一层,所有数字不可审计,财务不会认。 -->
        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">
              <button class="pma-lk" @click="layer3 = layer3 === 'method' ? 'none' : 'method'">
                {{ layer3 === 'method' ? '▾' : '▸' }} 方法与口径
              </button>
            </span>
            <span class="hint">
              这些数字是怎么算出来的、剔了哪些天、什么情况下不出结论
              <button class="pma-lk" style="margin-left:12px" @click="layer3 = layer3 === 'lab' ? 'none' : 'lab'">
                分析工作台 ›
              </button>
            </span>
          </div>

          <div v-if="layer3 === 'method'" class="pma-method">
            <h4>模型</h4>
            <p>
              每栋楼每天的「等效小时」= 发电量 ÷ 装机容量。把它写成
              <code>等效小时 = 这栋楼一贯的水平 × 当天的天气 × 波动</code>，取对数后用
              <b>Tukey 中位数抛光</b>分离前两项：行扫（按楼栋取中位）与列扫（按日期取中位）交替，
              直到不再变化（本期迭代 {{ snap.polish.iterations }} 轮，
              {{ snap.polish.converged ? '已收敛' : '未收敛，结论按不稳处理' }}）。
              用中位数不用平均：某栋表坏报低时，平均基准会被整体拉塌，
              于是所有楼看起来都「高于基准」，真正坏的那栋反而不报警。
            </p>

            <h4>怎么算显著</h4>
            <p>
              主统计量是<b>变点检验</b>：扫遍所有可能的「从哪天开始变差」，取最大分割统计量，
              零分布用<b>循环分块置换</b>现算（不查表 —— 最大值统计量不服从 t 分布，查表虚警率会从 5% 飙到 40%）。
              分块而不是逐日：逐日置换会摧毁自相关，零分布被压得过窄，比不置换还激进。
              多栋同时检验用 Benjamini–Hochberg 控制错误发现率。
            </p>
            <p>
              尺度用<b>一阶差分</b>估：直接取全序列离散度的话，基线里若含故障期，
              分子被拉小、分母被撑大 —— 结果是越坏的楼越不报警。
            </p>

            <h4>三重门槛</h4>
            <p>
              统计上说得过去（q &lt; 0.05）、<b>持续 ≥ 14 天</b>、<b>年化 ≥ ¥{{ RISK_GAP.toLocaleString('en-US') }}</b>，
              三条同时满足才亮红灯；黄灯放宽到 q &lt; 0.20、≥ 7 天、年化 ≥ ¥{{ WATCH_GAP.toLocaleString('en-US') }}。
              <b>金额门槛是过滤器，不是装饰</b>：楼栋之间 2% 的差异在一年数据下就「统计显著」，
              但那可能只是朝向不同。运维平台是被误报杀死的，不是被漏报。
            </p>

            <h4>本期数据质量</h4>
            <p>
              共 {{ snap.quality.totalDays }} 天，有效 {{ snap.quality.okDays }} 天。
              <template v-if="snap.quality.droppedHours">剔除 {{ snap.quality.droppedHours }} 天（当日气象数据不全）。</template>
              <template v-if="snap.quality.droppedLowGhi">剔除 {{ snap.quality.droppedLowGhi }} 天（当日日照过弱）。</template>
              <template v-if="snap.quality.droppedThin">剔除 {{ snap.quality.droppedThin }} 天（当天有抄表记录的楼栋不足 8 栋）。</template>
              <template v-if="snap.quality.noMeter.length">未装表不入分析：{{ snap.quality.noMeter.join('、') }}。</template>
              <template v-if="snap.quality.noCapacity.length">未录装机容量不入分析：{{ snap.quality.noCapacity.join('、') }}。</template>
              <template v-if="!snap.quality.hasWeather">本期未导入外部气象数据，未做辐照校准。</template>
            </p>
            <p class="mut">数据快照 <code>{{ snap.id }}</code> —— 工作台与本页用的是同一次计算。</p>
          </div>
        </div>

        <!-- ── 分析工作台(§06.4)。受众是系统所有者、审计、承包商 —— 不为可读性做任何妥协 ── -->
        <template v-if="layer3 === 'lab' && lab">
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">分析工作台</span>
              <span class="hint">
                与第一层同一次计算 · 快照 {{ lab.snapshotId }}
                <button class="pma-lk" style="margin-left:10px" @click="layer3 = 'none'">收起 ✕</button>
              </span>
            </div>
            <div class="pma-links">
              <span class="mut" style="font-size:12px">看哪一栋：</span>
              <button
                v-for="a in lab.acf" :key="a.id" class="pma-lk"
                :style="{ fontWeight: (labStation ?? lab.acf[0].id) === a.id ? 600 : 400 }"
                @click="labStation = a.id"
              >{{ a.name }}</button>
            </div>
          </div>

          <!-- A · 模型输出 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">A · α 排序（相对园区中位）</span>
              <span class="hint">
                区间是块自助算的，比 naive SE 宽得多 —— 互相重叠才是正常的
                <template v-if="lab.alphaExcluded.length">
                  · 已排除 {{ lab.alphaExcluded.join('、') }}（容量台账存疑，不是性能）
                </template>
              </span>
            </div>
            <AnaEChart :option="alphaOpt" :height="300" />
          </div>

          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">B · 残差自相关 ACF</span>
              <span class="hint">ρ₁ 非零即独立假设不成立；N_eff 就是「√N 错了多少」的答案</span>
            </div>
            <AnaEChart :option="acfOpt" :height="300" />
          </div>

          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">B · 残差 vs 年积日<span class="pma-must">上线前必做</span></span>
              <span class="hint">
                有稳定年周期 = 模型缺项（季节性遮挡），<b>不是故障</b>；本栋振幅
                {{ labDoy ? (labDoy.amp * 100).toFixed(1) : '—' }}%
              </span>
            </div>
            <AnaEChart :option="doyOpt" :height="300" />
          </div>

          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">B · 块自助零分布 + 观测值</span>
              <span class="hint">{{ lab.nullDist ? lab.nullDist.name : '—' }} · 让 p 值看得见，比一个 p=0.003 可信</span>
            </div>
            <AnaEChart :option="nullOpt" :height="300" />
          </div>

          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">B · 抛光收敛诊断</span>
              <span class="hint">行优先 / 列优先各跑一次 · <b>排名翻转 = 该结论不稳，不上报</b></span>
            </div>
            <div class="pma-conv" :class="{ bad: lab.convergence.flipped.length }">
              <template v-if="lab.convergence.flipped.length">
                排名不稳：{{ lab.convergence.flipped.join('、') }} —— 这几栋的结论不要上报。
              </template>
              <template v-else>两种扫描顺序给出同一排名，结论稳定。</template>
            </div>
          </div>

          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">B · 数据质量矩阵</span>
              <span class="hint">
                <span class="pma-sw" :style="{ background: QUALITY_COLOR.ok }" />正常
                <span class="pma-sw" :style="{ background: QUALITY_COLOR.missing }" />缺失
                <span class="pma-sw" :style="{ background: QUALITY_COLOR.dropped }" />整日剔除
                · <b>没有「补齐」这一档 —— 本实现从不补齐</b>
              </span>
            </div>
            <div class="pma-scroll">
              <div v-for="r in lab.quality.rows" :key="r.id" class="pma-qrow">
                <span class="nm">{{ r.name }}</span>
                <span
                  v-for="(st, k) in r.states" :key="k" class="cell"
                  :style="{ background: QUALITY_COLOR[st] }" :title="lab.quality.dates[k] + ' ' + st"
                />
              </div>
            </div>
          </div>

          <!-- C · 外部锚 -->
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">C · 全园健康度 log H</span>
              <span class="hint">
                补的是唯一的结构性盲区：全园一起变差时，楼栋之间互相比看不出来
              </span>
            </div>
            <AnaEChart v-if="lab.health.length" :option="healthOpt" :height="250" />
            <div v-else class="pma-conv">
              未导入外部气象数据，这条线给不出来 —— 楼栋之间的比较照常，
              但「全园是不是一起在变差」看不出来。
            </div>
          </div>

          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">A · 完整检验表</span>
              <span class="hint">z 用 N_eff；zₙ 是按天数算的同一个数，摆在旁边看差多少</span>
            </div>
            <div class="pma-scroll">
              <table class="ak-tbl">
                <thead>
                  <tr>
                    <th>楼栋</th><th>α%</th><th>z</th><th>zₙ(按天数)</th><th>p</th><th>q</th>
                    <th>N_eff</th><th>有效日</th><th>形状</th><th>变点区间</th><th>σ 怎么估的</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in lab.tests" :key="t.id">
                    <td style="text-align:left">{{ t.name }}</td>
                    <td class="mono">{{ t.alphaPct.toFixed(1) }}</td>
                    <td class="mono">{{ t.z == null ? '—' : t.z.toFixed(2) }}</td>
                    <td class="mono mut">{{ t.zNaive == null ? '—' : t.zNaive.toFixed(2) }}</td>
                    <td class="mono">{{ t.p.toFixed(3) }}</td>
                    <td class="mono">{{ t.q.toFixed(3) }}</td>
                    <td class="mono">{{ Math.round(t.nEff) }}</td>
                    <td class="mono">{{ t.days }}</td>
                    <td class="mut">{{ t.shape ?? '—' }}</td>
                    <td class="mono mut">{{ t.cpRange }}</td>
                    <td class="mut" style="text-align:left">{{ t.sigmaHow }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>

      <!-- 页脚:snapshot id。工作台渲染同一个对象、显示同一个 id ——
           两边对不上时先看是不是同一次计算,而不是先怀疑模型(§06.4) -->
      <div class="pma-foot">
        <span>本页数据快照 <code>{{ snap.id }}</code></span>
        <span>有效日 {{ snap.quality.okDays }} / {{ snap.quality.totalDays }} 天</span>
        <span v-if="snap.quality.droppedHours">剔除 {{ snap.quality.droppedHours }} 天（当日气象数据不全）</span>
        <span v-if="snap.quality.droppedLowGhi">剔除 {{ snap.quality.droppedLowGhi }} 天（当日日照过弱）</span>
        <span v-if="cmp.mode.value === 'yoy'">同比：{{ snap.yoy.yearNote }}</span>
        <button class="pma-lk" @click="goMeter">去分栋抄表 →</button>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.pma-warn {
  margin: 0 0 10px; padding: 9px 13px; border-radius: 8px; font-size: 13px;
  background: color-mix(in srgb, var(--hue-orange) 10%, transparent);
  border-left: 3px solid var(--hue-orange); color: var(--text-strong);
}
.pma-warn.mut { background: var(--surface-sunken); border-left-color: var(--divider); color: var(--text-muted); }
.pma-links { display: flex; gap: 14px; margin-bottom: 8px; }
.pma-lk {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--hue-blue); font-size: 12.5px; font-family: inherit;
}
.pma-note {
  margin: 0 0 12px; padding: 13px 16px; border-radius: 10px; font-size: 13.5px; line-height: 1.75;
  background: var(--surface); border: 1px solid var(--divider);
}
.pma-note p { margin: 0 0 9px; }
.pma-note p:last-child { margin-bottom: 0; }
.pma-note .mut { color: var(--text-muted); font-size: 12.5px; }
.pma-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; margin-bottom: 12px; }
.pma-lamp {
  background: none; border: 0; padding: 2px 0; cursor: pointer; font-family: inherit;
  font-size: 12.5px; color: var(--text-strong); display: inline-flex; align-items: baseline; gap: 5px;
}
.pma-lamp.on { font-weight: var(--fw-semibold); text-decoration: underline; }
.pma-lamp em { font-style: normal; color: var(--text-muted); font-size: 11.5px; }
.pma-fp { color: var(--text-muted); font-size: 11.5px; margin-left: auto; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 5px; vertical-align: middle; }
.pma-scroll { overflow-x: auto; }
.pma-row.can { cursor: pointer; }
.pma-row.can:hover { background: var(--surface-sunken); }
.pma-row.on { background: var(--surface-sunken); }
.pma-cum {
  display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: baseline;
  margin-bottom: 8px; font-size: 12.5px; color: var(--text-muted);
}
.pma-cum b { color: var(--text-strong); font-family: var(--font-mono); }
.pma-method { font-size: 13.5px; line-height: 1.8; }
.pma-method h4 { font-size: 13px; margin: 14px 0 4px; color: var(--text-strong); }
.pma-method h4:first-child { margin-top: 0; }
.pma-method p { margin: 0 0 8px; color: var(--text-muted); }
.pma-method code { font-family: var(--font-mono); font-size: 12px; }
.pma-must {
  font-size: 10.5px; margin-left: 6px; padding: 1px 6px; border-radius: 99px;
  background: color-mix(in srgb, var(--hue-red) 12%, transparent); color: var(--hue-red);
}
.pma-conv { font-size: 13px; color: var(--text-muted); padding: 6px 0; }
.pma-conv.bad { color: var(--hue-red); font-weight: var(--fw-semibold); }
.pma-sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 3px 0 8px; vertical-align: middle; }
.pma-qrow { display: flex; align-items: center; gap: 1px; margin-bottom: 2px; white-space: nowrap; }
.pma-qrow .nm { flex: 0 0 68px; font-size: 11px; color: var(--text-muted); }
.pma-qrow .cell { display: inline-block; width: 2px; height: 11px; }
.pma-foot {
  display: flex; flex-wrap: wrap; gap: 14px; align-items: baseline;
  margin-top: 12px; font-size: 11.5px; color: var(--text-muted);
}
.pma-foot code { font-family: var(--font-mono); }
</style>
