/**
 * 「续签率从哪来」自绘图的几何 —— 稿上(board-expiry)是两件东西叠在一起:
 * 上面一条堆叠条(18 续签 / 72 未续签),下面一条 0~100% 的数轴,标着观测值与它自己的 80% 区间。
 *
 * 为什么自绘(用户 2026-09-12:「echart实现不了就自己写」):堆叠条 + 数轴这种「两个不同坐标系
 * 上下贴着」的排版,ECharts 要两个 grid 拼,拼完还得手工对齐左右内边距;而这里真正要的只是
 * 六个矩形和几条线。
 */
export interface RenewalBox { width: number; height: number; padL: number; padR: number }
export interface RenewalGeo {
  box: RenewalBox
  /** 堆叠条:续签(蓝)与未续签(灰)两段。 */
  bar: { y: number; h: number; hitW: number; missW: number; x: number; totalW: number }
  barLabels: { hit: { x: number; y: number; text: string; inside: boolean }; miss: { x: number; y: number; text: string } | null }
  /** 数轴:0~100% 的直线与刻度。 */
  axis: { y: number; x0: number; x1: number }
  ticks: { v: number; x: number; label: string; strong: boolean }[]
  /** 80% 区间在轴上的那一段。 */
  band: { x: number; w: number; loText: string; hiText: string } | null
  /** 观测值那一竖。 */
  marker: { x: number; text: string } | null
}

const r2 = (v: number) => +v.toFixed(2)

export function renewalGeo(
  hits: number, n: number, band: { lo: number; hi: number } | null, box: RenewalBox,
): RenewalGeo | null {
  if (!(n > 0) || hits < 0 || hits > n) return null
  const totalW = box.width - box.padL - box.padR
  const x = (pct: number) => box.padL + (totalW * pct) / 100
  const barY = 10, barH = 30
  const hitW = r2((totalW * hits) / n)
  const missW = r2(totalW - hitW)
  const axisY = barY + barH + 34

  const pct = (hits / n) * 100
  // 估宽同气泡那套:中日韩字 12px,其余 6.6px。宁可略宽也不要把字压出段外。
  const hitText = `${hits} 续签`
  let hitLabelW = 0
  for (const ch of hitText) hitLabelW += /[　-鿿]/.test(ch) ? 12 : 6.6
  // 刻度:0 与 100 常驻;区间两端与观测值加粗标出来(稿上就是这四个数)
  const base = [{ v: 0, strong: false }, { v: 100, strong: false }]
  const extra: { v: number; strong: boolean }[] = []
  if (band) {
    extra.push({ v: +(band.lo * 100).toFixed(1), strong: false })
    extra.push({ v: +(band.hi * 100).toFixed(1), strong: false })
  }
  extra.push({ v: +pct.toFixed(1), strong: true })
  const ticks = [...base, ...extra]
    .sort((a, b) => a.v - b.v)
    .map((t) => ({ v: t.v, x: r2(x(t.v)), label: `${Math.round(t.v)}${t.strong || t.v === 0 || t.v === 100 ? '%' : ''}`, strong: t.strong }))

  return {
    box,
    bar: { y: barY, h: barH, x: box.padL, hitW, missW, totalW },
    barLabels: {
      // 蓝段装不下就把字放到段外(深色)。续签率低的园区(实测 8/116 = 6.9%)蓝段只有几十像素,
      // 字比段还宽,压在里面会糊出段外 —— 2026-09-12 在预览图上看见的。
      hit: hitW >= hitLabelW + 16
        ? { x: r2(box.padL + 10), y: barY + barH / 2 + 4, text: hitText, inside: true }
        : { x: r2(box.padL + hitW + 8), y: barY + barH / 2 + 4, text: hitText, inside: false },
      miss: missW > 46 && hitW >= hitLabelW + 16
        ? { x: r2(box.padL + hitW + 10), y: barY + barH / 2 + 4, text: `${n - hits} 未续签` } : null,
    },
    axis: { y: axisY, x0: r2(x(0)), x1: r2(x(100)) },
    ticks,
    band: band ? {
      x: r2(x(band.lo * 100)), w: r2(x(band.hi * 100) - x(band.lo * 100)),
      loText: `${Math.round(band.lo * 100)}`, hiText: `${Math.round(band.hi * 100)}`,
    } : null,
    marker: { x: r2(x(pct)), text: `${pct.toFixed(1)}%` },
  }
}
