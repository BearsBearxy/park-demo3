<script setup lang="ts">
// 损益附表分析(pnl-analysis)v2 — spec §二.13:五附表迷你趋势卡(SVG 保留,点卡选中)
// + 选中附表 12 月组合大图(AnaEChart,对比 ['mom']=上月虚线)+ 收入结构堆叠。
// 数据:anaData.fetchPnlSummary(year).bySchedule(口径与 v1 完全一致,数值锚点不变);
// 数据变换纯函数抽于 pnlAnalysis.logic.ts(单测)。
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaSpark from '@/components/ana/AnaSpark.vue'
import { iconFor } from '@/components/ds/icon'
import { usePeriod } from '@/analysis/usePeriod'
import { useCompare } from '@/analysis/useCompare'
import { fetchPnlSummary, type PnlSummary } from '@/analysis/anaData'
import { finMoney, finWan } from '@/utils/finFmt'
import { fnum } from '@/components/ana/anaFmt'
import { momShift, schedMonthly, schedSpark, schedTotals, structStack } from './pnlAnalysis.logic'

const router = useRouter()
const tabs = useTabsStore()
const period = usePeriod()
const year = computed(() => period.sel.value.year)
const cmp = useCompare(['mom'])

const summary = ref<PnlSummary | null>(null)
const loading = ref(true)
let token = 0   // 年切竞态守卫(范式同 FinPnlView):过期响应弃写
watch(year, async (y) => {
  if (!y) return // 可用月份注入前 year=0,注入后自动触发
  const t = ++token
  loading.value = true
  try {
    const sum = await fetchPnlSummary(y)
    if (t === token) summary.value = sum
  }
  catch { if (t === token) summary.value = null /* 拉失败清空→空态,禁止新年份标签配旧年数值(复审) */ }
  finally { if (t === token) loading.value = false }
}, { immediate: true })

// ── 各附表「全年汇总」+ 迷你趋势(原型 PA_SCHEDS;nav → P2 附表路由) ──
const SCHEDS = [
  { no: '附表1', name: '租金损益', icon: 'home', nav: 'rent-pnl', s: 's1' },
  { no: '附表2', name: '用电损益', icon: 'zap', nav: 'elec-pnl', s: 's2' },
  { no: '附表3', name: '用水损益', icon: 'droplets', nav: 'water-pnl', s: 's3' },
  { no: '附表4', name: '运管损益', icon: 'wrench', nav: 'ops-pnl', s: 's4' },
  { no: '附表5', name: '费用支出', icon: 'banknote', nav: 'expense-pnl', s: 's5' },
] as const

const covMonths = computed(() => summary.value?.months ?? [])
const cards = computed(() => SCHEDS.map((c) => {
  const band = summary.value?.bySchedule[c.s]
  const isExp = c.s === 's5'
  const data = schedTotals(band, isExp)
  return { ...c, isExp, data, spark: band && data ? schedSpark(band, isExp, covMonths.value) : [] }
}))

// KPI 条 = v1 四 KPI(数值锚点)+ 附表覆盖
const pnlCards = computed(() => cards.value.filter((c) => !c.isExp && c.data))
const sumIncome = computed(() => pnlCards.value.reduce((a, c) => a + c.data!.income, 0))
const sumCost = computed(() => pnlCards.value.reduce((a, c) => a + c.data!.cost, 0))
const sumPnl = computed(() => pnlCards.value.reduce((a, c) => a + c.data!.pnl, 0))
const expCost = computed(() => cards.value.find((x) => x.isExp)?.data?.cost ?? null)
const recordedCount = computed(() => cards.value.filter((c) => c.data).length)

const pct = (pnl: number, income: number): string => (income ? (pnl / income * 100).toFixed(1) + '%' : '—')

// ── 选中附表(点卡选中;年切换后若失数据回退到首个有数附表) ──
const sel = ref<string>('s1')
watch(cards, (cs) => {
  if (!cs.find((c) => c.s === sel.value)?.data) sel.value = cs.find((c) => c.data)?.s ?? 's1'
})
const selCard = computed(() => cards.value.find((c) => c.s === sel.value))

// 深链走 openFresh(页签语义,spec §4.1);发链 periodLink(§4.2):年表屏只取年,p=YYYY(改前 ?y=,parsePeriod 仍认旧书签)
function goSched(nav: string): void {
  tabs.openDeep(nav)
  router.push(periodLink(nav, { p: periodOf(year.value, null) }))
}

