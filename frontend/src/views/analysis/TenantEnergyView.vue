<script setup lang="ts">
// 租户用能工作台(tenant-energy)v2 — spec §二.5,示意图2 左右结构:
// 左列=租户搜索列表(按本期费额降序,点击选中);右=选中租户电/水费趋势 vs 园区均值带(AnaEChart)
// + 应收实收对比 + 深链(查台账/查附表10);下方 Top20 榜(点击选中联动)+ 费额vs月租散点(点点选中)。
// 口径与 v1 完全一致(数值锚点不变):s10 为费用金额(元),电=基本+标准+维护电费、水=标准+维护水费;
// 「本期」=≤所选期间的最近 s10 月;窗口=≤本期的全部 s10 月;台账应收/实收仅覆盖既有期,如实标注。
// 数据变换纯函数见 ./TenantEnergy.logic.ts(单测)。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import AnaShell from './AnaShell.vue'
import { usePeriod } from '@/analysis/usePeriod'
import { anaSettings } from '@/analysis/anaSettings'
import { fetchLedgerRows, fetchS10TenantMap, fetchTenants } from '@/analysis/anaData'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import type { TenantDTO } from '@/types/tenant'
import { iconFor } from '@/components/ds/icon'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import { NEG, WARN, fint } from '@/components/ana/anaFmt'
import { PHASES } from '@/views/sales-income/layout'
import { buildFamilyMap } from '@/analysis/anaFamily'
import { buildFamilyRows, buildParkBand, buildPayRows, buildTenantRows, splitLogPoints, tenantSeries } from './TenantEnergy.logic'

const period = usePeriod()
const router = useRouter()
const tabs = useTabsStore()
const loaded = ref(false)
const err = ref('')
const metric = ref<'elec' | 'water'>('elec')
const TOGGLES: { k: 'elec' | 'water'; l: string }[] = [{ k: 'elec', l: '电费' }, { k: 'water', l: '水费' }]

const tenantMap = ref<Map<string, AnalysisS10Row[]>>(new Map())
const ledgerRows = ref<AnalysisLedgerRow[]>([])
const tenantList = ref<TenantDTO[]>([])

async function reload() {
  // 切回重读会重跑本函数:错误不清,重试成功后屏上仍挂着上次的失败文案(P3 T2 评审坐实)
  err.value = ''
  try {
    const [tm, lr, ts] = await Promise.all([fetchS10TenantMap(), fetchLedgerRows(), fetchTenants()])
    tenantMap.value = tm
    ledgerRows.value = lr
    tenantList.value = ts
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    loaded.value = true
  }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })

// ── 期区标签/配色(ECharts canvas 不识别 CSS 变量 → fpAnaTheme 蓝族字面值) ──
const phaseName = (p: number): string => PHASES.find((x) => x.phase === p)?.short ?? `期区${p}`
const PHASE_HEX = ['#378ADD', '#85B7EB', '#185FA5', '#5DCAA5']
const phaseHex = (p: number): string => PHASE_HEX[(p - 1 + PHASE_HEX.length) % PHASE_HEX.length]

// ── 期间锚定:本期 = ≤ 所选期间的最近 s10 月(v1 口径不变) ──
const s10Months = computed(() => {
  const set = new Set<string>()
  for (const rs of tenantMap.value.values()) for (const r of rs) set.add(r.acctMonth)
  return [...set].sort()
})
const periodEnd = computed(() => period.ym.value ?? `${period.sel.value.year}-12`)
const curYm = computed(() => {
  const ms = s10Months.value
  if (!ms.length) return ''
  const le = ms.filter((m) => m <= periodEnd.value)
  return le.length ? le[le.length - 1] : ms[0]
})
const winMonths = computed(() => s10Months.value.filter((m) => m <= curYm.value))

// §五策略2「回退必须显式」:本期/台账期落在所选期间之外 → 横幅(月粒度比月;年粒度比年;相等不渲染)
const selPeriodLabel = computed(() => period.ym.value ?? `${period.sel.value.year}年`)
const outOfSel = (used: string): boolean =>
  period.ym.value ? used !== period.ym.value : !used.startsWith(period.sel.value.year + '-')
