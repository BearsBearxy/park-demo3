<script setup lang="ts">
// 园区能耗(park-energy)— 2026-10 改稿 energy-v2:回答「电这块这个月(这一年)从哪来、到哪去、赚多少」。
// 按月:四张瓦(都和上个月比)+ 电从哪来、到哪去(流向图,节点标本月和上月)+ 各项收益(本月和上月成对条)。
// 按年:五张瓦(写覆盖)+ 流向图(销售收入表有数的月)+ 各月售电收入和购电成本 + 各月单位购电成本 + 各项收益。
// 数和字全在 parkEnergy.logic(字从句型库出),这里只取数、画图。屏名在工具条,不再有页头大标题;对比开关拿掉。
import { computed, onMounted, ref, watch } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import { anaPalette, anaSvgVars } from '@/components/ana/anaTheme'
import { hues, inkA } from '@/components/ana/anaFmt'
import * as S from '@/components/ana/anaSentence'
import {
  buildEnergyMonths, fetchAvailableMonths, fetchChargingYear, fetchElecYear, fetchPvAll, fetchS10Rows, fetchUtilitiesYear,
} from '@/analysis/anaData'
import { asofOf, buildAmtMonths, monthModel, yearModel, type EnergyData, type FlowNode } from './parkEnergy.logic'
import { usePeriod, type PeriodSel } from '@/analysis/usePeriod'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { iconFor } from '@/components/ds/icon'
import { isSViewport } from '@/components/ana/anaChartHeight'

const E = S.ENERGY
const isS = isSViewport()   // 手机(≤600):挂载时判一次,同 AnaEChart
const period = usePeriod()
const loading = ref(true)
/** 这一年没读到时失败件的那句话(空串 = 没失败)。只在成功分支清:重试在途时失败件留在原地。 */
const failed = ref('')
// 换年在途(C5-02):旧内容留在原地退让,不卸载;过 200ms 门才亮、到数立刻灭
const staleShown = useDeferredFlag(loading)
/** 已画在屏上的期间。年要等数据一起换;同一年里切月 / 切粒度不打接口,直接跟 sel。null = 还没有任何数据。 */
const shown = ref<PeriodSel | null>(null)
watch(() => period.sel.value, (s) => { if (s.year === shown.value?.year) shown.value = s })
const view = computed(() => shown.value ?? period.sel.value)
const data = ref<EnergyData | null>(null)

// 工具条「数据截至」:购电、销售收入表、光伏各到哪个月(onMounted:让外壳先取 —— 子组件的 onMounted 先跑,同一份缓存)
const asofText = ref<string>()
// 手机上也写全三份(工具条那句允许折行),不退回「截至 最晚月」—— 那会把购电也读成到 2026年1月
onMounted(() => { void fetchAvailableMonths().then((d) => { asofText.value = asofOf(d.sources) }).catch(() => {}) })

let token = 0   // 年切竞态守卫:过期响应弃写
async function load(year: number) {
  if (!year) return
  const t = ++token
  loading.value = true
  try {
    // 上一年一起取:1 月比上一年 12 月;按年和往年比
    const yearOf = (y: number) => Promise.all([fetchElecYear(y), fetchChargingYear(7, y), fetchChargingYear(8, y), fetchUtilitiesYear(13, y), fetchUtilitiesYear(14, y)])
    const [cur, past, pv, s10] = await Promise.all([yearOf(year), yearOf(year - 1), fetchPvAll(), fetchS10Rows()])
    if (t !== token) return
    const build = (y: number, [elec, c7, c8, o13, o14]: Awaited<ReturnType<typeof yearOf>>) => ({
      mon: buildEnergyMonths(y, elec, pv, [c7, c8], [o13, o14], s10),
      amt: buildAmtMonths(y, elec, pv, [c7, c8], [o13, o14], s10),
    })
    const a = build(year, cur), b = build(year - 1, past)
    data.value = { year, mon: a.mon, amt: a.amt, monPast: b.mon, amtPast: b.amt }
    shown.value = { ...period.sel.value, year }
    failed.value = ''
  } catch {
    if (t === token) failed.value = `${year} 年的园区能耗数据没读到`
  } finally {
    if (t === token) loading.value = false
  }
}
watch(() => period.sel.value.year, (y) => { void load(y) }, { immediate: true })

