import { describe, expect, it } from 'vitest'
import {
  acf, nEffOf, buildLab, buildSnapshot, buildDetail, MAX_ITER, TOL,
  type QualityState, type ReadingRow, type StationCfg, type SnapshotInput,
} from './pvMeterAna.logic'

// 分析工作台(二层屏「高级分析」档)。2026-08 砍过一次,连同这份 spec 一起删了 261 行;
// 现在按 v3 的类型与 buildLab 的新签名恢复。**每一张图都在防一个具体的错**,
// 所以每条断言问的都是「它防住了没有」,不是「它画出来了没有」。
//
// 与当年那版的三处不同,都是 v3 数据结构变了逼出来的:
// ① 没有 snap.congenital,alphaRows 是 buildLab 现算的 —— 「不是另一次计算」这条铁律
//    改成断 p 与抽屉 buildDetail **逐位相同**、days 取自快照残差矩阵(比对象同一性更活)。
// ② α 排序的踢人判据换成 |ledgerDiff| > crit.ledger(v3 不出「数据存疑」判词)。
// ③ 质量矩阵多了第四态 pre(未投产)。三色仍是 ok/missing/dropped。

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const pad = (n: number) => String(n).padStart(2, '0')
const doyOf = (m: number, d: number) =>
  Math.round((Date.UTC(2026, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000) + 1

interface Opts {
  nStations?: number
  months?: number[]
  rho?: number                                   // 站内残差自相关
  minStations?: number
  gen?: (i: number, m: number, d: number) => number   // 返回 0 = 该日无记录
  cap?: (i: number) => number | null
  /** 铭牌两列。**默认给成与台账一致**(200×500W = 100kWp = capKwp)→ ledgerDiff = 0 */
  panel?: (i: number) => { panelCount: number | null; panelWatt: number | null }
  metered?: (i: number) => boolean
}

function makeInput(o: Opts = {}): SnapshotInput {
  const n = o.nStations ?? 9
  const months = o.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const stations: StationCfg[] = Array.from({ length: n }, (_, i) => {
    const p = o.panel ? o.panel(i) : { panelCount: 200, panelWatt: 500 }
    return {
      id: i + 1, name: `S${i + 1}`, phase: i < 5 ? 1 : 2,
      metered: o.metered ? o.metered(i) : true,
      capKwp: o.cap ? o.cap(i) : 100,
      panelCount: p.panelCount, panelWatt: p.panelWatt,
    }
  })
  const rows: ReadingRow[] = []
  const rnd = lcg(20260831)
  const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd())
  const state = new Map<number, number>()
  for (const m of months) {
    const dim = new Date(2026, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const date = `2026-${pad(m)}-${pad(d)}`
      for (let i = 0; i < n; i++) {
        let gen = o.gen ? o.gen(i, m, d) : 400 * (1 + (d % 5) * 0.1)
        if (gen <= 0) continue
        if (o.rho) {
          const prev = state.get(i) ?? 0
          const e = o.rho * prev + Math.sqrt(1 - o.rho ** 2) * g() * 0.08
          state.set(i, e)
          gen *= Math.exp(e)
        }
        rows.push({
          stationId: i + 1, date, gen,
          selfUse: gen * 0.7, gridFeed: gen * 0.3, revenue: gen * 0.7 * 0.86, priceSnap: 0.86,
        })
      }
    }
  }
  return {
    year: 2026, gran: 'year', stations, rows, gridPrice: 0.391,
    minStations: o.minStations, today: '2027-01-01',
  }
}

const lab = (o: Opts = {}, focusId?: number) => {
  const input = makeInput(o)
  return buildLab(buildSnapshot(input), input, focusId)
}

/** 把 rows 打乱抄表顺序。polish.resid 是按 rows 插入顺序建的 Map —— 取值前不排序,时序就散了 */
function shuffle(input: SnapshotInput): SnapshotInput {
  const rnd = lcg(31337)
  const rows = [...input.rows]
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = rows[i]; rows[i] = rows[j]; rows[j] = t
  }
  return { ...input, rows }
}

