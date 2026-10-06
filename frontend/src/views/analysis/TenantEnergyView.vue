<script setup lang="ts">
// 用能与缴费(tenant-energy)—— 2026-10 改稿(画布 tenant-energy-v2 七块板,图 = 规格)。
// 这屏回答「这个月租户用电花了多少、钱收回来没有、哪几户最要紧」。
// 按月:KPI 4 张 → 主卡「各户电费」前 20 户成对条(点条选中一户)→ 选中户读数卡 + 各户期末欠费 → 电费和月租散点。
// 按年:KPI 4 张 → 主卡(全年各户合计)+ 右栏「应收和实收」图、各户期末欠费 → 选中户「电费和水费」大图 → 各户期末欠费变动。
// 期间只往前回退:销售收入表 / 台账各取 ≤ 所选月的最近一月,和所选月不同就在那张卡头贴「显示 M月」;前面一个月都没有画空状态。
// 屏上每一句字从句型库 anaSentence 出;单户两张图和异常提醒中心共用 tenantEnergyChart,突变用异常提醒中心的 detectSpikes(只比相邻自然月)、灰带同那边的全园电费中间一半(S-08)。
// 数据变换纯函数见 ./TenantEnergy.logic.ts(单测)。
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import { useViewGate } from '@/composables/useViewGate'
import AnaShell from './AnaShell.vue'
import { usePeriod } from '@/analysis/usePeriod'
import { anaSettings } from '@/analysis/anaSettings'
import { fetchLedgerRows, fetchS10TenantMap, fetchTenants } from '@/analysis/anaData'
import { buildFamilyMap } from '@/analysis/anaFamily'
import type { AnalysisLedgerRow, AnalysisS10Row } from '@/api/analysis'
import type { TenantDTO } from '@/types/tenant'
import { iconFor } from '@/components/ds/icon'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import * as S from '@/components/ana/anaSentence'
import { esc } from '@/components/ana/anaFmt'
import { anaPalette } from '@/components/ana/anaTheme'
import { splitGaps, tenantEnergyOption, tenantEnergyReads, tenantLedger } from '@/components/ana/tenantEnergyChart'
import { detectSpikes } from './monitor.logic'
import { buildPayRows, buildTenantRows, familyBars, moverOutlier, parkQuartiles, pastYm, prevYm, tenantPeriods, yearRows, type Bar, type PayRow } from './TenantEnergy.logic'

const T = S.TE
const period = usePeriod()
const router = useRouter()
const tabs = useTabsStore()
const loaded = ref(false)
const err = ref('')
const metric = ref<'elec' | 'water'>('elec')
const METRICS = ['elec', 'water'] as const
const M = computed(() => T.metric[metric.value])

const tenantMap = ref<Map<string, AnalysisS10Row[]>>(new Map())
const ledgerRows = ref<AnalysisLedgerRow[]>([])
const tenantList = ref<TenantDTO[]>([])

let seq = 0   // 切回重读 / 重试可能叠着发:只认最后一趟
async function reload() {
  const my = ++seq
  try {
    const [tm, lr, ts] = await Promise.all([fetchS10TenantMap(), fetchLedgerRows(), fetchTenants()])
    if (my !== seq) return
    tenantMap.value = tm
    ledgerRows.value = lr
    tenantList.value = ts
    err.value = ''   // 只在成功分支清:重试在途时失败件留在原地
  } catch (e) {
    if (my === seq) err.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (my === seq) loaded.value = true
  }
}
onMounted(reload)
// 纯读屏没有草稿要保,切回来该看最新的(导入中心导完租户,回这屏必须是新名单)
onReactivated(() => { void reload() })

// ── 期间 ──
const byYear = computed(() => period.sel.value.gran === 'year')
const Y = computed(() => period.sel.value.year)
const ym = computed(() => period.ym.value ?? `${Y.value}-12`)
const ledYmOf = (r: AnalysisLedgerRow): string => `${r.year}-${String(r.month).padStart(2, '0')}`
const s10Months = computed(() => [...new Set([...tenantMap.value.values()].flatMap((rs) => rs.map((r) => r.acctMonth)))].sort())
const ledgerYms = computed(() => [...new Set(ledgerRows.value.map(ledYmOf))].sort())
const inYear = (m: string) => m.startsWith(`${Y.value}-`)
const yms = computed(() => s10Months.value.filter(inYear))      // 按年:销售收入表这一年有数的月
const lms = computed(() => ledgerYms.value.filter(inYear))      // 按年:台账这一年有数的月
const curYm = computed(() => (byYear.value ? null : pastYm(s10Months.value, ym.value)))
const ledYm = computed(() => (byYear.value ? lms.value[lms.value.length - 1] ?? null : pastYm(ledgerYms.value, ym.value)))
const pm = computed(() => {   // 上一个有数的月(12月比11月;2月比1月)
  const i = curYm.value ? s10Months.value.indexOf(curYm.value) : -1
  return i > 0 ? s10Months.value[i - 1] : null
})
const sFall = computed(() => !!curYm.value && curYm.value !== ym.value)
const lFall = computed(() => !!ledYm.value && (byYear.value || ledYm.value !== ym.value))
// 回退到的月:和所选同年只写月,跨年写年(S-34;选 2026年1月退到 2025年12月,写「12月」会读成 2026 年的,对抗复查 10-05)
const mL = (u: string) => (u.slice(0, 4) === ym.value.slice(0, 4) ? S.ymMonth(u) : S.ymLabel(u))
const per = (y: string | null) => (y && y !== ym.value ? mL(y) : '')
const asofText = computed(() => {
  const rows: [string, string][] = []
  const l = ledgerYms.value[ledgerYms.value.length - 1], s = s10Months.value[s10Months.value.length - 1]
  if (l) rows.push([T.table.ledger, l])
  if (s) rows.push([T.table.s10, s])
  return rows.length ? S.asofTables(rows) : undefined
})

