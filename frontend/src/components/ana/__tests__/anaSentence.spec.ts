import { describe, it, expect } from 'vitest'
import { sForecast, sPeer, sAchieve, sShare, sRisk, sThin, sFreq } from '../anaSentence'

const len = (s: string | null) => (s == null ? 0 : [...s].length)

describe('一句话结论模板(FORECAST §3.3/§3.4)', () => {
  it('❗预测区间:样本外回测 < 5 次 → 闭嘴(改用 sFreq)', () => {
    expect(sForecast({ period: '12月', label: '收入', value: 78, p: 80, lo: 70, hi: 86, backtests: 4 }))
      .toBeNull()
  })

  it('❗预测区间:回测 ≥ 5 次时出句,字数 ≤30', () => {
    const s = sForecast({ period: '12月', label: '收入', value: 78, p: 80, lo: 70, hi: 86, backtests: 5 })
    expect(len(s)).toBeLessThanOrEqual(30)
  })

  it('❗同类对标:n < 20 不给区间,只报样本量', () => {
    expect(sPeer({ name: '金纳', value: 7712, pct: 90, lo: 3000, hi: 9000, n: 19 }))
      .toBe('金纳 ¥7,712，同类样本 19 户，不给区间')
  })

  it('❗同类对标:20 ≤ n < 100 画带但不出百分数(D3 三档)', () => {
    const s = sPeer({ name: '金纳', value: 7712, pct: 90, lo: 3000, hi: 9000, n: 50 })
    expect(s).not.toMatch(/%/)
    expect(s).toContain('高于同类中位数')
    expect(len(s)).toBeLessThanOrEqual(34)
  })

  it('❗同类对标:n = 20 边界 → 落入 20-99 档', () => {
    expect(sPeer({ name: '金纳', value: 7712, pct: 90, lo: 3000, hi: 9000, n: 20 }))
      .toBe('金纳 ¥7,712，高于同类中位数')
  })

  it('❗同类对标:n = 100 边界 → 落入 ≥100 档', () => {
    expect(sPeer({ name: '金纳', value: 7712, pct: 90, lo: 3000, hi: 9000, n: 100 }))
      .toBe('金纳比 90% 的同类高，中间一半在 ¥3,000 ~ ¥9,000')
  })

  it('❗同类对标:n ≥ 100 才准写百分数,且句子里写「中间一半」不写「80%」', () => {
    const s = sPeer({ name: '金纳', value: 7712, pct: 90, lo: 3000, hi: 9000, n: 251 })
    expect(s).toContain('比 90% 的同类高')
    expect(s).toContain('中间一半')
    expect(s).not.toContain('80%')
    expect(len(s)).toBeLessThanOrEqual(34)
  })

  it('❗达成偏离:在阈值内 → 闭嘴(返回 null),不是返回「无偏离」', () => {
    expect(sAchieve({ label: '预算达成', value: 100.4, target: '预算', gapPct: 0.4, th: 1 })).toBeNull()
  })

  it('❗达成偏离:超阈值 → 出句,字数 ≤22', () => {
    const s = sAchieve({ label: '预算达成', value: 100.4, target: '预算', gapPct: 5.6, th: 1 })
    expect(s).toBe('预算达成 100.4%，离预算 5.6%')
    expect(len(s)).toBeLessThanOrEqual(22)
  })

  it('❗达成偏离:gapPct === th 边界 → 出句,不是闭嘴', () => {
    expect(sAchieve({ label: '预算达成', value: 100.4, target: '预算', gapPct: 1, th: 1 }))
      .toBe('预算达成 100.4%，离预算 1%')
  })

  it('❗结构占比:最大项 < 30% → 闭嘴', () => {
    expect(sShare({ n: 3, pct: 62, maxPct: 22 })).toBeNull()
  })

  it('❗结构占比:最大项 ≥ 30% → 出句,字数 ≤16', () => {
    const s = sShare({ n: 3, pct: 62, maxPct: 62 })
    expect(s).toBe('前 3 项占 62%')
    expect(len(s)).toBeLessThanOrEqual(16)
  })

  it('❗风险:无命中 → 闭嘴,且不许写「无异常」', () => {
    expect(sRisk({ n: 0, amount: 0, k: 3, pct: 0 })).toBeNull()
  })

  it('❗风险:有命中 → 出句,字数 ≤24', () => {
    const s = sRisk({ n: 5, amount: 12000, k: 3, pct: 65 })
    expect(s).toBe('5 户欠 ¥12,000，前 3 户占 65%')
    expect(len(s)).toBeLessThanOrEqual(24)
  })

  it('❗数据不足:永不省略', () => {
    expect(sThin({ label: '资产负债', n: 2, cannot: '画不了趋势' }))
      .toBe('资产负债只有 2 期，画不了趋势')
  })

  it('❗频次句(D4):回测 < 5 次 → 闭嘴,不画带只出点', () => {
    expect(sFreq({ label: '园区收入', lo: 700, hi: 780, backtests: 4, hits: 2 })).toBeNull()
  })

  it('❗频次句:够 5 次时写原话不写百分比 —— 月度序列一律不许标概率', () => {
    const s = sFreq({ label: '园区收入', lo: 700, hi: 780, backtests: 5, hits: 2 })
    expect(s).toBe('园区收入拟合区间 700~780，过去 5 次中 2 次')
    expect(s).not.toMatch(/%/)
    expect(len(s)).toBeLessThanOrEqual(30)
  })
})
