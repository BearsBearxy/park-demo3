import { describe, expect, it } from 'vitest'
import {
  robustSigma, shrinkSigma, blockBootstrapP, naiveNormalP, bhFdr, changePoint, classifyShape,
} from './pvMeterAna.logic'

// 显著性 / 变点 / 形状(PV-ANALYSIS-SPEC §5.3–5.4)。
// 全部用固定 seed 的确定性伪随机造夹具:同一份输入两次跑必须同一个答案,否则断言本身会闪。

/** 确定性 LCG —— 不用 Math.random,测试必须可复现 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
/** 近似标准正态(Box–Muller) */
function gauss(rnd: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd())
}
/** ρ 一阶自相关序列 */
function ar1(n: number, rho: number, sd: number, seed: number): number[] {
  const g = gauss(lcg(seed))
  const out: number[] = []
  let prev = 0
  for (let i = 0; i < n; i++) {
    prev = rho * prev + Math.sqrt(1 - rho * rho) * g()
    out.push(prev * sd)
  }
  return out
}

describe('robustSigma —— 一阶差分,对阶跃免疫', () => {
  // §5.3:直接对 r 取 MAD,基线若含故障期 → 分子 r̄ 被拉小、分母 σ 被撑大 → 双杀,
  // 结果是**越坏的楼越不报警**,检测器对最严重的资产最沉默。
  it('同一条噪声加不加 30% 阶跃,尺度估计变化 < 10%', () => {
    const base = ar1(300, 0.4, 0.08, 12345)
    const stepped = base.map((v, i) => (i >= 150 ? v - 0.3 : v))
    const a = robustSigma(base)
    const b = robustSigma(stepped)
    expect(Math.abs(b - a) / a).toBeLessThan(0.10)
  })

  it('读数取整导致差分全 0 时返回 0(由 shrinkSigma 的下限兜)', () => {
    expect(robustSigma([1, 1, 1, 1, 1])).toBe(0)
  })
})

describe('shrinkSigma —— 跨栋收缩 + 下限', () => {
  it('下限防 z=∞:站内尺度为 0 时不返回 0', () => {
    expect(shrinkSigma(0, 0, 0.01)).toBe(0.01)
  })
  it('站内与全园各半的平方平均', () => {
    expect(shrinkSigma(0.06, 0.08, 0)).toBeCloseTo(Math.sqrt(0.5 * 0.0036 + 0.5 * 0.0064), 12)
  })
})

describe('blockBootstrapP —— 单侧,两处 +1', () => {
  const baseline = ar1(400, 0.5, 0.08, 777)

  it('观测均值远低于全部零分布时 p = 1/(B+1),不是 0', () => {
    const { p, nullDist } = blockBootstrapP(baseline, -99, 20, { block: 14, B: 199, seed: 42 })
    expect(nullDist).toHaveLength(199)
    expect(p).toBeCloseTo(1 / 200, 12)
    expect(p).toBeGreaterThan(0)   // p=0 会让后面的 BH 排序失去意义
  })

  it('单侧:发电偏高不是故障 —— 观测均值远高时 p 接近 1', () => {
    const { p } = blockBootstrapP(baseline, 99, 20, { block: 14, B: 199, seed: 42 })
    expect(p).toBeGreaterThan(0.99)
  })

  it('同 seed 两次跑结果一致(确定性,可复算)', () => {
    const a = blockBootstrapP(baseline, -0.02, 20, { block: 14, B: 99, seed: 7 })
    const b = blockBootstrapP(baseline, -0.02, 20, { block: 14, B: 99, seed: 7 })
    expect(a.p).toBe(b.p)
  })

  // §5.3 的核心:光伏日残差自相关 ρ≈0.3–0.6,方差膨胀 (1+ρ)/(1−ρ)。
  // ρ=0.5 时你以为 p=0.05,实际 p=0.25 —— √N 会让 p 值乐观 1–3 个数量级。
  it('自相关序列上,块自助的 p **显著大于** √N 正态的 p', () => {
    // sd=0.08、win=30 下 obs=−0.03 → z≈−2.05,√N 认为 p≈0.02「显著」。
    // 但 ρ=0.5 的方差膨胀是 (1+ρ)/(1−ρ)=3 倍,真实的不确定性大得多。
    const b = ar1(400, 0.5, 0.08, 20260831)
    const win = 30, obs = -0.03
    const boot = blockBootstrapP(b, obs, win, { block: 18, B: 999, seed: 99 }).p
    const naive = naiveNormalP(b, obs, win)
    expect(naive).toBeLessThan(0.05)        // √N 认为「显著」
    expect(boot).toBeGreaterThan(naive * 3) // 块自助认为远没那么稳
  })
})

