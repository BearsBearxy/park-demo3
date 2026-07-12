<script setup lang="ts">
// 费用与报销(fin-expense)— spec 2026-07-12 §T1:附表5 全域费用分析(员工报销/办公类设专区)。
// KPI 6 瓦 + 主图 s8 四组堆叠柱+运营费用总计线(环比开=总计上月灰虚线 CMP_BASELINE)
// + s4 本期费用结构环 + 第二排 s4×3:科目Top10(条色随组)/环比异动榜(费用降是好事)/报销办公专区。
// 数据零新端点:fetchPnlYear('s5') 组带自带总计行不重算 + fetchPnlSummary 的 revenue(费用占收入比);
// 纯函数见 expense.logic.ts;期间口径同驾驶舱(atPeriod:月=当月,年=Σ;月锚回退横幅显式)。
import { computed, ref, watch } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaBarRow from '@/components/ana/AnaBarRow.vue'
import AnaPeriodBanner from '@/components/ana/AnaPeriodBanner.vue'
import { CMP_BASELINE, fnum, sgn } from '@/components/ana/anaFmt'
import { usePeriod, ymOf } from '@/analysis/usePeriod'
import { useCompare } from '@/analysis/useCompare'
import { fetchPnlSummary, fetchPnlYear, type PnlSummary } from '@/analysis/anaData'
import { anchorMonth, atPeriod, momOf } from './cockpit.logic'
import { addSeries, coveredMonths, extractGroups, momMovers, reimburse, topSubjects, wanSeries, REIMBURSE_KEYWORDS } from './expense.logic'
import type { PnlYearDTO } from '@/types/pnl'

const period = usePeriod()
const year = computed(() => period.sel.value.year)
const cmp = useCompare(['mom'])

// ── 取数(全走 anaData 缓存;年切重取,失败清空 → 空态,禁止旧年数值) ──
const s5 = ref<PnlYearDTO | null>(null)
const summary = ref<PnlSummary | null>(null)
const loading = ref(true)
watch(year, async (y) => {
  if (!y) return
  loading.value = true
  try {
    const [dto, sum] = await Promise.all([fetchPnlYear('s5', y), fetchPnlSummary(y)])
    s5.value = dto
    summary.value = sum
  } catch { s5.value = null; summary.value = null }
  finally { loading.value = false }
}, { immediate: true })

// ── 期间(§五策略2:所选月无附表5 → 锚定最近覆盖月 + 横幅显式) ──
const rows = computed(() => s5.value?.rows ?? [])
const groups = computed(() => extractGroups(rows.value))
const covered = computed(() => coveredMonths(groups.value))
const empty = computed(() => !covered.value.length)
const isMonth = computed(() => period.sel.value.gran === 'month')
const mi = computed(() => period.sel.value.month - 1)
const usedMi = computed(() => (isMonth.value ? anchorMonth(covered.value, mi.value + 1) - 1 : mi.value))
const usedYm = computed(() => (isMonth.value && usedMi.value !== mi.value ? ymOf(year.value, usedMi.value + 1) : null))

// ── KPI 6 瓦(期间取值同 atPeriod 口径) ──
const money = (v: number | null): string => (v == null ? '—' : (v < 0 ? '−¥' : '¥') + fnum(Math.abs(v) / 10000) + '万')
const total = computed(() => atPeriod(groups.value.total, isMonth.value, usedMi.value))
const admin = computed(() => atPeriod(groups.value.admin, isMonth.value, usedMi.value))
const sales = computed(() => atPeriod(groups.value.sales, isMonth.value, usedMi.value))
const finRepairSeries = computed(() => addSeries(groups.value.fin, groups.value.repair))
const finRepair = computed(() => atPeriod(finRepairSeries.value, isMonth.value, usedMi.value))
const reim = computed(() => reimburse(rows.value, isMonth.value, usedMi.value))
const revenue = computed(() => atPeriod(summary.value?.revenue, isMonth.value, usedMi.value))
// 费用占收入比:revenue 为 0 或 null → null → '—'(人话原则:分母 0 就地留白)
const expRatio = computed(() => (revenue.value && total.value != null ? (total.value / revenue.value) * 100 : null))
const reimShare = computed(() => (total.value && reim.value.sum != null ? (reim.value.sum / total.value) * 100 : null))

