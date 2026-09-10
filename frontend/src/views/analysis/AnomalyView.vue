<script setup lang="ts">
// 租户异常监控中心 v2(spec §二.2 + 示意图2,2026-07-08 整屏重做,本轮功能重心):
// 顶部规则汇总 4 卡(#kpis)| 左列租户风险清单(搜索+风险分最差在前;40/30/30 缺项归一,
// 阈值走 anaSettings:收缴目标/突变%/风险线)| 右面板=选中租户:电/水费逐月双线(±突变阈值%
// 相邻有数月突变红点 + 园区同类 P25~P75 灰带)、应收vs实收条(台账各期)、命中规则+处置状态
// (沿 localStorage 'fp-ana-anom',规则 id 稳定)、查台账/查附表10 深链。园区/公司级异常保留于
// 底部卡(v1 全量清单语义不丢)。纯函数见 monitor.logic.ts(单测 monitor.logic.spec.ts)。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import { iconFor } from '@/components/ds/icon'
import { STATUS, fint, fnum } from '@/components/ana/anaFmt'
import { bandSeries, bandTooWide } from '@/components/ana/anaTheme'
import { anaSettings } from '@/analysis/anaSettings'
import { buildAnomalies, fetchAnomalyInputs, type AnaAnomaly, type AnomalyInputs } from '@/analysis/anaData'
import { buildMonitorModel, elecReadout as elecReadoutOf, tenantLedgerBars, type MonitorTenant } from './monitor.logic'

const router = useRouter()
const tabs = useTabsStore()
const inputs = ref<AnomalyInputs | null>(null)
const ready = ref(false)
onMounted(async () => {
  try {
    inputs.value = await fetchAnomalyInputs()
  } finally {
    ready.value = true
  }
})

// ── 模型(阈值敏感:右上「目标与阈值」改动即时重算,无需重拉数据) ──
const model = computed(() => inputs.value
  ? buildMonitorModel(inputs.value.ledger, inputs.value.s10, {
      collectTarget: anaSettings.collectTarget, spikeTh: anaSettings.spikeTh, riskTh: anaSettings.churnTh,
    })
  : null)
// 全量规则引擎(cockpit 共用;租户级命中合并入右面板,园区/公司级保留于底部卡)
const anomalies = computed<AnaAnomaly[]>(() =>
  inputs.value ? buildAnomalies(inputs.value, { collectTarget: anaSettings.collectTarget }) : [])
const otherAnoms = computed(() => anomalies.value.filter((a) => a.type === '收缴率' || a.type === '能耗环比'))

// ── 左列清单(搜索 + 最差在前) ──
const q = ref('')
const list = computed(() => {
  const l = model.value?.list ?? []
  const k = q.value.trim()
  return k ? l.filter((t) => t.name.includes(k) || t.company.includes(k)) : l
})
const selName = ref<string | null>(null)
watch(list, (l) => {
  if (!l.length) { selName.value = null; return }
  if (!selName.value || !l.some((t) => t.name === selName.value)) selName.value = l[0].name
}, { immediate: true })
const sel = computed<MonitorTenant | null>(() => list.value.find((t) => t.name === selName.value) ?? null)
const tierZh = (t: MonitorTenant['tier']): string => (t === 'risk' ? '高风险' : t === 'watch' ? '观察' : '正常')
const tierColor = (t: MonitorTenant['tier']): string =>
  t === 'risk' ? 'var(--hue-red)' : t === 'watch' ? 'var(--hue-orange)' : 'var(--text-muted)'