const s10Fallback = computed(() => !!curYm.value && outOfSel(curYm.value))
const ymLabel = (ym: string): string => `${+ym.slice(0, 4)}年${+ym.slice(5, 7)}月`
const mShort = (ym: string): string => `${+ym.slice(5, 7)}月`
const metricLabel = computed(() => (metric.value === 'elec' ? '电费' : '水费'))

// ── 每户统计(纯函数,v1 rowsCur 语义) ──
const rentByName = computed(() => {
  const m = new Map<string, number>()
  for (const t of tenantList.value) if (t.status === 1 && t.monthlyRent > 0) m.set(t.companyName, t.monthlyRent)
  return m
})
const rowsCur = computed(() => buildTenantRows(tenantMap.value, curYm.value, winMonths.value, metric.value, rentByName.value))
const crossMean = computed(() => (rowsCur.value.length ? rowsCur.value.reduce((s, r) => s + r.cur, 0) / rowsCur.value.length : 0))
const crossStd = computed(() => {
  const m = crossMean.value
  return rowsCur.value.length ? Math.sqrt(rowsCur.value.reduce((s, r) => s + (r.cur - m) * (r.cur - m), 0) / rowsCur.value.length) : 0
})
const anomCount = computed(() => rowsCur.value.filter((r) => Math.abs(r.z) >= 1.3).length)
const presentPhases = computed(() => [...new Set(rowsCur.value.map((r) => r.phase))].sort((a, b) => a - b))

// ── 选中租户(默认 Top1;Top20 榜/散点/列表三处联动) ──
const selName = ref('')
const selRow = computed(() => rowsCur.value.find((r) => r.name === selName.value) ?? rowsCur.value[0] ?? null)
function select(name: string) { selName.value = name }

// ── 台账:应收 vs 实收 + 欠费(v1 口径) ──
const ledgerYmOf = (r: AnalysisLedgerRow): string => `${r.year}-${String(r.month).padStart(2, '0')}`
const ledgerYms = computed(() => [...new Set(ledgerRows.value.map(ledgerYmOf))].sort())
const ledgerYm = computed(() => {
  const le = ledgerYms.value.filter((m) => m <= periodEnd.value)
  return le.length ? le[le.length - 1] : ledgerYms.value[0] ?? ''
})
const ledgerFallback = computed(() => !!ledgerYm.value && outOfSel(ledgerYm.value))
const payRows = computed(() => buildPayRows(ledgerRows.value, ledgerYm.value))
const curCollect = computed(() => {
  if (!ledgerYm.value) return null
  let recv = 0, coll = 0
  for (const r of ledgerRows.value) if (ledgerYmOf(r) === ledgerYm.value) { recv += r.receivable; coll += r.collected }
  return { recv, coll, rate: recv ? +((coll / recv) * 100).toFixed(1) : 0 }
})
const arrears = computed(() => payRows.value.filter((p) => p.bal > 0.005))
const arrearsSum = computed(() => arrears.value.reduce((s, p) => s + p.bal, 0))
const payByName = computed(() => new Map(payRows.value.map((p) => [p.name, p])))
const payDot = (name: string): string => {
  const p = payByName.value.get(name)
  if (!p) return 'var(--text-disabled)'
  return p.status === 'normal' ? 'var(--hue-blue)' : p.status === 'partial' ? WARN : NEG
}

// ── 家族榜单开关(方案A,spec §B/W3):仅左列榜单家族化;KPI/Top20/散点计数口径不动 ──
const byFamily = ref(false)
const familyMap = computed(() => buildFamilyMap(tenantList.value))
const famRows = computed(() => buildFamilyRows(rowsCur.value, familyMap.value))