// ── 主图:四组堆叠柱 + 总计线(四色同驾驶舱 COMPO 策略;环比开=总计上月灰虚线) ──
const GROUP_DEFS = [
  { key: 'sales', name: '销售费用', color: '#378ADD' },
  { key: 'admin', name: '管理费用', color: '#5DCAA5' },
  { key: 'fin', name: '财务费用', color: '#EF9F27' },
  { key: 'repair', name: '修缮改造', color: '#F0997B' },
] as const
const mainOpt = computed<object>(() => {
  const g = groups.value
  const totalWan = wanSeries(g.total)
  const series: object[] = GROUP_DEFS.map((d) => ({
    name: d.name, type: 'bar', stack: 'exp', data: wanSeries(g[d.key]), barMaxWidth: 26, itemStyle: { color: d.color },
  }))
  series.push({
    name: '运营费用总计', type: 'line', data: totalWan, symbolSize: 5, connectNulls: true,
    itemStyle: { color: '#185FA5' }, lineStyle: { width: 2 },
  })
  if (cmp.mode.value === 'mom') {
    series.push({
      name: '总计(上月)', type: 'line', data: totalWan.map((_, i) => (i > 0 ? totalWan[i - 1] : null)), symbol: 'none',
      lineStyle: { type: 'dashed', width: 1.5, color: CMP_BASELINE }, itemStyle: { color: CMP_BASELINE },
    })
  }
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 56, right: 14, top: 32, bottom: 26 },
    xAxis: { type: 'category', data: Array.from({ length: 12 }, (_, i) => i + 1 + '月') },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
    series,
  }
})

// ── 本期费用结构环(图例带占比,同驾驶舱环样式) ──
const structItems = computed(() => GROUP_DEFS
  .map((d) => ({ name: d.name, color: d.color, value: atPeriod(groups.value[d.key], isMonth.value, usedMi.value) ?? 0 }))
  .filter((d) => d.value > 0))
const donutOpt = computed<object>(() => {
  const items = structItems.value
  const sum = items.reduce((s, d) => s + d.value, 0)
  // 显式 Map<string,…>:d.name 是 GROUP_DEFS 字面量联合,而 legend formatter 回调入参是宽 string
  const byName = new Map<string, number>(items.map((d) => [d.name, d.value]))
  return {
    color: items.map((d) => d.color),
    tooltip: { trigger: 'item', valueFormatter: (v: number) => '¥' + fnum(v) + '万' },
    legend: { bottom: 0, formatter: (name: string) => `${name} ${sum > 0 ? ((byName.get(name) ?? 0) / sum * 100).toFixed(1) : '0.0'}%` },
    series: [{
      type: 'pie', radius: ['50%', '74%'], center: ['50%', '42%'],
      label: { show: false }, itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      data: items.map((d) => ({ name: d.name, value: +(d.value / 10000).toFixed(2) })),
    }],
  }
})

