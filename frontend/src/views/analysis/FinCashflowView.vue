<script setup lang="ts">
// 现金流量分析(fin-cashflow)v2 — spec §二.9:欠费结余瀑布(ECharts);应收实收分组柱
// (点柱→该期欠费租户清单弹层,清单行可查台账深链);收缴率 vs 目标条(SVG 子弹条原语保留);
// 下半现金流量表空态保留。排版=AnaShell v2(#kpis)+ av2-grid(主图 s8/次图 s4)。
// 台账聚合口径与 v1 完全一致(ledgerPeriods/wf/statItems 计算未动);纯函数见 finCashflow.logic.ts。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import AnaBarRow from '@/components/ana/AnaBarRow.vue'
import AnaTrend from '@/components/ana/AnaTrend.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import DsSelect from '@/components/ds/Select.vue'
import { iconFor } from '@/components/ds/icon'
import { anaSettings } from '@/analysis/anaSettings'
import { useTabsStore } from '@/stores/tabs'
import { fetchCompanies, fetchLedgerRows, fetchS10PhaseMonthly, type S10PhaseMonthly } from '@/analysis/anaData'
import { fint, fnum } from '@/components/ana/anaFmt'
import { waterfallOption, type WfItem } from './finPnl.logic'
import { arrearsOf, rcGroupOption } from './finCashflow.logic'
import type { AnalysisLedgerRow } from '@/api/analysis'
import type { CompanyDTO } from '@/types/ledger'

const ready = ref(false)

// ── 公司选择器(法人口径;'0'=全部公司汇总,过滤台账卡) ──
const companies = ref<CompanyDTO[]>([])
const cid = ref('0')
const companyOpts = computed(() => [
  { value: '0', label: '全部公司(汇总)' },
  ...companies.value.map((c) => ({ value: String(c.id), label: c.name })),
])
const companyLabel = computed(() =>
  cid.value === '0' ? '全部公司(汇总)' : companies.value.find((c) => String(c.id) === cid.value)?.name ?? '—')

// ── 数据(一次拉全,过滤/聚合全在客户端) ──
const ledgerRows = ref<AnalysisLedgerRow[]>([])
const s10 = ref<S10PhaseMonthly | null>(null)
onMounted(async () => {
  try {
    const [cos, rows, pm] = await Promise.all([fetchCompanies(), fetchLedgerRows(), fetchS10PhaseMonthly()])
    companies.value = cos
    ledgerRows.value = rows
    s10.value = pm
  } catch { /* 拉取失败 → 空态卡兜底 */ } finally {
    ready.value = true
  }
})

// ── 台账聚合:公司过滤 → 按期 Σ(应收=21费;结余=期初+应收−实收)(同 v1) ──
interface LedgerPeriod { ym: string; receivable: number; collected: number; balancePrev: number; balanceEnd: number; rate: number }
const ledgerPeriods = computed<LedgerPeriod[]>(() => {
  const byYm = new Map<string, LedgerPeriod>()
  for (const r of ledgerRows.value) {
    if (cid.value !== '0' && String(r.companyId) !== cid.value) continue
    const ym = r.year + '-' + String(r.month).padStart(2, '0')
    const acc = byYm.get(ym) ?? { ym, receivable: 0, collected: 0, balancePrev: 0, balanceEnd: 0, rate: 0 }
    acc.receivable += r.receivable
    acc.collected += r.collected
    acc.balancePrev += r.balancePrev
    acc.balanceEnd += r.balanceEnd
    byYm.set(ym, acc)
  }
  return [...byYm.values()].sort((a, b) => a.ym.localeCompare(b.ym))
    .map((p) => ({ ...p, rate: p.receivable ? +((p.collected / p.receivable) * 100).toFixed(1) : 0 }))
})
// §五:期间无关屏不消费 period —「本期」＝最近台账期(覆盖窗口末,徽章已声明口径)
const cur = computed<LedgerPeriod | null>(() => {
  const list = ledgerPeriods.value
  return list.length ? list[list.length - 1] : null
})

