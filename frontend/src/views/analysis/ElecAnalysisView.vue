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
import { fnum, STATUS } from '@/components/ana/anaFmt'
import { finWan } from '@/utils/finFmt'
import { usePeriod } from '@/analysis/usePeriod'
import {
  elecCostApi,
  type ElecCostEntryDTO, type ElecMeterDTO, type ElecMetricsMonthDTO, type ElecPriceCfgDTO,
} from '@/api/elecCost'
import '@/components/ana/ana.css'

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const year = computed(() => period.sel.value.year)

// ── 取数(年切重取;seq 守卫防快切乱序落表,同 ElecView loadYear) ──
const loading = ref(true)
const failed = ref(false)
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
        ? `${year.value} 年${label}暂无可算月份`
        : `${year.value} 年${label}累计 ${finWan(total)}(${n} 个月)`,
      tone: (total == null ? 'neutral' : total >= 0 ? 'good' : 'risk') as 'neutral' | 'good' | 'risk',
    }
  }))

// ── 深链电费成本第二本账(cost):ElecView 认 ?mode=(P0b),子屏 ElecCostView 认 ?p=YYYY-MM 落月(只有年 → 停在它的月门) ──
// 改前发的是 view=cost —— 键名对不上,永远落在报送台账(假下钻)。openFresh 页签语义不变(spec §4.1)。
function goCost(month?: number): void {
  tabs.openDeep('elec-cost')
  void router.push(periodLink('elec-cost', { p: periodOf(year.value, month ?? null), extra: { mode: 'cost' } }))
}
interface EcClick { componentType?: string; dataIndex?: number }
function onChartClick(p: unknown): void {
  const e = p as EcClick
  if (e.componentType === 'series' && e.dataIndex != null) goCost(e.dataIndex + 1)
}

// ── 图1:收益四指标月度趋势(万元;缺月断点) ──
const TREND = [
  { key: 'parkElecProfit', color: '#185FA5' },
  { key: 'pvInvestIncome', color: '#5DCAA5' },
  { key: 'basicElecProfit', color: '#378ADD' },
  { key: 'sellAgreementPnl', color: '#EF9F27' },
]
const trendHasData = computed(() => TREND.some(({ key }) => metricSeries(key).some((v) => v != null)))
const trendOption = computed<object>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
  legend: { top: 0 },
  grid: { left: 56, right: 16, top: 32, bottom: 26 },
  xAxis: { type: 'category', data: MLABELS, boundaryGap: false },
  yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
  series: TREND.map(({ key, color }) => ({
    name: metricLabel(key, key), type: 'line', symbol: 'circle', symbolSize: 4,
    itemStyle: { color }, lineStyle: { width: 2, color },
    data: metricSeries(key).map((v) => (v == null ? null : +(v / 1e4).toFixed(2))),
  })),
}))

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
const SEGS: Seg[] = [
  { name: '一期·分时', color: '#185FA5', of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && !isP2(r) && r.feeKey === 'tou_industrial') },
  { name: '一期·基本', color: '#378ADD', of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && !isP2(r) && r.feeKey === 'basic_industrial') },
  { name: '一期·商业', color: '#85B7EB', of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && !isP2(r) && r.feeKey === 'commercial') },
  { name: '二期·分时', color: '#5DCAA5', of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && isP2(r) && r.feeKey === 'tou_industrial') },
  { name: '二期·基本', color: '#B7E2D2', of: (rows) => feeAmt(rows, (r) => mk(r) === 'master' && isP2(r) && r.feeKey === 'basic_industrial') },
  { name: '宿舍', color: '#EF9F27', of: (rows) => feeAmt(rows, (r) => mk(r) === 'dorm' && r.feeKey === 'usage') },
  { name: '运营净额', color: '#F0997B', of: opsNet },
  // 抵减段(负向):录入为正金额,展示取负 — 奖励与上网收益冲减当月总表电费
  { name: '功率因数奖励(抵减)', color: '#94A3B8', of: (rows) => neg(feeAmt(rows, (r) => r.feeKey === 'pf_reward')) },
  { name: '光伏上网收益(抵减)', color: '#CBD5E1', of: (rows) => neg(feeAmt(rows, (r) => r.feeKey === 'pv_grid_income')) },
]
const structOption = computed<object>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
  legend: { top: 0, itemWidth: 12, itemHeight: 8 },
  grid: { left: 56, right: 16, top: 56, bottom: 26 },
  xAxis: { type: 'category', data: MLABELS },
  yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
  series: SEGS.map((s) => ({
    name: s.name, type: 'bar', stack: 'st', barMaxWidth: 30, itemStyle: { color: s.color },
    data: entryMonths.value.map((rows) => {
      const v = s.of(rows)
      return v == null ? null : +(v / 1e4).toFixed(2)
    }),
  })),
}))

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
  xAxis: { type: 'category', data: MLABELS },
  yAxis: [
    { type: 'value', axisLabel: { formatter: '{value} 万' } },
    { type: 'value', scale: true, axisLabel: { formatter: '{value} 元' }, splitLine: { show: false } },
  ],
  series: [
    {
      name: '售电协议月损益', type: 'bar', yAxisIndex: 0, barMaxWidth: 26,
      data: sellPnl.value.map((v) => (v == null ? null
        : { value: +(v / 1e4).toFixed(2), itemStyle: { color: v < 0 ? '#E24B4A' : '#B5D4F4', borderRadius: [3, 3, 0, 0] } })),
    },
    {
      name: '公告价', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 4,
      itemStyle: { color: '#185FA5' }, lineStyle: { width: 2, color: '#185FA5' },
      data: posted.value.map((v) => (v == null ? null : +v.toFixed(4))),
    },
    {
      name: '执行价', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 4,
      itemStyle: { color: '#EF9F27' }, lineStyle: { width: 2, type: 'dashed', color: '#EF9F27' },
      data: execP.value.map((v) => (v == null ? null : +v.toFixed(4))),
    },
  ],
}))
</script>