/** S4 在 7/18 之后掉到 65% —— 一个真变点,用来喂 L4 零分布与「变点区间」两条断言 */
const stepGen = (i: number, m: number, d: number) =>
  400 * (1 + (d % 5) * 0.1) * (i === 3 && (m > 7 || (m === 7 && d > 18)) ? 0.65 : 1)

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

describe('工作台 · 铁律:一份数据、一次计算、一个 id', () => {
  it('lab 的 snapshotId 与第一层同一个', () => {
    const input = makeInput()
    const snap = buildSnapshot(input)
    expect(buildLab(snap, input).snapshotId).toBe(snap.id)
  })

  // 当年断的是「alphaRows 的每一行都是 snap.congenital 里那个对象」。v3 没有 snap.congenital,
  // 换成两条更活的:p 与抽屉里那次**逐位相同**,天数直接取自快照的残差矩阵。
  /**
   * 观测窗口必须跟着**显示段**走,而且这条只能钉在**值**上。
   *
   * 原来窗口写死 `slice(-30)`,数据截止 12-31 → 你看 8 月它算 12 月。
   * 屏上加了期间徽标之后我做过一次破坏验证:把窗口改回写死、**同时让徽标继续显示当段**,
   * 屏 spec 那条基于文案的断言照样绿 —— **文案断言永远验不了计算**。
   * 所以这条比对两个月份算出来的**数**:窗口真跟着段走,z 与观测值就必然不同。
   */
  /**
   * ACF 的最大滞后必须**由样本量定**,不写死 30。
   *
   * `acf()` 内部只按 `min(maxLag, n-1)` 截 —— n=31 时它照样吐到 lag 30,
   * 而 lag 30 只有**一对样本**,右半条全是噪声,偏偏图还渲染得出来。惯例是 n/4。
   * 整年 365 点时 min(30, 91) 与写死 30 同值,分不开,所以这条用**短序列**测。
   */
  // ── L5a 收敛轨迹 ──────────────────────────────────────────────────────
  // 屏上把「20 轮撞上限但末轮只挪了 1e-10」和「20 轮还在 1e-4 上下摆」分成两种结论,
  // 靠的就是 trace。**这两条钉的是 trace 本身,不是屏上那个词** —— 文案断言验不了计算。
  it('trace 逐轮记满,且 trace.length === iterations', () => {
    const pr = buildSnapshot(makeInput()).polish
    // push 排在 iter++ 之前才成立。这一行最容易在后续重构里被挪坏 —— 挪了这条立刻红。
    expect(pr.trace.length, `trace ${pr.trace.length} 轮 vs iterations ${pr.iterations}`)
      .toBe(pr.iterations)
    expect(pr.trace.length).toBeGreaterThan(0)
    expect(pr.trace.length).toBeLessThanOrEqual(MAX_ITER)
    // 双向,别只测一边:收敛 → 末轮真落到停机阈以下;没收敛 → 末轮必须还在阈上
    const last = pr.trace[pr.trace.length - 1]
    if (pr.converged) expect(last, '标了收敛,末轮却还在阈上').toBeLessThanOrEqual(TOL)
    else expect(last, '标了没收敛,末轮却已经落到阈下').toBeGreaterThan(TOL)
    // 抛光是往回收的:末轮的挪动量不该反而比首轮还大
    expect(last).toBeLessThanOrEqual(pr.trace[0])
  })

  it('两种扫描顺序各有各的轨迹 —— traceCol 不是 trace 的副本', () => {
    const l = lab()
    expect(l.convergence.trace.length).toBe(l.convergence.iterations)
    expect(l.convergence.traceCol.length).toBeGreaterThan(0)
    // 列优先那次自己没收住的话,右边斜率图的「名次挪了」就是算法故障伪装成结论。
    // 两条都要有数,且不许是同一个数组对象被塞了两遍。
    expect(l.convergence.traceCol).not.toBe(l.convergence.trace)
    expect(l.convergence.alphaGapPct).toBeGreaterThanOrEqual(0)
    // 一栋都没进矩阵时 Math.max() 吐 -Infinity,会顺着 JSON 漏到屏上的图脚。
    // 空 inPlay 得**真造一个**才咬得住 —— 健康夹具上这条永远绿。
    const none = lab({ metered: () => false })
    expect(none.convergence.names).toHaveLength(0)
    expect(Number.isFinite(none.convergence.alphaGapPct), '空矩阵吐出了 -Infinity').toBe(true)
  })

  it('ACF 的滞后上限由 n 定 —— 短序列不许画到 lag 30', () => {
    // 只给两个月 ≈ 59 天 → n/4 ≈ 14,写死 30 的话会吐到 30
    const l = lab({ months: [1, 2] })
    expect(l.acf.length).toBeGreaterThan(0)
    for (const a of l.acf) {
      const n = l.tests.find(t => t.id === a.id)?.days ?? 0
      const maxLag = a.rho.length - 1
      expect(maxLag, `${a.name}: n=${n} 却画到 lag ${maxLag} —— 滞后上限大概率还是写死的`)
        .toBeLessThanOrEqual(Math.max(1, Math.floor(n / 4)))
    }
    // 且确实比 30 短(否则这条测了个寂寞)
    expect(Math.max(...l.acf.map(a => a.rho.length - 1))).toBeLessThan(30)
  })

  it('观测窗口跟着显示段走 —— 钉在算出来的数上,不是钉在徽标文案上', () => {
    const base = makeInput({ gen: stepGen })
    const mk = (m: number) => {
      const input = { ...base, gran: 'month' as const, month: m }
      return buildLab(buildSnapshot(input), input)
    }
    const a = mk(3), b = mk(9)
    expect(a.window.label).toBe('2026-03')
    expect(b.window.label).toBe('2026-09')
    // 钉**精确值**:三月 31 天、九月 30 天。写死 `slice(-30)` 的话三月会变成 30 ——
    // 这是这个夹具上唯一一个不会被写死值蒙混过去的判别量。
    // (不拿 z 做判别:抛光残差以 0 为心,这个夹具上两个月的 z 都恰好是 0,分不开。)
    expect(a.window.n, '三月窗口不是 31 天 —— 窗口大概率还是写死的').toBe(31)
    expect(b.window.n, '九月窗口不是 30 天').toBe(30)
  })

  it('L7 的 p 与抽屉 buildDetail 那次逐位相同 —— 工作台永远不是另一次计算', () => {
    const input = makeInput({ gen: stepGen })
    const snap = buildSnapshot(input)
    const l = buildLab(snap, input)
    expect(l.tests.length).toBeGreaterThan(0)
    for (const t of l.tests) {
      const d = buildDetail(snap, t.id)
      expect(t.p, t.name).toBe(d?.cp ? d.cp.p : 1)
    }
  })

  it('有效日数取自快照的残差矩阵,不是自己重数一遍', () => {
    const input = makeInput({ rho: 0.4 })
    const snap = buildSnapshot(input)
    const l = buildLab(snap, input)
    for (const t of l.tests) expect(t.days, t.name).toBe(snap.polish.resid.get(t.id)!.size)
  })

  it('L5 的收敛读数就是快照那次抛光的,不是第二次抛光的', () => {
    const input = makeInput({ rho: 0.3 })
    const snap = buildSnapshot(input)
    const l = buildLab(snap, input)
    expect(l.convergence.iterations).toBe(snap.polish.iterations)
    expect(l.convergence.converged).toBe(snap.polish.converged)
  })
})