// ── 主图:选中附表 12 月组合(收入柱+成本柱+损益线;s5=费用柱);环比=上月虚线 ──
const mainOpt = computed<object>(() => {
  const c = selCard.value
  const band = summary.value?.bySchedule[sel.value]
  if (!c || !band) return {}
  const d = schedMonthly(band, c.isExp, covMonths.value)
  const series: object[] = c.isExp
    ? [{ name: '费用', type: 'bar', data: d.cost, barMaxWidth: 26, itemStyle: { color: '#85B7EB' } }]
    : [
        { name: '收入', type: 'bar', data: d.rev, barMaxWidth: 20, itemStyle: { color: '#378ADD' } },
        { name: '成本', type: 'bar', data: d.cost, barMaxWidth: 20, itemStyle: { color: '#B5D4F4' } },
        { name: '损益', type: 'line', data: d.pnl, symbolSize: 6, lineStyle: { width: 2 }, itemStyle: { color: '#185FA5' } },
      ]
  if (cmp.mode.value === 'mom') {
    series.push({
      name: c.isExp ? '费用(上月)' : '损益(上月)', type: 'line',
      data: momShift(c.isExp ? d.cost : d.pnl), symbol: 'none',
      lineStyle: { type: 'dashed', width: 1.5, color: 'rgba(28,28,28,.35)' },
      itemStyle: { color: 'rgba(28,28,28,.35)' },
    })
  }
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 56, right: 14, top: 32, bottom: 26 },
    xAxis: { type: 'category', data: d.labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
    series,
  }
})

// ── 次图:附表1-4 收入结构堆叠 ──
const structOpt = computed<object>(() => {
  const ps = summary.value
  if (!ps) return {}
  const labels = covMonths.value.map((m) => m + '月')
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 56, right: 14, top: 32, bottom: 26 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
    series: structStack(ps.bySchedule, covMonths.value).map((s, i) => ({
      name: s.name, type: 'bar', stack: 'rev', data: s.values, barMaxWidth: 22,
      itemStyle: { color: ['#378ADD', '#85B7EB', '#B5D4F4', '#185FA5'][i] },
    })),
  }
})
</script>

<template>
  <!-- §五:年敏感屏(年度口径),只年控件;watch(year) 重取,所选年空 → 全屏 AnaEmpty -->
  <AnaShell period-mode="year" :compare="['mom']">
    <template #kpis>
      <!-- 年空/加载中不渲染 KPI(禁止沿用旧年数值或展示假 0) -->
      <template v-if="!loading && recordedCount">
        <AnaKpiTile label="分项收入合计" :value="finWan(sumIncome)" :note="year + ' 年全年口径'" />
        <AnaKpiTile label="分项成本合计" :value="finWan(sumCost)" :note="'附表1-4 成本'" />
        <AnaKpiTile label="分项损益合计" :value="finWan(sumPnl)" :note="'损益率 ' + pct(sumPnl, sumIncome)" />
        <AnaKpiTile label="费用支出合计" :value="expCost == null ? '—' : finWan(expCost)" note="附表5 · 不计入分项损益" />
        <AnaKpiTile label="附表覆盖" :value="recordedCount + ' / 5'" :note="covMonths.length + ' 个月有数据'" />
      </template>
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <div v-else-if="!recordedCount" class="pa2-page">
      <AnaEmpty :label="year + ' 年五张损益附表均无数据'" hint="录入附表1-5(租金/用电/用水/运管/费用)后,这里展示趋势与结构"
        to="/rent-pnl" to-text="去录入损益附表" />
    </div>
    <div v-else class="pa2-page">
      <!-- 五附表迷你趋势卡(SVG 保留,点卡选中;空附表 → 深链录入) -->
      <div class="pa2-minis">
        <template v-for="c in cards" :key="c.no">
          <div v-if="!c.data" class="pa2-mini empty">
            <div class="hd">
              <span class="ic dim"><component :is="iconFor(c.icon)" :size="16" /></span>
              <div><div class="no">{{ c.no }}</div><div class="nm">{{ c.name }}</div></div>
            </div>
            <div class="emp"><component :is="iconFor('minus')" :size="13" />本年暂无数据
              <button class="go" @click="goSched(c.nav)">去录入 →</button></div>
          </div>
          <button v-else class="pa2-mini" :class="{ on: sel === c.s }" @click="sel = c.s">
            <div class="hd">
              <span class="ic"><component :is="iconFor(c.icon)" :size="16" /></span>
              <div><div class="no">{{ c.no }}</div><div class="nm">{{ c.name }}</div></div>
              <span v-if="!c.isExp" class="rate" :class="{ neg: c.data.pnl < 0 }">{{ pct(c.data.pnl, c.data.income) }}</span>
            </div>
            <AnaSpark :series="c.spark" :w="150" :h="26" :color="c.isExp ? 'rgb(150,170,205)' : 'var(--hue-blue)'" />
            <div class="ft">
              <span class="l">{{ c.isExp ? '全年支出' : '全年损益' }}</span>
              <span class="v" :class="{ neg: !c.isExp && c.data.pnl < 0 }">{{ finMoney(c.isExp ? c.data.cost : c.data.pnl) }}</span>
              <span class="lnk" title="进入附表" @click.stop="goSched(c.nav)"><component :is="iconFor('arrow-right')" :size="13" /></span>
            </div>
          </button>
        </template>
      </div>

      <div class="av2-grid">
        <!-- 主图 span8:选中附表 12 月组合 -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">{{ selCard?.no }} {{ selCard?.name }} · 12 月组合</span>
            <!-- 移动稿:首段是交互话术,S 档收走时连尾部「· 」一起,余文不残分隔符 -->
            <span class="hint"><span class="hint-desk">点上方卡片切换 · </span>环比=上月虚线 · 万元</span>
          </div>
          <AnaEChart :option="mainOpt" :height="300" />
        </div>
        <!-- 次图 span4:收入结构堆叠 -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">收入结构堆叠</span><span class="hint">附表1-4 · 万元</span></div>
          <AnaEChart :option="structOpt" :height="300" />
        </div>
      </div>

    </div>
  </AnaShell>
