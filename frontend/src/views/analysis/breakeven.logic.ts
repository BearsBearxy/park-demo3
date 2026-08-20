// src/views/analysis/breakeven.logic.ts — breakeven 屏纯数据变换(v2 抽出,口径与 v1 一致,数值不变):
// CVP 模型(固定/变动拆分系数假设)+ ECharts option(CVP 线 markPoint 保本/markArea 盈利区、
// 敏感性龙卷风横条、固定/变动逐月堆叠)。锚点(2026-07-08 dev 库,2025-10):rev 9,301,530.81 / cost 6,142,810.17。
import type { AnalysisS10Row } from '@/api/analysis'
import { fnum } from '@/components/ana/anaFmt'

export interface BeModel {
  rev: number; cost: number
  fr: number               // 固定成本占比(0~1,夹紧后)
  fixed: number; vari: number
  varRate: number; cm: number   // 变动成本率 / 边际贡献率
  beRev: number | null     // 保本收入(元)
  bePct: number | null     // 保本收入 / 当月收入 %
  safety: number | null    // 安全边际 pt
  profit: number
}

/** CVP 模型(v1 BreakevenView be computed 原样抽出;frRaw 内部夹紧 0~1)。 */
export function calcBe(rev: number, cost: number, frRaw: number): BeModel {
  const fr = Math.min(1, Math.max(0, frRaw))
  const fixed = cost * fr
  const vari = cost - fixed
  const varRate = rev > 0 ? vari / rev : 0
  const cm = 1 - varRate
  const beRev = cm > 0 ? fixed / cm : null
  const bePct = rev > 0 && beRev != null ? +(beRev / rev * 100).toFixed(1) : null
  return { rev, cost, fr, fixed, vari, varRate, cm, beRev, bePct, safety: bePct != null ? +(100 - bePct).toFixed(1) : null, profit: rev - cost }
}

export interface BeAnchor { month: number | null; allNegative: boolean }

/** §C4 口径月锚:选中月有覆盖 → 不动;否则退最近一个收入>0 的覆盖月(原退「最新覆盖月」会落负收入月,
 *  CVP 收入线倒挂);全负 → 维持最新覆盖月并标记 allNegative(主区空态提示)。months 为升序覆盖月号 1-12。 */
export function anchorMonth(months: number[], revenue: (number | null)[], selected: number | null): BeAnchor {
  if (!months.length) return { month: null, allNegative: false }
  if (selected != null && months.includes(selected)) return { month: selected, allNegative: false }
  for (let i = months.length - 1; i >= 0; i--) {
    if ((revenue[months[i] - 1] ?? 0) > 0) return { month: months[i], allNegative: false }
  }
  return { month: months[months.length - 1], allNegative: true }
}

/** §C4 人话结论行(数据模板,spec 定稿):保本有解给保本线+口径月达成度;无解(bePct=null)给替代句。 */
export function conclusionText(be: BeModel, ym: string): string {
  if (be.bePct == null || be.beRev == null) return '当前口径月收入为负,保本点不适用——见期间横幅'
  return `按当前成本结构,月收入 ≥ ¥${fnum(be.beRev / 10000)}万 即保本;口径月(${ym})收入 ¥${fnum(be.rev / 10000)}万,达成 ${(be.rev / be.beRev * 100).toFixed(0)}%`
}

export interface S10Used { ym: string; total: number; elec: number; water: number }

/** s10 开票收入(口径月缺 → 退最新 s10 月;v1 原样抽出)。 */
export function s10UsedOf(rows: AnalysisS10Row[], ymUsed: string | null): S10Used | null {
  if (!rows.length || !ymUsed) return null
  const months = [...new Set(rows.map((r) => r.acctMonth))].sort()
  const ym = months.includes(ymUsed) ? ymUsed : months[months.length - 1]
  let total = 0, elec = 0, water = 0
  for (const r of rows) {
    if (r.acctMonth !== ym) continue
    total += r.total; elec += r.elec; water += r.water
  }
  return { ym, total, elec, water }
}

export interface TornadoItem { name: string; delta: number }

/** 龙卷风敏感性:各驱动 ±10% 对月净利影响(万元,v1 口径)。 */
export function tornadoItems(be: BeModel, s10Used: S10Used | null): TornadoItem[] {
  const items: TornadoItem[] = [
    { name: '营业收入', delta: 0.10 * be.rev * be.cm / 10000 },
    { name: '变动成本', delta: 0.10 * be.vari / 10000 },
    { name: '固定成本', delta: 0.10 * be.fixed / 10000 },
  ]
  if (s10Used) {
    items.push({ name: '电费收入(s10)', delta: 0.10 * s10Used.elec * be.cm / 10000 })
    items.push({ name: '水费收入(s10)', delta: 0.10 * s10Used.water * be.cm / 10000 })
  }
  return items.sort((a, b) => b.delta - a.delta)
}

const INK = '#185FA5', RED = '#E24B4A', WARN = '#EF9F27', BLUE = '#378ADD', SLATE = 'rgba(28,28,28,.4)'   // 复审:统一主题语义红/墨灰
const wan0 = (v: number) => (v / 10000).toFixed(0) + '万'

