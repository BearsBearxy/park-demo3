// 光伏分栋分析 · 公式层(PV-ANALYSIS-SPEC §05)。全部纯函数:无 Vue 依赖、无 IO、可单测。
// 口径:eff(s,d) = 发电量 ÷ 装机容量(kWh/kWp);模型 eff = α(s)·β(d)·ε,取对数变可加,
// 用 Tukey 中位数抛光分离「这栋楼一贯的水平」α 与「当天的天气」β。单测 pvMeterAna.logic.spec.ts。
//
// 13 站 × 365 日 ≈ 4700 个点。实测整条 buildSnapshot(抛光 + 逐站变点检验 B=999 + 形状 BIC)
// 约 **100ms**,确实是设计稿说的毫秒级 —— 但那是把变点扫描换成前缀和之后的数:
// 逐点重算合并方差时是 837ms,B 还只有 199。见 pooledTScanner 的注释。

// ── 类型 ───────────────────────────────────────────────────────────────
export interface DayRow { stationId: number; date: string; gen: number }
export interface StationCfg {
  id: number; name: string
  phase: number
  metered: boolean
  capKwp: number | null      // 台账装机 kWp
  panelCount: number | null  // 板数
  panelWatt: number | null   // 单块标称功率 W
}

// ── 基本量 ─────────────────────────────────────────────────────────────

/** 等效小时 eff = 发电量 ÷ 装机容量(kWh/kWp)。装机容量不同的楼栋只有除掉容量才可比。 */
export function specificYield(gen: number, capKwp: number): number { return gen / capKwp }

// ── 中位数抛光 ─────────────────────────────────────────────────────────
export interface PolishResult {
  mu: number
  alpha: Map<number, number>               // log 域,站固有水平
  beta: Map<string, number>                // log 域,当日天气
  resid: Map<number, Map<string, number>>  // 残差(只含真正进了矩阵的格子)
  iterations: number
  converged: boolean
}

const MAX_ITER = 20
const TOL = 1e-12

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

/**
 * Tukey 中位数抛光。迭代到收敛,**显式重锚** —— 不要依赖迭代的隐式性质。
 *
 * 为什么用中位数不用最小二乘:某站表坏报低时,均值基准会被整体拉塌,
 * 于是所有站看起来都「高于基准」,真正的故障站反而不报警。
 *
 * 可辨识性:(mu, α+c, β−c) 是同一个解,靠 median(α)=0 / median(β)=0 锚定。
 * 迭代只跑两三轮的话这两个约束只是**近似**成立,而逐月偏离矩阵直接吃 β ——
 * 锚定漂移会原样变成一条假的全园趋势。所以收敛后再显式减一次中位数。
 *
 * @param okDays 允许进矩阵的日期;传 null = 全收。**只用来剔「当日在网站数不足」的日子**,
 *              不允许拿它做任何跟发电量有关的过滤 —— 那等于优先删掉故障楼的故障日。
 * @param order 扫描顺序。默认行优先;工作台的收敛诊断会用 'col' 再跑一次 ——
 *              两种顺序下 α 排名若翻转,说明该结论**不稳,不上报**(§06.4 B 组)
 */
export function medianPolish(
  rows: DayRow[], stations: StationCfg[], okDays: Set<string> | null,
  order: 'row' | 'col' = 'row',
): PolishResult {
  // 1) 建 log(eff) 矩阵。跳过:未装表 / 未录容量 / 不在允许日 / gen<=0。
  //    gen<=0 的格子**绝不补齐** —— 补了残差恒为 0,离线 10 天的楼会算出「正常」(§5.1)。
  const cap = new Map<number, number>()
  for (const s of stations) if (s.metered && s.capKwp != null && s.capKwp > 0) cap.set(s.id, s.capKwp)

  const cell = new Map<number, Map<string, number>>()   // 站 → 日 → log(eff)
  const dates = new Set<string>()
  for (const r of rows) {
    const c = cap.get(r.stationId)
    if (c === undefined) continue
    if (okDays && !okDays.has(r.date)) continue
    if (!(r.gen > 0)) continue
    let byDate = cell.get(r.stationId)
    if (!byDate) { byDate = new Map(); cell.set(r.stationId, byDate) }
    byDate.set(r.date, Math.log(specificYield(r.gen, c)))
    dates.add(r.date)
  }

  const sids = [...cell.keys()]
  const alpha = new Map<number, number>(sids.map(s => [s, 0]))
  const beta = new Map<string, number>([...dates].map(d => [d, 0]))
  let mu = 0

  // 2) 行中位数 / 列中位数交替扫,直到不再动
  let iter = 0
  for (; iter < MAX_ITER; iter++) {
    let maxDelta = 0

    // 行(站):把该站残差的中位数挪进 α;行扫完把 α 的中位数收进 mu
    // (保持 median(α)=0 的形态,列扫才不会来回摆)
    const sweepRow = () => {
      for (const s of sids) {
        const byDate = cell.get(s)!
        const rs: number[] = []
        for (const [d, v] of byDate) rs.push(v - mu - alpha.get(s)! - beta.get(d)!)
        const m = median(rs)
        alpha.set(s, alpha.get(s)! + m)
        maxDelta = Math.max(maxDelta, Math.abs(m))
      }
      const ma = median([...alpha.values()])
      if (ma !== 0) { mu += ma; for (const s of sids) alpha.set(s, alpha.get(s)! - ma) }
    }
    // 列(日):把该日残差的中位数挪进 β
    const sweepCol = () => {
      for (const d of dates) {
        const rs: number[] = []
        for (const s of sids) {
          const v = cell.get(s)!.get(d)
          if (v !== undefined) rs.push(v - mu - alpha.get(s)! - beta.get(d)!)
        }
        const m = median(rs)
        beta.set(d, beta.get(d)! + m)
        maxDelta = Math.max(maxDelta, Math.abs(m))
      }
      const mb = median([...beta.values()])
      if (mb !== 0) { mu += mb; for (const d of dates) beta.set(d, beta.get(d)! - mb) }
    }
    if (order === 'row') { sweepRow(); sweepCol() } else { sweepCol(); sweepRow() }

    if (maxDelta <= TOL) { iter++; break }
  }

  // 重锚不在这里补一遍:循环里**每一轮末尾**都收拢过一次(见上面的 ma/mb 两处),
  // 无论从 break 还是 MAX_ITER 出来,median(α)=median(β)=0 都已成立。
  // 早先在这里放过一块「收尾重锚」,破坏验证时发现注掉它一条断言都不红 —— 是死代码,删了。

  // 3) 残差
  const resid = new Map<number, Map<string, number>>()
  for (const s of sids) {
    const byDate = cell.get(s)!
    const out = new Map<string, number>()
    for (const [d, v] of byDate) out.set(d, v - mu - alpha.get(s)! - beta.get(d)!)
    resid.set(s, out)
  }

  return { mu, alpha, beta, resid, iterations: iter, converged: iter < MAX_ITER }
}