</template>

<style scoped>
.pa2-page { display: flex; flex-direction: column; gap: 10px; width: 100%; min-height: 0; box-sizing: border-box; font-family: var(--font-sans); color: var(--text-primary); }

/* 迷你趋势卡条(5 卡等分,窄屏折行) */
.pa2-minis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
.pa2-mini { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; box-sizing: border-box; text-align: left; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-family: var(--font-sans); transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.pa2-mini:hover { border-color: var(--border-strong); }
.pa2-mini.on { border-color: var(--hue-blue); box-shadow: 0 0 0 1px var(--hue-blue) inset; }
.pa2-mini.empty { cursor: default; background: transparent; border-style: dashed; }
.pa2-mini .hd { display: flex; align-items: center; gap: 8px; }
.pa2-mini .ic { width: 30px; height: 30px; flex: 0 0 auto; border-radius: 8px; background: var(--accent-blue); color: var(--hue-blue); display: grid; place-items: center; }
.pa2-mini .ic.dim { background: var(--surface-card); color: var(--text-disabled); }
.pa2-mini .no { font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--text-muted); font-family: var(--font-mono); }
.pa2-mini .nm { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pa2-mini .rate { margin-left: auto; font-size: 11px; font-weight: var(--fw-semibold); font-family: var(--font-mono); padding: 2px 8px; border-radius: var(--radius-full); background: var(--accent-sky); color: var(--hue-blue); white-space: nowrap; }
.pa2-mini .rate.neg { background: rgb(252, 235, 233); color: var(--hue-red); }
.pa2-mini .ft { display: flex; align-items: baseline; gap: 6px; }
.pa2-mini .ft .l { font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; }
.pa2-mini .ft .v { font-size: var(--fs-label); font-weight: var(--fw-semibold); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa2-mini .ft .v.neg { color: var(--hue-red); }
.pa2-mini .ft .lnk { margin-left: auto; color: var(--text-disabled); display: inline-flex; cursor: pointer; }
.pa2-mini .ft .lnk:hover { color: var(--text-primary); }
.pa2-mini .emp { display: flex; align-items: center; gap: 6px; color: var(--text-disabled); font-size: 12px; padding: 4px 0; }
.pa2-mini .emp .go { margin-left: auto; border: none; background: transparent; font-size: var(--fs-micro); color: var(--text-link); cursor: pointer; font-family: var(--font-sans); padding: 0; }
.pa2-mini .emp .go:hover { text-decoration: underline; }
</style>
