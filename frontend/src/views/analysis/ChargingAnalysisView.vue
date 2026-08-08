<script setup lang="ts">
// 充电桩分析(charging-analysis)— ENERGY-ANALYSIS-SPEC §3:汽车/电动车双 tab(默认汽车,各自独立口径)。
// 结论条(年充电量/收益/手续费/平均损耗率)+ 图1 桩月度量收双轴(充电量堆叠柱+收益线)
// + 图2 运营商收益占比环图与手续费率对比 + 图3 电表损耗率月度线(负值红点,无电表月断点不连线)。
// 固定按年(spec §6),年份数据驱动(cpMeterApi.years,同 CpMeterView);全年一次取数,tab 切换=前端过滤。
// cp_reading 为空 → AnaEmpty 引导(护栏硬要求,禁止渲染 0 假数据);数据变换纯函数抽 chargingAnalysis.logic.ts(单测)。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import Select from '@/components/ds/Select.vue'
import { iconFor } from '@/components/ds/icon'
import { fnum, STATUS, type AnaStatusLevel } from '@/components/ana/anaFmt'
import { cpMeterApi, type CpPowerUsageDTO, type CpReadingDTO, type CpStationDTO } from '@/api/cpMeter'
import { buildYearOptions } from '@/utils/yearGate'
import { feeRate, lossSeries, operatorTotals, stationMonthly, yearSummary } from './chargingAnalysis.logic'

const router = useRouter()
const tabs = useTabsStore()

// ── 双 tab(Segmented,默认汽车;共享桩库按 vehicleType 过滤,同 CpMeterView) ──
const tab = ref<'car' | 'ebike'>('car')
const TAB_ZH: Record<'car' | 'ebike', string> = { car: '汽车', ebike: '电动车' }

// ── 年份(数据驱动:有记录年 ∪ 当前年,默认最新有数据年;固定按年,无月粒度) ──
const today = new Date()
const year = ref(today.getFullYear())
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map((y) => ({ value: String(y), label: `${y}年` })),
)