const mm = computed(() => (data.value && view.value.gran === 'month' ? monthModel(data.value, view.value.month) : null))
const ym = computed(() => (data.value && view.value.gran === 'year' ? yearModel(data.value) : null))
const flow = computed(() => mm.value?.flow ?? ym.value?.flow ?? null)

// ── KPI:首进 / 失败期不清空整排瓦(C6-01),标签常驻、值写「—」;按月不放购电成本那张(主卡回退时 logic 会加回来) ──
const T = E.tile
const KPI_LABELS = [T.buy, T.unit, T.kwh, T.pv, T.pvShare]
const kpis = computed(() => (!shown.value || failed.value
  ? KPI_LABELS.map((label) => ({ label, value: '—', loading: !shown.value && !failed.value })).slice(period.sel.value.gran === 'month' ? 1 : 0)
  // 真瓦显式带 loading:false —— 值同为「—」时(按年选到没有购电数据的年),占位瓦和真瓦键数、值都一样,
  // Vue 判 props 没变不更新,三张瓦永远停在微光(对抗复查 10-05)
  : ((mm.value ?? ym.value)?.kpis ?? []).map((k) => ({ ...k, loading: false }))))

// ── 颜色:一个科目全屏一个颜色(蓝阶):售电收入 中蓝 / 购电成本 深蓝 / 光伏自用 浅蓝 / 办公、充电 最浅;
//    收益卡不是科目,是「本期 / 上期」:灰阶;售电收益线 = 基线灰。都跟外观走。 ──
const col = () => {
  const h = hues()
  return { sell: h.blue, buy: h.deep, pvSelf: h.mid, office: h.pale, chg: h.pale, cur: anaPalette().cmp.baseline, prev: anaSvgVars()['--sv-bar-muted'], red: h.red }
}

// ── 电从哪来、到哪去:左 = 购电成本、光伏自用,中 = 园区用电(不标字),右 = 售电收入、充电桩用电、办公和三期用电;
//    金额直接标在节点旁(图里一律 11 号) ──
const flowOption = computed(() => {
  const f = flow.value
  if (!f) return null
  const P = anaPalette(), C = col()
  const rich = { n: { fontSize: 11, color: P.legend }, v: { fontSize: 11, fontWeight: 600, color: inkA(1) }, p: { fontSize: 11, color: P.label } }
  const node = (n: FlowNode) => ({
    name: n.name, itemStyle: { color: C[n.key] },
    // 手机上两侧只有三成宽:名字、金额分两行,上期不写(读数句里有)
    label: { show: true, position: n.side === 'l' ? 'left' : 'right', distance: isS ? 4 : 8, rich,
      formatter: isS ? `{n|${n.name}}\n{v|${n.val}}` : `{n|${n.name}}  {v|${n.val}}${n.prev ? `  {p|${n.prev}}` : ''}` },
  })
  const L = f.nodes.filter((n) => n.side === 'l'), R = f.nodes.filter((n) => n.side === 'r')
  return {
    series: [{
      // 左右留白按画板 1440 宽(214 / 250 of 946)折成百分比;手机上标签折两行,两侧各给三成
      type: 'sankey', left: isS ? '32%' : '22.6%', right: isS ? '32%' : '26.4%', top: 28, bottom: isS ? 20 : 8, nodeWidth: 14, nodeGap: isS ? 30 : 18, nodeAlign: 'justify',   // 两行标签要 30 的缝才不叠、底下留半行
      layoutIterations: 0, draggable: false, lineStyle: { color: 'gradient', opacity: 0.32, curveness: 0.55 },
      data: [...L.map(node), { name: E.node.hub, itemStyle: { color: inkA(0.28) }, label: { show: false } }, ...R.map(node)],
      links: [...L.map((n) => ({ source: n.name, target: E.node.hub, value: n.value })), ...R.map((n) => ({ source: E.node.hub, target: n.name, value: n.value }))],
    }],
  }
})

