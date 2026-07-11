// fin-pnl v2 纯函数(spec §二.7):瀑布=透明垫底柱技法、点级切换的科目 12 月序列、
// 环比=上期虚线叠加、预算=budget_row 当年值/12 虚线。单测 finPnl.logic.spec.ts。
// ECharts option 为纯 JSON 构建(canvas 内无法用 CSS 变量 → 取 fpAnaTheme 字面色)。
import type { PnlSummary } from '@/analysis/anaData'
import { matchBudgetKey, type BudgetKey } from '@/analysis/budget'
import type { BudgetRowDTO } from '@/api/budget'
import { CMP_BASELINE, CMP_BUDGET, fnum } from '@/components/ana/anaFmt'

export interface WfItem { name: string; value: number; type: 'start' | 'end' | 'inc' | 'dec' }

const C_POS = '#378ADD'   // 加项/起点(蓝)
const C_NEG = '#E24B4A'   // 减项(语义红)
const C_END = '#185FA5'   // 终点(深蓝)
const wanTip = (v: number): string => '¥' + fnum(v, 1) + '万'

/** 瀑布垫底柱分解:pad=该柱底部累计,bar=|value|(fin-pnl / fin-cashflow 共用;导出供单测)。 */
export function waterfallParts(items: WfItem[]): { pads: number[]; bars: number[] } {
  const pads: number[] = [], bars: number[] = []
  let run = 0
  for (const it of items) {
    if (it.type === 'start' || it.type === 'end') {
      pads.push(0); bars.push(it.value)
      run = it.value
    } else {
      // inc:垫到当前累计;dec:垫到扣减后的新低位(value 为负)
      pads.push(it.type === 'inc' ? run : run + it.value)
      bars.push(Math.abs(it.value))
      run += it.value
    }
  }
  return { pads, bars }
}

/** 瀑布 ECharts option(透明垫底柱;第二系列可点击,name=科目)。 */
export function waterfallOption(items: WfItem[], height?: { barWidth?: string }): object {
  const { pads, bars } = waterfallParts(items)
  return {
    grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        const it = items[i]
        return it ? `${it.name}<br/>${it.value < 0 ? '−' : ''}${wanTip(Math.abs(it.value))}` : ''
      },
    },
    xAxis: { type: 'category', data: items.map((it) => it.name), axisLabel: { interval: 0 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fnum(v, 0) } },
    series: [
      // 垫底柱:透明 + silent(不响应点击/悬浮)
      { type: 'bar', stack: 'wf', silent: true, itemStyle: { color: 'transparent' }, data: pads, barWidth: height?.barWidth ?? '52%' },
      {
        type: 'bar', stack: 'wf', cursor: 'pointer',
        data: bars.map((v, i) => ({
          value: v,
          name: items[i].name,
          itemStyle: { color: items[i].type === 'dec' ? C_NEG : items[i].type === 'end' ? C_END : C_POS, borderRadius: 3 },
        })),
        label: {
          show: true, position: 'top', fontSize: 10, color: 'rgba(28,28,28,.62)',
          formatter: (p: { dataIndex: number }) => {
            const it = items[p.dataIndex]
            return (it.value < 0 ? '−' : '') + fnum(Math.abs(it.value), 0)
          },
        },
      },
    ],
  }
}

// ── 迷你利润表链条(spec 2026-07-11 §C:收入−成本=毛利−费用=营业利润→净利润) ──
// 期间费用=毛利−营业利润 差额口径(税金及附加/三费均在其中);value=元,负值由渲染层标红。
export interface PnlChainNode { label: string; value: number; pct: number | null; kind: 'pos' | 'neg' | 'sub' }

