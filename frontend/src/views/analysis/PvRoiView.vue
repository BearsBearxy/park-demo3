<script setup lang="ts">
// 光伏投资回收(pv-roi)v2 — spec §二.14:累计收益爬坡线 + 投资额 markLine(交点=预估回收点
// markPoint 标注)+ 回收进度条 + 分期收益柱(点柱→该期月度明细卡)。
// 数据 = pv_record 全月份(fetchPvAll,口径与 v1 一致);投资额=「目标与阈值」pvInvestment(万,localStorage)。
// +分栋抄表分析区(ENERGY-ANALYSIS-SPEC §2):发电效率/消纳结构/消纳收益,pv_reading 空整区引导。
// 数据变换纯函数抽于 pvRoi.logic.ts(单测)。
import { computed, onMounted, ref, watch } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import Select from '@/components/ds/Select.vue'
import { fetchPvAll, fetchPvPhases } from '@/analysis/anaData'
import { anaSettings } from '@/analysis/anaSettings'
import { finWan } from '@/utils/finFmt'
import { fnum } from '@/components/ana/anaFmt'
import type { PvPhaseDTO, PvRecordDTO } from '@/types/pv'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { elecCostApi } from '@/api/elecCost'
import {
  buildRamp, consumptionRows, cumSeries, monthlyEfficiency, phaseMonthly, phaseSummaries,
  revenueByStation, stationEfficiency,
} from './pvRoi.logic'

const phases = ref<PvPhaseDTO[]>([])
const records = ref<PvRecordDTO[]>([])
const loading = ref(true)
onMounted(async () => {
  try {
    ;[phases.value, records.value, mYears.value] = await Promise.all([
      fetchPvPhases(), fetchPvAll(), pvMeterApi.years().catch(() => []),   // 抄表空表/接口失败均按无数据引导
    ])
    selPhase.value = phaseSummaries(phases.value, records.value).find((x) => x.months)?.p.id ?? ''
    mYear.value = mYears.value[mYears.value.length - 1] ?? null   // 默认最近有数据年 → watch 触发取数
    // 上网参数价:price_cfg pv_grid_price(默认行),取不到回退种子默认(ELEC-COST-SPEC §2),不阻塞
    void elecCostApi.priceCfg()
      .then((cfgs) => { const v = cfgs.find((c) => c.cfgKey === 'pv_grid_price')?.value; if (v != null) gridPrice.value = v })
      .catch(() => {})
  } finally {
    loading.value = false
  }
})

const invest = computed(() => anaSettings.pvInvestment * 10000) // 设置为万元 → 元

// ── 分期汇总(v1 rows 同口径)+ 全园合计 ──
const rows = computed(() => phaseSummaries(phases.value, records.value))
const tot = computed(() => {
  const cum = rows.value.reduce((a, x) => a + x.cum, 0)
  const annual = rows.value.reduce((a, x) => a + x.annual, 0)
  return {
    cum, annual,
    selfAmt: rows.value.reduce((a, x) => a + x.selfAmt, 0),
    recovery: invest.value ? cum / invest.value : 0,
    payback: annual ? invest.value / annual : null, // 预估回收周期(年)
  }
})
const rpct = (x: number): string => (x * 100).toFixed(1) + '%'
const onlineLabel = (p: PvPhaseDTO): string => (p.online ? p.online.replace('-', '年') + '月并网' : '并网月未录')