// ── 右面板:电/水费双线 + 突变红点 + 园区 P25~P75 灰带 ──
const wanF = (v: number): string => fnum(v / 10000) + '万'
const energyOption = computed<object | null>(() => {
  const t = sel.value, m = model.value
  if (!t || !m || !t.months.length) return null
  const p25 = t.months.map((ym) => m.band[ym]?.p25 ?? null)
  const p75 = t.months.map((ym) => m.band[ym]?.p75 ?? null)
  const mkPts = (series: 'elec' | 'water', vals: number[]): object[] =>
    t.spikes.filter((s) => s.series === series).map((s) => ({ coord: [s.idx, vals[s.idx]] }))
  interface TipRow { seriesName?: string; axisValueLabel?: string; value?: number | null; marker?: string }
  return {
    grid: { left: 58, right: 16, top: 30, bottom: 26 },
    legend: { top: 0, data: ['电费', '水费'] },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: TipRow[]) => {
        const rows = ps.filter((p) => p.seriesName === '电费' || p.seriesName === '水费')
        return (rows[0]?.axisValueLabel ?? '') + rows.map((p) =>
          `<br/>${p.marker ?? ''}${p.seriesName} <b>¥${fint(Number(p.value ?? 0))}</b>`).join('')
      },
    },
    xAxis: { type: 'category', data: t.months, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => wanF(v) } },
    series: [
      // 园区同类灰带(P25~P75,堆叠带;silent 不响应交互)。带宽门(D3 附属):半宽/中位 > 20% 太宽,只出点不画带。
      ...(bandTooWide(p25, p75) ? [] : bandSeries(p25, p75, { name: '园区P25~P75' })),
      { name: '电费', type: 'line', data: t.elec, smooth: true, symbolSize: 5, itemStyle: { color: '#378ADD' },
        markPoint: { symbol: 'circle', symbolSize: 9, itemStyle: { color: '#E24B4A' }, label: { show: false }, data: mkPts('elec', t.elec) } },
      { name: '水费', type: 'line', data: t.water, smooth: true, symbolSize: 5, itemStyle: { color: '#5DCAA5' },
        markPoint: { symbol: 'circle', symbolSize: 9, itemStyle: { color: '#E24B4A' }, label: { show: false }, data: mkPts('water', t.water) } },
    ],
  }
})

// ── 电费读数句:选中租户末月电费 vs 同类区间(灰带只按电费画,水费不适用) ──
const elecReadout = computed<string | null>(() => {
  const t = sel.value, m = model.value
  if (!t || !m || !t.months.length) return null
  const ym = t.months[t.months.length - 1]
  return elecReadoutOf(t.elec[t.elec.length - 1], m.band[ym])
})
// D1:句子印了区间就得在同屏带出样本量 —— band 记录本身就是 n(D3:<20 不建 key,查不到具体数也就无从印起)。
const elecBandN = computed<number | null>(() => {
  const t = sel.value, m = model.value
  if (!t || !m || !t.months.length) return null
  return m.band[t.months[t.months.length - 1]]?.n ?? null
})
const elecBandRef = computed<string>(() => {
  const sample = elecBandN.value != null ? `样本${elecBandN.value}户` : '同类不足20户不画带'
  return `灰带=同类电费区间(acct_month 口径 · 元 · ${sample});相邻有数月环比判突变`
})

// ── 右面板:应收 vs 实收(台账各期) ──
const ledBars = computed(() => (sel.value && inputs.value ? tenantLedgerBars(inputs.value.ledger, sel.value.name) : null))
const ledgerOption = computed<object | null>(() => {
  const d = ledBars.value
  if (!d || !d.yms.length) return null
  return {
    grid: { left: 58, right: 16, top: 30, bottom: 24 },
    legend: { top: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : '¥' + fint(v)) },
    xAxis: { type: 'category', data: d.yms },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => wanF(v) } },
    series: [
      { name: '应收', type: 'bar', data: d.recv, barMaxWidth: 34, itemStyle: { color: '#85B7EB', borderRadius: [3, 3, 0, 0] } },
      { name: '实收', type: 'bar', data: d.coll, barMaxWidth: 34, itemStyle: { color: '#378ADD', borderRadius: [3, 3, 0, 0] } },
    ],
  }
})

// ── 命中规则(本屏租户级 mon:* + 规则引擎租户匹配条;id 稳定供状态跟踪) ──
interface HitRule { id: string; sev: 'risk' | 'watch' | 'info'; type: string; detail: string; ym: string; link?: string }
const hitRules = computed<HitRule[]>(() => {
  const t = sel.value
  if (!t) return []
  const engine = anomalies.value.filter((a) => a.title.startsWith(t.name + ' '))
    .map((a) => ({ id: a.id, sev: a.sev, type: a.type, detail: a.detail, ym: a.ym, link: a.link }))
  return [...t.rules, ...engine]
})

// ── 处置状态(沿 v1:localStorage 'fp-ana-anom',规则 id 稳定 → 跨会话/跨版本保留) ──
type TrackStatus = 'open' | 'doing' | 'done'
const STATUSES: { k: TrackStatus; l: string; c: string; bg: string }[] = [
  { k: 'open', l: '待处理', c: 'var(--hue-red)', bg: 'rgb(255,238,237)' },
  { k: 'doing', l: '处理中', c: 'var(--hue-orange)', bg: 'rgb(255,243,230)' },
  { k: 'done', l: '已解决', c: 'var(--hue-blue)', bg: 'var(--accent-blue)' },
]
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

