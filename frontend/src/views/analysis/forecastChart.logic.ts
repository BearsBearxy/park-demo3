/**
 * 自绘 SVG 图共用的画布盒(ChartBox)与轴刻度(niceTicks)—— 纯函数,不碰 DOM、不碰 ECharts。
 *
 * 为什么不用 ECharts(用户 2026-09-12:「echart画不出来这个可视化就不要用echart的」):
 * 这一天在浏览器里量出过两处 ECharts 画不准的地方 —— 类目轴上 markArea 给 idx±0.5 会整块
 * 挪半格,以及 markLine 的 coord 不参与 y 轴量程、竖线上半截被画到图外。两处都不是配错参数,
 * 是它对「一个类目上的一段区间」这件事本身没有第一等的表达。自己画 SVG 就没有这层翻译。
 */

export interface ChartBox { width: number; height: number; padL: number; padR: number; padT: number; padB: number }

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
