// src/views/analysis/chargingAnalysis.logic.ts — 充电桩分析纯数据变换(ENERGY-ANALYSIS-SPEC §3,
// 单测 chargingAnalysis.logic.spec.ts)。口径与分桩明细屏(CpMeterView)全等:三金额=cp_reading 直加;
// 手续费率=手续费÷(收益+手续费);损耗率=(电表量−Σ充电量)÷电表量(可为负=计量异常,未录电表→null 断点)。
// 入参一律先按当前 tab(vehicleType)过滤好再进来;本文件不认识 tab。
import type { CpPowerUsageDTO, CpReadingDTO, CpStationDTO } from '@/api/cpMeter'

/** readDate(YYYY-MM-DD)→ 月序 1..12。 */
export const monthOf = (readDate: string): number => +readDate.slice(5, 7)

/** 手续费率 = 手续费 ÷ (收益 + 手续费);分母 ≤0 → null(不画假 0)。 */
export function feeRate(fee: number, revenue: number): number | null {
  const base = revenue + fee
  return base > 0 ? fee / base : null
}

/** 电表损耗率 = (电表量 − Σ充电量) ÷ 电表量;未录电表(null)或电表 ≤0 → null(图上断点);可为负(计量异常红点)。 */
export function lossRate(meterKwh: number | null, sumChargeKwh: number): number | null {
  return meterKwh != null && meterKwh > 0 ? (meterKwh - sumChargeKwh) / meterKwh : null
}

// ── 结论条:年充电量/收益/手续费 Σ + 平均损耗率(电表已录行加权:Σ损耗÷Σ电表;无电表行 → null) ──
export interface YearSummary { chargeKwh: number; fee: number; revenue: number; avgLossRate: number | null }
export function yearSummary(
  readings: Pick<CpReadingDTO, 'chargeKwh' | 'fee' | 'revenue'>[],
  usage: Pick<CpPowerUsageDTO, 'meterKwh' | 'sumChargeKwh'>[],
): YearSummary {
  let chargeKwh = 0, fee = 0, revenue = 0
  for (const r of readings) { chargeKwh += r.chargeKwh; fee += r.fee; revenue += r.revenue }
  let meter = 0, metered = 0
  for (const u of usage) if (u.meterKwh != null) { meter += u.meterKwh; metered += u.sumChargeKwh }
  return { chargeKwh, fee, revenue, avgLossRate: lossRate(meter > 0 ? meter : null, metered) }
}

// ── 图1 桩月度量收:各桩充电量 12 月分桶(堆叠柱)+ 全部桩月收益合计(线) ──
// 无抄表记录的月 = null,不是 0。
// 0 与 null 在这张图上是两个业务事实:0 = 「这个月这根桩没人充电」,null = 「这个月没抄表」。
// 改前一律 fill(0),于是没抄表的 1-9 月被画成一条贴地零线 + 一排零高柱,用户读成「上半年没生意」。
// 本文件所属屏的头注释本就写着「禁止渲染 0 假数据」—— 那条规则原先只管到「整屏为空」,
// 这里把它延伸到「逐月为空」。ECharts 对 null:柱不画、线断点(connectNulls 默认 false)。
export interface StationMonthly { stations: { name: string; charge: (number | null)[] }[]; revenue: (number | null)[] }
export function stationMonthly(
  stations: Pick<CpStationDTO, 'id' | 'name' | 'sortNo'>[],
  readings: Pick<CpReadingDTO, 'stationId' | 'readDate' | 'chargeKwh' | 'revenue'>[],
): StationMonthly {
  const by = new Map<number, (number | null)[]>()
  const revenue = Array<number | null>(12).fill(null)
  for (const r of readings) {
    const m = monthOf(r.readDate) - 1
    const arr = by.get(r.stationId) ?? Array<number | null>(12).fill(null)
    // ?? 0 只在「本月首条记录」时把 null 抬成 0 再累加 —— 有记录的月即使读数为 0 也保持 0(真实的零),
    // 没记录的月一直是 null(画不出来)。两者由此区分开。
    arr[m] = (arr[m] ?? 0) + r.chargeKwh
    by.set(r.stationId, arr)
    revenue[m] = (revenue[m] ?? 0) + r.revenue
  }
  // 只画有记录的桩(空桩不进图例),按桩库 sort 序
  return {
    stations: [...stations].sort((a, b) => a.sortNo - b.sortNo)
      .filter((s) => by.has(s.id))
      .map((s) => ({ name: s.name, charge: by.get(s.id)! })),
    revenue,
  }
}

// ── 图2 运营商结构:收益/手续费按运营商聚合 + 手续费率;收益降序 ──
export interface OperatorTotal { operator: string; revenue: number; fee: number; feeRate: number | null }
export function operatorTotals(
  stations: Pick<CpStationDTO, 'id' | 'operator'>[],
  readings: Pick<CpReadingDTO, 'stationId' | 'fee' | 'revenue'>[],
): OperatorTotal[] {
  const opOf = new Map(stations.map((s) => [s.id, s.operator]))
  const agg = new Map<string, { revenue: number; fee: number }>()
  for (const r of readings) {
    const op = opOf.get(r.stationId)
    if (!op) continue   // 记录桩不在传入桩集合(跨 tab)→ 不计
    const a = agg.get(op) ?? { revenue: 0, fee: 0 }
    a.revenue += r.revenue; a.fee += r.fee
    agg.set(op, a)
  }
  return [...agg].map(([operator, a]) => ({ operator, ...a, feeRate: feeRate(a.fee, a.revenue) }))
    .sort((x, y) => y.revenue - x.revenue)
}

// ── 图3 电表损耗率趋势:每运营商 12 月损耗率;无电表月 null(断点不连线),负值由视图标红点 ──
export interface OperatorLoss { operator: string; rates: (number | null)[] }
export function lossSeries(
  usage: Pick<CpPowerUsageDTO, 'operator' | 'month' | 'meterKwh' | 'sumChargeKwh'>[],
): OperatorLoss[] {
  const by = new Map<string, (number | null)[]>()
  for (const u of usage) {
    const arr = by.get(u.operator) ?? Array<number | null>(12).fill(null)
    arr[u.month - 1] = lossRate(u.meterKwh, u.sumChargeKwh)
    by.set(u.operator, arr)
  }
  return [...by].map(([operator, rates]) => ({ operator, rates }))
}
