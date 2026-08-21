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
      axisLabel: { rotate: 38, fontSize: 11, formatter: (v: string) => (v.length > 6 ? v.slice(0, 6) + '…' : v) },
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

/* ---------- 到期墙(2026-07-12 实装:数据就绪后点亮时间轴) ---------- */

/** 入围状态:草稿/已到期/已退租不进墙。 */
const WALL_STATUS = new Set(['active', 'expiring'])

/** 'YYYY-MM-DD' → [y,m,d] 数值;拆分失败返回 null(new Date 解析字符串有 UTC 时区坑,一律手拆)。 */
function ymd(s: string): [number, number, number] | null {
  const [y, m, d] = s.split('-').map(Number)
  return y && m && d ? [y, m, d] : null
}

export interface ExpiryWallQuarter { label: string; rentSum: number; count: number }
export interface ExpiryWall { quarters: ExpiryWallQuarter[]; totalCount: number }

/** 到期墙:today 所在季度起未来 8 季逐季聚合到期月租与户数(endDate ≥ today 才进墙,按日期为准不信 status;8 季窗口外不计)。 */
export function buildExpiryWall(cs: ContractDTO[], today: Date): ExpiryWall {
  const ty = today.getFullYear(), tm = today.getMonth() + 1
  const todayKey = ty * 10000 + tm * 100 + today.getDate()
  const startQ = ty * 4 + Math.floor((tm - 1) / 3)   // 季度序号 = 年×4 + 季(0..3),跨年自然滚动
  const quarters: ExpiryWallQuarter[] = [...Array(8)].map((_, i) => {
    const qi = startQ + i
    return { label: `${Math.floor(qi / 4)}Q${qi % 4 + 1}`, rentSum: 0, count: 0 }
  })
  for (const c of cs) {
    if (!WALL_STATUS.has(c.status) || !c.endDate) continue
    const p = ymd(c.endDate)
    if (!p) continue
    const [y, m, d] = p
    if (y * 10000 + m * 100 + d < todayKey) continue   // 已过期不进墙
    const off = y * 4 + Math.floor((m - 1) / 3) - startQ
    if (off >= 8) continue                             // 窗口外(≥today 已保证 off≥0)
    quarters[off].rentSum += c.monthlyRent
    quarters[off].count++
  }
  return { quarters, totalCount: quarters.reduce((s, q) => s + q.count, 0) }
}

export interface ExpiringSoonRow {
  id: number; tenantName: string; contractNo: string
  monthlyRent: number; endDate: string; daysLeft: number
}

/** 临期清单:endDate ∈ [today, today+days] 闭区间,状态口径同到期墙,按 endDate 升序。 */
export function buildExpiringSoon(cs: ContractDTO[], today: Date, days = 90): ExpiringSoonRow[] {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())   // 归零到本地零点,天数才数得准
  const limit = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + days)
  const k0 = t0.getFullYear() * 10000 + (t0.getMonth() + 1) * 100 + t0.getDate()
  const k1 = limit.getFullYear() * 10000 + (limit.getMonth() + 1) * 100 + limit.getDate()
  const rows: ExpiringSoonRow[] = []
  for (const c of cs) {
    if (!WALL_STATUS.has(c.status) || !c.endDate) continue
    const p = ymd(c.endDate)
    if (!p) continue
    const [y, m, d] = p
    const k = y * 10000 + m * 100 + d
    if (k < k0 || k > k1) continue
    const daysLeft = Math.round((new Date(y, m - 1, d).getTime() - t0.getTime()) / 86400000)   // round 吸收 DST 时差
    rows.push({ id: c.id, tenantName: c.tenantName, contractNo: c.contractNo, monthlyRent: c.monthlyRent, endDate: c.endDate, daysLeft })
  }
  return rows.sort((a, b) => a.endDate.localeCompare(b.endDate))
}

/** 到期墙柱图 option(柱=每季到期月租折万,tooltip 含户数;样式对齐 paretoOption)。 */
export function wallOption(w: ExpiryWall): object {
  return {
    grid: { left: 48, right: 16, top: 26, bottom: 26 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps: { name: string; value: number; dataIndex: number }[]) =>
        `${ps[0].name}<br/>¥${ps[0].value}万 · ${w.quarters[ps[0].dataIndex].count} 份合同`,
    },
    xAxis: { type: 'category', data: w.quarters.map((q) => q.label), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '万/月', axisLabel: { formatter: (v: number) => String(v) } },
    series: [{
      name: '到期月租', type: 'bar', barWidth: '55%',
      itemStyle: { color: '#378ADD', borderRadius: [3, 3, 0, 0] },
      data: w.quarters.map((q) => +(q.rentSum / 10000).toFixed(2)),
    }],
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
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },   // 圆角环形+白缝(数据项 color 逐片合并仍生效)
      data: [
        { name: 'Top10 合同', value: top10Sum, itemStyle: { color: '#378ADD' } },
        { name: '其余合同', value: rest, itemStyle: { color: '#B5D4F4' } },
      ],
    }],
  }
}
