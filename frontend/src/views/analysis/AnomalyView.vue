<script setup lang="ts">
// 异常提醒中心(2026-10 改稿 anomaly-v2 四块板:默认 / 搜「健明」/ 换阈值 / 搜「碧沃丰」)。
// 这屏回答「先处理谁、为什么、多少钱」:顶部四张瓦 | 左列租户风险清单(整张按未收从多到少)|
// 右列 = 选中户:电费和水费、应收和实收(两张图与用能与缴费共用 components/ana/tenantEnergyChart,S-08)、
// 命中规则与处置(三态沿 localStorage 'fp-ana-anom',规则 id 稳定)| 底部两张计数卡(收缴率没到目标的公司 /
// 园区电量变动超阈值的项),「看全部」展开明细与处置。屏上每一句字从句型库 anaSentence 出。
// 纯函数见 monitor.logic.ts(单测 monitor.logic.spec.ts)。深链 /anomaly?tenant=<租户名>:搜索框填上这个名字、选中这户。
// 底部整行「光伏触发规则的楼栋」(2026-10 改稿 pv-v2-anomaly):检测见 pvRules.logic.ts,取数和上面分开 ——
// 光伏没读到只这张卡显示失败,不拖垮整屏;不进 buildAnomalies(铃铛、驾驶舱不出)。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import { onReactivated } from '@/composables/onReactivated'
import { useViewGate } from '@/composables/useViewGate'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaSkelChart from '@/components/ana/AnaSkelChart.vue'
import { chartHeightFor } from '@/components/ana/anaChartHeight'
import { iconFor } from '@/components/ds/icon'
import * as S from '@/components/ana/anaSentence'
import { tenantEnergyOption, tenantEnergyReads, tenantLedger } from '@/components/ana/tenantEnergyChart'
import { anaSettings } from '@/analysis/anaSettings'
import { usePeriod } from '@/analysis/usePeriod'
import { buildAnomalies, fetchAnomalyInputs, fetchPvRuleInput, type AnaAnomaly, type AnomalyInputs } from '@/analysis/anaData'
import { W, buildMonitorModel, coSummary, defaultPick, energyAsof, nrgSummary, owedYuan, type MonitorTenant } from './monitor.logic'
import { pvLatest, pvMonthHits, pvSort, type PvHit, type PvRuleInput } from './pvRules.logic'

const M = S.MON
const PV = S.PVR
const router = useRouter()
const tabs = useTabsStore()
const inputs = ref<AnomalyInputs | null>(null)
const ready = ref(false)
// 取数失败 ≠ 库里没有租户:失败给「重试」,不落到「台账和销售收入表里都没有租户」那句(文案复查 10-05)
const failed = ref(false)
async function load() {
  failed.value = false
  try {
    inputs.value = await fetchAnomalyInputs()
  } catch {
    failed.value = true
  } finally {
    ready.value = true
  }
}
let mainLoad: Promise<void> = Promise.resolve()
onMounted(() => { mainLoad = load(); void loadPv() })

// ── 光伏两条规则:最近有读数的那一年整年,逐月跑光伏屏同一套检测 ──
const pvIn = ref<PvRuleInput | null | undefined>(undefined)   // undefined = 还没回来;null = 库里没有分栋读数
const pvFailed = ref(false)
const pvHits = ref<PvHit[] | null>(null)                      // 检测完才有(已排序)
let pvSeq = 0
async function loadPv(): Promise<void> {
  const my = ++pvSeq
  pvFailed.value = false
  pvHits.value = null
  try {
    const inp = await fetchPvRuleInput()
    if (my !== pvSeq) return
    pvIn.value = inp
    if (!inp) return
    // 一个月一次 buildSnapshot(开发库 13 栋整年,浏览器开发模式每月约 150ms、12 个月 1.8 秒):
    // 等上面的主内容先画出来再算,月与月之间让出主线程,不一口气占住整屏
    await mainLoad
    const out: PvHit[] = []
    for (const m of inp.months) {
      await new Promise((r) => setTimeout(r))
      if (my !== pvSeq) return
      out.push(...pvMonthHits(inp, m))
    }
    pvHits.value = pvSort(out)
  } catch {
    if (my === pvSeq) pvFailed.value = true
  }
}
onBeforeUnmount(() => { pvSeq++ })   // 关页签时停掉还没跑完的月

// ── 模型(阈值敏感:右上「目标与阈值」改动即时重算,无需重拉数据) ──
const th = computed(() => ({ collectTarget: anaSettings.collectTarget, spikeTh: anaSettings.spikeTh, riskTh: anaSettings.churnTh }))
const model = computed(() => (inputs.value ? buildMonitorModel(inputs.value.ledger, inputs.value.s10, th.value) : null))
// 规则引擎(驾驶舱共用):园区电量规则的门槛跟设置走(av2-ask 5)
const anomalies = computed<AnaAnomaly[]>(() =>
  inputs.value ? buildAnomalies(inputs.value, { collectTarget: anaSettings.collectTarget, spikeTh: anaSettings.spikeTh }) : [])

