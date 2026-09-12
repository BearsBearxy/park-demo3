<script setup lang="ts">
// 光伏投资回收(pv-roi)v2 — spec §二.14:累计收益爬坡线 + 投资额 markLine(交点=预估回收点
// markPoint 标注)+ 回收进度条 + 分期收益柱(点柱→该期月度明细卡)。
// 数据 = pv_record 全月份(fetchPvAll,口径与 v1 一致);投资额=「目标与阈值」pvInvestment(万,localStorage)。
// 分栋抄表分析已独立成屏(pv-meter-analysis,PV-ANALYSIS-SPEC §00):本屏只留附表6 口径的投资回收。
// 数据变换纯函数抽于 pvRoi.logic.ts(单测)。
import { computed, onMounted, ref } from 'vue'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import AnaKpiTile from '@/components/ana/AnaKpiTile.vue'
import { fetchPvAll, fetchPvPhases } from '@/analysis/anaData'
import { anaSettings } from '@/analysis/anaSettings'
import { finWan } from '@/utils/finFmt'
import { fnum } from '@/components/ana/anaFmt'
import type { PvPhaseDTO, PvRecordDTO } from '@/types/pv'
import { buildRamp, cumSeries, phaseMonthly, phaseSummaries } from './pvRoi.logic'

const phases = ref<PvPhaseDTO[]>([])
const records = ref<PvRecordDTO[]>([])
const loading = ref(true)
onMounted(async () => {
  try {
    ;[phases.value, records.value] = await Promise.all([fetchPvPhases(), fetchPvAll()])
    selPhase.value = phaseSummaries(phases.value, records.value).find((x) => x.months)?.p.id ?? ''
  } finally {
    loading.value = false
  }
})

const invest = computed(() => anaSettings.pvInvestment * 10000) // 设置为万元 → 元

// ── 分期汇总(v1 rows 同口径)+ 全园合计 ──
const rows = computed(() => phaseSummaries(phases.value, records.value))
const tot = computed(() => {
  const cum = rows.value.reduce((a, x) => a + x.cum, 0)
  const annual = rows.value.reduce((a, x) => a + x.annual, 0)
  return {
    cum, annual,
    selfAmt: rows.value.reduce((a, x) => a + x.selfAmt, 0),
    recovery: invest.value ? cum / invest.value : 0,
    payback: annual ? invest.value / annual : null, // 预估回收周期(年)
  }
})
const rpct = (x: number): string => (x * 100).toFixed(1) + '%'
const onlineLabel = (p: PvPhaseDTO): string => (p.online ? p.online.replace('-', '年') + '月并网' : '并网月未录')

// ── 爬坡线 + 投资额 markLine + 预估回收点 markPoint ──
const cumPts = computed(() => cumSeries(records.value))
const ramp = computed(() => buildRamp(cumPts.value, tot.value.annual / 12, invest.value))
const hitYm = computed(() => (ramp.value.hitIdx != null ? ramp.value.labels[ramp.value.hitIdx] : null))
const rampOpt = computed<object>(() => {
  const r = ramp.value
  const investW = invest.value / 1e4
  const w = (a: (number | null)[]): (number | null)[] => a.map((v) => (v == null ? null : +(v / 1e4).toFixed(1)))
  const actualW = w(r.actual), projW = w(r.projected)
  const markPoint = r.hitIdx != null
    ? {
        symbol: 'pin', symbolSize: 42, itemStyle: { color: '#185FA5' },
        label: { formatter: '回收', color: '#fff', fontSize: 11 },
        data: [{ coord: [r.hitIdx, (actualW[r.hitIdx] ?? projW[r.hitIdx]) as number] }],
      }
    : undefined
  const yMax = Math.max(investW * 1.1, ...actualW.map((v) => v ?? 0), ...projW.map((v) => v ?? 0))
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 56, right: 60, top: 32, bottom: 26 },
    xAxis: { type: 'category', data: r.labels },
    yAxis: { type: 'value', max: Math.ceil(yMax), axisLabel: { formatter: '{value} 万' } },
    series: [
      {
        name: '累计收益', type: 'line', data: actualW, symbol: 'circle', symbolSize: 4,
        itemStyle: { color: '#378ADD' }, lineStyle: { width: 2 }, areaStyle: { color: 'rgba(55,138,221,.08)' },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: '#E24B4A', width: 1.5 },
          // 图表清晰化 §1:标签画在绘图区内,不许被图边裁切(默认 end 落图外右缘被裁,同 CockpitView 预算线)
          label: { position: 'insideEndTop', formatter: '投资额 ' + fnum(investW, 0) + ' 万', fontSize: 11, color: '#E24B4A' },
          data: [{ yAxis: investW }],
        },
        markPoint: r.hitIdx != null && actualW[r.hitIdx] != null ? markPoint : undefined,
      },
      {
        name: '外推(年化口径)', type: 'line', data: projW, symbol: 'none',
        lineStyle: { type: 'dashed', width: 1.5, color: '#85B7EB' }, itemStyle: { color: '#85B7EB' },
        markPoint: r.hitIdx != null && actualW[r.hitIdx] == null ? markPoint : undefined,
      },
    ],
  }
})