// ── 显著性(PV-ANALYSIS-SPEC §5.3)──────────────────────────────────────
// 单测 pvMeterAnaTest.logic.spec.ts。

/**
 * 稳健尺度:用**一阶差分**估噪声,对阶跃和慢漂移几乎免疫。
 *
 * 直接对 r 取 MAD 的话,基线若含故障期 → 分子 r̄ 被拉小、分母 σ 被撑大 → 双杀,
 * 结果是**越坏的楼越不报警**,检测器对最严重的资产最沉默。
 * ÷√2 是因为一阶差分的方差是原序列的 2 倍(相邻独立时)。
 */
export function robustSigma(r: number[]): number {
  if (r.length < 2) return 0
  const d = r.slice(1).map((v, i) => v - r[i])
  return 1.4826 * median(d.map(Math.abs)) / Math.SQRT2
}

/** 跨栋收缩 + 下限。13 栋是免费信息;下限防电表读数取整导致 MAD=0 → z=∞。 */
export function shrinkSigma(sigmaS: number, sigmaPool: number, floor: number): number {
  return Math.max(Math.sqrt(0.5 * sigmaS ** 2 + 0.5 * sigmaPool ** 2), floor)
}

/** 确定性 LCG。**不用 Math.random** —— 同一份数据两次打开屏必须给同一个 p,否则用户会以为系统在乱跳。 */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/**
 * 循环分块自助。块长 = 去相关时间的 2~3 倍(光伏取 14~21 天),一套机械同时吸收
 * 自相关、异方差、非正态。
 *
 * **单侧** —— 发电偏高几乎从不是故障;正侧偏离归类为「数据质量告警」
 * (表重复计量 / 容量台账错 / 镜像伪影),不是性能告警。
 *
 * p = (1 + #{null <= obsMean}) / (B + 1) —— 两处 +1 不是洁癖:省掉会得到 p=0,
 * 而 p=0 会让后面的 BH 排序失去意义。
 */
export function blockBootstrapP(
  baseline: number[], obsMean: number, winLen: number,
  opts: { block?: number; B?: number; seed?: number } = {},
): { p: number; nullDist: number[] } {
  const block = Math.max(1, opts.block ?? 14)
  const B = opts.B ?? 999
  const rnd = lcg(opts.seed ?? 20260831)
  const n = baseline.length
  const nullDist: number[] = []
  if (n === 0 || winLen <= 0) return { p: 1, nullDist }

  for (let b = 0; b < B; b++) {
    let sum = 0
    let filled = 0
    while (filled < winLen) {
      const start = Math.floor(rnd() * n)          // 循环分块:块可以跨过序列末尾绕回开头
      const take = Math.min(block, winLen - filled)
      for (let k = 0; k < take; k++) sum += baseline[(start + k) % n]
      filled += take
    }
    nullDist.push(sum / winLen)
  }
  const le = nullDist.reduce((c, v) => c + (v <= obsMean ? 1 : 0), 0)
  return { p: (1 + le) / (B + 1), nullDist }
}

/**
 * √N 正态 p —— **只用于工作台里跟块自助并排展示差多少**,绝不参与判定。
 * 光伏日残差 ρ≈0.5 时它报 p=0.05,实际是 0.25。
 */
export function naiveNormalP(baseline: number[], obsMean: number, winLen: number): number {
  const n = baseline.length
  if (n < 2 || winLen <= 0) return 1
  const m = baseline.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1))
  if (sd === 0) return 1
  const z = (obsMean - m) * Math.sqrt(winLen) / sd
  return normCdf(z)   // 单侧下尾,与块自助同口径
}

/** 标准正态 CDF(Abramowitz–Stegun 7.1.26 的误差函数近似,精度 1.5e-7,够用) */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp(-z * z / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z < 0 ? p : 1 - p
}

/**
 * Benjamini–Hochberg。**注意族的大小**:不是 13 个检验,是 13栋 × 窗口数 × 统计量数。
 * 调用方须**预注册**每栋一个主窗口 + 一个主统计量,其余标为描述性、不参与判定。
 * 返回值按**入参下标**对齐(内部排序不影响外部顺序)。
 */
export function bhFdr(pvals: number[], q = 0.05): boolean[] {
  const n = pvals.length
  const out = new Array<boolean>(n).fill(false)
  if (!n) return out
  const idx = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  let kMax = -1
  for (let k = 0; k < n; k++) if (idx[k].p <= ((k + 1) / n) * q) kMax = k
  for (let k = 0; k <= kMax; k++) out[idx[k].i] = true
  return out
}

// ── 变点与形状(PV-ANALYSIS-SPEC §5.4)──────────────────────────────────

export interface ChangePoint {
  index: number
  ciLo: number
  ciHi: number
  p: number
  dropPct: number
}

/**
 * 合并方差下的两段 t 统计量,**前缀和版**。**不用 Welch** —— 短段方差估计不稳,边界直接爆。
 *
 * 为什么要前缀和:变点扫描要对每个切点各算一次 t,而零分布又要把整趟扫描重复 B 次。
 * 逐点重算是 O(切点 × n),365 天 × 250 个切点 = 9 万次运算/趟,B=999 时一个站就是 9 千万次
 * (实测整屏 837ms,全压在这里)。前缀和让每个切点 O(1),一趟降到 O(n),快两个数量级。
 * 平方和求方差在数值上不如两遍法稳,但这里的量级(残差 ~0.1)离精度悬崖很远,够用。
 */
function pooledTScanner(r: number[]): (cut: number) => number {
  const n = r.length
  const S = new Float64Array(n + 1)
  const Q = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) { S[i + 1] = S[i] + r[i]; Q[i + 1] = Q[i] + r[i] * r[i] }
  return (cut: number): number => {
    const n1 = cut, n2 = n - cut
    if (n1 < 2 || n2 < 2) return 0
    const s1 = S[cut], s2 = S[n] - S[cut]
    const m1 = s1 / n1, m2 = s2 / n2
    const v1 = Q[cut] - (s1 * s1) / n1
    const v2 = (Q[n] - Q[cut]) - (s2 * s2) / n2
    const sp2 = (v1 + v2) / (n - 2)
    if (sp2 <= 0) return 0
    return (m2 - m1) / Math.sqrt(sp2 * (1 / n1 + 1 / n2))
  }
}

/** 循环分块置换一条序列。**逐日置换会摧毁自相关**,零分布被压得过窄,比不置换还激进。 */
function blockPermute(r: number[], block: number, rnd: () => number): number[] {
  const n = r.length
  const out: number[] = []
  while (out.length < n) {
    const start = Math.floor(rnd() * n)
    for (let k = 0; k < block && out.length < n; k++) out.push(r[(start + k) % n])
  }
  return out
}