// ── 工具条:三份数据各到哪个月,末尾接光伏抄表到哪个月(光伏回来以后一起换字,工具条只跳一次) ──
const pvYm = computed(() => {
  const i = pvIn.value
  return i ? `${i.year}-${String(i.months[i.months.length - 1]).padStart(2, '0')}` : null
})
const asofText = computed(() => {
  const m = model.value, e = inputs.value ? energyAsof(inputs.value.energy) : null
  if (pvIn.value === undefined && !pvFailed.value) return undefined
  const t = m?.lastLedgerYm && m.lastS10Ym && e ? S.asof(m.lastLedgerYm, m.lastS10Ym, e.ym, e.later) : undefined
  return t && pvYm.value ? `${t} · ${S.pvAsof(pvYm.value)}` : t
})

// ── 顶部四张瓦 ──
const tiles = computed(() => {
  const m = model.value
  if (!m || !m.lastLedgerYm || !m.s10Months.length) return null
  const n = m.list.length, t = anaSettings.churnTh
  return [
    { label: '高风险租户', value: `${m.cards.risk} 户`, note: S.ofAll(n, S.scoreGe(t)) },
    { label: '观察租户', value: `${m.cards.watch} 户`, note: S.ofAll(n, S.scoreIn(t - 20, t - 1)) },
    { label: S.tileLabel('未收合计', S.ymMonth(m.lastLedgerYm)), value: `¥${S.num(m.cards.arrearsTotal / 1e4)}万`, note: S.arrearsNote(m.cards.arrearsCount) },
    { label: S.tileLabel('能耗突变租户', `±${anaSettings.spikeTh}%`), value: `${m.cards.spikeTenants} 户`,
      note: S.spikeNote(+m.s10Months[0].slice(0, 4), m.s10Months.length, m.list.filter((x) => x.months.length).length) },
  ]
})

// ── 左列清单(搜索 + 整张按未收从多到少) ──
const q = ref('')
const list = computed(() => {
  const l = model.value?.list ?? []
  const k = q.value.trim()
  return k ? l.filter((t) => t.name.includes(k) || t.company.includes(k)) : l
})
// 清单整张按未收从多到少(monitor.logic 已排好),不再按档分组;分数照旧灰色小字写在行首(用户 10-05「按你推荐改」)
const rows = computed(() => list.value.map((t) => ({ t, sub: rowSub(t) })))
// 行副文只写有问题的项;按「 · 」拆开,每段不折断
function rowSub(t: MonitorTenant): string[] {
  const ym = model.value?.lastLedgerYm
  return ym ? S.rowSub(t, { ledYm: ym, spikeTh: anaSettings.spikeTh, ledYms: new Set(t.ledYms) }).split(' · ').filter(Boolean) : []
}
const listRead = computed(() => {
  const ym = model.value?.lastLedgerYm
  return ym ? S.arrears({ items: list.value.map((t) => ({ name: t.name, value: t.arrears })), ym }) : null
})
const listBase = computed(() => (listRead.value?.n && listRead.value.n > 1 && model.value?.lastLedgerYm ? S.arrearsBase(model.value.lastLedgerYm, listRead.value.n) : ''))
const scoreRefs = computed(() => (model.value?.lastS10Ym ? S.scoreNote(W, model.value.lastS10Ym) : []))

// 清单空了(数据还没到 / 搜不到)不清选中:清掉搜索、数据一到,原来那户还在就照旧选中它(深链也靠这条)
const selName = ref<string | null>(null)
watch(list, (l) => {
  if (!l.length) return
  if (!selName.value || !l.some((t) => t.name === selName.value)) selName.value = defaultPick(l)!.name
}, { immediate: true })
const sel = computed<MonitorTenant | null>(() => list.value.find((t) => t.name === selName.value) ?? null)

// 深链 /anomaly?tenant=<租户名>(用能与缴费「去异常提醒中心看这户 →」):首进 + KeepAlive 切回各认一次,同一地址只认一次
// (同 useDeepPeriod:用户自己改了搜索,切走再切回不被地址栏改回去)。放在清单 watch 之后:那条 immediate 会把选中清空。
let deepKey = ''
function takeDeep(): void {
  const r = router.currentRoute?.value   // 不用 useRoute:单测的 vue-router 桩只给 useRouter
  const t = r?.query.tenant, key = r?.fullPath ?? ''
  if (typeof t !== 'string' || !t || key === deepKey) return
  deepKey = key
  q.value = t
  selName.value = t
}
takeDeep()
onReactivated(takeDeep)