// 深链走 openFresh({pin:true})(spec §4.1 页签语义不变;目标屏 useDeepPeriod 切回也认 query,P0b)。发链统一 periodLink(§4.2):
// 台账 → p + extra.company/tenant;附10 → p + co=期区(periodLink 的 co 就是附10 的期区;缺席不写,S10View 落当前册)+ extra.tenant。
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
const go = (link: string): void => { void router.push(link) }
/** 规则引擎异常条(AnaAnomaly):录入屏目标带期与定位;落分析屏的三条 p 今天不被消费(usePeriod 单例,spec §12 遗留),带上无害。
 *  本屏这一列(otherAnoms)只有规则①②、目标都是分析屏 → 今天等于原样 push;留着为与驾驶舱同形(驾驶舱 anomTop 含③④两条录入屏规则)。 */
const goAnom = (a: AnaAnomaly): void => {
  const v = a.link.slice(1)
  // 录入屏目标走 openFresh({pin:true})(与 goLedger / goS10 同形):缓存的台账 / 附10 页签有草稿时 useDeepPeriod 的 dirty 闸会吞掉这一跳,「一击落位」靠全新实例;分析屏目标保持裸 push
  if (v === 'ledger' || v === 'sales-income') tabs.openDeep(v)
  void router.push(periodLink(v, { p: periodOf(+a.ym.slice(0, 4), +a.ym.slice(5, 7)), co: a.co, extra: { company: a.company, tenant: a.tenant } }))
}
const sevIcon = (s: 'risk' | 'watch' | 'info'): string => (s === 'risk' ? 'alert-octagon' : s === 'watch' ? 'alert-triangle' : 'info')
</script>