describe('L7 · 完整检验表', () => {
  it('逐站给出 α/z/p/q/N_eff/σ 估计方式/变点区间/有效日数', () => {
    const t = lab({ rho: 0.5 }).tests[0]
    expect(t.sigmaHow).toContain('一阶差分')
    expect(t.sigmaHow).toContain('收缩')
    expect(t.nEff).toBeGreaterThan(0)
    expect(t.days).toBeGreaterThan(0)
    expect(typeof t.q).toBe('number')
    expect(Number.isFinite(t.alphaPct)).toBe(true)
  })

  // z 用 n 的话,这一列就是那个「乐观 1~3 个数量级」的错数。
  // ⚠ 当年第一版把对照值写成 `t.z * √(n/N_eff)` —— 那是从 t.z 反推的,两边同源,
  //   怎么改实现都恒真(假绿)。拿实现自己并排给出的 zNaive 比,才是两条独立的路。
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
    const t = lab({ gen: stepGen }).tests.find(x => x.name === 'S4')!
    expect(t.cpRange).toContain('~')
  })
})

describe('L2 · 残差自相关', () => {
  it('每栋都有 ACF,长度到 lag 30', () => {
    const l = lab({ rho: 0.4 })
    expect(l.acf).toHaveLength(9)
    for (const a of l.acf) expect(a.rho).toHaveLength(31)
  })

  // 这张图是「为什么不用 √N 而用块自助」的证据 —— 它必须能把自相关量出来
  it('注入 ρ=0.6 后 ρ₁ 明显为正,且 N_eff 掉到天数以下', () => {
    const l = lab({ rho: 0.6 })
    const a = l.acf[0]
    expect(a.rho[1]).toBeGreaterThan(0.2)
    expect(a.nEff).toBeLessThan(l.tests.find(t => t.id === a.id)!.days)
  })

  // resid 是按 rows 插入顺序建的 Map。不先按日期排就直接 [...values()] 喂 ACF,
  // 时序变成「谁先抄谁在前」—— ρ₁ 会被打散,整套「用块自助不用 √N」的证据就没了
  it('抄表顺序打乱不改 ρ₁ —— 残差先按日期排序再喂 ACF', () => {
    const sorted = lab({ rho: 0.6 })
    const inp = shuffle(makeInput({ rho: 0.6 }))
    const mixed = buildLab(buildSnapshot(inp), inp)
    expect(sorted.acf[0].rho[1], '夹具前提:确实有自相关可被打散').toBeGreaterThan(0.2)
    for (const x of sorted.acf) {
      const y = mixed.acf.find(k => k.id === x.id)!
      expect(y.rho[1], x.name).toBeCloseTo(x.rho[1], 9)
      expect(y.nEff, x.name).toBeCloseTo(x.nEff, 6)
    }
  })
})

