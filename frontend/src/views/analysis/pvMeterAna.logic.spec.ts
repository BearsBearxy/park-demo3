import { describe, expect, it } from 'vitest'
import {
  specificYield, medianPolish,
  type DayRow, type StationCfg,
} from './pvMeterAna.logic'

// 光伏分栋分析公式层(PV-ANALYSIS-SPEC §05)。夹具一律**已知答案**:
// 无噪声矩阵 eff(s,d) = α(s)·β(d),取对数后是严格可加的,抛光必须精确还原。

const ln = Math.log

/** 造一个 eff = α(s)·β(d) 的无噪声矩阵。gen = eff × cap */
function grid(alphas: number[], betas: number[]): { rows: DayRow[]; stations: StationCfg[] } {
  const stations: StationCfg[] = alphas.map((_, i) => ({
    id: i + 1, name: `S${i + 1}`, capKwp: 10 * (i + 1), metered: true,
  }))
  const rows: DayRow[] = []
  alphas.forEach((a, i) => betas.forEach((b, d) => {
    rows.push({ stationId: i + 1, date: day(d), gen: a * b * stations[i].capKwp! })
  }))
  return { rows, stations }
}

const day = (d: number) => `2026-03-${String(d + 1).padStart(2, '0')}`
const med = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

// α 中位数 = 1.0,β 中位数 = 4.0 —— 便于手算期望
const ALPHAS = [0.8, 0.9, 1.0, 1.1, 1.2]
const BETAS = Array.from({ length: 30 }, (_, d) => 3.0 + (d % 5) * 0.5)   // 3.0/3.5/4.0/4.5/5.0,中位 4.0

describe('specificYield', () => {
  it('eff = 发电量 ÷ 装机容量 —— 容量不同的楼栋只有除掉容量才可比', () => {
    expect(specificYield(400, 100)).toBe(4)
    expect(specificYield(80, 20)).toBe(4)   // 两栋容量差 5 倍,eff 相同
  })
})

/** 位图:从 from 到 to 点(含)各一行 */
const span = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => 1 << (k + from)).reduce((a, b) => a | b, 0)

describe('medianPolish', () => {
  it('无噪声矩阵上精确还原 α 与 β', () => {
    const { rows, stations } = grid(ALPHAS, BETAS)
    const r = medianPolish(rows, stations, null)

    expect(r.converged).toBe(true)
    for (let i = 0; i < ALPHAS.length; i++) {
      expect(r.alpha.get(i + 1)!).toBeCloseTo(ln(ALPHAS[i]) - ln(med(ALPHAS)), 9)
    }
    for (let d = 0; d < BETAS.length; d++) {
      expect(r.beta.get(day(d))!).toBeCloseTo(ln(BETAS[d]) - ln(med(BETAS)), 9)
    }
    expect(r.mu).toBeCloseTo(ln(med(ALPHAS)) + ln(med(BETAS)), 9)
  })

  it('无噪声矩阵上残差全为 0', () => {
    const { rows, stations } = grid(ALPHAS, BETAS)
    const r = medianPolish(rows, stations, null)
    for (const byDate of r.resid.values()) {
      for (const v of byDate.values()) expect(v).toBeCloseTo(0, 9)
    }
  })

  // §5.2:可辨识性 (mu, α+c, β−c) 同解,靠 median(α)=0 / median(β)=0 锚定。
  // 只迭代 2~3 轮的话这两个约束只是近似成立,而 §5.5 的 logH 直接吃 β —— 锚定漂移会变成假趋势。
  it('显式重锚:median(α)=0 且 median(β)=0', () => {
    // 用一个抛光**不会一轮收敛**的矩阵(带扰动),逼出隐式锚定的漂移
    const { rows, stations } = grid(ALPHAS, BETAS)
    rows.forEach((r, i) => { r.gen *= 1 + ((i * 37) % 13 - 6) * 0.01 })
    const r = medianPolish(rows, stations, null)
    expect(med([...r.alpha.values()])).toBeCloseTo(0, 12)
    expect(med([...r.beta.values()])).toBeCloseTo(0, 12)
  })

  // §5.2:某站表坏报低时,均值基准会被整体拉塌 —— 于是所有站看起来都"高于基准",
  // 真正的故障站反而不报警。
  //
  // ⚠ 坏法要选对:整站恒定打折(每天都 ×0.5)会被 α 整个吸收,β 纹丝不动 —— 均值实现照样过,
  //   这么写是假绿(第一版就这么写的,换均值破坏时没红)。真正考验崩溃点的是**部分日子**的离群:
  //   9 站里 2 站在第 10~19 日 ×0.3。中位数把这 2 个离群值直接忽略;
  //   均值会让那 10 天的 β 偏 log(0.3)×2/9 ≈ −0.268 → 约 24%,过不了 5% 这道门。
  it('崩溃点:9 站里 2 站在部分日子离群,β 估计偏移 < 5%', () => {
    const a9 = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2]
    const clean = medianPolish(...Object.values(grid(a9, BETAS)) as [DayRow[], StationCfg[]], null)

    const bad = new Set(Array.from({ length: 10 }, (_, k) => day(k + 10)))
    const g = grid(a9, BETAS)
    g.rows.filter(r => r.stationId <= 2 && bad.has(r.date)).forEach(r => { r.gen *= 0.3 })
    const dirty = medianPolish(g.rows, g.stations, null)

    for (let d = 0; d < BETAS.length; d++) {
      const shift = Math.abs(dirty.beta.get(day(d))! - clean.beta.get(day(d))!)
      expect(Math.exp(shift) - 1, day(d)).toBeLessThan(0.05)
    }
  })

  // §5.1:gen=0 有两种相反含义,必须物理分开。表离线的格子**绝不能补齐** ——
  // 补了残差恒为 0,离线 10 天的楼会算出"正常"。
  it('gen<=0 的格子不进矩阵,残差里没有它(不是补成 0)', () => {
    const { rows, stations } = grid(ALPHAS, BETAS)
    const offline = new Set(['2026-03-05', '2026-03-06', '2026-03-07'])
    rows.filter(r => r.stationId === 3 && offline.has(r.date)).forEach(r => { r.gen = 0 })

    const r = medianPolish(rows, stations, null)
    const s3 = r.resid.get(3)!
    for (const d of offline) expect(s3.has(d)).toBe(false)
    expect(s3.size).toBe(BETAS.length - offline.size)
  })

  it('未装表 / 未录容量的站整站不进矩阵', () => {
    const { rows, stations } = grid(ALPHAS, BETAS)
    stations[0].metered = false
    stations[1].capKwp = null

    const r = medianPolish(rows, stations, null)
    expect(r.alpha.has(1)).toBe(false)
    expect(r.alpha.has(2)).toBe(false)
    expect(r.alpha.has(3)).toBe(true)
  })

  it('okDays 传集合时只用集合内的日子', () => {
    const { rows, stations } = grid(ALPHAS, BETAS)
    const ok = new Set([day(0), day(1), day(2), day(3), day(4)])
    const r = medianPolish(rows, stations, ok)
    expect([...r.beta.keys()].sort()).toEqual([...ok].sort())
  })
})