<template>
  <!-- §五:年敏感屏(指标为年度月序),只年控件 -->
  <AnaShell period-mode="year">
    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <AnaEmpty v-else-if="failed" label="数据加载失败" hint="请刷新重试" />
    <div v-else class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('zap')" :size="20" /></span>
          <div>
            <h2 class="ak-title">电费成本分析</h2>
            <p class="ak-sub">收益四指标趋势 · 总表电费结构 · 购售价差 · {{ year }}年</p>
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
        :label="year + ' 年电费成本模型无费项数据'"
        hint="本屏依赖电费成本总览的总表/宿舍/运营费项月度值;先录入或用模拟填充"
        to="/elec-cost"
        to-text="去电费成本总览"
      />

      <template v-else>
        <!-- 结论条:4 指标年累计,人话一句(cv2-concl 同款;点击深链成本总览) -->
        <div class="av2-card ea-concl">
          <button v-for="c in conclusion" :key="c.key" class="ea-cs" @click="goCost()">
            <span class="dot" :style="{ background: STATUS[c.tone].color }"></span>{{ c.text }}
          </button>
        </div>

        <div class="av2-grid">
          <!-- 图1 s12:收益四指标月度趋势;本屏无 s8 屏,av2-core 人工点名——结论条总结的正是这四指标,首图即主叙事 -->
          <div class="av2-card av2-s12 av2-core">
            <div class="av2-card-h">
              <span class="t">收益四指标月度趋势 · {{ year }}年</span>
              <span class="hint">万元 · 缺源月断点不补 0<span class="hint-desk"> · 点击深链成本总览对应月</span></span>
            </div>
            <AnaEChart v-if="trendHasData" :option="trendOption" :height="300" @chart-click="onChartClick" />
            <AnaEmpty v-else :label="year + ' 年四指标全月不可算'" hint="各指标缺失数据源见成本总览派生指标表" to="/elec-cost" to-text="去电费成本总览" />
          </div>

          <!-- 图2 s6:总表电费结构堆叠柱 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">总表电费结构</span>
              <span class="hint">万元 · 奖励/上网收益为负向抵减段</span>
            </div>
            <AnaEChart :option="structOption" :height="300" @chart-click="onChartClick" />
          </div>

          <!-- 图3 s6:购售价差双轴 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">购售价差</span>
              <span class="hint">线=双价(元/kWh,右轴) · 柱=月损益(万,左轴)</span>
            </div>
            <AnaEChart v-if="spreadHasData" :option="spreadOption" :height="300" @chart-click="onChartClick" />
            <AnaEmpty v-else label="双价参数未录" hint="公告价/执行价按月录于成本总览电价参数(或模拟填充)" to="/elec-cost" to-text="去电费成本总览" />
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
</style>
