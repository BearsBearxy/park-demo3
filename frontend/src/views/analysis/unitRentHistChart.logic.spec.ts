// 单位租金对标直方图 + 续签率数轴的几何。量的是矩形/竖线的坐标本身。
import { describe, it, expect } from 'vitest'
import { unitRentHistGeo, type HistBinIn } from './unitRentHistChart.logic'
import { renewalGeo } from './renewalChart.logic'
import type { ChartBox } from './forecastChart.logic'

const BOX: ChartBox = { width: 700, height: 280, padL: 40, padR: 20, padT: 30, padB: 46 }
const STATS = { p10: 13.8, median: 22.6, p90: 34.0 }
/** 16 档,binWidth 2.5,capHi 40 —— 与 buildUnitRentHist(p90≈34.5) 出来的形状一致。 */
function bins(): HistBinIn[] {
  return Array.from({ length: 16 }, (_, i) => ({ lo: i * 2.5, hi: (i + 1) * 2.5, count: [0, 1, 2, 3, 6, 9, 12, 14, 11, 8, 6, 4, 3, 2, 1, 1][i] }))
}

describe('unitRentHistGeo', () => {
  const g = () => unitRentHistGeo(bins(), 40, 7, 150, STATS, 28.11, '鑫皇', BOX)!

  it('❗区间内外两色:只有整格落在 p10~p90 内的柱子算「内」', () => {
    const geo = g()
    for (const b of geo.bars.filter((x) => !x.overflow)) {
      expect(b.inBand, `${b.lo}~${b.hi}`).toBe(b.lo >= STATS.p10 - 1e-9 && b.hi <= STATS.p90 + 1e-9)
    }
    // 跨在边界上的那两格必须判「外」—— 半格在里半格在外,算成内就是把区间画宽了
    expect(geo.bars.find((b) => b.lo === 12.5)!.inBand).toBe(false)
    expect(geo.bars.find((b) => b.lo === 32.5)!.inBand).toBe(false)
  })

  it('❗本户竖线落在它自己的值上 —— 这张图的全部意义就在这条线的位置', () => {
    const geo = g()
    const innerW = BOX.width - BOX.padL - BOX.padR
    const xMax = 40 + 2.5   // capHi + 溢出档一格
    expect(geo.self!.x).toBeCloseTo(BOX.padL + (innerW * 28.11) / xMax, 1)
    expect(geo.self!.label).toBe('鑫皇 28.1')
  })

  it('❗p10/p90 底色块与两条虚线同一组坐标,不各算一遍', () => {
    const geo = g()
    const p10 = geo.marks.find((m) => m.kind === 'p10')!
    const p90 = geo.marks.find((m) => m.kind === 'p90')!
    expect(geo.bandRect!.x).toBeCloseTo(p10.x, 6)
    // 两处都各自 toFixed(2) 之后再相加,末位差 0.005 是舍入,不是两套算法
    expect(geo.bandRect!.x + geo.bandRect!.w).toBeCloseTo(p90.x, 1)
    expect(geo.bandCaption!.x).toBeCloseTo((p10.x + p90.x) / 2, 1)
  })

  it('❗柱子全部落在绘图区内,最高那根顶到上沿', () => {
    const geo = g()
    const base = BOX.height - BOX.padB
    for (const b of geo.bars) {
      expect(b.y).toBeGreaterThanOrEqual(BOX.padT - 0.01)
      expect(b.y + b.h).toBeLessThanOrEqual(base + 0.01)
    }
    expect(Math.min(...geo.bars.map((b) => b.y))).toBeCloseTo(BOX.padT, 1)
  })

  it('❗溢出档单列一格并写明,不混进常规档', () => {
    const geo = g()
    const of = geo.bars.filter((b) => b.overflow)
    expect(of).toHaveLength(1)
    expect(of[0].count).toBe(7)
    expect(geo.overflowNote).toBe('7 份 > 40，最高 150.0')
    expect(geo.xTicks[geo.xTicks.length - 1].label).toBe('40+')
  })

  it('无溢出 / 无 stats / 空 bins:不崩,该空的空', () => {
    const noOf = unitRentHistGeo(bins(), 40, 0, 0, STATS, 20, '甲', BOX)!
    expect(noOf.bars.some((b) => b.overflow)).toBe(false)
    expect(noOf.overflowNote).toBe('')
    const noStats = unitRentHistGeo(bins(), 40, 0, 0, null, 20, '甲', BOX)!
    expect(noStats.bandRect).toBeNull()
    expect(noStats.marks).toEqual([])
    expect(unitRentHistGeo(null, 40, 0, 0, STATS, 20, '甲', BOX)).toBeNull()
    expect(unitRentHistGeo([], 40, 0, 0, STATS, 20, '甲', BOX)).toBeNull()
  })
})

describe('renewalGeo(续签率:堆叠条 + 数轴)', () => {
  const BOX2 = { width: 560, height: 108, padL: 6, padR: 6 }
  const g = () => renewalGeo(18, 90, { lo: 0.15, hi: 0.25 }, BOX2)!

  it('❗堆叠条两段之和 = 全宽,蓝段占比 = 续签率', () => {
    const geo = g()
    expect(geo.bar.hitW + geo.bar.missW).toBeCloseTo(geo.bar.totalW, 2)
    expect(geo.bar.hitW / geo.bar.totalW).toBeCloseTo(18 / 90, 4)
    expect(geo.barLabels.hit.text).toBe('18 续签')
    expect(geo.barLabels.miss!.text).toBe('72 未续签')
  })

  it('❗数轴钉死 0~100%,观测值与区间端点落在算出来的位置上', () => {
    const geo = g()
    const x = (pct: number) => BOX2.padL + ((BOX2.width - BOX2.padL - BOX2.padR) * pct) / 100
    expect(geo.axis.x0).toBeCloseTo(x(0), 2)
    expect(geo.axis.x1).toBeCloseTo(x(100), 2)
    expect(geo.marker!.x).toBeCloseTo(x(20), 2)
    expect(geo.band!.x).toBeCloseTo(x(15), 2)
    expect(geo.band!.x + geo.band!.w).toBeCloseTo(x(25), 2)
    // 观测值那一档要加粗 —— 四个数并排时读者得一眼找到它
    expect(geo.ticks.find((t) => t.strong)!.label).toBe('20%')
  })

  it('❗蓝段太窄时不画「未续签」标签 —— 挤在一起不如不写', () => {
    const geo = renewalGeo(89, 90, null, BOX2)!
    expect(geo.barLabels.miss).toBeNull()
  })

  it('n=0 / 命中数越界 → null(不画一条没有分母的比例)', () => {
    expect(renewalGeo(0, 0, null, BOX2)).toBeNull()
    expect(renewalGeo(5, 3, null, BOX2)).toBeNull()
    expect(renewalGeo(-1, 10, null, BOX2)).toBeNull()
  })
})
