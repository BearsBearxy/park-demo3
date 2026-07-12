// TenantPortfolioView(结构与续约)数据变换纯函数(v2 铁律⑦:抽出单测)。
// 箱线五数走 anaFmt.fiveNum(线性插值分位,与 v1 AnaBoxPlot 同算法 → 数值不变);
// 帕累托累计与 v1 同语义:仅对 Top N 逐项累加(cums[4] = Top5 集中度)。
import { fiveNum } from '@/components/ana/anaFmt'

export interface BoxRow {
  name: string
  stats: [number, number, number, number, number]   // [min, q1, med, q3, max](ECharts boxplot 数据形)
  mean: number
  n: number
}

/** 各组箱线五数 + 均值(div 用于单位折算,如 10000 → 万;保持与原始值同比例)。 */
export function buildBoxRows(groups: { name: string; values: number[] }[], div = 1): BoxRow[] {
  return groups.map((g) => {
    const f = fiveNum(g.values)
    const d = (v: number): number => +(v / div).toFixed(2)
    return { name: g.name, stats: [d(f.min), d(f.q1), d(f.med), d(f.q3), d(f.max)], mean: d(f.mean), n: g.values.length }
  })
}

export interface StripPoint { x: number; y: number; tenant: string }

/**
 * 抖动散点带(strip plot):每份合同一点,x=组序±黄金分割序列抖动(±0.16,确定性无随机,
 * 渲染与测试稳定),y=值/div。右偏分布(单份180万合同)下配对数轴替代箱线图。
 */
export function buildStripPoints(groups: { name: string; items: { v: number; tenant: string }[] }[], div = 1): StripPoint[][] {
  return groups.map((g, gi) =>
    g.items.map((it, k) => ({
      // 序列平移半步:k=0 恰为 0(组内首点/单点组正居中于刻度),后续点黄金分割均匀铺开
      x: +(gi + (((k * 0.618034 + 0.5) % 1) - 0.5) * 0.32).toFixed(3),
      y: +(it.v / div).toFixed(2),
      tenant: it.tenant,
    })))
}

export interface ParetoData { names: string[]; shares: number[]; cums: number[] }

/** 月租帕累托:Top N 各户占比 + 逐项累计曲线(v1 语义:cum 只累加已展示项)。 */
export function buildPareto(shares: { name: string; share: number }[], topN = 20): ParetoData {
  const items = shares.slice(0, topN)
  let cum = 0
  return {
    names: items.map((i) => i.name),
    shares: items.map((i) => +i.share.toFixed(2)),
    cums: items.map((i) => +(cum += i.share).toFixed(1)),
  }
}