// ── 右列图宽(横轴隔几格标一次按图宽算) ──
const chartBox = ref<HTMLElement | null>(null)
const chartW = ref(620)
let ro: ResizeObserver | null = null
watch(chartBox, (el) => {
  ro?.disconnect()
  if (!el || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => { if (el.clientWidth) chartW.value = el.clientWidth })
  ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())
// 换户时图不按系列名形变出假中间数据(C6-16 ④):系列 id 带户名
const keyed = (o: object, key: string): object => {
  const x = o as { series: object[] }
  return { ...x, series: x.series.map((s, i) => ({ ...s, id: `${key}-${i}` })) }
}

// ── 右上:选中户电费和水费(横轴 = 销售收入表首月到末月,缺月留空) ──
const xs = computed(() => {
  const ms = model.value?.s10Months ?? []
  const out: string[] = []
  if (ms.length) for (let m = ms[0]; m <= ms[ms.length - 1]; m = S.nextYm(m)) out.push(m)
  return out
})
const energy = computed(() => {
  const t = sel.value, m = model.value, x = xs.value
  if (!t || !m || !t.months.length || !x.length) return null
  // te2-ask 14:缺的月只有这户缺(那个月销售收入表别的户有数)才写「这户」;整张表都没有的月不算这户缺(tableMonths 让共用件分开说)
  const R = tenantEnergyReads({ xs: x, months: t.months, elec: t.elec, water: t.water, raw: t.spikes, band: m.band, table: M.tbl.s10, tableMonths: m.s10Months })
  const mark = R.read && R.read.type === 'jump' ? (R.read as S.Said & { mark?: string }).mark ?? '' : ''
  const { option, bandRef } = tenantEnergyOption({ xs: x, months: t.months, elec: t.elec, water: t.water, spikes: R.spikes, pick: R.pick, markText: mark, band: m.band, width: chartW.value })
  const y0 = x[0].slice(0, 4), y1 = x[x.length - 1].slice(0, 4)
  return {
    option: keyed(option, `e-${t.name}`),
    hint: S.hint(y0 === y1 ? S.yearSpan(+y0, +x[0].slice(5), +x[x.length - 1].slice(5)) : S.ymSpan(x[0], x[x.length - 1]), '元'),
    read: R.read?.text ?? '',
    // 「；共 n 次」数的是什么,紧跟缺月参照(同用能与缴费按年大图)
    refs: [R.ref?.text, R.read?.text.includes('；共') ? S.spikeCount(anaSettings.spikeTh) : '', bandRef].filter((s): s is string => !!s),
  }
})
const noS10 = S.thin({ noRows: M.tbl.s10 }).text

// ── 右中:选中户应收和实收(台账各期,几家公司相加;rows 带期末结余 → 收齐但期末仍欠时照说) ──
const ledger = computed(() => {
  const t = sel.value, rows = inputs.value?.ledger
  if (!t || !rows) return null
  const L = tenantLedger({
    rows: rows.filter((r) => r.tenantName === t.name)
      .map((r) => ({ ym: r.year + '-' + String(r.month).padStart(2, '0'), co: r.companyName, recv: r.receivable, coll: r.collected, end: r.balanceEnd })),
    width: chartW.value,
    tableYms: rows.map((r) => r.year + '-' + String(r.month).padStart(2, '0')),
  })
  return { ...L, option: L.option ? keyed(L.option, `l-${t.name}`) : null }
})

// ── 右下:命中规则(本屏租户级 + 规则引擎里挂在这户名下的 ③④;只写测量) ──
interface HitRule { id: string; title: string; value: string; detail: string; a?: AnaAnomaly }
const hitRules = computed<HitRule[]>(() => {
  const t = sel.value
  if (!t) return []
  const opt = { target: anaSettings.collectTarget, spikeTh: anaSettings.spikeTh }
  return [
    ...t.rules.map((r) => ({ id: r.id, ...S.monRule(r, t, opt) })),
    ...anomalies.value.filter((a) => a.title.startsWith(t.name + ' ')).map((a) => ({ id: a.id, a, ...S.engineRule(a) })),
  ]
})

// ── 底部:公司级 / 园区级计数卡;「看全部」展开明细与处置 ──
const coRows = computed(() => (inputs.value ? coSummary(anomalies.value, inputs.value.ledger) : []))
const nrgRows = computed(() => (inputs.value ? nrgSummary(anomalies.value, inputs.value.energy) : []))
const nCo = computed(() => coRows.value.reduce((s, r) => s + r.n, 0))
const nNrg = computed(() => nrgRows.value.reduce((s, r) => s + r.n, 0))
const ledSpan = computed(() => {
  const yms = [...new Set((inputs.value?.ledger ?? []).map((r) => r.year + '-' + String(r.month).padStart(2, '0')))].sort()
  return yms.length ? S.ymSpan(yms[0], yms[yms.length - 1]) : ''
})
const nrgYm = computed(() => (inputs.value ? energyAsof(inputs.value.energy)?.ym ?? null : null))   // 电量多数序列到的月:行内「最近一次」同年只写月
const openCo = ref(false)
const openNrg = ref(false)

// ── 底部整行:光伏触发规则的楼栋。卡上露每栋最近一条的前 4 行(月从近到远),「看全部」出全部;读数句说最近一个月 ──
const PV_SHOW = 4
const PV_HOLD = S.pvHint(13, S.yearSpan(2025, 1, 12), 24)   // 检测没跑完时卡头说明的隐形占位(同字数,折行和真版式一致)
const openPv = ref(false)
const pvCard = computed(() => {
  const inp = pvIn.value, hits = pvHits.value
  if (!inp || !hits) return null
  const latest = pvLatest(hits), last = inp.months[inp.months.length - 1]
  const shown = openPv.value ? hits : latest.slice(0, PV_SHOW)
  return {
    hint: S.pvHint(latest.length, S.yearSpan(inp.year, inp.months[0], last), hits.length),
    read: S.pvCount(last, hits.filter((h) => h.m === last))?.text ?? '',
    rows: shown.map((h) => ({ h, ...(h.kind === 'over' ? S.pvRuleOver(h) : S.pvRuleRun(h)) })),
    n: hits.length,
    more: hits.length > Math.min(latest.length, PV_SHOW),
  }
})
// 「查看分析 →」:光伏分栋分析停到这条的那个月、开这栋的抽屉(#st=)。期间是分析层共用的单例,先切好再开;
// 开全新实例 —— 光伏屏只在挂载时认 #st=,缓存着的页签不会再读一遍
const period = usePeriod()
function goPv(h: PvHit): void {
  const y = pvIn.value?.year
  if (y == null) return
  period.setGran('month')
  period.setYear(y)
  period.setMonth(h.m)
  tabs.openDeep('pv-meter-analysis')
  void router.push({ path: '/pv-meter-analysis', hash: `#st=${h.stationId}` })
}

// ── 处置状态(沿 v1:localStorage 'fp-ana-anom',规则 id 稳定 → 跨会话/跨版本保留) ──
type TrackStatus = 'open' | 'doing' | 'done'
const STATUS_KEYS: TrackStatus[] = ['open', 'doing', 'done']
const LS_KEY = 'fp-ana-anom'
function loadTrack(): Record<string, TrackStatus> {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}
const track = ref<Record<string, TrackStatus>>(loadTrack())
watch(track, (v) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch { /* 隐私模式静默 */ }
}, { deep: true })
const statusOf = (id: string): TrackStatus => track.value[id] ?? 'open'
const setStatus = (id: string, k: TrackStatus): void => { track.value = { ...track.value, [id]: k } }