// ── 左列搜索列表(按户/按家族统一显示行;点家族行 → 降级选中主租户本户,hint 注明) ──
const q = ref('')
const listRows = computed(() => {
  const kw = q.value.trim()
  if (!byFamily.value)
    return (kw ? rowsCur.value.filter((r) => r.name.includes(kw)) : rowsCur.value)
      .map((r) => ({ key: r.name, rank: r.rank, name: r.name, phase: r.phase, cur: r.cur, selectName: r.name, members: 1 }))
  return (kw ? famRows.value.filter((r) => r.root.includes(kw)) : famRows.value)
    .map((r) => ({ key: r.root, rank: r.rank, name: r.root, phase: r.phase, cur: r.cur, selectName: r.mainName, members: r.memberCount }))
})

// ── 主图:选中租户趋势 vs 园区均值带 ──
const trendOption = computed<object>(() => {
  const months = winMonths.value
  const band = buildParkBand(rowsCur.value, months)
  const diff = months.map((_, i) => (band.hi[i] != null && band.lo[i] != null ? +((band.hi[i] as number) - (band.lo[i] as number)).toFixed(0) : null))
  const name = selRow.value?.name ?? '—'
  return {
    grid: { left: 64, right: 18, top: 34, bottom: 26 },
    legend: { top: 0, data: [name, '园区均值'] },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : fint(v as number) + ' 元') },
    xAxis: { type: 'category', data: months.map(mShort), boundaryGap: false },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fint(v) } },
    series: [
      { name: 'lo', type: 'line', data: band.lo, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name: '均值±σ带', type: 'line', data: diff, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(28,28,28,.07)' }, silent: true, tooltip: { show: false } },
      // spec §C 规则4:稀疏序列缺月不连线蒙混 → connectNulls:false 断点呈现(hint 注明断点含义)
      { name: '园区均值', type: 'line', connectNulls: false, data: band.mean, symbol: 'none', lineStyle: { type: 'dashed', width: 1.5, color: 'rgba(28,28,28,.4)' }, itemStyle: { color: 'rgba(28,28,28,.4)' } },
      { name, type: 'line', connectNulls: false, data: tenantSeries(selRow.value, months), symbolSize: 7, lineStyle: { width: 2.5, color: '#378ADD' }, itemStyle: { color: '#378ADD' } },
    ],
  }
})

// ── 选中租户:应收 vs 实收(台账各期) ──
const selPay = computed(() => {
  if (!selRow.value) return []
  return ledgerYms.value.map((ym) => {
    let recv = 0, coll = 0, bal = 0
    for (const r of ledgerRows.value) {
      if (ledgerYmOf(r) !== ym || r.tenantName !== selRow.value?.name) continue
      recv += r.receivable; coll += r.collected; bal += r.balanceEnd
    }
    return { ym, recv, coll, bal }
  }).filter((x) => x.recv || x.coll || x.bal)
})
const payOption = computed<object>(() => ({
  grid: { left: 64, right: 18, top: 34, bottom: 26 },
  legend: { top: 0 },
  tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : '¥' + ((v as number) / 10000).toFixed(1) + '万') },
  xAxis: { type: 'category', data: selPay.value.map((x) => x.ym) },
  yAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + '万' } },
  series: [
    { name: '应收', type: 'bar', barWidth: 22, data: selPay.value.map((x) => +x.recv.toFixed(2)), itemStyle: { color: '#B5D4F4' } },
    { name: '实收', type: 'bar', barWidth: 22, data: selPay.value.map((x) => +x.coll.toFixed(2)), itemStyle: { color: '#378ADD' } },
  ],
}))

// ── Top20 榜(点击选中联动) ──
const topRows = computed(() => rowsCur.value.slice(0, 20))
const topOption = computed<object>(() => ({
  grid: { left: 118, right: 46, top: 8, bottom: 26 },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: unknown) => fint(v as number) + ' 元' },
  xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fint(v) } },
  yAxis: { type: 'category', inverse: true, data: topRows.value.map((r) => r.name), axisLabel: { width: 104, overflow: 'truncate' } },
  series: [{
    name: `本期${metricLabel.value}`, type: 'bar', barWidth: 12,
    data: topRows.value.map((r) => ({
      value: +r.cur.toFixed(0),
      itemStyle: { color: r.name === selRow.value?.name ? '#185FA5' : '#85B7EB' },
    })),
  }],
}))
function onTopClick(params: unknown) {
  const p = params as { name?: string }
  if (p?.name) select(p.name)
}