// ── 爬坡线 + 投资额 markLine + 预估回收点 markPoint ──
const cumPts = computed(() => cumSeries(records.value))
const ramp = computed(() => buildRamp(cumPts.value, tot.value.annual / 12, invest.value))
const hitYm = computed(() => (ramp.value.hitIdx != null ? ramp.value.labels[ramp.value.hitIdx] : null))
const rampOpt = computed<object>(() => {
  const r = ramp.value
  const investW = invest.value / 1e4
  const w = (a: (number | null)[]): (number | null)[] => a.map((v) => (v == null ? null : +(v / 1e4).toFixed(1)))
  const actualW = w(r.actual), projW = w(r.projected)
  const markPoint = r.hitIdx != null
    ? {
        symbol: 'pin', symbolSize: 42, itemStyle: { color: '#185FA5' },
        label: { formatter: '回收', color: '#fff', fontSize: 11 },
        data: [{ coord: [r.hitIdx, (actualW[r.hitIdx] ?? projW[r.hitIdx]) as number] }],
      }
    : undefined
  const yMax = Math.max(investW * 1.1, ...actualW.map((v) => v ?? 0), ...projW.map((v) => v ?? 0))
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 56, right: 60, top: 32, bottom: 26 },
    xAxis: { type: 'category', data: r.labels },
    yAxis: { type: 'value', max: Math.ceil(yMax), axisLabel: { formatter: '{value} 万' } },
    series: [
      {
        name: '累计收益', type: 'line', data: actualW, symbol: 'circle', symbolSize: 4,
        itemStyle: { color: '#378ADD' }, lineStyle: { width: 2 }, areaStyle: { color: 'rgba(55,138,221,.08)' },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: '#E24B4A', width: 1.5 },
          // 图表清晰化 §1:标签画在绘图区内,不许被图边裁切(默认 end 落图外右缘被裁,同 CockpitView 预算线)
          label: { position: 'insideEndTop', formatter: '投资额 ' + fnum(investW, 0) + ' 万', fontSize: 11, color: '#E24B4A' },
          data: [{ yAxis: investW }],
        },
        markPoint: r.hitIdx != null && actualW[r.hitIdx] != null ? markPoint : undefined,
      },
      {
        name: '外推(年化口径)', type: 'line', data: projW, symbol: 'none',
        lineStyle: { type: 'dashed', width: 1.5, color: '#85B7EB' }, itemStyle: { color: '#85B7EB' },
        markPoint: r.hitIdx != null && actualW[r.hitIdx] == null ? markPoint : undefined,
      },
    ],
  }
})

// ── 分期收益柱(点柱→选中该期,右侧月度明细卡联动) ──
const selPhase = ref('')
const phaseOpt = computed<object>(() => {
  const rs = rows.value
  const dim = (i: number): number => (rs[i].p.id === selPhase.value ? 1 : 0.45)
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 56, right: 14, top: 32, bottom: 26 },
    xAxis: { type: 'category', data: rs.map((x) => x.p.name) },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
    series: [
      {
        name: '自消纳', type: 'bar', stack: 'fee', barMaxWidth: 46,
        data: rs.map((x, i) => ({ value: +(x.selfAmt / 1e4).toFixed(1), itemStyle: { color: '#378ADD', opacity: dim(i) } })),
      },
      {
        name: '上网', type: 'bar', stack: 'fee',
        data: rs.map((x, i) => ({ value: +(x.gridAmt / 1e4).toFixed(1), itemStyle: { color: '#B5D4F4', opacity: dim(i) } })),
      },
    ],
  }
})
function onPhaseClick(params: unknown): void {
  const i = (params as { dataIndex?: number }).dataIndex
  if (i != null && rows.value[i]) selPhase.value = rows.value[i].p.id
}
const selRow = computed(() => rows.value.find((x) => x.p.id === selPhase.value) ?? null)
const selMonthly = computed(() => (selRow.value ? phaseMonthly(records.value, selRow.value.p.id) : []))
const wan2 = (v: number): string => fnum(v / 1e4, 2)

// ══ 分栋抄表分析(ENERGY-ANALYSIS-SPEC §2):效率 / 消纳结构 / 消纳收益 ══
const mYears = ref<number[]>([])
const mYear = ref<number | null>(null)
// ds/Select 只吃字符串值,年/站 id 进出各转一次
const mYearOpts = computed(() => mYears.value.map((y) => String(y)))
const mStations = ref<PvStationDTO[]>([])
const mReadings = ref<PvReadingDTO[]>([])
const mLoading = ref(false)
const gridPrice = ref(0.453)   // pv_grid_price 参数价(price_cfg 解析值,onMounted 覆写)

let mToken = 0   // 年切竞态守卫(范式同 FinPnlView):过期响应弃写
async function loadMeter(): Promise<void> {
  if (mYear.value == null) return
  const t = ++mToken
  mLoading.value = true
  try {
    const [sts, rds] = await Promise.all([pvMeterApi.stations(), pvMeterApi.readingsYear(mYear.value)])
    if (t !== mToken) return
    mStations.value = sts
    mReadings.value = rds
  } catch {
    if (t === mToken) { mStations.value = []; mReadings.value = [] }   // 拉失败清空→空态,禁止新年份标签配旧年数值
  } finally {
    if (t === mToken) mLoading.value = false
  }
}
watch(mYear, () => { void loadMeter() })   // 初始赋值与切年共用一条取数路径