// ── 各户:按月 = 所选月(回退后)这一月;按年 = 这一年有数的月合计 ──
const rentByName = computed(() => {
  const m = new Map<string, number>()
  for (const t of tenantList.value) if (t.status === 1 && t.monthlyRent > 0) m.set(t.companyName, t.monthlyRent)
  return m
})
const rows = computed<{ name: string; cur: number; vals: Map<string, number>; monthlyRent?: number | null }[]>(() => (byYear.value
  ? yearRows(tenantMap.value, yms.value, metric.value)
  : buildTenantRows(tenantMap.value, curYm.value ?? '', s10Months.value.filter((m) => m <= (curYm.value ?? '')), metric.value, rentByName.value)))
const pay = computed(() => (ledYm.value ? buildPayRows(ledgerRows.value, ledYm.value) : []))
const arr = computed(() => pay.value.filter((p) => p.bal > 0.005).sort((a, b) => b.bal - a.bal))
// 按年:台账上一年同月(期末欠费、欠费户数、欠费变动都和它比)
const pYm = computed(() => (byYear.value && ledYm.value ? `${Y.value - 1}-${ledYm.value.slice(5)}` : null))
const pPay = computed(() => (pYm.value && ledgerYms.value.includes(pYm.value) ? buildPayRows(ledgerRows.value, pYm.value) : null))

// ── 选中户:点主卡的条(按家族时选主租户);默认 = 这一期第一户,销售收入表没数时取期末欠费第一 ──
const selName = ref('')
const sel = computed(() => {
  const n = selName.value
  if (n && (rows.value.some((r) => r.name === n) || (!rows.value.length && pay.value.some((p) => p.name === n)))) return n
  return rows.value[0]?.name ?? arr.value[0]?.name ?? ''
})
function select(name: string) { selName.value = name }

// ── KPI 4 张:售电收入 / 水费收入 · 收缴率 · 期末欠费、欠费户数(台账的月) ──
const r1 = (v: number) => Math.round(v * 10) / 10
const d1 = (a: number, b: number) => r1(r1(a) - r1(b))   // 屏上两数相减 = 屏上写的差
const sumBy = <X,>(xs: X[], f: (x: X) => number) => xs.reduce((s, x) => s + f(x), 0)
const owedWan = (ps: PayRow[]) => sumBy(ps.filter((p) => p.bal > 0.005), (p) => p.bal) / 1e4
interface Tile { label: string; value: string; note?: string; dval?: string; ddir?: 'up' | 'dn'; dkey?: string; dtone?: 'up' }
// tone 'up' 绿:欠费变少是向好;电费多了少了只写测量,欠费变多不标红(S-41)
const moved = (d: number, val: string, key: string, good = false): Partial<Tile> => ({ dval: val, ddir: d < 0 ? 'dn' : 'up', dkey: key, dtone: good && d < 0 ? 'up' : undefined })
const tiles = computed<Tile[]>(() => {
  const out: Tile[] = []
  const sell = S.teTotal(M.value), y = Y.value
  if (byYear.value) {
    if (!yms.value.length) out.push({ label: sell, value: '–', note: S.noPastNote(y, T.table.s10) })
    else {
      const prevYear = s10Months.value.some((m) => m.startsWith(`${y - 1}-`))
      // ponytail: 上一年销售收入表有数时副行留空 —— 库里只有 2025 年一年,到第二年再定「和往年比」的写法
      out.push({ label: S.tileLabel(sell, S.nMonths(yms.value.length)), value: S.yuan(sumBy(rows.value, (r) => r.cur) / 1e4), note: prevYear ? undefined : S.noPastNote(y - 1, T.table.s10) })
    }
  } else if (!curYm.value) out.push({ label: sell, value: '–', note: S.noPastNote(+ym.value.slice(0, 4), T.table.s10) })
  else {
    const tot = sumBy(rows.value, (r) => r.cur) / 1e4
    const p = pm.value
    const pTot = p ? sumBy([...tenantMap.value.values()].flat().filter((r) => r.acctMonth === p), (r) => r[metric.value]) / 1e4 : 0
    const d = d1(tot, pTot)
    out.push({ label: S.tileLabel(sell, per(curYm.value)), value: S.yuan(tot), ...(p ? moved(d, S.dWan(d), S.vsLabel(S.ymMonth(p))) : { note: S.coverN(rows.value.length, '', T.hu) }) })
  }
  const L = ledYm.value
  if (!L) return out
  // 收缴率:按月 = 这一期;按年 = 这一年台账各期合计
  const led = byYear.value ? ledgerRows.value.filter((r) => r.year === y) : ledgerRows.value.filter((r) => ledYmOf(r) === L)
  const recv = sumBy(led, (r) => r.receivable), coll = sumBy(led, (r) => r.collected)
  const rate = recv ? +((coll / recv) * 100).toFixed(1) : 0
  const ls = lms.value, cont = ls.length > 0 && +ls[ls.length - 1].slice(5) - +ls[0].slice(5) + 1 === ls.length
  const rateSpan = byYear.value ? (cont ? S.monthSpan(+ls[0].slice(5), +ls[ls.length - 1].slice(5)) : S.nMonths(ls.length)) : per(L)
  out.push({ label: S.tileLabel(T.tile.rate, rateSpan), value: `${rate.toFixed(1)}%`, note: S.vsTarget(rate, anaSettings.collectTarget) })
  const aSum = owedWan(pay.value), n = arr.value.length
  const lbA = S.tileLabel(T.tile.arrears, byYear.value ? S.ymMonth(L) : per(L)), lbN = S.tileLabel(T.tile.arrearsN, byYear.value ? S.ymMonth(L) : per(L))
  if (byYear.value) {
    // 和上一年同月比(te2-ask 7「比去年10月」);上一年同月台账录的户数少时不画箭头,照说有几户(te2-ask 8)
    const q = pPay.value, m = +L.slice(5)
    if (!q) {
      out.push({ label: lbA, value: S.yuan(aSum), note: S.noLedgerYmNote(pYm.value!) }, { label: lbN, value: `${n} 户`, note: S.noLedgerYmNote(pYm.value!) })
    } else {
      const dA = d1(aSum, owedWan(q)), dN = n - q.filter((p) => p.bal > 0.005).length
      // 上一年同月台账录的户比今年少:两张瓦都不画箭头,照说那个月台账只有几户(差额多半是多录了户,不是同口径的涨跌;10-05 按推荐)
      const fewer = q.length < pay.value.length
      out.push({ label: lbA, value: S.yuan(aSum), ...(fewer ? { note: S.ledNNote(pYm.value!, q.length) } : moved(dA, S.dWan(dA), S.vsLastYear(m), true)) })
      out.push({ label: lbN, value: `${n} 户`, ...(fewer ? { note: S.ledNNote(pYm.value!, q.length) } : moved(dN, S.dHu(dN), S.vsLastYear(m), true)) })
    }
    return out
  }
  const lp = prevYm(L)
  if (!ledgerYms.value.includes(lp)) {
    out.push({ label: lbA, value: S.yuan(aSum), note: S.noLedgerNote(+lp.slice(5)) }, { label: lbN, value: `${n} 户`, note: S.noLedgerNote(+lp.slice(5)) })
    return out
  }
  const q = buildPayRows(ledgerRows.value, lp)
  const dA = d1(aSum, owedWan(q)), dN = n - q.filter((p) => p.bal > 0.005).length
  out.push({ label: lbA, value: S.yuan(aSum), ...moved(dA, S.dWan(dA), S.vsLabel(S.ymMonth(lp)), true) })
  out.push({ label: lbN, value: `${n} 户`, ...moved(dN, S.dHu(dN), S.vsLabel(S.ymMonth(lp)), true) })
  return out
})