// ── 分期收益柱(点柱→选中该期,右侧月度明细卡联动) ──
const selPhase = ref('')
const phaseOpt = computed<object>(() => {
  const rs = rows.value
  const dim = (i: number): number => (rs[i].p.id === selPhase.value ? 1 : 0.45)
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? '¥' + fnum(v, 1) + '万' : '—') },
    legend: { top: 0 },
    grid: { left: 56, right: 14, top: 32, bottom: 26 },
    xAxis: { type: 'category', data: rs.map((x) => x.p.name) },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} 万' } },
    series: [
      {
        name: '自消纳', type: 'bar', stack: 'fee', barMaxWidth: 46,
        data: rs.map((x, i) => ({ value: +(x.selfAmt / 1e4).toFixed(1), itemStyle: { color: '#378ADD', opacity: dim(i) } })),
      },
      {
        name: '上网', type: 'bar', stack: 'fee',
        data: rs.map((x, i) => ({ value: +(x.gridAmt / 1e4).toFixed(1), itemStyle: { color: '#B5D4F4', opacity: dim(i) } })),
      },
    ],
  }
})
function onPhaseClick(params: unknown): void {
  const i = (params as { dataIndex?: number }).dataIndex
  if (i != null && rows.value[i]) selPhase.value = rows.value[i].p.id
}
const selRow = computed(() => rows.value.find((x) => x.p.id === selPhase.value) ?? null)
const selMonthly = computed(() => (selRow.value ? phaseMonthly(records.value, selRow.value.p.id) : []))
const wan2 = (v: number): string => fnum(v / 1e4, 2)

</script>