// ── 图A:各站发电效率(kWh/kWp 等效小时)+ 覆盖率护栏 ──
const eff = computed(() => stationEfficiency(mStations.value, mReadings.value))
const effOpt = computed<object>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? fnum(v, 0) + ' kWh/kWp' : '—') },
  grid: { left: 48, right: 14, top: 14, bottom: 48 },
  xAxis: { type: 'category', data: eff.value.rows.map((r) => r.name), axisLabel: { rotate: 32, fontSize: 11 } },
  yAxis: { type: 'value' },
  series: [{
    name: '发电效率', type: 'bar', barMaxWidth: 26,
    data: eff.value.rows.map((r) => +r.eff.toFixed(0)),
    itemStyle: { color: '#5DCAA5', borderRadius: [3, 3, 0, 0] },
  }],
}))

// ── 图B:效率月度趋势(全园加权 + 可选单站) ──
const selStation = ref(0)   // 0 = 仅全园加权
const capStations = computed(() => mStations.value.filter((s) => s.capacityKwp != null && s.capacityKwp > 0))
const stationOpts = computed(() => [
  { value: '0', label: '全园加权' },
  ...capStations.value.map((s) => ({ value: String(s.id), label: s.name })),
])
const trend = computed(() => monthlyEfficiency(mStations.value, mReadings.value, selStation.value || undefined))
const trendHasData = computed(() => trend.value.park.some((v) => v != null))
const trendOpt = computed<object>(() => {
  const t = trend.value
  const series: object[] = [{
    name: '全园加权', type: 'line', data: t.park.map((v) => (v == null ? null : +v.toFixed(1))),
    symbol: 'circle', symbolSize: 5, itemStyle: { color: '#5DCAA5' }, lineStyle: { width: 2, color: '#5DCAA5' },
    areaStyle: { opacity: 0.08, color: '#5DCAA5' },
  }]
  if (t.sel) series.push({
    name: mStations.value.find((s) => s.id === selStation.value)?.name ?? '单站',
    type: 'line', data: t.sel.map((v) => (v == null ? null : +v.toFixed(1))),
    symbol: 'circle', symbolSize: 4, itemStyle: { color: '#378ADD' }, lineStyle: { width: 2, color: '#378ADD' },
  })
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? fnum(v, 1) + ' kWh/kWp' : '—') },
    legend: { top: 0 },
    grid: { left: 40, right: 14, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: t.yms.map((ym) => +ym.slice(5, 7) + '月'), boundaryGap: false },
    yAxis: { type: 'value', scale: true },
    series,
  }
})

// ── 消纳结构:自消纳/上网/损耗三段堆叠 + 损耗率副轴(负损耗红点);按月/按站两视角 ──
const consBy = ref<'month' | 'station'>('month')
const cons = computed(() => consumptionRows(mStations.value, mReadings.value, consBy.value))
const consOpt = computed<object>(() => {
  const rows = cons.value
  const wan = (v: number): number => +(v / 1e4).toFixed(2)
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (ps: { seriesName: string; value: number | { value: number } | null; axisValue: string }[]) =>
        ps[0].axisValue + ps.map((p) => {
          const v = p.value != null && typeof p.value === 'object' ? p.value.value : p.value
          return `<br/>${p.seriesName}:${v == null ? '—' : p.seriesName === '损耗率' ? v + '%' : fnum(v, 1) + ' 万kWh'}`
        }).join(''),
    },
    legend: { top: 0 },
    grid: { left: 46, right: 44, top: 30, bottom: consBy.value === 'station' ? 48 : 26 },
    xAxis: {
      type: 'category',
      data: rows.map((r) => (consBy.value === 'month' ? +r.key.slice(5, 7) + '月' : r.key)),
      axisLabel: consBy.value === 'station' ? { rotate: 32, fontSize: 11 } : undefined,
    },
    yAxis: [
      { type: 'value', name: '万kWh', nameTextStyle: { fontSize: 11 } },
      { type: 'value', axisLabel: { formatter: '{value}%' }, splitLine: { show: false } },
    ],
    series: [
      { name: '自消纳', type: 'bar', stack: 'kwh', barMaxWidth: 26, data: rows.map((r) => wan(r.self)), itemStyle: { color: '#378ADD' } },
      { name: '上网', type: 'bar', stack: 'kwh', data: rows.map((r) => wan(r.grid)), itemStyle: { color: '#B5D4F4' } },
      { name: '损耗', type: 'bar', stack: 'kwh', data: rows.map((r) => wan(r.loss)), itemStyle: { color: '#E24B4A', opacity: 0.75 } },
      {
        name: '损耗率', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 1.5, type: 'dashed', color: 'rgba(28,28,28,.45)' }, itemStyle: { color: 'rgba(28,28,28,.45)' },
        // 负损耗(计量异常)红点标注;发电 0 → null 断点
        data: rows.map((r) => (r.lossRate == null ? null
          : r.loss < 0
            ? { value: +(r.lossRate * 100).toFixed(1), itemStyle: { color: '#E24B4A' }, symbolSize: 7 }
            : +(r.lossRate * 100).toFixed(1))),
      },
    ],
  }
})