// §五:口径徽章「台账覆盖窗口 首期 / 末期」(全量台账数据派生,不写死、不随公司过滤)
const allLedgerYms = computed(() =>
  [...new Set(ledgerRows.value.map((r) => r.year + '-' + String(r.month).padStart(2, '0')))].sort())
const scopeChip = computed(() => {
  if (!ready.value) return ''   // 加载中不出徽章(空串 → AnaShell 不渲染)
  const ys = allLedgerYms.value
  return ys.length ? `台账覆盖窗口 ${ys[0]} / ${ys[ys.length - 1]}` : '台账未录入'
})

// ── s10 现收(园区口径,跨期次合计,同 v1) ──
const s10Months = computed(() => s10.value?.months ?? [])
const s10Totals = computed(() => {
  const pm = s10.value
  if (!pm) return []
  return pm.months.map((m) => pm.phases.reduce((s, ph) => s + (pm.totals[ph]?.[m] ?? 0), 0) / 1e4)
})
const s10Sum = computed(() => s10Totals.value.reduce((s, v) => s + v, 0))

// KPI 条(数值同 v1 statItems)
const kpis = computed(() => {
  const c = cur.value
  if (!c) return []
  const below = c.rate < anaSettings.collectTarget
  return [
    { label: '本期应收(台账)', value: '¥' + fint(c.receivable / 1e4) + '万', note: '台账期 ' + c.ym },
    { label: '本期实收', value: '¥' + fint(c.collected / 1e4) + '万' },
    { label: '收缴率', value: c.rate.toFixed(1) + '%', note: '目标 ' + anaSettings.collectTarget + '%' + (below ? ' · 未达标' : '') },
    { label: '期初欠费结余', value: '¥' + fint(c.balancePrev / 1e4) + '万' },
    {
      label: '期末欠费结余', value: '¥' + fint(c.balanceEnd / 1e4) + '万',
      note: (c.balanceEnd >= c.balancePrev ? '+' : '−') + fint(Math.abs(c.balanceEnd - c.balancePrev) / 1e4) + '万 较期初',
    },
    { label: 's10 现收累计', value: '¥' + fint(s10Sum.value) + '万', note: '附表10 · 园区口径 ' + s10Months.value.length + ' 期' },
  ]
})

// 欠费结余瀑布:期初欠费 → +本期应收 → −本期实收 → 期末欠费(值同 v1)
const wf = computed<WfItem[]>(() => {
  const c = cur.value
  if (!c) return []
  return [
    { name: '期初欠费结余', value: c.balancePrev / 1e4, type: 'start' },
    { name: '本期应收', value: c.receivable / 1e4, type: 'inc' },
    { name: '本期实收', value: -c.collected / 1e4, type: 'dec' },
    { name: '期末欠费结余', value: c.balanceEnd / 1e4, type: 'end' },
  ]
})
const wfOpt = computed(() => waterfallOption(wf.value))

// ── 应收 vs 实收 分组柱(点柱→该期欠费租户清单弹层,spec 下钻) ──
const rcOpt = computed(() => rcGroupOption(ledgerPeriods.value))
const drillYm = ref<string | null>(null)
const drillRows = computed(() =>
  drillYm.value ? arrearsOf(ledgerRows.value, cid.value, drillYm.value) : [])
function onRcClick(params: unknown) {
  const name = (params as { name?: string }).name
  if (name && ledgerPeriods.value.some((p) => p.ym === name)) drillYm.value = name
}

// 深链必须 openFresh:KeepAlive 缓存的 LedgerView 只在 onMounted 消费 query(同 ChurnView.goLedger)
const router = useRouter()
const tabs = useTabsStore()
function goLedger(tenant: string, company: string, ym: string) {
  drillYm.value = null
  tabs.openFresh('ledger', { pin: true })
  router.push({ path: '/ledger', query: { y: ym.slice(0, 4), m: String(+ym.slice(5, 7)), company, tenant } })
}