// ── 图 ──
// 横向条:一户一行;cut = 读数句点到的前 k 户(S-45 标边界,画在隐形的第二根纵轴上,线跟着卡宽走);sel = 选中户深蓝;
// mark = 读数句点到的那户两根条标数;text = 单独一行写数、不画条(te2-ask 6)
function rankOption(a: {
  names: string[]; cur: (number | null)[]; prev: (number | null)[] | null; prevName?: string; curName: string; sel: number
  cut?: { at: number; label: string } | null; mark?: number; text?: { idx: number; label: string } | null
  fmt: (v: number) => string; markFmt?: (v: number) => string; left: number; gap?: string
}): object {
  const p = anaPalette(), c = { cur: p.cat[0], prev: p.cat[7], sel: p.cat[5] }
  const lab = (i: number, v: number | null) => (i === a.mark && v != null && a.markFmt
    ? { label: { show: true, position: 'right', formatter: a.markFmt(v), fontSize: 11, color: p.legend } } : {})
  const series: object[] = []
  if (a.prev) series.push({ name: a.prevName, type: 'bar', barWidth: 7, barGap: a.gap ?? '10%', itemStyle: { color: c.prev }, data: a.prev.map((v, i) => ({ value: v, ...lab(i, v) })) })
  series.push({
    name: a.curName, type: 'bar', barWidth: a.prev ? 7 : 12,
    data: a.cur.map((v, i) => ({ value: v, itemStyle: { color: i === a.sel ? c.sel : c.cur }, ...lab(i, v) })),
    // 单独一行的数:钉在这一行纵轴起点、往右写(不进悬停提示,那一行两根条都是空的)
    markPoint: a.text ? { silent: true, symbol: 'rect', symbolSize: 1, itemStyle: { color: 'transparent' },
      label: { show: true, position: 'right', distance: 4, formatter: a.text.label, color: p.legend, fontSize: 11 }, data: [{ coord: [0, a.text.idx] }] } : undefined,
  })
  if (a.cut) series.push({
    type: 'line', yAxisIndex: 1, data: [], silent: true,
    markLine: { silent: true, symbol: 'none', lineStyle: { color: p.cmp.baseline, width: 1, type: [4, 4] },
      label: { position: 'insideEndBottom', formatter: a.cut.label, color: p.legend, fontSize: 11 }, data: [{ yAxis: a.cut.at }] },
  })
  return {
    legend: a.prev ? { top: 0, data: [a.prevName, a.curName] } : undefined,
    grid: { left: a.left, right: a.mark != null ? 72 : 24, top: a.prev ? 30 : 4, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: unknown) => (typeof v === 'number' ? a.fmt(v) : '–') },
    xAxis: { type: 'value', splitNumber: 4, axisLabel: { formatter: (v: number) => a.fmt(v) } },
    yAxis: [
      { type: 'category', inverse: true, data: a.names, axisLine: { lineStyle: { color: p.axis } }, axisLabel: { interval: 0, color: p.legend, fontSize: 11 } },
      { type: 'value', min: 0, max: a.names.length, inverse: true, show: false },
    ],
    series,
  }
}

// ── 主卡:各户电费(前 20 户;按月和上一个有数的月成对比;按户 / 按家族开关照留 —— 07-11 方案A) ──
const TOP = 20
const isFam = ref(false)
const familyMap = computed(() => buildFamilyMap(tenantList.value))
const q = computed(() => (isFam.value ? S.teFamQ : T.hu))
const bars = computed<Bar[]>(() => {
  const p = byYear.value ? null : pm.value
  const b = rows.value.map((r) => ({ name: r.name, cur: r.cur, prev: p && r.vals.has(p) ? r.vals.get(p)! : null, pick: r.name }))
  return isFam.value ? familyBars(b, familyMap.value) : b
})
const conc = computed(() => (bars.value.length ? S.concentration({ what: M.value, by: '', items: bars.value.map((b) => ({ name: b.name, value: b.cur })), q: q.value }) : null))
const mainHint = computed(() => (byYear.value
  ? S.hint(S.topN(TOP, q.value), S.coverTable(yms.value.length), '元')
  : S.hint(S.topN(TOP, q.value), pm.value ? S.cmpWith(+pm.value.slice(5)) : '', '元')))
