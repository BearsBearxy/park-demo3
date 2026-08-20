<script setup lang="ts">
// 资产负债分析(fin-balance)v2 — spec §二.8:资产/负债双环(ECharts)+ 比率仪表(gauge ≤2,
// 勿仪表盘泛滥:仅 资产负债率+流动比率,其余比率留 KPI 条/副行)+ 快照表;趋势空态保留。
// 排版=AnaShell v2(#kpis=AnaKpiTile 条)+ av2-grid。取数/比率计算与 v1 完全一致(bsValOf/T/R 未动);
// 双环/gauge option 纯函数见 finBalance.logic.ts。法人口径公司选择器保留。
import { computed, ref, watch } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaPill from '@/components/ana/AnaPill.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import DsSelect from '@/components/ds/Select.vue'
import { iconFor } from '@/components/ds/icon'
import { usePeriod } from '@/analysis/usePeriod'
import { fetchAvailableMonths, fetchCompanies, fetchReportAll, fetchReportPeriod } from '@/analysis/anaData'
import { computeBsRow, BS_ROWS } from '@/reports/balanceSheet'
import { computeRow } from '@/reports/incomeStatement'
import { fint, fnum } from '@/components/ana/anaFmt'
import { donutOption, gaugesOption, sliceColor } from './finBalance.logic'
import { nextTick } from 'vue'
import type { CompanyDTO } from '@/types/ledger'
import type { ReportPeriodDTO } from '@/types/report'

const period = usePeriod()
const ready = ref(false)

// ── 公司选择器(法人口径;'0'=全部公司汇总) ──
const companies = ref<CompanyDTO[]>([])
const cid = ref('0')
const companyOpts = computed(() => [
  { value: '0', label: '全部公司(汇总)' },
  ...companies.value.map((c) => ({ value: String(c.id), label: c.name })),
])
const companyLabel = computed(() =>
  cid.value === '0' ? '全部公司(汇总)' : companies.value.find((c) => String(c.id) === cid.value)?.name ?? '—')

// ── 快照月 = 所选月若有报表否则最近报表月(数据派生,不硬编码) ──
const reportMonths = ref<string[]>([])
const reportYm = computed(() => {
  const list = reportMonths.value
  if (!list.length) return null
  if (period.ym.value && list.includes(period.ym.value)) return period.ym.value
  const inYear = list.filter((m) => +m.slice(0, 4) === period.sel.value.year)
  const pool = inYear.length ? inYear : list
  return pool[pool.length - 1]
})

// §五策略2「快照月回退」显式:所选期 ≠ 报表月 → 横幅(月粒度比月;年粒度比年;相等不渲染)
const selPeriodLabel = computed(() => period.ym.value ?? period.sel.value.year + '年')
const reportFallback = computed(() => {
  const rym = reportYm.value
  if (!rym) return false
  return period.ym.value ? rym !== period.ym.value : !rym.startsWith(period.sel.value.year + '-')
})

// ── 数据:bs 快照 + is 快照(杜邦净利率/周转率联动) ──
const bsDto = ref<ReportPeriodDTO | null>(null)
const isDto = ref<ReportPeriodDTO | null>(null)
let token = 0
watch([cid, reportYm], async ([c, rym]) => {
  const t = ++token
  try {
    const [cos, months] = await Promise.all([fetchCompanies(), fetchAvailableMonths()])
    let bs: ReportPeriodDTO | null = null, is: ReportPeriodDTO | null = null
    if (rym) {
      const y = +rym.slice(0, 4), m = +rym.slice(5, 7)
      ;[bs, is] = await Promise.all([
        c === '0' ? fetchReportAll('bs', y, m) : fetchReportPeriod('bs', +c, y, m),
        c === '0' ? fetchReportAll('is', y, m) : fetchReportPeriod('is', +c, y, m),
      ])
    }
    if (t !== token) return
    companies.value = cos
    reportMonths.value = months.sources.report ?? []
    bsDto.value = bs
    isDto.value = is
  } catch {
    if (t === token) { bsDto.value = null; isDto.value = null }
  } finally {
    if (t === token) ready.value = true
  }
}, { immediate: true })