/**
 * 单变点扫描。max|t| **不服从 t 分布**(是布朗桥型极值分布),直接查 t 表虚警率从 5% 飙到 40%+,
 * 所以零分布用循环分块置换现算。
 *
 * 两端修剪 15%:边界处一段只有几个点,t 统计量会无意义地爆掉。
 *
 * ciLo/ciHi **必须给** —— argmax 有赢家诅咒,中等效应下 95% CI 常有 ±3~4 周。
 * 区间取 |t| 在极大值 2 个单位以内的那一段(profile 法,便宜且够用)。
 *
 * ⚠ 区间宽度是**效应强度的函数**:6σ 的阶跃真就定位到一两天,此时 ciLo≈ciHi 是正确结果,
 *   不要在这里补一个「至少 ±N 天」的下限 —— 那是往数据里掺假。
 *   要负责的是**界面**:窄区间照实写日期,宽区间必须写成「7 月中旬 · 区间 7/11–7/26 — 不是精确到天」。
 *   第二层的变点标注按 ciHi−ciLo 选措辞,不要固定一种(§06.2)。
 *
 * dropPct 用**样本分割**去偏:奇数日找变点、偶数日估落差 —— 同一批数据既选点又估幅度会高估。
 */
export function changePoint(
  r: number[], opts: { block?: number; B?: number; seed?: number; trim?: number } = {},
): ChangePoint {
  const n = r.length
  const trim = opts.trim ?? 0.15
  const block = Math.max(1, opts.block ?? 14)
  const B = opts.B ?? 999
  const lo = Math.max(2, Math.floor(n * trim))
  const hi = Math.min(n - 2, Math.ceil(n * (1 - trim)))
  const empty: ChangePoint = { index: -1, ciLo: -1, ciHi: -1, p: 1, dropPct: 0 }
  if (hi <= lo) return empty

  const tOf = (series: number[]) => {
    const t1 = pooledTScanner(series)
    let best = 0, at = -1
    const ts: number[] = new Array(n).fill(0)
    for (let c = lo; c <= hi; c++) {
      const t = Math.abs(t1(c))
      ts[c] = t
      if (t > best) { best = t; at = c }
    }
    return { best, at, ts }
  }

  const obs = tOf(r)
  if (obs.at < 0) return empty

  // 置换次数决定 p 的**下限**:B 次置换下 p 最小是 1/(B+1)。
  // 这个下限会直接卡死红灯 —— BH 在 n 个站的族里要求 p ≤ q/n,n=11、q=0.05 时是 0.00455,
  // 而 B=199 的下限是 0.005,**结构上永远够不到**。实测:种入的 −28% 阶跃 p=0.005、
  // 落差 26.9%、年化 ¥21 万,各项都对,却因为 q=0.055 只能判黄灯(§08 验收① 过不了)。
  //
  // 所以 B 提到 999(下限 0.001)。为了不让代价跟着涨 5 倍,加**提前终止**:
  // 一旦已经有 earlyGe 次置换打平或超过观测值,p 必然远高于任何门槛,再算下去不改变结论。
  // 没信号的站几十次就停,只有真有信号的那栋才付满额 —— 总开销反而比原来低。
  const rnd = lcg(opts.seed ?? 20260831)
  const earlyGe = 30
  let ge = 0
  let done = 0
  for (let b = 0; b < B; b++) {
    done = b + 1
    if (tOf(blockPermute(r, block, rnd)).best >= obs.best) ge++
    if (ge >= earlyGe) break
  }
  // 提前停时用**实际跑过的次数**算 p:这时 p 已经大得没有悬念,精度无所谓,但不能拿 B 当分母充数
  const p = (1 + ge) / (done + 1)

  // profile 区间:|t| 掉不到极大值 2 个单位以内的那一段
  const thr = obs.best - 2
  let ciLo = obs.at, ciHi = obs.at
  for (let c = obs.at; c >= lo && obs.ts[c] >= thr; c--) ciLo = c
  for (let c = obs.at; c <= hi && obs.ts[c] >= thr; c++) ciHi = c

  // 样本分割去偏:偶数下标估落差
  const even = r.filter((_, i) => i % 2 === 0)
  const cutEven = Math.round(obs.at / 2)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const before = mean(even.slice(0, cutEven))
  const after = mean(even.slice(cutEven))
  // 残差在 log 域,落差换成百分比
  const dropPct = (1 - Math.exp(after - before)) * 100

  return { index: obs.at, ciLo, ciHi, p, dropPct }
}

// ── 绝对基准通道(PV-ANALYSIS-SPEC §03.5)────────────────────────────────
//
// 抛光只看**相对**:α 吸走「这栋一贯的水平」,β 吸走「今天的天气」,于是两件事结构性看不见 ——
// 全园一起变差(共模劣化被 β 整个吃掉),以及一直就差的楼(水平被 α 整个吃掉)。
// 这条通道就是补那两个盲区的:分母不从发电量来,而从**铭牌**来。

/** 理论装机 kWp = 板数 × 单块标称功率 ÷ 1000。两列任一为空返回 null —— 那栋不出绝对量。 */
export function theoreticalKwp(st: StationCfg): number | null {
  return st.panelCount != null && st.panelWatt != null && st.panelCount > 0 && st.panelWatt > 0
    ? (st.panelCount * st.panelWatt) / 1000
    : null
}

/** 年等效小时 = Σ发电 ÷ 分母。分母为 0/空时返回 null,不返回 Infinity。 */
export function annualYieldHours(genTotal: number, denomKwp: number | null): number | null {
  return denomKwp != null && denomKwp > 0 ? genTotal / denomKwp : null
}

// ── 逐月量(PV-ANALYSIS-SPEC §03.4)──────────────────────────────────────