describe('L3 · 各栋残差的年内走势(模型诊断,上线前必做)', () => {
  // 有稳定年周期 = 模型缺项(季节性遮挡),**不是故障**。
  // 不做这个,春秋两季会各刷一批假变点
  it('无季节性时振幅小', () => {
    // 阈值比旧版(季度均值,0.05)放宽:月中位数只吃 ~30 天,季度均值吃 ~91 天,
    // 抽样噪声按构造更大,噪声地板就是要抬。**按实测值加余量放宽,不许退回季度均值把数字做绿**。
    for (const d of lab({ rho: 0.3 }).season) expect(d.amp ?? 0, d.name).toBeLessThan(0.09)
  })

  it('注入季节性后振幅量得出来,且不外溢到别的栋', () => {
    // 全站同相位的季节项会被 β 吸收,所以只给一个站加
    const l = lab({
      rho: 0.2,
      gen: (i, m, d) => 400 * (1 + (d % 5) * 0.1)
        * (i === 2 ? Math.exp(0.25 * Math.sin((2 * Math.PI * doyOf(m, d)) / 365)) : 1),
    })
    const s3 = l.season.find(x => x.name === 'S3')!
    expect(s3.amp!).toBeGreaterThan(0.1)
    for (const d of l.season.filter(x => x.name !== 'S3')) expect(d.amp ?? 0, d.name).toBeLessThan(s3.amp! / 2)
  })

  // 排序是这张图的杠杆:13 行的扫描退化成**看第一行**。排错了,第一眼就是错的。
  it('按年内极差降序,注入季节性那栋就是第一行', () => {
    const l = lab({
      rho: 0.2,
      gen: (i, m, d) => 400 * (1 + (d % 5) * 0.1)
        * (i === 2 ? Math.exp(0.25 * Math.sin((2 * Math.PI * doyOf(m, d)) / 365)) : 1),
    })
    expect(l.season[0].name, '季节性最重那栋没排在第一行').toBe('S3')
    const amps = l.season.map(x => x.amp).filter((v): v is number => v != null)
    expect(amps, '不是降序').toEqual([...amps].sort((a, b) => b - a))
    // null(量不出)一律排最后,不许混在中间
    const firstNull = l.season.findIndex(x => x.amp == null)
    if (firstNull >= 0) expect(l.season.slice(firstNull).every(x => x.amp == null)).toBe(true)
  })

  // **这条钉的是那个真 bug**:老写法 `[0,0,0,0].map` 给空季度返回 0 再进 Math.max/min,
  // 7 月才投产的栋拿两个凭空的 0 参与极差。以前只是图注里一个数,现在按 amp 排序会顶到第一行。
  it('只有下半年数据的栋 amp 为 null —— 空月不许当 0 参与极差', () => {
    const l = lab({ gen: (i, m) => (i === 0 && m < 7 ? 0 : 400) })
    const s1 = l.season.find(x => x.name === 'S1')!
    expect(s1.months.slice(0, 6).every(v => v == null), '上半年应该没有月中位数').toBe(true)
    expect(s1.amp, '有效月只有 6 个,量不出年内极差,不许给个数').toBeNull()
    // 但**行还在**:栋名照列、可点。少画一条线不许静默
    expect(l.season.map(x => x.name)).toContain('S1')
  })

  it('某月抄表太少 → 该月无中位数,线在那里断开,不插值', () => {
    const l = lab({ gen: (_i, m, d) => (m === 3 && d > 3 ? 0 : 400) })
    for (const r of l.season) expect(r.months[2], `${r.name} 三月只有 3 天却给出了中位数`).toBeNull()
  })

  it('常态带 = 全部进图月中位数的中间一半,且共用纵轴有地板', () => {
    const l = lab()
    expect(l.seasonBand).not.toBeNull()
    expect(l.seasonBand!.lo).toBeLessThanOrEqual(l.seasonBand!.hi)
    // 地板 0.02:模型干净时不许把 ±0.004 的噪声自适应放大成山脉
    expect(l.seasonHalf).toBeGreaterThanOrEqual(0.02)
    // 半幅必须罩得住所有画出来的点,否则线会画出行外
    const all = l.season.flatMap(r => (r.amp == null ? [] : r.months.filter((v): v is number => v != null)))
    expect(Math.max(...all.map(Math.abs))).toBeLessThanOrEqual(l.seasonHalf)
  })
})