// ── 各项收益 · 按月:上月浅、本月实的成对条,每根条都标数(没有数值轴的 ≤3 行小成对条,sp-ask2 第 3 条);负值往左、标红 ──
const earnOption = computed(() => {
  const e = mm.value?.earn
  if (!e) return {}
  const P = anaPalette(), C = col()
  const all = [...e.prev, ...e.cur].filter((v): v is number => v != null)
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all), pad = (hi - lo) * 0.22
  const lab = (color: string, base: string) => (v: number | null) => (v == null ? null
    : { value: v, itemStyle: { color: v < 0 ? C.red : base }, label: { show: true, position: v < 0 ? 'left' : 'right', formatter: S.yuan(v), color, fontSize: 11 } })
  return {
    legend: { top: 0, data: [e.prevName, e.curName] },
    grid: { left: 128, right: 56, top: 30, bottom: 8 },
    xAxis: { type: 'value', min: lo < 0 ? lo - pad : 0, max: hi + pad, axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', inverse: true, data: e.cats, axisLine: { lineStyle: { color: P.axis } }, axisLabel: { color: P.legend, fontSize: 11 } },
    series: [
      { name: e.prevName, type: 'bar', barWidth: 12, barGap: '20%', itemStyle: { color: C.prev }, data: e.prev.map(lab(P.label, C.prev)) },
      { name: e.curName, type: 'bar', barWidth: 12, itemStyle: { color: C.cur }, data: e.cur.map(lab(P.legend, C.cur)) },
    ],
  }
})

// ── 各月售电收入和购电成本(按年):12 个月位都留,没数的月空着;售电收益线只连有数的月,
//    读数句点到的最高、最低月在线上标数,标签抬到较高那根柱顶上方、引线连回点 ──
const BARS_H = 260
const barsOption = computed(() => {
  const b = ym.value?.bars
  if (!b) return {}
  const P = anaPalette(), C = col()
  const vals = [...b.sell, ...b.buy, ...b.gap].filter((v): v is number => v != null)
  const max = Math.max(50, Math.ceil(Math.max(0, ...vals) / 50) * 50), min = Math.floor(Math.min(0, ...vals) / 50) * 50
  const px = (BARS_H - 34 - 26) / (max - min)   // 绘图区高 / 纵轴跨度:每万元几像素
  const marked = new Set(b.marks)
  const lift = (i: number) => (Math.max(b.sell[i] ?? 0, b.buy[i] ?? 0) - b.gap[i]!) * px + 4
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : S.yuan(v)) },
    legend: { top: 0, data: [E.node.sell, E.node.buy, E.seg.resale] },
    grid: { left: 52, right: 16, top: 34, bottom: 26 },
    xAxis: { type: 'category', data: b.months },
    yAxis: { type: 'value', min, max, interval: 50, axisLabel: { formatter: S.axisWan } },
    series: [
      { name: E.node.sell, type: 'bar', barMaxWidth: 16, barGap: '15%', itemStyle: { color: C.sell }, data: b.sell },
      { name: E.node.buy, type: 'bar', barMaxWidth: 16, itemStyle: { color: C.buy }, data: b.buy },
      {
        name: E.seg.resale, type: 'line', symbol: 'circle', symbolSize: 6, connectNulls: false, z: 3,
        itemStyle: { color: C.cur }, lineStyle: { width: 1.5, color: C.cur },
        data: b.gap.map((v, i) => (v == null || !marked.has(i) ? v
          : { value: v, label: { show: true, position: 'top', distance: 4, formatter: S.yuan(v), fontSize: 11, color: P.legend }, labelLine: { show: true, lineStyle: { color: C.cur, width: 1 } } })),
        labelLayout: (p: { dataIndex: number }) => (marked.has(p.dataIndex) ? { dy: -lift(p.dataIndex) } : {}),
      },
    ],
  }
})