// ── 取数(复用 reports/balanceSheet.ts 已测合计公式;单列 end) ──
function bsValOf(dto: ReportPeriodDTO): (no: number) => number {
  const kids = new Map<string, string[]>()
  for (const cr of dto.customRows) {
    const l = kids.get(cr.parentKey) ?? []
    l.push(cr.rowKey)
    kids.set(cr.parentKey, l)
  }
  const leaf = (no: number): number => dto.amounts[String(no)]?.end ?? 0
  const kidSum = (no: number): number | null => {
    const ks = kids.get(String(no))
    if (!ks?.length) return null
    return ks.reduce((s, k) => s + (dto.amounts[k]?.end ?? 0), 0)
  }
  return (no) => computeBsRow(no, leaf, kidSum)
}
const bsVal = computed(() => (bsDto.value ? bsValOf(bsDto.value) : null))
const hasBs = computed(() => !!bsDto.value && Object.keys(bsDto.value.amounts).length > 0)

const T = computed(() => {
  const v = bsVal.value
  if (!v) return null
  return {
    totalAssets: v(30), curAssets: v(15), ncAssets: v(29),
    curLiab: v(41), ncLiab: v(46), totalLiab: v(47), equity: v(52),
    cash: v(1), ar: v(4), inv: v(9),
  }
})

// is 快照(杜邦联动):净利率 = 净利ytd/收入ytd;周转率 = 收入ytd/期末总资产(单期近似口径)
const isPart = computed(() => {
  const dto = isDto.value
  if (!dto || !Object.keys(dto.amounts).length) return null
  const leaf = (no: number, f: string): number => dto.amounts[String(no)]?.[f] ?? 0
  const v = (no: number): number => computeRow(no, 'ytd', leaf, () => null)
  return { rev: v(1), net: v(32) }
})

const R = computed(() => {
  const t = T.value
  if (!t || !t.totalAssets) return null
  const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)
  const ip = isPart.value
  return {
    debtRatio: (t.totalLiab / t.totalAssets) * 100,
    current: div(t.curAssets, t.curLiab),
    quick: div(t.curAssets - t.inv, t.curLiab),
    equityMult: div(t.totalAssets, t.equity),
    ncShare: (t.ncAssets / t.totalAssets) * 100,
    netMargin: ip && ip.rev ? (ip.net / ip.rev) * 100 : null,
    assetTurn: ip ? ip.rev / t.totalAssets : null,
    roe: ip ? div(ip.net, t.equity) : null,          // 比例,显示时 ×100
    roa: ip ? (ip.net / t.totalAssets) * 100 : null,
  }
})

// KPI 条(数值同 v1 statItems;单期快照无 delta,副信息走 note)
const kpis = computed(() => {
  const t = T.value, r = R.value
  if (!t || !r) return []
  return [
    { label: '资产总计', value: '¥' + fint(t.totalAssets / 1e4) + '万' },
    { label: '负债合计', value: '¥' + fint(t.totalLiab / 1e4) + '万' },
    { label: '所有者权益', value: '¥' + fint(t.equity / 1e4) + '万', note: t.equity < 0 ? '权益为负' : undefined },
    { label: '资产负债率', value: r.debtRatio.toFixed(1) + '%', note: r.debtRatio > 70 ? '高于 70% 关注' : undefined },
    { label: '流动比率', value: r.current == null ? '—' : r.current.toFixed(2), note: '速动 ' + (r.quick == null ? '—' : r.quick.toFixed(2)) },
    { label: '权益乘数', value: r.equityMult == null ? '—' : r.equityMult.toFixed(2) + '×' },
  ]
})

