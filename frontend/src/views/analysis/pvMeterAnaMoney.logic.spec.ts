import { describe, expect, it } from 'vitest'
import {
  congenitalCheck, gapMoney, alertLevel,
  medianPolish, type DayRow, type StationCfg,
} from './pvMeterAna.logic'

/** 确定性 LCG —— 不用 Math.random,测试必须可复现 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

// 先天缺陷 / 换算成钱(PV-ANALYSIS-SPEC §5.6–5.7)。

const day = (d: number) => `2026-03-${String(d + 1).padStart(2, '0')}`

/** eff = α(s)·β(d) 的无噪声矩阵;β 可外部给定,便于造「全园一起变差」 */
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

const A9 = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2]

describe('congenitalCheck —— 先天缺陷通道', () => {
  it('α 长期垫底的站被标 suspect,建议是核对容量台账不是现场检查', () => {
    const betas = Array.from({ length: 120 }, (_, d) => 4 + (d % 5) * 0.5)
    const alphas = [1.0, 1.0, 1.0, 0.75, 1.0, 1.0, 1.0, 1.0, 1.0]   // 第 4 站长期低 25%
    const { rows, stations } = grid(alphas, betas)
    const r = congenitalCheck(medianPolish(rows, stations, null), stations)

    const s4 = r.find(x => x.name === 'S4')!
    expect(s4.suspect).toBe(true)
    expect(s4.advice).toContain('装机容量台账')
    expect(s4.advice).not.toContain('现场检查')
    expect(r.filter(x => x.suspect)).toHaveLength(1)
  })

  // §5.6:CI 必须用**块自助**算。naive SE 在 σ≈8%、365 天下约 0.4%,13 个点的 CI 互不重叠,
  // 图上会显示「每栋楼都显著不同」,用户第一反应是「你这系统天天报警」。
  //
  // 阈值 1.15 是实测定的,不是拍的:纯 AR(1)(ρ=0.5)上块自助/naive ≈ 1.5(接近理论 √3=1.73),
  // 但**抛光后**的残差只剩 ≈1.26 —— 逐日中位数 β 已经吸走了一部分共同结构。
  // 教科书那个 1.7 在这里达不到,写 1.4 会红,那是数据事实不是 bug。
  // 1.15 仍然能把「用了分块」和「没用分块」分开:block=1 时这个比值恰好是 1.00。
  it('CI 宽度显著大于 naive SE 的区间(否则就是把 naive SE 换了个名字)', () => {
    const n = 200
    const betas = Array.from({ length: n }, (_, d) => 4 + (d % 7) * 0.4)
    const { rows, stations } = grid(A9, betas)
    // 每站一条真正的 AR(1)(ρ=0.5、σ=8%)—— 现实量级。
    // ⚠ 这里必须是真自相关序列:第一版用了个只依赖常量的递推,它会收敛到不动点,
    //   残差几乎没有相关结构,块自助与 naive 自然量不出差别(假绿)。
    const state = new Map<number, number>()
    const rnd = lcg(20260831)
    const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd())
    rows.forEach((x) => {
      const prev = state.get(x.stationId) ?? 0
      const e = 0.5 * prev + Math.sqrt(1 - 0.25) * g() * 0.08
      state.set(x.stationId, e)
      x.gen *= Math.exp(e)
    })
    const polish = medianPolish(rows, stations, null)
    const r = congenitalCheck(polish, stations, { block: 14 })

    for (const row of r) {
      const resid = [...polish.resid.get(row.id)!.values()]
      const m = resid.reduce((a, b) => a + b, 0) / resid.length
      const sd = Math.sqrt(resid.reduce((a, b) => a + (b - m) ** 2, 0) / (resid.length - 1))
      // ⚠ 单位要对齐:congenitalCheck 的 ciLo/ciHi 是 (exp(log值)−1)×100,
      //   log 域的宽度乘出来会被该站自身水平 exp(α) 缩放(S1 的 α≈−20% → ×0.8)。
      //   naive 这边是裸的 log 域宽度,不缩放的话两边差一个 exp(α),比出来的是假数。
      const level = 1 + row.alphaPct / 100
      const naiveWidthPct = 2 * 1.96 * (sd / Math.sqrt(resid.length)) * 100 * level
      expect(row.ciHi - row.ciLo, row.name).toBeGreaterThan(naiveWidthPct * 1.15)
    }
  })
})

