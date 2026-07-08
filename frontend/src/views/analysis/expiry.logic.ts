// src/views/analysis/expiry.logic.ts — expiry 屏纯数据变换(v2 抽出,口径与 v1 一致,数值不变):
// 合同快照统计 / 金额 Pareto(TopN 柱 + 累计占比线)/ Top10 集中度环 — ECharts option 纯函数。
// 锚点(2026-07-08 dev 库):合同 282 份、月租合计 4,671,702.21、有租金 235、日期缺失 282、Top10 55.8%。
import { quantile } from '@/components/ana/anaFmt'
import type { ContractDTO } from '@/types/contract'

export interface ExpiryStats {
  total: number
  rentSum: number
  withRent: number
  zeroRent: number
  medRent: number
  dateMissing: number
  top10Sum: number
  top10Pct: number
}

/** 合同快照统计(v1 ExpiryView stats computed 原样抽出)。 */
export function buildExpiryStats(cs: ContractDTO[]): ExpiryStats | null {
  if (!cs.length) return null
  const rentSum = cs.reduce((s, c) => s + c.monthlyRent, 0)
  const withRent = cs.filter((c) => c.monthlyRent > 0)
  const dateMissing = cs.filter((c) => !c.startDate && !c.endDate).length
  const top10 = [...cs].sort((a, b) => b.monthlyRent - a.monthlyRent).slice(0, 10)
  const top10Sum = top10.reduce((s, c) => s + c.monthlyRent, 0)
  return {
    total: cs.length,
    rentSum,
    withRent: withRent.length,
    zeroRent: cs.length - withRent.length,
    medRent: quantile(withRent.map((c) => c.monthlyRent), 0.5),
    dateMissing,
    top10Sum,
    top10Pct: rentSum > 0 ? +(top10Sum / rentSum * 100).toFixed(1) : 0,
  }
}

export interface ParetoData {
  tenants: string[]     // TopN 租户名(点柱→清单展开联动用)
  ids: number[]         // TopN 合同 id
  rents: number[]       // 月租金(元)
  cumPct: number[]      // 累计占全部合同月租合计 %
}

/** 合同金额 Pareto:按月租降序 TopN,累计占比对全量 rentSum。 */
export function buildPareto(cs: ContractDTO[], topN = 20): ParetoData {
  const total = cs.reduce((s, c) => s + c.monthlyRent, 0)
  const top = [...cs].sort((a, b) => b.monthlyRent - a.monthlyRent).slice(0, topN)
  let acc = 0
  const cumPct = top.map((c) => {
    acc += c.monthlyRent
    return total > 0 ? +(acc / total * 100).toFixed(1) : 0
  })
  return { tenants: top.map((c) => c.tenantName), ids: top.map((c) => c.id), rents: top.map((c) => c.monthlyRent), cumPct }
}

/** Pareto 柱线双轴 option(柱=月租金万、线=累计占比%)。 */
export function paretoOption(p: ParetoData): object {
  return {
    grid: { left: 48, right: 46, top: 30, bottom: 64 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps: { name: string; seriesName: string; value: number }[]) =>
        ps[0].name + ps.map((x) => `<br/>${x.seriesName} ${x.seriesName === '累计占比' ? x.value + '%' : '¥' + x.value.toFixed(1) + '万'}`).join(''),
    },
    legend: { top: 0, data: ['月租金', '累计占比'] },
    xAxis: {
      type: 'category', data: p.tenants,
      axisLabel: { rotate: 38, fontSize: 10, formatter: (v: string) => (v.length > 6 ? v.slice(0, 6) + '…' : v) },
    },
    yAxis: [
      { type: 'value', name: '万/月', axisLabel: { formatter: (v: number) => String(v) } },
      { type: 'value', min: 0, max: 100, splitLine: { show: false }, axisLabel: { formatter: '{value}%' } },
    ],
    series: [
      { name: '月租金', type: 'bar', barWidth: '55%', itemStyle: { color: '#378ADD', borderRadius: [3, 3, 0, 0] }, data: p.rents.map((r) => +(r / 10000).toFixed(2)) },
      { name: '累计占比', type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2, color: '#EF9F27' }, itemStyle: { color: '#EF9F27' }, data: p.cumPct },
    ],
  }
}

/** Top10 集中度环(Top10 vs 其余,值=月租金元;tooltip 折万)。 */
export function concentrationOption(top10Sum: number, rentSum: number): object {
  const rest = Math.max(0, rentSum - top10Sum)
  return {
    tooltip: { formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>¥${(p.value / 10000).toFixed(1)}万/月 · ${p.percent}%` },
    series: [{
      type: 'pie', radius: ['58%', '80%'], center: ['50%', '50%'],
      label: { show: false }, labelLine: { show: false },
      data: [
        { name: 'Top10 合同', value: top10Sum, itemStyle: { color: '#378ADD' } },
        { name: '其余合同', value: rest, itemStyle: { color: '#B5D4F4' } },
      ],
    }],
  }
}