<template>
  <!-- §五:期间无关屏(全窗口监控,规则跑全部数据),隐期间控件显口径徽章 -->
  <AnaShell period-mode="none" scope-chip="全窗口监控">
    <template #tools>
      <span class="mn-name"><component :is="iconFor('bell-ring')" :size="15" />租户异常监控中心</span>
    </template>

    <!-- 规则汇总 4 卡(高风险/观察/欠费合计/能耗突变) -->
    <template #kpis>
      <AnaKpiTile label="高风险租户" :value="(model?.cards.risk ?? 0) + ' 户'" :note="`风险分 ≥ ${anaSettings.churnTh}(风险线)`" />
      <AnaKpiTile label="观察租户" :value="(model?.cards.watch ?? 0) + ' 户'" :note="`${anaSettings.churnTh - 20}–${anaSettings.churnTh - 1} 分`" />
      <AnaKpiTile label="欠费合计" :value="model?.cards.arrearsTotal ? '¥' + fnum(model.cards.arrearsTotal / 10000) + '万' : '—'"
        :note="model?.lastLedgerYm ? `取 ${model.lastLedgerYm} · ${model.cards.arrearsCount} 户` : '台账未录入'" />
      <AnaKpiTile label="能耗突变租户" :value="(model?.cards.spikeTenants ?? 0) + ' 户'" :note="`电/水费环比 >±${anaSettings.spikeTh}%`" />
    </template>

    <div v-if="!ready" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="!model || !model.list.length" class="av2-grid">
      <div class="av2-card av2-s12">
        <AnaEmpty label="台账与附表10 均无租户数据,监控中心暂不可用"
          hint="风险分依赖台账(应收/实收)与附表10(计费/电水费)" to="/ledger" to-text="去台账录入" />
      </div>
    </div>

    <div v-else class="av2-grid">
      <!-- 左列:租户风险清单 -->
      <div class="av2-card av2-s4 mn-listcard">
        <div class="av2-card-h">
          <span class="t">租户风险清单</span>
          <span class="hint">{{ list.length }} 户 · 最差在前</span>
        </div>
        <div class="mn-search">
          <component :is="iconFor('search')" :size="14" />
          <input v-model="q" placeholder="搜索租户 / 公司…" />
        </div>
        <div class="mn-list">
          <button v-for="t in list" :key="t.name" class="mn-row" :class="{ on: t.name === selName }" @click="selName = t.name">
            <span class="score" :style="{ color: tierColor(t.tier) }">{{ t.score }}</span>
            <span class="body">
              <!-- 租户名常是长公司名(实测「采研企业管理(佛山)有限公司,颐美青科…」660px 被截到 222px),
                   截断后认不出是哪一户 —— 补 title 出全文 -->
              <span class="nm" :title="t.name">{{ t.name }}</span>
              <span class="sub">
                {{ t.arrears > 0.005 ? '欠费 ¥' + fint(t.arrears) : (t.payRate != null ? '收缴 ' + t.payRate.toFixed(0) + '%' : '无台账') }}
                · {{ t.spikes.length ? '突变 ' + t.spikes.length + ' 处' : (t.gone ? '计费中断' : '能耗平稳') }}
              </span>
            </span>
            <span class="tier" :style="{ color: tierColor(t.tier), borderColor: tierColor(t.tier) }">{{ tierZh(t.tier) }}</span>
          </button>
          <AnaEmpty v-if="!list.length" label="无匹配租户" hint="调整搜索关键词" />
        </div>
      </div>

      <!-- 右面板:选中租户 -->
      <div class="av2-s8 mn-right">
        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t">{{ sel?.name ?? '—' }} · 电/水费逐月</span>
            <span class="hint">红点=突变 >±{{ anaSettings.spikeTh }}%</span>
          </div>
          <AnaEChart v-if="energyOption" :option="energyOption" :height="250" />
          <AnaEmpty v-else label="该租户无附表10 计费记录" hint="电/水费趋势来自附表10 租户×月" to="/sales-income" to-text="去录入附表10" />
          <template v-if="energyOption">
            <p v-if="elecReadout" class="ana-read">{{ elecReadout }}</p>
            <p class="ana-ref">{{ elecBandRef }}</p>
          </template>
        </div>

        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t">应收 vs 实收</span>
            <span class="hint">台账覆盖 {{ ledBars?.yms.length ?? 0 }} 期 · 跨公司求和</span>
          </div>
          <AnaEChart v-if="ledgerOption" :option="ledgerOption" :height="200" />
          <AnaEmpty v-else label="该租户无台账记录" hint="应收/实收来自月度台账" to="/ledger" to-text="去台账录入" />
        </div>

        <div class="av2-card">
          <div class="av2-card-h">
            <span class="t">命中规则与处置</span>
            <span class="hint">状态本地保存 · 规则 id 稳定</span>
          </div>
          <div v-if="hitRules.length" class="mn-rules">
            <div v-for="r in hitRules" :key="r.id" class="mn-rule" :style="{ opacity: statusOf(r.id) === 'done' ? 0.62 : 1 }">
              <span class="ic" :style="{ color: STATUS[r.sev].color, background: STATUS[r.sev].soft }">
                <component :is="iconFor(sevIcon(r.sev))" :size="14" />
              </span>
              <div class="bd">
                <div class="tt" :style="{ textDecoration: statusOf(r.id) === 'done' ? 'line-through' : 'none' }">
                  {{ r.type }} · {{ r.ym }}
                </div>
                <div class="dt">{{ r.detail }}</div>
              </div>
              <div class="ops">
                <div class="mn-st-seg">
                  <button v-for="o in STATUSES" :key="o.k" :style="{
                    fontWeight: statusOf(r.id) === o.k ? 600 : 400,
                    background: statusOf(r.id) === o.k ? o.bg : 'transparent',
                    color: statusOf(r.id) === o.k ? o.c : 'var(--text-muted)',
                  }" @click="setStatus(r.id, o.k)">{{ o.l }}</button>
                </div>
                <button v-if="r.link" class="mn-link" @click="go(r.link)">查看分析 →</button>
              </div>
            </div>
          </div>
          <AnaEmpty v-else label="该租户未命中任何规则" hint="欠费 / 能耗突变 / 收入中断 / 负值行 均未触发" />
          <div v-if="sel" class="mn-links">
            <button class="mn-go" :disabled="!sel.company || !model.lastLedgerYm" :title="sel.company ? '' : '该租户无台账记录'" @click="goLedger(sel)">
              查台账<component :is="iconFor('arrow-up-right')" :size="13" />
            </button>
            <button class="mn-go" :disabled="!sel.months.length" :title="sel.months.length ? '' : '该租户无附表10 记录'" @click="goS10(sel)">
              查附表10<component :is="iconFor('arrow-up-right')" :size="13" />
            </button>
          </div>
        </div>
      </div>

      <!-- 园区/公司级异常(v1 全量清单语义保留:收缴率/能耗环比不挂单一租户) -->
      <div class="av2-card av2-s12">
        <div class="av2-card-h">
          <span class="t">园区 / 公司级异常</span>
          <span class="hint">{{ otherAnoms.length }} 条 · 收缴率(公司×期)与能耗环比(园区口径,固定 ±40%)</span>
        </div>
        <div v-if="otherAnoms.length" class="mn-rules">
          <div v-for="a in otherAnoms" :key="a.id" class="mn-rule" :style="{ opacity: statusOf(a.id) === 'done' ? 0.62 : 1 }">
            <span class="ic" :style="{ color: STATUS[a.sev].color, background: STATUS[a.sev].soft }">
              <component :is="iconFor(sevIcon(a.sev))" :size="14" />
            </span>
            <div class="bd">
              <div class="tt" :style="{ textDecoration: statusOf(a.id) === 'done' ? 'line-through' : 'none' }">
                {{ a.title }}<span class="tag">{{ a.dim }} · {{ a.type }} · {{ a.metric }}</span>
              </div>
              <div class="dt">{{ a.detail }}</div>
            </div>
            <div class="ops">
              <div class="mn-st-seg">
                <button v-for="o in STATUSES" :key="o.k" :style="{
                  fontWeight: statusOf(a.id) === o.k ? 600 : 400,
                  background: statusOf(a.id) === o.k ? o.bg : 'transparent',
                  color: statusOf(a.id) === o.k ? o.c : 'var(--text-muted)',
                }" @click="setStatus(a.id, o.k)">{{ o.l }}</button>
              </div>
              <button class="mn-link" @click="goAnom(a)">查看分析 →</button>
            </div>
          </div>
        </div>
        <AnaEmpty v-else label="当前阈值下无园区/公司级异常" hint="可在右上「目标与阈值」调整收缴率目标" />
      </div>

      <div class="av2-s12">
        <AnaMethodNote>
          风险分 = 收缴恶化(40%) + 营收变动(30%) + 能耗变动(30%),缺项按权重归一,高分=差;收缴取台账
          {{ model.lastLedgerYm ?? '—' }} 期,营收/能耗取附表10 相邻有数月环比(能耗按|环比|,突变双向计入)。
          阈值(收缴目标 {{ anaSettings.collectTarget }}% / 突变 ±{{ anaSettings.spikeTh }}% / 风险线 {{ anaSettings.churnTh }} 分)在右上「目标与阈值」调整并即时重算;处置状态仅本地保存。
        </AnaMethodNote>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.mn-name { order: -1; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; }