/** CVP 线:x=收入达成率 0~120%,收入/总成本两线;markPoint 保本点、markArea 盈利区、markLine 当前 100%。 */
export function cvpOption(be: BeModel): object {
  const revPts: [number, number][] = [], costPts: [number, number][] = []
  for (let x = 0; x <= 120; x += 10) {
    revPts.push([x, be.rev * x / 100])
    costPts.push([x, be.fixed + be.varRate * be.rev * x / 100])
  }
  const showBe = be.bePct != null && be.bePct <= 120 && be.beRev != null
  return {
    grid: { left: 58, right: 24, top: 36, bottom: 34 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: { seriesName: string; value: [number, number] }[]) =>
        `达成率 ${ps[0].value[0]}%` + ps.map((p) => `<br/>${p.seriesName} ¥${(p.value[1] / 10000).toFixed(1)}万`).join(''),
    },
    legend: { top: 0, data: ['收入', '总成本'] },
    xAxis: { type: 'value', min: 0, max: 120, interval: 20, axisLabel: { formatter: '{value}%' }, name: '收入达成率', nameLocation: 'middle', nameGap: 24 },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => wan0(v) } },
    series: [
      {
        name: '收入', type: 'line', data: revPts, showSymbol: false,
        lineStyle: { width: 2.4, color: INK }, itemStyle: { color: INK },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: 'rgba(28,28,28,.45)', width: 1 },
          label: { fontSize: 11, color: 'rgba(28,28,28,.62)', formatter: '当前 100%' },
          data: [{ xAxis: 100 }],
        },
        ...(showBe ? {
          markPoint: {
            symbol: 'pin', symbolSize: 44, itemStyle: { color: WARN },
            label: { fontSize: 11, color: '#fff', formatter: `保本\n${be.bePct!.toFixed(0)}%` },
            data: [{ coord: [be.bePct, be.beRev] }],
          },
          markArea: {
            silent: true, itemStyle: { color: 'rgba(93,202,165,.10)' },
            label: { show: true, position: 'insideTop', color: 'rgba(28,28,28,.45)', fontSize: 11, formatter: '盈利区' },
            data: [[{ xAxis: be.bePct }, { xAxis: 120 }]],
          },
        } : {}),
      },
      { name: '总成本', type: 'line', data: costPts, showSymbol: false, lineStyle: { width: 2.2, color: RED }, itemStyle: { color: RED } },
    ],
  }
}

/** 龙卷风横条:红=下行(取负)、蓝=上行,同类目对称;类目倒序(影响最大在顶)。 */
export function tornadoOption(items: TornadoItem[]): object {
  const rev = [...items].reverse()
  return {
    grid: { left: 96, right: 56, top: 30, bottom: 26 },
    tooltip: {
      formatter: (p: { name: string; value: number }) => `${p.name}<br/>±10% → 净利 ±¥${Math.abs(p.value).toFixed(1)}万`,
    },
    legend: { top: 0, data: ['净利 ↓(−10%)', '净利 ↑(+10%)'] },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => Math.abs(v) + '万' } },
    yAxis: { type: 'category', data: rev.map((i) => i.name), axisLabel: { fontSize: 11 } },
    series: [
      { name: '净利 ↓(−10%)', type: 'bar', stack: 'tor', barWidth: '52%', itemStyle: { color: RED, borderRadius: [3, 0, 0, 3] }, data: rev.map((i) => -+i.delta.toFixed(1)) },
      {
        name: '净利 ↑(+10%)', type: 'bar', stack: 'tor', itemStyle: { color: BLUE, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', fontSize: 11, color: 'rgba(28,28,28,.62)', formatter: (p: { value: number }) => '¥' + p.value.toFixed(1) + '万' },
        data: rev.map((i) => +i.delta.toFixed(1)),
      },
    ],
  }
}

export interface SplitData { periods: string[]; fixed: number[]; vari: number[] }

/** 固定/变动成本拆分逐月(万元,v1 口径:成本×系数)。 */
export function splitData(months: number[], cost: (number | null)[], fr: number): SplitData {
  const costs = months.map((m) => (cost[m - 1] ?? 0) / 10000)
  return {
    periods: months.map((m) => m + '月'),
    fixed: costs.map((c) => +(c * fr).toFixed(1)),
    vari: costs.map((c) => +(c * (1 - fr)).toFixed(1)),
  }
}

/** 固定/变动逐月堆叠柱 option。 */
export function splitOption(d: SplitData): object {
  return {
    grid: { left: 48, right: 16, top: 30, bottom: 26 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps: { name: string; seriesName: string; value: number }[]) =>
        ps[0].name + ps.map((p) => `<br/>${p.seriesName} ¥${p.value.toFixed(1)}万`).join(''),
    },
    legend: { top: 0, data: ['固定成本', '变动成本'] },
    xAxis: { type: 'category', data: d.periods },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}万' } },
    series: [
      { name: '固定成本', type: 'bar', stack: 'c', barWidth: '46%', itemStyle: { color: SLATE }, data: d.fixed },
      { name: '变动成本', type: 'bar', stack: 'c', itemStyle: { color: BLUE, borderRadius: [3, 3, 0, 0] }, data: d.vari },
    ],
  }
}