// ── 双环(负值/零值科目不入环,同 v1;应交税费/未分配利润可为负) ──
const assetDonut = computed(() => {
  const v = bsVal.value
  if (!v) return []
  const defs: [string, number][] = [
    ['货币资金', 1], ['应收账款', 4], ['预付账款', 5], ['其他应收款', 8], ['存货', 9], ['其他流动资产', 14],
    ['固定资产净值', 20], ['在建工程', 21], ['无形资产', 25], ['长期待摊费用', 27],
  ]
  return defs.map(([label, no]) => ({ label, value: v(no) })).filter((d) => d.value > 0)
})
const leDonut = computed(() => {
  const v = bsVal.value
  if (!v) return []
  const defs: [string, number][] = [
    ['短期借款', 31], ['应付账款', 33], ['应付职工薪酬', 35], ['应交税费', 36], ['其他应付款', 39],
    ['非流动负债', 46], ['实收资本', 48], ['资本公积', 49], ['盈余公积', 50], ['未分配利润', 51],
  ]
  return defs.map(([label, no]) => ({ label, value: v(no) })).filter((d) => d.value > 0)
})
const assetOpt = computed(() =>
  donutOption(assetDonut.value, ((T.value?.totalAssets ?? 0) / 1e8).toFixed(1) + '亿', '资产总计'))
const leOpt = computed(() =>
  donutOption(leDonut.value, (R.value?.debtRatio ?? 0).toFixed(0) + '%', '资产负债率'))
const gaugeOpt = computed(() => gaugesOption(R.value?.debtRatio ?? 0, R.value?.current ?? null))