// ── 费额 vs 月租散点(点点选中) ──
const scatterRows = computed(() => rowsCur.value.filter((r) => r.monthlyRent != null))
// spec §T2:x 轴(月租)默认对数(小户与大户同图可读);log 下月租≤0 无法取对数 → 过滤并在卡头 hint 披露计数
const xLog = ref(true)
const scatterSplit = computed(() => splitLogPoints(scatterRows.value, (r) => r.monthlyRent as number, xLog.value))
const scatterOption = computed<object>(() => {
  const maxTotal = Math.max(...scatterRows.value.map((r) => r.winTotal), 1)
  return {
    grid: { left: 64, right: 18, top: 20, bottom: 40 },
    tooltip: {
      formatter: (p: { data?: { name?: string; value?: number[]; phase?: number } }) => {
        const d = p.data
        if (!d?.value) return ''
        return `${d.name}<br/>月租 ${d.value[0]}万 · 本期${metricLabel.value} ${fint(d.value[1])} 元<br/>期区 ${phaseName(d.phase ?? 1)}`
      },
    },
    xAxis: { type: xLog.value ? 'log' : 'value', name: '月租金(万)', nameLocation: 'middle', nameGap: 26 },
    yAxis: { type: 'value', name: `本期${metricLabel.value}(元)`, axisLabel: { formatter: (v: number) => fint(v) } },
    series: [{
      type: 'scatter',
      data: scatterSplit.value.shown.map((r) => ({
        name: r.name, phase: r.phase,
        value: [+((r.monthlyRent as number) / 10000).toFixed(2), +r.cur.toFixed(0)],
        symbolSize: 6 + Math.sqrt(r.winTotal / maxTotal) * 18,
        itemStyle: {
          color: phaseHex(r.phase), opacity: r.name === selRow.value?.name ? 1 : 0.55,
          borderColor: r.name === selRow.value?.name ? '#1C1C1C' : 'transparent', borderWidth: 1.5,
        },
      })),
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { type: 'dashed', color: 'rgba(28,28,28,.4)' },
        label: { formatter: '户均', color: 'rgba(28,28,28,.4)', fontSize: 11 },
        data: [{ yAxis: +crossMean.value.toFixed(0) }],
      },
    }],
  }
})
function onScatterClick(params: unknown) {
  const p = params as { data?: { name?: string } }
  if (p?.data?.name) select(p.data.name)
}

// ── 深链(openFresh 页签语义 + periodLink 发链,参照 ChurnView.goLedger) ──
const selCompany = computed(() => {
  const name = selRow.value?.name
  if (!name) return ''
  const rs = ledgerRows.value.filter((r) => r.tenantName === name)
  return rs.length ? rs[rs.length - 1].companyName : ''
})
function goLedger() {
  if (!selRow.value || !ledgerYm.value) return
  tabs.openFresh('ledger', { pin: true })
  router.push(periodLink('ledger', { p: periodOf(+ledgerYm.value.slice(0, 4), +ledgerYm.value.slice(5, 7)), extra: { company: selCompany.value, tenant: selRow.value.name } }))
}
function goS10() {
  if (!selRow.value || !curYm.value) return
  tabs.openFresh('sales-income', { pin: true })
  router.push(periodLink('sales-income', { p: periodOf(+curYm.value.slice(0, 4), +curYm.value.slice(5, 7)), co: selRow.value.phase, extra: { tenant: selRow.value.name } }))
}

const selPayRow = computed(() => (selRow.value ? payByName.value.get(selRow.value.name) ?? null : null))
</script>