describe('L4 · 块自助零分布', () => {
  // 让 p 值看得见,比一个 p=0.003 可信
  it('零分布给得出来,且带观测值', () => {
    const l = lab({ gen: stepGen })
    expect(l.nullDist).not.toBeNull()
    expect(l.nullDist!.dist).toHaveLength(999)
    expect(Number.isFinite(l.nullDist!.obs)).toBe(true)
  })

  it('不给 focusId 时画 p 最小那栋', () => {
    const l = lab({ gen: stepGen })
    const minP = [...l.tests].sort((a, b) => a.p - b.p)[0]
    expect(l.nullDist!.id).toBe(minP.id)
    expect(minP.name).toBe('S4')      // 夹具前提:S4 才是掉下去的那栋
  })

  // 新签名的第三个参数:零分布跟着屏上选中走
  it('给了 focusId 就画那一栋', () => {
    const l = lab({ gen: stepGen }, 7)
    expect(l.nullDist!.id).toBe(7)
    expect(l.nullDist!.name).toBe('S7')
  })
})

describe('L5 · 抛光收敛诊断', () => {
  // 行优先/列优先排名翻转 = 该结论不稳,不上报
  it('干净数据上两种扫描顺序排名一致', () => {
    const l = lab({ gen: (i, m, d) => 400 * (1 + i * 0.03) * (1 + (d % 5) * 0.1) })
    expect(l.convergence.rowRank).toEqual(l.convergence.colRank)
    expect(l.convergence.flipped).toEqual([])
  })

  // ⚠ 上面那条**测不出这个诊断有没有真跑** —— 干净数据上两种顺序本来就该一致,
  //   把 'col' 改成 'row'(等于没诊断)照样绿。这条才是活的:
  //   稀疏(每格约 25% 有数)+ 强噪声下,站间真实差异只有 1~4%,两种扫描顺序会给出不同排名。
  it('稀疏强噪声下标出排名翻转的栋', () => {
    const rnd = lcg(997)
    const A = [0.98, 0.99, 1.0, 1.005, 1.01, 1.015, 1.02, 1.03, 1.04]
    const stations: StationCfg[] = A.map((_, i) => ({
      id: i + 1, name: `S${i + 1}`, phase: 1, metered: true,
      capKwp: 100, panelCount: 200, panelWatt: 500,
    }))
    const rows: ReadingRow[] = []
    for (let d = 0; d < 280; d++) {
      const date = `2026-${pad(Math.floor(d / 28) + 1)}-${pad((d % 28) + 1)}`
      const b = 4 + (d % 7) * 0.3
      for (let i = 0; i < 9; i++) {
        if (rnd() > 0.25) continue
        const gen = A[i] * b * 100 * Math.exp((rnd() - 0.5) * 0.5)
        rows.push({
          stationId: i + 1, date, gen,
          selfUse: gen * 0.7, gridFeed: gen * 0.3, revenue: gen * 0.7 * 0.86, priceSnap: 0.86,
        })
      }
    }
    const input: SnapshotInput = {
      year: 2026, gran: 'year', stations, rows, gridPrice: 0.391,
      minStations: 2, today: '2027-01-01',
    }
    const l = buildLab(buildSnapshot(input), input)
    expect(l.convergence.rowRank).not.toEqual(l.convergence.colRank)
    expect(l.convergence.flipped.length).toBeGreaterThan(0)
  })
})

