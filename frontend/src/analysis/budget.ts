// 预算对比纯函数(BudgetView / Cockpit 预算达成卡 / 导入解析共用;单测 budget.spec.ts)。
import type { PnlSummary } from './anaData'
import type { PnlYearDTO } from '@/types/pnl'
import { CMP_BUDGET, fnum } from '@/components/ana/anaFmt'

// 2025 起「发生额」以 pnl 实时推算为单一事实源(spec:文件 2025 发生额列跳过不导)
export const PNL_SOT_FROM_YEAR = 2025

// 费用侧细分键(复审:文件「管理费用总计」预算只含管理费,曾整体映射 s5 运营费用总计
// (销售+管理+财务+修缮)→ 达成率 103.3% 假超支,同口径实为 91.2% 结余)
export type BudgetKey = 'revenue' | 'cost' | 'mgmt' | 'sales' | 'fin' | 'repair' | 's5' | 'profit'

// 关键行匹配规则(spec「分析屏」节):收入总计→revenue;含「总计」的成本行→cost;
// 管理/销售(中介)/财务/修缮工程 各自映射组级(顺序在通用费用总计之前);其余费用总计→s5;
// 利润/损益→profit;子行(其中：)不参与匹配,匹配不到 → null(只显示文件值)。
export function matchBudgetKey(label: string, sub = false): BudgetKey | null {
  if (sub) return null
  if (label.includes('收入总计')) return 'revenue'
  if (label.includes('总计') && label.includes('成本')) return 'cost'
  if (label.includes('管理费')) return 'mgmt'
  if (label.includes('销售费') || label.includes('中介费')) return 'sales'
  if (label.includes('财务费')) return 'fin'
  if (label.includes('修缮') || label.includes('工程费')) return 'repair'
  if (label.includes('总计') && label.includes('费用')) return 's5'
  if (/利润|损益/.test(label)) return 'profit'
  return null
}

// 全 null(该年未录)→ null,否则非 null 月求和
const sumOrNull = (a: (number | null)[]): number | null => {
  let s = 0, has = false
  for (const v of a) if (v != null) { s += v; has = true }
  return has ? s : null
}

export type S5GroupTotals = Record<'mgmt' | 'sales' | 'fin' | 'repair', number | null>
// s5 组级小计年Σ(库行实测:管理费用总计：/销售费用合计/财务费用合计：/修缮、改造费用,kind='total')
export function extractS5GroupTotals(dto: PnlYearDTO): S5GroupTotals {
  const pick = (pred: (label: string) => boolean): number | null => {
    let s = 0, has = false
    for (const r of dto.rows) {
      if (r.kind !== 'total' || !pred(r.label)) continue
      for (const v of r.m) if (v != null) { s += v; has = true }
    }
    return has ? s : null
  }
  return {
    mgmt: pick(l => l.startsWith('管理费用总计')),
    sales: pick(l => l.startsWith('销售费用合计')),
    fin: pick(l => l.startsWith('财务费用合计')),
    repair: pick(l => l.startsWith('修缮、改造费用') || l.startsWith('修缮')),
  }
}

// pnl 年Σ → 关键值:revenue=Σ收入;cost=Σs1~s4 成本带(=总成本−s5);s5=运营费用总计带;profit=Σ利润;
// mgmt/sales/fin/repair 组级来自 extractS5GroupTotals(未传 → null,行退化为只显示文件值)。
export function pnlKeyTotals(p: PnlSummary, s5Groups?: S5GroupTotals): Record<BudgetKey, number | null> {
  const s5 = sumOrNull(p.bySchedule.s5?.cost ?? [])
  const all = sumOrNull(p.cost)
  return {
    revenue: sumOrNull(p.revenue),
    cost: all == null ? null : all - (s5 ?? 0),
    s5,
    profit: sumOrNull(p.profit),
    mgmt: s5Groups?.mgmt ?? null,
    sales: s5Groups?.sales ?? null,
    fin: s5Groups?.fin ?? null,
    repair: s5Groups?.repair ?? null,
  }
}

// ── 五年子弹图(图表清晰化 spec §T3):一 option 三 grid 横排,实际=柱、预算=紫杠刻度 ──

/** 单指标输入:bars=comboBarData 输出、budget=comboBudgetData 输出(均万元,结构化匹配不引 views 类型)。 */
export interface BulletMetric {
  name: string
  color: string
  bars: { value: number | null; isForecast: boolean }[]
  budget: (number | null)[]
}

// axis tooltip 参数(只取用到的字段);null 数据项 value 可能为 null/'-' → 统一收敛
interface BulletTipParam { seriesIndex: number; name: string; value: unknown }
const tipNum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)

/** 子弹图 option:每 grid 一指标(x=年份,title 数组作 grid 标题),前瞻年(isForecast)无柱只留紫杠;
 *  bar/scatter 均单系列同 category 天然居中对齐;tooltip 缺项省略,不显「—」。 */
export function bulletOption(years: string[], metrics: BulletMetric[]): Record<string, unknown> {
  const slot = 100 / metrics.length
  const series: object[] = []
  metrics.forEach((m, i) => {
    series.push({
      name: '实际', type: 'bar', xAxisIndex: i, yAxisIndex: i, barMaxWidth: 22,
      itemStyle: { color: m.color },
      data: m.bars.map(b => (b.isForecast ? null : b.value)),   // 前瞻年无柱
    })
    series.push({
      name: '预算目标', type: 'scatter', xAxisIndex: i, yAxisIndex: i,
      symbol: 'rect', symbolSize: [26, 3], itemStyle: { color: CMP_BUDGET },
      data: m.budget,
    })
  })
  return {
    // 同名系列共用图例项 → 图例恒两项「实际/预算目标」
    legend: { top: 0, data: ['实际', '预算目标'] },
    title: metrics.map((m, i) => ({
      text: m.name, left: slot * i + slot / 2 + '%', top: 22, textAlign: 'center',
      textStyle: { fontSize: 12, fontWeight: 600 },
    })),
    grid: metrics.map((_, i) => ({ left: slot * i + 3 + '%', width: slot - 6 + '%', top: 48, bottom: 2, containLabel: true })),
    xAxis: metrics.map((_, i) => ({ type: 'category', gridIndex: i, data: years })),
    yAxis: metrics.map((_, i) => ({ type: 'value', gridIndex: i, axisLabel: { formatter: '{value} 万' } })),
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps: BulletTipParam[] | BulletTipParam): string => {
        const arr = Array.isArray(ps) ? ps : [ps]
        if (!arr.length) return ''
        // 系列成对入队(bar/scatter 交替):seriesIndex 偶=实际柱,奇=预算杠;÷2=指标下标
        const a = tipNum(arr.find(p => p.seriesIndex % 2 === 0)?.value)
        const b = tipNum(arr.find(p => p.seriesIndex % 2 === 1)?.value)
        const parts: string[] = []
        if (a != null) parts.push(`实际 ${fnum(a, 1)}万`)
        if (b != null) parts.push(`预算 ${fnum(b, 1)}万`)      // 缺预算省略,不显「—」
        if (a != null && b != null && b !== 0) parts.push(`达成 ${(a / b * 100).toFixed(1)}%`)
        return `${arr[0].name} · ${metrics[Math.floor(arr[0].seriesIndex / 2)].name}<br/>${parts.join(' · ')}`
      },
    },
    series,
  }
}