const fmtWanTip = (v: number): string => '¥' + fnum(v, 1) + '万'
</script>

<template>
  <!-- §五:期间无关屏(台账覆盖窗口)→ 隐期间控件,显数据派生口径徽章 -->
  <AnaShell period-mode="none" :scope-chip="scopeChip">
    <template #tools>
      <span class="fin-name"><component :is="iconFor('wallet')" :size="14" />现金流量分析</span>
      <span class="fin-lbl"><component :is="iconFor('scale')" :size="12" />公司</span>
      <DsSelect size="sm" :options="companyOpts" :model-value="cid" :style="{ width: '172px' }"
        @update:model-value="cid = $event" />
    </template>

    <template #kpis>
      <AnaKpiTile v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value" :note="k.note" />
    </template>

    <div class="fin-page">
      <div class="fin-head">
        <span class="sub">现金流量表未录入(spec 改造) · 上=收款实现视图(台账应收 vs 实收 + 附表10 现收) · 单位 万元</span>
        <AnaPill tone="legal" icon="scale">法人口径 · {{ companyLabel }}</AnaPill>
      </div>

      <div class="av2-grid">
        <template v-if="cur">
          <!-- 主图 s8:欠费结余瀑布 -->
          <div class="av2-card av2-s8">
            <div class="av2-card-h"><span class="t">收款实现瀑布 · {{ cur.ym }}</span>
              <span class="hint">期初欠费 → 本期应收 → 本期实收 → 期末欠费 · 蓝＝加项 / 红＝减项</span></div>
            <AnaEChart :option="wfOpt" :height="256" />
            <AnaMethodNote>欠费结余口径:期末＝期初＋本期应收(21费合计)−本期实收;实收＞应收表示收回历史欠费。</AnaMethodNote>
          </div>

          <!-- 次图 s4:收缴率 vs 目标(SVG 子弹条原语保留) -->
          <div class="av2-card av2-s4">
            <div class="av2-card-h"><span class="t">收缴率 vs 目标</span>
              <span class="hint">目标 {{ anaSettings.collectTarget }}%(设置弹层可调)</span></div>
            <div class="ak-bar-rows" style="margin-top: 6px">
              <AnaBarRow v-for="p in ledgerPeriods" :key="p.ym" :name="p.ym" :value="p.rate" :max="100"
                :target="anaSettings.collectTarget"
                :fill="p.rate >= anaSettings.collectTarget ? 'var(--fill-blue)' : 'var(--hue-orange)'" />
            </div>
            <AnaMethodNote>收缴率＝Σ实收 ÷ Σ应收 × 100;台账仅 {{ ledgerPeriods.length }} 期,趋势结论需谨慎(覆盖度口径)。</AnaMethodNote>
          </div>

          <!-- 应收 vs 实收 分组柱 s8(点柱→该期欠费租户清单) -->
          <div class="av2-card av2-s8">
            <div class="av2-card-h"><span class="t">应收 vs 实收 · 分期对比</span>
              <span class="hint">台账仅 {{ ledgerPeriods.length }} 期(稀疏覆盖) · 点柱→该期欠费租户清单</span></div>
            <AnaEChart :option="rcOpt" :height="236" @chart-click="onRcClick" />
          </div>
        </template>
        <div v-else-if="ready" class="av2-card av2-s8">
          <AnaEmpty label="该公司暂无月度台账数据" hint="录入月度台账(应收/实收/结余)后,此处呈现收款实现视图"
            to="/ledger" toText="去录入台账" />
        </div>

        <!-- 附表10 现收 s4(园区口径,SVG 趋势原语保留) -->
        <div v-if="s10Months.length" class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">附表10 现收 · 逐期</span>
            <span class="hint">园区口径(不随公司过滤) · {{ s10Months.length }} 期</span></div>
          <AnaTrend :labels="s10Months" :cur="s10Totals" unit="万" :height="200" cur-name="现收合计" />
          <AnaMethodNote>25 费项合计,仅有数据月份;s10 无公司维度,本卡不随公司选择器过滤。</AnaMethodNote>
        </div>

        <!-- spec 必选空态:下半屏 现金流量表引导 s12 -->
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">现金流量表</span>
            <span class="hint">经营 / 投资 / 筹资 三段 · 现金流瀑布 · 自由现金流 FCF</span></div>
          <AnaEmpty label="现金流量表数据待录入"
            hint="园区当前无经营/投资/筹资三段现金流数据源;录入现金流量表后,此处呈现三段净额对比、期初→期末现金瀑布与 FCF(原型 screen-fin-cashflow 全量视图)"
            to="/reports-home" toText="去报表中心" />
        </div>
      </div>
    </div>

    <!-- 欠费租户清单弹层(点分组柱下钻;行内查台账深链) -->
    <div v-if="drillYm" class="fin-mask" @click="drillYm = null">
      <div class="fin-modal" @click.stop>
        <div class="fin-modal-h">
          <span class="t">{{ drillYm }} 欠费租户清单 · {{ companyLabel }}</span>
          <button class="x" aria-label="关闭" @click="drillYm = null"><component :is="iconFor('x')" :size="15" /></button>
        </div>
        <div class="fin-modal-sub">期末欠费结余 &gt; 0 的租户,按欠费额降序 · 共 {{ drillRows.length }} 户 · 单位 万元</div>
        <div class="fin-modal-body">
          <table v-if="drillRows.length" class="ak-tbl">
            <thead><tr><th>租户</th><th>公司</th><th>期初欠费</th><th>本期应收</th><th>本期实收</th><th>期末欠费</th><th>台账</th></tr></thead>
            <tbody>
              <tr v-for="r in drillRows" :key="r.companyName + r.tenantName">
                <td>{{ r.tenantName }}</td>
                <td class="mut">{{ r.companyName }}</td>
                <td class="mono mut">{{ fnum(r.balancePrev / 1e4, 1) }}</td>
                <td class="mono mut">{{ fnum(r.receivable / 1e4, 1) }}</td>
                <td class="mono mut">{{ fnum(r.collected / 1e4, 1) }}</td>
                <td class="mono" style="font-weight: 600; color: var(--hue-orange)">{{ fnum(r.balanceEnd / 1e4, 1) }}</td>
                <td><button class="fin-link" @click="goLedger(r.tenantName, r.companyName, drillYm!)">查台账 →</button></td>
              </tr>
            </tbody>
          </table>
          <AnaEmpty v-else label="该期无欠费租户" hint="所选公司口径下,该期期末欠费结余均 ≤ 0" />
        </div>
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 工具条标签 + v2 紧凑页头(复刻 AnaShell .anx-lbl 观感) */
.fin-name { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.fin-lbl { font-size: 11.5px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.fin-page { display: flex; flex-direction: column; gap: 10px; max-width: 1640px; margin: 0 auto; }
.fin-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.fin-head .sub { font-size: 11.5px; color: var(--text-muted); }
.fin-link { border: none; background: transparent; color: var(--text-link); font-size: 11.5px; cursor: pointer; font-family: var(--font-sans); padding: 0; }

/* 欠费清单弹层(屏私有,轻量遮罩卡) */
.fin-mask { position: fixed; inset: 0; z-index: 60; background: rgba(28,28,28,.32); display: grid; place-items: center; padding: 24px; }
.fin-modal { background: var(--surface-white); border-radius: 16px; box-shadow: 0 18px 48px rgba(28,28,28,.22); width: min(760px, 100%); max-height: 78vh; display: flex; flex-direction: column; padding: 18px 20px; box-sizing: border-box; }
.fin-modal-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.fin-modal-h .t { font-size: 14px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.fin-modal-h .x { width: 28px; height: 28px; border: none; border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; }
.fin-modal-h .x:hover { background: var(--bg-hover); color: var(--text-primary); }
.fin-modal-sub { font-size: 11.5px; color: var(--text-muted); margin: 4px 0 10px; }
.fin-modal-body { overflow: auto; min-height: 0; }
</style>