describe('L6 · 数据质量矩阵', () => {
  // 一份把三态都撞出来的夹具:
  //  · 3/10 只有两栋抄表 → 不足 minStations=3 → 那天被**整日剔除**
  //  · 4/15 全园一天都没抄 → 那是**漏抄**,不是剔除(横轴铺整段日历才看得见这一列)
  //  · S5 五月整月没抄 → 整片 missing
  const l = lab({
    gen: (i, m, d) => {
      if (m === 3 && d === 10) return i < 2 ? 400 : 0
      if (m === 4 && d === 15) return 0
      if (i === 4 && m === 5) return 0
      return 400 * (1 + (d % 5) * 0.1)
    },
  })
  const colOf = (name: string) => {
    const row = l.quality.rows.find(r => r.name === name)!
    return (date: string) => row.states[l.quality.dates.indexOf(date)]
  }

  // 色 = 正常 / 缺失 / 剔除。**没有「补齐」这一档,因为本实现从不补齐**
  // 当年没有这一条:三态必须**互斥且齐全**,一格不能既是又不是,也不能哪一格没着落
  it('三态互斥且齐全:每格恰好一种,三者之和 = 栋数 × 天数', () => {
    const tally: Record<QualityState, number> = { ok: 0, missing: 0, dropped: 0, pre: 0 }
    for (const r of l.quality.rows) for (const s of r.states) tally[s]++
    expect(tally.pre, '本夹具全部栋都是 1/1 起抄,不该有未投产格').toBe(0)
    expect(tally.ok + tally.missing + tally.dropped)
      .toBe(l.quality.rows.length * l.quality.dates.length)
    // 三档都真出现过,否则这条断言用一个恒 ok 的实现也能过
    expect(tally.ok).toBeGreaterThan(0)
    expect(tally.missing).toBeGreaterThan(0)
    expect(tally.dropped).toBeGreaterThan(0)
  })

  it('横轴是首末抄表日之间的整段日历 —— 全园没抄的那天不许从图上消失', () => {
    expect(l.quality.dates[0]).toBe('2026-01-01')
    expect(l.quality.dates[l.quality.dates.length - 1]).toBe('2026-12-31')
    expect(l.quality.dates).toHaveLength(365)
    expect(l.quality.dates).toContain('2026-04-15')
  })

  it('整日剔除 ≠ 漏抄:3/10 是 dropped,4/15 全园没抄是 missing', () => {
    expect(colOf('S1')('2026-03-10')).toBe('dropped')
    expect(l.quality.rows.every(r => r.states[l.quality.dates.indexOf('2026-04-15')] === 'missing'))
      .toBe(true)
  })

  it('缺的日子标 missing 不标 ok,别的栋同期还是 ok', () => {
    const s5 = colOf('S5')
    const may = l.quality.dates.filter(d => d.startsWith('2026-05'))
    expect(may).toHaveLength(31)
    expect(may.every(d => s5(d) === 'missing')).toBe(true)
    const s1 = colOf('S1')
    expect(may.every(d => s1(d) === 'ok')).toBe(true)
  })

  // 3ceefe0 在真数据上栽过的那一次:未投产被当成漏抄(§03.8 未到 ≠ 漏抄)
  it('投产前是第四态 pre,不是 missing', () => {
    const l2 = lab({ gen: (i, m, d) => (i === 8 && m < 6 ? 0 : 400 * (1 + (d % 5) * 0.1)) })
    const s9 = l2.quality.rows.find(r => r.name === 'S9')!
    const before = l2.quality.dates
      .map((d, k) => ({ d, s: s9.states[k] }))
      .filter(x => x.d < '2026-06-01')
    expect(before).toHaveLength(151)                       // 1/1 – 5/31
    expect(before.every(x => x.s === 'pre')).toBe(true)
    expect(s9.states).toContain('ok')
  })

  // 未装表的栋压根没进抛光矩阵。一整行 missing 会被读成「全年没抄表」—— 那是一句谎话
  it('不在模型里的栋标 inMatrix=false', () => {
    const l2 = lab({ metered: i => i !== 7 })
    const s8 = l2.quality.rows.find(r => r.name === 'S8')!
    expect(s8.inMatrix).toBe(false)
    expect(s8.states.every(s => s === 'missing')).toBe(true)
    expect(l2.quality.rows.filter(r => r.name !== 'S8').every(r => r.inMatrix)).toBe(true)
  })
})