// ── 各月单位购电成本(按年):最高最低(含并列)标在图上;没有均值虚线 ──
const unitOption = computed(() => {
  const u = ym.value?.unit
  if (!u) return {}
  const P = anaPalette(), deep = col().buy
  const vs = u.values.filter((v): v is number => v != null)
  const lo = vs.length ? Math.floor(Math.min(...vs) * 5) / 5 : 0, hi = vs.length ? Math.ceil(Math.max(...vs) * 5) / 5 : 1
  const his = new Set(u.his), marked = new Set([...u.his, ...u.los])
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : S.perKwh(v)) },
    grid: { left: 40, right: 16, top: 26, bottom: 24 },
    xAxis: { type: 'category', data: u.months, boundaryGap: false, axisLabel: { interval: 0 } },
    yAxis: { type: 'value', min: lo, max: Math.max(hi, lo + 0.2), interval: 0.2, axisLabel: { formatter: (v: number) => v.toFixed(1) } },
    series: [{
      type: 'line', symbol: 'circle', symbolSize: 5, itemStyle: { color: deep }, lineStyle: { width: 2, color: deep },
      data: u.values.map((v, i) => (v == null ? null : {
        value: v,
        label: marked.has(i) ? { show: true, position: his.has(i) || i === 0 ? 'right' : 'bottom', formatter: S.perKwh(v), fontSize: 11, color: P.legend } : { show: false },
      })),
    }],
  }
})

// ── 各项收益 · 按年:三项各自有数的月数写在条旁;光伏收益和往年同期比的两个数,深色气泡贴在条端下方(不带环、不带尖角) ──
const yEarnOption = computed(() => {
  const e = ym.value?.earn
  if (!e) return {}
  const P = anaPalette(), C = col()
  const vs = e.items.map((i) => i.value).filter((v): v is number => v != null)
  return {
    grid: { left: 128, right: 130, top: 4, bottom: 4 },
    xAxis: { type: 'value', show: false, min: Math.min(0, ...vs), max: Math.max(0, ...vs) },
    yAxis: { type: 'category', inverse: true, data: e.items.map((i) => i.name), axisLine: { lineStyle: { color: P.axis } }, axisTick: { show: false }, axisLabel: { color: P.legend, fontSize: 11 } },
    series: [{
      type: 'bar', barWidth: 14,
      data: e.items.map((i) => (i.value == null ? null : {
        value: i.value, itemStyle: { color: i.value < 0 ? C.red : C.cur },
        label: { show: true, position: i.value < 0 ? 'left' : 'right', distance: 10, formatter: i.label, fontSize: 11, color: P.legend },
      })),
      // AnaEChart 按 markPoint 数据项上的 callout 摆气泡;symbolSize 0 = 不画环
      ...(e.mark ? { markPoint: { silent: true, symbol: 'circle', symbolSize: 0, label: { show: false }, data: [{ coord: [e.mark.value, E.seg.pv], callout: { lines: e.mark.lines, prefer: 'bottom' } }] } } : {}),
    }],
  }
})
</script>

