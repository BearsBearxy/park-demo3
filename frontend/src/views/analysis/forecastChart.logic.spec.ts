// 自绘折线图的数据层与几何层。两层都是纯函数,所以这里量的就是屏上画出来的东西本身
// （SVG 的 d 属性、坐标、刻度），不是「option 对象长得对不对」那种隔了一层的判据 ——
// 2026-09-12 那天在 ECharts 上栽过两次:值全对、位置也对，画出来却是错的。
import { describe, it, expect } from 'vitest'
import { rollingForecastRows, prevYearUsable, forecastChartGeo, niceTicks, type ChartBox } from './forecastChart.logic'
import type { PnlSummary } from '@/analysis/anaData'

const REV: (number | null)[] = [
  7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20,
  8249744.52, 8669057.75, 8762619.48, 9301530.81, 9407837.38, -636050.65,
]
const band = (rev: (number | null)[]) => ({ rev, cost: new Array(12).fill(null), pnl: new Array(12).fill(null) })
/** scheds:哪些附表有收入 —— prevYearUsable 的判据就是这个集合。 */
function pnl(months: number[], revenue: (number | null)[], scheds: string[] = ['s1'], year = 2025): PnlSummary {
  const bySchedule: Record<string, ReturnType<typeof band>> = {}
  for (const k of ['s1', 's2', 's3', 's4', 's5']) bySchedule[k] = band(new Array(12).fill(null))
  for (const k of scheds) bySchedule[k] = band(revenue)
  return { year, months, revenue, cost: new Array(12).fill(null), profit: new Array(12).fill(null), bySchedule } as PnlSummary
}
const P_FULL = () => pnl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], REV)
const P_MID = () => pnl([1, 2, 3, 4, 5, 6], REV.map((v, i) => (i < 6 ? v : null)))
const BOX: ChartBox = { width: 900, height: 300, padL: 52, padR: 58, padT: 18, padB: 28 }

describe('rollingForecastRows(逐月预测带)', () => {
  it('❗每个月的带只用**它之前**的月算 —— 不存在一条整年的带(用户 2026-09-12 的硬要求)', () => {
    const rows = rollingForecastRows(P_MID())!
    // 录到 6 月 → 覆盖 1..7,第 7 行是下月预测
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7])
    // 前三个月身前不足 3 个训练点,没有带
    expect(rows.slice(0, 3).every((r) => r.lo == null && r.hi == null)).toBe(true)
    expect(rows.slice(3).every((r) => r.lo != null && r.hi != null)).toBe(true)
    // 判据:两个相邻月的带宽必须不同 —— 同一次拟合画出来的整年带,宽度是平滑连续的函数,
    // 而逐月重拟合每个月的残差尺度都在变。宽度完全相等就说明又退回整年带了。
    const w = (i: number) => (rows[i].hi as number) - (rows[i].lo as number)
    expect(w(3)).not.toBeCloseTo(w(4), 2)
    expect(w(4)).not.toBeCloseTo(w(5), 2)
  })

  it('❗最后一行是下月预测:没有实际值,isForecast 为真,其余行都为假', () => {
    const rows = rollingForecastRows(P_MID())!
    const f = rows[rows.length - 1]
    expect(f.month).toBe(7)
    expect(f.actual).toBeNull()
    expect(f.isForecast).toBe(true)
    expect(rows.slice(0, -1).every((r) => !r.isForecast)).toBe(true)
    // 7 月的带 = 用 1-6 月拟合 → 与回测口径同一份数(744~809,见 cockpit.logic.spec.ts)
    expect(Math.round(f.lo as number)).toBe(744)
    expect(Math.round(f.mid as number)).toBe(776)
    expect(Math.round(f.hi as number)).toBe(809)
  })

  it('❗整年录满:12 行,没有 isForecast 那一行(不跨年)', () => {
    const rows = rollingForecastRows(P_FULL())!
    expect(rows).toHaveLength(12)
    expect(rows.some((r) => r.isForecast)).toBe(false)
    expect(rows[11].actual).toBeCloseTo(-63.61, 1)
  })

  it('pnl 为 null / 一个月都没录 → null', () => {
    expect(rollingForecastRows(null)).toBeNull()
    expect(rollingForecastRows(pnl([], new Array(12).fill(null)))).toBeNull()
  })
})

describe('niceTicks', () => {
  it('取 1/2/5×10^k 的整刻度,全部落在区间内', () => {
    const t = niceTicks(712, 945)
    expect(t.length).toBeGreaterThanOrEqual(3)
    expect(t.every((v) => v >= 712 && v <= 945)).toBe(true)
    const step = t[1] - t[0]
    expect(t.every((v, i) => i === 0 || Math.abs(v - t[i - 1] - step) < 1e-6)).toBe(true)
  })
  it('上下界相等时不崩', () => {
    expect(niceTicks(5, 5)).toEqual([5])
  })
})