// ── 消纳收益:各站 消纳收益(快照单价口径)vs 上网收益(×参数价) ──
const rev = computed(() => revenueByStation(mStations.value, mReadings.value, gridPrice.value))
const revOpt = computed<object>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 2) + '万' : '—') },
  legend: { top: 0 },
  grid: { left: 52, right: 14, top: 30, bottom: 48 },
  xAxis: { type: 'category', data: rev.value.map((r) => r.name), axisLabel: { rotate: 32, fontSize: 11 } },
  yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
  series: [
    { name: '消纳收益', type: 'bar', barMaxWidth: 20, data: rev.value.map((r) => +(r.selfRev / 1e4).toFixed(2)), itemStyle: { color: '#378ADD', borderRadius: [3, 3, 0, 0] } },
    { name: '上网收益', type: 'bar', barMaxWidth: 20, data: rev.value.map((r) => +(r.gridRev / 1e4).toFixed(2)), itemStyle: { color: '#B5D4F4', borderRadius: [3, 3, 0, 0] } },
  ],
}))
</script>

<template>
  <!-- §五:期间无关屏(全周期累计,pv_record 全月份),隐期间控件显口径徽章 -->
  <AnaShell period-mode="none" scope-chip="全周期累计">
    <template #kpis>
      <AnaKpiTile label="工程总投资（含税）" :value="finWan(invest)" note="右上「目标与阈值」设置" />
      <AnaKpiTile label="累计电费收益" :value="finWan(tot.cum)" :note="cumPts.length + ' 个记账月'" />
      <AnaKpiTile label="综合回收进度" :value="rpct(tot.recovery)" note="= 累计收益 ÷ 总投资" />
      <AnaKpiTile label="年化电费收益" :value="finWan(tot.annual)" note="按各期活跃月折算" />
      <AnaKpiTile label="预估回收周期" :value="tot.payback ? tot.payback.toFixed(1) + ' 年' : '—'"
        :note="hitYm ? '预估回收点 ' + hitYm : '按年化外推'" />
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <div v-else class="roi2-page">
      <!-- 空态:附表6 无任何记账月 → 深链录入屏,不画假图 -->
      <AnaEmpty
        v-if="!records.length"
        label="光伏收益数据待录入"
        hint="附表6 尚无逐月自消纳 / 上网电费记录,无法计算累计收益与回收进度"
        to="/pv-income"
        to-text="去录入光伏收益"
      />

      <template v-else>
        <div class="av2-grid">
          <!-- 主图 span8:累计收益爬坡 + 投资额 markLine + 预估回收点 -->
          <div class="av2-card av2-s8">
            <div class="av2-card-h">
              <span class="t">累计收益爬坡 vs 工程总投资</span>
              <span class="hint">实线=已记账 · 虚线=按年化外推{{ hitYm ? ' · 预估回收点 ' + hitYm : '' }} · 万元</span>
            </div>
            <AnaEChart :option="rampOpt" :height="300" />
          </div>

          <!-- span4:回收进度条 -->
          <div class="av2-card av2-s4">
            <div class="av2-card-h"><span class="t">成本回收进度</span><span class="hint">全园合计口径</span></div>
            <div class="roi2-big">{{ rpct(tot.recovery) }}</div>
            <div class="roi2-bar"><div class="roi2-bar-fill" :style="{ width: (Math.min(1, tot.recovery) * 100).toFixed(1) + '%' }"></div></div>
            <div class="roi2-rows">
              <div class="r"><span class="k">累计电费收益</span><span class="v">{{ finWan(tot.cum) }}</span></div>
              <div class="r"><span class="k">其中 自消纳</span><span class="v">{{ finWan(tot.selfAmt) }}</span></div>
              <div class="r"><span class="k">其中 上网</span><span class="v">{{ finWan(tot.cum - tot.selfAmt) }}</span></div>
              <div class="r"><span class="k">预估回收周期</span><span class="v">{{ tot.payback ? tot.payback.toFixed(1) + ' 年' : '—' }}</span></div>
            </div>
          </div>

          <!-- 第二排 span8:分期收益柱(点柱→明细卡) -->
          <div class="av2-card av2-s8">
            <div class="av2-card-h"><span class="t">分期收益(自消纳 + 上网)</span><span class="hint"><span class="hint-desk">点击柱子查看该期月度明细</span></span></div>
            <AnaEChart :option="phaseOpt" :height="300" @chart-click="onPhaseClick" />
          </div>

          <!-- span4:选中期月度明细卡 -->
          <div class="av2-card av2-s4">
            <div class="av2-card-h">
              <span class="t">{{ selRow ? selRow.p.name + ' · 月度明细' : '月度明细' }}</span>
              <span v-if="selRow" class="hint">{{ onlineLabel(selRow.p) }} · {{ selRow.months }} 个月</span>
            </div>
            <template v-if="selRow && selMonthly.length">
              <div class="roi2-sel">
                <span>累计 <b>{{ finWan(selRow.cum) }}</b></span>
                <span>年化 <b>{{ finWan(selRow.annual) }}</b></span>
                <span>占全园 <b>{{ rpct(selRow.share) }}</b></span>
              </div>
              <div class="roi2-tblwrap">
                <table class="ak-tbl">
                  <thead><tr><th>记账月</th><th>自消纳(万)</th><th>上网(万)</th><th>合计(万)</th></tr></thead>
                  <tbody>
                    <tr v-for="m in selMonthly" :key="m.ym">
                      <td class="mono">{{ m.ym }}</td>
                      <td class="mono mut">{{ wan2(m.selfAmt) }}</td>
                      <td class="mono mut">{{ wan2(m.gridAmt) }}</td>
                      <td class="mono">{{ wan2(m.fee) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <AnaEmpty v-else label="该期暂无记账月" hint="点击左侧柱子切换期别,或到附表6 录入"
              to="/pv-income" to-text="去录入光伏收益" />
          </div>
        </div>

        <AnaMethodNote>
          年化电费收益按各期已记账月份折算;回收进度 = 累计电费收益 ÷ 工程总投资(期别工程成本暂未暴露,按全园合计口径);
          外推虚线按全园年化 ÷12 逐月递增,与投资额线交点即预估回收点。投运初期月份样本少,仅供参考。
        </AnaMethodNote>
      </template>

      <!-- ══ 分栋抄表分析(ENERGY-ANALYSIS-SPEC §2):独立于附表6 数据源,空态各自护栏 ══ -->
      <div class="roi2-sect">
        <div class="l">
          <span class="t">分栋抄表分析</span>
          <span class="hint">逐站逐日抄表 · 发电效率 / 消纳结构 / 消纳收益</span>
        </div>
        <label v-if="mYears.length" class="roi2-ysel">年份
          <span style="width:92px">
            <Select size="sm" :options="mYearOpts" :model-value="mYear == null ? '' : String(mYear)"
              @update:model-value="mYear = +$event" />
          </span>
        </label>
      </div>

      <!-- pv_reading 空 → 整区引导(护栏硬要求),不画假图 -->
      <AnaEmpty
        v-if="!mYears.length"
        label="分栋抄表数据待录入"
        hint="尚无任何电站抄表记录,无法分析发电效率、消纳结构与消纳收益"
        to="/pv-income"
        to-text="去 附表6 → 分栋抄表 录入"
      />
      <div v-else-if="mLoading" class="page-loading"><span class="page-spin" /></div>
      <template v-else>
        <div class="av2-grid">
          <!-- 图A:各站效率柱状对比(覆盖率护栏 N/13 站已录装机容量,无容量站列名不入图) -->
          <div class="av2-card av2-s8">
            <div class="av2-card-h">
              <span class="t">各站发电效率(kWh/kWp 等效小时)</span>
              <span class="hint">{{ mYear }} 年累计 · {{ eff.capN }}/{{ mStations.length }} 站已录装机容量</span>
            </div>
            <template v-if="eff.rows.length">
              <AnaEChart :option="effOpt" :height="250" />
              <p v-if="eff.noCap.length" class="roi2-nocap">未录装机容量不入图:{{ eff.noCap.join('、') }}</p>
            </template>
            <AnaEmpty v-else label="装机容量未录" hint="效率 = 发电总量 ÷ 装机容量,请在分栋抄表屏行内维护各站容量"
              to="/pv-income" to-text="去维护装机容量" />
          </div>

          <!-- 图B:效率月度趋势(全园加权 + 可选单站) -->
          <div class="av2-card av2-s4">
            <div class="av2-card-h">
              <span class="t">效率月度趋势</span>
              <!-- role=group 承载 aria-label:ds/Select 的透传 attr 落在根 div 上,裸 div 读屏不报 -->
              <div style="width:132px;flex:0 0 auto" role="group" aria-label="单站叠加">
                <Select size="sm" :options="stationOpts" :model-value="String(selStation)"
                  @update:model-value="selStation = +$event" />
              </div>
            </div>
            <AnaEChart v-if="trendHasData" :option="trendOpt" :height="250" />
            <AnaEmpty v-else label="装机容量未录" hint="加权效率需至少一站录有装机容量"
              to="/pv-income" to-text="去维护装机容量" />
          </div>

          <!-- 消纳结构:三段堆叠 + 损耗率副轴(负损耗红点),按月/按站两视角 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">消纳结构 · 自消纳 / 上网 / 损耗</span>
              <span class="anx-seg mini" role="group" aria-label="消纳结构视角">
                <button :class="{ on: consBy === 'month' }" @click="consBy = 'month'">按月</button>
                <button :class="{ on: consBy === 'station' }" @click="consBy = 'station'">按站</button>
              </span>
            </div>
            <AnaEChart :option="consOpt" :height="250" />
          </div>

          <!-- 消纳收益:快照单价口径 vs 上网参数价 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">各站消纳收益 vs 上网收益</span>
              <span class="hint">万元 · 快照单价口径 · 上网 ×{{ gridPrice }} 元</span>
            </div>
            <AnaEChart :option="revOpt" :height="250" />
          </div>
        </div>

        <AnaMethodNote>
          效率分母 = 电站配置装机容量(kWh/kWp 即等效小时,跨栋可比口径;未录容量站不入效率图);全园加权 = Σ有容量站发电 ÷ Σ当月有抄表站容量。
          损耗 = 发电总量 − 自消纳 − 上网,负值为计量异常(红点标注);消纳收益 = Σ自消纳 × 录入时单价快照(与抄表屏全等),
          上网收益 = 上网电量 × {{ gridPrice }} 元(price_cfg 参数价)。按发生日期汇月,缺月不补 0。
        </AnaMethodNote>
      </template>
    </div>
  </AnaShell>
</template>

<style scoped>
.roi2-page { display: flex; flex-direction: column; gap: 10px; width: 100%; min-height: 0; box-sizing: border-box; }

/* 回收进度卡 */
.roi2-big { font-size: var(--fs-display); font-weight: var(--fw-semibold); font-family: var(--font-mono); color: var(--hue-blue); letter-spacing: -0.02em; }
.roi2-bar { height: 8px; border-radius: var(--radius-full); background: var(--ink-100); overflow: hidden; margin: 10px 0 14px; }
.roi2-bar-fill { height: 100%; border-radius: var(--radius-full); background: var(--hue-blue); }
.roi2-rows { display: flex; flex-direction: column; gap: 8px; }
.roi2-rows .r { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.roi2-rows .k { font-size: var(--fs-micro); color: var(--text-muted); }
.roi2-rows .v { font-size: var(--fs-label); font-weight: var(--fw-semibold); font-family: var(--font-mono); color: var(--text-primary); }

/* 选中期摘要 + 明细表 */
.roi2-sel { display: flex; gap: 12px; flex-wrap: wrap; font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 8px; }
.roi2-sel b { font-family: var(--font-mono); color: var(--text-primary); font-weight: var(--fw-semibold); }
.roi2-tblwrap { max-height: 210px; overflow: auto; }

/* ── 分栋抄表分析区(ENERGY-ANALYSIS-SPEC §2) ── */
.roi2-sect { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
.roi2-sect .t { font-size: 14px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.roi2-sect .hint { margin-left: 8px; font-size: var(--fs-micro); color: var(--text-muted); }
.roi2-ysel { font-size: 12px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px; }
.roi2-nocap { margin: 6px 0 0; font-size: 11px; color: var(--text-muted); }
</style>
