import { describe, expect, it } from 'vitest'
import {
  acf, nEffOf, buildLab, buildSnapshot,
  type ReadingRow, type StationCfg, type WeatherDay, type SnapshotInput,
} from './pvMeterAna.logic'

// 分析工作台(PV-ANALYSIS-SPEC §06.4)。每一张图都在防一个具体的错,
// 所以每条断言问的都是「它防住了没有」,不是「它画出来了没有」。

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const pad = (n: number) => String(n).padStart(2, '0')

interface Opts {
  nStations?: number
  months?: number[]
  rho?: number                                   // 站内残差自相关
  season?: number                                // 年周期振幅(模拟季节性遮挡)
  gen?: (i: number, m: number, d: number) => number
  weather?: boolean
}

function makeInput(o: Opts = {}): SnapshotInput {
  const n = o.nStations ?? 9
  const months = o.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const stations: StationCfg[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1, name: `S${i + 1}`, capKwp: 100, metered: true,
  }))
  const rows: ReadingRow[] = []
  const weather: WeatherDay[] = []
  const rnd = lcg(20260831)
  const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd())
  const state = new Map<number, number>()
  let doy = 0
  for (const m of months) {
    const dim = new Date(2026, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      doy++
      const date = `2026-${pad(m)}-${pad(d)}`
      weather.push({ date, ghiKwh: 4 + (d % 5) * 0.4, rainMm: 0, isRain: d % 10 === 0, hours: 24 })
      for (let i = 0; i < n; i++) {
        let gen = o.gen ? o.gen(i, m, d) : 400 * (1 + (d % 5) * 0.1)
        if (gen <= 0) continue
        if (o.rho) {
          const prev = state.get(i) ?? 0
          const e = o.rho * prev + Math.sqrt(1 - o.rho ** 2) * g() * 0.08
          state.set(i, e)
          gen *= Math.exp(e)
        }
        if (o.season) gen *= Math.exp(o.season * Math.sin((2 * Math.PI * doy) / 365))
        rows.push({
          stationId: i + 1, date, gen,
          selfUse: gen * 0.7, gridFeed: gen * 0.3, revenue: gen * 0.7 * 0.86, priceSnap: 0.86,
        })
      }
    }
  }
  return {
    year: 2026, stations, rows,
    weather: o.weather === false ? [] : weather,
    gridPrice: 0.391,
  }
}

const lab = (o: Opts = {}) => {
  const input = makeInput(o)
  return buildLab(buildSnapshot(input), input)
}

describe('acf / nEff —— 直接体检 √N 错多少', () => {
  it('白噪声的 ρ₁ 接近 0', () => {
    const rnd = lcg(7)
    const r = Array.from({ length: 400 }, () => rnd() - 0.5)
    expect(Math.abs(acf(r, 30)[1])).toBeLessThan(0.15)
  })

  it('ρ=0.6 的序列量得出正的 ρ₁', () => {
    const rnd = lcg(11)
    const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd())
    const r: number[] = []
    let p = 0
    for (let i = 0; i < 500; i++) { p = 0.6 * p + Math.sqrt(1 - 0.36) * g(); r.push(p) }
    expect(acf(r, 30)[1]).toBeGreaterThan(0.4)
  })

  it('ρ₀ 恒为 1', () => {
    expect(acf([1, 2, 3, 2, 1, 2, 3], 3)[0]).toBeCloseTo(1, 12)
  })

  // 这个数就是「√N 到底错了多少」的量化答案
  it('自相关越强 N_eff 越小于 n', () => {
    expect(nEffOf([1, 0, 0], 300)).toBeCloseTo(300, 6)
    expect(nEffOf([1, 0.5, 0.25, 0.12], 300)).toBeLessThan(120)
  })

  it('求和截到第一个非正 ρ —— 全加会把噪声尾巴也算进去', () => {
    // 后面那串负值不该继续累加
    expect(nEffOf([1, 0.5, -0.4, 0.9, 0.9], 300)).toBeCloseTo(300 / 2, 6)
  })
})

describe('工作台 · 铁律', () => {
  // 一份数据、一次计算、一个 id。工作台**永远不是另一次计算**
  it('lab 的 snapshotId 与第一层同一个', () => {
    const input = makeInput()
    const snap = buildSnapshot(input)
    expect(buildLab(snap, input).snapshotId).toBe(snap.id)
  })

  // 要证的是「没重算」。数组本身会被过滤(踢掉数据存疑的站),所以断的是**每一行还是同一个对象**
  it('α 排序的每一行都是第一层那个对象,不是重算出来的新对象', () => {
    const input = makeInput()
    const snap = buildSnapshot(input)
    const rows = buildLab(snap, input).alphaRows
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r, r.name).toBe(snap.congenital.find(c => c.id === r.id))
  })
})

