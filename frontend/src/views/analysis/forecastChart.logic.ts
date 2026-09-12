/**
 * 「逐月预测带」自绘折线图的数据与几何 —— 两层都是纯函数,不碰 DOM、不碰 ECharts。
 *
 * 为什么不用 ECharts(用户 2026-09-12:「echart画不出来这个可视化就不要用echart的」):
 * 这一天在浏览器里量出过两处 ECharts 画不准的地方 —— 类目轴上 markArea 给 idx±0.5 会整块
 * 挪半格,以及 markLine 的 coord 不参与 y 轴量程、竖线上半截被画到图外。两处都不是配错参数,
 * 是它对「一个类目上的一段区间」这件事本身没有第一等的表达。自己画 SVG 就没有这层翻译。
 *
 * 视觉语言取自用户指定的 Figma 稿(Animated Line Charts,节点 2310:2628):
 * 主线 #4F46E5 / 浅带 #C7D2FE / 网格 #E5EAF0 / 轴标签 #CBD5E1 / 深色气泡 #1E293B,
 * 线下浅紫渐变到透明,只有横向网格线,没有纵向。
 * **有意偏离稿的一处**:稿上是平滑曲线,这里用直线段。平滑会在两个月之间凭空造出没有的值,
 * 这一屏的全部规矩都是「不许编屏上没有的数」,为观感破这条不值当。
 */
import { fitBandAt, fitPoints, pnlYearMonths, type XYPoint } from './cockpit.logic'
import type { PnlSummary } from '@/analysis/anaData'

const wan = (v: number | null | undefined): number | null => (v == null ? null : +(v / 10000).toFixed(2))

/** 一个月一行:实际值(录了才有)+ 这个月**自己的**预测带(只用它之前的月算出来的)。 */
export interface RollingRow {
  month: number
  actual: number | null
  /** 预测中位。训练点不足(该月之前不到 3 个已录入月)时整组为 null。 */
  mid: number | null
  lo: number | null
  hi: number | null
  /** 这一格是不是「还没录入、只有预测」的那一个月。 */
  isForecast: boolean
}

/**
 * 上一年能不能接进来:**有收入的附表集合必须与本年相同**。
 *
 * 这道守卫不是洁癖。园区收入 = 附表1~4 相加,其中附表1(租金)占六成以上。
 * 如果上一年只录了附表2(光伏)——demo 库里 2024 年正是这样 —— 直接接上去,
 * 去年尾月会是十几万、今年 1 月是七百多万,拟合出来的斜率全是这个**假台阶**造的,
 * 1~3 月的带又宽又偏,而且看上去一本正经。那比没有带更糟。
 *
 * 判据取「哪些附表有收入」而不是「有多少行」:行数天然不同,附表集合不同才是口径不同。
 */
export function prevYearUsable(cur: PnlSummary | null, prev: PnlSummary | null): boolean {
  if (!cur || !prev) return false
  const setOf = (p: PnlSummary) => Object.entries(p.bySchedule)
    .filter(([, b]) => b.rev.some((v) => v != null))
    .map(([k]) => k).sort().join(',')
  const a = setOf(cur)
  return a !== '' && a === setOf(prev)
}

/**
 * 逐月滚动预测:第 m 个月的带,只用 m **之前**已录入的月拟合出来。
 *
 * 这是用户 2026-09-12 的硬要求:「按照每个月的预测带,不允许再出现整年预测带的情况」。
 * 十二行里每一行的 lo/hi 来自各自不同的一次拟合 —— 不存在「一条整年的带」这种东西,
 * 也就不会再出现「图上一条宽带、表里一堆窄区间」那种自相矛盾(用户当场指出过)。
 *
 * **跨年**(用户 2026-09-12:「有用前一年的最后几个月来预测今年前三个月的预测带的机制吗」):
 * 传入 prev 就把上一年已录入的月按 x = 月号 − 12 接到横轴左边(去年 12 月 = 0,11 月 = −1),
 * 于是 1 月也有三个在前的点,前三个月不再天然没带。接不接由 prevYearUsable 判,理由见它的头注。
 * 一旦接上,**每个月**的带都用上全部可得历史,不只是前三个月 —— 同一张图上两套训练口径才是怪事。
 *
 * 覆盖到「最后一个已录入月 + 1」为止:那一格没有实际值,就是下月预测。
 */
export function rollingForecastRows(pnl: PnlSummary | null, prev: PnlSummary | null = null): RollingRow[] | null {
  if (!pnl) return null
  const recorded = pnlYearMonths(pnl)
  const last = recorded[recorded.length - 1]
  if (last == null) return null
  const prevPts: XYPoint[] = prevYearUsable(pnl, prev) && prev
    ? pnlYearMonths(prev).map((m) => ({ x: m - 12, y: wan(prev.revenue[m - 1]) as number }))
    : []
  const curPts: XYPoint[] = recorded.map((m) => ({ x: m, y: wan(pnl.revenue[m - 1]) as number }))
  const all = [...prevPts, ...curPts]
  const upto = Math.min(last + 1, 12)
  const rows: RollingRow[] = []
  for (let m = 1; m <= upto; m++) {
    const fit = fitPoints(all.filter((p) => p.x < m))
    const band = fit ? fitBandAt(fit, m) : null
    rows.push({
      month: m,
      actual: wan(pnl.revenue[m - 1]),
      mid: band ? band.mid : null,
      lo: band ? band.lo : null,
      hi: band ? band.hi : null,
      isForecast: m === last + 1,
    })
  }
  return rows
}

/* ---------- 几何:把行变成 SVG 能直接用的坐标,同样是纯函数 ---------- */