// ── 科目 Top10 横条(本期金额降序,条色随组;修缮无明细行故只有三组色) ──
const GROUP_COLOR: Record<string, string> = { 销售费用: '#378ADD', 管理费用: '#5DCAA5', 财务费用: '#EF9F27' }
const tops = computed(() => topSubjects(rows.value, isMonth.value, usedMi.value, 10))
const topOpt = computed<object>(() => {
  const items = [...tops.value].reverse()   // ECharts 类目轴自下而上
  return {
    grid: { left: 8, right: 52, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => '¥' + fnum(v) + '万' },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: items.map((d) => d.label), axisLabel: { fontSize: 10, width: 108, overflow: 'truncate' } },
    series: [{
      type: 'bar', barMaxWidth: 13,
      data: items.map((d) => ({ value: +(d.value / 10000).toFixed(2), itemStyle: { color: GROUP_COLOR[d.group] ?? '#B5D4F4', borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', fontSize: 10, formatter: '{c}万' },
    }],
  }
})

// ── 环比异动榜(月=锚定月;年粒度取最近覆盖月并在卡头披露) ──
const moverMi = computed(() => (isMonth.value ? usedMi.value : (covered.value[covered.value.length - 1] ?? 1) - 1))
const movers = computed(() => momMovers(rows.value, moverMi.value, 8))
</script>

<template>
  <!-- §五:月敏感屏(full);月锚回退横幅 + 年空态见主区 -->
  <AnaShell period-mode="full" :compare="['mom']">
    <template #kpis>
      <!-- 年空/加载中不渲染 KPI(禁止旧年数值或假 0) -->
      <template v-if="!loading && !empty">
        <AnaKpiTile label="运营费用总计" :value="money(total)"
          :delta="momOf(groups.total, isMonth, usedMi)" kind="环比" invert :trend="groups.total" />
        <AnaKpiTile label="管理费用" :value="money(admin)" :trend="groups.admin" />
        <AnaKpiTile label="销售费用" :value="money(sales)" :trend="groups.sales" />
        <AnaKpiTile label="财务费用+修缮" :value="money(finRepair)" :trend="finRepairSeries" />
        <AnaKpiTile label="员工报销与办公" :value="reim.sum == null ? '—' : money(reim.sum)"
          :note="reimShare != null ? '占运营费用 ' + reimShare.toFixed(1) + '%' : undefined" />
        <AnaKpiTile label="费用占收入比" :value="expRatio == null ? '—' : expRatio.toFixed(1) + '%'"
          :note="expRatio == null ? '当期无收入数据' : '收入 ' + money(revenue)" />
      </template>
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <AnaEmpty v-else-if="empty" :label="year + ' 年附表5 无数据'"
      hint="费用分析依赖附表5 费用支出(销售/管理/财务/修缮 组带)" to="/expense-pnl" to-text="去录入附表5" />
    <template v-else>
      <AnaPeriodBanner v-if="usedYm && period.ym.value" :selected="period.ym.value" :used="usedYm"
        source="附表5" style="margin-bottom: 12px" />
      <div class="av2-grid">
        <!-- 主图 s8:月度费用构成 -->
        <div class="av2-card av2-s8">
          <div class="av2-card-h">
            <span class="t">月度费用构成 · {{ year }}年</span>
            <span class="hint">覆盖 {{ covered.length }} 期(万元)· 环比=总计上月虚线</span>
          </div>
          <AnaEChart :option="mainOpt" :height="298" />
        </div>

        <!-- s4:本期费用结构环 -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">费用结构 · {{ isMonth ? '本月' : '本年' }}</span>
            <span class="hint">合计 {{ money(total) }}</span>
          </div>
          <AnaEChart v-if="structItems.length" :option="donutOpt" :height="298" />
          <AnaEmpty v-else label="当期无费用数据" />
        </div>

        <!-- 第二排 s4×3 -->
        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">科目 Top10</span>
            <span class="hint">本期金额降序 · 条色随组 · 万元</span>
          </div>
          <AnaEChart v-if="tops.length" :option="topOpt" :height="260" />
          <AnaEmpty v-else label="当期无费用科目明细" />
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">环比异动 Top8</span>
            <span class="hint">{{ moverMi + 1 }}月 vs 上一有数月 · 费用降是好事</span>
          </div>
          <div v-if="movers.length" class="ex-movers">
            <div v-for="mv in movers" :key="mv.label" class="ex-mv">
              <span class="lb" :title="mv.label">{{ mv.label }}</span>
              <span class="amt">{{ money(mv.delta) }}</span>
              <!-- invert 语义:费用增=红 / 降=蓝 -->
              <span class="pct" :style="{ color: mv.pct >= 0 ? 'var(--hue-red)' : 'var(--hue-blue)' }">{{ sgn(mv.pct) }}</span>
            </div>
          </div>
          <AnaEmpty v-else label="当期无可比科目" hint="需当月与其前有数月均有值" />
        </div>

        <div class="av2-card av2-s4">
          <div class="av2-card-h">
            <span class="t">员工报销与办公</span>
            <span class="hint">关键词圈定 · 万元</span>
          </div>
          <template v-if="reim.items.length">
            <div class="ex-reim-sum">
              <span class="v">{{ money(reim.sum) }}</span>
              <span class="s">{{ reimShare != null ? '占运营费用 ' + reimShare.toFixed(1) + '%' : '' }}</span>
            </div>
            <div class="ak-bar-rows">
              <AnaBarRow v-for="it in reim.items.slice(0, 7)" :key="it.label" :name="it.label"
                :value="+(it.value / 10000).toFixed(2)" :max="+(reim.items[0].value / 10000).toFixed(2)"
                fill="#5DCAA5" suffix="万" />
            </div>
            <!-- 条形仅列前7,合计含全部命中科目——余量必须披露,否则条形与合计对不上账(复审①) -->
            <p v-if="reim.items.length > 7" class="ex-reim-more">
              另 {{ reim.items.length - 7 }} 个科目合计 {{ money(reim.items.slice(7).reduce((s, x) => s + x.value, 0)) }}
            </p>
          </template>
          <AnaEmpty v-else label="当期无报销办公类科目" />
        </div>

        <div class="av2-s12">
          <AnaMethodNote>
            口径:附表5 费用支出;销售/管理/财务/修缮与运营费用总计均取自带总计行(不重算明细);
            员工报销与办公类=科目名称命中关键词「{{ REIMBURSE_KEYWORDS }}」的明细行(小计/合计行不圈);
            费用占收入比分母=附表1-4 收入(为 0 或缺 → '—');缺月 null 不补 0。
          </AnaMethodNote>
        </div>
      </div>
    </template>
  </AnaShell>
</template>

<style scoped>
/* 环比异动榜(紧凑行:科目名弹性截断,金额/百分比 mono 右对齐) */
.ex-movers { display: flex; flex-direction: column; gap: 7px; }
.ex-mv { display: flex; align-items: center; gap: 8px; }
.ex-mv .lb { flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex-mv .amt { flex: 0 0 auto; font-size: 11.5px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.ex-mv .pct { flex: 0 0 auto; width: 64px; text-align: right; font-size: 11.5px; font-weight: var(--fw-semibold); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
/* 报销专区合计行 */
.ex-reim-sum { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.ex-reim-more { margin: 8px 0 0; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.ex-reim-sum .v { font-size: 17px; font-weight: 600; font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); }
.ex-reim-sum .s { font-size: 11px; color: var(--text-muted); }
</style>