// 样本量带上 0 元户、为负的户(te2-ask 9:按月电费也写「x 户是 ¥0」,和水费、按年一致)
const mainRefs = computed(() => {
  const rs = bars.value   // 按家族时数家族,和读数句「最多的 n 个家族」同一个数法
  if (!rs.length) return []
  return [S.teBaseZ(rs.filter((r) => r.cur > 0).length, M.value, rs.filter((r) => r.cur === 0).length, rs.filter((r) => r.cur < 0).length, q.value),
    sFall.value ? S.thin({ table: T.table.s10, noMonth: S.ymMonth(ym.value), shown: mL(curYm.value!) }).text : ''].filter(Boolean)
})
const mainEmpty = computed(() => S.thin({ table: T.table.s10, noMonth: S.yearLabel(byYear.value ? Y.value : +ym.value.slice(0, 4)), cant: S.teRank(M.value) }).text)
const mainOption = computed(() => {
  const top = bars.value.slice(0, TOP), k = conc.value?.top.length ?? 0
  const p = byYear.value ? null : pm.value
  return rankOption({
    names: top.map((b) => b.name), cur: top.map((b) => Math.round(b.cur)),
    prev: p ? top.map((b) => (b.prev == null ? null : Math.round(b.prev))) : null, prevName: p ? S.ymMonth(p) : '', curName: curYm.value ? S.ymMonth(curYm.value) : '',
    sel: top.findIndex((b) => b.pick === sel.value), cut: k && k <= TOP ? { at: k, label: S.topN(k, q.value) } : null, fmt: S.yi, left: 96,
  })
})
function onMainClick(params: unknown) {
  const b = bars.value.find((x) => x.name === (params as { name?: string })?.name)
  if (b) select(b.pick)
}

// 异常提醒中心的模型:选中户的逐月电费水费、突变(detectSpikes)、全园电费中间一半 —— 两屏同一份(S-08)
// 选中户逐月电费、水费(同月几行相加)和突变 —— 突变用异常提醒中心同一个 detectSpikes、同一个阈值、只比相邻自然月,两屏同一户同一句(S-08)
const mon = computed(() => {
  const by = new Map<string, { elec: number; water: number }>()
  for (const r of tenantMap.value.get(sel.value) ?? []) { const a = by.get(r.acctMonth) ?? { elec: 0, water: 0 }; a.elec += r.elec; a.water += r.water; by.set(r.acctMonth, a) }
  const months = [...by.keys()].sort(), elec = months.map((m) => by.get(m)!.elec), water = months.map((m) => by.get(m)!.water)
  const spikes = (['elec', 'water'] as const).flatMap((series) => detectSpikes(series === 'elec' ? elec : water, anaSettings.spikeTh, months).map((x) => ({ series, ...x })))
  return months.length ? { months, elec, water, spikes } : null
})
const quart = computed(() => parkQuartiles(tenantMap.value, metric.value))
const elecBand = computed(() => (metric.value === 'elec' ? quart.value : parkQuartiles(tenantMap.value, 'elec')))   // 大图灰带一律是全园电费(同异常提醒中心)

// ── 按月第二排左:选中户(读数句 + 去异常提醒中心;趋势和应收实收图在那屏)──
const tenantCard = computed(() => {
  const c = curYm.value, L = ledYm.value, name = sel.value
  const row = c ? rows.value.find((r) => r.name === name) : undefined
  let eRead: S.Said | null = null, ref = '', spikeRef = ''
  if (c && row) {
    const t = mon.value, a = t ? (metric.value === 'elec' ? t.elec : t.water) : []
    const spikes = t ? t.spikes.filter((s) => s.series === metric.value && t.months[s.idx] <= c)
      .map((s) => ({ what: M.value, ym: t.months[s.idx], prevYm: t.months[s.idx - 1], cur: a[s.idx], chg: s.chg })) : []
    const b = quart.value[c]
    eRead = S.jump({ spikes }) || S.band({ ym: c, value: row.cur, band: b, median: b?.p50, what: M.value })
    // 突变句带 %:同卡写这户在销售收入表里缺了哪几个月;不缺月不出句
    if (eRead?.type === 'jump') {
      const win = s10Months.value.filter((m) => m <= c)
      let span = 0
      for (let x = win[0]; x && x <= c; x = S.nextYm(x)) span++
      const gaps = S.gapsText(row.vals.keys(), win[0], c)
      const xs: string[] = []
      for (let x = win[0]; x && x <= c; x = S.nextYm(x)) xs.push(x)
      // 整张表都没有的月和只有这户缺的月分开说(同异常提醒中心那张图,te2-ask 14)
      if (gaps) ref = S.thin({ ...splitGaps(xs, [...row.vals.keys()], s10Months.value, gaps, false), table: T.table.s10, crossed: spikes.some((s) => S.nextYm(s.prevYm) !== s.ym), nGap: span - row.vals.size }).text
      if (eRead.text.includes('；共')) spikeRef = S.spikeCount(anaSettings.spikeTh, M.value)   // 句尾写了「共 n 次」才注:只数所选那一项
    }
  }
  const periods = L ? tenantPeriods(ledgerRows.value, name, L) : []
  // balEnd:最后一期收齐但期末仍欠时照说(te2-ask 16)
  const cRead = L ? (periods.length ? S.collect({ periods, balEnd: periods[periods.length - 1].end }) : S.thin({ noRows: T.table.ledger })) : null
  return {
    title: S.tenantTitle(name, eRead ? S.teTenant(M.value, !!cRead) : S.MON.card.ledger),
    reads: [eRead?.text, cRead?.text].filter((x): x is string => !!x),
    refs: [ref, spikeRef, cRead ? S.teLedgerAll : ''].filter(Boolean),
    hasLedger: !!cRead,
  }
})