describe('gapMoney —— 按自用电价,不是上网标杆价', () => {
  // §5.7:少发的那度要从电网买回来,损失的是自用电价(0.7~1.2元分时),不是上网标杆价(0.39元)。
  // 搞错了整屏的数就是错的。
  it('用自用电价折算', () => {
    expect(gapMoney(1000, 800, 0.86)).toBeCloseTo(172, 9)
  })
  it('实发多于应发时缺口为 0,不出负数', () => {
    expect(gapMoney(800, 1000, 0.86)).toBe(0)
  })
})

describe('alertLevel —— 三重门槛', () => {
  // §5.7 本项目最重要的一条产品规则:
  // 统计上 q=0.001 但年化只差 ¥800 的变点,**绝不该出现在屏上**。
  // 「运维平台是被误报杀死的,从来不是被漏报杀死的。」
  it('统计极显著但金额不够 → ok,不是 risk', () => {
    expect(alertLevel({ q: 0.001, days: 200, annualGap: 800 })).toBe('ok')
  })
  it('三重门槛同时满足才 risk', () => {
    expect(alertLevel({ q: 0.03, days: 20, annualGap: 60000 })).toBe('risk')
  })
  it('天数不够 → 降为 watch', () => {
    expect(alertLevel({ q: 0.03, days: 10, annualGap: 60000 })).toBe('watch')
  })
  it('q 不够显著 → ok', () => {
    expect(alertLevel({ q: 0.5, days: 200, annualGap: 60000 })).toBe('ok')
  })
})

describe('congenitalCheck 的区间必须自洽', () => {
  // 抛光锚的是残差**中位数**为 0,不是均值。带阶跃的站残差是「一半 0 一半负」,
  // 均值明显为负 —— 重采样前不中心化的话,区间会整体漂到 α + mean(resid),
  // 出现「点估计 0%,区间 −23%~−12%」这种一眼假的东西(工作台 α 排序图直接崩掉可信度)。
  it('点估计落在区间内 —— 含阶跃的站也一样', () => {
    const n = 200
    const betas = Array.from({ length: n }, (_, d) => 4 + (d % 7) * 0.4)
    const { rows, stations } = grid(A9, betas)
    // S5 从第 140 天起掉 35%。**必须是非对称切分**:100/100 对称时抛光把中位锚在正中间,
    // 残差均值恰好是 0,中心化做不做都一样 —— 那样的夹具试不出这条(第一版就是那么写的,
    // 破坏时只压到了 1e-14 的浮点噪声)。140/60 下残差均值 ≈ −0.13,差别才显出来。
    rows.filter(r => r.stationId === 5).forEach((r, i) => { if (i >= 140) r.gen *= 0.65 })

    const polish = medianPolish(rows, stations, null)
    const r5 = [...polish.resid.get(5)!.values()]
    const mean5 = r5.reduce((a, b) => a + b, 0) / r5.length
    expect(Math.abs(mean5), '夹具前提:S5 残差均值必须明显偏离 0').toBeGreaterThan(0.05)

    for (const row of congenitalCheck(polish, stations)) {
      expect(row.ciLo, `${row.name} ciLo`).toBeLessThanOrEqual(row.alphaPct + 1e-9)
      expect(row.ciHi, `${row.name} ciHi`).toBeGreaterThanOrEqual(row.alphaPct - 1e-9)
    }
  })
})