// 深链走 openDeep(spec §4.1 页签语义不变;目标屏 useDeepPeriod 切回也认 query,P0b)。发链统一 periodLink(§4.2):
// 台账 → p + extra.company/tenant;销售收入表 → p + co=期区(缺席不写,S10View 落当前册)+ extra.tenant。
function goLedger(t: MonitorTenant): void {
  const ym = model.value?.lastLedgerYm
  if (!t.company || !ym) return
  tabs.openDeep('ledger')
  void router.push(periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company: t.company, tenant: t.name } }))
}
function goS10(t: MonitorTenant): void {
  const ym = t.months[t.months.length - 1]
  if (!ym) return
  tabs.openDeep('sales-income')
  void router.push(periodLink('sales-income', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), co: t.phase ?? undefined, extra: { tenant: t.name } }))
}
// 跳到模块屏的入口:没有目标屏的查看权就置灰、悬停写明缺哪一项(RBAC v3,master 0.28.0)
const { lack } = useViewGate()
/** 规则引擎条(③ 收入中断 ④ 负值行):录入屏目标带期与定位(与驾驶舱同形)。 */
const goAnom = (a: AnaAnomaly): void => {
  const v = a.link.slice(1)
  // 录入屏目标走 openDeep(与 goLedger / goS10 同形):缓存的台账 / 销售收入表页签有草稿时 useDeepPeriod 的 dirty 闸会吞掉这一跳,「一击落位」靠全新实例;分析屏目标保持裸 push
  if (v === 'ledger' || v === 'sales-income') tabs.openDeep(v)
  void router.push(periodLink(v, { p: periodOf(+a.ym.slice(0, 4), +a.ym.slice(5, 7)), co: a.co, extra: { company: a.company, tenant: a.tenant } }))
}
</script>