// ── 各户期末欠费:一句集中度 + 去现金流量分析(逐户清单在那屏,不重画)──
const arrCard = computed(() => {
  const a = arr.value
  const aConc = a.length ? S.concentration({ what: T.tile.arrears, by: '', items: a.map((p) => ({ name: p.name, value: p.bal })), q: T.hu }) : null
  const read = ledYm.value ? aConc : S.thin({ table: T.table.ledger, noMonth: byYear.value ? S.yearLabel(Y.value) : S.ymMonth(ym.value), cant: T.tile.arrears })
  // 选中户卡里没有台账句时,「台账含租金」那句挪到这张卡(按年由右栏应收和实收图交代)
  return { read: read?.text ?? '', refs: [aConc ? S.teBase(a.length, T.tile.arrears) : '', !byYear.value && ledYm.value && !tenantCard.value.hasLedger ? S.teLedgerAll : ''].filter(Boolean) }
})

// ── 按月第三排:电费和月租(散点;横轴对数默认、可切线性 —— 07-12 用户拍板;只画在租、有月租的户)──
const xLog = ref(true)
const pts = computed(() => (byYear.value ? [] : rows.value.filter((r) => r.monthlyRent != null)
  .map((r) => ({ name: r.name, x: r.monthlyRent as number, y: r.cur, ratio: (r.cur / (r.monthlyRent as number)) * 100 }))))
const ex = computed(() => (pts.value.length >= 2
  ? S.extremes({ metric: S.teRatio(M.value), items: pts.value.map((p) => ({ label: p.name, value: p.ratio })), fmt: (v) => v.toFixed(1) + '%', q: T.hu }) : null))
const scatterRefs = computed(() => {
  const noRent = rows.value.length - pts.value.length
  const selOff = rows.value.some((r) => r.name === sel.value) && !pts.value.some((p) => p.name === sel.value)
  return [S.teRentBasis(M.value), noRent ? S.thin({ noRent, sel: selOff ? sel.value : '' }).text : ''].filter(Boolean)
})
const scatterEmpty = computed(() => S.thin({ table: T.table.s10, noMonth: S.yearLabel(+ym.value.slice(0, 4)), cant: S.teRatio(M.value) }).text)
const scatterOption = computed(() => {
  const p = anaPalette(), dot = p.cat[0], deep = p.cat[5]
  const hi = new Set(ex.value ? ex.value.his.map((x) => x.label) : []), lo = new Set(ex.value ? ex.value.los.map((x) => x.label) : [])
  const yMax = Math.max(...pts.value.map((x) => x.y), 1)
  const axisX = { lineStyle: { color: p.axis } }
  return {
    grid: { left: 72, right: 28, top: 30, bottom: 40 },
    tooltip: { formatter: (q: { data?: { name?: string; value?: number[] } }) => (q.data?.value ? `${esc(q.data.name)}<br/>${T.axis.rent} ${S.yi(q.data.value[0])} · ${M.value} ${S.yi(q.data.value[1])}` : '') },
    xAxis: { type: xLog.value ? 'log' : 'value', logBase: 10, name: T.axis.rent, nameLocation: 'middle', nameGap: 24, nameTextStyle: { fontSize: 11, color: p.label },
      axisLabel: { formatter: (v: number) => S.yi(v), fontSize: 11, color: p.label }, axisLine: { show: true, ...axisX }, axisTick: { show: false }, splitLine: { lineStyle: { color: p.grid } } },
    yAxis: { type: 'value', name: M.value, nameTextStyle: { fontSize: 11, color: p.label, align: 'right' }, max: metric.value === 'elec' ? Math.ceil(yMax / 20000) * 20000 : undefined, axisLabel: { formatter: (v: number) => S.yi(v) } },
    series: [{
      type: 'scatter', symbolSize: 8, z: 2,
      data: pts.value.map((x) => ({
        name: x.name, value: [x.x, Math.round(x.y)],
        itemStyle: { color: x.name === sel.value ? deep : dot, opacity: x.name === sel.value || hi.has(x.name) ? 1 : 0.5 },
        label: hi.has(x.name) || (lo.size <= 2 && lo.has(x.name)) || x.name === sel.value
          ? { show: true, formatter: x.name, position: 'right', fontSize: 11, color: p.legend, textBorderColor: p.calloutCore, textBorderWidth: 3 } : { show: false },
      })),
      // 读数句点到的最低那几户:并列时只写「n 户」,点上加白环(同异常提醒中心突变点的环)
      markPoint: { silent: true, symbol: 'circle', symbolSize: 10, label: { show: false }, itemStyle: { color: p.calloutCore, borderColor: deep, borderWidth: 2 },
        data: lo.size > 2 ? pts.value.filter((x) => lo.has(x.name)).map((x) => ({ coord: [x.x, Math.round(x.y)] })) : [] },
    }],
  }
})
function onScatterClick(params: unknown) {
  const n = (params as { data?: { name?: string } })?.data?.name
  if (n) select(n)
}

// ── 按年:两张单户图的宽(横轴隔几格标一次看宽)。卡是数据到了才挂上的,按元素出现时再量 ──
const W = reactive({ trend: 946, ledger: 292 })
const ro = typeof ResizeObserver === 'undefined' ? null
  : new ResizeObserver((es) => { for (const e of es) { const k = (e.target as HTMLElement).dataset.w as keyof typeof W; W[k] = Math.max(160, Math.round(e.contentRect.width)) } })
const els: Partial<Record<keyof typeof W, HTMLElement>> = {}
const track = (k: keyof typeof W) => (el: unknown) => {
  if (!(el instanceof HTMLElement) || !ro || els[k] === el) return
  if (els[k]) ro.unobserve(els[k]!)
  els[k] = el
  ro.observe(el)
}
const trackTrend = track('trend'), trackLedger = track('ledger')
onBeforeUnmount(() => ro?.disconnect())