/** Huber 稳健回归 y = a + b·x。IRLS,单点撬不动斜率。返回斜率、标准误、R²、样本数。 */
function huberFit(x: number[], y: number[]): { a: number; b: number; se: number; r2: number; n: number } {
  const n = x.length
  if (n < 3) return { a: 0, b: 0, se: Infinity, r2: 0, n }
  let w = new Array(n).fill(1)
  let a = 0, b = 0
  for (let iter = 0; iter < 12; iter++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
    for (let i = 0; i < n; i++) {
      sw += w[i]; sx += w[i] * x[i]; sy += w[i] * y[i]
      sxx += w[i] * x[i] * x[i]; sxy += w[i] * x[i] * y[i]
    }
    const den = sw * sxx - sx * sx
    if (!(Math.abs(den) > 1e-12)) break
    b = (sw * sxy - sx * sy) / den
    a = (sy - b * sx) / sw
    const res = x.map((xi, i) => y[i] - (a + b * xi))
    const s = median(res.map(Math.abs)) * 1.4826 || 1e-9
    const k = 1.345 * s
    const nw = res.map(r => (Math.abs(r) <= k ? 1 : k / Math.abs(r)))
    const delta = nw.reduce((t, v, i) => t + Math.abs(v - w[i]), 0)
    w = nw
    if (delta < 1e-8) break
  }
  // 标准误与 R² 用**加权**残差,与拟合同一口径
  const res = x.map((xi, i) => y[i] - (a + b * xi))
  let sw = 0, sx = 0, sxx = 0, sse = 0
  for (let i = 0; i < n; i++) { sw += w[i]; sx += w[i] * x[i]; sxx += w[i] * x[i] * x[i]; sse += w[i] * res[i] * res[i] }
  const sxxC = sxx - (sx * sx) / sw
  const se = n > 2 && sxxC > 1e-12 ? Math.sqrt(sse / (n - 2) / sxxC) : Infinity
  const ybar = y.reduce((t, v, i) => t + w[i] * v, 0) / sw
  const sst = y.reduce((t, v, i) => t + w[i] * (v - ybar) ** 2, 0)
  return { a, b, se, r2: sst > 1e-12 ? Math.max(0, 1 - sse / sst) : 0, n }
}

export interface SlopeRow { key: string; beta: number; se: number; r2: number; n: number }

/**
 * 逐栋(逐月)响应斜率:log gen = α + β·f(d) + ε,f = 全园当日 log 因子(抛光的 β)。
 * β = 1 表示与全园同步涨落;β < 1 = 好天涨得少;β > 1 = 坏天跌得更狠。
 *
 * 后三个返回值(se / r2 / n)决定图上误差带画多宽 —— **样本少的月带子要宽到肉眼可见**,
 * 把「读不出东西」也画出来,而不是画一条看起来很确定的线。
 */
export function responseSlopes(
  rows: DayRow[], polish: PolishResult, stations: StationCfg[], by: 'year' | 'month' = 'month',
): Map<number, SlopeRow[]> {
  const out = new Map<number, SlopeRow[]>()
  const genOf = new Map<number, Map<string, number>>()
  for (const r of rows) {
    if (!(r.gen > 0)) continue
    let m = genOf.get(r.stationId)
    if (!m) { m = new Map(); genOf.set(r.stationId, m) }
    m.set(r.date, r.gen)
  }
  for (const s of stations) {
    const g = genOf.get(s.id)
    if (!g) { out.set(s.id, []); continue }
    const buckets = new Map<string, { x: number[]; y: number[] }>()
    for (const [date, gen] of g) {
      const f = polish.beta.get(date)
      if (f === undefined) continue
      const key = by === 'year' ? date.slice(0, 4) : YM(date)
      let bk = buckets.get(key)
      if (!bk) { bk = { x: [], y: [] }; buckets.set(key, bk) }
      bk.x.push(f)
      bk.y.push(Math.log(gen))
    }
    out.set(s.id, [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, bk]) => {
        const f = huberFit(bk.x, bk.y)
        return { key, beta: f.b, se: f.se, r2: f.r2, n: f.n }
      }))
  }
  return out
}

/**
 * 逐栋逐月稳健离散度(给 M2 方差热力矩阵)。一阶差分 MAD ÷ √2 ——
 * 对阶跃和慢漂移几乎免疫,量的是**抖动**不是趋势。缓慢漂移归 S2 样条与 M4 控制图管。
 * 不足 4 天的月返回 null:三个点算不出稳健尺度,画成 0 会看起来「特别稳」。
 */
export function monthlyDispersion(polish: PolishResult): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>()
  for (const [id, byDate] of polish.resid) {
    const byYm = new Map<string, { d: string; v: number }[]>()
    for (const [d, v] of byDate) {
      const k = YM(d)
      const a = byYm.get(k) ?? []
      a.push({ d, v }); byYm.set(k, a)
    }
    const m = new Map<string, number>()
    for (const [k, arr] of byYm) {
      if (arr.length < 4) continue
      arr.sort((a, b) => a.d.localeCompare(b.d))
      m.set(k, robustSigma(arr.map(x => x.v)))
    }
    out.set(id, m)
  }
  return out
}

// ── 限制性立方样条(PV-ANALYSIS-SPEC §03.4)──────────────────────────────

/** 解 n×n 线性方程组(高斯消元 + 部分主元)。失败返回 null。 */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-12) return null
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / M[i][i])
}

/**
 * 限制性立方样条趋势 + 95% 置信带。**这是 classifyShape 五标签的替代品**:
 * BIC 五选一逼着数据挑一个标签,形状不在那五种里就被硬塞;样条不预设形状,曲线自己长出来,
 * 由看的人自己判。节点数固定 —— 让用户拖节点等于让他调出想要的结论。
 *
 * 节点取时间分位数(默认 4 个:5% / 35% / 65% / 95%)。基函数 = [1, x, s1, s2](k−2 个样条项),
 * 两端强制线性(这就是「限制性」的含义:外推不翘上天)。
 * 置信带 = ±1.96 × sqrt(残差方差 × x'(X'X)⁻¹x),数据稀的时段自动张开。
 */
export function rcsTrend(
  resid: { date: string; v: number }[], knots = 4,
): { date: string; fit: number; lo: number; hi: number }[] {
  const n = resid.length
  if (n < knots + 2) return []
  const x = resid.map((_, i) => i / Math.max(1, n - 1))
  const y = resid.map(r => r.v)
  const qs = [0.05, 0.35, 0.65, 0.95].slice(0, knots)
  const sorted = [...x].sort((a, b) => a - b)
  const t = qs.map(q => sorted[Math.min(n - 1, Math.floor(q * (n - 1)))])
  const kEnd = t[t.length - 1], kPre = t[t.length - 2]
  if (!(kEnd - t[0] > 1e-9)) return []
  const cube = (u: number) => (u > 0 ? u ** 3 : 0)
  // Harrell 的 RCS 基:第 j 项 = (x−tj)³₊ − (x−t_{k−1})³₊·(t_k−tj)/(t_k−t_{k−1})
  //                              + (x−t_k)³₊·(t_{k−1}−tj)/(t_k−t_{k−1})
  const basis = (u: number) => {
    const b = [1, u]
    for (let j = 0; j < t.length - 2; j++) {
      const den = (kEnd - kPre) || 1e-9
      const scale = (kEnd - t[0]) ** 2 || 1e-9
      b.push((cube(u - t[j]) - cube(u - kPre) * (kEnd - t[j]) / den + cube(u - kEnd) * (kPre - t[j]) / den) / scale)
    }
    return b
  }
  const X = x.map(basis)
  const p = X[0].length
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
  const Xty = new Array(p).fill(0)
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i]
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]
    }
  }
  const beta = solve(XtX.map(r => [...r]), [...Xty])
  if (!beta) return []
  const fit = X.map(row => row.reduce((t2, v, k) => t2 + v * beta[k], 0))
  const sse = y.reduce((t2, v, i) => t2 + (v - fit[i]) ** 2, 0)
  const s2 = n > p ? sse / (n - p) : 0
  // (X'X)⁻¹ 逐列解出来,只为拿 x'(X'X)⁻¹x
  const inv: number[][] = []
  for (let c = 0; c < p; c++) {
    const e = new Array(p).fill(0); e[c] = 1
    const col = solve(XtX.map(r => [...r]), e)
    if (!col) return []
    inv.push(col)
  }
  return resid.map((r, i) => {
    let q = 0
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) q += X[i][a] * inv[b][a] * X[i][b]
    const half = 1.96 * Math.sqrt(Math.max(0, s2 * q))
    return { date: r.date, fit: fit[i], lo: fit[i] - half, hi: fit[i] + half }
  })
}