<template>
  <!-- 期间无关屏(规则跑全部数据):隐期间控件;工具条右端写三份数据各到哪个月 -->
  <AnaShell period-mode="none" :asof-text="asofText" :kpi-hold="ready ? 0 : 4">
    <template #tools>
      <span class="mn-name"><component :is="iconFor('bell-ring')" :size="15" />{{ M.screen }}</span>
    </template>

    <template #kpis>
      <template v-if="tiles">
        <AnaKpiTile v-for="k in tiles" :key="k.label" :label="k.label" :value="k.value" :note="k.note" pct-unit />
      </template>
    </template>

    <!-- 首进:版式已知就不转圈(C6-01)。块高照真版式 —— 左列清单卡随右列等高(桌面档清单卡里的列表 height 0 + flex 撑满);
         右列两张图 = AnaSkelChart,高与 AnaEChart 的 :height 同表降档(250 / 200,anaChartHeight.ts);两张图卡下各留
         读数句 + 参照一行(.ana-read margin-top 8 / .ana-ref margin-top 2,.hold 各 min-height 1lh = 20);
         左列清单卡:读数句 + 参照各一行、清单 560(窄档封顶高;桌面档清单撑满到右列等高)、底下风险分两行参照;
         默认选中户 = 清单(按未收排)里第一户有数据的,10-06 实测是可莱恩:电费水费卡读数句 1 行 + 参照 2 行(缺月、灰带范围),
         规则卡命中 3 条 .mn-rules 193;底部两张计数卡按 6 行留位
         (1440 实测 .mn-sum 36 × 6 + 看全部 margin 6 + 15 = 237);
         光伏卡读数句 1 行 + 规则 4 行(1440 实测 .mn-rule 60 × 4 + 缝 8 × 3 = 264)+ 看全部,整张 356(检测没跑完时同一份留位)。
         数据到了原地硬切,不做淡入。 -->
    <!-- skel:start —— 首进骨架(与下方真版式逐块同高,改真版式的卡头 / 文字行时同步改这里;anaSkeletonParity.spec 盯着) -->
    <div v-if="!ready" class="av2-grid ak-skel">
      <div class="av2-card av2-s4 mn-listcard">
        <div class="av2-card-h">
          <span class="t">{{ M.card.list }}</span>
          <span class="hint"><span class="ana-hole">000</span> 户 · {{ M.listHint }}</span>
        </div>
        <div class="mn-search">
          <component :is="iconFor('search')" :size="14" />
          <input disabled :placeholder="M.search" />
        </div>
        <p class="ana-read mn-read tight hold"></p>
        <p class="ana-ref mn-read hold"></p>
        <div class="mn-list"><div class="fp-shim" style="height: 560px"></div></div>
        <p class="ana-ref hold"></p>
        <p class="ana-ref hold"></p>
      </div>
      <div class="av2-s8 mn-right">
        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t"><span class="ana-hole">某某某某</span> · {{ M.card.energy }}</span>
          </div>
          <AnaSkelChart :height="250" />
          <p class="ana-read hold"></p>
          <p class="ana-ref hold"></p>
          <p class="ana-ref hold"></p>
        </div>
        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t"><span class="ana-hole">某某某某</span> · {{ M.card.ledger }}</span>
          </div>
          <AnaSkelChart :height="200" />
          <p class="ana-read hold"></p>
          <p class="ana-ref hold"></p>
        </div>
        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t">{{ M.card.rules }}</span>
            <span class="hint">{{ M.localOnly }}</span>
          </div>
          <div class="fp-shim" style="height: 193px"></div>
          <div class="mn-links ana-hole">
            <button type="button" class="mn-go" disabled tabindex="-1">{{ M.links[0] }}<component :is="iconFor('arrow-up-right')" :size="13" /></button>
            <button type="button" class="mn-go" disabled tabindex="-1">{{ M.links[1] }}<component :is="iconFor('arrow-up-right')" :size="13" /></button>
          </div>
        </div>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h"><span class="t">{{ M.card.co }}</span></div>
        <div class="fp-shim" style="height: 237px"></div>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h"><span class="t">{{ S.energyTitle(anaSettings.spikeTh) }}</span></div>
        <div class="fp-shim" style="height: 237px"></div>
      </div>
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">{{ PV.card }}</span>
          <span class="hint"><span class="ana-hole">{{ PV_HOLD }}</span></span>
        </div>
        <p class="ana-read hold"></p>
        <div class="fp-shim" style="height: 264px"></div>
        <button type="button" class="mn-all ana-hole" disabled tabindex="-1">{{ S.linkAll(24) }}</button>
      </div>
    </div>
    <!-- skel:end -->

    <FPLoadError v-else-if="failed" @retry="load()">异常提醒中心的数据没读到</FPLoadError>
    <div v-else-if="!model || !model.list.length" class="av2-grid">
      <div class="av2-card av2-s12">
        <AnaEmpty :label="M.noData" to="/ledger" :to-text="M.links[0]" />
      </div>
    </div>

    <div v-else class="av2-grid">
      <!-- 左列:租户风险清单 -->
      <div class="av2-card av2-s4 mn-listcard">
        <div class="av2-card-h">
          <span class="t">{{ M.card.list }}</span>
          <span class="hint">{{ S.hint(S.coverN(list.length, '', '户'), M.listHint) }}</span>
        </div>
        <div class="mn-search">
          <component :is="iconFor('search')" :size="14" />
          <input v-model="q" :placeholder="M.search" />
        </div>
        <p v-if="listRead" class="ana-read mn-read" :class="{ tight: listBase }">{{ listRead.text }}</p>
        <p v-if="listBase" class="ana-ref mn-read">{{ listBase }}</p>
        <div class="mn-list">
          <template v-for="{ t, sub } in rows" :key="t.name">
            <button type="button" class="mn-row" :class="{ on: t.name === selName }" @click="selName = t.name">
              <span class="score">{{ t.score }}</span>
              <span class="body">
                <!-- 租户名常是长公司名,截断后认不出是哪一户 —— 悬停说明出全文 -->
                <span class="nm-line"><span v-tip="t.name" class="nm">{{ t.name }}</span><span v-if="t.tier !== 'normal'" class="mn-tier">{{ M.tier[t.tier] }}</span></span>
                <span v-if="sub.length" class="sub"><template v-for="(p, i) in sub" :key="i"><template v-if="i"> · </template><span class="mn-p">{{ p }}</span></template></span>
              </span>
              <span v-if="owedYuan(t) >= 1" class="mn-amt">{{ S.yi(t.arrears) }}</span>
            </button>
          </template>
          <AnaEmpty v-if="!list.length" :label="M.noMatch" />
        </div>
        <p v-for="r in scoreRefs" :key="r" class="ana-ref">{{ r }}</p>
      </div>

      <!-- 右列:选中户 -->
      <div v-if="sel" class="av2-s8 mn-right">
        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t">{{ S.tenantTitle(sel.name, M.card.energy) }}</span>
            <span v-if="energy" class="hint">{{ energy.hint }}</span>
          </div>
          <div ref="chartBox">
            <AnaEChart v-if="energy" :option="energy.option" :height="250" />
            <!-- 这户在销售收入表里一个月都没有:空状态钉成它顶替的那张图的高,换户时下方卡不跳 -->
            <AnaEmpty v-else :label="noS10" to="/sales-income" :to-text="M.links[1]"
              :style="{ minHeight: chartHeightFor(250) + 'px', boxSizing: 'border-box' }" />
          </div>
          <template v-if="energy">
            <p v-if="energy.read" class="ana-read">{{ energy.read }}</p>
            <p v-for="r in energy.refs" :key="r" class="ana-ref">{{ r }}</p>
          </template>
        </div>

        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t">{{ S.tenantTitle(sel.name, M.card.ledger) }}</span>
            <span v-if="ledger?.option" class="hint">{{ ledger.hint }}</span>
          </div>
          <AnaEChart v-if="ledger?.option" :option="ledger.option" :height="200" />
          <AnaEmpty v-else :label="ledger?.read?.text" to="/ledger" :to-text="M.links[0]" />
          <template v-if="ledger?.option">
            <p v-if="ledger.read" class="ana-read">{{ ledger.read.text }}</p>
            <p v-for="r in ledger.refs" :key="r" class="ana-ref">{{ r }}</p>
          </template>
        </div>

        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t">{{ M.card.rules }}</span>
            <span class="hint">{{ S.hint(hitRules.length ? S.nRules(hitRules.length) : '', M.localOnly) }}</span>
          </div>
          <div v-if="hitRules.length" class="mn-rules">
            <div v-for="r in hitRules" :key="r.id" class="mn-rule" :class="{ done: statusOf(r.id) === 'done' }">
              <span class="mn-dot"></span>
              <div class="bd">
                <div class="tt">{{ r.title }}<span class="mn-vv">{{ r.value }}</span></div>
                <div class="dt">{{ r.detail }}</div>
              </div>
              <div class="ops">
                <div class="mn-st-seg">
                  <button v-for="(k, i) in STATUS_KEYS" :key="k" type="button" :class="{ on: statusOf(r.id) === k }" @click="setStatus(r.id, k)">{{ M.status[i] }}</button>
                </div>
                <button v-if="r.a" type="button" class="mn-link" :disabled="!!lack(r.a.link)" v-tip="lack(r.a.link)" @click="goAnom(r.a)">{{ M.view }}</button>
              </div>
            </div>
          </div>
          <div class="mn-links">
            <button type="button" class="mn-go" :disabled="!sel.company || !model.lastLedgerYm || !!lack('/ledger')" v-tip="lack('/ledger')" @click="goLedger(sel)">
              {{ M.links[0] }}<component :is="iconFor('arrow-up-right')" :size="13" />
            </button>
            <button type="button" class="mn-go" :disabled="!sel.months.length || !!lack('/sales-income')" v-tip="lack('/sales-income')" @click="goS10(sel)">
              {{ M.links[1] }}<component :is="iconFor('arrow-up-right')" :size="13" />
            </button>
          </div>
        </div>
      </div>

      <!-- 底部:收缴率没到目标的公司(公司×期)/ 园区电量变动超阈值的项;明细与处置在「看全部」里 -->
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">{{ M.card.co }}</span>
          <span class="hint">{{ S.hint(S.nCo(coRows.length), ledSpan, S.nRules(nCo)) }}</span>
        </div>
        <div v-for="r in coRows" :key="r.name" class="mn-sum">
          <span class="n">{{ r.name }}</span>
          <span class="c">{{ S.coRow(r.n, r.of ?? 0, anaSettings.collectTarget) }}</span>
          <span class="r miss">{{ S.coLatest(r.last.ym, r.last.value, model?.lastLedgerYm ?? null) }}</span>
        </div>
        <template v-if="openCo && nCo">
          <div v-for="r in coRows.flatMap((x) => x.all.map((a) => ({ x, a })))" :key="r.a.id" class="mn-sum mn-det" :class="{ done: statusOf(r.a.id) === 'done' }">
            <span class="n">{{ r.x.name }}</span>
            <span class="c">{{ S.ymLabel(r.a.ym) }} {{ r.a.value }}</span>
            <div class="mn-st-seg">
              <button v-for="(k, i) in STATUS_KEYS" :key="k" type="button" :class="{ on: statusOf(r.a.id) === k }" @click="setStatus(r.a.id, k)">{{ M.status[i] }}</button>
            </div>
          </div>
          <button type="button" class="mn-all" @click="openCo = false">{{ M.collapse }}</button>
        </template>
        <button v-else-if="nCo" type="button" class="mn-all" @click="openCo = true">{{ S.linkAll(nCo) }}</button>
      </div>
      <div class="av2-card av2-s6">
        <div class="av2-card-h">
          <span class="t">{{ S.energyTitle(anaSettings.spikeTh) }}</span>
          <span class="hint">{{ S.hint(S.nSeries(nrgRows.length), S.cmpPrev, S.nRules(nNrg)) }}</span>
        </div>
        <div v-for="r in nrgRows" :key="r.name" class="mn-sum">
          <span class="n">{{ r.name }}</span>
          <span class="c">{{ S.seriesRow(r.n) }}</span>
          <span class="r">{{ S.latest(r.last.ym, r.last.value, nrgYm) }}</span>
        </div>
        <template v-if="openNrg && nNrg">
          <div v-for="r in nrgRows.flatMap((x) => x.all.map((a) => ({ x, a })))" :key="r.a.id" class="mn-sum mn-det" :class="{ done: statusOf(r.a.id) === 'done' }">
            <span class="n">{{ r.x.name }}</span>
            <span class="c">{{ S.ymLabel(r.a.ym) }} {{ r.a.value }}</span>
            <div class="mn-st-seg">
              <button v-for="(k, i) in STATUS_KEYS" :key="k" type="button" :class="{ on: statusOf(r.a.id) === k }" @click="setStatus(r.a.id, k)">{{ M.status[i] }}</button>
            </div>
          </div>
          <button type="button" class="mn-all" @click="openNrg = false">{{ M.collapse }}</button>
        </template>
        <button v-else-if="nNrg" type="button" class="mn-all" @click="openNrg = true">{{ S.linkAll(nNrg) }}</button>
      </div>

      <!-- 底部整行:光伏触发规则的楼栋(一栋一个月一条)。检测没跑完时照真版式留位(同首进骨架那张) -->
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">{{ PV.card }}</span>
          <span v-if="pvCard" class="hint">{{ pvCard.hint }}</span>
          <span v-else-if="!pvFailed && pvIn !== null" class="hint"><span class="ana-hole">{{ PV_HOLD }}</span></span>
        </div>
        <FPLoadError v-if="pvFailed" @retry="loadPv()">{{ PV.failed }}</FPLoadError>
        <AnaEmpty v-else-if="pvIn === null" :label="PV.noRows" />
        <template v-else-if="pvCard">
          <p v-if="pvCard.read" class="ana-read">{{ pvCard.read }}</p>
          <div v-if="pvCard.rows.length" class="mn-rules">
            <div v-for="r in pvCard.rows" :key="r.h.id" class="mn-rule" :class="{ done: statusOf(r.h.id) === 'done' }">
              <span class="mn-dot"></span>
              <div class="bd">
                <div class="tt">{{ r.title }}<span class="mn-vv">{{ r.value }}</span></div>
                <div class="dt">{{ r.detail }}</div>
              </div>
              <div class="ops">
                <div class="mn-st-seg">
                  <button v-for="(k, i) in STATUS_KEYS" :key="k" type="button" :class="{ on: statusOf(r.h.id) === k }" @click="setStatus(r.h.id, k)">{{ M.status[i] }}</button>
                </div>
                <button type="button" class="mn-link" :disabled="!!lack('/pv-meter-analysis')" v-tip="lack('/pv-meter-analysis')" @click="goPv(r.h)">{{ M.view }}</button>
              </div>
            </div>
          </div>
          <button v-if="openPv" type="button" class="mn-all" @click="openPv = false">{{ M.collapse }}</button>
          <button v-else-if="pvCard.more" type="button" class="mn-all" @click="openPv = true">{{ S.linkAll(pvCard.n) }}</button>
        </template>
        <template v-else>
          <p class="ana-read hold"></p>
          <div class="fp-shim" style="height: 264px"></div>
          <button type="button" class="mn-all ana-hole" disabled tabindex="-1">{{ S.linkAll(24) }}</button>
        </template>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.mn-name { order: -1; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
/* 左列清单:桌面档(两列并排)清单撑满到右列等高、卡内滚;窄档单列堆叠时按 560 封顶 */
.mn-listcard { display: flex; flex-direction: column; }
.mn-search { display: flex; align-items: center; gap: 7px; border: 1px solid var(--border-subtle); border-radius: 9px; padding: 6px 10px; margin-bottom: 8px; color: var(--text-muted); }
.mn-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-primary); }
.mn-read { margin: 0 0 8px; }
.mn-read.tight { margin-bottom: 0; }
.mn-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; max-height: 560px; display: flex; flex-direction: column; gap: 4px; }
@media (min-width: 1281px) { .mn-list { height: 0; max-height: none; } }
.mn-row { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: transparent; border-radius: 9px; padding: 8px 9px; cursor: pointer; font-family: var(--font-sans); text-align: left; transition: background var(--dur-fast) var(--ease-standard); }
.mn-row:hover { background: var(--bg-hover); }
.mn-row:active:not(.on) { background: var(--ink-100); transition-duration: 0ms; }
.mn-row.on { background: var(--accent-blue); }
.mn-row .score { flex: 0 0 24px; font-size: 12px; font-weight: 500; color: var(--text-muted); font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.mn-row .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mn-row .nm { font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 名字后的档位小标签(高风险 / 观察):清单按未收排、不分组以后,屏顶两张瓦的户数靠它在清单里认出来;灰底,不用红 */
.mn-row .nm-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.mn-tier { flex: 0 0 auto; font-size: var(--fs-micro); line-height: 16px; padding: 0 5px; border-radius: 4px; background: var(--ink-100); color: var(--text-secondary); font-weight: var(--fw-medium); }
.mn-row .sub { font-size: var(--fs-micro); color: var(--text-muted); font-family: var(--font-mono); }
.mn-p { white-space: nowrap; }
.mn-amt { flex: 0 0 auto; font-family: var(--font-mono); font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); font-variant-numeric: tabular-nums; }
/* 右列 */
.mn-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
/* 规则行:中性色,不出红橙(高风险也不用红) */
.mn-rules { display: flex; flex-direction: column; gap: 8px; }
.mn-rule { display: flex; align-items: flex-start; gap: 10px; background: var(--surface-card); border-radius: 10px; padding: 9px 11px; }
.mn-rule.done { opacity: 0.62; }
.mn-rule.done .tt { text-decoration: line-through; }
.mn-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--hue-blue); margin-top: 6px; }
.mn-rule .bd { flex: 1; min-width: 0; }
.mn-rule .tt { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); display: flex; align-items: center; gap: 7px; }
.mn-vv { margin-left: auto; font-family: var(--font-mono); font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
.mn-rule .dt { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 2px; line-height: 1.5; }
.mn-rule .ops { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
/* 手机:三态按钮挤掉标题宽,换到下一行;名称放不下时值折到名称下面(光伏规则行名称长,不把名称挤成一列) */
@media (max-width: 600px) { .mn-rule { flex-wrap: wrap; } .mn-rule .bd { flex-basis: calc(100% - 17px); } .mn-rule .ops { margin-left: 17px; align-items: flex-start; } .mn-rule .tt { flex-wrap: wrap; } }
.mn-st-seg { display: inline-flex; background: var(--surface-sunken); border-radius: 999px; padding: 2px; }
.mn-st-seg button { border: none; cursor: pointer; background: transparent; color: var(--text-muted); font-family: var(--font-sans); font-size: var(--fs-micro); padding: 2px 9px; border-radius: 999px; transition: background var(--dur-fast), color var(--dur-fast); }
.mn-st-seg button.on { background: var(--surface-white); color: var(--text-primary); font-weight: var(--fw-semibold); box-shadow: 0 0 0 1px var(--border-subtle); }
.mn-link { border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); }
.mn-link:hover { text-decoration: underline; }
.mn-link:disabled { color: var(--text-disabled); cursor: default; text-decoration: none; }
/* 深链按钮 */
.mn-links { display: flex; gap: 10px; margin-top: 10px; border-top: 1px solid var(--divider); padding-top: 10px; }
.mn-go { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border-subtle); background: var(--surface-white); color: var(--text-secondary); border-radius: var(--radius-full); padding: 6px 14px; font-size: 12px; cursor: pointer; font-family: var(--font-sans); }
.mn-go:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.mn-go:disabled { opacity: 0.45; cursor: default; }
/* 底部计数卡:一行 = 名字 · 次数 · 最近一次;橙只给没到目标的收缴率 */
.mn-sum { display: grid; grid-template-columns: minmax(0, 1fr) auto 176px; gap: 12px; align-items: baseline; padding: 7px 2px; border-bottom: 1px solid var(--divider); font-size: var(--fs-label); color: var(--text-primary); }
.mn-sum .c { color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--fs-micro); }
.mn-sum .r { text-align: right; font-family: var(--font-mono); font-size: var(--fs-micro); font-weight: var(--fw-semibold); }
.mn-sum .r.miss { color: var(--warn-text); }
.mn-det { align-items: center; }
.mn-det.done { opacity: 0.62; }
.mn-all { display: block; margin: 6px auto 0; border: none; background: transparent; color: var(--text-link); font-size: var(--fs-micro); cursor: pointer; font-family: var(--font-sans); }
.mn-all:hover { text-decoration: underline; }
@media (max-width: 600px) { .mn-sum { grid-template-columns: minmax(0, 1fr) auto; } .mn-sum .r { grid-column: 1 / -1; text-align: left; } }
</style>