// 右栏上:选中户应收和实收图 = 异常提醒中心那张(共用 tenantLedger);横轴只取这一年的台账期;rows 带期末结余(te2-ask 16)
const yLed = computed(() => {
  if (!byYear.value || !sel.value) return null
  const set = new Set(lms.value)
  const rs = ledgerRows.value.filter((r) => r.tenantName === sel.value && set.has(ledYmOf(r)))
    .map((r) => ({ ym: ledYmOf(r), co: r.companyName, recv: r.receivable, coll: r.collected, end: r.balanceEnd }))
  return tenantLedger({ rows: rs, width: W.ledger, allFees: true, tableYms: lms.value })
})
// 跳到模块屏的入口:没有目标屏的查看权就置灰、悬停写明缺哪一项(RBAC v3,master 0.28.0)
const { lack } = useViewGate()

// 第二排:选中户电费和水费大图 = 异常提醒中心那张(1–12 月每格都标,缺月留空;突变、灰带取异常屏的模型)
const yTrend = computed(() => {
  const t = mon.value
  if (!byYear.value || !t) return null
  const xs: string[] = []
  for (let x = `${Y.value}-01`; x <= `${Y.value}-12`; x = S.nextYm(x)) xs.push(x)
  const keep = t.months.filter((m) => m <= xs[11]).length   // 只用这一年末月以前的数(months 升序)
  const months = t.months.slice(0, keep), elec = t.elec.slice(0, keep), water = t.water.slice(0, keep)
  if (!months.some((m) => m >= xs[0])) return null
  const R = tenantEnergyReads({ xs, months, elec, water, raw: t.spikes.filter((s) => s.idx < keep), band: elecBand.value, table: T.table.s10,
    tableMonths: s10Months.value, crossedOnlyPick: true })
  const markText = R.pick ? (R.read as { mark?: string } | null)?.mark ?? '' : ''
  const { option, bandRef } = tenantEnergyOption({ xs, months, elec, water, spikes: R.spikes, pick: R.pick, markText, band: elecBand.value, width: W.trend })
  return {
    option, read: R.read?.text ?? '',
    // 「共 n 次」数的是什么:紧跟读数句的注解;灰带被压扁时写出范围
    refs: [R.ref?.text, R.read?.text.includes('；共') ? S.spikeCount(anaSettings.spikeTh) : '', bandRef].filter((x): x is string => !!x),
  }
})

// 第三排:各户期末欠费变动(上一年同月 → 今年这个月,按户;两年台账都有的户才比,变动最大的 10 户)
const K = 10
const yMove = computed(() => {
  if (!byYear.value || !ledYm.value || !pYm.value) return null
  const pm2 = new Map((pPay.value ?? []).map((p) => [p.name, Math.max(p.bal, 0) / 1e4]))
  const cm = new Map(pay.value.map((p) => [p.name, Math.max(p.bal, 0) / 1e4]))
  const items = [...new Set([...pm2.keys(), ...cm.keys()])].map((n) => ({ name: n, prev: pm2.get(n) ?? null, cur: cm.get(n) ?? null }))
  const both = items.filter((i): i is { name: string; prev: number; cur: number } => i.prev != null && i.cur != null)
  const mv = S.movers({ items, prevLabel: S.ymLabel(pYm.value), table: T.table.ledger, q: T.hu })
  const top = [...both].sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev)).slice(0, K).map((i) => ({ name: i.name, prev: r1(i.prev), cur: r1(i.cur) }))
  const out = moverOutlier(top, mv?.top)
  const oi = top.findIndex((i) => i.name === out), mi = top.findIndex((i) => i.name === mv?.top)
  return {
    hint: S.hint(S.teMovers(K), S.cmpWithYm(pYm.value), '万元'),
    read: mv?.text ?? '',
    ref: both.length ? S.teBoth(Y.value - 1, Y.value, +ledYm.value.slice(5), both.length) : '',
    option: top.length ? rankOption({
      names: top.map((i) => i.name), cur: top.map((i) => (i.name === out ? null : i.cur)), prev: top.map((i) => (i.name === out ? null : i.prev)),
      prevName: S.ymLabel(pYm.value), curName: S.ymLabel(ledYm.value), sel: top.findIndex((i) => i.name === sel.value),
      text: oi >= 0 ? { idx: oi, label: S.teMoveRow(top[oi].prev, top[oi].cur) } : null,
      mark: oi < 0 && mi >= 0 ? mi : undefined, markFmt: S.yuan, fmt: S.axisWan, left: 120, gap: '60%',
    }) : null,
  }
})

// ── 链接(发链统一 periodLink;异常提醒中心认 tenant=,p 是这屏所选的期) ──
function goAnomaly() {
  if (!sel.value) return
  tabs.openDeep('anomaly')
  router.push(periodLink('anomaly', { p: periodOf(Y.value, byYear.value ? null : period.sel.value.month), extra: { tenant: sel.value } }))
}
function goArrears() {
  tabs.openDeep('fin-cashflow')
  router.push('/fin-cashflow')
}
</script>

