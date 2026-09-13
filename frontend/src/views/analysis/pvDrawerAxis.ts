// 抽屉 B9 B10 B11 共用的画布几何(PV-ANALYSIS-SCREEN-V4 §3.17–3.19;画布 v2/Drawer.dc.html)。
// 宽 = 实测,padL 46 / padR 14;B9 B10 横轴按一年逐日(第 d 天 → padL + (d−1)/(年天数−1) × 内宽),
// B11 按 12 个等宽月槽取槽中心。坐标保留一位小数(画布同口径)。单测跟着三张图的 spec 走。

export const PAD_L = 46
export const PAD_R = 14

export const r1 = (v: number) => Math.round(v * 10) / 10

const innerW = (width: number) => width - PAD_L - PAD_R

/** 一年第 doy 天的 x */
export function xOfDay(doy: number, width: number, daysInYear: number): number {
  return r1(PAD_L + ((doy - 1) / (daysInYear - 1)) * innerW(width))
}

/** 画布 renderVals 的反算:鼠标 x → 第几天,夹在 [1, maxDoy] */
export function dayOfX(x: number, width: number, daysInYear: number, maxDoy = daysInYear): number {
  const d = Math.round(((x - PAD_L) / innerW(width)) * (daysInYear - 1)) + 1
  return Math.max(1, Math.min(maxDoy, d))
}

/** 12 个月初是一年第几天。二月天数由年天数反推(365 → 28,366 → 29) */
export function monthStartDays(daysInYear: number): number[] {
  const len = [31, daysInYear - 337, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const out: number[] = []
  let d = 1
  for (const n of len) { out.push(d); d += n }
  return out
}

/** 画布 near():从 doy 起向两侧各找 6 天,同距先取早的一天。doys 升序(同距时先遇到的就是早的);找不到 = null */
export function nearestIndex(doys: number[], doy: number, maxGap = 6): number | null {
  let best: number | null = null, bd = Infinity
  doys.forEach((d, i) => {
    const g = Math.abs(d - doy)
    if (g <= maxGap && g < bd) { best = i; bd = g }
  })
  return best
}

/** B11 月槽:槽宽与第 m 个月(1 起)的槽中心 */
export const slotWidth = (width: number) => innerW(width) / 12
export const slotCenter = (m: number, width: number) => r1(PAD_L + (m - 0.5) * slotWidth(width))

const NICE = [1, 1.5, 2, 2.5, 5, 10]
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw))
  let best = p, bd = Infinity
  for (const k of NICE) if (Math.abs(k * p - raw) < bd) { bd = Math.abs(k * p - raw); best = k * p }
  return best
}

/**
 * 纵轴:数据极值贴在绘图区上下各留 reserve 像素处(留给直标字与估计窗口底条),
 * 网格步长取「量程 / 3」最近的 1 / 1.5 / 2 / 2.5 / 5 × 10^k,网格线从 base(0 或 1)起按步长排。
 * ponytail: 画布的纵轴是写死的 SVG,renderVals 里没有量程算法;reserve 像素是照画布
 * 数据极值离绘图区边缘的距离量出来的。一个离群点会把其余点压扁,要改就换分位数截断。
 */
export function yAxis(
  vals: number[], top: number, bottom: number,
  reserve: { top: number; bottom: number }, base = 0,
): { y: (v: number) => number; ticks: number[]; step: number } {
  let mn = Math.min(...vals), mx = Math.max(...vals)
  if (!(mx - mn > 1e-9)) { mn -= 0.05; mx += 0.05 }
  const k = (bottom - top - reserve.top - reserve.bottom) / (mx - mn)
  const y = (v: number) => r1(top + reserve.top + (mx - v) * k)
  const lo = mn - reserve.bottom / k, hi = mx + reserve.top / k
  const step = niceStep((hi - lo) / 3)
  const ticks: number[] = []
  for (let i = Math.ceil((lo - base) / step - 1e-9); base + i * step <= hi + 1e-9; i++) {
    ticks.push(Math.round((base + i * step) * 1e6) / 1e6)
  }
  return { y, ticks, step }
}

/** '2025-06-09' → { m: 6, d: 9 } */
export const md = (date: string) => ({ m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) })