// 点环扇区 → 快照全表滚动定位并高亮该科目行(复审:本屏补下钻;行匹配按 label 前缀)
const flashLabel = ref<string | null>(null)
async function locateRow(p: unknown) {
  const name = (p as { name?: string }).name
  if (!name) return
  const row = bsTable.value.find(r => r.label.trim().startsWith(name) || name.startsWith(r.label.trim()))
  if (!row) return
  flashLabel.value = row.label
  await nextTick()
  document.querySelector('[data-bsrow="' + CSS.escape(row.label) + '"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  setTimeout(() => { if (flashLabel.value === row.label) flashLabel.value = null }, 2000)
}

// ── 全表(单期:期末 + 占资产总计;「较年初」列因仅一期快照降级删除) ──
interface BsTblRow { label: string; level: number; kind: 'label' | 'normal' | 'subtotal'; v: number | null; share: number | null }
const bsTable = computed<BsTblRow[]>(() => {
  const v = bsVal.value
  if (!v) return []
  const ta = v(30)
  return BS_ROWS.map((r) => (r.no === null
    ? { label: r.label, level: r.level, kind: 'label' as const, v: null, share: null }
    : { label: r.label, level: r.level, kind: r.type, v: v(r.no), share: ta ? (v(r.no) / ta) * 100 : null }))
})
</script>

<template>
  <!-- §五:月敏感屏(full);快照月回退以横幅显式 -->
  <AnaShell period-mode="full">
    <template #tools>
      <span class="fin-name"><component :is="iconFor('scale')" :size="14" />资产负债分析</span>
      <span class="fin-lbl"><component :is="iconFor('scale')" :size="12" />公司</span>
      <DsSelect size="sm" :options="companyOpts" :model-value="cid" :style="{ width: '172px' }"
        @update:model-value="cid = $event" />
    </template>

    <template #kpis>
      <AnaKpiTile v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value" :note="k.note" />
    </template>

    <div class="fin-page">
      <div class="fin-head">
        <span class="sub">法人口径 · 结构占比、偿债与营运比率、杜邦 ROE 拆解 · 单位 万元 · {{ reportYm ?? '—' }} 期末快照(单期口径)</span>
        <AnaPill tone="legal" icon="scale">法人口径 · {{ companyLabel }}</AnaPill>
      </div>

      <!-- §五策略2:所选期无报表 → 快照月回退横幅(禁静默) -->
      <AnaPeriodBanner v-if="reportFallback && reportYm" :selected="selPeriodLabel" :used="reportYm" source="报表" />

      <div v-if="hasBs && T && R" class="av2-grid">
        <!-- 双环 s4×2 -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">资产构成</span><span class="hint">期末 · 占资产总计 · 点扇区定位全表</span></div>
          <AnaEChart :option="assetOpt" :height="200" @chart-click="locateRow" />
          <div class="fin-legend">
            <div v-for="(d, i) in assetDonut" :key="d.label" class="ak-dl" style="font-size: var(--fs-micro)">
              <span class="dot" :style="{ background: sliceColor(i) }"></span><span class="nm">{{ d.label }}</span>
              <span class="pc">{{ ((d.value / T.totalAssets) * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </div>
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">负债与所有者权益</span><span class="hint">负债率 {{ R.debtRatio.toFixed(1) }}% · 点扇区定位全表</span></div>
          <AnaEChart :option="leOpt" :height="200" @chart-click="locateRow" />
          <div class="fin-legend">
            <div v-for="(d, i) in leDonut" :key="d.label" class="ak-dl" style="font-size: var(--fs-micro)">
              <span class="dot" :style="{ background: sliceColor(i) }"></span><span class="nm">{{ d.label }}</span>
              <span class="pc">{{ ((d.value / T.totalAssets) * 100).toFixed(0) }}%</span>
            </div>
          </div>
          <AnaMethodNote>为负的科目(如应交税费、未分配利润)不入环图,金额见下方全表。</AnaMethodNote>
        </div>

        <!-- 比率仪表 s4(spec:gauge ≤2;其余比率见 KPI 条与副行) -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h"><span class="t">关键比率仪表</span><span class="hint">偿债 · 杠杆</span></div>
          <AnaEChart :option="gaugeOpt" :height="200" />
          <div class="fin-gsub">
            权益乘数 {{ R.equityMult == null ? '—' : R.equityMult.toFixed(1) + '×' }} ·
            非流动资产占比 {{ R.ncShare.toFixed(0) }}% ·
            速动比率 {{ R.quick == null ? '—' : R.quick.toFixed(2) }}
          </div>
        </div>

        <!-- 杜邦拆解 s12(保留) -->
        <div class="av2-card av2-s12">
          <div class="av2-card-h">
            <span class="t">净资产收益率拆解:利润率 × 周转 × 杠杆(杜邦)</span>
            <!-- §C3:权益基数失真就地醒目(金额取运行时权益实值) -->
            <AnaPill v-if="R.roe != null && R.netMargin != null" tone="warn" icon="alert-triangle">权益仅 ¥{{ fint(T.equity / 1e4) }}万 · 杠杆放大,比率失真仅供参考</AnaPill>
            <span class="hint">ROE = 净利率 × 总资产周转率 × 权益乘数</span>
          </div>
          <div v-if="R.roe != null && R.netMargin != null" style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap">
            <div style="flex: 0 0 auto; text-align: center; padding: 14px 22px; background: var(--accent-blue); border-radius: 16px">
              <div style="font-size: 12px; color: var(--text-muted)">净资产收益率 ROE</div>
              <div style="font-size: var(--fs-display); font-weight: 600; font-family: var(--font-mono); color: var(--text-primary); letter-spacing: -0.02em">{{ (R.roe * 100).toFixed(1) }}%</div>
              <div style="font-size: 11px; color: var(--text-muted)">ROA {{ R.roa == null ? '—' : R.roa.toFixed(1) + '%' }}</div>
            </div>
            <span style="font-size: var(--fs-h2); color: var(--text-muted)">=</span>
            <template v-for="(f, i) in [
              { k: '净利率', v: R.netMargin.toFixed(1) + '%', note: '赚钱能力' },
              { k: '总资产周转率', v: (R.assetTurn ?? 0).toFixed(2) + '次', note: '资产效率' },
              { k: '权益乘数', v: R.equityMult == null ? '—' : R.equityMult.toFixed(1) + '×', note: '杠杆倍数' },
            ]" :key="f.k">
              <div style="flex: 1 1 120px; min-width: 110px; text-align: center; padding: 14px 16px; background: var(--surface-card); border-radius: 14px">
                <div style="font-size: var(--fs-micro); color: var(--text-muted)">{{ f.k }}</div>
                <div style="font-size: var(--fs-h2); font-weight: var(--fw-semibold); font-family: var(--font-mono); color: var(--text-primary)">{{ f.v }}</div>
                <div style="font-size: var(--fs-micro); color: var(--text-muted)">{{ f.note }}</div>
              </div>
              <span v-if="i < 2" style="font-size: var(--fs-h2); color: var(--text-muted)">×</span>
            </template>
          </div>
          <AnaEmpty v-else label="杜邦拆解不可算"
            :hint="T.equity <= 0 ? '所有者权益为非正数(未分配利润为负拖累权益基数),ROE 无意义' : '缺同期利润表快照(净利率/周转率取自 is)'" />
          <AnaMethodNote>单期快照口径:净利率/净利取利润表本年累计;周转率＝累计营业收入 ÷ 期末总资产(近似);
            非流动资产占比 {{ R.ncShare.toFixed(0) }}%,属重资产结构,ROE 数值另受权益基数(¥{{ fint(T.equity / 1e4) }}万)放大杠杆影响。</AnaMethodNote>
        </div>

        <!-- spec 必选空态:fin-balance 趋势卡 -->
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">资产负债趋势</span><span class="hint">期末 vs 年初 · ROE 走势</span></div>
          <AnaEmpty label="趋势数据待录入"
            :hint="'资产负债表当前仅 ' + (reportYm ?? '—') + ' 一期快照,无法呈现较年初变动与 ROE 走势;录入更多期间后自动点亮'"
            to="/balance-sheet" toText="去录入资产负债表" />
        </div>

        <!-- 快照全表 s12(保留) -->
        <div class="av2-card av2-s12">
          <div class="av2-card-h"><span class="t">资产负债表全表</span><span class="hint">{{ companyLabel }} · 期末 / 占资产总计 · 单位 万元</span></div>
          <table class="ak-tbl">
            <thead><tr><th>项目</th><th>期末</th><th>占资产总计</th></tr></thead>
            <tbody>
              <tr v-for="r in bsTable" :key="r.label" :data-bsrow="r.label"
                :class="{ 'fb-flash': flashLabel === r.label }"
                :style="r.kind === 'label' ? { background: 'var(--surface-card)' } : r.label.includes('总计') ? { background: 'var(--ink-050)' } : undefined">
                <td :style="{
                  fontWeight: r.kind === 'label' || r.kind === 'subtotal' ? 600 : 400,
                  paddingLeft: r.level ? '22px' : undefined,
                  color: r.level ? 'var(--text-secondary)' : 'var(--text-primary)',
                }">{{ r.label }}</td>
                <td class="mono" :style="{ fontWeight: r.kind === 'subtotal' ? 700 : 400 }">{{ r.v == null ? '' : fnum(r.v / 1e4, 1) }}</td>
                <td class="mono mut">{{ r.share == null ? '' : r.share.toFixed(1) + '%' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else-if="ready" class="av2-card">
        <AnaEmpty label="该公司该期无资产负债表数据" hint="在报表中心录入资产负债表后,此处呈现结构占比、关键比率与杜邦拆解"
          to="/balance-sheet" toText="去录入资产负债表" />
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
/* 点环扇区定位行:2s 高亮渐隐(样式同深链 row-flash 观感) */
.fb-flash td { animation: fbflash 2s ease-out; }
@keyframes fbflash { 0% { background: var(--accent-blue); } 100% { background: transparent; } }

/* 工具条标签 + v2 紧凑页头/图例(复刻 AnaShell .anx-lbl 观感) */
.fin-name { font-size: var(--fs-label); font-weight: var(--fw-semibold); color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.fin-lbl { font-size: var(--fs-micro); color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.fin-page { display: flex; flex-direction: column; gap: 10px; max-width: 1640px; margin: 0 auto; }
.fin-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.fin-head .sub { font-size: var(--fs-micro); color: var(--text-muted); }
.fin-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin-top: 10px; }
.fin-gsub { margin-top: 8px; font-size: var(--fs-micro); color: var(--text-muted); text-align: center; font-variant-numeric: tabular-nums; }
</style>