// ── 取数:桩库一次 + 该年整年 readings/power-usage(month 缺省=全年,§4 新口);竞态守卫同 CpMeterView ──
const stations = ref<CpStationDTO[]>([])
const readings = ref<CpReadingDTO[]>([])
const usage = ref<CpPowerUsageDTO[]>([])
const loading = ref(true)
const failed = ref(false)
let seq = 0
async function load(y: number) {
  const my = ++seq
  loading.value = true
  failed.value = false
  try {
    const [sts, rds, pus] = await Promise.all([
      stations.value.length ? Promise.resolve(stations.value) : cpMeterApi.stations(),
      cpMeterApi.readings(y),
      cpMeterApi.powerUsage(y),
    ])
    if (my !== seq) return
    stations.value = sts
    readings.value = rds
    usage.value = pus
  } catch {
    if (my === seq) failed.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}
onMounted(async () => {
  try {
    dataYears.value = await cpMeterApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // 改年经 watch 触发 load
  } catch { /* 年份拉取失败不阻断:保持当前年 */ }
  void load(year.value)
})
watch(year, (y) => { void load(y) })

// ── 当前 tab 视角(前端过滤;logic 纯函数不认识 tab) ──
const myStations = computed(() => stations.value.filter((s) => s.vehicleType === tab.value))
const myIds = computed(() => new Set(myStations.value.map((s) => s.id)))
const myReadings = computed(() => readings.value.filter((r) => myIds.value.has(r.stationId)))
const myUsage = computed(() => usage.value.filter((u) => u.vehicleType === tab.value))
// 护栏:该类型该年无任何 cp_reading → 整区空态引导,不画假图
const empty = computed(() => !myReadings.value.length)

// 深链(openFresh 协议同 ChurnView.goLedger):附表7/8 屏为功能门结构(ChargingView mode gate),
// 落地后点「分桩充电明细」卡进入;该屏不消费 query,本刀不改它 → 深链到门,不带参。
const navValue = computed(() => (tab.value === 'ebike' ? 'ebike-charging' : 'car-charging'))
function goDetail(): void {
  tabs.openFresh(navValue.value, { pin: true })
  void router.push({ path: '/' + navValue.value })
}

// ── 结论条(数据模板分句,同 CockpitView §A 观感;损耗率缺电表→诚实说不可算) ──
const pct = (v: number): string => (v * 100).toFixed(1) + '%'
const sum = computed(() => yearSummary(myReadings.value, myUsage.value))
const conclusion = computed<{ text: string; tone: AnaStatusLevel }[]>(() => {
  if (empty.value) return []
  const s = sum.value
  const fr = feeRate(s.fee, s.revenue)
  const lossSeg = s.avgLossRate == null
    ? { text: '电表用电量未录,损耗率不可算', tone: 'neutral' as const }
    : s.avgLossRate < 0
      ? { text: `平均损耗率 ${pct(s.avgLossRate)}(电表小于充电量,计量异常)`, tone: 'risk' as const }
      : { text: `平均损耗率 ${pct(s.avgLossRate)}(电表口径)`, tone: 'good' as const }
  return [
    { text: `${year.value}年${TAB_ZH[tab.value]}桩充电 ${fnum(s.chargeKwh, 0)} kWh`, tone: 'good' },
    { text: `收益 ¥${fnum(s.revenue, 0)}`, tone: 'good' },
    { text: `手续费 ¥${fnum(s.fee, 0)}${fr != null ? '(费率 ' + pct(fr) + ')' : ''}`, tone: 'neutral' },
    lossSeg,
  ]
})

// ── 图1 桩月度量收:各桩充电量堆叠柱 + 月收益线(双轴) ──
const M_LABELS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`)
const sm = computed(() => stationMonthly(myStations.value, myReadings.value))
const chart1Opt = computed<object>(() => ({
  tooltip: { trigger: 'axis' },
  legend: { top: 0, type: 'scroll' },
  grid: { left: 56, right: 56, top: 32, bottom: 26 },
  xAxis: { type: 'category', data: M_LABELS },
  yAxis: [
    { type: 'value', name: 'kWh', nameTextStyle: { fontSize: 10 } },
    { type: 'value', name: '元', nameTextStyle: { fontSize: 10 }, splitLine: { show: false } },
  ],
  series: [
    ...sm.value.stations.map((s) => ({
      name: s.name, type: 'bar', stack: 'chg', barMaxWidth: 30,
      data: s.charge.map((v) => +v.toFixed(1)),
    })),
    {
      name: '收益', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 5,
      itemStyle: { color: '#185FA5' }, lineStyle: { width: 2, color: '#185FA5' },
      data: sm.value.revenue.map((v) => +v.toFixed(0)),
    },
  ],
}))

// ── 图2 运营商结构:收益占比环图 + 手续费率横条 ──
const ops = computed(() => operatorTotals(myStations.value, myReadings.value))
const donutRows = computed(() => ops.value.filter((o) => o.revenue > 0))
const donutOpt = computed<object>(() => ({
  tooltip: {
    formatter: (p: { name?: string; value?: number; percent?: number }) =>
      `${p.name}<br/>¥${fnum(p.value ?? 0, 0)}(${p.percent}%)`,
  },
  legend: { top: 0 },
  series: [{
    type: 'pie', radius: ['52%', '76%'], center: ['50%', '57%'],
    label: { fontSize: 11, formatter: '{b} {d}%' },
    data: donutRows.value.map((o) => ({ name: o.operator, value: +o.revenue.toFixed(0) })),
  }],
}))
const feeRows = computed(() => ops.value.filter((o) => o.feeRate != null))
const feeOpt = computed<object>(() => ({
  tooltip: { valueFormatter: (v: number) => v + '%' },
  grid: { left: 76, right: 48, top: 8, bottom: 22 },
  xAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
  yAxis: { type: 'category', data: [...feeRows.value].reverse().map((o) => o.operator) },
  series: [{
    name: '手续费率', type: 'bar', barMaxWidth: 20,
    data: [...feeRows.value].reverse().map((o) => +(o.feeRate! * 100).toFixed(2)),
    itemStyle: { color: '#85B7EB', borderRadius: [0, 3, 3, 0] },
    label: { show: true, position: 'right', fontSize: 11, formatter: '{c}%' },
  }],
}))

// ── 图3 电表损耗率月度线:负值逐点红(计量异常);null=无电表月断点(connectNulls 关) ──
const loss = computed(() => lossSeries(myUsage.value))
const hasLoss = computed(() => loss.value.some((l) => l.rates.some((v) => v != null)))
const lossOpt = computed<object>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? v.toFixed(1) + '%' : '—') },
  legend: { top: 0 },
  grid: { left: 48, right: 14, top: 30, bottom: 26 },
  xAxis: { type: 'category', data: M_LABELS, boundaryGap: false },
  yAxis: { type: 'value', scale: true, axisLabel: { formatter: '{value}%' } },
  series: loss.value.map((l) => ({
    name: l.operator, type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2 },
    data: l.rates.map((v) =>
      v == null ? null : { value: +(v * 100).toFixed(1), itemStyle: v < 0 ? { color: '#E24B4A' } : undefined }),
  })),
}))
</script>

<template>
  <!-- §五语义:固定按年 → 期间控件隐藏(periodMode none),口径徽章 + tools 槽放 tab/年份 -->
  <AnaShell period-mode="none" :scope-chip="year + '年 · 全年口径'">
    <template #tools>
      <span class="ak-seg2" role="group" aria-label="桩类型">
        <button :class="{ on: tab === 'car' }" @click="tab = 'car'">汽车</button>
        <button :class="{ on: tab === 'ebike' }" @click="tab = 'ebike'">电动车</button>
      </span>
      <div style="width: 110px">
        <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
      </div>
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <AnaEmpty v-else-if="failed" label="数据加载失败" hint="请刷新重试" />
    <div v-else class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('plug')" :size="20" /></span>
          <div>
            <h2 class="ak-title">充电桩分析</h2>
            <p class="ak-sub">{{ TAB_ZH[tab] }}桩 · 桩月度量收 · 运营商结构 · 电表损耗率 · {{ year }}年</p>
          </div>
        </div>
      </div>

      <!-- 护栏:该类型该年无 cp_reading → 空态引导去分桩明细录入,不画假图(硬要求) -->
      <AnaEmpty
        v-if="empty"
        :label="year + ' 年' + TAB_ZH[tab] + '桩暂无分桩充电明细'"
        :hint="'分桩明细(cp_reading)未录入,无法计算量收与损耗 — 进入附表' + (tab === 'ebike' ? '8' : '7') + ' 屏后选「分桩充电明细」录入或导入'"
        :to="'/' + navValue"
        to-text="去录入分桩明细"
      />

      <template v-else>
        <!-- 结论条(CockpitView §A 同观感:分句 + tone 圆点;点击深链分桩明细) -->
        <div class="av2-card ca-concl">
          <span v-for="(c, i) in conclusion" :key="i" class="ca-cs">
            <span class="dot" :style="{ background: STATUS[c.tone].color }"></span>{{ c.text }}
          </span>
          <button class="ca-cs lk" @click="goDetail">查看分桩明细 →</button>
        </div>

        <div class="av2-grid">
          <!-- 图1 s12:桩月度量收(充电量堆叠柱 + 收益线,双轴) -->
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">桩月度量收 · {{ year }}年</span>
              <span class="hint">左轴充电量 kWh(按桩堆叠)· 右轴收益 元 · 点图深链分桩明细</span>
            </div>
            <AnaEChart :option="chart1Opt" :height="300" @chart-click="goDetail" />
          </div>

          <!-- 图2a s6:运营商收益占比环图 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">运营商收益占比</span>
              <span class="hint">全年收益 元 · 点图深链分桩明细</span>
            </div>
            <AnaEChart v-if="donutRows.length" :option="donutOpt" :height="232" @chart-click="goDetail" />
            <AnaEmpty v-else label="本年收益均为 0" hint="有充电记录但收益未填,先到分桩明细补录" :to="'/' + navValue" to-text="去补录" />
          </div>

          <!-- 图2b s6:手续费率对比 -->
          <div class="av2-card av2-s6">
            <div class="av2-card-h">
              <span class="t">运营商手续费率</span>
              <span class="hint">手续费 ÷(收益+手续费)· 全年口径</span>
            </div>
            <AnaEChart v-if="feeRows.length" :option="feeOpt" :height="232" @chart-click="goDetail" />
            <AnaEmpty v-else label="本年无可算费率" hint="收益与手续费全为 0,费率不可算" />
          </div>

          <!-- 图3 s12:电表损耗率月度线(负值红点=计量异常;无电表月断点) -->
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">电表损耗率趋势 · 每运营商</span>
              <span class="hint">(电表量−Σ充电量)÷电表量 · 红点=负值计量异常 · 无电表月断点不连线</span>
            </div>
            <AnaEChart v-if="hasLoss" :option="lossOpt" :height="216" @chart-click="goDetail" />
            <AnaEmpty v-else label="本年电表用电量未录入" hint="到分桩明细「电表与损耗」小节按运营商按月录入电表量后可算损耗率"
              :to="'/' + navValue" to-text="去录电表量" />
          </div>
        </div>

        <AnaMethodNote>
          量收=分桩明细(cp_reading)三金额直加(平台对账单抄录口径);手续费率=手续费÷(收益+手续费);
          损耗率=(运营商电表量−Σ该运营商{{ TAB_ZH[tab] }}桩充电量)÷电表量,平均损耗率按电表已录月加权;
          与分桩明细屏口径全等。附表{{ tab === 'ebike' ? '8' : '7' }} 月度汇总为独立数据域,不入本屏。
        </AnaMethodNote>
      </template>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 结论条:CockpitView .cv2-concl 同观感(av2-card 分句 flex wrap;末句=深链按钮) */
.ca-concl { display: flex; flex-wrap: wrap; align-items: center; column-gap: 20px; row-gap: 6px; }
.ca-cs { display: inline-flex; align-items: center; gap: 7px; border: none; background: transparent; padding: 0; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.ca-cs .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.ca-cs.lk { cursor: pointer; color: var(--text-link); }
.ca-cs.lk:hover { text-decoration: underline; }
</style>