describe('bhFdr', () => {
  it('顺序无关:打乱后按原下标对齐结果一致', () => {
    const p = [0.001, 0.2, 0.01, 0.6, 0.04, 0.9]
    const straight = bhFdr(p, 0.05)
    const order = [3, 0, 5, 2, 4, 1]
    const shuffled = bhFdr(order.map(i => p[i]), 0.05)
    order.forEach((orig, k) => expect(shuffled[k]).toBe(straight[orig]))
  })
  it('全部很小 → 全部拒绝;全部很大 → 一个都不拒绝', () => {
    expect(bhFdr([1e-6, 1e-5, 1e-4], 0.05)).toEqual([true, true, true])
    expect(bhFdr([0.5, 0.7, 0.9], 0.05)).toEqual([false, false, false])
  })
})

describe('changePoint', () => {
  const stepAt = (n: number, at: number, drop: number, seed: number) =>
    ar1(n, 0.4, 0.05, seed).map((v, i) => (i >= at ? v - drop : v))

  it('找得到阶跃位置,且 index 落在返回的区间内', () => {
    const r = changePoint(stepAt(300, 150, 0.30, 555), { block: 14, B: 199, seed: 3 })
    expect(Math.abs(r.index - 150)).toBeLessThan(20)
    expect(r.ciLo).toBeLessThanOrEqual(r.index)
    expect(r.ciHi).toBeGreaterThanOrEqual(r.index)
  })

  // 强效应(6σ 阶跃)下区间收得很窄是**对的** —— 那种落差真就定位到天。
  // 要守的是区间有效且盖住真变点,不是「必须很宽」。
  it('强效应下区间有效且盖住真变点', () => {
    const r = changePoint(stepAt(300, 150, 0.30, 556), { block: 14, B: 99, seed: 3 })
    expect(r.ciLo).toBeLessThanOrEqual(150)
    expect(r.ciHi).toBeGreaterThanOrEqual(150)
  })

  // 中等效应(落差 ≈ 0.4σ)下区间必须**明显宽** —— 这才是「不是精确到天」那句文案的依据,
  // 也是防「区间恒等于变点本身」这种退化实现的那道门。
  it('中等效应下区间宽达两周以上', () => {
    const r = changePoint(stepAt(300, 150, 0.02, 558), { block: 14, B: 99, seed: 3 })
    expect(r.ciHi - r.ciLo).toBeGreaterThanOrEqual(14)
  })

  // §5.4:零分布必须用**循环分块**置换。逐日置换会摧毁自相关,零分布被压得过窄 ——
  // 一条纯噪声(没有任何变点)会被判成显著变点,而且**自相关越强越容易假阳**。
  // ρ=0.7 是光伏日残差的现实上界,这条就是照着那个坏情形写的。
  it('无变点的强自相关噪声上 p 不显著(逐日置换会在这里假阳)', () => {
    for (const seed of [999, 1001, 1003]) {
      const r = changePoint(ar1(400, 0.7, 0.05, seed), { block: 21, B: 199, seed: 5 })
      expect(r.p, `seed=${seed}`).toBeGreaterThan(0.05)
    }
  })

  it('两端修剪:变点不会落在最前/最后 15%', () => {
    const r = changePoint(stepAt(300, 150, 0.30, 557), { block: 14, B: 99, seed: 3, trim: 0.15 })
    expect(r.index).toBeGreaterThanOrEqual(45)
    expect(r.index).toBeLessThanOrEqual(255)
  })
})

describe('classifyShape', () => {
  const noRain = (n: number) => Array.from({ length: n }, () => false)

  it('flat:无趋势无变点', () => {
    expect(classifyShape(ar1(200, 0.3, 0.03, 11), noRain(200)).shape).toBe('flat')
  })

  it('step:阶跃,变点后斜率≈0', () => {
    const r = ar1(200, 0.3, 0.03, 12).map((v, i) => (i >= 100 ? v - 0.35 : v))
    expect(classifyShape(r, noRain(200)).shape).toBe('step')
  })

  it('ramp:显著负趋势、雨后不回弹 → 测直流侧压降,不是清洗', () => {
    const rain = Array.from({ length: 200 }, (_, i) => i % 20 === 0)
    const r = ar1(200, 0.3, 0.02, 13).map((v, i) => v - i * 0.0025)
    expect(classifyShape(r, rain).shape).toBe('ramp')
  })

  // 与 ramp 只差「雨后回不回弹」这一条,却对应完全不同的动作:
  // sawtooth → 可安排清洗;ramp → 测直流侧压降。判错了派错人。
  it('sawtooth:负趋势 + 降雨日之后跳升 → 可安排清洗', () => {
    const rain = Array.from({ length: 200 }, (_, i) => i % 20 === 0)
    const base = ar1(200, 0.3, 0.02, 14)
    let since = 0
    const r = base.map((v, i) => {
      if (i > 0 && rain[i - 1]) since = 0; else since++
      return v - since * 0.008
    })
    expect(classifyShape(r, rain).shape).toBe('sawtooth')
  })

  it('spike:单点极大,前后正常', () => {
    const r = ar1(200, 0.3, 0.03, 15)
    r[97] = -0.9
    expect(classifyShape(r, noRain(200)).shape).toBe('spike')
  })
})