describe('A · 完整检验表', () => {
  it('逐站给出 α/z/p/q/N_eff/σ 估计方式/变点区间/有效日数', () => {
    const t = lab({ rho: 0.5 }).tests[0]
    expect(t.sigmaHow).toContain('一阶差分')
    expect(t.sigmaHow).toContain('收缩')
    expect(t.nEff).toBeGreaterThan(0)
    expect(t.days).toBeGreaterThan(0)
    expect(typeof t.q).toBe('number')
  })

  // z 用 n 的话,这一列就是那个「乐观 1~3 个数量级」的错数。
  // ⚠ 第一版把对照值写成 `t.z * √(n/N_eff)` —— 那是从 t.z 反推的,两边同源,
  //   怎么改实现都恒真(假绿)。现在拿实现自己并排给出的 zNaive 比,是两条独立的路。
  it('z 用 N_eff 不是 n —— 自相关下 |z| 严格小于按 n 算的', () => {
    const l = lab({ rho: 0.6 })
    const withAcf = l.tests.filter(t => {
      const a = l.acf.find(x => x.id === t.id)!
      return a.nEff < t.days * 0.9                 // 前提:这站确实有自相关(有效样本明显少于天数)
    })
    expect(withAcf.length, '夹具前提:至少有站量得出自相关').toBeGreaterThan(0)
    for (const t of withAcf) {
      expect(Math.abs(t.z!), t.name).toBeLessThan(Math.abs(t.zNaive!))
    }
  })

  it('变点区间给的是区间不是一个点', () => {
    const l = lab({
      gen: (i, m, d) => 400 * (1 + (d % 5) * 0.1) * (i === 3 && (m > 7 || (m === 7 && d > 18)) ? 0.65 : 1),
    })
    const t = l.tests.find(x => x.name === 'S4')!
    expect(t.cpRange).toContain('~')
  })
})

