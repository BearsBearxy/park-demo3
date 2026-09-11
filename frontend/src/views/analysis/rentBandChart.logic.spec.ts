// 合约租金带自绘图的几何。量的是 SVG 路径坐标本身 —— 2026-09-12 那天两次栽在
// 「值全对、画出来是错的」,几何层的断言必须落在坐标上,不是落在配置对象上。
import { describe, it, expect } from 'vitest'
import { rentBandGeo, type RentBandCol, type GapInput } from './rentBandChart.logic'
import type { ChartBox } from './forecastChart.logic'

const BOX: ChartBox = { width: 900, height: 300, padL: 54, padR: 52, padT: 26, padB: 26 }

/** 12 个历史月(只有已实现)+ 12 个预测月(锁定/预计/上下沿),同稿上那张图。 */
function cols(): RentBandCol[] {
  const hist: RentBandCol[] = Array.from({ length: 12 }, (_, i) => ({
    month: `2025-${String(i + 1).padStart(2, '0')}`,
    realized: 330 - i * 1.5, locked: null, mid: null, lo: null, hi: null,
  }))
  const fwd: RentBandCol[] = Array.from({ length: 12 }, (_, i) => {
    const locked = 312 - i * 8
    return {
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      realized: i === 0 ? locked : null,
      locked, mid: locked + 12 + i, lo: locked + 2, hi: locked + 26 + i * 2,
    }
  })
  return [...hist, ...fwd]
}
const SPLIT = 12
const GAP: GapInput = { colIndex: 14, dropWan: 56.8, names: ['力灏', '开利暖通'], count: 5, endLabel: '2026-03' }

describe('rentBandGeo', () => {
  const g = () => rentBandGeo(cols(), BOX, SPLIT, GAP)!

  it('❗量程罩住全部五条序列 —— 少罩一样,线或带就被画到图外', () => {
    const geo = g()
    const ys: number[] = []
    const nums = (d: string) => d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []
    for (const d of [geo.realizedPath, geo.lockedPath, geo.midPath, geo.bandPath]) {
      for (const pair of nums(d)) ys.push(Number(pair.split(',')[1]))
    }
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(BOX.padT - 0.01)
    expect(Math.max(...ys)).toBeLessThanOrEqual(BOX.height - BOX.padB + 0.01)
  })

  it('❗历史段与预测段在预测起点那一列接上 —— 已实现的末点与已锁定的首点同一个 x', () => {
    const geo = g()
    expect(geo.splitX).not.toBeNull()
    // 已实现共 13 个点(12 个历史 + 起点那一个),最后一个的 x 必须等于 splitX
    const lastRealized = geo.dots[geo.dots.length - 1]
    expect(lastRealized.i).toBe(SPLIT)
    expect(lastRealized.x).toBeCloseTo(geo.splitX as number, 6)
    // 已锁定这条线从起点开始,不从图左边开始
    expect(geo.lockedPath.startsWith(`M${geo.splitX}`)).toBe(true)
  })

  it('❗预测段底色从预测起点铺到右边缘,不盖住历史段', () => {
    const geo = g()
    expect(geo.shade).not.toBeNull()
    expect(geo.shade!.x).toBeCloseTo(geo.splitX as number, 6)
    expect(geo.shade!.x + geo.shade!.w).toBeCloseTo(BOX.width - BOX.padR, 6)
  })

  it('❗右端四个数按 y 拉开 ≥13px —— 值贴得近时会叠字,这是稿上四个数并排的前提', () => {
    // 造一组上沿/预计/锁定/下沿几乎重合的末列
    const c = cols()
    const last = c[c.length - 1]
    last.locked = 200; last.mid = 200.4; last.lo = 199.6; last.hi = 200.8
    const geo = rentBandGeo(c, BOX, SPLIT, null)!
    expect(geo.endLabels).toHaveLength(4)
    const ys = geo.endLabels.map((e) => e.y)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(12.99)
  })

  it('❗缺口批注落在缺口那一列,文案含金额、租户名与到期月', () => {
    const geo = g()
    expect(geo.gapMark).not.toBeNull()
    const innerW = BOX.width - BOX.padL - BOX.padR
    expect(geo.gapMark!.x).toBeCloseTo(BOX.padL + (innerW * GAP.colIndex) / (cols().length - 1), 1)
    expect(geo.gapMark!.lines[0]).toBe('−56.8 万')
    expect(geo.gapMark!.lines[1]).toContain('力灏 + 开利暖通')
    expect(geo.gapMark!.lines[1]).toContain('等 5 份')
    expect(geo.gapMark!.lines[2]).toContain('2026-03')
  })

  it('没有缺口 / 列太少 / 全空 → 不崩,给 null 或空标注', () => {
    expect(rentBandGeo(cols(), BOX, SPLIT, null)!.gapMark).toBeNull()
    expect(rentBandGeo(null, BOX, SPLIT, null)).toBeNull()
    expect(rentBandGeo([cols()[0]], BOX, 0, null)).toBeNull()
    const blank = cols().map((c) => ({ ...c, realized: null, locked: null, mid: null, lo: null, hi: null }))
    expect(rentBandGeo(blank, BOX, SPLIT, null)).toBeNull()
  })
})