<template>
  <!-- §五:月敏感屏(full);「本期=≤所选的最近 s10 月」回退以横幅显式 -->
  <AnaShell period-mode="full">
    <!-- v-if 必须在槽内层:挂在 <template #kpis> 上时条件为假 → $slots.kpis 不存在 →
         AnaShell 的容器判不到、连同 min-height 一起不渲染 → 数据到达时整条 KPI 带凭空插入,
         把下方图表整体下推 93px(DESIGN-FIDELITY §6.4)。写法对齐 ExpiryView。 -->
    <template #kpis>
      <template v-if="loaded && !err && s10Months.length">
      <AnaKpiTile label="本期覆盖租户" :value="`${rowsCur.length} 户`" :note="curYm" />
      <AnaKpiTile :label="`户均${metricLabel}`" :value="`${fint(crossMean)} 元`" :note="`跨户 σ ${fint(crossStd)}`" />
      <!-- spec §C/C1 人话化:主标签人话,z 分数口径退 AnaMethodNote(计算零变化) -->
      <AnaKpiTile label="用量异常户" :value="`${anomCount} 户`" note="较自身常态明显偏离" />
      <AnaKpiTile v-if="curCollect" :label="`收缴率(${ledgerYm})`" :value="`${curCollect.rate}%`" :delta="+(curCollect.rate - anaSettings.collectTarget).toFixed(1)" :kind="`vs 目标 ${anaSettings.collectTarget}%`" />
      <AnaKpiTile v-else label="收缴率" value="—" note="台账未录入" />
      <AnaKpiTile label="期末欠费" :value="`¥${(arrearsSum / 10000).toFixed(1)}万`" :note="ledgerYm || '台账未录入'" />
      <AnaKpiTile label="欠费户数" :value="`${arrears.length} 户`" :note="ledgerYm || '台账未录入'" />
      </template>
    </template>
    <template #tools>
      <div v-if="loaded && !err && s10Months.length" class="anx-seg te2-seg">
        <button v-for="o in TOGGLES" :key="o.k" :class="{ on: metric === o.k }" @click="metric = o.k">{{ o.l }}</button>
      </div>
    </template>

    <div v-if="!loaded" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="err" class="ak-page">
      <AnaEmpty label="分析数据加载失败" :hint="err" />
    </div>

    <div v-else-if="!s10Months.length" class="ak-page">
      <div class="ak-head">
        <div class="ak-h-l">
          <span class="ak-h-ic"><component :is="iconFor('activity')" :size="20" /></span>
          <div>
            <h2 class="ak-title">租户用能工作台</h2>
            <p class="ak-sub">期间 {{ period.label.value }}</p>
          </div>
        </div>
      </div>
      <AnaEmpty label="销售收入台账(s10)未录入,无法分析租户用能" hint="录入各期 s10 后,此处按租户呈现电费/水费分布与缴费行为" to="/sales-income" toText="去录入销售收入" />
    </div>

    <div v-else class="ak-page">
      <!-- §五策略2:所选期无 s10 →「本期」回退最近覆盖月,全屏口径横幅(禁静默) -->
      <AnaPeriodBanner v-if="s10Fallback" :selected="selPeriodLabel" :used="curYm" source="s10" />
      <div class="av2-grid">
        <!-- 左列:租户搜索列表(本期费额降序,点击选中);spec §B/W3 按户|按家族开关 -->
        <div class="av2-card av2-s4 te2-left">
          <div class="av2-card-h">
            <span class="t">租户列表</span>
            <span class="te2-lh">
              <!-- 拆开三元:排序口径留守,「点击…」指点话术进 hint-desk(S 档隐藏后不悬空分隔符) -->
              <span class="hint">{{ byFamily ? '家族合计降序' : `按本期${metricLabel}降序` }}<span class="hint-desk">{{ byFamily ? ' · 点击看主租户' : ' · 点击选中' }}</span></span>
              <span class="anx-seg mini" role="group" aria-label="榜单口径">
                <button :class="{ on: !byFamily }" @click="byFamily = false">按户</button>
                <button :class="{ on: byFamily }" @click="byFamily = true">按家族</button>
              </span>
            </span>
          </div>
          <input v-model="q" class="te2-search" type="search" :placeholder="byFamily ? `搜索家族(共 ${famRows.length} 族)` : `搜索租户(共 ${rowsCur.length} 户)`" />
          <div class="te2-list">
            <button v-for="r in listRows" :key="r.key" class="te2-item" :class="{ on: r.selectName === selRow?.name }" @click="select(r.selectName)">
              <span class="rk">{{ r.rank }}</span>
              <span class="nm">{{ r.name }}<span v-if="r.members > 1" class="fam">含{{ r.members }}户</span></span>
              <span class="ph">{{ phaseName(r.phase) }}</span>
              <span class="amt">{{ fint(r.cur) }}</span>
              <span v-if="!byFamily" class="dot" :style="{ background: payDot(r.name) }"></span>
            </button>
            <div v-if="!listRows.length" class="te2-none">无匹配租户</div>
          </div>
        </div>

        <!-- 右:选中租户趋势 vs 园区均值带 + 应收实收 + 深链 -->
        <div class="te2-right av2-s8">
          <div class="av2-card">
            <div class="av2-card-h">
              <span class="t">{{ selRow?.name ?? '—' }} · {{ metricLabel }}趋势 vs 园区均值带</span>
              <span class="hint">窗口 {{ winMonths.length }} 期 · 灰带=跨户均值±σ · 断点=该月无记录{{ byFamily ? ' · 趋势为主租户本户' : '' }}</span>
            </div>
            <AnaEChart :option="trendOption" :height="300" />
            <AnaMethodNote>
              口径:s10 为费用金额(元),电费=基本+标准+维护电费、水费=标准+维护水费,非用量;合同面积未录入,单位面积强度口径不可用。
              s10 覆盖 {{ s10Months.length }} 期({{ s10Months.join(' / ') }})。
              异常=该户本期用量偏离其12个月均值超1.3倍标准差(z分数)。
              家族=租户管理中的关联关系(parent_id);「按家族」仅作用于左侧榜单(成员本期金额加总重排),KPI 计数口径仍按户;点击家族行,右侧趋势/应收降级为主租户本户。
            </AnaMethodNote>
          </div>
          <div class="av2-card">
            <div class="av2-card-h">
              <span class="t">{{ selRow?.name ?? '—' }} · 应收 vs 实收</span>
              <span class="te2-links">
                <button class="te2-link" :disabled="!ledgerYm" @click="goLedger">查台账 →</button>
                <button class="te2-link" :disabled="!curYm" @click="goS10">查附表10 →</button>
              </span>
            </div>
            <template v-if="ledgerYms.length">
              <!-- §五策略2:所选期无台账 → 台账期回退,卡顶横幅(禁静默) -->
              <AnaPeriodBanner v-if="ledgerFallback" :selected="selPeriodLabel" :used="ledgerYm" source="台账" style="margin-bottom: 8px" />
              <template v-if="selPay.length">
                <AnaEChart :option="payOption" :height="200" />
                <div v-if="selPayRow" class="te2-payline">
                  {{ ledgerYm }} 收缴率 <b :style="{ color: selPayRow.rate < anaSettings.collectTarget ? 'var(--hue-orange)' : 'var(--hue-blue)' }">{{ selPayRow.rate }}%</b>
                  <span> · 期末结余 </span><b :style="{ color: selPayRow.bal > 0.005 ? 'var(--hue-red)' : 'var(--text-primary)' }">¥{{ (selPayRow.bal / 10000).toFixed(1) }}万</b>
                </div>
              </template>
              <div v-else class="te2-none" style="padding: 28px 0">该租户台账无应收/实收记录</div>
              <AnaMethodNote>台账仅覆盖 {{ ledgerYms.length }} 期({{ ledgerYms.join(' / ') }});收缴率=Σ实收/Σ应收,实收含补缴上期结余,可超 100%。</AnaMethodNote>
            </template>
            <AnaEmpty v-else label="月度台账未录入" hint="录入台账后此处对照该租户应收与实收" to="/ledger" toText="去录入台账" />
          </div>
        </div>

        <!-- 下方:Top20 榜(点击选中)+ 费额 vs 月租散点(点点选中) -->
        <div class="av2-card av2-s6">
          <div class="av2-card-h"><span class="t">本期{{ metricLabel }} Top 20</span><span class="hint"><span class="hint-desk">点击条形选中租户</span></span></div>
          <AnaEChart :option="topOption" :height="440" @chart-click="onTopClick" />
        </div>
        <div class="av2-card av2-s6">
          <div class="av2-card-h">
            <span class="t">{{ metricLabel }} vs 月租金</span>
            <span class="te2-lh">
              <!-- 指点话术在句首:连同后随「· 」一起包,S 档隐藏后图例句仍完整 -->
              <span class="hint"><span class="hint-desk">点点选中 · </span>气泡=窗口累计 · 虚线=户均<template v-if="xLog"> · 对数刻度:小户与大户同图可读</template><template v-if="xLog && scatterSplit.hidden"> · 0租金户 {{ scatterSplit.hidden }} 户未显示</template></span>
              <span class="anx-seg mini" role="group" aria-label="横轴刻度">
                <button :class="{ on: xLog }" @click="xLog = true">对数</button>
                <button :class="{ on: !xLog }" @click="xLog = false">线性</button>
              </span>
            </span>
          </div>
          <AnaEChart :option="scatterOption" :height="440" @chart-click="onScatterClick" />
          <div class="cz-legend" style="margin-top: 6px">
            <span v-for="p in presentPhases" :key="p" class="cz-leg"><span class="sw" :style="{ background: phaseHex(p) }"></span>{{ phaseName(p) }}</span>
          </div>
          <AnaMethodNote>仅显示与主数据同名匹配到月租金的 {{ scatterRows.length }} 户(共 {{ rowsCur.length }} 户)。</AnaMethodNote>
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.te2-seg button { padding: 5px 14px; }
.te2-left { display: flex; flex-direction: column; }
.te2-lh { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.te2-item .fam { margin-left: 6px; font-size: var(--fs-micro); color: var(--text-muted); background: var(--surface-sunken); border-radius: var(--radius-full); padding: 1px 6px; }
.te2-search { width: 100%; box-sizing: border-box; font-family: var(--font-sans); font-size: var(--fs-label); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 7px 10px; outline: none; margin-bottom: 8px; }
.te2-search:focus { border-color: var(--border-strong); }
.te2-list { flex: 1; min-height: 0; max-height: 560px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.te2-item { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: transparent; cursor: pointer; font-family: var(--font-sans); padding: 7px 8px; border-radius: 8px; text-align: left; }
.te2-item:hover { background: var(--bg-hover); }
.te2-item.on { background: var(--accent-blue); }
.te2-item .rk { width: 20px; flex: 0 0 auto; font-size: var(--fs-micro); font-family: var(--font-mono); color: var(--text-muted); }
.te2-item .nm { flex: 1; min-width: 0; font-size: var(--fs-label); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.te2-item .ph { flex: 0 0 auto; font-size: var(--fs-micro); color: var(--text-muted); }
.te2-item .amt { flex: 0 0 auto; font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.te2-item .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.te2-none { text-align: center; color: var(--text-disabled); font-size: var(--fs-label); padding: 16px 0; }
.te2-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.te2-links { display: inline-flex; gap: 10px; }
.te2-link { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); padding: 0; }
.te2-link:hover { text-decoration: underline; }
.te2-link:disabled { color: var(--text-disabled); cursor: default; text-decoration: none; }
.te2-payline { font-size: 12px; color: var(--text-secondary); margin-top: 6px; }
.te2-payline b { font-family: var(--font-mono); font-weight: 600; }
</style>