<template>
  <!-- 月敏感屏(full);流向图月锚回退以卡头标签显式 -->
  <AnaShell period-mode="full" :busy="staleShown" :asof-text="asofText">
    <template #tools>
      <span class="pe-name"><component :is="iconFor('zap')" :size="15" />{{ E.screen }}</span>
    </template>
    <template #kpis>
      <AnaKpiTile v-for="k in kpis" :key="k.label" v-bind="k" pct-unit />
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。卡头照抄真版式,图块 = AnaSkelChart(高同各 AnaEChart),读数句 / 参照按 12 月板留行。
         只认首进:换年时旧内容留在原地退让(C5-02),不退回骨架。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <div v-if="loading && !shown" class="ak-page ak-skel">
      <div class="av2-grid">
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">{{ E.card.flow }}</span><span class="hint"><span class="ana-hole">{{ S.hint(E.byAmt, S.cmpWith(12), '万元') }}</span></span></div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"></p>
          <p class="ana-ref hold"></p>
        </div>
        <div v-if="period.sel.value.gran === 'month'" class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">{{ E.card.earn }}</span><span class="hint"><span class="ana-hole">{{ S.hint(S.cmpWith(12), '万元') }}</span></span></div>
          <AnaSkelChart :height="150" />
          <p class="ana-read hold"></p>
          <p v-for="i in 3" :key="i" class="ana-ref hold"></p>
        </div>
        <template v-else>
          <div class="av2-card av2-s12">
            <div class="av2-card-h"><span class="t">{{ E.card.bars }}</span><span class="hint">万元</span></div>
            <AnaSkelChart :height="260" />
            <p class="ana-read hold"></p>
            <p class="ana-ref hold"></p>
          </div>
          <div class="av2-card av2-s6">
            <div class="av2-card-h"><span class="t">{{ E.card.unit }}</span><span class="hint">{{ E.unitU }}</span></div>
            <AnaSkelChart :height="230" />
            <p class="ana-read hold"></p>
            <p v-for="i in 2" :key="i" class="ana-ref hold"></p>
          </div>
          <div class="av2-card av2-s6">
            <div class="av2-card-h"><span class="t">{{ E.card.earn }}</span><span class="hint">万元</span></div>
            <AnaSkelChart :height="128" />
            <p class="ana-read hold"></p>
            <p v-for="i in 4" :key="i" class="ana-ref hold"></p>
          </div>
        </template>
      </div>
    </div>
    <!-- skel:end -->
    <!-- 加载失败:换掉内容区,带重试;重试走同一个 load(首载 / 换年共用) -->
    <FPLoadError v-else-if="failed" sub="屏上不显示别的年份的数字" @retry="load(period.sel.value.year)">{{ failed }}</FPLoadError>
    <!-- data-stale-host 常挂:类摘掉后仍有 transition-property,退场才是 200 而不是硬切 -->
    <div v-else class="ak-page" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">
      <div class="av2-grid">
        <!-- av2-core:流向图是本屏主卡(手机上排最前) -->
        <div class="av2-card av2-s12 av2-core">
          <div class="av2-card-h">
            <span class="t">{{ E.card.flow }}<FPStateTag v-if="flow?.tag" tone="muted" style="margin-left: 8px">{{ flow.tag }}</FPStateTag></span>
            <span class="hint">{{ flow?.hint }}</span>
          </div>
          <AnaEChart v-if="flowOption" :option="flowOption" :height="250" />
          <AnaEmpty v-else :label="(mm ?? ym)?.flowEmpty" />
          <p class="ana-read hold">{{ flow?.read }}</p>
          <p v-for="t in flow?.refs ?? []" :key="t" class="ana-ref">{{ t }}</p>
        </div>

        <div v-if="mm" class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">{{ E.card.earn }}</span><span class="hint">{{ mm.earn.hint }}</span></div>
          <AnaEChart :option="earnOption" :height="150" />
          <p class="ana-read hold">{{ mm.earn.read }}</p>
          <p v-for="t in mm.earn.refs" :key="t" class="ana-ref">{{ t }}</p>
        </div>

        <template v-else-if="ym">
          <div class="av2-card av2-s12">
            <div class="av2-card-h"><span class="t">{{ E.card.bars }}</span><span class="hint">{{ ym.bars.hint }}</span></div>
            <AnaEChart :option="barsOption" :height="260" />
            <p class="ana-read hold">{{ ym.bars.read }}</p>
            <p v-for="t in ym.bars.refs" :key="t" class="ana-ref">{{ t }}</p>
          </div>
          <div class="av2-card av2-s6">
            <div class="av2-card-h"><span class="t">{{ E.card.unit }}</span><span class="hint">{{ ym.unit.hint }}</span></div>
            <AnaEChart :option="unitOption" :height="230" />
            <p class="ana-read hold">{{ ym.unit.read }}</p>
            <p v-for="t in ym.unit.refs" :key="t" class="ana-ref">{{ t }}</p>
          </div>
          <div class="av2-card av2-s6 pe-nopin">
            <div class="av2-card-h"><span class="t">{{ E.card.earn }}</span><span class="hint">{{ ym.earn.hint }}</span></div>
            <AnaEChart :option="yEarnOption" :height="128" />
            <p class="ana-read hold">{{ ym.earn.read }}</p>
            <p v-for="t in ym.earn.refs" :key="t" class="ana-ref">{{ t }}</p>
          </div>
        </template>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 屏名进工具条(同驾驶舱 .cv2-name):排在期间前面,14 号半粗 */
.pe-name { order: -1; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
/* 按年各项收益的气泡不指条上某一点:不画尖角 */
.pe-nopin :deep(.ana-callout)::after { display: none; }
</style>