// 真数据上撞到的:一个 +750% 的站会把 α 排序图的横轴拉到 1000%,
// 其余十几栋全挤在 0 附近 —— 这张图就废了。v3 里踢人的判据是**容量台账与铭牌不符**。
describe('L1 · α 排序把台账对不上的栋踢出去', () => {
  const withBadCap = () => lab({ cap: i => (i === 8 ? 12 : 100) })

  it('|ledgerDiff| 超过判据线的栋不进 α 排序', () => {
    const l = withBadCap()
    expect(l.alphaRows.map(r => r.name)).not.toContain('S9')
    expect(l.alphaRows).toHaveLength(8)
  })

  // 但不能静默少一行 —— 图上要说明踢了谁
  it('踢掉谁要报出来', () => {
    expect(withBadCap().alphaExcluded).toEqual(['S9'])
  })

  it('台账都对得上时一个都不踢', () => {
    const l = lab()
    expect(l.alphaExcluded).toEqual([])
    expect(l.alphaRows).toHaveLength(9)
  })

  // 板数没录 → ledgerDiff 为 null → **判不出来**。判不出来不等于判它有罪
  it('板数没录的栋放行,由 quality.noPanel 在屏上说明', () => {
    const l = lab({
      cap: i => (i === 8 ? 12 : 100),
      panel: i => (i === 8
        ? { panelCount: null, panelWatt: null }
        : { panelCount: 200, panelWatt: 500 }),
    })
    expect(l.alphaExcluded).toEqual([])
    expect(l.alphaRows.map(r => r.name)).toContain('S9')
  })

  it('α 排序按 α 升序,且带**有宽度**的块自助区间', () => {
    const rows = lab({ rho: 0.4 }).alphaRows
    for (let i = 1; i < rows.length; i++) expect(rows[i].alphaPct).toBeGreaterThanOrEqual(rows[i - 1].alphaPct)
    for (const r of rows) {
      // 只断 ciLo ≤ α ≤ ciHi 是假绿:把区间塌成点(ciLo = ciHi = α)照样过,
      // 而这张图存在的理由就是**不确定度**。所以直接断宽度大于 0。
      expect(r.ciHi - r.ciLo, r.name).toBeGreaterThan(0)
      expect(r.alphaPct, r.name).toBeGreaterThanOrEqual(r.ciLo)
      expect(r.alphaPct, r.name).toBeLessThanOrEqual(r.ciHi)
    }
  })
})