<template>
  <!-- §五:期间无关屏(全周期累计,pv_record 全月份),隐期间控件显口径徽章 -->
  <AnaShell period-mode="none" scope-chip="全周期累计">
    <template #kpis>
      <AnaKpiTile label="工程总投资（含税）" :value="finWan(invest)" note="右上「目标与阈值」设置" />
      <AnaKpiTile label="累计电费收益" :value="finWan(tot.cum)" :note="cumPts.length + ' 个记账月'" />
      <AnaKpiTile label="综合回收进度" :value="rpct(tot.recovery)" note="= 累计收益 ÷ 总投资" />
      <AnaKpiTile label="年化电费收益" :value="finWan(tot.annual)" note="按各期已记账月折算" />
      <AnaKpiTile label="预估回收周期" :value="tot.payback ? tot.payback.toFixed(1) + ' 年' : '—'"
        :note="hitYm ? '预估回收点 ' + hitYm : '按年化外推'" />
    </template>

    <div v-if="loading" class="page-loading"><span class="page-spin" /></div>
    <div v-else class="roi2-page">
      <!-- 空态:附表6 无任何记账月 → 深链录入屏,不画假图 -->
      <AnaEmpty
        v-if="!records.length"
        label="光伏收益数据待录入"
        hint="附表6 尚无逐月自消纳 / 上网电费记录,无法计算累计收益与回收进度"
        to="/pv-income"
        to-text="去录入光伏收益"
      />

      <template v-else>
        <div class="av2-grid">
          <!-- 主图 span8:累计收益爬坡 + 投资额 markLine + 预估回收点 -->
          <div class="av2-card av2-s8">
            <div class="av2-card-h">
              <span class="t">累计收益爬坡 vs 工程总投资</span>
              <span class="hint">实线=已记账 · 虚线=按年化外推{{ hitYm ? ' · 预估回收点 ' + hitYm : '' }} · 万元</span>
            </div>
            <AnaEChart :option="rampOpt" :height="300" />
          </div>

          <!-- span4:回收进度条 -->
          <div class="av2-card av2-s4">
            <div class="av2-card-h"><span class="t">成本回收进度</span><span class="hint">全园合计口径</span></div>
            <div class="roi2-big">{{ rpct(tot.recovery) }}</div>
            <div class="roi2-bar"><div class="roi2-bar-fill" :style="{ width: (Math.min(1, tot.recovery) * 100).toFixed(1) + '%' }"></div></div>
            <div class="roi2-rows">
              <div class="r"><span class="k">累计电费收益</span><span class="v">{{ finWan(tot.cum) }}</span></div>
              <div class="r"><span class="k">其中 自消纳</span><span class="v">{{ finWan(tot.selfAmt) }}</span></div>
              <div class="r"><span class="k">其中 上网</span><span class="v">{{ finWan(tot.cum - tot.selfAmt) }}</span></div>
              <div class="r"><span class="k">预估回收周期</span><span class="v">{{ tot.payback ? tot.payback.toFixed(1) + ' 年' : '—' }}</span></div>
            </div>
          </div>

          <!-- 第二排 span8:分期收益柱(点柱→明细卡) -->
          <div class="av2-card av2-s8">
            <div class="av2-card-h"><span class="t">分期收益(自消纳 + 上网)</span><span class="hint"><span class="hint-desk">点击柱子查看该期月度明细</span></span></div>
            <AnaEChart :option="phaseOpt" :height="300" @chart-click="onPhaseClick" />
          </div>

          <!-- span4:选中期月度明细卡 -->
          <div class="av2-card av2-s4">
            <div class="av2-card-h">
              <span class="t">{{ selRow ? selRow.p.name + ' · 月度明细' : '月度明细' }}</span>
              <span v-if="selRow" class="hint">{{ onlineLabel(selRow.p) }} · {{ selRow.months }} 个月</span>
            </div>
            <template v-if="selRow && selMonthly.length">
              <div class="roi2-sel">
                <span>累计 <b>{{ finWan(selRow.cum) }}</b></span>
                <span>年化 <b>{{ finWan(selRow.annual) }}</b></span>
                <span>占全园 <b>{{ rpct(selRow.share) }}</b></span>
              </div>
              <div class="roi2-tblwrap">
                <table class="ak-tbl">
                  <thead><tr><th>记账月</th><th>自消纳(万)</th><th>上网(万)</th><th>合计(万)</th></tr></thead>
                  <tbody>
                    <tr v-for="m in selMonthly" :key="m.ym">
                      <td class="mono">{{ m.ym }}</td>
                      <td class="mono mut">{{ wan2(m.selfAmt) }}</td>
                      <td class="mono mut">{{ wan2(m.gridAmt) }}</td>
                      <td class="mono">{{ wan2(m.fee) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <AnaEmpty v-else label="该期暂无记账月" hint="点击左侧柱子切换期别,或到附表6 录入"
              to="/pv-income" to-text="去录入光伏收益" />
          </div>
        </div>

      </template>

    </div>
  </AnaShell>
</template>

<style scoped>
.roi2-page { display: flex; flex-direction: column; gap: 10px; width: 100%; min-height: 0; box-sizing: border-box; }

/* 回收进度卡 */
.roi2-big { font-size: var(--fs-display); font-weight: var(--fw-semibold); font-family: var(--font-mono); color: var(--hue-blue); letter-spacing: -0.02em; }
.roi2-bar { height: 8px; border-radius: var(--radius-full); background: var(--ink-100); overflow: hidden; margin: 10px 0 14px; }
.roi2-bar-fill { height: 100%; border-radius: var(--radius-full); background: var(--hue-blue); }
.roi2-rows { display: flex; flex-direction: column; gap: 8px; }
.roi2-rows .r { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.roi2-rows .k { font-size: var(--fs-micro); color: var(--text-muted); }
.roi2-rows .v { font-size: var(--fs-label); font-weight: var(--fw-semibold); font-family: var(--font-mono); color: var(--text-primary); }

/* 选中期摘要 + 明细表 */
.roi2-sel { display: flex; gap: 12px; flex-wrap: wrap; font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 8px; }
.roi2-sel b { font-family: var(--font-mono); color: var(--text-primary); font-weight: var(--fw-semibold); }
.roi2-tblwrap { max-height: 210px; overflow: auto; }

</style>