/* 左列清单 */
.mn-listcard { display: flex; flex-direction: column; }
.mn-search { display: flex; align-items: center; gap: 7px; border: 1px solid var(--border-subtle); border-radius: 9px; padding: 6px 10px; margin-bottom: 8px; color: var(--text-muted); }
.mn-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-primary); }
.mn-list { flex: 1; min-height: 0; overflow-y: auto; max-height: 560px; display: flex; flex-direction: column; gap: 4px; }
.mn-row { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: transparent; border-radius: 9px; padding: 8px 9px; cursor: pointer; font-family: var(--font-sans); text-align: left; }
.mn-row:hover { background: var(--bg-hover); }
.mn-row.on { background: var(--accent-blue); }
.mn-row .score { flex: 0 0 34px; font-size: 15px; font-weight: 600; font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.mn-row .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mn-row .nm { font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mn-row .sub { font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-mono); }
.mn-row .tier { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-semibold); border: 1px solid; border-radius: var(--radius-full); padding: 1px 7px; }
/* 右面板 */
.mn-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
/* 规则行 */
.mn-rules { display: flex; flex-direction: column; gap: 8px; }
.mn-rule { display: flex; align-items: flex-start; gap: 10px; background: var(--surface-card); border-radius: 10px; padding: 9px 11px; }
.mn-rule .ic { width: 26px; height: 26px; flex: 0 0 auto; border-radius: 8px; display: grid; place-items: center; }
.mn-rule .bd { flex: 1; min-width: 0; }
.mn-rule .tt { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.mn-rule .tt .tag { font-size: var(--fs-micro); font-weight: var(--fw-medium); color: var(--text-muted); background: var(--surface-sunken); border-radius: var(--radius-full); padding: 1px 7px; }
.mn-rule .dt { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 2px; line-height: 1.5; }
.mn-rule .ops { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.mn-st-seg { display: inline-flex; background: var(--surface-sunken); border-radius: 999px; padding: 2px; }
.mn-st-seg button { border: none; cursor: pointer; font-family: var(--font-sans); font-size: var(--fs-micro); padding: 2px 9px; border-radius: 999px; transition: background var(--dur-fast), color var(--dur-fast); }
.mn-link { border: none; background: transparent; color: var(--text-link); font-size: 11px; cursor: pointer; font-family: var(--font-sans); }
.mn-link:hover { text-decoration: underline; }
/* 深链按钮 */
.mn-links { display: flex; gap: 10px; margin-top: 10px; border-top: 1px solid var(--divider); padding-top: 10px; }
.mn-go { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border-subtle); background: var(--surface-white); color: var(--text-secondary); border-radius: var(--radius-full); padding: 6px 14px; font-size: 12px; cursor: pointer; font-family: var(--font-sans); }
.mn-go:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.mn-go:disabled { opacity: 0.45; cursor: default; }
</style>
