/**
 * 「单位租金对标」直方图的几何 —— 稿上(board-peer)要的是:
 * 区间内的柱子是蓝的、区间外是灰的,p10/p90 两条虚线,中位标注,本户一条竖线带点和名字,
 * 带下居中一句「80% 的同类在这段」,右下角一行溢出说明。
 *
 * 为什么自绘(用户 2026-09-12:「echart实现不了就自己写」):那天在浏览器里量到 ECharts 在
 * 类目轴上给 markArea 小数坐标会整块挪半格;而这张图的全部意义就在于「本户那条线落在哪一格」。
 * 换成数值轴由自己算像素,落点就是算出来的那个数。
 */
import { niceTicks, type ChartBox } from './forecastChart.logic'

export interface HistBinIn { lo: number; hi: number; count: number }
export interface UnitRentHistGeo {
  box: ChartBox
  bars: { lo: number; hi: number; count: number; x: number; w: number; y: number; h: number; inBand: boolean; overflow: boolean }[]
  /** p10~p90 的底色块。 */
  bandRect: { x: number; w: number } | null
  /** p10 / 中位 / p90 三条虚线与它们的轴下标注。 */
  marks: { x: number; label: string; kind: 'p10' | 'median' | 'p90' }[]
  /** 本户那一竖:线 + 顶上的点 + 名字。 */
  self: { x: number; label: string; dotY: number } | null
  /** 带下居中那句话的位置。 */
  bandCaption: { x: number; y: number } | null
  yTicks: { v: number; y: number; label: string }[]
  xTicks: { v: number; x: number; label: string }[]
  /** 溢出档说明(稿上「7 份 > 40，最高 150」)。 */
  overflowNote: string
}

const r2 = (v: number) => +v.toFixed(2)

export function unitRentHistGeo(
  bins: HistBinIn[] | null, capHi: number, overflowCount: number, overflowMax: number,
  stats: { p10: number; median: number; p90: number } | null,
  selfValue: number | null, selfName: string, box: ChartBox,
): UnitRentHistGeo | null {
  if (!bins || !bins.length) return null
  const hasOverflow = overflowCount > 0
  // 横轴:0 .. capHi,溢出档单独占最右边一格宽度(稿上「40+」那一格)
  const binW = bins[0].hi - bins[0].lo
  const xMax = capHi + (hasOverflow ? binW : 0)
  const maxCount = Math.max(1, ...bins.map((b) => b.count), hasOverflow ? overflowCount : 0)

  const innerW = box.width - box.padL - box.padR
  const innerH = box.height - box.padT - box.padB
  const x = (v: number) => box.padL + (innerW * v) / xMax
  const y = (c: number) => box.padT + innerH * (1 - c / maxCount)
  const base = box.height - box.padB

  const inBand = (lo: number, hi: number) => !!stats && lo >= stats.p10 - 1e-9 && hi <= stats.p90 + 1e-9
  const bars = bins.map((b) => ({
    lo: b.lo, hi: b.hi, count: b.count,
    x: r2(x(b.lo) + 1), w: r2(Math.max(1, x(b.hi) - x(b.lo) - 2)),
    y: r2(y(b.count)), h: r2(base - y(b.count)),
    inBand: inBand(b.lo, b.hi), overflow: false,
  }))
  if (hasOverflow) {
    bars.push({
      lo: capHi, hi: xMax, count: overflowCount,
      x: r2(x(capHi) + 1), w: r2(Math.max(1, x(xMax) - x(capHi) - 2)),
      y: r2(y(overflowCount)), h: r2(base - y(overflowCount)),
      inBand: false, overflow: true,
    })
  }

  const bandRect = stats ? { x: r2(x(stats.p10)), w: r2(x(stats.p90) - x(stats.p10)) } : null
  const marks = stats ? [
    { x: r2(x(stats.p10)), label: stats.p10.toFixed(1), kind: 'p10' as const },
    { x: r2(x(stats.median)), label: `中位 ${stats.median.toFixed(1)}`, kind: 'median' as const },
    { x: r2(x(stats.p90)), label: stats.p90.toFixed(1), kind: 'p90' as const },
  ] : []
  const self = selfValue != null
    ? { x: r2(x(Math.min(selfValue, xMax))), label: `${selfName} ${selfValue.toFixed(1)}`, dotY: box.padT }
    : null
  const bandCaption = bandRect ? { x: r2(bandRect.x + bandRect.w / 2), y: base + 30 } : null

  const yTicks = niceTicks(0, maxCount, 3).map((v) => ({ v, y: r2(y(v)), label: String(Math.round(v)) }))
  const step = binW * 4
  const xTicks: { v: number; x: number; label: string }[] = []
  for (let v = 0; v <= capHi + 1e-9; v += step) xTicks.push({ v, x: r2(x(v)), label: String(Math.round(v)) })
  if (hasOverflow) xTicks.push({ v: xMax, x: r2(x(capHi + binW / 2)), label: `${Math.round(capHi)}+` })

  const overflowNote = hasOverflow
    ? `${overflowCount} 份 > ${Math.round(capHi)}，最高 ${overflowMax.toFixed(1)}`
    : ''
  return { box, bars, bandRect, marks, self, bandCaption, yTicks, xTicks, overflowNote }
}