<template>
  <AnaShell period-mode="full" :kpi-hold="!loaded ? 4 : 0" :asof-text="asofText">
    <template #kpis>
      <template v-if="loaded && !err">
        <AnaKpiTile v-for="(k, i) in tiles" :key="i" v-bind="k" pct-unit />
      </template>
    </template>
    <template #tools>
      <span class="te2-name"><component :is="iconFor('activity')" :size="15" />{{ T.screen }}</span>
      <!-- 取数途中占位不可见(手机上工具条会因它多折一行,数据到了才插进来整页下推 38px) -->
      <div v-if="!loaded || !err" class="anx-seg te2-seg" :class="{ 'ana-hole': !loaded }">
        <button v-for="k in METRICS" :key="k" :class="{ on: metric === k }" @click="metric = k">{{ T.metric[k] }}</button>
      </div>
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。图块高 = 该图 :height 字面值(主卡 454 · 散点 300 · 按年应收实收 330 · 电费和水费 300 · 欠费变动 354),
         卡头、读数句、参照、链接用真版式同一批类,随数据变的字换成隐形占位。按年 / 按月各一份,和真版式同序。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <div v-if="!loaded" class="ak-page te2-skel">
      <div class="av2-grid">
        <div class="av2-card" :class="byYear ? 'av2-s8' : 'av2-s12'">
          <div class="av2-card-h">
            <span class="t">{{ S.teRank(M) }}</span>
            <span class="te2-lh">
              <span class="hint"><span class="ana-hole">{{ S.hint(S.topN(TOP), '元') }}</span></span>
              <span class="anx-seg mini" aria-hidden="true"><button class="on" disabled tabindex="-1">{{ T.seg.by[0] }}</button><button disabled tabindex="-1">{{ T.seg.by[1] }}</button></span>
            </span>
          </div>
          <AnaSkelChart :height="454" />
          <p class="ana-read hold"></p>
          <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
        </div>
        <template v-if="byYear">
          <div class="te2-right av2-s4">
            <div class="av2-card">
              <div class="av2-card-h"><span class="t"><span class="ana-hole">{{ T.hu }}</span> · {{ S.MON.card.ledger }}</span><span class="hint"><span class="ana-hole">{{ T.hu }}</span></span></div>
              <AnaSkelChart :height="330" />
              <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
            </div>
            <div class="av2-card te2-col te2-grow">
              <div class="av2-card-h"><span class="t">{{ S.teArrearsCard }}</span></div>
              <p class="ana-read hold"></p>
              <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
              <span class="te-go ana-hole">{{ T.goArrears }}</span>
            </div>
          </div>
          <div class="av2-card av2-s12 te2-col">
            <div class="av2-card-h"><span class="t"><span class="ana-hole">{{ T.hu }}</span> · {{ S.MON.card.energy }}</span><span class="hint">{{ S.hint('元') }}</span></div>
            <AnaSkelChart :height="300" />
            <p class="ana-read hold"></p>
            <!-- 参照按默认那户(全年第一)的三行留:缺月、「共 n 次」的门槛、灰带范围 -->
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
            <span class="te-go ana-hole">{{ T.go }}</span>
          </div>
          <div class="av2-card av2-s12">
            <div class="av2-card-h"><span class="t">{{ S.teArrearsMove }}<FPStateTag tone="muted" style="margin-left: 8px"><span class="ana-hole">{{ S.fallbackTag(10) }}</span></FPStateTag></span><span class="hint"><span class="ana-hole">{{ S.teMovers(K) }}</span></span></div>
            <AnaSkelChart :height="354" />
            <p class="ana-read hold"></p>
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
          </div>
        </template>
        <template v-else>
          <div class="av2-card av2-s6 te2-col">
            <div class="av2-card-h"><span class="t"><span class="ana-hole">{{ T.hu }}</span> · {{ M }}</span></div>
            <p class="ana-read hold"></p>
            <p class="ana-read hold"></p>
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
            <span class="te-go ana-hole">{{ T.go }}</span>
          </div>
          <div class="av2-card av2-s6 te2-col">
            <div class="av2-card-h"><span class="t">{{ S.teArrearsCard }}</span></div>
            <p class="ana-read hold"></p>
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
            <span class="te-go ana-hole">{{ T.goArrears }}</span>
          </div>
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">{{ S.teScatter(M) }}</span>
              <span class="te2-lh">
                <span class="hint"><span class="ana-hole">{{ S.hint(T.hu, '元') }}</span></span>
                <span class="anx-seg mini" aria-hidden="true"><button class="on" disabled tabindex="-1">{{ T.seg.axis[0] }}</button><button disabled tabindex="-1">{{ T.seg.axis[1] }}</button></span>
              </span>
            </div>
            <AnaSkelChart :height="300" />
            <p class="ana-read hold"></p>
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
            <p class="ana-ref"><span class="ana-hole">{{ T.hu }}</span></p>
          </div>
        </template>
      </div>
    </div>
    <!-- skel:end -->

    <!-- 加载失败(画布 06-D 右格):换掉内容区,带重试;重试走同一个 reload(首载 / 切回共用) -->
    <FPLoadError v-else-if="err" sub="屏上不显示上一次读到的数字" @retry="reload">租户用能数据没读到</FPLoadError>

    <div v-else class="ak-page">
      <div class="av2-grid">
        <!-- 主卡:各户电费(按月 12 栏、按年 8 栏) -->
        <div class="av2-card" :class="byYear ? 'av2-s8' : 'av2-s12'">
          <div class="av2-card-h">
            <span class="t">{{ S.teRank(M) }}<FPStateTag v-if="sFall" tone="muted" style="margin-left: 8px">显示 {{ mL(curYm!) }}</FPStateTag></span>
            <span v-if="bars.length" class="te2-lh">
              <span class="hint">{{ mainHint }}</span>
              <span class="anx-seg mini" role="group">
                <button :class="{ on: !isFam }" @click="isFam = false">{{ T.seg.by[0] }}</button>
                <button :class="{ on: isFam }" @click="isFam = true">{{ T.seg.by[1] }}</button>
              </span>
            </span>
          </div>
          <template v-if="bars.length">
            <AnaEChart :option="mainOption" :height="454" @chart-click="onMainClick" />
            <p class="ana-read hold">{{ conc?.text }}</p>
            <p v-for="t in mainRefs" :key="t" class="ana-ref">{{ t }}</p>
          </template>
          <!-- 销售收入表前面一个月都没有:照说,不拿以后的月顶替(te2-ask 4);补上读数句、参照的高,主卡和有数时一样高 -->
          <template v-else>
            <div class="te2-empty" style="height: 470px"><AnaEmpty :label="mainEmpty" to="/sales-income" :to-text="T.goS10" /></div>
            <p class="ana-read hold"></p>
          </template>
        </div>

        <template v-if="byYear">
          <div class="te2-right av2-s4">
            <div v-if="yLed" class="av2-card">
              <div class="av2-card-h"><span class="t">{{ S.tenantTitle(sel, S.MON.card.ledger) }}</span><span class="hint">{{ S.hint(S.coLedger(yLed.cos), '元') }}</span></div>
              <div data-w="ledger" :ref="trackLedger"><AnaEChart v-if="yLed.option" :option="yLed.option" :height="330" /></div>
              <p class="ana-read hold"><template v-if="yLed.read">{{ yLed.read.text }}</template></p>
              <p v-for="t in yLed.refs" :key="t" class="ana-ref">{{ t }}</p>
            </div>
            <div class="av2-card te2-col te2-grow">
              <div class="av2-card-h"><span class="t">{{ S.teArrearsCard }}<FPStateTag v-if="lFall" tone="muted" style="margin-left: 8px">显示 {{ mL(ledYm!) }}</FPStateTag></span></div>
              <p class="ana-read hold">{{ arrCard.read }}</p>
              <p v-for="t in arrCard.refs" :key="t" class="ana-ref">{{ t }}</p>
              <button v-if="ledYm" class="te-go" :disabled="!!lack('/fin-cashflow')" v-tip="lack('/fin-cashflow')" @click="goArrears">{{ T.goArrears }}</button>
            </div>
          </div>
          <div v-if="yTrend" class="av2-card av2-s12 te2-col">
            <div class="av2-card-h"><span class="t">{{ S.tenantTitle(sel, S.MON.card.energy) }}</span><span class="hint">{{ S.hint('元') }}</span></div>
            <div data-w="trend" :ref="trackTrend"><AnaEChart :option="yTrend.option" :height="300" /></div>
            <p class="ana-read hold">{{ yTrend.read }}</p>
            <p v-for="t in yTrend.refs" :key="t" class="ana-ref">{{ t }}</p>
            <button class="te-go" :disabled="!!lack('/anomaly')" v-tip="lack('/anomaly')" @click="goAnomaly">{{ T.go }}</button>
          </div>
          <div v-if="yMove" class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">{{ S.teArrearsMove }}<FPStateTag tone="muted" style="margin-left: 8px">{{ S.fallbackTag(+ledYm!.slice(5)) }}</FPStateTag></span>
              <span class="hint">{{ yMove.hint }}</span>
            </div>
            <AnaEChart v-if="yMove.option" :option="yMove.option" :height="354" />
            <p class="ana-read hold">{{ yMove.read }}</p>
            <p class="ana-ref hold"><template v-if="yMove.ref">{{ yMove.ref }}</template></p>
          </div>
        </template>

        <template v-else>
          <!-- 选中户:只放读数句 + 入口(电费和水费、应收和实收两张图在异常提醒中心) -->
          <div v-if="sel" class="av2-card av2-s6 te2-col">
            <div class="av2-card-h"><span class="t">{{ tenantCard.title }}</span></div>
            <p v-for="t in tenantCard.reads" :key="t" class="ana-read hold">{{ t }}</p>
            <p v-for="t in tenantCard.refs" :key="t" class="ana-ref">{{ t }}</p>
            <button class="te-go" :disabled="!!lack('/anomaly')" v-tip="lack('/anomaly')" @click="goAnomaly">{{ T.go }}</button>
          </div>
          <div class="av2-card av2-s6 te2-col">
            <div class="av2-card-h"><span class="t">{{ S.teArrearsCard }}<FPStateTag v-if="lFall" tone="muted" style="margin-left: 8px">显示 {{ mL(ledYm!) }}</FPStateTag></span></div>
            <p class="ana-read hold">{{ arrCard.read }}</p>
            <p v-for="t in arrCard.refs" :key="t" class="ana-ref">{{ t }}</p>
            <button v-if="ledYm" class="te-go" :disabled="!!lack('/fin-cashflow')" v-tip="lack('/fin-cashflow')" @click="goArrears">{{ T.goArrears }}</button>
          </div>
          <div class="av2-card av2-s12">
            <div class="av2-card-h">
              <span class="t">{{ S.teScatter(M) }}<FPStateTag v-if="sFall" tone="muted" style="margin-left: 8px">显示 {{ mL(curYm!) }}</FPStateTag></span>
              <span v-if="pts.length" class="te2-lh">
                <span class="hint">{{ S.hint(S.coverN(pts.length, '', T.hu), '元') }}</span>
                <span class="anx-seg mini" role="group">
                  <button :class="{ on: xLog }" @click="xLog = true">{{ T.seg.axis[0] }}</button>
                  <button :class="{ on: !xLog }" @click="xLog = false">{{ T.seg.axis[1] }}</button>
                </span>
              </span>
            </div>
            <template v-if="pts.length">
              <AnaEChart :option="scatterOption" :height="300" @chart-click="onScatterClick" />
              <p class="ana-read hold">{{ ex?.text }}</p>
              <p v-for="t in scatterRefs" :key="t" class="ana-ref">{{ t }}</p>
            </template>
            <div v-else class="te2-empty" style="height: 300px"><AnaEmpty :label="scatterEmpty" to="/sales-income" :to-text="T.goS10" /></div>
          </div>
        </template>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 工具条屏名(order:-1 置于期间控件前,同驾驶舱 .cv2-name) */
.te2-name { order: -1; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
.te2-seg button { padding: 5px 14px; }
.te2-lh { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.te2-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.te2-grow { flex: 1 1 auto; }
.te2-empty { display: flex; flex-direction: column; }
/* 带入口链接的卡:flex 列、链接贴卡底 —— 同排两卡被栅格拉成等高后,两条链接在一条线上。
   flex 里外边距不折叠:卡头下第一行的上边距清零(卡头已有下边距 8),链接上方留 8 */
.te2-col { display: flex; flex-direction: column; }
.te2-col > .av2-card-h + * { margin-top: 0; }
.te-go { display: block; align-self: flex-start; margin-top: auto; padding: 8px 0 0; border: none; background: transparent; color: var(--text-link); font-family: var(--font-sans); font-size: var(--fs-micro); line-height: var(--lh-snug); text-align: left; cursor: pointer; }
.te-go:hover { text-decoration: underline; }
.te-go:disabled { color: var(--text-disabled); cursor: default; text-decoration: none; }
</style>