// ── 快照:一份数据、一次计算、一个 id ───────────────────────────────────

export interface ReadingRow {
  stationId: number; date: string
  gen: number; selfUse: number; gridFeed: number; revenue: number
  priceSnap: number | null
}

/** 五条判据线 + 年锚点。全部来自参数中心(V120),不在代码里写死 —— 见 §04.1。 */
export interface Criteria {
  anchorHours: number    // pv_yield_anchor_h      950
  resid: number          // pv_crit_resid          0.10
  dispRatio: number      // pv_crit_disp_ratio     1.5
  coverMonth: number     // pv_crit_cover_month    0.90
  ledger: number         // pv_crit_ledger         0.03
  yieldRatio: number     // pv_crit_yield_ratio    0.85
  minOnlineDays: number  // 常量 90:在网不足这么多天,该栋一律「读不出」
}

export const DEFAULT_CRITERIA: Criteria = {
  anchorHours: 950, resid: 0.10, dispRatio: 1.5,
  coverMonth: 0.90, ledger: 0.03, yieldRatio: 0.85, minOnlineDays: 90,
}

export interface SnapshotInput {
  year: number
  stations: StationCfg[]
  rows: ReadingRow[]
  gridPrice: number          // 上网标杆价 元/kWh
  crit?: Partial<Criteria>   // 参数中心的当前值;不传 = 用默认
  minStations?: number       // 当日在网栋数下限,低于它当天算不出基准
  prevRows?: ReadingRow[]    // 上一年抄表(同比用)。不传 = 没取过,同比位显「—」不显「0%」
}

/** 每栋的基础量。**全是事实,没有一个判词** —— 状态灯/情况/建议那一套在 v2 里整条删掉了。 */
export interface StationRow {
  id: number; name: string; phase: number
  metered: boolean
  cadence: 'daily' | 'monthly'
  days: number                     // 在网(有抄表且进了矩阵)天数
  capKwp: number | null            // 台账装机
  theoKwp: number | null           // 理论装机 = 板数 × 标称 W ÷ 1000
  ledgerDiff: number | null        // (台账 − 理论) ÷ 理论
  genYear: number
  selfKwh: number; gridKwh: number; lossKwh: number
  revSelf: number; revGrid: number
  yieldHours: number | null        // 年等效小时
  yieldDenom: 'theoretical' | 'ledger' | null
  yieldRatio: number | null        // 年等效小时 ÷ 锚点
}

export type CritKey = 'resid' | 'disp' | 'cover' | 'ledger' | 'yield'

/** 命中清单的一行。三段式:哪个数 · 多少 · 跟什么比(§05)。 */
export interface Hit {
  stationId: number
  station: string
  criterion: CritKey
  what: string       // 「月残差中位数」
  value: string      // 「8–12 月 −25%」
  line: string       // 「判据线 ±10%」
  readable: boolean  // false = 样本不足,读不出 —— 既不是命中也不是未命中
}

export interface AnaSnapshot {
  id: string
  year: number
  months: string[]                                  // 该年出现过的 ym,升序 —— 网格的列
  stations: StationRow[]
  /** 三张同网格的 13×12:行 = stations 顺序,列 = months 顺序。null = 该月没有可算的值 */
  grid: {
    deviation: Map<number, (number | null)[]>       // M1 月残差中位数(比例,+高 −低)
    dispersion: Map<number, (number | null)[]>      // M2 月稳健 σ(比例)
    coverage: Map<number, (number | null)[]>        // D2 有抄表天数 ÷ 当月天数
    born: Map<number, number>                       // 该栋首次出现的列下标 —— 之前是「未投产」留白,不是漏抄
  }
  slopes: Map<number, SlopeRow[]>                   // M3
  hits: Hit[]                                       // F1
  ledger: {                                         // L3 账面量
    monthly: { labels: string[]; self: number[]; grid: number[]; loss: number[]; lossPct: number[] }
    yieldByMonth: (number | null)[]                 // R4/A1:全园加权月等效小时
  }
  crit: Criteria
  parkYieldHours: number | null                     // A1 右上角:全园年等效小时
  parkYieldRatio: number | null                     // ÷ 锚点
  polish: PolishResult
  usedDays: Set<string> | null
  quality: {
    totalDays: number; okDays: number
    noMeter: string[]; noCapacity: string[]; noPanel: string[]
    minStationsOnDay: number; droppedThin: number; tooFewStations: boolean; degraded: boolean
  }
  yoy: {
    monthPct: number | null
    monthNote: string
    yearPct: number | null
    yearMonths: number
    yearNote: string
  }
}

