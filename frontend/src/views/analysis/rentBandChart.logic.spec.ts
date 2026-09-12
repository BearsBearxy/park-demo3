// 合约租金带自绘图的几何。量的是 SVG 路径坐标本身 —— 2026-09-12 那天两次栽在
// 「值全对、画出来是错的」,几何层的断言必须落在坐标上,不是落在配置对象上。
import { describe, it, expect } from 'vitest'
import { rentBandGeo, rentBandColsOf, rentBandGapsOf, rentBandSplitIdx, GAP_MIN_DROP_WAN, type RentBandCol, type GapInput } from './rentBandChart.logic'
import type { RentRoll } from './expiry.logic'
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
const GAP2: GapInput = { colIndex: 21, dropWan: 35.0, names: ['碧沃丰'], count: 1, endLabel: '2026-10' }

describe('rentBandGeo', () => {
  const g = () => rentBandGeo(cols(), BOX, SPLIT, [GAP])!

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
    const geo = rentBandGeo(c, BOX, SPLIT, [])!
    expect(geo.endLabels).toHaveLength(4)
    const ys = geo.endLabels.map((e) => e.y)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(12.99)
  })

  it('❗缺口批注落在缺口那一列,文案含金额、租户名与到期月', () => {
    const geo = g()
    expect(geo.gapMarks).toHaveLength(1)
    const innerW = BOX.width - BOX.padL - BOX.padR
    expect(geo.gapMarks[0].x).toBeCloseTo(BOX.padL + (innerW * GAP.colIndex) / (cols().length - 1), 1)
    expect(geo.gapMarks[0].lines[0]).toBe('−56.8 万')
    expect(geo.gapMarks[0].lines[1]).toContain('力灏 + 开利暖通')
    expect(geo.gapMarks[0].lines[1]).toContain('等 5 份')
    expect(geo.gapMarks[0].lines[2]).toContain('2026-03')
  })

  it('❗每个到期扎堆的月份都标(用户 2026-09-12)—— 不再只标最近那一个', () => {
    const geo = rentBandGeo(cols(), BOX, SPLIT, [GAP, GAP2])!
    expect(geo.gapMarks).toHaveLength(2)
    // 只有一份合同时不写「等 N 份」
    expect(geo.gapMarks[1].lines[1]).toBe('碧沃丰')
    // 按列序排,左边的先画
    expect(geo.gapMarks[0].x).toBeLessThan(geo.gapMarks[1].x)
  })

  it('❗跌幅没到阈值的到期月不标 —— 实测图上那一跌 0.1 万(约万分之五)也占了三行字', () => {
    const small: GapInput = { ...GAP2, dropWan: GAP_MIN_DROP_WAN - 0.1 }
    expect(rentBandGeo(cols(), BOX, SPLIT, [GAP, small])!.gapMarks.map((m) => m.colIndex)).toEqual([GAP.colIndex])
    // 恰好等于阈值算「够」,不是「不够」
    const just: GapInput = { ...GAP2, dropWan: GAP_MIN_DROP_WAN }
    expect(rentBandGeo(cols(), BOX, SPLIT, [GAP, just])!.gapMarks).toHaveLength(2)
  })

  it('❗气泡那一行与批注同源 —— 阈值只判一次,气泡不会替被滤掉的缺口说话', () => {
    const geo = g()
    expect(geo.gapMarks[0].colIndex).toBe(GAP.colIndex)
    expect(geo.gapMarks[0].tip).toBe('5 份到期 · −56.8 万')
  })

  it('缺口落在列外 / 那一列没有值 → 跳过,不画半条批注', () => {
    const bad: GapInput = { ...GAP, colIndex: 999 }
    expect(rentBandGeo(cols(), BOX, SPLIT, [bad])!.gapMarks).toHaveLength(0)
  })

  it('没有缺口 / 列太少 / 全空 → 不崩,该空的空', () => {
    expect(rentBandGeo(cols(), BOX, SPLIT, [])!.gapMarks).toEqual([])
    expect(rentBandGeo(null, BOX, SPLIT, [])).toBeNull()
    expect(rentBandGeo([cols()[0]], BOX, 0, [])).toBeNull()
    const blank = cols().map((c) => ({ ...c, realized: null, locked: null, mid: null, lo: null, hi: null }))
    expect(rentBandGeo(blank, BOX, SPLIT, [])).toBeNull()
  })
})

describe('rentBandColsOf / rentBandGapsOf(RentRoll → 图的入参)', () => {
  const roll = {
    history: [{ month: '2025-08', locked: 3_300_000 }, { month: '2025-09', locked: 3_200_000 }],
    months: [
      { month: '2025-10', locked: 3_120_000, renewalLo: 0, renewalMid: 120_000, renewalHi: 260_000 },
      { month: '2025-11', locked: 3_040_000, renewalLo: 20_000, renewalMid: 130_000, renewalHi: 280_000 },
    ],
    gaps: [{ monthsAway: 1, count: 3, totalRentSum: 80_000, names: ['甲', '乙'] }],
  } as unknown as RentRoll

  it('❗元→万只换一次，预测起点同时是历史末点 —— 两段在这一点接上才不断开', () => {
    const cols = rentBandColsOf(roll)
    expect(cols.map((c) => c.month)).toEqual(['2025-08', '2025-09', '2025-10', '2025-11'])
    expect(rentBandSplitIdx(roll)).toBe(2)
    expect(cols[1]).toMatchObject({ realized: 320, locked: null, mid: null })
    expect(cols[2]).toMatchObject({ realized: 312, locked: 312, mid: 324, lo: 312, hi: 338 })
    expect(cols[3].realized, '预测段只有第 0 月有已实现').toBeNull()
  })

  it('❗缺口的列下标 = 接缝 + monthsAway —— 差一格就标到旁边那个月上去了', () => {
    const [g] = rentBandGapsOf(roll)
    expect(g).toEqual({ colIndex: 3, dropWan: 8, names: ['甲', '乙'], count: 3, endLabel: '2025-11' })
  })
})