describe('forecastChartGeo(几何)', () => {
  const geo = () => forecastChartGeo(rollingForecastRows(P_MID()), BOX)!

  it('❗量程必须同时罩住实际值与带的上下沿 —— 少罩一样,线或带就被画到图外', () => {
    const g = geo()
    const rows = rollingForecastRows(P_MID())!
    const ys: number[] = []
    const nums = (d: string) => d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []
    for (const d of [g.linePath, ...g.bandPaths]) for (const pair of nums(d)) ys.push(Number(pair.split(',')[1]))
    const top = BOX.padT, bottom = BOX.height - BOX.padB
    expect(Math.min(...ys), '有点画在了绘图区上边之外').toBeGreaterThanOrEqual(top - 0.01)
    expect(Math.max(...ys), '有点画在了绘图区下边之外').toBeLessThanOrEqual(bottom + 0.01)
    expect(rows.length).toBe(g.xTicks.length)
  })

  it('❗预测点与它的上下沿在同一条竖线上(x 完全相等)', () => {
    const g = geo()
    expect(g.forecast).toBeTruthy()
    expect(g.forecast!.yHi).toBeLessThan(g.forecast!.yMid)   // 上沿在上(y 轴向下)
    expect(g.forecast!.yMid).toBeLessThan(g.forecast!.yLo)
    // x 只有一个值 —— 这一条钉的正是 ECharts 那次半格错位
    expect(g.xTicks[g.xTicks.length - 1].x).toBeCloseTo(g.forecast!.x, 6)
  })

  it('❗折线只连有实际值的月,缺月断开 —— 连过去等于替用户补了一个没有的月', () => {
    const gap = pnl([1, 2, 3, 4, 6], REV.map((v, i) => (i === 4 || i > 5 ? null : v)))
    const g = forecastChartGeo(rollingForecastRows(gap), BOX)!
    expect((g.linePath.match(/M/g) ?? []).length, '缺 5 月,折线必须断成两段').toBe(2)
  })

  it('❗「今天」竖线落在最后一个已录入月与预测月之间', () => {
    const g = geo()
    const xs = g.xTicks.map((t) => t.x)
    const last = xs[xs.length - 2], fc = xs[xs.length - 1]
    expect(g.todayX).toBeGreaterThan(last)
    expect(g.todayX).toBeLessThan(fc)
  })

  it('整年录满时没有预测点,也没有「今天」竖线', () => {
    const g = forecastChartGeo(rollingForecastRows(P_FULL()), BOX)!
    expect(g.forecast).toBeNull()
    expect(g.todayX).toBeNull()
  })

  it('rows 为 null / 空 → null', () => {
    expect(forecastChartGeo(null, BOX)).toBeNull()
    expect(forecastChartGeo([], BOX)).toBeNull()
  })
})

describe('跨年:用上一年的尾月给今年前几个月算带(用户 2026-09-12)', () => {
  // 上一年十二个月都录了,口径同本年
  // ⚠ 不能造成完美直线:残差为 0,带宽就是 0,断言「hi > lo」会红,而那不是产品的问题。
  //    加一点起伏,才是真实数据的样子。
  const PREV = () => pnl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    Array.from({ length: 12 }, (_, i) => 6_000_000 + i * 80_000 + (i % 3 - 1) * 120_000), ['s1'], 2024)
  const CUR = () => pnl([1, 2, 3], [7_146_649.89, 7_169_836.30, 6_996_629.95, ...new Array(9).fill(null)], ['s1'])

  it('❗不接上一年:1~3 月天然没带(这正是用户问的那个洞)', () => {
    const rows = rollingForecastRows(CUR())!
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4])
    expect(rows.slice(0, 3).map((r) => r.lo), '1~3 月身前不足 3 个点').toEqual([null, null, null])
    expect(rows[3].lo, '4 月(下月预测)身前有 1~3 月,是有带的').not.toBeNull()
  })

  it('❗接上一年:1 月就有带 —— 身前是去年 10、11、12 月', () => {
    const rows = rollingForecastRows(CUR(), PREV())!
    expect(rows[0].month).toBe(1)
    expect(rows[0].lo, '1 月必须有带').not.toBeNull()
    expect(rows[0].hi as number).toBeGreaterThan(rows[0].lo as number)
    // 每个月的带仍各自独立:相邻两月带宽不同(没有退回整年带)
    const w = (i: number) => (rows[i].hi as number) - (rows[i].lo as number)
    expect(w(0)).not.toBeCloseTo(w(1), 2)
  })

  it('❗附表口径不同就不接 —— 去年只录了附表2,今年是附表1,接上去会造出假台阶', () => {
    const prevOnlyS2 = pnl([10, 11, 12],
      [...new Array(9).fill(null), 17.0 * 10000, 17.5 * 10000, 12.2 * 10000], ['s2'], 2024)
    expect(prevYearUsable(CUR(), prevOnlyS2), '口径不同,不许接').toBe(false)
    const rows = rollingForecastRows(CUR(), prevOnlyS2)!
    expect(rows[0].lo, '没接上,1 月仍然没带 —— 宁可没有,也不要一条假带').toBeNull()
  })

  it('prevYearUsable:两边都得有收入附表;null / 空口径一律不接', () => {
    expect(prevYearUsable(CUR(), PREV())).toBe(true)
    expect(prevYearUsable(CUR(), null)).toBe(false)
    expect(prevYearUsable(null, PREV())).toBe(false)
    expect(prevYearUsable(CUR(), pnl([1], [1], [], 2024)), '上一年一个收入附表都没有').toBe(false)
  })
})