describe('B · 模型诊断(必做)', () => {
  // **上线前必做**。有稳定年周期 = 模型缺项(季节性遮挡),**不是故障**。
  // 不做这个,春秋两季会各刷一批假变点
  it('残差 vs 年积日:无季节性时振幅小', () => {
    const l = lab({ rho: 0.3 })
    for (const d of l.doy) expect(d.amp, d.name).toBeLessThan(0.05)
  })

  it('残差 vs 年积日:注入季节性后振幅量得出来', () => {
    // 全站同相位的季节项会被 β 吸收,所以只给一个站加
    const l = lab({
      rho: 0.2,
      gen: (i, m, d) => 400 * (1 + (d % 5) * 0.1)
        * (i === 2 ? Math.exp(0.25 * Math.sin((2 * Math.PI * (new Date(2026, m - 1, d).getTime()
          - Date.UTC(2026, 0, 1)) / 86400000) / 365)) : 1),
    })
    const s3 = l.doy.find(x => x.name === 'S3')!
    expect(s3.amp).toBeGreaterThan(0.1)
    // 其余站不该被带出季节性
    for (const d of l.doy.filter(x => x.name !== 'S3')) expect(d.amp, d.name).toBeLessThan(s3.amp / 2)
  })

  // 让 p 值看得见,比一个 p=0.003 可信
  it('块自助零分布给得出来,且带观测值', () => {
    const l = lab({
      gen: (i, m, d) => 400 * (1 + (d % 5) * 0.1) * (i === 3 && (m > 7 || (m === 7 && d > 18)) ? 0.65 : 1),
    })
    expect(l.nullDist).not.toBeNull()
    expect(l.nullDist!.dist.length).toBe(999)
    expect(Number.isFinite(l.nullDist!.obs)).toBe(true)
  })

  // 行优先/列优先排名翻转 = 该结论不稳,不上报
  it('收敛诊断:干净数据上两种扫描顺序排名一致', () => {
    const l = lab({
      gen: (i, m, d) => 400 * (1 + i * 0.03) * (1 + (d % 5) * 0.1),
    })
    expect(l.convergence.rowRank).toEqual(l.convergence.colRank)
    expect(l.convergence.flipped).toEqual([])
  })

  // ⚠ 上面那条**测不出这个诊断有没有真跑** —— 干净数据上两种顺序本来就该一致,
  //   把 'col' 改成 'row'(等于没诊断)照样绿。这条才是活的:
  //   稀疏(每格约 25% 有数)+ 强噪声下,站间真实差异只有 1~4%,两种扫描顺序会给出不同排名。
  //   这正是「该结论不稳,不上报」要抓的形态 —— 诊断必须把它标出来。
  it('收敛诊断:稀疏强噪声下标出排名翻转的站', () => {
    const rnd = lcg(997)
    const A = [0.98, 0.99, 1.0, 1.005, 1.01, 1.015, 1.02, 1.03, 1.04]
    const stations: StationCfg[] = A.map((_, i) => ({ id: i + 1, name: `S${i + 1}`, capKwp: 100, metered: true }))
    const rows: ReadingRow[] = []
    for (let d = 0; d < 280; d++) {
      const date = `2026-${pad(Math.floor(d / 28) + 1)}-${pad((d % 28) + 1)}`
      const b = 4 + (d % 7) * 0.3
      for (let i = 0; i < 9; i++) {
        if (rnd() > 0.25) continue
        const gen = A[i] * b * 100 * Math.exp((rnd() - 0.5) * 0.5)
        rows.push({ stationId: i + 1, date, gen, selfUse: gen * 0.7, gridFeed: gen * 0.3, revenue: gen * 0.7 * 0.86, priceSnap: 0.86 })
      }
    }
    const input: SnapshotInput = { year: 2026, stations, rows, weather: [], gridPrice: 0.391, minStations: 2 }
    const l = buildLab(buildSnapshot(input), input)
    expect(l.convergence.rowRank).not.toEqual(l.convergence.colRank)
    expect(l.convergence.flipped.length).toBeGreaterThan(0)
  })

  // 色 = 正常 / 缺失 / 剔除。**没有「补齐」这一档,因为本实现从不补齐**
  it('数据质量矩阵三档齐全,缺的日子标 missing 不标 ok', () => {
    const l = lab({
      gen: (i, m, d) => (i === 4 && m === 5 ? 0 : 400 * (1 + (d % 5) * 0.1)),
    })
    const s5 = l.quality.rows.find(r => r.name === 'S5')!
    const may = l.quality.dates.map((d, k) => ({ d, s: s5.states[k] })).filter(x => x.d.startsWith('2026-05'))
    expect(may.length).toBe(31)
    expect(may.every(x => x.s === 'missing')).toBe(true)
    // 别的站同期是 ok,不是被整片标成 dropped
    const s1 = l.quality.rows.find(r => r.name === 'S1')!
    expect(l.quality.dates.map((d, k) => ({ d, s: s1.states[k] }))
      .filter(x => x.d.startsWith('2026-05')).every(x => x.s === 'ok')).toBe(true)
  })

  it('每栋都有 ACF,长度到 lag 30', () => {
    const l = lab({ rho: 0.4 })
    expect(l.acf).toHaveLength(9)
    for (const a of l.acf) expect(a.rho).toHaveLength(31)
  })
})

describe('C · 外部锚', () => {
  it('有天气时 logH 与 kt 自检都给得出来', () => {
    const l = lab({ rho: 0.2 })
    expect(l.health.length).toBeGreaterThan(300)
    expect(typeof l.kt.suspect).toBe('boolean')
  })

  // 没有天气数据时不能假装有 —— 空着,让屏上说明白
  it('没有天气数据时 logH 为空,不编一条出来', () => {
    const l = lab({ weather: false })
    expect(l.health).toEqual([])
  })
})

// 真数据上撞到的:一个 +750% 的站会把 α 排序图的横轴拉到 1000%,
// 其余十几栋全挤在 0 附近 —— 这张图就废了。那种站已经判成「数据存疑」,不该再进性能排序。
describe('A · α 排序把数据存疑的站踢出去', () => {
  const withBadCap = () => {
    const input = makeInput({ nStations: 9 })
    input.stations[8].capKwp = 12          // S9 容量填成 1/8 → α 高得离谱
    return buildLab(buildSnapshot(input), input)
  }

  it('容量台账存疑的站不进 α 排序', () => {
    const l = withBadCap()
    expect(l.alphaRows.map(r => r.name)).not.toContain('S9')
    expect(l.alphaRows).toHaveLength(8)
  })

  // 但不能静默少一行 —— 图上要说明踢了谁
  it('踢掉谁要报出来', () => {
    expect(withBadCap().alphaExcluded).toEqual(['S9'])
  })

  it('没有存疑站时一个都不踢', () => {
    const l = lab()
    expect(l.alphaExcluded).toEqual([])
    expect(l.alphaRows).toHaveLength(9)
  })
})