/** FNV-1a:内容派生的短 id。同一份数据两次算必须同一个 id —— 页脚要拿它对账。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const YM = (d: string) => d.slice(0, 7)

function daysInYm(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** BH 的 q 值(不是布尔),逐点用于命中清单的假阳性闸门 */
export function bhFdrQ(pvals: number[]): number[] {
  const n = pvals.length
  const out: number[] = new Array(n).fill(1)
  if (!n) return out
  const idx = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  let prev = 1
  for (let k = n - 1; k >= 0; k--) {
    prev = Math.min(prev, (idx[k].p * n) / (k + 1))
    out[idx[k].i] = Math.min(1, prev)
  }
  return out
}

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%`
const monLabel = (ym: string) => `${Number(ym.slice(5, 7))} 月`

/** 把一串命中的月份压成「8–12 月」这样的区段文案;不连续时用顿号分开 */
function monthSpan(yms: string[], all: string[]): string {
  if (!yms.length) return ''
  const idx = yms.map(m => all.indexOf(m)).sort((a, b) => a - b)
  const parts: string[] = []
  let start = idx[0], prev = idx[0]
  for (let i = 1; i <= idx.length; i++) {
    if (i < idx.length && idx[i] === prev + 1) { prev = idx[i]; continue }
    parts.push(start === prev ? monLabel(all[start]) : `${Number(all[start].slice(5, 7))}–${monLabel(all[prev])}`)
    if (i < idx.length) { start = idx[i]; prev = idx[i] }
  }
  return parts.join('、')
}

/**
 * 五条判据的命中清单(PV-ANALYSIS-SPEC §04.3)。三条硬规矩都在这个函数里:
 *   ① **只列命中的,不列「正常」的** —— 屏做不到「正常」这个保证(看不见遮挡/朝向/倾角)。
 *   ② **按楼栋固定顺序,不按严重度排** —— 一排序就要选排序键,那是业务判断不是屏能答的。
 *   ③ **必须有第三档「读不出」** —— 在网不足 minOnlineDays 的站,既不是命中也不是未命中。
 *
 * `resid` 这条**同时要幅度与闸门**:13 栋 × 12 月 = 156 个格子拿 ±10% 去比,纯噪声也会中一片
 * (月中位数的标准误在 σ=25%、ρ=0.5 下约 8%,±10% 只有 1.25 个标准误)。所以它还要过
 * BH-FDR:族 = 逐栋预注册的变点检验 p。两条都写在行上,用户能自己复算。
 */
export function criteriaHits(
  stations: StationRow[], months: string[],
  grid: AnaSnapshot['grid'], residQ: Map<number, number>, crit: Criteria,
): Hit[] {
  const hits: Hit[] = []
  // 园区同月中位波动 —— disp 这条是相对园区自己的,尺度无关
  const parkDisp = months.map((_, c) => {
    const col: number[] = []
    for (const [, arr] of grid.dispersion) { const v = arr[c]; if (v != null) col.push(v) }
    return col.length ? median(col) : null
  })

  for (const s of stations) {
    if (!s.metered) continue
    const push = (criterion: CritKey, what: string, value: string, line: string, readable = true) =>
      hits.push({ stationId: s.id, station: s.name, criterion, what, value, line, readable })

    // ③ 读不出:在网天数不足。整栋一行,不逐条重复
    if (s.days > 0 && s.days < crit.minOnlineDays) {
      push('resid', '在网天数', `${s.days} / 365 天`, `判据线 ≥ ${crit.minOnlineDays} 天 · 读不出`, false)
      continue
    }

    // 台账差:纯算术,不需要任何统计,板数一录进来就能算
    if (s.theoKwp != null && s.capKwp != null && s.ledgerDiff != null) {
      if (Math.abs(s.ledgerDiff) > crit.ledger) {
        push('ledger', '台账差',
          `${s.capKwp.toFixed(1)} vs 理论 ${s.theoKwp.toFixed(1)}（${pct(s.ledgerDiff)}）`,
          `判据线 ±${(crit.ledger * 100).toFixed(0)}%`)
      }
    } else if (s.days > 0) {
      push('ledger', '台账差', '板数或单块功率未录', '录入后可算 · 读不出', false)
    }

    // 月偏离:幅度 + BH 闸门,两条都写出来
    const dev = grid.deviation.get(s.id) ?? []
    const over = months.filter((_, c) => dev[c] != null && Math.abs(dev[c]!) > crit.resid)
    const q = residQ.get(s.id) ?? 1
    if (over.length && q < 0.05) {
      const vals = over.map((_, i) => dev[months.indexOf(over[i])]!)
      const worst = vals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), vals[0])
      push('resid', '月残差中位数', `${monthSpan(over, months)} ${pct(worst)}`,
        `判据线 ±${(crit.resid * 100).toFixed(0)}% 且 q<0.05`)
    }

    // 月波动:相对园区同月中位
    const dsp = grid.dispersion.get(s.id) ?? []
    const dOver = months.filter((_, c) => dsp[c] != null && parkDisp[c] != null && dsp[c]! > parkDisp[c]! * crit.dispRatio)
    if (dOver.length) {
      const c0 = months.indexOf(dOver[0])
      push('disp', '月波动', `${monthSpan(dOver, months)} ${(dsp[c0]! * 100).toFixed(0)}%`,
        `园区同月中位 × ${crit.dispRatio} = ${(parkDisp[c0]! * crit.dispRatio * 100).toFixed(0)}%`)
    }

    // 月抄表覆盖:纯事实
    const cov = grid.coverage.get(s.id) ?? []
    const born = grid.born.get(s.id) ?? 0
    const cOver = months.filter((_, c) => c >= born && cov[c] != null && cov[c]! < crit.coverMonth)
    if (cOver.length) {
      const c0 = months.indexOf(cOver[0])
      push('cover', '月抄表覆盖', `${monthSpan(cOver, months)} ${(cov[c0]! * 100).toFixed(0)}%`,
        `判据线 ≥ ${(crit.coverMonth * 100).toFixed(0)}%`)
    }

    // 年等效小时 ÷ 锚点。第一年满不了 300 天的站显「读不出」——
    // 这条本来就是年粒度的,不满一年算出来的比值没有意义
    if (s.yieldRatio != null && s.days >= 300) {
      if (s.yieldRatio < crit.yieldRatio) {
        push('yield', '年等效小时', `${s.yieldHours!.toFixed(0)} 小时（锚点的 ${(s.yieldRatio * 100).toFixed(0)}%）`,
          `判据线 ≥ 锚点 ${crit.anchorHours} × ${(crit.yieldRatio * 100).toFixed(0)}%`)
      }
    } else if (s.days > 0 && s.metered) {
      push('yield', '年等效小时', s.yieldDenom == null ? '缺分母（板数与台账都没有）' : '不满一年',
        `判据线 ≥ 锚点 ${crit.anchorHours} × ${(crit.yieldRatio * 100).toFixed(0)}% · 读不出`, false)
    }
  }
  return hits
}

export function buildSnapshot(input: SnapshotInput): AnaSnapshot {
  const { year, stations, rows, gridPrice, prevRows, minStations = 3 } = input
  const crit: Criteria = { ...DEFAULT_CRITERIA, ...input.crit }

  // ① 零剔除(§01)。没有任何按发电量或天气的日过滤。
  //    唯一会被剔的是「当日在网栋数不足」的日子 —— 那是基准算不出来,不是数据不好。
  const readDates = new Set(rows.map(r => r.date))
  const months = [...new Set(rows.map(r => YM(r.date)))].sort()
  const colOf = new Map(months.map((m, i) => [m, i]))

  const noMeter = stations.filter(s => !s.metered).map(s => s.name)
  const noCapacity = stations.filter(s => s.metered && (s.capKwp == null || s.capKwp <= 0)).map(s => s.name)
  const noPanel = stations.filter(s => s.metered && theoreticalKwp(s) == null).map(s => s.name)

  const polish0 = medianPolish(rows, stations, null)
  const countDay = (pr: PolishResult) => {
    const m = new Map<string, number>()
    for (const [, byDate] of pr.resid) for (const d of byDate.keys()) m.set(d, (m.get(d) ?? 0) + 1)
    return m
  }
  // 在网栋数 < 3 的日子不出 β(中位数在 n<3 时没有意义),但那天的原始值照常进 L3 的账面图。
  // 门槛从 v1 的 8 降到 3:8 会把只有一期五栋的 1–5 月整段剔光,而 5 栋照样能互比,只是区间更宽。
  const parkStations = stations.filter(s => s.metered && s.capKwp != null && s.capKwp > 0).length
  const tooFewStations = parkStations > 0 && parkStations < minStations
  const thinDays = tooFewStations ? [] : [...countDay(polish0)].filter(([, n]) => n < minStations).map(([d]) => d)
  const usedDays = thinDays.length ? new Set([...readDates].filter(d => !thinDays.includes(d))) : null
  const polish = thinDays.length ? medianPolish(rows, stations, usedDays) : polish0
  const perDay = countDay(polish)
  const minStationsOnDay = perDay.size ? Math.min(...perDay.values()) : 0

  // ② 逐站基础量
  const byStation = new Map<number, ReadingRow[]>()
  for (const r of rows) {
    const a = byStation.get(r.stationId) ?? []
    a.push(r); byStation.set(r.stationId, a)
  }

  const stationRows: StationRow[] = stations.map(s => {
    const rs = byStation.get(s.id) ?? []
    const resid = polish.resid.get(s.id) ?? new Map<string, number>()
    const genYear = rs.reduce((t, r) => t + r.gen, 0)
    const selfKwh = rs.reduce((t, r) => t + r.selfUse, 0)
    const gridKwh = rs.reduce((t, r) => t + r.gridFeed, 0)
    const theoKwp = theoreticalKwp(s)
    const denomKwp = theoKwp ?? (s.capKwp != null && s.capKwp > 0 ? s.capKwp : null)
    const yieldHours = annualYieldHours(genYear, denomKwp)
    return {
      id: s.id, name: s.name, phase: s.phase, metered: s.metered,
      cadence: cadenceOf(rs.map(r => r.date)),
      days: resid.size,
      capKwp: s.capKwp, theoKwp,
      ledgerDiff: theoKwp != null && s.capKwp != null && theoKwp > 0 ? (s.capKwp - theoKwp) / theoKwp : null,
      genYear, selfKwh, gridKwh, lossKwh: genYear - selfKwh - gridKwh,
      revSelf: rs.reduce((t, r) => t + r.revenue, 0),
      revGrid: gridKwh * gridPrice,
      yieldHours,
      yieldDenom: theoKwp != null ? 'theoretical' : denomKwp != null ? 'ledger' : null,
      yieldRatio: yieldHours != null && crit.anchorHours > 0 ? yieldHours / crit.anchorHours : null,
    }
  })

  // ③ 三张同网格。列 = months;born 之前留白(未投产),born 之后没有值才是漏抄
  const deviation = new Map<number, (number | null)[]>()
  const dispersion = new Map<number, (number | null)[]>()
  const coverage = new Map<number, (number | null)[]>()
  const born = new Map<number, number>()
  const disp = monthlyDispersion(polish)
  for (const s of stations) {
    const rs = byStation.get(s.id) ?? []
    const firstYm = rs.length ? rs.map(r => YM(r.date)).sort()[0] : null
    born.set(s.id, firstYm != null ? (colOf.get(firstYm) ?? 0) : months.length)

    const residByYm = new Map<string, number[]>()
    for (const [d, v] of polish.resid.get(s.id) ?? new Map<string, number>()) {
      const a = residByYm.get(YM(d)) ?? []
      a.push(v); residByYm.set(YM(d), a)
    }
    // log 域中位数换回比例:exp(m) − 1
    deviation.set(s.id, months.map(m => {
      const a = residByYm.get(m)
      return a && a.length >= 4 ? Math.exp(median(a)) - 1 : null
    }))
    const d2 = disp.get(s.id) ?? new Map<string, number>()
    dispersion.set(s.id, months.map(m => d2.get(m) ?? null))

    const cntByYm = new Map<string, number>()
    for (const r of rs) cntByYm.set(YM(r.date), (cntByYm.get(YM(r.date)) ?? 0) + 1)
    coverage.set(s.id, months.map(m => {
      const c = cntByYm.get(m)
      return c == null ? null : Math.min(1, c / daysInYm(m))
    }))
  }
  const grid = { deviation, dispersion, coverage, born }

  // ④ 预注册主统计量 = 变点检验(单侧,零分布走循环分块置换),每栋只此一个。
  //    它是 F1 里 resid 那条的**闸门**:156 个格子拿 ±10% 去比,纯噪声也会中一片。
  const cpIds: number[] = []
  const cpP: number[] = []
  for (const s of stations) {
    if (!s.metered) continue
    const base = [...(polish.resid.get(s.id) ?? new Map<string, number>())]
      .sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)
    if (base.length < 8) continue
    const cp = changePoint(base, { block: 14, B: 999, seed: 20260831 })
    cpIds.push(s.id)
    cpP.push(cp.index >= 0 && cp.dropPct > 0 ? cp.p : 1)
  }
  const qs = bhFdrQ(cpP)
  const residQ = new Map(cpIds.map((id, i) => [id, qs[i]]))

  // ⑤ 账面量(L3)。零容量依赖 —— 板数与铭牌都没录进来之前,这一层照常出真数
  const acc = new Map(months.map(m => [m, { self: 0, grid: 0, gen: 0 }]))
  for (const r of rows) {
    const a = acc.get(YM(r.date))
    if (!a) continue
    a.self += r.selfUse; a.grid += r.gridFeed; a.gen += r.gen
  }
  const monthly = {
    labels: months,
    self: months.map(m => acc.get(m)!.self),
    grid: months.map(m => acc.get(m)!.grid),
    loss: months.map(m => acc.get(m)!.gen - acc.get(m)!.self - acc.get(m)!.grid),
    lossPct: months.map(m => {
      const a = acc.get(m)!
      return a.gen > 0 ? (a.gen - a.self - a.grid) / a.gen : 0
    }),
  }

  // ⑥ 全园月等效小时(A1/R4)。分母 = 当月有抄表的站的容量合计(优先理论装机)
  const denomOf = new Map(stationRows.map(s => [s.id, s.theoKwp ?? (s.capKwp && s.capKwp > 0 ? s.capKwp : null)]))
  const yieldByMonth = months.map(m => {
    let gen = 0, cap = 0
    const seen = new Set<number>()
    for (const r of rows) {
      if (YM(r.date) !== m) continue
      gen += r.gen
      if (!seen.has(r.stationId)) {
        seen.add(r.stationId)
        cap += denomOf.get(r.stationId) ?? 0
      }
    }
    return cap > 0 ? gen / cap : null
  })
  const parkGen = stationRows.reduce((t, s) => t + s.genYear, 0)
  const parkCap = stationRows.reduce((t, s) => t + (denomOf.get(s.id) ?? 0), 0)
  const parkYieldHours = parkCap > 0 ? parkGen / parkCap : null
  const parkYieldRatio = parkYieldHours != null && crit.anchorHours > 0 ? parkYieldHours / crit.anchorHours : null

  const hits = criteriaHits(stationRows, months, grid, residQ, crit)

  return {
    id: fnv1a([
      year, stations.length, rows.length, gridPrice,
      parkGen.toFixed(3), crit.resid, crit.ledger, crit.anchorHours,
    ].join('|')),
    year, months,
    stations: stationRows,
    grid,
    slopes: responseSlopes(rows.map(r => ({ stationId: r.stationId, date: r.date, gen: r.gen })), polish, stations),
    hits,
    ledger: { monthly, yieldByMonth },
    crit,
    parkYieldHours, parkYieldRatio,
    polish, usedDays,
    quality: {
      totalDays: readDates.size,
      okDays: usedDays ? usedDays.size : readDates.size,
      noMeter, noCapacity, noPanel,
      minStationsOnDay, droppedThin: thinDays.length, tooFewStations,
      degraded: thinDays.length > 0 || tooFewStations,
    },
    yoy: yoyOf(rows, prevRows, months[months.length - 1] ?? `${year}-01`, gridPrice),
  }
}

/**
 * 同比(PV-ANALYSIS-SPEC §07)。两条护栏都在这里,都是「不许静默」:
 * ① 上一年无抄表 → 显 `—`,**不显 `0%`**。0% 意味着「持平」,—— 意味着「没得比」。
 * ② 跨年月份不齐 → 按**两年都有抄表的月**对齐后再比,并**报出参与月数**。
 */
function moneyOf(r: ReadingRow, gridPrice: number): number {
  return r.revenue + r.gridFeed * gridPrice
}

function sumByYm(rows: ReadingRow[], gridPrice: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(YM(r.date), (m.get(YM(r.date)) ?? 0) + moneyOf(r, gridPrice))
  return m
}

export function yoyOf(
  rows: ReadingRow[], prevRows: ReadingRow[] | undefined, ym: string, gridPrice: number,
): AnaSnapshot['yoy'] {
  const none = (note: string): AnaSnapshot['yoy'] =>
    ({ monthPct: null, monthNote: note, yearPct: null, yearMonths: 0, yearNote: note })
  if (!prevRows) return none('未取上一年数据')
  if (!prevRows.length) return none('上一年无抄表记录，没得比')

  const cur = sumByYm(rows, gridPrice)
  const prev = sumByYm(prevRows, gridPrice)

  const prevYm = `${Number(ym.slice(0, 4)) - 1}-${ym.slice(5, 7)}`
  const a = cur.get(ym) ?? 0
  const b = prev.get(prevYm)
  const monthPct = b != null && b > 0 ? (a / b - 1) * 100 : null
  const monthNote = monthPct == null ? `${prevYm} 无抄表记录，没得比` : `对比 ${prevYm}`

  const shared = [...cur.keys()]
    .filter(k => prev.has(`${Number(k.slice(0, 4)) - 1}-${k.slice(5, 7)}`))
    .sort()
  if (!shared.length) {
    return { monthPct, monthNote, yearPct: null, yearMonths: 0, yearNote: '两年没有共同的抄表月份，没得比' }
  }
  const curSum = shared.reduce((t, k) => t + (cur.get(k) ?? 0), 0)
  const prevSum = shared.reduce((t, k) => t + (prev.get(`${Number(k.slice(0, 4)) - 1}-${k.slice(5, 7)}`) ?? 0), 0)
  const yearPct = prevSum > 0 ? (curSum / prevSum - 1) * 100 : null
  return {
    monthPct, monthNote,
    yearPct, yearMonths: shared.length,
    yearNote: yearPct == null
      ? '上一年对应月份无收益，没得比'
      : `按两年都有抄表的 ${shared.length} 个月对齐后比较`,
  }
}

/**
 * 抄表节律(§07)。只有月抄的站**不能与日频站混排** ——
 * N=12 与 N=247 的置信区间差一个量级,并排放会让人以为两者一样可信。
 * 判定:覆盖 ≥3 个月,且平均每月 ≤1.5 条。
 */
export function cadenceOf(dates: string[]): 'daily' | 'monthly' {
  if (dates.length < 3) return 'daily'
  const months = new Set(dates.map(YM))
  if (months.size < 3) return 'daily'
  return dates.length / months.size <= 1.5 ? 'monthly' : 'daily'
}

// ── L5 单栋抽屉(PV-ANALYSIS-SPEC §06.5)─────────────────────────────────
//
// 挂在同一个快照上,不另起一次计算 —— 铁律:一份数据、一次计算、一个 id。

export interface StationDetail {
  dates: string[]
  resid: number[]                                            // log 域残差
  spline: { date: string; fit: number; lo: number; hi: number }[]   // S2
  cp: ChangePoint | null                                     // S3
  cpDate: string | null; cpLo: string | null; cpHi: string | null
  center: number                                             // M4 中心线
  sigma: number                                              // M4 控制限半宽(1σ)
  limitFrom: string | null; limitTo: string | null           // 控制限的估计窗口 —— 画在图上
}

/**
 * 单栋详情。M4 的控制限**用变点前段估** —— 整期都有故障时用全期估,限本身被撑宽,
 * 什么都不越限,检测器对最严重的资产最沉默。估计窗口要画出来,不能只给两条线。
 */
export function buildDetail(snap: AnaSnapshot, stationId: number): StationDetail | null {
  const byDate = snap.polish.resid.get(stationId)
  if (!byDate || byDate.size < 8) return null
  const arr = [...byDate].sort((a, b) => a[0].localeCompare(b[0]))
  const dates = arr.map(([d]) => d)
  const resid = arr.map(([, v]) => v)
  const cp = changePoint(resid, { block: 14, B: 999, seed: 20260831 })
  const idx = cp.index >= 0 && cp.index < dates.length ? cp.index : null
  // 变点前段:至少留 8 个点,否则退回全期并在 limitFrom/To 上如实标出来
  const to = idx != null && idx >= 8 ? idx : resid.length
  const base = resid.slice(0, to)
  return {
    dates, resid,
    spline: rcsTrend(arr.map(([date, v]) => ({ date, v }))),
    cp: idx == null ? null : cp,
    cpDate: idx == null ? null : dates[idx],
    cpLo: idx == null || cp.ciLo < 0 ? null : dates[Math.min(cp.ciLo, dates.length - 1)],
    cpHi: idx == null || cp.ciHi < 0 ? null : dates[Math.min(cp.ciHi, dates.length - 1)],
    center: median(base),
    sigma: robustSigma(base),
    limitFrom: dates[0] ?? null,
    limitTo: dates[Math.max(0, to - 1)] ?? null,
  }
}