export interface ChartBox { width: number; height: number; padL: number; padR: number; padT: number; padB: number }
export interface ChartGeo {
  box: ChartBox
  /** 线下渐变与折线共用的这条路径(只连有实际值的月)。 */
  linePath: string
  /** 逐月带的外轮廓(上沿从左到右,下沿从右到左,闭合)。分段:中间断开的月不连过去。 */
  bandPaths: string[]
  /** 预测中位那条虚线(只连有 mid 的月)。 */
  midPath: string
  dots: { month: number; x: number; y: number }[]
  forecast: { month: number; x: number; yMid: number; yLo: number; yHi: number } | null
  /** 「今天」那条竖线的 x —— 最后一个已录入月与预测月之间。null = 没有预测月。 */
  todayX: number | null
  yTicks: { v: number; y: number; label: string }[]
  xTicks: { month: number; x: number; label: string }[]
  /** 第一个算得出带的月份。它之前的月身前不足 3 个已录入月,残差自由度为 0,带算不出来。 */
  firstBandMonth: number | null
}

/** 轴刻度:在 [lo, hi] 上取 ≤count 个「好看的」整数刻度(1/2/5×10^k)。 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo]
  // 取整规则同 D3:先算出「理想步长」raw,再按它落在 10^k 的哪一档,归到 1/2/5/10 上。
  // 不用「第一个 ≥ raw 的候选」那种写法 —— 实测 712~945 会取到 100,整幅只剩两条网格线。
  const raw = (hi - lo) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const err = raw / mag
  const step = mag * (err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1)
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

export function forecastChartGeo(rows: RollingRow[] | null, box: ChartBox): ChartGeo | null {
  if (!rows || !rows.length) return null
  const vals: number[] = []
  for (const r of rows) {
    if (r.actual != null) vals.push(r.actual)
    if (r.lo != null) vals.push(r.lo)
    if (r.hi != null) vals.push(r.hi)
  }
  if (!vals.length) return null
  // 量程罩住实际值**与**带的上下沿 —— 少罩一样,线或带就会被画到图外(2026-09-12 在 ECharts 上栽过)。
  let min = Math.min(...vals), max = Math.max(...vals)
  if (min === max) { min -= 1; max += 1 }
  const pad = (max - min) * 0.08
  min -= pad; max += pad

  const innerW = box.width - box.padL - box.padR
  const innerH = box.height - box.padT - box.padB
  const n = rows.length
  const x = (i: number) => box.padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1))
  const y = (v: number) => box.padT + innerH * (1 - (v - min) / (max - min))
  const r2 = (v: number) => +v.toFixed(2)

  // 折线:只连有实际值的月;中间缺月断开(不 connectNulls —— 连过去等于替用户补了一个没有的月)
  const segs: { i: number; v: number }[][] = []
  let cur: { i: number; v: number }[] = []
  rows.forEach((r, i) => {
    if (r.actual == null) { if (cur.length) { segs.push(cur); cur = [] } return }
    cur.push({ i, v: r.actual })
  })
  if (cur.length) segs.push(cur)
  const linePath = segs.map((sg) => sg.map((p, k) => `${k ? 'L' : 'M'}${r2(x(p.i))},${r2(y(p.v))}`).join(' ')).join(' ')

  // 带:同样分段,缺带的月断开
  const bandSegs: { i: number; lo: number; hi: number }[][] = []
  let bcur: { i: number; lo: number; hi: number }[] = []
  rows.forEach((r, i) => {
    if (r.lo == null || r.hi == null) { if (bcur.length) { bandSegs.push(bcur); bcur = [] } return }
    bcur.push({ i, lo: r.lo, hi: r.hi })
  })
  if (bcur.length) bandSegs.push(bcur)
  const bandPaths = bandSegs.filter((sg) => sg.length > 1).map((sg) => {
    const top = sg.map((p, k) => `${k ? 'L' : 'M'}${r2(x(p.i))},${r2(y(p.hi))}`).join(' ')
    const bot = [...sg].reverse().map((p) => `L${r2(x(p.i))},${r2(y(p.lo))}`).join(' ')
    return `${top} ${bot} Z`
  })
  const midSegs = bandSegs.filter((sg) => sg.length > 1)
  const midPath = midSegs.map((sg) => sg.map((p, k) => {
    const r = rows[p.i]
    return `${k ? 'L' : 'M'}${r2(x(p.i))},${r2(y(r.mid as number))}`
  }).join(' ')).join(' ')

  const dots = rows.filter((r) => r.actual != null).map((r) => ({
    month: r.month, x: r2(x(rows.indexOf(r))), y: r2(y(r.actual as number)),
  }))
  const fRow = rows.find((r) => r.isForecast && r.mid != null)
  const forecast = fRow ? {
    month: fRow.month, x: r2(x(rows.indexOf(fRow))),
    yMid: r2(y(fRow.mid as number)), yLo: r2(y(fRow.lo as number)), yHi: r2(y(fRow.hi as number)),
  } : null
  const fIdx = rows.findIndex((r) => r.isForecast)
  const todayX = fIdx > 0 ? r2((x(fIdx - 1) + x(fIdx)) / 2) : null

  const yTicks = niceTicks(min, max).map((v) => ({ v, y: r2(y(v)), label: String(Math.round(v)) }))
  const xTicks = rows.map((r, i) => ({ month: r.month, x: r2(x(i)), label: `${r.month}月` }))
  const firstBandMonth = rows.find((r) => r.lo != null)?.month ?? null
  return { box, linePath, bandPaths, midPath, dots, forecast, todayX, yTicks, xTicks, firstBandMonth }
}