/** is 快照 → 链条节点(pct=占营业收入%;rev=0 → 全部 null,数值仍成链)。 */
export function pnlChain(snap: { rev: number; cost: number; op: number; net: number }): PnlChainNode[] {
  const { rev, cost, op, net } = snap
  const gross = rev - cost
  const pct = (x: number): number | null => (rev ? +((x / rev) * 100).toFixed(1) : null)
  return [
    { label: '营业收入', value: rev, pct: pct(rev), kind: 'pos' },
    { label: '营业成本', value: cost, pct: pct(cost), kind: 'neg' },
    { label: '毛利', value: gross, pct: pct(gross), kind: 'sub' },
    { label: '期间费用', value: gross - op, pct: pct(gross - op), kind: 'neg' },
    { label: '营业利润', value: op, pct: pct(op), kind: 'sub' },
    { label: '净利润', value: net, pct: pct(net), kind: 'sub' },
  ]
}

// ── 科目 12 月序列(瀑布点级 → 趋势卡切换;成本类取正值显示) ──
export function subjectMonthly(ps: PnlSummary, subject: string): number[] {
  const pick: Record<string, (number | null)[]> = {
    营业收入: ps.revenue,
    租金成本: ps.bySchedule.s1?.cost ?? [],
    用电成本: ps.bySchedule.s2?.cost ?? [],
    用水成本: ps.bySchedule.s3?.cost ?? [],
    运管成本: ps.bySchedule.s4?.cost ?? [],
    运营费用: ps.bySchedule.s5?.cost ?? [],
    园区总损益: ps.profit,
  }
  const arr = pick[subject] ?? ps.revenue
  return ps.months.map((m) => (arr[m - 1] ?? 0) / 1e4)
}

/** 环比叠加 = 上期虚线(首期无上期 → null)。 */
export const momOverlay = (values: number[]): (number | null)[] =>
  values.map((_, i) => (i > 0 ? values[i - 1] : null))

// 科目 → 预算关键行(仅收入/利润有年度预算基准;成本细分科目文件无对应行 → null,趋势卡口径标注)
const SUBJECT_BUDGET_KEY: Record<string, BudgetKey> = { 营业收入: 'revenue', 园区总损益: 'profit' }

/** budget_row 当年值/12(万);无匹配行或无预算 → null。 */
export function budgetMonthlyWan(rows: BudgetRowDTO[], year: number, subject: string): number | null {
  const key = SUBJECT_BUDGET_KEY[subject]
  if (!key) return null
  const row = rows.find((r) => r.year === year && r.budget != null && matchBudgetKey(r.label, r.sub) === key)
  return row?.budget != null ? row.budget / 12 / 1e4 : null
}

/** 科目 12 月趋势 option(柱 + 可选环比虚线 + 可选预算 markLine)。 */
export function subjectTrendOption(
  labels: string[], values: number[], subject: string,
  cmp: { mom?: (number | null)[] | null; budget?: number | null },
): object {
  const series: object[] = [{
    name: subject, type: 'bar', data: values, barWidth: '46%',
    itemStyle: { color: C_POS, borderRadius: 3 },
    markLine: cmp.budget != null
      ? {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: CMP_BUDGET, width: 1.5 },
          // 图表清晰化 §1:insideEndTop 画图内防裁切;文案/色与驾驶舱主图同规则
          label: { position: 'insideEndTop', formatter: '预算月均 ' + fnum(cmp.budget, 0) + '万', fontSize: 10, color: CMP_BUDGET },
          data: [{ yAxis: cmp.budget }],
        }
      : undefined,
  }]
  if (cmp.mom) {
    series.push({
      name: '上期', type: 'line', data: cmp.mom,
      lineStyle: { type: 'dashed', color: CMP_BASELINE, width: 1.5 },
      itemStyle: { color: CMP_BASELINE }, symbol: 'circle', symbolSize: 4,
    })
  }
  return {
    grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
    legend: cmp.mom ? { top: 0, right: 0 } : undefined,
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : wanTip(v)) },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fnum(v, 0) } },
    series,
  }
}

/** 收入结构堆叠 option(附表1-4 收入构成,主题色板自动配色)。 */
export function structOption(labels: string[], series: { name: string; values: (number | null)[] }[]): object {
  return {
    grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '—' : wanTip(v)) },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fnum(v, 0) } },
    series: series.map((s) => ({
      name: s.name, type: 'bar', stack: 'rev', data: s.values, barWidth: '46%',
    })),
  }
}
